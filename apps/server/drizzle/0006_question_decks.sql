CREATE TABLE `question_decks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`questions` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`games` text DEFAULT '["hoodwink"]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
