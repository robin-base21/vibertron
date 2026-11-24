CREATE TABLE `flyers` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`image_ref` text NOT NULL,
	`reference_ref` text,
	`prompt` text,
	`aspect` text NOT NULL,
	`model` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `flyers_event_idx` ON `flyers` (`event_id`);--> statement-breakpoint
CREATE TABLE `link_previews` (
	`url` text PRIMARY KEY NOT NULL,
	`image_ref` text,
	`status` text NOT NULL,
	`error` text,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `events` ADD `flyer_id` text;