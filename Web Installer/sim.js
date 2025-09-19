const MEASURING_TIME = null //Time limit for MQTT in seconds, starts from 1st message, logs amount of messages after

const OPTIONS = {
    dev: true,
    apiVersion: "100",
    modes: [
        "lines",
        "delay",
        "comp"
    ]
}

//const log = document.getElementById("log")
//const logContainer = document.querySelector(".logContainer")
const svgContainer = document.querySelector("#svgContainer")
const modeButton = document.querySelector("#changeMode")
const modeText = document.querySelector("#currentMode")

let ledOrder
let mapData = {
    colors:{},
    updates: []
}

let mode = OPTIONS.modes[0]
let updates = 0

Promise.all([fetch("./data/ledsInOrder.json"), loadSvg()]).then(([data, _]) => {
    data.json().then(json => {
        ledOrder = json
        reloadMap()
        setInterval(reloadMap, 10_000)
        setInterval(drawMap, 1_000)
        modeButton.addEventListener("click", switchMode)
        modeButton.addEventListener("dblclick", testMode)
    })

})

function switchMode() {
    const currentModeIndex = mode == "test" ? 0 : OPTIONS.modes.findIndex(m => m == mode)
    mode = OPTIONS.modes[(currentModeIndex + 1) % OPTIONS.modes.length]
    modeText.innerHTML = mode
    reloadMap()
}
function testMode() {
    mode = "test"
    modeText.innerHTML = "test"
    reloadMap()
}



async function fetchData(url) {
    const response = await fetch(url)
    return await response.text()
}

async function reloadMap() {
    const url = OPTIONS.dev ? `http://127.0.0.1:3001/hki-ltm/${OPTIONS.apiVersion}.json?mode=${mode}` : `https://hekinav-api.loophole.site/hki-ltm/${OPTIONS.apiVersion}.json?mode=${mode}`
    const response = await fetch(url)
    if (response.status == 200) {
        response.json().then(data => {
            mapData = data
        })
    } else {
        alert(`API at ${url} is not responding`)
    }
}
function drawMap() {
    const svg = document.querySelector("svg")
    const colors = mapData.colors
    updates++
    svg.querySelectorAll("rect").forEach(led => led.setAttribute("fill", "none"))

    mapData.updates.forEach(update => {
        const LED = svg.querySelector("rect#" + getLedIdFromIndex(update.b[1]))
        if (update.c.length == 1) {
            LED.setAttribute("fill", `rgb(${colors[update.c[0]]})`)
        } else if (update.c.length > 1) {
            const i = updates % update.c.length
            LED.setAttribute("fill", `rgb(${colors[update.c[i]]})`)
        } else {
            LED.setAttribute("fill", "none")
        }

    })
}
function getLedIdFromIndex(i) {
    if (i >= 100 && i < 100 + ledOrder["HKI-KTS"].length) {
        return ledOrder["HKI-KTS"][i - 100]
    } else if (i >= 300 && i < 300 + ledOrder["HPL-NOA"].length) {
        return ledOrder["HPL-NOA"][i - 300]
    } else {
        console.error(`Index ${i} is out of range for both strands`)
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