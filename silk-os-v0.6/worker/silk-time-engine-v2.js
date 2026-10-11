const TIME_ZONE = "America/Toronto";
const DEFAULT_PREP = { work: 30, school: 30, study: 10, workout: 15, appointment: 20, personal: 10, other: 10 };
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function localTimingContext(epochSeconds) {
  const milliseconds = Number(epochSeconds || 0) * 1000;
  if (!milliseconds) return { weekday: null, weekday_name: null, hour: null, daypart: null };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    weekday: "short",
    hourCycle: "h23",
    hour: "2-digit",
  }).formatToParts(new Date(milliseconds));
  const weekdayText = String(parts.find((part) => part.type === "weekday")?.value || "").slice(0, 3).toLowerCase();
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return {
    weekday: WEEKDAYS.indexOf(weekdayText),
    weekday_name: weekdayText || null,
    hour: Number.isFinite(hour) ? hour : null,
    daypart: Number.isFinite(hour) ? daypartForHour(hour) : null,
  };
}

export function measurementStats(rows, fallback = null) {
  const cleanRows = (rows || [])
    .map((row) => ({ actual: Number(row.actual), occurredAt: Number(row.occurredAt || 0) }))
    .filter((row) => Number.isFinite(row.actual) && row.actual > 0)
    .sort((a, b) => b.occurredAt - a.occurredAt);
  const values = cleanRows.map((row) => row.actual);
  if (!values.length) {
    return {
      minutes: fallback,
      samples: 0,
      confidence: "learning",
      confidence_score: 0,
      variability_minutes: null,
      latest_at: null,
    };
  }
  const minutes = robust(values, fallback ?? values[0]);
  const center = median(values);
  const deviations = values.map((value) => Math.abs(value - center));
  const variability = median(deviations);
  const latestAt = cleanRows[0]?.occurredAt || null;
  const ageDays = latestAt ? Math.max(0, (Date.now() / 1000 - latestAt) / 86400) : 365;
  const sampleScore = Math.min(1, values.length / 8);
  const consistencyScore = Math.max(0.35, Math.min(1, 1 - (center > 0 ? variability / center : 1)));
  const recencyScore = ageDays <= 14 ? 1 : ageDays <= 30 ? 0.9 : ageDays <= 60 ? 0.75 : 0.6;
  const score = round2(sampleScore * 0.55 + consistencyScore * 0.3 + recencyScore * 0.15);
  return {
    minutes: Math.max(1, Math.round(minutes)),
    samples: values.length,
    confidence: confidenceLabel(score),
    confidence_score: score,
    variability_minutes: Math.round(variability * 10) / 10,
    latest_at: latestAt,
  };
}

export function buildContextMetrics(rows, { fallback = null, max = 16 } = {}) {
  const groups = new Map();
  for (const row of rows || []) {
    const context = cleanContext(row.context);
    const actual = Number(row.actual);
    const occurredAt = Number(row.occurredAt || 0);
    if (!context || !Number.isFinite(actual) || actual <= 0) continue;
    const key = context.toLowerCase();
    const group = groups.get(key) || { context, rows: [] };
    if (group.rows.length < 60) group.rows.push({ actual, occurredAt });
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => {
      const overall = measurementStats(group.rows, fallback);
      const weekday = {};
      const daypart = {};
      for (const name of WEEKDAYS) {
        const subset = group.rows.filter((row) => localTimingContext(row.occurredAt).weekday_name === name);
        if (subset.length >= 2) weekday[name] = measurementStats(subset, overall.minutes);
      }
      for (const name of ["morning", "afternoon", "evening", "night"]) {
        const subset = group.rows.filter((row) => localTimingContext(row.occurredAt).daypart === name);
        if (subset.length >= 2) daypart[name] = measurementStats(subset, overall.minutes);
      }
      return { context: group.context, ...overall, weekday, daypart };
    })
    .sort((a, b) => b.samples - a.samples || b.confidence_score - a.confidence_score)
    .slice(0, max);
}

export function preferredWindows(epochSecondsList) {
  const groups = new Map();
  for (const epoch of epochSecondsList || []) {
    const context = localTimingContext(epoch);
    if (context.hour == null || !context.weekday_name || !context.daypart) continue;
    const key = `${context.weekday_name}:${context.daypart}`;
    const group = groups.get(key) || {
      weekday: context.weekday,
      weekday_name: context.weekday_name,
      daypart: context.daypart,
      hours: [],
      samples: 0,
    };
    group.hours.push(context.hour);
    group.samples += 1;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      weekday: group.weekday,
      weekday_name: group.weekday_name,
      daypart: group.daypart,
      start_hour: mode(group.hours),
      samples: group.samples,
      confidence: group.samples >= 5 ? "strong" : group.samples >= 3 ? "useful" : "learning",
    }))
    .sort((a, b) => b.samples - a.samples)
    .slice(0, 6);
}

export function selectContextMetric(metrics, context, epochSeconds, minimumSamples = 2) {
  const key = cleanContext(context).toLowerCase();
  if (!key) return null;
  const metric = (metrics || []).find((item) => cleanContext(item.context).toLowerCase() === key);
  if (!metric || Number(metric.samples || 0) < minimumSamples) return null;
  const timing = localTimingContext(epochSeconds);
  const weekdayMetric = timing.weekday_name ? metric.weekday?.[timing.weekday_name] : null;
  const daypartMetric = timing.daypart ? metric.daypart?.[timing.daypart] : null;
  const candidates = [weekdayMetric, daypartMetric]
    .filter(Boolean)
    .sort((a, b) => Number(b.confidence_score || 0) - Number(a.confidence_score || 0) || Number(b.samples || 0) - Number(a.samples || 0));
  const selected = candidates[0] || metric;
  return {
    ...selected,
    context: metric.context,
    pattern: selected === metric ? "overall" : selected === weekdayMetric ? `weekday:${timing.weekday_name}` : `daypart:${timing.daypart}`,
  };
}

export function adaptiveEventPlanV2(event, profile, previousEvent = null) {
  const category = normalizeCategory(event?.category);
  const startAt = Number(event?.start_at || 0);
  const location = cleanContext(event?.location);
  const title = cleanContext(event?.title);
  const prepOverride = noteMinutes(event?.notes, "prep");
  const travelOverride = noteMinutes(event?.notes, "travel");

  const prepContext = selectContextMetric(profile?.prep_by_context, location || title, startAt, 2);
  const categoryPrep = profile?.prep_by_category?.[category];
  const prepMinutes = prepOverride
    ?? (prepContext ? Number(prepContext.minutes) : null)
    ?? (categoryPrep?.learned ? Number(categoryPrep.minutes) : null)
    ?? DEFAULT_PREP[category]
    ?? 10;
  const prepSource = prepOverride != null
    ? "explicit"
    : prepContext
      ? `context:${prepContext.pattern}`
      : categoryPrep?.learned
        ? "category"
        : "default";

  const originContext = cleanContext(previousEvent?.location);
  const routeKey = originContext && location ? `${originContext} → ${location}` : "";
  const routeMetric = routeKey ? selectContextMetric(profile?.travel_by_route, routeKey, startAt, 2) : null;
  const travelContext = location ? selectContextMetric(profile?.travel_by_context, location, startAt, 2) : null;
  let travelMinutes = travelOverride;
  let travelSource = travelOverride != null ? "explicit" : "none";
  if (travelMinutes == null && routeMetric) {
    travelMinutes = Number(routeMetric.minutes);
    travelSource = `route:${routeMetric.pattern}`;
  }
  if (travelMinutes == null && travelContext) {
    travelMinutes = Number(travelContext.minutes);
    travelSource = `destination:${travelContext.pattern}`;
  }
  if (travelMinutes == null && location) {
    travelMinutes = 30;
    travelSource = "default";
  }
  travelMinutes = Math.max(0, Number(travelMinutes || 0));

  const leaveBy = startAt - travelMinutes * 60;
  const prepStart = leaveBy - Number(prepMinutes) * 60;
  const prepConfidence = prepContext?.confidence || categoryPrep?.confidence || "learning";
  const travelConfidence = routeMetric?.confidence || travelContext?.confidence || (travelOverride != null ? "explicit" : "learning");

  return {
    prepMinutes: Number(prepMinutes),
    travelMinutes,
    leaveBy,
    prepStart,
    prepSource,
    travelSource,
    prepConfidence,
    travelConfidence,
  };
}

export function buildEventTransitions(events, profile) {
  const timed = (events || [])
    .filter((event) => !Number(event.all_day) && Number(event.start_at) > 0 && Number(event.end_at) > 0)
    .sort((a, b) => Number(a.start_at) - Number(b.start_at));
  const transitions = [];
  for (let index = 1; index < timed.length; index += 1) {
    const previous = timed[index - 1];
    const next = timed[index];
    const gapMinutes = Math.round((Number(next.start_at) - Number(previous.end_at)) / 60);
    if (gapMinutes > 12 * 60) continue;
    const plan = adaptiveEventPlanV2(next, profile, previous);
    const requiredMinutes = Math.max(0, Math.round(plan.prepMinutes + plan.travelMinutes));
    const slackMinutes = gapMinutes - requiredMinutes;
    const status = slackMinutes < 0 ? "conflict" : slackMinutes < 15 ? "tight" : slackMinutes < 45 ? "workable" : "comfortable";
    transitions.push({
      from_event_id: Number(previous.id),
      from_title: String(previous.title || "Previous event"),
      from_location: String(previous.location || ""),
      from_end_at: Number(previous.end_at),
      to_event_id: Number(next.id),
      to_title: String(next.title || "Next event"),
      to_location: String(next.location || ""),
      to_start_at: Number(next.start_at),
      gap_minutes: gapMinutes,
      prep_minutes: Math.round(plan.prepMinutes),
      travel_minutes: Math.round(plan.travelMinutes),
      required_minutes: requiredMinutes,
      slack_minutes: slackMinutes,
      status,
      prep_source: plan.prepSource,
      travel_source: plan.travelSource,
    });
  }
  return transitions;
}

export function confidenceFromMeasurements(values, occurredAt = null) {
  const rows = (values || []).map((actual, index) => ({
    actual,
    occurredAt: Array.isArray(occurredAt) ? occurredAt[index] : occurredAt || Math.floor(Date.now() / 1000),
  }));
  return measurementStats(rows, null);
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

function daypartForHour(hour) {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

function robust(values, fallback) {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!valid.length) return fallback;
  if (valid.length < 5) return median(valid);
  const trim = Math.max(1, Math.floor(valid.length * 0.1));
  const trimmed = valid.slice(trim, valid.length - trim);
  const sample = trimmed.length ? trimmed : valid;
  return sample.reduce((sum, value) => sum + value, 0) / sample.length;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mode(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
}

function confidenceLabel(score) {
  if (score >= 0.8) return "strong";
  if (score >= 0.55) return "useful";
  return "learning";
}

function cleanContext(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 180) : "";
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
