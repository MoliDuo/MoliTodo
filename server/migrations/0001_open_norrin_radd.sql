CREATE TABLE `tasks` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`text` text NOT NULL,
	`done` integer NOT NULL,
	`done_at` integer,
	`archived` integer NOT NULL,
	`duration` integer NOT NULL,
	`position` text NOT NULL,
	`deleted` integer NOT NULL,
	`version` integer NOT NULL,
	`seq` integer NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE INDEX `tasks_owner_seq` ON `tasks` (`owner`,`seq`);