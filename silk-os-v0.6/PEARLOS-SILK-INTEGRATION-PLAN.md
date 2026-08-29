# PearlOS → SILK Integration Plan

Status: **Approved roadmap / source-of-truth planning document**

Date added: 2026-08-28  
Last expanded: 2026-08-28

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

# Governing architecture rules

## Local-first intelligence

**SILK must not spend cloud AI tokens for work that can reasonably be performed locally at acceptable quality.**

Preferred routing order:

```text
Can deterministic code do it?
        |
       YES → run locally with no model
        |
        NO
        v
Can Apple's on-device model do it?
        |
       YES → Apple Foundation Models
        |
        NO
        v
Can a SILK-owned local model do it?
        |
       YES → Core AI / compatible local runtime
        |
        NO
        v
Can the Mac run a larger local model?
        |
       YES → local Mac inference
        |
        NO
        v
Optional cloud fallback → Nano / Luna / Terra
```

OpenAI remains valuable for difficult reasoning and fallback, but **SILK must not build a default OpenAI-powered multi-agent swarm.** The normal agent architecture should be local-first and effectively $0/token.

A worker also does not automatically mean an LLM. Many workers should be deterministic programs with typed inputs and outputs, supervised by one local model or SILK Core.

## Model hierarchy for agents

Preferred agent brains:

1. **Apple Foundation Models / System Language Model** for lightweight routing, tool selection, extraction, summaries, and normal on-device agent reasoning.
2. **Bring-your-own on-device models** through Apple's Core AI / Foundation Models-compatible model interfaces where a specialized or larger local model is useful.
3. **Local Mac models** for heavier coding, analysis, long tasks, and background workers when the Mac is reachable.
4. **OpenAI API only as an optional fallback** when the local layers cannot perform the task well enough.

The Capability Bus should make the model provider replaceable so a worker does not care whether its reasoning came from Apple, a local open-weight model, or a cloud fallback.

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
- task/activity UI patterns
- applet/event dispatch patterns

When code is directly copied or materially derived:
- preserve applicable PearlOS copyright/license notices
- record the PearlOS source file and commit used
- keep PearlOS license obligations with the derived code
- prefer small, traceable adaptations rather than importing the entire repository

## 2. Recreate from the idea

When PearlOS is tied to a different stack or when SILK needs a cleaner implementation, use the architecture as inspiration and write a SILK-native version.

This will be the default for native Apple functionality such as SwiftUI, AppKit, HealthKit, App Intents, notifications, WebKit browser surfaces, and native local-AI integrations.

## 3. Hybrid

Use PearlOS architecture and selected implementation details while rebuilding the surrounding system around SILK's existing backend, permissions, UI, data model, and local-first AI router.

This is expected to be the most common approach.

---

# The fourteen core PearlOS-derived SILK systems

## 1. SILK Capability Bus

**Priority: Highest**

Every important SILK ability becomes a typed, discoverable capability instead of one-off hard-coded model behavior.

Examples:

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
silk.applet.create
silk.activity.inspect
```

Each capability should declare at minimum:

```text
AVAILABLE
CONNECTED
READ / WRITE
APPROVAL_REQUIRED
CLIENT_REQUIREMENTS
LOCAL / CLOUD
COST_CLASS
```

Execution path:

```text
Local router / Apple model / local model / cloud fallback
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
Event Bus + Activity/Audit log
```

**PearlOS strategy:** Hybrid. Study its bot-tool registration/discovery architecture and reuse small compatible patterns where useful, but implement SILK's capability registry around the existing Worker, D1, approval queue, local models, and future native clients.

---

## 2. AI-controlled SILK interface

**Priority: High**

SILK should be able to operate its own UI through explicit typed interface capabilities.

Examples:
- "Silk, show me tomorrow" → navigate to Calendar/tomorrow
- "Open my workout" → open the workout interface
- "Put those emails on screen" → display Gmail results
- "Show that beside the browser" → arrange workspace surfaces
- "Close that and bring the browser back" → focus/close/open UI surfaces

The AI should never mutate arbitrary UI state directly. It should emit typed UI commands that the active client decides how to render.

**PearlOS strategy:** Hybrid/recreate. Borrow the event-driven idea and possibly compatible event-routing code for the web client. Recreate the native UI command layer in SwiftUI/AppKit.

---

## 3. SILK Canvas

**Priority: High**

PearlOS's Wonder Canvas is a strong reference for a dynamic visual surface controlled by the assistant.

SILK Canvas is **not an AI-image-generation feature**. The planned use is structured, interactive visual information rather than generated photos.

Canvas should display rich temporary or persistent views such as:
- weather
- calendar timelines
- maps
- web research
- emails
- workout charts
- training-week visualizations
- study diagrams
- project roadmaps
- comparison tables
- dashboards
- financial views
- task boards
- browser pages
- media
- interactive applets

Example: "Visualize my training week" should render useful charts, cards, timeline blocks, volume/recovery metrics, and recommendations, not generate a picture.

The Canvas is the place where SILK can visually "put something up on the screen."

**PearlOS strategy:** Hybrid. Study Wonder Canvas architecture and selected reusable web code. Rebuild the visual language to match SILK. Native versions should use SwiftUI/AppKit/WebKit.

---

## 4. Real-time SILK Voice Engine

**Priority: High, after core integrations are stable**

SILK ultimately needs a true conversational voice experience:
- low-latency conversation
- voice activity detection
- interruption/barge-in
- streamed speech recognition
- streamed responses
- tool calls during a conversation
- natural TTS
- "Hey Silk" / wake interaction where technically practical

The default native implementation should prefer on-device Apple speech/AI capabilities where available rather than requiring paid speech APIs.

Do **not** automatically copy PearlOS's entire Daily.co + Deepgram + Pipecat + PocketTTS stack. Use PearlOS primarily as an architecture reference for turn-taking, interruption, tool execution, and conversational state.

**PearlOS strategy:** Architecture inspiration first; selective code adaptation only where it clearly reduces work.

---

## 5. SILK Orchestrator + Worker Agents

**Priority: High for the later Agents phase**

PearlOS separates the conversational companion from execution workers. SILK should adopt this principle without creating an expensive cloud-agent swarm.

### Non-negotiable cost rule

**No default OpenAI-powered agent swarm.**

Worker reasoning should use, in order:
- deterministic code when possible
- Apple on-device AI
- SILK-owned custom/local on-device models
- larger local Mac models
- OpenAI only as explicit fallback for tasks that exceed local capability

SILK Core remains responsive while specialized workers perform bounded jobs.

Target concept:

```text
                          SILK
                            |
                      ORCHESTRATOR
                            |
          +-----------------+-----------------+
          |                 |                 |
          v                 v                 v
 Deterministic worker   Local AI worker   Mac AI worker
          |                 |                 |
      APIs/files       Apple/Core AI       larger local LLM
          |                 |                 |
          +-----------------+-----------------+
                            |
                    optional cloud fallback
```

Potential workers:
- research worker
- browser worker
- study curator
- project auditor
- coding/build worker
- email/calendar operator
- workout/data worker
- local Mac/file worker
- smart-home/device worker

Important: multiple worker roles do **not** require multiple models. A single local model can supervise many typed workers, and deterministic workers should be preferred whenever reasoning is unnecessary.

Workers receive only the capabilities necessary for their task and remain subject to SILK permissions and owner approvals.

**PearlOS strategy:** Hybrid. Reuse orchestration/dispatch lessons and small patterns where useful; build SILK's own local-first agent runtime around its Capability Bus.

---

## 6. Feature flags + capability permissions

**Priority: High**

PearlOS uses feature flags to determine what functionality/tools are available. SILK should evolve this into a user-facing capability and security manager.

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
Browser downloads      ASK
Memory delete          APPROVAL
Device files           OFF
Camera                  OFF
Smart home              OFF
Agent code execution   OFF
Cloud AI fallback       ON
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
- Activity Center
- Media

SILK should be able to arrange these panels through typed UI commands.

Example:

> "Silk, put tomorrow's calendar beside the browser."

### iPhone

Use focused native navigation rather than cramming desktop windows onto a phone.

### iPad

Use an adaptive workspace between iPhone and Mac experiences.

### Web

The existing SILK client may eventually gain an optional workspace/window mode using reusable web patterns from PearlOS.

**PearlOS strategy:** Directly study and potentially adapt compatible web window-management components for SILK Web; recreate natively in SwiftUI/AppKit for Apple clients.

---

## 8. SILK Browse + SILK Shield

**Priority: High for native-client roadmap**

SILK should eventually contain a real browser surface, not only background search APIs.

### SILK Browse

Native Apple clients should use WebKit (`WKWebView`). Expected features:
- URL/search bar
- tabs
- back/forward/reload
- bookmarks
- history
- private sessions
- downloads
- find on page
- reader-style views where practical
- share/open externally
- full-screen media where supported

AI browser tools:

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

Privacy/content filtering:
- known ad-domain blocking
- tracker blocking
- tracking-pixel blocking
- popup/popunder reduction
- malicious redirect blocking
- cookie/privacy controls
- per-site permissions

Do not design SILK around bypassing DRM, paywalls, subscriptions, authentication, or access controls.

### Browse vs Research

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

**PearlOS strategy:** Hybrid. Study PearlOS browser/tool/event implementations; reuse compatible non-commercial source when useful for the web client; build native Apple browsing around WebKit.

---

## 9. SILK Applets

**Priority: High after Canvas foundation**

PearlOS includes AI-created interactive HTML/app-like surfaces. SILK should add an Applet runtime so Canvas can become interactive instead of merely presenting static information.

Examples:
- savings planner
- nursing-school comparison board
- dosage calculator
- training-volume calculator
- MLB matchup viewer
- trip comparison tool
- study quiz
- custom data explorer

Concept:

```text
User request
    |
    v
SILK understands required mini-tool
    |
    v
Applet specification / safe code
    |
    v
Sandboxed Applet runtime
    |
    v
Interactive view inside Canvas
```

Applets should operate through approved capabilities rather than receiving unrestricted access to SILK data.

**PearlOS strategy:** Hybrid/direct adaptation where useful for web applet generation and event patterns; build a SILK-specific safe runtime and native rendering strategy.

---

## 10. SILK Activity Center

**Priority: High before advanced agents**

PearlOS includes task/process visibility. SILK needs a clear place to show what the system is currently doing.

Activity Center itself is local UI/state and does **not** require paid AI.

It should show:
- active workers
- background research
- browser automation
- Calendar/Gmail/OneNote syncs
- queued jobs
- approvals waiting
- completed actions
- failures/retries
- local vs cloud execution
- model/provider used when AI was required
- estimated cloud cost when applicable
- scheduled/recurring work

Controls:

```text
PAUSE
CANCEL
RETRY
INSPECT
APPROVE / DENY
```

Example:

```text
ACTIVE
● Researching Montreal trip     Local research worker
● Syncing Calendar              Google Calendar

QUEUED
○ Analyze workout history

COMPLETED
✓ Morning briefing
✓ OneNote study sync

FAILED
! Weather refresh              Retry
```

**PearlOS strategy:** Hybrid. Study Task Manager/process UI and execution-state patterns, but connect it to SILK's own Event Bus, audit logs, approvals, and worker runtime.

---

## 11. SILK Event Bus

**Priority: Highest foundation, alongside Capability Bus**

Capability Bus answers: **What can SILK do?**  
Event Bus answers: **What just happened?**

Examples:

```text
calendar.event.created
calendar.sync.completed
gmail.message.drafted
browser.page.loaded
browser.download.completed
workout.set.completed
agent.task.started
agent.task.completed
canvas.view.created
applet.updated
approval.requested
```

Example flow:

```text
calendar.create()
      |
      v
Google Calendar succeeds
      |
      v
calendar.event.created
      |
      +--> Calendar UI refresh
      +--> Canvas refresh
      +--> Activity Center success
      +--> optional memory update
      +--> Voice response: "Done."
```

Use typed events and explicit subscribers rather than hidden cross-component side effects.

**PearlOS strategy:** Hybrid/direct inspiration from its layered event architecture; implement a SILK-specific event contract shared by web/native clients and backend workers.

---

## 12. SILK Context Modes

**Priority: Medium-high**

PearlOS has desktop modes. SILK should expand this into behavioral modes that change which capabilities, layouts, notifications, and information are prioritized.

Initial modes:

```text
NORMAL
WORK
STUDY
GYM
DRIVING
TRAVEL
SLEEP
FOCUS
```

Examples:

### Study Mode
- Canvas prioritizes notes/flashcards
- OneNote is prominent
- notifications reduced
- concise educational voice style
- study Workspace layout

### Gym Mode
- workout controls primary
- rest timer prominent
- short voice responses
- training Canvas available
- distracting modules hidden

### Work Mode
- Calendar/Gmail/tasks primary
- work Workspace layout
- personal distractions reduced

### Travel Mode
- maps/weather/bookings/calendar/currency/browser prominent

Modes may initially be manual. Later SILK may suggest or activate them based on location, calendar, device state, or user command, subject to permissions.

**PearlOS strategy:** Recreate/hybrid. Use PearlOS HOME/WORK mode ideas as inspiration but implement SILK's broader context-aware state machine.

---

## 13. SILK Profile Layer

**Priority: Medium, before memory becomes large**

Stable configuration must be separate from episodic/semantic memory.

```text
PROFILE = stable settings/preferences
MEMORY  = learned facts/history
CONTEXT = what is happening right now
```

Profile examples:
- preferred name
- home city/timezone
- preferred units
- language
- browser search engine
- voice configuration
- workout units
- Calendar defaults
- AI routing preferences
- privacy defaults
- notification preferences
- default Workspace layouts
- Context Mode preferences

SILK should not perform fuzzy memory retrieval for settings that belong in deterministic profile storage.

**PearlOS strategy:** Recreate/hybrid using its profile/preferences concept while storing SILK profile data in a dedicated typed schema.

---

## 14. SILK Sandbox / Lab

**Priority: Later, especially for Mac**

PearlOS's newer architecture separates conversational orchestration from controlled execution environments. SILK should have an isolated Lab where workers can safely test things without modifying the production SILK core.

Potential Lab capabilities:
- run Python
- run JavaScript
- create temporary files
- analyze datasets
- test code
- prototype applets
- clone/inspect GitHub repositories
- run calculations
- compile/test local projects
- benchmark local models

Flow:

```text
SILK
  |
  v
Coding / analysis worker
  |
  v
SILK LAB (isolated)
  |
  v
Test / inspect / produce result
  |
  v
Owner review / approval if production change is needed
  |
  v
Real system
```

The Sandbox should default to no production secrets, no destructive access, and only explicitly granted capabilities.

**PearlOS strategy:** Hybrid. Adopt separation-of-duties and sandbox lessons rather than copying PearlOS deployment infrastructure wholesale.

---

# Additional approved optional modules

These are approved ideas but do not need to become independent foundation layers immediately.

## 15. SILK Media

PearlOS includes YouTube and soundtrack/media controls. SILK may eventually provide a unified Media panel through Browse/native media frameworks.

Possible capabilities:
- YouTube/web video
- music
- podcasts
- play/pause/seek
- queue
- volume
- Now Playing
- handoff between devices where practical

This should remain secondary to SILK's productivity/personal-OS mission and does not need an animated companion/sprite system.

## 16. SILK Share / Export

Canvas, Applets, research, schedules, workouts, and reports should be exportable.

Examples:
- export Canvas to PDF
- save Canvas snapshot
- create a document from research
- export training summary
- invoke native share sheet
- save structured data locally
- send/share through explicitly approved connected capabilities

This can initially live inside Canvas and individual modules rather than becoming a separate navigation area.

---

# Features intentionally NOT prioritized from PearlOS

Do not copy every PearlOS feature merely because it exists.

Currently low priority / intentionally excluded:
- animated sprite/character overlays
- decorative AI companion avatars
- mandatory ambient soundtrack behavior
- PearlOS branding/trademarks
- full PearlOS infrastructure topology

SILK should remain a clean personal operating/intelligence environment rather than becoming a virtual-character toy.

---

# What SILK should NOT inherit wholesale

Do not replace SILK's current core with PearlOS's full infrastructure merely for architectural similarity.

Avoid importing the entire PearlOS stack by default, including its full combination of:
- GraphQL mesh
- PostgreSQL backend
- multi-service deployment topology
- Daily.co dependency
- Deepgram dependency
- Pipecat service
- PocketTTS service

SILK's current lightweight cloud core should remain until a specific capability proves it needs a larger service.

Current SILK strengths to preserve:
- Cloudflare Worker deployment
- private D1 database
- Nano / Luna / Terra model routing as optional cloud intelligence
- owner authentication
- encrypted OAuth token storage
- approval queue for external writes
- auditable activity/usage logs
- simple web deployment
- planned native Apple clients
- local-first intelligence direction

---

# Licensing and source tracking

PearlOS is distributed under the **PearlOS Source-Available License (PSAL-NC)** rather than MIT/Apache/BSD.

The project is currently planned as private, personal, non-commercial software. License obligations still matter.

Before directly importing PearlOS code:

1. Read the current PearlOS `LICENSE` at the source commit being used.
2. Preserve copyright/license notices required by that license.
3. Record the source repository, source path, and commit SHA in the SILK change/commit or a dedicated attribution file.
4. Place any required license copy or attribution under `LICENSES/`.
5. Do not use PearlOS trademarks or present SILK as PearlOS/Pearl.
6. If SILK's distribution/commercial status ever changes, re-audit all PearlOS-derived code before proceeding.

Architecture ideas may be recreated independently even when direct source reuse is unnecessary.

---

# Updated implementation sequence

Do **not** build all systems at once. This roadmap extends the current v0.7 work rather than interrupting it.

```text
CURRENT CONNECTIONS
  |
  +-- Google Calendar
  +-- Gmail
  +-- Google Contacts
  +-- Microsoft OneNote
  +-- Tavily / background web research
  |
  v
FOUNDATION
  +-- SILK Capability Bus
  +-- SILK Event Bus
  +-- capability permissions / feature flags
  +-- SILK Profile Layer foundation
  +-- Activity Center foundation
  |
  v
VISUAL / INTERACTION
  +-- AI-controlled SILK interface
  +-- SILK Canvas
  +-- SILK Applets
  +-- SILK Browse + Shield
  +-- Context Modes
  |
  v
NATIVE APP PHASE
  +-- iPhone native client
  +-- Mac native client
  +-- Apple Foundation Models integration
  +-- bring-your-own local model support
  +-- on-device speech / voice engine
  +-- HealthKit / notifications / App Intents
  |
  v
WORKSPACE
  +-- SILK Workspace/Desktop Mode on Mac
  +-- adaptive iPad Workspace
  +-- Activity Center full UI
  +-- Media / Share / Export as useful
  |
  v
LOCAL AGENCY
  +-- local-first orchestrator
  +-- deterministic workers
  +-- Apple-AI workers
  +-- custom on-device model workers
  +-- larger local Mac workers
  +-- SILK Sandbox / Lab
  +-- local Mac bridge
  +-- optional device/home bridge
  +-- OpenAI fallback only when required
```

---

# Long-term architecture map

```text
                              SILK
                               |
                         AI ORCHESTRATOR
                               |
              +----------------+----------------+
              |                                 |
       MODEL ROUTER                       CAPABILITY BUS
              |                                 |
    +---------+---------+             +---------+---------+
    |         |         |             |         |         |
Apple AI   Local AI   OpenAI        Data      Action      UI
    |      Mac/CoreAI  fallback       |         |          |
    |                                 |         |          |
    |                           Calendar     Agents     Workspace
    |                           Gmail        Browser    Canvas
    |                           Contacts     Applets    Navigation
    |                           Memory       Sandbox    Activity
    |                           Profile
    |                           Projects
    |                           Workout
    |                                 |
    +--------------------------- EVENT BUS ----------------------+
                                      |
                         +------------+------------+
                         |            |            |
                       Voice       Context       Security
                                    Modes       Approvals
```

---

# Decision summary

**Decision: APPROVED AND EXPANDED.**

SILK will use PearlOS as an ongoing architecture and source-code reference for these fourteen core systems:

1. SILK Capability Bus
2. AI-controlled SILK interface
3. SILK Canvas
4. Real-time SILK Voice Engine
5. SILK Orchestrator + Worker Agents
6. Feature flags + capability permissions
7. SILK Workspace / Desktop Mode
8. SILK Browse + SILK Shield
9. SILK Applets
10. SILK Activity Center
11. SILK Event Bus
12. SILK Context Modes
13. SILK Profile Layer
14. SILK Sandbox / Lab

Additionally approved for later integration:
15. SILK Media
16. SILK Share / Export

For each area, SILK may:
- directly adapt PearlOS code when appropriate,
- independently recreate the idea when SILK's stack differs,
- or use a hybrid of PearlOS implementation patterns and SILK-native architecture.

## Agent cost decision

**SILK will not use an OpenAI multi-agent swarm as its default agent architecture.**

Normal agency should be built from deterministic workers plus Apple/local models. OpenAI remains an optional fallback for tasks that genuinely exceed local capability.

The governing principle is:

> **Use PearlOS to accelerate SILK, not to replace SILK. Keep SILK local-first, private, low-cost, auditable, and capable of using cloud intelligence only when it provides a real advantage.**
