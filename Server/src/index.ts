import express from "express"
import cors from "cors"
import { ltmApi } from "./ltmApi"
import { generateDocs } from "./modules/docsCreator.ts"
import apiDocsJson from "./hekinavApi.json"

const app = express()
const port = 3001
app.use(cors())
app.use("/hki-ltm", ltmApi())
app.listen(port, () => {
    console.log(`Starting up main app: Listening on port ${port}`)
})
app.get('/', (req, res) => {
    res.send(generateDocs(apiDocsJson))
})

app.get(/\/sim(.*)/, (req, res) => {
    console.log(req.url)
    res.sendFile(decodeURI( req.url.replace("/sim","/home/untoa/helsinki-live-train-map/Web Installer"))) 
})