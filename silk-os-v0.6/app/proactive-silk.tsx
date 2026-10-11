"use client";

import { Bell, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./proactive-silk.module.css";

type Signal = {
  id: string;
  title: string;
  body: string;
  urgency: "low" | "normal" | "high";
  action_url: string;
  kind: string;
};

type Toast = Signal & { shownAt: number };

const STORAGE_KEY = "silk_proactive_seen_v1";
const ENABLE_KEY = "silk_proactive_enabled";

function readSeen() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, number>;
    const cutoff = Date.now() - 72 * 60 * 60 * 1000;
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => Number(value) >= cutoff));
  } catch {
    return {} as Record<string, number>;
  }
}

export default function ProactiveSilk() {
  const [enabled, setEnabled] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenRef = useRef<Record<string, number>>({});
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const initialize = useCallback(async () => {
    if (!("Notification" in window)) return false;
    const allowed = window.localStorage.getItem(ENABLE_KEY) === "true" && Notification.permission === "granted";
    setEnabled(allowed);
    if (!allowed) return false;
    seenRef.current = readSeen();
    if ("serviceWorker" in navigator) {
      try {
        registrationRef.current = await navigator.serviceWorker.register("/silk-sw.js", { scope: "/" });
      } catch (error) {
        console.warn("SILK service worker could not register", error);
      }
    }
    return true;
  }, []);

  const showSignal = useCallback(async (signal: Signal) => {
    if (seenRef.current[signal.id]) return;
    const now = Date.now();
    seenRef.current[signal.id] = now;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seenRef.current));
    setToasts((current) => [{ ...signal, shownAt: now }, ...current].slice(0, 3));
    window.dispatchEvent(new CustomEvent("silk-proactive-signal", { detail: signal }));

    if (Notification.permission !== "granted") return;
    const options: NotificationOptions = {
      body: signal.body,
      tag: signal.id,
      data: { url: signal.action_url || "/", kind: signal.kind },
      requireInteraction: signal.urgency === "high",
      silent: false,
    };
    try {
      if (registrationRef.current) await registrationRef.current.showNotification(signal.title, options);
      else new Notification(signal.title, options);
    } catch (error) {
      console.warn("SILK could not display a browser notification", error);
    }
  }, []);

  const poll = useCallback(async () => {
    if (!enabled) return;
    try {
      const response = await fetch("/api/proactive/signals", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { signals?: Signal[] };
      const signals = Array.isArray(payload.signals) ? payload.signals : [];
      for (const signal of signals) await showSignal(signal);
    } catch {
      // Proactive polling is best-effort and should never destabilize SILK.
    }
  }, [enabled, showSignal]);

  useEffect(() => {
    const initial = window.setTimeout(() => void initialize(), 0);
    const onEnable = () => void initialize().then((ready) => {
      if (ready) window.setTimeout(() => void poll(), 0);
    });
    window.addEventListener("silk-enable-proactive", onEnable);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener("silk-enable-proactive", onEnable);
    };
  }, [initialize, poll]);

  useEffect(() => {
    if (!enabled) return;
    const first = window.setTimeout(() => void poll(), 1200);
    const timer = window.setInterval(() => void poll(), 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, poll]);

  useEffect(() => {
    if (!toasts.length) return;
    const timer = window.setTimeout(() => setToasts((current) => current.slice(0, -1)), 9000);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  if (!toasts.length) return null;
  return (
    <div className={styles.stack} aria-live="polite">
      {toasts.map((toast) => (
        <article className={`${styles.toast} ${toast.urgency === "high" ? styles.high : ""}`} key={toast.id}>
          <span className={styles.icon}><Bell size={15} /></span>
          <button className={styles.copy} onClick={() => { if (toast.action_url) window.location.href = toast.action_url; }}>
            <strong>{toast.title}</strong>
            <small>{toast.body}</small>
          </button>
          <button className={styles.close} aria-label="Dismiss notification" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}><X size={14} /></button>
        </article>
      ))}
    </div>
  );
}
