import { handleSilkCalendar } from "./silk-calendar.js";

const PARSER_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
const TIME_ZONE = "America/Toronto";

export async function tryHandleSilkCalendarChat(request, env) {
  if (request.method !== "POST") return null;
  const url = new URL(request.url);
  if (!["/api/chat", "/api/chat/stream"].includes(url.pathname)) return null;

  const body = await request.clone().json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return null;

  const intent = calendarIntent(message);
  if (!intent) return null;

  const payload = intent === "write"
    ? await handleWrite(message, request, env)
    : await handleRead(message, request, env);

  if (!payload) return null;
  await saveConversation(env.DB, message, payload.reply);

  return url.pathname === "/api/chat/stream"
    ? streamResponse(payload)
    : json(payload);
}

function calendarIntent(message) {
  const text = String(message || "");
  if (/\b(?:add|create|schedule|book|put)\b[\s\S]{0,220}\b(?:calendar|event|appointment|meeting|class|study(?: block| session)?|workout|gym|shift)\b/i.test(text)) {
    return "write";
  }
  if (/\b(?:calendar|schedule)\b[\s\S]{0,120}\b(?:today|tomorrow|week|upcoming|next)\b/i.test(text) ||
      /\b(?:what|anything|events?|appointments?)\b[\s\S]{0,120}\b(?:today|tomorrow|this week)\b[\s\S]{0,80}\b(?:calendar|schedule|planned|booked)?\b/i.test(text)) {
    return "read";
  }
  return null;
}

async function handleWrite(message, request, env) {
  if (!env.AI) {
    return {
      reply: "SILK Calendar is available, but the Workers AI binding is needed to turn natural-language dates into an event. Open Calendar to add this one manually.",
      provider: "silk",
      model: "SILK Calendar",
      model_id: "silk.calendar",
      action: "silk_calendar_parser_unavailable",
    };
  }

  const draft = await parseDraft(message, env);
  if (draft.question) {
    return {
      reply: draft.question,
      provider: "silk",
      model: "SILK Calendar",
      model_id: "silk.calendar",
      action: "silk_calendar_clarification",
    };
  }

  const category = workoutLanguage(message) ? "workout" : draft.category;
  const createRequest = new Request(new URL("/api/silk-calendar/events", request.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: draft.title,
      start: draft.start,
      end: draft.end,
      location: draft.location,
      notes: draft.notes,
      category,
      requires_completion: category === "workout" || draft.requires_completion,
      source: "silk-chat",
    }),
  });
  const response = await handleSilkCalendar(createRequest, env);
  const created = await response.json();
  if (!response.ok || !created?.event) {
    return {
      reply: created?.error || "I could not add that to SILK Calendar.",
      provider: "silk",
      model: "SILK Calendar",
      model_id: "silk.calendar",
      action: "silk_calendar_error",
    };
  }

  const event = created.event;
  await logAction(env.DB, "calendar.event.created", event.title, { event_id: event.id, category: event.category });
  const checkin = event.requires_completion ? " I’ll ask if you completed it after it ends." : "";
  return {
    reply: `${event.title} is on SILK Calendar for ${formatEventTime(event)}.${checkin}`,
    provider: "silk",
    model: "SILK Calendar",
    model_id: "silk.calendar",
    action: "silk_calendar_created",
    calendar_event: event,
  };
}

async function handleRead(message, request, env) {
  const scope = readScope(message);
  const now = Math.floor(Date.now() / 1000);
  const query = new URLSearchParams({
    from: String(now - 2 * 86400),
    to: String(now + 9 * 86400),
  });
  const response = await handleSilkCalendar(
    new Request(new URL(`/api/silk-calendar/events?${query}`, request.url), { method: "GET" }),
    env,
  );
  const result = await response.json();
  if (!response.ok) return null;

  const today = localDateKey(Date.now());
  const tomorrow = addDateKey(today, 1);
  const weekEnd = addDateKey(today, 6);
  const events = (result.events || []).filter((event) => {
    const key = localDateKey(Number(event.start_at) * 1000);
    if (scope === "today") return key === today;
    if (scope === "tomorrow") return key === tomorrow;
    return key >= today && key <= weekEnd;
  });

  const label = scope === "today" ? "today" : scope === "tomorrow" ? "tomorrow" : "the next 7 days";
  return {
    reply: events.length
      ? `On SILK Calendar ${label}: ${events.slice(0, 8).map(formatShortEvent).join("; ")}.`
      : `You have nothing on SILK Calendar ${label}.`,
    provider: "silk",
    model: "SILK Calendar",
    model_id: "silk.calendar",
    action: "silk_calendar_retrieved",
    calendar_events: events,
  };
}

async function parseDraft(message, env) {
  const localNow = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    dateStyle: "full",
    timeStyle: "long",
  }).format(new Date());

  const prompt = `You extract events for a private personal calendar.
Current local date/time in America/Toronto: ${localNow}.
User request: ${JSON.stringify(message)}

Return ONLY one JSON object with exactly these keys:
{"title":"","start":"","end":"","location":"","notes":"","category":"personal","requires_completion":false,"question":""}

Rules:
- start and end must be ISO 8601 timestamps with an explicit UTC offset.
- Resolve relative dates like today, tomorrow, Friday, next Saturday using America/Toronto.
- If duration is missing, use 1 hour.
- category must be one of personal, work, school, study, workout, appointment, other.
- Work shifts are category work. Gym/training/workout sessions are category workout.
- Workout events require_completion=true.
- If title, date, or start time is genuinely missing, put one concise question in question and leave start/end blank.
- Never claim the event has already been created.`;

  const raw = await env.AI.run(PARSER_MODEL, {
    messages: [
      { role: "system", content: "Return valid JSON only. Do not include markdown or reasoning." },
      { role: "user", content: prompt },
    ],
    max_tokens: 360,
    temperature: 0.1,
  });
  const text = aiText(raw);
  const parsed = extractObject(text);
  const question = clean(parsed?.question, 300);
  if (question) return { question };

  const title = clean(parsed?.title, 240);
  const start = clean(parsed?.start, 100);
  const end = clean(parsed?.end, 100);
  if (!title || !validDate(start) || !validDate(end)) {
    return { question: "What date and start time should I use for that SILK Calendar event?" };
  }

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

function readScope(message) {
  if (/\btomorrow\b/i.test(message)) return "tomorrow";
  if (/\btoday\b/i.test(message)) return "today";
  return "week";
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
  const [year, month, day] = key.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
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
    await db.prepare(`INSERT INTO action_log (provider, action, target, detail_json, status)
      VALUES ('silk', ?1, ?2, ?3, 'completed')`)
      .bind(action, clean(target, 240), JSON.stringify(detail || {})).run();
  } catch (error) {
    console.error("Could not log SILK calendar action", error);
  }
}

function streamResponse(payload) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      const emit = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      emit("activity", { state: "calendar", label: "Updating SILK Calendar" });
      emit("message", payload);
      emit("activity", { state: "idle", label: "Ready" });
      emit("done", { ok: true });
      controller.close();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store",
      "Connection": "keep-alive",
    },
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
