ALTER TABLE `events` ADD `refund_days` integer;--> statement-breakpoint
ALTER TABLE `signups` ADD `refund_due` integer;--> statement-breakpoint
ALTER TABLE `signups` ADD `refunded_at` integer;