CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`level_id` text NOT NULL,
	`seed` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`status` text NOT NULL,
	`hints_used` integer DEFAULT 0 NOT NULL,
	`hint_tiers_json` text DEFAULT '[]' NOT NULL,
	`commands_count` integer DEFAULT 0 NOT NULL,
	`used_manual` integer DEFAULT 0 NOT NULL,
	`xp_awarded` integer DEFAULT 0 NOT NULL,
	`rank` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attempts_user_id_idx` ON `attempts` (`user_id`);--> statement-breakpoint
CREATE INDEX `attempts_level_id_idx` ON `attempts` (`level_id`);--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_tokens_user_id_idx` ON `auth_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `badges` (
	`user_id` text NOT NULL,
	`badge_id` text NOT NULL,
	`earned_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `badge_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `badges_user_id_idx` ON `badges` (`user_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`level_id` text,
	`attempt_id` text,
	`type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_user_id_idx` ON `events` (`user_id`);--> statement-breakpoint
CREATE INDEX `events_level_id_idx` ON `events` (`level_id`);--> statement-breakpoint
CREATE INDEX `events_attempt_id_idx` ON `events` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `level_progress` (
	`user_id` text NOT NULL,
	`level_id` text NOT NULL,
	`best_rank` text,
	`best_xp` integer DEFAULT 0 NOT NULL,
	`completions` integer DEFAULT 0 NOT NULL,
	`first_completed_at` integer,
	PRIMARY KEY(`user_id`, `level_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `skill_progress` (
	`user_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`levels_used_json` text DEFAULT '[]' NOT NULL,
	`mastered_at` integer,
	`last_used_at` integer,
	PRIMARY KEY(`user_id`, `skill_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `skill_progress_user_id_idx` ON `skill_progress` (`user_id`);--> statement-breakpoint
CREATE TABLE `spellbook_notes` (
	`user_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`note` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `skill_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `spellbook_notes_user_id_idx` ON `spellbook_notes` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`display_name` text,
	`xp` integer DEFAULT 0 NOT NULL,
	`streak_days` integer DEFAULT 0 NOT NULL,
	`last_active_day` text
);
