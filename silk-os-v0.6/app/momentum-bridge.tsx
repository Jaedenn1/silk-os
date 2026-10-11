"use client";

import {
  Activity,
  Award,
  Bell,
  BookOpen,
  Clock3,
  Dumbbell,
  Flame,
  FolderKanban,
  Sparkles,
  Trophy,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./momentum-bridge.module.css";

type HistoryItem = {
  id: number;
  category: string;
  title: string;
  result: "completed" | "not_completed";
  occurred_at: number;
  source: string;
};

type CompletionSummary = {
  history: HistoryItem[];
  streaks: {
    overall: { current: number; best: number };
    workout: { current: number; best: number };
    study: { current: number; best: number };
    project: { current: number; best: number };
  };
  achievements: Array<{
    id: string;
    title: string;
    description: string;
    unlocked: boolean;
    progress: number;
    target: number;
  }>;
  rates: {
    seven_day: { completed: number; missed: number; total: number; percent: number | null };
    thirty_day: { completed: number; missed: number; total: number; percent: number | null };
  };
};

type LearnedMetric = {
  minutes: number;
  samples: number;
  confidence: "learning" | "useful" | "strong";
};

type TimeProfile = {
  generated_at: number;
  prep_by_category: Record<string, LearnedMetric & { default_minutes: number; learned: boolean }>;
  prep_by_context?: Array<{ context: string; minutes: number; samples: number; confidence: string; confidence_score?: number }>;
  travel_by_context: Array<{ context: string; minutes: number; samples: number; confidence: string; confidence_score?: number }>;
  travel_by_route?: Array<{ context: string; minutes: number; samples: number; confidence: string; confidence_score?: number }>;
  upcoming_transitions?: Array<{ from_title: string; to_title: string; slack_minutes: number; status: string }>;
  study: { recommended_minutes: number; average_minutes: number | null; samples: number; preferred_start_hour: number | null };
  workout: { recommended_minutes: number; average_minutes: number | null; samples: number; preferred_start_hour: number | null };
  underestimation: { factor: number | null; samples: number; label: string };
  active_prep?: { event_id: number; category: string; started_at: number } | null;
};

function pct(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(value)}%`;
}

function duration(minutes: number | null | undefined) {
  if (!minutes) return "Learning";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function clockHour(hour: number | null | undefined) {
  if (hour == null) return "Learning";
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric" });
}

function categoryRate(history: HistoryItem[], category: string) {
  const recent = history.filter((item) => item.category === category);
  const completed = recent.filter((item) => item.result === "completed").length;
  return recent.length ? Math.round((completed / recent.length) * 100) : null;
}

function relativeTime(epoch: number) {
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - epoch));
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function MomentumBridge() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState(false);
  const [summary, setSummary] = useState<CompletionSummary | null>(null);
  const [profile, setProfile] = useState<TimeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notifications, setNotifications] = useState("off");
  const [screensaverEnabled, setScreensaverEnabled] = useState(true);
  const [screensaverDelay, setScreensaverDelay] = useState(3);

  const syncShell = useCallback(() => {
    const workspace = document.querySelector<HTMLElement>(".workspace-scroll");
    const title = document.querySelector<HTMLElement>(".topbar-title h1")?.textContent?.trim();
    setTarget(workspace);
    setActive(Boolean(workspace && title === "Momentum"));
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
    if (typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      const enabled = window.localStorage.getItem("silk_proactive_enabled") === "true";
      const permission = "Notification" in window ? Notification.permission : "unsupported";
      setNotifications(enabled && permission === "granted" ? "on" : permission);
      setScreensaverEnabled(window.localStorage.getItem("silk_screensaver_enabled") !== "false");
      setScreensaverDelay(Math.max(1, Math.min(30, Number(window.localStorage.getItem("silk_screensaver_delay_minutes") || 3))));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active]);

  const load = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError("");
    try {
      const [completionResponse, timeResponse] = await Promise.all([
        fetch("/api/completions/summary", { credentials: "same-origin" }),
        fetch("/api/time-engine/profile", { credentials: "same-origin" }),
      ]);
      if (!completionResponse.ok) throw new Error("Momentum could not load completion history.");
      setSummary((await completionResponse.json()) as CompletionSummary);
      if (timeResponse.ok) setProfile((await timeResponse.json()) as TimeProfile);
      else setProfile(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Momentum could not refresh.");
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [active, load]);

  const enableNotifications = useCallback(async () => {
    if (!("Notification" in window)) {
      setNotifications("unsupported");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      window.localStorage.setItem("silk_proactive_enabled", "true");
      setNotifications("on");
      window.dispatchEvent(new CustomEvent("silk-enable-proactive"));
    } else {
      setNotifications(permission);
    }
  }, []);

  const consistency = useMemo(() => {
    const history = summary?.history || [];
    return {
      workout: categoryRate(history, "workout"),
      study: categoryRate(history, "study"),
      project: categoryRate(history, "project"),
    };
  }, [summary]);

  const recentWins = useMemo(() => (summary?.history || []).filter((item) => item.result === "completed").slice(0, 8), [summary]);
  const unlocked = useMemo(() => (summary?.achievements || []).filter((item) => item.unlocked), [summary]);

  if (!target || !active) return null;

  return createPortal(
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>MOMENTUM / PROGRESS</span>
          <h1>Your evidence, not your intentions.</h1>
          <p>SILK tracks what you actually complete, what keeps slipping, and the timing patterns it has enough evidence to learn.</p>
        </div>
        <div className={styles.heroActions}>
          <button onClick={() => window.dispatchEvent(new Event("silk-inspiration-open"))}><Sparkles size={15} /> Inspire me</button>
          <button onClick={() => void load()} disabled={loading}><Activity size={15} /> {loading ? "Syncing" : "Refresh"}</button>
        </div>
      </section>

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.metrics}>
        <article className={styles.metric}><span><Flame size={15} /> Current streak</span><strong>{summary?.streaks.overall.current ?? 0}</strong><small>consecutive completion days</small></article>
        <article className={styles.metric}><span><Trophy size={15} /> Best streak</span><strong>{summary?.streaks.overall.best ?? 0}</strong><small>best run on record</small></article>
        <article className={styles.metric}><span><Zap size={15} /> 7-day rate</span><strong>{pct(summary?.rates.seven_day.percent)}</strong><small>{summary?.rates.seven_day.total ?? 0} tracked commitments</small></article>
        <article className={styles.metric}><span><Award size={15} /> Achievements</span><strong>{unlocked.length}</strong><small>unlocked so far</small></article>
      </section>

      <section className={styles.grid}>
        <article className={`${styles.card} ${styles.consistencyCard}`}>
          <div className={styles.cardHead}><div><span>CONSISTENCY</span><h2>What keeps happening</h2></div><Activity size={18} /></div>
          <div className={styles.consistencyList}>
            <div><span className={styles.icon}><Dumbbell size={15} /></span><div><strong>Workout</strong><small>{summary?.streaks.workout.current ?? 0}-day current streak · best {summary?.streaks.workout.best ?? 0}</small></div><b>{pct(consistency.workout)}</b></div>
            <div><span className={styles.icon}><BookOpen size={15} /></span><div><strong>Study</strong><small>{summary?.streaks.study.current ?? 0}-day current streak · best {summary?.streaks.study.best ?? 0}</small></div><b>{pct(consistency.study)}</b></div>
            <div><span className={styles.icon}><FolderKanban size={15} /></span><div><strong>Projects</strong><small>{summary?.streaks.project.current ?? 0}-day current streak · best {summary?.streaks.project.best ?? 0}</small></div><b>{pct(consistency.project)}</b></div>
          </div>
        </article>

        <article className={`${styles.card} ${styles.learnCard}`}>
          <div className={styles.cardHead}><div><span>ADAPTIVE TIME ENGINE</span><h2>What SILK has learned</h2></div><Clock3 size={18} /></div>
          <div className={styles.learnGrid}>
            <div><span>Study block</span><strong>{duration(profile?.study.recommended_minutes)}</strong><small>{profile?.study.samples || 0} measured sessions · preferred {clockHour(profile?.study.preferred_start_hour)}</small></div>
            <div><span>Workout length</span><strong>{duration(profile?.workout.recommended_minutes)}</strong><small>{profile?.workout.samples || 0} measured sessions · preferred {clockHour(profile?.workout.preferred_start_hour)}</small></div>
            <div><span>Planning accuracy</span><strong>{profile?.underestimation.factor ? `${profile.underestimation.factor.toFixed(2)}×` : "Learning"}</strong><small>{profile?.underestimation.label || "SILK needs matched planned vs actual durations."}</small></div>
            <div><span>Context prep</span><strong>{profile?.prep_by_context?.filter((item) => item.samples >= 2).length || 0}</strong><small>destinations/events with repeat prep evidence</small></div>
            <div><span>Travel contexts</span><strong>{profile?.travel_by_context.length || 0}</strong><small>{profile?.travel_by_route?.length || 0} origin → destination route patterns</small></div>
            <div><span>Next transition</span><strong>{profile?.upcoming_transitions?.[0]?.status ? profile.upcoming_transitions[0].status.toUpperCase() : "Clear"}</strong><small>{profile?.upcoming_transitions?.[0] ? `${profile.upcoming_transitions[0].from_title} → ${profile.upcoming_transitions[0].to_title} · ${profile.upcoming_transitions[0].slack_minutes}m slack` : "No adjacent timed events need transition planning."}</small></div>
          </div>
          <div className={styles.prepStrip}>
            {Object.entries(profile?.prep_by_category || {}).slice(0, 5).map(([category, metric]) => (
              <div key={category}><span>{category}</span><strong>{metric.minutes}m</strong><small>{metric.learned ? `${metric.samples} samples` : "default"}</small></div>
            ))}
          </div>
        </article>

        <article className={`${styles.card} ${styles.achievementsCard}`}>
          <div className={styles.cardHead}><div><span>ACHIEVEMENTS</span><h2>Earned, not sprayed everywhere</h2></div><Award size={18} /></div>
          <div className={styles.achievementGrid}>
            {(summary?.achievements || []).map((achievement) => (
              <div className={achievement.unlocked ? styles.unlocked : styles.locked} key={achievement.id}>
                <span>{achievement.unlocked ? <Trophy size={16} /> : <Award size={16} />}</span>
                <div><strong>{achievement.title}</strong><small>{achievement.description}</small></div>
                <em>{achievement.unlocked ? "Unlocked" : `${Math.min(achievement.progress, achievement.target)}/${achievement.target}`}</em>
              </div>
            ))}
            {!summary?.achievements?.length && <p className={styles.empty}>Achievements will appear as completion history grows.</p>}
          </div>
        </article>

        <article className={`${styles.card} ${styles.winsCard}`}>
          <div className={styles.cardHead}><div><span>RECENT WINS</span><h2>Receipts</h2></div><CheckMark /></div>
          <div className={styles.winList}>
            {recentWins.map((item) => <div key={item.id}><span className={styles.winDot} /><div><strong>{item.title}</strong><small>{item.category} · {relativeTime(item.occurred_at)}</small></div></div>)}
            {!recentWins.length && <p className={styles.empty}>Complete something and SILK will put the receipt here.</p>}
          </div>
        </article>

        <article className={`${styles.card} ${styles.proactiveCard}`}>
          <div className={styles.cardHead}><div><span>PROACTIVE SILK</span><h2>Let SILK interrupt only when it matters</h2></div><Bell size={18} /></div>
          <p>Departure warnings, shrinking free windows, finished study blocks, traffic changes, and sleep-protection signals can surface without waiting for you to ask.</p>
          <div className={styles.proactiveRow}>
            <div><span>Status</span><strong>{notifications === "on" ? "Enabled" : notifications === "denied" ? "Blocked by browser" : notifications === "unsupported" ? "Not supported here" : "Off"}</strong></div>
            {notifications !== "on" && notifications !== "unsupported" && <button onClick={() => void enableNotifications()}><Bell size={14} /> Enable alerts</button>}
            {notifications === "on" && <span className={styles.enabled}><Zap size={13} /> Listening</span>}
          </div>
          <small className={styles.note}>SILK does not request notification permission until you explicitly press Enable alerts.</small>
        </article>

        <article className={`${styles.card} ${styles.proactiveCard}`}>
          <div className={styles.cardHead}><div><span>AMBIENT SILK</span><h2>3D Inspiration Screensaver</h2></div><Sparkles size={18} /></div>
          <p>Idle SILK becomes a quiet 3D monument to human achievement, then returns to the exact screen you left.</p>
          <div className={styles.proactiveRow}>
            <div><span>Idle activation</span><strong>{screensaverEnabled ? `On · ${screensaverDelay} min` : "Off"}</strong></div>
            <div className={styles.heroActions}>
              <button onClick={() => { const next = !screensaverEnabled; setScreensaverEnabled(next); window.localStorage.setItem("silk_screensaver_enabled", String(next)); }}>{screensaverEnabled ? "Disable" : "Enable"}</button>
              <button onClick={() => { const next = screensaverDelay >= 10 ? 1 : screensaverDelay + 1; setScreensaverDelay(next); window.localStorage.setItem("silk_screensaver_delay_minutes", String(next)); }}>Delay {screensaverDelay}m</button>
              <button onClick={() => window.dispatchEvent(new Event("silk-inspiration-open"))}>Launch now</button>
            </div>
          </div>
          <small className={styles.note}>It will not activate while you are typing, editing a field, or handling a modal/approval. Reduced-motion devices get the static fallback.</small>
        </article>
      </section>
    </div>,
    target,
  );
}

function CheckMark() {
  return <span className={styles.checkMark}>✓</span>;
}
