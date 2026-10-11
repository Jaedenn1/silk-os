"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import styles from "./inspiration-screensaver.module.css";

type Figure = {
  name: string;
  field: string;
  era: string;
  mark: string;
  quote?: string;
  source?: string;
  sourceUrl?: string;
};

const FIGURES: Figure[] = [
  {
    name: "Ada Lovelace",
    field: "Mathematics · Computing",
    era: "1815–1852",
    mark: "AL",
    quote: "The Analytical Engine has no pretensions whatever to originate anything.",
    source: "Notes on the Analytical Engine, 1843 · History of Science Museum, Oxford",
    sourceUrl: "https://www.hsm.ox.ac.uk/imagining-ai",
  },
  {
    name: "Frederick Douglass",
    field: "Oratory · Reform · Writing",
    era: "1818–1895",
    mark: "FD",
    quote: "If there is no struggle, there is no progress.",
    source: "Frederick Douglass quotation · Library of Congress",
    sourceUrl: "https://www.loc.gov/item/2023632628/",
  },
  {
    name: "Theodore Roosevelt",
    field: "Leadership · Exploration",
    era: "1858–1919",
    mark: "TR",
    quote: "The credit belongs to the man who is actually in the arena.",
    source: "Citizenship in a Republic, 1910 · Theodore Roosevelt Presidential Library",
    sourceUrl: "https://www.trlibrary.com/tr/myths/misquotes",
  },
  {
    name: "Booker T. Washington",
    field: "Education · Institution Building",
    era: "1856–1915",
    mark: "BW",
    quote: "Success is to be measured not so much by the position... as by the obstacles which he has overcome.",
    source: "Up From Slavery, Chapter II · Yale Avalon Project",
    sourceUrl: "https://avalon.law.yale.edu/19th_century/booker_01.asp",
  },
  { name: "Isaac Newton", field: "Physics · Mathematics", era: "1643–1727", mark: "IN" },
  { name: "Marie Curie", field: "Physics · Chemistry", era: "1867–1934", mark: "MC" },
  { name: "Katherine Johnson", field: "Mathematics · Spaceflight", era: "1918–2020", mark: "KJ" },
  { name: "Jesse Owens", field: "Athletics", era: "1913–1980", mark: "JO" },
];

const IDLE_EVENTS: Array<keyof WindowEventMap> = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];

function shouldHoldIdle() {
  const active = document.activeElement as HTMLElement | null;
  if (active && (active.matches("input,textarea,select,[contenteditable='true']") || active.getAttribute("role") === "textbox")) return true;
  if (document.querySelector("dialog[open],[role='dialog'],.modal,.approval-modal")) return true;
  const dirtyInputs = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type='checkbox']):not([type='radio']),textarea"));
  return dirtyInputs.some((input) => input.value.trim().length > 0 && input === document.activeElement);
}

export default function InspirationScreensaver() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"poster" | "quote">("poster");
  const [scene, setScene] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const timerRef = useRef<number | null>(null);
  const reduced = useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);

  const delayMs = useCallback(() => {
    const minutes = Number(window.localStorage.getItem("silk_screensaver_delay_minutes") || 3);
    return Math.max(1, Math.min(30, Number.isFinite(minutes) ? minutes : 3)) * 60_000;
  }, []);

  const enabled = useCallback(() => window.localStorage.getItem("silk_screensaver_enabled") !== "false", []);

  const close = useCallback(() => {
    setOpen(false);
    setMode("poster");
    setScene(0);
  }, []);

  const start = useCallback(() => {
    if (!enabled() || shouldHoldIdle()) return;
    setNow(new Date());
    setOpen(true);
  }, [enabled]);

  const resetIdle = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (open) return;
    if (!enabled()) return;
    timerRef.current = window.setTimeout(() => {
      if (document.visibilityState === "visible") start();
    }, delayMs());
  }, [delayMs, enabled, open, start]);

  useEffect(() => {
    const manual = () => start();
    window.addEventListener("silk-inspiration-open", manual);
    if (!open) {
      for (const event of IDLE_EVENTS) window.addEventListener(event, resetIdle, { passive: true });
      resetIdle();
    }
    return () => {
      window.removeEventListener("silk-inspiration-open", manual);
      for (const event of IDLE_EVENTS) window.removeEventListener(event, resetIdle);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [open, resetIdle, start]);

  useEffect(() => {
    if (!open) return;
    const exit = () => close();
    for (const event of IDLE_EVENTS) window.addEventListener(event, exit, { once: true, passive: true });
    return () => {
      for (const event of IDLE_EVENTS) window.removeEventListener(event, exit);
    };
  }, [close, open]);

  useEffect(() => {
    if (!open) return;
    const sceneTimer = window.setInterval(() => setScene((value) => (value + 1) % 4), 14_000);
    const modeTimer = window.setInterval(() => setMode((value) => value === "poster" ? "quote" : "poster"), 28_000);
    const clockTimer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => {
      window.clearInterval(sceneTimer);
      window.clearInterval(modeTimer);
      window.clearInterval(clockTimer);
    };
  }, [open]);

  if (!open) return null;
  const quoteFigure = FIGURES[scene % 4];

  return (
    <div className={`${styles.screen} ${reduced ? styles.reduced : ""}`} role="presentation" aria-label="SILK inspiration screensaver">
      <div className={styles.noise} />
      <div className={styles.aurora} />
      <header className={styles.header}>
        <div><span>SILK / AMBIENT</span><strong>{mode === "poster" ? "HUMAN POTENTIAL" : "THE STANDARD"}</strong></div>
        <div className={styles.clock}><strong>{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</strong><span>{now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</span></div>
      </header>

      {mode === "poster" ? (
        <section className={styles.posterScene}>
          <div className={styles.posterTitle}><span>BUILT ACROSS GENERATIONS</span><h1>GREATNESS</h1><p>Different disciplines. Same refusal to remain ordinary.</p></div>
          <div className={styles.stage}>
            {FIGURES.map((figure, index) => (
              <article className={`${styles.figure} ${styles[`depth${index % 4}`]}`} key={figure.name} style={{ "--i": index } as CSSProperties}>
                <div className={styles.silhouette}><span>{figure.mark}</span></div>
                <div className={styles.figureCopy}><strong>{figure.name}</strong><span>{figure.field}</span><small>{figure.era}</small></div>
              </article>
            ))}
          </div>
          <div className={styles.depthLine}><span /> <em>SPORT · SCIENCE · INVENTION · LEADERSHIP · EXPLORATION</em><span /></div>
        </section>
      ) : (
        <section className={styles.quoteScene} key={quoteFigure.name}>
          <div className={styles.quoteMonument}>
            <div className={styles.ring} />
            <div className={styles.monolith}><span>{quoteFigure.mark}</span></div>
            <div className={styles.floorGlow} />
          </div>
          <div className={styles.quoteCopy}>
            <span className={styles.field}>{quoteFigure.field}</span>
            <h2>{quoteFigure.name}</h2>
            <small>{quoteFigure.era}</small>
            <blockquote>“{quoteFigure.quote}”</blockquote>
            <div className={styles.source}><span>VERIFIED SOURCE</span><p>{quoteFigure.source}</p></div>
          </div>
        </section>
      )}

      <footer className={styles.footer}><span>MOVE · TOUCH · TYPE TO RETURN TO SILK</span><i>{mode === "poster" ? "POSTER 01" : `QUOTE ${String(scene + 1).padStart(2, "0")}`}</i></footer>
    </div>
  );
}
