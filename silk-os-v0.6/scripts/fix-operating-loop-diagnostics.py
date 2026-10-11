from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"{label} anchor not found")
    return text.replace(old, new, 1)

# Fix the accidental duplicate export introduced by the integration patch.
time_engine = Path("worker/silk-time-engine.js")
text = time_engine.read_text().replace("export export function sampleConfidence", "export function sampleConfidence")
time_engine.write_text(text)

# Keep Momentum's localStorage/Notification synchronization asynchronous so it
# obeys React's set-state-in-effect rule.
momentum = Path("app/momentum-bridge.tsx")
text = momentum.read_text()
old = '''  useEffect(() => {\n    if (typeof window === "undefined") return;\n    const enabled = window.localStorage.getItem("silk_proactive_enabled") === "true";\n    const permission = "Notification" in window ? Notification.permission : "unsupported";\n    setNotifications(enabled && permission === "granted" ? "on" : permission);\n    setScreensaverEnabled(window.localStorage.getItem("silk_screensaver_enabled") !== "false");\n    setScreensaverDelay(Math.max(1, Math.min(30, Number(window.localStorage.getItem("silk_screensaver_delay_minutes") || 3))));\n  }, [active]);\n'''
new = '''  useEffect(() => {\n    if (typeof window === "undefined") return;\n    const timer = window.setTimeout(() => {\n      const enabled = window.localStorage.getItem("silk_proactive_enabled") === "true";\n      const permission = "Notification" in window ? Notification.permission : "unsupported";\n      setNotifications(enabled && permission === "granted" ? "on" : permission);\n      setScreensaverEnabled(window.localStorage.getItem("silk_screensaver_enabled") !== "false");\n      setScreensaverDelay(Math.max(1, Math.min(30, Number(window.localStorage.getItem("silk_screensaver_delay_minutes") || 3))));\n    }, 0);\n    return () => window.clearTimeout(timer);\n  }, [active]);\n'''
text = replace_once(text, old, new, "Momentum async settings")
momentum.write_text(text)

# Same rule for the proactive client: initialize from the effect on a queued
# callback, while subscriptions remain registered synchronously.
proactive = Path("app/proactive-silk.tsx")
text = proactive.read_text()
old = '''  useEffect(() => {\n    void initialize();\n    const onEnable = () => void initialize().then((ready) => {\n      if (ready) window.setTimeout(() => void poll(), 0);\n    });\n    window.addEventListener("silk-enable-proactive", onEnable);\n    return () => window.removeEventListener("silk-enable-proactive", onEnable);\n  }, [initialize, poll]);\n'''
new = '''  useEffect(() => {\n    const initial = window.setTimeout(() => void initialize(), 0);\n    const onEnable = () => void initialize().then((ready) => {\n      if (ready) window.setTimeout(() => void poll(), 0);\n    });\n    window.addEventListener("silk-enable-proactive", onEnable);\n    return () => {\n      window.clearTimeout(initial);\n      window.removeEventListener("silk-enable-proactive", onEnable);\n    };\n  }, [initialize, poll]);\n'''
text = replace_once(text, old, new, "Proactive async init")
proactive.write_text(text)

# Avoid relying on a global React namespace for the inline CSS custom property.
saver = Path("app/inspiration-screensaver.tsx")
text = saver.read_text()
text = text.replace(
    'import { useCallback, useEffect, useMemo, useRef, useState } from "react";',
    'import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";',
)
text = text.replace('as React.CSSProperties', 'as CSSProperties')
saver.write_text(text)

# RouteEstimate's typed payload already exposes the traffic provider; do not
# reach into an untyped providers field.
today = Path("app/today-v2-bridge.tsx")
text = today.read_text().replace('payload.traffic?.provider || payload.providers?.router || null', 'payload.traffic?.provider || null')
today.write_text(text)
