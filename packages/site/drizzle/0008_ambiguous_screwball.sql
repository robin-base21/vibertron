ALTER TABLE `flyers` ADD `source_flyer_id` text;--> statement-breakpoint
ALTER TABLE `flyers` ADD `mode` text DEFAULT 'fresh' NOT NULL;