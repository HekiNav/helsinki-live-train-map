import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import cron from "node-cron"
import * as schema from "./db/schema"
import { DigitrafficTrainType, EndpointDefinition } from "./ltmApi"
import { and, eq, lte, sql } from "drizzle-orm"
// Open SQLite DB 

const db = drizzle<typeof schema>({
  client: new Database("./src/comp_cache.db"),
  schema
})

export async function createDb() {
  console.log("Starting DB: setting up CRON jobs")

  // Schedule: fetch every 12 hours
  cron.schedule("0 */12 * * *", fetchAndCache)

  // Schedule: cleanup every 6 hours
  cron.schedule("0 */6 * * *", cleanup)

  // Run once at startup
  console.log("Starting DB: fetching data")
  // Commented because takes too long and isnt necessary every time
  await fetchAndCache()
  console.log("Starting DB: cleaning up")
  await cleanup()
  console.log("DB started")
  return db
}
export async function createEndpointStat({ epLoc, statType, epPath }: EndpointDefinition) {
  await db.insert(schema.stats).values({
    amountCalled: 0,
    endpointLocation: epLoc,
    endpointPath: epPath,
    statType: statType
  }).onConflictDoNothing()/* (
    `INSERT OR IGNORE INTO stats (endpoint_location, stat_type, endpoint_path, amount_called) VALUES (?, ?, ?, 0)`
    , [epLoc, statType, epPath]) */
}
export async function incrementEndpointStat({ epLoc, epPath }: Omit<EndpointDefinition, "on" | "method" | "statType">) {
  await db.update(schema.stats).set({
    amountCalled: sql`${schema.stats.amountCalled} + 1`
  }).where(and(
    eq(schema.stats.endpointLocation, epLoc),
    eq(schema.stats.endpointPath, epPath),
  ))
}
export async function getEndpointStat({ epLoc, epPath }: Omit<EndpointDefinition, "on" | "method" | "statType">) {
  return await db.query.stats.findFirst({
    where: and(
      eq(schema.stats.endpointLocation, epLoc),
      eq(schema.stats.endpointPath, epPath),
    )
  })
}

export interface TimeTableRow {
  stationShortCode: string;
  stationcUICCode: number; // 1-9999
  countryCode: "FI" | "RU";
  type: "ARRIVAL" | "DEPARTURE";
  scheduledTime: string; // ISO 8601 datetime
}

export interface Locomotive {
  vehicleNumber?: string;
  location: number;
  locomotiveType: string; // SR1, SR2, etc.
  powerType: string; // Diesel, Sähkö, etc.
}

export interface Wagon {
  vehicleNumber?: string;
  location: number;
  salesNumber: number;
  length: number;
  playground?: true;
  pet?: true;
  catering?: true;
  video?: true;
  luggage?: true;
  smoking?: true;
  disabled?: true;
  wagonType?: string;
}

export interface JourneySection {
  beginTimeTableRow: TimeTableRow;
  endTimeTableRow: TimeTableRow;
  locomotives: Locomotive[];
  wagons: Wagon[];
  totalLength: number;
  maximumSpeed: number;
}

export interface Train {
  trainNumber: number;
  departureDate: string;
  operatorUICCode: number;
  operatorShortCode: string;
  trainCategory: string;
  trainType: DigitrafficTrainType;
  version: number;
  journeySections: JourneySection[];
}

// Function to fetch and store data
async function fetchAndCache() {
  const date = new Date(Date.now()).toISOString().substring(0, 10)
  const url = "https://rata.digitraffic.fi/api/v1/compositions/" + date;
  const res = await fetch(url);
  const json = await res.json() as Train[]
  console.log("Starting DB: inserting data")
  await Promise.all(json.map(async (train) => {
    await db.insert(schema.compositions).values({
      data: JSON.stringify(train),
      depDate: new Date(train.departureDate),
      trainNumber: train.trainNumber
    }).onConflictDoNothing()
  }))
}

async function cleanup() {
  // Delete data older than 48 hrs
  await db
    .delete(schema.compositions)
    .where(lte(schema.compositions.createdAt, new Date(Date.now() - 48 * 3600 * 1000)));
  // Duplicate prevention moved to creation with multi-column primaryKeys
  // Remove duplicates 
  /* db.run(`
  WITH cte AS (
    SELECT rowid AS rid,
           row_number() OVER (PARTITION BY depDate, trainNumber ORDER BY created_at) AS rn
    FROM compositions
)
DELETE FROM compositions
WHERE rowid IN (
    SELECT rid FROM cte WHERE rn > 1
);
  
  `) */

}

