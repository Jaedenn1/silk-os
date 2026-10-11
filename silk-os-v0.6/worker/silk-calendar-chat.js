import { handleSilkCalendar } from "./silk-calendar.js";
import { completeFromChat } from "./silk-completions.js";

const PARSER_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
const TIME_ZONE = "America/Toronto";
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DEFAULT_PREP = { work: 30, school: 30, study: 10, workout: 15, appointment: 20, personal: 10, other: 10 };

export async function tryHandleSilkCalendarChat(request, env) {
  if (request.method !== "POST") return null;
  const url = new URL(request.url);
  if (!["/api/chat", "/api/chat/stream"].includes(url.pathname)) return null;

  const body = await request.clone().json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return null;

  const completion = await completeFromChat(message, env.DB);
  if (completion) {
    await saveConversation(env.DB, message, completion.reply);
    return url.pathname === "/api/chat/stream" ? streamResponse(completion) : json(completion);
  }

  const intent = calendarIntent(message);
  if (!intent) return null;

  let payload = null;
  if (intent === "create") payload = await handleCreate(message, request, env);
  else if (intent === "update") payload = await handleUpdate(message, request, env);
  else payload = await handleRead(message, request, env);

  if (!payload) return null;
  await saveConversation(env.DB, message, payload.reply);
  return url.pathname === "/api/chat/stream" ? streamResponse(payload) : json(payload);
}

export function calendarIntent(message) {
  const text = String(message || "").trim();
  if (!text) return null;

  if (/\b(?:move|reschedule|change|shift|push|set)\b[\s\S]{0,180}\b(?:workout|gym|shift|meeting|appointment|class|study|event|calendar|to\s+\d|at\s+\d)\b/i.test(text)) {
    return "update";
  }
  if (/\b(?:add|create|schedule|book|put)\b[\s\S]{0,220}\b(?:calendar|event|appointment|meeting|class|study(?: block| session)?|workout|gym|shift)\b/i.test(text)) {
    return "create";
  }
  if (
    /\bwhat(?:'s| is) next\b/i.test(text) ||
    /\bwhen do i work\b/i.test(text) ||
    /\bdo i have time\b/i.test(text) ||
    /\b(?:free time|open time|open window|free window)\b/i.test(text) ||
    /\bwhat(?:'s| is| does)\b[\s\S]{0,80}\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week)\b[\s\S]{0,80}\b(?:look like|schedule|calendar|planned|booked)?/i.test(text) ||
    /\b(?:calendar|schedule)\b[\s\S]{0,120}\b(?:today|tomorrow|week|upcoming|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text) ||
    /\b(?:events?|appointments?|shifts?)\b[\s\S]{0,120}\b(?:today|tomorrow|this week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text)
  ) {
    return "read";
  }
  return null;
}

async function handleCreate(message, request, env) {
  if (!env.AI) return calendarPayload("I can read SILK Calendar, but the Workers AI binding is needed to turn that sentence into a new event.", "silk_calendar_parser_unavailable");

  const draft = await parseDraft(message, env);
  if (draft.question) return calendarPayload(draft.question, "silk_calendar_clarification");

  const category = workoutLanguage(message) ? "workout" : studyLanguage(message) ? "study" : draft.category;
  const response = await handleSilkCalendar(new Request(new URL("/api/silk-calendar/events", request.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: draft.title,
      start: draft.start,
      end: draft.end,
      location: draft.location,
      notes: draft.notes,
      category,
      requires_completion: ["workout", "study"].includes(category) || draft.requires_completion,
      source: "silk-chat",
    }),
  }), env);
  const created = await response.json();
  if (!response.ok || !created?.event) return calendarPayload(created?.error || "I could not add that to SILK Calendar.", "silk_calendar_error");

  const event = created.event;
  await logAction(env.DB, "calendar.event.created", event.title, { event_id: event.id, category: event.category });
  const checkin = event.requires_completion ? " I’ll ask whether you completed it after it ends." : "";
  return {
    ...calendarPayload(`${event.title} is on SILK Calendar for ${formatEventTime(event)}.${checkin}`, "silk_calendar_created"),
    calendar_event: event,
  };
}

async function handleUpdate(message, request, env) {
  const all = await loadEvents(request, env, Math.floor(Date.now() / 1000) - 86400, Math.floor(Date.now() / 1000) + 21 * 86400);
  const now = Math.floor(Date.now() / 1000);
  const dateKey = resolveDateKey(message);
  const target = targetDescriptor(message);
  let candidates = all.filter((event) => Number(event.end_at) >= now - 3600 && eventMatchesTarget(event, target));
  if (dateKey) candidates = candidates.filter((event) => localDateKey(Number(event.start_at) * 1000) === dateKey);
  candidates.sort((a, b) => Number(a.start_at) - Number(b.start_at));

  if (!candidates.length) {
    return calendarPayload(`I couldn’t find an upcoming SILK Calendar event matching “${target.label || "that"}”.`, "silk_calendar_update_not_found");
  }

  const event = candidates[0];
  if (candidates.length > 1 && candidates[1].start_at === event.start_at) {
    return calendarPayload(`I found more than one matching event at that time: ${candidates.slice(0, 4).map((item) => item.title).join(", ")}. Which one should I move?`, "silk_calendar_clarification");
  }

  const change = resolveMove(message, event);
  if (change.question) return calendarPayload(change.question, "silk_calendar_clarification");

  const response = await handleSilkCalendar(new Request(new URL(`/api/silk-calendar/events/${event.id}`, request.url), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start_at: change.start, end_at: change.end, source: "silk-chat" }),
  }), env);
  const updated = await response.json();
  if (!response.ok || !updated?.event) return calendarPayload(updated?.error || "I could not move that Calendar event.", "silk_calendar_error");

  await logAction(env.DB, "calendar.event.rescheduled", updated.event.title, {
    event_id: updated.event.id,
    old_start: event.start_at,
    new_start: updated.event.start_at,
  });
  return {
    ...calendarPayload(`${updated.event.title} is moved to ${formatEventTime(updated.event)}.`, "silk_calendar_updated"),
    calendar_event: updated.event,
  };
}

async function handleRead(message, request, env) {
  const now = Math.floor(Date.now() / 1000);
  const all = await loadEvents(request, env, now - 2 * 86400, now + 22 * 86400);
  if (/\bwhat(?:'s| is) next\b/i.test(message)) {
    const next = all.filter((event) => Number(event.end_at) >= now).sort((a, b) => Number(a.start_at) - Number(b.start_at))[0];
    if (!next) return calendarPayload("You don’t have another event on SILK Calendar in the next three weeks.", "silk_calendar_next");
    return {
      ...calendarPayload(`Next up is ${next.title}, ${formatEventTime(next)}${next.location ? ` at ${next.location}` : ""}.`, "silk_calendar_next"),
      calendar_events: [next],
    };
  }

  const dateKey = resolveDateKey(message);
  const scope = dateKey ? { start: dateKey, end: dateKey, label: dayLabel(dateKey) } : weekScope();
  let events = all.filter((event) => {
    const key = localDateKey(Number(event.start_at) * 1000);
    return key >= scope.start && key <= scope.end;
  });

  if (/\bwhen do i work\b|\bwork shifts?\b|\bmy shifts?\b/i.test(message)) {
    events = events.filter((event) => event.category === "work" || /\b(?:shift|work|hospital|dct|clean team|er)\b/i.test(event.title));
    if (!events.length) return calendarPayload(`I don’t see a work shift on SILK Calendar ${scope.label}.`, "silk_calendar_work_retrieved");
    return {
      ...calendarPayload(`Your work ${events.length === 1 ? "shift is" : "shifts are"} ${events.map(formatShortEvent).join("; ")}.`, "silk_calendar_work_retrieved"),
      calendar_events: events,
    };
  }

  if (/\bdo i have time\b|\bfree time\b|\bopen (?:time|window)\b|\bfree window\b/i.test(message)) {
    const duration = requestedDurationMinutes(message);
    const availabilityDate = dateKey || localDateKey(Date.now());
    const availabilityLabel = dateKey ? scope.label : "today";
    const availabilityEvents = all.filter((event) => localDateKey(Number(event.start_at) * 1000) === availabilityDate);
    const windows = findFreeWindows(availabilityEvents, availabilityDate, duration);
    const purpose = /\b(?:gym|workout|training)\b/i.test(message) ? "for the gym" : "free";
    if (!windows.length) {
      return calendarPayload(`I don’t see a ${duration}-minute usable window ${availabilityLabel} ${purpose === "free" ? "" : purpose} once Calendar blocks and basic prep/travel buffers are included.`.replace(/\s+/g, " "), "silk_calendar_availability");
    }
    const shown = windows.slice(0, 3).map((window) => `${formatClock(window.start)}–${formatClock(window.end)} (${window.minutes} min)`).join("; ");
    return {
      ...calendarPayload(`Yes. ${availabilityLabel[0].toUpperCase()}${availabilityLabel.slice(1)} you have ${shown}${purpose === "free" ? "" : ` ${purpose}`}.`, "silk_calendar_availability"),
      free_windows: windows,
      calendar_events: availabilityEvents,
    };
  }

  const phrase = scope.start === scope.end ? scope.label : "over the next 7 days";
  return {
    ...calendarPayload(events.length ? `On SILK Calendar ${phrase}: ${events.slice(0, 10).map(formatShortEvent).join("; ")}.` : `You have nothing on SILK Calendar ${phrase}.`, "silk_calendar_retrieved"),
    calendar_events: events,
  };
}

async function loadEvents(request, env, from, to) {
  const query = new URLSearchParams({ from: String(from), to: String(to) });
  const response = await handleSilkCalendar(new Request(new URL(`/api/silk-calendar/events?${query}`, request.url), { method: "GET" }), env);
  if (!response.ok) return [];
  const result = await response.json();
  return Array.isArray(result?.events) ? result.events : [];
}

function targetDescriptor(message) {
  const text = String(message || "");
  if (/\b(?:workout|gym|training)\b/i.test(text)) return { category: "workout", label: "workout" };
  if (/\b(?:shift|work)\b/i.test(text)) return { category: "work", label: "work shift" };
  if (/\b(?:study|review|quiz|exam)\b/i.test(text)) return { category: "study", label: "study session" };
  if (/\bappointment\b/i.test(text)) return { category: "appointment", label: "appointment" };
  const match = text.match(/\b(?:move|reschedule|change|shift|push|set)\s+(?:my\s+|the\s+)?(.+?)(?=\s+(?:to|at|on)\b|$)/i);
  const label = clean(match?.[1], 180);
  return { category: "", label };
}

function eventMatchesTarget(event, target) {
  if (target.category && event.category === target.category) return true;
  if (target.category === "work" && /\b(?:shift|work|hospital|dct|clean team|er)\b/i.test(event.title || "")) return true;
  if (target.category === "workout" && /\b(?:workout|gym|training|leg day|push day|pull day|full body)\b/i.test(event.title || "")) return true;
  if (target.category === "study" && /\b(?:study|review|quiz|exam)\b/i.test(event.title || "")) return true;
  if (target.label) return String(event.title || "").toLowerCase().includes(target.label.toLowerCase());
  return false;
}

export function resolveMove(message, event) {
  const explicitDate = resolveDateKey(message);
  const originalKey = localDateKey(Number(event.start_at) * 1000);
  const dateKey = explicitDate || originalKey;
  const time = extractMoveTime(message, event);
  const duration = Math.max(60, Number(event.end_at) - Number(event.start_at));

  if (!time) {
    if (explicitDate) {
      const original = localParts(Number(event.start_at) * 1000);
      const start = epochForLocal(dateKey, original.hour, original.minute);
      return { start, end: start + duration, question: "" };
    }
    return { question: "What time should I move it to?" };
  }

  const start = epochForLocal(dateKey, time.hour, time.minute);
  if (!Number.isFinite(start)) return { question: "What exact time should I use?" };
  if (!explicitDate && Number(event.start_at) > Date.now() / 1000 && start < Date.now() / 1000 - 300) {
    return { question: `That would move ${event.title} into the past today. What time should I use instead?` };
  }
  return { start, end: start + duration, question: "" };
}

function extractMoveTime(message, event) {
  const matches = [...String(message || "").matchAll(/\b(?:to|at)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/gi)];
  const match = matches[matches.length - 1];
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (hour > 23 || minute > 59) return null;
  const meridiem = String(match[3] || "").toLowerCase().replace(/\./g, "");
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && hour <= 12) {
    const originalHour = localParts(Number(event.start_at) * 1000).hour;
    if (hour <= 7) hour = hour === 12 ? 12 : hour + 12;
    else if (originalHour >= 12 && hour < 12) hour += 12;
  }
  return { hour, minute };
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
  if (/\bnext\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text)) {
    if (delta === 0) delta = 7;
    else if (delta < 7) delta += 7;
  }
  return addDateKey(today, delta);
}

function weekScope() {
  const today = localDateKey(Date.now());
  return { start: today, end: addDateKey(today, 6), label: "over the next 7 days" };
}

export function findFreeWindows(events, dateKey, minimumMinutes = 60) {
  const start = epochForLocal(dateKey, 7, 0);
  const end = epochForLocal(dateKey, 23, 0);
  const blocks = events
    .filter((event) => localDateKey(Number(event.start_at) * 1000) === dateKey && !event.all_day)
    .map((event) => {
      const prep = DEFAULT_PREP[event.category] ?? 10;
      const travel = String(event.location || "").trim() ? 30 : 0;
      return { start: Math.max(start, Number(event.start_at) - (prep + travel) * 60), end: Math.min(end, Number(event.end_at)) };
    })
    .filter((block) => block.end > start && block.start < end)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (last && block.start <= last.end) last.end = Math.max(last.end, block.end);
    else merged.push({ ...block });
  }

  const windows = [];
  let cursor = Math.max(start, Math.floor(Date.now() / 1000));
  for (const block of merged) {
    if (block.end <= cursor) continue;
    if (block.start > cursor) {
      const minutes = Math.floor((block.start - cursor) / 60);
      if (minutes >= minimumMinutes) windows.push({ start: cursor, end: block.start, minutes });
    }
    cursor = Math.max(cursor, block.end);
  }
  if (end > cursor) {
    const minutes = Math.floor((end - cursor) / 60);
    if (minutes >= minimumMinutes) windows.push({ start: cursor, end, minutes });
  }
  return windows;
}

function requestedDurationMinutes(message) {
  const match = String(message || "").match(/\b(\d{1,3})\s*(?:minutes?|mins?|m)\b/i);
  if (match) return Math.max(15, Math.min(240, Number(match[1])));
  const hours = String(message || "").match(/\b(\d(?:\.\d)?)\s*(?:hours?|hrs?|h)\b/i);
  if (hours) return Math.max(15, Math.min(240, Math.round(Number(hours[1]) * 60)));
  if (/\b(?:gym|workout|training)\b/i.test(message)) return 60;
  return 45;
}

async function parseDraft(message, env) {
  const localNow = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, dateStyle: "full", timeStyle: "long" }).format(new Date());
  const prompt = `You extract events for a private personal calendar.\nCurrent local date/time in America/Toronto: ${localNow}.\nUser request: ${JSON.stringify(message)}\n\nReturn ONLY one JSON object with exactly these keys:\n{"title":"","start":"","end":"","location":"","notes":"","category":"personal","requires_completion":false,"question":""}\n\nRules:\n- start and end must be ISO 8601 timestamps with an explicit UTC offset.\n- Resolve relative dates like today, tomorrow, Friday, next Saturday using America/Toronto.\n- If duration is missing, use 1 hour.\n- category must be one of personal, work, school, study, workout, appointment, other.\n- Work shifts are category work. Gym/training/workout sessions are workout. Study/review sessions are study.\n- Workout and study events require_completion=true.\n- If title, date, or start time is genuinely missing, put one concise question in question and leave start/end blank.\n- Never claim the event has already been created.`;
  const raw = await env.AI.run(PARSER_MODEL, {
    messages: [
      { role: "system", content: "Return valid JSON only. Do not include markdown or reasoning." },
      { role: "user", content: prompt },
    ],
    max_tokens: 360,
    temperature: 0.1,
  });
  const parsed = extractObject(aiText(raw));
  const question = clean(parsed?.question, 300);
  if (question) return { question };
  const title = clean(parsed?.title, 240);
  const start = clean(parsed?.start, 100);
  const end = clean(parsed?.end, 100);
  if (!title || !validDate(start) || !validDate(end)) return { question: "What date and start time should I use for that SILK Calendar event?" };
  const allowed = new Set(["personal", "work", "school", "study", "workout", "appointment", "other"]);
  const category = allowed.has(parsed?.category) ? parsed.category : "personal";
  return {
    title,
    start,
    end,
    location: clean(parsed?.location, 500),
    notes: clean(parsed?.notes, 4000),
    category,
    requires_completion: parsed?.requires_completion === true,
    question: "",
  };
}

function calendarPayload(reply, action) {
  return { reply, provider: "silk", model: "SILK Calendar", model_id: "silk.calendar", action };
}

function dayLabel(dateKey) {
  const today = localDateKey(Date.now());
  if (dateKey === today) return "today";
  if (dateKey === addDateKey(today, 1)) return "tomorrow";
  const epoch = epochForLocal(dateKey, 12, 0);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, weekday: "long", month: "short", day: "numeric" }).format(new Date(epoch * 1000));
}

function formatEventTime(event) {
  const start = new Date(Number(event.start_at) * 1000);
  const end = new Date(Number(event.end_at) * 1000);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, weekday: "short", month: "short", day: "numeric" }).format(start);
  const time = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(start);
  const endTime = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(end);
  return `${date}, ${time}–${endTime}`;
}

function formatShortEvent(event) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, weekday: "short", month: "short", day: "numeric" }).format(new Date(Number(event.start_at) * 1000));
  const time = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(Number(event.start_at) * 1000));
  return `${event.title} (${date} at ${time})`;
}

function formatClock(epoch) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(Number(epoch) * 1000));
}

function localDateKey(milliseconds) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(milliseconds));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function localParts(milliseconds) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(milliseconds));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day), hour: Number(map.hour), minute: Number(map.minute) };
}

function weekdayIndex(milliseconds) {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "long" }).format(new Date(milliseconds)).toLowerCase();
  return WEEKDAYS.indexOf(weekday);
}

function epochForLocal(dateKey, hour, minute) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return Number.NaN;
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = desiredUtc;
  for (let index = 0; index < 2; index += 1) {
    const offsetMinutes = zoneOffsetMinutes(candidate);
    candidate = desiredUtc - offsetMinutes * 60_000;
  }
  return Math.floor(candidate / 1000);
}

function zoneOffsetMinutes(milliseconds) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, timeZoneName: "shortOffset" }).formatToParts(new Date(milliseconds)).find((item) => item.type === "timeZoneName")?.value || "GMT";
  const match = part.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const value = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === "-" ? -value : value;
}

function addDateKey(key, days) {
  const [year, month, day] = String(key).split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function aiText(raw) {
  if (typeof raw === "string") return raw;
  if (typeof raw?.response === "string") return raw.response;
  if (typeof raw?.result?.response === "string") return raw.result.response;
  if (typeof raw?.output_text === "string") return raw.output_text;
  if (Array.isArray(raw?.result?.response)) return raw.result.response.map((item) => item?.text || item).join("");
  return JSON.stringify(raw || {});
}

function extractObject(text) {
  const value = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try { return JSON.parse(value.slice(start, end + 1)); }
  catch { return {}; }
}

function workoutLanguage(message) {
  return /\b(?:workout|gym|training session|full body|leg day|push day|pull day|upper body|lower body)\b/i.test(message);
}

function studyLanguage(message) {
  return /\b(?:study|review session|quiz prep|exam prep|anatomy review)\b/i.test(message);
}

function validDate(value) {
  return typeof value === "string" && value.length > 8 && Number.isFinite(Date.parse(value));
}

function clean(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function saveConversation(db, userMessage, assistantMessage) {
  try {
    await db.batch([
      db.prepare("INSERT INTO messages (role, content) VALUES ('user', ?1)").bind(userMessage.slice(0, 4000)),
      db.prepare("INSERT INTO messages (role, content) VALUES ('assistant', ?1)").bind(assistantMessage.slice(0, 20000)),
    ]);
  } catch (error) {
    console.error("Could not save SILK calendar chat", error);
  }
}

async function logAction(db, action, target, detail) {
  try {
    await db.prepare(`INSERT INTO action_log (provider, action, target, detail_json, status) VALUES ('silk', ?1, ?2, ?3, 'completed')`).bind(action, clean(target, 240), JSON.stringify(detail || {})).run();
  } catch (error) {
    console.error("Could not log SILK calendar action", error);
  }
}

function streamResponse(payload) {
  const encoder = new TextEncoder();
  const activity = String(payload?.action || "").includes("completion") ? "completion" : "calendar";
  const label = activity === "completion" ? "Updating completion history" : "Working with SILK Calendar";
  const body = new ReadableStream({
    start(controller) {
      const emit = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      emit("activity", { state: activity, label });
      emit("message", payload);
      emit("activity", { state: "idle", label: "Ready" });
      emit("done", { ok: true });
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-store", Connection: "keep-alive" } });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
