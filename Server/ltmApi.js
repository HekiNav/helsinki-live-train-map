const mqtt = require("mqtt")
const fs = require("node:fs/promises")
const express = require("express")
const { generateDocs } = require("./modules/docsCreator")
const apiDocsJson = require("./ltmApi.json")
const { createDb } = require("./ltmApiDb")

const app = express()

const OPTIONS = {
    allowedTrainTypes: ["HV", "HL"]
}


let ledOrder
let lines
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

const lineColors = {
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
const compColors = {
    0: [255, 0, 0],   // Red    Sm2
    1: [255, 255, 0], // Yellow Sm7
    2: [0, 255, 0],   // Green  Sm4
    3: [128, 0, 255], // Purple Sm5
    4: [255, 0, 128], // Pink   Other
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

        //setInterval(reloadMap, 1000)

        app.get('/', (req, res) => {
            res.send(generateDocs(apiDocsJson))
        })
        const json = {
            version: "100",
            timestamp: 0,
            update: 5,
            colors:
                lineColors
            , updates: []
        }
        app.get('/ping', (req, res) => {
            res.send(req.query.msg || "Hello World!")
        })
        app.get('/100.json', (req, res) => {
            json.timestamp = Date.now() - 20

            json.colors = getColorTable(req.query.mode)
            generateUpdates(req.query.mode).then(updates => {
                json.updates = updates
                res.json(json)
            })

        })
        console.log("Starting up LTM API: Listening")
        // MQTT HANDLING
        client = mqtt.connect("wss://rata.digitraffic.fi/mqtt")

        //train-tracking/<departure_date,train_number,type,station,track_section,previous_station,next_station,previous_track_section,next_track_section>
        client.on("connect", () => {
            client.subscribe("trains/+/+/Commuter/HL/#", (err) => {
                if (err) console.error(`LTM API: MQTT connection error: ${err}`)
                else console.log("Starting up LTM API: Connected to Digitraffic")
            });
        });


        // PERIODICALLY REMOVE GHOST TRAINS
        setInterval(handleGhostTrains, 60000)

        // MQTT MESSAGE HANDLING

        client.on("message", (topic, message) => {
            // message is Buffer
            parseMessage(topic, JSON.parse(message.toString()), OPTIONS)
        });
    })
    return app
}
function handleGhostTrains() {
    const now = Date.now()
    ledState.forEach(led => {
        led.trains = led.trains.filter(t => ((now - t.t) / 1000 / 60) < 30)
    });
}
function initialRequest() {
    fetchData("https://rata.digitraffic.fi/api/v1/live-trains").then(data => {
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
function parseMessage(topic, message, opt = { allowedTrainTypes: [] }) {
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
    if (opt.allowedTrainTypes.length && !opt.allowedTrainTypes.find(type => type == trainType)) return null
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
            console.error("Could not find last update point in data", timeTableRows, lastUpdate)
        }
    } else {
        s = sections.find(sec => (sec.station1 == lastUpdate.stationShortCode && sec.station2 == nextUpdate.stationShortCode) || (sec.station2 == lastUpdate.stationShortCode && sec.station1 == nextUpdate.stationShortCode))
        if (!s) {
            console.error("Could not find last update point in data", lastUpdate.stationShortCode, nextUpdate.stationShortCode)
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
        const intervalTime = diff / (tracks.length - 1)
        const interval = setInterval(updateMultiBetween, intervalTime)
        let i = 0
        function updateMultiBetween() {
            i++
            const track = tracks[i]
            const lastTrack = tracks[i - 1]
            if (i >= tracks.length || !(ledState.find(led => led.id == lastTrack.component).trains.find(t => t.n == trainNumber))) {
                clearInterval(interval)
                return
            }
            updateLedState(track)
        }
        track = tracks[0]
    } else {
        track = findCorrectTrack(s, commuterLineID, timeTableRows)
    }
    if (!track) {
        console.error("No track", s, timeTableRows, commuterLineID)
        return null
    }
    if (track.length) track = track[0]

    updateLedState(track)




    function updateLedState(track) {
        ledState.forEach(led => {
            led.trains = led.trains.filter(t => t.n != trainNumber)
            if (led.id == track.component) {
                led.trains.push({
                    n: trainNumber,
                    l: commuterLineID,
                    d: typeof lastUpdate.differenceInMinutes == "number" ? lastUpdate.differenceInMinutes : lastUpdate.unknownDelay,
                    t: Date.now(),
                    dt: departureDate
                })
            }
        })
    }
}
function getLastUpdate(timeTable) {
    const last = timeTable[timeTable.findIndex(row => !row.actualTime) - 1]
    if (!last && timeTable[0].trainReady) {

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

    if (remainingTracks.length > 1 && !segment.equalTracksException && !remainingTracks.find(t => !t.lines)) remainingTracks = remainingTracks.filter(t => t.lines.find(l => l == lineID))
    if ((lineID == "I" || lineID == "P") && remainingTracks.length > 1) {
        let railwayLine = ""
        if (lineID == "I" && timeTable[timeTable.length - 4].actualTime || lineID == "P" && !timeTable[timeTable.length - 4].actualTime) {
            railwayLine = "coastal"
        } else {
            railwayLine = "main"
        }
        remainingTracks = remainingTracks.filter(t => t.line == railwayLine)
    }
    if (remainingTracks.length != 1 && !segment.equalTracksException) {
        console.error("Could not filter tracks")
        console.log(segment, lineID)
        return null
    }
    return remainingTracks[0]
}
async function generateUpdates(mode) {
    return (await Promise.all(ledState.map(async led => {
        const block = (ledOrder["HPL-NOA"].some(id => id == led.id) ? ledOrder["HPL-NOA"].findIndex(id => id == led.id) + 300 : ledOrder["HKI-KTS"].findIndex(id => id == led.id) + 100)
        let colors = []
        if (mode == "test") {
            const section = sections.filter(s => (s.tracks || s.segments.flat()).some(t => t.component == led.id))
            colors = await Promise.all(section.map(getTrainColorFunction(mode)))
        } else {
            colors = await Promise.all(led.trains.map(getTrainColorFunction(mode)))
        }
        return led.trains.length || mode == "test" ? { b: [block, block], c: await colors, t: 0 } : []
    }))).flat()
}
function getColorTable(mode) {
    switch (mode) {
        case "lines":
            return lineColors;
        case "delay":
            return delayColors;
        case "test":
            return testColors;
        case "comp":
            return compColors;
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
        default:
            return () => 0;
    }
}
async function getTrainColorByComposition(t) {
    const { data } = await db.get(`
SELECT data
  FROM compositions
  WHERE trainNumber = ? AND depDate = ?
  `, [t.n, t.dt]
    )
    const { journeySections } = JSON.parse(data)
    const loco = journeySections[0].locomotives[0].locomotiveType
    console.log(loco)
    switch (loco) {
        case "Sm2":
            return 0;
        case "Sm7":
            return 1;
        case "Sm4":
            return 2;
        case "Sm5":
            return 3;
        default:
            return 4;
    }
}
function getTrainColorByLine(t) {
    switch (t.l) {
        case "A":
            return 1;
        case "E":
            return 7;
        case "U":
            return 2;
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