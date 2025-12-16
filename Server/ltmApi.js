const mqtt = require("mqtt")
const fs = require("node:fs/promises")
const express = require("express")
const { generateDocs } = require("./modules/docsCreator")
const apiDocsJson = require("./ltmApi.json")
const { createDb, createEndpointStat, incrementEndpointStat, getEndpointStat } = require("./ltmApiDb")

const app = express()

const OPTIONS = {
    allowedTrainTypes: {
        default: ["HL", "HV"],
        train: [], //all
        comp: []
    }
}


let ledOrder
let sections
let stations
let client
let db

const testColors = {
    0: [255, 0, 0],
    1: [255, 255, 0],
    2: [0, 255, 0],
    3: [0, 255, 255],
    4: [0, 0, 255],
}

const fullColors = {
    0: [255, 0, 0],     // Red
    1: [255, 128, 0],   // Orange
    2: [255, 255, 0],   // Yellow
    // SKIPPED 3: [128, 255, 0], // Yellow-green
    3: [0, 255, 0],     // Green
    // SKIPPED 5: [0, 255, 128], // Turqoise
    4: [0, 255, 255],   // Cyan
    // SKIPPED 7: [0, 128, 255], // Almost blue
    5: [0, 0, 255],     // Blue
    6: [128, 0, 255],   // Purple
    7: [255, 0, 255],   // Magenta
    8: [255, 0, 128],   // Pink
    9: [255, 255, 255], // White
}

const delayColors = {
    0: [0, 255, 0],
    1: [255, 255, 0],
    2: [255, 0, 0],
    2: [0, 255, 255],
}

let ledState
module.exports.ltmApi = function () {
    Promise.all([
        getJSON("ledsInOrder"), getJSON("lines",), getJSON("sections"), getJSON("stations"), createDb()
    ]).then((jsonData) => {
        [ledOrder, lines, sections, stations, db] = jsonData
        ledState = Object.values(ledOrder).flat().map(id => ({ id: id, trains: [] }))

        // INITIAL STATE REQUEST

        initialRequest()
        const json = {
            version: "100",
            timestamp: 0,
            update: 5,
            colors:
                fullColors
            , updates: []
        }
        createEndpoints([
            {
                epLoc: "local",
                statType: "user_fetches",
                epPath: "/",
                method: "get",
                on: (req, res) => {
                    res.send(generateDocs(apiDocsJson))
                }
            },
            {
                epLoc: "local",
                statType: "user_fetches",
                epPath: "/ping",
                method: "get",
                on: (req, res) => {
                    res.send(req.query.msg || "Hello World!")
                }
            },
            {
                epLoc: "local",
                statType: "user_fetches",
                epPath: "/100.json",
                method: "get",
                on: (req, res) => {
                    json.timestamp = Date.now() - 20

                    json.colors = getColorTable(req.query.mode)
                    generateUpdates(req.query.mode).then(updates => {
                        json.updates = updates
                        res.json(json)
                    })
                }
            },
            {
                epLoc: "local",
                statType: "user_fetches",
                epPath: "/stats",
                method: "get",
                on: (req, res) => {
                    if (!req.query.stat || !req.query.stat.length) res.status(400).json({ message: "Invalid parameter 'stat': missing" })
                    const stat = req.query.stat.split("..")
                    if (stat.length != 2) res.status(400).json({ message: "Invalid parameter 'stat': bad syntax" })
                    getEndpointStat({
                        epLoc: stat[0],
                        epPath: stat[1]
                    }).then(response => {
                        if (!response) res.status(400).json({ message: "Invalid parameter 'stat': bad values" })
                        res.json(response)
                    })
                }
            }
        ], app)

        console.log("Starting up LTM API: Listening")
        // MQTT HANDLING
        const mqttUrl = "wss://rata.digitraffic.fi/mqtt"
        const mqttConnectStatdata =
        {
            epLoc: "digitraffic",
            statType: "server_mqtt_connections",
            epPath: mqttUrl
        }
        const mqttMessageStatdata =
        {
            epLoc: "digitraffic",
            statType: "server_mqtt_messages",
            epPath: "live-trains"
        }
        client = mqtt.connect(mqttUrl)
        

        createEndpointStat(mqttConnectStatdata)
        createEndpointStat(mqttMessageStatdata)

        //train-tracking/<departure_date,train_number,type,station,track_section,previous_station,next_station,previous_track_section,next_track_section>
        client.on("connect", () => {
            incrementEndpointStat(mqttConnectStatdata)
            client.subscribe("trains/+/+/+/+/#", (err) => {
                if (err) console.error(`LTM API: MQTT connection error: ${err}`)
                else console.log("Starting up LTM API: Connected to Digitraffic")
            });
        });


        // PERIODICALLY REMOVE GHOST TRAINS
        setInterval(handleGhostTrains, 1000)

        // MQTT MESSAGE HANDLING

        client.on("message", (topic, message) => {
            incrementEndpointStat(mqttMessageStatdata)
            // message is Buffer
            parseMessage(topic, JSON.parse(message.toString()), OPTIONS)
        });
    })
    return app
}
function createEndpoints(eps, app) {
    eps.forEach(async ep => {
        if (ep.epLoc = "local") app[ep.method](ep.epPath, (...params) => {
            incrementEndpointStat(ep)
            ep.on(...params)
        })
        await createEndpointStat(ep)
    })
}
function handleGhostTrains() {
    const now = Date.now()
    ledState.forEach(led => {
        led.trains = led.trains.filter(t => ((now - t.t) / 1000 / 60) < 30)
    });
}
function initialRequest() {
    const url = "https://rata.digitraffic.fi/api/v1/live-trains"
    const statdata =
    {
        epLoc: "digitraffic",
        statType: "server_fetches",
        epPath: url
    }
    createEndpointStat(statdata)
    fetchData(url).then(data => {
        incrementEndpointStat(statdata)
        const trains = JSON.parse(data)
        trains.forEach(train => {
            parseMessage("", train, OPTIONS)
        });
        console.log("Starting up LTM API: Fetched initial data")
    })
}
async function fetchData(url) {
    const response = await fetch(url)
    return await response.text()
}
function parseMessage(topic, message, opt = { allowedTrainTypes: { default: [] } }) {
    const [endpoint,
        departureDateT,
        trainNumberT,
        trainCategoryT,
        trainTypeT,
        operatorT,
        commuterLineT,
        runningCurrentlyT,
        timetableTypeT] = topic.split("/")
    const { trainNumber,
        departureDate,
        operatorUICCode,
        operatorShortCode,
        trainType,
        trainCategory,
        commuterLineID,
        runningCurrently,
        cancelled,
        version,
        timetableType,
        timetableAcceptanceDate,
        deleted,
        timeTableRows } = message
    // Filters
    if (!runningCurrently) {
        return null
    }
    const filteredTimeTable = timeTableRows.filter(row => stations.find(s => s.stationShortCode == row.stationShortCode).passengerTraffic)

    const lastUpdate = getLastUpdate(filteredTimeTable)
    const nextUpdate = filteredTimeTable.find(row => !row.actualTime) || filteredTimeTable[0]


    if (!lastUpdate) return null
    let s
    if (lastUpdate.type == "ARRIVAL") {
        s = sections.find(sec => sec.code == lastUpdate.stationShortCode)
        if (!s) {
            //console.error("Could not find last update point in data", timeTableRows, lastUpdate)
            return null
        }
    } else {
        s = sections.find(sec => (sec.station1 == lastUpdate.stationShortCode && sec.station2 == nextUpdate.stationShortCode) || (sec.station2 == lastUpdate.stationShortCode && sec.station1 == nextUpdate.stationShortCode))
        if (!s) {
            //console.error("Could not find last update point in data", lastUpdate.stationShortCode, nextUpdate.stationShortCode)
            return null
        }
    }
    let track
    if (s.type == "multiBetween") {
        let tracks = findCorrectMultiTrack(s, commuterLineID, timeTableRows)
        if (lastUpdate.stationShortCode == s.station2) tracks.reverse()
        // TODO: multiBetween handling
        const t1 = new Date(nextUpdate.liveEstimateTime || nextUpdate.scheduledTime)
        const t2 = new Date(lastUpdate.actualTime || lastUpdate.scheduledTime)
        const diff = (Number(t1) - Number(t2))
        const intervalTime = diff / (tracks.length)
        const interval = setInterval(updateMultiBetween, intervalTime)
        let i = 0
        updateMultiBetween()
        function updateMultiBetween() {
            const track = tracks[i] || findCorrectTrack(sections.find(sec => sec.code == nextUpdate.stationShortCode), commuterLineID, timeTableRows)
            const lastTrack = tracks[i - 1]
            if (i >= tracks.length || (i != 0 && !(ledState.find(led => led.id == lastTrack.component).trains.find(t => t.n == trainNumber)))) {
                clearInterval(interval)
                return
            }
            updateLedState(track)
            i++
        }
        track = tracks[0]
    } else {
        track = findCorrectTrack(s, commuterLineID.length ? commuterLineID : null, timeTableRows)
    }
    if (!track) {
        console.error("No track", s, trainNumber, trainType)
        return null
    }
    if (track.length) track = track[0]

    updateLedState(track)





    function updateLedState(track) {
        const previousLed = ledState.find(led => led.id != track.component && led.trains.find(t => t.n == trainNumber))
        ledState.forEach(led => {
            led.trains = led.trains.filter(t => t.n != trainNumber)
            if (led.id == track.component) {
                led.trains.push({
                    n: trainNumber,
                    l: commuterLineID,
                    d: typeof lastUpdate.differenceInMinutes == "number" ? lastUpdate.differenceInMinutes : lastUpdate.unknownDelay,
                    t: Date.now(),
                    dt: departureDate,
                    ty: trainType,
                    p: previousLed && previousLed.id != track.component ? previousLed.id : null
                })
            }
        })
    }
}
function getLastUpdate(timeTable) {
    const last = timeTable[timeTable.findIndex(row => !row.actualTime) - 1]
    if (!last && timeTable[0] && timeTable[0].trainReady) {

        let update = timeTable[0]
        update.type = "ARRIVAL"
        return update
    }
    return last
}
function findCorrectMultiTrack(segment, lineID, timeTable) {
    return segment.segments.map(s => {
        return findCorrectTrack({ tracks: s }, lineID, timeTable)
    })
}
function findCorrectTrack(segment, lineID, timeTable) {
    let remainingTracks = segment.tracks
    const line = lineID == "V" || !lineID ? "-" : lineID
    if (remainingTracks.length > 1 && !segment.equalTracksException && !remainingTracks.find(t => !t.lines)) remainingTracks = remainingTracks.filter(t => t.lines.find(l => l == line))
    if ((line == "I" || line == "P") && remainingTracks.length > 1) {
        let railwayLine = ""
        if (line == "I" && timeTable[timeTable.length - 4].actualTime || line == "P" && !timeTable[timeTable.length - 4].actualTime) {
            railwayLine = "coastal"
        } else {
            railwayLine = "main"
        }
        remainingTracks = remainingTracks.filter(t => t.line == railwayLine)
    }
    if (remainingTracks.length != 1 && !segment.equalTracksException && line != "-") {
        console.error("Could not filter tracks")
        console.log(segment, line)
        return null
    }
    return remainingTracks[0]
}
async function generateUpdates(mode) {
    const allowedTrainTypes = OPTIONS.allowedTrainTypes[mode] || OPTIONS.allowedTrainTypes.default
    return (await Promise.all(ledState.map(async led => {
        let colors = []
        const block = componentIdtoBlock(led.id)
        const prevblock = componentIdtoBlock((led.trains.find(t => t.p) || { p: null }).p)
        if (mode == "test") {
            const section = sections.filter(s => (s.tracks || s.segments.flat()).some(t => t.component == led.id))
            colors = await Promise.all(section.map(getTrainColorFunction(mode)))
        } else {
            colors = await Promise.all(led.trains.filter(t => !(allowedTrainTypes.length) || allowedTrainTypes.find(type => type == t.ty)).map(getTrainColorFunction(mode)))
        }
        return led.trains.length || mode == "test" ? { b: [prevblock, block], c: colors, t: Date.now() } : []
    }))).flat()
}
function componentIdtoBlock(led) {
    return led ? (ledOrder["HPL-NOA"].some(id => id == led) ? ledOrder["HPL-NOA"].findIndex(id => id == led) + 300 : ledOrder["HKI-KTS"].findIndex(id => id == led) + 100) : null
}
function getColorTable(mode) {
    switch (mode) {
        case "delay":
            return delayColors;
        case "test":
            return testColors;
        case "lines":
        case "comp":
        case "train":
            return fullColors;
        default:
            return [[255, 0, 0]];
    }
}
function getTrainColorFunction(mode) {
    switch (mode) {
        case "lines":
            return getTrainColorByLine;
        case "delay":
            return getTrainColorByDelay;
        case "test":
            return getBlockColorBySectionType;
        case "comp":
            return getTrainColorByComposition;
        case "train":
            return getTrainColorByType;
        default:
            return () => 0;
    }
}
async function getTrainColorByComposition(t) {
    const response = await db.get(`
SELECT data
  FROM compositions
  WHERE trainNumber = ? AND depDate = ?
  `, [t.n, t.dt]
    )
    const loco = response ? JSON.parse(response.data).journeySections[0].locomotives[0].locomotiveType : "N/A"
    switch (loco) {
        case "Sm2":
            return 0;
        case "Sm3":
            return 3;
        case "Sm7":
            return 1;
        case "Sm4":
            return 2;
        case "Sr2":
            return 4;
        case "Sr3":
            return 5;
        case "Sm5":
            return 6;
        case "N/A":
            return 8;
        default:
            console.log(loco)
            return 9;
    }
}
function getTrainColorByLine(t) {
    switch (t.l) {
        case "A":
            return 1;
        case "E":
            return 2;
        case "U":
            return 7;
        case "Y":
        case "L":
        case "H":
            return 6;
        case "M":
        case "I":
            return 4;
        case "P":
            return 3;
        case "K":
            return 5;
        case "Z":
            return 9;
        case "D":
        case "T":
        case "R":
            return 8;
        // Not in service
        case "V":
            return 0;
        case "O":
            return 2;
        default:
            return 8;
    }
}
function getTrainColorByType(t) {
    switch (t.ty) {
        case "IC":
            return 0;
        case "HL":
            return 3;
        case "S":
            return 2;
        case "T":
            return 4;
        case "VET":
            return 1;
        case "SAA":
        case "W":
            return 5;
        default:
            return 9;
    }
}
function getTrainColorByDelay(t) {
    if (t.d === true) {
        return 3
    } else if (t.d < 2) {
        return 0
    } else if (t.d > 10) {
        return 2
    } else {
        return 1
    }
}
function getBlockColorBySectionType(s) {
    switch (s.type) {
        case "stop":
            return 0;
        case "station":
            return 1;
        case "between":
            return 2;
        case "multiBetween":
            return 3;
        default:
            return 4;
    }
}
async function getJSON(name) {
    const json = (await fs.readFile(`./data/${name}.json`)).toString()
    return JSON.parse(json)
}