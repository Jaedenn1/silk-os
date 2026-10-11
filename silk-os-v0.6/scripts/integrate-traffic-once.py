from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}, found {count}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "worker/index.ts",
    "  MAPS_TILE_STYLE_URL?: string;\n  GOOGLE_CLIENT_ID?: string;",
    "  MAPS_TILE_STYLE_URL?: string;\n  TOMTOM_API_KEY?: string;\n  GOOGLE_CLIENT_ID?: string;",
)

replace_once(
    "app/today-v2-bridge.tsx",
    '''  map_style_url: string;
  cached: boolean;
  estimate: boolean;
};''',
    '''  map_style_url: string;
  traffic: {
    live: boolean;
    delay_minutes: number;
    delay_seconds: number;
    affected_km: number;
    provider: string | null;
  };
  cached: boolean;
  estimate: boolean;
};''',
)

replace_once(
    "app/today-v2-bridge.tsx",
    '''          <div className={styles.cardHeading}><div><span>LIVE ROUTE</span><h2>Maps & travel time</h2></div><Navigation size={18} /></div>''',
    '''          <div className={styles.cardHeading}><div><span>LIVE TRAFFIC</span><h2>Maps, traffic & travel time</h2></div><Navigation size={18} /></div>''',
)

replace_once(
    "app/today-v2-bridge.tsx",
    '''            <div className={styles.routeFacts}>
              <div><span>Drive</span><strong>{liveRoute.travel_minutes} min</strong></div>
              <div><span>Distance</span><strong>{liveRoute.distance_km.toFixed(1)} km</strong></div>
              <div><span>Leave by</span><strong>{clock(routeTarget.start_at - liveRoute.travel_minutes * 60)}</strong></div>
            </div>''',
    '''            <div className={styles.routeFacts}>
              <div><span>Drive</span><strong>{liveRoute.travel_minutes} min</strong></div>
              <div><span>Traffic delay</span><strong>{liveRoute.traffic.live ? `+${liveRoute.traffic.delay_minutes} min` : "Fallback"}</strong></div>
              <div><span>Distance</span><strong>{liveRoute.distance_km.toFixed(1)} km</strong></div>
              <div><span>Leave by</span><strong>{clock(routeTarget.start_at - liveRoute.travel_minutes * 60)}</strong></div>
            </div>''',
)

replace_once(
    "app/today-v2-bridge.tsx",
    '''            <div className={styles.routeDestination}><MapPin size={13} /><div><strong>{routeTarget.title}</strong><small>{liveRoute.destination.label}</small></div></div>''',
    '''            <div className={styles.routeDestination}><MapPin size={13} /><div><strong>{routeTarget.title}</strong><small>{liveRoute.destination.label} · {liveRoute.traffic.live ? `live traffic${liveRoute.traffic.affected_km ? ` · ${liveRoute.traffic.affected_km.toFixed(1)} km affected` : ""}` : "open-route fallback · no live flow"}</small></div></div>''',
)

replace_once(
    "app/today-v2-bridge.tsx",
    '''            <small className={styles.routeAttribution}>OpenFreeMap · OpenStreetMap contributors · Photon · Valhalla</small>''',
    '''            <small className={styles.routeAttribution}>{liveRoute.traffic.live ? "TomTom live traffic · " : ""}OpenFreeMap · OpenStreetMap contributors · Photon · Valhalla fallback</small>''',
)

replace_once(
    "app/today-v2-bridge.tsx",
    '''            <p>Use your device location to replace SILK’s fallback travel buffer with a real OpenStreetMap route. Your precise position is requested only when you press the button.</p>''',
    '''            <p>Use your device location to calculate a real traffic-aware drive time. SILK uses its zero-cost traffic provider when configured and automatically falls back to the open route engine instead of spending money. Your precise position is requested only when you press the button.</p>''',
)

css = Path("app/today-v2.module.css")
text = css.read_text()
old = ".routeFacts{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}"
new = ".routeFacts{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}"
if text.count(old) != 1:
    raise SystemExit(f"Expected one routeFacts rule, found {text.count(old)}")
text = text.replace(old, new, 1)
old_mobile = "@media(max-width:760px){.routeLive{grid-template-columns:1fr}.routeLive>div:first-child{grid-row:auto}.routeFacts{grid-template-columns:repeat(3,1fr)}}"
if old_mobile in text:
    text = text.replace(old_mobile, "@media(max-width:760px){.routeLive{grid-template-columns:1fr}.routeLive>div:first-child{grid-row:auto}.routeFacts{grid-template-columns:repeat(2,1fr)}}", 1)
css.write_text(text)
