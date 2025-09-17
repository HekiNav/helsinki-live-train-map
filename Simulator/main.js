const MEASURING_TIME = null //Time limit for MQTT in seconds, starts from 1st message, logs amount of messages after

const OPTIONS = {
    dev: true,
    apiVersion: "100",
    modes: [
        "lines",
        "delay"
    ]
}

//const log = document.getElementById("log")
//const logContainer = document.querySelector(".logContainer")
const svgContainer = document.querySelector("#svgContainer")
const modeButton = document.querySelector("#changeMode")
const modeText = document.querySelector("#currentMode")

let ledOrder

let mode = OPTIONS.modes[0]

/* print(`[CONFIG] Train filters:<br>
[CONFIG] Allowed types: ${OPTIONS.allowedTrainTypes.length ? OPTIONS.allowedTrainTypes.toString() : "all"}<br>`)

print("[STATUS] Loading JSON data<br>") */
/* Promise.all([
    getJSON("ledsInOrder"), getJSON("lines",), getJSON("sections"), getJSON("stations")
]).then((jsonData) => {
    [ledOrder, lines, sections, stations] = jsonData
    ledState = Object.values(ledOrder).flat().map(id => ({ id: id, trains: [] }))
    print("[STATUS] JSON data loaded<br>")

    // INITIAL STATE REQUEST
    print("[STATUS] Requesting initial state<br>")
    loadSvg()
    initialRequest()
 */
/* 
    // MQTT HANDLING
    client = mqtt.connect("wss://rata.digitraffic.fi/mqtt")

    //train-tracking/<departure_date,train_number,type,station,track_section,previous_station,next_station,previous_track_section,next_track_section>
    client.on("connect", () => {
        client.subscribe("trains/+/+/Commuter/HL/#", (err) => {
            if (err) print(`[ERROR] MQTT connection error: ${err}<br>`)
            else print("[STATUS] MQTT connection successful<br>")
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
            print(`[TIMER] Starting timer for ${MEASURING_TIME} seconds<br>`)
            setTimeout(() => {
                client.end();
                print(`[TIMER] Got ${msgCount} messages in ${MEASURING_TIME} seconds, averaging at ${msgCount / (MEASURING_TIME / 60)} msg/m<br>`)
            }, 1000 * MEASURING_TIME)
            firstMessage = false
        }
    });
})
 */

fetch("./data/ledsInOrder.json").then(data => {
    data.json().then(json => {
        ledOrder = json
        setInterval(reloadMap, 10_000)
        modeButton.addEventListener("click", switchMode)
    })

})

function switchMode() {
    const currentModeIndex = OPTIONS.modes.findIndex(m => m == mode)
    mode = OPTIONS.modes[(currentModeIndex + 1) % OPTIONS.modes.length]
    modeText.innerHTML = mode
    reloadMap()
}


/* 
function initialRequest() {
    fetchData("https://rata.digitraffic.fi/api/v1/live-trains").then(data => {
        const trains = JSON.parse(data)
        print(`[STATUS] Got ${trains.length} unfiltered trains<br>`)
        trains.forEach(train => {
            parseMessage("", train, OPTIONS)
        });
    })
} */
/* async function graphQL(body) {
    const response = await fetch("https://rata.digitraffic.fi/api/v2/graphql/graphql", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept-Encoding": "gzip"
        },
        body: body
    })
} */
/* 
async function fetchData(url) {
    const response = await fetch(url)
    return await response.text()
} */
/* function parseMessage(topic, message, opt = { allowedTrainTypes: [] }) {
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
                console.log(i >= tracks.length,!(ledState.find(led => led.id == lastTrack.component).trains.find(t => t.n == trainNumber)), ledState.find(led => led.id == lastTrack.component).trains.map(t => t).find(t => t.n == trainNumber))
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


    print(`[TRAIN] ${trainNumber} (${commuterLineID}) ${s.type == "between" || s.type == "multiBetween" ? `between ${s.station1} and ${s.station2}` : `at ${s.code}`}<br>`)


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
 */
async function reloadMap() {
    const url = OPTIONS.dev ? `http://127.0.0.1:3001/hki-ltm/${OPTIONS.apiVersion}.json` : `https://hekinav-api.loophole.site/hki-ltm/${OPTIONS.apiVersion}.json`
    const response = await fetch(url)
    if (response.status == 200) {
        drawMap()
    } else {
        alert(`API at ${url} is not responding`)
    }
    /* updates++
    ledState.forEach(led => {
        const svg = document.querySelector("svg")

        const LED = svg.querySelector("rect#" + led.id)
        if (led.trains.length == 1) {
            LED.setAttribute("fill", getTrainColor(led.trains[0]))
            LED.setAttribute("data-train", led.trains[0].n)
        } else if (led.trains.length > 1) {
            const i = updates % led.trains.length
            LED.setAttribute("fill", getTrainColor(led.trains[i]))
            LED.setAttribute("data-train", led.trains[i].n)
        } else {
            LED.setAttribute("fill", "none")
            LED.removeAttribute("data-train")
        }

    }) */
}
function drawMap() {
    console.log(ledOrder)
    
}
/* 
function getTrainColor(t) {
    switch (mode) {
        case "lines":
            return lines[t.l].color
        default:
            return "#f0f"
    }
}

async function getJSON(name) {
    const json = await fetchData(`./data/${name}.json`)
    return JSON.parse(await json)
}

function loadSvg() {
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