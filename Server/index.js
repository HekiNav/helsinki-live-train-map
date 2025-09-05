const express = require("express")
const mqtt = require("mqtt")
const fs = require("node:fs/promises")
const app = express()
const port = 3001

const MEASURING_TIME = null //Time limit for MQTT in seconds, starts from 1st message, logs amount of messages after

const OPTIONS = {
    allowedTrainTypes: ["HL"],
    modes: [
        "lines",
        "delay"
    ]
}


let ledOrder
let lines
let sections
let stations
let client
let colors

let ledState
let updates = {}

const print = console.log

print(`[CONFIG] Train filters:
[CONFIG] Allowed types: ${OPTIONS.allowedTrainTypes.length ? OPTIONS.allowedTrainTypes.toString() : "all"}`)

print("[STATUS] Loading JSON data")
Promise.all([
    getJSON("ledsInOrder"), getJSON("lines",), getJSON("sections"), getJSON("stations")
]).then((jsonData) => {
    [ledOrder, lines, sections, stations] = jsonData
    ledState = Object.values(ledOrder).flat().map(id => ({ id: id, trains: [] }))
    colors = Object.values(lines).reduce((prev,cur,i) => ({...prev, [i]: cur.color}), {})
    print("[STATUS] JSON data loaded")

    // INITIAL STATE REQUEST
    print("[STATUS] Requesting initial state")

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
            colors
        , updates: []
    }
    app.get('/hki-ltm/100.json', (req, res) => {
        const user = req.query.userId
        if (!user || Number(user) == NaN) return res.json({
            error: 400,
            message: "Please provide a positive integer userId url parameter"
        })
        json.timestamp = Date.now() - 20
        json.updates = generateUpdates(user)
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
            if (err) print(`[ERROR] MQTT connection error: ${err}`)
            else print("[STATUS] MQTT connection successful")
        });
    });

    // MQTT MESSAGE HANDLING
    let msgCount = 0
    let firstMessage = true

    client.on("message", (topic, message) => {
        msgCount++
        // message is Buffer
        parseMessage(topic, JSON.parse(message.toString()), OPTIONS)
        if (firstMessage & MEASURING_TIME) {
            print(`[TIMER] Starting timer for ${MEASURING_TIME} seconds`)
            setTimeout(() => {
                client.end();
                print(`[TIMER] Got ${msgCount} messages in ${MEASURING_TIME} seconds, averaging at ${msgCount / (MEASURING_TIME / 60)} msg/m`)
            }, 1000 * MEASURING_TIME)
            firstMessage = false
        }
    });
})




function initialRequest() {
    fetchData("https://rata.digitraffic.fi/api/v1/live-trains").then(data => {
        const trains = JSON.parse(data)
        print(`[STATUS] Got ${trains.length} unfiltered trains`)
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
        console.log(lastUpdate.stationShortCode, "=>", nextUpdate.stationShortCode, tracks.length, intervalTime / 1000)
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


    print(`[TRAIN] ${trainNumber} (${commuterLineID}) ${s.type == "between" || s.type == "multiBetween" ? `between ${s.station1} and ${s.station2}` : `at ${s.code}`}`)


    function updateLedState(track) {
        ledState.forEach(led => {
            led.trains = led.trains.filter(t => t.n != trainNumber)
            if (led.id == track.component) {
                led.trains.push({
                    n: trainNumber,
                    l: commuterLineID,
                    d: lastUpdate.differenceInMinutes || lastUpdate.unknownDelay
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

function generateUpdates(user) {
    console.log("USER:",user)
    updates[user] ? updates[user]++ : updates[user]=1
    return ledState.flatMap(led => {
        const block = (ledOrder["HPL-NOA"].some(id => id == led.id) ? ledOrder["HPL-NOA"].findIndex(id => id == led.id) + 100 : ledOrder["HKI-KTS"].findIndex(id => id == led.id) + 300) + 1
        let color = 0
        if (led.trains.length == 1) {
            color = getTrainColor(led.trains[0])
        } else if (led.trains.length > 1) {
            const i = updates[user] % led.trains.length
            color = getTrainColor(led.trains[i])
        } else {
            return []
        }
        return { b: [block, block], c: color, t: 0 }
    })
}
function getTrainColor(t) {
    return Object.values(colors).findIndex(c => c.toString() == lines[t.l].color.toString())
}

async function getJSON(name) {
    const json = (await fs.readFile(`./data/${name}.json`)).toString()
    return JSON.parse(json)
}

/* function loadSvg() {
    fetchData("./tools/output.svg").then(data => {
        svgContainer.innerHTML += data
        const svg = document.querySelector("svg")
        function resizeSVG() {
            svg.style.transform = `scale(${svgContainer.clientWidth / svg.clientWidth * 90}%)`
        }
        window.addEventListener("resize", resizeSVG)
        resizeSVG()
    })
}
function print(message) {
    log.innerHTML += message
    logContainer.scrollTop = logContainer.scrollHeight
} */