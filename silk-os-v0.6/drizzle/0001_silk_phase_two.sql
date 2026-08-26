ALTER TABLE `study_sessions` ADD `onenote_page_id` text;
--> statement-breakpoint
ALTER TABLE `study_sessions` ADD `onenote_sync_status` text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE `study_sessions` ADD `onenote_synced_at` integer;
--> statement-breakpoint
ALTER TABLE `study_sessions` ADD `onenote_sync_error` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `approval_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`action` text NOT NULL,
	`target` text DEFAULT '' NOT NULL,
	`summary` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`risk_level` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`resolved_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "approval_summary_length_check" CHECK(length("approval_requests"."summary") between 1 and 500),
	CONSTRAINT "approval_risk_check" CHECK("approval_requests"."risk_level" in ('low', 'medium', 'high')),
	CONSTRAINT "approval_status_check" CHECK("approval_requests"."status" in ('pending', 'approved', 'rejected', 'expired'))
);
--> statement-breakpoint
CREATE INDEX `idx_approval_requests_status` ON `approval_requests` (`status`,`created_at`,`id`);
--> statement-breakpoint
CREATE TABLE `weather_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`location_label` text NOT NULL,
	`payload_json` text NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
