from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"{label} anchor not found")
    return text.replace(old, new, 1)

# --- Worker Time Engine ----------------------------------------------------
path = Path("worker/silk-time-engine.js")
text = path.read_text()
imports = '''import {
  adaptiveEventPlanV2,
  buildContextMetrics,
  buildEventTransitions,
  localTimingContext,
  measurementStats,
  preferredWindows,
} from "./silk-time-engine-v2.js";

'''
if not text.startswith('import {\n  adaptiveEventPlanV2,'):
    text = imports + text

old = '''    const row = await env.DB.prepare(`SELECT event_id, title, category, planned_minutes, started_at FROM ${PREP_TABLE} WHERE event_id=?1`).bind(eventId).first();
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
'''
new = '''    const row = await env.DB.prepare(`SELECT event_id, title, category, planned_minutes, started_at FROM ${PREP_TABLE} WHERE event_id=?1`).bind(eventId).first();
    if (!row) throw new TimeEngineError(404, "SILK is not currently timing prep for that event.");
    const calendarEvent = await env.DB.prepare(`SELECT title, location, start_at FROM silk_calendar_events_v2 WHERE id=?1`).bind(eventId).first().catch(() => null);
    const now = Math.floor(Date.now() / 1000);
    const actual = Math.max(1, Math.min(240, Math.round((now - Number(row.started_at || now)) / 60)));
    const eventStart = Number(calendarEvent?.start_at || now);
    const timing = localTimingContext(eventStart);
    const location = clean(calendarEvent?.location, 180);
    await insertObservation(env.DB, {
      kind: "prep",
      category: normalizeCategory(row.category),
      context: location || clean(row.title, 180),
      planned: Number(row.planned_minutes || 0) || null,
      actual,
      metadata: {
        event_id: eventId,
        title: clean(calendarEvent?.title || row.title, 180),
        location,
        event_start_at: eventStart,
        weekday: timing.weekday_name,
        daypart: timing.daypart,
      },
      occurredAt: now,
    });
'''
text = replace_once(text, old, new, "contextual prep observation")

if "const prepByContext = buildContextMetrics" not in text:
    start = text.index("  const prepByCategory = {};")
    end = text.index("  const studyRows =", start)
    block = '''  const prepByCategory = {};
  for (const [category, fallback] of Object.entries(DEFAULT_PREP)) {
    const rows = observations
      .filter((row) => row.kind === "prep" && normalizeCategory(row.category) === category)
      .map((row) => ({ actual: Number(row.actual_minutes), occurredAt: Number(row.occurred_at || 0) }))
      .filter((row) => Number.isFinite(row.actual) && row.actual > 0)
      .slice(0, 40);
    const stats = measurementStats(rows, fallback);
    const learned = stats.samples >= 3 && stats.confidence_score >= 0.5;
    prepByCategory[category] = {
      ...stats,
      minutes: learned ? stats.minutes : fallback,
      default_minutes: fallback,
      learned,
    };
  }

  const prepByContext = buildContextMetrics(
    observations
      .filter((row) => row.kind === "prep" && row.context_key)
      .map((row) => ({ context: String(row.context_key), actual: Number(row.actual_minutes), occurredAt: Number(row.occurred_at || 0) })),
    { fallback: null, max: 20 },
  );

  const travelRows = observations
    .filter((row) => row.kind === "travel_estimate" && row.context_key)
    .map((row) => ({
      context: String(row.context_key),
      actual: Number(row.actual_minutes),
      occurredAt: Number(row.occurred_at || 0),
      metadata: parseMetadata(row.metadata_json),
    }));
  const travelByContext = buildContextMetrics(travelRows, { fallback: 30, max: 20 });
  const travelByRoute = buildContextMetrics(
    travelRows
      .filter((row) => clean(row.metadata?.origin_context, 180))
      .map((row) => ({
        context: `${clean(row.metadata.origin_context, 180)} → ${row.context}`,
        actual: row.actual,
        occurredAt: row.occurredAt,
      })),
    { fallback: 30, max: 20 },
  );

'''
    text = text[:start] + block + text[end:]

text = replace_once(text,
'''  const studyHours = studyRows.map((row) => localHour(Number(row.studied_at || 0) * 1000)).filter(Number.isFinite);
''',
'''  const studyHours = studyRows.map((row) => localHour(Number(row.studied_at || 0) * 1000)).filter(Number.isFinite);
  const studyWindows = preferredWindows(studyRows.map((row) => Number(row.studied_at || 0)).filter((value) => value > 0));
''', "study windows")
text = replace_once(text,
'''  const workoutHours = workoutRows.map((row) => localHour(Number(row.started_at || 0) * 1000)).filter(Number.isFinite);
''',
'''  const workoutHours = workoutRows.map((row) => localHour(Number(row.started_at || 0) * 1000)).filter(Number.isFinite);
  const workoutWindows = preferredWindows(workoutRows.map((row) => Number(row.started_at || 0)).filter((value) => value > 0));
''', "workout windows")

under_anchor = '''  const underestimationLabel = factor == null
    ? "SILK needs matched planned vs actual durations."
    : factor > 1.12
      ? `Tasks are running about ${Math.round((factor - 1) * 100)}% longer than planned.`
      : factor < 0.88
        ? `Tasks are finishing about ${Math.round((1 - factor) * 100)}% faster than planned.`
        : "Planned durations are tracking close to reality.";
'''
under_new = under_anchor + '''  const underestimationByCategory = {};
  for (const category of ["study", "workout", "project", "work", "school", "appointment", "personal", "other"]) {
    const categoryRatios = durationPairs
      .filter((row) => normalizeCategory(row.category) === category)
      .map((row) => Number(row.actual_minutes) / Number(row.planned_minutes))
      .filter((value) => Number.isFinite(value) && value >= 0.25 && value <= 4);
    if (categoryRatios.length >= 2) {
      underestimationByCategory[category] = {
        factor: round2(median(categoryRatios)),
        samples: categoryRatios.length,
        confidence: confidence(categoryRatios.length),
      };
    }
  }

  const upcomingEvents = (await db.prepare(`
    SELECT id, title, start_at, end_at, all_day, location, notes, category
    FROM silk_calendar_events_v2
    WHERE end_at >= ?1 AND start_at <= ?2
    ORDER BY start_at, id
    LIMIT 24
  `).bind(now - 6 * 3600, now + 36 * 3600).all().catch(() => ({ results: [] }))).results || [];
'''
text = replace_once(text, under_anchor, under_new, "underestimation categories and transitions")

text = replace_once(text,
'''  return {
    generated_at: now,
    prep_by_category: prepByCategory,
    travel_by_context: travelByContext,
''',
'''  const profile = {
    version: 2,
    generated_at: now,
    prep_by_category: prepByCategory,
    prep_by_context: prepByContext,
    travel_by_context: travelByContext,
    travel_by_route: travelByRoute,
''', "V2 profile header")
text = replace_once(text,
'''      samples: studyDurations.length,
      preferred_start_hour: studyHours.length >= 3 ? modeHour(studyHours) : null,
''',
'''      samples: studyDurations.length,
      preferred_start_hour: studyHours.length >= 3 ? modeHour(studyHours) : null,
      preferred_windows: studyWindows,
''', "study preferred windows output")
text = replace_once(text,
'''      samples: workoutDurations.length,
      preferred_start_hour: workoutHours.length >= 3 ? modeHour(workoutHours) : null,
''',
'''      samples: workoutDurations.length,
      preferred_start_hour: workoutHours.length >= 3 ? modeHour(workoutHours) : null,
      preferred_windows: workoutWindows,
''', "workout preferred windows output")
text = replace_once(text,
'''    underestimation: {
      factor,
      samples: ratios.length,
      label: underestimationLabel,
    },
''',
'''    underestimation: {
      factor,
      samples: ratios.length,
      label: underestimationLabel,
      by_category: underestimationByCategory,
    },
''', "underestimation output")

end_anchor = '''    evidence: {
      prep_samples: observations.filter((row) => row.kind === "prep").length,
      travel_samples: observations.filter((row) => row.kind === "travel_estimate").length,
      duration_pairs: ratios.length,
      study_sessions: studyDurations.length,
      workout_sessions: workoutDurations.length,
    },
  };
}

export async function recordDurationObservation'''
end_new = '''    evidence: {
      prep_samples: observations.filter((row) => row.kind === "prep").length,
      travel_samples: observations.filter((row) => row.kind === "travel_estimate").length,
      duration_pairs: ratios.length,
      study_sessions: studyDurations.length,
      workout_sessions: workoutDurations.length,
    },
  };
  profile.upcoming_transitions = buildEventTransitions(upcomingEvents, profile);
  return profile;
}

export async function recordDurationObservation'''
text = replace_once(text, end_anchor, end_new, "profile transitions output")

record_anchor = '''export function sampleConfidence(samples) {
  return confidence(samples);
}
'''
record_new = '''export function adaptiveEventPlan(event, profile, previousEvent = null) {
  return adaptiveEventPlanV2(event, profile, previousEvent);
}

export function sampleConfidence(samples) {
  return confidence(samples);
}
'''
text = replace_once(text, record_anchor, record_new, "adaptive event plan export")

if "function parseMetadata(value)" not in text:
    object_anchor = '''function objectOnly(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}
'''
    object_new = '''function parseMetadata(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return objectOnly(parsed);
  } catch {
    return {};
  }
}

function objectOnly(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}
'''
    text = replace_once(text, object_anchor, object_new, "metadata parser")

path.write_text(text)

# --- Proactive SILK shares the exact same adaptive planner -----------------
path = Path("worker/silk-proactive.js")
text = path.read_text()
text = replace_once(text,
'''import { buildAdaptiveTimeProfile } from "./silk-time-engine.js";
''',
'''import { adaptiveEventPlan, buildAdaptiveTimeProfile } from "./silk-time-engine.js";
export { adaptiveEventPlan };
''', "proactive adaptive import")
old = '''    const plan = adaptiveEventPlan(next, profile);
    const untilStart = Math.round((Number(next.start_at) - now) / 60);
'''
new = '''    const nextIndex = upcoming.findIndex((event) => Number(event.id) === Number(next.id));
    const previous = nextIndex > 0 ? upcoming[nextIndex - 1] : null;
    const plan = adaptiveEventPlan(next, profile, previous);
    const transition = (profile?.upcoming_transitions || []).find((item) => Number(item.to_event_id) === Number(next.id));
    if (transition && ["conflict", "tight"].includes(transition.status)) {
      signals.push(signal(
        `transition:${transition.from_event_id}:${transition.to_event_id}:${transition.status}`,
        transition.status === "conflict" ? `Schedule conflict before ${next.title}` : `Tight transition before ${next.title}`,
        transition.slack_minutes < 0
          ? `${transition.from_title} leaves SILK about ${Math.abs(transition.slack_minutes)} minutes short once prep and travel are included.`
          : `Only ${transition.slack_minutes} minutes of slack remain after prep and travel.`,
        transition.status === "conflict" ? "high" : "normal",
        "/",
        "transition",
      ));
    }
    const untilStart = Math.round((Number(next.start_at) - now) / 60);
'''
text = replace_once(text, old, new, "proactive transition planning")
if "export function adaptiveEventPlan(event, profile)" in text:
    start = text.index("export function adaptiveEventPlan(event, profile)")
    end = text.index("async function sleepSignal", start)
    text = text[:start] + text[end:]
path.write_text(text)

# --- Today consumes destination/weekday/daypart/route-aware patterns -------
path = Path("app/today-v2-bridge.tsx")
text = path.read_text()
if "type ContextTimingMetric =" not in text:
    anchor = '''type AdaptiveTimeProfile = {
'''
    metric_type = '''type ContextTimingMetric = {
  context: string;
  minutes: number;
  samples: number;
  confidence: string;
  confidence_score?: number;
  weekday?: Record<string, { minutes: number; samples: number; confidence_score?: number }>;
  daypart?: Record<string, { minutes: number; samples: number; confidence_score?: number }>;
};

type TimeTransition = {
  from_event_id: number;
  from_title: string;
  to_event_id: number;
  to_title: string;
  gap_minutes: number;
  required_minutes: number;
  slack_minutes: number;
  status: "conflict" | "tight" | "workable" | "comfortable";
};

'''
    text = text.replace(anchor, metric_type + anchor, 1)
text = replace_once(text,
'''type AdaptiveTimeProfile = {
  prep_by_category: Record<string, { minutes: number; default_minutes: number; samples: number; confidence: string; learned: boolean }>;
  travel_by_context: Array<{ context: string; minutes: number; samples: number; confidence: string }>;
  study: { recommended_minutes: number; samples: number; preferred_start_hour: number | null };
  workout: { recommended_minutes: number; samples: number; preferred_start_hour: number | null };
  underestimation: { factor: number | null; samples: number; label: string };
  active_prep?: { event_id: number; title: string; category: string; planned_minutes: number; started_at: number } | null;
};
''',
'''type AdaptiveTimeProfile = {
  version?: number;
  prep_by_category: Record<string, { minutes: number; default_minutes: number; samples: number; confidence: string; learned: boolean }>;
  prep_by_context?: ContextTimingMetric[];
  travel_by_context: ContextTimingMetric[];
  travel_by_route?: ContextTimingMetric[];
  upcoming_transitions?: TimeTransition[];
  study: { recommended_minutes: number; samples: number; preferred_start_hour: number | null; preferred_windows?: Array<{ weekday_name: string; daypart: string; start_hour: number; samples: number }> };
  workout: { recommended_minutes: number; samples: number; preferred_start_hour: number | null; preferred_windows?: Array<{ weekday_name: string; daypart: string; start_hour: number; samples: number }> };
  underestimation: { factor: number | null; samples: number; label: string; by_category?: Record<string, { factor: number; samples: number; confidence: string }> };
  active_prep?: { event_id: number; title: string; category: string; planned_minutes: number; started_at: number } | null;
};
''', "Today V2 profile type")
text = replace_once(text,
'''  estimatedTravel: boolean;
};
''',
'''  estimatedTravel: boolean;
  prepSource?: string;
  travelSource?: string;
};
''', "Today plan source type")

if "function contextualMetric" not in text:
    helper_anchor = '''function planEvent(event: CalendarEvent, liveRoute?: RouteEstimate | null, profile?: AdaptiveTimeProfile | null): EventPlan | null {
'''
    helper = '''function torontoTiming(epoch: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "short", hourCycle: "h23", hour: "2-digit" }).formatToParts(new Date(epoch * 1000));
  const weekday = String(parts.find((part) => part.type === "weekday")?.value || "").slice(0, 3).toLowerCase();
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const daypart = hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : hour >= 17 && hour < 22 ? "evening" : "night";
  return { weekday, daypart };
}

function contextualMetric(metrics: ContextTimingMetric[] | undefined, context: string, epoch: number) {
  const metric = (metrics || []).find((item) => item.samples >= 2 && item.context.toLowerCase() === context.trim().toLowerCase());
  if (!metric) return null;
  const timing = torontoTiming(epoch);
  const weekday = metric.weekday?.[timing.weekday];
  const daypart = metric.daypart?.[timing.daypart];
  const candidates = [weekday, daypart].filter(Boolean).sort((a, b) => Number(b?.confidence_score || 0) - Number(a?.confidence_score || 0));
  return candidates[0] || metric;
}

'''
    if helper_anchor not in text:
        raise SystemExit("Today plan helper anchor not found")
    text = text.replace(helper_anchor, helper + helper_anchor, 1)

start = text.index("function planEvent(event: CalendarEvent")
end = text.index("\nexport default function TodayV2Bridge()", start)
new_plan = '''function planEvent(event: CalendarEvent, liveRoute?: RouteEstimate | null, profile?: AdaptiveTimeProfile | null, previousEvent?: CalendarEvent | null): EventPlan | null {
  if (event.all_day || !event.start_at) return null;
  const prepOverride = noteMinutes(event.notes, "prep");
  const travelOverride = noteMinutes(event.notes, "travel");
  const liveTravel = liveRoute?.eventId === event.id ? liveRoute.travel_minutes : null;
  const category = Object.prototype.hasOwnProperty.call(DEFAULT_PREP, event.category) ? event.category : "other";
  const context = event.location.trim() || event.title.trim();
  const contextPrep = contextualMetric(profile?.prep_by_context, context, event.start_at);
  const categoryPrep = profile?.prep_by_category?.[category];
  const routeKey = previousEvent?.location?.trim() && event.location.trim() ? `${previousEvent.location.trim()} → ${event.location.trim()}` : "";
  const routeTravel = routeKey ? contextualMetric(profile?.travel_by_route, routeKey, event.start_at) : null;
  const destinationTravel = event.location.trim() ? contextualMetric(profile?.travel_by_context, event.location.trim(), event.start_at) : null;
  const prepMinutes = prepOverride ?? contextPrep?.minutes ?? (categoryPrep?.learned ? categoryPrep.minutes : DEFAULT_PREP[category] ?? 10);
  const travelMinutes = travelOverride ?? liveTravel ?? routeTravel?.minutes ?? destinationTravel?.minutes ?? (event.location.trim() ? 30 : 0);
  const prepSource = prepOverride !== null ? "explicit" : contextPrep ? "context" : categoryPrep?.learned ? "category" : "default";
  const travelSource = travelOverride !== null ? "explicit" : liveTravel !== null ? "live" : routeTravel ? "route" : destinationTravel ? "destination" : travelMinutes > 0 ? "default" : "none";
  const leaveBy = event.start_at - travelMinutes * 60;
  return {
    prepMinutes,
    travelMinutes,
    leaveBy,
    prepStart: leaveBy - prepMinutes * 60,
    estimatedTravel: travelSource === "default",
    prepSource,
    travelSource,
  };
}
'''
text = text[:start] + new_plan + text[end:]

text = replace_once(text,
'''    return events.filter((event) => event.start_at < bounds.end && event.end_at >= bounds.start);
''',
'''    return events
      .filter((event) => event.start_at < bounds.end && event.end_at >= bounds.start)
      .sort((a, b) => a.start_at - b.start_at);
''', "sorted Today events")
text = replace_once(text,
'''    const calendarEntries: TimelineEntry[] = todayEvents.map((event) => ({
''',
'''    const calendarEntries: TimelineEntry[] = todayEvents.map((event, index) => ({
''', "Today indexed events")
text = replace_once(text,
'''      plan: planEvent(event, routeEstimate, timeProfile),
''',
'''      plan: planEvent(event, routeEstimate, timeProfile, index > 0 ? todayEvents[index - 1] : null),
''', "Today prior-event logistics")
path.write_text(text)

# --- Momentum shows the richer learning surface ----------------------------
path = Path("app/momentum-bridge.tsx")
text = path.read_text()
text = replace_once(text,
'''  travel_by_context: Array<{ context: string; minutes: number; samples: number; confidence: string }>;
''',
'''  prep_by_context?: Array<{ context: string; minutes: number; samples: number; confidence: string; confidence_score?: number }>;
  travel_by_context: Array<{ context: string; minutes: number; samples: number; confidence: string; confidence_score?: number }>;
  travel_by_route?: Array<{ context: string; minutes: number; samples: number; confidence: string; confidence_score?: number }>;
  upcoming_transitions?: Array<{ from_title: string; to_title: string; slack_minutes: number; status: string }>;
''', "Momentum V2 time profile")
text = replace_once(text,
'''            <div><span>Travel contexts</span><strong>{profile?.travel_by_context.length || 0}</strong><small>recurring route patterns with measured estimates</small></div>
''',
'''            <div><span>Context prep</span><strong>{profile?.prep_by_context?.filter((item) => item.samples >= 2).length || 0}</strong><small>destinations/events with repeat prep evidence</small></div>
            <div><span>Travel contexts</span><strong>{profile?.travel_by_context.length || 0}</strong><small>{profile?.travel_by_route?.length || 0} origin → destination route patterns</small></div>
            <div><span>Next transition</span><strong>{profile?.upcoming_transitions?.[0]?.status ? profile.upcoming_transitions[0].status.toUpperCase() : "Clear"}</strong><small>{profile?.upcoming_transitions?.[0] ? `${profile.upcoming_transitions[0].from_title} → ${profile.upcoming_transitions[0].to_title} · ${profile.upcoming_transitions[0].slack_minutes}m slack` : "No adjacent timed events need transition planning."}</small></div>
''', "Momentum V2 learning UI")
path.write_text(text)

# --- Permanent regression tests -------------------------------------------
Path("tests/time-engine.test.mjs").write_text('''import test from "node:test";
import assert from "node:assert/strict";
import { adaptiveEventPlan, robustMinutes, sampleConfidence } from "../worker/silk-time-engine.js";
import { buildEventTransitions, confidenceFromMeasurements, selectContextMetric } from "../worker/silk-time-engine-v2.js";

test("adaptive timing uses robust measured minutes", () => {
  assert.equal(robustMinutes([28, 30, 31, 32, 120], 30), 31);
  assert.equal(sampleConfidence(1), "learning");
  assert.equal(sampleConfidence(4), "useful");
  assert.equal(sampleConfidence(9), "strong");
});

test("explicit Calendar timing overrides learned timing", () => {
  const event = { start_at: 200000, category: "work", location: "Hospital", notes: "prep:20 travel:45" };
  const profile = {
    prep_by_category: { work: { minutes: 38, learned: true, confidence: "strong" } },
    prep_by_context: [{ context: "Hospital", minutes: 44, samples: 8, confidence: "strong" }],
    travel_by_context: [{ context: "Hospital", minutes: 27, samples: 8, confidence: "strong" }],
  };
  const plan = adaptiveEventPlan(event, profile);
  assert.equal(plan.prepMinutes, 20);
  assert.equal(plan.travelMinutes, 45);
  assert.equal(plan.leaveBy, 200000 - 45 * 60);
});

test("destination-specific prep beats category defaults", () => {
  const event = { start_at: 200000, category: "work", location: "Hospital", notes: "" };
  const profile = {
    prep_by_category: { work: { minutes: 34, learned: true, confidence: "useful" } },
    prep_by_context: [{ context: "Hospital", minutes: 42, samples: 5, confidence: "useful", weekday: {}, daypart: {} }],
    travel_by_context: [],
  };
  const plan = adaptiveEventPlan(event, profile);
  assert.equal(plan.prepMinutes, 42);
  assert.match(plan.prepSource, /^context/);
});

test("weekday/daypart context can refine a learned destination", () => {
  const epoch = Math.floor(new Date("2026-10-12T14:00:00-04:00").getTime() / 1000);
  const metric = selectContextMetric([{
    context: "Juravinski Hospital",
    minutes: 30,
    samples: 8,
    confidence: "strong",
    confidence_score: 0.9,
    weekday: { mon: { minutes: 36, samples: 3, confidence: "useful", confidence_score: 0.7 } },
    daypart: { afternoon: { minutes: 34, samples: 4, confidence: "useful", confidence_score: 0.8 } },
  }], "Juravinski Hospital", epoch, 2);
  assert.equal(metric.minutes, 34);
  assert.equal(metric.pattern, "daypart:afternoon");
});

test("event-to-event transitions account for prep and travel", () => {
  const profile = {
    prep_by_category: { work: { minutes: 30, learned: true, confidence: "useful" } },
    prep_by_context: [],
    travel_by_context: [{ context: "Hospital", minutes: 30, samples: 5, confidence: "useful", weekday: {}, daypart: {} }],
    travel_by_route: [],
  };
  const transitions = buildEventTransitions([
    { id: 1, title: "Gym", start_at: 1000, end_at: 4600, all_day: 0, location: "Gym", category: "workout", notes: "" },
    { id: 2, title: "ER Shift", start_at: 7000, end_at: 10000, all_day: 0, location: "Hospital", category: "work", notes: "" },
  ], profile);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].gap_minutes, 40);
  assert.equal(transitions[0].required_minutes, 60);
  assert.equal(transitions[0].status, "conflict");
  assert.equal(transitions[0].slack_minutes, -20);
});

test("confidence rewards consistent evidence and penalizes noisy evidence", () => {
  const now = Math.floor(Date.now() / 1000);
  const consistent = confidenceFromMeasurements([29, 30, 30, 31, 30, 29, 31, 30], now);
  const noisy = confidenceFromMeasurements([10, 60, 20, 75, 15, 80, 25, 70], now);
  assert.equal(consistent.confidence, "strong");
  assert.ok(consistent.confidence_score > noisy.confidence_score);
});
''')
