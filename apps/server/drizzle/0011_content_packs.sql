CREATE TABLE `content_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`data` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
