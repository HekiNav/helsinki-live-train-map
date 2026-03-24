import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
const cron = require("node-cron")
// Open SQLite DB 

const db = drizzle({
  client: new Database("./comp_cache.db")
})

export async function createDb() {
  console.log("Starting DB: setting up CRON jobs")

  // Schedule: fetch daily at 04:00 and 16:00
  cron.schedule("0 4,16 * * *", fetchAndCache)

  // Schedule: cleanup every 6 hours
  cron.schedule("0 */6 * * *", cleanup)

  // Run once at startup
  console.log("Starting DB: fetching data")
  // Commented because takes too long and isnt necessary every time
  //await fetchAndCache()
  console.log("Starting DB: cleaning up")
  await cleanup()
  console.log("DB started")
  return db
}
export async function createEndpointStat({ epLoc, statType, epPath }) {
  await db.insert(
    `INSERT OR IGNORE INTO stats (endpoint_location, stat_type, endpoint_path, amount_called) VALUES (?, ?, ?, 0)`
    , [epLoc, statType, epPath])
}
export async function incrementEndpointStat({ epLoc, epPath }) {
  await db.run(`
      UPDATE stats SET amount_called = amount_called +1 WHERE endpoint_location = ? AND endpoint_path = ? 
`, [epLoc, epPath])
}
export async function getEndpointStat({ epLoc, epPath }) {
  return await db.get(`
      SELECT * FROM stats WHERE endpoint_location = ? AND endpoint_path = ? 
`, [epLoc, epPath])
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
