from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}, found {count}: {old[:140]!r}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "worker/silk-calendar-chat.js",
    '  const text = message.toLowerCase();\n\n',
    '',
)

replace_once(
    "worker/silk-completions.js",
    '''    const dateKey = localDateKey(Date.now());
    instanceKey = clean(pending.key, 300) || `project-task:${row.id}:${dateKey}`;''',
    '''    const dateKey = localDateKey(Date.now());
    instanceKey = result === "completed"
      ? `project-task:${row.id}`
      : (clean(pending.key, 300) || `project-task:${row.id}:${dateKey}`);''',
)
