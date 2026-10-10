"use client";

import { Activity, AlertTriangle, BookOpen, CheckCircle2, Clock3, Dumbbell, FolderKanban, ListChecks, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./home-today-needs.module.css";

type DailyItem = {
  id: number;
  title: string;
  source_type: string;
  status: "todo" | "doing" | "done" | "skipped";
  scheduled_at?: number | null;
  duration_minutes?: number;
  priority?: number;
};

type SilkCalendarEvent = {
  id: number;
  title: string;
  start_at: number;
  end_at: number;
  all_day: boolean;
  location: string;
  category: string;
};

type Project = {
  id: number;
  name: string;
  status: string;
  priority: number;
  open_tasks: number;
};

type HomeData = {
  today: {
    items: DailyItem[];
    deadlines: Array<{ id: number; name: string; due_at: number; priority: number }>;
  };
  projects: Project[];
  study: { weakest_topics?: Array<Record<string, unknown>> };
  workouts: { active?: Record<string, unknown> | null };
  approvals: Array<{ id: number; status: string }>;
};

type TimelineItem = {
  key: string;
  title: string;
  meta: string;
  at: number | null;
  end?: number | null;
  done?: boolean;
  kind: "calendar" | "task";
};

type NeedItem = {
  key: string;
  title: string;
  meta: string;
  tone: "attention" | "study" | "project" | "fitness" | "system" | "task";
};

function clock(epoch?: number | null) {
  if (!epoch) return "";
  return new Date(epoch * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function durationLabel(minutes?: number) {
  const value = Number(minutes || 0);
  if (!value) return "Flexible";
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function label(value: string) {
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function relativeDeadline(epoch: number) {
  const diff = epoch * 1000 - Date.now();
  if (diff < 0) return "Overdue";
  const mins = Math.max(0, Math.round(diff / 60000));
  if (mins < 60) return `Due in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Due in ${hours}h`;
  return `Due ${new Date(epoch * 1000).toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function findTodayTarget() {
  const articles = Array.from(document.querySelectorAll<HTMLElement>("article"));
  for (const article of articles) {
    const header = article.querySelector("header");
    const eyebrow = header?.querySelector("span")?.textContent?.trim();
    const heading = header?.querySelector("h2")?.textContent?.trim();
    if (eyebrow === "TODAY" && heading === "Your day") {
      return article.querySelector<HTMLElement>(":scope > header + div");
    }
  }
  return null;
}

export default function HomeTodayNeedsBridge() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<HomeData | null>(null);
  const [events, setEvents] = useState<SilkCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sync = () => setTarget(findTodayTarget());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!target) return;
    target.dataset.silkTodayEnhanced = "true";
    return () => {
      delete target.dataset.silkTodayEnhanced;
    };
  }, [target]);

  const load = useCallback(async () => {
    try {
      const sessionResponse = await fetch("/api/session", { credentials: "same-origin" });
      const session = (await sessionResponse.json().catch(() => ({}))) as { authenticated?: boolean };
      if (!session.authenticated) return;

      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const query = new URLSearchParams({ from: start.toISOString(), to: end.toISOString() });

      const [bootstrapResponse, calendarResponse] = await Promise.all([
        fetch("/api/bootstrap", { credentials: "same-origin" }),
        fetch(`/api/silk-calendar/events?${query}`, { credentials: "same-origin" }),
      ]);

      if (bootstrapResponse.ok) setData((await bootstrapResponse.json()) as HomeData);
      if (calendarResponse.ok) {
        const payload = (await calendarResponse.json().catch(() => ({}))) as { events?: SilkCalendarEvent[] };
        setEvents(Array.isArray(payload.events) ? payload.events : []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!target) return;
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load, target]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const calendarItems = events.map((event) => ({
      key: `calendar-${event.id}`,
      title: event.title,
      meta: `${label(event.category || "Calendar")} · ${event.all_day ? "All day" : `${clock(event.start_at)}–${clock(event.end_at)}`}${event.location ? ` · ${event.location}` : ""}`,
      at: event.all_day ? null : event.start_at,
      end: event.end_at,
      done: event.end_at < Date.now() / 1000,
      kind: "calendar" as const,
    }));

    const tasks = (data?.today.items || [])
      .filter((item) => item.status !== "skipped")
      .map((item) => ({
        key: `task-${item.id}`,
        title: item.title,
        meta: `${label(item.source_type || "Task")} · ${durationLabel(item.duration_minutes)}${item.scheduled_at ? ` · ${clock(item.scheduled_at)}` : ""}`,
        at: item.scheduled_at || null,
        done: item.status === "done",
        kind: "task" as const,
      }));

    return [...calendarItems, ...tasks]
      .sort((a, b) => {
        if (a.at === null && b.at !== null) return 1;
        if (a.at !== null && b.at === null) return -1;
        if (a.at !== null && b.at !== null) return a.at - b.at;
        return Number(a.done) - Number(b.done);
      })
      .slice(0, 7);
  }, [data, events]);

  const needs = useMemo<NeedItem[]>(() => {
    const now = new Date();
    const dayEnd = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() / 1000);
    const items: NeedItem[] = [];

    for (const deadline of (data?.today.deadlines || []).filter((item) => Number(item.due_at) <= dayEnd).slice(0, 2)) {
      items.push({
        key: `deadline-${deadline.id}`,
        title: deadline.name,
        meta: relativeDeadline(deadline.due_at),
        tone: "attention",
      });
    }

    const unscheduled = (data?.today.items || [])
      .filter((item) => !item.scheduled_at && !["done", "skipped"].includes(item.status))
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
    for (const item of unscheduled.slice(0, 2)) {
      items.push({
        key: `unscheduled-${item.id}`,
        title: item.title,
        meta: `${label(item.source_type || "Task")} · ${durationLabel(item.duration_minutes)} · Needs a time`,
        tone: "task",
      });
    }

    const weakestTopic = String(data?.study.weakest_topics?.[0]?.topic || "").trim();
    if (weakestTopic && weakestTopic.toLowerCase() !== "caught up") {
      items.push({
        key: "study-focus",
        title: `Review ${weakestTopic}`,
        meta: "Study focus · weakest current topic",
        tone: "study",
      });
    }

    const pendingApprovals = data?.approvals.filter((item) => item.status === "pending").length || 0;
    if (pendingApprovals) {
      items.push({
        key: "approvals",
        title: `${pendingApprovals} approval${pendingApprovals === 1 ? "" : "s"} waiting`,
        meta: "SILK needs your decision",
        tone: "system",
      });
    }

    const priorityProject = (data?.projects || [])
      .filter((project) => project.status === "active" && project.open_tasks > 0)
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))[0];
    if (priorityProject) {
      items.push({
        key: `project-${priorityProject.id}`,
        title: priorityProject.name,
        meta: `${priorityProject.open_tasks} open project task${priorityProject.open_tasks === 1 ? "" : "s"} · priority ${priorityProject.priority}/5`,
        tone: "project",
      });
    }

    if (data?.workouts.active) {
      items.push({
        key: "active-workout",
        title: "Workout in progress",
        meta: "Fitness · finish or log the session",
        tone: "fitness",
      });
    }

    return items.slice(0, 6);
  }, [data]);

  if (!target) return null;

  const unfinishedTimeline = timeline.filter((item) => !item.done).length;

  return createPortal(
    <div className={styles.root} data-silk-today-root>
      <div className={styles.summary}>
        <span><Clock3 size={12} /> {events.length} scheduled</span>
        <span><ListChecks size={12} /> {(data?.today.items || []).filter((item) => !["done", "skipped"].includes(item.status)).length} tasks</span>
        <span className={needs.length ? styles.attention : ""}><Activity size={12} /> {needs.length} need{needs.length === 1 ? "" : "s"}</span>
      </div>

      <div className={styles.columns}>
        <section className={styles.section}>
          <div className={styles.sectionHeading}><span>TIMELINE</span><small>{unfinishedTimeline ? `${unfinishedTimeline} remaining` : "Clear"}</small></div>
          <div className={styles.list}>
            {timeline.map((item) => (
              <div className={`${styles.row} ${item.done ? styles.done : ""}`} key={item.key}>
                <span className={styles.icon}>{item.done ? <CheckCircle2 size={13} /> : item.kind === "calendar" ? <Clock3 size={13} /> : <ListChecks size={13} />}</span>
                <div><strong>{item.title}</strong><small>{item.meta}</small></div>
              </div>
            ))}
            {!timeline.length && !loading && <p className={styles.empty}>No schedule or tasks yet today.</p>}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}><span>NEEDS</span><small>{needs.length ? "Needs attention" : "Nothing flagged"}</small></div>
          <div className={styles.list}>
            {needs.map((item) => {
              const Icon = item.tone === "attention" ? AlertTriangle
                : item.tone === "study" ? BookOpen
                : item.tone === "project" ? FolderKanban
                : item.tone === "fitness" ? Dumbbell
                : item.tone === "system" ? ShieldCheck
                : ListChecks;
              return (
                <div className={`${styles.row} ${styles[item.tone]}`} key={item.key}>
                  <span className={styles.icon}><Icon size={13} /></span>
                  <div><strong>{item.title}</strong><small>{item.meta}</small></div>
                </div>
              );
            })}
            {!needs.length && !loading && <p className={styles.empty}>No extra needs flagged. Your schedule is doing the heavy lifting.</p>}
          </div>
        </section>
      </div>
      {loading && <p className={styles.loading}>Building today’s picture…</p>}
    </div>,
    target,
  );
}
