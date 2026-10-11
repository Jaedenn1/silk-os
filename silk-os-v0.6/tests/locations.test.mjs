import test from "node:test";
import assert from "node:assert/strict";
import { haversineMeters, matchPlaceByText, nearestPlace } from "../worker/silk-locations.js";

const places = [
  { id: 1, name: "Home", kind: "home", lat: 43.2400, lon: -79.8700, radius_m: 180, address: "", aliases: ["My place"] },
  { id: 2, name: "Hospital", kind: "medical", lat: 43.2394, lon: -79.8504, radius_m: 220, address: "711 Concession", aliases: ["Juravinski Hospital", "JHCC"] },
];

test("location text matching resolves saved names and aliases", () => {
  assert.equal(matchPlaceByText(places, "Home")?.id, 1);
  assert.equal(matchPlaceByText(places, "Juravinski Hospital")?.id, 2);
  assert.equal(matchPlaceByText(places, "JHCC")?.id, 2);
});

test("nearest place respects recognition radius", () => {
  const nearHospital = nearestPlace(places, 43.23945, -79.85045);
  assert.equal(nearHospital?.id, 2);
  assert.ok(Number(nearHospital?.distance_m) < 50);

  const farAway = nearestPlace(places, 43.3000, -79.9000);
  assert.equal(farAway, null);
});

test("haversine distance is stable for nearby points", () => {
  const meters = haversineMeters(43.24, -79.87, 43.2409, -79.87);
  assert.ok(meters > 90 && meters < 110);
});
