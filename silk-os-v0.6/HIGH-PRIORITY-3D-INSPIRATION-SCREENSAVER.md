# HIGH PRIORITY — 3D Inspiration Screensaver

## Priority

**HIGH PRIORITY**

This feature should be treated as one of SILK's major ambient / identity experiences after the core Home and Today systems are stable.

Do **not** implement yet. This document records the approved concept so it is not lost.

---

# Concept

SILK should have a cinematic 3D screensaver / idle experience that activates when the user has not interacted with the interface for a configurable amount of time.

The screensaver should celebrate exceptional human achievement across disciplines and feel like a living digital monument rather than a normal slideshow.

The experience can contain:

- elite athletes
- inventors
- scientists
- mathematicians
- engineers
- artists / creators
- explorers
- savants / polymaths
- builders / founders where appropriate
- other historically significant high-achievement figures

The visual tone must remain consistent with SILK's **Quiet Futurism** direction: premium, dark, dimensional, cinematic, elegant, restrained, and highly polished.

---

# Experience modes

## 1. 3D Greatness Poster

A single large cinematic composition containing multiple notable people in one scene.

Possible treatment:

- layered 3D depth
- foreground / midground / background subjects
- parallax camera movement
- volumetric light
- subtle fog / atmospheric depth
- glass / metallic title treatment
- slow camera drift
- silhouettes, archival imagery, or licensed/generated visual interpretations
- category groupings such as sport, science, invention, exploration, medicine, engineering, art

This should feel closer to a premium museum installation or title sequence than a collage.

Potential title language:

- GREATNESS
- BUILT DIFFERENT
- HUMAN POTENTIAL
- THE STANDARD
- THOSE WHO PUSHED FURTHER

Avoid cheesy motivational-poster aesthetics.

## 2. 3D Quote Slideshow

A rotating series of individual cinematic scenes.

Each scene may contain:

- one athlete / inventor / thinker / creator
- a strong portrait or stylized 3D interpretation
- name and field
- one short verified quote
- minimal supporting typography
- slow depth / parallax movement
- ambient particles, light, or environmental motion

Example layout ideas:

- subject on the left, quote floating beside them
- subject centered behind translucent glass typography
- quote in the middle with the subject partially obscured behind depth layers
- full-screen portrait with slow camera push-in and subtle light sweep

Transitions should be slow and cinematic rather than presentation-like.

## 3. Collection / Theme Rotations

Screensaver content should eventually support themed rotations such as:

- Greatest athletes
- Inventors
- Science & mathematics
- Medicine
- Engineering
- Explorers
- Artists / creators
- Builders
- Discipline
- Resilience
- Obsession / mastery

A mixed "Greatest People" collection should also exist.

---

# Idle behavior

Potential activation model:

1. User stops interacting with SILK.
2. After a configurable idle delay, Home fades into the screensaver.
3. The screensaver enters either Poster mode or Slideshow mode.
4. Mouse, touch, keyboard, voice activation, or other intentional input exits immediately.
5. SILK returns to the exact screen / state the user was previously viewing.

Important requirements:

- never lose unsaved user work
- never trigger while the user is actively watching / reading something that SILK can reasonably detect
- allow screensaver to be disabled
- allow idle delay configuration
- do not activate during important modal / approval interactions
- support reduced-motion and low-power fallbacks

---

# Visual direction

The aesthetic should fit the new SILK Core and Home visual language.

Preferred characteristics:

- near-black background
- deep navy / charcoal
- controlled cyan, indigo, violet, silver, and occasional warm highlights
- cinematic rim lighting
- subtle glass layers
- extremely restrained bloom
- depth-of-field where performance allows
- smooth parallax
- slow camera movement
- realistic or artistically stylized imagery depending on the collection
- minimal typography

Avoid:

- generic motivational graphics
- esports-style neon overload
- cyberpunk clutter
- cheesy gold trophies / podium imagery
- giant UI panels over the art
- fast slideshow transitions
- excessive particle effects

---

# Content quality rules

## Quotes

Quotes must be verified before inclusion.

Do not use:

- falsely attributed internet quotes
- paraphrases presented as direct quotes
- low-confidence quote aggregators as the sole source

Store attribution / source metadata with the quote content so SILK can later expose provenance if needed.

## People

The collection should be curated rather than automatically filled with random celebrities.

Selection should emphasize genuine achievement, originality, mastery, discovery, perseverance, or historic impact.

The collection does not need to imply that every included figure was morally perfect or admirable in every area of life. SILK is celebrating specific achievements, not canonizing people.

## Images / likenesses

Before production use, verify licensing / usage rights for any third-party photography, archival imagery, artwork, or commercial likeness assets.

Where appropriate, SILK may instead use original generated artwork or abstract / stylized interpretations rather than copying protected promotional images.

---

# Interaction ideas for later

Not required for v1, but preserve these possibilities:

- swipe / arrow to move to the next figure
- tap a person's name for a short biography
- save a figure or quote to Favorites
- choose preferred collections
- hide people the user does not want shown
- "Inspire me" manual launch from Home
- morning / study / workout-specific collections
- contextual selection based on the user's current mode
- special quote sets before studying, training, or work

---

# Technical direction

Likely implementation candidates:

- React Three Fiber
- Drei
- shader-based depth / lighting where appropriate
- GPU-conscious parallax layers for lower-powered hardware
- static / CSS fallback for reduced-motion or devices without adequate WebGL performance

The feature must be performance-aware because SILK may run on lower-power hardware as well as desktop / laptop browsers.

Use progressive enhancement:

1. true 3D where supported
2. layered parallax fallback
3. static high-quality composition fallback

The screensaver should never make the rest of SILK less reliable.

---

# Product relationship to SILK

This is not merely decoration.

The screensaver should reinforce SILK's identity as a personal operating system centered around:

- ambition
- curiosity
- mastery
- discipline
- building
- learning
- human potential

It should feel like an ambient reminder of what humans can achieve while the system is idle.

---

# Initial implementation order when this feature is started

1. Decide the first curated collection (recommended: mixed Greatness collection).
2. Pick 8–12 initial figures.
3. Verify quote sources.
4. Design one finished 3D slideshow scene.
5. Design one finished multi-person poster scene.
6. Test idle activation / exit behavior.
7. Add reduced-motion / performance fallback.
8. Build collection rotation.
9. Add user preferences.
10. Only then expand the library of people / quotes.

---

# Current decision

**Approved concept. HIGH PRIORITY. Do not build yet.**

The intended feature is a SILK idle screensaver with two flagship experiences:

- a cinematic **3D Greatness Poster** featuring exceptional people across sport, science, invention, engineering, creativity, exploration, and other areas of achievement
- a cinematic **3D Quote Slideshow** featuring one person at a time with a verified quote integrated into the scene

This feature should be revisited after the current Home / Today foundation is stable.