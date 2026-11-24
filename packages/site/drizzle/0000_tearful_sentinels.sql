CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`tagline` text,
	`description` text,
	`starts_at` integer,
	`ends_at` integer,
	`venue` text,
	`capacity` integer,
	`price_note` text,
	`signup_open` integer DEFAULT true NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	`vibertron_event_id` text,
	`vibertron_slug` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_slug_unique` ON `events` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_vibertron_event_id_unique` ON `events` (`vibertron_event_id`);--> statement-breakpoint
CREATE TABLE `results` (
	`event_id` text PRIMARY KEY NOT NULL,
	`vibertron_event_id` text NOT NULL,
	`payload` text NOT NULL,
	`published_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `results_vibertron_event_id_unique` ON `results` (`vibertron_event_id`);--> statement-breakpoint
CREATE TABLE `signups` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`waitlist` integer DEFAULT false NOT NULL,
	`marketing_consent` integer DEFAULT false NOT NULL,
	`paid` integer DEFAULT false NOT NULL,
	`paid_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `signups_event_email_idx` ON `signups` (`event_id`,`email`);--> statement-breakpoint
CREATE INDEX `signups_event_idx` ON `signups` (`event_id`);--> statement-breakpoint
CREATE TABLE `subscribers` (
	`email` text PRIMARY KEY NOT NULL,
	`consent_at` integer NOT NULL,
	`source` text NOT NULL
);
