import { buildAdaptiveTimeProfile } from "./silk-time-engine.js";

const TIME_ZONE = "America/Toronto";
const DEFAULT_PREP = { work: 30, school: 30, study: 10, workout: 15, appointment: 20, personal: 10, other: 10 };

export async function handleSilkProactive(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/proactive/signals") {
    return json({ signals: await buildSignals(env.DB), generated_at: Math.floor(Date.now() / 1000) });
  }
  return json({ error: "Proactive SILK route not found." }, 404);
}

export async function buildSignals(db, now = Math.floor(Date.now() / 1000)) {
  const profile = await buildAdaptiveTimeProfile(db);
  const signals = [];
  const upcoming = (await db.prepare(`
    SELECT id, title, start_at, end_at, all_day, location, notes, category, requires_completion, completion_status
    FROM silk_calendar_events_v2
    WHERE end_at >= ?1 AND start_at <= ?2
    ORDER BY start_at, id
    LIMIT 20
  `).bind(now - 300, now + 36 * 3600).all().catch(() => ({ results: [] }))).results || [];
  const next = upcoming.find((event) => !Number(event.all_day) && Number(event.start_at) >= now - 300) || null;

  if (next) {
    const plan = eventPlan(next, profile);
    const untilStart = Math.round((Number(next.start_at) - now) / 60);
    const untilLeave = Math.round((plan.leaveBy - now) / 60);
    const untilPrep = Math.round((plan.prepStart - now) / 60);

    if (plan.travelMinutes > 0 && untilLeave <= 45 && untilLeave >= -5) {
      signals.push(signal(
        `leave:${next.id}:${minuteBucket(plan.leaveBy, 10)}`,
        untilLeave <= 0 ? `Leave for ${next.title}` : `Leave in ${Math.max(1, untilLeave)} minutes`,
        `${next.title} starts at ${formatClock(Number(next.start_at))}. ${plan.travelMinutes} min travel${next.location ? ` to ${next.location}` : ""}.`,
        untilLeave <= 10 ? "high" : "normal",
        "/",
        "departure",
      ));
    } else if (untilPrep <= 30 && untilPrep >= -5) {
      signals.push(signal(
        `prep:${next.id}:${minuteBucket(plan.prepStart, 10)}`,
        untilPrep <= 0 ? `Start getting ready for ${next.title}` : `Prep starts in ${Math.max(1, untilPrep)} minutes`,
        `${plan.prepMinutes} min prep${plan.travelMinutes ? ` + ${plan.travelMinutes} min travel` : ""}.`,
        untilPrep <= 10 ? "high" : "normal",
        "/",
        "prep",
      ));
    }

    const freeUntil = Math.max(now, plan.prepStart);
    const freeMinutes = Math.floor((freeUntil - now) / 60);
    if (freeMinutes >= 45 && freeMinutes <= 240 && untilStart <= 360) {
      signals.push(signal(
        `window:${next.id}:${minuteBucket(now, 30)}`,
        `You have ${durationLabel(freeMinutes)} free`,
        `That window ends when prep for ${next.title} begins at ${formatClock(plan.prepStart)}.`,
        "low",
        "/",
        "free_window",
      ));
    }

    if (next.location) {
      const traffic = await latestTrafficObservation(db, String(next.location), now);
      if (traffic && traffic.delay >= 5) {
        signals.push(signal(
          `traffic:${next.id}:${minuteBucket(traffic.occurredAt, 10)}:${Math.round(traffic.delay)}`,
          `Traffic added ${Math.round(traffic.delay)} minutes`,
          `${next.title} is coming up. SILK's latest route check measured ${Math.round(traffic.travel)} minutes total.`,
          traffic.delay >= 10 ? "high" : "normal",
          "/",
          "traffic",
        ));
      }
    }
  }

  const pendingDaily = (await db.prepare(`
    SELECT id, title, source_type, scheduled_at, duration_minutes
    FROM daily_items
    WHERE scheduled_at IS NOT NULL
      AND status NOT IN ('done','skipped')
      AND source_type IN ('study','workout','project')
      AND (scheduled_at + duration_minutes * 60) <= ?1
      AND (scheduled_at + duration_minutes * 60) >= ?2
    ORDER BY scheduled_at DESC LIMIT 4
  `).bind(now, now - 2 * 3600).all().catch(() => ({ results: [] }))).results || [];
  for (const item of pendingDaily) {
    signals.push(signal(
      `checkin:daily:${item.id}`,
      `${item.title} ended — completed?`,
      "Close the loop in Today so SILK can learn from the result.",
      "normal",
      "/",
      "checkin",
    ));
  }

  const pendingCalendar = (await db.prepare(`
    SELECT id, title, end_at, category
    FROM silk_calendar_events_v2
    WHERE end_at <= ?1 AND end_at >= ?2
      AND (requires_completion = 1 OR category IN ('study','workout'))
      AND completion_status NOT IN ('completed','not_completed')
    ORDER BY end_at DESC LIMIT 4
  `).bind(now, now - 2 * 3600).all().catch(() => ({ results: [] }))).results || [];
  for (const event of pendingCalendar) {
    signals.push(signal(
      `checkin:calendar:${event.id}`,
      `${event.title} completed?`,
      "SILK is waiting for the completion check-in.",
      "normal",
      "/",
      "checkin",
    ));
  }

  const sleep = await sleepSignal(db, profile, now);
  if (sleep) signals.push(sleep);

  return dedupeSignals(signals).slice(0, 8);
}

function eventPlan(event, profile) {
  const category = normalizeCategory(event.category);
  const prepOverride = noteMinutes(event.notes, "prep");
  const travelOverride = noteMinutes(event.notes, "travel");
  const learnedPrep = profile?.prep_by_category?.[category];
  const prepMinutes = prepOverride ?? (learnedPrep?.learned ? Number(learnedPrep.minutes) : DEFAULT_PREP[category] || 10);
  let travelMinutes = travelOverride;
  if (travelMinutes == null && String(event.location || "").trim()) {
    const learned = (profile?.travel_by_context || []).find((item) => item.context.toLowerCase() === String(event.location).trim().toLowerCase());
    travelMinutes = learned && learned.samples >= 2 ? Number(learned.minutes) : 30;
  }
  travelMinutes = Number(travelMinutes || 0);
  const leaveBy = Number(event.start_at) - travelMinutes * 60;
  return { prepMinutes, travelMinutes, leaveBy, prepStart: leaveBy - prepMinutes * 60 };
}

async function sleepSignal(db, profile, now) {
  const tomorrow = addDateKey(localDateKey(now * 1000), 1);
  const start = epochForLocal(tomorrow, 0, 0);
  const cutoff = epochForLocal(tomorrow, 14, 0);
  const event = await db.prepare(`
    SELECT id, title, start_at, end_at, all_day, location, notes, category
    FROM silk_calendar_events_v2
    WHERE all_day = 0 AND start_at >= ?1 AND start_at < ?2
    ORDER BY start_at, id LIMIT 1
  `).bind(start, cutoff).first().catch(() => null);
  if (!event) return null;
  const plan = eventPlan(event, profile);
  const wakeAt = plan.prepStart - 60 * 60;
  const bedtime = wakeAt - 8 * 60 * 60;
  const windDown = bedtime - 30 * 60;
  if (now < windDown - 60 * 60 || now > bedtime + 30 * 60) return null;
  const untilWindDown = Math.round((windDown - now) / 60);
  return signal(
    `sleep:${event.id}:${localDateKey(now * 1000)}`,
    untilWindDown > 0 ? `Wind down in ${untilWindDown} minutes` : "Protect sleep tonight",
    `Aim to be asleep by ${formatClock(bedtime)} for tomorrow's ${formatClock(Number(event.start_at))} ${event.title}.`,
    untilWindDown <= 15 ? "high" : "normal",
    "/",
    "sleep",
  );
}

async function latestTrafficObservation(db, context, now) {
  const row = await db.prepare(`
    SELECT actual_minutes, occurred_at, metadata_json
    FROM silk_time_observations
    WHERE kind='travel_estimate' AND lower(context_key)=lower(?1) AND occurred_at >= ?2
    ORDER BY occurred_at DESC, id DESC LIMIT 1
  `).bind(context.trim(), now - 3 * 3600).first().catch(() => null);
  if (!row) return null;
  let metadata = {};
  try { metadata = JSON.parse(String(row.metadata_json || "{}")); } catch { metadata = {}; }
  return {
    travel: Number(row.actual_minutes || 0),
    delay: Number(metadata.traffic_delay_minutes || 0),
    occurredAt: Number(row.occurred_at || 0),
  };
}

function signal(id, title, body, urgency, actionUrl, kind) {
  return { id, title, body, urgency, action_url: actionUrl, kind };
}

function dedupeSignals(signals) {
  const seen = new Set();
  return signals.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function noteMinutes(notes, key) {
  const match = String(notes || "").match(new RegExp(`(?:^|\\s)${key}\\s*[:=]\\s*(\\d{1,3})(?:m|min|mins|minutes)?\\b`, "i"));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 && value <= 240 ? value : null;
}

function normalizeCategory(value) {
  const key = String(value || "other").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(DEFAULT_PREP, key) ? key : "other";
}

function durationLabel(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function minuteBucket(epoch, minutes) {
  return Math.floor(Number(epoch || 0) / (minutes * 60));
}

function formatClock(epoch) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(Number(epoch) * 1000));
}

function localDateKey(milliseconds) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(milliseconds));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

export function proactiveErrorResponse(error) {
  return json({ error: error instanceof Error ? error.message : "Proactive SILK failed." }, 500);
}
