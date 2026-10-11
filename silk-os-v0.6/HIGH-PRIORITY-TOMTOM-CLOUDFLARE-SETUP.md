# HIGH PRIORITY — Enable TomTom Live Traffic in Cloudflare

**Priority:** P0 / next deployment task

SILK Maps is already wired for traffic-aware routing, but **live traffic will not activate until the TomTom API key is added to the deployed Cloudflare Worker as a secret**.

## Required action

Add the Cloudflare Worker secret:

`TOMTOM_API_KEY`

Target Worker / deployment: `assistant-core`

Public SILK URL:

`https://assistant-core.jaedennm.workers.dev`

## Why this is high priority

Without `TOMTOM_API_KEY`, Today V2 can still show the open-source map and Valhalla route fallback, but it cannot provide true live congestion-aware drive times or traffic-delay minutes.

With the secret configured, Today V2 can use live traffic to improve:

- drive-time ETA
- traffic delay
- leave-by time
- prep timing
- schedule conflict detection
- usable free-time windows
- SILK's "what should I do now?" recommendation

## $0 requirement

This integration must remain zero-cost to the user.

SILK already contains a hard monthly traffic-request ceiling below the provider's current free allowance and automatically falls back to the open Valhalla/OpenStreetMap routing stack when live traffic is unavailable or the SILK traffic budget is reached.

**Do not configure SILK to automatically exceed the free traffic allowance.**

## Setup checklist

- [ ] Create / confirm TomTom developer account using the free tier.
- [ ] Obtain a TomTom API key with Routing access.
- [ ] Add `TOMTOM_API_KEY` as a Cloudflare Worker secret for `assistant-core`.
- [ ] Redeploy / confirm the Worker sees the new secret.
- [ ] Create or use a Calendar event with a real location.
- [ ] Open Today V2 and tap **Use current location**.
- [ ] Confirm the route card reports **LIVE TRAFFIC**, not fallback.
- [ ] Confirm drive time, traffic delay, distance, and leave-by time populate.
- [ ] Confirm those live travel values feed Today V2 logistics and recommendations.

## Acceptance criteria

This P0 task is complete when an authenticated SILK session can route from the device's current location to the next Calendar event and Today V2 reports a real live-traffic ETA and traffic delay while preserving SILK's $0 hard-stop behavior.
