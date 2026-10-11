from pathlib import Path

life = Path("worker/silk-life-chat.js")
text = life.read_text()
old = '''  if (/\\b(?:finish|end|complete)\\b[\\s\\S]{0,120}\\b(?:workout|gym|training|full body|leg day|push day|pull day|upper body|lower body)\\b/i.test(text) ||
      /\\b(?:workout|gym|training)\\b[\\s\\S]{0,100}\\b(?:finished|done|complete)\\b/i.test(text)) {
    return "workout_finish";
  }
'''
new = '''  if (/\\b(?:finish|end|complete)\\b[\\s\\S]{0,120}\\b(?:workout|gym|training|full body|leg day|push day|pull day|upper body|lower body)\\b/i.test(text) ||
      /\\b(?:workout|gym|training)\\b[\\s\\S]{0,100}\\b(?:finished|done|complete)\\b/i.test(text) ||
      /\\bmark\\b[\\s\\S]{0,140}\\b(?:workout|gym|training|full body|leg day|push day|pull day|upper body|lower body)\\b[\\s\\S]{0,80}\\b(?:complete|done|finished)\\b/i.test(text)) {
    return "workout_finish";
  }
'''
if old not in text:
    raise SystemExit("Workout finish intent anchor not found")
life.write_text(text.replace(old, new, 1))

tests = Path("tests/life-chat.test.mjs")
text = tests.read_text()
anchor = '  assert.equal(lifeIntent("Finish my workout"), "workout_finish");\n'
addition = anchor + '  assert.equal(lifeIntent("Mark Full Body A complete"), "workout_finish");\n'
if 'lifeIntent("Mark Full Body A complete")' not in text:
    if anchor not in text:
        raise SystemExit("Workout finish test anchor not found")
    text = text.replace(anchor, addition, 1)
tests.write_text(text)
