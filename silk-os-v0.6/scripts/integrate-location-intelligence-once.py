from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"{label} anchor not found")
    return text.replace(old, new, 1)

# Worker shell routing -------------------------------------------------------
path = Path("worker/index.ts")
text = path.read_text()
text = replace_once(
    text,
    'import { handleSilkProactive, proactiveErrorResponse } from "./silk-proactive.js";\n',
    'import { handleSilkProactive, proactiveErrorResponse } from "./silk-proactive.js";\nimport { handleSilkLocations, locationErrorResponse } from "./silk-locations.js";\n',
    "location import",
)
location_route = '''    if (url.pathname.startsWith("/api/locations/")) {
      if (!(await ownerSessionIsAuthenticated(request, env, ctx))) {
        return withSecurityHeaders(new Response(JSON.stringify({ error: "Unlock SILK before using Location Intelligence." }), {
          status: 401,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        }));
      }
      try {
        return withSecurityHeaders(await handleSilkLocations(request, env));
      } catch (error) {
        return withSecurityHeaders(locationErrorResponse(error));
      }
    }

'''
text = replace_once(text, '    if (url.pathname.startsWith("/api/maps/")) {\n', location_route + '    if (url.pathname.startsWith("/api/maps/")) {\n', "location route")
path.write_text(text)

# Location duplicate guard --------------------------------------------------
path = Path("worker/silk-locations.js")
text = path.read_text()
create_anchor = '''    const input = normalizePlaceInput(body, true);
    const now = Math.floor(Date.now() / 1000);
    const result = await env.DB.prepare(`
'''
create_new = '''    const input = normalizePlaceInput(body, true);
    const duplicate = await env.DB.prepare(`SELECT id FROM ${PLACE_TABLE} WHERE is_active=1 AND lower(name)=lower(?1) LIMIT 1`).bind(input.name).first();
    if (duplicate) throw new LocationError(409, `A saved place named “${input.name}” already exists.`);
    const now = Math.floor(Date.now() / 1000);
    const result = await env.DB.prepare(`
'''
text = replace_once(text, create_anchor, create_new, "duplicate place guard")
path.write_text(text)

# Maps recognizes semantic origin + destination -----------------------------
path = Path("worker/silk-maps.js")
text = path.read_text()
if not text.startswith('import { resolvePlaceContext } from "./silk-locations.js";'):
    text = 'import { resolvePlaceContext } from "./silk-locations.js";\n\n' + text
route_anchor = '''  const route = await routeBetween(origin, destination, mode, env);
  return json({
'''
route_new = '''  const route = await routeBetween(origin, destination, mode, env);
  const [originPlace, destinationPlace] = await Promise.all([
    resolvePlaceContext(env.DB, { lat: origin.lat, lon: origin.lon }).catch(() => null),
    resolvePlaceContext(env.DB, { lat: destination.lat, lon: destination.lon, text: destinationText }).catch(() => null),
  ]);
  return json({
'''
text = replace_once(text, route_anchor, route_new, "map place resolution")
destination_anchor = '''    destination: {
      lat: destination.lat,
      lon: destination.lon,
      label: destination.label,
      query: destinationText,
    },
    mode,
'''
destination_new = '''    destination: {
      lat: destination.lat,
      lon: destination.lon,
      label: destination.label,
      query: destinationText,
    },
    context: {
      origin: originPlace?.name || "Current location",
      destination: destinationPlace?.name || destinationText,
      origin_place_id: originPlace?.id || null,
      destination_place_id: destinationPlace?.id || null,
      origin_kind: originPlace?.kind || null,
      destination_kind: destinationPlace?.kind || null,
    },
    mode,
'''
text = replace_once(text, destination_anchor, destination_new, "map semantic context output")
path.write_text(text)

# Time Engine canonicalizes old/raw observations to saved place names -------
path = Path("worker/silk-time-engine.js")
text = path.read_text()
import_anchor = '''} from "./silk-time-engine-v2.js";

'''
import_new = '''} from "./silk-time-engine-v2.js";
import { listLocationPlaces, matchPlaceByText } from "./silk-locations.js";

'''
text = replace_once(text, import_anchor, import_new, "time engine location import")
obs_anchor = '''  `).bind(since).all()).results || [];

  const prepByCategory = {};
'''
obs_new = '''  `).bind(since).all()).results || [];
  const places = await listLocationPlaces(db).catch(() => []);
  const semanticContext = (value) => matchPlaceByText(places, String(value || ""))?.name || clean(value, 180);

  const prepByCategory = {};
'''
text = replace_once(text, obs_anchor, obs_new, "load saved places")
text = replace_once(
    text,
    '.map((row) => ({ context: String(row.context_key), actual: Number(row.actual_minutes), occurredAt: Number(row.occurred_at || 0) })),',
    '.map((row) => ({ context: semanticContext(row.context_key), actual: Number(row.actual_minutes), occurredAt: Number(row.occurred_at || 0) })),',
    "canonical prep contexts",
)
travel_anchor = '''  const travelRows = observations
    .filter((row) => row.kind === "travel_estimate" && row.context_key)
    .map((row) => ({
      context: String(row.context_key),
      actual: Number(row.actual_minutes),
      occurredAt: Number(row.occurred_at || 0),
      metadata: parseMetadata(row.metadata_json),
    }));
'''
travel_new = '''  const travelRows = observations
    .filter((row) => row.kind === "travel_estimate" && row.context_key)
    .map((row) => {
      const metadata = parseMetadata(row.metadata_json);
      return {
        context: semanticContext(metadata.destination_context || row.context_key),
        actual: Number(row.actual_minutes),
        occurredAt: Number(row.occurred_at || 0),
        metadata: {
          ...metadata,
          origin_context: semanticContext(metadata.origin_context),
          destination_context: semanticContext(metadata.destination_context || row.context_key),
        },
      };
    });
'''
text = replace_once(text, travel_anchor, travel_new, "canonical travel contexts")
profile_anchor = '''  const profile = {
    version: 2,
    generated_at: now,
'''
profile_new = '''  const profile = {
    version: 2,
    generated_at: now,
    places: places.map((place) => ({
      id: place.id,
      name: place.name,
      kind: place.kind,
      address: place.address,
      radius_m: place.radius_m,
      aliases: place.aliases,
    })),
'''
text = replace_once(text, profile_anchor, profile_new, "places in timing profile")
path.write_text(text)

# V2 planner maps Calendar aliases to canonical saved places ----------------
path = Path("worker/silk-time-engine-v2.js")
text = path.read_text()
semantic_fn = '''export function semanticPlaceContext(profile, value) {
  const raw = cleanContext(value);
  const needle = normalizeSemanticText(raw);
  if (!needle) return raw;
  let partial = null;
  for (const place of profile?.places || []) {
    const variants = [place?.name, place?.address, ...(Array.isArray(place?.aliases) ? place.aliases : [])]
      .map((item) => ({ raw: cleanContext(item), normalized: normalizeSemanticText(item) }))
      .filter((item) => item.normalized);
    if (variants.some((item) => item.normalized === needle)) return cleanContext(place?.name) || raw;
    const longest = variants
      .filter((item) => item.normalized.length >= 5 && (needle.includes(item.normalized) || item.normalized.includes(needle)))
      .sort((a, b) => b.normalized.length - a.normalized.length)[0];
    if (longest && (!partial || longest.normalized.length > partial.score)) partial = { name: cleanContext(place?.name), score: longest.normalized.length };
  }
  return partial?.name || raw;
}

'''
text = replace_once(text, 'export function adaptiveEventPlanV2(event, profile, previousEvent = null) {\n', semantic_fn + 'export function adaptiveEventPlanV2(event, profile, previousEvent = null) {\n', "semantic context helper")
text = replace_once(
    text,
    '''  const location = cleanContext(event?.location);
  const title = cleanContext(event?.title);
''',
    '''  const rawLocation = cleanContext(event?.location);
  const location = semanticPlaceContext(profile, rawLocation);
  const title = cleanContext(event?.title);
''',
    "semantic destination",
)
text = replace_once(
    text,
    '  const originContext = cleanContext(previousEvent?.location);\n',
    '  const originContext = semanticPlaceContext(profile, previousEvent?.location);\n',
    "semantic origin",
)
text = replace_once(
    text,
    '''      from_location: String(previous.location || ""),
''',
    '''      from_location: semanticPlaceContext(profile, previous.location),
''',
    "transition origin name",
)
text = replace_once(
    text,
    '''      to_location: String(next.location || ""),
''',
    '''      to_location: semanticPlaceContext(profile, next.location),
''',
    "transition destination name",
)
normalize_anchor = '''function cleanContext(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 180) : "";
}
'''
normalize_new = '''function normalizeSemanticText(value) {
  return cleanContext(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function cleanContext(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 180) : "";
}
'''
text = replace_once(text, normalize_anchor, normalize_new, "semantic normalization")
path.write_text(text)

# Today consumes map semantic context and semantic routes -------------------
path = Path("app/today-v2-bridge.tsx")
text = path.read_text()
text = replace_once(
    text,
    '''  destination: { lat: number; lon: number; label: string; query: string };
  travel_minutes: number;
''',
    '''  destination: { lat: number; lon: number; label: string; query: string };
  context?: { origin: string; destination: string; origin_place_id: number | null; destination_place_id: number | null; origin_kind?: string | null; destination_kind?: string | null };
  travel_minutes: number;
''',
    "route context type",
)
text = replace_once(
    text,
    '''type AdaptiveTimeProfile = {
  version?: number;
''',
    '''type AdaptiveTimeProfile = {
  version?: number;
  places?: Array<{ id: number; name: string; kind: string; address?: string; radius_m?: number; aliases?: string[] }>;
''',
    "profile places type",
)
semantic_ts = '''function semanticPlaceContext(profile: AdaptiveTimeProfile | null | undefined, value: string) {
  const raw = String(value || "").trim();
  const normalize = (item: string) => String(item || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  const needle = normalize(raw);
  if (!needle) return raw;
  let partial: { name: string; score: number } | null = null;
  for (const place of profile?.places || []) {
    const variants = [place.name, place.address || "", ...(place.aliases || [])]
      .map((item) => ({ raw: item, normalized: normalize(item) }))
      .filter((item) => item.normalized);
    if (variants.some((item) => item.normalized === needle)) return place.name;
    const longest = variants.filter((item) => item.normalized.length >= 5 && (needle.includes(item.normalized) || item.normalized.includes(needle))).sort((a, b) => b.normalized.length - a.normalized.length)[0];
    if (longest && (!partial || longest.normalized.length > partial.score)) partial = { name: place.name, score: longest.normalized.length };
  }
  return partial?.name || raw;
}

'''
text = replace_once(text, 'function planEvent(event: CalendarEvent, liveRoute?: RouteEstimate | null, profile?: AdaptiveTimeProfile | null, previousEvent?: CalendarEvent | null): EventPlan | null {\n', semantic_ts + 'function planEvent(event: CalendarEvent, liveRoute?: RouteEstimate | null, profile?: AdaptiveTimeProfile | null, previousEvent?: CalendarEvent | null): EventPlan | null {\n', "today semantic helper")
text = replace_once(
    text,
    '''  const context = event.location.trim() || event.title.trim();
  const contextPrep = contextualMetric(profile?.prep_by_context, context, event.start_at);
''',
    '''  const context = semanticPlaceContext(profile, event.location.trim()) || event.title.trim();
  const contextPrep = contextualMetric(profile?.prep_by_context, context, event.start_at);
''',
    "today semantic prep context",
)
text = replace_once(
    text,
    '''  const routeKey = previousEvent?.location?.trim() && event.location.trim() ? `${previousEvent.location.trim()} → ${event.location.trim()}` : "";
''',
    '''  const originContext = semanticPlaceContext(profile, previousEvent?.location || "");
  const routeKey = originContext && context ? `${originContext} → ${context}` : "";
''',
    "today semantic route key",
)
observer_anchor = '''                category: routeTarget.category,
                context_key: routeTarget.location,
                actual_minutes: payload.travel_minutes,
                metadata: { traffic_delay_minutes: payload.traffic?.delay_minutes || 0, provider: payload.traffic?.provider || null },
'''
observer_new = '''                category: routeTarget.category,
                context_key: payload.context?.destination || routeTarget.location,
                actual_minutes: payload.travel_minutes,
                metadata: {
                  origin_context: payload.context?.origin || "",
                  destination_context: payload.context?.destination || routeTarget.location,
                  origin_place_id: payload.context?.origin_place_id || null,
                  destination_place_id: payload.context?.destination_place_id || null,
                  raw_destination: routeTarget.location,
                  traffic_delay_minutes: payload.traffic?.delay_minutes || 0,
                  provider: payload.traffic?.provider || null,
                },
'''
text = replace_once(text, observer_anchor, observer_new, "semantic route observation")
text = replace_once(
    text,
    '''<div className={styles.routeDestination}><MapPin size={13} /><div><strong>{routeTarget.title}</strong><small>{liveRoute.destination.label} · {liveRoute.traffic.live ?''',
    '''<div className={styles.routeDestination}><MapPin size={13} /><div><strong>{routeTarget.title}</strong><small>{liveRoute.context ? `${liveRoute.context.origin} → ${liveRoute.context.destination} · ` : ""}{liveRoute.destination.label} · {liveRoute.traffic.live ?''',
    "route semantic label",
)
path.write_text(text)

# Momentum Places manager ---------------------------------------------------
path = Path("app/momentum-bridge.tsx")
text = path.read_text()
text = replace_once(text, '  FolderKanban,\n  Sparkles,\n', '  FolderKanban,\n  MapPin,\n  Sparkles,\n  Trash2,\n', "momentum place icons")
place_type = '''type SavedPlace = {
  id: number;
  name: string;
  kind: string;
  address: string;
  lat: number;
  lon: number;
  radius_m: number;
  aliases: string[];
};

'''
text = replace_once(text, 'function pct(value: number | null | undefined) {\n', place_type + 'function pct(value: number | null | undefined) {\n', "saved place type")
states_anchor = '''  const [screensaverEnabled, setScreensaverEnabled] = useState(true);
  const [screensaverDelay, setScreensaverDelay] = useState(3);
'''
states_new = '''  const [screensaverEnabled, setScreensaverEnabled] = useState(true);
  const [screensaverDelay, setScreensaverDelay] = useState(3);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [placeName, setPlaceName] = useState("");
  const [placeKind, setPlaceKind] = useState("other");
  const [placeAliases, setPlaceAliases] = useState("");
  const [placeBusy, setPlaceBusy] = useState(false);
  const [placeMessage, setPlaceMessage] = useState("");
'''
text = replace_once(text, states_anchor, states_new, "place state")
load_anchor = '''      const [completionResponse, timeResponse] = await Promise.all([
        fetch("/api/completions/summary", { credentials: "same-origin" }),
        fetch("/api/time-engine/profile", { credentials: "same-origin" }),
      ]);
'''
load_new = '''      const [completionResponse, timeResponse, placesResponse] = await Promise.all([
        fetch("/api/completions/summary", { credentials: "same-origin" }),
        fetch("/api/time-engine/profile", { credentials: "same-origin" }),
        fetch("/api/locations/places", { credentials: "same-origin" }),
      ]);
'''
text = replace_once(text, load_anchor, load_new, "load places")
set_anchor = '''      if (timeResponse.ok) setProfile((await timeResponse.json()) as TimeProfile);
      else setProfile(null);
'''
set_new = '''      if (timeResponse.ok) setProfile((await timeResponse.json()) as TimeProfile);
      else setProfile(null);
      if (placesResponse.ok) {
        const payload = (await placesResponse.json().catch(() => ({}))) as { places?: SavedPlace[] };
        setPlaces(Array.isArray(payload.places) ? payload.places : []);
      } else setPlaces([]);
'''
text = replace_once(text, set_anchor, set_new, "set places")
callbacks_anchor = '''  const consistency = useMemo(() => {
'''
callbacks = '''  const saveCurrentPlace = useCallback(() => {
    const name = placeName.trim();
    if (!name || placeBusy) {
      if (!name) setPlaceMessage("Name the place first — Home, Gym, Hospital, etc.");
      return;
    }
    if (!navigator.geolocation) {
      setPlaceMessage("This browser does not expose device location.");
      return;
    }
    setPlaceBusy(true);
    setPlaceMessage("Reading your current location…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void (async () => {
          try {
            const response = await fetch("/api/locations/places", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name,
                kind: placeKind,
                aliases: placeAliases.split(",").map((item) => item.trim()).filter(Boolean),
                lat: position.coords.latitude,
                lon: position.coords.longitude,
                radius_m: 175,
              }),
            });
            const payload = (await response.json().catch(() => ({}))) as { error?: string; place?: SavedPlace };
            if (!response.ok) throw new Error(payload.error || "SILK could not save that place.");
            setPlaceName("");
            setPlaceAliases("");
            setPlaceKind("other");
            setPlaceMessage(`${payload.place?.name || name} is now a recognized SILK place.`);
            await load();
          } catch (saveError) {
            setPlaceMessage(saveError instanceof Error ? saveError.message : "SILK could not save that place.");
          } finally {
            setPlaceBusy(false);
          }
        })();
      },
      (locationError) => {
        setPlaceBusy(false);
        setPlaceMessage(locationError.code === 1 ? "Location permission was not granted." : "SILK could not read your current location.");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 2 * 60_000 },
    );
  }, [load, placeAliases, placeBusy, placeKind, placeName]);

  const deletePlace = useCallback(async (place: SavedPlace) => {
    if (placeBusy) return;
    setPlaceBusy(true);
    setPlaceMessage("");
    try {
      const response = await fetch(`/api/locations/places/${place.id}`, { method: "DELETE", credentials: "same-origin" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "SILK could not remove that place.");
      setPlaceMessage(`${place.name} removed from Location Intelligence.`);
      await load();
    } catch (deleteError) {
      setPlaceMessage(deleteError instanceof Error ? deleteError.message : "SILK could not remove that place.");
    } finally {
      setPlaceBusy(false);
    }
  }, [load, placeBusy]);

'''
text = replace_once(text, callbacks_anchor, callbacks + callbacks_anchor, "place callbacks")
places_card = '''        <article className={`${styles.card} ${styles.placesCard}`}>
          <div className={styles.cardHead}><div><span>LOCATION INTELLIGENCE</span><h2>Teach SILK the places in your life</h2></div><MapPin size={18} /></div>
          <p>Saved places turn anonymous coordinates and Calendar addresses into stable context like Home → Gym → Hospital, so route and prep learning stays attached to the right place.</p>
          <div className={styles.placeCapture}>
            <input value={placeName} onChange={(event) => setPlaceName(event.target.value)} placeholder="Place name · Home, Gym, Hospital" maxLength={80} />
            <select value={placeKind} onChange={(event) => setPlaceKind(event.target.value)}>
              <option value="home">Home</option><option value="work">Work</option><option value="gym">Gym</option><option value="school">School</option><option value="medical">Medical</option><option value="family">Family</option><option value="other">Other</option>
            </select>
            <input value={placeAliases} onChange={(event) => setPlaceAliases(event.target.value)} placeholder="Aliases · optional, comma separated" maxLength={220} />
            <button onClick={saveCurrentPlace} disabled={placeBusy || !placeName.trim()}><MapPin size={14} /> {placeBusy ? "Saving…" : "Save current location"}</button>
          </div>
          {placeMessage && <small className={styles.placeMessage}>{placeMessage}</small>}
          <div className={styles.placeList}>
            {places.map((place) => <div key={place.id}><span className={styles.placeDot} /><div><strong>{place.name}</strong><small>{place.kind}{place.aliases.length ? ` · ${place.aliases.join(" · ")}` : ""} · {place.radius_m}m recognition radius</small></div><button aria-label={`Remove ${place.name}`} onClick={() => void deletePlace(place)} disabled={placeBusy}><Trash2 size={13} /></button></div>)}
            {!places.length && <p className={styles.empty}>No semantic places yet. Save one while you are physically there.</p>}
          </div>
          <small className={styles.note}>Precise coordinates are stored in SILK’s authenticated database, not committed to GitHub. Location is requested only when you press Save current location or use route calculation.</small>
        </article>

'''
text = replace_once(text, '        <article className={`${styles.card} ${styles.proactiveCard}`}>\n          <div className={styles.cardHead}><div><span>PROACTIVE SILK</span>', places_card + '        <article className={`${styles.card} ${styles.proactiveCard}`}>\n          <div className={styles.cardHead}><div><span>PROACTIVE SILK</span>', "places card")
path.write_text(text)

# Momentum styling ----------------------------------------------------------
path = Path("app/momentum-bridge.module.css")
text = path.read_text()
if ".placesCard{" not in text:
    addition = '''.placesCard{grid-column:1/-1}.placesCard>p{color:#918d9c;line-height:1.55;font-size:13px;margin:0 0 14px}.placeCapture{display:grid;grid-template-columns:1.15fr .65fr 1.2fr auto;gap:8px}.placeCapture input,.placeCapture select{min-width:0;border:1px solid rgba(181,174,206,.12);background:rgba(11,12,18,.78);color:#eeeaf5;border-radius:10px;padding:10px 11px;outline:none}.placeCapture input:focus,.placeCapture select:focus{border-color:rgba(158,137,255,.38);box-shadow:0 0 0 3px rgba(122,102,214,.08)}.placeCapture button,.placeList button{border:1px solid rgba(184,176,218,.16);background:rgba(34,31,48,.72);color:#e9e5f2;border-radius:10px;padding:10px 12px;display:inline-flex;align-items:center;justify-content:center;gap:7px;font-weight:650;cursor:pointer}.placeCapture button:disabled,.placeList button:disabled{opacity:.5;cursor:default}.placeMessage{display:block;color:#9d93c5;margin:10px 0 0}.placeList{display:grid;gap:7px;margin-top:12px}.placeList>div{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;padding:10px 11px;border:1px solid rgba(181,174,206,.08);border-radius:11px;background:rgba(11,12,18,.62)}.placeDot{width:8px;height:8px;border-radius:999px;background:#9182ef;box-shadow:0 0 0 4px rgba(145,130,239,.07)}.placeList strong{display:block;font-size:12px}.placeList small{display:block;color:#74707f;font-size:10px;margin-top:3px;text-transform:capitalize}.placeList button{padding:7px 8px;color:#9b95a7}@media(max-width:980px){.placeCapture{grid-template-columns:1fr 1fr}.placeCapture button{grid-column:1/-1}}@media(max-width:620px){.placeCapture{grid-template-columns:1fr}.placeCapture button{grid-column:auto}}'''
    text += addition
path.write_text(text)
