from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"{label} anchor not found")
    return text.replace(old, new, 1)

# Mount global experiences.
page = Path("app/page.tsx")
text = page.read_text()
text = replace_once(text,
'''import HomeV2Bridge from "./home-v2-bridge";\nimport SilkOS from "./silk-os";\nimport TodayV2Bridge from "./today-v2-bridge";\n''',
'''import HomeV2Bridge from "./home-v2-bridge";\nimport InspirationScreensaver from "./inspiration-screensaver";\nimport MomentumBridge from "./momentum-bridge";\nimport ProactiveSilk from "./proactive-silk";\nimport SilkOS from "./silk-os";\nimport TodayV2Bridge from "./today-v2-bridge";\n''', "page imports")
text = replace_once(text,
'''      <HomeTodayNeedsBridge />\n      <TodayV2Bridge />\n      <SilkOS />\n''',
'''      <HomeTodayNeedsBridge />\n      <TodayV2Bridge />\n      <MomentumBridge />\n      <ProactiveSilk />\n      <InspirationScreensaver />\n      <SilkOS />\n''', "page mounts")
page.write_text(text)

# Add Momentum to the OS navigation.
silk = Path("app/silk-os.tsx")
text = silk.read_text()
text = replace_once(text,
'''type View = "home"|"chat"|"today"|"calendar"|"projects"|"study"|"workouts"|"memory"|"integrations"|"activity"|"agents"|"devices"|"settings";''',
'''type View = "home"|"chat"|"today"|"momentum"|"calendar"|"projects"|"study"|"workouts"|"memory"|"integrations"|"activity"|"agents"|"devices"|"settings";''', "View type")
text = replace_once(text,
'''  {id:"home",label:"Overview",icon:Home},{id:"chat",label:"Ask Silk",icon:MessageCircle},{id:"today",label:"Today",icon:ListChecks},\n  {id:"calendar",label:"Calendar",icon:CalendarDays},{id:"projects",label:"Projects",icon:FolderKanban},{id:"study",label:"Study",icon:BookOpen},''',
'''  {id:"home",label:"Overview",icon:Home},{id:"chat",label:"Ask Silk",icon:MessageCircle},{id:"today",label:"Today",icon:ListChecks},\n  {id:"momentum",label:"Momentum",icon:Gauge},{id:"calendar",label:"Calendar",icon:CalendarDays},{id:"projects",label:"Projects",icon:FolderKanban},{id:"study",label:"Study",icon:BookOpen},''', "Momentum nav")
silk.write_text(text)

# Authenticate and route Time Engine + proactive APIs.
index = Path("worker/index.ts")
text = index.read_text()
text = replace_once(text,
'''import { handleSilkCompletions, completionErrorResponse } from "./silk-completions.js";\nimport { classifyAutomaticChatTier, routeAutomaticModelEnv } from "./model-routing.js";\n''',
'''import { handleSilkCompletions, completionErrorResponse } from "./silk-completions.js";\nimport { handleSilkTimeEngine, timeEngineErrorResponse } from "./silk-time-engine.js";\nimport { handleSilkProactive, proactiveErrorResponse } from "./silk-proactive.js";\nimport { classifyAutomaticChatTier, routeAutomaticModelEnv } from "./model-routing.js";\n''', "Worker imports")
anchor = '''    if (url.pathname.startsWith("/api/maps/")) {\n'''
block = '''    if (url.pathname.startsWith("/api/time-engine/")) {\n      if (!(await ownerSessionIsAuthenticated(request, env, ctx))) {\n        return withSecurityHeaders(new Response(JSON.stringify({ error: "Unlock SILK before using adaptive time intelligence." }), {\n          status: 401,\n          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },\n        }));\n      }\n      try {\n        return withSecurityHeaders(await handleSilkTimeEngine(request, env));\n      } catch (error) {\n        return withSecurityHeaders(timeEngineErrorResponse(error));\n      }\n    }\n\n    if (url.pathname.startsWith("/api/proactive/")) {\n      if (!(await ownerSessionIsAuthenticated(request, env, ctx))) {\n        return withSecurityHeaders(new Response(JSON.stringify({ error: "Unlock SILK before using proactive signals." }), {\n          status: 401,\n          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },\n        }));\n      }\n      try {\n        return withSecurityHeaders(await handleSilkProactive(request, env));\n      } catch (error) {\n        return withSecurityHeaders(proactiveErrorResponse(error));\n      }\n    }\n\n'''
if block not in text:
    if anchor not in text:
        raise SystemExit("Worker route anchor not found")
    text = text.replace(anchor, block + anchor, 1)
index.write_text(text)

# Make the Time Engine usable by other SILK modules and tests.
time_engine = Path("worker/silk-time-engine.js")
text = time_engine.read_text()
text = replace_once(text,
'''async function insertObservation(db, input) {\n''',
'''export async function recordDurationObservation(db, { category = "other", context = "", planned, actual, occurredAt = null } = {}) {\n  await ensureSchema(db);\n  const plannedMinutes = boundedMinutes(planned, true);\n  const actualMinutes = boundedMinutes(actual, true);\n  if (!plannedMinutes || !actualMinutes) return null;\n  return insertObservation(db, {\n    kind: "duration",\n    category: normalizeCategory(category),\n    context: clean(context, 180),\n    planned: plannedMinutes,\n    actual: actualMinutes,\n    metadata: {},\n    occurredAt: Number(occurredAt) || Math.floor(Date.now() / 1000),\n  });\n}\n\nexport function robustMinutes(values, fallback) {\n  const valid = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);\n  if (!valid.length) return fallback;\n  if (valid.length < 5) return Math.max(1, Math.round(median(valid)));\n  const trim = Math.max(1, Math.floor(valid.length * 0.1));\n  const trimmed = valid.slice(trim, valid.length - trim);\n  const sample = trimmed.length ? trimmed : valid;\n  return Math.max(1, Math.round(sample.reduce((sum, value) => sum + value, 0) / sample.length));\n}\n\nexport function sampleConfidence(samples) {\n  return confidence(samples);\n}\n\nasync function insertObservation(db, input) {\n''', "Time Engine exports")
# Remove duplicate local robustMinutes after exporting it.
duplicate = '''function robustMinutes(values, fallback) {\n  const valid = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);\n  if (!valid.length) return fallback;\n  if (valid.length < 5) return Math.max(1, Math.round(median(valid)));\n  const trim = Math.max(1, Math.floor(valid.length * 0.1));\n  const trimmed = valid.slice(trim, valid.length - trim);\n  const sample = trimmed.length ? trimmed : valid;\n  return Math.max(1, Math.round(sample.reduce((sum, value) => sum + value, 0) / sample.length));\n}\n\n'''
# Keep the first exported implementation, remove the later non-exported duplicate.
first = text.find("export function robustMinutes")
second = text.find(duplicate, first + 1)
if second >= 0:
    text = text[:second] + text[second + len(duplicate):]
time_engine.write_text(text)

# Life Control uses learned study/workout duration defaults and creates a planned workout block.
life = Path("worker/silk-life-chat.js")
text = life.read_text()
if not text.startswith('import { buildAdaptiveTimeProfile, recordDurationObservation }'):
    text = 'import { buildAdaptiveTimeProfile, recordDurationObservation } from "./silk-time-engine.js";\n\n' + text
text = replace_once(text,
'''async function startStudyBlock(message, db) {\n  const duration = extractDurationMinutes(message, 45);\n  const subject = extractStudySubject(message) || "Study";\n''',
'''async function startStudyBlock(message, db) {\n  const explicitDuration = extractDurationMinutes(message, 0);\n  const profile = explicitDuration ? null : await buildAdaptiveTimeProfile(db);\n  const duration = explicitDuration || Number(profile?.study?.recommended_minutes || 45);\n  const subject = extractStudySubject(message) || "Study";\n''', "adaptive study duration")
text = replace_once(text,
'''  const name = extractWorkoutName(message) || "Workout";\n  const now = Math.floor(Date.now() / 1000);\n  const result = await db.prepare(`INSERT INTO workout_sessions (name, started_at, notes) VALUES (?1, ?2, 'Started from Ask SILK')`).bind(clean(name, 100), now).run();\n  const id = Number(result?.meta?.last_row_id || 0);\n  await logAction(db, "workout.started", name, { workout_id: id || null });\n  return lifePayload(`${name} is started. I’m tracking it as your active workout.`, "workout_started", {\n    workout_session: { id: id || null, name, started_at: now, ended_at: null },\n  });\n''',
'''  const name = extractWorkoutName(message) || "Workout";\n  const now = Math.floor(Date.now() / 1000);\n  const profile = await buildAdaptiveTimeProfile(db);\n  const plannedMinutes = Number(profile?.workout?.recommended_minutes || 60);\n  const result = await db.prepare(`INSERT INTO workout_sessions (name, started_at, notes) VALUES (?1, ?2, 'Started from Ask SILK')`).bind(clean(name, 100), now).run();\n  const id = Number(result?.meta?.last_row_id || 0);\n  const dateKey = localDateKey(Date.now());\n  if (id) {\n    await db.prepare(`\n      INSERT INTO daily_items\n        (date_key, title, kind, source_type, source_id, status, scheduled_at, duration_minutes, priority, notes, updated_at)\n      VALUES (?1, ?2, 'task', 'workout', ?3, 'doing', ?4, ?5, 3, 'Started from Ask SILK', ?4)\n      ON CONFLICT(date_key, source_type, source_id) DO UPDATE SET status='doing', scheduled_at=excluded.scheduled_at, duration_minutes=excluded.duration_minutes, updated_at=excluded.updated_at\n    `).bind(dateKey, clean(name, 300), `workout-session:${id}`, now, plannedMinutes).run().catch(() => null);\n  }\n  await logAction(db, "workout.started", name, { workout_id: id || null, planned_minutes: plannedMinutes });\n  return lifePayload(`${name} is started. I’m tracking it as your active workout${profile?.workout?.samples >= 3 ? ` with a learned ${plannedMinutes}-minute target` : ""}.`, "workout_started", {\n    workout_session: { id: id || null, name, started_at: now, ended_at: null, planned_minutes: plannedMinutes },\n  });\n''', "adaptive workout start")
text = replace_once(text,
'''  await db.prepare(`UPDATE workout_sessions SET ended_at = ?2 WHERE id = ?1`).bind(Number(active.id), now).run();\n  const minutes = Math.max(1, Math.round((now - Number(active.started_at || now)) / 60));\n  await logAction(db, "workout.completed", active.name || "Workout", { workout_id: active.id, duration_minutes: minutes, message: clean(message, 300) });\n''',
'''  await db.prepare(`UPDATE workout_sessions SET ended_at = ?2 WHERE id = ?1`).bind(Number(active.id), now).run();\n  const minutes = Math.max(1, Math.round((now - Number(active.started_at || now)) / 60));\n  const linked = await db.prepare(`SELECT id, duration_minutes FROM daily_items WHERE source_type='workout' AND source_id=?1 ORDER BY id DESC LIMIT 1`).bind(`workout-session:${active.id}`).first().catch(() => null);\n  if (linked) {\n    await db.prepare(`UPDATE daily_items SET status='done', completed_at=?2, completion_source='ask_silk', updated_at=?2 WHERE id=?1`).bind(Number(linked.id), now).run();\n    if (Number(linked.duration_minutes) > 0) await recordDurationObservation(db, { category: "workout", context: active.name || "Workout", planned: Number(linked.duration_minutes), actual: minutes, occurredAt: now });\n  }\n  await logAction(db, "workout.completed", active.name || "Workout", { workout_id: active.id, duration_minutes: minutes, planned_minutes: linked?.duration_minutes || null, message: clean(message, 300) });\n''', "workout duration evidence")
life.write_text(text)

# Completion of actively-timed Study blocks can become duration evidence when answered reasonably close to the block.
completions = Path("worker/silk-completions.js")
text = completions.read_text()
if not text.startswith('import { recordDurationObservation }'):
    text = 'import { recordDurationObservation } from "./silk-time-engine.js";\n\n' + text
text = replace_once(text,
'''    const row = await db.prepare(`SELECT id, title, source_type, scheduled_at, duration_minutes FROM daily_items WHERE id = ?1`).bind(Number(pending.entity_id)).first();\n''',
'''    const row = await db.prepare(`SELECT id, title, source_type, status, scheduled_at, duration_minutes FROM daily_items WHERE id = ?1`).bind(Number(pending.entity_id)).first();\n''', "completion daily select")
text = replace_once(text,
'''    if (result === "completed") await syncDailyCompletionToModules(db, row, category, now);\n''',
'''    if (result === "completed") {\n      await syncDailyCompletionToModules(db, row, category, now);\n      const planned = Number(row.duration_minutes || 0);\n      const actual = row.scheduled_at ? Math.max(1, Math.round((now - Number(row.scheduled_at)) / 60)) : 0;\n      const reasonable = planned > 0 && actual >= 5 && actual <= Math.max(planned + 30, planned * 2);\n      if (row.status === "doing" && reasonable && ["study", "workout", "project"].includes(category)) {\n        await recordDurationObservation(db, { category, context: row.title, planned, actual, occurredAt: now });\n      }\n    }\n''', "completion duration evidence")
completions.write_text(text)

# Today consumes learned prep/travel, records route observations, and exposes a real prep timer.
today = Path("app/today-v2-bridge.tsx")
text = today.read_text()
profile_type = '''\ntype AdaptiveTimeProfile = {\n  prep_by_category: Record<string, { minutes: number; default_minutes: number; samples: number; confidence: string; learned: boolean }>;\n  travel_by_context: Array<{ context: string; minutes: number; samples: number; confidence: string }>;\n  study: { recommended_minutes: number; samples: number; preferred_start_hour: number | null };\n  workout: { recommended_minutes: number; samples: number; preferred_start_hour: number | null };\n  underestimation: { factor: number | null; samples: number; label: string };\n  active_prep?: { event_id: number; title: string; category: string; planned_minutes: number; started_at: number } | null;\n};\n\n'''
if "type AdaptiveTimeProfile" not in text:
    anchor = "const DEFAULT_PREP: Record<string, number> = {"
    if anchor not in text:
        raise SystemExit("Today profile type anchor not found")
    text = text.replace(anchor, profile_type + anchor, 1)
text = replace_once(text,
'''function planEvent(event: CalendarEvent, liveRoute?: RouteEstimate | null): EventPlan | null {\n  if (event.all_day || !event.start_at) return null;\n  const prepOverride = noteMinutes(event.notes, "prep");\n  const travelOverride = noteMinutes(event.notes, "travel");\n  const liveTravel = liveRoute?.eventId === event.id ? liveRoute.travel_minutes : null;\n  const prepMinutes = prepOverride ?? DEFAULT_PREP[event.category] ?? 10;\n  const travelMinutes = travelOverride ?? liveTravel ?? (event.location.trim() ? 30 : 0);\n  const leaveBy = event.start_at - travelMinutes * 60;\n  return {\n    prepMinutes,\n    travelMinutes,\n    leaveBy,\n    prepStart: leaveBy - prepMinutes * 60,\n    estimatedTravel: travelOverride === null && liveTravel === null && travelMinutes > 0,\n  };\n}\n''',
'''function planEvent(event: CalendarEvent, liveRoute?: RouteEstimate | null, profile?: AdaptiveTimeProfile | null): EventPlan | null {\n  if (event.all_day || !event.start_at) return null;\n  const prepOverride = noteMinutes(event.notes, "prep");\n  const travelOverride = noteMinutes(event.notes, "travel");\n  const liveTravel = liveRoute?.eventId === event.id ? liveRoute.travel_minutes : null;\n  const category = Object.prototype.hasOwnProperty.call(DEFAULT_PREP, event.category) ? event.category : "other";\n  const learnedPrep = profile?.prep_by_category?.[category];\n  const learnedTravel = event.location.trim()\n    ? profile?.travel_by_context?.find((item) => item.samples >= 2 && item.context.toLowerCase() === event.location.trim().toLowerCase())?.minutes ?? null\n    : null;\n  const prepMinutes = prepOverride ?? (learnedPrep?.learned ? learnedPrep.minutes : DEFAULT_PREP[category] ?? 10);\n  const travelMinutes = travelOverride ?? liveTravel ?? learnedTravel ?? (event.location.trim() ? 30 : 0);\n  const leaveBy = event.start_at - travelMinutes * 60;\n  return {\n    prepMinutes,\n    travelMinutes,\n    leaveBy,\n    prepStart: leaveBy - prepMinutes * 60,\n    estimatedTravel: travelOverride === null && liveTravel === null && learnedTravel === null && travelMinutes > 0,\n  };\n}\n''', "adaptive planEvent")
text = replace_once(text,
'''  const [completionSummary, setCompletionSummary] = useState<CompletionSummary | null>(null);\n  const [loading, setLoading] = useState(true);\n''',
'''  const [completionSummary, setCompletionSummary] = useState<CompletionSummary | null>(null);\n  const [timeProfile, setTimeProfile] = useState<AdaptiveTimeProfile | null>(null);\n  const [loading, setLoading] = useState(true);\n''', "Today profile state")
text = replace_once(text,
'''      const [calendarResponse, pendingResponse, completionResponse] = await Promise.all([\n        fetch(`/api/silk-calendar/events?${query}`, { credentials: "same-origin" }),\n        fetch("/api/completions/pending", { credentials: "same-origin" }),\n        fetch("/api/completions/summary", { credentials: "same-origin" }),\n      ]);\n''',
'''      const [calendarResponse, pendingResponse, completionResponse, timeResponse] = await Promise.all([\n        fetch(`/api/silk-calendar/events?${query}`, { credentials: "same-origin" }),\n        fetch("/api/completions/pending", { credentials: "same-origin" }),\n        fetch("/api/completions/summary", { credentials: "same-origin" }),\n        fetch("/api/time-engine/profile", { credentials: "same-origin" }),\n      ]);\n''', "Today load profile")
text = replace_once(text,
'''      if (completionResponse.ok) {\n        setCompletionSummary((await completionResponse.json().catch(() => null)) as CompletionSummary | null);\n      } else {\n        setCompletionSummary(null);\n      }\n''',
'''      if (completionResponse.ok) {\n        setCompletionSummary((await completionResponse.json().catch(() => null)) as CompletionSummary | null);\n      } else {\n        setCompletionSummary(null);\n      }\n\n      if (timeResponse.ok) {\n        setTimeProfile((await timeResponse.json().catch(() => null)) as AdaptiveTimeProfile | null);\n      } else {\n        setTimeProfile(null);\n      }\n''', "Today set profile")
text = text.replace('plan: planEvent(event, routeEstimate),', 'plan: planEvent(event, routeEstimate, timeProfile),')
text = text.replace('}, [data, routeEstimate, todayEvents]);', '}, [data, routeEstimate, timeProfile, todayEvents]);')
text = text.replace('const plan = planEvent(tomorrowFirst);', 'const plan = planEvent(tomorrowFirst, null, timeProfile);')
text = text.replace('}, [tomorrowFirst]);', '}, [timeProfile, tomorrowFirst]);', 1)
text = replace_once(text,
'''            setRouteEstimate({ ...payload, eventId: routeTarget.id });\n''',
'''            setRouteEstimate({ ...payload, eventId: routeTarget.id });\n            void fetch("/api/time-engine/observe", {\n              method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },\n              body: JSON.stringify({\n                kind: "travel_estimate",\n                category: routeTarget.category,\n                context_key: routeTarget.location,\n                actual_minutes: payload.travel_minutes,\n                metadata: { traffic_delay_minutes: payload.traffic?.delay_minutes || 0, provider: payload.traffic?.provider || payload.providers?.router || null },\n              }),\n            }).catch(() => undefined);\n''', "travel observation")
prep_handler_anchor = '''  const openView = useCallback((name: string) => findNavButton(name)?.click(), []);\n'''
prep_handler = '''  const togglePrepTracking = useCallback(async () => {\n    const entry = nextLogistics;\n    const event = entry?.calendarEvent;\n    const plan = entry?.plan;\n    if (!event || !plan || saving) return;\n    const tracking = timeProfile?.active_prep?.event_id === event.id;\n    setSaving(true);\n    setError("");\n    try {\n      const response = await fetch(`/api/time-engine/prep/${tracking ? "finish" : "start"}`, {\n        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ event_id: event.id, title: event.title, category: event.category, planned_minutes: plan.prepMinutes }),\n      });\n      const payload = await response.json().catch(() => ({})) as { error?: string; profile?: AdaptiveTimeProfile };\n      if (!response.ok) throw new Error(payload.error || "SILK could not update the prep timer.");\n      if (payload.profile) setTimeProfile(payload.profile);\n      await load();\n    } catch (prepError) {\n      setError(prepError instanceof Error ? prepError.message : "SILK could not update the prep timer.");\n    } finally {\n      setSaving(false);\n    }\n  }, [load, nextLogistics, saving, timeProfile]);\n\n'''
if "const togglePrepTracking" not in text:
    if prep_handler_anchor not in text:
        raise SystemExit("Prep handler anchor not found")
    text = text.replace(prep_handler_anchor, prep_handler + prep_handler_anchor, 1)
text = replace_once(text,
'''              <small>Prep at {clock(nextLogistics.plan.prepStart)}{nextLogistics.plan.travelMinutes ? ` · leave by ${clock(nextLogistics.plan.leaveBy)} · ${nextLogistics.plan.estimatedTravel ? "estimated " : ""}${nextLogistics.plan.travelMinutes}m travel` : " · no travel buffer"}{nextLogistics.calendarEvent?.location ? ` · ${nextLogistics.calendarEvent.location}` : ""}</small>\n            </div>}\n''',
'''              <small>Prep at {clock(nextLogistics.plan.prepStart)}{nextLogistics.plan.travelMinutes ? ` · leave by ${clock(nextLogistics.plan.leaveBy)} · ${nextLogistics.plan.estimatedTravel ? "estimated " : ""}${nextLogistics.plan.travelMinutes}m travel` : " · no travel buffer"}{nextLogistics.calendarEvent?.location ? ` · ${nextLogistics.calendarEvent.location}` : ""}</small>\n              {nextLogistics.calendarEvent && <button className={styles.routeButton} onClick={() => void togglePrepTracking()} disabled={saving}>{timeProfile?.active_prep?.event_id === nextLogistics.calendarEvent.id ? "Ready · stop prep timer" : "Start prep timer"}</button>}\n            </div>}\n            {timeProfile && <div className={styles.engineRow}>\n              <span>Learned behavior</span>\n              <strong>{timeProfile.underestimation.factor ? `${timeProfile.underestimation.factor.toFixed(2)}× planning factor` : "Still learning your planning accuracy"}</strong>\n              <small>Study target {timeProfile.study.recommended_minutes}m · workout target {timeProfile.workout.recommended_minutes}m · {timeProfile.underestimation.label}</small>\n            </div>}\n''', "Today prep UI")
text = text.replace('Travel falls back to 30 min when a Calendar event has a location but no live route is active. Add <code>travel:45</code> or <code>prep:20</code> to event notes for an explicit override.', 'SILK now prefers explicit note overrides, then live routes, then learned recurring travel/prep patterns, and only then its safe defaults. Add <code>travel:45</code> or <code>prep:20</code> to keep an explicit value authoritative.')
today.write_text(text)

# Proactive signal tests need the planning helper exported.
proactive = Path("worker/silk-proactive.js")
text = proactive.read_text()
text = text.replace('const plan = eventPlan(next, profile);', 'const plan = adaptiveEventPlan(next, profile);')
text = text.replace('const plan = eventPlan(event, profile);', 'const plan = adaptiveEventPlan(event, profile);')
text = text.replace('function eventPlan(event, profile) {', 'export function adaptiveEventPlan(event, profile) {')
proactive.write_text(text)

# Momentum exposes screensaver settings rather than hiding them in localStorage.
momentum = Path("app/momentum-bridge.tsx")
text = momentum.read_text()
text = replace_once(text,
'''  const [notifications, setNotifications] = useState("off");\n''',
'''  const [notifications, setNotifications] = useState("off");\n  const [screensaverEnabled, setScreensaverEnabled] = useState(true);\n  const [screensaverDelay, setScreensaverDelay] = useState(3);\n''', "Momentum screensaver state")
text = replace_once(text,
'''    const enabled = window.localStorage.getItem("silk_proactive_enabled") === "true";\n    const permission = "Notification" in window ? Notification.permission : "unsupported";\n    setNotifications(enabled && permission === "granted" ? "on" : permission);\n''',
'''    const enabled = window.localStorage.getItem("silk_proactive_enabled") === "true";\n    const permission = "Notification" in window ? Notification.permission : "unsupported";\n    setNotifications(enabled && permission === "granted" ? "on" : permission);\n    setScreensaverEnabled(window.localStorage.getItem("silk_screensaver_enabled") !== "false");\n    setScreensaverDelay(Math.max(1, Math.min(30, Number(window.localStorage.getItem("silk_screensaver_delay_minutes") || 3))));\n''', "Momentum settings load")
insert = '''\n        <article className={`${styles.card} ${styles.proactiveCard}`}>\n          <div className={styles.cardHead}><div><span>AMBIENT SILK</span><h2>3D Inspiration Screensaver</h2></div><Sparkles size={18} /></div>\n          <p>Idle SILK becomes a quiet 3D monument to human achievement, then returns to the exact screen you left.</p>\n          <div className={styles.proactiveRow}>\n            <div><span>Idle activation</span><strong>{screensaverEnabled ? `On · ${screensaverDelay} min` : "Off"}</strong></div>\n            <div className={styles.heroActions}>\n              <button onClick={() => { const next = !screensaverEnabled; setScreensaverEnabled(next); window.localStorage.setItem("silk_screensaver_enabled", String(next)); }}>{screensaverEnabled ? "Disable" : "Enable"}</button>\n              <button onClick={() => { const next = screensaverDelay >= 10 ? 1 : screensaverDelay + 1; setScreensaverDelay(next); window.localStorage.setItem("silk_screensaver_delay_minutes", String(next)); }}>Delay {screensaverDelay}m</button>\n              <button onClick={() => window.dispatchEvent(new Event("silk-inspiration-open"))}>Launch now</button>\n            </div>\n          </div>\n          <small className={styles.note}>It will not activate while you are typing, editing a field, or handling a modal/approval. Reduced-motion devices get the static fallback.</small>\n        </article>\n'''
anchor = '''      </section>\n    </div>,\n    target,\n'''
if "AMBIENT SILK" not in text:
    if anchor not in text:
        raise SystemExit("Momentum ambient card anchor not found")
    text = text.replace(anchor, insert + '''      </section>\n    </div>,\n    target,\n''', 1)
momentum.write_text(text)

# Permanent regression tests.
Path("tests/time-engine.test.mjs").write_text('''import test from "node:test";\nimport assert from "node:assert/strict";\nimport { robustMinutes, sampleConfidence } from "../worker/silk-time-engine.js";\nimport { adaptiveEventPlan } from "../worker/silk-proactive.js";\n\ntest("adaptive timing uses robust measured minutes", () => {\n  assert.equal(robustMinutes([28, 30, 31, 32, 120], 30), 31);\n  assert.equal(sampleConfidence(1), "learning");\n  assert.equal(sampleConfidence(4), "useful");\n  assert.equal(sampleConfidence(9), "strong");\n});\n\ntest("explicit Calendar timing overrides learned timing", () => {\n  const event = { start_at: 200000, category: "work", location: "Hospital", notes: "prep:20 travel:45" };\n  const profile = {\n    prep_by_category: { work: { minutes: 38, learned: true } },\n    travel_by_context: [{ context: "Hospital", minutes: 27, samples: 8 }],\n  };\n  const plan = adaptiveEventPlan(event, profile);\n  assert.equal(plan.prepMinutes, 20);\n  assert.equal(plan.travelMinutes, 45);\n  assert.equal(plan.leaveBy, 200000 - 45 * 60);\n});\n\ntest("learned timing beats safe defaults when evidence exists", () => {\n  const event = { start_at: 200000, category: "work", location: "Hospital", notes: "" };\n  const profile = {\n    prep_by_category: { work: { minutes: 38, learned: true } },\n    travel_by_context: [{ context: "Hospital", minutes: 27, samples: 4 }],\n  };\n  const plan = adaptiveEventPlan(event, profile);\n  assert.equal(plan.prepMinutes, 38);\n  assert.equal(plan.travelMinutes, 27);\n});\n''')

# Mark the screensaver concept as implemented rather than stale "do not build" guidance.
doc = Path("HIGH-PRIORITY-3D-INSPIRATION-SCREENSAVER.md")
text = doc.read_text()
text = text.replace("**HIGH PRIORITY**\n\nThis feature should be treated as one of SILK's major ambient / identity experiences after the core Home and Today systems are stable.\n\nDo **not** implement yet. This document records the approved concept so it is not lost.", "**IMPLEMENTED — V1**\n\nThe initial ambient experience is now implemented after the Home / Today foundation stabilized. Continue treating quality, performance, quote provenance, and licensing as high-priority constraints for future expansion.")
text = text.replace("**Approved concept. HIGH PRIORITY. Do not build yet.**", "**Implemented in V1. Continue iterating deliberately.**")
if "## V1 implementation status" not in text:
    text += '''\n\n---\n\n## V1 implementation status\n\nBuilt in October 2026:\n\n- idle activation with configurable delay and disable control\n- exact-state return via non-destructive overlay\n- 3D / perspective Greatness Poster using original abstract figure monuments\n- verified-source quote slideshow\n- mixed collection spanning science, computing, education, leadership, athletics, and spaceflight\n- reduced-motion fallback\n- typing / modal / approval suppression\n- manual **Inspire me** launch from Momentum\n- no third-party portrait assets in V1, avoiding unverified licensing dependencies\n\nFuture versions can add licensed or original generated visual likenesses, more collections, favorites, biography drill-down, and richer WebGL depth if performance testing supports it.\n'''
doc.write_text(text)
