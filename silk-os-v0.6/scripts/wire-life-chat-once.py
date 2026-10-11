from pathlib import Path

path = Path("worker/index.ts")
text = path.read_text()

old_import = 'import { tryHandleSilkCalendarChat } from "./silk-calendar-chat.js";\n'
new_import = old_import + 'import { tryHandleSilkLifeChat } from "./silk-life-chat.js";\n'
if 'tryHandleSilkLifeChat' not in text:
    if old_import not in text:
        raise SystemExit("Calendar chat import anchor not found")
    text = text.replace(old_import, new_import, 1)

old_block = '''      if (authenticated) {
        try {
          const calendarChat = await tryHandleSilkCalendarChat(request, env);
          if (calendarChat) return withSecurityHeaders(calendarChat);
        } catch (error) {
          console.error("SILK Calendar chat route failed", error);
        }
      }
'''
new_block = '''      if (authenticated) {
        try {
          const lifeChat = await tryHandleSilkLifeChat(request, env);
          if (lifeChat) return withSecurityHeaders(lifeChat);
        } catch (error) {
          console.error("SILK Life Control chat route failed", error);
        }
        try {
          const calendarChat = await tryHandleSilkCalendarChat(request, env);
          if (calendarChat) return withSecurityHeaders(calendarChat);
        } catch (error) {
          console.error("SILK Calendar chat route failed", error);
        }
      }
'''
if 'const lifeChat = await tryHandleSilkLifeChat' not in text:
    if old_block not in text:
        raise SystemExit("Authenticated chat routing anchor not found")
    text = text.replace(old_block, new_block, 1)

path.write_text(text)
