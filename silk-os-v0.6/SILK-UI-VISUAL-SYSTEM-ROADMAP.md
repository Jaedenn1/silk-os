# SILK UI / Visual System Roadmap

## Status

**Planning and visual-direction stage only. Do not begin the UI implementation yet.**

The current SILK application structure remains the foundation. This roadmap is not a proposal to rebuild SILK from scratch or replace its existing capabilities. The goal is to make the current interface feel more dimensional, alive, coherent, and distinctly SILK while preserving the useful navigation, data, workflows, calendar, chat, Today view, projects, study tools, workouts, memory, and system-state architecture already in place.

## Mandatory workflow before changing UI code

Before any visual-system code changes are made, SILK must be reviewed **screen-by-screen, starting with Home**.

For **Home first**, decide and agree on paper / in design discussion:

1. Exactly what existing Home content stays.
2. Which Home sections become Bento cards or Bento regions.
3. Where the SILK Core lives and how prominent it should be.
4. Where the Circular Carousel / mode navigator sits.
5. Which information is primary, secondary, and ambient.
6. Which cards may use depth, glow, motion, or special effects.
7. How desktop, tablet, and phone layouts differ.
8. Where the sidebar remains available as the efficient fallback / power-user navigation.

**Only after Home looks right on paper and the direction is explicitly agreed should implementation begin.**

Once the Home visual system is approved and implemented successfully, propagate the same design language deliberately to Calendar, Chat, Study, Workouts, Projects, Memory, Activity, Settings, and other screens.

This sequencing is intentional: avoid redesigning multiple screens at once, avoid mixing layout decisions with implementation decisions, and avoid turning a visual refresh into an accidental full application rewrite.

---

# Design philosophy: Quiet Futurism

SILK should feel like a private personal operating system rather than a generic SaaS dashboard.

The intended visual character is:

- dark and dimensional
- elegant rather than noisy
- glassy where appropriate
- subtly reactive to user input
- visibly alive when SILK is active
- highly polished on desktop and mobile
- futuristic without becoming cyberpunk clutter
- expressive in important moments, restrained during normal use

A useful shorthand is:

**Aceternity visual language + React Bits interaction delight + Magic UI information layout + selective true 3D through React Three Fiber / Drei.**

The goal is not to make every component animated or glowing. The cooler an effect is, the more selectively it should be used.

---

# Core rules

## 1. Preserve the SILK structure

Do not rebuild the application shell merely to adopt a UI library.

Keep the useful existing concepts:

- Home / Overview
- Ask SILK
- Today
- Calendar
- Projects
- Study
- Workouts
- Memory
- Connections
- Activity
- Settings
- SILK Core
- owner-only security model

The design system should upgrade these surfaces rather than replacing their underlying purpose.

## 2. Three levels of visual depth

### Level 1 — Ambient background

Use subtle motion only:

- very dark blue-black / charcoal field
- faint grid, light field, particles, or slow illumination
- no distracting constant animation

### Level 2 — Normal information surfaces

Most cards and controls remain readable and calm:

- glass / translucent surfaces where useful
- light blur
- restrained shadows
- small hover lift
- polished transitions
- subtle border response

### Level 3 — Attention / special state

Reserve stronger effects for things SILK wants the user to notice:

- important priority signal
- current / active task
- completion check-in
- urgent deadline
- system warning
- major achievement
- successful important action

These may receive deeper 3D, spotlight, holo, border glow, or carefully chosen animation.

## 3. No “cyberpunk casino”

Do not apply glowing borders, holographic effects, electric effects, particles, or 3D transforms to every surface.

Examples that should normally remain quiet:

- ordinary settings fields
- standard dropdowns
- routine calendar controls
- low-priority informational cards
- basic navigation labels

## 4. Motion must communicate meaning

Animation should indicate:

- hierarchy
- selection
- system activity
- state change
- completion
- navigation
- importance

Avoid animation that exists only because a component demo looked impressive.

---

# Proposed UI technology roles

## Aceternity-style visual language

Use Aceternity as the main aesthetic reference for:

- depth
- spotlight interaction
- elegant dark surfaces
- 3D card behavior
- reactive borders
- restrained futuristic presentation
- selected high-attention cards

Do **not** replace the entire application with Aceternity components. Use the design language selectively.

## React Bits — interaction and delight layer

React Bits contains many of the interaction patterns that fit SILK particularly well.

### Folder Float

**Use for:** files, school materials, projects, document collections, life categories.

Potential examples:

- Nursing
- Courses
- Assignments
- Exams
- Employment
- Taxes
- Car documents
- SILK projects
- Game projects
- Personal records

A folder should visually expose its contents while remaining functional rather than purely decorative.

### Flip Card

**Use for:** achievements and milestones.

Front face:

- achievement name
- icon / illustration
- date
- rarity / category styling

Back face:

- stats
- details
- location
- associated record
- notes

Potential achievements include:

- first 5K
- 10K
- half marathon
- HYROX
- triathlon
- 100 workouts
- semester completed
- full school year completed
- Practical Nursing graduation
- first nursing job
- meaningful financial milestones

Avoid trivial “achievement spam.” Achievements should represent genuinely meaningful accomplishments.

### Holo / Reflective Card

**Use for:** rare or major achievements only.

Possible hierarchy:

- Standard — normal achievement card
- Significant — reflective / restrained holo
- Major — full holo treatment

Examples of major-tier achievements:

- graduation
- first major race
- HYROX / triathlon
- major career milestone
- especially meaningful life milestone

### Circular Carousel / Circular mode navigator

**Use for:** beautiful primary navigation between SILK’s major modes.

Potential modes:

- Home
- Chat
- Calendar
- Study
- Fitness
- Projects
- Memory
- Life / Documents
- Money if added later

Important rule:

**Do not remove efficient navigation.** The existing / revised sidebar remains available behind a menu button or as a desktop power-user option.

Preferred model:

- Circular Carousel = expressive primary mode navigation
- Sidebar = fast direct navigation / fallback

### Accordion Gallery

**Use selectively for:** landing-page choices or major subareas where visual expansion is useful.

Potential examples:

Study landing page:

- Courses
- Exams
- Review
- Quizzes

Fitness landing page:

- Current program
- Running
- Strength
- History

Do not use accordion galleries for deep settings or repetitive utility navigation.

### Glide Select

**Use for:** aesthetically polished dropdowns and selectors.

Good candidates:

- Calendar category
- model / mode selection
- filters
- sort controls
- priority
- study course
- workout selection
- response style

### Prompt Bar

**Use for:** Ask SILK / chat composer.

The future SILK prompt surface may support:

- normal prompting
- voice / dictation
- contextual sources
- attachments where supported
- command syntax
- selected model / mode indicators where useful
- send / stop state

Potential commands / context patterns:

- `@calendar`
- `@school`
- `@workout`
- `/start-workout`
- `/today`

The interface should remain friendly to ordinary natural-language prompting; commands are additive, not required.

### Thought Line

**Use for:** visible, truthful SILK activity.

Examples:

- Retrieving memory
- Checking calendar
- Searching the web
- Reading project context
- Comparing available time
- Routing request
- Preparing response

Important restriction:

**Thought Line must never claim to expose SILK’s hidden chain-of-thought or private reasoning.** It should show only observable system actions, tool activity, high-level progress, and truthful state transitions.

### Slide Commit

**Use for:** deliberate affirmative completion / commit interactions.

Primary example:

`Full Body A completed?`

- slide to complete = Yes / completed
- separate `No` action = not completed

This can also be reused for selected consequential positive actions where a satisfying deliberate gesture makes sense.

Completion should feel rewarding but never shame the user for selecting No.

### Border Glow

**Use sparingly for:**

- selected card
- active task
- high-priority signal
- important upcoming deadline
- current system state

Suggested hierarchy:

- Normal = no glow
- Hover = faint response
- Active = subtle glow
- Important = stronger controlled glow
- Critical = attention animation only when justified

### Electric effects

**Use extremely sparingly.**

Potential uses:

- SILK startup / awakening moment
- major achievement unlock
- important system connection established
- rare Core state transition

Do not use for normal page loads or routine calendar events.

---

# Magic UI — structure and information presentation

## Bento Grid

**Primary candidate for the Home / Overview redesign.**

The existing Home content should be reorganized into a hierarchy of differently sized Bento regions rather than a uniform grid of equal cards.

Potential Home areas:

- Daily command brief
- SILK Core
- Today
- Next event
- Priority signal
- Calendar preview
- Study / school status
- Workout status
- Projects
- Activity / notification summary

Exact arrangement is **not approved yet** and must be decided during the Home-first design pass before implementation.

## Animated List

**Use for:**

- SILK activity
- recent completions
- notifications
- event history
- Today feed where appropriate

New items should enter smoothly without creating visual noise.

## Animated Gradient Text

**Use selectively for:**

- SILK brand treatment
- Achievement Unlocked
- rare special headings
- selected system-state labels

Do not turn normal body text into animated gradients.

## Dia Text Reveal

**Use selectively for:** page / mode arrival or meaningful transitions.

Potential examples:

- STUDY
- CALENDAR
- MEMORY

The effect should play briefly and resolve into normal readable text.

---

# React Three Fiber + Drei — true 3D layer

React Three Fiber and Drei should not be used to rebuild standard interface elements.

They are reserved for places where real 3D adds genuine identity or utility.

## SILK Core

The SILK Core should become a true reactive object rather than merely a decorative animation.

Potential states:

### Idle

- slow floating / breathing motion
- subtle internal particles
- calm illumination

### Listening

- gentle pulse / expansion
- input-responsive motion if appropriate

### Thinking / processing

- internal motion increases
- structure reorganizes
- controlled particle acceleration

### Searching

- lines / rays move outward
- scanning-like behavior

### Calendar

- orbital / ring transformation

### Success

- brief outward energy pulse

### Warning / approval required

- controlled amber / warning state

All Core states should map to observable SILK application state rather than fake reasoning.

## Memory Galaxy

The existing Memory Galaxy concept should be retained and upgraded rather than replaced.

Potential behavior:

- memories as nodes
- meaningful clusters
- category grouping
- faint relationship lines
- importance affects prominence
- selected memory moves forward
- controllable orbit / camera
- restrained depth and motion

---

# Screen-level intent

## Home — FIRST DESIGN TARGET

**No implementation until this screen is agreed on visually.**

Decide:

- What current content stays
- Bento layout
- SILK Core location
- Circular Carousel location
- sidebar behavior
- mobile behavior
- information hierarchy
- which card gets special visual treatment
- background / depth behavior

Home establishes the design rules for the rest of SILK.

## Chat

Planned visual upgrades after Home approval:

- Prompt Bar
- Thought Line / activity trace
- improved message surface hierarchy
- Core integration with chat states
- better mobile composer

## Calendar

Keep the current calendar engine and functionality.

Planned visual upgrades:

- glass / dimensional container
- elevated event pills
- better today emphasis
- elegant current-time marker
- Glide Select controls
- Slide Commit completion prompt
- restrained glow for high-priority or active events

Do not rebuild Calendar functionality solely for aesthetics.

## Study

Potential:

- Accordion Gallery landing choices
- Bento summary
- exam / course priority cards
- Folder Float for course material
- achievement cards for semester milestones

## Workouts / Fitness

Potential:

- program / session Bento
- Slide Commit check-ins
- achievement collection
- rare holo achievements
- running / race milestone cards

## Files / Documents

Potential future dedicated area centered around Folder Float.

## Achievements

Potential dedicated collection using Flip Cards, with Holo / Reflective treatment reserved for significant achievements.

## Activity

Animated List is the primary candidate.

## Memory

Keep current information library and upgrade the existing Memory Galaxy using the true 3D layer.

---

# Navigation model

Preferred target architecture:

1. **Circular Carousel / mode navigator** for expressive major-mode navigation.
2. **Sidebar** retained as fast navigation and fallback.
3. **Accordion Gallery** used only for selected landing-page subareas.
4. **Glide Select** used for local choices / filters, not for global navigation.

Do not force visually impressive navigation where a fast direct control is more useful.

---

# Achievements philosophy

Achievements should recognize real progress and create a visual history of the owner’s life without trivializing everything into a game.

Good achievement categories:

- Fitness / running / races
- School
- Career
- Projects
- Meaningful personal milestones
- Selected financial goals

Avoid rewarding every routine action. The achievement collection should remain meaningful enough that rare visual treatments retain emotional value.

---

# Accessibility, performance, and fallback requirements

Before adopting a component or effect, verify:

- keyboard accessibility
- touch behavior
- reduced-motion behavior
- mobile performance
- low-power device performance
- compatibility with the existing React / Next / Cloudflare stack
- graceful fallback if WebGL / intensive effects are unavailable
- license / usage terms for the exact component implementation

The Raspberry Pi / lower-power-client experience should remain usable even if advanced effects must be reduced.

Never make essential navigation or information dependent on a heavy visual effect.

---

# Implementation order after design approval

## Phase 0 — Design approval

**Current phase.**

- Review screens one at a time.
- Start with Home.
- Produce / discuss the intended Home layout before code.
- Agree on the Bento regions, Core position, Circular Carousel position, sidebar behavior, and mobile arrangement.

## Phase 1 — Home visual system

Only after Phase 0 approval:

- establish tokens / surfaces
- background / glass treatment
- Bento Home layout
- Circular Carousel mode navigation
- sidebar fallback behavior
- selected depth / spotlight behavior
- SILK Core placement
- responsive rules

## Phase 2 — Chat

- Prompt Bar
- Thought Line / observable activity
- updated message surfaces
- Core/chat coordination

## Phase 3 — Calendar

- visual restyle around existing calendar engine
- Glide Select
- completion interactions / Slide Commit
- event hierarchy

## Phase 4 — Study / Fitness / Projects

- Accordion Gallery where appropriate
- Folder Float
- Bento summaries
- achievement integration

## Phase 5 — Achievements

- Flip Cards
- Holo / Reflective rarity
- milestone history

## Phase 6 — True 3D refinement

- upgraded SILK Core
- upgraded Memory Galaxy
- performance and reduced-motion fallbacks

---

# Explicit non-goals

Do not:

- rewrite the whole app because a component library looks attractive
- replace usable screens before designing their successor
- use 3D for ordinary controls
- expose hidden chain-of-thought through Thought Line
- glow every component
- animate all text
- remove the sidebar before an equally efficient fallback exists
- make mobile navigation visually impressive but frustrating
- sacrifice readability for atmosphere
- begin implementation before the Home screen direction is agreed

---

# Current decision

The agreed direction is:

- **Aceternity-inspired visual language**
- **React Bits for selected interactions and delight**
- **Magic UI Bento / information presentation**
- **React Three Fiber + Drei for genuine 3D SILK experiences**
- **Existing SILK application structure remains the foundation**

**Next action: design Home on paper / in discussion. No UI code changes yet.**

For Home, decide exactly what stays, what becomes Bento, where the SILK Core lives, and where the Circular Carousel sits. Once Home looks right on paper and the direction is agreed, implement the visual system there first and use that approved system as the basis for Calendar, Chat, Study, and the rest of SILK.
