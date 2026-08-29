# PearlOS → SILK: Continuity, Pulse, Doctor + Library Plan

Status: **APPROVED roadmap extension / source-of-truth companion document**

Date approved: **2026-08-29**

Parent roadmap: `PEARLOS-SILK-INTEGRATION-PLAN.md`  
Related extension: `PEARLOS-SILK-COMMUNICATIONS-DEVICE-BRIDGE.md`

## Purpose

This document records the next approved SILK architecture additions after reviewing PearlOS and other assistant/personal-knowledge systems.

If a future chat, agent, or developer loses the original discussion, treat this file together with the two roadmap files above as the source of truth.

The approved additions are:

17. **SILK Continuity**
18. **SILK Pulse — deterministic-first**
19. **SILK Doctor**
20. **SILK Library Engine**

A separate room/smart-home satellite system is **not currently planned** and should not be treated as a near-term SILK requirement.

---

# Governing principles for these systems

## 1. Do not use AI when deterministic software is enough

SILK should not invoke Apple AI, a local model, or OpenAI merely because a timer fired or a background process ran.

Preferred execution order:

```text
Deterministic rule / direct query / search
        |
        +--> enough information? --> execute without AI
        |
        v
Optional Apple/local AI judgment
        |
        v
Optional larger local Mac model
        |
        v
OpenAI fallback only when genuinely useful
```

This applies especially to **SILK Pulse**, **SILK Doctor**, and most **SILK Library search** operations.

## 2. Other AI systems are components, not competing assistants

Khoj, Open WebUI, PrivateGPT, AnythingLLM, Onyx, RAGFlow, Mem0, Letta/MemGPT and similar projects should be treated as:

- architecture references,
- reusable components where licensing/technical fit permits,
- retrieval/memory/indexing engines,
- implementation examples.

They should **not** create a second assistant persona beside SILK.

SILK remains the only top-level personal assistant/orchestrator.

---

# 17. SILK Continuity

**Status: APPROVED CORE SYSTEM**

**Priority: High once native Mac + iPhone clients exist**

SILK Continuity makes all SILK clients feel like one assistant rather than separate apps that merely share a database.

Target experience:

```text
Mac
  |
  |  Trip Research Canvas
  |  active conversation
  |  browser context
  |  running task
  v
SILK Continuity
  |
  v
iPhone

"Continue Trip Research?"
```

Examples:

- "Silk, put this on my Mac."
- "Continue this on my phone."
- "Send this browser page to my iPhone."
- Start a Canvas on Mac and reopen the same logical Canvas on iPhone.
- Start research on one device and inspect the Activity Center from another.
- Preserve the current Context Mode across devices where appropriate.

## Continuity state

Initial synchronized/handoff state should include:

```text
conversation / conversation pointer
active task
Canvas state
open Library item
browser handoff URL / safe browser state
Context Mode
Activity / worker state
selected project/workout/study context
```

Do **not** require exact desktop-window coordinates to sync to iPhone. Each client should translate the shared logical state into its own native UI.

## Architecture

```text
               SILK CORE STATE
                      |
           +----------+----------+
           |          |          |
          Mac       iPhone      Web
           |          |          |
           +------ EVENT BUS ----+
                      |
                handoff events
```

Potential events/capabilities:

```text
continuity.session.updated
continuity.handoff.requested
continuity.handoff.accepted
continuity.canvas.updated
continuity.task.updated

silk.continuity.get_state
silk.continuity.handoff
silk.continuity.resume
silk.continuity.send_to_device
```

Continuity should be local/private where practical and use SILK Core only for the minimum synchronization state required.

---

# 18. SILK Pulse — deterministic-first proactive intelligence

**Status: APPROVED CORE SYSTEM**

**Priority: High after Event Bus, notifications, and core integrations are reliable**

SILK Pulse gives SILK proactive awareness without turning the assistant into a constantly-running LLM.

## Non-negotiable cost rule

> **A Pulse heartbeat must not invoke an LLM merely because it occurred.**

Normal Pulse operation should use:

- Event Bus events
- timestamps
- calendar deltas
- weather thresholds
- notification state
- device/bridge state
- worker errors
- explicit importance rules
- cooldowns and quiet hours
- numeric/scored prioritization

Most Pulse checks should cost **$0 in AI usage**.

## Example deterministic checks

```text
Calendar event changed?             rule
Meeting starts in 60 minutes?       rule
Departure time reached threshold?   rule
Rain before planned departure?      rule
Scheduled task failed?              rule
Important integration disconnected? rule
Reminder still incomplete?          rule
Battery/device bridge offline?      rule
```

## Importance engine

Example initial model:

```text
Event
  |
  v
Deterministic evaluator
  |
  v
Importance score

0-49    ignore / record only
50-79   queue for briefing / Activity
80-100  notify now
```

The exact score bands can be tuned later.

## Optional AI escalation

Only ambiguous cases should escalate:

```text
rules cannot confidently classify event
        |
        v
Apple/local model available?
        |
       YES --> optional lightweight judgment
        |
        NO
        v
queue it or apply conservative deterministic policy
```

OpenAI should **not** be a normal Pulse dependency. Cloud AI may be used only for an explicitly valuable edge case or a user-requested deeper analysis.

## Anti-annoyance rules

Pulse should support:

- notification cooldowns
- deduplication
- batching
- quiet hours
- Context Mode awareness
- urgency classes
- "do not remind again" state
- per-source notification preferences
- maximum proactive notifications per time window

The goal is useful awareness, not constant interruption.

Potential events/capabilities:

```text
pulse.event.evaluated
pulse.item.queued
pulse.notification.triggered
pulse.item.dismissed

silk.pulse.evaluate
silk.pulse.queue
silk.pulse.snooze
silk.pulse.dismiss
```

---

# 19. SILK Doctor

**Status: APPROVED CORE SYSTEM**

**Priority: High as SILK gains more integrations/devices**

SILK Doctor is a deterministic health, configuration, connectivity, security, and dependency checker for SILK itself.

User command:

> "Silk, check yourself."

Example output:

```text
SILK DOCTOR

CORE
✓ Cloudflare Worker
✓ D1
✓ Event Bus

AI
✓ Apple local model available
✓ Mac local model available
✓ OpenAI fallback configured

INTEGRATIONS
✓ Google Calendar
✓ Gmail
! OneNote needs reconnect

APPLE / DEVICES
✓ Notifications
✓ Messages Bridge
✓ iPhone Bridge

LIBRARY
✓ Index healthy
✓ Last sync 4 min ago
✓ Search engine available

SECURITY
✓ System Integrity Protection expected state
✓ secrets present
✓ no unexpected public bridge binding detected

STORAGE
✓ sufficient disk space
```

## Doctor should not need AI for health checks

Checks should primarily use:

- HTTP status probes
- local process state
- database integrity queries
- OAuth/token status metadata
- filesystem permissions
- bridge availability
- version checks
- storage capacity
- config/schema validation
- binding/port checks
- model availability probes

AI may optionally explain a confusing failure after the deterministic diagnostic data is collected, but AI is not required to run Doctor.

## Doctor responsibilities

Doctor should eventually inspect:

```text
SILK Core / Worker
D1 schema and connectivity
OAuth integrations
OpenAI fallback configuration
Apple/local model availability
Mac local-model runtime
Messages Bridge
iPhone Device Bridge
APNs/native notification setup
Library index and sources
Event Bus
Activity Center
Sandbox/Lab
browser automation bridge
storage/disk
permissions
security-sensitive local bridges
version compatibility
```

Potential capabilities/events:

```text
silk.doctor.run
silk.doctor.check
silk.doctor.explain
silk.doctor.repair_safe

doctor.check.completed
doctor.issue.detected
doctor.issue.resolved
```

Automatic repair should be restricted to safe, reversible actions. Sensitive or destructive repair remains approval-gated.

---

# 20. SILK Library Engine

**Status: APPROVED CORE SYSTEM**

**Priority: Very high after core integrations + native/local foundations**

SILK Library is the owner's searchable personal knowledge base. It is separate from SILK Memory.

## Core distinction

```text
PROFILE
Stable settings and explicit preferences

MEMORY
Facts/history SILK has learned or remembered

LIBRARY
Actual source documents and knowledge repositories

CONTEXT
What is happening right now

RECALL / TIMELINE
Historical device activity if that system is approved later
```

SILK should not answer factual questions about a source document from fuzzy memory when the Library can retrieve the original evidence.

## Example Library sources

```text
LOCAL
- Mac folders
- Documents
- Downloads
- PDFs
- Word/text/Markdown files
- spreadsheets where parsing is supported
- saved webpages
- project documentation

CONNECTED
- OneNote
- Google Drive when connected later
- Gmail attachments / selected email material
- GitHub repositories / documentation
- other approved connectors

SILK-GENERATED
- Canvas reports
- research reports
- study sessions
- exported notes
- saved Applets/data where appropriate
```

## Search should not require generative AI

Example:

> "Find the document that mentions Code Red."

Expected flow:

```text
Query
  |
  +--> metadata search
  +--> BM25 / keyword search
  +--> semantic vector retrieval
           |
           v
      local reranker
           |
           v
     exact source results
```

A normal retrieval query should be able to return source passages without calling an LLM.

AI is only needed when the user asks for reasoning/synthesis, for example:

> "Compare the Code Red procedures across these five documents and explain the differences."

Then SILK may retrieve the evidence first and route only the selected context to Apple/local AI or an optional fallback model.

## Required retrieval architecture

```text
                      SILK LIBRARY
                           |
               +-----------+-----------+
               |                       |
            SOURCES                  INDEX
               |                       |
         files/connectors          metadata
         OneNote/GitHub            keywords
         Drive/email               embeddings
         saved webpages            source links
               |                       |
               +-----------+-----------+
                           |
                    HYBRID SEARCH
                           |
                +----------+----------+
                |                     |
             BM25                  semantic
            keyword                 vector
                |                     |
                +----------+----------+
                           |
                    local reranker
                           |
                      evidence
                           |
             +-------------+-------------+
             |                           |
       show exact sources          reasoning needed?
             |                           |
           no LLM                         v
                                local model first
                                      |
                               cloud fallback only
                               when genuinely useful
```

## Citations are mandatory for Library answers

SILK Library should preserve provenance.

Example Canvas response:

```text
SILK LIBRARY

Answer
Annual Code Red education is required...

Sources
1. HHS Orientation Guide.pdf — page 14
2. Code Procedures.pdf — page 7

[OPEN SOURCE]
```

Where technically possible, source records should preserve:

```text
source name
source type
source URI/path
page/section
chunk/range
modified timestamp
index timestamp
connector/source ID
```

## Library workspaces / scopes

Borrow the useful workspace concept from document-AI systems without creating separate assistants.

Example scopes:

```text
School
Work
SILK OS
Personal
Travel
Finance
Projects
```

A query can search everything or a selected scope.

## Source adapters

Library should use a connector/adaptor model so new knowledge sources can be added without rebuilding search.

```text
Source Adapter
  |
  +--> discover items
  +--> read/stream content
  +--> extract metadata
  +--> normalize text
  +--> detect changes
  +--> update/delete index entries
```

Potential capabilities:

```text
silk.library.search
silk.library.open_source
silk.library.add_source
silk.library.remove_source
silk.library.reindex
silk.library.sync
silk.library.get_citations
silk.library.compare_sources
```

Potential events:

```text
library.source.added
library.source.updated
library.source.removed
library.index.completed
library.sync.completed
library.search.completed
```

---

# External projects approved for study/reference

These projects are **reference implementations or possible component sources**, not automatically approved wholesale dependencies. Before copying code, inspect current license and technical fit.

## Khoj

Repository: `khoj-ai/khoj`

Use as a primary reference for:

- personal AI / second-brain experience
- natural-language document search
- self-hosted/local knowledge access
- document-oriented personal knowledge UX

Decision: **study heavily; SILK remains the assistant.**

## Open WebUI Knowledge

Repository: `open-webui/open-webui`

Use as a reference for:

- knowledge collections
- hybrid retrieval concepts
- keyword + semantic retrieval
- reranking
- source/citation presentation
- document/folder synchronization patterns

Decision: **strong retrieval/search reference.**

## PrivateGPT

Repository: `zylon-ai/private-gpt`

Use as a reference/candidate component for:

- local document ingestion
- private/local RAG services
- parsing/chunking/metadata pipelines
- local embeddings
- local retrieval APIs

Decision: **evaluate as a Mac-local backend/component rather than a second UI.**

## AnythingLLM

Repository: `Mintplex-Labs/anything-llm`

Use as a reference for:

- document workspaces/scopes
- local/private document AI organization
- separating knowledge collections by purpose

Decision: **borrow workspace/library organization ideas.**

## Onyx

Repository: `onyx-dot-app/onyx`

Use as a reference for:

- many-source connector architecture
- knowledge-source synchronization
- hybrid information retrieval
- modular connector design

Decision: **study connector architecture; do not adopt its full enterprise stack by default.**

## RAGFlow

Repository: `infiniflow/ragflow`

Use as a reference for:

- complicated-document ingestion
- deep document parsing
- PDFs/tables/mixed layouts
- provenance/citation handling
- advanced RAG pipeline design

Decision: **study parsing/retrieval techniques; do not make the heavy RAGFlow deployment a SILK requirement.**

---

# Memory systems to study separately

These are **not the Library itself**.

## Mem0

Use as a reference for:

- personalized memory storage
- memory retrieval
- memory history/lifecycle
- deciding what belongs in long-term assistant memory

This belongs under a future SILK Memory redesign rather than being the core Library search engine.

## Letta / MemGPT

Current ecosystem reference: Letta (formerly MemGPT).

Use as an architecture reference for:

- persistent agent state
- memory blocks
- context management
- model-independent long-term state

Do **not** make Letta an always-running SILK agent runtime by default. SILK's local-first/no-expensive-agent-swarm rule remains in force.

---

# Explicit non-goal: room/smart-home satellites for now

A distributed room-assistant/satellite system is **not approved for current SILK scope**.

Do not prioritize:

- room microphones
- room voice satellites
- smart-light control
- room-aware assistant hardware
- Home Assistant/OpenVoiceOS satellite infrastructure

This can be revisited only if the owner later decides home/device automation has become relevant.

---

# Updated source-of-truth system map

The approved roadmap now includes at least these numbered systems/extensions:

```text
1-14   PearlOS-derived core systems
15     SILK Communications Hub
16     SILK Device Bridge
17     SILK Continuity
18     SILK Pulse
19     SILK Doctor
20     SILK Library Engine
```

The existing approved optional Media/Share modules remain valid; numbering in companion documents is architectural, not a software-version number.

---

# Suggested implementation placement

These additions should **not interrupt the current connection work**.

Recommended placement:

```text
CURRENT CONNECTIONS
  Google Calendar
  Gmail
  Google Contacts
  OneNote
  background web research
        |
        v
FOUNDATION
  Capability Bus
  Event Bus
  permissions
  Profile
  Activity Center
        |
        v
KNOWLEDGE FOUNDATION
  SILK Library ingestion/index/search
  source adapters
  citations
  Doctor checks for Library/integrations
        |
        v
NATIVE CLIENTS
  Mac + iPhone
  notifications
  local AI
  Device Bridge / Communications
        |
        v
CONTINUITY
  shared logical state
  handoff
        |
        v
PROACTIVE LAYER
  SILK Pulse
  deterministic rules first
        |
        v
ADVANCED LOCAL INTELLIGENCE
  optional Apple/local reasoning
  optional Mac-local models
  OpenAI fallback only when needed
```

---

# Decision summary

**APPROVED.**

SILK will add:

- **SILK Continuity** as the cross-device handoff/shared-state system.
- **SILK Pulse** as a deterministic-first proactive/event-prioritization system that does not burn AI tokens merely because it runs.
- **SILK Doctor** as a primarily deterministic health/security/configuration diagnostic system.
- **SILK Library Engine** as a local-first, citation-backed personal knowledge and document retrieval system.

SILK Library will study Khoj, Open WebUI Knowledge, PrivateGPT, AnythingLLM, Onyx and RAGFlow for compatible ideas/components. Mem0 and Letta/MemGPT remain references for the separate Memory architecture.

The governing rule remains:

> **Other AI systems may become tools, engines, or organs inside SILK. They do not replace SILK or become competing assistants. Search and automation should remain deterministic/local wherever possible, with AI invoked only when it adds real value.**
