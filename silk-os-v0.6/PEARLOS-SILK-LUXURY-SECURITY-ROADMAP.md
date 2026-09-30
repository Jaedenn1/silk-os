# SILK Luxury Features + Mandatory Security Launch Gate

Status: **APPROVED roadmap extension / source-of-truth companion document**

Date approved: **2026-09-30**

Parent roadmaps:
- `PEARLOS-SILK-INTEGRATION-PLAN.md`
- `PEARLOS-SILK-COMMUNICATIONS-DEVICE-BRIDGE.md`
- `PEARLOS-SILK-CONTINUITY-PULSE-DOCTOR-LIBRARY.md`

## Purpose

This document records four approved **luxury features**, two explicitly deferred "only if we ever get there" ideas, the mandatory **SILK Vault** password/secret manager, and one **mandatory pre-launch security program** for SILK.

If a future chat, agent, or developer loses the original discussion, treat this file together with the existing SILK roadmap documents as source of truth.

The governing product principle remains:

> SILK should feel powerful and deeply integrated, but it must remain private, local-first, auditable, low-cost, and conservative with sensitive data.

---

# Approved luxury features

These are approved additions, but they are **not allowed to delay core SILK usefulness or the security launch gate**.

## L1. SILK Active Context

**Status: APPROVED LUXURY FEATURE**

Goal: let SILK understand what the owner is actively working with so commands like "explain this", "save this", or "what am I looking at?" can work without manually copying context into SILK.

Potential context sources, subject to explicit permission:

```text
frontmost app
current browser page / URL
selected text
current file/document
clipboard contents
focused SILK Canvas/Applet
active project/workout/study context
current browser tab title
window/app identity
```

Example:

> "Silk, explain this."

SILK should be able to determine whether "this" means the selected paragraph, current webpage, current document, or active Canvas.

### Privacy rules

- OFF by default until the owner opts in.
- Scope permissions by app/source.
- Never capture password fields or secure text inputs.
- Never read protected/secret fields unless explicitly supported and required.
- Allow per-app exclusion.
- Allow a visible "context paused" state.
- Prefer ephemeral context over long-term storage.
- Context acquisition should be local-first.
- Raw active context should not be sent to cloud AI unless the owner permits it and the task genuinely requires it.

### Possible capabilities

```text
silk.context.get_active_app
silk.context.get_selection
silk.context.get_current_page
silk.context.get_current_file
silk.context.get_clipboard
silk.context.pause
silk.context.resume
```

---

## L2. SILK Command Bar

**Status: APPROVED LUXURY FEATURE**

Goal: provide a universal, fast SILK entry point across macOS without requiring the full SILK app to be open and focused.

Concept:

```text
global shortcut
      |
      v
SILK COMMAND BAR
      |
      +-- Ask SILK
      +-- Run a capability
      +-- Open a SILK surface
      +-- Search Library
      +-- Trigger a routine
      +-- Act on current context
```

Potential commands:

- Open Calendar
- Search Messages
- Start Workout
- Ask about this page
- Search SILK Library
- Open Canvas
- Run Morning Routine
- Open Activity Center
- Run SILK Doctor

### Design rules

- Native macOS implementation preferred.
- Fast startup and minimal latency.
- Works with keyboard-first interaction.
- Uses the same Capability Bus and permission model as the main SILK app.
- Must not bypass approval requirements.
- Sensitive commands should surface a clear approval step.
- Global hotkey should be configurable.

---

## L3. SILK Skills / Routines

**Status: APPROVED LUXURY FEATURE**

Goal: package reusable multi-step workflows above the Capability Bus so common tasks can run deterministically without requiring an LLM every time.

A Capability is one action. A Skill/Routine is a reusable composition of capabilities.

Example:

```text
Capability:
calendar.read

Capability:
weather.read

Capability:
notifications.schedule

Capability:
workout.open

        |
        v

Routine:
"Prepare for Work"
```

Possible routines:

- Morning Briefing
- Prepare for Work
- Gym Session
- Study Session
- Night Routine
- Payday Review
- Weekly Review
- Trip Prep
- Before Shift
- After Shift

### Execution rule

Prefer:

```text
saved routine definition
       |
       v
deterministic steps
       |
       +--> only invoke AI if a step genuinely requires reasoning
```

A routine should not become an excuse to call an LLM for every step.

### Required routine features

- named routine
- owner-editable steps
- dry-run preview
- per-step permissions
- approval-gated consequential actions
- pause/cancel
- error handling
- retry
- Activity Center visibility
- optional schedule/event trigger
- version history for routine edits

### Possible capabilities/events

```text
silk.skills.list
silk.skills.run
silk.skills.create
silk.skills.edit
silk.skills.disable

skill.started
skill.step.completed
skill.failed
skill.completed
```

---

## L4. SILK Undo / Change Journal

**Status: APPROVED LUXURY FEATURE**

Goal: make SILK actions reversible wherever technically possible.

Activity Center answers:

> What is SILK doing?

Change Journal answers:

> What did SILK change, and can I undo it?

Example:

```text
SILK CHANGE JOURNAL

09:42
Calendar event changed
08:00 -> 09:00
[UNDO]

09:31
Moved file
Downloads -> Work
[UNDO]

09:18
Updated workout target
[UNDO]
```

### Journal requirements

For every reversible state-changing action, record where practical:

```text
timestamp
actor / worker
capability used
target
before-state reference
after-state reference
approval record
device/client
undo availability
undo expiry if any
result
```

### Safety model

- Undo must itself be permission checked.
- Some actions cannot be truly undone (for example, external messages already delivered).
- For irreversible actions, show "not reversible" before execution.
- Prefer soft-delete/versioning over hard-delete where practical.
- File operations should prefer recoverable moves/trash over destructive deletion.
- Calendar/contact/note edits should preserve enough previous state to restore when possible.
- Undo history must not become a secret-leak log; sensitive payloads should be minimized/redacted/encrypted.

### Possible capabilities

```text
silk.journal.list_changes
silk.journal.inspect
silk.journal.undo
silk.journal.restore
```

---

# Deferred extras — not active roadmap commitments

These are interesting, but they should **not** compete with core SILK or the approved luxury features.

## D1. SILK Recall / Timeline

**Status: DEFERRED / ONLY IF WE EVER GET TO IT**

Potential idea:

- searchable historical device activity
- "What site was I looking at yesterday?"
- "What was I doing before I started studying?"

Reason for deferral:

- significant privacy sensitivity
- substantial storage requirements
- capture/exclusion complexity
- encryption and retention requirements
- risk of collecting information SILK never needed

If revisited, it must be opt-in, local-first, aggressively filtered, and designed with explicit retention/deletion controls.

---

## D2. Teach SILK Mode

**Status: DEFERRED / ONLY IF WE EVER GET TO IT**

Potential idea:

> "Silk, watch me do this once."

SILK observes a workflow, generalizes it, and proposes a reusable Skill.

Reason for deferral:

- difficult to generalize workflows reliably
- UI automation can be fragile
- requires Active Context + Device/UI control + Skills to be mature first
- needs strong safety constraints to prevent learned workflows from becoming overly broad

If revisited, learned routines must always be reviewed before activation.

---

# MANDATORY: SILK Security Program

**Status: NON-NEGOTIABLE PRE-LAUNCH REQUIREMENT**

SILK must **not** be considered finished, production-ready, or officially launched for personal daily use until the security release gate in this document passes.

SILK may eventually handle or access:

- schedules and location-adjacent calendar context
- email
- messages
- contacts
- voicemail
- private documents
- personal memory/profile data
- health/workout information
- OAuth tokens
- API keys
- private GitHub/project data
- device notifications
- browser state
- private files
- SILK Vault passwords
- passkeys/recovery codes where technically appropriate
- TOTP/2FA seeds if the owner chooses to store them
- other vault-protected secrets and credentials

The design target is not "perfect security"—that does not exist.

The target is:

> **Assume a skilled, persistent attacker. Make compromise difficult, expensive, noisy, compartmentalized, and recoverable.**

Security must be defense-in-depth. No single secret, process, bridge, model, device, or database compromise should automatically expose everything SILK can access.

---

## S0. Security principles

1. **Least privilege everywhere.**
2. **Local-first for the most sensitive data.**
3. **Do not store a secret SILK does not need.**
4. **Passwords are an intentional SILK feature, but plaintext credentials must exist only transiently during an explicitly authorized Vault operation. Persistent password storage belongs exclusively to the isolated, encrypted SILK Vault.**
5. **Every external capability gets an explicit permission scope.**
6. **Read access and write access are separate permissions.**
7. **Consequential writes require approval by default.**
8. **No public local bridge ports by default.**
9. **No secrets in source control, client bundles, logs, prompts, screenshots, crash reports, or analytics.**
10. **Assume models can make mistakes; models never bypass security policy.**
11. **Security checks are deterministic code, not LLM judgment.**
12. **Minimize blast radius through compartmentalization.**
13. **Prefer reversible actions.**
14. **Maintain an auditable record of consequential actions without logging sensitive contents unnecessarily.**
15. **Secure defaults beat configurable-but-dangerous defaults.**

---

# S1. Threat model before launch

Create a living threat model that identifies:

### Assets
- OAuth refresh/access tokens
- API keys
- session secrets
- private documents
- message/email content
- memory/profile records
- device bridge access
- local filesystem access
- GitHub credentials
- notification content
- browser sessions
- local model caches containing sensitive prompts

### Adversaries
- remote internet attacker
- malicious website
- compromised dependency
- compromised OAuth provider token
- stolen iPhone/Mac
- malware running as the user
- malicious browser content
- supply-chain attacker
- leaked API key
- compromised Cloudflare account
- compromised GitHub account
- malicious prompt/content attempting tool abuse
- attacker with temporary local access

### Attack surfaces
- Cloudflare Worker
- D1
- OAuth callbacks
- native clients
- browser/WebKit
- Messages bridge
- iPhone bridge
- Library indexing
- local model servers
- applets
- sandbox/lab
- agent/tool execution
- APNs
- GitHub Actions/build pipeline
- any local HTTP server
- import/export/share flows

Every new major subsystem must update the threat model.

---

# S2. Data classification

Every stored field/source should have a classification, for example:

```text
PUBLIC
INTERNAL
PERSONAL
SENSITIVE
SECRET
CRITICAL_SECRET
```

Examples:

```text
app theme                 INTERNAL
calendar title            PERSONAL
email body                SENSITIVE
health record             SENSITIVE
OAuth refresh token       CRITICAL_SECRET
API key                   CRITICAL_SECRET
session signing key       CRITICAL_SECRET
password                  CRITICAL_SECRET (SILK Vault only)
```

Classification should influence:
- storage location
- encryption requirement
- sync eligibility
- log redaction
- retention
- export permissions
- model-routing rules

---

# S3. SILK Vault, credential, and secret handling

## SILK Vault is a mandatory core subsystem

**Status: REQUIRED FOR FINAL SILK**

SILK is intentionally planned to include a first-class password/secret vault so the owner can securely remember and use credentials.

The Vault is **not** ordinary SILK Memory, Library data, D1 application data, or model context. It is a separate high-security domain.

Target architecture:

```text
                 SILK VAULT
                     |
          encrypted local vault store
                     |
          per-vault encryption key(s)
                     |
       Keychain / Secure Enclave protection
                     |
          Face ID / Touch ID / owner auth
```

### Core Vault rules

- Passwords and secrets are encrypted at rest.
- Plaintext credentials exist only transiently in memory during an explicitly authorized Vault operation.
- Vault plaintext must never be written to D1, logs, analytics, crash reports, prompts, embeddings, Library indexes, Activity text, or Change Journal payloads.
- Passwords/secrets must never be sent to Apple Foundation Models, Mac-local LLMs, OpenAI, or any other generative model.
- The AI layer may request a typed Vault action, but deterministic Vault policy and owner authentication decide whether it executes.
- The Vault must be local-first.
- Cloudflare must not receive plaintext passwords or the Vault decryption key.
- If encrypted Vault synchronization is added later, synchronization must use end-to-end encrypted ciphertext designed so the sync service cannot decrypt it.
- Key-encryption material should use Apple Keychain and Secure Enclave-backed protection where technically appropriate.
- Vault unlock should support Face ID / Touch ID on trusted Apple devices.
- High-risk operations may require fresh biometric/owner reauthentication even when SILK itself is already open.
- Vault auto-lock is mandatory.
- Lock on device lock/sleep/logout where appropriate.
- Provide a global emergency Vault lock.
- Clipboard copies of passwords/secrets must auto-clear after a short configurable interval.
- Prefer direct credential filling/use through approved local mechanisms over displaying plaintext.
- Credential reveal should require explicit user action.
- Screenshots/screen recording of revealed secrets should be restricted where platform APIs allow; where they cannot be prevented, SILK should minimize exposure duration and warn appropriately.
- Never put secrets into notification bodies.
- Never expose Vault data to Applets, arbitrary agents, browser page JavaScript, external MCP servers, or Sandbox/Lab processes.
- Only narrowly scoped, explicitly approved local capabilities may request Vault operations.

### Vault data types

Potential supported entries:

```text
username + password
secure note
recovery code
software/license secret
Wi-Fi credential
API token owned by the user
TOTP seed (optional, separately protected)
passkey metadata/reference where platform support permits
```

OAuth tokens used internally by SILK should still use purpose-built token storage rather than being treated as normal user Vault entries.

### Password-management features

The eventual Vault should support:

- strong password generation
- configurable password length/character rules
- search by service/account metadata without exposing secret values
- duplicate/reused-password detection performed locally
- weak-password detection performed locally
- optional breach checking using a privacy-preserving method where feasible
- TOTP generation if TOTP seeds are enabled
- encrypted backup/export
- secure import path
- credential version/history only when encrypted and necessary
- account notes/URLs/usernames
- explicit per-entry reveal/copy/fill controls
- emergency Vault lock
- recovery procedure

### Vault recovery

A Vault that cannot be recovered safely is dangerous, but a recovery design that trivially bypasses encryption is worse.

Before launch, define and test:

- owner recovery method
- device-loss recovery
- encrypted backup recovery
- recovery-key handling
- what happens if Secure Enclave-bound material is lost
- key rotation
- migration between Apple devices
- revocation of lost/stolen devices

No recovery secret may be silently uploaded to Cloudflare or committed to source.

### Vault capability boundary

Possible capabilities:

```text
silk.vault.list_metadata
silk.vault.search_metadata
silk.vault.create_entry
silk.vault.update_entry
silk.vault.copy_secret
silk.vault.fill_credential
silk.vault.reveal_secret
silk.vault.generate_password
silk.vault.generate_totp
silk.vault.lock
silk.vault.unlock
silk.vault.export_encrypted
```

Rules:

- listing/searching metadata does not imply permission to reveal secrets;
- reveal/copy/fill are separate high-risk capabilities;
- secret-returning capabilities require owner authentication and should return data only to a trusted native Vault surface or tightly scoped local fill mechanism;
- models should receive success/failure/status metadata, never the secret value.

## Other credential approaches

Where a password does not need to be stored in SILK Vault, continue to prefer:

- OAuth delegated authorization
- Sign in with Apple / provider auth
- system Keychain
- Secure Enclave-backed keys where supported
- app-specific tokens
- short-lived credentials
- scoped access tokens
- passkeys

## SILK infrastructure secret storage

- macOS/iOS infrastructure secrets: Keychain
- hardware-bound key material: Secure Enclave where appropriate
- server secrets: Cloudflare Secrets or equivalent encrypted secret manager
- encrypted OAuth refresh tokens at rest
- separate encryption keys from encrypted data
- support key rotation
- do not hard-code secrets in GitHub, JavaScript bundles, Swift source, committed config, or environment examples
- SILK infrastructure secrets and user Vault contents must remain separate security domains

---

# S4. Authentication and device trust

Before launch, support:

- strong owner authentication
- secure session cookies/tokens
- short session lifetime for high-risk actions
- device registration
- per-device identity
- remote device revocation
- reauthentication for sensitive actions
- optional biometric confirmation (Face ID / Touch ID) for high-risk capabilities
- session invalidation after credential rotation
- protection against session fixation/replay
- CSRF protection where browser sessions are used
- secure OAuth state + PKCE
- strict redirect URI validation

For native Apple clients, prefer system authentication frameworks and hardware-backed security where available.

---

# S5. Capability-level authorization

Security policy lives **below the AI layer**.

Models may request:

```text
silk.gmail.send
silk.messages.send
silk.browser.fill_field
silk.files.delete
```

but deterministic authorization code decides whether execution is allowed.

Each capability must declare:

```text
READ / WRITE
RISK_CLASS
REQUIRES_APPROVAL
ALLOWED_CLIENTS
ALLOWED_WORKERS
DATA_SCOPE
NETWORK_SCOPE
AUDIT_REQUIRED
```

Workers get only task-specific capabilities.

No "god mode" token shared across all agents.

---

# S6. Approval system

Default approval requirements for:

- sending email/messages
- posting externally
- purchases
- financial actions
- deleting files/data
- modifying security settings
- revealing secrets
- granting new permissions
- connecting a new device
- changing OAuth scopes
- running privileged code
- exporting sensitive collections
- installing/updating executable plugins/components

Approval UI must show:
- exact action
- destination/target
- relevant scope
- what data leaves the device
- whether action is reversible

---

# S7. Encryption

Before launch:

### In transit
- TLS everywhere
- no plaintext remote APIs
- strict certificate validation
- modern TLS defaults

### At rest
- encrypted OAuth/token storage
- encrypted sensitive local stores where practical
- platform file/data protection APIs on Apple devices
- encrypted backups
- separate keys from data

### Key management
- rotation support
- versioned keys
- recovery plan
- no master encryption key committed to source
- minimize one-key-unlocks-everything architecture

---

# S8. Local bridge isolation

Messages/iPhone/notification/browser bridges are high-value attack surfaces.

Requirements:

- bind to loopback or Unix-domain socket by default
- never expose to LAN/WAN automatically
- authenticate every bridge request
- use per-client scoped credentials
- reject unauthenticated local requests
- origin/request validation
- strict input validation
- request size/rate limits
- no arbitrary command execution endpoints
- explicit allowlist of callable capabilities
- Activity/Audit records
- kill switch to disable bridge instantly

If cross-device LAN communication is later required:
- authenticated encrypted channel
- paired-device identity
- mutual trust/certificate model
- explicit device approval
- revocation support

---

# S9. Browser and web-content security

SILK Browse must treat webpages as hostile input.

Requirements:

- site content cannot grant itself capabilities
- webpage text cannot alter system security policy
- tool requests caused by webpage/prompt injection are checked by deterministic policy
- isolate cookies/site storage
- limit cross-origin access
- safe download handling
- malware/suspicious file warnings where feasible
- do not expose local bridge endpoints to webpage JavaScript
- Content Security Policy for SILK web surfaces
- strict sanitization for rendered external HTML
- separate trusted SILK UI from untrusted web content

---

# S10. Agent / model security

Assume models can be manipulated.

Rules:

- prompt injection is expected, not exceptional
- external content is data, not authority
- only deterministic policy code grants capabilities
- models cannot self-expand permissions
- models cannot read arbitrary secrets
- models cannot modify security policy
- models cannot disable audit logging
- models cannot silently install executable code
- models receive minimum context required
- sensitive data should remain local unless cloud use is explicitly permitted
- cloud fallback should redact/minimize context where possible

---

# S11. Applet security

SILK Applets require a sandbox.

By default:

- no filesystem access
- no Keychain access
- no arbitrary network access
- no bridge access
- no raw OAuth tokens
- no arbitrary native APIs
- only explicit Capability Bus calls
- per-applet permission manifest
- Content Security Policy
- resource/time limits
- kill switch
- signed/trusted applet metadata if persistence is allowed

---

# S12. Sandbox / Lab security

SILK Lab must be isolated from production.

Default:
- no production secrets
- no unrestricted home-directory access
- no production DB write access
- network restricted where practical
- temporary filesystem
- resource limits
- execution timeout
- explicit file mounts only
- separate working directory
- human approval before moving generated code/data into production

---

# S13. Logging and audit security

Audit important actions, but do not create a second treasure trove.

Logs should record:
- who/what initiated action
- capability
- timestamp
- result
- approval ID
- target identifier when safe

Logs should **not** contain by default:
- passwords
- raw tokens
- entire emails/messages
- private document contents
- secret headers
- full auth responses

Support:
- redaction
- retention limits
- tamper-evident/append-only strategy for critical audit records where practical
- export for incident review
- secure deletion according to retention policy

---

# S14. Rate limiting and abuse resistance

Apply deterministic limits to:
- login attempts
- OAuth callbacks/state creation
- API routes
- bridge endpoints
- message sends
- email sends
- external writes
- agent task creation
- expensive model calls
- Library ingestion
- file uploads
- applet execution

Include:
- exponential backoff
- lockout/cooldown
- replay protection
- request quotas
- duplicate suppression

---

# S15. Anomaly detection

Use deterministic heuristics first.

Examples:
- unknown device
- new geographic/session pattern where available and privacy-safe
- unusual volume of message sends
- mass file access
- repeated denied capability requests
- token refresh failures
- bridge suddenly listening on non-loopback interface
- impossible rate of export/download
- security setting changed unexpectedly

Response options:
- block action
- require reauthentication
- disable capability
- revoke session/token
- notify owner
- run SILK Doctor

No LLM is required for the core anomaly decision.

---

# S16. Dependency and supply-chain security

Before launch:

- dependency lockfiles
- automatic vulnerability scanning
- SBOM (Software Bill of Materials)
- dependency license inventory
- pin critical dependencies
- review transitive high-risk dependencies
- Dependabot/Renovate-style alerts
- secret scanning
- static analysis
- signed release artifacts where supported
- protect main branch/release workflow
- limit GitHub Actions permissions
- pin third-party Actions to trusted immutable revisions where feasible
- no unreviewed executable install scripts in release path

---

# S17. Build and update security

For native clients:

- code signing
- hardened runtime where appropriate
- entitlements minimized
- release builds separate from dev builds
- debug endpoints disabled in production
- no development secrets bundled
- signed update mechanism
- rollback plan

For web/backend:

- reproducible/controlled build process
- deploy from protected branch/workflow
- least-privilege deployment credentials
- environment separation
- post-deploy health checks

---

# S18. Backup and recovery

Security includes recovery.

Required:
- encrypted backups of critical SILK configuration/data
- tested restore procedure
- key recovery plan
- versioned schema migrations
- rollback strategy
- disaster recovery checklist
- ability to rebuild SILK from clean infrastructure without reusing compromised credentials

Do not back up secrets into insecure locations.

---

# S19. Incident response

Before launch, document:

```text
1. detect
2. contain
3. revoke
4. rotate
5. restore
6. investigate
7. verify
```

One-command / one-screen emergency controls should eventually include:

- revoke all active SILK sessions
- disable external writes
- disable local bridges
- disable cloud AI
- revoke connected devices
- rotate application/session secrets
- disconnect integrations
- enter READ-ONLY SAFE MODE

SILK Doctor should help verify recovery afterward.

---

# S20. Privacy controls

Owner controls should include:

- inspect stored data
- inspect connected sources
- per-source enable/disable
- per-capability permissions
- retention rules
- export data
- delete data
- clear cached model context
- clear Library index without deleting originals
- disconnect provider and revoke tokens
- private/paused mode
- clear active context

No hidden telemetry by default.

---

# S21. Secure deletion

For sensitive records where deletion is requested:

- remove database rows/index entries
- revoke related tokens where applicable
- purge cached copies
- remove generated embeddings/index records
- clear temporary files
- respect platform limits around physical secure erase on modern encrypted storage

Do not promise physical byte-level erasure that the OS/filesystem cannot guarantee; use cryptographic/platform-appropriate deletion semantics.

---

# S22. Security testing program

Before official launch:

### Automated
- SAST
- dependency vulnerability scan
- secret scan
- lint/type checks
- API authorization tests
- permission boundary tests
- fuzz/input validation tests on exposed parsers/routes where practical
- OAuth/session security tests
- rate-limit tests
- bridge authentication tests
- backup/restore test
- security regression suite

### Manual
- architecture security review
- threat-model review
- permission review
- secrets review
- native entitlement review
- local bridge review
- browser/web-content isolation review
- applet sandbox review
- agent prompt-injection/tool-abuse review

### Adversarial
Before launch, perform a serious penetration-test/red-team pass focused on:
- auth bypass
- privilege escalation
- session theft
- OAuth/token theft
- prompt-injection-to-tool-abuse
- local bridge compromise
- malicious webpage attacks
- malicious document ingestion
- applet escape
- sandbox escape
- secret exfiltration
- insecure direct object references
- CSRF/XSS where relevant
- dependency/supply-chain weaknesses

Where feasible, use an independent security reviewer or external penetration tester rather than relying solely on the same developer/system that built the feature.

---

# S23. Mandatory launch security gate

SILK is **NOT READY TO LAUNCH** until all of the following are true:

```text
[ ] current threat model reviewed
[ ] data classification implemented
[ ] no raw production secrets in source control
[ ] secret scanning passes
[ ] critical infrastructure secrets stored in approved secret stores
[ ] SILK Vault implemented as an isolated encrypted security domain
[ ] Vault plaintext never reaches D1, logs, prompts, embeddings, analytics, or cloud AI
[ ] Vault keys protected with Keychain/Secure Enclave strategy where appropriate
[ ] Vault Face ID / Touch ID or equivalent owner reauthentication works
[ ] Vault auto-lock and emergency lock work
[ ] clipboard auto-clear works for copied secrets
[ ] encrypted Vault backup AND recovery tested
[ ] lost-device Vault revocation/recovery procedure tested
[ ] strong owner authentication implemented
[ ] sessions hardened
[ ] OAuth PKCE/state/redirect protections verified
[ ] device registration/revocation works
[ ] capability authorization enforced below AI layer
[ ] high-risk writes require approval
[ ] encryption in transit verified
[ ] sensitive at-rest encryption strategy verified
[ ] local bridges authenticated and non-public by default
[ ] browser/web content isolated from privileged capabilities
[ ] agent prompt-injection/tool-abuse protections tested
[ ] Applet sandbox passes security tests
[ ] Lab/Sandbox isolated from production secrets
[ ] logs redact secrets/private payloads
[ ] rate limiting enabled
[ ] anomaly-response paths tested
[ ] dependency/SBOM/vulnerability scans pass
[ ] signed/controlled build path verified
[ ] backup AND restore tested
[ ] emergency READ-ONLY SAFE MODE works
[ ] incident-response runbook tested
[ ] data export/delete controls tested
[ ] automated security regression suite passes
[ ] manual security review completed
[ ] penetration/red-team review completed
[ ] all Critical vulnerabilities fixed
[ ] all High vulnerabilities fixed or explicitly accepted with documented mitigation
```

Launch must fail closed if the security gate is not met.

---

# S24. Security after launch

Security is ongoing.

Recommended cadence:
- dependency scans continuously
- secrets scans continuously
- Doctor security checks regularly
- security review for every new privileged capability
- threat-model update for each major subsystem
- rotate sensitive credentials periodically and after suspected compromise
- review logs/anomalies
- repeat penetration testing after major architectural changes

---

# Roadmap placement

Security begins **now**, but the full gate is required before launch.

```text
CURRENT BUILD
   |
   +--> implement features
   |
   +--> apply security requirements as architecture is built
   |
   v
CORE / NATIVE / INTEGRATIONS
   |
   v
LUXURY FEATURES (optional for launch)
   |
   v
SECURITY HARDENING + RED TEAM
   |
   v
MANDATORY SECURITY GATE
   |
   +--> FAIL --> keep building/fixing
   |
   +--> PASS
            |
            v
     SILK READY TO LAUNCH
```

Important:

**The luxury features may be unfinished at launch. The Security Program may not be unfinished at launch.**

---

# Decision summary

## Approved luxury features

1. SILK Active Context
2. SILK Command Bar
3. SILK Skills / Routines
4. SILK Undo / Change Journal

## Deferred extras

1. SILK Recall / Timeline
2. Teach SILK Mode

## Mandatory core subsystem

**SILK Vault — encrypted password/secret manager**

SILK will intentionally provide a password vault. The Vault must remain isolated from Memory, Library, D1 application data, model prompts, agents, Applets, and cloud AI. Plaintext credentials are local and transient only.

## Mandatory system-wide requirement

**SILK Security Program / Launch Gate**

The roadmap now explicitly treats security as a release-blocking requirement, not cleanup to perform after features are built. The Vault-specific security requirements are part of that launch gate.

The governing security rule is:

> **SILK should minimize what it knows, isolate what it must know, strictly control what it can do, make consequential actions auditable and reversible, and require the security gate to pass before launch.**
