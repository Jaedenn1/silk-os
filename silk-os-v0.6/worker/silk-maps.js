const DEFAULT_GEOCODER = "https://photon.komoot.io";
const DEFAULT_ROUTER = "https://valhalla1.openstreetmap.de";
const DEFAULT_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const TOMTOM_ROUTER = "https://api.tomtom.com/maps/orbis/routing/routes/calculate";
const TOMTOM_FREE_HARD_CAP = 15000;
const CACHE_TABLE = "silk_map_cache";
const USAGE_TABLE = "silk_map_provider_usage";
let schemaPromise = null;

export async function handleSilkMaps(request, env) {
  await ensureSchema(env.DB);
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/maps/config") {
    const trafficUsage = await readTomTomUsage(env.DB);
    return json({
      map_style_url: cleanBase(env.MAPS_TILE_STYLE_URL || DEFAULT_MAP_STYLE),
      providers: {
        tiles: env.MAPS_TILE_STYLE_URL ? "custom" : "OpenFreeMap / OpenStreetMap",
        geocoder: env.MAPS_GEOCODER_URL ? "custom" : "Photon / OpenStreetMap",
        router: env.MAPS_ROUTER_URL ? "custom" : "Valhalla / OpenStreetMap",
        traffic: env.TOMTOM_API_KEY ? "TomTom live traffic" : "not configured",
      },
      zero_cost_guard: {
        enabled: true,
        tomtom_monthly_hard_cap: TOMTOM_FREE_HARD_CAP,
        tomtom_requests_this_month: trafficUsage,
        behavior_at_cap: "fall back to Valhalla; never continue into paid usage",
      },
    });
  }

  if (request.method === "POST" && url.pathname === "/api/maps/route") {
    return routeRequest(request, env);
  }

  return json({ error: "Maps route not found." }, 404);
}

async function routeRequest(request, env) {
  const body = await readBody(request);
  const origin = normalizePoint(body.origin);
  const destinationText = cleanText(body.destination, 500);
  const mode = normalizeMode(body.mode);

  if (!origin) throw new MapsError(400, "A valid current location is required.");
  if (!destinationText) throw new MapsError(400, "A destination is required.");

  const destination = await geocode(destinationText, origin, env);
  if (!destination) throw new MapsError(404, `SILK could not locate “${destinationText}”.`);

  const route = await routeBetween(origin, destination, mode, env);
  return json({
    origin,
    destination: {
      lat: destination.lat,
      lon: destination.lon,
      label: destination.label,
      query: destinationText,
    },
    mode,
    travel_minutes: Math.max(1, Math.ceil(route.seconds / 60)),
    travel_seconds: route.seconds,
    distance_km: route.distanceKm,
    geometry: route.geometry,
    traffic: {
      live: Boolean(route.trafficAware),
      delay_minutes: Math.max(0, Math.ceil(Number(route.trafficDelaySeconds || 0) / 60)),
      delay_seconds: Math.max(0, Number(route.trafficDelaySeconds || 0)),
      affected_km: Math.max(0, Number(route.trafficLengthKm || 0)),
      provider: route.trafficAware ? "TomTom" : null,
    },
    map_style_url: cleanBase(env.MAPS_TILE_STYLE_URL || DEFAULT_MAP_STYLE),
    providers: {
      geocoder: env.MAPS_GEOCODER_URL ? "custom" : "Photon",
      router: route.provider,
      map: env.MAPS_TILE_STYLE_URL ? "custom" : "OpenFreeMap",
    },
    zero_cost_guard: {
      enabled: true,
      tomtom_monthly_hard_cap: TOMTOM_FREE_HARD_CAP,
      tomtom_requests_this_month: route.tomtomUsage ?? await readTomTomUsage(env.DB),
      paid_fallback_allowed: false,
    },
    cached: Boolean(route.cached),
    estimate: !route.trafficAware,
  });
}

async function geocode(query, origin, env) {
  const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
  const key = `geo:v1:${normalized}`;
  const cached = await readCache(env.DB, key);
  if (cached) return cached;

  const base = cleanBase(env.MAPS_GEOCODER_URL || DEFAULT_GEOCODER);
  const url = new URL(`${base}/api`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  url.searchParams.set("lang", "en");
  url.searchParams.set("lat", String(origin.lat));
  url.searchParams.set("lon", String(origin.lon));
  url.searchParams.set("zoom", "12");

  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Client-Id": "silk-os",
    },
  }, 8000);
  if (!response.ok) throw new MapsError(502, `Geocoding provider returned ${response.status}.`);

  const payload = await response.json();
  const feature = Array.isArray(payload?.features) ? payload.features[0] : null;
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!validLatLon(lat, lon)) return null;

  const properties = feature?.properties || {};
  const label = [
    properties.name || properties.street || query,
    properties.city || properties.locality,
    properties.state,
    properties.country,
  ].filter(Boolean).filter((value, index, array) => array.indexOf(value) === index).join(", ");

  const result = { lat, lon, label: label || query };
  await writeCache(env.DB, key, result, 30 * 86400);
  return result;
}

async function routeBetween(origin, destination, mode, env) {
  if (mode === "auto" && env.TOMTOM_API_KEY) {
    try {
      const trafficRoute = await routeTomTom(origin, destination, env);
      if (trafficRoute) return trafficRoute;
    } catch (error) {
      console.warn("SILK live traffic route unavailable; falling back to Valhalla", error);
    }
  }

  return routeValhalla(origin, destination, mode, env);
}

async function routeTomTom(origin, destination, env) {
  const rounded = (value) => Number(value).toFixed(4);
  const key = [
    "route:tomtom-live:v1",
    rounded(origin.lat),
    rounded(origin.lon),
    rounded(destination.lat),
    rounded(destination.lon),
  ].join(":");

  const cached = await readCache(env.DB, key);
  if (cached) return { ...cached, cached: true, tomtomUsage: await readTomTomUsage(env.DB) };

  const budget = await consumeTomTomRequestBudget(env.DB);
  if (!budget.allowed) return null;

  const response = await fetchWithTimeout(`${TOMTOM_ROUTER}?apiVersion=3`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "TomTom-Api-Version": "3",
      "TomTom-Api-Key": String(env.TOMTOM_API_KEY),
      Attributes: "routes",
    },
    body: JSON.stringify({
      routePlanningLocations: {
        origin: { type: "Point", coordinates: [origin.lon, origin.lat] },
        destination: { type: "Point", coordinates: [destination.lon, destination.lat] },
      },
      departureDateTime: "now",
      travelMode: "car",
      routeType: "fast",
      traffic: "live",
      maxPathAlternativeRoutes: 0,
    }),
  }, 10000);

  if (!response.ok) throw new MapsError(502, `Live traffic provider returned ${response.status}.`);
  const payload = await response.json();
  const route = Array.isArray(payload?.routes) ? payload.routes[0] : null;
  const summary = route?.summary;
  const seconds = Number(summary?.travelDurationInSeconds);
  const distanceMeters = Number(summary?.lengthInMeters);
  if (!route || !Number.isFinite(seconds) || seconds <= 0) {
    throw new MapsError(502, "The live traffic provider did not return a usable travel time.");
  }

  const coordinates = [];
  for (const leg of Array.isArray(route.legs) ? route.legs : []) {
    const legCoordinates = leg?.path?.coordinates;
    if (!Array.isArray(legCoordinates)) continue;
    for (const coordinate of legCoordinates) {
      if (!Array.isArray(coordinate) || coordinate.length < 2) continue;
      const normalized = [Number(coordinate[0]), Number(coordinate[1])];
      const previous = coordinates[coordinates.length - 1];
      if (!previous || previous[0] !== normalized[0] || previous[1] !== normalized[1]) coordinates.push(normalized);
    }
  }

  const result = {
    seconds,
    distanceKm: Number.isFinite(distanceMeters) ? distanceMeters / 1000 : 0,
    geometry: coordinates.length >= 2 ? { type: "LineString", coordinates } : null,
    trafficAware: true,
    trafficDelaySeconds: Math.max(0, Number(summary?.trafficDelayDurationInSeconds || 0)),
    trafficLengthKm: Math.max(0, Number(summary?.trafficLengthInMeters || 0) / 1000),
    provider: "TomTom live traffic",
  };

  await writeCache(env.DB, key, result, 5 * 60);
  return { ...result, cached: false, tomtomUsage: budget.count };
}

async function routeValhalla(origin, destination, mode, env) {
  const rounded = (value) => Number(value).toFixed(4);
  const key = [
    "route:valhalla:v2",
    mode,
    rounded(origin.lat),
    rounded(origin.lon),
    rounded(destination.lat),
    rounded(destination.lon),
  ].join(":");

  const cached = await readCache(env.DB, key);
  if (cached) return { ...cached, cached: true };

  const base = cleanBase(env.MAPS_ROUTER_URL || DEFAULT_ROUTER);
  const response = await fetchWithTimeout(`${base}/route`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Client-Id": "silk-os",
    },
    body: JSON.stringify({
      locations: [
        { lat: origin.lat, lon: origin.lon, type: "break" },
        { lat: destination.lat, lon: destination.lon, type: "break" },
      ],
      costing: mode,
      units: "kilometers",
      directions_options: { units: "kilometers", language: "en-US" },
    }),
  }, 10000);

  if (response.status === 429) throw new MapsError(429, "The open routing service is temporarily rate-limited. SILK will keep its fallback travel estimate.");
  if (!response.ok) throw new MapsError(502, `Routing provider returned ${response.status}.`);

  const payload = await response.json();
  const summary = payload?.trip?.summary;
  const seconds = Number(summary?.time);
  const distanceKm = Number(summary?.length);
  const shape = payload?.trip?.legs?.[0]?.shape;
  if (!Number.isFinite(seconds) || seconds <= 0) throw new MapsError(502, "The routing provider did not return a usable travel time.");

  const result = {
    seconds,
    distanceKm: Number.isFinite(distanceKm) ? distanceKm : 0,
    geometry: typeof shape === "string" && shape
      ? { type: "LineString", coordinates: decodePolyline6(shape) }
      : null,
    trafficAware: false,
    trafficDelaySeconds: 0,
    trafficLengthKm: 0,
    provider: env.MAPS_ROUTER_URL ? "custom" : "Valhalla",
  };

  await writeCache(env.DB, key, result, 15 * 60);
  return { ...result, cached: false };
}

function decodePolyline6(encoded) {
  let index = 0;
  let lat = 0;
  let lon = 0;
  const coordinates = [];

  while (index < encoded.length) {
    const latitude = decodeChunk(encoded, index);
    index = latitude.index;
    const longitude = decodeChunk(encoded, index);
    index = longitude.index;
    lat += latitude.delta;
    lon += longitude.delta;
    coordinates.push([lon / 1e6, lat / 1e6]);
  }

  return coordinates;
}

function decodeChunk(encoded, start) {
  let result = 0;
  let shift = 0;
  let index = start;
  let byte = 0;
  do {
    if (index >= encoded.length) return { delta: 0, index };
    byte = encoded.charCodeAt(index++) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);
  const delta = (result & 1) ? ~(result >> 1) : (result >> 1);
  return { delta, index };
}

async function ensureSchema(db) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS ${CACHE_TABLE} (
          cache_key TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )
      `).run();
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS ${USAGE_TABLE} (
          provider TEXT NOT NULL,
          month_key TEXT NOT NULL,
          request_count INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (provider, month_key)
        )
      `).run();
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

function monthKey() {
  return new Date().toISOString().slice(0, 7);
}

async function readTomTomUsage(db) {
  const row = await db.prepare(`SELECT request_count FROM ${USAGE_TABLE} WHERE provider = 'tomtom' AND month_key = ?1 LIMIT 1`)
    .bind(monthKey()).first();
  return Math.max(0, Number(row?.request_count || 0));
}

async function consumeTomTomRequestBudget(db) {
  const current = await readTomTomUsage(db);
  if (current >= TOMTOM_FREE_HARD_CAP) return { allowed: false, count: current };
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`
    INSERT INTO ${USAGE_TABLE} (provider, month_key, request_count, updated_at)
    VALUES ('tomtom', ?1, 1, ?2)
    ON CONFLICT(provider, month_key) DO UPDATE SET request_count = request_count + 1, updated_at = excluded.updated_at
  `).bind(monthKey(), now).run();
  return { allowed: true, count: current + 1 };
}

async function readCache(db, key) {
  const now = Math.floor(Date.now() / 1000);
  const row = await db.prepare(`SELECT payload, expires_at FROM ${CACHE_TABLE} WHERE cache_key = ?1 LIMIT 1`).bind(key).first();
  if (!row) return null;
  if (Number(row.expires_at || 0) <= now) {
    await db.prepare(`DELETE FROM ${CACHE_TABLE} WHERE cache_key = ?1`).bind(key).run();
    return null;
  }
  try {
    return JSON.parse(String(row.payload || "null"));
  } catch {
    await db.prepare(`DELETE FROM ${CACHE_TABLE} WHERE cache_key = ?1`).bind(key).run();
    return null;
  }
}

async function writeCache(db, key, payload, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const expires = now + ttlSeconds;
  await db.prepare(`
    INSERT INTO ${CACHE_TABLE} (cache_key, payload, expires_at, created_at)
    VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at, created_at = excluded.created_at
  `).bind(key, JSON.stringify(payload), expires, now).run();
}

function normalizePoint(value) {
  const lat = Number(value?.lat);
  const lon = Number(value?.lon ?? value?.lng);
  return validLatLon(lat, lon) ? { lat, lon } : null;
}

function validLatLon(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function normalizeMode(value) {
  const mode = String(value || "auto").toLowerCase();
  if (["auto", "pedestrian", "bicycle"].includes(mode)) return mode;
  return "auto";
}

function cleanBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function readBody(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 10000) throw new MapsError(413, "Maps request is too large.");
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
    return body;
  } catch {
    throw new MapsError(400, "Maps request must be valid JSON.");
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new MapsError(504, "The maps provider timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function mapsErrorResponse(error) {
  if (error instanceof MapsError) return json({ error: error.message }, error.status);
  console.error("SILK maps error", error);
  return json({ error: "SILK maps could not complete that request." }, 500);
}

class MapsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
