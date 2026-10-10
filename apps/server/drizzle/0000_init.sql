CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`host_id` text NOT NULL,
	`players` text NOT NULL,
	`state` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `word_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`words` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
