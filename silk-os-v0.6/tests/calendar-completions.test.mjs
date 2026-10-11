import assert from "node:assert/strict";
import test from "node:test";

import {
  calendarIntent,
  findFreeWindows,
  resolveDateKey,
  resolveMove,
} from "../worker/silk-calendar-chat.js";
import {
  calculateStreaks,
  completionAchievements,
} from "../worker/silk-completions.js";

const HOUR = 60 * 60;

function torontoEpoch(date, hour, minute = 0) {
  const [year, month, day] = date.split("-").map(Number);
  const offset = date >= "2026-11-01" ? "-05:00" : "-04:00";
  return Math.floor(Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${offset}`) / 1000);
}

test("Calendar chat recognizes the core read and update phrases", () => {
  assert.equal(calendarIntent("When do I work tomorrow?"), "read");
  assert.equal(calendarIntent("What's next?"), "read");
  assert.equal(calendarIntent("Do I have time for the gym?"), "read");
  assert.equal(calendarIntent("What does Saturday look like?"), "read");
  assert.equal(calendarIntent("Move my workout to 7"), "update");
});

test("named weekday resolution uses Toronto local dates", () => {
  const fridayNight = Date.parse("2026-10-09T23:30:00-04:00");
  assert.equal(resolveDateKey("What does Saturday look like?", fridayNight), "2026-10-10");
  assert.equal(resolveDateKey("What about next Saturday?", fridayNight), "2026-10-17");
});

test("move workout preserves duration and resolves conversational 7 as evening", () => {
  const event = {
    id: 1,
    title: "GYM",
    category: "workout",
    start_at: torontoEpoch("2026-10-12", 10),
    end_at: torontoEpoch("2026-10-12", 11),
  };
  const moved = resolveMove("Move my workout to 7", event);
  assert.equal(moved.question, "");
  assert.equal(moved.start, torontoEpoch("2026-10-12", 19));
  assert.equal(moved.end - moved.start, HOUR);
});

test("free-window calculation subtracts event prep and travel buffers", () => {
  const date = "2026-10-12";
  const events = [{
    id: 2,
    title: "ER Shift",
    category: "work",
    location: "Juravinski",
    all_day: false,
    start_at: torontoEpoch(date, 15),
    end_at: torontoEpoch(date, 23),
  }];
  const originalNow = Date.now;
  Date.now = () => torontoEpoch(date, 9) * 1000;
  try {
    const windows = findFreeWindows(events, date, 60);
    assert.equal(windows.length, 1);
    assert.equal(windows[0].start, torontoEpoch(date, 9));
    assert.equal(windows[0].end, torontoEpoch(date, 14));
    assert.equal(windows[0].minutes, 300);
  } finally {
    Date.now = originalNow;
  }
});

test("completion streaks and achievements are derived from one history ledger", () => {
  const history = [
    { result: "completed", category: "workout", occurred_at: torontoEpoch("2026-10-09", 12) },
    { result: "completed", category: "study", occurred_at: torontoEpoch("2026-10-10", 12) },
    { result: "completed", category: "project", occurred_at: torontoEpoch("2026-10-11", 12) },
  ];
  const streaks = calculateStreaks(history, Date.parse("2026-10-11T20:00:00-04:00"));
  assert.equal(streaks.overall.current, 3);
  assert.equal(streaks.overall.best, 3);
  const achievements = completionAchievements(history, streaks);
  assert.equal(achievements.find((item) => item.id === "first-win")?.unlocked, true);
  assert.equal(achievements.find((item) => item.id === "momentum-3")?.unlocked, true);
});
