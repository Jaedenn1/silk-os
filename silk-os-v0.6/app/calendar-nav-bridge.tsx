"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./calendar-bridge.module.css";

type PendingEvent = {
  id: number;
  title: string;
  start_at: number;
  end_at: number;
  category: string;
};

async function loadPending(): Promise<PendingEvent[]> {
  const response = await fetch("/api/silk-calendar/pending", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (response.status === 401) return [];
  if (!response.ok) return [];
  const body = await response.json().catch(() => ({ events: [] })) as { events?: PendingEvent[] };
  return body.events || [];
}

export default function CalendarNavBridge() {
  const [pending, setPending] = useState<PendingEvent[]>([]);
  const current = pending[0] || null;

  const refresh = useCallback(async () => {
    setPending(await loadPending());
  }, []);

  useEffect(() => {
    const interceptCalendar = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest(".side-nav button") as HTMLButtonElement | null;
      if (!button || button.textContent?.trim() !== "Calendar") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.location.assign("/calendar");
    };

    document.addEventListener("click", interceptCalendar, true);
    return () => document.removeEventListener("click", interceptCalendar, true);
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const answer = async (completed: boolean) => {
    if (!current) return;
    const response = await fetch(`/api/silk-calendar/events/${current.id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completion_status: completed ? "completed" : "not_completed" }),
    });
    if (!response.ok) return;
    setPending((items) => items.filter((item) => item.id !== current.id));
    window.setTimeout(() => void refresh(), 100);
  };

  if (!current) return null;

  const ended = new Date(current.end_at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <aside className={styles.checkin} role="dialog" aria-live="polite" aria-label="SILK completion check-in">
      <div className={styles.eyebrow}>
        <span>SILK CHECK-IN</span>
        <i className={styles.pulse} />
      </div>
      <h2>{current.title} completed?</h2>
      <p>This was scheduled to finish at {ended}. Tell SILK what actually happened so your calendar reflects reality, not optimism.</p>
      <div className={styles.actions}>
        <button className={styles.no} onClick={() => void answer(false)}>No</button>
        <button className={styles.yes} onClick={() => void answer(true)}>Yes</button>
      </div>
      <div className={styles.footer}>
        <span>{pending.length > 1 ? `${pending.length - 1} more after this` : "Accountability, without the lecture."}</span>
        <a href="/calendar">Open Calendar</a>
      </div>
    </aside>
  );
}
