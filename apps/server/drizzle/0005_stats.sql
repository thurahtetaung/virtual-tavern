CREATE TABLE `stats_daily` (
	`day` text NOT NULL,
	`game_id` text NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	PRIMARY KEY(`day`, `game_id`, `metric`)
);
--> statement-breakpoint
CREATE TABLE `stats_daily_players` (
	`day` text NOT NULL,
	`game_id` text NOT NULL,
	`player_id` text NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	PRIMARY KEY(`day`, `game_id`, `player_id`, `metric`)
);
--> statement-breakpoint
CREATE INDEX `stats_daily_players_player` ON `stats_daily_players` (`player_id`,`day`);--> statement-breakpoint
CREATE TABLE `stats_daily_settings` (
	`day` text NOT NULL,
	`game_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`day`, `game_id`, `key`, `value`)
);
--> statement-breakpoint
CREATE TABLE `stats_daily_words` (
	`day` text NOT NULL,
	`game_id` text NOT NULL,
	`kind` text NOT NULL,
	`word` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`day`, `game_id`, `kind`, `word`)
);
--> statement-breakpoint
CREATE INDEX `stats_daily_words_game_kind` ON `stats_daily_words` (`game_id`,`kind`,`day`);--> statement-breakpoint
CREATE TABLE `stats_events` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` integer NOT NULL,
	`day` text NOT NULL,
	`type` text NOT NULL,
	`game_id` text NOT NULL,
	`room_id` text NOT NULL,
	`player_id` text,
	`props` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stats_events_day_game` ON `stats_events` (`day`,`game_id`);--> statement-breakpoint
CREATE INDEX `stats_events_type_ts` ON `stats_events` (`type`,`ts`);--> statement-breakpoint
CREATE INDEX `stats_events_player_ts` ON `stats_events` (`player_id`,`ts`);--> statement-breakpoint
CREATE INDEX `stats_events_room_ts` ON `stats_events` (`room_id`,`ts`);--> statement-breakpoint
CREATE TABLE `stats_player_names` (
	`player_id` text NOT NULL,
	`name` text NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`player_id`, `name`)
);
--> statement-breakpoint
CREATE TABLE `stats_players` (
	`player_id` text PRIMARY KEY NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`last_name` text NOT NULL,
	`games_played` integer DEFAULT 0 NOT NULL,
	`rooms_joined` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stats_rollups` (
	`day` text PRIMARY KEY NOT NULL,
	`rolled_at` integer NOT NULL
);
