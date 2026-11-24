ALTER TABLE `events` ADD `form` text;--> statement-breakpoint
ALTER TABLE `events` ADD `deposit_amount` integer;--> statement-breakpoint
ALTER TABLE `events` ADD `deposit_instructions` text;--> statement-breakpoint
ALTER TABLE `events` ADD `deposit_note` text;--> statement-breakpoint
ALTER TABLE `events` ADD `proof_required` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `hold_hours` integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE `signups` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `signups` ADD `answers` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `signups` ADD `newsletter` integer;--> statement-breakpoint
ALTER TABLE `signups` ADD `step` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `signups` ADD `hold_until` integer;--> statement-breakpoint
ALTER TABLE `signups` ADD `proof_ref` text;--> statement-breakpoint
ALTER TABLE `signups` ADD `proof_at` integer;--> statement-breakpoint
ALTER TABLE `signups` ADD `completed_at` integer;--> statement-breakpoint
ALTER TABLE `signups` ADD `token` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `signups` SET `completed_at` = `created_at`, `step` = 4, `token` = lower(hex(randomblob(16))) WHERE `completed_at` IS NULL;
