CREATE TABLE `linked_keys` (
	`key_hash` text NOT NULL,
	`room_id` text NOT NULL,
	`player_id` text NOT NULL,
	`active` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`key_hash`, `room_id`)
);
--> statement-breakpoint
CREATE INDEX `linked_keys_room_player` ON `linked_keys` (`room_id`,`player_id`);