CREATE TABLE `recap_awards` (
	`room_id` text NOT NULL,
	`night_key` text NOT NULL,
	`award_id` text NOT NULL,
	`player_id` text NOT NULL,
	`game_id` text,
	`slot` text DEFAULT 'award' NOT NULL,
	`value` real,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `night_key`, `award_id`, `player_id`)
);
--> statement-breakpoint
CREATE INDEX `recap_awards_player` ON `recap_awards` (`player_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `recap_nights` (
	`room_id` text NOT NULL,
	`night_key` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`wrapped_at` integer,
	`games` integer NOT NULL,
	`tone` text NOT NULL,
	`card` text NOT NULL,
	PRIMARY KEY(`room_id`, `night_key`)
);
--> statement-breakpoint
CREATE INDEX `recap_nights_started` ON `recap_nights` (`started_at`);--> statement-breakpoint
CREATE TABLE `recap_records` (
	`room_id` text NOT NULL,
	`record_id` text NOT NULL,
	`player_id` text,
	`value` real NOT NULL,
	`at` integer NOT NULL,
	`night_key` text NOT NULL,
	`game_id` text NOT NULL,
	`emoji` text NOT NULL,
	`text` text NOT NULL,
	PRIMARY KEY(`room_id`, `record_id`)
);
