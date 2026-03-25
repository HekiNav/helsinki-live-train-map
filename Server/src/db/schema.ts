import { sqliteTable, AnySQLiteColumn, integer, text, numeric, primaryKey } from "drizzle-orm/sqlite-core"
  import { sql } from "drizzle-orm"

export const compositions = sqliteTable("compositions", {
	depDate: integer({ mode: "timestamp_ms" }).notNull(),
	data: text().notNull(),
	trainNumber: integer().notNull(),
	createdAt: integer({ mode: "timestamp_ms" }).default(sql`(unixepoch() * 1000)`),
}, (table) => ({
	pk: primaryKey({ columns: [table.depDate, table.trainNumber] }),
}));

export const stats = sqliteTable("stats", {
	endpointLocation: text().notNull(),
	statType: text().notNull(),
	endpointPath: text().notNull(),
	amountCalled: integer().notNull(),
});

