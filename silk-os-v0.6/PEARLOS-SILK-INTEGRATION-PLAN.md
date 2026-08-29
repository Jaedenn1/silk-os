# PearlOS → SILK Integration Plan

Status: **Approved roadmap / source-of-truth planning document**

Date added: 2026-08-28

Reference repository: https://github.com/NiaExperience/PearlOS

PearlOS baseline reviewed: `80e535db2c09ff7c424de1f528332f62847b0c6b` (`feat: integrate universal architecture for v1.2.0`)

## Purpose

This document records the decision to study and selectively reuse ideas and, where useful and license-compatible, source code from PearlOS while continuing to build SILK as its own personal operating system.

If a future chat, agent, or developer loses the original discussion, this file should be treated as the plan.

The goal is **not** to replace SILK with PearlOS or turn SILK into a PearlOS fork. SILK keeps its own identity, data model, Cloudflare core, OpenAI routing, D1 memory, approval system, integrations, native Apple direction, and visual design.

PearlOS is a reference implementation and code resource for specific capabilities that overlap with the long-term SILK vision.

## Product direction

SILK is intended to become a private personal system with multiple clients:

```text
                         SILK CORE
            Cloudflare Worker + D1 + AI routing
                              |
              +---------------+---------------+
              |               |               |
              v               v               v
        Native iPhone     Native Mac       SILK Web
           client           client          client
        SwiftUI/WebKit   SwiftUI/AppKit      Next.js
```

The current web app remains useful, but the long-term primary experience should be native Apple applications on the owner's own devices. The browser client becomes another way to access SILK, not the definition of SILK itself.

The current project is intended for private, personal, non-commercial use rather than public distribution or commercialization.

---

# Reuse policy

For each PearlOS-derived capability, choose one of three approaches.

## 1. Direct adaptation

Use PearlOS source code when it is technically compatible with SILK and gives a real engineering advantage.

Examples may include:
- event/tool patterns
- reusable TypeScript utilities
- browser-side interaction logic
- window-management concepts or components for the SILK web client
- safe orchestration patterns

When code is directly copied or materially derived:
- preserve applicable PearlOS copyright/license notices
- record the PearlOS source file and commit used
- keep PearlOS license obligations with the derived code
- prefer small, traceable adaptations rather than importing the entire repository

## 2. Recreate from the idea

When PearlOS is tied to a different stack or when SILK needs a cleaner implementation, use the architecture as inspiration and write a SILK-native version.

This will be the default for native Apple functionality such as SwiftUI, AppKit, HealthKit, App Intents, notifications, and WebKit browser surfaces.

## 3. Hybrid

Use PearlOS architecture and selected implementation details while rebuilding the surrounding system around SILK's existing backend, permissions, UI, and data model.

This is expected to be the most common approach.

---

# The eight PearlOS-derived SILK systems

## 1. SILK Capability Bus

**Priority: Highest**

PearlOS uses explicit AI-callable tools instead of letting the model freely manipulate the system. SILK should formalize the same principle.

Every important capability should be registered and typed, for example:

```text
silk.calendar.read
silk.calendar.create
silk.gmail.search
silk.gmail.draft
silk.contacts.lookup
silk.onenote.write
silk.web.search
silk.browser.open
silk.projects.update
silk.workout.log_set
silk.memory.remember
silk.ui.navigate
silk.canvas.show
silk.device.command
```

Each capability should declare at minimum:

```text
AVAILABLE
CONNECTED
READ / WRITE
APPROVAL_REQUIRED
CLIENT_REQUIREMENTS
```

Execution path:

```text
Nano / Luna / Terra
        |
        v
Typed capability request
        |
        v
Permission + connection check
        |
        +--> owner approval when required
        |
        v
Execution
        |
        v
Activity/audit log
```

**PearlOS strategy:** Hybrid. Study its bot-tool registration/discovery architecture and reuse small compatible patterns where useful, but implement SILK's capability registry around the existing Worker, D1, approval queue, and future native clients.

---

## 2. AI-controlled SILK interface

**Priority: High**

SILK should be able to control its own UI through explicit interface capabilities.

Examples:
- "Silk, show me tomorrow" → navigate to Calendar/tomorrow
- "Open my workout" → open the workout interface
- "Put those emails on screen" → display Gmail results
- "Show that beside the browser" → arrange workspace surfaces

The AI should never mutate arbitrary UI state directly. It should emit typed UI commands that the active client decides how to render.

**PearlOS strategy:** Hybrid/recreate. Borrow the event-driven idea and possibly compatible event-routing code for the web client. Recreate the native UI command layer in SwiftUI/AppKit.

---

## 3. SILK Canvas

**Priority: High**

PearlOS's Wonder Canvas is a strong reference for a dynamic visual surface controlled by the assistant.

SILK Canvas should be able to display rich, temporary or persistent views such as:
- weather
- calendar timelines
- maps
- web research
- emails
- workout charts
- study diagrams
- images
- project roadmaps
- generated tables/cards
- interactive mini tools
- media

The Canvas is not merely another chat panel. It is the place where SILK can visually "put something up on the screen."

**PearlOS strategy:** Hybrid. Study Wonder Canvas architecture and selected reusable web code. Rebuild the visual language to match SILK. Native versions should use SwiftUI/AppKit/WebKit instead of forcing the PearlOS browser implementation into Apple clients.

---

## 4. Real-time SILK Voice Engine

**Priority: High, after core integrations are stable**

PearlOS demonstrates a serious real-time voice pipeline using WebRTC, STT, turn detection, orchestration, interruption handling, an LLM, tools, and TTS.

SILK ultimately needs the same class of experience:
- low-latency conversation
- voice activity detection
- interruption/barge-in
- streamed speech recognition
- streamed model responses
- tool calls during a conversation
- natural TTS
- "Hey Silk" / wake interaction where platform rules permit

Do **not** automatically copy PearlOS's entire Daily.co + Deepgram + Pipecat + PocketTTS stack. SILK should choose the cheapest and cleanest pipeline available when this phase begins.

**PearlOS strategy:** Architecture inspiration first; selective code adaptation only where it clearly reduces work.

---

## 5. SILK Orchestrator + Worker Agents

**Priority: High for the later Agents phase**

PearlOS separates the conversational companion from execution workers. SILK should adopt this principle.

SILK Core remains responsive and conversational while specialized workers perform bounded jobs.

Target concept:

```text
                         SILK CORE
                            |
               +------------+------------+
               |            |            |
               v            v            v
          Cloud worker   Local worker   Device worker
               |            |            |
          APIs/research   Mac/files     Home/devices
```

Potential workers:
- research agent
- study curator
- project auditor
- coding/build agent
- email/calendar operator
- local Mac agent
- smart-home/device agent

Workers receive only the capabilities necessary for the task and remain subject to SILK permissions and owner approvals.

**PearlOS strategy:** Hybrid. Reuse orchestration/dispatch lessons and small patterns where useful; build SILK's own agent runtime around its Capability Bus.

---

## 6. Feature flags + capability permissions

**Priority: High**

PearlOS uses feature flags to determine what functionality and tools are available. SILK should evolve this into a user-facing capability and security manager.

Example:

```text
Calendar read          ON
Calendar write         APPROVAL
Gmail read             ON
Gmail send             APPROVAL
Contacts lookup        ON
OneNote write          ON
Web research           ON
Browser automation     ON
Device files           OFF
Camera                  OFF
Smart home              OFF
Agent code execution   OFF
```

This should integrate with Connections, Security, Activity, Agents, and native device permissions.

**PearlOS strategy:** Hybrid/direct adaptation where practical. Study its feature package/flag architecture, but retain SILK's own policy semantics and approval model.

---

## 7. SILK Workspace / Desktop Mode

**Priority: Medium-high, especially for Mac**

PearlOS's desktop/window model is worth adapting, but SILK should not become a fake operating-system shell on every device.

### Mac

Create a full **SILK Workspace** with movable/resizable/focusable panels such as:
- SILK conversation/Core
- Calendar
- Gmail
- Browser
- Canvas
- Projects
- Study
- Workouts
- media

SILK should be able to arrange these panels through typed UI commands.

Example:

> "Silk, put tomorrow's calendar beside the browser."

### iPhone

Use a focused native navigation experience rather than cramming desktop windows onto a phone.

### iPad

Use an adaptive workspace between the iPhone and Mac experiences.

### Web

The existing SILK client may eventually gain an optional workspace/window mode using reusable web patterns from PearlOS.

**PearlOS strategy:** Directly study and potentially adapt compatible web window-management components for SILK Web; recreate natively in SwiftUI/AppKit for Apple clients.

---

## 8. SILK Browse

**Priority: High for the native-client roadmap**

SILK should eventually contain a real browser surface rather than relying only on external Safari or background search APIs.

### Native implementation

Use Apple WebKit (`WKWebView`) inside SILK on iPhone/iPad/Mac.

Expected user features:
- URL/search bar
- tabs
- back/forward
- reload
- bookmarks
- history
- private sessions
- downloads
- find on page
- reader-style views where practical
- share/open in Safari
- full-screen media where supported

### AI browser capabilities

Expose explicit browser tools such as:

```text
browser.open_url
browser.search
browser.new_tab
browser.close_tab
browser.back
browser.forward
browser.read_page
browser.find_text
browser.click
browser.scroll
browser.fill_field
browser.extract_links
browser.summarize_page
```

The user and SILK should be able to operate the same browser surface.

### SILK Shield

Add privacy/content filtering using native WebKit content-rule lists and related controls where supported:
- known ad-domain blocking
- tracker blocking
- tracking-pixel blocking
- popup/popunder reduction
- malicious redirect blocking
- cookie/privacy controls
- per-site controls

This is intended as a privacy and browsing-quality feature. Do not design SILK around bypassing DRM, paywalls, subscriptions, authentication, or access controls.

### Browse vs Research

SILK should keep two complementary web systems:

```text
                    SILK WEB
                       |
             +---------+---------+
             |                   |
             v                   v
        SILK Browse         SILK Research
       visible browser      background retrieval
       user + AI control    search/fetch APIs
```

Tavily or another backend research provider may still be useful even after SILK Browse exists.

**PearlOS strategy:** Hybrid. Study PearlOS browser/tool/event implementations; reuse compatible non-commercial source when useful for the web client; build native Apple browsing around WebKit.

---

# What SILK should NOT inherit wholesale

Do not replace SILK's current core with PearlOS's full infrastructure merely for architectural similarity.

Avoid importing the entire PearlOS stack by default, including its full combination of:
- GraphQL mesh
- PostgreSQL backend
- multi-service monorepo
- Daily.co dependency
- Deepgram dependency
- Pipecat service
- PocketTTS service
- deployment topology

SILK's current lightweight cloud core should remain until a specific capability proves it needs a larger service.

Current SILK strengths to preserve:
- Cloudflare Worker deployment
- private D1 database
- Nano / Luna / Terra model routing
- owner authentication
- encrypted OAuth token storage
- approval queue for external writes
- auditable activity/usage logs
- simple web deployment
- planned native Apple clients

---

# Licensing and source tracking

PearlOS is distributed under the **PearlOS Source-Available License (PSAL-NC)** rather than MIT/Apache/BSD.

The project is currently planned as private, personal, non-commercial software. That is compatible with the intended non-commercial use direction, but license obligations still matter.

Before directly importing PearlOS code:

1. Read the current PearlOS `LICENSE` at the source commit being used.
2. Preserve copyright/license notices required by that license.
3. Record the source repository, source path, and commit SHA in the SILK change/commit or a dedicated attribution file.
4. Place any required license copy or attribution under `LICENSES/`.
5. Do not use PearlOS trademarks or present SILK as PearlOS/Pearl.
6. If SILK's distribution/commercial status ever changes, re-audit all PearlOS-derived code before proceeding.

Architecture ideas may be recreated independently even when direct source reuse is unnecessary.

---

# Suggested implementation sequence

This document does **not** mean these eight systems should interrupt the current v0.7 connection work.

Recommended order from the current project state:

```text
CURRENT
  |
  +-- Google Calendar
  +-- Gmail
  +-- Google Contacts
  +-- Microsoft OneNote
  +-- Tavily / background web research
  |
  v
FOUNDATION
  +-- formal SILK Capability Bus
  +-- capability permissions/feature flags
  +-- event-driven UI commands
  |
  v
EXPERIENCE
  +-- SILK Canvas
  +-- SILK Browse
  +-- stronger voice engine
  |
  v
NATIVE APP PHASE
  +-- iPhone native client
  +-- Mac native client
  +-- HealthKit / notifications / App Intents
  +-- SILK Workspace/Desktop Mode on Mac
  |
  v
AGENCY / DEVICES
  +-- orchestrator + bounded worker agents
  +-- local Mac bridge
  +-- optional device/home bridge
```

---

# Decision summary

**Decision: APPROVED.**

SILK will use PearlOS as an ongoing architecture and source-code reference for these eight areas:

1. SILK Capability Bus
2. AI-controlled SILK interface
3. SILK Canvas
4. Real-time SILK Voice Engine
5. SILK Orchestrator + Worker Agents
6. Feature flags + capability permissions
7. SILK Workspace / Desktop Mode
8. SILK Browse + SILK Shield

For each area, SILK may:
- directly adapt PearlOS code when appropriate,
- independently recreate the idea when SILK's stack differs,
- or use a hybrid of PearlOS implementation patterns and SILK-native architecture.

The governing principle is:

> **Use PearlOS to accelerate SILK, not to replace SILK. Preserve the parts of SILK that are already simpler, safer, cheaper, and more personal.**
