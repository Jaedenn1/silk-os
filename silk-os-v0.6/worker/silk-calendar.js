const CATEGORY_VALUES = new Set(["personal", "work", "school", "study", "workout", "appointment", "other"]);
const COMPLETION_VALUES = new Set(["none", "pending", "completed", "not_completed"]);
let schemaReady = false;

export async function handleSilkCalendar(request, env) {
  await ensureCalendarSchema(env.DB);

  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/api/silk-calendar/events") {
    return listEvents(url, env.DB);
  }

  if (request.method === "GET" && path === "/api/silk-calendar/pending") {
    return listPendingCheckins(env.DB);
  }

  if (request.method === "POST" && path === "/api/silk-calendar/events") {
    return createEvent(request, env.DB);
  }

  const match = path.match(/^\/api\/silk-calendar\/events\/(\d+)$/);
  if (match && request.method === "PATCH") {
    return updateEvent(request, env.DB, Number(match[1]));
  }

  if (match && request.method === "DELETE") {
    return deleteEvent(env.DB, Number(match[1]));
  }

  return json({ error: "Calendar route not found." }, 404);
}

async function ensureCalendarSchema(db) {
  if (schemaReady) return;

  await db.exec(`
    CREATE TABLE IF NOT EXISTS silk_calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
      start_at INTEGER NOT NULL,
      end_at INTEGER NOT NULL,
      all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
      location TEXT NOT NULL DEFAULT '' CHECK (length(location) <= 500),
      notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
      category TEXT NOT NULL DEFAULT 'personal'
        CHECK (category IN ('personal', 'work', 'school', 'study', 'workout', 'appointment', 'other')),
      requires_completion INTEGER NOT NULL DEFAULT 0 CHECK (requires_completion IN (0, 1)),
      completion_status TEXT NOT NULL DEFAULT 'none'
        CHECK (completion_status IN ('none', 'pending', 'completed', 'not_completed')),
      source TEXT NOT NULL DEFAULT 'silk' CHECK (length(source) <= 80),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      CHECK (end_at >= start_at)
    );
    CREATE INDEX IF NOT EXISTS idx_silk_calendar_range
      ON silk_calendar_events(start_at, end_at, id);
    CREATE INDEX IF NOT EXISTS idx_silk_calendar_checkins
      ON silk_calendar_events(requires_completion, completion_status, end_at);
  `);

  schemaReady = true;
}

async function listEvents(url, db) {
  const now = Math.floor(Date.now() / 1000);
  const from = parseBoundary(url.searchParams.get("from"), now - 31 * 86400);
  const to = parseBoundary(url.searchParams.get("to"), now + 62 * 86400);

  if (to < from) return json({ error: "The calendar range is invalid." }, 400);
  if (to - from > 370 * 86400) return json({ error: "Calendar ranges are limited to 370 days." }, 400);

  const result = await db.prepare(`
    SELECT * FROM silk_calendar_events
    WHERE start_at < ?2 AND end_at >= ?1
    ORDER BY start_at ASC, id ASC
    LIMIT 1000
  `).bind(from, to).all();

  return json({ events: (result.results || []).map(normalizeRow) });
}

async function listPendingCheckins(db) {
  const now = Math.floor(Date.now() / 1000);
  const result = await db.prepare(`
    SELECT * FROM silk_calendar_events
    WHERE requires_completion = 1
      AND completion_status = 'pending'
      AND end_at <= ?1
    ORDER BY end_at DESC, id DESC
    LIMIT 5
  `).bind(now).all();

  return json({ events: (result.results || []).map(normalizeRow) });
}

async function createEvent(request, db) {
  const body = await readBody(request);
  const event = normalizeInput(body, null);

  const result = await db.prepare(`
    INSERT INTO silk_calendar_events (
      title, start_at, end_at, all_day, location, notes, category,
      requires_completion, completion_status, source, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, unixepoch())
  `).bind(
    event.title,
    event.start_at,
    event.end_at,
    event.all_day,
    event.location,
    event.notes,
    event.category,
    event.requires_completion,
    event.completion_status,
    event.source,
  ).run();

  const id = Number(result.meta?.last_row_id || 0);
  const row = id
    ? await db.prepare("SELECT * FROM silk_calendar_events WHERE id = ?1").bind(id).first()
    : await db.prepare("SELECT * FROM silk_calendar_events ORDER BY id DESC LIMIT 1").first();

  return json({ event: normalizeRow(row) }, 201);
}

async function updateEvent(request, db, id) {
  const current = await db.prepare("SELECT * FROM silk_calendar_events WHERE id = ?1").bind(id).first();
  if (!current) return json({ error: "Calendar event not found." }, 404);

  const body = await readBody(request);
  const event = normalizeInput(body, normalizeRow(current));

  await db.prepare(`
    UPDATE silk_calendar_events
    SET title = ?2,
        start_at = ?3,
        end_at = ?4,
        all_day = ?5,
        location = ?6,
        notes = ?7,
        category = ?8,
        requires_completion = ?9,
        completion_status = ?10,
        source = ?11,
        updated_at = unixepoch()
    WHERE id = ?1
  `).bind(
    id,
    event.title,
    event.start_at,
    event.end_at,
    event.all_day,
    event.location,
    event.notes,
    event.category,
    event.requires_completion,
    event.completion_status,
    event.source,
  ).run();

  const row = await db.prepare("SELECT * FROM silk_calendar_events WHERE id = ?1").bind(id).first();
  return json({ event: normalizeRow(row) });
}

async function deleteEvent(db, id) {
  const result = await db.prepare("DELETE FROM silk_calendar_events WHERE id = ?1").bind(id).run();
  if (!Number(result.meta?.changes || 0)) return json({ error: "Calendar event not found." }, 404);
  return json({ deleted: true });
}

function normalizeInput(body, current) {
  const merged = { ...(current || {}), ...(body || {}) };
  const title = cleanText(merged.title, 240);
  if (!title) throw new CalendarError(400, "Give the event a title.");

  const startAt = parseDate(merged.start_at ?? merged.start);
  const endAt = parseDate(merged.end_at ?? merged.end);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) {
    throw new CalendarError(400, "Start and end times are required.");
  }
  if (endAt < startAt) throw new CalendarError(400, "The event cannot end before it starts.");
  if (endAt - startAt > 31 * 86400) throw new CalendarError(400, "A single event cannot be longer than 31 days.");

  const category = CATEGORY_VALUES.has(String(merged.category || "")) ? String(merged.category) : "personal";
  const requiresCompletion = category === "workout" || merged.requires_completion === true || merged.requires_completion === 1;

  let completionStatus = String(merged.completion_status || (requiresCompletion ? "pending" : "none"));
  if (!COMPLETION_VALUES.has(completionStatus)) completionStatus = requiresCompletion ? "pending" : "none";
  if (!requiresCompletion) completionStatus = "none";
  if (requiresCompletion && completionStatus === "none") completionStatus = "pending";

  return {
    title,
    start_at: startAt,
    end_at: endAt,
    all_day: merged.all_day === true || merged.all_day === 1 ? 1 : 0,
    location: cleanText(merged.location, 500),
    notes: cleanText(merged.notes, 4000),
    category,
    requires_completion: requiresCompletion ? 1 : 0,
    completion_status: completionStatus,
    source: cleanText(merged.source || "silk", 80) || "silk",
  };
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    title: String(row.title || ""),
    start_at: Number(row.start_at),
    end_at: Number(row.end_at),
    all_day: Boolean(row.all_day),
    location: String(row.location || ""),
    notes: String(row.notes || ""),
    category: String(row.category || "personal"),
    requires_completion: Boolean(row.requires_completion),
    completion_status: String(row.completion_status || "none"),
    source: String(row.source || "silk"),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  };
}

function parseBoundary(value, fallback) {
  if (!value) return fallback;
  const parsed = parseDate(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDate(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value !== "string" || !value.trim()) return Number.NaN;
  if (/^\d+$/.test(value.trim())) return parseDate(Number(value));
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Number.NaN;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function readBody(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 20000) throw new CalendarError(413, "Calendar request is too large.");
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
    return body;
  } catch {
    throw new CalendarError(400, "Calendar request must be valid JSON.");
  }
}

export function calendarErrorResponse(error) {
  if (error instanceof CalendarError) return json({ error: error.message }, error.status);
  console.error("SILK calendar error", error);
  return json({ error: "SILK Calendar could not complete that request." }, 500);
}

class CalendarError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
