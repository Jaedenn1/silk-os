"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./calendar.module.css";

type CompletionStatus = "none" | "pending" | "completed" | "not_completed";
type Category = "personal" | "work" | "school" | "study" | "workout" | "appointment" | "other";

type SilkCalendarEvent = {
  id: number;
  title: string;
  start_at: number;
  end_at: number;
  all_day: boolean;
  location: string;
  notes: string;
  category: Category;
  requires_completion: boolean;
  completion_status: CompletionStatus;
  source: string;
};

type Draft = {
  id?: number;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location: string;
  notes: string;
  category: Category;
  requires_completion: boolean;
  completion_status: CompletionStatus;
};

type CalendarApi = {
  render(): void;
  destroy(): void;
  refetchEvents(): void;
  unselect(): void;
};

type FullCalendarGlobal = {
  Calendar: new (element: HTMLElement, options: Record<string, unknown>) => CalendarApi;
};

declare global {
  interface Window {
    FullCalendar?: FullCalendarGlobal;
  }
}

const FULLCALENDAR_SRC = "https://cdn.jsdelivr.net/npm/fullcalendar@6.1.21/index.global.min.js";

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (response.status === 401) {
    window.location.assign("/");
    throw new Error("Unlock SILK first.");
  }
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Request failed (${response.status})`);
  return body as T;
}

function loadFullCalendar(): Promise<void> {
  if (window.FullCalendar?.Calendar) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-silk-fullcalendar="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("FullCalendar could not load.")), { once: true });
      if (window.FullCalendar?.Calendar) resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = FULLCALENDAR_SRC;
    script.async = true;
    script.dataset.silkFullcalendar = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("FullCalendar could not load."));
    document.head.appendChild(script);
  });
}

function localInput(value: Date | number) {
  const date = typeof value === "number" ? new Date(value * 1000) : value;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function newDraft(start = new Date(), end = new Date(Date.now() + 60 * 60_000)): Draft {
  return {
    title: "",
    start: localInput(start),
    end: localInput(end),
    all_day: false,
    location: "",
    notes: "",
    category: "personal",
    requires_completion: false,
    completion_status: "none",
  };
}

function draftFromEvent(event: SilkCalendarEvent): Draft {
  return {
    id: event.id,
    title: event.title,
    start: localInput(event.start_at),
    end: localInput(event.end_at),
    all_day: event.all_day,
    location: event.location,
    notes: event.notes,
    category: event.category,
    requires_completion: event.requires_completion,
    completion_status: event.completion_status,
  };
}

function eventPayload(draft: Draft) {
  const start = new Date(draft.start);
  const end = new Date(draft.end);
  if (!draft.title.trim()) throw new Error("Give the event a title.");
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new Error("Choose a valid start and end time.");
  if (end.getTime() < start.getTime()) throw new Error("The event cannot end before it starts.");

  const requiresCompletion = draft.category === "workout" || draft.requires_completion;
  return {
    title: draft.title.trim(),
    start: start.toISOString(),
    end: end.toISOString(),
    all_day: draft.all_day,
    location: draft.location.trim(),
    notes: draft.notes.trim(),
    category: draft.category,
    requires_completion: requiresCompletion,
    completion_status: requiresCompletion
      ? (draft.completion_status === "none" ? "pending" : draft.completion_status)
      : "none",
    source: "silk-calendar",
  };
}

function fullCalendarEvent(event: SilkCalendarEvent) {
  return {
    id: String(event.id),
    title: event.title,
    start: new Date(event.start_at * 1000).toISOString(),
    end: new Date(event.end_at * 1000).toISOString(),
    allDay: event.all_day,
    classNames: [`silk-event-${event.category}`],
    extendedProps: { record: event },
  };
}

function eventTime(event: SilkCalendarEvent) {
  const start = new Date(event.start_at * 1000);
  return start.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function SilkCalendar() {
  const hostRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<CalendarApi | null>(null);
  const [ready, setReady] = useState(false);
  const [editor, setEditor] = useState<Draft | null>(null);
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const [pending, setPending] = useState<SilkCalendarEvent[]>([]);
  const [saving, setSaving] = useState(false);

  const openEditor = useCallback((draft: Draft) => {
    setSaveError("");
    setEditor(draft);
  }, []);

  const refreshPending = useCallback(async () => {
    try {
      const result = await api<{ events: SilkCalendarEvent[] }>("/api/silk-calendar/pending");
      setPending(result.events || []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load workout check-ins.");
    }
  }, []);

  const refetch = useCallback(() => {
    calendarRef.current?.refetchEvents();
    void refreshPending();
  }, [refreshPending]);

  const persistMove = useCallback(async (info: Record<string, unknown>) => {
    const event = info.event as {
      id: string;
      start: Date | null;
      end: Date | null;
      allDay: boolean;
      extendedProps?: { record?: SilkCalendarEvent };
    };
    const revert = info.revert as (() => void) | undefined;
    const record = event.extendedProps?.record;
    if (!record || !event.start) return;

    const fallbackDuration = Math.max(30 * 60_000, (record.end_at - record.start_at) * 1000);
    const end = event.end || new Date(event.start.getTime() + fallbackDuration);
    try {
      const result = await api<{ event: SilkCalendarEvent }>(`/api/silk-calendar/events/${record.id}`, {
        method: "PATCH",
        body: JSON.stringify({ start: event.start.toISOString(), end: end.toISOString(), all_day: event.allDay }),
      });
      if (!result.event?.id) throw new Error("SILK could not verify the moved event in D1.");
      setNotice(`${record.title} moved and saved.`);
      refetch();
    } catch (error) {
      revert?.();
      setNotice(error instanceof Error ? error.message : "Could not move the event.");
    }
  }, [refetch]);

  useEffect(() => {
    let cancelled = false;
    let calendar: CalendarApi | null = null;

    void (async () => {
      try {
        await loadFullCalendar();
        if (cancelled || !hostRef.current || !window.FullCalendar?.Calendar) return;

        calendar = new window.FullCalendar.Calendar(hostRef.current, {
          initialView: window.innerWidth < 720 ? "listWeek" : "dayGridMonth",
          height: "auto",
          nowIndicator: true,
          editable: true,
          selectable: true,
          selectMirror: true,
          dayMaxEvents: true,
          firstDay: 1,
          headerToolbar: {
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
          },
          buttonText: { today: "Today", month: "Month", week: "Week", day: "Day", list: "List" },
          eventTimeFormat: { hour: "numeric", minute: "2-digit", meridiem: "short" },
          slotMinTime: "05:00:00",
          slotMaxTime: "25:00:00",
          events: async (info: { startStr: string; endStr: string }, success: (events: unknown[]) => void, failure: (error: Error) => void) => {
            try {
              const query = new URLSearchParams({ from: info.startStr, to: info.endStr });
              const result = await api<{ events: SilkCalendarEvent[] }>(`/api/silk-calendar/events?${query}`);
              success((result.events || []).map(fullCalendarEvent));
            } catch (error) {
              failure(error instanceof Error ? error : new Error("Calendar events could not load."));
            }
          },
          select: (info: { start: Date; end: Date; allDay: boolean }) => {
            const draft = newDraft(info.start, info.end);
            draft.all_day = info.allDay;
            openEditor(draft);
          },
          dateClick: (info: { date: Date; allDay: boolean }) => {
            const start = info.allDay
              ? new Date(info.date.getFullYear(), info.date.getMonth(), info.date.getDate(), 9, 0)
              : info.date;
            const draft = newDraft(start, new Date(start.getTime() + 60 * 60_000));
            draft.all_day = false;
            openEditor(draft);
          },
          eventClick: (info: { event: { extendedProps?: { record?: SilkCalendarEvent } } }) => {
            const record = info.event.extendedProps?.record;
            if (record) openEditor(draftFromEvent(record));
          },
          eventDrop: persistMove,
          eventResize: persistMove,
        });

        calendarRef.current = calendar;
        calendar.render();
        setReady(true);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "The calendar could not start.");
      }
    })();

    return () => {
      cancelled = true;
      calendar?.destroy();
      calendarRef.current = null;
    };
  }, [openEditor, persistMove]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshPending(), 0);
    const timer = window.setInterval(() => void refreshPending(), 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refreshPending]);

  const saveEvent = useCallback(async () => {
    if (!editor || saving) return;

    setSaveError("");
    setSaving(true);
    try {
      const payload = eventPayload(editor);
      const result = editor.id
        ? await api<{ event: SilkCalendarEvent }>(`/api/silk-calendar/events/${editor.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await api<{ event: SilkCalendarEvent }>("/api/silk-calendar/events", { method: "POST", body: JSON.stringify(payload) });

      const savedId = Number(result.event?.id || 0);
      if (!savedId) throw new Error("SILK did not receive a saved event ID from D1.");

      const verified = await api<{ event: SilkCalendarEvent }>(`/api/silk-calendar/events/${savedId}`);
      if (!verified.event?.id) throw new Error("SILK could not verify the saved event in D1.");

      setNotice(editor.id ? `${verified.event.title} updated and saved.` : `${verified.event.title} added and saved to SILK Calendar.`);
      setEditor(null);
      calendarRef.current?.unselect();
      refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save the event.";
      setSaveError(message);
      setNotice(message);
    } finally {
      setSaving(false);
    }
  }, [editor, refetch, saving]);

  const removeEvent = async () => {
    if (!editor?.id) return;
    if (!window.confirm(`Delete “${editor.title}” from SILK Calendar?`)) return;
    setSaving(true);
    try {
      await api(`/api/silk-calendar/events/${editor.id}`, { method: "DELETE" });
      setEditor(null);
      setNotice("Event deleted.");
      refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not delete the event.";
      setSaveError(message);
      setNotice(message);
    } finally {
      setSaving(false);
    }
  };

  const checkIn = async (calendarEvent: SilkCalendarEvent, completed: boolean) => {
    try {
      const result = await api<{ event: SilkCalendarEvent }>(`/api/silk-calendar/events/${calendarEvent.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completion_status: completed ? "completed" : "not_completed" }),
      });
      if (!result.event?.id) throw new Error("SILK could not verify the check-in update.");
      setNotice(completed ? `${calendarEvent.title} marked complete.` : `${calendarEvent.title} marked not completed.`);
      refetch();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save the check-in.");
    }
  };

  const pendingLabel = useMemo(() => pending.length === 1 ? "1 check-in waiting" : `${pending.length} check-ins waiting`, [pending.length]);

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles.mark}>S</div>
          <div>
            <span className={styles.eyebrow}>SILK OS / PRIVATE CALENDAR</span>
            <h1>SILK Calendar</h1>
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => window.location.assign("/")}>Back to SILK</button>
          <button className={styles.primary} onClick={() => openEditor(newDraft())}>+ New event</button>
        </div>
      </header>

      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <div className={styles.layout}>
        <section className={styles.calendarCard}>
          {!ready ? <div className={styles.loading}>Loading your private calendar…</div> : null}
          <div ref={hostRef} className={styles.calendarHost} />
        </section>

        <aside className={styles.side}>
          <section className={styles.sideCard}>
            <span className={styles.eyebrow}>ACCOUNTABILITY</span>
            <h2>{pending.length ? pendingLabel : "Nothing waiting"}</h2>
            <p>When a workout or another tracked event ends, SILK asks whether you actually did it.</p>
            <div className={styles.checkins}>
              {pending.map((item) => (
                <article className={styles.checkin} key={item.id}>
                  <strong>{item.title} completed?</strong>
                  <small>{eventTime(item)}</small>
                  <div className={styles.checkinActions}>
                    <button className={styles.no} onClick={() => void checkIn(item, false)}>No</button>
                    <button className={styles.yes} onClick={() => void checkIn(item, true)}>Yes</button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.sideCard}>
            <span className={styles.eyebrow}>OWNED BY SILK</span>
            <h2>Google is optional.</h2>
            <p>These events live in SILK&apos;s private D1 database. Google Calendar can become a sync source later instead of holding the whole system hostage.</p>
          </section>

          <section className={styles.sideCard}>
            <span className={styles.eyebrow}>CATEGORIES</span>
            <div className={styles.legend}>
              <span><i /> Work</span>
              <span><i /> Workout</span>
              <span><i /> School / study</span>
              <span><i /> Appointment</span>
              <span><i /> Personal</span>
            </div>
          </section>
        </aside>
      </div>

      {editor ? (
        <div className={styles.modalBackdrop} onMouseDown={(event) => !saving && event.currentTarget === event.target && setEditor(null)}>
          <form
            className={styles.modal}
            onSubmit={(event) => {
              event.preventDefault();
              void saveEvent();
            }}
          >
            <header className={styles.modalHeader}>
              <div>
                <span className={styles.eyebrow}>{editor.id ? "EDIT EVENT" : "NEW EVENT"}</span>
                <h2>{editor.id ? editor.title || "Calendar event" : "Add to SILK"}</h2>
                {editor.id && editor.requires_completion ? <span className={styles.statusChip}>{editor.completion_status.replace("_", " ")}</span> : null}
              </div>
              <button type="button" className={styles.close} disabled={saving} onClick={() => setEditor(null)} aria-label="Close">×</button>
            </header>

            {saveError ? <div className={styles.notice} role="alert">{saveError}</div> : null}

            <div className={styles.formGrid}>
              <label className={`${styles.field} ${styles.fieldWide}`}>
                Event
                <input autoFocus value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} placeholder="ER shift, Full Body A, Anatomy review…" />
              </label>
              <label className={styles.field}>
                Start
                <input type="datetime-local" value={editor.start} onChange={(event) => setEditor({ ...editor, start: event.target.value })} />
              </label>
              <label className={styles.field}>
                End
                <input type="datetime-local" value={editor.end} onChange={(event) => setEditor({ ...editor, end: event.target.value })} />
              </label>
              <label className={styles.field}>
                Category
                <select value={editor.category} onChange={(event) => {
                  const category = event.target.value as Category;
                  setEditor({ ...editor, category, requires_completion: category === "workout" ? true : editor.requires_completion });
                }}>
                  <option value="personal">Personal</option>
                  <option value="work">Work</option>
                  <option value="school">School</option>
                  <option value="study">Study</option>
                  <option value="workout">Workout</option>
                  <option value="appointment">Appointment</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className={styles.field}>
                Location
                <input value={editor.location} onChange={(event) => setEditor({ ...editor, location: event.target.value })} placeholder="Optional" />
              </label>
              <label className={`${styles.field} ${styles.fieldWide}`}>
                Notes
                <textarea value={editor.notes} onChange={(event) => setEditor({ ...editor, notes: event.target.value })} placeholder="Anything SILK should know about this block." />
              </label>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={editor.category === "workout" || editor.requires_completion}
                  disabled={editor.category === "workout"}
                  onChange={(event) => setEditor({ ...editor, requires_completion: event.target.checked })}
                />
                <span><strong>Ask me if I completed this.</strong><br />After the event ends, SILK will ask “{editor.title || "Event"} completed?” with Yes / No.</span>
              </label>
            </div>

            <div className={styles.modalActions}>
              {editor.id ? <button type="button" className={styles.danger} disabled={saving} onClick={() => void removeEvent()}>Delete</button> : <span />}
              <div>
                <button type="button" className={styles.secondary} disabled={saving} onClick={() => setEditor(null)}>Cancel</button>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={saving}
                  onClick={() => void saveEvent()}
                >
                  {saving ? "Saving…" : "Save event"}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}