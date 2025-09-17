const express = require("express")
const cors = require("cors")
const mqtt = require("mqtt")
const fs = require("node:fs/promises")
const app = express()
const port = 3001

app.use(cors())

const MEASURING_TIME = null //Time limit for MQTT in seconds, starts from 1st message, logs amount of messages after

const OPTIONS = {
    allowedTrainTypes: ["HV", "HL"]
}


let ledOrder
let lines
let sections
let stations
let client

const testColors = {
    0: [255,0,0],
    1: [255,255,0],
    2: [0,255,0],
    3: [0,255,255],
    4: [0,0,255],
}

const lineColors = {
    0: [255, 0, 0], // Red
    1: [255, 128, 0], // Orange
    2: [255, 255, 0], // Yellow
    // SKIPPED 3: [128, 255, 0], // Yellow-green
    3: [0, 255, 0], // Green
    // SKIPPED 5: [0, 255, 128], // Turqoise
    4: [0, 255, 255], // Cyan
    // SKIPPED 7: [0, 128, 255], // Almost blue
    5: [0, 0, 255], // Blue
    6: [128, 0, 255], // Purple
    7: [255, 0, 255], // Magenta
    8: [255, 0, 128], // Pink
    9: [255, 255, 255], // Pink
}

const delayColors = {
    0: [0, 255, 0],
    1: [255, 255, 0],
    2: [255, 0, 0],
    2: [0, 255, 255],
}

let ledState


console.log(`[CONFIG] Train filters:
[CONFIG] Allowed types: ${OPTIONS.allowedTrainTypes.length ? OPTIONS.allowedTrainTypes.toString() : "all"}`)

console.log("[STATUS] Loading JSON data")
Promise.all([
    getJSON("ledsInOrder"), getJSON("lines",), getJSON("sections"), getJSON("stations")
]).then((jsonData) => {
    [ledOrder, lines, sections, stations] = jsonData
    ledState = Object.values(ledOrder).flat().map(id => ({ id: id, trains: [] }))
    console.log("[STATUS] JSON data loaded")

    // INITIAL STATE REQUEST
    console.log("[STATUS] Requesting initial state")

    initialRequest()

    //setInterval(reloadMap, 1000)
    app.get('/', (req, res) => {
        res.send('Helsinki Live Train Map API')
    })
    const json = {
        version: "100",
        timestamp: 0,
        update: 5,
        colors:
            lineColors
        , updates: []
    }
    app.get('/hki-ltm/100.json', (req, res) => {
        json.timestamp = Date.now() - 20
        json.updates = generateUpdates(req.query.mode)
        json.colors = getColorTable(req.query.mode)
        res.json(json)
    })


    app.listen(port, () => {
        console.log(`Listening on port ${port}`)
    })


    // MQTT HANDLING
    client = mqtt.connect("wss://rata.digitraffic.fi/mqtt")

    //train-tracking/<departure_date,train_number,type,station,track_section,previous_station,next_station,previous_track_section,next_track_section>
    client.on("connect", () => {
        client.subscribe("trains/+/+/Commuter/HL/#", (err) => {
            if (err) console.log(`[ERROR] MQTT connection error: ${err}`)
            else console.log("[STATUS] MQTT connection successful")
        });
    });


    // PERIODICALLY REMOVE GHOST TRAINS
    setInterval(handleGhostTrains, 60000)

    // MQTT MESSAGE HANDLING
    let msgCount = 0
    let firstMessage = true

    client.on("message", (topic, message) => {
        msgCount++
        // message is Buffer
        parseMessage(topic, JSON.parse(message.toString()), OPTIONS)
        if (firstMessage & MEASURING_TIME) {
            console.log(`[TIMER] Starting timer for ${MEASURING_TIME} seconds`)
            setTimeout(() => {
                client.end();
                console.log(`[TIMER] Got ${msgCount} messages in ${MEASURING_TIME} seconds, averaging at ${msgCount / (MEASURING_TIME / 60)} msg/m`)
            }, 1000 * MEASURING_TIME)
            firstMessage = false
        }
    });
})

function handleGhostTrains() {
    const now = Date.now()
    ledState.forEach(led => {
        led.trains = led.trains.filter(t => ((now - t.t) / 1000 / 60) < 30)
    });
}


function initialRequest() {
    fetchData("https://rata.digitraffic.fi/api/v1/live-trains").then(data => {
        const trains = JSON.parse(data)
        //console.log(`[STATUS] Got ${trains.length} unfiltered trains`)
        trains.forEach(train => {
            parseMessage("", train, OPTIONS)
        });
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
        //console.log(lastUpdate.stationShortCode, "=>", nextUpdate.stationShortCode, tracks.length, intervalTime / 1000)
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


    //console.log(`[TRAIN] ${trainNumber} (${commuterLineID}) ${s.type == "between" || s.type == "multiBetween" ? `between ${s.station1} and ${s.station2}` : `at ${s.code}`}`)


    function updateLedState(track) {
        ledState.forEach(led => {
            led.trains = led.trains.filter(t => t.n != trainNumber)
            if (led.id == track.component) {
                led.trains.push({
                    n: trainNumber,
                    l: commuterLineID,
                    d: typeof lastUpdate.differenceInMinutes == "number" ? lastUpdate.differenceInMinutes : lastUpdate.unknownDelay,
                    t: Date.now()
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

function generateUpdates(mode) {
    return ledState.flatMap(led => {
        const block = (ledOrder["HPL-NOA"].some(id => id == led.id) ? ledOrder["HPL-NOA"].findIndex(id => id == led.id) + 300 : ledOrder["HKI-KTS"].findIndex(id => id == led.id) + 100)
        if (mode == "test") {
            const section = sections.filter(s => (s.tracks || s.segments.flat()).some(t => t.component == led.id))
            console.log(section, led.id)
            return { b: [block, block], c: section.map(getTrainColorFunction(mode)), t: 0 }
        }
        return led.trains.length ? { b: [block, block], c: led.trains.map(getTrainColorFunction(mode)), t: 0 } : []
    })
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
        default:
            return () => 0;
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