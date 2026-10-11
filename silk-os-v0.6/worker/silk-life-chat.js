const TIME_ZONE = "America/Toronto";
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export async function tryHandleSilkLifeChat(request, env) {
  if (request.method !== "POST") return null;
  const url = new URL(request.url);
  if (!["/api/chat", "/api/chat/stream"].includes(url.pathname)) return null;

  const body = await request.clone().json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return null;

  const intent = lifeIntent(message);
  if (!intent) return null;

  let payload = null;
  if (intent === "study_recommend") payload = await recommendStudy(env.DB);
  else if (intent === "study_start") payload = await startStudyBlock(message, env.DB);
  else if (intent === "study_status") payload = await studyStatus(env.DB);
  else if (intent === "workout_status") payload = await workoutStatus(env.DB);
  else if (intent === "workout_start") payload = await startWorkout(message, env.DB);
  else if (intent === "workout_finish") payload = await finishWorkout(message, env.DB);
  else if (intent === "project_add_task") payload = await addProjectTask(message, env.DB);
  else if (intent === "project_reschedule") payload = await rescheduleProjectTask(message, env.DB);
  else if (intent === "project_read") payload = await projectRead(message, env.DB);

  if (!payload) return null;
  await saveConversation(env.DB, message, payload.reply);
  return url.pathname === "/api/chat/stream" ? streamResponse(payload) : json(payload);
}

export function lifeIntent(message) {
  const text = String(message || "").trim();
  if (!text) return null;

  // Calendar owns scheduled workout/study moves. Life Control owns project-task due dates.
  if (/\b(?:move|reschedule|push)\b/i.test(text)) {
    if (/\b(?:project\s+task|task)\b/i.test(text)) return "project_reschedule";
    return null;
  }

  if (/\b(?:add|create)\b[\s\S]{0,40}\btask\b[\s\S]{0,220}\bto\b/i.test(text)) return "project_add_task";

  if (/\bwhat should i study\b|\bwhat (?:do|should) i review\b|\bweakest (?:study )?topics?\b|\bwhat should i learn next\b/i.test(text)) {
    return "study_recommend";
  }
  if (/\b(?:what did i study|study history|recent study|last study session|how much did i study)\b/i.test(text)) return "study_status";
  if (/\b(?:start|begin)\b[\s\S]{0,180}\b(?:study|review|anatomy|session|block)\b/i.test(text) && !/\bworkout\b/i.test(text)) {
    return "study_start";
  }

  if (/\b(?:finish|end|complete)\b[\s\S]{0,120}\b(?:workout|gym|training|full body|leg day|push day|pull day|upper body|lower body)\b/i.test(text) ||
      /\b(?:workout|gym|training)\b[\s\S]{0,100}\b(?:finished|done|complete)\b/i.test(text)) {
    return "workout_finish";
  }
  if (/\b(?:start|begin)\b[\s\S]{0,160}\b(?:workout|gym|training|full body|leg day|push day|pull day|upper body|lower body)\b/i.test(text) ||
      /\b(?:start|begin)\s+(?:full body|leg day|push day|pull day|upper body|lower body)\b/i.test(text)) {
    return "workout_start";
  }
  if (/\b(?:workout|gym|training|full body|leg day|push day|pull day|upper body|lower body)\b/i.test(text) &&
      /\b(?:what|which|active|doing|planned|today|current)\b/i.test(text)) {
    return "workout_status";
  }

  if (/\bwhat project should i work on\b|\bwhat should i work on(?: right now)?\b|\bwhat(?:'s| is) left on\b|\bwhat remains on\b|\bproject status\b|\bopen project tasks?\b/i.test(text)) {
    return "project_read";
  }
  return null;
}

async function recommendStudy(db) {
  const weakest = await db.prepare(`
    SELECT t.topic, t.score, t.improvement_notes, s.subject, s.next_step, s.studied_at
    FROM study_topics t
    JOIN study_sessions s ON s.id = t.session_id
    WHERE t.score IS NOT NULL
    ORDER BY t.score ASC, s.studied_at DESC, t.id DESC
    LIMIT 5
  `).all().catch(() => ({ results: [] }));
  const topics = weakest.results || [];

  if (topics.length) {
    const lead = topics[0];
    const next = clean(lead.next_step, 300) || clean(lead.improvement_notes, 300);
    const alternates = topics.slice(1, 3).map((row) => row.topic).filter(Boolean);
    const extra = alternates.length ? ` After that: ${alternates.join(" and ")}.` : "";
    const why = Number.isFinite(Number(lead.score)) ? ` Your latest tracked score there is ${Math.round(Number(lead.score))}%.` : "";
    const step = next ? ` Next step: ${next}.` : "";
    return lifePayload(`Study ${lead.topic || lead.subject || "your weakest topic"} next.${why}${step}${extra}`, "study_recommended", {
      study_recommendation: { topic: lead.topic, subject: lead.subject, score: lead.score, next_step: next || null },
    });
  }

  const latest = await db.prepare(`
    SELECT subject, weaknesses, next_step, studied_at
    FROM study_sessions
    ORDER BY studied_at DESC, id DESC
    LIMIT 1
  `).first().catch(() => null);
  if (latest) {
    const focus = clean(latest.next_step, 300) || clean(latest.weaknesses, 300) || clean(latest.subject, 180);
    return lifePayload(`Your best next study target is ${focus}. I don’t have scored topic data yet, so I’m using your most recent study session.`, "study_recommended");
  }
  return lifePayload("I don’t have enough Study history yet to identify a weak topic. Start a study block or log a session and I’ll build the recommendation from real results.", "study_recommended");
}

async function startStudyBlock(message, db) {
  const duration = extractDurationMinutes(message, 45);
  const subject = extractStudySubject(message) || "Study";
  const now = Math.floor(Date.now() / 1000);
  const dateKey = localDateKey(Date.now());
  const title = /\b(?:study|review)\b/i.test(subject) ? subject : `${subject} study`;
  const result = await db.prepare(`
    INSERT INTO daily_items
      (date_key, title, kind, source_type, source_id, status, scheduled_at, duration_minutes, priority, notes, updated_at)
    VALUES (?1, ?2, 'task', 'study', NULL, 'doing', ?3, ?4, 4, 'Started from Ask SILK', ?3)
  `).bind(dateKey, clean(title, 300), now, duration).run();
  const id = Number(result?.meta?.last_row_id || 0);
  await logAction(db, "study.block.started", title, { daily_item_id: id || null, duration_minutes: duration, subject });
  return lifePayload(`${title} is started for ${duration} minutes. I’ll surface a completion check-in after the block ends.`, "study_started", {
    daily_item: { id: id || null, title, source_type: "study", status: "doing", scheduled_at: now, duration_minutes: duration },
  });
}

async function studyStatus(db) {
  const rows = (await db.prepare(`
    SELECT id, subject, session_type, studied_at, duration_minutes, overall_grade, next_step
    FROM study_sessions
    ORDER BY studied_at DESC, id DESC
    LIMIT 5
  `).all().catch(() => ({ results: [] }))).results || [];
  if (!rows.length) return lifePayload("You don’t have any completed Study sessions logged yet.", "study_status");
  const total = rows.reduce((sum, row) => sum + Number(row.duration_minutes || 0), 0);
  const recent = rows.slice(0, 3).map((row) => `${row.subject || "Study"}${row.duration_minutes ? ` (${row.duration_minutes} min)` : ""}`).join("; ");
  return lifePayload(`Your recent Study sessions: ${recent}.${total ? ` The last ${rows.length} logged sessions total ${total} minutes.` : ""}`, "study_status", { study_sessions: rows });
}

async function workoutStatus(db) {
  const active = await db.prepare(`
    SELECT id, name, started_at, notes
    FROM workout_sessions
    WHERE ended_at IS NULL
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `).first().catch(() => null);
  if (active) {
    return lifePayload(`${active.name || "Workout"} is currently active. You started it at ${formatClock(Number(active.started_at))}.`, "workout_status", { workout_session: active });
  }

  const today = localDateKey(Date.now());
  const planned = (await db.prepare(`
    SELECT id, title, status, scheduled_at, duration_minutes
    FROM daily_items
    WHERE date_key = ?1 AND source_type = 'workout' AND status NOT IN ('done','skipped')
    ORDER BY scheduled_at IS NULL, scheduled_at, priority DESC, id
    LIMIT 3
  `).bind(today).all().catch(() => ({ results: [] }))).results || [];
  if (planned.length) {
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
    SELECT id, name, started_at, ended_at
    FROM workout_sessions
    WHERE ended_at IS NOT NULL
    ORDER BY ended_at DESC, id DESC
    LIMIT 1
  `).first().catch(() => null);
  return recent
    ? lifePayload(`You don’t have an active workout right now. Your most recent completed session was ${recent.name || "Workout"}.`, "workout_status", { workout_session: recent })
    : lifePayload("You don’t have an active or tracked workout yet today.", "workout_status");
}

async function startWorkout(message, db) {
  const active = await db.prepare(`SELECT id, name, started_at FROM workout_sessions WHERE ended_at IS NULL ORDER BY started_at DESC, id DESC LIMIT 1`).first().catch(() => null);
  if (active) {
    return lifePayload(`${active.name || "Workout"} is already active. Finish it before starting another workout.`, "workout_already_active", { workout_session: active });
  }
  const name = extractWorkoutName(message) || "Workout";
  const now = Math.floor(Date.now() / 1000);
  const result = await db.prepare(`INSERT INTO workout_sessions (name, started_at, notes) VALUES (?1, ?2, 'Started from Ask SILK')`).bind(clean(name, 100), now).run();
  const id = Number(result?.meta?.last_row_id || 0);
  await logAction(db, "workout.started", name, { workout_id: id || null });
  return lifePayload(`${name} is started. I’m tracking it as your active workout.`, "workout_started", {
    workout_session: { id: id || null, name, started_at: now, ended_at: null },
  });
}

async function finishWorkout(message, db) {
  const active = await db.prepare(`SELECT id, name, started_at FROM workout_sessions WHERE ended_at IS NULL ORDER BY started_at DESC, id DESC LIMIT 1`).first().catch(() => null);
  if (!active) return lifePayload("You don’t have an active workout to finish.", "workout_no_active");
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`UPDATE workout_sessions SET ended_at = ?2 WHERE id = ?1`).bind(Number(active.id), now).run();
  const minutes = Math.max(1, Math.round((now - Number(active.started_at || now)) / 60));
  await logAction(db, "workout.completed", active.name || "Workout", { workout_id: active.id, duration_minutes: minutes, message: clean(message, 300) });
  return lifePayload(`${active.name || "Workout"} is complete — ${minutes} minutes tracked.`, "workout_completed", {
    workout_session: { ...active, ended_at: now, duration_minutes: minutes },
  });
}

async function projectRead(message, db) {
  const projects = (await db.prepare(`
    SELECT p.id, p.name, p.description, p.status, p.priority, p.due_at,
           SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done_tasks,
           SUM(CASE WHEN t.status != 'done' THEN 1 ELSE 0 END) AS open_tasks,
           COUNT(t.id) AS task_count
    FROM projects p
    LEFT JOIN project_tasks t ON t.project_id = p.id
    WHERE p.status IN ('active','paused')
    GROUP BY p.id
    ORDER BY p.status = 'active' DESC, p.priority DESC, p.due_at IS NULL, p.due_at, p.updated_at DESC
  `).all().catch(() => ({ results: [] }))).results || [];
  if (!projects.length) return lifePayload("You don’t have any active SILK projects yet.", "project_status");

  const named = bestNamedProject(message, projects);
  const project = named || projects.find((item) => Number(item.open_tasks || 0) > 0) || projects[0];
  const tasks = (await db.prepare(`
    SELECT id, title, status, due_at, sort_order
    FROM project_tasks
    WHERE project_id = ?1 AND status != 'done'
    ORDER BY status = 'doing' DESC, due_at IS NULL, due_at, sort_order, id
    LIMIT 8
  `).bind(Number(project.id)).all().catch(() => ({ results: [] }))).results || [];

  if (/\bwhat project should i work on\b|\bwhat should i work on(?: right now)?\b/i.test(message)) {
    const task = tasks[0];
    const reply = task
      ? `Work on “${task.title}” next in ${project.name}. It’s the highest-priority open task in your strongest active project right now.`
      : `${project.name} is your highest-priority active project, but it has no open tasks.`;
    return lifePayload(reply, "project_recommended", { project, project_task: task || null });
  }

  const progress = Number(project.task_count || 0) ? `${Number(project.done_tasks || 0)}/${Number(project.task_count || 0)} tasks complete` : "no tasks tracked yet";
  if (!tasks.length) return lifePayload(`${project.name}: ${progress}. There are no open tasks left.`, "project_status", { project, project_tasks: [] });
  return lifePayload(`${project.name}: ${progress}. Still open: ${tasks.slice(0, 6).map((task) => task.title).join("; ")}.`, "project_status", { project, project_tasks: tasks });
}

async function addProjectTask(message, db) {
  const parsed = parseAddTask(message);
  if (!parsed.task || !parsed.project) return lifePayload("Tell me the task and project, like: “Add task polish Ask SILK to Build Silk.”", "project_clarification");
  const projects = (await db.prepare(`SELECT id, name, status, priority FROM projects WHERE status IN ('active','paused') ORDER BY priority DESC, updated_at DESC`).all().catch(() => ({ results: [] }))).results || [];
  const project = bestNamedProject(parsed.project, projects);
  if (!project) return lifePayload(`I couldn’t find an active project matching “${parsed.project}”.`, "project_not_found");
  const order = await db.prepare(`SELECT COALESCE(MAX(sort_order),0) AS max_order FROM project_tasks WHERE project_id = ?1`).bind(Number(project.id)).first().catch(() => ({ max_order: 0 }));
  const now = Math.floor(Date.now() / 1000);
  const result = await db.prepare(`
    INSERT INTO project_tasks (project_id, title, notes, status, sort_order, created_at, updated_at)
    VALUES (?1, ?2, '', 'todo', ?3, ?4, ?4)
  `).bind(Number(project.id), clean(parsed.task, 300), Number(order?.max_order || 0) + 1, now).run();
  const id = Number(result?.meta?.last_row_id || 0);
  await logAction(db, "project.task.created", parsed.task, { project_id: project.id, project_name: project.name, task_id: id || null });
  return lifePayload(`Added “${parsed.task}” to ${project.name}.`, "project_task_created", { project, project_task: { id: id || null, title: parsed.task, status: "todo" } });
}

async function rescheduleProjectTask(message, db) {
  const dateKey = resolveDateKey(message);
  if (!dateKey) return lifePayload("What day should I move that project task to?", "project_clarification");
  const label = extractTaskMoveLabel(message);
  let task = null;
  if (!label || /^(?:that|it|this)$/i.test(label)) task = await recentReferencedTask(db);
  else task = await findOpenTask(db, label);
  if (!task) return lifePayload(`I couldn’t identify the open project task you want to move. Name the task explicitly and I’ll move it.`, "project_task_not_found");

  const dueAt = epochForLocal(dateKey, 23, 59);
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`UPDATE project_tasks SET due_at = ?2, updated_at = ?3 WHERE id = ?1`).bind(Number(task.id), dueAt, now).run();
  await logAction(db, "project.task.rescheduled", task.title, { task_id: task.id, project_id: task.project_id, due_at: dueAt });
  return lifePayload(`Moved “${task.title}” to ${dayLabel(dateKey)}. Its due time is end of day.`, "project_task_rescheduled", { project_task: { ...task, due_at: dueAt } });
}

async function findOpenTask(db, label) {
  const rows = (await db.prepare(`
    SELECT t.id, t.project_id, t.title, t.status, t.due_at, p.name AS project_name
    FROM project_tasks t JOIN projects p ON p.id = t.project_id
    WHERE t.status != 'done' AND p.status IN ('active','paused')
    ORDER BY t.status = 'doing' DESC, p.priority DESC, t.due_at IS NULL, t.due_at, t.id
    LIMIT 200
  `).all().catch(() => ({ results: [] }))).results || [];
  return bestTextMatch(label, rows, (row) => row.title);
}

async function recentReferencedTask(db) {
  const tasks = (await db.prepare(`
    SELECT t.id, t.project_id, t.title, t.status, t.due_at, p.name AS project_name
    FROM project_tasks t JOIN projects p ON p.id = t.project_id
    WHERE t.status != 'done' AND p.status IN ('active','paused')
    ORDER BY t.updated_at DESC, t.id DESC LIMIT 100
  `).all().catch(() => ({ results: [] }))).results || [];
  if (!tasks.length) return null;
  const messages = (await db.prepare(`SELECT content FROM messages ORDER BY id DESC LIMIT 8`).all().catch(() => ({ results: [] }))).results || [];
  for (const message of messages) {
    const content = String(message.content || "").toLowerCase();
    const match = tasks.find((task) => content.includes(String(task.title || "").toLowerCase()));
    if (match) return match;
  }
  return tasks.length === 1 ? tasks[0] : null;
}

function bestNamedProject(message, projects) {
  const text = String(message || "").toLowerCase();
  const exact = projects.find((project) => text.includes(String(project.name || "").toLowerCase()));
  if (exact) return exact;
  return bestTextMatch(message, projects, (project) => project.name);
}

function bestTextMatch(query, rows, pick) {
  const tokens = meaningfulTokens(query);
  if (!tokens.length) return null;
  let best = null;
  let bestScore = 0;
  for (const row of rows) {
    const value = String(pick(row) || "").toLowerCase();
    const score = tokens.reduce((sum, token) => sum + (value.includes(token) ? 1 : 0), 0);
    if (score > bestScore) { best = row; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

function meaningfulTokens(value) {
  const stop = new Set(["the","a","an","to","on","in","of","for","my","project","task","tasks","what","whats","is","left","move","reschedule","push","tomorrow","today","next"]);
  return String(value || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((token) => token.length > 2 && !stop.has(token));
}

export function extractDurationMinutes(message, fallback = 45) {
  const minutes = String(message || "").match(/\b(\d{1,3})\s*(?:-\s*)?(?:minutes?|mins?|min|m)\b/i);
  if (minutes) return Math.max(10, Math.min(240, Number(minutes[1])));
  const hours = String(message || "").match(/\b(\d(?:\.\d)?)\s*(?:hours?|hrs?|hr|h)\b/i);
  if (hours) return Math.max(10, Math.min(240, Math.round(Number(hours[1]) * 60)));
  return fallback;
}

export function extractStudySubject(message) {
  return clean(String(message || "")
    .replace(/\b(?:start|begin)\b/ig, " ")
    .replace(/\b\d{1,3}\s*(?:-\s*)?(?:minutes?|mins?|min|m)\b/ig, " ")
    .replace(/\b\d(?:\.\d)?\s*(?:hours?|hrs?|hr|h)\b/ig, " ")
    .replace(/\b(?:a|an|the)\b/ig, " ")
    .replace(/\b(?:study\s+block|study\s+session|review\s+session|session|block)\b/ig, " ")
    .replace(/\bstudy\b/ig, " ")
    .replace(/\s+/g, " ")
    .trim().replace(/[.!?]+$/, ""), 180);
}

function extractWorkoutName(message) {
  const text = String(message || "").replace(/\b(?:start|begin)\b/ig, " ").replace(/\b(?:my|a|the)\b/ig, " ").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  if (/^(?:workout|gym|training)$/i.test(text)) return "Workout";
  return clean(text.replace(/\s+(?:workout|session)$/i, "").trim(), 100) || "Workout";
}

function parseAddTask(message) {
  const match = String(message || "").match(/\b(?:add|create)\s+(?:a\s+)?task\s+(.+?)\s+to\s+(?:the\s+)?(?:project\s+)?(.+?)(?:\s+project)?[.!?]*$/i);
  if (!match) return { task: "", project: "" };
  return { task: clean(match[1], 300), project: clean(match[2], 160) };
}

function extractTaskMoveLabel(message) {
  const match = String(message || "").match(/\b(?:move|reschedule|push)\s+(?:the\s+|my\s+)?(?:project\s+)?task\s+(.+?)\s+(?:to|for)\s+(?:today|tomorrow|next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|20\d{2}-\d{2}-\d{2}|today|tomorrow)\b/i);
  return clean(match?.[1], 300);
}

export function resolveDateKey(message, nowMs = Date.now()) {
  const text = String(message || "").toLowerCase();
  const today = localDateKey(nowMs);
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  if (/\btomorrow\b/.test(text)) return addDateKey(today, 1);
  if (/\btoday\b/.test(text)) return today;
  const weekday = WEEKDAYS.find((day) => new RegExp(`\\b${day}\\b`).test(text));
  if (!weekday) return null;
  const target = WEEKDAYS.indexOf(weekday);
  const current = weekdayIndex(nowMs);
  let delta = (target - current + 7) % 7;
  if (new RegExp(`\\bnext\\s+${weekday}\\b`).test(text)) delta = delta === 0 ? 7 : delta + 7;
  return addDateKey(today, delta);
}

function localDateKey(milliseconds) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(milliseconds));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function weekdayIndex(milliseconds) {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "long" }).format(new Date(milliseconds)).toLowerCase();
  return WEEKDAYS.indexOf(weekday);
}

function addDateKey(key, days) {
  const [year, month, day] = String(key).split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function epochForLocal(dateKey, hour, minute) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = desiredUtc;
  for (let index = 0; index < 2; index += 1) candidate = desiredUtc - zoneOffsetMinutes(candidate) * 60_000;
  return Math.floor(candidate / 1000);
}

function zoneOffsetMinutes(milliseconds) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, timeZoneName: "shortOffset" }).formatToParts(new Date(milliseconds)).find((item) => item.type === "timeZoneName")?.value || "GMT";
  const match = part.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const value = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === "-" ? -value : value;
}

function dayLabel(dateKey) {
  const today = localDateKey(Date.now());
  if (dateKey === today) return "today";
  if (dateKey === addDateKey(today, 1)) return "tomorrow";
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, weekday: "long", month: "short", day: "numeric" }).format(new Date(epochForLocal(dateKey, 12, 0) * 1000));
}

function formatClock(epoch) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(Number(epoch) * 1000));
}

function lifePayload(reply, action, extra = {}) {
  return { reply, provider: "silk", model: "SILK Life Control", model_id: "silk.life", action, ...extra };
}

async function saveConversation(db, userMessage, assistantMessage) {
  try {
    await db.batch([
      db.prepare("INSERT INTO messages (role, content) VALUES ('user', ?1)").bind(userMessage.slice(0, 4000)),
      db.prepare("INSERT INTO messages (role, content) VALUES ('assistant', ?1)").bind(assistantMessage.slice(0, 20000)),
    ]);
  } catch (error) {
    console.error("Could not save SILK life-control chat", error);
  }
}

async function logAction(db, action, target, detail) {
  try {
    await db.prepare(`INSERT INTO action_log (provider, action, target, detail_json, status) VALUES ('silk', ?1, ?2, ?3, 'completed')`).bind(action, clean(target, 240), JSON.stringify(detail || {})).run();
  } catch (error) {
    console.error("Could not log SILK life-control action", error);
  }
}

function streamResponse(payload) {
  const encoder = new TextEncoder();
  const domain = String(payload?.action || "").split("_")[0] || "life";
  const labels = { study: "Working with SILK Study", workout: "Working with SILK Fitness", project: "Working with SILK Projects" };
  const label = labels[domain] || "Updating SILK";
  const body = new ReadableStream({
    start(controller) {
      const emit = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      emit("activity", { state: domain, label });
      emit("message", payload);
      emit("activity", { state: "idle", label: "Ready" });
      emit("done", { ok: true });
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-store", Connection: "keep-alive" } });
}

function clean(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
