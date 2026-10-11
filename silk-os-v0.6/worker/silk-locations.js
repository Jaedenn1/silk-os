const PLACE_TABLE = "silk_places";
const ALLOWED_KINDS = new Set(["home", "work", "gym", "school", "medical", "family", "other"]);
let schemaPromise = null;

export async function handleSilkLocations(request, env) {
  await ensureSchema(env.DB);
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/locations/places") {
    return json({ places: await listLocationPlaces(env.DB) });
  }

  if (request.method === "POST" && url.pathname === "/api/locations/places") {
    const body = await readBody(request);
    const input = normalizePlaceInput(body, true);
    const now = Math.floor(Date.now() / 1000);
    const result = await env.DB.prepare(`
      INSERT INTO ${PLACE_TABLE}
        (name, kind, address, lat, lon, radius_m, aliases_json, is_active, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8)
    `).bind(input.name, input.kind, input.address, input.lat, input.lon, input.radius_m, JSON.stringify(input.aliases), now).run();
    const place = await getPlace(env.DB, Number(result?.meta?.last_row_id || 0));
    await logAction(env.DB, "location.place.created", place?.name || input.name, { id: place?.id, kind: input.kind });
    return json({ place }, 201);
  }

  const placeMatch = url.pathname.match(/^\/api\/locations\/places\/(\d+)$/);
  if (placeMatch && request.method === "PATCH") {
    const id = Number(placeMatch[1]);
    const current = await getPlace(env.DB, id);
    if (!current) throw new LocationError(404, "Saved place not found.");
    const body = await readBody(request);
    const input = normalizePlaceInput({ ...current, ...body }, true);
    await env.DB.prepare(`
      UPDATE ${PLACE_TABLE}
      SET name=?2, kind=?3, address=?4, lat=?5, lon=?6, radius_m=?7, aliases_json=?8, updated_at=unixepoch()
      WHERE id=?1
    `).bind(id, input.name, input.kind, input.address, input.lat, input.lon, input.radius_m, JSON.stringify(input.aliases)).run();
    const place = await getPlace(env.DB, id);
    await logAction(env.DB, "location.place.updated", place?.name || input.name, { id, kind: input.kind });
    return json({ place });
  }

  if (placeMatch && request.method === "DELETE") {
    const id = Number(placeMatch[1]);
    const current = await getPlace(env.DB, id);
    if (!current) throw new LocationError(404, "Saved place not found.");
    await env.DB.prepare(`DELETE FROM ${PLACE_TABLE} WHERE id=?1`).bind(id).run();
    await logAction(env.DB, "location.place.deleted", current.name, { id, kind: current.kind });
    return json({ deleted: true, id });
  }

  if (request.method === "POST" && url.pathname === "/api/locations/resolve") {
    const body = await readBody(request);
    const place = await resolvePlaceContext(env.DB, {
      lat: body?.lat,
      lon: body?.lon,
      text: body?.text,
    });
    return json({ place, context: place?.name || clean(body?.text, 180) || "Current location" });
  }

  return json({ error: "Location Intelligence route not found." }, 404);
}

export async function listLocationPlaces(db) {
  await ensureSchema(db);
  const rows = (await db.prepare(`
    SELECT id, name, kind, address, lat, lon, radius_m, aliases_json, is_active, created_at, updated_at
    FROM ${PLACE_TABLE}
    WHERE is_active=1
    ORDER BY CASE kind WHEN 'home' THEN 0 WHEN 'work' THEN 1 WHEN 'gym' THEN 2 ELSE 3 END, name COLLATE NOCASE
  `).all()).results || [];
  return rows.map(normalizePlaceRow);
}

export async function resolvePlaceContext(db, { lat = null, lon = null, text = "" } = {}) {
  const places = await listLocationPlaces(db);
  const byText = matchPlaceByText(places, text);
  if (byText) return byText;
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (validLatLon(latitude, longitude)) return nearestPlace(places, latitude, longitude);
  return null;
}

export function matchPlaceByText(places, text) {
  const needle = normalizeText(text);
  if (!needle) return null;
  const candidates = [];
  for (const place of places || []) {
    const values = [place.name, place.address, ...(Array.isArray(place.aliases) ? place.aliases : [])]
      .map(normalizeText)
      .filter(Boolean);
    if (values.some((value) => value === needle)) return place;
    const longest = values
      .filter((value) => value.length >= 5 && (needle.includes(value) || value.includes(needle)))
      .sort((a, b) => b.length - a.length)[0];
    if (longest) candidates.push({ place, score: longest.length });
  }
  return candidates.sort((a, b) => b.score - a.score)[0]?.place || null;
}

export function nearestPlace(places, lat, lon) {
  if (!validLatLon(Number(lat), Number(lon))) return null;
  let best = null;
  for (const place of places || []) {
    if (!validLatLon(Number(place.lat), Number(place.lon))) continue;
    const distance = haversineMeters(Number(lat), Number(lon), Number(place.lat), Number(place.lon));
    const radius = clampRadius(place.radius_m);
    if (distance > radius) continue;
    if (!best || distance < best.distance_m) best = { ...place, distance_m: Math.round(distance) };
  }
  return best;
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (value) => value * Math.PI / 180;
  const radius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getPlace(db, id) {
  if (!Number.isFinite(Number(id)) || Number(id) <= 0) return null;
  const row = await db.prepare(`
    SELECT id, name, kind, address, lat, lon, radius_m, aliases_json, is_active, created_at, updated_at
    FROM ${PLACE_TABLE} WHERE id=?1 AND is_active=1
  `).bind(Number(id)).first();
  return row ? normalizePlaceRow(row) : null;
}

function normalizePlaceInput(value, requireCoordinates) {
  const name = clean(value?.name, 80);
  if (!name) throw new LocationError(400, "Give this place a name, such as Home, Gym, or Hospital.");
  const kindRaw = clean(value?.kind, 30).toLowerCase();
  const kind = ALLOWED_KINDS.has(kindRaw) ? kindRaw : "other";
  const lat = Number(value?.lat);
  const lon = Number(value?.lon);
  if (requireCoordinates && !validLatLon(lat, lon)) throw new LocationError(400, "Valid coordinates are required to save a place.");
  const aliases = normalizeAliases(value?.aliases ?? value?.aliases_json);
  return {
    name,
    kind,
    address: clean(value?.address, 240),
    lat,
    lon,
    radius_m: clampRadius(value?.radius_m),
    aliases,
  };
}

function normalizePlaceRow(row) {
  return {
    id: Number(row.id),
    name: String(row.name || ""),
    kind: ALLOWED_KINDS.has(String(row.kind || "")) ? String(row.kind) : "other",
    address: String(row.address || ""),
    lat: Number(row.lat),
    lon: Number(row.lon),
    radius_m: clampRadius(row.radius_m),
    aliases: normalizeAliases(row.aliases_json),
    is_active: Boolean(Number(row.is_active ?? 1)),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  };
}

function normalizeAliases(value) {
  let values = value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      values = Array.isArray(parsed) ? parsed : value.split(",");
    } catch {
      values = value.split(",");
    }
  }
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const output = [];
  for (const item of values) {
    const cleaned = clean(item, 100);
    const key = normalizeText(cleaned);
    if (!cleaned || !key || seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
    if (output.length >= 12) break;
  }
  return output;
}

function clampRadius(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 175;
  return Math.max(50, Math.min(1000, Math.round(number)));
}

function validLatLon(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function normalizeText(value) {
  return clean(value, 240).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

async function ensureSchema(db) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS ${PLACE_TABLE} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'other',
          address TEXT NOT NULL DEFAULT '',
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          radius_m INTEGER NOT NULL DEFAULT 175,
          aliases_json TEXT NOT NULL DEFAULT '[]',
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `).run();
      await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_silk_places_name ON ${PLACE_TABLE}(name COLLATE NOCASE) WHERE is_active=1`).run();
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

async function logAction(db, action, target, detail) {
  try {
    await db.prepare(`INSERT INTO action_log (provider, action, target, detail_json, status) VALUES ('silk', ?1, ?2, ?3, 'completed')`)
      .bind(action, clean(target, 180), JSON.stringify(detail || {})).run();
  } catch (error) {
    console.error("Could not log SILK location action", error);
  }
}

async function readBody(request) {
  try { return await request.json(); }
  catch { throw new LocationError(400, "A valid JSON body is required."); }
}

function clean(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

export class LocationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function locationErrorResponse(error) {
  const status = error instanceof LocationError ? error.status : 500;
  return json({ error: error instanceof Error ? error.message : "SILK Location Intelligence failed." }, status);
}
