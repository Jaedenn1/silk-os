# PearlOS → SILK: Communications + Device Bridge Plan

Status: **APPROVED roadmap extension / source-of-truth companion document**

Date approved: 2026-08-28

Parent roadmap: `PEARLOS-SILK-INTEGRATION-PLAN.md`

## Purpose

This document extends the approved PearlOS → SILK roadmap with communication and Apple-device capabilities researched after the original PearlOS architecture review.

These are now part of the long-term SILK plan. If a future chat, agent, or developer loses the original conversation, treat this file together with `PEARLOS-SILK-INTEGRATION-PLAN.md` as the source of truth.

The goals are:

- let SILK understand and help manage the owner's communications,
- let SILK reach the owner through native Apple notifications and an optional iMessage identity,
- give SILK a controlled bridge to the owner's iPhone through the Mac,
- keep normal operation local-first and low/no recurring cost,
- preserve explicit approval for outbound or destructive actions,
- avoid weakening macOS/iOS security merely to obtain convenience features.

---

# Approved architecture additions

## 15. SILK Communications Hub

**Status: APPROVED CORE SYSTEM**

The Communications Hub unifies messages, notifications, WhatsApp, voicemail, and SILK-originated alerts behind typed capabilities and the existing SILK permission/approval model.

Target architecture:

```text
                         SILK
                           |
                 COMMUNICATIONS HUB
                           |
       +-------------------+-------------------+
       |                   |                   |
       v                   v                   v
    Messages          Notifications        WhatsApp
       |                   |                   |
  Mac Messages       Native SILK +       experimental
      bridge          mirrored phone       bridges
       |
       +-------------------+-------------------+
                           |
                        Voicemail
                     experimental live
```

### 15.1 iMessage + SMS/RCS bridge

**Status: STRONG / PLANNED**

SILK should be able to read, search, watch, summarize, and—only with the configured approval policy—send messages that are available in the owner's macOS Messages environment.

Primary researched implementation reference:

- `openclaw/imsg`
- macOS Messages local database: `~/Library/Messages/chat.db`

Useful capabilities exposed by this class of local bridge include:

```text
messages.list_conversations
messages.read
messages.search
messages.watch
messages.attachments
messages.draft
messages.send
```

Planned SILK permissions:

```text
Messages read          ON
Messages search        ON
Messages watch         ON
Messages summarize     ON
Messages draft         ON
Messages send          APPROVAL
Messages delete        OFF by default
```

SMS/RCS availability depends on the messages actually being synchronized/forwarded into the Mac Messages environment from the iPhone/carrier setup.

### Implementation principles

- Prefer read-only access to the local Messages database for reads.
- Keep System Integrity Protection enabled.
- Grant only the macOS permissions actually required, such as Full Disk Access for local message-database reads and Automation/Accessibility only where needed for approved sending.
- Do not expose the raw Messages database to the public internet.
- Put a SILK-local API/bridge in front of the data with scoped capabilities.
- Record sends in the SILK Activity/Audit system.
- Sending should remain owner-approval gated unless a future user policy explicitly allows a narrow automatic case.

### Additional references

BlueBubbles proves a broader Mac-hosted iMessage bridge/server architecture is possible, but SILK should not adopt BlueBubbles' entire stack or disable SIP for advanced private-API features merely to obtain typing indicators/effects/etc.

A smaller `imsg`-style bridge is the preferred starting point.

---

### 15.2 SILK native notifications

**Status: STRONG / PLANNED**

The native iPhone/iPad/Mac SILK clients should support free Apple notifications as the primary way SILK proactively reaches the owner.

Use:

- local notifications for on-device scheduled reminders,
- Apple Push Notification service (APNs) for notifications originating from SILK Core or another authorized SILK device,
- actionable notification buttons,
- notification deep links into the correct SILK view,
- Apple Watch delivery when available through the native ecosystem.

Example:

```text
SILK

You need to leave in 17 minutes.
Traffic added 11 minutes.

[OPEN DAY] [SNOOZE]
```

Potential events:

```text
notification.scheduled
notification.delivered
notification.opened
notification.action.selected
```

Native SILK notifications are the default proactive channel because they do not require renting a telephone number or paying per SMS.

---

### 15.3 SILK iMessage identity

**Status: STRONG / PLANNED, REQUIRES PROTOTYPE**

Goal: allow the owner to have a real Messages conversation thread with SILK without paying for a dedicated cellular/SMS number.

Target concept:

```text
Messages

SILK
Don't forget — gym at 5:00.
I've opened today's session.

Owner:
Push it to 5:30.
```

Potential implementation:

- create a dedicated Apple Account/email identity for SILK,
- run that identity in an appropriate Mac Messages environment (for example a dedicated macOS user/session or dedicated Mac host),
- connect that Messages environment to SILK through the local bridge,
- let SILK receive owner messages and send iMessages subject to policy.

Important:

- This is an iMessage identity, not a guaranteed dedicated telephone number.
- Do not assume silent/background automation works until proven on the actual Mac setup.
- Test account/session separation carefully so the owner's personal Messages identity and SILK's identity do not become entangled.
- Store credentials using Apple/macOS secure credential facilities; never place Apple Account credentials in GitHub.

This capability is intended to give SILK a psychologically distinct communication channel while remaining free per message.

---

### 15.4 WhatsApp read + send

**Status: EXPERIMENTAL / APPROVED TO PURSUE**

The owner wants SILK to eventually read/search/summarize WhatsApp and draft/send responses.

There is no assumption that a normal personal WhatsApp inbox exposes a stable official personal-assistant API. The researched paths are therefore experimental.

#### Route A — linked-device bridge

Open-source references include:

- `wwebjs/whatsapp-web.js`
- Baileys-family WhatsApp multi-device protocol libraries

Possible capabilities:

```text
whatsapp.read
whatsapp.search
whatsapp.watch
whatsapp.draft
whatsapp.send
```

Because these are unofficial client/protocol approaches, they may break when WhatsApp changes and may create account-policy risk.

#### Route B — SILK Device Bridge controlling the real WhatsApp app

Preferred safer fallback where practical:

```text
SILK
  |
  v
Device Bridge
  |
  v
real iPhone / WhatsApp UI
```

SILK can open the real app, inspect the visible interface, navigate to a chat, prepare a response, and send only after approval.

This is slower than a direct bridge but avoids making an unofficial WhatsApp protocol implementation a foundational dependency.

#### WhatsApp policy

```text
WhatsApp read          EXPERIMENTAL
WhatsApp search        EXPERIMENTAL
WhatsApp draft         EXPERIMENTAL
WhatsApp send          APPROVAL + EXPERIMENTAL
```

No WhatsApp approach should be declared stable until it is tested end-to-end on the owner's actual account/device setup.

---

### 15.5 Live voicemail integration

**Status: EXPERIMENTAL / APPROVED TO PURSUE**

SILK should eventually be able to detect, surface, transcribe/summarize, and help act on voicemail.

There is not currently a normal public iOS developer API that SILK should assume can directly enumerate the system Visual Voicemail inbox.

Researched implementation routes:

#### Route A — macOS Phone app automation

On current macOS versions with Apple's Phone app, investigate Accessibility/UI automation for the Voicemail interface.

Potential actions:

```text
voicemail.list
voicemail.open
voicemail.play
voicemail.read_transcript
```

#### Route B — SILK Device Bridge

Use iPhone control through macOS iPhone Mirroring to operate:

```text
Phone → Voicemail
```

and read the visible transcript/interface where technically reliable.

#### Route C — backup ingestion

Open-source `iphone-voicemail-exporter` demonstrates extraction of voicemail metadata/audio from iPhone Finder backups, including the voicemail database path associated with backup data.

This is useful as a fallback/history import even if it is not sufficiently live for immediate voicemail alerts.

#### Planned behavior

When live integration is proven, SILK may produce:

```text
SILK
New voicemail from Dad — 47 seconds.
Summary: calling about dinner tomorrow.

[LISTEN] [CALL BACK] [DISMISS]
```

Voicemail deletion or other destructive actions should remain approval-gated/off by default.

---

## 16. SILK Device Bridge

**Status: APPROVED CORE SYSTEM**

The Device Bridge gives SILK a controlled way to interact with Apple devices when an app/service does not expose an appropriate API.

This is separate from the Communications Hub because the same bridge can later support many non-communication use cases.

### 16.1 iPhone-control bridge

**Status: STRONG / PLANNED, REQUIRES PROTOTYPE**

Primary researched open-source reference:

- `leeguooooo/iphone-use`

The project demonstrates self-hosted control of a real iPhone through macOS iPhone Mirroring, including a machine/agent-facing interface.

This creates a possible SILK path like:

```text
SILK Capability Bus
        |
        v
SILK Device Bridge
        |
        v
macOS iPhone Mirroring
        |
        v
real iPhone UI
```

Potential capabilities:

```text
device.iphone.status
device.iphone.view
device.iphone.open_app
device.iphone.tap
device.iphone.scroll
device.iphone.type
device.iphone.back
device.iphone.run_flow
```

Potential uses beyond Communications:

- WhatsApp UI operations,
- Phone/voicemail navigation,
- interacting with apps that do not provide APIs,
- reading user-visible information when expressly authorized,
- future device automation.

### Safety rules

- Keep the bridge local/private by default.
- Do not expose unrestricted remote touch/control to public endpoints.
- Typed high-level capabilities should be preferred over arbitrary raw coordinate automation.
- Sensitive actions require approval.
- Password/passcode entry, financial transactions, destructive actions, security-setting changes, and similarly sensitive operations should not be automatically executed merely because raw UI control exists.
- Record device actions in Activity Center/Audit logs.
- Prefer official APIs when they exist; use UI control as a fallback.

---

### 16.2 SILK reading iPhone notifications through the Mac

**Status: STRONG RESEARCH LEAD / PLANNED PROTOTYPE**

Apple's iPhone Mirroring/Continuity system can surface iPhone notifications on the Mac. SILK should investigate using the Mac as a local notification observation bridge.

Target flow:

```text
iPhone notification
        |
        v
Apple Continuity / iPhone Mirroring
        |
        v
Mac Notification Center
        |
        v
SILK Notification Bridge
        |
        v
Event Bus / Activity / local reasoning
```

Potential normalized event:

```text
phone.notification.received
```

Possible fields when available:

```text
source app
timestamp
title
subtitle
body
identifier
```

This could let SILK understand alerts from apps that otherwise have no API—for example WhatsApp or another installed iPhone app—without requiring full inbox access.

Important implementation status:

- macOS has local Notification Center state/databases that open-source forensic tools can parse,
- mirrored iPhone notifications are known to surface on the Mac,
- SILK must still prototype and verify exactly how mirrored iPhone notification payloads are stored/exposed on the owner's macOS version before this is called end-to-end complete.

Do not claim this capability is live until the actual SILK Mac bridge can identify and parse mirrored notifications reliably.

---

# Communications capability registry additions

The Capability Bus should eventually include at least:

```text
silk.messages.list
silk.messages.read
silk.messages.search
silk.messages.watch
silk.messages.draft
silk.messages.send

silk.notifications.schedule
silk.notifications.push
silk.notifications.inspect_phone

silk.whatsapp.read
silk.whatsapp.search
silk.whatsapp.draft
silk.whatsapp.send

silk.voicemail.list
silk.voicemail.read_transcript
silk.voicemail.play

silk.device.iphone.view
silk.device.iphone.open_app
silk.device.iphone.interact
```

Each capability must declare:

```text
AVAILABLE
CONNECTED
READ / WRITE
APPROVAL_REQUIRED
LOCAL / CLOUD
EXPERIMENTAL / STABLE
CLIENT_REQUIREMENTS
COST_CLASS
```

---

# Approval defaults

Recommended starting policy:

```text
iMessage/SMS/RCS read        ON
Message search               ON
Message watch                ON
Message send                 APPROVAL

SILK local notifications     ON
SILK APNs notifications      ON

Phone-notification read      ON after explicit bridge setup

WhatsApp read                EXPERIMENTAL + explicit opt-in
WhatsApp send                EXPERIMENTAL + APPROVAL

Voicemail read/transcript    EXPERIMENTAL + explicit opt-in
Voicemail play               USER INITIATED / APPROVAL
Voicemail delete             OFF

iPhone UI observation        explicit opt-in
iPhone safe navigation       explicit opt-in
iPhone sensitive actions     APPROVAL or OFF
```

---

# Cost principle

The communication architecture should remain consistent with SILK's local-first rule.

Preferred normal-cost model:

```text
Mac Messages bridge          $0/use
Native SILK notifications    $0/use
iPhone notification bridge   $0/use
iPhone-control bridge        $0/use
SILK iMessage identity       $0/message
WhatsApp local bridge        $0/use if used
Voicemail local bridge       $0/use
```

External service/carrier/account rules may still apply. A dedicated programmable cellular telephone number is intentionally **not** a core requirement because a reliable real phone number normally creates telecom/provider cost and dependency.

SILK should prefer native notifications + optional iMessage identity for proactive communication.

---

# Open-source/reference projects to evaluate during implementation

These projects are research references, not automatically approved dependencies:

- `openclaw/imsg` — local macOS Messages read/watch/send tooling
- `BlueBubblesApp/bluebubbles-server` — broader Mac-hosted Messages bridge architecture
- `leeguooooo/iphone-use` — self-hosted iPhone Mirroring control/agent bridge
- `wwebjs/whatsapp-web.js` — unofficial WhatsApp Web automation
- Baileys-family WhatsApp multi-device libraries — unofficial linked-device approach
- `sawwavecircuits/iphone-voicemail-exporter` — iPhone backup voicemail extraction

Before copying or importing code from any project:

1. inspect its current license at the exact commit,
2. record repository/path/commit,
3. preserve required notices,
4. prefer small, replaceable adapters,
5. avoid making an unofficial third-party protocol implementation a hard dependency when a safer official/local-UI route exists.

---

# Updated implementation sequence for these additions

These capabilities are approved but should not interrupt the current Google/OneNote/Tavily connection work.

```text
CURRENT CONNECTIONS
    |
    v
FOUNDATION
Capability Bus + Event Bus + Permissions
    |
    v
NATIVE MAC / IPHONE CLIENTS
    |
    +-- native SILK notifications
    +-- Mac local bridge foundation
    |
    v
COMMUNICATIONS V1
    +-- iMessage/SMS/RCS read/search/watch
    +-- message sending with approval
    +-- Activity Center events
    |
    v
DEVICE BRIDGE V1
    +-- iPhone Mirroring control prototype
    +-- mirrored-notification read prototype
    |
    v
SILK IDENTITY
    +-- dedicated iMessage identity prototype
    |
    v
EXPERIMENTAL COMMUNICATIONS
    +-- WhatsApp read/send
    +-- live voicemail
```

---

# Decision summary

**APPROVED.**

The following are now committed to the long-term SILK roadmap:

### Strong / planned

1. iMessage + SMS/RCS bridge
2. SILK native notifications
3. SILK reading iPhone notifications through the Mac
4. SILK iPhone-control bridge
5. SILK iMessage identity

### Experimental but approved to pursue

6. WhatsApp reading/sending
7. Live voicemail integration

These systems must integrate with the existing SILK Capability Bus, Event Bus, Activity Center, permissions, approvals, local-first intelligence architecture, and future native Apple clients.

The governing principle is:

> **Give SILK broad awareness and useful device control without turning private communications into an exposed cloud service. Keep data local where practical, make outbound/sensitive actions explicit and auditable, and use UI/device bridges only where cleaner APIs are unavailable.**
