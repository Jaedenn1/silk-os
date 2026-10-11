const TIME_ZONE = "America/Toronto";
const OBSERVATION_TABLE = "silk_time_observations";
const PREP_TABLE = "silk_prep_tracking";
const DEFAULT_PREP = { work: 30, school: 30, study: 10, workout: 15, appointment: 20, personal: 10, other: 10 };
let schemaPromise = null;

export async function handleSilkTimeEngine(request, env) {
  await ensureSchema(env.DB);
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/time-engine/profile") {
    return json(await buildAdaptiveTimeProfile(env.DB));
  }

  if (request.method === "POST" && url.pathname === "/api/time-engine/observe") {
    const body = await readBody(request);
    const kind = clean(body.kind, 40);
    if (!new Set(["travel_estimate", "duration"]).has(kind)) throw new TimeEngineError(400, "Unsupported timing observation.");
    const actual = boundedMinutes(body.actual_minutes, true);
    const planned = body.planned_minutes == null ? null : boundedMinutes(body.planned_minutes, true);
    if (!actual) throw new TimeEngineError(400, "A measured duration is required.");
    const category = normalizeCategory(body.category);
    const context = clean(body.context_key, 180);
    const record = await insertObservation(env.DB, {
      kind,
      category,
      context,
      planned,
      actual,
      metadata: objectOnly(body.metadata),
      occurredAt: Number(body.occurred_at) || Math.floor(Date.now() / 1000),
    });
    return json({ observation: record, profile: await buildAdaptiveTimeProfile(env.DB) });
  }

  if (request.method === "POST" && url.pathname === "/api/time-engine/prep/start") {
    const body = await readBody(request);
    const eventId = Number(body.event_id);
    if (!Number.isFinite(eventId) || eventId <= 0) throw new TimeEngineError(400, "A Calendar event is required to start prep tracking.");
    const now = Math.floor(Date.now() / 1000);
    const category = normalizeCategory(body.category);
    const planned = boundedMinutes(body.planned_minutes, false) || DEFAULT_PREP[category] || 10;
    const title = clean(body.title, 240) || "Calendar event";
    await env.DB.prepare(`
      INSERT INTO ${PREP_TABLE} (event_id, title, category, planned_minutes, started_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?5)
      ON CONFLICT(event_id) DO UPDATE SET title=excluded.title, category=excluded.category,
        planned_minutes=excluded.planned_minutes, started_at=excluded.started_at, updated_at=excluded.updated_at
    `).bind(eventId, title, category, planned, now).run();
    await logAction(env.DB, "time.prep.started", title, { event_id: eventId, category, planned_minutes: planned });
    return json({ active_prep: { event_id: eventId, title, category, planned_minutes: planned, started_at: now } });
  }

  if (request.method === "POST" && url.pathname === "/api/time-engine/prep/finish") {
    const body = await readBody(request);
    const eventId = Number(body.event_id);
    if (!Number.isFinite(eventId) || eventId <= 0) throw new TimeEngineError(400, "A Calendar event is required to finish prep tracking.");
    const row = await env.DB.prepare(`SELECT event_id, title, category, planned_minutes, started_at FROM ${PREP_TABLE} WHERE event_id=?1`).bind(eventId).first();
    if (!row) throw new TimeEngineError(404, "SILK is not currently timing prep for that event.");
    const now = Math.floor(Date.now() / 1000);
    const actual = Math.max(1, Math.min(240, Math.round((now - Number(row.started_at || now)) / 60)));
    await insertObservation(env.DB, {
      kind: "prep",
      category: normalizeCategory(row.category),
      context: clean(row.title, 180),
      planned: Number(row.planned_minutes || 0) || null,
      actual,
      metadata: { event_id: eventId },
      occurredAt: now,
    });
    await env.DB.prepare(`DELETE FROM ${PREP_TABLE} WHERE event_id=?1`).bind(eventId).run();
    await logAction(env.DB, "time.prep.measured", clean(row.title, 240), { event_id: eventId, planned_minutes: row.planned_minutes, actual_minutes: actual });
    return json({ measured_minutes: actual, profile: await buildAdaptiveTimeProfile(env.DB) });
  }

  return json({ error: "Time Engine route not found." }, 404);
}

export async function buildAdaptiveTimeProfile(db) {
  await ensureSchema(db);
  const now = Math.floor(Date.now() / 1000);
  const since = now - 90 * 86400;

  const observations = (await db.prepare(`
    SELECT id, kind, category, context_key, planned_minutes, actual_minutes, occurred_at, metadata_json
    FROM ${OBSERVATION_TABLE}
    WHERE occurred_at >= ?1
    ORDER BY occurred_at DESC, id DESC
    LIMIT 1000
  `).bind(since).all()).results || [];

  const prepByCategory = {};
  for (const [category, fallback] of Object.entries(DEFAULT_PREP)) {
    const samples = observations
      .filter((row) => row.kind === "prep" && normalizeCategory(row.category) === category)
      .map((row) => Number(row.actual_minutes))
      .filter((value) => Number.isFinite(value) && value > 0)
      .slice(0, 30);
    const learned = samples.length >= 2;
    prepByCategory[category] = {
      minutes: learned ? robustMinutes(samples, fallback) : fallback,
      default_minutes: fallback,
      samples: samples.length,
      confidence: confidence(samples.length),
      learned,
    };
  }

  const travelGroups = new Map();
  for (const row of observations.filter((item) => item.kind === "travel_estimate" && item.context_key)) {
    const key = String(row.context_key).trim().toLowerCase();
    if (!key) continue;
    const group = travelGroups.get(key) || { context: String(row.context_key).trim(), values: [] };
    if (group.values.length < 40) group.values.push(Number(row.actual_minutes));
    travelGroups.set(key, group);
  }
  const travelByContext = [...travelGroups.values()]
    .map((group) => ({
      context: group.context,
      minutes: robustMinutes(group.values.filter((value) => Number.isFinite(value) && value > 0), 30),
      samples: group.values.length,
      confidence: confidence(group.values.length),
    }))
    .filter((group) => group.samples > 0)
    .sort((a, b) => b.samples - a.samples)
    .slice(0, 12);

  const studyRows = (await db.prepare(`
    SELECT studied_at, duration_minutes FROM study_sessions
    WHERE studied_at >= ?1 AND duration_minutes IS NOT NULL AND duration_minutes > 0
    ORDER BY studied_at DESC, id DESC LIMIT 240
  `).bind(since).all().catch(() => ({ results: [] }))).results || [];
  const studyDurations = studyRows.map((row) => Number(row.duration_minutes)).filter((value) => Number.isFinite(value) && value > 0 && value <= 360);
  const studyHours = studyRows.map((row) => localHour(Number(row.studied_at || 0) * 1000)).filter(Number.isFinite);

  const workoutRows = (await db.prepare(`
    SELECT started_at, ended_at FROM workout_sessions
    WHERE started_at >= ?1 AND ended_at IS NOT NULL AND ended_at > started_at
    ORDER BY started_at DESC, id DESC LIMIT 240
  `).bind(since).all().catch(() => ({ results: [] }))).results || [];
  const workoutDurations = workoutRows
    .map((row) => Math.round((Number(row.ended_at) - Number(row.started_at)) / 60))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 360);
  const workoutHours = workoutRows.map((row) => localHour(Number(row.started_at || 0) * 1000)).filter(Number.isFinite);

  const durationPairs = observations
    .filter((row) => row.kind === "duration" && Number(row.planned_minutes) > 0 && Number(row.actual_minutes) > 0)
    .slice(0, 80);
  const ratios = durationPairs
    .map((row) => Number(row.actual_minutes) / Number(row.planned_minutes))
    .filter((value) => Number.isFinite(value) && value >= 0.25 && value <= 4);
  const factor = ratios.length >= 2 ? round2(median(ratios)) : null;
  const underestimationLabel = factor == null
    ? "SILK needs matched planned vs actual durations."
    : factor > 1.12
      ? `Tasks are running about ${Math.round((factor - 1) * 100)}% longer than planned.`
      : factor < 0.88
        ? `Tasks are finishing about ${Math.round((1 - factor) * 100)}% faster than planned.`
        : "Planned durations are tracking close to reality.";

  const activePrep = await db.prepare(`
    SELECT event_id, title, category, planned_minutes, started_at
    FROM ${PREP_TABLE}
    ORDER BY started_at DESC LIMIT 1
  `).first().catch(() => null);

  return {
    generated_at: now,
    prep_by_category: prepByCategory,
    travel_by_context: travelByContext,
    study: {
      average_minutes: studyDurations.length ? robustMinutes(studyDurations, 45) : null,
      recommended_minutes: studyDurations.length >= 3 ? clampToFive(robustMinutes(studyDurations, 45), 20, 120) : 45,
      samples: studyDurations.length,
      preferred_start_hour: studyHours.length >= 3 ? modeHour(studyHours) : null,
    },
    workout: {
      average_minutes: workoutDurations.length ? robustMinutes(workoutDurations, 60) : null,
      recommended_minutes: workoutDurations.length >= 3 ? clampToFive(robustMinutes(workoutDurations, 60), 25, 150) : 60,
      samples: workoutDurations.length,
      preferred_start_hour: workoutHours.length >= 3 ? modeHour(workoutHours) : null,
    },
    underestimation: {
      factor,
      samples: ratios.length,
      label: underestimationLabel,
    },
    active_prep: activePrep ? {
      event_id: Number(activePrep.event_id),
      title: String(activePrep.title || ""),
      category: normalizeCategory(activePrep.category),
      planned_minutes: Number(activePrep.planned_minutes || 0),
      started_at: Number(activePrep.started_at || 0),
    } : null,
    evidence: {
      prep_samples: observations.filter((row) => row.kind === "prep").length,
      travel_samples: observations.filter((row) => row.kind === "travel_estimate").length,
      duration_pairs: ratios.length,
      study_sessions: studyDurations.length,
      workout_sessions: workoutDurations.length,
    },
  };
}

export async function recordDurationObservation(db, { category = "other", context = "", planned, actual, occurredAt = null } = {}) {
  await ensureSchema(db);
  const plannedMinutes = boundedMinutes(planned, true);
  const actualMinutes = boundedMinutes(actual, true);
  if (!plannedMinutes || !actualMinutes) return null;
  return insertObservation(db, {
    kind: "duration",
    category: normalizeCategory(category),
    context: clean(context, 180),
    planned: plannedMinutes,
    actual: actualMinutes,
    metadata: {},
    occurredAt: Number(occurredAt) || Math.floor(Date.now() / 1000),
  });
}

export function sampleConfidence(samples) {
  return confidence(samples);
}

async function insertObservation(db, input) {
  const result = await db.prepare(`
    INSERT INTO ${OBSERVATION_TABLE}
      (kind, category, context_key, planned_minutes, actual_minutes, occurred_at, metadata_json)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  `).bind(
    input.kind,
    input.category || "other",
    input.context || "",
    input.planned == null ? null : Number(input.planned),
    Number(input.actual),
    Number(input.occurredAt || Math.floor(Date.now() / 1000)),
    JSON.stringify(input.metadata || {}),
  ).run();
  return { id: Number(result?.meta?.last_row_id || 0), ...input };
}

async function ensureSchema(db) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS ${OBSERVATION_TABLE} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'other',
          context_key TEXT NOT NULL DEFAULT '',
          planned_minutes REAL,
          actual_minutes REAL NOT NULL,
          occurred_at INTEGER NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_silk_time_observations_kind ON ${OBSERVATION_TABLE}(kind, category, occurred_at DESC)`).run();
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS ${PREP_TABLE} (
          event_id INTEGER PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'other',
          planned_minutes INTEGER NOT NULL DEFAULT 10,
          started_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `).run();
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

export function robustMinutes(values, fallback) {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!valid.length) return fallback;
  if (valid.length < 5) return Math.max(1, Math.round(median(valid)));
  const trim = Math.max(1, Math.floor(valid.length * 0.1));
  const trimmed = valid.slice(trim, valid.length - trim);
  const sample = trimmed.length ? trimmed : valid;
  return Math.max(1, Math.round(sample.reduce((sum, value) => sum + value, 0) / sample.length));
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function modeHour(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
}

function confidence(samples) {
  if (samples >= 8) return "strong";
  if (samples >= 3) return "useful";
  return "learning";
}

function localHour(milliseconds) {
  if (!milliseconds) return Number.NaN;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, hourCycle: "h23", hour: "2-digit" }).formatToParts(new Date(milliseconds));
  return Number(parts.find((part) => part.type === "hour")?.value);
}

function clampToFive(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value / 5) * 5));
}

function boundedMinutes(value, allowZero) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const min = allowZero ? 0 : 1;
  if (number < min || number > 1440) return null;
  return Math.round(number * 10) / 10;
}

function normalizeCategory(value) {
  const category = clean(value, 40).toLowerCase();
  return Object.prototype.hasOwnProperty.call(DEFAULT_PREP, category) ? category : "other";
}

function objectOnly(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function clean(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function readBody(request) {
  try { return await request.json(); }
  catch { throw new TimeEngineError(400, "A valid JSON body is required."); }
}

async function logAction(db, action, target, detail) {
  try {
    await db.prepare(`INSERT INTO action_log (provider, action, target, detail_json, status) VALUES ('silk', ?1, ?2, ?3, 'completed')`)
      .bind(action, clean(target, 240), JSON.stringify(detail || {})).run();
  } catch (error) {
    console.error("Could not log SILK Time Engine action", error);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

export class TimeEngineError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function timeEngineErrorResponse(error) {
  const status = error instanceof TimeEngineError ? error.status : 500;
  return json({ error: error instanceof Error ? error.message : "SILK Time Engine failed." }, status);
}
