CREATE TABLE `action_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_action_log_date` ON `action_log` (`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `conversation_summaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`summary` text NOT NULL,
	`through_message_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "conversation_summaries_length_check" CHECK(length("conversation_summaries"."summary") between 1 and 8000)
);
--> statement-breakpoint
CREATE TABLE `daily_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date_key` text NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT 'task' NOT NULL,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_id` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`scheduled_at` integer,
	`duration_minutes` integer DEFAULT 30 NOT NULL,
	`priority` integer DEFAULT 3 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`completion_source` text,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "daily_items_title_length_check" CHECK(length("daily_items"."title") between 1 and 300),
	CONSTRAINT "daily_items_status_check" CHECK("daily_items"."status" in ('todo', 'doing', 'done', 'skipped')),
	CONSTRAINT "daily_items_duration_check" CHECK("daily_items"."duration_minutes" between 0 and 1440),
	CONSTRAINT "daily_items_priority_check" CHECK("daily_items"."priority" between 1 and 5),
	CONSTRAINT "daily_items_notes_length_check" CHECK(length("daily_items"."notes") <= 4000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_daily_items_source` ON `daily_items` (`date_key`,`source_type`,`source_id`) WHERE "daily_items"."source_id" is not null;--> statement-breakpoint
CREATE INDEX `idx_daily_items_date` ON `daily_items` (`date_key`,`status`,`scheduled_at`,`priority`);--> statement-breakpoint
CREATE TABLE `exercise_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workout_id` integer NOT NULL,
	`exercise_name` text NOT NULL,
	`set_number` integer NOT NULL,
	`weight` real,
	`reps` integer,
	`rpe` real,
	`is_warmup` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workout_id`) REFERENCES `workout_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "exercise_sets_set_number_check" CHECK("exercise_sets"."set_number" > 0),
	CONSTRAINT "exercise_sets_reps_check" CHECK("exercise_sets"."reps" is null or "exercise_sets"."reps" >= 0),
	CONSTRAINT "exercise_sets_rpe_check" CHECK("exercise_sets"."rpe" is null or ("exercise_sets"."rpe" >= 0 and "exercise_sets"."rpe" <= 10))
);
--> statement-breakpoint
CREATE INDEX `idx_exercise_sets_history` ON `exercise_sets` (`exercise_name`,`created_at`);--> statement-breakpoint
CREATE TABLE `integrations` (
	`provider` text PRIMARY KEY NOT NULL,
	`access_token_encrypted` text,
	`refresh_token_encrypted` text,
	`token_expires_at` integer,
	`scope` text,
	`account_email` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `knowledge_edges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_node_id` integer NOT NULL,
	`target_node_id` integer NOT NULL,
	`relation` text DEFAULT 'related' NOT NULL,
	`weight` real DEFAULT 0.5 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`source_node_id`) REFERENCES `knowledge_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_node_id`) REFERENCES `knowledge_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_edges_unique` ON `knowledge_edges` (`source_node_id`,`target_node_id`,`relation`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_edges_source` ON `knowledge_edges` (`source_node_id`,`weight`);--> statement-breakpoint
CREATE TABLE `knowledge_nodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`node_key` text NOT NULL,
	`label` text NOT NULL,
	`node_type` text DEFAULT 'memory' NOT NULL,
	`privacy` text DEFAULT 'personal' NOT NULL,
	`importance` integer DEFAULT 3 NOT NULL,
	`memory_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_nodes_node_key_unique` ON `knowledge_nodes` (`node_key`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_nodes_rank` ON `knowledge_nodes` (`importance`,`updated_at`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`identifier` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`window_start` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`content` text NOT NULL,
	`importance` integer DEFAULT 3 NOT NULL,
	`privacy` text DEFAULT 'personal' NOT NULL,
	`confidence` real DEFAULT 0.8 NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`last_accessed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "memories_content_length_check" CHECK(length("memories"."content") between 1 and 4000),
	CONSTRAINT "memories_importance_check" CHECK("memories"."importance" between 1 and 5),
	CONSTRAINT "memories_privacy_check" CHECK("memories"."privacy" in ('public', 'personal', 'sensitive', 'restricted')),
	CONSTRAINT "memories_confidence_check" CHECK("memories"."confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE INDEX `idx_memories_importance` ON `memories` (`importance`,`updated_at`);--> statement-breakpoint
CREATE TABLE `message_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_message_sources_message` ON `message_sources` (`message_id`,`position`,`id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "messages_role_check" CHECK("messages"."role" in ('user', 'assistant')),
	CONSTRAINT "messages_content_length_check" CHECK(length("messages"."content") between 1 and 20000)
);
--> statement-breakpoint
CREATE INDEX `idx_messages_created_at` ON `messages` (`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`code_verifier_encrypted` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_states_expiry` ON `oauth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `project_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`due_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_tasks_title_length_check" CHECK(length("project_tasks"."title") between 1 and 300),
	CONSTRAINT "project_tasks_notes_length_check" CHECK(length("project_tasks"."notes") <= 4000),
	CONSTRAINT "project_tasks_status_check" CHECK("project_tasks"."status" in ('todo', 'doing', 'done'))
);
--> statement-breakpoint
CREATE INDEX `idx_project_tasks_project` ON `project_tasks` (`project_id`,`status`,`sort_order`,`id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`priority` integer DEFAULT 3 NOT NULL,
	`due_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	CONSTRAINT "projects_name_length_check" CHECK(length("projects"."name") between 1 and 160),
	CONSTRAINT "projects_description_length_check" CHECK(length("projects"."description") <= 4000),
	CONSTRAINT "projects_status_check" CHECK("projects"."status" in ('active', 'paused', 'completed', 'archived')),
	CONSTRAINT "projects_priority_check" CHECK("projects"."priority" between 1 and 5)
);
--> statement-breakpoint
CREATE INDEX `idx_projects_status` ON `projects` (`status`,`priority`,`updated_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `study_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course` text DEFAULT 'Pre-Health' NOT NULL,
	`subject` text NOT NULL,
	`session_type` text DEFAULT 'Study session' NOT NULL,
	`studied_at` integer DEFAULT (unixepoch()) NOT NULL,
	`duration_minutes` integer,
	`overall_grade` real,
	`strengths` text,
	`weaknesses` text,
	`next_step` text,
	`source_text` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "study_duration_check" CHECK("study_sessions"."duration_minutes" is null or "study_sessions"."duration_minutes" >= 0),
	CONSTRAINT "study_grade_check" CHECK("study_sessions"."overall_grade" is null or ("study_sessions"."overall_grade" >= 0 and "study_sessions"."overall_grade" <= 100))
);
--> statement-breakpoint
CREATE INDEX `idx_study_sessions_date` ON `study_sessions` (`studied_at`,`id`);--> statement-breakpoint
CREATE TABLE `study_topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`topic` text NOT NULL,
	`score` real,
	`correct_notes` text,
	`improvement_notes` text,
	FOREIGN KEY (`session_id`) REFERENCES `study_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "study_topic_score_check" CHECK("study_topics"."score" is null or ("study_topics"."score" >= 0 and "study_topics"."score" <= 100))
);
--> statement-breakpoint
CREATE INDEX `idx_study_topics_session` ON `study_topics` (`session_id`,`id`);--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text DEFAULT 'cloudflare' NOT NULL,
	`model` text NOT NULL,
	`task` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`cached_input_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`neurons` real DEFAULT 0 NOT NULL,
	`estimated_cost_usd` real DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`request_id` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_usage_events_date` ON `usage_events` (`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `web_searches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`query` text NOT NULL,
	`result_count` integer DEFAULT 0 NOT NULL,
	`provider` text DEFAULT 'tavily' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_web_searches_date` ON `web_searches` (`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `workout_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`ended_at` integer,
	`notes` text
);
