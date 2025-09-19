const express = require("express")
const cors = require("cors")
const { ltmApi } = require("./ltmApi")
const {generateDocs} = require("./modules/docsCreator")
const apiDocsJson = require("./hekinavApi.json")

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
