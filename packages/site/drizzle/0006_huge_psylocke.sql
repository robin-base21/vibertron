CREATE TABLE `emails` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`to` text NOT NULL,
	`subject` text NOT NULL,
	`html` text NOT NULL,
	`text` text NOT NULL,
	`event_id` text,
	`signup_id` text,
	`status` text NOT NULL,
	`provider_id` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `emails_signup_idx` ON `emails` (`signup_id`);--> statement-breakpoint
CREATE INDEX `emails_created_idx` ON `emails` (`created_at`);--> statement-breakpoint
ALTER TABLE `events` ADD `announced_at` integer;--> statement-breakpoint
ALTER TABLE `signups` ADD `email_confirmed_at` integer;--> statement-breakpoint
-- Signups from before email confirmation existed count as confirmed.
UPDATE `signups` SET `email_confirmed_at` = `created_at` WHERE `email_confirmed_at` IS NULL;
