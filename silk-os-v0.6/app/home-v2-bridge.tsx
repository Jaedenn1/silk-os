"use client";

import {
  Activity,
  BookOpen,
  Brain,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Dumbbell,
  FolderKanban,
  Home,
  ListChecks,
  Menu,
  MessageCircle,
  Mic,
  MoreHorizontal,
  Search,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { SilkCoreWebGL, type SilkCoreState } from "./components/silk-core-webgl";
import styles from "./home-v2.module.css";

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

type Project = {
  id: number;
  name: string;
  description?: string;
  status: string;
  priority: number;
  done_tasks: number;
  task_count: number;
  open_tasks: number;
};

type ActivityItem = {
  id: number;
  provider: string;
  action: string;
  target: string;
  status: string;
  created_at: number;
};

type HomeData = {
  today: {
    date: string;
    items: DailyItem[];
    progress: { completed: number; total: number; percent: number };
    focus_minutes: number;
    deadlines: Array<{ id: number; name: string; due_at: number; priority: number }>;
    synced_at: number;
  };
  projects: Project[];
  study: { weakest_topics?: Array<Record<string, unknown>> };
  workouts: { active?: Record<string, unknown> | null; recent?: Array<Record<string, unknown>> };
  activity: ActivityItem[];
  approvals: Array<{ id: number; status: string }>;
  weather: {
    status: string;
    location: string;
    condition?: string;
    temperature?: number;
    unit?: string;
  };
  settings: { owner_name: string; assistant_name: string };
};

type Mode = {
  label: string;
  target: string | null;
  icon: typeof Home;
};

const MODES: Mode[] = [
  { label: "Today", target: "Today", icon: ListChecks },
  { label: "Calendar", target: "Calendar", icon: CalendarDays },
  { label: "Fitness", target: "Workouts", icon: Dumbbell },
  { label: "Files", target: null, icon: FolderKanban },
  { label: "Memory", target: "Memory", icon: Brain },
  { label: "Projects", target: "Projects", icon: FolderKanban },
  { label: "Study", target: "Study", icon: BookOpen },
];

function relativeTime(epoch?: number | null) {
  if (!epoch) return "Unscheduled";
  const diff = epoch * 1000 - Date.now();
  const mins = Math.round(Math.abs(diff) / 60000);
  if (diff < 0) return mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
  if (mins < 1) return "now";
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `in ${hours}h ${rest}m` : `in ${hours}h`;
}

function clock(epoch?: number | null) {
  if (!epoch) return "";
  return new Date(epoch * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function duration(minutes?: number) {
  const value = Number(minutes || 0);
  if (!value) return "Flexible";
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function activityLabel(value: string) {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function findNavButton(label: string) {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".side-nav button"));
  return buttons.find((button) => button.textContent?.trim() === label) || null;
}

export default function HomeV2Bridge() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [data, setData] = useState<HomeData | null>(null);
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [quickReply, setQuickReply] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [coreState, setCoreState] = useState<SilkCoreState>("idle");
  const [coreLabel, setCoreLabel] = useState("Ready");
  const [, setTick] = useState(0);

  const syncShell = useCallback(() => {
    const workspace = document.querySelector<HTMLElement>(".workspace-scroll");
    const title = document.querySelector<HTMLElement>(".topbar-title h1")?.textContent?.trim();
    setTarget(workspace);
    setActive(Boolean(workspace && title === "Overview"));
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
    shell.classList.toggle("home-v2-active", active);
    shell.classList.toggle("home-nav-open", active && drawerOpen);
    return () => {
      shell.classList.remove("home-v2-active", "home-nav-open");
    };
  }, [active, drawerOpen]);

  useEffect(() => {
    const closeDrawer = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest(".side-nav button");
      if (button) setDrawerOpen(false);
    };
    document.addEventListener("click", closeDrawer, true);
    return () => document.removeEventListener("click", closeDrawer, true);
  }, []);

  const load = useCallback(async () => {
    try {
      const sessionResponse = await fetch("/api/session", { credentials: "same-origin" });
      const session = (await sessionResponse.json().catch(() => ({}))) as { configured?: boolean; authenticated?: boolean };
      if (!session.configured) {
        setPreview(true);
        setData(null);
        return;
      }
      if (!session.authenticated) return;
      const response = await fetch("/api/bootstrap", { credentials: "same-origin" });
      if (!response.ok) return;
      setData((await response.json()) as HomeData);
      setPreview(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const todo = useMemo(
    () => (data?.today.items || []).filter((item) => !["done", "skipped"].includes(item.status)),
    [data],
  );

  const nextUp = useMemo(() => {
    const now = Date.now() / 1000;
    return [...(data?.today.items || [])]
      .filter((item) => item.scheduled_at && Number(item.scheduled_at) >= now && !["done", "skipped"].includes(item.status))
      .sort((a, b) => Number(a.scheduled_at) - Number(b.scheduled_at))[0] || todo[0] || null;
  }, [data, todo]);

  const activeProjects = useMemo(
    () => (data?.projects || []).filter((project) => project.status === "active").slice(0, 3),
    [data],
  );

  const openView = useCallback((label: string) => {
    const button = findNavButton(label);
    if (!button) return;
    button.click();
  }, []);

  const spin = (direction: number) => setRotation((value) => value + direction * (360 / MODES.length));

  const runQuickChat = useCallback(async (text: string) => {
    if (!text.trim() || quickBusy) return;
    setQuickReply("");
    setSteps([]);
    setQuickBusy(true);
    setCoreState("routing");
    setCoreLabel("Routing request");

    if (preview) {
      window.setTimeout(() => {
        setSteps(["Routing request", "Checking your workspace"]);
        setQuickReply("This is the SILK Home preview. Once your private workspace is connected, quick chat can read your calendar, Today list, projects, study data, and other SILK context from here.");
        setCoreState("idle");
        setCoreLabel("Ready");
        setQuickBusy(false);
      }, 420);
      return;
    }

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!response.ok || !response.body) throw new Error("SILK could not open quick chat.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";

        for (const frame of frames) {
          const event = frame.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
          const raw = frame.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
          if (!event || !raw) continue;
          const payload = JSON.parse(raw) as Record<string, unknown>;

          if (event === "activity") {
            const state = String(payload.state || "thinking") as SilkCoreState;
            const label = String(payload.label || "Working");
            setCoreState(state);
            setCoreLabel(label);
            setSteps((current) => current.includes(label) ? current : [...current, label].slice(-4));
          }
          if (event === "message") {
            setQuickReply(String(payload.reply || ""));
          }
          if (event === "error") throw new Error(String(payload.error || "SILK could not answer."));
        }
      }
      void load();
    } catch (error) {
      setCoreState("error");
      setCoreLabel("Quick chat error");
      setQuickReply(error instanceof Error ? error.message : "SILK could not answer.");
    } finally {
      setQuickBusy(false);
      window.setTimeout(() => {
        setCoreState("idle");
        setCoreLabel("Ready");
      }, 900);
    }
  }, [load, preview, quickBusy]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) return;
    setPrompt("");
    void runQuickChat(text);
  };

  const openFullChat = () => {
    const refresh = document.querySelector<HTMLButtonElement>(".top-actions .icon-button:last-child");
    refresh?.click();
    window.setTimeout(() => openView("Ask Silk"), 350);
  };

  if (!target || !active) return null;

  const owner = data?.settings.owner_name || "Jaedenn";
  const pendingApprovals = data?.approvals.filter((item) => item.status === "pending").length || 0;
  const focus = data?.today.focus_minutes || 0;
  const weakest = String(data?.study.weakest_topics?.[0]?.topic || "Caught up");
  const todayCount = todo.length;
  const dateLabel = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const weather = data?.weather.status === "ready" && data.weather.temperature !== undefined
    ? `${Math.round(Number(data.weather.temperature))}${data.weather.unit || "°"} · ${data.weather.condition || "Weather"}`
    : null;

  const home = (
    <div className={styles.home}>
      {drawerOpen && <button className={styles.backdrop} aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />}

      <section className={styles.hero}>
        <div className={styles.heroTop}>
          <button className={styles.menuButton} onClick={() => setDrawerOpen(true)} aria-label="Open SILK navigation">
            <Menu size={18} />
            <span>SILK</span>
          </button>
          <div className={styles.heroMeta}>
            <span>{dateLabel}</span>
            <span className={styles.online}><i /> SILK ONLINE</span>
          </div>
        </div>

        <div className={styles.heroGrid}>
          <div className={styles.brief}>
            <span className={styles.kicker}>PERSONAL COMMAND CENTER</span>
            <h1>{greeting()}, {owner}.</h1>
            <p>
              {todayCount
                ? `You have ${todayCount} ${todayCount === 1 ? "thing" : "things"} that matter today. ${todo[0]?.title || "Your next priority"} is at the front of the queue.`
                : "Your tracked queue is clear. Pick one meaningful thing before the day fills itself for you."}
            </p>
            <div className={styles.briefChips}>
              {nextUp && <span><Clock3 size={14} /> Next: {nextUp.title}{nextUp.scheduled_at ? ` · ${clock(nextUp.scheduled_at)}` : ""}</span>}
              <span><Activity size={14} /> Free focus: {duration(focus)}</span>
              {weather && <span>{weather}</span>}
              {pendingApprovals > 0 && <span className={styles.attention}>{pendingApprovals} approval{pendingApprovals === 1 ? "" : "s"} waiting</span>}
            </div>
          </div>

          <div className={styles.orbitStage} aria-label="SILK mode carousel">
            <div className={styles.orbitHalo} />
            <div className={styles.coreWrap}>
              <SilkCoreWebGL state={coreState} label={coreLabel} />
            </div>
            {MODES.map((mode, index) => {
              const angle = (index / MODES.length) * Math.PI * 2 - Math.PI / 2 + rotation * Math.PI / 180;
              const x = 50 + Math.cos(angle) * 41;
              const y = 50 + Math.sin(angle) * 41;
              const Icon = mode.icon;
              return (
                <button
                  key={mode.label}
                  className={`${styles.mode} ${mode.target ? "" : styles.modeFuture}`}
                  style={{ left: `${x}%`, top: `${y}%` }}
                  onClick={() => mode.target && openView(mode.target)}
                  title={mode.target ? `Open ${mode.label}` : `${mode.label} workspace is planned`}
                >
                  <span><Icon size={17} /></span>
                  <small>{mode.label}</small>
                </button>
              );
            })}
            <button className={`${styles.orbitControl} ${styles.orbitLeft}`} onClick={() => spin(-1)} aria-label="Rotate modes left"><ChevronLeft size={16} /></button>
            <button className={`${styles.orbitControl} ${styles.orbitRight}`} onClick={() => spin(1)} aria-label="Rotate modes right"><ChevronRight size={16} /></button>
          </div>
        </div>

        <form className={styles.promptBar} onSubmit={submit}>
          <Search size={18} />
          <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask SILK anything..." aria-label="Quick chat with SILK" />
          <button type="button" className={styles.promptTool} aria-label="Voice input"><Mic size={17} /></button>
          <button className={styles.sendButton} disabled={!prompt.trim() || quickBusy} aria-label="Send to SILK">
            {quickBusy ? <span className={styles.spinner} /> : <Send size={16} />}
          </button>
        </form>

        {(quickBusy || steps.length > 0 || quickReply) && (
          <div className={styles.quickPanel}>
            <div className={styles.thoughtLine}>
              <span className={quickBusy ? styles.thinkingDot : styles.doneDot} />
              <strong>{quickBusy ? "SILK is working" : "SILK finished"}</strong>
              <div className={styles.steps}>
                {steps.map((step, index) => <span key={`${step}-${index}`}><Check size={12} /> {step}</span>)}
              </div>
            </div>
            {quickReply && (
              <div className={styles.quickReply}>
                <p>{quickReply}</p>
                <button onClick={openFullChat}>Continue in Chat <ChevronRight size={14} /></button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className={styles.bento}>
        <article className={`${styles.card} ${styles.todayCard}`}>
          <header><div><span>TODAY</span><h2>Your day</h2></div><button onClick={() => openView("Today")}>Open Today <ChevronRight size={14} /></button></header>
          <div className={styles.todayList}>
            {(data?.today.items || []).slice(0, 5).map((item) => (
              <div key={item.id} className={`${styles.todayItem} ${item.status === "done" ? styles.done : ""}`}>
                <span className={styles.taskDot}>{item.status === "done" ? <Check size={12} /> : null}</span>
                <div><strong>{item.title}</strong><small>{activityLabel(item.source_type)} · {duration(item.duration_minutes)}{item.scheduled_at ? ` · ${clock(item.scheduled_at)}` : ""}</small></div>
              </div>
            ))}
            {!data?.today.items?.length && <p className={styles.empty}>Nothing is tracked yet. Enjoy the suspicious calm.</p>}
          </div>
        </article>

        <article className={`${styles.card} ${styles.priorityCard}`}>
          <div className={styles.glowOrb} />
          <header><div><span>PRIORITY SIGNAL</span><h2>SILK recommends</h2></div><Sparkles size={18} /></header>
          <div className={styles.priorityBody}>
            <strong>{todo[0]?.title || "Choose the next meaningful task"}</strong>
            <p>{todo[0] ? `${duration(todo[0].duration_minutes)} is enough to make real progress here.` : "Your queue is clear, so the smartest move is deciding what deserves your attention next."}</p>
            {data?.today.deadlines?.[0] && <small>Nearest deadline · {data.today.deadlines[0].name}</small>}
          </div>
          <button className={styles.focusButton} onClick={() => openView(todo[0]?.source_type === "study" ? "Study" : "Today")}>Start focus <ChevronRight size={14} /></button>
        </article>

        <article className={`${styles.card} ${styles.nextCard}`}>
          <header><div><span>NEXT UP</span><h2>{nextUp?.title || "Open space"}</h2></div><Clock3 size={18} /></header>
          {nextUp ? (
            <div className={styles.nextBody}>
              <strong>{nextUp.scheduled_at ? clock(nextUp.scheduled_at) : duration(nextUp.duration_minutes)}</strong>
              <span>{nextUp.scheduled_at ? relativeTime(nextUp.scheduled_at) : "Ready when you are"}</span>
              <small>{activityLabel(nextUp.source_type)} · {duration(nextUp.duration_minutes)}</small>
            </div>
          ) : <p className={styles.empty}>Nothing scheduled next.</p>}
        </article>

        <article className={`${styles.card} ${styles.projectsCard}`}>
          <header><div><span>PROJECTS</span><h2>Active work</h2></div><button onClick={() => openView("Projects")}>All projects <ChevronRight size={14} /></button></header>
          <div className={styles.projectsList}>
            {activeProjects.map((project) => {
              const percent = project.task_count ? Math.round(project.done_tasks / project.task_count * 100) : 0;
              return <div className={styles.projectRow} key={project.id}>
                <div><strong>{project.name}</strong><small>{project.open_tasks} open</small></div>
                <div className={styles.progress}><i style={{ width: `${percent}%` }} /></div>
                <span>{percent}%</span>
              </div>;
            })}
            {!activeProjects.length && <p className={styles.empty}>No active projects.</p>}
          </div>
        </article>

        <article className={`${styles.card} ${styles.activityCard}`}>
          <header><div><span>SILK ACTIVITY</span><h2>Recently</h2></div><button onClick={() => openView("Activity")}>View all <ChevronRight size={14} /></button></header>
          <div className={styles.activityList}>
            {(data?.activity || []).slice(0, 4).map((item) => (
              <div key={item.id} className={styles.activityRow}><span><Check size={11} /></span><div><strong>{activityLabel(item.action)}</strong><small>{item.target}</small></div><time>{relativeTime(item.created_at)}</time></div>
            ))}
            {!data?.activity?.length && <p className={styles.empty}>No recent SILK activity.</p>}
          </div>
        </article>

        <article className={`${styles.card} ${styles.pulseCard}`}>
          <header><div><span>LIFE PULSE</span><h2>Right now</h2></div><Activity size={18} /></header>
          <div className={styles.pulseGrid}>
            <button onClick={() => openView("Study")}><BookOpen size={16} /><span><small>Study</small><strong>{weakest}</strong></span><i className={weakest === "Caught up" ? styles.ok : styles.warn} /></button>
            <button onClick={() => openView("Workouts")}><Dumbbell size={16} /><span><small>Fitness</small><strong>{data?.workouts.active ? "Workout active" : "Ready"}</strong></span><i className={styles.ok} /></button>
            <button onClick={() => openView("Today")}><Clock3 size={16} /><span><small>Schedule</small><strong>{duration(focus)} focus</strong></span><i className={focus >= 120 ? styles.ok : styles.warn} /></button>
            <button onClick={() => openView("Projects")}><FolderKanban size={16} /><span><small>Projects</small><strong>{activeProjects.length} active</strong></span><i className={styles.ok} /></button>
          </div>
        </article>
      </section>

      <nav className={styles.mobileDock} aria-label="SILK quick navigation">
        <button className={styles.mobileActive}><Home size={18} /><span>Home</span></button>
        <button onClick={() => openView("Ask Silk")}><MessageCircle size={18} /><span>Chat</span></button>
        <button onClick={() => openView("Today")}><ListChecks size={18} /><span>Today</span></button>
        <button onClick={() => openView("Calendar")}><CalendarDays size={18} /><span>Calendar</span></button>
        <button onClick={() => setDrawerOpen(true)}><MoreHorizontal size={18} /><span>More</span></button>
      </nav>

      {loading && <div className={styles.loadingBadge}>Syncing SILK…</div>}
    </div>
  );

  return createPortal(home, target);
}
