from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}, found {count}: {old[:140]!r}")
    file.write_text(text.replace(old, new, 1))


# Route the unified completion engine through the authenticated Worker shell.
replace_once(
    "worker/index.ts",
    'import { handleSilkMaps, mapsErrorResponse } from "./silk-maps.js";\nimport { classifyAutomaticChatTier, routeAutomaticModelEnv } from "./model-routing.js";',
    'import { handleSilkMaps, mapsErrorResponse } from "./silk-maps.js";\nimport { handleSilkCompletions, completionErrorResponse } from "./silk-completions.js";\nimport { classifyAutomaticChatTier, routeAutomaticModelEnv } from "./model-routing.js";',
)

replace_once(
    "worker/index.ts",
    '''    if (url.pathname.startsWith("/api/maps/")) {''',
    '''    if (url.pathname.startsWith("/api/completions/")) {
      if (!(await ownerSessionIsAuthenticated(request, env, ctx))) {
        return withSecurityHeaders(new Response(JSON.stringify({ error: "Unlock SILK before using completion intelligence." }), {
          status: 401,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        }));
      }
      try {
        return withSecurityHeaders(await handleSilkCompletions(request, env));
      } catch (error) {
        return withSecurityHeaders(completionErrorResponse(error));
      }
    }

    if (url.pathname.startsWith("/api/maps/")) {''',
)

# Study sessions should close the loop just like workouts.
replace_once(
    "worker/silk-calendar.js",
    '  const requiresCompletion = category === "workout" || merged.requires_completion === true || merged.requires_completion === 1;',
    '  const requiresCompletion = ["workout", "study"].includes(category) || merged.requires_completion === true || merged.requires_completion === 1;',
)

# Today V2 gets generalized completion types and the derived history summary.
replace_once(
    "app/today-v2-bridge.tsx",
    '''  cached: boolean;
  estimate: boolean;
};

const DEFAULT_PREP''',
    '''  cached: boolean;
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

const DEFAULT_PREP''',
)

replace_once(
    "app/today-v2-bridge.tsx",
    '''  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [pendingCheckins, setPendingCheckins] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);''',
    '''  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [pendingCheckins, setPendingCheckins] = useState<PendingCheckin[]>([]);
  const [completionSummary, setCompletionSummary] = useState<CompletionSummary | null>(null);
  const [loading, setLoading] = useState(true);''',
)

replace_once(
    "app/today-v2-bridge.tsx",
    '''      const [bootstrapResponse, calendarResponse, pendingResponse] = await Promise.all([
        fetch("/api/bootstrap", { credentials: "same-origin" }),
        fetch(`/api/silk-calendar/events?${query}`, { credentials: "same-origin" }),
        fetch("/api/silk-calendar/pending", { credentials: "same-origin" }),
      ]);''',
    '''      const [bootstrapResponse, calendarResponse, pendingResponse, completionResponse] = await Promise.all([
        fetch("/api/bootstrap", { credentials: "same-origin" }),
        fetch(`/api/silk-calendar/events?${query}`, { credentials: "same-origin" }),
        fetch("/api/completions/pending", { credentials: "same-origin" }),
        fetch("/api/completions/summary", { credentials: "same-origin" }),
      ]);''',
)

replace_once(
    "app/today-v2-bridge.tsx",
    '''      if (pendingResponse.ok) {
        const payload = (await pendingResponse.json().catch(() => ({}))) as { events?: CalendarEvent[] };
        setPendingCheckins(Array.isArray(payload.events) ? payload.events : []);
      } else {
        setPendingCheckins([]);
      }''',
    '''      if (pendingResponse.ok) {
        const payload = (await pendingResponse.json().catch(() => ({}))) as { pending?: PendingCheckin[] };
        setPendingCheckins(Array.isArray(payload.pending) ? payload.pending : []);
      } else {
        setPendingCheckins([]);
      }

      if (completionResponse.ok) {
        setCompletionSummary((await completionResponse.json().catch(() => null)) as CompletionSummary | null);
      } else {
        setCompletionSummary(null);
      }''',
)

# Completion history can change what SILK recommends when reliability is slipping.
replace_once(
    "app/today-v2-bridge.tsx",
    '''    const urgent = needs.find((item) => item.tone === "urgent");
    if (urgent) return { title: urgent.title, meta: urgent.meta };

    if (bestFit) {
      return {
        title: bestFit.task.title,
        meta: `Fits inside your ${minutesLabel(bestFit.window.minutes)} window ending at ${clock(bestFit.window.end)}.`,
      };
    }''',
    '''    const urgent = needs.find((item) => item.tone === "urgent");
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
    }''',
)

replace_once(
    "app/today-v2-bridge.tsx",
    '''  }, [bestFit, conflicts, needs, nextEntry, nextLogistics, sleepSignal]);''',
    '''  }, [bestFit, completionSummary, conflicts, needs, nextEntry, nextLogistics, sleepSignal]);''',
)

# One responder now closes Calendar, project, workout/study, and Today check-ins through the same ledger.
replace_once(
    "app/today-v2-bridge.tsx",
    '''  const completeCalendar = useCallback(async (event: CalendarEvent, status: "completed" | "not_completed") => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/silk-calendar/events/${event.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completion_status: status }),
      });
      if (!response.ok) throw new Error("Could not save that check-in.");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not save that check-in.");
    } finally {
      setSaving(false);
    }
  }, [load, saving]);''',
    '''  const respondCheckin = useCallback(async (checkin: PendingCheckin, result: "completed" | "not_completed") => {
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
  }, [load, saving]);''',
)

replace_once(
    "app/today-v2-bridge.tsx",
    '''            {pendingCheckins.slice(0, 3).map((event) => <div className={styles.checkin} key={event.id}>
              <div><strong>{event.title}</strong><small>Ended {clock(event.end_at)} · did you complete it?</small></div>
              <div className={styles.checkinActions}><button onClick={() => void completeCalendar(event, "completed")} disabled={saving}><Check size={12} /> Yes</button><button onClick={() => void completeCalendar(event, "not_completed")} disabled={saving}>No</button></div>
            </div>)}
            {!pendingCheckins.length && <p className={styles.empty}>No completion check-ins waiting.</p>}''',
    '''            {pendingCheckins.slice(0, 4).map((checkin) => <div className={styles.checkin} key={checkin.key}>
              <div><strong>{checkin.title}</strong><small>{checkin.meta} · did you complete it?</small></div>
              <div className={styles.checkinActions}><button onClick={() => void respondCheckin(checkin, "completed")} disabled={saving}><Check size={12} /> Yes</button><button onClick={() => void respondCheckin(checkin, "not_completed")} disabled={saving}>No</button></div>
            </div>)}
            {!pendingCheckins.length && <p className={styles.empty}>No completion check-ins waiting.</p>}
            {completionSummary && <div className={styles.completionPulse}>
              <div><span>Current streak</span><strong>{completionSummary.streaks.overall.current} day{completionSummary.streaks.overall.current === 1 ? "" : "s"}</strong></div>
              <div><span>7-day completion</span><strong>{completionSummary.rates.seven_day.percent == null ? "—" : `${completionSummary.rates.seven_day.percent}%`}</strong></div>
              <div><span>Achievements</span><strong>{completionSummary.achievements.filter((item) => item.unlocked).length}/{completionSummary.achievements.length}</strong></div>
            </div>}''',
)

# Completion pulse styling stays inside the locked Today palette.
replace_once(
    "app/today-v2.module.css",
    '''.checkinActions button:disabled{opacity:.4}''',
    '''.checkinActions button:disabled{opacity:.4}.completionPulse{position:relative;z-index:2;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:2px}.completionPulse>div{display:grid;gap:4px;padding:9px;border:1px solid rgba(175,166,222,.09);border-radius:10px;background:rgba(126,108,220,.025)}.completionPulse span{font:700 7px var(--font-geist-mono),monospace;letter-spacing:.1em;text-transform:uppercase;color:#686476}.completionPulse strong{font-size:10px;font-weight:550;color:#cbc5df}@media(max-width:620px){.completionPulse{grid-template-columns:1fr}}''',
)
