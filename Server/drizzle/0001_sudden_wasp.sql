PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_compositions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`depDate` integer NOT NULL,
	`data` text NOT NULL,
	`trainNumber` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
INSERT INTO `__new_compositions`("id", "depDate", "data", "trainNumber", "createdAt") SELECT "id", "depDate", "data", "trainNumber", "createdAt" FROM `compositions`;--> statement-breakpoint
DROP TABLE `compositions`;--> statement-breakpoint
ALTER TABLE `__new_compositions` RENAME TO `compositions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_stats` (
	`endpointLocation` text NOT NULL,
	`statType` text NOT NULL,
	`endpointPath` text NOT NULL,
	`amountCalled` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_stats`("endpointLocation", "statType", "endpointPath", "amountCalled") SELECT "endpointLocation", "statType", "endpointPath", "amountCalled" FROM `stats`;--> statement-breakpoint
DROP TABLE `stats`;--> statement-breakpoint
ALTER TABLE `__new_stats` RENAME TO `stats`;