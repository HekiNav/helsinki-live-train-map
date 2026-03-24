import { sqliteTable, AnySQLiteColumn, integer, text, numeric } from "drizzle-orm/sqlite-core"
  import { sql } from "drizzle-orm"

export const compositions = sqliteTable("compositions", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	depDate: integer({mode: "timestamp_ms"}).notNull(),
	data: text().notNull(),
	trainNumber: integer().notNull(),
	createdAt: integer({mode: "timestamp_ms"}).default(sql`(unixepoch() * 1000)`),
});

export const stats = sqliteTable("stats", {
	endpointLocation: text().notNull(),
	statType: text().notNull(),
	endpointPath: text().notNull(),
	amountCalled: integer().notNull(),
});

