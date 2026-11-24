CREATE TABLE `manual_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`tagline` text,
	`author` text NOT NULL,
	`team_name` text,
	`link` text,
	`deck_ref` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `manual_projects_event_idx` ON `manual_projects` (`event_id`);--> statement-breakpoint
ALTER TABLE `project_curation` ADD `name` text;--> statement-breakpoint
ALTER TABLE `project_curation` ADD `tagline` text;--> statement-breakpoint
ALTER TABLE `project_curation` ADD `author` text;--> statement-breakpoint
ALTER TABLE `project_curation` ADD `link` text;