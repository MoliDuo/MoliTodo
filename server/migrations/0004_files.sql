CREATE TABLE `files` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` blob NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
