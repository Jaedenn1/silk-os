import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTodayStats,
  calendarEventToDailyItem,
  chooseModel,
  constantTimeEqual,
  focusKnowledgeGraph,
  localDateKey,
  normalizeMemoryKey,
  normalizeMemoryPrivacy,
  projectTaskStatusForDailyStatus,
  selectRelevantMemories,
  shouldStoreMemoryCandidate,
} from "../worker/silk-core.js";

const openAIEnv = {
  PRIMARY_AI_PROVIDER: "openai",
  OPENAI_ROUTER_MODEL: "gpt-5-nano",
  OPENAI_ROUTINE_MODEL: "gpt-5.6-luna",
  OPENAI_COMPLEX_MODEL: "gpt-5.6-terra",
};

test("automatic routing sends small, routine, and complex work to the intended model", () => {
  assert.equal(chooseModel("Hello", "automatic", "chat", openAIEnv).id, "gpt-5-nano");
  assert.equal(
    chooseModel("Rewrite this short paragraph more clearly.", "automatic", "chat", openAIEnv).id,
    "gpt-5.6-luna",
  );
  assert.equal(
    chooseModel("Compare these two nursing study plans and recommend the stronger one with evidence.", "automatic", "chat", openAIEnv).id,
    "gpt-5.6-terra",
  );
});

test("authentication comparison rejects wrong values and length mismatches", () => {
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(constantTimeEqual(new Uint8Array([1]), new Uint8Array([1, 0])), false);
});

test("memory normalization deduplicates punctuation and applies safe privacy defaults", () => {
  assert.equal(normalizeMemoryKey("  Incline PRESS — 70 lb! "), "incline press 70 lb");
  assert.equal(normalizeMemoryPrivacy("restricted"), "restricted");
  assert.equal(normalizeMemoryPrivacy("unknown"), "personal");
});

test("memory retrieval stays relevant and bounded before it reaches a paid model", () => {
  const selected = selectRelevantMemories(
    [
      { id: 1, category: "fitness", content: "Incline chest press personal record is 70 pounds", importance: 4, updated_at: 1 },
      { id: 2, category: "school", content: "Anatomical planes need more review", importance: 3, updated_at: 2 },
      { id: 3, category: "general", content: "A".repeat(3000), importance: 5, updated_at: 3 },
    ],
    "What was my incline press record?",
    { limit: 2, characterBudget: 1200 },
  );
  assert.equal(selected[0].id, 1);
  assert.equal(selected.length, 2);
  assert.ok(selected.reduce((total, memory) => total + memory.content.length, 0) <= 1200);
});

test("sensitive memory requires an explicit remember request and secrets are never stored", () => {
  const sensitive = { content: "My knee has a recurring stability issue", privacy: "sensitive" };
  assert.equal(shouldStoreMemoryCandidate(sensitive, false), false);
  assert.equal(shouldStoreMemoryCandidate(sensitive, true), true);
  assert.equal(
    shouldStoreMemoryCandidate({ content: "My API key is sk-example123456789", privacy: "restricted" }, true),
    false,
  );
});

test("calendar events become stable daily tracker items", () => {
  const item = calendarEventToDailyItem(
    {
      id: "google-event-7",
      summary: "Anatomy review",
      start: "2026-08-10T14:00:00.000Z",
      end: "2026-08-10T15:30:00.000Z",
      location: "Library",
    },
    "2026-08-10",
  );
  assert.deepEqual(item, {
    dateKey: "2026-08-10",
    title: "Anatomy review",
    sourceId: "google-event-7",
    scheduledAt: 1786370400,
    durationMinutes: 90,
    notes: "Library",
  });
});

test("daily completion excludes skipped work and calculates focus time", () => {
  const stats = buildTodayStats(
    [
      { status: "done", source_type: "manual", duration_minutes: 30 },
      { status: "todo", source_type: "calendar", duration_minutes: 75 },
      { status: "skipped", source_type: "calendar", duration_minutes: 15 },
    ],
    { completed: 6, total: 10 },
  );
  assert.deepEqual(stats.progress, { completed: 1, total: 2, percent: 50 });
  assert.deepEqual(stats.week, { completed: 6, total: 10 });
  assert.equal(stats.focusMinutes, 390);
});

test("daily tracker completion cascades to project tasks", () => {
  assert.equal(projectTaskStatusForDailyStatus("done"), "done");
  assert.equal(projectTaskStatusForDailyStatus("doing"), "doing");
  assert.equal(projectTaskStatusForDailyStatus("skipped"), "todo");
});

test("focused memory graph spreads activation to connected context only", () => {
  const graph = focusKnowledgeGraph(
    [
      { id: 1, label: "Anatomical planes", node_type: "memory", importance: 5 },
      { id: 2, label: "Pre-Health", node_type: "course", importance: 4 },
      { id: 3, label: "Incline press", node_type: "memory", importance: 5 },
    ],
    [
      { id: 1, source: 1, target: 2, relation: "course", weight: 0.9 },
      { id: 2, source: 3, target: 2, relation: "unrelated", weight: 0.1 },
    ],
    "anatomical",
    10,
  );
  assert.equal(graph.nodes[0].id, 1);
  assert.ok(graph.nodes.some((node) => node.id === 2));
});

test("Toronto local date keys remain stable", () => {
  assert.equal(localDateKey(new Date("2026-08-10T03:30:00Z")), "2026-08-09");
});
