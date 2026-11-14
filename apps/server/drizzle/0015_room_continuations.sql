CREATE TABLE `room_continuations` (
	`room_id` text NOT NULL,
	`next_room_id` text NOT NULL,
	PRIMARY KEY(`room_id`, `next_room_id`)
);
