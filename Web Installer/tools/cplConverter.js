const csv = require('csv-parser')
const fs = require('fs')
const svg = require("svg-builder")
const gerberToSvg = require('gerber-to-svg')
const { text } = require('node:stream/consumers')


const results = [];

const cplPath = __dirname.replace("\\Simulator\\tools", "\\PCB\\jlcpcb\\Cpl\\Helsinki-LED-Train-Map-all-pos.csv")
const silkscreenPath = __dirname.replace("\\Simulator\\tools", "\\PCB\\jlcpcb\\Gerb\\Helsinki-LED-Train-Map-F_Silkscreen.gto")
if (!fs.existsSync(cplPath)) throw new Error(`Could not find CPL file at ${cplPath}. Is it generated?`)

fs.createReadStream(cplPath)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', () => {
        parseData(results)
    });

const gerberStream = fs.createReadStream(silkscreenPath)
const streamConverter = gerberToSvg(gerberStream)

text(streamConverter).then(text => {
    fs.writeFile("output2.svg", text, (err) => {
        if (err) throw err
    })
})


function parseData(cplFile) {
    data = cplFile.filter(component => component.Package == "LED-SMD_4P-L1.6-W1.5_XL-1615RGBC-WS2812B")
    const LED_SIZE = 1.6

    data.forEach(component => component.PosY *= -1)


    const maxX = Math.max(...data.map(row => Number(row.PosX)))
    const minX = Math.min(...data.map(row => Number(row.PosX)))
    const maxY = Math.max(...data.map(row => Number(row.PosY)))
    const minY = Math.min(...data.map(row => Number(row.PosY)))

    const width = Math.ceil(maxX - minX) + LED_SIZE
    const height = Math.ceil(maxY - minY) + LED_SIZE
    console.log(maxX, minX)
    svg.width(width).height(height)

    let ids = []

    data.forEach(LED => {
        svg.rect({
            x: LED_SIZE * -0.5,
            y: LED_SIZE * -0.5,
            width: LED_SIZE,
            height: LED_SIZE,
            fill: "none",
            stroke: "#555",
            "stroke-width": "0.01mm",
            transform: `translate(${LED.PosX - minX + LED_SIZE * 0.5},${LED.PosY - minY + LED_SIZE * 0.5})
            rotate(${LED.Rot * -1})`,
            id: LED.Ref
        })
        ids.push(LED.Ref)

    });
    svg.render()
    const svgData = svg.buffer()
    fs.writeFile("output.svg", svgData, (err) => {
        if (err) throw err
    })
}
