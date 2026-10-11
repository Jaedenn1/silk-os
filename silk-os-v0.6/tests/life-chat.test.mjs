import test from "node:test";
import assert from "node:assert/strict";
import { lifeIntent, extractDurationMinutes, extractStudySubject, extractWorkoutName, resolveDateKey } from "../worker/silk-life-chat.js";

test("Life Control recognizes Study commands", () => {
  assert.equal(lifeIntent("What should I study tonight?"), "study_recommend");
  assert.equal(lifeIntent("Start a 45-minute anatomy session"), "study_start");
  assert.equal(lifeIntent("What did I study recently?"), "study_status");
  assert.equal(extractDurationMinutes("Start a 45-minute anatomy session"), 45);
  assert.equal(extractDurationMinutes("Begin 1.5 hours of chemistry study"), 90);
  assert.equal(extractStudySubject("Start a 45-minute anatomy session"), "anatomy");
});

test("Life Control recognizes Workout commands without stealing Calendar moves", () => {
  assert.equal(lifeIntent("What workout am I doing today?"), "workout_status");
  assert.equal(lifeIntent("Start Full Body A workout"), "workout_start");
  assert.equal(extractWorkoutName("Start Full Body A workout"), "Full Body A");
  assert.equal(extractWorkoutName("Start a workout"), "Workout");
  assert.equal(lifeIntent("Finish my workout"), "workout_finish");
  assert.equal(lifeIntent("Move my workout to 7"), null);
  assert.equal(lifeIntent("Do I have time for the gym?"), null);
});

test("Life Control recognizes Project commands", () => {
  assert.equal(lifeIntent("What's left on SILK OS?"), "project_read");
  assert.equal(lifeIntent("What project should I work on right now?"), "project_read");
  assert.equal(lifeIntent("Add task polish Ask SILK to Build Silk"), "project_add_task");
  assert.equal(lifeIntent("Move project task polish Ask SILK to tomorrow"), "project_reschedule");
});

test("Life Control resolves Toronto-relative dates", () => {
  const now = Date.parse("2026-10-11T10:00:00-04:00");
  assert.equal(resolveDateKey("move task to today", now), "2026-10-11");
  assert.equal(resolveDateKey("move task to tomorrow", now), "2026-10-12");
  assert.equal(resolveDateKey("move task to Monday", now), "2026-10-12");
  assert.equal(resolveDateKey("move task to next Monday", now), "2026-10-19");
});
