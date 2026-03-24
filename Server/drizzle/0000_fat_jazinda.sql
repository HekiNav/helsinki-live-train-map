-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations

CREATE TABLE `compositions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`depDate` text,
	`data` text,
	`trainNumber` integer,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP)
);
--> statement-breakpoint
CREATE TABLE `stats` (
	`endpoint_location` text,
	`stat_type` text,
	`endpoint_path` text,
	`amount_called` integer
);
