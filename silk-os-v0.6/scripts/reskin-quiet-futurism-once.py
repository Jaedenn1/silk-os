from pathlib import Path


def append_once(path: str, marker: str, block: str) -> None:
    file = Path(path)
    text = file.read_text()
    if marker in text:
        return
    file.write_text(text.rstrip() + "\n\n" + block.strip() + "\n")


calendar_block = r'''
/* SILK Quiet Futurism — Calendar scoped theme */
.shell {
  color: #f5f3fb;
  background:
    radial-gradient(circle at 76% -8%, rgba(139, 105, 255, .10), transparent 35%),
    radial-gradient(circle at 12% 100%, rgba(70, 111, 255, .05), transparent 30%),
    linear-gradient(180deg, #090b11 0%, #07090d 52%, #05070a 100%);
}
.mark {
  border-color: rgba(188, 181, 218, .16);
  background: linear-gradient(145deg, rgba(24, 24, 34, .9), rgba(12, 12, 18, .96));
  box-shadow: inset 0 1px rgba(255,255,255,.04), 0 16px 40px rgba(0,0,0,.24);
  color: #a58fff;
}
.eyebrow { color: #9d8dff; }
.primary {
  background: linear-gradient(145deg, #7876d9, #6764b8);
  color: #fff;
  box-shadow: inset 0 1px rgba(255,255,255,.1), 0 9px 24px rgba(80,76,174,.16);
}
.yes { background: #8fdcaf; color: #07110c; }
.secondary, .no {
  color: #c9c5d0;
  background: rgba(255,255,255,.018);
  border-color: rgba(188,181,218,.12);
}
.calendarCard, .sideCard {
  border-color: rgba(188,181,218,.11);
  background: linear-gradient(145deg, rgba(16,16,24,.91), rgba(9,9,14,.94));
  box-shadow: 0 24px 80px rgba(0,0,0,.28), inset 0 1px rgba(255,255,255,.025);
}
.sideCard p { color: #8e8a99; }
.notice {
  border-color: rgba(188,181,218,.14);
  color: #c9c5d0;
  background: rgba(18,18,27,.92);
}
.checkin {
  border-color: rgba(188,181,218,.09);
  background: rgba(255,255,255,.012);
}
.checkin small { color: #74707f; }
.legend span { color: #9995a6; }
.legend i { background: #758cff; }
.legend span:nth-child(2) i { background: #8fe0b5; }
.legend span:nth-child(3) i { background: #a58fff; }
.legend span:nth-child(4) i { background: #ffb86a; }
.legend span:nth-child(5) i { background: #d68aa8; }

.calendarHost :global(.fc) {
  --fc-border-color: rgba(188,181,218,.075);
  --fc-page-bg-color: transparent;
  --fc-neutral-bg-color: rgba(255,255,255,.018);
  --fc-neutral-text-color: #8d8997;
  --fc-today-bg-color: rgba(137,119,235,.055);
  --fc-event-bg-color: #33386b;
  --fc-event-border-color: rgba(165,143,255,.28);
  --fc-event-text-color: #f1eef8;
  --fc-button-bg-color: #171721;
  --fc-button-border-color: rgba(188,181,218,.12);
  --fc-button-hover-bg-color: #21202e;
  --fc-button-hover-border-color: rgba(181,166,243,.21);
  --fc-button-active-bg-color: #353166;
  --fc-button-active-border-color: rgba(165,143,255,.3);
}
.calendarHost :global(.fc .fc-col-header-cell-cushion),
.calendarHost :global(.fc .fc-daygrid-day-number) { color: #b7b3c0; }
.calendarHost :global(.fc .fc-timegrid-slot-label-cushion) { color: #686472; }
.calendarHost :global(.fc .silk-event-work) { background: #303a69; border-color: rgba(117,140,255,.36); }
.calendarHost :global(.fc .silk-event-school),
.calendarHost :global(.fc .silk-event-study) { background: #40345f; border-color: rgba(165,143,255,.38); }
.calendarHost :global(.fc .silk-event-workout) { background: #25483b; border-color: rgba(143,224,181,.32); }
.calendarHost :global(.fc .silk-event-appointment) { background: #57402b; border-color: rgba(255,184,106,.37); }
.calendarHost :global(.fc .silk-event-personal),
.calendarHost :global(.fc .silk-event-other) { background: #473342; border-color: rgba(214,138,168,.3); }
.loading { color: #817d8c; }
.modalBackdrop { background: rgba(2,3,6,.80); }
.modal {
  border-color: rgba(188,181,218,.16);
  background: linear-gradient(145deg, #111119, #0a0a10);
  box-shadow: 0 36px 120px rgba(0,0,0,.56), inset 0 1px rgba(255,255,255,.035);
}
.close { color: #8c8897; }
.field { color: #9995a6; }
.field input, .field select, .field textarea {
  color: #f1eef7;
  background: rgba(4,5,9,.58);
  border-color: rgba(188,181,218,.12);
}
.field input:focus, .field select:focus, .field textarea:focus { border-color: rgba(165,143,255,.35); }
.checkRow {
  border-color: rgba(143,224,181,.11);
  background: rgba(143,224,181,.025);
  color: #a9bcb1;
}
.checkRow input { accent-color: #8fe0b5; }
.statusChip {
  border-color: rgba(143,224,181,.13);
  color: #92d7b2;
  background: rgba(143,224,181,.03);
}
'''

bridge_block = r'''
/* SILK Quiet Futurism — floating completion check-in */
.checkin {
  border-color: rgba(188,181,218,.18);
  color: #f5f3fb;
  background:
    radial-gradient(circle at 90% -20%, rgba(139,105,255,.12), transparent 45%),
    linear-gradient(145deg, rgba(18,18,27,.98), rgba(10,10,16,.98));
  box-shadow: 0 24px 80px rgba(0,0,0,.52), inset 0 1px rgba(255,255,255,.035);
}
.eyebrow { color: #9d8dff; }
.pulse { background: #8fe0b5; box-shadow: 0 0 16px rgba(143,224,181,.65); }
.checkin p { color: #908c9b; }
.no {
  color: #c7c3ce;
  background: rgba(255,255,255,.018);
  border-color: rgba(188,181,218,.11);
}
.yes {
  color: #07110c;
  background: #8fdcaf;
  border-color: #8fdcaf;
}
.footer span { color: #666270; }
.footer a { color: #aa9eff; }
'''

append_once("app/calendar/calendar.module.css", "SILK Quiet Futurism — Calendar scoped theme", calendar_block)
append_once("app/calendar-bridge.module.css", "SILK Quiet Futurism — floating completion check-in", bridge_block)

# The provider-setup HTML is outside the React shell, so bring that page into the same palette too.
index = Path("worker/index.ts")
text = index.read_text()
replacements = {
    'background:#030a0f;color:#eaf8ff': 'background:#07090d;color:#f5f3fb',
    'radial-gradient(circle at 70% 0,rgba(42,190,225,.13),transparent 35%),#030a0f': 'radial-gradient(circle at 70% 0,rgba(139,105,255,.11),transparent 35%),#07090d',
    'border:1px solid rgba(114,231,255,.18);border-radius:18px;padding:28px;background:rgba(7,22,30,.94)': 'border:1px solid rgba(188,181,218,.16);border-radius:18px;padding:28px;background:rgba(16,16,24,.96)',
    'letter-spacing:.18em;color:#72e7ff': 'letter-spacing:.18em;color:#9d8dff',
    'p{color:#91aab6': 'p{color:#9995a6',
    'ol{padding-left:24px;color:#cfe7ef': 'ol{padding-left:24px;color:#c9c5d0',
    'border:1px solid rgba(114,231,255,.12);border-radius:9px;background:#02070a;color:#bcefff': 'border:1px solid rgba(188,181,218,.12);border-radius:9px;background:#08080d;color:#d9d5e4',
    'color:#031014;background:#72e7ff': 'color:#fff;background:#7774d8',
}
for old, new in replacements.items():
    if old in text:
        text = text.replace(old, new, 1)
index.write_text(text)
