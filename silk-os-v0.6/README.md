# Silk OS v0.7

Silk is a private, cloud-first personal intelligence operating system built for one owner. It is more than a chat screen: the command deck combines a daily tracker, connected services, projects, study signals, workouts, durable memory, observable system activity, and owner-approved actions.

## What is included

- Dimensional responsive Silk OS interface for desktop, tablet, and iPhone
- Real WebGL Silk Core with state-driven motion for retrieval, routing, search, calendar, speaking, syncing, approvals, and errors
- Interactive WebGL memory galaxy capped to a focused set of relevant nodes
- Assistant UI chat composer with streamed, factual activity states and browser speech input
- Automatic OpenAI routing: Nano for tiny work, Luna for routine work, Terra for complex work
- Cloudflare Workers AI fallback when the `AI` binding is available
- Private D1 persistence for messages, memories, daily items, projects, workouts, study records, usage, and integrations
- Memory privacy controls: public, personal, sensitive, and restricted
- Google Calendar OAuth and Calendar-to-Today synchronization
- Microsoft OAuth, OneNote section selection, and automatic study-session export
- Tavily web search with source links
- Open-Meteo weather and a “good morning” brief using weather, Calendar, tasks, deadlines, projects, and study gaps
- Live activity ledger plus an approval queue that executes approved Google Calendar changes
- Truthful agent and device workspaces that distinguish active capabilities from future local-bridge features
- Real provider usage and estimated cost records with an OpenAI spending ceiling
- Owner passphrase, secure cookie session, rate-limited login, same-origin checks, encrypted OAuth tokens, and hardened response headers
- Automated tests for routing, authentication comparison, memory rules, calendar conversion, daily completion, and page rendering

## Architecture

| Layer | Responsibility |
|---|---|
| React + assistant-ui | Dashboard, chat, memory controls, mobile interface |
| WebGL | Live Silk Core and interactive memory galaxy |
| Cloudflare Worker | Authentication, routing, AI calls, tools, streaming, security |
| Cloudflare D1 | Durable private records and the focused knowledge graph |
| OpenAI Responses API | Nano/Luna/Terra model calls with `store: false` |
| Cloudflare Workers AI | Free-tier fallback when configured |
| Google Calendar | Secure OAuth calendar connection |
| Microsoft Graph | Secure OneNote connection and page creation |
| Tavily | Current web results and source links |
| Open-Meteo | Weather for the daily briefing |

## Important privacy behavior

- API keys and OAuth tokens never enter the browser bundle.
- OpenAI requests use `store: false`.
- Restricted memories are never automatically placed in a cloud-model prompt.
- Sensitive or restricted facts are only auto-saved after an explicit “remember” request.
- Passwords, API keys, and financial credentials are rejected from durable memory.
- Google and Microsoft passwords never enter Silk; each provider handles its own sign-in.
- Calendar writes wait for owner approval before they execute.
- Agent creation, Apple Health, computer files, smart-home controls, and local-device control remain visibly disabled until their secure companion bridges exist.

## Deploy without a command line

Follow [CLOUDFLARE-DEPLOYMENT-GUIDE.md](./CLOUDFLARE-DEPLOYMENT-GUIDE.md). It uses only GitHub and Cloudflare in your browser.

For the exact delivered-versus-future capability list, see [SILK-V0.7-IMPLEMENTATION.md](./SILK-V0.7-IMPLEMENTATION.md).

## Developer checks

These commands are optional and are not required for the browser-only deployment path:

```bash
npm test
npm run build
```

The database schema lives in `db/schema.ts`; its generated migration is in `drizzle/`. The Worker also performs an idempotent schema check on first use, so an existing Silk v0.5 D1 database upgrades without wiping records.

## Reused open-source component

The chat surface uses `@assistant-ui/react`, licensed under MIT. Its license is preserved in `LICENSES/assistant-ui-MIT.txt`.
