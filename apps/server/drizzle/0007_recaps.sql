CREATE TABLE `room_recap_settings` (
	`room_id` text PRIMARY KEY NOT NULL,
	`tone` text DEFAULT 'cheeky' NOT NULL,
	`tz_offset_min` integer,
	`updated_at` integer NOT NULL
);
