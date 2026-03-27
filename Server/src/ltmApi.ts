import mqtt, { MqttClient } from "mqtt"
import fs from "node:fs/promises"
import express from "express"
import { AnyDocJson, generateDocs } from "./modules/docsCreator"
import apiDocsJson from "./ltmApi.json"
import { createDb, createEndpointStat, incrementEndpointStat, getEndpointStat } from "./ltmApiDb"
import { and, eq } from "drizzle-orm"
import { compositions } from "./db/schema"

const app = express()

const OPTIONS: {
    allowedTrainTypes: {
        [k in MapMode | "default"]?: DigitrafficTrainType[]
    } & {
        default: DigitrafficTrainType[]
    }
} = {
    allowedTrainTypes: {
        default: ["HL", "HV"],
        train: [], //all
        comp: []
    }
}

let ledOrder: { "HPL-NOA": string[], "HKI-KTS": string[] }
let sections: AnyTrackSection[]
let stations: Station[]
let client: MqttClient
let paxInfo: PaxInfoCategory[]

const db = createDb()

const testColors = {
    0: [255, 0, 0] as RGBArray,
    1: [255, 255, 0] as RGBArray,
    2: [0, 255, 0] as RGBArray,
    3: [0, 255, 255] as RGBArray,
    4: [0, 0, 255] as RGBArray,
}

const fullColors = {
    0: [255, 0, 0] as RGBArray,     // Red
    1: [255, 128, 0] as RGBArray,   // Orange
    2: [255, 255, 0] as RGBArray,   // Yellow
    // SKIPPED 3: [128, 255, 0], // Yellow-green
    3: [0, 255, 0] as RGBArray,     // Green
    // SKIPPED 5: [0, 255, 128], // Turqoise
    4: [0, 255, 255] as RGBArray,   // Cyan
    // SKIPPED 7: [0, 128, 255], // Almost blue
    5: [0, 0, 255] as RGBArray,     // Blue
    6: [128, 0, 255] as RGBArray,   // Purple
    7: [255, 0, 255] as RGBArray,   // Magenta
    8: [255, 0, 128] as RGBArray,   // Pink
    9: [255, 255, 255] as RGBArray, // White
}

const delayColors = {
    0: [0, 255, 0] as RGBArray,
    1: [255, 255, 0] as RGBArray,
    2: [255, 0, 0] as RGBArray,
    3: [0, 255, 255] as RGBArray,
    4: [255, 255, 255] as RGBArray,
}

let ledState: {
    id: string,
    trains: LEDTrain[]
}[]

let paxInfoState: PaxInfoStateItem[] = []

export type RGBArray = [number, number, number]

export interface MultiTrack extends SectionTrack {
    lines: string[],
    line?: string
}

export interface MultiBetweenSection {
    type: "multiBetween",
    station1: string,
    station2: string,
    segments: MultiTrack[][]
}

export interface SectionTrack {
    component: string
}

export interface StationSection {
    type: "station",
    code: string,
    equalTracksException?: boolean
    tracks: MultiTrack[]
}

export interface StopSection {
    type: "stop",
    code: string,
    equalTracksException?: boolean
    tracks: MultiTrack[]
}
export interface BetweenSection {
    type: "between",
    station1: string,
    station2: string,
    equalTracksException?: boolean
    tracks: MultiTrack[]
}

export interface Station {
    passengerTraffic: boolean,
    type: string,
    stationName: string,
    stationShortCode: string,
    stationUICCode: number,
    countryCode: string,
    longitude: number,
    latitude: number
}

export type AnyTrackSection = StationSection | MultiBetweenSection | StopSection | BetweenSection

export interface PaxInfoCategory {
    id: DisruptionType,
    keywords: string[]
}

interface PaxInfoTrainNotif {
    type: "train"
    category: DisruptionType
    train: number
}

interface PaxInfoStationNotif {
    type: "station"
    category: DisruptionType
    stations: string[]
}

export type PaxInfoStateItem = PaxInfoTrainNotif | PaxInfoStationNotif

export interface LEDTrain {
    n: number,
    l: string | null,
    d: number | true,
    t: number,
    dt: Date,
    ty: DigitrafficTrainType,
    p: string | null
}

export type DisruptionType = "infrastructure_disruption" | "track_work" | "missing_wagon" | "cancellation" | "replacement" | "private_train" | "other_disruption"
export type MapMode = "delay" | "test" | "lines" | "comp" | "train" | "disruption"
export interface MapUpdate {
    p: number[];
    b: number;
    v: number[];
    c: number[];
    t: number;
}

export interface EndpointDefinition {
    epLoc: string,
    statType: "user_fetches" | "server_fetches" | "server_mqtt_connections" | "server_mqtt_messages",
    epPath: string,
    method?: "get" | "post",
    on?: (req: express.Request, res: express.Response, next: express.NextFunction) => void
}

export interface DigitrafficPaxInfoMsg {
    id: string
    version: number
    creationDateTime: string
    startValidity: string
    endValidity: string
    stations: string[]
    trainNumber?: number
    trainDepartureDate?: string
    audio?: {
        text?: DigitrafficPaxInfoText
    }
    video?: {
        text?: DigitrafficPaxInfoText
    }

}
export interface DigitrafficPaxInfoText {
    fi?: string
    sv?: string
    en?: string
}


export type DigitrafficTrainType = "PAR" | "HL" | "VET" | "VEV" | "H" | "PVS" | "HV" | "P" | "HDM" | "PVV" | "VLI" | "S" | "HLV" | "T" | "V" | "W" | "IC2" | "IC" | "HSM" | "AE" | "PYO" | "MV" | "MUS" | "TYO" | "MUV" | "SAA" | "LIV" | "RJ" | "PAI"

export interface DigitrafficTrainData {
    trainNumber: 1
    departureDate: string
    operatorUICCode: 1
    operatorShortCode: string
    trainType: DigitrafficTrainType
    trainCategory: string
    commuterLineID?: string
    runningCurrently: true
    cancelled: true
    version: number
    timetableType: "REGULAR" | "ADHOC"
    timetableAcceptanceDate: string
    deleted?: true
    timeTableRows: DigitrafficTrainTimetableRow[]


}
export interface DigitrafficTrainTimetableRow {
    trainStopping: boolean
    stationShortCode: string
    stationUICCode: 1
    countryCode: string
    type: string
    commercialStop?: boolean
    commercialTrack?: string
    cancelled: true
    scheduledTime: string
    liveEstimateTime?: string
    estimateSource?: string
    unknownDelay?: boolean
    actualTime?: string
    differenceInMinutes?: number
    causes: DigitrafficDelayCauses
    stopSector?: string
    trainReady?: DigitrafficTrainReady
}
export interface DigitrafficTrainReady {
    source: string
    accepted: boolean
    timestamp: string
}
export interface DigitrafficDelayCauses {
    categoryCodeId: string
    categoryCode: string
    detailedCategoryCodeId?: string
    detailedCategoryCode?: string
    thirdCategoryCodeId?: string
    thirdCategoryCode?: string
}

export function ltmApi() {
    Promise.all([
        getJSON("ledsInOrder"), getJSON("sections"), getJSON("stations"), getJSON("paxInfo")
    ]).then((jsonData) => {
        [ledOrder, sections, stations, paxInfo] = jsonData
        ledState = Object.values(ledOrder).flat().map(id => ({ id: id, trains: [] }))

        // INITIAL STATE REQUEST

        initialRequest()
        const json: {
            colors: { [key: number]: RGBArray },
            version: string,
            timestamp: number,
            update: number,
            updates: MapUpdate[]
        } = {
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
                    res.send(generateDocs(apiDocsJson as AnyDocJson))
                }
            },
            {
                epLoc: "local",
                statType: "user_fetches",
                epPath: "/most_delayed",
                method: "get",
                on: (req, res) => {
                    res.send(ledState.flatMap(l => l.trains).reduce((p, c) => c.d > (p?.d || 0) ? c : p, null as LEDTrain | null))
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

                    json.colors = getColorTable(typeof req.query.mode == "string" ? req.query.mode as MapMode : "test")
                    generateUpdates(typeof req.query.mode == "string" ? req.query.mode as MapMode : "test").then(updates => {
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
                    const statString = (Array.isArray(req.query.stat) ? req.query.stat[0] : req.query.stat)
                    const stat = typeof statString?.split == "function" && statString?.split("..")
                    if (!req.query.stat || !req.query.stat.length || !statString || !stat) return res.status(400).json({ message: "Invalid parameter 'stat': missing" })
                    if (stat.length != 2) res.status(400).json({ message: "Invalid parameter 'stat': bad syntax" })

                    getEndpointStat({
                        epLoc: stat[0],
                        epPath: stat[1],
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
        const mqttConnectStatdata: EndpointDefinition =
        {
            epLoc: "digitraffic",
            statType: "server_mqtt_connections",
            epPath: mqttUrl
        }
        const mqttMessageStatdata: EndpointDefinition =
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

        setInterval(handlePaxInfo, 60_000)
        handlePaxInfo()

        // MQTT MESSAGE HANDLING
        client.on("message", (topic, message) => {
            incrementEndpointStat(mqttMessageStatdata)
            // message is Buffer
            parseMessage(topic, JSON.parse(message.toString()), OPTIONS)
        });
    })
    return app
}

async function handlePaxInfo() {
    const data = JSON.parse(await fetchData("https://rata.digitraffic.fi/api/v1/passenger-information/active")) as DigitrafficPaxInfoMsg[]

    const notifs = data.reduce((p, m) => {
        const texts: string[] = [m.audio?.text?.fi, m.video?.text?.fi].filter(t => t !== undefined)
        const types = paxInfo.reduce((p, c) => {
            const match = texts.find(t => c.keywords.some(k => t.toLowerCase().includes(k.toLowerCase())))
            return match ? [...p, { ...c, text: match }] : p
        }, new Array<PaxInfoCategory & { text: string }>)
        if (!types.length) {
            //console.log(texts, m.stations, m.trainNumber)
            return p
        }
        //console.log(types, m.stations, m.trainNumber)
        if (m.trainNumber && m.trainDepartureDate == new Date().toISOString().slice(0, 10)) {
            return [...p, {
                type: "train" as "train",
                train: m.trainNumber | 0,
                category: types[0].id
            }]
        } else if (!m.trainNumber) {
            return [...p, {
                type: "station" as "station",
                category: types[0].id,
                stations: m.stations
            }]
        } else {
            return p
        }
    }, new Array<PaxInfoStateItem>)
    paxInfoState = notifs
}

function createEndpoints(eps: EndpointDefinition[], app: express.Application) {
    eps.forEach(async ep => {
        if (ep.epLoc == "local" && ep.method && ep.on) app[ep.method](ep.epPath, (...params) => {
            incrementEndpointStat(ep)
            if (ep.on) ep.on(...params)
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
    const statdata: EndpointDefinition =
    {
        epLoc: "digitraffic",
        statType: "server_fetches",
        epPath: url
    }
    createEndpointStat(statdata)
    fetchData(url).then(data => {
        incrementEndpointStat(statdata)
        const trains = JSON.parse(data) as DigitrafficTrainData[]
        trains.forEach(train => {
            parseMessage("", train, OPTIONS)
        });
        console.log("Starting up LTM API: Fetched initial data")
    })
}
async function fetchData(url: string) {
    const response = await fetch(url)
    return await response.text()
}

function parseMessage(topic: string, message: DigitrafficTrainData, opt: typeof OPTIONS = { allowedTrainTypes: { default: [] } }) {
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
    const filteredTimeTable = timeTableRows.filter(row => stations?.find(s => s.stationShortCode == row.stationShortCode)?.passengerTraffic)

    const lastUpdate = getLastUpdate(filteredTimeTable)
    const nextUpdate = filteredTimeTable.find(row => !row.actualTime) || filteredTimeTable[0]


    if (!lastUpdate) return null
    let s: AnyTrackSection | undefined
    if (lastUpdate.type == "ARRIVAL") {
        s = sections.find(sec => (sec.type == "station" || sec.type == "stop") && sec.code == lastUpdate.stationShortCode)
        if (!s) {
            //console.error("Could not find last update point in data", timeTableRows, lastUpdate)
            return null
        }
    } else {
        s = sections.find(sec => (sec.type == "between" || sec.type == "multiBetween") && ((sec.station1 == lastUpdate.stationShortCode && sec.station2 == nextUpdate.stationShortCode) || (sec.station2 == lastUpdate.stationShortCode && sec.station1 == nextUpdate.stationShortCode)))
        if (!s) {
            //console.error("Could not find last update point in data", lastUpdate.stationShortCode, nextUpdate.stationShortCode)
            return null
        }
    }
    let track: SectionTrack | SectionTrack[] | null
    if (s.type == "multiBetween") {
        let tracks = findCorrectMultiTrack(s, commuterLineID || "-", timeTableRows)
        if (lastUpdate.stationShortCode == s.station2) tracks.reverse()
        // TODO: fix multiBetween handling
        const t1 = new Date(nextUpdate.liveEstimateTime || nextUpdate.scheduledTime)
        const t2 = new Date(lastUpdate.actualTime || lastUpdate.scheduledTime)
        const diff = (Number(t1) - Number(t2))
        const intervalTime = diff / (tracks.length)

        const interval = setInterval(updateMultiBetween, intervalTime)
        let i = 0
        updateMultiBetween()
        function updateMultiBetween() {
            const sec = sections.find(sec => (sec.type != "multiBetween" && sec.type != "between") && sec.code == nextUpdate.stationShortCode) as StopSection | StationSection | null
            const track: SectionTrack | null = sec ? tracks[i] || findCorrectTrack(sec, commuterLineID || "-", timeTableRows) : null
            const lastTrack = tracks[i - 1]
            //console.log("BEGIN", (s as MultiBetweenSection).station1, "=>", (s as MultiBetweenSection).station2, intervalTime)
            if (!track || i > tracks.length || (i != 0 && !(ledState.find(led => led.id == lastTrack?.component)?.trains.find(t => t.n == trainNumber)))) {
                //console.log("CLEAR", (s as MultiBetweenSection).station1, "=>", (s as MultiBetweenSection).station2, i)

                clearInterval(interval)
                return
            }
            if (track) updateLedState({
                ...track,
            })
            //console.log("UPDATE", (s as MultiBetweenSection).station1, "=>", (s as MultiBetweenSection).station2, i, track.component)

            i++
        }
        track = tracks[0]
    } else {
        const t = findCorrectTrack(s, commuterLineID || "-", timeTableRows)
        track = t
    }
    if (!track) {
        console.error("No track", s, trainNumber, trainType)
        return null
    }
    if (Array.isArray(track)) track = track[0]

    if (track && !Array.isArray(track)) updateLedState(track)





    function updateLedState(track: SectionTrack) {
        const previousLed = ledState.find(led => led.id != track.component && led.trains.find(t => t.n == trainNumber))
        ledState.forEach(led => {
            led.trains = led.trains.filter(t => t.n != trainNumber)
            if (led.id == track.component) {
                led.trains.push({
                    n: trainNumber,
                    l: commuterLineID || null,
                    d: typeof lastUpdate.differenceInMinutes == "number" ? lastUpdate.differenceInMinutes : lastUpdate.unknownDelay as number | true,
                    t: Date.now(),
                    dt: new Date(departureDate),
                    ty: trainType,
                    p: previousLed && previousLed.id != track.component ? previousLed.id : null
                })
            }
        })
    }
}
function getLastUpdate(timeTable: DigitrafficTrainTimetableRow[]) {
    const last = timeTable[timeTable.findIndex(row => !row.actualTime) - 1]
    if (!last && timeTable[0] && timeTable[0].trainReady) {

        let update = timeTable[0]
        update.type = "ARRIVAL"
        return update
    }
    return last
}
function findCorrectMultiTrack(segment: MultiBetweenSection, lineID: string, timeTable: DigitrafficTrainTimetableRow[]) {
    return segment.segments.map(s => {
        return findCorrectTrack({ tracks: s }, lineID, timeTable)
    })
}
function findCorrectTrack(segment: { tracks: MultiTrack[], equalTracksException?: boolean }, lineID: string, timeTable: DigitrafficTrainTimetableRow[]) {
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

async function generateUpdates(mode: MapMode) {
    const allowedTrainTypes = OPTIONS?.allowedTrainTypes[mode] || OPTIONS.allowedTrainTypes.default
    const updates = mode == "disruption" ? getDisruptionUpdates() : (await Promise.all(ledState.map(async led => {
        let colors: number[] = []
        const block = componentIdtoBlock(led.id) || 0
        const prevblocks = led.trains.flatMap(t => componentIdtoBlock(t.p || "") || [])
        if (mode == "test") {
            const section = sections.filter(s => (s.type == "multiBetween" ? s.segments.flat() : s.tracks).some(t => t.component == led.id))
            colors = await Promise.all(section.map(getBlockColorBySectionType))
        } else {
            colors = await Promise.all(led.trains.filter(t => !(allowedTrainTypes.length) || allowedTrainTypes.find(type => type == t.ty)).map(getTrainColorFunction(mode)))
        }
        return led.trains.length || mode == "test" ? { b: block, p: prevblocks, v: led.trains.map(t => t.n), c: colors, t: Date.now() } : []
    }))).flat().filter(u => u.b)
    // filter out prev blocks that overlap with current blocks
    return updates.map(u => ({ ...u, p: u.p.filter(b => !updates.some(e => e.b == b)) }))
}

function getDisruptionUpdates(): MapUpdate[] {
    const trains = ledState.filter(l => paxInfoState.some(i => i.type == "train" && l.trains.some(t => t.n == i.train)))
    // TODO: add station updates
    const stations = paxInfoState.reduce((p, i) =>
        i.type == "station" ? [...p, {
            ...i,
            leds: sections.filter(se =>
                (se.type == "stop" || se.type == "station") ?
                    i.stations.some(s =>
                        s == se.code
                    ) :
                    i.stations.some(s =>
                        s == se.station1
                    ) && i.stations.some(s =>
                        s == se.station2
                    )
            ).flatMap(se =>
                se.type == "multiBetween" ? se.segments.flat().map(t => t.component) :
                    se.tracks.map(t => t.component)
            )
        }
        ] : p, new Array<PaxInfoStationNotif & { leds: string[] }>)
    return [...trains.map(t => ({
        p: [],
        b: componentIdtoBlock(t.id) || 0,
        v: [],
        c: [0],
        t: Date.now()
    })), ...stations.flatMap(s => s.leds.map(id => ({
        p: [],
        v: [],
        b: componentIdtoBlock(id) || 0,
        c: [getColorFromDisruptionType(s.category)],
        t: Date.now()
    })))].reduce((prev, curr) => {
        const index = prev.findIndex(u => u.b == curr.b)
        if (index >= 0) {
            const prevItem = prev[index]
            prev.splice(index, 1, {
                ...curr,
                c: [...new Set([...prevItem.c, ...curr.c])],
            })
            return prev
        }
        return [...prev, curr]
    }, new Array<MapUpdate>())
}

function getColorFromDisruptionType(type: DisruptionType): number {
    switch (type) {
        case "cancellation":
            return 0
        case "infrastructure_disruption":
            return 1
        case "other_disruption":
            return 2
        case "track_work":
            return 3
        case "private_train":
            return 4
        case "replacement":
            return 5
        case "missing_wagon":
            return 6
        default:
            return 9
    }
}

function componentIdtoBlock(led: string) {
    return led ? (ledOrder["HPL-NOA"].some(id => id == led) ? ledOrder["HPL-NOA"].findIndex(id => id == led) + 300 : ledOrder["HKI-KTS"].findIndex(id => id == led) + 100) : null
}
function getColorTable(mode: MapMode) {
    switch (mode) {
        case "delay":
            return delayColors;
        case "test":
            return testColors;
        case "lines":
        case "comp":
        case "train":
        case "disruption":
            return fullColors;
        default:
            return { 0: [255, 0, 0] as RGBArray };
    }
}
function getTrainColorFunction(mode: MapMode): (t: LEDTrain) => (Promise<number> | number) {
    switch (mode) {
        case "lines":
            return getTrainColorByLine;
        case "delay":
            return getTrainColorByDelay;
        case "comp":
            return getTrainColorByComposition;
        case "train":
            return getTrainColorByType;
        default:
            return () => 0;
    }
}
async function getTrainColorByComposition(t: LEDTrain) {
    const response = await (await db).query.compositions.findFirst({
        where: and(
            eq(compositions.trainNumber, t.n),
            eq(compositions.depDate, new Date(t.dt)),
        )
    })

    const loco = response ? JSON.parse(response.data).journeySections[0].locomotives[0].locomotiveType : "N/A"
    switch (loco) {
        case "Sm2":
            return 0;
        case "Sm3":
            return 3;
        case "Sm4":
            return 2;
        case "Sm5":
            return 6;
        case "Sm6":
            return 7;
        case "Sm7":
            return 1;

        case "Sr2":
            return 4;
        case "Sr3":
            return 5;

        case "N/A":
            return 8;
        default:
            console.log(loco)
            return 9;
    }
}
function getTrainColorByLine(t: LEDTrain) {
    switch (t.l) {
        case "Z":
            return 0;
        case "A":
            return 1;
        case "E":
        case "O":
            return 2;
        case "P":
        case "G":
            return 3;
        case "M":
        case "I":
            return 4;
        case "K":
            return 5;
        case "Y":
        case "L":
        case "H":
            return 6;
        case "U":
            return 7;
        case "D":
        case "T":
        case "R":
            return 8;
        // Not in service
        case "V":
        default:
            return 9;
    }
}
function getTrainColorByType(t: LEDTrain) {
    switch (t.ty) {
        case "IC":
            return 0;
        case "VET":
            return 1;
        case "MUS":
        case "MUV":
            return 2;
        case "S":
            return 3;
        case "T":
            return 5;
        case "HL":
            return 6;
        case "HV":
            return 7;
        case "SAA":
        case "PAR":
        case "PAI":
        case "VEV":
        case "W":
            return 8;
        default:
            console.log(t)
            return 9;
    }
}
function getTrainColorByDelay(t: LEDTrain) {
    if (t.d === true/* WHAT IS THIS BRO */) {
        return 4
        // More than 1 min delay
    } else if (t.d < -1) {
        return 3
    } else if (t.d < 2) {
        return 0
    } else if (t.d > 10) {
        return 2
    } else {
        return 1
    }
}
function getBlockColorBySectionType(s: { type: "stop" | "station" | "multiBetween" | "between" }) {
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
async function getJSON(name: string) {
    const json = (await fs.readFile(`./src/data/${name}.json`)).toString()
    return JSON.parse(json)
}