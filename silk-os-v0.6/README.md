# Silk OS v0.6

Silk is a private, cloud-first personal assistant operating system built for one owner. It is more than a chat screen: the home view combines a daily tracker, Google Calendar, projects, study signals, workouts, durable memory, real model usage, and a focused memory map.

## What is included

- Original responsive Silk OS interface with desktop, tablet, and iPhone layouts
- Assistant UI chat composer with streamed factual activity states
- Automatic OpenAI routing: Nano for tiny work, Luna for routine work, Terra for complex work
- Cloudflare Workers AI fallback when the `AI` binding is available
- Private D1 persistence for messages, memories, daily items, projects, workouts, study records, usage, and integrations
- Memory privacy controls: public, personal, sensitive, and restricted
- Focused memory map capped at 60 nodes instead of an ever-growing visual mess
- Google Calendar OAuth and Calendar-to-Today synchronization
- Tavily web search with source links
- Real provider usage and estimated cost records with an OpenAI spending ceiling
- Owner passphrase, secure cookie session, rate-limited login, same-origin checks, encrypted Google tokens, and hardened response headers
- Automated tests for routing, authentication comparison, memory rules, calendar conversion, daily completion, and page rendering

## Architecture

| Layer | Responsibility |
|---|---|
| React + assistant-ui | Dashboard, chat, memory controls, mobile interface |
| Cloudflare Worker | Authentication, routing, AI calls, tools, streaming, security |
| Cloudflare D1 | Durable private records and the focused knowledge graph |
| OpenAI Responses API | Nano/Luna/Terra model calls with `store: false` |
| Cloudflare Workers AI | Free-tier fallback when configured |
| Google Calendar | Secure OAuth calendar connection |
| Tavily | Current web results and source links |

## Important privacy behavior

- API keys and OAuth tokens never enter the browser bundle.
- OpenAI requests use `store: false`.
- Restricted memories are never automatically placed in a cloud-model prompt.
- Sensitive or restricted facts are only auto-saved after an explicit “remember” request.
- Passwords, API keys, and financial credentials are rejected from durable memory.
- Google passwords never enter Silk; Google handles sign-in.

## Deploy without a command line

Follow [CLOUDFLARE-DEPLOYMENT-GUIDE.md](./CLOUDFLARE-DEPLOYMENT-GUIDE.md). It uses only GitHub and Cloudflare in your browser.

## Developer checks

These commands are optional and are not required for the browser-only deployment path:

```bash
npm test
npm run build
```

The database schema lives in `db/schema.ts`; its generated migration is in `drizzle/`. The Worker also performs an idempotent schema check on first use, so an existing Silk v0.5 D1 database upgrades without wiping records.

## Reused open-source component

The chat surface uses `@assistant-ui/react`, licensed under MIT. Its license is preserved in `LICENSES/assistant-ui-MIT.txt`.
