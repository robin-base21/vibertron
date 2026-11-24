CREATE TABLE `project_curation` (
	`event_id` text NOT NULL,
	`project_id` text NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`featured_at` integer,
	PRIMARY KEY(`event_id`, `project_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `events` ADD `featured` integer DEFAULT false NOT NULL;