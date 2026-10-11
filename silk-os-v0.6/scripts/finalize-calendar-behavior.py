from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}, found {count}: {old[:160]!r}")
    file.write_text(text.replace(old, new, 1))


# A vague availability question means today unless the user names another day.
replace_once(
    "worker/silk-calendar-chat.js",
    '''  if (/\\bdo i have time\\b|\\bfree time\\b|\\bopen (?:time|window)\\b|\\bfree window\\b/i.test(message)) {
    const duration = requestedDurationMinutes(message);
    const windows = findFreeWindows(events, scope.start, duration);
    const purpose = /\\b(?:gym|workout|training)\\b/i.test(message) ? "for the gym" : "free";
    if (!windows.length) {
      return calendarPayload(`I don’t see a ${duration}-minute usable window ${scope.label} ${purpose === "free" ? "" : purpose} once Calendar blocks and basic prep/travel buffers are included.`.replace(/\\s+/g, " "), "silk_calendar_availability");
    }
    const shown = windows.slice(0, 3).map((window) => `${formatClock(window.start)}–${formatClock(window.end)} (${window.minutes} min)`).join("; ");
    return {
      ...calendarPayload(`Yes. ${scope.label[0].toUpperCase()}${scope.label.slice(1)} you have ${shown}${purpose === "free" ? "" : ` ${purpose}`}.`, "silk_calendar_availability"),
      free_windows: windows,
      calendar_events: events,
    };
  }''',
    '''  if (/\\bdo i have time\\b|\\bfree time\\b|\\bopen (?:time|window)\\b|\\bfree window\\b/i.test(message)) {
    const duration = requestedDurationMinutes(message);
    const availabilityDate = dateKey || localDateKey(Date.now());
    const availabilityLabel = dateKey ? scope.label : "today";
    const availabilityEvents = all.filter((event) => localDateKey(Number(event.start_at) * 1000) === availabilityDate);
    const windows = findFreeWindows(availabilityEvents, availabilityDate, duration);
    const purpose = /\\b(?:gym|workout|training)\\b/i.test(message) ? "for the gym" : "free";
    if (!windows.length) {
      return calendarPayload(`I don’t see a ${duration}-minute usable window ${availabilityLabel} ${purpose === "free" ? "" : purpose} once Calendar blocks and basic prep/travel buffers are included.`.replace(/\\s+/g, " "), "silk_calendar_availability");
    }
    const shown = windows.slice(0, 3).map((window) => `${formatClock(window.start)}–${formatClock(window.end)} (${window.minutes} min)`).join("; ");
    return {
      ...calendarPayload(`Yes. ${availabilityLabel[0].toUpperCase()}${availabilityLabel.slice(1)} you have ${shown}${purpose === "free" ? "" : ` ${purpose}`}.`, "silk_calendar_availability"),
      free_windows: windows,
      calendar_events: availabilityEvents,
    };
  }''',
)

# Bootstrap first so project tasks are synchronized before generalized check-ins are queried.
replace_once(
    "app/today-v2-bridge.tsx",
    '''      const [bootstrapResponse, calendarResponse, pendingResponse, completionResponse] = await Promise.all([
        fetch("/api/bootstrap", { credentials: "same-origin" }),
        fetch(`/api/silk-calendar/events?${query}`, { credentials: "same-origin" }),
        fetch("/api/completions/pending", { credentials: "same-origin" }),
        fetch("/api/completions/summary", { credentials: "same-origin" }),
      ]);

      if (!bootstrapResponse.ok) throw new Error("Today could not load your SILK data.");
      setData((await bootstrapResponse.json()) as TodayData);''',
    '''      const bootstrapResponse = await fetch("/api/bootstrap", { credentials: "same-origin" });
      if (!bootstrapResponse.ok) throw new Error("Today could not load your SILK data.");
      setData((await bootstrapResponse.json()) as TodayData);

      const [calendarResponse, pendingResponse, completionResponse] = await Promise.all([
        fetch(`/api/silk-calendar/events?${query}`, { credentials: "same-origin" }),
        fetch("/api/completions/pending", { credentials: "same-origin" }),
        fetch("/api/completions/summary", { credentials: "same-origin" }),
      ]);''',
)
