from pathlib import Path

life = Path("worker/silk-life-chat.js")
text = life.read_text()
anchor = '''  if (planned.length) {
    const text = planned.map((item) => `${item.title}${item.scheduled_at ? ` at ${formatClock(Number(item.scheduled_at))}` : ""}`).join("; ");
    return lifePayload(`Your workout plan today is ${text}.`, "workout_status", { workout_items: planned });
  }

  const recent = await db.prepare(`
'''
replacement = '''  if (planned.length) {
    const text = planned.map((item) => `${item.title}${item.scheduled_at ? ` at ${formatClock(Number(item.scheduled_at))}` : ""}`).join("; ");
    return lifePayload(`Your workout plan today is ${text}.`, "workout_status", { workout_items: planned });
  }

  const dayStart = epochForLocal(today, 0, 0);
  const dayEnd = epochForLocal(addDateKey(today, 1), 0, 0);
  const calendarWorkouts = (await db.prepare(`
    SELECT id, title, start_at, end_at, location
    FROM silk_calendar_events_v2
    WHERE category = 'workout' AND start_at >= ?1 AND start_at < ?2
    ORDER BY start_at, id
    LIMIT 4
  `).bind(dayStart, dayEnd).all().catch(() => ({ results: [] }))).results || [];
  if (calendarWorkouts.length) {
    const text = calendarWorkouts.map((item) => `${item.title} at ${formatClock(Number(item.start_at))}`).join("; ");
    return lifePayload(`Your workout plan today is ${text}.`, "workout_status", { calendar_workouts: calendarWorkouts });
  }

  const recent = await db.prepare(`
'''
if "calendar_workouts: calendarWorkouts" not in text:
    if anchor not in text:
        raise SystemExit("Workout status anchor not found")
    text = text.replace(anchor, replacement, 1)
life.write_text(text)

completion = Path("worker/silk-completions.js")
text = completion.read_text()
call_anchor = '''    await db.prepare(`
      UPDATE daily_items
      SET status = ?2, completion_source = ?3,
          completed_at = CASE WHEN ?2 = 'done' THEN ?4 ELSE completed_at END,
          updated_at = ?4
      WHERE id = ?1
    `).bind(Number(row.id), result === "completed" ? "done" : "skipped", source, now).run();
  } else {
'''
call_replacement = '''    await db.prepare(`
      UPDATE daily_items
      SET status = ?2, completion_source = ?3,
          completed_at = CASE WHEN ?2 = 'done' THEN ?4 ELSE completed_at END,
          updated_at = ?4
      WHERE id = ?1
    `).bind(Number(row.id), result === "completed" ? "done" : "skipped", source, now).run();
    if (result === "completed") await syncDailyCompletionToModules(db, row, category, now);
  } else {
'''
if "syncDailyCompletionToModules(db, row, category, now)" not in text:
    if call_anchor not in text:
        raise SystemExit("Daily completion anchor not found")
    text = text.replace(call_anchor, call_replacement, 1)

helper_anchor = "async function buildCompletionSummary(db) {"
helper = r'''async function syncDailyCompletionToModules(db, row, category, now) {
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

'''
if "async function syncDailyCompletionToModules" not in text:
    if helper_anchor not in text:
        raise SystemExit("Completion summary anchor not found")
    text = text.replace(helper_anchor, helper + helper_anchor, 1)
completion.write_text(text)
