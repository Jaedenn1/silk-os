import test from "node:test";
import assert from "node:assert/strict";
import { adaptiveEventPlan, robustMinutes, sampleConfidence } from "../worker/silk-time-engine.js";
import { buildEventTransitions, confidenceFromMeasurements, selectContextMetric } from "../worker/silk-time-engine-v2.js";

test("adaptive timing uses robust measured minutes", () => {
  assert.equal(robustMinutes([28, 30, 31, 32, 120], 30), 31);
  assert.equal(sampleConfidence(1), "learning");
  assert.equal(sampleConfidence(4), "useful");
  assert.equal(sampleConfidence(9), "strong");
});

test("explicit Calendar timing overrides learned timing", () => {
  const event = { start_at: 200000, category: "work", location: "Hospital", notes: "prep:20 travel:45" };
  const profile = {
    prep_by_category: { work: { minutes: 38, learned: true, confidence: "strong" } },
    prep_by_context: [{ context: "Hospital", minutes: 44, samples: 8, confidence: "strong" }],
    travel_by_context: [{ context: "Hospital", minutes: 27, samples: 8, confidence: "strong" }],
  };
  const plan = adaptiveEventPlan(event, profile);
  assert.equal(plan.prepMinutes, 20);
  assert.equal(plan.travelMinutes, 45);
  assert.equal(plan.leaveBy, 200000 - 45 * 60);
});

test("destination-specific prep beats category defaults", () => {
  const event = { start_at: 200000, category: "work", location: "Hospital", notes: "" };
  const profile = {
    prep_by_category: { work: { minutes: 34, learned: true, confidence: "useful" } },
    prep_by_context: [{ context: "Hospital", minutes: 42, samples: 5, confidence: "useful", weekday: {}, daypart: {} }],
    travel_by_context: [],
  };
  const plan = adaptiveEventPlan(event, profile);
  assert.equal(plan.prepMinutes, 42);
  assert.match(plan.prepSource, /^context/);
});

test("weekday/daypart context can refine a learned destination", () => {
  const epoch = Math.floor(new Date("2026-10-12T14:00:00-04:00").getTime() / 1000);
  const metric = selectContextMetric([{
    context: "Juravinski Hospital",
    minutes: 30,
    samples: 8,
    confidence: "strong",
    confidence_score: 0.9,
    weekday: { mon: { minutes: 36, samples: 3, confidence: "useful", confidence_score: 0.7 } },
    daypart: { afternoon: { minutes: 34, samples: 4, confidence: "useful", confidence_score: 0.8 } },
  }], "Juravinski Hospital", epoch, 2);
  assert.equal(metric.minutes, 34);
  assert.equal(metric.pattern, "daypart:afternoon");
});

test("event-to-event transitions account for prep and travel", () => {
  const profile = {
    prep_by_category: { work: { minutes: 30, learned: true, confidence: "useful" } },
    prep_by_context: [],
    travel_by_context: [{ context: "Hospital", minutes: 30, samples: 5, confidence: "useful", weekday: {}, daypart: {} }],
    travel_by_route: [],
  };
  const transitions = buildEventTransitions([
    { id: 1, title: "Gym", start_at: 1000, end_at: 4600, all_day: 0, location: "Gym", category: "workout", notes: "" },
    { id: 2, title: "ER Shift", start_at: 7000, end_at: 10000, all_day: 0, location: "Hospital", category: "work", notes: "" },
  ], profile);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].gap_minutes, 40);
  assert.equal(transitions[0].required_minutes, 60);
  assert.equal(transitions[0].status, "conflict");
  assert.equal(transitions[0].slack_minutes, -20);
});

test("confidence rewards consistent evidence and penalizes noisy evidence", () => {
  const now = Math.floor(Date.now() / 1000);
  const consistent = confidenceFromMeasurements([29, 30, 30, 31, 30, 29, 31, 30], now);
  const noisy = confidenceFromMeasurements([10, 60, 20, 75, 15, 80, 25, 70], now);
  assert.equal(consistent.confidence, "strong");
  assert.ok(consistent.confidence_score > noisy.confidence_score);
});
