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
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
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
  category: string;
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

type TimelineEntry = {
  key: string;
  title: string;
  start: number | null;
  end: number | null;
  source: "calendar" | "task";
  meta: string;
  done: boolean;
  dailyItem?: DailyItem;
};

type Need = {
  key: string;
  title: string;
  meta: string;
  tone: "urgent" | "task" | "study" | "project" | "fitness" | "system";
};

type FreeWindow = { start: number; end: number; minutes: number };

function clock(epoch?: number | null) {
  if (!epoch) return "";
  return new Date(epoch * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function minutesLabel(value?: number) {
  const minutes = Math.max(0, Number(value || 0));
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
  return {
    startDate: start,
    endDate: end,
    start: Math.floor(start.getTime() / 1000),
    end: Math.floor(end.getTime() / 1000),
  };
}

export default function TodayV2Bridge() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState(false);
  const [data, setData] = useState<TodayData | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [, setTick] = useState(0);

  const syncShell = useCallback(() => {
    const workspace = document.querySelector<HTMLElement>(".workspace-scroll");
    const title = document.querySelector<HTMLElement>(".topbar-title h1")?.textContent?.trim();
    setTarget(workspace);
    setActive(Boolean(workspace && title === "Today"));
  }, []);

  useEffect(() => {
    syncShell();
    const observer = new MutationObserver(syncShell);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [syncShell]);

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".silk-shell");
    if (!shell) return;
    shell.classList.toggle("today-v2-active", active);
    return () => shell.classList.remove("today-v2-active");
  }, [active]);

  const load = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    try {
      const sessionResponse = await fetch("/api/session", { credentials: "same-origin" });
      const session = (await sessionResponse.json().catch(() => ({}))) as { configured?: boolean; authenticated?: boolean };
      if (!session.configured || !session.authenticated) return;

      const bounds = dayBounds();
      const query = new URLSearchParams({
        from: bounds.startDate.toISOString(),
        to: bounds.endDate.toISOString(),
      });
      const [bootstrapResponse, calendarResponse] = await Promise.all([
        fetch("/api/bootstrap", { credentials: "same-origin" }),
        fetch(`/api/silk-calendar/events?${query}`, { credentials: "same-origin" }),
      ]);

      if (bootstrapResponse.ok) setData((await bootstrapResponse.json()) as TodayData);
      if (calendarResponse.ok) {
        const payload = (await calendarResponse.json().catch(() => ({}))) as { events?: CalendarEvent[] };
        setEvents(Array.isArray(payload.events) ? payload.events : []);
      } else {
        setEvents([]);
      }
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      setTick((value) => value + 1);
      void load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [active, load]);

  const timeline = useMemo<TimelineEntry[]>(() => {
    const calendarEntries: TimelineEntry[] = events.map((event) => ({
      key: `calendar-${event.id}`,
      title: event.title,
      start: event.all_day ? null : event.start_at,
      end: event.all_day ? null : event.end_at,
      source: "calendar",
      meta: `${label(event.category || "Calendar")}${event.location ? ` · ${event.location}` : ""}`,
      done: event.end_at < Date.now() / 1000,
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
  }, [data, events]);

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

  const freeWindows = useMemo<FreeWindow[]>(() => {
    const bounds = dayBounds();
    const now = Math.max(Math.floor(Date.now() / 1000), bounds.start);
    const dayFinish = Math.min(bounds.end, Math.floor(new Date(bounds.startDate.getFullYear(), bounds.startDate.getMonth(), bounds.startDate.getDate(), 23, 0).getTime() / 1000));
    if (now >= dayFinish) return [];

    const intervals = timeline
      .filter((item) => item.start !== null && item.end !== null && Number(item.end) > now)
      .map((item) => ({ start: Math.max(now, Number(item.start)), end: Math.min(dayFinish, Number(item.end)) }))
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
    return windows.slice(0, 3);
  }, [timeline]);

  const nextEntry = useMemo(() => {
    const now = Date.now() / 1000;
    const live = timeline.find((item) => item.start !== null && item.end !== null && Number(item.start) <= now && Number(item.end) >= now && !item.done);
    if (live) return { item: live, status: "Happening now" };
    const upcoming = timeline.find((item) => item.start !== null && Number(item.start) >= now && !item.done);
    if (upcoming) return { item: upcoming, status: relativeFuture(Number(upcoming.start)) };
    return null;
  }, [timeline]);

  const recommended = useMemo(() => {
    if (nextEntry?.status === "Happening now") return { title: nextEntry.item.title, meta: "Stay with the current block." };
    const urgent = needs.find((item) => item.tone === "urgent");
    if (urgent) return { title: urgent.title, meta: urgent.meta };
    const task = needs.find((item) => item.tone === "task");
    if (task) return { title: task.title, meta: "Give this a time before the day fills up." };
    const study = needs.find((item) => item.tone === "study");
    if (study) return { title: study.title, meta: "This is your clearest learning gap right now." };
    const project = needs.find((item) => item.tone === "project");
    if (project) return { title: project.title, meta: project.meta };
    if (nextEntry) return { title: nextEntry.item.title, meta: `Coming up ${nextEntry.status}.` };
    return { title: "Protect the open space", meta: "Nothing urgent is competing for your attention right now." };
  }, [needs, nextEntry]);

  const toggleTask = useCallback(async (item: DailyItem) => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/today/${item.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: item.status === "done" ? "todo" : "done", completion_source: "today_v2" }),
      });
      if (!response.ok) throw new Error("Could not update that task.");
      await load();
    } finally {
      setSaving(false);
    }
  }, [load, saving]);

  const addTask = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const title = newTask.trim();
    if (!title || saving) return;
    setSaving(true);
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
    } finally {
      setSaving(false);
    }
  }, [data?.today.date, load, newTask, saving]);

  const openView = useCallback((name: string) => findNavButton(name)?.click(), []);

  if (!target || !active) return null;

  const unfinishedTasks = (data?.today.items || []).filter((item) => !["done", "skipped"].includes(item.status)).length;
  const nowLabel = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  const content = (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>DAILY COMMAND CENTER</span>
          <h1>{nowLabel}</h1>
          <p>{nextEntry ? `${nextEntry.item.title} is ${nextEntry.status.toLowerCase()}.` : "Your schedule is open right now."} SILK has pulled together what deserves attention today.</p>
        </div>
        <button className={styles.refresh} onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> {loading ? "Syncing" : "Refresh"}</button>
      </section>

      <section className={styles.stats}>
        <div><span>Scheduled</span><strong>{events.length + timeline.filter((item) => item.source === "task").length}</strong><small>time blocks</small></div>
        <div><span>Tasks</span><strong>{unfinishedTasks}</strong><small>still open</small></div>
        <div><span>Needs</span><strong>{needs.length}</strong><small>attention signals</small></div>
        <div><span>Free room</span><strong>{freeWindows.length ? minutesLabel(freeWindows.reduce((sum, window) => sum + window.minutes, 0)) : "Tight"}</strong><small>visible today</small></div>
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
          </div> : <p className={styles.empty}>Nothing scheduled next.</p>}
        </article>

        <article className={`${styles.card} ${styles.timelineCard}`}>
          <div className={styles.cardHeading}><div><span>TIMELINE</span><h2>Your day</h2></div><button onClick={() => openView("Calendar")}>Calendar <ChevronRight size={13} /></button></div>
          <div className={styles.timeline}>
            {timeline.map((item) => (
              <div className={`${styles.timelineRow} ${item.done ? styles.done : ""}`} key={item.key}>
                <div className={styles.time}>{item.start ? clock(item.start) : "ALL DAY"}</div>
                <span className={styles.lineDot}>{item.done ? <Check size={11} /> : item.source === "calendar" ? <CalendarDays size={11} /> : <ListChecks size={11} />}</span>
                <div className={styles.timelineCopy}><strong>{item.title}</strong><small>{item.end && item.start ? `${clock(item.start)}–${clock(item.end)} · ` : ""}{item.meta}</small></div>
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

        <article className={`${styles.card} ${styles.freeCard}`}>
          <div className={styles.cardHeading}><div><span>OPEN WINDOWS</span><h2>Usable free time</h2></div><Clock3 size={18} /></div>
          <div className={styles.freeList}>
            {freeWindows.map((window, index) => <div key={`${window.start}-${index}`}><strong>{clock(window.start)}–{clock(window.end)}</strong><span>{minutesLabel(window.minutes)}</span></div>)}
            {!freeWindows.length && <p className={styles.empty}>No 30+ minute open window is visible before 11 PM.</p>}
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
