CREATE TABLE `ballots` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`round` text NOT NULL,
	`voter_participant_id` text NOT NULL,
	`team_id` text,
	`ranking` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`voter_participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ballots_voter_idx` ON `ballots` (`event_id`,`round`,`voter_participant_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`tagline` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_participant_id_unique` ON `projects` (`participant_id`);--> statement-breakpoint
CREATE INDEX `projects_event_idx` ON `projects` (`event_id`);--> statement-breakpoint
CREATE TABLE `voting_results` (
	`event_id` text NOT NULL,
	`round` text NOT NULL,
	`json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`event_id`, `round`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `events` ADD `voting_phase` text DEFAULT 'none' NOT NULL;