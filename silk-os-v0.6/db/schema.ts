import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const unixepoch = sql`(unixepoch())`;

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at").notNull().default(unixepoch),
  },
  (table) => [
    check("messages_role_check", sql`${table.role} in ('user', 'assistant')`),
    check("messages_content_length_check", sql`length(${table.content}) between 1 and 20000`),
    index("idx_messages_created_at").on(table.createdAt, table.id),
  ],
);

export const memories = sqliteTable(
  "memories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    category: text("category").notNull().default("general"),
    content: text("content").notNull(),
    importance: integer("importance").notNull().default(3),
    privacy: text("privacy").notNull().default("personal"),
    confidence: real("confidence").notNull().default(0.8),
    source: text("source").notNull().default("manual"),
    locked: integer("locked", { mode: "boolean" }).notNull().default(false),
    lastAccessedAt: integer("last_accessed_at"),
    createdAt: integer("created_at").notNull().default(unixepoch),
    updatedAt: integer("updated_at").notNull().default(unixepoch),
  },
  (table) => [
    check("memories_content_length_check", sql`length(${table.content}) between 1 and 4000`),
    check("memories_importance_check", sql`${table.importance} between 1 and 5`),
    check("memories_privacy_check", sql`${table.privacy} in ('public', 'personal', 'sensitive', 'restricted')`),
    check("memories_confidence_check", sql`${table.confidence} between 0 and 1`),
    index("idx_memories_importance").on(table.importance, table.updatedAt),
  ],
);

export const loginAttempts = sqliteTable("login_attempts", {
  identifier: text("identifier").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStart: integer("window_start").notNull(),
});

export const workoutSessions = sqliteTable("workout_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name"),
  startedAt: integer("started_at").notNull().default(unixepoch),
  endedAt: integer("ended_at"),
  notes: text("notes"),
});

export const exerciseSets = sqliteTable(
  "exercise_sets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workoutId: integer("workout_id")
      .notNull()
      .references(() => workoutSessions.id, { onDelete: "cascade" }),
    exerciseName: text("exercise_name").notNull(),
    setNumber: integer("set_number").notNull(),
    weight: real("weight"),
    reps: integer("reps"),
    rpe: real("rpe"),
    isWarmup: integer("is_warmup", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull().default(unixepoch),
  },
  (table) => [
    check("exercise_sets_set_number_check", sql`${table.setNumber} > 0`),
    check("exercise_sets_reps_check", sql`${table.reps} is null or ${table.reps} >= 0`),
    check("exercise_sets_rpe_check", sql`${table.rpe} is null or (${table.rpe} >= 0 and ${table.rpe} <= 10)`),
    index("idx_exercise_sets_history").on(table.exerciseName, table.createdAt),
  ],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull().default(unixepoch),
});

export const studySessions = sqliteTable(
  "study_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    course: text("course").notNull().default("Pre-Health"),
    subject: text("subject").notNull(),
    sessionType: text("session_type").notNull().default("Study session"),
    studiedAt: integer("studied_at").notNull().default(unixepoch),
    durationMinutes: integer("duration_minutes"),
    overallGrade: real("overall_grade"),
    strengths: text("strengths"),
    weaknesses: text("weaknesses"),
    nextStep: text("next_step"),
    sourceText: text("source_text"),
    createdAt: integer("created_at").notNull().default(unixepoch),
    updatedAt: integer("updated_at").notNull().default(unixepoch),
  },
  (table) => [
    check("study_duration_check", sql`${table.durationMinutes} is null or ${table.durationMinutes} >= 0`),
    check("study_grade_check", sql`${table.overallGrade} is null or (${table.overallGrade} >= 0 and ${table.overallGrade} <= 100)`),
    index("idx_study_sessions_date").on(table.studiedAt, table.id),
  ],
);

export const studyTopics = sqliteTable(
  "study_topics",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => studySessions.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    score: real("score"),
    correctNotes: text("correct_notes"),
    improvementNotes: text("improvement_notes"),
  },
  (table) => [
    check("study_topic_score_check", sql`${table.score} is null or (${table.score} >= 0 and ${table.score} <= 100)`),
    index("idx_study_topics_session").on(table.sessionId, table.id),
  ],
);

export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull().default("cloudflare"),
    model: text("model").notNull(),
    task: text("task").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    neurons: real("neurons").notNull().default(0),
    estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    requestId: text("request_id").notNull().default(""),
    createdAt: integer("created_at").notNull().default(unixepoch),
  },
  (table) => [index("idx_usage_events_date").on(table.createdAt, table.id)],
);

export const projects = sqliteTable(
  "projects",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("active"),
    priority: integer("priority").notNull().default(3),
    dueAt: integer("due_at"),
    createdAt: integer("created_at").notNull().default(unixepoch),
    updatedAt: integer("updated_at").notNull().default(unixepoch),
    completedAt: integer("completed_at"),
  },
  (table) => [
    check("projects_name_length_check", sql`length(${table.name}) between 1 and 160`),
    check("projects_description_length_check", sql`length(${table.description}) <= 4000`),
    check("projects_status_check", sql`${table.status} in ('active', 'paused', 'completed', 'archived')`),
    check("projects_priority_check", sql`${table.priority} between 1 and 5`),
    index("idx_projects_status").on(table.status, table.priority, table.updatedAt),
  ],
);

export const projectTasks = sqliteTable(
  "project_tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    status: text("status").notNull().default("todo"),
    sortOrder: integer("sort_order").notNull().default(0),
    dueAt: integer("due_at"),
    createdAt: integer("created_at").notNull().default(unixepoch),
    updatedAt: integer("updated_at").notNull().default(unixepoch),
    completedAt: integer("completed_at"),
  },
  (table) => [
    check("project_tasks_title_length_check", sql`length(${table.title}) between 1 and 300`),
    check("project_tasks_notes_length_check", sql`length(${table.notes}) <= 4000`),
    check("project_tasks_status_check", sql`${table.status} in ('todo', 'doing', 'done')`),
    index("idx_project_tasks_project").on(table.projectId, table.status, table.sortOrder, table.id),
  ],
);

export const integrations = sqliteTable("integrations", {
  provider: text("provider").primaryKey(),
  accessTokenEncrypted: text("access_token_encrypted"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  tokenExpiresAt: integer("token_expires_at"),
  scope: text("scope"),
  accountEmail: text("account_email"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull().default(unixepoch),
  updatedAt: integer("updated_at").notNull().default(unixepoch),
});

export const oauthStates = sqliteTable(
  "oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    provider: text("provider").notNull(),
    codeVerifierEncrypted: text("code_verifier_encrypted").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull().default(unixepoch),
  },
  (table) => [index("idx_oauth_states_expiry").on(table.expiresAt)],
);

export const actionLog = sqliteTable(
  "action_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    action: text("action").notNull(),
    target: text("target"),
    detailJson: text("detail_json").notNull().default("{}"),
    status: text("status").notNull().default("completed"),
    createdAt: integer("created_at").notNull().default(unixepoch),
  },
  (table) => [index("idx_action_log_date").on(table.createdAt, table.id)],
);

export const messageSources = sqliteTable(
  "message_sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    messageId: integer("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    snippet: text("snippet").notNull().default(""),
    position: integer("position").notNull().default(0),
  },
  (table) => [index("idx_message_sources_message").on(table.messageId, table.position, table.id)],
);

export const webSearches = sqliteTable(
  "web_searches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    query: text("query").notNull(),
    resultCount: integer("result_count").notNull().default(0),
    provider: text("provider").notNull().default("tavily"),
    createdAt: integer("created_at").notNull().default(unixepoch),
  },
  (table) => [index("idx_web_searches_date").on(table.createdAt, table.id)],
);

export const dailyItems = sqliteTable(
  "daily_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dateKey: text("date_key").notNull(),
    title: text("title").notNull(),
    kind: text("kind").notNull().default("task"),
    sourceType: text("source_type").notNull().default("manual"),
    sourceId: text("source_id"),
    status: text("status").notNull().default("todo"),
    scheduledAt: integer("scheduled_at"),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    priority: integer("priority").notNull().default(3),
    notes: text("notes").notNull().default(""),
    completionSource: text("completion_source"),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at").notNull().default(unixepoch),
    updatedAt: integer("updated_at").notNull().default(unixepoch),
  },
  (table) => [
    check("daily_items_title_length_check", sql`length(${table.title}) between 1 and 300`),
    check("daily_items_status_check", sql`${table.status} in ('todo', 'doing', 'done', 'skipped')`),
    check("daily_items_duration_check", sql`${table.durationMinutes} between 0 and 1440`),
    check("daily_items_priority_check", sql`${table.priority} between 1 and 5`),
    check("daily_items_notes_length_check", sql`length(${table.notes}) <= 4000`),
    uniqueIndex("idx_daily_items_source")
      .on(table.dateKey, table.sourceType, table.sourceId)
      .where(sql`${table.sourceId} is not null`),
    index("idx_daily_items_date").on(table.dateKey, table.status, table.scheduledAt, table.priority),
  ],
);

export const knowledgeNodes = sqliteTable(
  "knowledge_nodes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    nodeKey: text("node_key").notNull().unique(),
    label: text("label").notNull(),
    nodeType: text("node_type").notNull().default("memory"),
    privacy: text("privacy").notNull().default("personal"),
    importance: integer("importance").notNull().default(3),
    memoryId: integer("memory_id").references(() => memories.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(unixepoch),
    updatedAt: integer("updated_at").notNull().default(unixepoch),
  },
  (table) => [index("idx_knowledge_nodes_rank").on(table.importance, table.updatedAt)],
);

export const knowledgeEdges = sqliteTable(
  "knowledge_edges",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceNodeId: integer("source_node_id")
      .notNull()
      .references(() => knowledgeNodes.id, { onDelete: "cascade" }),
    targetNodeId: integer("target_node_id")
      .notNull()
      .references(() => knowledgeNodes.id, { onDelete: "cascade" }),
    relation: text("relation").notNull().default("related"),
    weight: real("weight").notNull().default(0.5),
    createdAt: integer("created_at").notNull().default(unixepoch),
  },
  (table) => [
    uniqueIndex("knowledge_edges_unique").on(table.sourceNodeId, table.targetNodeId, table.relation),
    index("idx_knowledge_edges_source").on(table.sourceNodeId, table.weight),
  ],
);

export const conversationSummaries = sqliteTable("conversation_summaries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  summary: text("summary").notNull(),
  throughMessageId: integer("through_message_id").notNull(),
  createdAt: integer("created_at").notNull().default(unixepoch),
}, (table) => [
  check("conversation_summaries_length_check", sql`length(${table.summary}) between 1 and 8000`),
]);
