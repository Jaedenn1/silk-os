import test from "node:test";
import assert from "node:assert/strict";
import { adaptiveEventPlanV2, semanticPlaceContext } from "../worker/silk-time-engine-v2.js";

const profile = {
  places: [
    { id: 1, name: "Home", kind: "home", aliases: ["My place"], address: "" },
    { id: 2, name: "Gym", kind: "gym", aliases: ["MOVATI"], address: "" },
    { id: 3, name: "Hospital", kind: "medical", aliases: ["Juravinski Hospital", "JHCC"], address: "" },
  ],
  prep_by_category: { work: { minutes: 30, learned: false, confidence: "learning" } },
  prep_by_context: [],
  travel_by_context: [],
  travel_by_route: [
    { context: "Gym → Hospital", minutes: 18, samples: 5, confidence: "useful", confidence_score: 0.72, weekday: {}, daypart: {} },
  ],
};

test("semantic place context resolves aliases to canonical names", () => {
  assert.equal(semanticPlaceContext(profile, "MOVATI"), "Gym");
  assert.equal(semanticPlaceContext(profile, "Juravinski Hospital"), "Hospital");
  assert.equal(semanticPlaceContext(profile, "Unknown place"), "Unknown place");
});

test("adaptive planner uses learned semantic origin to destination route", () => {
  const previous = { id: 1, title: "Workout", location: "MOVATI", start_at: 1000, end_at: 4000, category: "workout" };
  const next = { id: 2, title: "ER Shift", location: "Juravinski Hospital", start_at: 10000, end_at: 20000, category: "work", notes: "" };
  const plan = adaptiveEventPlanV2(next, profile, previous);
  assert.equal(plan.travelMinutes, 18);
  assert.match(plan.travelSource, /^route:/);
});
