# P0 — Closed-App Push Notifications for SILK

**Priority:** P0 / High Priority

## Status

Deferred for now by product decision. The proactive signal engine already exists, but SILK does **not yet** have full server-originated Web Push delivery to iPhone/PWA while the app is closed.

## Goal

Allow SILK to deliver real iPhone notifications when the Home Screen web app is closed, including:

- leave-by / traffic alerts
- completion check-ins
- free-window opportunities
- sleep-protection warnings
- meaningful schedule changes

## Required work

1. Generate Web Push VAPID key pair.
2. Store the private key only as a Cloudflare secret; never commit it to GitHub.
3. Add browser/PWA push-subscription flow behind an explicit user action.
4. Store endpoint, `p256dh`, and `auth` subscription values securely in D1.
5. Extend the SILK service worker to receive push events, show notifications, deep-link into SILK, and manage badges where supported.
6. Add Cloudflare scheduled execution for the proactive signal engine.
7. Deduplicate/throttle alerts so SILK only pushes meaningful changes.
8. Remove stale/expired subscriptions safely.
9. Verify end-to-end on an iPhone Home Screen install with SILK fully closed.

## Acceptance criteria

- User explicitly enables notifications from SILK.
- SILK Home Screen web app can receive a notification while closed.
- Tapping a notification opens the relevant SILK view.
- No private push key is exposed in source control.
- Repeated scheduled checks do not spam duplicate alerts.
- Notification delivery degrades safely if permission/subscription is unavailable.

## Next action when resumed

Implement the subscription + VAPID + scheduled Worker delivery layer on top of the existing proactive intelligence engine.
