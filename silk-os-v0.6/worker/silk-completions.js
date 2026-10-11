const HISTORY_TABLE = "silk_completion_history";
const CALENDAR_TABLE = "silk_calendar_events_v2";
const TIME_ZONE = "America/Toronto";
let schemaPromise = null;

export async function handleSilkCompletions(request, env) {
  await ensureSchema(env.DB);
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/completions/pending") {
    await syncCompletionHistory(env.DB);
    return json({ pending: await getPending(env.DB) });
  }

  if (request.method === "GET" && url.pathname === "/api/completions/summary") {
    await syncCompletionHistory(env.DB);
    return json(await buildCompletionSummary(env.DB));
  }

  if (request.method === "GET" && url.pathname === "/api/completions/history") {
    await syncCompletionHistory(env.DB);
    const limit = clampInteger(url.searchParams.get("limit"), 1, 100, 40);
    return json({ history: await getHistory(env.DB, limit) });
  }

  if (request.method === "POST" && url.pathname === "/api/completions/respond") {
    const body = await readBody(request);
    const result = String(body.result || "");
    if (!["completed", "not_completed"].includes(result)) {
      return json({ error: "Completion result must be completed or not_completed." }, 400);
    }
    const pending = normalizePendingInput(body);
    if (!pending) return json({ error: "A valid completion target is required." }, 400);
    const recorded = await applyCompletion(env.DB, pending, result, "today-checkin");
    return json({ ok: true, completion: recorded, summary: await buildCompletionSummary(env.DB) });
  }

  return json({ error: "Completion route not found." }, 404);
}

export async function completeFromChat(message, db) {
  await ensureSchema(db);
  const match = String(message || "").trim().match(
    /^(?:(?:i\s+(?:just\s+)?(?:finished|completed|did))|(?:mark))\s+(.+?)(?:\s+(?:as\s+)?done)?[.!]*$/i,
  );
  if (!match) return null;

  const needle = clean(match[1], 220).replace(/[%_]/g, "").trim();
  if (!needle) return null;

  await syncCompletionHistory(db);
  const pending = await getPending(db);
  let matches = pending.filter((item) => item.title.toLowerCase().includes(needle.toLowerCase()));

  if (!matches.length && await tableExists(db, "daily_items")) {
    const today = localDateKey(Date.now());
    const rows = (await db.prepare(`
      SELECT id, title, source_type, source_id, scheduled_at, duration_minutes
      FROM daily_items
      WHERE date_key = ?1
        AND status NOT IN ('done', 'skipped')
        AND title LIKE ?2
      ORDER BY priority DESC, scheduled_at, id
      LIMIT 4
    `).bind(today, `%${needle}%`).all()).results || [];
    matches = rows.map((row) => dailyItemToPending(row, today));
  }

  if (matches.length === 1) {
    const completion = await applyCompletion(db, matches[0], "completed", "chat");
    const streak = (await buildCompletionSummary(db)).streaks.overall.current;
    return {
      reply: `${completion.title} is marked complete.${streak > 1 ? ` You’re on a ${streak}-day completion streak.` : ""}`,
      provider: "silk",
      model: "SILK Completion Engine",
      model_id: "silk.completions",
      action: "silk_completion_recorded",
      completion,
    };
  }

  if (matches.length > 1) {
    return {
      reply: `I found more than one possible match: ${matches.slice(0, 4).map((item) => item.title).join(", ")}. Tell me the exact one.`,
      provider: "silk",
      model: "SILK Completion Engine",
      model_id: "silk.completions",
      action: "silk_completion_clarification",
    };
  }

  return null;
}

export function completionAchievements(history = [], streaks = {}) {
  const completed = history.filter((item) => item.result === "completed");
  const counts = completed.reduce((map, item) => {
    const category = String(item.category || "general");
    map[category] = (map[category] || 0) + 1;
    return map;
  }, {});
  const overallStreak = Number(streaks?.overall?.current || 0);

  return [
    achievement("first-win", "First Win", "Complete your first tracked commitment.", completed.length >= 1, Math.min(completed.length, 1), 1),
    achievement("momentum-3", "Momentum", "Complete something on 3 consecutive days.", overallStreak >= 3, Math.min(overallStreak, 3), 3),
    achievement("consistency-7", "Seven Strong", "Build a 7-day completion streak.", overallStreak >= 7, Math.min(overallStreak, 7), 7),
    achievement("training-5", "Training Rhythm", "Complete 5 workouts.", Number(counts.workout || 0) >= 5, Math.min(Number(counts.workout || 0), 5), 5),
    achievement("study-5", "Study Rhythm", "Complete 5 study commitments.", Number(counts.study || 0) >= 5, Math.min(Number(counts.study || 0), 5), 5),
    achievement("projects-5", "Closer", "Finish 5 project tasks.", Number(counts.project || 0) >= 5, Math.min(Number(counts.project || 0), 5), 5),
    achievement("reliable-20", "Reliable", "Complete 20 tracked commitments.", completed.length >= 20, Math.min(completed.length, 20), 20),
  ];
}

export function calculateStreaks(history = [], nowMs = Date.now()) {
  const categories = ["overall", "workout", "study", "project"];
  const result = {};
  for (const category of categories) {
    const dates = new Set(
      history
        .filter((item) => item.result === "completed" && (category === "overall" || item.category === category))
        .map((item) => localDateKey(Number(item.occurred_at || 0) * 1000)),
    );
    result[category] = streakForDates(dates, localDateKey(nowMs));
  }
  return result;
}

async function ensureSchema(db) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          instance_key TEXT NOT NULL UNIQUE,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'general',
          title TEXT NOT NULL,
          result TEXT NOT NULL CHECK (result IN ('completed', 'not_completed')),
          occurred_at INTEGER NOT NULL,
          answered_at INTEGER NOT NULL DEFAULT (unixepoch()),
          source TEXT NOT NULL DEFAULT 'silk',
          metadata_json TEXT NOT NULL DEFAULT '{}'
        )
      `).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_silk_completion_date ON ${HISTORY_TABLE}(occurred_at DESC, id DESC)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_silk_completion_category ON ${HISTORY_TABLE}(category, result, occurred_at DESC)`).run();
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

async function syncCompletionHistory(db) {
  const now = Math.floor(Date.now() / 1000);
  const since = now - 120 * 86400;

  if (await tableExists(db, CALENDAR_TABLE)) {
    const rows = (await db.prepare(`
      SELECT id, title, category, completion_status, end_at
      FROM ${CALENDAR_TABLE}
      WHERE end_at >= ?1
        AND completion_status IN ('completed', 'not_completed')
      ORDER BY end_at DESC
      LIMIT 800
    `).bind(since).all()).results || [];
    for (const row of rows) {
      await insertHistory(db, {
        instanceKey: `calendar:${row.id}`,
        entityType: "calendar_event",
        entityId: String(row.id),
        category: normalizeCategory(row.category, row.title),
        title: row.title,
        result: row.completion_status,
        occurredAt: Number(row.end_at || now),
        source: "calendar-sync",
      });
    }
  }

  if (await tableExists(db, "workout_sessions")) {
    const rows = (await db.prepare(`
      SELECT id, name, ended_at FROM workout_sessions
      WHERE ended_at IS NOT NULL AND ended_at >= ?1
      ORDER BY ended_at DESC LIMIT 500
    `).bind(since).all()).results || [];
    for (const row of rows) {
      await insertHistory(db, {
        instanceKey: `workout-session:${row.id}`,
        entityType: "workout_session",
        entityId: String(row.id),
        category: "workout",
        title: clean(row.name, 240) || "Workout",
        result: "completed",
        occurredAt: Number(row.ended_at || now),
        source: "workout-sync",
      });
    }
  }

  if (await tableExists(db, "study_sessions")) {
    const rows = (await db.prepare(`
      SELECT id, subject, session_type, studied_at FROM study_sessions
      WHERE studied_at >= ?1
      ORDER BY studied_at DESC LIMIT 500
    `).bind(since).all()).results || [];
    for (const row of rows) {
      await insertHistory(db, {
        instanceKey: `study-session:${row.id}`,
        entityType: "study_session",
        entityId: String(row.id),
        category: "study",
        title: clean(`${row.session_type || "Study"}: ${row.subject || "Session"}`, 240),
        result: "completed",
        occurredAt: Number(row.studied_at || now),
        source: "study-sync",
      });
    }
  }

  if (await tableExists(db, "project_tasks")) {
    const rows = (await db.prepare(`
      SELECT t.id, t.title, t.completed_at, p.name AS project_name
      FROM project_tasks t JOIN projects p ON p.id = t.project_id
      WHERE t.status = 'done' AND t.completed_at IS NOT NULL AND t.completed_at >= ?1
      ORDER BY t.completed_at DESC LIMIT 500
    `).bind(since).all()).results || [];
    for (const row of rows) {
      await insertHistory(db, {
        instanceKey: `project-task:${row.id}`,
        entityType: "project_task",
        entityId: String(row.id),
        category: "project",
        title: clean(row.title, 240),
        result: "completed",
        occurredAt: Number(row.completed_at || now),
        source: "project-sync",
        metadata: { project: clean(row.project_name, 160) },
      });
    }
  }

  if (await tableExists(db, "daily_items")) {
    const rows = (await db.prepare(`
      SELECT id, title, source_type, status, completed_at, updated_at
      FROM daily_items
      WHERE source_type NOT IN ('calendar', 'project')
        AND status IN ('done', 'skipped')
        AND COALESCE(completed_at, updated_at) >= ?1
      ORDER BY COALESCE(completed_at, updated_at) DESC LIMIT 500
    `).bind(since).all()).results || [];
    for (const row of rows) {
      await insertHistory(db, {
        instanceKey: `daily:${row.id}`,
        entityType: "daily_item",
        entityId: String(row.id),
        category: normalizeCategory(row.source_type, row.title),
        title: clean(row.title, 240),
        result: row.status === "done" ? "completed" : "not_completed",
        occurredAt: Number(row.completed_at || row.updated_at || now),
        source: "today-sync",
      });
    }
  }
}

async function getPending(db) {
  const now = Math.floor(Date.now() / 1000);
  const results = [];

  if (await tableExists(db, CALENDAR_TABLE)) {
    const rows = (await db.prepare(`
      SELECT id, title, category, end_at, completion_status, requires_completion
      FROM ${CALENDAR_TABLE}
      WHERE end_at <= ?1
        AND end_at >= ?2
        AND (requires_completion = 1 OR category IN ('workout', 'study'))
        AND completion_status NOT IN ('completed', 'not_completed')
      ORDER BY end_at DESC, id DESC
      LIMIT 8
    `).bind(now, now - 7 * 86400).all()).results || [];
    for (const row of rows) {
      const key = `calendar:${row.id}`;
      if (await hasHistory(db, key)) continue;
      results.push({
        key,
        entity_type: "calendar_event",
        entity_id: String(row.id),
        title: clean(row.title, 240),
        category: normalizeCategory(row.category, row.title),
        ended_at: Number(row.end_at || now),
        meta: `${prettyCategory(normalizeCategory(row.category, row.title))} · ended ${formatClock(Number(row.end_at || now))}`,
      });
    }
  }

  if (await tableExists(db, "daily_items")) {
    const today = localDateKey(Date.now());
    const rows = (await db.prepare(`
      SELECT id, title, source_type, source_id, scheduled_at, duration_minutes, priority
      FROM daily_items
      WHERE date_key = ?1
        AND status NOT IN ('done', 'skipped')
        AND scheduled_at IS NOT NULL
        AND (scheduled_at + duration_minutes * 60) <= ?2
      ORDER BY priority DESC, scheduled_at DESC, id DESC
      LIMIT 12
    `).bind(today, now).all()).results || [];
    for (const row of rows) {
      if (row.source_type === "calendar") continue;
      const pending = dailyItemToPending(row, today);
      if (pending.entity_type === "daily_item" && !/\b(?:study|review|quiz|exam|workout|gym|training)\b/i.test(row.title || "")) continue;
      if (await hasHistory(db, pending.key)) continue;
      results.push(pending);
    }
  }

  return results.sort((a, b) => Number(b.ended_at || 0) - Number(a.ended_at || 0)).slice(0, 8);
}

function dailyItemToPending(row, dateKey) {
  const endedAt = Number(row.scheduled_at || Math.floor(Date.now() / 1000)) + Number(row.duration_minutes || 30) * 60;
  if (row.source_type === "project" && row.source_id) {
    return {
      key: `project-task:${row.source_id}:${dateKey}`,
      entity_type: "project_task",
      entity_id: String(row.source_id),
      daily_item_id: Number(row.id),
      title: clean(row.title, 240),
      category: "project",
      ended_at: endedAt,
      meta: `Project task · planned by ${formatClock(endedAt)}`,
    };
  }
  const category = normalizeCategory(row.source_type, row.title);
  return {
    key: `daily:${row.id}`,
    entity_type: "daily_item",
    entity_id: String(row.id),
    daily_item_id: Number(row.id),
    title: clean(row.title, 240),
    category,
    ended_at: endedAt,
    meta: `${prettyCategory(category)} · planned block ended ${formatClock(endedAt)}`,
  };
}

async function applyCompletion(db, pending, result, source) {
  await ensureSchema(db);
  const now = Math.floor(Date.now() / 1000);
  let occurredAt = Number(pending.ended_at || now);
  let title = clean(pending.title, 240) || "Commitment";
  let category = normalizeCategory(pending.category, title);
  let instanceKey = clean(pending.key, 300);

  if (pending.entity_type === "calendar_event") {
    if (!await tableExists(db, CALENDAR_TABLE)) throw new CompletionError(404, "Calendar is not initialized yet.");
    const row = await db.prepare(`SELECT id, title, category, end_at FROM ${CALENDAR_TABLE} WHERE id = ?1`).bind(Number(pending.entity_id)).first();
    if (!row) throw new CompletionError(404, "Calendar event not found.");
    title = clean(row.title, 240);
    category = normalizeCategory(row.category, row.title);
    occurredAt = Number(row.end_at || now);
    instanceKey = `calendar:${row.id}`;
    await db.prepare(`
      UPDATE ${CALENDAR_TABLE}
      SET requires_completion = 1, completion_status = ?2, updated_at = ?3
      WHERE id = ?1
    `).bind(Number(row.id), result, now).run();
    if (await tableExists(db, "daily_items")) {
      await db.prepare(`
        UPDATE daily_items
        SET status = ?2,
            completion_source = ?3,
            completed_at = CASE WHEN ?2 = 'done' THEN ?4 ELSE completed_at END,
            updated_at = ?4
        WHERE source_type = 'calendar' AND source_id = ?1
      `).bind(String(row.id), result === "completed" ? "done" : "skipped", source, now).run();
    }
  } else if (pending.entity_type === "project_task") {
    if (!await tableExists(db, "project_tasks")) throw new CompletionError(404, "Project task not found.");
    const row = await db.prepare(`SELECT id, title FROM project_tasks WHERE id = ?1`).bind(Number(pending.entity_id)).first();
    if (!row) throw new CompletionError(404, "Project task not found.");
    title = clean(row.title, 240);
    category = "project";
    const dateKey = localDateKey(Date.now());
    instanceKey = result === "completed"
      ? `project-task:${row.id}`
      : (clean(pending.key, 300) || `project-task:${row.id}:${dateKey}`);
    if (result === "completed") {
      await db.prepare(`UPDATE project_tasks SET status = 'done', completed_at = ?2, updated_at = ?2 WHERE id = ?1`).bind(Number(row.id), now).run();
    } else {
      await db.prepare(`UPDATE project_tasks SET status = 'doing', completed_at = NULL, updated_at = ?2 WHERE id = ?1`).bind(Number(row.id), now).run();
    }
    if (await tableExists(db, "daily_items")) {
      await db.prepare(`
        UPDATE daily_items
        SET status = ?2, completion_source = ?3,
            completed_at = CASE WHEN ?2 = 'done' THEN ?4 ELSE completed_at END,
            updated_at = ?4
        WHERE id = ?1 OR (source_type = 'project' AND source_id = ?5)
      `).bind(Number(pending.daily_item_id || 0), result === "completed" ? "done" : "skipped", source, now, String(row.id)).run();
    }
  } else if (pending.entity_type === "daily_item") {
    if (!await tableExists(db, "daily_items")) throw new CompletionError(404, "Today item not found.");
    const row = await db.prepare(`SELECT id, title, source_type, scheduled_at, duration_minutes FROM daily_items WHERE id = ?1`).bind(Number(pending.entity_id)).first();
    if (!row) throw new CompletionError(404, "Today item not found.");
    title = clean(row.title, 240);
    category = normalizeCategory(row.source_type, row.title);
    occurredAt = Number(row.scheduled_at || now) + Number(row.duration_minutes || 0) * 60;
    instanceKey = `daily:${row.id}`;
    await db.prepare(`
      UPDATE daily_items
      SET status = ?2, completion_source = ?3,
          completed_at = CASE WHEN ?2 = 'done' THEN ?4 ELSE completed_at END,
          updated_at = ?4
      WHERE id = ?1
    `).bind(Number(row.id), result === "completed" ? "done" : "skipped", source, now).run();
    if (result === "completed") await syncDailyCompletionToModules(db, row, category, now);
  } else {
    throw new CompletionError(400, "Unsupported completion target.");
  }

  const record = await insertHistory(db, {
    instanceKey,
    entityType: pending.entity_type,
    entityId: String(pending.entity_id),
    category,
    title,
    result,
    occurredAt,
    source,
    metadata: { daily_item_id: pending.daily_item_id || null },
  }, true);

  await logAction(db,
    result === "completed" ? `completion.${category}.completed` : `completion.${category}.not_completed`,
    title,
    { entity_type: pending.entity_type, entity_id: String(pending.entity_id), category, source },
    result === "completed" ? "completed" : "not_completed",
  );

  return record;
}

async function syncDailyCompletionToModules(db, row, category, now) {
  const id = Number(row.id || 0);
  const title = clean(row.title, 240) || "Session";
  const start = Number(row.scheduled_at || now);
  const duration = Math.max(1, Number(row.duration_minutes || 30));
  const marker = `SILK daily item:${id}`;

  if (category === "study") {
    const existing = await db.prepare(`SELECT id FROM study_sessions WHERE source_text = ?1 LIMIT 1`).bind(marker).first();
    if (!existing) {
      const subject = title.replace(/\s+(?:study|review|session|block)$/i, "").trim() || title;
      await db.prepare(`
        INSERT INTO study_sessions
          (course, subject, session_type, studied_at, duration_minutes, strengths, weaknesses, next_step, source_text, created_at, updated_at)
        VALUES ('SILK', ?1, 'Study session', ?2, ?3, '', '', '', ?4, ?5, ?5)
      `).bind(subject, start, duration, marker, now).run();
    }
    return;
  }

  if (category === "workout") {
    const existing = await db.prepare(`SELECT id FROM workout_sessions WHERE notes = ?1 LIMIT 1`).bind(marker).first();
    if (existing) return;

    const active = await db.prepare(`
      SELECT id FROM workout_sessions
      WHERE ended_at IS NULL AND lower(coalesce(name,'')) = lower(?1)
      ORDER BY started_at DESC, id DESC LIMIT 1
    `).bind(title).first();
    if (active) {
      await db.prepare(`UPDATE workout_sessions SET ended_at = ?2, notes = ?3 WHERE id = ?1`).bind(Number(active.id), now, marker).run();
      return;
    }

    await db.prepare(`
      INSERT INTO workout_sessions (name, started_at, ended_at, notes)
      VALUES (?1, ?2, ?3, ?4)
    `).bind(title, start, start + duration * 60, marker).run();
  }
}

async function buildCompletionSummary(db) {
  await ensureSchema(db);
  const history = await getHistory(db, 400);
  const now = Math.floor(Date.now() / 1000);
  const last7 = history.filter((item) => Number(item.occurred_at) >= now - 7 * 86400);
  const last30 = history.filter((item) => Number(item.occurred_at) >= now - 30 * 86400);
  const streaks = calculateStreaks(history, Date.now());
  const achievements = completionAchievements(history, streaks);
  const seven = rate(last7);
  const thirty = rate(last30);
  const missedByCategory = last30.filter((item) => item.result === "not_completed").reduce((map, item) => {
    map[item.category] = (map[item.category] || 0) + 1;
    return map;
  }, {});
  const missedCategory = Object.entries(missedByCategory).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const completionRate = seven.total ? seven.percent : null;
  const mode = completionRate === null ? "neutral" : completionRate >= 80 ? "building" : completionRate >= 60 ? "steady" : "reset";

  return {
    history: history.slice(0, 30),
    streaks,
    achievements,
    rates: { seven_day: seven, thirty_day: thirty },
    recommendation_signal: {
      mode,
      completion_rate_7d: completionRate,
      missed_category: missedCategory,
      current_streak: streaks.overall.current,
    },
  };
}

async function getHistory(db, limit) {
  const rows = (await db.prepare(`
    SELECT id, instance_key, entity_type, entity_id, category, title, result,
           occurred_at, answered_at, source, metadata_json
    FROM ${HISTORY_TABLE}
    ORDER BY occurred_at DESC, id DESC
    LIMIT ?1
  `).bind(limit).all()).results || [];
  return rows.map((row) => ({
    id: Number(row.id),
    instance_key: String(row.instance_key || ""),
    entity_type: String(row.entity_type || ""),
    entity_id: String(row.entity_id || ""),
    category: String(row.category || "general"),
    title: String(row.title || ""),
    result: String(row.result || "completed"),
    occurred_at: Number(row.occurred_at || 0),
    answered_at: Number(row.answered_at || 0),
    source: String(row.source || "silk"),
    metadata: parseJson(row.metadata_json),
  }));
}

async function insertHistory(db, input, overwrite = false) {
  const now = Math.floor(Date.now() / 1000);
  const values = {
    instanceKey: clean(input.instanceKey, 300),
    entityType: clean(input.entityType, 80),
    entityId: clean(String(input.entityId || ""), 120),
    category: normalizeCategory(input.category, input.title),
    title: clean(input.title, 240) || "Commitment",
    result: input.result === "not_completed" ? "not_completed" : "completed",
    occurredAt: Number.isFinite(Number(input.occurredAt)) ? Number(input.occurredAt) : now,
    source: clean(input.source, 80) || "silk",
    metadata: JSON.stringify(input.metadata || {}),
  };
  if (!values.instanceKey || !values.entityType || !values.entityId) return null;

  if (overwrite) {
    await db.prepare(`
      INSERT INTO ${HISTORY_TABLE} (
        instance_key, entity_type, entity_id, category, title, result,
        occurred_at, answered_at, source, metadata_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
      ON CONFLICT(instance_key) DO UPDATE SET
        category = excluded.category,
        title = excluded.title,
        result = excluded.result,
        occurred_at = excluded.occurred_at,
        answered_at = excluded.answered_at,
        source = excluded.source,
        metadata_json = excluded.metadata_json
    `).bind(values.instanceKey, values.entityType, values.entityId, values.category, values.title, values.result, values.occurredAt, now, values.source, values.metadata).run();
  } else {
    await db.prepare(`
      INSERT OR IGNORE INTO ${HISTORY_TABLE} (
        instance_key, entity_type, entity_id, category, title, result,
        occurred_at, answered_at, source, metadata_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    `).bind(values.instanceKey, values.entityType, values.entityId, values.category, values.title, values.result, values.occurredAt, now, values.source, values.metadata).run();
  }

  const row = await db.prepare(`SELECT * FROM ${HISTORY_TABLE} WHERE instance_key = ?1`).bind(values.instanceKey).first();
  return row ? {
    id: Number(row.id),
    instance_key: String(row.instance_key),
    entity_type: String(row.entity_type),
    entity_id: String(row.entity_id),
    category: String(row.category),
    title: String(row.title),
    result: String(row.result),
    occurred_at: Number(row.occurred_at),
    answered_at: Number(row.answered_at),
    source: String(row.source),
    metadata: parseJson(row.metadata_json),
  } : null;
}

async function hasHistory(db, key) {
  const row = await db.prepare(`SELECT 1 AS yes FROM ${HISTORY_TABLE} WHERE instance_key = ?1 LIMIT 1`).bind(key).first();
  return Boolean(row);
}

async function tableExists(db, name) {
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?1 LIMIT 1").bind(name).first();
  return Boolean(row);
}

async function logAction(db, action, target, detail, status) {
  if (!await tableExists(db, "action_log")) return;
  try {
    await db.prepare(`
      INSERT INTO action_log (provider, action, target, detail_json, status)
      VALUES ('silk', ?1, ?2, ?3, ?4)
    `).bind(action, clean(target, 240), JSON.stringify(detail || {}), clean(status, 40) || "completed").run();
  } catch (error) {
    console.error("Could not log SILK completion activity", error);
  }
}

function normalizePendingInput(body) {
  const entityType = clean(body.entity_type, 80);
  const entityId = clean(String(body.entity_id || ""), 120);
  if (!entityType || !entityId) return null;
  if (!["calendar_event", "project_task", "daily_item"].includes(entityType)) return null;
  return {
    key: clean(body.key, 300),
    entity_type: entityType,
    entity_id: entityId,
    daily_item_id: Number(body.daily_item_id || 0) || null,
    category: clean(body.category, 80),
    title: clean(body.title, 240),
    ended_at: Number(body.ended_at || 0) || null,
  };
}

function normalizeCategory(value, title) {
  const raw = String(value || "").toLowerCase();
  const text = `${raw} ${String(title || "").toLowerCase()}`;
  if (/workout|gym|training|fitness/.test(text)) return "workout";
  if (/study|school|review|quiz|exam|anatomy|nursing/.test(text)) return "study";
  if (/project/.test(text)) return "project";
  if (/work|shift|hospital|dct|clean team|er\b/.test(text)) return "work";
  if (/appointment|doctor|dentist/.test(text)) return "appointment";
  return raw && raw !== "manual" ? raw : "general";
}

function prettyCategory(category) {
  return String(category || "general").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function rate(history) {
  const completed = history.filter((item) => item.result === "completed").length;
  const missed = history.filter((item) => item.result === "not_completed").length;
  const total = completed + missed;
  return { completed, missed, total, percent: total ? Math.round((completed / total) * 100) : null };
}

function achievement(id, title, description, unlocked, progress, target) {
  return { id, title, description, unlocked: Boolean(unlocked), progress: Number(progress || 0), target: Number(target || 1) };
}

function streakForDates(dates, todayKey) {
  if (!dates.size) return { current: 0, best: 0 };
  const sorted = [...dates].sort();
  let best = 0;
  let run = 0;
  let previous = null;
  for (const key of sorted) {
    if (previous && addDateKey(previous, 1) === key) run += 1;
    else run = 1;
    best = Math.max(best, run);
    previous = key;
  }

  let anchor = dates.has(todayKey) ? todayKey : addDateKey(todayKey, -1);
  if (!dates.has(anchor)) return { current: 0, best };
  let current = 0;
  while (dates.has(anchor)) {
    current += 1;
    anchor = addDateKey(anchor, -1);
  }
  return { current, best };
}

function localDateKey(milliseconds) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(milliseconds));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDateKey(key, days) {
  const [year, month, day] = String(key).split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function formatClock(epoch) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(Number(epoch || 0) * 1000));
}

function parseJson(value) {
  try { return JSON.parse(String(value || "{}")); }
  catch { return {}; }
}

function clean(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

async function readBody(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 20000) throw new CompletionError(413, "Completion request is too large.");
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
    return body;
  } catch {
    throw new CompletionError(400, "Completion request must be valid JSON.");
  }
}

export function completionErrorResponse(error) {
  if (error instanceof CompletionError) return json({ error: error.message }, error.status);
  console.error("SILK completion error", error);
  return json({ error: "SILK could not update completion history." }, 500);
}

class CompletionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
