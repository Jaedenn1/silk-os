import test from "node:test";
import assert from "node:assert/strict";
import { robustMinutes, sampleConfidence } from "../worker/silk-time-engine.js";
import { adaptiveEventPlan } from "../worker/silk-proactive.js";

test("adaptive timing uses robust measured minutes", () => {
  assert.equal(robustMinutes([28, 30, 31, 32, 120], 30), 31);
  assert.equal(sampleConfidence(1), "learning");
  assert.equal(sampleConfidence(4), "useful");
  assert.equal(sampleConfidence(9), "strong");
});

test("explicit Calendar timing overrides learned timing", () => {
  const event = { start_at: 200000, category: "work", location: "Hospital", notes: "prep:20 travel:45" };
  const profile = {
    prep_by_category: { work: { minutes: 38, learned: true } },
    travel_by_context: [{ context: "Hospital", minutes: 27, samples: 8 }],
  };
  const plan = adaptiveEventPlan(event, profile);
  assert.equal(plan.prepMinutes, 20);
  assert.equal(plan.travelMinutes, 45);
  assert.equal(plan.leaveBy, 200000 - 45 * 60);
});

test("learned timing beats safe defaults when evidence exists", () => {
  const event = { start_at: 200000, category: "work", location: "Hospital", notes: "" };
  const profile = {
    prep_by_category: { work: { minutes: 38, learned: true } },
    travel_by_context: [{ context: "Hospital", minutes: 27, samples: 4 }],
  };
  const plan = adaptiveEventPlan(event, profile);
  assert.equal(plan.prepMinutes, 38);
  assert.equal(plan.travelMinutes, 27);
});
