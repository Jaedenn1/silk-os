"use client";

import {
  Activity,
  AlertTriangle,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Dumbbell,
  FolderKanban,
  ListChecks,
  MapPin,
  Navigation,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import SilkRouteMap from "./components/silk-route-map";
import styles from "./today-v2.module.css";

type DailyItem = {
  id: number;
  title: string;
  kind: string;
  source_type: string;
  status: "todo" | "doing" | "done" | "skipped";
  scheduled_at?: number | null;
  duration_minutes?: number;
  priority?: number;
};

type CalendarEvent = {
  id: number;
  title: string;
  start_at: number;
  end_at: number;
  all_day: boolean;
  location: string;
  notes?: string;
  category: string;
  requires_completion?: boolean;
  completion_status?: string;
};

type Project = {
  id: number;
  name: string;
  status: string;
  priority: number;
  open_tasks: number;
  due_at?: number | null;
};

type Approval = { id: number; status: string };

type TodayData = {
  today: {
    date: string;
    items: DailyItem[];
    progress: { completed: number; total: number; percent: number };
    focus_minutes: number;
    deadlines: Array<{ id: number; name: string; due_at: number; priority: number }>;
  };
  projects: Project[];
  study: { weakest_topics?: Array<Record<string, unknown>> };
  workouts: { active?: Record<string, unknown> | null };
  approvals: Approval[];
};

type EventPlan = {
  prepMinutes: number;
  travelMinutes: number;
  prepStart: number;
  leaveBy: number;
  estimatedTravel: boolean;
  prepSource?: string;
  travelSource?: string;
};

type TimelineEntry = {
  key: string;
  title: string;
  start: number | null;
  end: number | null;
  source: "calendar" | "task";
  meta: string;
  done: boolean;
  dailyItem?: DailyItem;
  calendarEvent?: CalendarEvent;
  plan?: EventPlan | null;
};

type Need = {
  key: string;
  title: string;
  meta: string;
  tone: "urgent" | "task" | "study" | "project" | "fitness" | "system";
};

type FreeWindow = { start: number; end: number; minutes: number };
type Conflict = { key: string; title: string; meta: string; tone: "hard" | "buffer" };
type SleepSignal = { event: CalendarEvent; wakeAt: number; bedtime: number; windDown: number };
type RouteEstimate = {
  eventId: number;
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number; label: string; query: string };
  travel_minutes: number;
  travel_seconds: number;
  distance_km: number;
  geometry: { type: "LineString"; coordinates: number[][] } | null;
  map_style_url: string;
  traffic: {
    live: boolean;
    delay_minutes: number;
    delay_seconds: number;
    affected_km: number;
    provider: string | null;
  };
  cached: boolean;
  estimate: boolean;
};

type PendingCheckin = {
  key: string;
  entity_type: "calendar_event" | "project_task" | "daily_item";
  entity_id: string;
  daily_item_id?: number | null;
  title: string;
  category: string;
  ended_at: number;
  meta: string;
};

type CompletionSummary = {
  streaks: {
    overall: { current: number; best: number };
    workout: { current: number; best: number };
    study: { current: number; best: number };
    project: { current: number; best: number };
  };
  achievements: Array<{ id: string; title: string; description: string; unlocked: boolean; progress: number; target: number }>;
  rates: {
    seven_day: { completed: number; missed: number; total: number; percent: number | null };
    thirty_day: { completed: number; missed: number; total: number; percent: number | null };
  };
  recommendation_signal: {
    mode: "neutral" | "building" | "steady" | "reset";
    completion_rate_7d: number | null;
    missed_category: string | null;
    current_streak: number;
  };
};


type ContextTimingMetric = {
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

type AdaptiveTimeProfile = {
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

const DEFAULT_PREP: Record<string, number> = {
  work: 30,
  school: 30,
  study: 10,
  workout: 15,
  appointment: 20,
  personal: 10,
  other: 10,
};

function clock(epoch?: number | null) {
  if (!epoch) return "";
  return new Date(epoch * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function minutesLabel(value?: number) {
  const minutes = Math.max(0, Math.round(Number(value || 0)));
  if (!minutes) return "Flexible";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function label(value: string) {
  return String(value || "").replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function relativeFuture(epoch: number) {
  const diff = epoch * 1000 - Date.now();
  if (diff <= 0) return "now";
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `in ${hours}h ${rest}m` : `in ${hours}h`;
}

function dueLabel(epoch: number) {
  const diff = epoch * 1000 - Date.now();
  if (diff < 0) return "Overdue";
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `Due in ${Math.max(1, mins)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Due in ${hours}h`;
  return `Due ${new Date(epoch * 1000).toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function findNavButton(labelText: string) {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".side-nav button"));
  return buttons.find((button) => button.textContent?.trim() === labelText) || null;
}

function dayBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 14, 0);
  return {
    startDate: start,
    endDate: end,
    tomorrowNoon,
    start: Math.floor(start.getTime() / 1000),
    end: Math.floor(end.getTime() / 1000),
    tomorrowNoonEpoch: Math.floor(tomorrowNoon.getTime() / 1000),
  };
}

function noteMinutes(notes: string | undefined, key: "prep" | "travel") {
  const match = String(notes || "").match(new RegExp(`(?:^|\\s)${key}\\s*[:=]\\s*(\\d{1,3})(?:m|min|mins|minutes)?\\b`, "i"));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 && value <= 240 ? value : null;
}

function torontoTiming(epoch: number) {
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

function planEvent(event: CalendarEvent, liveRoute?: RouteEstimate | null, profile?: AdaptiveTimeProfile | null, previousEvent?: CalendarEvent | null): EventPlan | null {
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

export default function TodayV2Bridge() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState(false);
  const [data, setData] = useState<TodayData | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [pendingCheckins, setPendingCheckins] = useState<PendingCheckin[]>([]);
  const [completionSummary, setCompletionSummary] = useState<CompletionSummary | null>(null);
  const [timeProfile, setTimeProfile] = useState<AdaptiveTimeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [error, setError] = useState("");
  const [routeEstimate, setRouteEstimate] = useState<RouteEstimate | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [, setTick] = useState(0);

  const syncShell = useCallback(() => {
    const workspace = document.querySelector<HTMLElement>(".workspace-scroll");
    const title = document.querySelector<HTMLElement>(".topbar-title h1")?.textContent?.trim();
    setTarget(workspace);
    setActive(Boolean(workspace && title === "Today"));
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(syncShell, 0);
    const observer = new MutationObserver(syncShell);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      window.clearTimeout(initial);
      observer.disconnect();
    };
  }, [syncShell]);

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".silk-shell");
    if (!shell) return;
    shell.classList.toggle("today-v2-active", active && Boolean(data));
    return () => shell.classList.remove("today-v2-active");
  }, [active, data]);

  const load = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError("");
    try {
      const sessionResponse = await fetch("/api/session", { credentials: "same-origin" });
      const session = (await sessionResponse.json().catch(() => ({}))) as { configured?: boolean; authenticated?: boolean };
      if (!session.configured || !session.authenticated) return;

      const bounds = dayBounds();
      const query = new URLSearchParams({
        from: bounds.startDate.toISOString(),
        to: bounds.tomorrowNoon.toISOString(),
      });
      const bootstrapResponse = await fetch("/api/bootstrap", { credentials: "same-origin" });
      if (!bootstrapResponse.ok) throw new Error("Today could not load your SILK data.");
      setData((await bootstrapResponse.json()) as TodayData);

      const [calendarResponse, pendingResponse, completionResponse, timeResponse] = await Promise.all([
        fetch(`/api/silk-calendar/events?${query}`, { credentials: "same-origin" }),
        fetch("/api/completions/pending", { credentials: "same-origin" }),
        fetch("/api/completions/summary", { credentials: "same-origin" }),
        fetch("/api/time-engine/profile", { credentials: "same-origin" }),
      ]);

      if (calendarResponse.ok) {
        const payload = (await calendarResponse.json().catch(() => ({}))) as { events?: CalendarEvent[] };
        setEvents(Array.isArray(payload.events) ? payload.events : []);
      } else {
        setEvents([]);
      }

      if (pendingResponse.ok) {
        const payload = (await pendingResponse.json().catch(() => ({}))) as { pending?: PendingCheckin[] };
        setPendingCheckins(Array.isArray(payload.pending) ? payload.pending : []);
      } else {
        setPendingCheckins([]);
      }

      if (completionResponse.ok) {
        setCompletionSummary((await completionResponse.json().catch(() => null)) as CompletionSummary | null);
      } else {
        setCompletionSummary(null);
      }

      if (timeResponse.ok) {
        setTimeProfile((await timeResponse.json().catch(() => null)) as AdaptiveTimeProfile | null);
      } else {
        setTimeProfile(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Today could not refresh.");
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const initial = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initial);
  }, [active, load]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      setTick((value) => value + 1);
      void load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [active, load]);

  const todayEvents = useMemo(() => {
    const bounds = dayBounds();
    return events
      .filter((event) => event.start_at < bounds.end && event.end_at >= bounds.start)
      .sort((a, b) => a.start_at - b.start_at);
  }, [events]);

  const tomorrowFirst = useMemo(() => {
    const bounds = dayBounds();
    return [...events]
      .filter((event) => !event.all_day && event.start_at >= bounds.end && event.start_at < bounds.tomorrowNoonEpoch)
      .sort((a, b) => a.start_at - b.start_at)[0] || null;
  }, [events]);

  const timeline = useMemo<TimelineEntry[]>(() => {
    const calendarEntries: TimelineEntry[] = todayEvents.map((event, index) => ({
      key: `calendar-${event.id}`,
      title: event.title,
      start: event.all_day ? null : event.start_at,
      end: event.all_day ? null : event.end_at,
      source: "calendar",
      meta: `${label(event.category || "Calendar")}${event.location ? ` · ${event.location}` : ""}`,
      done: event.requires_completion
        ? event.completion_status === "completed"
        : event.end_at < Date.now() / 1000,
      calendarEvent: event,
      plan: planEvent(event, routeEstimate, timeProfile, index > 0 ? todayEvents[index - 1] : null),
    }));

    const taskEntries: TimelineEntry[] = (data?.today.items || [])
      .filter((item) => item.status !== "skipped" && item.scheduled_at)
      .map((item) => ({
        key: `task-${item.id}`,
        title: item.title,
        start: Number(item.scheduled_at),
        end: Number(item.scheduled_at) + Number(item.duration_minutes || 30) * 60,
        source: "task",
        meta: `${label(item.source_type || "Task")} · ${minutesLabel(item.duration_minutes)}`,
        done: item.status === "done",
        dailyItem: item,
      }));

    return [...calendarEntries, ...taskEntries].sort((a, b) => {
      if (a.start === null && b.start !== null) return -1;
      if (a.start !== null && b.start === null) return 1;
      return Number(a.start || 0) - Number(b.start || 0);
    });
  }, [data, routeEstimate, timeProfile, todayEvents]);

  const conflicts = useMemo<Conflict[]>(() => {
    const timed = timeline
      .filter((item) => item.start !== null && item.end !== null)
      .sort((a, b) => Number(a.start) - Number(b.start));
    const result: Conflict[] = [];

    for (let index = 1; index < timed.length; index += 1) {
      const previous = timed[index - 1];
      const current = timed[index];
      if (Number(current.start) < Number(previous.end)) {
        result.push({
          key: `hard-${previous.key}-${current.key}`,
          title: `${previous.title} overlaps ${current.title}`,
          meta: `${clock(Number(current.start))} starts before the previous block ends at ${clock(Number(previous.end))}.`,
          tone: "hard",
        });
        continue;
      }

      if (current.plan && current.plan.prepStart < Number(previous.end)) {
        result.push({
          key: `buffer-${previous.key}-${current.key}`,
          title: `Not enough buffer before ${current.title}`,
          meta: `Prep should begin at ${clock(current.plan.prepStart)}, but ${previous.title} runs until ${clock(Number(previous.end))}.`,
          tone: "buffer",
        });
      }
    }

    return result.slice(0, 4);
  }, [timeline]);

  const sleepSignal = useMemo<SleepSignal | null>(() => {
    if (!tomorrowFirst) return null;
    const plan = planEvent(tomorrowFirst, null, timeProfile);
    if (!plan) return null;
    const wakeAt = plan.prepStart - 60 * 60;
    const bedtime = wakeAt - 8 * 60 * 60;
    return { event: tomorrowFirst, wakeAt, bedtime, windDown: bedtime - 30 * 60 };
  }, [timeProfile, tomorrowFirst]);

  const needs = useMemo<Need[]>(() => {
    const items: Need[] = [];
    const bounds = dayBounds();

    for (const deadline of [...(data?.today.deadlines || [])]
      .filter((deadline) => Number(deadline.due_at) <= bounds.end)
      .sort((a, b) => Number(a.due_at) - Number(b.due_at))
      .slice(0, 3)) {
      items.push({
        key: `deadline-${deadline.id}`,
        title: deadline.name,
        meta: `${dueLabel(deadline.due_at)} · priority ${deadline.priority}/5`,
        tone: "urgent",
      });
    }

    for (const item of [...(data?.today.items || [])]
      .filter((task) => !task.scheduled_at && !["done", "skipped"].includes(task.status))
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
      .slice(0, 3)) {
      items.push({
        key: `task-${item.id}`,
        title: item.title,
        meta: `${label(item.source_type || "Task")} · ${minutesLabel(item.duration_minutes)} · needs a time`,
        tone: "task",
      });
    }

    const weakest = data?.study.weakest_topics?.[0];
    const weakestTopic = String(weakest?.topic || "").trim();
    if (weakestTopic && weakestTopic.toLowerCase() !== "caught up") {
      const score = weakest?.score == null ? "" : ` · ${String(weakest.score)}%`;
      items.push({ key: "study", title: `Review ${weakestTopic}`, meta: `Study focus${score}`, tone: "study" });
    }

    const project = [...(data?.projects || [])]
      .filter((item) => item.status === "active" && item.open_tasks > 0)
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))[0];
    if (project) {
      items.push({
        key: `project-${project.id}`,
        title: project.name,
        meta: `${project.open_tasks} open task${project.open_tasks === 1 ? "" : "s"} · priority ${project.priority}/5`,
        tone: "project",
      });
    }

    if (data?.workouts.active) {
      items.push({ key: "workout", title: "Workout in progress", meta: "Finish or log the active session", tone: "fitness" });
    }

    const pending = data?.approvals.filter((approval) => approval.status === "pending").length || 0;
    if (pending) {
      items.push({
        key: "approvals",
        title: `${pending} SILK approval${pending === 1 ? "" : "s"} waiting`,
        meta: "Your decision is required",
        tone: "system",
      });
    }

    return items.slice(0, 7);
  }, [data]);

  const protectedIntervals = useMemo(() => {
    return timeline
      .filter((item) => item.start !== null && item.end !== null)
      .map((item) => ({
        start: Math.max(dayBounds().start, item.plan?.prepStart ?? Number(item.start)),
        end: Number(item.end),
      }));
  }, [timeline]);

  const freeWindows = useMemo<FreeWindow[]>(() => {
    const bounds = dayBounds();
    const now = Math.max(Math.floor(Date.now() / 1000), bounds.start);
    const defaultFinish = Math.floor(new Date(bounds.startDate.getFullYear(), bounds.startDate.getMonth(), bounds.startDate.getDate(), 23, 0).getTime() / 1000);
    const sleepFinish = sleepSignal && sleepSignal.bedtime > now && sleepSignal.bedtime < bounds.end ? sleepSignal.bedtime : defaultFinish;
    const dayFinish = Math.min(bounds.end, sleepFinish);
    if (now >= dayFinish) return [];

    const intervals = protectedIntervals
      .filter((interval) => interval.end > now)
      .map((interval) => ({ start: Math.max(now, interval.start), end: Math.min(dayFinish, interval.end) }))
      .filter((interval) => interval.end > interval.start)
      .sort((a, b) => a.start - b.start);

    const merged: Array<{ start: number; end: number }> = [];
    for (const interval of intervals) {
      const last = merged[merged.length - 1];
      if (!last || interval.start > last.end) merged.push({ ...interval });
      else last.end = Math.max(last.end, interval.end);
    }

    const windows: FreeWindow[] = [];
    let cursor = now;
    for (const interval of merged) {
      if (interval.start - cursor >= 30 * 60) {
        windows.push({ start: cursor, end: interval.start, minutes: Math.round((interval.start - cursor) / 60) });
      }
      cursor = Math.max(cursor, interval.end);
    }
    if (dayFinish - cursor >= 30 * 60) {
      windows.push({ start: cursor, end: dayFinish, minutes: Math.round((dayFinish - cursor) / 60) });
    }
    return windows.slice(0, 4);
  }, [protectedIntervals, sleepSignal]);

  const nextEntry = useMemo(() => {
    const now = Date.now() / 1000;
    const live = timeline.find((item) => item.start !== null && item.end !== null && Number(item.start) <= now && Number(item.end) >= now && !item.done);
    if (live) return { item: live, status: "Happening now" };
    const upcoming = timeline.find((item) => item.start !== null && Number(item.start) >= now && !item.done);
    if (upcoming) return { item: upcoming, status: relativeFuture(Number(upcoming.start)) };
    return null;
  }, [timeline]);

  const nextLogistics = useMemo(() => {
    const now = Date.now() / 1000;
    const upcoming = timeline.find((item) => item.source === "calendar" && item.start !== null && Number(item.start) > now && item.plan);
    return upcoming || null;
  }, [timeline]);

  const routeTarget = useMemo(() => {
    const now = Date.now() / 1000;
    return [...todayEvents]
      .filter((event) => !event.all_day && event.start_at > now && Boolean(event.location.trim()))
      .sort((a, b) => a.start_at - b.start_at)[0] || null;
  }, [todayEvents]);

  const liveRoute = routeEstimate && routeTarget && routeEstimate.eventId === routeTarget.id ? routeEstimate : null;

  const bestFit = useMemo(() => {
    if (!freeWindows.length) return null;
    const tasks = [...(data?.today.items || [])]
      .filter((item) => !item.scheduled_at && !["done", "skipped"].includes(item.status))
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
    for (const window of freeWindows) {
      const task = tasks.find((item) => Number(item.duration_minutes || 30) <= window.minutes);
      if (task) return { task, window };
    }
    return null;
  }, [data, freeWindows]);

  const recommended = useMemo(() => {
    const now = Date.now() / 1000;
    if (nextEntry?.status === "Happening now") return { title: nextEntry.item.title, meta: "Stay with the current block." };

    const logistics = nextLogistics?.plan;
    if (nextLogistics && logistics) {
      if (logistics.travelMinutes > 0 && now >= logistics.leaveBy) {
        return { title: `Leave for ${nextLogistics.title}`, meta: `${logistics.estimatedTravel ? "Estimated " : ""}${logistics.travelMinutes} min travel · starts ${clock(nextLogistics.start)}.` };
      }
      if (now >= logistics.prepStart) {
        return { title: `Get ready for ${nextLogistics.title}`, meta: `${logistics.prepMinutes} min prep${logistics.travelMinutes ? ` + ${logistics.travelMinutes} min travel` : ""}.` };
      }
    }

    if (conflicts.length) return { title: "Resolve today’s schedule conflict", meta: conflicts[0].title };

    const urgent = needs.find((item) => item.tone === "urgent");
    if (urgent) return { title: urgent.title, meta: urgent.meta };

    const completionSignal = completionSummary?.recommendation_signal;
    if (completionSignal?.mode === "reset" && completionSignal.missed_category) {
      const tone = completionSignal.missed_category === "workout" ? "fitness" : completionSignal.missed_category === "study" ? "study" : completionSignal.missed_category === "project" ? "project" : null;
      const resetNeed = tone ? needs.find((item) => item.tone === tone) : null;
      if (resetNeed) return { title: resetNeed.title, meta: `Your recent completion history says ${completionSignal.missed_category} needs a reset. Make this the next clean win.` };
    }

    if (bestFit) {
      return {
        title: bestFit.task.title,
        meta: completionSignal?.mode === "reset"
          ? `Rebuild momentum with a finishable win. This fits inside your ${minutesLabel(bestFit.window.minutes)} window ending at ${clock(bestFit.window.end)}.`
          : `Fits inside your ${minutesLabel(bestFit.window.minutes)} window ending at ${clock(bestFit.window.end)}.`,
      };
    }

    if (sleepSignal && now >= sleepSignal.windDown) {
      return { title: "Protect tomorrow’s sleep", meta: `Aim to be asleep around ${clock(sleepSignal.bedtime)} for ${sleepSignal.event.title}.` };
    }

    const study = needs.find((item) => item.tone === "study");
    if (study) return { title: study.title, meta: "This is your clearest learning gap right now." };
    const project = needs.find((item) => item.tone === "project");
    if (project) return { title: project.title, meta: project.meta };
    if (nextEntry) return { title: nextEntry.item.title, meta: `Coming up ${nextEntry.status}.` };
    return { title: "Protect the open space", meta: "Nothing urgent is competing for your attention right now." };
  }, [bestFit, completionSummary, conflicts, needs, nextEntry, nextLogistics, sleepSignal]);

  const toggleTask = useCallback(async (item: DailyItem) => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/today/${item.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: item.status === "done" ? "todo" : "done", completion_source: "today_v2" }),
      });
      if (!response.ok) throw new Error("Could not update that task.");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not update that task.");
    } finally {
      setSaving(false);
    }
  }, [load, saving]);

  const respondCheckin = useCallback(async (checkin: PendingCheckin, result: "completed" | "not_completed") => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/completions/respond", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...checkin, result }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; summary?: CompletionSummary };
      if (!response.ok) throw new Error(payload.error || "Could not save that check-in.");
      if (payload.summary) setCompletionSummary(payload.summary);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not save that check-in.");
    } finally {
      setSaving(false);
    }
  }, [load, saving]);

  const addTask = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const title = newTask.trim();
    if (!title || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/today", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: data?.today.date, title, priority: 3 }),
      });
      if (!response.ok) throw new Error("Could not add that task.");
      setNewTask("");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not add that task.");
    } finally {
      setSaving(false);
    }
  }, [data?.today.date, load, newTask, saving]);

  const requestLiveRoute = useCallback(() => {
    if (!routeTarget || routeBusy) return;
    if (!navigator.geolocation) {
      setError("This browser does not expose device location to SILK.");
      return;
    }

    setRouteBusy(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void (async () => {
          try {
            const response = await fetch("/api/maps/route", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                origin: { lat: position.coords.latitude, lon: position.coords.longitude },
                destination: routeTarget.location,
                mode: "auto",
              }),
            });
            const payload = await response.json().catch(() => ({})) as Omit<RouteEstimate, "eventId"> & { error?: string };
            if (!response.ok) throw new Error(payload.error || "SILK could not calculate that route.");
            setRouteEstimate({ ...payload, eventId: routeTarget.id });
            void fetch("/api/time-engine/observe", {
              method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                kind: "travel_estimate",
                category: routeTarget.category,
                context_key: routeTarget.location,
                actual_minutes: payload.travel_minutes,
                metadata: { traffic_delay_minutes: payload.traffic?.delay_minutes || 0, provider: payload.traffic?.provider || null },
              }),
            }).catch(() => undefined);
          } catch (routeError) {
            setError(routeError instanceof Error ? routeError.message : "SILK could not calculate that route.");
          } finally {
            setRouteBusy(false);
          }
        })();
      },
      (locationError) => {
        setRouteBusy(false);
        setError(locationError.code === 1
          ? "Location permission was not granted. SILK will keep the fallback travel estimate."
          : "SILK could not read your current location. The fallback travel estimate is still active.");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }, [routeBusy, routeTarget]);

  const togglePrepTracking = useCallback(async () => {
    const entry = nextLogistics;
    const event = entry?.calendarEvent;
    const plan = entry?.plan;
    if (!event || !plan || saving) return;
    const tracking = timeProfile?.active_prep?.event_id === event.id;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/time-engine/prep/${tracking ? "finish" : "start"}`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: event.id, title: event.title, category: event.category, planned_minutes: plan.prepMinutes }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; profile?: AdaptiveTimeProfile };
      if (!response.ok) throw new Error(payload.error || "SILK could not update the prep timer.");
      if (payload.profile) setTimeProfile(payload.profile);
      await load();
    } catch (prepError) {
      setError(prepError instanceof Error ? prepError.message : "SILK could not update the prep timer.");
    } finally {
      setSaving(false);
    }
  }, [load, nextLogistics, saving, timeProfile]);

  const openView = useCallback((name: string) => findNavButton(name)?.click(), []);

  if (!target || !active || !data) return null;

  const unfinishedTasks = data.today.items.filter((item) => !["done", "skipped"].includes(item.status)).length;
  const nowLabel = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const totalFree = freeWindows.reduce((sum, window) => sum + window.minutes, 0);

  const content = (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>DAILY COMMAND CENTER</span>
          <h1>{nowLabel}</h1>
          <p>{nextEntry ? `${nextEntry.item.title} is ${nextEntry.status.toLowerCase()}.` : "Your schedule is open right now."} SILK has combined your commitments, prep, travel buffers, tasks, and tomorrow’s first signal.</p>
        </div>
        <button className={styles.refresh} onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> {loading ? "Syncing" : "Refresh"}</button>
      </section>

      {error && <div className={styles.errorBanner}><AlertTriangle size={14} /><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}

      <section className={styles.stats}>
        <div><span>Scheduled</span><strong>{todayEvents.length + timeline.filter((item) => item.source === "task").length}</strong><small>time blocks</small></div>
        <div><span>Tasks</span><strong>{unfinishedTasks}</strong><small>still open</small></div>
        <div className={conflicts.length ? styles.statWarn : ""}><span>Conflicts</span><strong>{conflicts.length}</strong><small>{conflicts.length ? "needs attention" : "schedule clear"}</small></div>
        <div><span>Free room</span><strong>{totalFree ? minutesLabel(totalFree) : "Tight"}</strong><small>after prep + travel</small></div>
      </section>

      <section className={styles.grid}>
        <article className={`${styles.card} ${styles.recommendCard}`}>
          <div className={styles.cardHeading}><div><span>RIGHT NOW</span><h2>SILK recommends</h2></div><Sparkles size={18} /></div>
          <div className={styles.recommendBody}>
            <strong>{recommended.title}</strong>
            <p>{recommended.meta}</p>
            {nextEntry && <small><Clock3 size={12} /> Next schedule signal · {nextEntry.item.start ? clock(nextEntry.item.start) : "All day"}</small>}
          </div>
        </article>

        <article className={`${styles.card} ${styles.nextCard}`}>
          <div className={styles.cardHeading}><div><span>NEXT UP</span><h2>{nextEntry?.item.title || "Open space"}</h2></div><Clock3 size={18} /></div>
          {nextEntry ? <div className={styles.nextBody}>
            <strong>{nextEntry.item.start ? clock(nextEntry.item.start) : "All day"}</strong>
            <span>{nextEntry.status}</span>
            <small>{nextEntry.item.meta}</small>
            {nextEntry.item.plan && nextEntry.status !== "Happening now" && <em>Prep {clock(nextEntry.item.plan.prepStart)}{nextEntry.item.plan.travelMinutes ? ` · Leave ${clock(nextEntry.item.plan.leaveBy)}` : ""}</em>}
          </div> : <p className={styles.empty}>Nothing scheduled next.</p>}
        </article>

        <article className={`${styles.card} ${styles.timelineCard}`}>
          <div className={styles.cardHeading}><div><span>TIMELINE</span><h2>Your day</h2></div><button onClick={() => openView("Calendar")}>Calendar <ChevronRight size={13} /></button></div>
          <div className={styles.timeline}>
            {timeline.map((item) => (
              <div className={`${styles.timelineRow} ${item.done ? styles.done : ""}`} key={item.key}>
                <div className={styles.time}>{item.start ? clock(item.start) : "ALL DAY"}</div>
                <span className={styles.lineDot}>{item.done ? <Check size={11} /> : item.source === "calendar" ? <CalendarDays size={11} /> : <ListChecks size={11} />}</span>
                <div className={styles.timelineCopy}>
                  <strong>{item.title}</strong>
                  <small>{item.end && item.start ? `${clock(item.start)}–${clock(item.end)} · ` : ""}{item.meta}</small>
                  {item.plan && item.start && <em>Prep {clock(item.plan.prepStart)}{item.plan.travelMinutes ? ` · leave ${clock(item.plan.leaveBy)} · ${item.plan.estimatedTravel ? "est. " : ""}${item.plan.travelMinutes}m travel` : ""}</em>}
                </div>
                {item.dailyItem && <button className={styles.complete} onClick={() => void toggleTask(item.dailyItem!)} disabled={saving} aria-label={item.done ? `Mark ${item.title} incomplete` : `Complete ${item.title}`}><CheckCircle2 size={16} /></button>}
              </div>
            ))}
            {!timeline.length && !loading && <p className={styles.empty}>No timed commitments today.</p>}
          </div>
        </article>

        <article className={`${styles.card} ${styles.needsCard}`}>
          <div className={styles.cardHeading}><div><span>NEEDS</span><h2>Still deserves attention</h2></div><Activity size={18} /></div>
          <div className={styles.needsList}>
            {needs.map((item) => {
              const Icon = item.tone === "urgent" ? AlertTriangle : item.tone === "study" ? BookOpen : item.tone === "project" ? FolderKanban : item.tone === "fitness" ? Dumbbell : item.tone === "system" ? ShieldCheck : ListChecks;
              return <div className={`${styles.need} ${styles[item.tone]}`} key={item.key}><span><Icon size={14} /></span><div><strong>{item.title}</strong><small>{item.meta}</small></div></div>;
            })}
            {!needs.length && !loading && <p className={styles.empty}>Nothing extra is demanding attention. Suspiciously civilized.</p>}
          </div>
        </article>

        <article className={`${styles.card} ${styles.timeEngineCard}`}>
          <div className={styles.cardHeading}><div><span>TIME ENGINE</span><h2>Prep, travel & protection</h2></div><Clock3 size={18} /></div>
          <div className={styles.engineList}>
            {nextLogistics?.plan && <div className={styles.engineRow}>
              <span>Next logistics</span>
              <strong>{nextLogistics.title}</strong>
              <small>Prep at {clock(nextLogistics.plan.prepStart)}{nextLogistics.plan.travelMinutes ? ` · leave by ${clock(nextLogistics.plan.leaveBy)} · ${nextLogistics.plan.estimatedTravel ? "estimated " : ""}${nextLogistics.plan.travelMinutes}m travel` : " · no travel buffer"}{nextLogistics.calendarEvent?.location ? ` · ${nextLogistics.calendarEvent.location}` : ""}</small>
              {nextLogistics.calendarEvent && <button className={styles.routeButton} onClick={() => void togglePrepTracking()} disabled={saving}>{timeProfile?.active_prep?.event_id === nextLogistics.calendarEvent.id ? "Ready · stop prep timer" : "Start prep timer"}</button>}
            </div>}
            {timeProfile && <div className={styles.engineRow}>
              <span>Learned behavior</span>
              <strong>{timeProfile.underestimation.factor ? `${timeProfile.underestimation.factor.toFixed(2)}× planning factor` : "Still learning your planning accuracy"}</strong>
              <small>Study target {timeProfile.study.recommended_minutes}m · workout target {timeProfile.workout.recommended_minutes}m · {timeProfile.underestimation.label}</small>
            </div>}
            {conflicts.length ? <div className={`${styles.engineRow} ${styles.engineAlert}`}>
              <span>Schedule conflict</span><strong>{conflicts[0].title}</strong><small>{conflicts[0].meta}</small>
            </div> : <div className={styles.engineRow}><span>Conflict scan</span><strong>Clear</strong><small>No overlapping commitments or prep-buffer collisions detected.</small></div>}
            {sleepSignal ? <div className={styles.engineRow}>
              <span>Sleep protection</span><strong>Wind down {clock(sleepSignal.windDown)}</strong><small>Aim asleep by {clock(sleepSignal.bedtime)} · wake around {clock(sleepSignal.wakeAt)} for tomorrow’s {clock(sleepSignal.event.start_at)} {sleepSignal.event.title}. This uses an 8h sleep target plus a 1h wake buffer.</small>
            </div> : <div className={styles.engineRow}><span>Sleep protection</span><strong>No early trigger</strong><small>No timed commitment before 2 PM tomorrow is loaded.</small></div>}
          </div>
          <p className={styles.estimateNote}>SILK now prefers explicit note overrides, then live routes, then learned recurring travel/prep patterns, and only then its safe defaults. Add <code>travel:45</code> or <code>prep:20</code> to keep an explicit value authoritative.</p>
        </article>

        <article className={`${styles.card} ${styles.routeCard}`}>
          <div className={styles.cardHeading}><div><span>LIVE TRAFFIC</span><h2>Maps, traffic & travel time</h2></div><Navigation size={18} /></div>
          {routeTarget ? liveRoute ? <div className={styles.routeLive}>
            <SilkRouteMap origin={liveRoute.origin} destination={liveRoute.destination} geometry={liveRoute.geometry} styleUrl={liveRoute.map_style_url} />
            <div className={styles.routeFacts}>
              <div><span>Drive</span><strong>{liveRoute.travel_minutes} min</strong></div>
              <div><span>Traffic delay</span><strong>{liveRoute.traffic.live ? `+${liveRoute.traffic.delay_minutes} min` : "Fallback"}</strong></div>
              <div><span>Distance</span><strong>{liveRoute.distance_km.toFixed(1)} km</strong></div>
              <div><span>Leave by</span><strong>{clock(routeTarget.start_at - liveRoute.travel_minutes * 60)}</strong></div>
            </div>
            <div className={styles.routeDestination}><MapPin size={13} /><div><strong>{routeTarget.title}</strong><small>{liveRoute.destination.label} · {liveRoute.traffic.live ? `live traffic${liveRoute.traffic.affected_km ? ` · ${liveRoute.traffic.affected_km.toFixed(1)} km affected` : ""}` : "open-route fallback · no live flow"}</small></div></div>
            <button className={styles.routeButton} onClick={requestLiveRoute} disabled={routeBusy}><Navigation size={14} /> {routeBusy ? "Routing…" : "Refresh from current location"}</button>
            <small className={styles.routeAttribution}>{liveRoute.traffic.live ? "TomTom live traffic · " : ""}OpenFreeMap · OpenStreetMap contributors · Photon · Valhalla fallback</small>
          </div> : <div className={styles.routePrompt}>
            <span className={styles.routeIcon}><MapPin size={18} /></span>
            <div><strong>{routeTarget.title}</strong><small>{routeTarget.location}</small></div>
            <p>Use your device location to calculate a real traffic-aware drive time. SILK uses its zero-cost traffic provider when configured and automatically falls back to the open route engine instead of spending money. Your precise position is requested only when you press the button.</p>
            <button className={styles.routeButton} onClick={requestLiveRoute} disabled={routeBusy}><Navigation size={14} /> {routeBusy ? "Calculating route…" : "Use current location"}</button>
          </div> : <p className={styles.empty}>No upcoming timed Calendar event has a location to route to.</p>}
        </article>

        <article className={`${styles.card} ${styles.checkinCard}`}>
          <div className={styles.cardHeading}><div><span>CHECK-INS</span><h2>Close the loop</h2></div><CheckCircle2 size={18} /></div>
          <div className={styles.checkinList}>
            {pendingCheckins.slice(0, 4).map((checkin) => <div className={styles.checkin} key={checkin.key}>
              <div><strong>{checkin.title}</strong><small>{checkin.meta} · did you complete it?</small></div>
              <div className={styles.checkinActions}><button onClick={() => void respondCheckin(checkin, "completed")} disabled={saving}><Check size={12} /> Yes</button><button onClick={() => void respondCheckin(checkin, "not_completed")} disabled={saving}>No</button></div>
            </div>)}
            {!pendingCheckins.length && <p className={styles.empty}>No completion check-ins waiting.</p>}
            {completionSummary && <div className={styles.completionPulse}>
              <div><span>Current streak</span><strong>{completionSummary.streaks.overall.current} day{completionSummary.streaks.overall.current === 1 ? "" : "s"}</strong></div>
              <div><span>7-day completion</span><strong>{completionSummary.rates.seven_day.percent == null ? "—" : `${completionSummary.rates.seven_day.percent}%`}</strong></div>
              <div><span>Achievements</span><strong>{completionSummary.achievements.filter((item) => item.unlocked).length}/{completionSummary.achievements.length}</strong></div>
            </div>}
          </div>
        </article>

        <article className={`${styles.card} ${styles.freeCard}`}>
          <div className={styles.cardHeading}><div><span>OPEN WINDOWS</span><h2>Actually usable free time</h2></div><Clock3 size={18} /></div>
          <div className={styles.freeList}>
            {freeWindows.map((window, index) => <div key={`${window.start}-${index}`}><strong>{clock(window.start)}–{clock(window.end)}</strong><span>{minutesLabel(window.minutes)}</span></div>)}
            {!freeWindows.length && <p className={styles.empty}>No 30+ minute open window remains after schedule, prep, travel, and sleep protection.</p>}
          </div>
          {bestFit && <p className={styles.fitNote}><Sparkles size={12} /> {bestFit.task.title} ({minutesLabel(bestFit.task.duration_minutes || 30)}) fits in the {clock(bestFit.window.start)}–{clock(bestFit.window.end)} window.</p>}
        </article>

        <article className={`${styles.card} ${styles.conflictCard}`}>
          <div className={styles.cardHeading}><div><span>CONFLICTS</span><h2>Schedule integrity</h2></div><AlertTriangle size={18} /></div>
          <div className={styles.conflictList}>
            {conflicts.map((conflict) => <div className={`${styles.conflict} ${conflict.tone === "hard" ? styles.hardConflict : ""}`} key={conflict.key}><strong>{conflict.title}</strong><small>{conflict.meta}</small></div>)}
            {!conflicts.length && <p className={styles.clearState}><CheckCircle2 size={14} /> Your timed schedule and prep buffers fit together.</p>}
          </div>
        </article>

        <article className={`${styles.card} ${styles.captureCard}`}>
          <div className={styles.cardHeading}><div><span>CAPTURE</span><h2>Add something</h2></div><Plus size={18} /></div>
          <form className={styles.addForm} onSubmit={addTask}><input value={newTask} onChange={(event) => setNewTask(event.target.value)} placeholder="What else needs to happen today?" /><button disabled={!newTask.trim() || saving}><Plus size={16} /> Add</button></form>
          <div className={styles.quickLinks}>
            <button onClick={() => openView("Study")}><BookOpen size={14} /> Study</button>
            <button onClick={() => openView("Workouts")}><Dumbbell size={14} /> Fitness</button>
            <button onClick={() => openView("Projects")}><FolderKanban size={14} /> Projects</button>
            <button onClick={() => openView("Calendar")}><CalendarDays size={14} /> Calendar</button>
          </div>
        </article>
      </section>
    </div>
  );

  return createPortal(content, target);
}
