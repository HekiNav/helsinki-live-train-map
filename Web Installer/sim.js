const MEASURING_TIME = null //Time limit for MQTT in seconds, starts from 1st message, logs amount of messages after

const OPTIONS = {
    dev: false,
    apiVersion: "100",
    modes: [
        "lines",
        "delay",
        "comp",
        "train"
    ]
}

//const log = document.getElementById("log")
//const logContainer = document.querySelector(".logContainer")
const svgContainer = document.querySelector("#svgContainer")
const modeButton = document.querySelector("#changeMode")
const modeText = document.querySelector("#currentMode")

let ledOrder
let mapData = {
    colors: {},
    updates: []
}

let mode = OPTIONS.modes[0]
let updates = 0
const prodUrls = ["hekinav.github.io", "ltm.hekinav.dev", "hekinav.dev", "hki-ltm.pages.dev"]
const isProd = prodUrls.find(url => window.location.host.includes(url))

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
    const url = !isProd && OPTIONS.dev ? `http://127.0.0.1:3001/hki-ltm/${OPTIONS.apiVersion}.json?mode=${mode}` : `https://ltm-api.hekinav.dev/hki-ltm/${OPTIONS.apiVersion}.json?mode=${mode}`
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
    svg.querySelectorAll("rect.component").forEach(led => {
        led.setAttribute("fill", "black")
        led.setAttribute("style", `
                filter: drop-shadow(0px 0px .5px none);
                `)
    })
    mapData.updates.forEach(update => {
        const LED = svg.querySelector("rect#" + getLedIdFromIndex(update.b))
        const prevLEDs = update.p.reduce((prev, block) => block ? [...prev, svg.querySelector("rect#" + getLedIdFromIndex(block))] : prev, [])

        let prevColor = "none"
        let color = "none"
        if (update.c.length == 1) {
            color = `rgb(${colors[update.c[0]]})`

        } else if (update.c.length > 1) {
            const i = updates % update.c.length
            color = `rgb(${colors[update.c[i]]})`
            prevColor = `rgba(${colors[update.c[i]]}, 0.4)`

        }
        LED.setAttribute("fill", color)
        LED.setAttribute("style", `
                filter: drop-shadow(0px 0px .5px ${color});
                `)
        for (const i in prevLEDs) {

            const prevLED = prevLEDs[i]

            if (!prevLED || prevLED.id == LED.id) return
            prevLED.setAttribute("data-content", "a")

            const prevColor = `rgba(${colors[update.c[i]]}, 0.4)`
            prevLED.setAttribute("fill", prevColor)
            prevLED.setAttribute("style", `
                filter: drop-shadow(0px 0px .5px ${prevColor});
                `)
        }

    })
}
function getLedIdFromIndex(i) {
    if (i >= 100 && i < 100 + ledOrder["HKI-KTS"].length) {
        return ledOrder["HKI-KTS"][i - 100]
    } else if (i >= 300 && i < 300 + ledOrder["HPL-NOA"].length) {
        return ledOrder["HPL-NOA"][i - 300]
    } else {
        //console.error(`Index ${i} is out of range for both strands`)
    }
}

async function getJSON(name) {
    const json = await fetchData(`./data/${name}.json`)
    return JSON.parse(await json)
}

function loadSvg() {
    fetchData(isProd ? "./output.svg" : "./tools/output.svg").then(data => {
        const tempContainer = document.createElement("div")
        tempContainer.innerHTML = data
        console.log(tempContainer)
        tempContainer.querySelectorAll(".component").forEach(led => {
            led.addEventListener("mousemove", (e) => showTooltip(e, led.getAttribute("data-content"))),
                led.addEventListener("mouseleave", hideTooltip)
        })
        svgContainer.append(...tempContainer.children)
        const svg = document.querySelector("svg")
        function resizeSVG() {
            svg.style.transform = `scale(${svgContainer.clientWidth / svg.clientWidth * 90}%)`
        }
        window.addEventListener("resize", resizeSVG)
        resizeSVG()
    })
}
function showTooltip(evt, text) {
    if (!text) return hideTooltip()
    let tooltip = document.getElementById("tooltip");
    tooltip.innerHTML = text;
    tooltip.style.display = "block";
    tooltip.style.left = evt.pageX + 10 + 'px';
    tooltip.style.top = evt.pageY + 10 + 'px';
}

function hideTooltip() {
    var tooltip = document.getElementById("tooltip");
    tooltip.style.display = "none";
}