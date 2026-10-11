from pathlib import Path

life = Path("worker/silk-life-chat.js")
text = life.read_text()
old = '''function extractWorkoutName(message) {
  const text = String(message || "").replace(/\\b(?:start|begin)\\b/ig, " ").replace(/\\b(?:my|a|the)\\b/ig, " ").replace(/\\s+/g, " ").trim().replace(/[.!?]+$/, "");
  if (/^(?:workout|gym|training)$/i.test(text)) return "Workout";
  return clean(text.replace(/\\s+(?:workout|session)$/i, "").trim(), 100) || "Workout";
}
'''
new = '''export function extractWorkoutName(message) {
  const text = String(message || "")
    .replace(/\\b(?:start|begin)\\b/ig, " ")
    .replace(/^\\s*(?:my|a|the)\\s+/i, "")
    .replace(/\\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
  if (/^(?:workout|gym|training)$/i.test(text)) return "Workout";
  return clean(text.replace(/\\s+(?:workout|session)$/i, "").trim(), 100) || "Workout";
}
'''
if old not in text:
    raise SystemExit("Workout name function anchor not found")
life.write_text(text.replace(old, new, 1))

tests = Path("tests/life-chat.test.mjs")
text = tests.read_text()
old_import = 'import { lifeIntent, extractDurationMinutes, extractStudySubject, resolveDateKey } from "../worker/silk-life-chat.js";'
new_import = 'import { lifeIntent, extractDurationMinutes, extractStudySubject, extractWorkoutName, resolveDateKey } from "../worker/silk-life-chat.js";'
if old_import not in text:
    raise SystemExit("Life chat test import anchor not found")
text = text.replace(old_import, new_import, 1)
anchor = '  assert.equal(lifeIntent("Start Full Body A workout"), "workout_start");\n'
addition = anchor + '  assert.equal(extractWorkoutName("Start Full Body A workout"), "Full Body A");\n  assert.equal(extractWorkoutName("Start a workout"), "Workout");\n'
if 'extractWorkoutName("Start Full Body A workout")' not in text:
    if anchor not in text:
        raise SystemExit("Workout test anchor not found")
    text = text.replace(anchor, addition, 1)
tests.write_text(text)
