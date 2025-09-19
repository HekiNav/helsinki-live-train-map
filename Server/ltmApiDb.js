const sqlite = require("sqlite")
const sqlite3 = require("sqlite3")
const cron = require("node-cron")
// Open SQLite DB 
let db
module.exports.createDb = async function () {
  console.log("Starting DB: opening file")
  db = await sqlite.open({
    filename: "./comp_cache.db",
    driver: sqlite3.Database
  })
  db.on("error", console.error)
  // Create table if not exists
  console.log("Starting DB: initializing table")
  await db.exec(`
  CREATE TABLE IF NOT EXISTS compositions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    depDate TEXT,
    data TEXT,
    trainNumber INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
  console.log("Starting DB: setting up CRON jobs")

  // Schedule: fetch daily at 04:00
  cron.schedule("0 4 * * *", fetchAndCache)

  // Schedule: cleanup every 6 hours
  cron.schedule("0 */6 * * *", cleanup)

  // Run once at startup
  console.log("Starting DB: fetching data")
  await fetchAndCache()
  console.log("Starting DB: cleaning up")
  await cleanup()
  console.log("DB started")
  return db
}



// Function to fetch and store data
async function fetchAndCache() {
  const date = new Date(Date.now()).toISOString().substring(0, 10)
  const url = "https://rata.digitraffic.fi/api/v1/compositions/" + date;
  const res = await fetch(url);
  const json = await res.json();
  console.log("Starting DB: inserting data")
  await Promise.all(json.map(async (train) => {
    await db.run(
      `INSERT INTO compositions (depDate, data, trainNumber) VALUES (?, ?, ?)`,
      [train.departureDate, JSON.stringify(train), train.trainNumber]
    );
  }))
}

async function cleanup() {
  // Delete data older than 48 hrs
  await db.run(`
    DELETE FROM compositions
    WHERE created_at <= datetime('now', '-48 hours')
  `)
  // Remove duplicates
    db.run(`
  WITH cte AS (
    SELECT rowid AS rid,
           row_number() OVER (PARTITION BY depDate, trainNumber ORDER BY created_at) AS rn
    FROM compositions
)
DELETE FROM compositions
WHERE rowid IN (
    SELECT rid FROM cte WHERE rn > 1
);
  
  `)

}
