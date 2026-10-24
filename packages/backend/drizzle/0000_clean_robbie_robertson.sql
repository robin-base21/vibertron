CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`email` text,
	`password_hash` text,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);