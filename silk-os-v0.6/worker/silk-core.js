const CLOUDFLARE_MODELS = Object.freeze({
  efficient: {
    provider: "cloudflare",
    tier: "routine",
    id: "@cf/qwen/qwen3-30b-a3b-fp8",
    label: "Qwen 3 · Cloudflare fallback",
    inputPrice: 0.051,
    cachedInputPrice: 0.051,
    outputPrice: 0.34,
    inputNeurons: 4625,
    outputNeurons: 30475,
  },
  reasoning: {
    provider: "cloudflare",
    tier: "complex",
    id: "@cf/openai/gpt-oss-120b",
    label: "GPT-OSS 120B · Cloudflare fallback",
    inputPrice: 0.35,
    cachedInputPrice: 0.35,
    outputPrice: 0.75,
    inputNeurons: 31818,
    outputNeurons: 68182,
  },
  vision: {
    provider: "cloudflare",
    tier: "vision",
    id: "@cf/google/gemma-4-26b-a4b-it",
    label: "Gemma 4 · Vision",
    inputPrice: 0.1,
    cachedInputPrice: 0.1,
    outputPrice: 0.3,
    inputNeurons: 9091,
    outputNeurons: 27273,
  },
});

// Official list prices verified against the OpenAI model pages on 2026-08-05.
// Keep these values centralized so a future pricing change requires one edit.
const OPENAI_MODEL_PRICING = Object.freeze({
  "gpt-5-nano": { label: "GPT-5 Nano", inputPrice: 0.05, cachedInputPrice: 0.005, outputPrice: 0.4 },
  "gpt-5.6-luna": {
    label: "GPT-5.6 Luna",
    inputPrice: 0.2,
    cachedInputPrice: 0.02,
    outputPrice: 1.2,
  },
  "gpt-5.6-terra": {
    label: "GPT-5.6 Terra",
    inputPrice: 2,
    cachedInputPrice: 0.2,
    outputPrice: 12,
  },
});

const OPENAI_DEFAULT_ROUTER_MODEL = "gpt-5-nano";
const OPENAI_DEFAULT_ROUTINE_MODEL = "gpt-5.6-luna";
const OPENAI_DEFAULT_COMPLEX_MODEL = "gpt-5.6-terra";
const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const OPENAI_REQUEST_TIMEOUT_MS = 35_000;
const OPENAI_MAX_ATTEMPTS = 2;
const OPENAI_CIRCUIT_FAILURE_LIMIT = 3;
const OPENAI_CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000;
const OPENAI_CACHE_WRITE_MULTIPLIER = 1.25;
const providerCircuitState = new Map();

const SESSION_COOKIE = "__Host-silk_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_STUDY_SOURCE_LENGTH = 30000;
const MAX_REQUEST_BODY = 60000;
const HISTORY_LIMIT = 12;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_ATTEMPT_LIMIT = 8;
const CAD_PER_USD = 1.41;
const DEFAULT_TIME_ZONE = "America/Toronto";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");
const MICROSOFT_SCOPES = ["openid", "email", "offline_access", "User.Read", "Notes.ReadWrite"].join(" ");
const MICROSOFT_AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const MICROSOFT_GRAPH_URL = "https://graph.microsoft.com/v1.0";

const DEFAULT_SETTINGS = Object.freeze({
  owner_name: "Jaed",
  assistant_name: "Silk",
  model_mode: "automatic",
  response_length: "concise",
  monthly_budget_cad: "2",
  facts_first: "true",
  home_city: "Toronto, Ontario",
  time_zone: DEFAULT_TIME_ZONE,
  temperature_unit: "celsius",
  morning_brief_enabled: "true",
});

const CALENDAR_DRAFT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    summary: { type: "string" },
    start: { type: "string" },
    end: { type: "string" },
    location: { type: "string" },
    description: { type: "string" },
    question: { type: "string" },
  },
  required: ["summary", "start", "end", "location", "description", "question"],
  additionalProperties: false,
});

const STUDY_DRAFT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    course: { type: "string" },
    subject: { type: "string" },
    session_type: {
      type: "string",
      enum: ["Study session", "Quiz", "Exam", "Comeback exam", "Review", "Lesson"],
    },
    studied_at: { type: "string" },
    duration_minutes: { type: ["integer", "null"] },
    overall_grade: { type: ["number", "null"] },
    strengths: { type: "string" },
    weaknesses: { type: "string" },
    next_step: { type: "string" },
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string" },
          score: { type: ["number", "null"] },
          correct_notes: { type: "string" },
          improvement_notes: { type: "string" },
        },
        required: ["topic", "score", "correct_notes", "improvement_notes"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "course",
    "subject",
    "session_type",
    "studied_at",
    "duration_minutes",
    "overall_grade",
    "strengths",
    "weaknesses",
    "next_step",
    "topics",
  ],
  additionalProperties: false,
});

const MEMORY_EXTRACTION_SCHEMA = Object.freeze({
  type: "object",
  properties: { memories: { type: "array", maxItems: 5, items: {
    type: "object",
    properties: {
      category: { type: "string" }, content: { type: "string" },
      importance: { type: "integer", minimum: 1, maximum: 5 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      privacy: { type: "string", enum: ["public", "personal", "sensitive", "restricted"] },
      entities: { type: "array", maxItems: 8, items: { type: "object", properties: {
        name: { type: "string" }, type: { type: "string" }, relation: { type: "string" },
      }, required: ["name", "type", "relation"], additionalProperties: false } },
    },
    required: ["category", "content", "importance", "confidence", "privacy", "entities"],
    additionalProperties: false,
  } } },
  required: ["memories"],
  additionalProperties: false,
});

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 20000),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  "CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC, id DESC)",
  `CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL DEFAULT 'general',
    content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
    importance INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  "CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC, updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS login_attempts (
    identifier TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS workout_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    started_at INTEGER NOT NULL DEFAULT (unixepoch()),
    ended_at INTEGER,
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS exercise_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id INTEGER NOT NULL,
    exercise_name TEXT NOT NULL,
    set_number INTEGER NOT NULL CHECK (set_number > 0),
    weight REAL,
    reps INTEGER CHECK (reps >= 0),
    rpe REAL CHECK (rpe IS NULL OR (rpe >= 0 AND rpe <= 10)),
    is_warmup INTEGER NOT NULL DEFAULT 0 CHECK (is_warmup IN (0, 1)),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (workout_id) REFERENCES workout_sessions(id) ON DELETE CASCADE
  )`,
  "CREATE INDEX IF NOT EXISTS idx_exercise_sets_history ON exercise_sets(exercise_name, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE TABLE IF NOT EXISTS study_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course TEXT NOT NULL DEFAULT 'Pre-Health',
    subject TEXT NOT NULL,
    session_type TEXT NOT NULL DEFAULT 'Study session',
    studied_at INTEGER NOT NULL DEFAULT (unixepoch()),
    duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
    overall_grade REAL CHECK (overall_grade IS NULL OR (overall_grade >= 0 AND overall_grade <= 100)),
    strengths TEXT,
    weaknesses TEXT,
    next_step TEXT,
    source_text TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  "CREATE INDEX IF NOT EXISTS idx_study_sessions_date ON study_sessions(studied_at DESC, id DESC)",
  `CREATE TABLE IF NOT EXISTS study_topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    topic TEXT NOT NULL,
    score REAL CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
    correct_notes TEXT,
    improvement_notes TEXT,
    FOREIGN KEY (session_id) REFERENCES study_sessions(id) ON DELETE CASCADE
  )`,
  "CREATE INDEX IF NOT EXISTS idx_study_topics_session ON study_topics(session_id, id)",
  `CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL DEFAULT 'cloudflare',
    model TEXT NOT NULL,
    task TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    cached_input_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    neurons REAL NOT NULL DEFAULT 0,
    estimated_cost_usd REAL NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    request_id TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  "CREATE INDEX IF NOT EXISTS idx_usage_events_date ON usage_events(created_at DESC, id DESC)",
  `CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'paused', 'completed', 'archived')),
    priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
    due_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    completed_at INTEGER
  )`,
  "CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status, priority DESC, updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS project_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
    notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    due_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    completed_at INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`,
  "CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(project_id, status, sort_order, id)",
  `CREATE TABLE IF NOT EXISTS integrations (
    provider TEXT PRIMARY KEY,
    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,
    token_expires_at INTEGER,
    scope TEXT,
    account_email TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    code_verifier_encrypted TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  "CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_states(expires_at)",
  `CREATE TABLE IF NOT EXISTS action_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    detail_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'completed',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  "CREATE INDEX IF NOT EXISTS idx_action_log_date ON action_log(created_at DESC, id DESC)",
  `CREATE TABLE IF NOT EXISTS message_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    snippet TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
  )`,
  "CREATE INDEX IF NOT EXISTS idx_message_sources_message ON message_sources(message_id, position, id)",
  `CREATE TABLE IF NOT EXISTS web_searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    result_count INTEGER NOT NULL DEFAULT 0,
    provider TEXT NOT NULL DEFAULT 'tavily',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  "CREATE INDEX IF NOT EXISTS idx_web_searches_date ON web_searches(created_at DESC, id DESC)",
  `CREATE TABLE IF NOT EXISTS daily_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date_key TEXT NOT NULL,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300), kind TEXT NOT NULL DEFAULT 'task',
    source_type TEXT NOT NULL DEFAULT 'manual', source_id TEXT,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done', 'skipped')),
    scheduled_at INTEGER, duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 0 AND 1440),
    priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
    notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 4000), completion_source TEXT, completed_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_items_source ON daily_items(date_key, source_type, source_id) WHERE source_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_daily_items_date ON daily_items(date_key, status, scheduled_at, priority DESC)",
  `CREATE TABLE IF NOT EXISTS knowledge_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, node_key TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
    node_type TEXT NOT NULL DEFAULT 'memory', privacy TEXT NOT NULL DEFAULT 'personal',
    importance INTEGER NOT NULL DEFAULT 3, memory_id INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
  )`,
  "CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_rank ON knowledge_nodes(importance DESC, updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS knowledge_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_node_id INTEGER NOT NULL, target_node_id INTEGER NOT NULL,
    relation TEXT NOT NULL DEFAULT 'related', weight REAL NOT NULL DEFAULT 0.5,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (source_node_id) REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target_node_id) REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    UNIQUE(source_node_id, target_node_id, relation)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_knowledge_edges_source ON knowledge_edges(source_node_id, weight DESC)",
  `CREATE TABLE IF NOT EXISTS conversation_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 8000),
    through_message_id INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE TABLE IF NOT EXISTS approval_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 500),
    payload_json TEXT NOT NULL DEFAULT '{}',
    risk_level TEXT NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low', 'medium', 'high')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    expires_at INTEGER NOT NULL,
    resolved_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  "CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status, created_at DESC, id DESC)",
  `CREATE TABLE IF NOT EXISTS weather_cache (
    cache_key TEXT PRIMARY KEY,
    location_label TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
];

const schemaReadyByDatabase = new WeakMap();

const silkCore = {
  async fetch(request, env, ctx) {
    try {
      return withCommonHeaders(await routeRequest(request, env, ctx));
    } catch (error) {
      if (error instanceof HttpError) {
        return withCommonHeaders(json({ error: error.message }, error.status));
      }
      console.error("Unhandled Silk Worker error", error);
      return withCommonHeaders(json({ error: "Silk hit an unexpected error. Please try again." }, 500));
    }
  },
};

export default silkCore;

async function routeRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/") {
    return new Response(APP_HTML, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": contentSecurityPolicy(),
      },
    });
  }

  if (request.method === "GET" && path === "/assets/app.js") {
    return new Response(APP_JS, {
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  if (request.method === "GET" && path === "/assets/styles.css") {
    return new Response(APP_CSS, {
      headers: {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  if (request.method === "GET" && path === "/manifest.webmanifest") {
    return json({
      name: "Silk Personal Assistant",
      short_name: "Silk",
      description: "A private, cloud-first personal assistant.",
      start_url: "/",
      display: "standalone",
      background_color: "#06111d",
      theme_color: "#081523",
    }, 200, { "Cache-Control": "public, max-age=3600" }, "application/manifest+json; charset=utf-8");
  }

  if (request.method === "GET" && path === "/api/session") {
    return json({
      configured: Boolean(env.APP_PASSWORD),
      authenticated: await isAuthorized(request, env),
      version: "Silk OS v0.7",
    });
  }

  if (!path.startsWith("/api/")) return new Response("Not found.", { status: 404 });
  if (!env.DB) throw new HttpError(503, "Silk's D1 database binding is missing.");
  await ensureSchema(env.DB);
  if (isMutationMethod(request.method)) requireSameOrigin(request);

  if (request.method === "POST" && path === "/api/login") return login(request, env);
  if (request.method === "POST" && path === "/api/logout") {
    return json({ ok: true }, 200, { "Set-Cookie": expiredSessionCookie() });
  }

  // The one-time OAuth state protects this cross-site callback. It must be
  // handled before the normal session check because Google initiates the GET.
  if (request.method === "GET" && path === "/api/google/callback") {
    return googleOAuthCallback(request, env);
  }
  if (request.method === "GET" && path === "/api/microsoft/callback") {
    return microsoftOAuthCallback(request, env);
  }

  await requireAuthorization(request, env);

  if (request.method === "GET" && path === "/api/bootstrap") return getBootstrap(env);
  if (request.method === "GET" && path === "/api/history") {
    return json({ messages: await getHistory(env.DB, 80) });
  }
  if (request.method === "POST" && path === "/api/chat") return chat(request, env, ctx);
  if (request.method === "POST" && path === "/api/chat/stream") return streamChat(request, env, ctx);
  if (request.method === "GET" && path === "/api/today") return json({ today: await getTodayDashboard(env, url.searchParams.get("date")) });
  if (request.method === "POST" && path === "/api/today") return createDailyItemRequest(request, env.DB);
  const todayItemMatch = path.match(/^\/api\/today\/(\d+)$/);
  if (todayItemMatch && request.method === "PATCH") return updateDailyItemRequest(request, env.DB, Number(todayItemMatch[1]));
  if (todayItemMatch && request.method === "DELETE") return deleteDailyItemRequest(env.DB, Number(todayItemMatch[1]));

  if (request.method === "GET" && path === "/api/projects") {
    return json({ projects: await getProjects(env.DB) });
  }
  if (request.method === "POST" && path === "/api/projects") {
    return createProjectRequest(request, env.DB);
  }
  const projectMatch = path.match(/^\/api\/projects\/(\d+)$/);
  if (projectMatch && request.method === "PATCH") {
    return updateProjectRequest(request, env.DB, Number(projectMatch[1]));
  }
  if (projectMatch && request.method === "DELETE") {
    return deleteProjectRequest(env.DB, Number(projectMatch[1]));
  }
  const projectTaskCreateMatch = path.match(/^\/api\/projects\/(\d+)\/tasks$/);
  if (projectTaskCreateMatch && request.method === "POST") {
    return createProjectTaskRequest(request, env.DB, Number(projectTaskCreateMatch[1]));
  }
  const projectTaskMatch = path.match(/^\/api\/project-tasks\/(\d+)$/);
  if (projectTaskMatch && request.method === "PATCH") {
    return updateProjectTaskRequest(request, env.DB, Number(projectTaskMatch[1]));
  }
  if (projectTaskMatch && request.method === "DELETE") {
    return deleteProjectTaskRequest(env.DB, Number(projectTaskMatch[1]));
  }

  if (request.method === "GET" && path === "/api/google/status") {
    return json({ google: await getGoogleStatus(env) });
  }
  if (request.method === "GET" && path === "/api/google/connect") {
    return beginGoogleOAuth(request, env);
  }
  if (request.method === "POST" && path === "/api/google/disconnect") {
    return disconnectGoogle(env);
  }
  if (request.method === "GET" && path === "/api/microsoft/status") {
    return json({ microsoft: await getMicrosoftStatus(env) });
  }
  if (request.method === "GET" && path === "/api/microsoft/connect") {
    return beginMicrosoftOAuth(request, env);
  }
  if (request.method === "POST" && path === "/api/microsoft/disconnect") {
    return disconnectMicrosoft(env);
  }
  if (request.method === "GET" && path === "/api/microsoft/sections") {
    return json({ sections: await listOneNoteSections(env) });
  }
  if (request.method === "PATCH" && path === "/api/microsoft/settings") {
    return updateMicrosoftSettings(request, env);
  }
  if (request.method === "GET" && path === "/api/calendar/events") {
    return listCalendarEventsRequest(request, env);
  }
  if (request.method === "POST" && path === "/api/calendar/events") {
    return createCalendarEventRequest(request, env);
  }
  const calendarEventMatch = path.match(/^\/api\/calendar\/events\/([^/]+)$/);
  if (calendarEventMatch && request.method === "PATCH") {
    return updateCalendarEventRequest(request, env, decodeURIComponent(calendarEventMatch[1]));
  }
  if (calendarEventMatch && request.method === "DELETE") {
    return deleteCalendarEventRequest(request, env, decodeURIComponent(calendarEventMatch[1]));
  }

  if (request.method === "GET" && path === "/api/web/status") {
    return json({ web: await getWebSearchStatus(env) });
  }
  if (request.method === "POST" && path === "/api/search") {
    return webSearchRequest(request, env);
  }

  if (request.method === "GET" && path === "/api/memories") {
    return json({ memories: await getMemories(env.DB) });
  }
  if (request.method === "GET" && path === "/api/memory/graph") {
    return json(await getMemoryGraph(env.DB, url.searchParams.get("query"), url.searchParams.get("limit")));
  }
  if (request.method === "POST" && path === "/api/memories") return createMemory(request, env.DB);
  const memoryMatch = path.match(/^\/api\/memories\/(\d+)$/);
  if (memoryMatch && request.method === "PATCH") {
    return updateMemory(request, env.DB, Number(memoryMatch[1]));
  }
  if (memoryMatch && request.method === "DELETE") {
    return deleteMemoryRequest(env.DB, Number(memoryMatch[1]));
  }

  if (request.method === "GET" && path === "/api/study") return json(await getStudyOverview(env.DB));
  if (request.method === "POST" && path === "/api/study/parse") return parseStudyRequest(request, env);
  if (request.method === "POST" && path === "/api/study") return createStudySession(request, env);
  const studySyncMatch = path.match(/^\/api\/study\/(\d+)\/sync-onenote$/);
  if (studySyncMatch && request.method === "POST") {
    return syncStudySessionToOneNoteRequest(env, Number(studySyncMatch[1]));
  }
  const studyMatch = path.match(/^\/api\/study\/(\d+)$/);
  if (studyMatch && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM study_sessions WHERE id = ?").bind(Number(studyMatch[1])).run();
    return json({ ok: true });
  }

  if (request.method === "GET" && path === "/api/workouts") {
    return json(await getWorkoutOverview(env.DB));
  }
  if (request.method === "POST" && path === "/api/workouts/start") {
    return startWorkoutRequest(request, env.DB);
  }
  if (request.method === "POST" && path === "/api/workouts/set") {
    return logWorkoutSetRequest(request, env.DB);
  }
  if (request.method === "POST" && path === "/api/workouts/finish") {
    return finishWorkoutRequest(request, env.DB);
  }

  if (request.method === "GET" && path === "/api/settings") {
    return json({ settings: await getSettings(env.DB) });
  }
  if (request.method === "PATCH" && path === "/api/settings") return updateSettings(request, env.DB);
  if (request.method === "GET" && path === "/api/usage") {
    return json({ usage: await getUsageSummary(env.DB, env) });
  }
  if (request.method === "GET" && path === "/api/ai/status") {
    return json({ ai: await getAIStatus(env) });
  }
  if (request.method === "GET" && path === "/api/weather") {
    return json({ weather: await getWeatherSummary(env) });
  }
  if (request.method === "GET" && path === "/api/morning-brief") {
    return json({ brief: await getMorningBrief(env) });
  }
  if (request.method === "GET" && path === "/api/activity") {
    return json({ activity: await getActivity(env.DB, url.searchParams.get("limit")) });
  }
  if (request.method === "GET" && path === "/api/integrations/status") {
    return json({ integrations: await getIntegrationStatuses(env) });
  }
  if (request.method === "GET" && path === "/api/approvals") {
    return json({ approvals: await getApprovals(env.DB) });
  }
  if (request.method === "POST" && path === "/api/approvals") {
    return createApprovalRequest(request, env.DB);
  }
  const approvalMatch = path.match(/^\/api\/approvals\/(\d+)$/);
  if (approvalMatch && request.method === "PATCH") {
    return resolveApprovalRequest(request, env, Number(approvalMatch[1]));
  }

  return json({ error: "Not found." }, 404);
}

async function ensureSchema(db) {
  if (schemaReadyByDatabase.has(db)) return schemaReadyByDatabase.get(db);
  const initialization = (async () => {
    await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));
    await ensureUsageEventColumns(db);
    await ensureV06Columns(db);
    await ensureV07Columns(db);
  })();
  schemaReadyByDatabase.set(db, initialization);
  try {
    await initialization;
  } catch (error) {
    schemaReadyByDatabase.delete(db);
    throw error;
  }
}

async function ensureV06Columns(db) {
  const rows = await db.prepare("PRAGMA table_info(memories)").all();
  const existing = new Set((rows.results || []).map((row) => String(row.name)));
  const migrations = [
    ["privacy", "ALTER TABLE memories ADD COLUMN privacy TEXT NOT NULL DEFAULT 'personal'"],
    ["confidence", "ALTER TABLE memories ADD COLUMN confidence REAL NOT NULL DEFAULT 0.8"],
    ["source", "ALTER TABLE memories ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'"],
    ["locked", "ALTER TABLE memories ADD COLUMN locked INTEGER NOT NULL DEFAULT 0"],
    ["last_accessed_at", "ALTER TABLE memories ADD COLUMN last_accessed_at INTEGER"],
  ];
  for (const [column, sql] of migrations) {
    if (existing.has(column)) continue;
    try { await db.prepare(sql).run(); }
    catch (error) { if (!/duplicate column|already exists/i.test(String(error?.message || error))) throw error; }
  }
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_memories_privacy_rank ON memories(privacy, importance DESC, updated_at DESC)").run();
}

async function ensureV07Columns(db) {
  const rows = await db.prepare("PRAGMA table_info(study_sessions)").all();
  const existing = new Set((rows.results || []).map((row) => String(row.name)));
  const migrations = [
    ["onenote_page_id", "ALTER TABLE study_sessions ADD COLUMN onenote_page_id TEXT"],
    ["onenote_sync_status", "ALTER TABLE study_sessions ADD COLUMN onenote_sync_status TEXT NOT NULL DEFAULT 'pending'"],
    ["onenote_synced_at", "ALTER TABLE study_sessions ADD COLUMN onenote_synced_at INTEGER"],
    ["onenote_sync_error", "ALTER TABLE study_sessions ADD COLUMN onenote_sync_error TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [column, sql] of migrations) {
    if (existing.has(column)) continue;
    try { await db.prepare(sql).run(); }
    catch (error) { if (!/duplicate column|already exists/i.test(String(error?.message || error))) throw error; }
  }
}

async function ensureUsageEventColumns(db) {
  const rows = await db.prepare("PRAGMA table_info(usage_events)").all();
  const existing = new Set((rows.results || []).map((row) => String(row.name)));
  const migrations = [
    ["provider", "ALTER TABLE usage_events ADD COLUMN provider TEXT NOT NULL DEFAULT 'cloudflare'"],
    ["cached_input_tokens", "ALTER TABLE usage_events ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0"],
    ["cache_write_tokens", "ALTER TABLE usage_events ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0"],
    ["latency_ms", "ALTER TABLE usage_events ADD COLUMN latency_ms INTEGER NOT NULL DEFAULT 0"],
    ["request_id", "ALTER TABLE usage_events ADD COLUMN request_id TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [column, sql] of migrations) {
    if (existing.has(column)) continue;
    try {
      await db.prepare(sql).run();
    } catch (error) {
      // Another Worker isolate may have completed the same idempotent migration.
      if (!/duplicate column|already exists/i.test(String(error?.message || error))) throw error;
    }
  }
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_usage_events_provider_date ON usage_events(provider, created_at DESC, id DESC)",
  ).run();
}

async function getBootstrap(env) {
  const db = env.DB;
  const [history, memories, study, workouts, projects, settings, usage, google, microsoft, web, ai, today, activity, approvals] = await Promise.all([
    getHistory(db, 80),
    getMemories(db),
    getStudyOverview(db),
    getWorkoutOverview(db),
    getProjects(db),
    getSettings(db),
    getUsageSummary(db, env),
    getGoogleStatus(env),
    getMicrosoftStatus(env),
    getWebSearchStatus(env),
    getAIStatus(env),
    getTodayDashboard(env),
    getActivity(db, 18),
    getApprovals(db),
  ]);
  let weather = { configured: false, status: "unavailable", location: settings.home_city || "" };
  try { weather = await getWeatherSummary(env, settings); }
  catch (error) { weather.error = safeText(error?.message, 240); }
  return json({ history, memories, study, workouts, projects, settings, usage, google, microsoft, web, ai, today, activity, approvals, weather });
}

async function login(request, env) {
  if (!env.APP_PASSWORD) {
    throw new HttpError(503, "The owner passphrase has not been configured yet.");
  }
  const identifier = await loginIdentifier(request, env.APP_PASSWORD);
  if (await isLoginBlocked(env.DB, identifier)) {
    throw new HttpError(429, "Too many login attempts. Try again in 15 minutes.");
  }
  const body = await readJson(request);
  const password = typeof body.password === "string" ? body.password : "";
  if (!(await securePasswordMatch(password, env.APP_PASSWORD))) {
    await recordFailedLogin(env.DB, identifier);
    throw new HttpError(401, "That passphrase is incorrect.");
  }
  await clearLoginAttempts(env.DB, identifier);
  const token = await createSessionToken(env.APP_PASSWORD);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token) });
}

async function streamChat(request, env, ctx) {
  const preview = await request.clone().json().catch(() => ({}));
  const message = String(preview?.message || "");
  const encoder = new TextEncoder();
  const responseStream = new ReadableStream({ async start(controller) {
    const emit = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    try {
      emit("activity", { state: "retrieving", label: "Retrieving relevant memories" });
      if (preview?.web_search === true || shouldSearchWeb(message)) emit("activity", { state: "searching", label: "Searching the web" });
      if (/\b(calendar|schedule|today|tomorrow|morning|meeting|appointment)\b/i.test(message)) emit("activity", { state: "calendar", label: "Checking Calendar" });
      emit("activity", { state: "routing", label: "Selecting the right model" });
      emit("activity", { state: "thinking", label: "Preparing a response" });
      const response = await chat(request, env, ctx);
      const data = await response.json();
      if (!response.ok) throw new HttpError(response.status, data?.error || "Silk could not answer.");
      emit("message", data); emit("activity", { state: "idle", label: "Ready" }); emit("done", { ok: true });
    } catch (error) {
      emit("error", { error: error instanceof HttpError ? error.message : "Silk hit an unexpected error.", status: error instanceof HttpError ? error.status : 500 });
    } finally { controller.close(); }
  } });
  return new Response(responseStream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-store", "Connection": "keep-alive" } });
}

async function chat(request, env, ctx) {
  requireAIConfiguration(env);
  const body = await readJson(request);
  const message = normalizeMessage(body.message);
  const directReply = await handleDirectCommand(message, env);

  if (directReply) {
    await saveConversationPair(env.DB, message, directReply.reply, directReply.sources || []);
    scheduleMemoryExtraction(ctx, env, message, directReply.reply);
    return json(directReply);
  }

  const settings = await getSettings(env.DB);
  const [history, memories, studyContext, workoutContext, projectContext, calendarContext] = await Promise.all([
    getRecentHistoryForAI(env.DB),
    getRelevantMemories(env.DB, message),
    getLatestStudyContext(env.DB),
    getCurrentWorkoutContext(env.DB),
    getProjectContext(env.DB),
    getCalendarContext(env),
  ]);
  const webRequested = body.web_search === true || shouldSearchWeb(message);
  const webResults = webRequested ? await searchWeb(message, env) : [];
  const model = chooseModel(message, settings.model_mode, "chat", env);
  const messages = [{
    role: "system",
    content: buildSystemPrompt(settings, {
      studyContext,
      workoutContext,
      projectContext,
      calendarContext,
      webAvailable: Boolean(env.TAVILY_API_KEY),
      calendarConnected: Boolean(calendarContext),
    }),
  }];
  if (memories.length) {
    messages.push({
      role: "system",
      content: "Relevant stored memories. Treat them as context rather than unquestionable truth:\n" +
        memories.map((item) => "[" + item.category + "] " + item.content).join("\n"),
    });
  }
  if (webResults.length) {
    messages.push({
      role: "system",
      content: "Current web search results are listed below. Base time-sensitive claims on these results, cite them inline as [1], [2], and so on, and do not invent a citation.\n\n" +
        webResults.map((item, index) =>
          "[" + (index + 1) + "] " + item.title + "\nURL: " + item.url + "\n" + item.snippet
        ).join("\n\n"),
    });
  }
  messages.push(...history, { role: "user", content: message });

  const result = await callAI(env, {
    model,
    messages,
    task: webResults.length ? "web_search_answer" : "chat",
    maxTokens: responseTokenLimit(settings.response_length),
    temperature: model.tier === "routine" ? 0.55 : 0.45,
    reasoningEffort: model.tier === "complex" ? "medium" : "low",
    verbosity: responseVerbosity(settings.response_length),
  });
  if (!result.text) throw new HttpError(502, "The AI returned no final text. Please try again.");
  await saveConversationPair(env.DB, message, result.text, webResults);
  scheduleMemoryExtraction(ctx, env, message, result.text);
  return json({
    reply: result.text,
    provider: result.provider,
    model: result.model.label,
    model_id: result.model.id,
    mode: settings.model_mode,
    sources: webResults,
    searched_web: webResults.length > 0,
    fallback: result.fallback || null,
    usage: {
      input_tokens: result.inputTokens,
      cached_input_tokens: result.cachedInputTokens,
      output_tokens: result.outputTokens,
      estimated_cost_usd: roundNumber(result.estimatedCostUsd, 6),
      latency_ms: result.latencyMs,
    },
  });
}

function scheduleMemoryExtraction(ctx, env, userMessage, assistantMessage) {
  if (!ctx?.waitUntil || !env.OPENAI_API_KEY) return;
  ctx.waitUntil(extractDurableMemories(env, userMessage, assistantMessage).catch((error) => {
    console.error("Background memory extraction failed", { message: safeText(error?.message, 180) });
  }));
}

function buildSystemPrompt(settings, context = {}) {
  const lengthRule = settings.response_length === "detailed"
    ? "Give enough detail to fully explain the answer, but remain organized."
    : settings.response_length === "balanced"
      ? "Use a moderate amount of detail."
      : "Be concise by default and expand only when the task genuinely needs it.";

  return `You are Silk, ${settings.owner_name || "Jaed"}'s private cloud-first personal assistant. You should feel capable, calm, precise, and natural, similar in function to a polished fictional assistant without impersonating a copyrighted character.

Communication rules:
- Lead with relevant facts or evidence. Give the recommendation after the facts.
- Do not mechanically repeat or paraphrase Jaed's message before answering.
- Do not use fake enthusiasm, excessive emojis, filler, or constant reassurance.
- Ask a question only when missing information materially changes the answer.
- ${lengthRule}
- Be direct when a plan is weak, risky, inefficient, or contradicted by the available evidence.

Operational truth:
- You can converse, read supplied memory context, use stored study and workout records, and use Silk's private project tracker.
- You may help prepare OneNote content, but direct OneNote synchronization is not connected yet.
- ${context.webAvailable ? "You can search the live web when search results are supplied. Cite those results as instructed." : "Live web search is awaiting its Tavily API key."}
- ${context.calendarConnected ? "Google Calendar is connected. Calendar context below is live." : "Google Calendar is not connected yet."}
- Notifications, home controls, continuous camera vision, and Raspberry Pi hardware are not connected yet.
- Never claim to have used an unavailable tool or completed an external action.
- A database action is real only if the application explicitly reports that it was completed.

Latest study context:
${context.studyContext || "No study sessions have been saved yet."}

Current workout context:
${context.workoutContext || "No workout is currently active."}

Private project context:
${context.projectContext || "No active projects are saved."}

Upcoming Google Calendar context:
${context.calendarContext || "No connected calendar context is available."}`;
}

function requireAIConfiguration(env) {
  const provider = primaryAIProvider(env);
  if (provider === "openai" && !env.OPENAI_API_KEY) {
    throw new HttpError(503, "PRIMARY_AI_PROVIDER is openai, but the OPENAI_API_KEY secret is missing.");
  }
  if (provider === "cloudflare" && !env.AI) {
    throw new HttpError(503, "Silk's Workers AI binding is missing.");
  }
}

function primaryAIProvider(env) {
  const configured = String(env?.PRIMARY_AI_PROVIDER || "cloudflare").trim().toLowerCase();
  return configured === "openai" ? "openai" : "cloudflare";
}

function resolveOpenAIModel(env, tier) {
  const configuredId = tier === "micro" ? env?.OPENAI_ROUTER_MODEL || OPENAI_DEFAULT_ROUTER_MODEL
    : tier === "complex" ? env?.OPENAI_COMPLEX_MODEL || OPENAI_DEFAULT_COMPLEX_MODEL
      : env?.OPENAI_ROUTINE_MODEL || OPENAI_DEFAULT_ROUTINE_MODEL;
  const id = safeModelId(configuredId);
  const known = OPENAI_MODEL_PRICING[id];
  const pricing = known || {
    label: id,
    // Conservative fallback pricing for an unknown OpenAI model override.
    inputPrice: 5,
    cachedInputPrice: 0.5,
    outputPrice: 30,
  };
  return Object.freeze({
    provider: "openai",
    tier,
    id,
    label: pricing.label,
    inputPrice: pricing.inputPrice,
    cachedInputPrice: pricing.cachedInputPrice,
    outputPrice: pricing.outputPrice,
    inputNeurons: 0,
    outputNeurons: 0,
  });
}

function resolveCloudflareModel(tier) {
  return tier === "complex" ? CLOUDFLARE_MODELS.reasoning : CLOUDFLARE_MODELS.efficient;
}

function safeModelId(value) {
  const model = String(value || "").trim();
  if (!model || model.length > 120 || !/^[a-zA-Z0-9._:@/-]+$/.test(model)) {
    throw new HttpError(503, "An AI model environment variable contains an invalid model ID.");
  }
  return model;
}

async function callAI(env, options) {
  const requestedModel = options.model;
  if (!requestedModel || !requestedModel.provider) {
    throw new HttpError(500, "Silk could not resolve an AI provider and model.");
  }
  if (requestedModel.provider === "openai") {
    try {
      return await callOpenAI(env, options);
    } catch (error) {
      if (error instanceof ProviderError && error.allowFallback && env.AI) {
        const fallbackModel = resolveCloudflareModel(requestedModel.tier);
        const fallback = await callCloudflareAI(env, { ...options, model: fallbackModel });
        return {
          ...fallback,
          fallback: {
            from_provider: "openai",
            reason: error.code || "openai_unavailable",
          },
        };
      }
      throw error;
    }
  }
  return callCloudflareAI(env, options);
}

async function callCloudflareAI(env, options) {
  if (!env.AI) throw new HttpError(503, "Silk's Workers AI binding is missing.");
  const startedAt = Date.now();
  let rawResult;
  try {
    rawResult = await env.AI.run(options.model.id, {
      messages: options.messages,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
    });
  } catch (error) {
    console.error("Workers AI request failed", {
      name: safeText(error?.name, 80),
      message: safeText(error?.message, 180),
    });
    throw new ProviderError(502, "The free Cloudflare AI model is temporarily unavailable.", {
      provider: "cloudflare",
      code: "cloudflare_unavailable",
      retryable: true,
      allowFallback: false,
    });
  }
  const latencyMs = Date.now() - startedAt;
  const text = extractAIText(rawResult);
  if (!text) throw new HttpError(502, "The Cloudflare AI model returned an empty response.");

  const inputCharacters = options.messages.reduce(
    (total, item) => total + String(item.content || "").length,
    0,
  );
  const inputTokens = readUsageNumber(rawResult, ["prompt_tokens", "input_tokens"]) ||
    estimateTokens(inputCharacters);
  const outputTokens = readUsageNumber(rawResult, ["completion_tokens", "output_tokens"]) ||
    estimateTokens(text.length);
  const neurons = (inputTokens / 1_000_000) * options.model.inputNeurons +
    (outputTokens / 1_000_000) * options.model.outputNeurons;
  const estimatedCostUsd = (inputTokens / 1_000_000) * options.model.inputPrice +
    (outputTokens / 1_000_000) * options.model.outputPrice;
  await recordUsage(env.DB, {
    provider: "cloudflare",
    model: options.model.id,
    task: options.task,
    inputTokens,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens,
    neurons,
    estimatedCostUsd,
    latencyMs,
    requestId: "",
  });
  return {
    provider: "cloudflare",
    model: options.model,
    text,
    toolCalls: [],
    inputTokens,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens,
    neurons,
    estimatedCostUsd,
    latencyMs,
    requestId: "",
  };
}

async function callOpenAI(env, options) {
  if (!env.OPENAI_API_KEY) {
    throw new ProviderError(503, "The OPENAI_API_KEY secret is missing.", {
      provider: "openai",
      code: "openai_key_missing",
      allowFallback: false,
    });
  }
  assertProviderCircuitClosed("openai");
  await enforceOpenAISpendLimit(env, options);

  const payload = buildOpenAIRequest(options);
  let lastError;
  for (let attempt = 1; attempt <= OPENAI_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("openai_timeout"), OPENAI_REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();
    try {
      const response = await externalFetch(env, OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + env.OPENAI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const latencyMs = Date.now() - startedAt;
      const requestId = safeText(response.headers.get("x-request-id"), 200);
      const responsePayload = await readExternalJson(response);
      if (!response.ok) {
        const providerError = openAIHttpError(response, responsePayload, requestId);
        lastError = providerError;
        if (providerError.retryable && attempt < OPENAI_MAX_ATTEMPTS) {
          await sleep(retryDelayMs(response, attempt));
          continue;
        }
        noteProviderFailure("openai", providerError.retryable);
        throw providerError;
      }

      noteProviderSuccess("openai");
      const text = extractOpenAIText(responsePayload);
      const toolCalls = extractOpenAIToolCalls(responsePayload);
      const usage = readOpenAIUsage(responsePayload);
      const estimatedCostUsd = estimateOpenAICost(options.model, usage);
      await recordUsage(env.DB, {
        provider: "openai",
        model: options.model.id,
        task: options.task,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        outputTokens: usage.outputTokens,
        neurons: 0,
        estimatedCostUsd,
        latencyMs,
        requestId: requestId || safeText(responsePayload.id, 200),
      });
      if (!text && !toolCalls.length) {
        throw new ProviderError(502, "OpenAI returned neither text nor a tool call.", {
          provider: "openai",
          code: "openai_empty_response",
          retryable: true,
          allowFallback: true,
        });
      }
      return {
        provider: "openai",
        model: options.model,
        text,
        toolCalls,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        outputTokens: usage.outputTokens,
        neurons: 0,
        estimatedCostUsd,
        latencyMs,
        requestId: requestId || safeText(responsePayload.id, 200),
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const timedOut = controller.signal.aborted || error?.name === "AbortError";
      const providerError = new ProviderError(
        504,
        timedOut ? "OpenAI timed out before answering." : "Silk could not reach OpenAI.",
        {
          provider: "openai",
          code: timedOut ? "openai_timeout" : "openai_network_error",
          retryable: true,
          allowFallback: true,
        },
      );
      lastError = providerError;
      console.error("OpenAI network request failed", {
        code: providerError.code,
        name: safeText(error?.name, 80),
        message: safeText(error?.message, 180),
      });
      if (attempt < OPENAI_MAX_ATTEMPTS) {
        await sleep(250 * attempt);
        continue;
      }
      noteProviderFailure("openai", true);
      throw providerError;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new ProviderError(502, "OpenAI could not complete the request.", {
    provider: "openai",
    code: "openai_failed",
    allowFallback: true,
  });
}

function buildOpenAIRequest(options) {
  const payload = {
    model: options.model.id,
    input: options.messages.map((item) => ({
      role: item.role === "system" ? "developer" : item.role,
      content: String(item.content || ""),
    })),
    store: false,
    max_output_tokens: Math.max(1, Math.min(128_000, Number(options.maxTokens || 520))),
    reasoning: {
      effort: options.reasoningEffort || (options.model.tier === "complex" ? "medium" : "low"),
    },
    text: {
      verbosity: ["low", "medium", "high"].includes(options.verbosity)
        ? options.verbosity
        : "low",
    },
    safety_identifier: "silk_single_owner_v1",
  };
  if (options.responseFormat?.schema) {
    payload.text.format = {
      type: "json_schema",
      name: safeSchemaName(options.responseFormat.name),
      strict: true,
      schema: options.responseFormat.schema,
    };
  }
  if (Array.isArray(options.tools) && options.tools.length) {
    payload.tools = options.tools;
    if (options.toolChoice) payload.tool_choice = options.toolChoice;
  }
  return payload;
}

function safeSchemaName(value) {
  const name = String(value || "silk_response").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return name || "silk_response";
}

function extractOpenAIText(result) {
  if (typeof result?.output_text === "string" && result.output_text.trim()) {
    return result.output_text.trim();
  }
  const parts = [];
  for (const item of Array.isArray(result?.output) ? result.output : []) {
    if (item?.type !== "message") continue;
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      } else if (content?.type === "refusal" && typeof content.refusal === "string") {
        parts.push(content.refusal);
      }
    }
  }
  return parts.join("\n").trim();
}

function extractOpenAIToolCalls(result) {
  const calls = [];
  for (const item of Array.isArray(result?.output) ? result.output : []) {
    if (item?.type !== "function_call") continue;
    let argumentsValue = {};
    try {
      argumentsValue = JSON.parse(String(item.arguments || "{}"));
    } catch {
      argumentsValue = null;
    }
    calls.push({
      id: safeText(item.id, 200),
      call_id: safeText(item.call_id, 200),
      name: safeText(item.name, 120),
      arguments: argumentsValue,
      raw_arguments: safeText(item.arguments, 20_000),
    });
  }
  return calls;
}

function readOpenAIUsage(result) {
  const usage = result?.usage || {};
  const details = usage.input_tokens_details || {};
  return {
    inputTokens: nonnegativeUsageNumber(usage.input_tokens),
    cachedInputTokens: nonnegativeUsageNumber(details.cached_tokens),
    cacheWriteTokens: nonnegativeUsageNumber(details.cache_write_tokens),
    outputTokens: nonnegativeUsageNumber(usage.output_tokens),
  };
}

function nonnegativeUsageNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function estimateOpenAICost(model, usage) {
  const cached = Math.min(usage.inputTokens, usage.cachedInputTokens);
  const cacheWrites = Math.min(Math.max(0, usage.inputTokens - cached), usage.cacheWriteTokens);
  const uncached = Math.max(0, usage.inputTokens - cached - cacheWrites);
  return (uncached / 1_000_000) * model.inputPrice +
    (cached / 1_000_000) * model.cachedInputPrice +
    (cacheWrites / 1_000_000) * model.inputPrice * OPENAI_CACHE_WRITE_MULTIPLIER +
    (usage.outputTokens / 1_000_000) * model.outputPrice;
}

async function enforceOpenAISpendLimit(env, options) {
  const limit = openAISpendLimitUsd(env, true);
  const spent = await getOpenAISpendThisMonth(env.DB);
  const inputCharacters = options.messages.reduce(
    (total, item) => total + String(item.content || "").length,
    0,
  );
  const estimatedInputTokens = estimateTokens(inputCharacters);
  const upperBound = (estimatedInputTokens / 1_000_000) * options.model.inputPrice +
    (Number(options.maxTokens || 520) / 1_000_000) * options.model.outputPrice;
  if (spent >= limit || spent + upperBound > limit) {
    throw new ProviderError(402, "Silk's OpenAI spending ceiling has been reached.", {
      provider: "openai",
      code: "openai_spend_limit",
      retryable: false,
      allowFallback: true,
    });
  }
}

function openAISpendLimitUsd(env, required = false) {
  const value = Number(env?.OPENAI_SPEND_LIMIT_USD);
  if (Number.isFinite(value) && value > 0) return value;
  if (required) {
    throw new ProviderError(503, "OPENAI_SPEND_LIMIT_USD must be a positive number before paid calls are enabled.", {
      provider: "openai",
      code: "openai_limit_missing",
      allowFallback: false,
    });
  }
  return 0;
}

async function getOpenAISpendThisMonth(db) {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS spent
     FROM usage_events
     WHERE provider = 'openai' AND created_at >= ?`,
  ).bind(startOfCurrentUtcMonth()).first();
  return Number(row?.spent || 0);
}

function openAIHttpError(response, payload, requestId) {
  const code = safeText(payload?.error?.code || payload?.error?.type, 120) || "openai_http_" + response.status;
  const retryable = [408, 409, 429, 500, 502, 503, 504].includes(response.status) &&
    code !== "insufficient_quota";
  const quota = response.status === 429 && /quota|billing|credit/i.test(
    code + " " + safeText(payload?.error?.message, 300),
  );
  let message = "OpenAI could not complete the request.";
  let allowFallback = retryable || quota;
  if (response.status === 401 || response.status === 403) {
    message = "OpenAI rejected the API key or its permissions. Check the project key in Cloudflare.";
    allowFallback = false;
  } else if (response.status === 400 && /model/i.test(code + " " + safeText(payload?.error?.message, 300))) {
    message = "OpenAI rejected a configured model ID. Check OPENAI_ROUTER_MODEL, OPENAI_ROUTINE_MODEL, and OPENAI_COMPLEX_MODEL.";
    allowFallback = false;
  } else if (quota) {
    message = "OpenAI API credit is unavailable or exhausted.";
  } else if (response.status === 429) {
    message = "OpenAI is rate-limiting Silk temporarily.";
  } else if (response.status >= 500) {
    message = "OpenAI is temporarily unavailable.";
  }
  console.error("OpenAI API error", {
    status: response.status,
    code,
    requestId,
  });
  return new ProviderError(response.status >= 400 && response.status < 600 ? response.status : 502, message, {
    provider: "openai",
    code,
    retryable,
    allowFallback,
    requestId,
  });
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(2_000, retryAfter * 1000);
  return Math.min(1_500, 300 * attempt);
}

function assertProviderCircuitClosed(provider) {
  const state = providerCircuitState.get(provider);
  if (!state || Number(state.openUntil || 0) <= Date.now()) return;
  throw new ProviderError(503, "OpenAI is temporarily paused after repeated failures.", {
    provider,
    code: "openai_circuit_open",
    retryable: false,
    allowFallback: true,
  });
}

function noteProviderSuccess(provider) {
  providerCircuitState.delete(provider);
}

function noteProviderFailure(provider, countsTowardCircuit) {
  if (!countsTowardCircuit) return;
  const previous = providerCircuitState.get(provider) || { failures: 0, openUntil: 0 };
  const failures = Number(previous.failures || 0) + 1;
  providerCircuitState.set(provider, {
    failures,
    openUntil: failures >= OPENAI_CIRCUIT_FAILURE_LIMIT
      ? Date.now() + OPENAI_CIRCUIT_COOLDOWN_MS
      : 0,
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)));
}

function readUsageNumber(result, keys) {
  for (const usage of [result?.usage, result?.result?.usage]) {
    if (!usage) continue;
    for (const key of keys) {
      const value = Number(usage[key]);
      if (Number.isFinite(value) && value >= 0) return value;
    }
  }
  return 0;
}

function estimateTokens(characters) {
  return Math.max(1, Math.ceil(Number(characters || 0) / 4));
}

async function recordUsage(db, event) {
  try {
    await db.prepare(
      `INSERT INTO usage_events
       (provider, model, task, input_tokens, cached_input_tokens, cache_write_tokens,
        output_tokens, neurons, estimated_cost_usd, latency_ms, request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      event.provider,
      event.model,
      event.task,
      Math.round(event.inputTokens || 0),
      Math.round(event.cachedInputTokens || 0),
      Math.round(event.cacheWriteTokens || 0),
      Math.round(event.outputTokens || 0),
      Number(event.neurons || 0),
      Number(event.estimatedCostUsd || 0),
      Math.round(event.latencyMs || 0),
      safeText(event.requestId, 200),
    ).run();
  } catch (error) {
    console.error("Could not record model usage", {
      provider: event.provider,
      model: event.model,
      message: safeText(error?.message, 180),
    });
  }
}

function chooseModel(message, mode = "automatic", task = "chat", env = {}) {
  let tier = "routine";
  if (task === "memory_extract" || task === "provider_diagnostic") tier = "micro";
  else if (task === "study_parse" || mode === "best") tier = "complex";
  else if (mode === "efficient" || task === "calendar_parse" || task === "provider_diagnostic") {
    tier = "routine";
  } else {
    const complexPattern =
      /\b(explain|compare|analy[sz]e|evidence|recommend|study|exam|anatomy|nursing|schedule|plan|why|how should|reason|evaluate|problem|assignment|debug|architecture|code review)\b/i;
    const text = String(message || "");
    const microPattern = /^\s*(?:hi|hello|hey|thanks|thank you|good (?:morning|afternoon|evening)|what(?:'s| is) next|mark .+ done|show .+|open .+|status)\b/i;
    tier = text.length > 180 || complexPattern.test(text) ? "complex" : text.length < 90 && microPattern.test(text) ? "micro" : "routine";
  }
  return primaryAIProvider(env) === "openai"
    ? resolveOpenAIModel(env, tier)
    : resolveCloudflareModel(tier);
}

function responseTokenLimit(length) {
  if (length === "detailed") return 1200;
  if (length === "balanced") return 800;
  return 520;
}

function responseVerbosity(length) {
  if (length === "detailed") return "high";
  if (length === "balanced") return "medium";
  return "low";
}

async function getAIStatus(env) {
  const router = resolveOpenAIModel(env, "micro");
  const routine = resolveOpenAIModel(env, "routine");
  const complex = resolveOpenAIModel(env, "complex");
  const limit = openAISpendLimitUsd(env, false);
  const spent = env.DB ? await getOpenAISpendThisMonth(env.DB) : 0;
  const circuit = providerCircuitState.get("openai") || {};
  return {
    primary_provider: primaryAIProvider(env),
    openai_configured: Boolean(env.OPENAI_API_KEY),
    cloudflare_configured: Boolean(env.AI),
    router_model: router.id,
    routine_model: routine.id,
    complex_model: complex.id,
    store_responses: false,
    spend_limit_usd: roundNumber(limit, 2),
    spent_this_month_usd: roundNumber(spent, 6),
    remaining_usd: roundNumber(Math.max(0, limit - spent), 6),
    circuit_open: Number(circuit.openUntil || 0) > Date.now(),
  };
}

async function handleDirectCommand(message, env) {
  const db = env.DB;
  const stripped = message.replace(/^silk[,\s:!-]*/i, "").trim();

  if (/\bgood morning\b/i.test(stripped)) {
    const brief = await getMorningBrief(env);
    const weatherLine = brief.weather?.status === "ready"
      ? `${brief.weather.location} is ${Math.round(brief.weather.temperature)}${brief.weather.unit} and ${String(brief.weather.condition).toLowerCase()}, with a high of ${Math.round(brief.weather.high)}${brief.weather.unit}. `
      : "";
    const calendarCount = Number(brief.calendar?.count || 0);
    const taskCount = (brief.today?.items || []).filter((item) => item.source_type !== "calendar").length;
    return {
      reply: `${weatherLine}You have ${calendarCount} calendar event${calendarCount === 1 ? "" : "s"} and ${taskCount} unfinished tracked task${taskCount === 1 ? "" : "s"} today. ${brief.today.progress.completed} of ${brief.today.progress.total} items are complete. ${brief.recommendation}`,
      provider: "silk",
      model: "Silk workflow",
      model_id: "silk.morning",
      sources: [],
      action: { type: "morning_brief", brief },
    };
  }
  const completion=stripped.match(/^(?:i (?:just )?(?:finished|completed)|mark)\s+(.+?)(?:\s+(?:as )?done)?[.!]*$/i);
  if(completion){const needle=safeText(completion[1],200).replace(/[%_]/g,"").trim();const matches=(await db.prepare(`SELECT * FROM daily_items WHERE date_key=? AND status NOT IN ('done','skipped') AND title LIKE ? ORDER BY priority DESC,scheduled_at LIMIT 3`).bind(localDateKey(),`%${needle}%`).all()).results||[];if(matches.length===1){const item=matches[0];await db.prepare(`UPDATE daily_items SET status='done',completion_source='voice',completed_at=unixepoch(),updated_at=unixepoch() WHERE id=?`).bind(item.id).run();if(item.source_type==='project'&&item.source_id)await db.prepare(`UPDATE project_tasks SET status='done',completed_at=unixepoch(),updated_at=unixepoch() WHERE id=?`).bind(Number(item.source_id)).run();return{reply:`${item.title} is marked complete.`,provider:"silk",model:"Silk workflow",model_id:"silk.today",sources:[],action:{type:"daily_item_completed",item_id:item.id}};}if(matches.length>1)return{reply:`I found more than one possible match: ${matches.map((item)=>item.title).join(", ")}. Tell me the exact one.`,sources:[]};}

  if (/^(?:which|what) provider and model (?:are|is) answering(?: this)?[?.!]*$/i.test(stripped)) {
    const settings = await getSettings(db);
    const requestedModel = chooseModel(stripped, "efficient", "provider_diagnostic", env);
    const result = await callAI(env, {
      model: requestedModel,
      messages: [
        { role: "system", content: "Return only the word ready." },
        { role: "user", content: "Run a provider connectivity check." },
      ],
      task: "provider_diagnostic",
      maxTokens: 16,
      temperature: 0.1,
      reasoningEffort: "low",
      verbosity: "low",
    });
    const providerLabel = result.provider === "openai" ? "OpenAI" : "Cloudflare Workers AI";
    const fallbackNote = result.fallback
      ? " OpenAI was unavailable, so the Cloudflare fallback handled this test (" + result.fallback.reason + ")."
      : "";
    return {
      reply: providerLabel + " is answering with " + result.model.label + " (" + result.model.id + "). " +
        "This test used " + result.inputTokens + " input tokens and " + result.outputTokens +
        " output tokens, with an estimated cost of US$" + roundNumber(result.estimatedCostUsd, 6).toFixed(6) + "." +
        fallbackNote,
      provider: result.provider,
      model: result.model.label,
      model_id: result.model.id,
      mode: settings.model_mode,
      action: "provider_diagnostic",
      fallback: result.fallback || null,
      usage: {
        input_tokens: result.inputTokens,
        cached_input_tokens: result.cachedInputTokens,
        output_tokens: result.outputTokens,
        estimated_cost_usd: roundNumber(result.estimatedCostUsd, 6),
        latency_ms: result.latencyMs,
      },
    };
  }
  const memoryMatch = stripped.match(/^remember(?: that)?\s+(.{3,4000})$/i);
  if (memoryMatch) {
    await insertMemory(db, "general", memoryMatch[1].trim(), 3);
    return {
      reply: "Saved. I’ll keep that in your general memory until you edit or remove it.",
      model: "Silk action",
      action: "memory_saved",
    };
  }

  const projectMatch = stripped.match(/^(?:create|start|add)(?: a| the)? project(?: called| named)?\s+(.{2,160})[.!]?$/i);
  if (projectMatch) {
    const project = await createProject(db, {
      name: projectMatch[1].trim().replace(/[.!]+$/, ""),
      description: "",
      status: "active",
      priority: 3,
      dueAt: null,
    });
    return {
      reply: project.name + " is now an active project in Silk. Open Projects to add its tasks, priority, description, or due date.",
      model: "Silk action",
      action: "project_created",
    };
  }

  if (/\b(?:unfinished|active|open)\s+projects\b|\bwhat projects\b/i.test(stripped)) {
    const projects = (await getProjects(db)).filter((item) => ["active", "paused"].includes(item.status));
    return {
      reply: projects.length
        ? "You have " + projects.length + " unfinished project" + (projects.length === 1 ? "" : "s") + ": " +
          projects.slice(0, 8).map((item) => item.name + " (" + item.open_tasks + " open task" +
            (Number(item.open_tasks) === 1 ? "" : "s") + ")").join("; ") + "."
        : "You have no unfinished projects in Silk.",
      model: "Silk records",
      action: "projects_retrieved",
    };
  }

  if (isCalendarWriteRequest(stripped)) {
    const status = await getGoogleStatus(env);
    if (!status.connected) {
      return {
        reply: status.configured
          ? "Google Calendar is ready but not connected. Open Calendar and choose Connect Google Calendar first."
          : "Google Calendar still needs its three Cloudflare secrets. Open Calendar for the setup list.",
        model: "Silk calendar",
        action: "calendar_not_connected",
      };
    }
    const parsed = await parseCalendarDraft(stripped, env);
    if (parsed.question) {
      return {
        reply: parsed.question,
        model: "Silk calendar",
        action: "calendar_clarification",
      };
    }
    return {
      reply: "I prepared the event details below. Check the title and time, then press Add event to write it to Google Calendar.",
      model: "Silk calendar draft",
      action: "calendar_draft",
      calendar_draft: parsed.draft,
    };
  }

  const calendarRange = requestedCalendarRange(stripped);
  if (calendarRange) {
    const status = await getGoogleStatus(env);
    if (!status.connected) {
      return {
        reply: status.configured
          ? "Google Calendar is configured but not connected. Open Calendar and choose Connect Google Calendar."
          : "Google Calendar still needs its three Cloudflare secrets. Open Calendar for the exact setup list.",
        model: "Silk calendar",
        action: "calendar_not_connected",
      };
    }
    const events = await listCalendarEvents(env, calendarRange.from, calendarRange.to, 20);
    return {
      reply: formatCalendarReply(events, calendarRange.label),
      model: "Silk calendar",
      action: "calendar_retrieved",
    };
  }

  const startMatch = stripped.match(
    /^(?:start|i(?:'m| am) starting|begin)(?: my| a)?\s+(.{2,80}?)\s+workout[.!]?$/i,
  );
  if (startMatch) {
    const session = await startWorkout(db, startMatch[1].trim());
    return {
      reply: session.created
        ? session.name + " is started. Tell me each exercise, weight, reps, and RPE as you complete it."
        : "You already have " + session.name + " active. Finish it before starting another workout.",
      model: "Silk action",
      action: session.created ? "workout_started" : "workout_already_active",
    };
  }

  if (/^(?:finish|end|complete)(?: my| the)? workout[.!]?$/i.test(stripped)) {
    const finished = await finishActiveWorkout(db);
    return {
      reply: finished ? finished.name + " is finished and saved." : "There isn’t an active workout to finish.",
      model: "Silk action",
      action: finished ? "workout_finished" : "no_active_workout",
    };
  }

  const setData = parseWorkoutSetCommand(stripped);
  if (setData) {
    const active = await getActiveWorkout(db);
    if (!active) {
      return {
        reply: "I understood the set, but no workout is active. Say “start push workout” first, then log the set again.",
        model: "Silk action",
        action: "workout_required",
      };
    }
    const result = await logWorkoutSet(db, { workoutId: active.id, ...setData });
    return { reply: result.summary, model: "Silk action", action: "set_logged" };
  }

  if (/\b(?:what did i study last|last study session|last exam|last quiz)\b/i.test(stripped)) {
    const latest = await getLatestStudySession(db);
    return {
      reply: latest ? describeStudySession(latest) : "You haven’t saved a study session yet.",
      model: "Silk records",
      action: "study_retrieved",
    };
  }

  if (/^(?:what(?:'s| is) next|next set|what should i do next)[?.!]*$/i.test(stripped)) {
    const active = await getActiveWorkout(db);
    if (!active) return null;
    const latestSet = await db.prepare(
      `SELECT exercise_name, set_number, weight, reps, rpe, is_warmup
       FROM exercise_sets WHERE workout_id = ?
       ORDER BY id DESC LIMIT 1`,
    ).bind(active.id).first();
    return {
      reply: latestSet
        ? "Your last logged set was " + formatSet(latestSet) +
          ". Continue with your programmed next set, or tell me the exercise you want to perform so I can compare it with your history."
        : active.name + " is active, but no sets are logged yet. Tell me your first exercise.",
      model: "Silk records",
      action: "workout_retrieved",
    };
  }
  return null;
}

function isCalendarWriteRequest(text) {
  return /\b(?:add|create|schedule|book|put)\b[\s\S]{0,180}\b(?:calendar|event|appointment|meeting|class|study block|workout)\b/i.test(
    String(text || ""),
  );
}

async function parseCalendarDraft(message, env) {
  const prompt = [
    {
      role: "system",
      content: `Extract a Google Calendar event draft from the user's request.
Return exactly one JSON object and no markdown with:
{"summary":string,"start":string,"end":string,"location":string,"description":string,"question":string}
Use ISO 8601 date-times with an explicit offset. The user's time zone is America/Toronto.
Current time is ${new Date().toISOString()}.
If the title, date, or start time is materially ambiguous, set question to one concise clarification and leave start/end empty.
If duration is omitted, use one hour. Never claim the event was created.`,
    },
    { role: "user", content: message },
  ];
  const result = await callAI(env, {
    model: chooseModel(message, "efficient", "calendar_parse", env),
    messages: prompt,
    task: "calendar_parse",
    maxTokens: 260,
    temperature: 0.1,
    reasoningEffort: "low",
    verbosity: "low",
    responseFormat: {
      name: "silk_calendar_draft",
      schema: CALENDAR_DRAFT_SCHEMA,
    },
  });
  let parsed;
  try {
    parsed = extractJsonObject(result.text);
  } catch {
    return { question: "What date and start time should I use for that calendar event?" };
  }
  const question = safeText(parsed.question, 300);
  if (question) return { question };
  const summary = safeText(parsed.summary, 200);
  const start = new Date(parsed.start);
  const end = new Date(parsed.end);
  if (!summary || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return { question: "What title, date, and start time should I use for that event?" };
  }
  return {
    draft: {
      summary,
      start: start.toISOString(),
      end: end.toISOString(),
      location: safeText(parsed.location, 500),
      description: safeText(parsed.description, 8000),
    },
  };
}

function parseWorkoutSetCommand(text) {
  const match = text.match(
    /^(?:i\s+)?(?:did|finished|completed|log(?:ged)?)\s+(.+?)\s+(?:at|with)\s+(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?)?\s+(?:for\s+)?(\d+)\s*(?:reps?)?(?:.*?\brpe\s*[:=]?\s*(\d+(?:\.\d+)?))?(?:\s+(warmup|warm-up))?[.!]?$/i,
  );
  if (!match) return null;
  const weight = Number(match[2]);
  const reps = Number(match[3]);
  const rpe = match[4] ? Number(match[4]) : null;
  if (!Number.isFinite(weight) || weight < 0 || !Number.isInteger(reps) || reps < 0) return null;
  if (rpe !== null && (rpe < 0 || rpe > 10)) return null;
  return {
    exerciseName: match[1].trim(),
    weight,
    reps,
    rpe,
    isWarmup: Boolean(match[5]),
  };
}

async function getHistory(db, limit = 60) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 60));
  const rows = await db.prepare(
    `SELECT id, role, content, created_at
     FROM messages ORDER BY id DESC LIMIT ?`,
  ).bind(safeLimit).all();
  const messages = (rows.results || []).reverse();
  const assistantIds = messages.filter((item) => item.role === "assistant").map((item) => Number(item.id));
  if (!assistantIds.length) return messages;
  const placeholders = assistantIds.map(() => "?").join(",");
  const sourceRows = await db.prepare(
    `SELECT message_id, title, url, snippet, position
     FROM message_sources
     WHERE message_id IN (${placeholders})
     ORDER BY message_id, position, id`,
  ).bind(...assistantIds).all();
  const byMessage = new Map();
  for (const source of sourceRows.results || []) {
    const id = Number(source.message_id);
    if (!byMessage.has(id)) byMessage.set(id, []);
    byMessage.get(id).push({
      title: source.title,
      url: source.url,
      snippet: source.snippet,
    });
  }
  return messages.map((item) => ({
    ...item,
    sources: byMessage.get(Number(item.id)) || [],
  }));
}

async function getRecentHistoryForAI(db) {
  const rows = await db.prepare(
    `SELECT role, content FROM messages ORDER BY id DESC LIMIT ?`,
  ).bind(HISTORY_LIMIT).all();
  return trimHistory((rows.results || []).reverse());
}

async function saveConversationPair(db, message, reply, sources = []) {
  await db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").bind("user", message).run();
  const assistant = await db.prepare(
    "INSERT INTO messages (role, content) VALUES (?, ?) RETURNING id",
  ).bind("assistant", reply).first();
  const cleanSources = normalizeSources(sources);
  if (assistant?.id && cleanSources.length) {
    await db.batch(cleanSources.map((source, index) =>
      db.prepare(
        `INSERT INTO message_sources (message_id, title, url, snippet, position)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(assistant.id, source.title, source.url, source.snippet, index),
    ));
  }
  return Number(assistant?.id || 0);
}

async function getProjects(db) {
  const rows = await db.prepare(
    `SELECT p.id, p.name, p.description, p.status, p.priority, p.due_at,
            p.created_at, p.updated_at, p.completed_at,
            COUNT(t.id) AS task_count,
            COALESCE(SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END), 0) AS done_tasks,
            COALESCE(SUM(CASE WHEN t.status != 'done' THEN 1 ELSE 0 END), 0) AS open_tasks
     FROM projects p
     LEFT JOIN project_tasks t ON t.project_id = p.id
     GROUP BY p.id
     ORDER BY
       CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
       p.priority DESC,
       CASE WHEN p.due_at IS NULL THEN 1 ELSE 0 END,
       p.due_at,
       p.updated_at DESC`,
  ).all();
  const projects = rows.results || [];
  if (!projects.length) return [];
  const ids = projects.map((item) => Number(item.id));
  const placeholders = ids.map(() => "?").join(",");
  const tasks = await db.prepare(
    `SELECT id, project_id, title, notes, status, sort_order, due_at,
            created_at, updated_at, completed_at
     FROM project_tasks
     WHERE project_id IN (${placeholders})
     ORDER BY project_id, status = 'done', sort_order, id`,
  ).bind(...ids).all();
  const byProject = new Map();
  for (const task of tasks.results || []) {
    const id = Number(task.project_id);
    if (!byProject.has(id)) byProject.set(id, []);
    byProject.get(id).push(task);
  }
  return projects.map((project) => ({
    ...project,
    task_count: Number(project.task_count || 0),
    done_tasks: Number(project.done_tasks || 0),
    open_tasks: Number(project.open_tasks || 0),
    tasks: byProject.get(Number(project.id)) || [],
  }));
}

async function getProjectContext(db) {
  const projects = (await getProjects(db)).filter((item) => ["active", "paused"].includes(item.status));
  if (!projects.length) return "";
  return projects.slice(0, 12).map((project) => {
    const open = (project.tasks || []).filter((task) => task.status !== "done").slice(0, 6);
    return project.name + " [" + project.status + ", priority " + project.priority + "] — " +
      project.done_tasks + "/" + project.task_count + " tasks complete" +
      (open.length ? ". Open: " + open.map((task) => task.title).join("; ") : "");
  }).join("\n");
}

async function createProjectRequest(request, db) {
  const body = await readJson(request);
  const project = await createProject(db, normalizeProjectInput(body));
  return json({ project }, 201);
}

function normalizeProjectInput(body, existing = null) {
  const current = existing || {};
  return {
    name: body.name === undefined
      ? current.name
      : normalizeShortText(body.name, 160, "Project name"),
    description: body.description === undefined
      ? String(current.description || "")
      : safeText(body.description, 4000),
    status: ["active", "paused", "completed", "archived"].includes(body.status)
      ? body.status
      : current.status || "active",
    priority: body.priority === undefined
      ? Number(current.priority || 3)
      : clampInteger(body.priority, 1, 5, 3),
    dueAt: body.due_at === undefined
      ? (current.due_at === undefined ? null : current.due_at)
      : parseOptionalTimestamp(body.due_at),
  };
}

async function createProject(db, data) {
  return db.prepare(
    `INSERT INTO projects (name, description, status, priority, due_at, completed_at)
     VALUES (?, ?, ?, ?, ?, CASE WHEN ? = 'completed' THEN unixepoch() ELSE NULL END)
     RETURNING id, name, description, status, priority, due_at, created_at, updated_at, completed_at`,
  ).bind(data.name, data.description, data.status, data.priority, data.dueAt, data.status).first();
}

async function updateProjectRequest(request, db, id) {
  const existing = await db.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
  if (!existing) throw new HttpError(404, "That project no longer exists.");
  const data = normalizeProjectInput(await readJson(request), existing);
  const project = await db.prepare(
    `UPDATE projects
     SET name = ?, description = ?, status = ?, priority = ?, due_at = ?,
         completed_at = CASE
           WHEN ? = 'completed' AND completed_at IS NULL THEN unixepoch()
           WHEN ? != 'completed' THEN NULL
           ELSE completed_at
         END,
         updated_at = unixepoch()
     WHERE id = ?
     RETURNING id, name, description, status, priority, due_at, created_at, updated_at, completed_at`,
  ).bind(
    data.name,
    data.description,
    data.status,
    data.priority,
    data.dueAt,
    data.status,
    data.status,
    id,
  ).first();
  return json({ project });
}

async function deleteProjectRequest(db, id) {
  const result = await db.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
  if (!Number(result?.meta?.changes ?? result?.changes ?? 0)) {
    throw new HttpError(404, "That project no longer exists.");
  }
  return json({ ok: true });
}

async function createProjectTaskRequest(request, db, projectId) {
  const project = await db.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).first();
  if (!project) throw new HttpError(404, "That project no longer exists.");
  const body = await readJson(request);
  const title = normalizeShortText(body.title, 300, "Task title");
  const notes = safeText(body.notes, 4000);
  const dueAt = parseOptionalTimestamp(body.due_at);
  const order = await db.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM project_tasks WHERE project_id = ?",
  ).bind(projectId).first();
  const task = await db.prepare(
    `INSERT INTO project_tasks (project_id, title, notes, sort_order, due_at)
     VALUES (?, ?, ?, ?, ?)
     RETURNING id, project_id, title, notes, status, sort_order, due_at, created_at, updated_at, completed_at`,
  ).bind(projectId, title, notes, Number(order?.next_order || 0), dueAt).first();
  await db.prepare("UPDATE projects SET updated_at = unixepoch() WHERE id = ?").bind(projectId).run();
  return json({ task }, 201);
}

async function updateProjectTaskRequest(request, db, id) {
  const existing = await db.prepare("SELECT * FROM project_tasks WHERE id = ?").bind(id).first();
  if (!existing) throw new HttpError(404, "That task no longer exists.");
  const body = await readJson(request);
  const title = body.title === undefined
    ? existing.title
    : normalizeShortText(body.title, 300, "Task title");
  const notes = body.notes === undefined ? existing.notes : safeText(body.notes, 4000);
  const status = ["todo", "doing", "done"].includes(body.status) ? body.status : existing.status;
  const dueAt = body.due_at === undefined ? existing.due_at : parseOptionalTimestamp(body.due_at);
  const task = await db.prepare(
    `UPDATE project_tasks
     SET title = ?, notes = ?, status = ?, due_at = ?,
         completed_at = CASE
           WHEN ? = 'done' AND completed_at IS NULL THEN unixepoch()
           WHEN ? != 'done' THEN NULL
           ELSE completed_at
         END,
         updated_at = unixepoch()
     WHERE id = ?
     RETURNING id, project_id, title, notes, status, sort_order, due_at, created_at, updated_at, completed_at`,
  ).bind(title, notes, status, dueAt, status, status, id).first();
  await db.prepare("UPDATE projects SET updated_at = unixepoch() WHERE id = ?").bind(existing.project_id).run();
  return json({ task });
}

async function deleteProjectTaskRequest(db, id) {
  const existing = await db.prepare("SELECT project_id FROM project_tasks WHERE id = ?").bind(id).first();
  if (!existing) throw new HttpError(404, "That task no longer exists.");
  await db.prepare("DELETE FROM project_tasks WHERE id = ?").bind(id).run();
  await db.prepare("UPDATE projects SET updated_at = unixepoch() WHERE id = ?").bind(existing.project_id).run();
  return json({ ok: true });
}

function localDateKey(value = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function normalizeDateKey(value) {
  const text = String(value || "").trim(); if (!text) return localDateKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T12:00:00Z`))) throw new HttpError(400, "Choose a valid date in YYYY-MM-DD format.");
  return text;
}
function utcRangeForDateKey(dateKey) { const start = Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 1000); return [start, start + 86400]; }
function calendarEventToDailyItem(event, dateKey) {
  const start = event?.all_day ? null : Math.floor(new Date(event?.start).getTime() / 1000);
  const end = event?.all_day ? null : Math.floor(new Date(event?.end).getTime() / 1000);
  const validStart = Number.isFinite(start) ? start : null;
  const validEnd = Number.isFinite(end) ? end : null;
  return {
    dateKey,
    title: safeText(event?.summary || "Untitled calendar event", 300),
    sourceId: safeText(event?.id, 300),
    scheduledAt: validStart,
    durationMinutes: validStart && validEnd
      ? Math.max(0, Math.min(1440, Math.round((validEnd - validStart) / 60)))
      : 0,
    notes: safeText([event?.location, event?.description].filter(Boolean).join(" — "), 4000),
  };
}
function buildTodayStats(items = [], week = {}) {
  const counted = items.filter((item) => item.status !== "skipped");
  const completed = counted.filter((item) => item.status === "done").length;
  const scheduledMinutes = items
    .filter((item) => item.source_type === "calendar")
    .reduce((sum, item) => sum + Number(item.duration_minutes || 0), 0);
  return {
    progress: {
      completed,
      total: counted.length,
      percent: counted.length ? Math.round((completed / counted.length) * 100) : 0,
    },
    week: { completed: Number(week?.completed || 0), total: Number(week?.total || 0) },
    focusMinutes: Math.max(0, 480 - scheduledMinutes),
  };
}
async function syncCalendarToDailyItems(env, dateKey) {
  const status = await getGoogleStatus(env); if (!status.connected) return [];
  const [year, month, day] = dateKey.split("-").map(Number); const from = startOfZonedDate(year, month, day, DEFAULT_TIME_ZONE); const to = new Date(from.getTime() + 86400000);
  try {
    const events = await listCalendarEvents(env, from, to, 50);
    for (const event of events) {
      const item = calendarEventToDailyItem(event, dateKey);
      await env.DB.prepare(`INSERT INTO daily_items (date_key,title,kind,source_type,source_id,status,scheduled_at,duration_minutes,priority,notes) VALUES (?,?,'event','calendar',?,'todo',?,?,3,?) ON CONFLICT(date_key,source_type,source_id) DO UPDATE SET title=excluded.title,scheduled_at=excluded.scheduled_at,duration_minutes=excluded.duration_minutes,notes=excluded.notes,updated_at=unixepoch()`).bind(item.dateKey, item.title, item.sourceId, item.scheduledAt, item.durationMinutes, item.notes).run();
    }
    return events;
  } catch (error) { console.error("Calendar-to-today sync failed", { message: safeText(error?.message,180) }); return []; }
}
async function syncProjectTasksToDailyItems(db, dateKey) {
  const [start,end] = utcRangeForDateKey(dateKey);
  const rows = await db.prepare(`SELECT t.id,t.title,t.notes,t.status,t.due_at,p.priority,p.name AS project_name FROM project_tasks t JOIN projects p ON p.id=t.project_id WHERE p.status='active' AND t.status!='done' AND ((t.due_at>=? AND t.due_at<?) OR t.status='doing') ORDER BY p.priority DESC,t.due_at,t.id LIMIT 30`).bind(start,end).all();
  for (const task of rows.results || []) await db.prepare(`INSERT INTO daily_items (date_key,title,kind,source_type,source_id,status,scheduled_at,duration_minutes,priority,notes) VALUES (?,?,'task','project',?,?,?,30,?,?) ON CONFLICT(date_key,source_type,source_id) DO UPDATE SET title=excluded.title,priority=excluded.priority,notes=excluded.notes,status=CASE WHEN daily_items.status IN ('done','skipped') THEN daily_items.status ELSE excluded.status END,updated_at=unixepoch()`).bind(dateKey,safeText(task.title,300),String(task.id),task.status==='doing'?'doing':'todo',task.due_at||null,Number(task.priority||3),safeText(`${task.project_name}${task.notes?` — ${task.notes}`:""}`,4000)).run();
}
async function getTodayDashboard(env, dateValue = null) {
  const dateKey = normalizeDateKey(dateValue); await Promise.all([syncCalendarToDailyItems(env,dateKey), syncProjectTasksToDailyItems(env.DB,dateKey)]);
  const items = (await env.DB.prepare(`SELECT id,date_key,title,kind,source_type,source_id,status,scheduled_at,duration_minutes,priority,notes,completion_source,completed_at,created_at,updated_at FROM daily_items WHERE date_key=? ORDER BY status='done',scheduled_at IS NULL,scheduled_at,priority DESC,id`).bind(dateKey).all()).results || [];
  const weekStart = new Date(`${dateKey}T12:00:00Z`); weekStart.setUTCDate(weekStart.getUTCDate()-((weekStart.getUTCDay()+6)%7)); const weekStartKey=weekStart.toISOString().slice(0,10); const weekEnd=new Date(weekStart); weekEnd.setUTCDate(weekEnd.getUTCDate()+7); const weekEndKey=weekEnd.toISOString().slice(0,10);
  const week = await env.DB.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN status='done' THEN 1 ELSE 0 END),0) AS completed FROM daily_items WHERE date_key>=? AND date_key<? AND status!='skipped'`).bind(weekStartKey,weekEndKey).first();
  const [dayStart]=utcRangeForDateKey(dateKey); const deadlines=(await env.DB.prepare(`SELECT id,name,due_at,priority FROM projects WHERE status='active' AND due_at IS NOT NULL AND due_at>=? AND due_at<? ORDER BY due_at,priority DESC LIMIT 8`).bind(dayStart,dayStart+7*86400).all()).results||[];
  const stats = buildTodayStats(items, week);
  return { date:dateKey,items,progress:stats.progress,week:stats.week,focus_minutes:stats.focusMinutes,deadlines,synced_at:Math.floor(Date.now()/1000) };
}
async function createDailyItemRequest(request,db) {
  const body=await readJson(request); const item=await db.prepare(`INSERT INTO daily_items (date_key,title,kind,source_type,status,scheduled_at,duration_minutes,priority,notes) VALUES (?,?,?,'manual',?,?,?,?,?) RETURNING *`).bind(normalizeDateKey(body.date||body.date_key),normalizeShortText(body.title,300,"Task title"),safeText(body.kind||"task",40),["todo","doing","done","skipped"].includes(body.status)?body.status:"todo",parseOptionalTimestamp(body.scheduled_at),clampInteger(body.duration_minutes,0,1440,30),clampInteger(body.priority,1,5,3),safeText(body.notes,4000)).first(); return json({item},201);
}
function projectTaskStatusForDailyStatus(status) {
  return status === "done" ? "done" : status === "doing" ? "doing" : "todo";
}
async function updateDailyItemRequest(request,db,id) {
  const existing=await db.prepare("SELECT * FROM daily_items WHERE id=?").bind(id).first(); if(!existing) throw new HttpError(404,"That daily item no longer exists."); const body=await readJson(request); const status=["todo","doing","done","skipped"].includes(body.status)?body.status:existing.status;
  const item=await db.prepare(`UPDATE daily_items SET title=?,status=?,priority=?,notes=?,duration_minutes=?,completion_source=CASE WHEN ?='done' THEN COALESCE(?,'manual') ELSE NULL END,completed_at=CASE WHEN ?='done' THEN COALESCE(completed_at,unixepoch()) ELSE NULL END,updated_at=unixepoch() WHERE id=? RETURNING *`).bind(body.title===undefined?existing.title:normalizeShortText(body.title,300,"Task title"),status,body.priority===undefined?existing.priority:clampInteger(body.priority,1,5,existing.priority),body.notes===undefined?existing.notes:safeText(body.notes,4000),body.duration_minutes===undefined?existing.duration_minutes:clampInteger(body.duration_minutes,0,1440,existing.duration_minutes),status,safeText(body.completion_source||"manual",40),status,id).first();
  if(existing.source_type==='project'&&existing.source_id){const projectStatus=projectTaskStatusForDailyStatus(status);await db.prepare(`UPDATE project_tasks SET status=?,completed_at=CASE WHEN ?='done' THEN unixepoch() ELSE NULL END,updated_at=unixepoch() WHERE id=?`).bind(projectStatus,projectStatus,Number(existing.source_id)).run();} return json({item});
}
async function deleteDailyItemRequest(db,id){const existing=await db.prepare("SELECT source_type FROM daily_items WHERE id=?").bind(id).first();if(!existing)throw new HttpError(404,"That daily item no longer exists.");if(existing.source_type!=="manual")throw new HttpError(409,"Synced items stay linked to their source. Mark it skipped instead.");await db.prepare("DELETE FROM daily_items WHERE id=?").bind(id).run();return json({ok:true});}

async function getGoogleStatus(env) {
  const configured = Boolean(
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY,
  );
  const integration = configured
    ? await env.DB.prepare(
      `SELECT account_email, scope, token_expires_at, updated_at
       FROM integrations WHERE provider = 'google'`,
    ).first()
    : null;
  return {
    configured,
    connected: Boolean(integration),
    account_email: integration?.account_email || "",
    scope: integration?.scope || "",
    token_expires_at: Number(integration?.token_expires_at || 0),
    redirect_path: "/api/google/callback",
    testing_note: "Google OAuth apps left in Testing mode usually require reconnection every 7 days.",
  };
}

function requireGoogleConfiguration(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
    throw new HttpError(
      503,
      "Google Calendar needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and TOKEN_ENCRYPTION_KEY secrets.",
    );
  }
}

async function beginGoogleOAuth(request, env) {
  requireGoogleConfiguration(env);
  const state = randomBase64Url(32);
  const verifier = randomBase64Url(64);
  const stateHash = await sha256Base64Url(state);
  const challenge = await sha256Base64Url(verifier);
  const encryptedVerifier = await encryptSecret(verifier, env.TOKEN_ENCRYPTION_KEY);
  const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < unixepoch()"),
    env.DB.prepare(
      `INSERT INTO oauth_states (state_hash, provider, code_verifier_encrypted, expires_at)
       VALUES (?, 'google', ?, ?)`,
    ).bind(stateHash, encryptedVerifier, expiresAt),
  ]);
  const redirectUri = new URL("/api/google/callback", request.url).toString();
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return Response.redirect(authorization.toString(), 302);
}

async function googleOAuthCallback(request, env) {
  requireGoogleConfiguration(env);
  const url = new URL(request.url);
  const oauthError = safeText(url.searchParams.get("error"), 160);
  if (oauthError) return redirectWithCalendarResult(request.url, "error", oauthError);
  const code = safeText(url.searchParams.get("code"), 4096);
  const state = safeText(url.searchParams.get("state"), 1024);
  if (!code || !state) throw new HttpError(400, "Google did not return a valid authorization code.");
  const stateHash = await sha256Base64Url(state);
  const stored = await env.DB.prepare(
    `SELECT code_verifier_encrypted, expires_at
     FROM oauth_states
     WHERE state_hash = ? AND provider = 'google'`,
  ).bind(stateHash).first();
  await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash = ?").bind(stateHash).run();
  if (!stored || Number(stored.expires_at) < Math.floor(Date.now() / 1000)) {
    throw new HttpError(400, "The Google connection request expired. Start it again from Silk.");
  }
  const verifier = await decryptSecret(stored.code_verifier_encrypted, env.TOKEN_ENCRYPTION_KEY);
  const redirectUri = new URL("/api/google/callback", request.url).toString();
  const tokenResponse = await externalFetch(env, "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }).toString(),
  });
  const tokenPayload = await readExternalJson(tokenResponse);
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    console.error("Google token exchange failed", tokenPayload.error || tokenResponse.status);
    return redirectWithCalendarResult(request.url, "error", "Google could not complete the connection.");
  }
  const existing = await env.DB.prepare(
    "SELECT refresh_token_encrypted FROM integrations WHERE provider = 'google'",
  ).first();
  const accessEncrypted = await encryptSecret(tokenPayload.access_token, env.TOKEN_ENCRYPTION_KEY);
  const refreshEncrypted = tokenPayload.refresh_token
    ? await encryptSecret(tokenPayload.refresh_token, env.TOKEN_ENCRYPTION_KEY)
    : existing?.refresh_token_encrypted || null;
  const expiresAt = Math.floor(Date.now() / 1000) + Math.max(60, Number(tokenPayload.expires_in || 3600) - 60);
  const email = readJwtPayload(tokenPayload.id_token)?.email || "";
  await env.DB.prepare(
    `INSERT INTO integrations
       (provider, access_token_encrypted, refresh_token_encrypted, token_expires_at,
        scope, account_email, metadata_json, updated_at)
     VALUES ('google', ?, ?, ?, ?, ?, '{}', unixepoch())
     ON CONFLICT(provider) DO UPDATE SET
       access_token_encrypted = excluded.access_token_encrypted,
       refresh_token_encrypted = COALESCE(excluded.refresh_token_encrypted, integrations.refresh_token_encrypted),
       token_expires_at = excluded.token_expires_at,
       scope = excluded.scope,
       account_email = excluded.account_email,
       updated_at = unixepoch()`,
  ).bind(
    accessEncrypted,
    refreshEncrypted,
    expiresAt,
    tokenPayload.scope || GOOGLE_SCOPES,
    email,
  ).run();
  await logAction(env.DB, "google", "connect", email || "primary calendar", {}, "completed");
  return redirectWithCalendarResult(request.url, "connected");
}

function redirectWithCalendarResult(requestUrl, result, detail = "") {
  const target = new URL("/", requestUrl);
  target.searchParams.set("calendar", result);
  if (detail) target.searchParams.set("detail", detail.slice(0, 160));
  return Response.redirect(target.toString(), 302);
}

async function disconnectGoogle(env) {
  requireGoogleConfiguration(env);
  const integration = await env.DB.prepare(
    "SELECT access_token_encrypted FROM integrations WHERE provider = 'google'",
  ).first();
  if (integration?.access_token_encrypted) {
    try {
      const token = await decryptSecret(integration.access_token_encrypted, env.TOKEN_ENCRYPTION_KEY);
      await externalFetch(env, "https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      });
    } catch (error) {
      console.error("Google token revocation failed", error);
    }
  }
  await env.DB.prepare("DELETE FROM integrations WHERE provider = 'google'").run();
  await logAction(env.DB, "google", "disconnect", "primary calendar", {}, "completed");
  return json({ ok: true });
}

async function getGoogleAccessToken(env, forceRefresh = false) {
  requireGoogleConfiguration(env);
  const integration = await env.DB.prepare(
    `SELECT access_token_encrypted, refresh_token_encrypted, token_expires_at
     FROM integrations WHERE provider = 'google'`,
  ).first();
  if (!integration) throw new HttpError(409, "Connect Google Calendar first.");
  const now = Math.floor(Date.now() / 1000);
  if (!forceRefresh && Number(integration.token_expires_at || 0) > now + 45) {
    return decryptSecret(integration.access_token_encrypted, env.TOKEN_ENCRYPTION_KEY);
  }
  if (!integration.refresh_token_encrypted) {
    throw new HttpError(401, "Google Calendar needs to be reconnected.");
  }
  const refreshToken = await decryptSecret(
    integration.refresh_token_encrypted,
    env.TOKEN_ENCRYPTION_KEY,
  );
  const response = await externalFetch(env, "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const payload = await readExternalJson(response);
  if (!response.ok || !payload.access_token) {
    if (payload.error === "invalid_grant") {
      await env.DB.prepare("DELETE FROM integrations WHERE provider = 'google'").run();
    }
    throw new HttpError(401, "Google Calendar authorization expired. Reconnect it from Calendar.");
  }
  const accessEncrypted = await encryptSecret(payload.access_token, env.TOKEN_ENCRYPTION_KEY);
  const expiresAt = now + Math.max(60, Number(payload.expires_in || 3600) - 60);
  await env.DB.prepare(
    `UPDATE integrations
     SET access_token_encrypted = ?, token_expires_at = ?, updated_at = unixepoch()
     WHERE provider = 'google'`,
  ).bind(accessEncrypted, expiresAt).run();
  return payload.access_token;
}

async function googleApi(env, path, options = {}, retry = true) {
  const token = await getGoogleAccessToken(env);
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", "Bearer " + token);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await externalFetch(env, "https://www.googleapis.com/calendar/v3" + path, {
    ...options,
    headers,
  });
  if (response.status === 401 && retry) {
    await getGoogleAccessToken(env, true);
    return googleApi(env, path, options, false);
  }
  return response;
}

async function listCalendarEventsRequest(request, env) {
  const url = new URL(request.url);
  const from = parseCalendarBoundary(url.searchParams.get("from"), new Date());
  const fallbackTo = new Date(from.getTime() + 7 * 86400000);
  const to = parseCalendarBoundary(url.searchParams.get("to"), fallbackTo);
  if (to <= from || to.getTime() - from.getTime() > 93 * 86400000) {
    throw new HttpError(400, "Choose a calendar range between one minute and 93 days.");
  }
  return json({ events: await listCalendarEvents(env, from, to, 50) });
}

async function listCalendarEvents(env, from, to, maxResults = 50) {
  const query = new URLSearchParams({
    timeMin: new Date(from).toISOString(),
    timeMax: new Date(to).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(Math.min(100, Math.max(1, maxResults))),
    timeZone: DEFAULT_TIME_ZONE,
  });
  const response = await googleApi(
    env,
    "/calendars/primary/events?" + query.toString(),
  );
  const payload = await readExternalJson(response);
  if (!response.ok) throw new HttpError(502, googleApiError(payload, "Google could not load the calendar."));
  return (payload.items || []).map(normalizeCalendarEvent);
}

async function createCalendarEventRequest(request, env) {
  const body = await readJson(request);
  const event = normalizeCalendarEventInput(body);
  if (body.confirmed !== true) {
    const approval = await createApprovalRecord(env.DB, {
      provider: "google",
      action: "calendar.create",
      target: event.summary,
      summary: `Create “${event.summary}” in Google Calendar`,
      payload: body,
      risk_level: "medium",
    });
    return json({ requires_confirmation: true, approval }, 202);
  }
  const response = await googleApi(env, "/calendars/primary/events", {
    method: "POST",
    body: JSON.stringify(event),
  });
  const payload = await readExternalJson(response);
  if (!response.ok) throw new HttpError(502, googleApiError(payload, "Google could not create the event."));
  const normalized = normalizeCalendarEvent(payload);
  await logAction(env.DB, "google", "calendar_event_created", normalized.id, {
    summary: normalized.summary,
    start: normalized.start,
  }, "completed");
  return json({ event: normalized }, 201);
}

async function updateCalendarEventRequest(request, env, eventId) {
  if (!eventId) throw new HttpError(400, "An event ID is required.");
  const body = await readJson(request);
  const patch = {};
  if (body.summary !== undefined) patch.summary = normalizeShortText(body.summary, 200, "Event title");
  if (body.description !== undefined) patch.description = safeText(body.description, 8000);
  if (body.location !== undefined) patch.location = safeText(body.location, 500);
  if (body.start !== undefined || body.end !== undefined) {
    if (!body.start || !body.end) throw new HttpError(400, "Both start and end are required when changing event time.");
    const timing = normalizeCalendarEventInput(body);
    patch.start = timing.start;
    patch.end = timing.end;
  }
  if (!Object.keys(patch).length) throw new HttpError(400, "No calendar changes were supplied.");
  if (body.confirmed !== true) {
    const approval = await createApprovalRecord(env.DB, {
      provider: "google",
      action: "calendar.update",
      target: eventId,
      summary: "Update a Google Calendar event",
      payload: { event_id: eventId, ...body },
      risk_level: "medium",
    });
    return json({ requires_confirmation: true, approval }, 202);
  }
  const response = await googleApi(
    env,
    "/calendars/primary/events/" + encodeURIComponent(eventId),
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  const payload = await readExternalJson(response);
  if (!response.ok) throw new HttpError(502, googleApiError(payload, "Google could not update the event."));
  const normalized = normalizeCalendarEvent(payload);
  await logAction(env.DB, "google", "calendar_event_updated", normalized.id, patch, "completed");
  return json({ event: normalized });
}

async function deleteCalendarEventRequest(request, env, eventId) {
  if (!eventId) throw new HttpError(400, "An event ID is required.");
  const body = await readJson(request);
  if (body.confirmed !== true) {
    const approval = await createApprovalRecord(env.DB, {
      provider: "google",
      action: "calendar.delete",
      target: eventId,
      summary: "Delete a Google Calendar event",
      payload: { event_id: eventId },
      risk_level: "high",
    });
    return json({ requires_confirmation: true, approval }, 202);
  }
  const response = await googleApi(
    env,
    "/calendars/primary/events/" + encodeURIComponent(eventId),
    { method: "DELETE" },
  );
  if (!response.ok && response.status !== 204) {
    const payload = await readExternalJson(response);
    throw new HttpError(502, googleApiError(payload, "Google could not delete the event."));
  }
  await logAction(env.DB, "google", "calendar_event_deleted", eventId, {}, "completed");
  return json({ ok: true });
}

function normalizeCalendarEventInput(body) {
  const summary = normalizeShortText(body.summary, 200, "Event title");
  const description = safeText(body.description, 8000);
  const location = safeText(body.location, 500);
  const timeZone = safeText(body.time_zone, 80) || DEFAULT_TIME_ZONE;
  const allDay = Boolean(body.all_day);
  if (allDay) {
    const startDate = normalizeDateString(String(body.start || ""));
    const endDate = normalizeDateString(String(body.end || ""));
    if (!startDate || !endDate || endDate <= startDate) {
      throw new HttpError(400, "All-day events need a valid start date and a later end date.");
    }
    return {
      summary,
      description,
      location,
      start: { date: startDate },
      end: { date: endDate },
    };
  }
  const start = new Date(body.start);
  const end = new Date(body.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new HttpError(400, "The event needs a valid start and a later end time.");
  }
  return {
    summary,
    description,
    location,
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
  };
}

function normalizeCalendarEvent(event) {
  return {
    id: String(event?.id || ""),
    summary: String(event?.summary || "Untitled event"),
    description: String(event?.description || ""),
    location: String(event?.location || ""),
    start: event?.start?.dateTime || event?.start?.date || "",
    end: event?.end?.dateTime || event?.end?.date || "",
    all_day: Boolean(event?.start?.date && !event?.start?.dateTime),
    html_link: String(event?.htmlLink || ""),
    status: String(event?.status || "confirmed"),
  };
}

function requestedCalendarRange(text) {
  if (!/\b(calendar|schedule|events?|appointments?|what(?:'s| is) (?:on|in) my day)\b/i.test(text)) return null;
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localMidnight = startOfZonedDate(
    Number(values.year),
    Number(values.month),
    Number(values.day),
    DEFAULT_TIME_ZONE,
  );
  if (/\btomorrow\b/i.test(text)) {
    const from = new Date(localMidnight.getTime() + 86400000);
    return { from, to: new Date(from.getTime() + 86400000), label: "tomorrow" };
  }
  if (/\btoday\b|\bmy day\b/i.test(text)) {
    return { from: localMidnight, to: new Date(localMidnight.getTime() + 86400000), label: "today" };
  }
  return { from: now, to: new Date(now.getTime() + 7 * 86400000), label: "the next seven days" };
}

function startOfZonedDate(year, month, day, timeZone) {
  const target = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    guess += target - represented;
  }
  return new Date(guess);
}

function formatCalendarReply(events, label) {
  if (!events.length) return "Your Google Calendar has no events " + label + ".";
  const lines = events.slice(0, 12).map((event) => {
    if (event.all_day) return "• " + event.summary + " — all day";
    const time = new Date(event.start).toLocaleTimeString("en-CA", {
      timeZone: DEFAULT_TIME_ZONE,
      hour: "numeric",
      minute: "2-digit",
    });
    return "• " + time + " — " + event.summary + (event.location ? " at " + event.location : "");
  });
  return "Your Google Calendar " + label + ":\n" + lines.join("\n");
}

async function getCalendarContext(env) {
  try {
    const status = await getGoogleStatus(env);
    if (!status.connected) return "";
    const from = new Date();
    const events = await listCalendarEvents(
      env,
      from,
      new Date(from.getTime() + 7 * 86400000),
      10,
    );
    return events.length
      ? events.map((event) => event.summary + " — " + event.start).join("\n")
      : "No events in the next seven days.";
  } catch (error) {
    console.error("Calendar context could not be loaded", error);
    return "";
  }
}

async function getMicrosoftStatus(env) {
  const configured = Boolean(
    env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY,
  );
  const integration = configured
    ? await env.DB.prepare(
      `SELECT account_email, scope, token_expires_at, metadata_json, updated_at
       FROM integrations WHERE provider = 'microsoft'`,
    ).first()
    : null;
  const metadata = parseStoredJson(integration?.metadata_json);
  return {
    configured,
    connected: Boolean(integration),
    account_email: integration?.account_email || "",
    scope: integration?.scope || "",
    token_expires_at: Number(integration?.token_expires_at || 0),
    section_id: safeText(metadata.section_id, 300),
    section_name: safeText(metadata.section_name, 200),
    auto_sync: metadata.auto_sync !== false,
    redirect_path: "/api/microsoft/callback",
  };
}

function requireMicrosoftConfiguration(env) {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
    throw new HttpError(
      503,
      "OneNote needs MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and TOKEN_ENCRYPTION_KEY secrets.",
    );
  }
}

async function beginMicrosoftOAuth(request, env) {
  requireMicrosoftConfiguration(env);
  const state = randomBase64Url(32);
  const verifier = randomBase64Url(64);
  const stateHash = await sha256Base64Url(state);
  const challenge = await sha256Base64Url(verifier);
  const encryptedVerifier = await encryptSecret(verifier, env.TOKEN_ENCRYPTION_KEY);
  const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < unixepoch()"),
    env.DB.prepare(
      `INSERT INTO oauth_states (state_hash, provider, code_verifier_encrypted, expires_at)
       VALUES (?, 'microsoft', ?, ?)`,
    ).bind(stateHash, encryptedVerifier, expiresAt),
  ]);
  const redirectUri = new URL("/api/microsoft/callback", request.url).toString();
  const authorization = new URL(MICROSOFT_AUTHORITY + "/authorize");
  authorization.search = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: MICROSOFT_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return Response.redirect(authorization.toString(), 302);
}

async function microsoftOAuthCallback(request, env) {
  requireMicrosoftConfiguration(env);
  const url = new URL(request.url);
  const oauthError = safeText(url.searchParams.get("error_description") || url.searchParams.get("error"), 300);
  if (oauthError) return redirectWithMicrosoftResult(request.url, "error", oauthError);
  const code = safeText(url.searchParams.get("code"), 4096);
  const state = safeText(url.searchParams.get("state"), 1024);
  if (!code || !state) throw new HttpError(400, "Microsoft did not return a valid authorization code.");
  const stateHash = await sha256Base64Url(state);
  const stored = await env.DB.prepare(
    `SELECT code_verifier_encrypted, expires_at FROM oauth_states
     WHERE state_hash = ? AND provider = 'microsoft'`,
  ).bind(stateHash).first();
  await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash = ?").bind(stateHash).run();
  if (!stored || Number(stored.expires_at) < Math.floor(Date.now() / 1000)) {
    throw new HttpError(400, "The Microsoft connection request expired. Start it again from Silk.");
  }
  const verifier = await decryptSecret(stored.code_verifier_encrypted, env.TOKEN_ENCRYPTION_KEY);
  const redirectUri = new URL("/api/microsoft/callback", request.url).toString();
  const tokenResponse = await externalFetch(env, MICROSOFT_AUTHORITY + "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID,
      client_secret: env.MICROSOFT_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
      scope: MICROSOFT_SCOPES,
    }).toString(),
  });
  const tokenPayload = await readExternalJson(tokenResponse);
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    console.error("Microsoft token exchange failed", tokenPayload.error || tokenResponse.status);
    return redirectWithMicrosoftResult(request.url, "error", "Microsoft could not complete the connection.");
  }
  const existing = await env.DB.prepare(
    "SELECT refresh_token_encrypted, metadata_json FROM integrations WHERE provider = 'microsoft'",
  ).first();
  const accessEncrypted = await encryptSecret(tokenPayload.access_token, env.TOKEN_ENCRYPTION_KEY);
  const refreshEncrypted = tokenPayload.refresh_token
    ? await encryptSecret(tokenPayload.refresh_token, env.TOKEN_ENCRYPTION_KEY)
    : existing?.refresh_token_encrypted || null;
  const expiresAt = Math.floor(Date.now() / 1000) + Math.max(60, Number(tokenPayload.expires_in || 3600) - 60);
  let email = readJwtPayload(tokenPayload.id_token)?.preferred_username || readJwtPayload(tokenPayload.id_token)?.email || "";
  try {
    const profileResponse = await externalFetch(env, MICROSOFT_GRAPH_URL + "/me?$select=mail,userPrincipalName", {
      headers: { Authorization: "Bearer " + tokenPayload.access_token },
    });
    const profile = await readExternalJson(profileResponse);
    if (profileResponse.ok) email = profile.mail || profile.userPrincipalName || email;
  } catch (error) {
    console.error("Microsoft profile lookup failed", safeText(error?.message, 180));
  }
  const metadata = { auto_sync: true, ...parseStoredJson(existing?.metadata_json) };
  await env.DB.prepare(
    `INSERT INTO integrations
       (provider, access_token_encrypted, refresh_token_encrypted, token_expires_at,
        scope, account_email, metadata_json, updated_at)
     VALUES ('microsoft', ?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(provider) DO UPDATE SET
       access_token_encrypted = excluded.access_token_encrypted,
       refresh_token_encrypted = COALESCE(excluded.refresh_token_encrypted, integrations.refresh_token_encrypted),
       token_expires_at = excluded.token_expires_at,
       scope = excluded.scope,
       account_email = excluded.account_email,
       metadata_json = excluded.metadata_json,
       updated_at = unixepoch()`,
  ).bind(accessEncrypted, refreshEncrypted, expiresAt, tokenPayload.scope || MICROSOFT_SCOPES, safeText(email, 300), JSON.stringify(metadata)).run();
  await logAction(env.DB, "microsoft", "connect", email || "OneNote", {}, "completed");
  return redirectWithMicrosoftResult(request.url, "connected");
}

function redirectWithMicrosoftResult(requestUrl, result, detail = "") {
  const target = new URL("/", requestUrl);
  target.searchParams.set("microsoft", result);
  if (detail) target.searchParams.set("detail", detail.slice(0, 160));
  return Response.redirect(target.toString(), 302);
}

async function disconnectMicrosoft(env) {
  requireMicrosoftConfiguration(env);
  await env.DB.prepare("DELETE FROM integrations WHERE provider = 'microsoft'").run();
  await logAction(env.DB, "microsoft", "disconnect", "OneNote", {}, "completed");
  return json({ ok: true });
}

async function getMicrosoftAccessToken(env, forceRefresh = false) {
  requireMicrosoftConfiguration(env);
  const integration = await env.DB.prepare(
    `SELECT access_token_encrypted, refresh_token_encrypted, token_expires_at
     FROM integrations WHERE provider = 'microsoft'`,
  ).first();
  if (!integration) throw new HttpError(409, "Connect Microsoft OneNote first.");
  const now = Math.floor(Date.now() / 1000);
  if (!forceRefresh && Number(integration.token_expires_at || 0) > now + 45) {
    return decryptSecret(integration.access_token_encrypted, env.TOKEN_ENCRYPTION_KEY);
  }
  if (!integration.refresh_token_encrypted) throw new HttpError(401, "Microsoft OneNote needs to be reconnected.");
  const refreshToken = await decryptSecret(integration.refresh_token_encrypted, env.TOKEN_ENCRYPTION_KEY);
  const response = await externalFetch(env, MICROSOFT_AUTHORITY + "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID,
      client_secret: env.MICROSOFT_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: MICROSOFT_SCOPES,
    }).toString(),
  });
  const payload = await readExternalJson(response);
  if (!response.ok || !payload.access_token) {
    if (["invalid_grant", "interaction_required"].includes(payload.error)) {
      await env.DB.prepare("DELETE FROM integrations WHERE provider = 'microsoft'").run();
    }
    throw new HttpError(401, "Microsoft authorization expired. Reconnect OneNote.");
  }
  const accessEncrypted = await encryptSecret(payload.access_token, env.TOKEN_ENCRYPTION_KEY);
  const refreshEncrypted = payload.refresh_token
    ? await encryptSecret(payload.refresh_token, env.TOKEN_ENCRYPTION_KEY)
    : integration.refresh_token_encrypted;
  const expiresAt = now + Math.max(60, Number(payload.expires_in || 3600) - 60);
  await env.DB.prepare(
    `UPDATE integrations SET access_token_encrypted = ?, refresh_token_encrypted = ?,
     token_expires_at = ?, updated_at = unixepoch() WHERE provider = 'microsoft'`,
  ).bind(accessEncrypted, refreshEncrypted, expiresAt).run();
  return payload.access_token;
}

async function microsoftGraph(env, path, options = {}, retry = true) {
  const token = await getMicrosoftAccessToken(env);
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", "Bearer " + token);
  const response = await externalFetch(env, MICROSOFT_GRAPH_URL + path, { ...options, headers });
  if (response.status === 401 && retry) {
    await getMicrosoftAccessToken(env, true);
    return microsoftGraph(env, path, options, false);
  }
  return response;
}

async function listOneNoteSections(env) {
  const response = await microsoftGraph(env, "/me/onenote/sections?$select=id,displayName,createdDateTime&$top=100");
  const payload = await readExternalJson(response);
  if (!response.ok) throw new HttpError(502, "Microsoft could not load your OneNote sections.");
  return (payload.value || []).map((section) => ({
    id: safeText(section.id, 300),
    name: safeText(section.displayName, 200) || "Untitled section",
    created_at: safeText(section.createdDateTime, 80),
  }));
}

async function updateMicrosoftSettings(request, env) {
  const body = await readJson(request);
  const integration = await env.DB.prepare(
    "SELECT metadata_json FROM integrations WHERE provider = 'microsoft'",
  ).first();
  if (!integration) throw new HttpError(409, "Connect Microsoft OneNote first.");
  const metadata = {
    ...parseStoredJson(integration.metadata_json),
    section_id: normalizeShortText(body.section_id, 300, "OneNote section"),
    section_name: safeText(body.section_name, 200),
    auto_sync: body.auto_sync !== false,
  };
  await env.DB.prepare(
    "UPDATE integrations SET metadata_json = ?, updated_at = unixepoch() WHERE provider = 'microsoft'",
  ).bind(JSON.stringify(metadata)).run();
  await logAction(env.DB, "microsoft", "onenote_section_selected", metadata.section_id, { name: metadata.section_name }, "completed");
  return json({ microsoft: await getMicrosoftStatus(env) });
}

async function syncStudySessionToOneNoteRequest(env, sessionId) {
  const session = await getStudySessionById(env.DB, sessionId);
  if (!session) throw new HttpError(404, "That study session no longer exists.");
  const result = await syncStudySessionToOneNote(env, session);
  return json({ session: await getStudySessionById(env.DB, sessionId), onenote: result });
}

async function syncStudySessionToOneNote(env, session) {
  const integration = await env.DB.prepare(
    "SELECT metadata_json FROM integrations WHERE provider = 'microsoft'",
  ).first();
  const metadata = parseStoredJson(integration?.metadata_json);
  if (!integration) throw new HttpError(409, "Connect Microsoft OneNote first.");
  if (!metadata.section_id) throw new HttpError(409, "Choose a OneNote section before syncing study notes.");
  await env.DB.prepare(
    "UPDATE study_sessions SET onenote_sync_status = 'syncing', onenote_sync_error = '', updated_at = unixepoch() WHERE id = ?",
  ).bind(session.id).run();
  try {
    const response = await microsoftGraph(
      env,
      "/me/onenote/sections/" + encodeURIComponent(metadata.section_id) + "/pages",
      {
        method: "POST",
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: buildOneNotePageHtml(session),
      },
    );
    const payload = await readExternalJson(response);
    if (!response.ok || !payload.id) throw new HttpError(502, "Microsoft could not create the OneNote page.");
    await env.DB.prepare(
      `UPDATE study_sessions SET onenote_page_id = ?, onenote_sync_status = 'synced',
       onenote_synced_at = unixepoch(), onenote_sync_error = '', updated_at = unixepoch() WHERE id = ?`,
    ).bind(safeText(payload.id, 500), session.id).run();
    await logAction(env.DB, "microsoft", "onenote_page_created", payload.id, {
      session_id: session.id,
      subject: session.subject,
      section: metadata.section_name || metadata.section_id,
    }, "completed");
    return { page_id: safeText(payload.id, 500), links: payload.links || {}, section_name: metadata.section_name || "" };
  } catch (error) {
    const message = safeText(error?.message || "OneNote sync failed.", 500);
    await env.DB.prepare(
      "UPDATE study_sessions SET onenote_sync_status = 'failed', onenote_sync_error = ?, updated_at = unixepoch() WHERE id = ?",
    ).bind(message, session.id).run();
    await logAction(env.DB, "microsoft", "onenote_page_create", String(session.id), { error: message }, "failed");
    throw error;
  }
}

function buildOneNotePageHtml(session) {
  const topics = Array.isArray(session.topics) ? session.topics : [];
  const topicRows = topics.length
    ? `<h2>Topic results</h2><ul>${topics.map((topic) => `<li><strong>${escapeHtml(topic.topic)}</strong>${topic.score === null || topic.score === undefined ? "" : ` — ${escapeHtml(String(topic.score))}%`}${topic.improvement_notes ? `<br><span>${escapeHtml(topic.improvement_notes)}</span>` : ""}</li>`).join("")}</ul>`
    : "";
  const studied = new Date(Number(session.studied_at || Math.floor(Date.now() / 1000)) * 1000).toLocaleDateString("en-CA", { timeZone: DEFAULT_TIME_ZONE });
  return `<!DOCTYPE html><html><head><title>${escapeHtml(session.subject)} — ${escapeHtml(studied)}</title><meta name="created" content="${new Date().toISOString()}" /></head><body><h1>${escapeHtml(session.subject)}</h1><p><strong>${escapeHtml(session.session_type || "Study session")}</strong> · ${escapeHtml(studied)}${session.duration_minutes ? ` · ${escapeHtml(String(session.duration_minutes))} minutes` : ""}${session.overall_grade === null || session.overall_grade === undefined ? "" : ` · ${escapeHtml(String(session.overall_grade))}%`}</p>${session.strengths ? `<h2>What went well</h2><p>${escapeHtml(session.strengths)}</p>` : ""}${session.weaknesses ? `<h2>What needs work</h2><p>${escapeHtml(session.weaknesses)}</p>` : ""}${session.next_step ? `<h2>Recommended next step</h2><p>${escapeHtml(session.next_step)}</p>` : ""}${topicRows}<p><em>Saved automatically by Silk.</em></p></body></html>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
}

function parseStoredJson(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function getWebSearchStatus(env) {
  const start = startOfCurrentUtcMonth();
  const total = await env.DB.prepare(
    "SELECT COUNT(*) AS searches FROM web_searches WHERE created_at >= ?",
  ).bind(start).first();
  return {
    configured: Boolean(env.TAVILY_API_KEY),
    provider: "Tavily",
    searches_this_month: Number(total?.searches || 0),
    free_monthly_credits: 1000,
  };
}

async function webSearchRequest(request, env) {
  const body = await readJson(request);
  const query = normalizeShortText(body.query, 500, "Search query");
  const results = await searchWeb(query, env);
  return json({ query, results, provider: "Tavily" });
}

function shouldSearchWeb(message) {
  return /\b(search (?:the )?web|look (?:it|this|that|.+) up|browse|find (?:online|sources?)|latest|current(?:ly)?|today(?:'s)? (?:news|price|weather)|recent news|breaking news|news about|price of|weather (?:in|for)|verify online)\b/i.test(
    String(message || ""),
  );
}

async function searchWeb(query, env) {
  if (!env.TAVILY_API_KEY) {
    throw new HttpError(503, "Web search needs the TAVILY_API_KEY Cloudflare secret.");
  }
  const response = await externalFetch(env, "https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.TAVILY_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      topic: "general",
      search_depth: "basic",
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    }),
  });
  const payload = await readExternalJson(response);
  if (!response.ok) {
    console.error("Tavily search failed", payload.error || response.status);
    throw new HttpError(502, "Tavily could not complete that search. Check the API key or try again.");
  }
  const results = normalizeSources((payload.results || []).map((item) => ({
    title: item.title,
    url: item.url,
    snippet: item.content,
  })));
  await env.DB.prepare(
    "INSERT INTO web_searches (query, result_count, provider) VALUES (?, ?, 'tavily')",
  ).bind(query, results.length).run();
  return results;
}

function normalizeSources(sources) {
  const seen = new Set();
  const normalized = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    const title = safeText(source?.title, 300) || "Source";
    const snippet = safeText(source?.snippet || source?.content, 1500);
    let url;
    try {
      url = new URL(String(source?.url || ""));
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || seen.has(url.toString())) continue;
    seen.add(url.toString());
    normalized.push({ title, url: url.toString(), snippet });
    if (normalized.length >= 8) break;
  }
  return normalized;
}

async function externalFetch(env, url, options = {}) {
  const fetcher = typeof env.TEST_FETCH === "function" ? env.TEST_FETCH : fetch;
  return fetcher(url, options);
}

async function readExternalJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function googleApiError(payload, fallback) {
  return safeText(payload?.error?.message || payload?.error_description, 300) || fallback;
}

async function logAction(db, provider, action, target, detail, status) {
  await db.prepare(
    `INSERT INTO action_log (provider, action, target, detail_json, status)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(provider, action, target || "", JSON.stringify(detail || {}), status || "completed").run();
}

async function getActivity(db, limitValue = 30) {
  const limit = clampInteger(limitValue, 1, 100, 30);
  const rows = (await db.prepare(
    `SELECT id, provider, action, target, detail_json, status, created_at
     FROM action_log ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).bind(limit).all()).results || [];
  return rows.map((row) => ({
    id: Number(row.id),
    provider: String(row.provider || "silk"),
    action: String(row.action || "activity"),
    target: String(row.target || ""),
    detail: parseStoredJson(row.detail_json),
    status: String(row.status || "completed"),
    created_at: Number(row.created_at || 0),
  }));
}

async function createApprovalRecord(db, input) {
  const now = Math.floor(Date.now() / 1000);
  const approval = await db.prepare(
    `INSERT INTO approval_requests
     (provider, action, target, summary, payload_json, risk_level, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
     RETURNING id, provider, action, target, summary, risk_level, status, expires_at, created_at`,
  ).bind(
    safeText(input.provider || "silk", 80) || "silk",
    safeText(input.action || "action", 120) || "action",
    safeText(input.target, 300),
    normalizeShortText(input.summary, 500, "Approval summary"),
    JSON.stringify(input.payload || {}),
    ["low", "medium", "high"].includes(input.risk_level) ? input.risk_level : "medium",
    now + clampInteger(input.expires_in_seconds, 60, 86400, 1800),
  ).first();
  await logAction(db, approval.provider, "approval_requested", String(approval.id), {
    action: approval.action,
    summary: approval.summary,
    risk_level: approval.risk_level,
  }, "pending");
  return approval;
}

async function createApprovalRequest(request, db) {
  const body = await readJson(request);
  return json({ approval: await createApprovalRecord(db, body) }, 201);
}

async function getApprovals(db) {
  await db.prepare(
    "UPDATE approval_requests SET status = 'expired', resolved_at = unixepoch() WHERE status = 'pending' AND expires_at < unixepoch()",
  ).run();
  const rows = (await db.prepare(
    `SELECT id, provider, action, target, summary, risk_level, status, expires_at, resolved_at, created_at
     FROM approval_requests ORDER BY status = 'pending' DESC, created_at DESC, id DESC LIMIT 50`,
  ).all()).results || [];
  return rows.map((row) => ({ ...row, id: Number(row.id), expires_at: Number(row.expires_at), created_at: Number(row.created_at) }));
}

async function resolveApprovalRequest(request, env, id) {
  const body = await readJson(request);
  const status = body.status === "approved" ? "approved" : body.status === "rejected" ? "rejected" : "";
  if (!status) throw new HttpError(400, "Choose approved or rejected.");
  const approval = await env.DB.prepare(
    `UPDATE approval_requests SET status = ?, resolved_at = unixepoch()
     WHERE id = ? AND status = 'pending' AND expires_at >= unixepoch()
     RETURNING id, provider, action, target, summary, payload_json, risk_level, status, expires_at, resolved_at, created_at`,
  ).bind(status, id).first();
  if (!approval) throw new HttpError(409, "That approval is no longer pending.");
  await logAction(env.DB, approval.provider, "approval_" + status, String(id), { action: approval.action }, status);

  let result = null;
  if (status === "approved") {
    try {
      result = await executeApprovedAction(env, approval);
    } catch (error) {
      await logAction(env.DB, approval.provider, "approval_execution_failed", String(id), {
        action: approval.action,
        error: error instanceof Error ? error.message : "External action failed",
      }, "failed");
      throw error;
    }
  }

  const safeApproval = { ...approval };
  delete safeApproval.payload_json;
  return json({ approval: safeApproval, executed: status === "approved", result });
}

async function executeApprovedAction(env, approval) {
  const payload = parseStoredJson(approval.payload_json);
  if (approval.provider !== "google") {
    throw new HttpError(400, "This approval type cannot execute an external action yet.");
  }

  if (approval.action === "calendar.create") {
    const event = normalizeCalendarEventInput(payload);
    const response = await googleApi(env, "/calendars/primary/events", {
      method: "POST",
      body: JSON.stringify(event),
    });
    const responsePayload = await readExternalJson(response);
    if (!response.ok) throw new HttpError(502, googleApiError(responsePayload, "Google could not create the event."));
    const normalized = normalizeCalendarEvent(responsePayload);
    await logAction(env.DB, "google", "calendar_event_created", normalized.id, {
      approval_id: Number(approval.id),
      summary: normalized.summary,
      start: normalized.start,
    }, "completed");
    return { event: normalized };
  }

  if (approval.action === "calendar.update") {
    const eventId = safeText(payload.event_id || approval.target, 500);
    if (!eventId) throw new HttpError(400, "The approved Calendar event ID is missing.");
    const patch = {};
    if (payload.summary !== undefined) patch.summary = normalizeShortText(payload.summary, 200, "Event title");
    if (payload.description !== undefined) patch.description = safeText(payload.description, 8000);
    if (payload.location !== undefined) patch.location = safeText(payload.location, 500);
    if (payload.start !== undefined || payload.end !== undefined) {
      if (!payload.start || !payload.end) throw new HttpError(400, "Both start and end are required when changing event time.");
      const timing = normalizeCalendarEventInput(payload);
      patch.start = timing.start;
      patch.end = timing.end;
    }
    if (!Object.keys(patch).length) throw new HttpError(400, "The approved Calendar update is empty.");
    const response = await googleApi(env, "/calendars/primary/events/" + encodeURIComponent(eventId), {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    const responsePayload = await readExternalJson(response);
    if (!response.ok) throw new HttpError(502, googleApiError(responsePayload, "Google could not update the event."));
    const normalized = normalizeCalendarEvent(responsePayload);
    await logAction(env.DB, "google", "calendar_event_updated", normalized.id, {
      approval_id: Number(approval.id),
      ...patch,
    }, "completed");
    return { event: normalized };
  }

  if (approval.action === "calendar.delete") {
    const eventId = safeText(payload.event_id || approval.target, 500);
    if (!eventId) throw new HttpError(400, "The approved Calendar event ID is missing.");
    const response = await googleApi(env, "/calendars/primary/events/" + encodeURIComponent(eventId), {
      method: "DELETE",
    });
    if (!response.ok && response.status !== 204) {
      const responsePayload = await readExternalJson(response);
      throw new HttpError(502, googleApiError(responsePayload, "Google could not delete the event."));
    }
    await logAction(env.DB, "google", "calendar_event_deleted", eventId, {
      approval_id: Number(approval.id),
    }, "completed");
    return { deleted: true, event_id: eventId };
  }

  throw new HttpError(400, "This approved Google action is not supported.");
}

async function getIntegrationStatuses(env) {
  const [google, microsoft, web, settings] = await Promise.all([
    getGoogleStatus(env),
    getMicrosoftStatus(env),
    getWebSearchStatus(env),
    getSettings(env.DB),
  ]);
  return {
    google_calendar: google,
    microsoft_onenote: microsoft,
    web_search: web,
    weather: { configured: Boolean(settings.home_city), location: settings.home_city || "" },
    openai: { configured: Boolean(env.OPENAI_API_KEY), server_side_secret: true },
    cloudflare_ai: { configured: Boolean(env.AI), bound: Boolean(env.AI) },
    apple_health: { configured: false, requires_native_companion: true },
    local_bridge: { configured: false, available_after_device_bridge: true },
  };
}

async function getWeatherSummary(env, knownSettings = null) {
  const settings = knownSettings || await getSettings(env.DB);
  const location = safeText(settings.home_city, 200);
  if (!location) return { configured: false, status: "location_required", location: "" };
  const cacheKey = "home:" + location.toLowerCase() + ":" + settings.temperature_unit;
  const cached = await env.DB.prepare(
    "SELECT location_label, payload_json, expires_at, updated_at FROM weather_cache WHERE cache_key = ?",
  ).bind(cacheKey).first();
  const now = Math.floor(Date.now() / 1000);
  if (cached && Number(cached.expires_at) > now) {
    return { ...parseStoredJson(cached.payload_json), cached: true, updated_at: Number(cached.updated_at) };
  }
  try {
    const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geocodeUrl.search = new URLSearchParams({ name: location.split(",")[0].trim(), count: "5", language: "en", format: "json" }).toString();
    const geocodeResponse = await externalFetch(env, geocodeUrl.toString());
    const geocode = await readExternalJson(geocodeResponse);
    const places = Array.isArray(geocode.results) ? geocode.results : [];
    const place = places.find((candidate) => location.toLowerCase().includes(String(candidate.admin1 || "").toLowerCase())) || places[0];
    if (!geocodeResponse.ok || !place) throw new Error("The home city could not be found.");
    const unit = settings.temperature_unit === "fahrenheit" ? "fahrenheit" : "celsius";
    const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
    forecastUrl.search = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      current: "temperature_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
      temperature_unit: unit,
      wind_speed_unit: "kmh",
      timezone: safeText(settings.time_zone, 80) || DEFAULT_TIME_ZONE,
      forecast_days: "3",
    }).toString();
    const forecastResponse = await externalFetch(env, forecastUrl.toString());
    const forecast = await readExternalJson(forecastResponse);
    if (!forecastResponse.ok || !forecast.current) throw new Error("The weather service did not return a forecast.");
    const code = Number(forecast.current.weather_code || 0);
    const payload = {
      configured: true,
      status: "ready",
      location: [place.name, place.admin1].filter(Boolean).join(", "),
      latitude: Number(place.latitude),
      longitude: Number(place.longitude),
      condition: weatherCodeLabel(code),
      weather_code: code,
      temperature: Number(forecast.current.temperature_2m),
      feels_like: Number(forecast.current.apparent_temperature),
      precipitation: Number(forecast.current.precipitation || 0),
      wind_speed: Number(forecast.current.wind_speed_10m || 0),
      unit: unit === "fahrenheit" ? "°F" : "°C",
      high: Number(forecast.daily?.temperature_2m_max?.[0]),
      low: Number(forecast.daily?.temperature_2m_min?.[0]),
      precipitation_probability: Number(forecast.daily?.precipitation_probability_max?.[0] || 0),
      sunrise: forecast.daily?.sunrise?.[0] || "",
      sunset: forecast.daily?.sunset?.[0] || "",
      source: "Open-Meteo",
      cached: false,
      updated_at: now,
    };
    await env.DB.prepare(
      `INSERT INTO weather_cache (cache_key, location_label, payload_json, expires_at, updated_at)
       VALUES (?, ?, ?, ?, unixepoch())
       ON CONFLICT(cache_key) DO UPDATE SET location_label = excluded.location_label,
       payload_json = excluded.payload_json, expires_at = excluded.expires_at, updated_at = unixepoch()`,
    ).bind(cacheKey, payload.location, JSON.stringify(payload), now + 20 * 60).run();
    return payload;
  } catch (error) {
    if (cached) return { ...parseStoredJson(cached.payload_json), cached: true, stale: true, error: safeText(error?.message, 240) };
    return { configured: true, status: "unavailable", location, error: safeText(error?.message || "Weather is temporarily unavailable.", 240) };
  }
}

function weatherCodeLabel(code) {
  if (code === 0) return "Clear";
  if ([1, 2].includes(code)) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if ([45, 48].includes(code)) return "Foggy";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorms";
  return "Mixed conditions";
}

async function getMorningBrief(env) {
  const [settings, today, weather, study, projects] = await Promise.all([
    getSettings(env.DB),
    getTodayDashboard(env),
    getWeatherSummary(env),
    getLatestStudySession(env.DB),
    getProjects(env.DB),
  ]);
  const unfinished = today.items.filter((item) => !["done", "skipped"].includes(item.status));
  const first = unfinished.sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0))[0] || null;
  const events = today.items.filter((item) => item.source_type === "calendar");
  const weakest = study?.topics?.filter((topic) => topic.score !== null && topic.score !== undefined)
    .sort((left, right) => Number(left.score) - Number(right.score))[0] || null;
  const recommendation = first
    ? `${first.title} is the highest-priority unfinished item. I recommend starting there.`
    : weakest
      ? `${weakest.topic} is your lowest recorded study result at ${weakest.score}%. I recommend reviewing it first.`
      : "Nothing urgent is currently tracked. I recommend choosing one meaningful priority before the day fills up.";
  return {
    generated_at: Math.floor(Date.now() / 1000),
    owner_name: settings.owner_name,
    date: today.date,
    weather,
    calendar: { connected: (await getGoogleStatus(env)).connected, events, count: events.length },
    today: { ...today, items: unfinished },
    latest_study: study,
    active_projects: projects.filter((project) => project.status === "active").slice(0, 5),
    recommendation,
  };
}

function parseCalendarBoundary(value, fallback) {
  const date = value ? new Date(value) : new Date(fallback);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "A calendar date is invalid.");
  return date;
}

function parseOptionalTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "The due date is invalid.");
  return Math.floor(date.getTime() / 1000);
}

function randomBase64Url(bytes) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64Url(value);
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function encryptionKey(secret) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(secret)));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptSecret(value, secret) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret),
    new TextEncoder().encode(String(value)),
  );
  return bytesToBase64Url(iv) + "." + bytesToBase64Url(new Uint8Array(encrypted));
}

async function decryptSecret(value, secret) {
  const [ivText, encryptedText] = String(value || "").split(".");
  if (!ivText || !encryptedText) throw new HttpError(500, "A stored integration token is invalid.");
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlToBytes(ivText) },
      await encryptionKey(secret),
      base64UrlToBytes(encryptedText),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new HttpError(500, "Silk could not decrypt a stored connection. Reconnect that service.");
  }
}

function readJwtPayload(token) {
  if (!token || typeof token !== "string") return {};
  try {
    const part = token.split(".")[1];
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
  } catch {
    return {};
  }
}

async function getMemories(db) {
  const rows = await db.prepare(
    `SELECT id, category, content, importance, privacy, confidence, source, locked,
            last_accessed_at, created_at, updated_at
     FROM memories ORDER BY importance DESC, updated_at DESC LIMIT 100`,
  ).all();
  return rows.results || [];
}

function selectRelevantMemories(memories, query = "", { limit = 12, characterBudget = 6000 } = {}) {
  const ignored = new Set(["about", "after", "again", "also", "because", "could", "from", "have", "into", "just", "that", "their", "there", "these", "they", "this", "what", "when", "where", "which", "with", "would", "your"]);
  const keywords = normalizeMemoryKey(query).split(" ").filter((word) => word.length >= 3 && !ignored.has(word));
  const ranked = memories.map((memory) => {
    const normalized = normalizeMemoryKey(`${memory.category || ""} ${memory.content || ""}`);
    const hits = keywords.reduce((total, keyword) => total + (normalized.includes(keyword) ? 1 : 0), 0);
    return { ...memory, _score: Number(memory.importance || 3) * 4 + hits * 8 + Number(memory.updated_at || 0) / 10_000_000_000 };
  }).sort((left, right) => right._score - left._score);
  const selected = [];
  let remaining = Math.max(500, Number(characterBudget) || 6000);
  for (const memory of ranked) {
    if (selected.length >= Math.max(1, Number(limit) || 12) || remaining < 80) break;
    const content = String(memory.content || "").slice(0, Math.min(1000, remaining)).trim();
    if (!content) continue;
    selected.push({ ...memory, content });
    delete selected[selected.length - 1]._score;
    remaining -= content.length;
  }
  return selected;
}

async function getRelevantMemories(db, query = "") {
  const rows = await db.prepare(
    `SELECT id, category, content, importance, updated_at FROM memories
     WHERE privacy IN ('public', 'personal') ORDER BY importance DESC, updated_at DESC LIMIT 80`,
  ).all();
  const selected = selectRelevantMemories(rows.results || [], query);
  if (selected.length) {
    const ids = selected.map((memory) => Number(memory.id)).filter(Number.isFinite);
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      await db.prepare(`UPDATE memories SET last_accessed_at = unixepoch() WHERE id IN (${placeholders})`).bind(...ids).run();
    }
  }
  return selected;
}

async function createMemory(request, db) {
  const body = await readJson(request);
  const category = normalizeShortText(body.category || "general", 40, "Memory category");
  const content = normalizeLongText(body.content, 4000, "Memory");
  const importance = clampInteger(body.importance, 1, 5, 3);
  const privacy = normalizeMemoryPrivacy(body.privacy);
  const confidence = clampNumber(body.confidence, 0, 1, 1);
  const locked = body.locked === true ? 1 : 0;
  const memory = await insertMemory(db, category, content, importance, privacy, confidence, "manual", locked);
  await syncMemoryNode(db, memory);
  return json({ memory }, 201);
}

async function insertMemory(db, category, content, importance, privacy = "personal", confidence = 0.8, source = "manual", locked = 0) {
  return db.prepare(
    `INSERT INTO memories (category, content, importance, privacy, confidence, source, locked)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, category, content, importance, privacy, confidence, source, locked,
     last_accessed_at, created_at, updated_at`,
  ).bind(category, content, importance, privacy, confidence, source, locked).first();
}

async function updateMemory(request, db, id) {
  const existing = await db.prepare("SELECT * FROM memories WHERE id = ?").bind(id).first();
  if (!existing) throw new HttpError(404, "That memory no longer exists.");
  const body = await readJson(request);
  const category = body.category === undefined
    ? existing.category
    : normalizeShortText(body.category, 40, "Memory category");
  const content = body.content === undefined
    ? existing.content
    : normalizeLongText(body.content, 4000, "Memory");
  const importance = body.importance === undefined
    ? Number(existing.importance)
    : clampInteger(body.importance, 1, 5, Number(existing.importance));
  const privacy = body.privacy === undefined ? existing.privacy : normalizeMemoryPrivacy(body.privacy);
  const confidence = body.confidence === undefined ? Number(existing.confidence ?? 0.8) : clampNumber(body.confidence, 0, 1, Number(existing.confidence ?? 0.8));
  const locked = body.locked === undefined ? Number(existing.locked || 0) : body.locked === true ? 1 : 0;
  const memory = await db.prepare(
    `UPDATE memories SET category = ?, content = ?, importance = ?, privacy = ?, confidence = ?, locked = ?, updated_at = unixepoch()
     WHERE id = ?
     RETURNING id, category, content, importance, privacy, confidence, source, locked, last_accessed_at, created_at, updated_at`,
  ).bind(category, content, importance, privacy, confidence, locked, id).first();
  await syncMemoryNode(db, memory);
  return json({ memory });
}

async function deleteMemoryRequest(db, id) {
  const node = await db.prepare("SELECT id FROM knowledge_nodes WHERE memory_id = ?").bind(id).first();
  if (node) await db.batch([
    db.prepare("DELETE FROM knowledge_edges WHERE source_node_id = ? OR target_node_id = ?").bind(node.id, node.id),
    db.prepare("DELETE FROM knowledge_nodes WHERE id = ?").bind(node.id),
  ]);
  await db.prepare("DELETE FROM memories WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

function normalizeMemoryPrivacy(value) {
  const privacy = String(value || "personal").trim().toLowerCase();
  return ["public", "personal", "sensitive", "restricted"].includes(privacy) ? privacy : "personal";
}
function normalizeMemoryKey(value) { return String(value || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim(); }
function containsForbiddenSecret(value) { return /\b(?:password|passphrase|api[ _-]?key|secret key|credit card|cvv|bank account|social insurance)\b/i.test(String(value || "")) || /\bsk-[a-zA-Z0-9_-]{12,}\b/.test(String(value || "")); }
function shouldStoreMemoryCandidate(item, explicitRemember = false) {
  const content = safeText(item?.content, 4000).trim();
  if (normalizeMemoryKey(content).length < 8 || containsForbiddenSecret(content)) return false;
  const privacy = normalizeMemoryPrivacy(item?.privacy);
  return explicitRemember || !["sensitive", "restricted"].includes(privacy);
}

async function extractDurableMemories(env, userMessage, assistantMessage) {
  if (!env.OPENAI_API_KEY || containsForbiddenSecret(userMessage)) return;
  const explicitRemember = /\b(?:remember|save this|keep this in mind|don't forget)\b/i.test(userMessage);
  const result = await callAI(env, {
    model: chooseModel(userMessage, "efficient", "memory_extract", env), task: "memory_extract",
    messages: [{ role: "system", content: "Extract only durable facts that improve a private assistant. Never save transient requests, greetings, guesses, passwords, API keys, or financial credentials. Use restricted for facts that must never be injected into a cloud model. Return an empty array when nothing is worth retaining." }, { role: "user", content: `User message:\n${userMessage}\n\nAssistant response:\n${assistantMessage}` }],
    maxTokens: 700, temperature: 0.1, reasoningEffort: "low", verbosity: "low",
    responseFormat: { name: "silk_memory_extraction", schema: MEMORY_EXTRACTION_SCHEMA },
  });
  const parsed = extractJsonObject(result.text) || {};
  const current = await getMemories(env.DB);
  const byKey = new Map(current.map((memory) => [normalizeMemoryKey(memory.content), memory]));
  for (const item of (Array.isArray(parsed.memories) ? parsed.memories.slice(0, 5) : [])) {
    const content = safeText(item?.content, 4000).trim(); const key = normalizeMemoryKey(content);
    if (!shouldStoreMemoryCandidate(item, explicitRemember)) continue;
    const privacy = normalizeMemoryPrivacy(item?.privacy);
    const importance = clampInteger(item?.importance, 1, 5, 3); const confidence = clampNumber(item?.confidence, 0, 1, 0.8);
    const category = safeText(item?.category || "general", 40).trim() || "general";
    let memory = byKey.get(key);
    if (memory) memory = await env.DB.prepare(`UPDATE memories SET importance = MAX(importance, ?), confidence = MAX(confidence, ?), updated_at = unixepoch() WHERE id = ? RETURNING id, category, content, importance, privacy, confidence, source, locked, last_accessed_at, created_at, updated_at`).bind(importance, confidence, memory.id).first();
    else { memory = await insertMemory(env.DB, category, content, importance, privacy, confidence, "conversation", 0); byKey.set(key, memory); }
    await syncMemoryNode(env.DB, memory, item?.entities);
  }
}

async function syncMemoryGraph(db) { for (const memory of await getMemories(db)) await syncMemoryNode(db, memory); }
async function syncMemoryNode(db, memory, entities = []) {
  if (!memory?.id) return;
  const memoryKey = `memory:${memory.id}`;
  await db.prepare(`INSERT INTO knowledge_nodes (node_key,label,node_type,privacy,importance,memory_id,updated_at) VALUES (?,?,'memory',?,?,?,unixepoch()) ON CONFLICT(node_key) DO UPDATE SET label=excluded.label,privacy=excluded.privacy,importance=excluded.importance,updated_at=unixepoch()`).bind(memoryKey, safeText(memory.content, 180), normalizeMemoryPrivacy(memory.privacy), Number(memory.importance || 3), memory.id).run();
  const memoryNode = await db.prepare("SELECT id FROM knowledge_nodes WHERE node_key = ?").bind(memoryKey).first();
  const category = safeText(memory.category || "general", 40).trim().toLowerCase() || "general"; const categoryKey = `category:${normalizeMemoryKey(category)}`;
  await db.prepare(`INSERT INTO knowledge_nodes (node_key,label,node_type,privacy,importance) VALUES (?,?,'category','personal',3) ON CONFLICT(node_key) DO UPDATE SET updated_at=unixepoch()`).bind(categoryKey, category).run();
  const categoryNode = await db.prepare("SELECT id FROM knowledge_nodes WHERE node_key = ?").bind(categoryKey).first();
  if (memoryNode && categoryNode) await db.prepare(`INSERT INTO knowledge_edges (source_node_id,target_node_id,relation,weight) VALUES (?,?,'category',0.8) ON CONFLICT(source_node_id,target_node_id,relation) DO NOTHING`).bind(memoryNode.id, categoryNode.id).run();
  for (const entity of Array.isArray(entities) ? entities.slice(0, 8) : []) {
    const label = safeText(entity?.name, 100).trim(); if (!label) continue; const type = safeText(entity?.type || "entity", 40).trim().toLowerCase() || "entity"; const key = `entity:${type}:${normalizeMemoryKey(label)}`;
    await db.prepare(`INSERT INTO knowledge_nodes (node_key,label,node_type,privacy,importance) VALUES (?,?,?,?,?) ON CONFLICT(node_key) DO UPDATE SET importance=MAX(importance,excluded.importance),updated_at=unixepoch()`).bind(key, label, type, normalizeMemoryPrivacy(memory.privacy), Number(memory.importance || 3)).run();
    const entityNode = await db.prepare("SELECT id FROM knowledge_nodes WHERE node_key = ?").bind(key).first();
    if (memoryNode && entityNode) await db.prepare(`INSERT INTO knowledge_edges (source_node_id,target_node_id,relation,weight) VALUES (?,?,?,0.7) ON CONFLICT(source_node_id,target_node_id,relation) DO NOTHING`).bind(memoryNode.id, entityNode.id, safeText(entity?.relation || "mentions", 60)).run();
  }
}
function focusKnowledgeGraph(nodes, edges, query = "", limit = 48) {
  const nodeById = new Map(nodes.map((node) => [Number(node.id), node]));
  const keywords = normalizeMemoryKey(query).split(" ").filter((word) => word.length >= 2);
  const activation = new Map();
  for (const node of nodes) {
    const label = normalizeMemoryKey(`${node.label || ""} ${node.node_type || ""}`);
    const matches = keywords.length ? keywords.filter((word) => label.includes(word)).length : 0;
    const starting = keywords.length ? (matches ? 1 + matches * 0.4 : 0) : Number(node.importance || 3) / 5;
    if (starting) activation.set(Number(node.id), starting);
  }
  if (keywords.length && !activation.size) return { nodes: [], edges: [] };
  let frontier = new Map(activation);
  for (const decay of [0.58, 0.28]) {
    const next = new Map();
    for (const edge of edges) {
      const source = Number(edge.source), target = Number(edge.target), weight = Math.max(0, Math.min(1, Number(edge.weight || 0.5)));
      if (frontier.has(source)) next.set(target, (next.get(target) || 0) + frontier.get(source) * weight * decay);
      if (frontier.has(target)) next.set(source, (next.get(source) || 0) + frontier.get(target) * weight * decay);
    }
    for (const [id, score] of next) activation.set(id, (activation.get(id) || 0) + score);
    frontier = next;
  }
  const chosen = [...activation.entries()]
    .filter(([id]) => nodeById.has(id))
    .sort((left, right) => {
      const leftNode = nodeById.get(left[0]), rightNode = nodeById.get(right[0]);
      return (right[1] * 10 + Number(rightNode?.importance || 0)) - (left[1] * 10 + Number(leftNode?.importance || 0));
    })
    .slice(0, Math.max(10, Math.min(60, Number(limit) || 48)));
  const chosenIds = new Set(chosen.map(([id]) => id));
  return {
    nodes: chosen.map(([id]) => nodeById.get(id)),
    edges: edges.filter((edge) => chosenIds.has(Number(edge.source)) && chosenIds.has(Number(edge.target))).slice(0, 160),
  };
}

async function getMemoryGraph(db, queryValue, limitValue) {
  await syncMemoryGraph(db);
  const limit = clampInteger(limitValue, 10, 60, 48);
  const query = safeText(queryValue, 100).trim();
  const nodeRows = await db.prepare(`SELECT id,node_key,label,node_type,privacy,importance,memory_id,updated_at FROM knowledge_nodes ORDER BY importance DESC,updated_at DESC LIMIT 240`).all();
  const edgeRows = await db.prepare(`SELECT id,source_node_id AS source,target_node_id AS target,relation,weight FROM knowledge_edges ORDER BY weight DESC,id DESC LIMIT 600`).all();
  const focused = focusKnowledgeGraph(nodeRows.results || [], edgeRows.results || [], query, limit);
  return { ...focused, focus: query || null };
}

async function parseStudyRequest(request, env) {
  requireAIConfiguration(env);
  const body = await readJson(request);
  const source = normalizeLongText(body.source, MAX_STUDY_SOURCE_LENGTH, "Study notes");
  const settings = await getSettings(env.DB);
  const model = chooseModel(source, settings.model_mode, "study_parse", env);
  const messages = [
    {
      role: "system",
      content: `You extract structured study-session records from pasted notes.
Return exactly one valid JSON object with no markdown and these keys:
{
  "course": "string",
  "subject": "string",
  "session_type": "Study session|Quiz|Exam|Comeback exam|Review|Lesson",
  "studied_at": "YYYY-MM-DD or empty string",
  "duration_minutes": number or null,
  "overall_grade": number from 0 to 100 or null,
  "strengths": "concise factual summary",
  "weaknesses": "concise factual summary",
  "next_step": "specific evidence-based recommendation",
  "topics": [
    {
      "topic": "string",
      "score": number from 0 to 100 or null,
      "correct_notes": "string",
      "improvement_notes": "string"
    }
  ]
}
Do not invent grades or facts. Use empty strings or null when information is absent.`,
    },
    { role: "user", content: source },
  ];

  let draft;
  let usedModel = model;
  let provider = model.provider;
  try {
    const result = await callAI(env, {
      model,
      messages,
      task: "study_parse",
      maxTokens: 1200,
      temperature: 0.1,
      reasoningEffort: "medium",
      verbosity: "low",
      responseFormat: {
        name: "silk_study_session",
        schema: STUDY_DRAFT_SCHEMA,
      },
    });
    usedModel = result.model;
    provider = result.provider;
    draft = normalizeStudyDraft(extractJsonObject(result.text), source);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 502) throw error;
    draft = heuristicStudyDraft(source);
  }
  return json({ draft, model: usedModel.label, provider });
}

function extractJsonObject(text) {
  const cleaned = String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new HttpError(502, "Study analysis returned invalid data.");
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new HttpError(502, "Study analysis returned invalid JSON.");
  }
}

function normalizeStudyDraft(value, source = "") {
  const draft = value && typeof value === "object" ? value : {};
  const topics = Array.isArray(draft.topics)
    ? draft.topics.slice(0, 30).map((item) => ({
      topic: safeText(item?.topic, 120) || "Unnamed topic",
      score: optionalGrade(item?.score),
      correct_notes: safeText(item?.correct_notes, 1000),
      improvement_notes: safeText(item?.improvement_notes, 1000),
    }))
    : [];
  return {
    course: safeText(draft.course, 120) || "Pre-Health",
    subject: safeText(draft.subject, 160) || "General study",
    session_type: allowedSessionType(draft.session_type),
    studied_at: normalizeDateString(draft.studied_at),
    duration_minutes: optionalNonnegativeInteger(draft.duration_minutes),
    overall_grade: optionalGrade(draft.overall_grade),
    strengths: safeText(draft.strengths, 3000),
    weaknesses: safeText(draft.weaknesses, 3000),
    next_step: safeText(draft.next_step, 3000),
    topics,
    source_text: String(source || "").slice(0, MAX_STUDY_SOURCE_LENGTH),
  };
}

function heuristicStudyDraft(source) {
  const percentages = [...source.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value >= 0 && value <= 100);
  const durationMatch = source.match(/(\d+)\s*(?:minutes?|mins?)/i);
  const firstLine = source.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "General study";
  return normalizeStudyDraft({
    course: "Pre-Health",
    subject: firstLine.slice(0, 100),
    session_type: /\bexam\b/i.test(source)
      ? "Exam"
      : /\bquiz\b/i.test(source)
        ? "Quiz"
        : "Study session",
    duration_minutes: durationMatch ? Number(durationMatch[1]) : null,
    overall_grade: percentages.length ? percentages[0] : null,
    strengths: "",
    weaknesses: "",
    next_step: "Review the lowest-scoring or least-confident topic before adding new material.",
    topics: [],
  }, source);
}

async function createStudySession(request, env) {
  const db = env.DB;
  const body = await readJson(request);
  const draft = normalizeStudyDraft(body, body.source_text || "");
  if (!draft.subject || (draft.subject === "General study" && !draft.source_text)) {
    throw new HttpError(400, "A study subject or source note is required.");
  }
  const studiedAt = draft.studied_at
    ? Math.floor(new Date(draft.studied_at + "T12:00:00Z").getTime() / 1000)
    : Math.floor(Date.now() / 1000);
  const inserted = await db.prepare(
    `INSERT INTO study_sessions
     (course, subject, session_type, studied_at, duration_minutes, overall_grade,
      strengths, weaknesses, next_step, source_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
  ).bind(
    draft.course,
    draft.subject,
    draft.session_type,
    studiedAt,
    draft.duration_minutes,
    draft.overall_grade,
    draft.strengths,
    draft.weaknesses,
    draft.next_step,
    draft.source_text,
  ).first();
  const sessionId = Number(inserted.id);
  if (draft.topics.length) {
    await db.batch(draft.topics.map((topic) =>
      db.prepare(
        `INSERT INTO study_topics
         (session_id, topic, score, correct_notes, improvement_notes)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        sessionId,
        topic.topic,
        topic.score,
        topic.correct_notes,
        topic.improvement_notes,
      ),
    ));
  }
  let sync = { status: "pending" };
  let session = await getStudySessionById(db, sessionId);
  try {
    const microsoft = await getMicrosoftStatus(env);
    if (microsoft.connected && microsoft.section_id && microsoft.auto_sync) {
      const result = await syncStudySessionToOneNote(env, session);
      sync = { status: "synced", ...result };
      session = await getStudySessionById(db, sessionId);
    }
  } catch (error) {
    sync = { status: "failed", error: safeText(error?.message, 300) };
  }
  return json({ session, onenote: sync }, 201);
}

async function getStudyOverview(db) {
  const sessionRows = await db.prepare(
    `SELECT id, course, subject, session_type, studied_at, duration_minutes,
            overall_grade, strengths, weaknesses, next_step, onenote_page_id,
            onenote_sync_status, onenote_synced_at, onenote_sync_error, created_at
     FROM study_sessions ORDER BY studied_at DESC, id DESC LIMIT 30`,
  ).all();
  const sessions = sessionRows.results || [];
  const topicsBySession = await getTopicsForSessions(db, sessions.map((item) => item.id));
  for (const session of sessions) {
    session.topics = topicsBySession.get(Number(session.id)) || [];
    session.one_note_text = formatOneNoteSession(session);
  }
  const metrics = await db.prepare(
    `SELECT COUNT(*) AS total_sessions,
            ROUND(AVG(overall_grade), 1) AS average_grade,
            COALESCE(SUM(duration_minutes), 0) AS total_minutes
     FROM study_sessions`,
  ).first();
  const weakestTopics = (await db.prepare(
    `SELECT topic, ROUND(AVG(score), 1) AS score, COUNT(*) AS attempts
     FROM study_topics WHERE score IS NOT NULL GROUP BY lower(topic)
     ORDER BY score ASC, attempts DESC LIMIT 8`,
  ).all()).results || [];
  return {
    sessions,
    latest: sessions[0] || null,
    weakest_topics: weakestTopics,
    metrics: {
      total_sessions: Number(metrics?.total_sessions || 0),
      average_grade: metrics?.average_grade === null || metrics?.average_grade === undefined
        ? null
        : Number(metrics.average_grade),
      total_minutes: Number(metrics?.total_minutes || 0),
    },
  };
}

async function getTopicsForSessions(db, sessionIds) {
  const map = new Map();
  if (!sessionIds.length) return map;
  const placeholders = sessionIds.map(() => "?").join(",");
  const rows = await db.prepare(
    `SELECT id, session_id, topic, score, correct_notes, improvement_notes
     FROM study_topics WHERE session_id IN (${placeholders})
     ORDER BY session_id, id`,
  ).bind(...sessionIds).all();
  for (const topic of rows.results || []) {
    const key = Number(topic.session_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(topic);
  }
  return map;
}

async function getStudySessionById(db, id) {
  const session = await db.prepare(
    `SELECT id, course, subject, session_type, studied_at, duration_minutes,
            overall_grade, strengths, weaknesses, next_step, onenote_page_id,
            onenote_sync_status, onenote_synced_at, onenote_sync_error, created_at
     FROM study_sessions WHERE id = ?`,
  ).bind(id).first();
  if (!session) return null;
  const topics = await getTopicsForSessions(db, [id]);
  session.topics = topics.get(Number(id)) || [];
  session.one_note_text = formatOneNoteSession(session);
  return session;
}

async function getLatestStudySession(db) {
  const session = await db.prepare(
    `SELECT id, course, subject, session_type, studied_at, duration_minutes,
            overall_grade, strengths, weaknesses, next_step
     FROM study_sessions ORDER BY studied_at DESC, id DESC LIMIT 1`,
  ).first();
  if (!session) return null;
  const topics = await getTopicsForSessions(db, [session.id]);
  session.topics = topics.get(Number(session.id)) || [];
  return session;
}

async function getLatestStudyContext(db) {
  const latest = await getLatestStudySession(db);
  return latest ? describeStudySession(latest) : "";
}

function describeStudySession(session) {
  const pieces = [
    session.subject + " (" + session.session_type + ")",
    session.overall_grade === null || session.overall_grade === undefined
      ? ""
      : "overall grade " + Number(session.overall_grade).toFixed(Number(session.overall_grade) % 1 ? 1 : 0) + "%",
    session.strengths ? "strengths: " + session.strengths : "",
    session.weaknesses ? "weaknesses: " + session.weaknesses : "",
    session.next_step ? "recommended next step: " + session.next_step : "",
  ].filter(Boolean);
  return pieces.join(". ") + ".";
}

function formatOneNoteSession(session) {
  const date = new Date(Number(session.studied_at) * 1000).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const lines = [
    session.course + " — " + session.subject,
    date + " · " + session.session_type,
  ];
  if (session.duration_minutes !== null && session.duration_minutes !== undefined) {
    lines.push("Duration: " + session.duration_minutes + " minutes");
  }
  if (session.overall_grade !== null && session.overall_grade !== undefined) {
    lines.push("Overall grade: " + session.overall_grade + "%");
  }
  if (session.strengths) lines.push("\nWhat went well\n" + session.strengths);
  if (session.weaknesses) lines.push("\nNeeds improvement\n" + session.weaknesses);
  if (session.topics?.length) {
    lines.push("\nTopic breakdown");
    for (const topic of session.topics) {
      const score = topic.score === null || topic.score === undefined ? "" : " — " + topic.score + "%";
      lines.push("• " + topic.topic + score);
      if (topic.correct_notes) lines.push("  Correct: " + topic.correct_notes);
      if (topic.improvement_notes) lines.push("  Improve: " + topic.improvement_notes);
    }
  }
  if (session.next_step) lines.push("\nNext recommendation\n" + session.next_step);
  return lines.join("\n");
}

async function startWorkoutRequest(request, db) {
  const body = await readJson(request);
  const name = normalizeShortText(body.name || "Workout", 100, "Workout name");
  const session = await startWorkout(db, name);
  return json({ session }, session.created ? 201 : 200);
}

async function startWorkout(db, name) {
  const active = await getActiveWorkout(db);
  if (active) return { ...active, created: false };
  const session = await db.prepare(
    `INSERT INTO workout_sessions (name)
     VALUES (?) RETURNING id, name, started_at, ended_at, notes`,
  ).bind(name).first();
  return { ...session, created: true };
}

async function logWorkoutSetRequest(request, db) {
  const body = await readJson(request);
  const active = body.workout_id
    ? await db.prepare("SELECT * FROM workout_sessions WHERE id = ? AND ended_at IS NULL")
      .bind(Number(body.workout_id)).first()
    : await getActiveWorkout(db);
  if (!active) throw new HttpError(409, "Start a workout before logging a set.");
  const result = await logWorkoutSet(db, {
    workoutId: Number(active.id),
    exerciseName: normalizeShortText(body.exercise_name, 140, "Exercise"),
    weight: optionalNonnegativeNumber(body.weight),
    reps: optionalNonnegativeInteger(body.reps),
    rpe: body.rpe === "" || body.rpe === null || body.rpe === undefined
      ? null
      : clampNumber(body.rpe, 0, 10, null),
    isWarmup: Boolean(body.is_warmup),
  });
  return json(result, 201);
}

async function logWorkoutSet(db, data) {
  const previousNumber = await db.prepare(
    "SELECT COALESCE(MAX(set_number), 0) AS max_set FROM exercise_sets WHERE workout_id = ? AND lower(exercise_name) = lower(?)",
  ).bind(data.workoutId, data.exerciseName).first();
  const setNumber = Number(previousNumber?.max_set || 0) + 1;
  const bestPrior = await db.prepare(
    `SELECT weight, reps, rpe,
            (COALESCE(weight, 0) * (1 + COALESCE(reps, 0) / 30.0)) AS estimated_one_rm
     FROM exercise_sets
     WHERE lower(exercise_name) = lower(?) AND is_warmup = 0
     ORDER BY estimated_one_rm DESC, id DESC LIMIT 1`,
  ).bind(data.exerciseName).first();

  const workoutSet = await db.prepare(
    `INSERT INTO exercise_sets
     (workout_id, exercise_name, set_number, weight, reps, rpe, is_warmup)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING id, workout_id, exercise_name, set_number, weight, reps, rpe, is_warmup, created_at`,
  ).bind(
    data.workoutId,
    data.exerciseName,
    setNumber,
    data.weight,
    data.reps,
    data.rpe,
    data.isWarmup ? 1 : 0,
  ).first();

  const currentE1RM = !data.isWarmup && Number.isFinite(data.weight) && Number.isFinite(data.reps)
    ? data.weight * (1 + data.reps / 30)
    : null;
  const priorE1RM = bestPrior ? Number(bestPrior.estimated_one_rm || 0) : null;
  const isPr = currentE1RM !== null && (!priorE1RM || currentE1RM > priorE1RM + 0.01);
  const recommendation = workoutRecommendation(data, bestPrior);
  const summary = data.exerciseName + " set " + setNumber + " saved: " +
    (data.weight ?? 0) + " lb × " + (data.reps ?? 0) +
    (data.rpe === null ? "" : " at RPE " + data.rpe) +
    (data.isWarmup ? " (warm-up)." : ".") +
    (isPr ? " That is a new estimated PR. " : " ") +
    recommendation;
  return { set: workoutSet, is_pr: isPr, recommendation, summary };
}

function workoutRecommendation(data, previous) {
  if (data.isWarmup) {
    if (previous?.weight !== null && previous?.weight !== undefined) {
      return "Your best recent working set was " + previous.weight + " lb × " + previous.reps +
        (previous.rpe === null || previous.rpe === undefined ? "" : " at RPE " + previous.rpe) +
        ". Use that history to select the first working set.";
    }
    return "No previous working set is stored for this exercise yet. Choose a controlled first working weight.";
  }
  if (data.rpe !== null && data.rpe <= 7 && Number(data.reps) >= 8) {
    return "The set had at least three reps in reserve. A small weight increase on the next set is reasonable if technique stayed clean.";
  }
  if (data.rpe !== null && data.rpe >= 9.5) {
    return "That set was at or near failure. Repeat or slightly reduce the weight rather than forcing an increase.";
  }
  if (data.rpe !== null) {
    return "The effort was in a productive range. Repeat the weight unless your target rep range calls for progression.";
  }
  return "Add an RPE next time so I can make a more precise progression recommendation.";
}

async function finishWorkoutRequest(request, db) {
  const body = await readJson(request);
  const finished = body.workout_id
    ? await db.prepare(
      `UPDATE workout_sessions SET ended_at = unixepoch()
       WHERE id = ? AND ended_at IS NULL
       RETURNING id, name, started_at, ended_at, notes`,
    ).bind(Number(body.workout_id)).first()
    : await finishActiveWorkout(db);
  if (!finished) throw new HttpError(404, "There is no active workout to finish.");
  return json({ session: finished });
}

async function finishActiveWorkout(db) {
  const active = await getActiveWorkout(db);
  if (!active) return null;
  return db.prepare(
    `UPDATE workout_sessions SET ended_at = unixepoch()
     WHERE id = ? RETURNING id, name, started_at, ended_at, notes`,
  ).bind(active.id).first();
}

async function getActiveWorkout(db) {
  return db.prepare(
    `SELECT id, name, started_at, ended_at, notes
     FROM workout_sessions WHERE ended_at IS NULL
     ORDER BY id DESC LIMIT 1`,
  ).first();
}

async function getWorkoutOverview(db) {
  const active = await getActiveWorkout(db);
  const activeSets = active
    ? (await db.prepare(
      `SELECT id, workout_id, exercise_name, set_number, weight, reps, rpe, is_warmup, created_at
       FROM exercise_sets WHERE workout_id = ? ORDER BY id DESC LIMIT 40`,
    ).bind(active.id).all()).results || []
    : [];
  const recentSessions = (await db.prepare(
    `SELECT ws.id, ws.name, ws.started_at, ws.ended_at, ws.notes,
            COUNT(es.id) AS set_count
     FROM workout_sessions ws
     LEFT JOIN exercise_sets es ON es.workout_id = ws.id
     GROUP BY ws.id
     ORDER BY ws.started_at DESC, ws.id DESC LIMIT 12`,
  ).all()).results || [];
  const prs = (await db.prepare(
    `SELECT exercise_name,
            ROUND(MAX(COALESCE(weight, 0) * (1 + COALESCE(reps, 0) / 30.0)), 1) AS estimated_one_rm,
            MAX(weight) AS heaviest_weight
     FROM exercise_sets
     WHERE is_warmup = 0 AND weight IS NOT NULL AND reps IS NOT NULL
     GROUP BY lower(exercise_name)
     ORDER BY estimated_one_rm DESC LIMIT 20`,
  ).all()).results || [];
  return { active, active_sets: activeSets, recent_sessions: recentSessions, prs };
}

async function getCurrentWorkoutContext(db) {
  const active = await getActiveWorkout(db);
  if (!active) return "";
  const sets = (await db.prepare(
    `SELECT exercise_name, set_number, weight, reps, rpe, is_warmup
     FROM exercise_sets WHERE workout_id = ?
     ORDER BY id DESC LIMIT 10`,
  ).bind(active.id).all()).results || [];
  const setText = sets.length ? sets.reverse().map(formatSet).join("; ") : "no sets logged";
  return active.name + " is active. Logged sets: " + setText + ".";
}

function formatSet(item) {
  return item.exercise_name + " set " + item.set_number + ": " +
    (item.weight ?? 0) + " lb × " + (item.reps ?? 0) +
    (item.rpe === null || item.rpe === undefined ? "" : " @ RPE " + item.rpe) +
    (Number(item.is_warmup) ? " warm-up" : "");
}

async function getSettings(db) {
  const rows = await db.prepare("SELECT key, value FROM settings").all();
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows.results || []) {
    if (Object.hasOwn(DEFAULT_SETTINGS, row.key)) settings[row.key] = String(row.value);
  }
  return settings;
}

async function updateSettings(request, db) {
  const body = await readJson(request);
  const current = await getSettings(db);
  const next = {
    owner_name: body.owner_name === undefined
      ? current.owner_name
      : normalizeShortText(body.owner_name, 60, "Owner name"),
    assistant_name: "Silk",
    model_mode: ["efficient", "automatic", "best"].includes(body.model_mode)
      ? body.model_mode
      : current.model_mode,
    response_length: ["concise", "balanced", "detailed"].includes(body.response_length)
      ? body.response_length
      : current.response_length,
    monthly_budget_cad: body.monthly_budget_cad === undefined
      ? current.monthly_budget_cad
      : String(clampNumber(body.monthly_budget_cad, 0, 25, 2)),
    facts_first: "true",
    home_city: body.home_city === undefined
      ? current.home_city
      : normalizeShortText(body.home_city, 200, "Home city"),
    time_zone: body.time_zone === undefined
      ? current.time_zone
      : normalizeShortText(body.time_zone, 80, "Time zone"),
    temperature_unit: ["celsius", "fahrenheit"].includes(body.temperature_unit)
      ? body.temperature_unit
      : current.temperature_unit,
    morning_brief_enabled: body.morning_brief_enabled === false || body.morning_brief_enabled === "false"
      ? "false"
      : "true",
  };
  await db.batch(Object.entries(next).map(([key, value]) =>
    db.prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, unixepoch())
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`,
    ).bind(key, String(value)),
  ));
  return json({ settings: next });
}

async function getUsageSummary(db, env = {}) {
  const start = startOfCurrentUtcMonth();
  const totals = await db.prepare(
    `SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(neurons), 0) AS neurons,
            COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd,
            COALESCE(AVG(latency_ms), 0) AS average_latency_ms,
            COUNT(*) AS requests
     FROM usage_events WHERE created_at >= ?`,
  ).bind(start).first();
  const providerRows = (await db.prepare(
    `SELECT provider,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(neurons), 0) AS neurons,
            COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd,
            COALESCE(AVG(latency_ms), 0) AS average_latency_ms,
            COUNT(*) AS requests
     FROM usage_events
     WHERE created_at >= ?
     GROUP BY provider`,
  ).bind(start).all()).results || [];
  const daily = (await db.prepare(
    `SELECT date(created_at, 'unixepoch') AS day,
            ROUND(SUM(neurons), 1) AS neurons,
            ROUND(SUM(CASE WHEN provider = 'openai' THEN estimated_cost_usd ELSE 0 END), 6) AS openai_cost_usd,
            COUNT(*) AS requests
     FROM usage_events
     WHERE created_at >= ?
     GROUP BY date(created_at, 'unixepoch')
     ORDER BY day DESC LIMIT 31`,
  ).bind(start).all()).results || [];
  const providers = {};
  for (const row of providerRows) {
    providers[row.provider] = {
      input_tokens: Number(row.input_tokens || 0),
      cached_input_tokens: Number(row.cached_input_tokens || 0),
      output_tokens: Number(row.output_tokens || 0),
      neurons: roundNumber(row.neurons || 0, 1),
      estimated_cost_usd: roundNumber(row.estimated_cost_usd || 0, 6),
      average_latency_ms: Math.round(Number(row.average_latency_ms || 0)),
      requests: Number(row.requests || 0),
    };
  }
  const openaiSpend = Number(providers.openai?.estimated_cost_usd || 0);
  const limit = openAISpendLimitUsd(env, false);
  const totalEquivalentUsd = Number(totals?.estimated_cost_usd || 0);
  return {
    input_tokens: Number(totals?.input_tokens || 0),
    cached_input_tokens: Number(totals?.cached_input_tokens || 0),
    output_tokens: Number(totals?.output_tokens || 0),
    neurons: roundNumber(totals?.neurons || 0, 1),
    estimated_cost_usd: roundNumber(totalEquivalentUsd, 6),
    estimated_cost_cad: roundNumber(openaiSpend * CAD_PER_USD, 4),
    paid_cost_usd: roundNumber(openaiSpend, 6),
    paid_cost_cad: roundNumber(openaiSpend * CAD_PER_USD, 4),
    openai_spend_limit_usd: roundNumber(limit, 2),
    openai_remaining_usd: roundNumber(Math.max(0, limit - openaiSpend), 6),
    openai_limit_percent: limit > 0 ? roundNumber(Math.min(100, openaiSpend / limit * 100), 2) : 0,
    average_latency_ms: Math.round(Number(totals?.average_latency_ms || 0)),
    requests: Number(totals?.requests || 0),
    providers,
    daily,
    free_daily_neurons: 10000,
  };
}

function startOfCurrentUtcMonth() {
  const now = new Date();
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
}

function normalizeMessage(value) {
  if (typeof value !== "string") throw new HttpError(400, "A message is required.");
  const message = value.replace(/\u0000/g, "").trim();
  if (!message) throw new HttpError(400, "A message is required.");
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new HttpError(413, "Messages must be " + MAX_MESSAGE_LENGTH + " characters or fewer.");
  }
  return message;
}

function normalizeShortText(value, maxLength, label) {
  if (typeof value !== "string") throw new HttpError(400, label + " is required.");
  const text = value.replace(/\u0000/g, "").trim();
  if (!text) throw new HttpError(400, label + " is required.");
  if (text.length > maxLength) throw new HttpError(413, label + " is too long.");
  return text;
}

function normalizeLongText(value, maxLength, label) {
  return normalizeShortText(value, maxLength, label);
}

function safeText(value, maxLength) {
  return typeof value === "string"
    ? value.replace(/\u0000/g, "").trim().slice(0, maxLength)
    : "";
}

function optionalGrade(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace("%", "").trim());
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : null;
}

function optionalNonnegativeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number);
}

function optionalNonnegativeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new HttpError(400, "Weight must be zero or greater.");
  }
  return number;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    if (fallback === null) throw new HttpError(400, "A numeric value is invalid.");
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function roundNumber(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}

function allowedSessionType(value) {
  const options = ["Study session", "Quiz", "Exam", "Comeback exam", "Review", "Lesson"];
  const normalized = safeText(value, 40);
  return options.find((item) => item.toLowerCase() === normalized.toLowerCase()) || "Study session";
}

function normalizeDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return Number.isNaN(new Date(value + "T12:00:00Z").getTime()) ? "" : value;
}

function trimHistory(messages) {
  const kept = [];
  let characters = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string") continue;
    characters += item.content.length;
    if (characters > 16000) break;
    kept.unshift({ role: item.role, content: item.content });
  }
  return kept;
}

function extractAIText(result) {
  let text = "";
  if (typeof result === "string") text = result;
  else if (result && typeof result.response === "string") text = result.response;
  else if (result && typeof result.result?.response === "string") text = result.result.response;
  else if (Array.isArray(result?.choices)) {
    text = result.choices[0]?.message?.content || result.choices[0]?.text || "";
  }
  return String(text).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_REQUEST_BODY) throw new HttpError(413, "The request is too large.");
  const raw = await request.text();
  if (raw.length > MAX_REQUEST_BODY) throw new HttpError(413, "The request is too large.");
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new HttpError(400, "The request must contain valid JSON.");
  }
}

function isMutationMethod(method) {
  return ["POST", "PATCH", "PUT", "DELETE"].includes(method);
}

function requireSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new HttpError(403, "Cross-site requests are not allowed.");
  }
}

async function requireAuthorization(request, env) {
  if (!(await isAuthorized(request, env))) throw new HttpError(401, "Please sign in again.");
}

async function isAuthorized(request, env) {
  if (!env.APP_PASSWORD) return false;
  const token = parseCookies(request.headers.get("Cookie") || "")[SESSION_COOKIE];
  return verifySessionToken(token, env.APP_PASSWORD);
}

function parseCookies(header) {
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

async function createSessionToken(password) {
  const now = Math.floor(Date.now() / 1000);
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const payload = base64UrlEncode(JSON.stringify({
    sub: "owner",
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    nonce: bytesToBase64Url(nonceBytes),
  }));
  const signature = await sign(payload, password);
  return payload + "." + bytesToBase64Url(signature);
}

async function verifySessionToken(token, password) {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  try {
    if (!constantTimeEqual(base64UrlToBytes(parts[1]), await sign(parts[0], password))) return false;
    const parsed = JSON.parse(base64UrlDecode(parts[0]));
    return parsed.sub === "owner" && Number(parsed.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function sign(payload, password) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest("SHA-256", encoder.encode("silk-session-v2:" + password));
  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

async function securePasswordMatch(provided, expected) {
  const encoder = new TextEncoder();
  const hashes = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode("silk-password-v2:" + provided)),
    crypto.subtle.digest("SHA-256", encoder.encode("silk-password-v2:" + expected)),
  ]);
  return constantTimeEqual(new Uint8Array(hashes[0]), new Uint8Array(hashes[1]));
}

function constantTimeEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function loginIdentifier(request, password) {
  const address = request.headers.get("CF-Connecting-IP") || "unknown";
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("silk-login-v2:" + password + ":" + address),
  );
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function isLoginBlocked(db, identifier) {
  try {
    const row = await db.prepare(
      "SELECT attempts, window_start FROM login_attempts WHERE identifier = ?",
    ).bind(identifier).first();
    if (!row) return false;
    const now = Math.floor(Date.now() / 1000);
    if (now - Number(row.window_start) >= LOGIN_WINDOW_SECONDS) {
      await db.prepare("DELETE FROM login_attempts WHERE identifier = ?").bind(identifier).run();
      return false;
    }
    return Number(row.attempts) >= LOGIN_ATTEMPT_LIMIT;
  } catch (error) {
    console.error("Login rate-limit lookup failed", error);
    return false;
  }
}

async function recordFailedLogin(db, identifier) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const row = await db.prepare(
      "SELECT attempts, window_start FROM login_attempts WHERE identifier = ?",
    ).bind(identifier).first();
    if (!row || now - Number(row.window_start) >= LOGIN_WINDOW_SECONDS) {
      await db.prepare(
        `INSERT INTO login_attempts (identifier, attempts, window_start)
         VALUES (?, 1, ?)
         ON CONFLICT(identifier) DO UPDATE SET attempts = 1, window_start = excluded.window_start`,
      ).bind(identifier, now).run();
      return;
    }
    await db.prepare(
      "UPDATE login_attempts SET attempts = attempts + 1 WHERE identifier = ?",
    ).bind(identifier).run();
  } catch (error) {
    console.error("Could not record failed login", error);
  }
}

async function clearLoginAttempts(db, identifier) {
  try {
    await db.prepare("DELETE FROM login_attempts WHERE identifier = ?").bind(identifier).run();
  } catch (error) {
    console.error("Could not clear login attempts", error);
  }
}

function sessionCookie(token) {
  return SESSION_COOKIE + "=" + token +
    "; Path=/; Max-Age=" + SESSION_TTL_SECONDS + "; HttpOnly; Secure; SameSite=Lax";
}

function expiredSessionCookie() {
  return SESSION_COOKIE + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
}

function base64UrlEncode(text) {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

function base64UrlDecode(text) {
  return new TextDecoder().decode(base64UrlToBytes(text));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(text) {
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function json(data, status = 200, additionalHeaders = {}, contentType = "application/json; charset=utf-8") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      ...additionalHeaders,
    },
  });
}

function withCommonHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function contentSecurityPolicy() {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class ProviderError extends HttpError {
  constructor(status, message, options = {}) {
    super(status, message);
    this.provider = options.provider || "";
    this.code = options.code || "provider_error";
    this.retryable = Boolean(options.retryable);
    this.allowFallback = Boolean(options.allowFallback);
    this.requestId = options.requestId || "";
  }
}

const APP_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#081523">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="description" content="Silk, a private cloud-first personal assistant.">
  <title>Silk · Personal Assistant</title>
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
  <div class="ambient ambient-one" aria-hidden="true"></div>
  <div class="ambient ambient-two" aria-hidden="true"></div>

  <main id="login-view" class="login-view hidden">
    <section class="login-panel" aria-labelledby="login-title">
      <div class="login-mark" aria-hidden="true"><span></span></div>
      <p class="overline">PRIVATE ASSISTANT · SILK V0.3</p>
      <h1 id="login-title">Welcome back.</h1>
      <p class="login-copy">Your conversations, study records and workout history remain behind your private passphrase.</p>
      <form id="login-form" class="login-form">
        <label for="password">Passphrase</label>
        <div class="field-row">
          <input id="password" name="password" type="password" autocomplete="current-password" required>
          <button type="submit" class="primary-button">Unlock Silk</button>
        </div>
      </form>
      <p id="login-error" class="form-error" role="alert"></p>
      <p id="setup-message" class="setup-message hidden">The APP_PASSWORD secret still needs to be added in Cloudflare.</p>
      <div class="login-foot">
        <span><i class="status-dot"></i> Cloudflare online</span>
        <span>Encrypted session</span>
      </div>
    </section>
  </main>

  <div id="app-view" class="app-view hidden">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"><span></span></div>
        <div>
          <strong>SILK</strong>
          <small>Personal intelligence</small>
        </div>
      </div>

      <nav class="side-nav" aria-label="Primary navigation">
        <button class="nav-button active" type="button" data-page="chat">
          <span class="nav-glyph">⌁</span><span>Chat</span>
        </button>
        <button class="nav-button" type="button" data-page="study">
          <span class="nav-glyph">◫</span><span>Study</span><b id="study-nav-count">0</b>
        </button>
        <button class="nav-button" type="button" data-page="workouts">
          <span class="nav-glyph">◇</span><span>Workouts</span>
        </button>
        <button class="nav-button" type="button" data-page="projects">
          <span class="nav-glyph">▱</span><span>Projects</span><b id="project-nav-count">0</b>
        </button>
        <button class="nav-button" type="button" data-page="calendar">
          <span class="nav-glyph">□</span><span>Calendar</span>
        </button>
        <button class="nav-button" type="button" data-page="memory">
          <span class="nav-glyph">◎</span><span>Memory</span><b id="memory-nav-count">0</b>
        </button>
        <button class="nav-button" type="button" data-page="settings">
          <span class="nav-glyph">⛭</span><span>Settings</span>
        </button>
      </nav>

      <div class="sidebar-status">
        <div class="status-heading"><span>System</span><span class="online-label">Online</span></div>
        <div class="quota-line"><span id="sidebar-neurons">0 neurons</span><span>10k/day</span></div>
        <div class="quota-track"><i id="sidebar-quota-fill"></i></div>
        <small>Free development allowance</small>
      </div>

      <button id="logout" class="lock-button" type="button">
        <span>⌁</span> Lock Silk
      </button>
    </aside>

    <div class="workspace">
      <header class="mobile-header">
        <div class="brand compact">
          <div class="brand-mark" aria-hidden="true"><span></span></div>
          <div><strong>SILK</strong><small id="mobile-status">Online</small></div>
        </div>
        <button id="mobile-lock" class="small-button" type="button">Lock</button>
      </header>

      <section id="page-chat" class="page page-chat active" data-page-panel="chat">
        <header class="page-header chat-header">
          <div>
            <p class="overline" id="today-label">PERSONAL ASSISTANT</p>
            <h2 id="greeting">Good evening, Jaed.</h2>
          </div>
          <div class="header-actions">
            <span class="model-pill" id="current-model-pill"><i></i> Automatic routing</span>
            <button id="voice-toggle" class="small-button" type="button" aria-pressed="false">Voice off</button>
          </div>
        </header>

        <div id="context-strip" class="context-strip" aria-label="Current context"></div>

        <div id="messages" class="messages" aria-live="polite"></div>
        <div id="typing" class="typing hidden" aria-label="Silk is thinking">
          <div class="typing-orb"></div><span></span><span></span><span></span>
        </div>
        <p id="chat-error" class="form-error chat-error" role="alert"></p>

        <div class="quick-actions" aria-label="Quick actions">
          <button type="button" data-quick-message="Give me a short briefing using my latest saved study and workout information.">Morning briefing</button>
          <button type="button" data-page-jump="study">Save study session</button>
          <button type="button" data-page-jump="calendar">Open calendar</button>
          <button type="button" data-page-jump="projects">Open projects</button>
          <button type="button" data-quick-message="What should I focus on next based on my saved records?">What’s next?</button>
        </div>

        <form id="chat-form" class="composer">
          <button id="mic" class="composer-tool hidden" type="button" aria-label="Speak a message">◉</button>
          <button id="web-search-toggle" class="composer-tool web-tool" type="button" aria-label="Search the web with this message" aria-pressed="false" title="Force web search">⌕</button>
          <textarea id="message" rows="1" maxlength="4000" placeholder="Message Silk…" required></textarea>
          <button id="send" class="send-button" type="submit" aria-label="Send message">↑</button>
        </form>
        <p id="composer-caption" class="composer-caption">Silk uses your private records and can search the web when connected.</p>
      </section>

      <section id="page-study" class="page scroll-page" data-page-panel="study">
        <header class="page-header">
          <div><p class="overline">LEARNING INTELLIGENCE</p><h2>Study</h2></div>
          <button class="primary-button compact-button" type="button" data-focus-study>Import session</button>
        </header>

        <div id="study-metrics" class="metric-grid"></div>

        <div class="split-layout study-layout">
          <article class="panel import-panel">
            <div class="panel-heading">
              <div><p class="overline">NEW RECORD</p><h3>Import a study recap</h3></div>
              <span class="feature-tag">AI structured</span>
            </div>
            <p class="panel-copy">Paste the recap from a ChatGPT lesson, quiz or comeback exam. Silk will extract your grade, strengths, weak areas and next recommendation.</p>
            <form id="study-import-form">
              <label for="study-source">Session notes</label>
              <textarea id="study-source" class="large-textarea" rows="9" maxlength="30000" placeholder="Paste the complete study recap here…" required></textarea>
              <div class="form-actions">
                <span id="study-parser-model">Uses the best free reasoning model</span>
                <button id="analyze-study" class="primary-button" type="submit">Analyze notes</button>
              </div>
            </form>
            <p id="study-error" class="form-error" role="alert"></p>
          </article>

          <aside id="study-focus-card" class="panel focus-panel"></aside>
        </div>

        <article id="study-review" class="panel review-panel hidden">
          <div class="panel-heading">
            <div><p class="overline">CONFIRM BEFORE SAVING</p><h3>Review Silk’s extraction</h3></div>
            <button id="cancel-study-review" class="ghost-button" type="button">Cancel</button>
          </div>
          <form id="study-review-form">
            <div class="form-grid three">
              <div><label for="review-course">Course</label><input id="review-course" required></div>
              <div><label for="review-subject">Subject</label><input id="review-subject" required></div>
              <div>
                <label for="review-type">Session type</label>
                <select id="review-type">
                  <option>Study session</option><option>Quiz</option><option>Exam</option>
                  <option>Comeback exam</option><option>Review</option><option>Lesson</option>
                </select>
              </div>
              <div><label for="review-date">Date</label><input id="review-date" type="date"></div>
              <div><label for="review-duration">Minutes</label><input id="review-duration" type="number" min="0"></div>
              <div><label for="review-grade">Overall grade %</label><input id="review-grade" type="number" min="0" max="100" step="0.1"></div>
            </div>
            <div class="form-grid">
              <div><label for="review-strengths">What went well</label><textarea id="review-strengths" rows="4"></textarea></div>
              <div><label for="review-weaknesses">Needs improvement</label><textarea id="review-weaknesses" rows="4"></textarea></div>
            </div>
            <label for="review-next">Next recommendation</label>
            <textarea id="review-next" rows="3"></textarea>
            <div id="review-topics" class="topic-preview"></div>
            <div class="form-actions">
              <span>Nothing is saved until you confirm.</span>
              <button class="primary-button" type="submit">Save study session</button>
            </div>
          </form>
        </article>

        <div class="section-heading">
          <div><p class="overline">HISTORY</p><h3>Recent study sessions</h3></div>
          <span id="study-history-label"></span>
        </div>
        <div id="study-list" class="record-list"></div>
      </section>

      <section id="page-workouts" class="page scroll-page" data-page-panel="workouts">
        <header class="page-header">
          <div><p class="overline">TRAINING INTELLIGENCE</p><h2>Workouts</h2></div>
          <span class="model-pill"><i></i> Progression tracked</span>
        </header>

        <div id="workout-state"></div>

        <div class="split-layout workout-layout">
          <article class="panel">
            <div class="panel-heading">
              <div><p class="overline">CURRENT SESSION</p><h3 id="workout-form-title">Start a workout</h3></div>
              <span id="workout-live-tag" class="feature-tag muted-tag">Not active</span>
            </div>
            <form id="workout-start-form">
              <label for="workout-name">Workout name</label>
              <div class="inline-form">
                <input id="workout-name" placeholder="Push, legs, upper body…" required>
                <button class="primary-button" type="submit">Start</button>
              </div>
            </form>
            <form id="workout-set-form" class="hidden">
              <div class="form-grid workout-fields">
                <div class="wide-field"><label for="exercise-name">Exercise</label><input id="exercise-name" placeholder="Incline dumbbell press" required></div>
                <div><label for="set-weight">Weight lb</label><input id="set-weight" type="number" min="0" step="0.5" required></div>
                <div><label for="set-reps">Reps</label><input id="set-reps" type="number" min="0" required></div>
                <div><label for="set-rpe">RPE</label><input id="set-rpe" type="number" min="0" max="10" step="0.5" placeholder="8"></div>
              </div>
              <div class="form-actions workout-actions">
                <label class="check-label"><input id="set-warmup" type="checkbox"> Warm-up set</label>
                <div>
                  <button id="finish-workout" class="ghost-button danger-button" type="button">Finish workout</button>
                  <button class="primary-button" type="submit">Log set</button>
                </div>
              </div>
            </form>
            <p id="workout-error" class="form-error" role="alert"></p>
            <div id="set-recommendation" class="recommendation hidden"></div>
          </article>

          <aside class="panel">
            <div class="panel-heading"><div><p class="overline">PERSONAL RECORDS</p><h3>Estimated strength</h3></div></div>
            <div id="pr-list" class="pr-list"></div>
          </aside>
        </div>

        <div class="section-heading"><div><p class="overline">RECENT</p><h3>Workout history</h3></div></div>
        <div id="workout-history" class="record-list compact-records"></div>
      </section>

      <section id="page-projects" class="page scroll-page" data-page-panel="projects">
        <header class="page-header">
          <div><p class="overline">PRIVATE EXECUTION</p><h2>Projects</h2></div>
          <span class="model-pill"><i></i> Stored only in Silk</span>
        </header>

        <div id="project-metrics" class="metric-grid"></div>

        <div class="split-layout project-layout">
          <article class="panel">
            <div class="panel-heading">
              <div><p class="overline">NEW PROJECT</p><h3>Define the outcome</h3></div>
              <span class="feature-tag">Private D1</span>
            </div>
            <form id="project-form">
              <label for="project-name">Project name</label>
              <input id="project-name" maxlength="160" placeholder="Finish anatomy study system" required>
              <div class="form-grid">
                <div>
                  <label for="project-priority">Priority</label>
                  <select id="project-priority">
                    <option value="5">5 · Critical</option><option value="4">4 · High</option>
                    <option value="3" selected>3 · Normal</option><option value="2">2 · Low</option>
                    <option value="1">1 · Someday</option>
                  </select>
                </div>
                <div><label for="project-due">Due date</label><input id="project-due" type="date"></div>
              </div>
              <label for="project-description">Outcome or notes</label>
              <textarea id="project-description" rows="4" maxlength="4000" placeholder="What does finished look like?"></textarea>
              <div class="form-actions">
                <span>No external project service is used.</span>
                <button class="primary-button" type="submit">Create project</button>
              </div>
            </form>
            <p id="project-error" class="form-error" role="alert"></p>
          </article>

          <aside class="panel memory-guide">
            <p class="overline">HOW SILK USES THIS</p>
            <h3>Real unfinished-work context.</h3>
            <p>Silk can read these projects during chat, report what remains, and keep tasks current without sending the project list to another productivity service.</p>
            <ul>
              <li>Ask “What projects are unfinished?”</li>
              <li>Say “Create project called …”</li>
              <li>Complete tasks here as the source of truth.</li>
            </ul>
          </aside>
        </div>

        <div class="section-heading">
          <div><p class="overline">WORKSPACE</p><h3>Tracked projects</h3></div>
          <select id="project-filter" aria-label="Filter projects">
            <option value="open">Open</option><option value="all">All</option>
            <option value="active">Active</option><option value="paused">Paused</option>
            <option value="completed">Completed</option><option value="archived">Archived</option>
          </select>
        </div>
        <div id="project-list" class="project-list"></div>
      </section>

      <section id="page-calendar" class="page scroll-page" data-page-panel="calendar">
        <header class="page-header">
          <div><p class="overline">LIVE SCHEDULE</p><h2>Google Calendar</h2></div>
          <span id="calendar-status-pill" class="model-pill"><i></i> Not connected</span>
        </header>

        <article id="calendar-connection" class="panel connection-panel"></article>

        <div id="calendar-workspace" class="hidden">
          <div class="split-layout calendar-layout">
            <article class="panel">
              <div class="panel-heading">
                <div><p class="overline">NEW EVENT</p><h3>Add to your primary calendar</h3></div>
                <span class="feature-tag">Confirmation required</span>
              </div>
              <form id="calendar-event-form">
                <label for="calendar-title">Event title</label>
                <input id="calendar-title" maxlength="200" required>
                <div class="form-grid">
                  <div><label for="calendar-start">Starts</label><input id="calendar-start" type="datetime-local" required></div>
                  <div><label for="calendar-end">Ends</label><input id="calendar-end" type="datetime-local" required></div>
                </div>
                <label for="calendar-location">Location</label>
                <input id="calendar-location" maxlength="500" placeholder="Optional">
                <label for="calendar-description">Notes</label>
                <textarea id="calendar-description" rows="3" maxlength="8000" placeholder="Optional"></textarea>
                <div class="form-actions">
                  <span>Silk writes only after you press Add event.</span>
                  <button class="primary-button" type="submit">Add event</button>
                </div>
              </form>
              <p id="calendar-error" class="form-error" role="alert"></p>
            </article>

            <aside class="panel">
              <div class="panel-heading">
                <div><p class="overline">NEXT 7 DAYS</p><h3>Upcoming</h3></div>
                <button id="refresh-calendar" class="ghost-button" type="button">Refresh</button>
              </div>
              <div id="calendar-events" class="calendar-events"></div>
            </aside>
          </div>
        </div>
      </section>

      <section id="page-memory" class="page scroll-page" data-page-panel="memory">
        <header class="page-header">
          <div><p class="overline">CURATED CONTEXT</p><h2>Memory</h2></div>
          <span class="model-pill"><i></i> You stay in control</span>
        </header>

        <div class="split-layout memory-layout">
          <article class="panel">
            <div class="panel-heading">
              <div><p class="overline">ADD MEMORY</p><h3>Something Silk should retain</h3></div>
            </div>
            <form id="memory-form">
              <div class="form-grid memory-fields">
                <div>
                  <label for="memory-category">Category</label>
                  <select id="memory-category">
                    <option value="general">General</option>
                    <option value="school">School</option>
                    <option value="fitness">Fitness</option>
                    <option value="schedule">Schedule</option>
                    <option value="preference">Preference</option>
                    <option value="work">Work</option>
                  </select>
                </div>
                <div>
                  <label for="memory-importance">Importance</label>
                  <select id="memory-importance">
                    <option value="1">1 · Low</option><option value="2">2</option>
                    <option value="3" selected>3 · Normal</option><option value="4">4</option>
                    <option value="5">5 · Critical</option>
                  </select>
                </div>
              </div>
              <label for="memory-content">Memory</label>
              <textarea id="memory-content" rows="5" maxlength="4000" placeholder="Example: I prefer facts before recommendations." required></textarea>
              <div class="form-actions">
                <span>You can edit or delete this later.</span>
                <button class="primary-button" type="submit">Save memory</button>
              </div>
            </form>
            <p id="memory-error" class="form-error" role="alert"></p>
          </article>

          <aside class="panel memory-guide">
            <p class="overline">HOW MEMORY WORKS</p>
            <h3>Relevant, not invasive.</h3>
            <p>Silk sends only a small set of useful memories with each AI request. Higher-importance memories are considered first.</p>
            <ul>
              <li>Chat history and long-term memory are separate.</li>
              <li>Nothing is silently marked permanent.</li>
              <li>Removing a memory removes it from future context.</li>
            </ul>
          </aside>
        </div>

        <div class="section-heading">
          <div><p class="overline">SAVED CONTEXT</p><h3 id="memory-heading">All memories</h3></div>
          <select id="memory-filter" aria-label="Filter memories">
            <option value="all">All categories</option><option value="general">General</option>
            <option value="school">School</option><option value="fitness">Fitness</option>
            <option value="schedule">Schedule</option><option value="preference">Preference</option>
            <option value="work">Work</option>
          </select>
        </div>
        <div id="memory-list" class="memory-list"></div>
      </section>

      <section id="page-settings" class="page scroll-page" data-page-panel="settings">
        <header class="page-header">
          <div><p class="overline">SYSTEM CONTROL</p><h2>Settings</h2></div>
          <span class="version-label">Silk v0.5</span>
        </header>

        <div class="settings-grid">
          <article class="panel">
            <div class="panel-heading"><div><p class="overline">PERSONALITY</p><h3>How Silk responds</h3></div></div>
            <form id="settings-form">
              <label for="owner-name">Your name</label>
              <input id="owner-name" maxlength="60">
              <label>Model routing</label>
              <div class="segmented" id="model-mode-control">
                <label><input type="radio" name="model-mode" value="efficient"><span>Routine</span><small>GPT-5.6 Luna</small></label>
                <label><input type="radio" name="model-mode" value="automatic"><span>Automatic</span><small>Luna or Terra</small></label>
                <label><input type="radio" name="model-mode" value="best"><span>Complex</span><small>GPT-5.6 Terra</small></label>
              </div>
              <label for="response-length">Response detail</label>
              <select id="response-length">
                <option value="concise">Concise</option><option value="balanced">Balanced</option><option value="detailed">Detailed</option>
              </select>
              <label for="monthly-budget">Budget display target (CAD/month)</label>
              <input id="monthly-budget" type="number" min="0" max="25" step="0.5">
              <div class="locked-rule"><span>✓</span><div><strong>Facts before recommendations</strong><small>This core rule remains active.</small></div></div>
              <div class="form-actions"><span id="settings-status"></span><button class="primary-button" type="submit">Save settings</button></div>
            </form>
          </article>

          <article class="panel">
            <div class="panel-heading"><div><p class="overline">USAGE</p><h3>This month</h3></div></div>
            <div id="usage-panel" class="usage-panel"></div>
            <p class="panel-copy small-copy">OpenAI spend uses response token usage and the configured USD hard stop. Cloudflare neuron estimates are tracked separately.</p>
          </article>
        </div>

        <article class="panel integrations-panel">
          <div class="panel-heading">
            <div><p class="overline">UPGRADE PATH</p><h3>Connections</h3></div>
            <span class="feature-tag">Cloud first</span>
          </div>
          <div class="integration-grid">
            <div class="integration-card ready"><span>◫</span><div><strong>OneNote</strong><small>Required for every future study save</small></div><b>Next</b></div>
            <div id="web-integration-card" class="integration-card"><span>⌕</span><div><strong>Web search</strong><small>Sources and current information</small></div><b>Setup</b></div>
            <div id="calendar-integration-card" class="integration-card"><span>□</span><div><strong>Calendar</strong><small>Live Google schedule</small></div><b>Setup</b></div>
            <div class="integration-card"><span>◉</span><div><strong>Hardware hub</strong><small>Wake word, lights and room audio</small></div><b>Later</b></div>
          </div>
        </article>
      </section>
    </div>

    <nav class="mobile-nav" aria-label="Mobile navigation">
      <button class="nav-button active" type="button" data-page="chat"><span class="nav-glyph">⌁</span><span>Chat</span></button>
      <button class="nav-button" type="button" data-page="study"><span class="nav-glyph">◫</span><span>Study</span></button>
      <button class="nav-button" type="button" data-page="workouts"><span class="nav-glyph">◇</span><span>Workout</span></button>
      <button class="nav-button" type="button" data-page="projects"><span class="nav-glyph">▱</span><span>Projects</span></button>
      <button class="nav-button" type="button" data-page="calendar"><span class="nav-glyph">□</span><span>Calendar</span></button>
      <button class="nav-button" type="button" data-page="memory"><span class="nav-glyph">◎</span><span>Memory</span></button>
      <button class="nav-button" type="button" data-page="settings"><span class="nav-glyph">⛭</span><span>Settings</span></button>
    </nav>
  </div>

  <div id="toast" class="toast hidden" role="status"></div>
  <script src="/assets/app.js" defer></script>
</body>
</html>`;
const APP_CSS = String.raw`
:root {
  color-scheme: dark;
  --bg: #06101b;
  --bg-deep: #030a12;
  --panel: rgba(12, 27, 43, .84);
  --panel-solid: #0c1b2b;
  --panel-raised: #11243a;
  --line: rgba(158, 202, 234, .14);
  --line-bright: rgba(139, 218, 255, .28);
  --text: #f2f7fb;
  --muted: #91a7b8;
  --muted-2: #6f879a;
  --cyan: #76dcff;
  --cyan-strong: #3ec7fb;
  --blue: #75a7ff;
  --violet: #a58bff;
  --green: #5ae2b3;
  --amber: #ffd27a;
  --red: #ff8c9c;
  --shadow: 0 24px 80px rgba(0, 0, 0, .32);
  --radius: 22px;
  --radius-sm: 14px;
  --sidebar: 252px;
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body {
  min-height: 100%;
  margin: 0;
  background: var(--bg-deep);
}

body {
  min-height: 100dvh;
  overflow: hidden;
  color: var(--text);
  background:
    radial-gradient(circle at 62% -20%, rgba(44, 133, 214, .22), transparent 38%),
    radial-gradient(circle at 100% 100%, rgba(80, 42, 190, .12), transparent 34%),
    linear-gradient(145deg, #06121e 0%, #040c15 60%, #07111e 100%);
  -webkit-font-smoothing: antialiased;
}

button,
input,
textarea,
select {
  font: inherit;
}

button {
  color: inherit;
}

button,
select {
  cursor: pointer;
}

button:disabled,
input:disabled,
textarea:disabled {
  cursor: not-allowed;
  opacity: .55;
}

button,
input,
textarea,
select {
  -webkit-tap-highlight-color: transparent;
}

input,
textarea,
select {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 13px;
  outline: none;
  color: var(--text);
  background: rgba(4, 13, 23, .7);
  transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
}

input,
select {
  min-height: 46px;
  padding: 0 14px;
}

textarea {
  resize: vertical;
  padding: 13px 14px;
  line-height: 1.55;
}

input::placeholder,
textarea::placeholder {
  color: #61788b;
}

input:focus,
textarea:focus,
select:focus,
button:focus-visible {
  border-color: rgba(118, 220, 255, .58);
  box-shadow: 0 0 0 3px rgba(62, 199, 251, .11);
}

label {
  display: block;
  margin: 0 0 8px;
  color: #b8c8d5;
  font-size: .79rem;
  font-weight: 650;
  letter-spacing: .015em;
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

h1,
h2,
h3 {
  letter-spacing: -.035em;
}

h1 {
  margin-bottom: 13px;
  font-size: clamp(2.25rem, 5vw, 3.6rem);
}

h2 {
  margin-bottom: 0;
  font-size: clamp(1.9rem, 3.4vw, 2.75rem);
}

h3 {
  margin-bottom: 0;
  font-size: 1.15rem;
}

.hidden {
  display: none !important;
}

.ambient {
  position: fixed;
  z-index: 0;
  width: 420px;
  height: 420px;
  border-radius: 50%;
  pointer-events: none;
  filter: blur(90px);
  opacity: .12;
}

.ambient-one {
  top: -260px;
  right: 7%;
  background: #23a9fa;
}

.ambient-two {
  bottom: -300px;
  left: 36%;
  background: #7253f2;
}

.login-view {
  position: relative;
  z-index: 1;
  display: grid;
  min-height: 100dvh;
  padding: 24px;
  place-items: center;
}

.login-panel {
  width: min(620px, 100%);
  padding: clamp(30px, 6vw, 58px);
  border: 1px solid var(--line-bright);
  border-radius: 30px;
  background: linear-gradient(145deg, rgba(18, 40, 62, .9), rgba(8, 21, 35, .94));
  box-shadow: var(--shadow);
  backdrop-filter: blur(24px);
}

.login-mark,
.brand-mark {
  position: relative;
  display: grid;
  place-items: center;
  border: 1px solid rgba(118, 220, 255, .28);
  background: linear-gradient(145deg, rgba(50, 192, 247, .16), rgba(116, 81, 238, .12));
  box-shadow: inset 0 0 28px rgba(58, 196, 250, .08), 0 0 30px rgba(37, 168, 236, .08);
}

.login-mark {
  width: 58px;
  height: 58px;
  margin-bottom: 28px;
  border-radius: 18px;
  transform: rotate(45deg);
}

.login-mark span,
.brand-mark span {
  width: 38%;
  height: 38%;
  border: 2px solid var(--cyan);
  border-radius: 50% 50% 50% 12%;
  box-shadow: 0 0 14px rgba(118, 220, 255, .5);
}

.login-mark span {
  transform: rotate(-45deg);
}

.overline {
  margin-bottom: 7px;
  color: var(--cyan);
  font-size: .7rem;
  font-weight: 800;
  letter-spacing: .19em;
}

.login-copy {
  max-width: 500px;
  margin-bottom: 28px;
  color: var(--muted);
  font-size: 1rem;
  line-height: 1.65;
}

.login-form > label {
  margin-bottom: 9px;
}

.field-row,
.inline-form {
  display: flex;
  gap: 10px;
}

.field-row input,
.inline-form input {
  flex: 1;
}

.primary-button,
.ghost-button,
.small-button,
.lock-button,
.quick-actions button,
.nav-button,
.send-button,
.composer-tool {
  border: 1px solid transparent;
  outline: none;
}

.primary-button {
  min-height: 46px;
  padding: 0 19px;
  border-radius: 13px;
  color: #03101a;
  background: linear-gradient(135deg, #8be7ff, #77abff);
  box-shadow: 0 9px 28px rgba(49, 173, 236, .18);
  font-weight: 760;
  white-space: nowrap;
  transition: transform .16s ease, filter .16s ease;
}

.primary-button:hover {
  filter: brightness(1.07);
  transform: translateY(-1px);
}

.compact-button {
  min-height: 40px;
  padding: 0 16px;
  font-size: .84rem;
}

.form-error {
  min-height: 18px;
  margin: 10px 0 0;
  color: var(--red);
  font-size: .82rem;
}

.setup-message {
  margin: 14px 0 0;
  padding: 12px 14px;
  border: 1px solid rgba(255, 210, 122, .24);
  border-radius: 12px;
  color: var(--amber);
  background: rgba(255, 210, 122, .06);
  font-size: .85rem;
}

.login-foot {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  margin-top: 34px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
  color: var(--muted-2);
  font-size: .75rem;
}

.status-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 7px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 12px var(--green);
}

.app-view {
  position: relative;
  z-index: 1;
  display: grid;
  height: 100dvh;
  grid-template-columns: var(--sidebar) 1fr;
}

.sidebar {
  display: flex;
  min-width: 0;
  padding: 24px 18px 18px;
  border-right: 1px solid var(--line);
  flex-direction: column;
  background: rgba(3, 11, 19, .78);
  backdrop-filter: blur(24px);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 8px 25px;
}

.brand-mark {
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  border-radius: 12px;
}

.brand strong {
  display: block;
  font-size: .97rem;
  letter-spacing: .18em;
}

.brand small {
  display: block;
  margin-top: 3px;
  color: var(--muted-2);
  font-size: .67rem;
}

.side-nav {
  display: grid;
  gap: 5px;
}

.nav-button {
  position: relative;
  display: flex;
  min-height: 47px;
  padding: 0 12px;
  border-radius: 13px;
  align-items: center;
  gap: 11px;
  color: #8499aa;
  background: transparent;
  text-align: left;
  transition: color .16s ease, background .16s ease, border-color .16s ease;
}

.nav-button:hover {
  color: #dce9f2;
  background: rgba(111, 177, 221, .06);
}

.nav-button.active {
  border-color: rgba(118, 220, 255, .12);
  color: var(--text);
  background: linear-gradient(90deg, rgba(57, 172, 230, .13), rgba(94, 112, 238, .07));
}

.nav-button.active::before {
  position: absolute;
  top: 11px;
  bottom: 11px;
  left: -3px;
  width: 3px;
  border-radius: 4px;
  background: var(--cyan);
  box-shadow: 0 0 12px rgba(118, 220, 255, .5);
  content: "";
}

.nav-glyph {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  color: var(--cyan);
  font-size: 1.15rem;
}

.nav-button b {
  min-width: 20px;
  margin-left: auto;
  padding: 2px 5px;
  border-radius: 20px;
  color: #9fb5c5;
  background: rgba(255,255,255,.06);
  font-size: .65rem;
  text-align: center;
}

.sidebar-status {
  margin: auto 3px 15px;
  padding: 15px;
  border: 1px solid var(--line);
  border-radius: 15px;
  background: rgba(12, 28, 44, .57);
}

.status-heading,
.quota-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-heading {
  margin-bottom: 13px;
  font-size: .72rem;
  font-weight: 730;
  text-transform: uppercase;
  letter-spacing: .1em;
}

.online-label {
  color: var(--green);
}

.online-label::before {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin: 0 5px 1px 0;
  border-radius: 50%;
  background: var(--green);
  content: "";
}

.quota-line {
  color: #a5b7c5;
  font-size: .67rem;
}

.quota-track,
.usage-track {
  height: 5px;
  margin: 8px 0 9px;
  overflow: hidden;
  border-radius: 9px;
  background: rgba(255,255,255,.07);
}

.quota-track i,
.usage-track i {
  display: block;
  width: 0;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--cyan-strong), var(--violet));
  transition: width .35s ease;
}

.sidebar-status small {
  color: #60788b;
  font-size: .62rem;
}

.lock-button {
  display: flex;
  min-height: 42px;
  border-radius: 12px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #8298aa;
  background: transparent;
}

.lock-button:hover {
  color: #d9e5ed;
  background: rgba(255,255,255,.04);
}

.workspace {
  position: relative;
  min-width: 0;
  min-height: 0;
}

.mobile-header,
.mobile-nav {
  display: none;
}

.page {
  display: none;
  height: 100dvh;
  min-width: 0;
  padding: 28px clamp(24px, 4vw, 58px);
}

.page.active {
  display: block;
}

.scroll-page {
  overflow-y: auto;
  padding-bottom: 64px;
  scrollbar-color: rgba(118, 220, 255, .22) transparent;
}

.page-chat.active {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto auto auto;
}

.page-header {
  display: flex;
  max-width: 1280px;
  margin: 0 auto 26px;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
}

.chat-header {
  width: 100%;
  margin-bottom: 16px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 9px;
}

.model-pill,
.version-label,
.feature-tag {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: #9fb2c1;
  background: rgba(9, 24, 39, .72);
  font-size: .72rem;
  font-weight: 650;
  white-space: nowrap;
}

.model-pill {
  min-height: 35px;
  padding: 0 12px;
}

.model-pill i {
  width: 6px;
  height: 6px;
  margin-right: 7px;
  border-radius: 50%;
  background: var(--cyan);
  box-shadow: 0 0 10px rgba(118,220,255,.7);
}

.small-button,
.ghost-button {
  min-height: 36px;
  padding: 0 13px;
  border-color: var(--line);
  border-radius: 10px;
  color: #a9bac7;
  background: rgba(11, 25, 40, .7);
}

.small-button:hover,
.ghost-button:hover {
  border-color: var(--line-bright);
  color: var(--text);
}

.context-strip {
  display: grid;
  width: min(100%, 980px);
  margin: 0 auto 11px;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.context-card {
  min-width: 0;
  padding: 10px 12px;
  overflow: hidden;
  border: 1px solid rgba(141, 198, 231, .09);
  border-radius: 12px;
  color: #8da3b4;
  background: rgba(9, 22, 36, .5);
  font-size: .69rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-card strong {
  margin-right: 5px;
  color: #bed0dc;
  font-weight: 680;
}

.messages {
  width: min(100%, 980px);
  min-height: 0;
  margin: 0 auto;
  padding: 18px 4px 8px;
  overflow-y: auto;
  scroll-behavior: smooth;
  scrollbar-color: rgba(118, 220, 255, .2) transparent;
}

.welcome {
  display: grid;
  min-height: 100%;
  place-items: center;
  text-align: center;
}

.welcome > div {
  max-width: 520px;
}

.welcome-orb {
  display: grid;
  width: 62px;
  height: 62px;
  margin: 0 auto 21px;
  border: 1px solid rgba(118, 220, 255, .27);
  border-radius: 21px;
  place-items: center;
  background: radial-gradient(circle, rgba(70, 202, 255, .22), rgba(53, 90, 182, .08));
  box-shadow: 0 0 60px rgba(41, 173, 235, .14);
}

.welcome-orb::after {
  width: 14px;
  height: 14px;
  border: 2px solid var(--cyan);
  border-radius: 50% 50% 50% 4px;
  content: "";
  transform: rotate(-20deg);
}

.welcome h3 {
  margin-bottom: 10px;
  font-size: 1.7rem;
}

.welcome p {
  color: var(--muted);
  line-height: 1.65;
}

.message {
  display: flex;
  margin: 0 0 19px;
  flex-direction: column;
}

.message.user {
  align-items: flex-end;
}

.message.assistant {
  align-items: flex-start;
}

.message-bubble {
  max-width: min(78%, 720px);
  padding: 13px 16px;
  border: 1px solid var(--line);
  border-radius: 17px;
  line-height: 1.58;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.message.user .message-bubble {
  border-color: rgba(131, 184, 255, .22);
  border-bottom-right-radius: 5px;
  color: #07121e;
  background: linear-gradient(135deg, #b1e9ff, #93b9ff);
}

.message.assistant .message-bubble {
  border-bottom-left-radius: 5px;
  background: rgba(15, 31, 49, .86);
}

.message-meta {
  margin: 5px 6px 0;
  color: #61788a;
  font-size: .62rem;
}

.typing {
  width: min(100%, 980px);
  margin: 2px auto 7px;
  padding-left: 5px;
  align-items: center;
  gap: 5px;
}

.typing:not(.hidden) {
  display: flex;
}

.typing span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #7293aa;
  animation: typingPulse 1s infinite alternate;
}

.typing span:nth-child(3) {
  animation-delay: .16s;
}

.typing span:nth-child(4) {
  animation-delay: .32s;
}

.typing-orb {
  width: 23px;
  height: 23px;
  margin-right: 3px;
  border: 1px solid rgba(118,220,255,.2);
  border-radius: 8px;
  background: rgba(49,173,232,.1);
}

@keyframes typingPulse {
  from { opacity: .35; transform: translateY(1px); }
  to { opacity: 1; transform: translateY(-2px); }
}

.chat-error {
  width: min(100%, 980px);
  margin: 0 auto;
}

.quick-actions {
  display: flex;
  width: min(100%, 980px);
  margin: 3px auto 10px;
  gap: 7px;
  overflow-x: auto;
  scrollbar-width: none;
}

.quick-actions::-webkit-scrollbar {
  display: none;
}

.quick-actions button {
  min-height: 34px;
  padding: 0 12px;
  border-color: var(--line);
  border-radius: 999px;
  flex: 0 0 auto;
  color: #8fa4b5;
  background: rgba(8, 21, 34, .58);
  font-size: .7rem;
}

.quick-actions button:hover {
  border-color: var(--line-bright);
  color: var(--text);
}

.composer {
  display: flex;
  width: min(100%, 980px);
  min-height: 58px;
  margin: 0 auto;
  padding: 7px;
  border: 1px solid rgba(130, 194, 231, .22);
  border-radius: 18px;
  align-items: flex-end;
  gap: 5px;
  background: rgba(9, 23, 38, .92);
  box-shadow: 0 15px 40px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.025);
}

.composer:focus-within {
  border-color: rgba(118, 220, 255, .48);
  box-shadow: 0 0 0 3px rgba(62, 199, 251, .08), 0 15px 40px rgba(0,0,0,.18);
}

.composer textarea {
  min-height: 42px;
  max-height: 140px;
  padding: 10px 9px;
  border: 0;
  resize: none;
  background: transparent;
  box-shadow: none;
  line-height: 1.4;
}

.composer textarea:focus {
  box-shadow: none;
}

.composer-tool,
.send-button {
  display: grid;
  width: 42px;
  height: 42px;
  min-width: 42px;
  border-radius: 13px;
  place-items: center;
}

.composer-tool {
  color: var(--cyan);
  background: rgba(82, 188, 236, .1);
}

.composer-tool.listening {
  color: #06111b;
  background: var(--red);
  animation: listenPulse 1.2s infinite;
}

.composer-tool.web-tool.active {
  color: #06111b;
  background: linear-gradient(135deg, #8fe8ff, #9cb5ff);
  box-shadow: 0 0 0 3px rgba(108, 210, 255, .09);
}

.message-sources {
  display: grid;
  width: min(88%, 700px);
  margin-top: 7px;
  gap: 6px;
}

.source-card {
  display: grid;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 11px;
  gap: 2px;
  color: #a9c2d4;
  background: rgba(13, 31, 48, .72);
  text-decoration: none;
}

.source-card:hover {
  border-color: var(--line-bright);
  background: rgba(19, 43, 65, .82);
}

.source-card strong {
  overflow: hidden;
  color: #dbeaf3;
  font-size: .72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-card small {
  overflow: hidden;
  color: #6c8ca2;
  font-size: .61rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes listenPulse {
  50% { box-shadow: 0 0 0 8px rgba(255,140,156,.08); }
}

.send-button {
  color: #05111c;
  background: linear-gradient(135deg, #9aeaff, #89b2ff);
  font-size: 1.25rem;
  font-weight: 800;
}

.composer-caption {
  width: min(100%, 980px);
  margin: 7px auto 0;
  color: #587084;
  font-size: .63rem;
  text-align: center;
}

.metric-grid {
  display: grid;
  max-width: 1280px;
  margin: 0 auto 18px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.metric-card {
  min-height: 103px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: linear-gradient(145deg, rgba(16, 34, 53, .8), rgba(9, 22, 35, .68));
}

.metric-card span {
  display: block;
  margin-bottom: 10px;
  color: #71899a;
  font-size: .68rem;
  font-weight: 720;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.metric-card strong {
  font-size: 1.55rem;
  letter-spacing: -.04em;
}

.metric-card small {
  display: block;
  margin-top: 5px;
  color: #72899a;
  font-size: .66rem;
}

.split-layout,
.settings-grid {
  display: grid;
  max-width: 1280px;
  margin: 0 auto 24px;
  grid-template-columns: minmax(0, 1.45fr) minmax(300px, .75fr);
  gap: 16px;
}

.settings-grid {
  grid-template-columns: minmax(0, 1.2fr) minmax(300px, .8fr);
}

.panel {
  min-width: 0;
  padding: clamp(18px, 2.5vw, 27px);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: linear-gradient(145deg, rgba(15, 32, 50, .8), rgba(8, 20, 33, .76));
  box-shadow: 0 16px 48px rgba(0, 0, 0, .12);
}

.panel-heading,
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
}

.panel-heading {
  margin-bottom: 17px;
}

.panel-heading .overline,
.section-heading .overline {
  margin-bottom: 5px;
}

.panel-copy {
  margin: -3px 0 20px;
  color: var(--muted);
  font-size: .87rem;
  line-height: 1.62;
}

.small-copy {
  margin: 17px 0 0;
  font-size: .72rem;
}

.feature-tag,
.version-label {
  padding: 6px 10px;
  color: var(--cyan);
  background: rgba(63, 179, 230, .07);
}

.muted-tag {
  color: #768c9e;
  background: rgba(255,255,255,.03);
}

.large-textarea {
  min-height: 188px;
}

.form-actions {
  display: flex;
  margin-top: 14px;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
}

.form-actions > span {
  color: #688093;
  font-size: .69rem;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 13px;
}

.form-grid.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-bottom: 13px;
}

.form-grid + label,
.segmented + label,
#settings-form > label:not(:first-child) {
  margin-top: 15px;
}

.focus-panel {
  position: relative;
  overflow: hidden;
}

.focus-panel::after {
  position: absolute;
  right: -70px;
  bottom: -90px;
  width: 180px;
  height: 180px;
  border-radius: 50%;
  background: rgba(69, 173, 233, .07);
  content: "";
  filter: blur(8px);
}

.focus-empty,
.empty-state {
  display: grid;
  min-height: 180px;
  place-items: center;
  color: #698194;
  font-size: .82rem;
  text-align: center;
}

.focus-subject {
  margin-bottom: 9px;
  color: var(--cyan);
  font-size: .76rem;
  font-weight: 760;
  letter-spacing: .09em;
  text-transform: uppercase;
}

.focus-panel h3 {
  margin-bottom: 14px;
  font-size: 1.55rem;
}

.project-list {
  display: grid;
  max-width: 1280px;
  margin: 0 auto;
  gap: 12px;
}

.project-card {
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: linear-gradient(145deg, rgba(15, 33, 51, .86), rgba(7, 19, 31, .82));
}

.project-card-head,
.project-card-meta,
.project-actions,
.project-progress-label,
.task-row,
.calendar-event {
  display: flex;
  align-items: center;
}

.project-card-head,
.project-progress-label,
.calendar-event {
  justify-content: space-between;
}

.project-card h3 {
  margin: 0;
  font-size: 1.08rem;
}

.project-card-meta {
  flex-wrap: wrap;
  margin: 7px 0 12px;
  gap: 7px;
  color: #7690a4;
  font-size: .68rem;
}

.project-card-meta span,
.status-chip {
  padding: 4px 7px;
  border-radius: 999px;
  background: rgba(255,255,255,.04);
}

.project-description {
  margin: 0 0 14px;
  color: var(--muted);
  font-size: .82rem;
  line-height: 1.55;
}

.project-progress-label {
  margin-bottom: 6px;
  color: #88a0b2;
  font-size: .68rem;
}

.project-progress {
  height: 5px;
  margin-bottom: 14px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255,255,255,.06);
}

.project-progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--cyan-strong), var(--violet));
}

.task-list {
  display: grid;
  gap: 5px;
}

.task-row {
  min-height: 38px;
  padding: 7px 9px;
  border: 1px solid rgba(150, 199, 230, .09);
  border-radius: 10px;
  gap: 9px;
  background: rgba(4, 14, 24, .38);
}

.task-row.done span {
  color: #657d8e;
  text-decoration: line-through;
}

.task-row input {
  width: 16px;
  height: 16px;
  accent-color: var(--cyan-strong);
}

.task-row span {
  flex: 1;
  min-width: 0;
  color: #c5d5df;
  font-size: .78rem;
}

.task-row button {
  padding: 4px 7px;
  border: 0;
  color: #71899b;
  background: transparent;
}

.project-task-form {
  display: flex;
  margin-top: 9px;
  gap: 7px;
}

.project-task-form input {
  min-height: 38px;
}

.project-task-form button {
  flex: 0 0 auto;
}

.project-actions {
  margin-top: 13px;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 7px;
}

.connection-panel {
  max-width: 1280px;
  margin: 0 auto 18px;
}

.connection-status {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 14px;
}

.connection-icon {
  display: grid;
  width: 48px;
  height: 48px;
  border: 1px solid var(--line-bright);
  border-radius: 15px;
  place-items: center;
  color: var(--cyan);
  background: rgba(61, 179, 232, .08);
  font-size: 1.1rem;
}

.connection-status p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: .76rem;
  line-height: 1.5;
}

.setup-list {
  margin: 15px 0 0;
  padding-left: 20px;
  color: #90a8b8;
  font-size: .76rem;
  line-height: 1.8;
}

.setup-code {
  display: block;
  margin-top: 4px;
  padding: 7px 9px;
  overflow-wrap: anywhere;
  border: 1px solid var(--line);
  border-radius: 9px;
  color: #b9d9ea;
  background: rgba(3, 12, 21, .5);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .68rem;
}

.calendar-events {
  display: grid;
  max-height: 560px;
  overflow-y: auto;
  gap: 7px;
}

.calendar-event {
  padding: 11px;
  border: 1px solid var(--line);
  border-radius: 12px;
  gap: 10px;
  background: rgba(5, 17, 28, .4);
}

.calendar-event-time {
  width: 66px;
  flex: 0 0 66px;
  color: var(--cyan);
  font-size: .68rem;
  font-weight: 750;
}

.calendar-event-copy {
  min-width: 0;
  flex: 1;
}

.calendar-event-copy strong,
.calendar-event-copy small {
  display: block;
}

.calendar-event-copy strong {
  overflow: hidden;
  font-size: .78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-event-copy small {
  margin-top: 3px;
  color: #71899b;
  font-size: .64rem;
}

.calendar-event button {
  padding: 5px 7px;
  border: 0;
  color: #9e7180;
  background: transparent;
}

.focus-panel p {
  position: relative;
  z-index: 1;
  color: #aabcc9;
  line-height: 1.65;
}

.focus-stat {
  display: inline-flex;
  margin-top: 7px;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 9px;
  color: #91a7b7;
  background: rgba(0,0,0,.12);
  font-size: .7rem;
}

.review-panel {
  max-width: 1280px;
  margin: 0 auto 28px;
}

.topic-preview {
  display: flex;
  margin-top: 15px;
  flex-wrap: wrap;
  gap: 7px;
}

.topic-chip {
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: 9px;
  color: #8fa7b8;
  background: rgba(7, 17, 28, .45);
  font-size: .69rem;
}

.topic-chip.good {
  border-color: rgba(90, 226, 179, .17);
  color: #83dcbf;
}

.topic-chip.weak {
  border-color: rgba(255, 210, 122, .19);
  color: #e5bd73;
}

.section-heading {
  max-width: 1280px;
  margin: 32px auto 13px;
}

.section-heading > span {
  color: #6e8597;
  font-size: .72rem;
}

.section-heading select {
  width: auto;
  min-width: 160px;
}

.record-list,
.memory-list {
  display: grid;
  max-width: 1280px;
  margin: 0 auto;
  gap: 9px;
}

.record-card,
.memory-card {
  display: flex;
  min-width: 0;
  padding: 15px 17px;
  border: 1px solid var(--line);
  border-radius: 15px;
  align-items: center;
  gap: 14px;
  background: rgba(10, 24, 39, .62);
}

.record-main {
  min-width: 0;
  flex: 1;
}

.record-main strong,
.memory-card strong {
  display: block;
  margin-bottom: 4px;
}

.record-main p,
.memory-card p {
  margin: 0;
  color: #8fa4b4;
  font-size: .78rem;
  line-height: 1.5;
}

.record-meta {
  display: flex;
  margin-top: 7px;
  gap: 12px;
  color: #657d8f;
  font-size: .66rem;
}

.grade-badge,
.grade-ring {
  display: grid;
  width: 48px;
  height: 48px;
  border: 1px solid rgba(118, 220, 255, .2);
  border-radius: 50%;
  flex: 0 0 auto;
  place-items: center;
  color: var(--cyan);
  background: rgba(52, 177, 230, .08);
  font-size: .75rem;
  font-weight: 760;
}

.record-actions,
.memory-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
}

.record-actions button,
.memory-actions button {
  min-height: 33px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 9px;
  color: #849bad;
  background: rgba(5, 15, 25, .45);
  font-size: .67rem;
}

.record-actions button:hover,
.memory-actions button:hover {
  color: var(--text);
  border-color: var(--line-bright);
}

.danger-button,
.danger-text {
  color: var(--red) !important;
}

.workout-fields {
  grid-template-columns: minmax(190px, 1.5fr) repeat(3, minmax(80px, .55fr));
}

.workout-actions > div {
  display: flex;
  gap: 7px;
}

.check-label {
  display: flex;
  margin: 0;
  align-items: center;
  gap: 8px;
  color: #91a6b5;
  font-weight: 550;
}

.check-label input {
  width: 16px;
  min-height: 16px;
  accent-color: var(--cyan);
}

.recommendation {
  margin-top: 18px;
  padding: 14px;
  border: 1px solid rgba(118, 220, 255, .17);
  border-radius: 13px;
  color: #afc2cf;
  background: rgba(47, 166, 221, .06);
  font-size: .82rem;
  line-height: 1.55;
}

.recommendation strong {
  display: block;
  margin-bottom: 5px;
  color: var(--cyan);
}

.pr-list {
  display: grid;
  gap: 8px;
}

.pr-row {
  display: flex;
  padding: 11px 12px;
  border: 1px solid rgba(154, 200, 230, .09);
  border-radius: 11px;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  background: rgba(4, 14, 23, .35);
}

.pr-row div {
  min-width: 0;
}

.pr-row strong {
  display: block;
  overflow: hidden;
  font-size: .79rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pr-row small {
  color: #657d90;
  font-size: .64rem;
}

.pr-row b {
  color: var(--cyan);
  font-size: .82rem;
  white-space: nowrap;
}

.compact-records .record-card {
  min-height: 64px;
}

.memory-layout {
  grid-template-columns: minmax(0, 1.05fr) minmax(300px, .95fr);
}

.memory-fields {
  margin-bottom: 13px;
}

.memory-guide p,
.memory-guide li {
  color: #93a8b7;
  font-size: .82rem;
  line-height: 1.62;
}

.memory-guide ul {
  margin: 18px 0 0;
  padding-left: 18px;
}

.memory-guide li + li {
  margin-top: 7px;
}

.memory-card {
  align-items: flex-start;
}

.memory-body {
  min-width: 0;
  flex: 1;
}

.memory-top {
  display: flex;
  margin-bottom: 8px;
  align-items: center;
  gap: 8px;
}

.category-tag {
  padding: 4px 7px;
  border-radius: 7px;
  color: var(--cyan);
  background: rgba(80, 184, 232, .08);
  font-size: .62rem;
  font-weight: 740;
  text-transform: capitalize;
}

.importance-dots {
  display: inline-flex;
  gap: 3px;
}

.importance-dots i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(255,255,255,.12);
}

.importance-dots i.on {
  background: var(--violet);
}

.settings-grid .panel {
  align-self: start;
}

.segmented {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}

.segmented label {
  position: relative;
  min-width: 0;
  margin: 0;
  cursor: pointer;
}

.segmented input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.segmented label > span,
.segmented label > small {
  display: block;
  padding: 0 10px;
  border-right: 1px solid var(--line);
  border-left: 1px solid var(--line);
  color: #879dad;
  background: rgba(4, 13, 22, .48);
}

.segmented label > span {
  padding-top: 11px;
  border-top: 1px solid var(--line);
  border-radius: 11px 11px 0 0;
  font-size: .75rem;
}

.segmented label > small {
  min-height: 34px;
  padding-top: 3px;
  border-bottom: 1px solid var(--line);
  border-radius: 0 0 11px 11px;
  color: #5f788b;
  font-size: .58rem;
}

.segmented input:checked ~ span,
.segmented input:checked ~ small {
  border-color: rgba(118,220,255,.27);
  color: var(--text);
  background: rgba(50, 170, 223, .1);
}

.segmented input:checked ~ small {
  color: #88a4b8;
}

.locked-rule {
  display: flex;
  margin-top: 17px;
  padding: 12px;
  border: 1px solid rgba(90, 226, 179, .12);
  border-radius: 12px;
  align-items: center;
  gap: 10px;
  background: rgba(90, 226, 179, .035);
}

.locked-rule > span {
  display: grid;
  width: 27px;
  height: 27px;
  border-radius: 9px;
  place-items: center;
  color: var(--green);
  background: rgba(90,226,179,.08);
}

.locked-rule strong,
.locked-rule small {
  display: block;
}

.locked-rule strong {
  font-size: .76rem;
}

.locked-rule small {
  margin-top: 3px;
  color: #6a8395;
  font-size: .63rem;
}

.usage-panel {
  display: grid;
  gap: 16px;
}

.usage-number {
  display: flex;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
  align-items: flex-end;
  justify-content: space-between;
  gap: 15px;
}

.usage-number span {
  color: #71899a;
  font-size: .68rem;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.usage-number strong {
  font-size: 1.4rem;
}

.usage-number small {
  color: #668093;
  font-size: .65rem;
}

.usage-breakdown {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.usage-breakdown div {
  padding: 10px;
  border: 1px solid rgba(155, 203, 232, .08);
  border-radius: 10px;
  background: rgba(3, 12, 21, .33);
}

.usage-breakdown span,
.usage-breakdown strong {
  display: block;
}

.usage-breakdown span {
  margin-bottom: 4px;
  color: #657f92;
  font-size: .61rem;
}

.usage-breakdown strong {
  font-size: .78rem;
}

.integrations-panel {
  max-width: 1280px;
  margin: 0 auto;
}

.integration-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 9px;
}

.integration-card {
  display: flex;
  min-width: 0;
  padding: 13px;
  border: 1px solid var(--line);
  border-radius: 13px;
  align-items: center;
  gap: 10px;
  background: rgba(3, 13, 23, .34);
}

.integration-card > span {
  display: grid;
  width: 31px;
  height: 31px;
  border-radius: 9px;
  flex: 0 0 auto;
  place-items: center;
  color: #8098aa;
  background: rgba(255,255,255,.04);
}

.integration-card > div {
  min-width: 0;
  flex: 1;
}

.integration-card strong,
.integration-card small {
  display: block;
}

.integration-card strong {
  font-size: .74rem;
}

.integration-card small {
  margin-top: 3px;
  overflow: hidden;
  color: #627a8d;
  font-size: .59rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.integration-card b {
  color: #71899a;
  font-size: .58rem;
}

.integration-card.ready {
  border-color: rgba(118,220,255,.18);
  background: rgba(55, 167, 219, .055);
}

.integration-card.ready > span,
.integration-card.ready b {
  color: var(--cyan);
}

.toast {
  position: fixed;
  z-index: 100;
  right: 24px;
  bottom: 24px;
  max-width: min(390px, calc(100vw - 32px));
  padding: 12px 16px;
  border: 1px solid var(--line-bright);
  border-radius: 13px;
  color: #dce9f1;
  background: rgba(13, 31, 48, .95);
  box-shadow: var(--shadow);
  font-size: .8rem;
  backdrop-filter: blur(20px);
  animation: toastIn .2s ease;
}

@keyframes toastIn {
  from { opacity: 0; transform: translateY(8px); }
}

@media (max-width: 1050px) {
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .integration-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .workout-fields {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .workout-fields .wide-field {
    grid-column: 1 / -1;
  }
}

@media (max-width: 860px) {
  body {
    overflow: hidden;
  }

  .app-view {
    display: block;
  }

  .sidebar {
    display: none;
  }

  .workspace {
    height: 100dvh;
  }

  .mobile-header {
    position: fixed;
    z-index: 20;
    top: 0;
    right: 0;
    left: 0;
    display: flex;
    height: calc(62px + env(safe-area-inset-top));
    padding: env(safe-area-inset-top) 17px 0;
    border-bottom: 1px solid var(--line);
    align-items: center;
    justify-content: space-between;
    background: rgba(4, 13, 22, .88);
    backdrop-filter: blur(22px);
  }

  .mobile-header .brand {
    padding: 0;
  }

  .mobile-header .brand-mark {
    width: 33px;
    height: 33px;
  }

  .mobile-header .brand small {
    color: var(--green);
  }

  .mobile-nav {
    position: fixed;
    z-index: 20;
    right: 0;
    bottom: 0;
    left: 0;
    display: grid;
    height: calc(66px + env(safe-area-inset-bottom));
    padding: 5px 5px env(safe-area-inset-bottom);
    border-top: 1px solid var(--line);
    grid-template-columns: repeat(7, minmax(0, 1fr));
    background: rgba(4, 13, 22, .93);
    backdrop-filter: blur(22px);
  }

  .mobile-nav .nav-button {
    min-height: 53px;
    padding: 4px 2px;
    border: 0;
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    font-size: .53rem;
    text-align: center;
  }

  .mobile-nav .nav-button.active {
    background: transparent;
  }

  .mobile-nav .nav-button.active::before {
    top: auto;
    right: 31%;
    bottom: -4px;
    left: 31%;
    width: auto;
    height: 2px;
  }

  .mobile-nav .nav-glyph {
    height: 25px;
  }

  .mobile-nav .nav-button:nth-child(4) span:last-child {
    font-size: .5rem;
  }

  .page {
    height: 100dvh;
    padding: calc(82px + env(safe-area-inset-top)) 16px calc(87px + env(safe-area-inset-bottom));
  }

  .page-chat {
    padding-top: calc(78px + env(safe-area-inset-top));
  }

  .page-header {
    margin-bottom: 19px;
  }

  .chat-header .overline,
  .chat-header h2 {
    display: none;
  }

  .chat-header {
    min-height: 36px;
    margin-bottom: 7px;
    justify-content: flex-end;
  }

  .header-actions {
    width: 100%;
    justify-content: space-between;
  }

  .split-layout,
  .settings-grid,
  .memory-layout {
    grid-template-columns: 1fr;
  }

  .context-strip {
    grid-template-columns: 1fr;
  }

  .context-card:nth-child(n+2) {
    display: none;
  }

  .composer-caption {
    display: none;
  }

  .composer {
    border-radius: 17px;
  }
}

@media (max-width: 600px) {
  .login-view {
    padding: 15px;
  }

  .login-panel {
    padding: 29px 22px;
    border-radius: 24px;
  }

  .field-row {
    flex-direction: column;
  }

  .login-foot {
    flex-direction: column;
    gap: 7px;
  }

  .page-header {
    align-items: flex-end;
  }

  .page-header h2 {
    font-size: 2rem;
  }

  .metric-grid,
  .form-grid,
  .form-grid.three,
  .workout-fields,
  .integration-grid {
    grid-template-columns: 1fr;
  }

  .connection-status {
    grid-template-columns: auto 1fr;
  }

  .connection-status > button {
    grid-column: 1 / -1;
    width: 100%;
  }

  .project-task-form {
    align-items: stretch;
    flex-direction: column;
  }

  .metric-card {
    min-height: 88px;
  }

  .form-grid.three {
    margin-bottom: 0;
  }

  .form-grid.three > div,
  .form-grid > div {
    min-width: 0;
  }

  .workout-fields .wide-field {
    grid-column: auto;
  }

  .panel {
    padding: 18px;
    border-radius: 18px;
  }

  .panel-heading {
    align-items: flex-start;
  }

  .form-actions,
  .workout-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .workout-actions > div {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .segmented {
    grid-template-columns: 1fr;
  }

  .segmented label > span,
  .segmented label > small {
    border-radius: 0;
  }

  .segmented label > span {
    border-radius: 11px 11px 0 0;
  }

  .segmented label > small {
    min-height: 27px;
    border-radius: 0 0 11px 11px;
  }

  .message-bubble {
    max-width: 91%;
  }

  .record-card,
  .memory-card {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .record-actions,
  .memory-actions {
    width: 100%;
    justify-content: flex-end;
  }

  .section-heading select {
    min-width: 125px;
  }

  .toast {
    right: 16px;
    bottom: calc(82px + env(safe-area-inset-bottom));
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
  }
}
`;
const APP_JS = String.raw`
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const state = {
    data: null,
    page: "chat",
    studyDraft: null,
    forceWebSearch: false,
    calendarEvents: [],
    voiceEnabled: localStorage.getItem("silk-voice") === "on",
    recognition: null,
    toastTimer: null,
  };

  async function api(path, options = {}) {
    const settings = {
      method: options.method || "GET",
      credentials: "same-origin",
      headers: { ...(options.headers || {}) },
    };
    if (options.body !== undefined) {
      settings.headers["Content-Type"] = "application/json";
      settings.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, settings);
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    if (response.status === 401) {
      showLogin(true);
      throw new Error("Your session expired. Unlock Silk again.");
    }
    if (!response.ok) throw new Error(payload.error || "Silk could not complete that request.");
    return payload;
  }

  function showLogin(configured = true) {
    $("#app-view").classList.add("hidden");
    $("#login-view").classList.remove("hidden");
    $("#setup-message").classList.toggle("hidden", configured);
    $("#password").disabled = !configured;
    $("#login-form button").disabled = !configured;
    if (configured) setTimeout(() => $("#password").focus(), 50);
  }

  function showApp() {
    $("#login-view").classList.add("hidden");
    $("#app-view").classList.remove("hidden");
  }

  async function initialize() {
    bindEvents();
    updateVoiceControls();
    updateToday();
    try {
      const session = await api("/api/session");
      if (!session.configured) return showLogin(false);
      if (!session.authenticated) return showLogin(true);
      showApp();
      await loadBootstrap();
      handleConnectionResult();
    } catch (error) {
      showLogin(true);
      $("#login-error").textContent = error.message;
    }
  }

  async function loadBootstrap(options = {}) {
    try {
      const data = await api("/api/bootstrap");
      state.data = data;
      renderAll();
      if (options.toast) showToast(options.toast);
    } catch (error) {
      showToast(error.message);
    }
  }

  function renderAll() {
    if (!state.data) return;
    renderChat();
    renderStudy();
    renderWorkouts();
    renderProjects();
    renderCalendar();
    renderMemories();
    renderSettings();
    renderUsage();
    renderContextStrip();
    updateNavigationCounts();
  }

  function bindEvents() {
    $("#login-form").addEventListener("submit", login);
    $("#logout").addEventListener("click", logout);
    $("#mobile-lock").addEventListener("click", logout);
    $("#chat-form").addEventListener("submit", submitChat);
    $("#message").addEventListener("input", resizeComposer);
    $("#message").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        $("#chat-form").requestSubmit();
      }
    });
    $("#voice-toggle").addEventListener("click", toggleVoice);
    $("#mic").addEventListener("click", toggleRecognition);
    $("#web-search-toggle").addEventListener("click", toggleWebSearch);
    $("#study-import-form").addEventListener("submit", analyzeStudy);
    $("#study-review-form").addEventListener("submit", saveStudy);
    $("#cancel-study-review").addEventListener("click", clearStudyReview);
    $("#study-list").addEventListener("click", handleStudyAction);
    $("#workout-start-form").addEventListener("submit", startWorkout);
    $("#workout-set-form").addEventListener("submit", logWorkoutSet);
    $("#finish-workout").addEventListener("click", finishWorkout);
    $("#project-form").addEventListener("submit", createProject);
    $("#project-list").addEventListener("click", handleProjectAction);
    $("#project-list").addEventListener("submit", addProjectTask);
    $("#project-filter").addEventListener("change", renderProjects);
    $("#calendar-connection").addEventListener("click", handleCalendarConnection);
    $("#calendar-event-form").addEventListener("submit", createCalendarEvent);
    $("#calendar-events").addEventListener("click", handleCalendarEventAction);
    $("#refresh-calendar").addEventListener("click", () => loadCalendarEvents(true));
    $("#memory-form").addEventListener("submit", saveMemory);
    $("#memory-list").addEventListener("click", handleMemoryAction);
    $("#memory-filter").addEventListener("change", renderMemories);
    $("#settings-form").addEventListener("submit", saveSettings);

    $$("[data-page]").forEach((button) => {
      button.addEventListener("click", () => navigate(button.dataset.page));
    });
    $$("[data-page-jump]").forEach((button) => {
      button.addEventListener("click", () => navigate(button.dataset.pageJump));
    });
    $$("[data-quick-message]").forEach((button) => {
      button.addEventListener("click", () => sendChat(button.dataset.quickMessage));
    });
    $$("[data-focus-study]").forEach((button) => {
      button.addEventListener("click", () => {
        navigate("study");
        setTimeout(() => $("#study-source").focus(), 60);
      });
    });
  }

  async function login(event) {
    event.preventDefault();
    const password = $("#password").value;
    const button = $("#login-form button");
    $("#login-error").textContent = "";
    setBusy(button, true, "Unlocking…");
    try {
      await api("/api/login", { method: "POST", body: { password } });
      $("#password").value = "";
      showApp();
      await loadBootstrap();
    } catch (error) {
      $("#login-error").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  async function logout() {
    try {
      await api("/api/logout", { method: "POST", body: {} });
    } catch {
      // The local interface should lock even if the network request fails.
    }
    state.data = null;
    showLogin(true);
  }

  function navigate(page) {
    if (!["chat", "study", "workouts", "projects", "calendar", "memory", "settings"].includes(page)) return;
    state.page = page;
    $$("[data-page-panel]").forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.pagePanel === page);
    });
    $$("[data-page]").forEach((button) => {
      button.classList.toggle("active", button.dataset.page === page);
    });
    if (page === "chat") {
      setTimeout(() => {
        scrollMessages();
        $("#message").focus();
      }, 60);
    } else if (page === "calendar" && state.data?.google?.connected) {
      loadCalendarEvents();
    }
  }

  function updateToday() {
    const now = new Date();
    $("#today-label").textContent = now.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).toUpperCase();
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }

  function renderChat() {
    const settings = state.data.settings || {};
    $("#greeting").textContent = greeting() + ", " + (settings.owner_name || "Jaed") + ".";
    const messages = $("#messages");
    messages.replaceChildren();
    const history = state.data.history || [];
    if (!history.length) {
      const welcome = element("div", "welcome");
      const inner = element("div");
      inner.append(
        element("div", "welcome-orb"),
        textElement("h3", "Silk is ready."),
        textElement("p", "Ask a question, import a study recap, or start tracking a workout. I’ll use only the records you have chosen to save."),
      );
      welcome.append(inner);
      messages.append(welcome);
    } else {
      history.forEach((item) => appendMessage(item.role, item.content, item.created_at, false, item.sources));
    }
    requestAnimationFrame(scrollMessages);
  }

  function appendMessage(role, content, createdAt, shouldScroll = true, sources = []) {
    const messages = $("#messages");
    const welcome = $(".welcome", messages);
    if (welcome) welcome.remove();
    const wrapper = element("div", "message " + (role === "user" ? "user" : "assistant"));
    const bubble = textElement("div", String(content || ""), "message-bubble");
    wrapper.append(bubble);
    const cleanSources = Array.isArray(sources) ? sources : [];
    if (role !== "user" && cleanSources.length) {
      const holder = element("div", "message-sources");
      cleanSources.forEach((source, index) => {
        const link = element("a", "source-card");
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.append(
          textElement("strong", "[" + (index + 1) + "] " + (source.title || "Source")),
          textElement("small", sourceHost(source.url)),
        );
        holder.append(link);
      });
      wrapper.append(holder);
    }
    if (createdAt) {
      wrapper.append(textElement("div", formatTime(createdAt), "message-meta"));
    }
    messages.append(wrapper);
    if (shouldScroll) requestAnimationFrame(scrollMessages);
  }

  async function submitChat(event) {
    event.preventDefault();
    const input = $("#message");
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    resizeComposer();
    await sendChat(message);
  }

  async function sendChat(message) {
    if (!message || $("#send").disabled) return;
    $("#chat-error").textContent = "";
    appendMessage("user", message, Math.floor(Date.now() / 1000));
    if (!state.data.history) state.data.history = [];
    state.data.history.push({ role: "user", content: message, created_at: Math.floor(Date.now() / 1000) });
    $("#typing").classList.remove("hidden");
    setBusy($("#send"), true);
    scrollMessages();
    try {
      const forceSearch = state.forceWebSearch;
      const result = await api("/api/chat", {
        method: "POST",
        body: { message, web_search: forceSearch },
      });
      $("#typing").classList.add("hidden");
      appendMessage("assistant", result.reply, Math.floor(Date.now() / 1000), true, result.sources);
      state.data.history.push({
        role: "assistant",
        content: result.reply,
        created_at: Math.floor(Date.now() / 1000),
        sources: result.sources || [],
      });
      $("#current-model-pill").lastChild.textContent = " " + (result.model || "Automatic routing");
      if (state.voiceEnabled) speak(result.reply);
      if (result.fallback) showToast("OpenAI was unavailable, so Silk used the Cloudflare fallback.");
      if (forceSearch) setWebSearch(false);
      if (result.calendar_draft) {
        showCalendarDraft(result.calendar_draft);
      } else if (result.action) {
        await loadBootstrap();
      } else {
        refreshUsage();
      }
    } catch (error) {
      $("#typing").classList.add("hidden");
      $("#chat-error").textContent = error.message;
    } finally {
      setBusy($("#send"), false);
      $("#message").focus();
    }
  }

  function renderContextStrip() {
    const strip = $("#context-strip");
    strip.replaceChildren();
    const latestStudy = state.data.study?.sessions?.[0];
    const active = state.data.workouts?.active;
    const memories = state.data.memories || [];
    const openProjects = (state.data.projects || []).filter((item) => ["active", "paused"].includes(item.status));
    const google = state.data.google || {};
    strip.append(
      contextCard("Study", latestStudy
        ? latestStudy.subject + gradeSuffix(latestStudy.overall_grade)
        : "No saved session"),
      contextCard("Workout", active ? active.name + " is active" : "No active workout"),
      contextCard("Projects", openProjects.length + " open"),
      contextCard("Calendar", google.connected ? "Google connected" : "Not connected"),
      contextCard("Memory", memories.length + (memories.length === 1 ? " saved item" : " saved items")),
    );
  }

  function contextCard(label, value) {
    const card = element("div", "context-card");
    card.append(textElement("strong", label), document.createTextNode(value));
    return card;
  }

  function toggleWebSearch() {
    if (!state.data?.web?.configured) {
      navigate("settings");
      return showToast("Add the TAVILY_API_KEY secret to enable live web search.");
    }
    setWebSearch(!state.forceWebSearch);
  }

  function setWebSearch(enabled) {
    state.forceWebSearch = Boolean(enabled);
    const button = $("#web-search-toggle");
    button.classList.toggle("active", state.forceWebSearch);
    button.setAttribute("aria-pressed", String(state.forceWebSearch));
    $("#composer-caption").textContent = state.forceWebSearch
      ? "Web search is forced for the next message. Silk will show the sources."
      : state.data?.web?.configured
        ? "Web search is ready. Silk also activates it automatically for current-information questions."
        : "Add a free Tavily key in Cloudflare to enable sourced web search.";
  }

  function handleConnectionResult() {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("calendar");
    if (!result) return;
    navigate("calendar");
    if (result === "connected") {
      showToast("Google Calendar connected.");
      loadCalendarEvents(true);
    } else {
      showToast(url.searchParams.get("detail") || "Google Calendar could not connect.");
    }
    url.searchParams.delete("calendar");
    url.searchParams.delete("detail");
    history.replaceState({}, "", url.pathname + url.search + url.hash);
  }

  function renderProjects() {
    const projects = state.data.projects || [];
    const open = projects.filter((item) => ["active", "paused"].includes(item.status));
    const completed = projects.filter((item) => item.status === "completed");
    const openTasks = projects.reduce((sum, item) => sum + Number(item.open_tasks || 0), 0);
    const dueSoon = open.filter((item) => {
      if (!item.due_at) return false;
      const remaining = Number(item.due_at) * 1000 - Date.now();
      return remaining >= 0 && remaining <= 7 * 86400000;
    }).length;
    renderMetricCards($("#project-metrics"), [
      ["Open", open.length, "Active or paused"],
      ["Open tasks", openTasks, "Across all projects"],
      ["Due soon", dueSoon, "Within seven days"],
      ["Completed", completed.length, "Finished outcomes"],
    ]);
    $("#project-nav-count").textContent = String(open.length);
    const filter = $("#project-filter").value;
    const visible = projects.filter((item) => {
      if (filter === "all") return true;
      if (filter === "open") return ["active", "paused"].includes(item.status);
      return item.status === filter;
    });
    const list = $("#project-list");
    list.replaceChildren();
    if (!visible.length) return list.append(emptyState("No projects match this view."));
    visible.forEach((project) => list.append(projectCard(project)));
  }

  function projectCard(project) {
    const card = element("article", "project-card");
    const head = element("div", "project-card-head");
    head.append(
      textElement("h3", project.name),
      textElement("span", capitalize(project.status), "status-chip"),
    );
    const meta = element("div", "project-card-meta");
    meta.append(
      textElement("span", "Priority " + Number(project.priority || 3)),
      textElement("span", project.due_at ? "Due " + formatDate(project.due_at) : "No due date"),
      textElement("span", Number(project.open_tasks || 0) + " open"),
    );
    card.append(head, meta);
    if (project.description) card.append(textElement("p", project.description, "project-description"));
    const count = Number(project.task_count || 0);
    const done = Number(project.done_tasks || 0);
    const percent = count ? Math.round(done / count * 100) : 0;
    const label = element("div", "project-progress-label");
    label.append(
      document.createTextNode(done + " of " + count + " tasks complete"),
      document.createTextNode(percent + "%"),
    );
    const track = element("div", "project-progress");
    const fill = element("i");
    fill.style.width = percent + "%";
    track.append(fill);
    card.append(label, track);
    const tasks = element("div", "task-list");
    (project.tasks || []).forEach((task) => {
      const row = element("div", "task-row" + (task.status === "done" ? " done" : ""));
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.checked = task.status === "done";
      checkbox.dataset.action = "task-toggle";
      checkbox.dataset.id = String(task.id);
      checkbox.setAttribute("aria-label", "Mark " + task.title + " complete");
      const remove = textElement("button", "×");
      remove.type = "button";
      remove.dataset.action = "task-delete";
      remove.dataset.id = String(task.id);
      remove.setAttribute("aria-label", "Delete " + task.title);
      row.append(checkbox, textElement("span", task.title), remove);
      tasks.append(row);
    });
    card.append(tasks);
    if (project.status !== "archived") {
      const form = element("form", "project-task-form");
      form.dataset.projectId = String(project.id);
      const input = element("input");
      input.name = "title";
      input.maxLength = 300;
      input.placeholder = "Add the next task…";
      input.required = true;
      const submit = textElement("button", "Add task", "ghost-button");
      submit.type = "submit";
      form.append(input, submit);
      card.append(form);
    }
    const actions = element("div", "project-actions");
    actions.append(
      projectActionButton("Edit", "project-edit", project.id),
      projectActionButton(
        project.status === "paused" ? "Resume" : project.status === "active" ? "Pause" : "Reopen",
        "project-status",
        project.id,
      ),
      projectActionButton(
        project.status === "completed" ? "Completed" : "Complete",
        "project-complete",
        project.id,
        project.status === "completed" ? "hidden" : "",
      ),
      projectActionButton("Delete", "project-delete", project.id, "danger-text"),
    );
    card.append(actions);
    return card;
  }

  function projectActionButton(label, action, id, className = "") {
    const button = textElement("button", label, "ghost-button " + className);
    button.type = "button";
    button.dataset.action = action;
    button.dataset.id = String(id);
    return button;
  }

  async function createProject(event) {
    event.preventDefault();
    const button = $("#project-form button[type=submit]");
    const due = $("#project-due").value;
    const payload = {
      name: $("#project-name").value.trim(),
      description: $("#project-description").value.trim(),
      priority: Number($("#project-priority").value),
      due_at: due ? new Date(due + "T23:59:59").toISOString() : null,
    };
    $("#project-error").textContent = "";
    setBusy(button, true, "Creating…");
    try {
      await api("/api/projects", { method: "POST", body: payload });
      $("#project-form").reset();
      $("#project-priority").value = "3";
      await loadBootstrap({ toast: "Project created in Silk." });
    } catch (error) {
      $("#project-error").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  async function addProjectTask(event) {
    const form = event.target.closest(".project-task-form");
    if (!form) return;
    event.preventDefault();
    const input = $("input[name=title]", form);
    const title = input.value.trim();
    if (!title) return;
    const button = $("button[type=submit]", form);
    setBusy(button, true, "Adding…");
    try {
      await api("/api/projects/" + form.dataset.projectId + "/tasks", {
        method: "POST",
        body: { title },
      });
      await loadBootstrap({ toast: "Task added." });
    } catch (error) {
      showToast(error.message);
    } finally {
      setBusy(button, false);
    }
  }

  async function handleProjectAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const id = Number(button.dataset.id);
    const action = button.dataset.action;
    if (action === "task-toggle" || action === "task-delete") {
      const task = findProjectTask(id);
      if (!task) return;
      try {
        if (action === "task-delete") {
          if (!window.confirm("Delete this task?")) return;
          await api("/api/project-tasks/" + id, { method: "DELETE" });
        } else {
          await api("/api/project-tasks/" + id, {
            method: "PATCH",
            body: { status: task.status === "done" ? "todo" : "done" },
          });
        }
        await loadBootstrap({ toast: action === "task-delete" ? "Task deleted." : "Task updated." });
      } catch (error) {
        showToast(error.message);
      }
      return;
    }
    const project = (state.data.projects || []).find((item) => Number(item.id) === id);
    if (!project) return;
    try {
      if (action === "project-delete") {
        if (!window.confirm("Delete " + project.name + " and all its tasks?")) return;
        await api("/api/projects/" + id, { method: "DELETE" });
      } else if (action === "project-complete") {
        await api("/api/projects/" + id, { method: "PATCH", body: { status: "completed" } });
      } else if (action === "project-status") {
        const status = project.status === "active" ? "paused" : "active";
        await api("/api/projects/" + id, { method: "PATCH", body: { status } });
      } else if (action === "project-edit") {
        const name = window.prompt("Project name:", project.name);
        if (name === null || !name.trim()) return;
        const description = window.prompt("Outcome or notes:", project.description || "");
        if (description === null) return;
        await api("/api/projects/" + id, {
          method: "PATCH",
          body: { name: name.trim(), description: description.trim() },
        });
      }
      await loadBootstrap({ toast: "Project updated." });
    } catch (error) {
      showToast(error.message);
    }
  }

  function findProjectTask(id) {
    for (const project of state.data.projects || []) {
      const task = (project.tasks || []).find((item) => Number(item.id) === id);
      if (task) return task;
    }
    return null;
  }

  function renderCalendar() {
    const google = state.data.google || {};
    const pill = $("#calendar-status-pill");
    pill.lastChild.textContent = google.connected ? " Connected" : google.configured ? " Ready to connect" : " Setup needed";
    const connection = $("#calendar-connection");
    connection.replaceChildren();
    const status = element("div", "connection-status");
    const icon = textElement("div", "□", "connection-icon");
    const copy = element("div");
    if (!google.configured) {
      copy.append(
        textElement("strong", "Google credentials are not installed yet."),
        textElement("p", "Create a Google OAuth web client, then add the three values below as encrypted Cloudflare Worker secrets."),
      );
      status.append(icon, copy);
      connection.append(status);
      const list = element("ol", "setup-list");
      ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"].forEach((name) => {
        list.append(textElement("li", name));
      });
      const callback = textElement("code", window.location.origin + "/api/google/callback", "setup-code");
      connection.append(list, textElement("p", "Authorized redirect URI", "panel-copy small-copy"), callback);
      $("#calendar-workspace").classList.add("hidden");
    } else if (!google.connected) {
      copy.append(
        textElement("strong", "Connect your personal Google Calendar."),
        textElement("p", "Silk requests event access so it can read, create, update, and delete events in your primary calendar."),
      );
      const button = textElement("button", "Connect Google Calendar", "primary-button");
      button.type = "button";
      button.dataset.calendarAction = "connect";
      status.append(icon, copy, button);
      connection.append(status);
      $("#calendar-workspace").classList.add("hidden");
    } else {
      copy.append(
        textElement("strong", google.account_email || "Google Calendar connected"),
        textElement("p", google.testing_note || "Calendar access is active."),
      );
      const button = textElement("button", "Disconnect", "ghost-button danger-button");
      button.type = "button";
      button.dataset.calendarAction = "disconnect";
      status.append(icon, copy, button);
      connection.append(status);
      $("#calendar-workspace").classList.remove("hidden");
      setDefaultCalendarTimes();
      if (!state.calendarEvents.length) loadCalendarEvents();
    }
    renderCalendarEvents();
    renderIntegrations();
  }

  async function handleCalendarConnection(event) {
    const button = event.target.closest("[data-calendar-action]");
    if (!button) return;
    if (button.dataset.calendarAction === "connect") {
      window.location.href = "/api/google/connect";
      return;
    }
    if (!window.confirm("Disconnect Google Calendar from Silk? Your Google events will not be deleted.")) return;
    setBusy(button, true, "Disconnecting…");
    try {
      await api("/api/google/disconnect", { method: "POST", body: {} });
      state.calendarEvents = [];
      await loadBootstrap({ toast: "Google Calendar disconnected." });
    } catch (error) {
      showToast(error.message);
    } finally {
      setBusy(button, false);
    }
  }

  async function loadCalendarEvents(showConfirmation = false) {
    if (!state.data?.google?.connected) return;
    const from = new Date();
    const to = new Date(from.getTime() + 7 * 86400000);
    try {
      const result = await api(
        "/api/calendar/events?from=" + encodeURIComponent(from.toISOString()) +
        "&to=" + encodeURIComponent(to.toISOString()),
      );
      state.calendarEvents = result.events || [];
      renderCalendarEvents();
      if (showConfirmation) showToast("Calendar refreshed.");
    } catch (error) {
      $("#calendar-error").textContent = error.message;
    }
  }

  function renderCalendarEvents() {
    const list = $("#calendar-events");
    if (!list) return;
    list.replaceChildren();
    if (!state.data?.google?.connected) return;
    if (!state.calendarEvents.length) return list.append(emptyState("No events in the next seven days."));
    state.calendarEvents.forEach((event) => {
      const row = element("div", "calendar-event");
      row.append(textElement("div", calendarEventTime(event), "calendar-event-time"));
      const copy = element("div", "calendar-event-copy");
      copy.append(
        textElement("strong", event.summary),
        textElement("small", calendarEventDetail(event)),
      );
      const edit = textElement("button", "Edit");
      edit.type = "button";
      edit.dataset.calendarAction = "edit-event";
      edit.dataset.id = event.id;
      const remove = textElement("button", "×");
      remove.type = "button";
      remove.dataset.calendarAction = "delete-event";
      remove.dataset.id = event.id;
      row.append(copy, edit, remove);
      list.append(row);
    });
  }

  async function createCalendarEvent(event) {
    event.preventDefault();
    const button = $("#calendar-event-form button[type=submit]");
    const payload = {
      summary: $("#calendar-title").value.trim(),
      start: new Date($("#calendar-start").value).toISOString(),
      end: new Date($("#calendar-end").value).toISOString(),
      location: $("#calendar-location").value.trim(),
      description: $("#calendar-description").value.trim(),
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto",
    };
    $("#calendar-error").textContent = "";
    setBusy(button, true, "Adding…");
    try {
      await api("/api/calendar/events", { method: "POST", body: payload });
      $("#calendar-event-form").reset();
      setDefaultCalendarTimes(true);
      await loadCalendarEvents();
      showToast("Event added to Google Calendar.");
    } catch (error) {
      $("#calendar-error").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  function showCalendarDraft(draft) {
    navigate("calendar");
    $("#calendar-title").value = draft.summary || "";
    $("#calendar-start").value = localDateTimeValue(new Date(draft.start));
    $("#calendar-end").value = localDateTimeValue(new Date(draft.end));
    $("#calendar-location").value = draft.location || "";
    $("#calendar-description").value = draft.description || "";
    setTimeout(() => {
      $("#calendar-event-form").scrollIntoView({ behavior: "smooth", block: "start" });
      $("#calendar-title").focus();
    }, 70);
    showToast("Calendar draft ready for your confirmation.");
  }

  async function handleCalendarEventAction(event) {
    const button = event.target.closest("[data-calendar-action]");
    if (!button) return;
    const calendarEvent = state.calendarEvents.find((item) => item.id === button.dataset.id);
    if (!calendarEvent) return;
    try {
      if (button.dataset.calendarAction === "delete-event") {
        if (!window.confirm("Delete " + calendarEvent.summary + " from Google Calendar?")) return;
        await api("/api/calendar/events/" + encodeURIComponent(calendarEvent.id), { method: "DELETE" });
        showToast("Calendar event deleted.");
      } else {
        const summary = window.prompt("Event title:", calendarEvent.summary);
        if (summary === null || !summary.trim()) return;
        await api("/api/calendar/events/" + encodeURIComponent(calendarEvent.id), {
          method: "PATCH",
          body: { summary: summary.trim() },
        });
        showToast("Calendar event updated.");
      }
      await loadCalendarEvents();
    } catch (error) {
      showToast(error.message);
    }
  }

  function setDefaultCalendarTimes(force = false) {
    const startInput = $("#calendar-start");
    const endInput = $("#calendar-end");
    if (!force && startInput.value && endInput.value) return;
    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    const end = new Date(start.getTime() + 60 * 60000);
    startInput.value = localDateTimeValue(start);
    endInput.value = localDateTimeValue(end);
  }

  function calendarEventTime(event) {
    if (event.all_day) return "All day";
    const date = new Date(event.start);
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function calendarEventDetail(event) {
    const date = new Date(event.start);
    const day = Number.isNaN(date.getTime())
      ? event.start
      : date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    return day + (event.location ? " · " + event.location : "");
  }

  function localDateTimeValue(date) {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function renderIntegrations() {
    const web = state.data.web || {};
    const google = state.data.google || {};
    const webCard = $("#web-integration-card");
    const calendarCard = $("#calendar-integration-card");
    if (webCard) {
      webCard.classList.toggle("ready", Boolean(web.configured));
      $("b", webCard).textContent = web.configured ? "Ready" : "Setup";
      $("small", webCard).textContent = web.configured
        ? Number(web.searches_this_month || 0) + " / " + Number(web.free_monthly_credits || 1000) + " free searches used"
        : "Add a free Tavily API key";
    }
    if (calendarCard) {
      calendarCard.classList.toggle("ready", Boolean(google.connected));
      $("b", calendarCard).textContent = google.connected ? "Connected" : google.configured ? "Connect" : "Setup";
      $("small", calendarCard).textContent = google.connected
        ? google.account_email || "Primary calendar connected"
        : "Google OAuth connection";
    }
    setWebSearch(state.forceWebSearch);
  }

  function sourceHost(value) {
    try {
      return new URL(value).hostname.replace(/^www\./, "");
    } catch {
      return "source";
    }
  }

  function renderStudy() {
    const study = state.data.study || { sessions: [], metrics: {} };
    const metrics = study.metrics || {};
    const sessions = study.sessions || [];
    const hours = Number(metrics.total_minutes || 0) / 60;
    const weakest = findWeakestTopic(sessions);
    const cards = [
      ["Sessions", formatNumber(metrics.total_sessions || 0), "Saved learning records"],
      ["Average", metrics.average_grade === null || metrics.average_grade === undefined
        ? "—" : formatNumber(metrics.average_grade) + "%", "Across graded sessions"],
      ["Study time", hours < 1 ? formatNumber(metrics.total_minutes || 0) + " min" : hours.toFixed(1) + " hr", "Recorded duration"],
      ["Priority", weakest ? weakest.topic : "Not enough data", weakest ? "Lowest saved topic score" : "Import a recap to begin"],
    ];
    renderMetricCards($("#study-metrics"), cards);
    $("#study-nav-count").textContent = String(metrics.total_sessions || 0);
    $("#study-history-label").textContent = sessions.length + (sessions.length === 1 ? " record" : " records");
    renderStudyFocus(sessions[0], weakest);
    renderStudyList(sessions);
    if (state.studyDraft) showStudyReview(state.studyDraft);
  }

  function renderStudyFocus(latest, weakest) {
    const card = $("#study-focus-card");
    card.replaceChildren();
    if (!latest) {
      const empty = element("div", "focus-empty");
      empty.textContent = "Your next evidence-based study recommendation will appear here after the first import.";
      card.append(empty);
      return;
    }
    card.append(
      textElement("p", "RECOMMENDED FOCUS", "overline"),
      textElement("div", latest.course || "Study", "focus-subject"),
      textElement("h3", weakest ? weakest.topic : latest.subject),
      textElement("p", latest.next_step || (
        weakest
          ? "This is the lowest recorded topic. Review it before adding new material."
          : "Review the areas you felt least confident about before adding new material."
      )),
      textElement(
        "span",
        gradeLabel(latest.overall_grade) + " · " + formatDate(latest.studied_at),
        "focus-stat",
      ),
    );
  }

  function renderStudyList(sessions) {
    const list = $("#study-list");
    list.replaceChildren();
    if (!sessions.length) return list.append(emptyState("No study sessions saved yet."));
    sessions.forEach((session) => {
      const card = element("article", "record-card");
      const grade = textElement("div", gradeLabel(session.overall_grade), "grade-badge");
      const main = element("div", "record-main");
      main.append(
        textElement("strong", (session.course || "Study") + " · " + (session.subject || "General")),
        textElement("p", session.next_step || session.weaknesses || "No next recommendation was saved."),
      );
      const meta = element("div", "record-meta");
      meta.append(
        textElement("span", formatDate(session.studied_at)),
        textElement("span", session.session_type || "Study session"),
        textElement("span", session.duration_minutes ? session.duration_minutes + " min" : "Duration not recorded"),
      );
      main.append(meta);
      const actions = element("div", "record-actions");
      actions.append(
        actionButton("Copy for OneNote", "study-copy", session.id),
        actionButton("Delete", "study-delete", session.id, "danger-text"),
      );
      card.append(grade, main, actions);
      list.append(card);
    });
  }

  async function analyzeStudy(event) {
    event.preventDefault();
    const source = $("#study-source").value.trim();
    if (!source) return;
    const button = $("#analyze-study");
    $("#study-error").textContent = "";
    setBusy(button, true, "Analyzing…");
    try {
      const result = await api("/api/study/parse", { method: "POST", body: { source } });
      state.studyDraft = result.draft;
      $("#study-parser-model").textContent = "Analyzed with " + result.model;
      showStudyReview(result.draft);
      $("#study-review").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      $("#study-error").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  function showStudyReview(draft) {
    $("#study-review").classList.remove("hidden");
    $("#review-course").value = draft.course || "";
    $("#review-subject").value = draft.subject || "";
    $("#review-type").value = draft.session_type || "Study session";
    $("#review-date").value = draft.studied_at || localDateValue();
    $("#review-duration").value = draft.duration_minutes ?? "";
    $("#review-grade").value = draft.overall_grade ?? "";
    $("#review-strengths").value = draft.strengths || "";
    $("#review-weaknesses").value = draft.weaknesses || "";
    $("#review-next").value = draft.next_step || "";
    const topics = $("#review-topics");
    topics.replaceChildren();
    (draft.topics || []).forEach((topic) => {
      const className = topic.score === null || topic.score === undefined
        ? ""
        : Number(topic.score) >= 75 ? " good" : " weak";
      topics.append(textElement(
        "span",
        topic.topic + gradeSuffix(topic.score),
        "topic-chip" + className,
      ));
    });
  }

  function clearStudyReview() {
    state.studyDraft = null;
    $("#study-review").classList.add("hidden");
  }

  async function saveStudy(event) {
    event.preventDefault();
    if (!state.studyDraft) return;
    const button = $("#study-review-form button[type=submit]");
    const payload = {
      ...state.studyDraft,
      course: $("#review-course").value.trim(),
      subject: $("#review-subject").value.trim(),
      session_type: $("#review-type").value,
      studied_at: $("#review-date").value,
      duration_minutes: optionalNumber($("#review-duration").value),
      overall_grade: optionalNumber($("#review-grade").value),
      strengths: $("#review-strengths").value.trim(),
      weaknesses: $("#review-weaknesses").value.trim(),
      next_step: $("#review-next").value.trim(),
    };
    setBusy(button, true, "Saving…");
    try {
      await api("/api/study", { method: "POST", body: payload });
      state.studyDraft = null;
      $("#study-review").classList.add("hidden");
      $("#study-source").value = "";
      await loadBootstrap({ toast: "Study session saved. Silk can now use it as context." });
    } catch (error) {
      $("#study-error").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  async function handleStudyAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const id = Number(button.dataset.id);
    const session = state.data.study.sessions.find((item) => Number(item.id) === id);
    if (!session) return;
    if (button.dataset.action === "study-copy") {
      await copyText(session.one_note_text || "");
      showToast("OneNote-ready recap copied.");
      return;
    }
    if (button.dataset.action === "study-delete") {
      if (!window.confirm("Delete this study session?")) return;
      setBusy(button, true, "Deleting…");
      try {
        await api("/api/study/" + id, { method: "DELETE" });
        await loadBootstrap({ toast: "Study session deleted." });
      } catch (error) {
        showToast(error.message);
      }
    }
  }

  function renderWorkouts() {
    const workouts = state.data.workouts || {
      active: null,
      active_sets: [],
      recent_sessions: [],
      prs: [],
    };
    const active = workouts.active;
    $("#workout-start-form").classList.toggle("hidden", Boolean(active));
    $("#workout-set-form").classList.toggle("hidden", !active);
    $("#workout-live-tag").textContent = active ? "Live" : "Not active";
    $("#workout-live-tag").classList.toggle("muted-tag", !active);
    $("#workout-form-title").textContent = active ? active.name : "Start a workout";
    renderWorkoutState(workouts);
    renderPrs(workouts.prs || []);
    renderWorkoutHistory(workouts.recent_sessions || []);
  }

  function renderWorkoutState(workouts) {
    const holder = $("#workout-state");
    holder.replaceChildren();
    const active = workouts.active;
    const sets = workouts.active_sets || [];
    if (!active) return;
    const uniqueExercises = new Set(sets.map((item) => String(item.exercise_name).toLowerCase())).size;
    const elapsed = Math.max(0, Math.floor((Date.now() / 1000 - Number(active.started_at || 0)) / 60));
    const cards = [
      ["Active workout", active.name || "Workout", "Started " + formatTime(active.started_at)],
      ["Logged sets", sets.length, "Current session"],
      ["Exercises", uniqueExercises, "Unique movements"],
      ["Elapsed", elapsed + " min", "Since start"],
    ];
    const grid = element("div", "metric-grid");
    renderMetricCards(grid, cards);
    holder.append(grid);
    if (sets.length) {
      const recent = element("div", "record-list compact-records");
      sets.slice(0, 6).forEach((set) => {
        const card = element("div", "record-card");
        const main = element("div", "record-main");
        main.append(
          textElement("strong", set.exercise_name + " · set " + set.set_number),
          textElement(
            "p",
            formatNumber(set.weight || 0) + " lb × " + formatNumber(set.reps || 0) +
              (set.rpe === null || set.rpe === undefined ? "" : " · RPE " + set.rpe) +
              (Number(set.is_warmup) ? " · warm-up" : ""),
          ),
        );
        card.append(main);
        recent.append(card);
      });
      holder.append(recent);
    }
  }

  function renderPrs(prs) {
    const list = $("#pr-list");
    list.replaceChildren();
    if (!prs.length) return list.append(emptyState("PR estimates will appear after your first working sets."));
    prs.forEach((pr) => {
      const row = element("div", "pr-row");
      const copy = element("div");
      copy.append(
        textElement("strong", pr.exercise_name),
        textElement("small", "Heaviest saved: " + formatNumber(pr.heaviest_weight || 0) + " lb"),
      );
      row.append(copy, textElement("b", formatNumber(pr.estimated_one_rm || 0) + " lb e1RM"));
      list.append(row);
    });
  }

  function renderWorkoutHistory(sessions) {
    const list = $("#workout-history");
    list.replaceChildren();
    if (!sessions.length) return list.append(emptyState("No workouts saved yet."));
    sessions.forEach((session) => {
      const card = element("article", "record-card");
      const main = element("div", "record-main");
      const status = session.ended_at ? "Completed" : "Active";
      main.append(
        textElement("strong", session.name || "Workout"),
        textElement(
          "p",
          formatNumber(session.set_count || 0) + " sets · " + status +
            (session.ended_at ? " · " + durationBetween(session.started_at, session.ended_at) : ""),
        ),
      );
      const meta = element("div", "record-meta");
      meta.append(textElement("span", formatDate(session.started_at)));
      main.append(meta);
      card.append(main);
      list.append(card);
    });
  }

  async function startWorkout(event) {
    event.preventDefault();
    const name = $("#workout-name").value.trim();
    if (!name) return;
    const button = $("#workout-start-form button");
    $("#workout-error").textContent = "";
    setBusy(button, true, "Starting…");
    try {
      await api("/api/workouts/start", { method: "POST", body: { name } });
      $("#workout-name").value = "";
      await loadBootstrap({ toast: name + " started." });
      $("#exercise-name").focus();
    } catch (error) {
      $("#workout-error").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  async function logWorkoutSet(event) {
    event.preventDefault();
    const button = $("#workout-set-form button[type=submit]");
    const payload = {
      workout_id: state.data.workouts.active?.id,
      exercise_name: $("#exercise-name").value.trim(),
      weight: optionalNumber($("#set-weight").value),
      reps: optionalNumber($("#set-reps").value),
      rpe: $("#set-rpe").value === "" ? null : optionalNumber($("#set-rpe").value),
      is_warmup: $("#set-warmup").checked,
    };
    $("#workout-error").textContent = "";
    setBusy(button, true, "Logging…");
    try {
      const result = await api("/api/workouts/set", { method: "POST", body: payload });
      $("#set-recommendation").classList.remove("hidden");
      $("#set-recommendation").replaceChildren(
        textElement("strong", result.is_pr ? "New estimated PR" : "Next-set guidance"),
        document.createTextNode(result.recommendation),
      );
      $("#set-reps").value = "";
      $("#set-rpe").value = "";
      $("#set-warmup").checked = false;
      await loadBootstrap();
      $("#exercise-name").value = payload.exercise_name;
      $("#set-weight").value = payload.weight ?? "";
      $("#set-reps").focus();
      showToast(result.is_pr ? "Set saved — new estimated PR." : "Set saved.");
    } catch (error) {
      $("#workout-error").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  async function finishWorkout() {
    const active = state.data.workouts.active;
    if (!active) return;
    if (!window.confirm("Finish and save " + active.name + "?")) return;
    const button = $("#finish-workout");
    setBusy(button, true, "Finishing…");
    try {
      await api("/api/workouts/finish", {
        method: "POST",
        body: { workout_id: active.id },
      });
      $("#set-recommendation").classList.add("hidden");
      await loadBootstrap({ toast: active.name + " finished and saved." });
    } catch (error) {
      $("#workout-error").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  function renderMemories() {
    const memories = state.data.memories || [];
    const filter = $("#memory-filter").value;
    const visible = filter === "all"
      ? memories
      : memories.filter((item) => item.category === filter);
    $("#memory-nav-count").textContent = String(memories.length);
    $("#memory-heading").textContent = filter === "all"
      ? "All memories"
      : capitalize(filter) + " memories";
    const list = $("#memory-list");
    list.replaceChildren();
    if (!visible.length) return list.append(emptyState("No memories in this category."));
    visible.forEach((memory) => {
      const card = element("article", "memory-card");
      const body = element("div", "memory-body");
      const top = element("div", "memory-top");
      top.append(
        textElement("span", memory.category, "category-tag"),
        importanceDots(Number(memory.importance || 0)),
      );
      body.append(top, textElement("p", memory.content));
      const actions = element("div", "memory-actions");
      actions.append(
        actionButton("Edit", "memory-edit", memory.id),
        actionButton("Delete", "memory-delete", memory.id, "danger-text"),
      );
      card.append(body, actions);
      list.append(card);
    });
  }

  async function saveMemory(event) {
    event.preventDefault();
    const button = $("#memory-form button");
    const payload = {
      category: $("#memory-category").value,
      importance: Number($("#memory-importance").value),
      content: $("#memory-content").value.trim(),
    };
    if (!payload.content) return;
    $("#memory-error").textContent = "";
    setBusy(button, true, "Saving…");
    try {
      await api("/api/memories", { method: "POST", body: payload });
      $("#memory-content").value = "";
      $("#memory-importance").value = "3";
      await loadBootstrap({ toast: "Memory saved." });
    } catch (error) {
      $("#memory-error").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  async function handleMemoryAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const id = Number(button.dataset.id);
    const memory = state.data.memories.find((item) => Number(item.id) === id);
    if (!memory) return;
    if (button.dataset.action === "memory-edit") {
      const updated = window.prompt("Edit this memory:", memory.content);
      if (updated === null || !updated.trim() || updated.trim() === memory.content) return;
      setBusy(button, true, "Saving…");
      try {
        await api("/api/memories/" + id, {
          method: "PATCH",
          body: { content: updated.trim() },
        });
        await loadBootstrap({ toast: "Memory updated." });
      } catch (error) {
        showToast(error.message);
      }
      return;
    }
    if (button.dataset.action === "memory-delete") {
      if (!window.confirm("Remove this memory from Silk's future context?")) return;
      setBusy(button, true, "Deleting…");
      try {
        await api("/api/memories/" + id, { method: "DELETE" });
        await loadBootstrap({ toast: "Memory removed." });
      } catch (error) {
        showToast(error.message);
      }
    }
  }

  function renderSettings() {
    const settings = state.data.settings || {};
    $("#owner-name").value = settings.owner_name || "Jaed";
    $("#response-length").value = settings.response_length || "concise";
    $("#monthly-budget").value = settings.monthly_budget_cad || "2";
    const selected = $("input[name=model-mode][value=" + cssEscape(settings.model_mode || "automatic") + "]");
    if (selected) selected.checked = true;
    const labels = {
      efficient: "Routine · GPT-5.6 Luna",
      automatic: "Automatic · Luna / Terra",
      best: "Complex · GPT-5.6 Terra",
    };
    $("#current-model-pill").lastChild.textContent = " " + (labels[settings.model_mode] || labels.automatic);
    renderIntegrations();
  }

  async function saveSettings(event) {
    event.preventDefault();
    const button = $("#settings-form button[type=submit]");
    const checked = $("input[name=model-mode]:checked");
    const payload = {
      owner_name: $("#owner-name").value.trim(),
      model_mode: checked ? checked.value : "automatic",
      response_length: $("#response-length").value,
      monthly_budget_cad: Number($("#monthly-budget").value || 0),
    };
    $("#settings-status").textContent = "";
    setBusy(button, true, "Saving…");
    try {
      const result = await api("/api/settings", { method: "PATCH", body: payload });
      state.data.settings = result.settings;
      renderSettings();
      $("#settings-status").textContent = "Saved";
      $("#greeting").textContent = greeting() + ", " + result.settings.owner_name + ".";
      showToast("Silk's settings were updated.");
    } catch (error) {
      $("#settings-status").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  function renderUsage() {
    const usage = state.data.usage || {};
    const providers = usage.providers || {};
    const openai = providers.openai || {};
    const cloudflare = providers.cloudflare || {};
    const today = (usage.daily || []).find((item) => item.day === new Date().toISOString().slice(0, 10));
    const todayNeurons = Number(today?.neurons || 0);
    const dailyLimit = Number(usage.free_daily_neurons || 10000);
    const cloudflarePercent = Math.min(100, (todayNeurons / dailyLimit) * 100);
    const spend = Number(usage.paid_cost_usd || 0);
    const spendLimit = Number(usage.openai_spend_limit_usd || 0);
    const spendPercent = spendLimit > 0 ? Math.min(100, spend / spendLimit * 100) : 0;
    $("#sidebar-neurons").textContent = formatNumber(todayNeurons) + " neurons";
    $("#sidebar-quota-fill").style.width = cloudflarePercent + "%";
    const panel = $("#usage-panel");
    panel.replaceChildren();
    const main = element("div", "usage-number");
    const left = element("div");
    left.append(
      textElement("span", "OpenAI spend"),
      textElement("strong", formatUsd(spend)),
    );
    main.append(
      left,
      textElement("small", formatCad(usage.paid_cost_cad || 0) + " · " + formatNumber(usage.requests || 0) + " AI requests"),
    );
    const paidQuota = element("div");
    paidQuota.append(
      textElement(
        "div",
        spendLimit > 0
          ? formatUsd(spend) + " / " + formatUsd(spendLimit) + " OpenAI hard stop"
          : "OpenAI hard stop is not configured",
        "quota-line",
      ),
    );
    const paidTrack = element("div", "usage-track");
    const paidFill = element("i");
    paidFill.style.width = spendPercent + "%";
    paidTrack.append(paidFill);
    paidQuota.append(paidTrack);

    const breakdown = element("div", "usage-breakdown");
    [
      ["OpenAI requests", formatNumber(openai.requests || 0)],
      ["Cloudflare requests", formatNumber(cloudflare.requests || 0)],
      ["Input tokens", formatNumber(usage.input_tokens || 0)],
      ["Cached input", formatNumber(usage.cached_input_tokens || 0)],
      ["Output tokens", formatNumber(usage.output_tokens || 0)],
      ["Cloudflare neurons today", formatNumber(todayNeurons) + " / " + formatNumber(dailyLimit)],
      ["Average latency", formatNumber(usage.average_latency_ms || 0) + " ms"],
      ["OpenAI remaining", formatUsd(usage.openai_remaining_usd || 0)],
    ].forEach(([label, value]) => {
      const item = element("div");
      item.append(textElement("span", label), textElement("strong", value));
      breakdown.append(item);
    });
    panel.append(main, paidQuota, breakdown);
  }

  async function refreshUsage() {
    try {
      const result = await api("/api/usage");
      state.data.usage = result.usage;
      renderUsage();
    } catch {
      // Usage display is non-critical to the completed chat request.
    }
  }

  function updateNavigationCounts() {
    $("#study-nav-count").textContent = String(state.data.study?.metrics?.total_sessions || 0);
    $("#memory-nav-count").textContent = String(state.data.memories?.length || 0);
    $("#project-nav-count").textContent = String(
      (state.data.projects || []).filter((item) => ["active", "paused"].includes(item.status)).length,
    );
  }

  function toggleVoice() {
    state.voiceEnabled = !state.voiceEnabled;
    localStorage.setItem("silk-voice", state.voiceEnabled ? "on" : "off");
    if (!state.voiceEnabled && window.speechSynthesis) window.speechSynthesis.cancel();
    updateVoiceControls();
    showToast(state.voiceEnabled
      ? "Browser voice enabled. This is a temporary free voice, not Silk's final voice."
      : "Voice disabled.");
  }

  function updateVoiceControls() {
    const toggle = $("#voice-toggle");
    toggle.textContent = state.voiceEnabled ? "Voice on" : "Voice off";
    toggle.setAttribute("aria-pressed", String(state.voiceEnabled));
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    $("#mic").classList.toggle("hidden", !state.voiceEnabled || !Recognition);
  }

  function toggleRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return showToast("Speech input is not supported by this browser.");
    if (state.recognition) {
      state.recognition.stop();
      return;
    }
    const recognition = new Recognition();
    state.recognition = recognition;
    recognition.lang = "en-CA";
    recognition.interimResults = true;
    recognition.continuous = false;
    $("#mic").classList.add("listening");
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      $("#message").value = transcript.trim();
      resizeComposer();
    };
    recognition.onerror = () => showToast("I could not hear that clearly. Try once more.");
    recognition.onend = () => {
      state.recognition = null;
      $("#mic").classList.remove("listening");
      $("#message").focus();
    };
    recognition.start();
  }

  function speak(text) {
    if (!window.speechSynthesis || !state.voiceEnabled) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(String(text || "").replace(/[*#_]/g, ""));
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((voice) =>
      /samantha|ava|serena|victoria|female/i.test(voice.name) && /^en/i.test(voice.lang)
    ) || voices.find((voice) => /^en-CA|^en-GB/i.test(voice.lang)) ||
      voices.find((voice) => /^en/i.test(voice.lang));
    if (preferred) utterance.voice = preferred;
    utterance.rate = .97;
    utterance.pitch = .96;
    window.speechSynthesis.speak(utterance);
  }

  function resizeComposer() {
    const input = $("#message");
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
  }

  function renderMetricCards(container, cards) {
    container.replaceChildren();
    cards.forEach(([label, value, detail]) => {
      const card = element("div", "metric-card");
      card.append(
        textElement("span", String(label)),
        textElement("strong", String(value)),
        textElement("small", String(detail || "")),
      );
      container.append(card);
    });
  }

  function findWeakestTopic(sessions) {
    let weakest = null;
    (sessions || []).forEach((session) => {
      (session.topics || []).forEach((topic) => {
        const score = Number(topic.score);
        if (topic.score === null || topic.score === undefined || !Number.isFinite(score)) return;
        if (!weakest || score < weakest.score) weakest = { ...topic, score };
      });
    });
    return weakest;
  }

  function importanceDots(count) {
    const holder = element("span", "importance-dots");
    for (let i = 1; i <= 5; i += 1) holder.append(element("i", i <= count ? "on" : ""));
    holder.setAttribute("aria-label", "Importance " + count + " of 5");
    return holder;
  }

  function actionButton(label, action, id, className = "") {
    const button = textElement("button", label, className);
    button.type = "button";
    button.dataset.action = action;
    button.dataset.id = String(id);
    return button;
  }

  function emptyState(text) {
    return textElement("div", text, "empty-state");
  }

  function element(tag, className = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function textElement(tag, text, className = "") {
    const node = element(tag, className);
    node.textContent = String(text ?? "");
    return node;
  }

  function setBusy(button, busy, busyLabel = "") {
    if (!button) return;
    if (busy) {
      button.dataset.normalLabel = button.textContent;
      if (busyLabel) button.textContent = busyLabel;
      button.disabled = true;
    } else {
      if (button.dataset.normalLabel !== undefined) {
        button.textContent = button.dataset.normalLabel;
        delete button.dataset.normalLabel;
      }
      button.disabled = false;
    }
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.remove("hidden");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.add("hidden"), 3300);
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }

  function scrollMessages() {
    const messages = $("#messages");
    messages.scrollTop = messages.scrollHeight;
  }

  function formatDate(timestamp) {
    if (!timestamp) return "Date not recorded";
    const date = new Date(Number(timestamp) * 1000);
    if (Number.isNaN(date.getTime())) return "Date not recorded";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function formatTime(timestamp) {
    if (!timestamp) return "";
    const date = new Date(Number(timestamp) * 1000);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function durationBetween(start, end) {
    const minutes = Math.max(0, Math.round((Number(end) - Number(start)) / 60));
    if (minutes < 60) return minutes + " min";
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return hours + " hr" + (remainder ? " " + remainder + " min" : "");
  }

  function localDateValue() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  }

  function gradeLabel(value) {
    return value === null || value === undefined || value === "" ? "—" : formatNumber(value) + "%";
  }

  function gradeSuffix(value) {
    return value === null || value === undefined || value === "" ? "" : " · " + formatNumber(value) + "%";
  }

  function formatNumber(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(number);
  }

  function formatCad(value) {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
      minimumFractionDigits: Number(value) < 1 ? 2 : 2,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  }

  function formatUsd(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(Number(value || 0));
  }

  function optionalNumber(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function capitalize(value) {
    const text = String(value || "");
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "");
  }

  initialize();
})();
`;

export {
  APP_CSS,
  APP_HTML,
  APP_JS,
  buildOpenAIRequest,
  callAI,
  chooseModel,
  constantTimeEqual,
  extractAIText,
  extractOpenAIText,
  extractOpenAIToolCalls,
  estimateOpenAICost,
  extractJsonObject,
  heuristicStudyDraft,
  normalizeMessage,
  normalizeMemoryKey,
  normalizeMemoryPrivacy,
  selectRelevantMemories,
  localDateKey,
  normalizeSources,
  normalizeStudyDraft,
  parseCookies,
  parseWorkoutSetCommand,
  buildTodayStats,
  calendarEventToDailyItem,
  focusKnowledgeGraph,
  projectTaskStatusForDailyStatus,
  shouldStoreMemoryCandidate,
  shouldSearchWeb,
  trimHistory,
};
