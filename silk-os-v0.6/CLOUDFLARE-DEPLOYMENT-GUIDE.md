# Deploy Silk OS v0.7 to Cloudflare — no command line

You do not need to understand React, install a coding program, or type terminal commands. This path uses the GitHub and Cloudflare websites.

## Before you start

You already have the important pieces:

- Cloudflare Worker: `assistant-core`
- D1 database: `assistant-memory`
- D1 binding name: `DB`
- OpenAI secret: `OPENAI_API_KEY`
- Owner passphrase secret: `APP_PASSWORD`

Keep the old Worker version available in **Deployments → Version history**. Cloudflare can roll back if needed. The new Worker upgrades the existing database in place and does not delete messages, projects, workouts, study records, or memories.

## Part 1 — put the supplied folder on GitHub

1. Download `silk-os-v0.7.zip` and unzip it on your Mac.
2. Go to [github.com/new](https://github.com/new).
3. Repository name: `silk-os`.
4. Choose **Private**.
5. Leave the README, `.gitignore`, and license boxes unchecked—the folder already contains them.
6. Select **Create repository**.
7. On the empty-repository page, choose **uploading an existing file**.
8. Open the unzipped `silk-os-v0.7` folder, select everything inside it, and drag those items into GitHub.
9. Wait for the upload list to finish, enter `Silk OS v0.7` as the commit message, then select **Commit changes**.

Do not upload `node_modules`, `.env`, or a file containing an API key. They are not included in the supplied zip.

## Part 2 — insert your D1 database ID once

The deployment configuration needs the ID of your existing `assistant-memory` database. The ID is an identifier, not a password.

1. In Cloudflare, open **Storage & databases → D1 SQL Database → assistant-memory → Settings**.
2. Copy the **Database ID**.
3. In GitHub, open `wrangler.cloudflare.jsonc`.
4. Select the pencil icon to edit it.
5. Replace only `PUT_YOUR_D1_DATABASE_ID_HERE` with the copied ID.
6. Commit the change.

Do not change the binding name `DB`. Silk’s code expects exactly that name.

## Part 3 — connect the existing Worker to GitHub

1. In Cloudflare, go to **Workers & Pages**.
2. Open the existing **assistant-core** Worker.
3. Open **Settings → Builds**.
4. Select **Connect** and authorize GitHub when asked.
5. Choose the private `silk-os` repository.
6. Use these exact build settings:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Root directory | `/` or leave blank |
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy --config wrangler.cloudflare.jsonc` |
| Non-production deploys | Off for now |

7. Select **Save and Deploy**.

The Cloudflare Worker name and the `name` inside `wrangler.cloudflare.jsonc` are both `assistant-core`; they must match.

## Part 4 — confirm bindings and runtime settings

After the first deployment, open **assistant-core → Settings**.

### Bindings

Confirm both of these exist:

| Type | Variable name | Connected resource |
|---|---|---|
| D1 database | `DB` | `assistant-memory` |
| Workers AI | `AI` | Workers AI |

The included Wrangler file normally creates both bindings. If either is missing, open **Bindings → Add binding**, add it, and deploy the settings change.

### Non-secret variables

These values are included in `wrangler.cloudflare.jsonc`:

| Name | Value |
|---|---|
| `PRIMARY_AI_PROVIDER` | `openai` |
| `OPENAI_ROUTER_MODEL` | `gpt-5-nano` |
| `OPENAI_ROUTINE_MODEL` | `gpt-5.6-luna` |
| `OPENAI_COMPLEX_MODEL` | `gpt-5.6-terra` |
| `OPENAI_SPEND_LIMIT_USD` | `10` |

The spending value is a hard application guardrail in US dollars. Silk checks recorded monthly OpenAI cost before starting a paid request.

### Required secrets

Open **Settings → Variables and Secrets**. Confirm these are set as **Secret**, not plain text:

| Secret | What it is |
|---|---|
| `APP_PASSWORD` | The owner passphrase used to unlock Silk |
| `OPENAI_API_KEY` | Your restricted OpenAI project key |

If a secret already exists, do not replace it. Cloudflare preserves existing secrets during normal code deployments.

### Optional secrets

| Secret | Needed for |
|---|---|
| `TAVILY_API_KEY` | Current web search |
| `GOOGLE_CLIENT_ID` | Google Calendar OAuth |
| `GOOGLE_CLIENT_SECRET` | Google Calendar OAuth |
| `MICROSOFT_CLIENT_ID` | Microsoft OneNote OAuth |
| `MICROSOFT_CLIENT_SECRET` | Microsoft OneNote OAuth |
| `TOKEN_ENCRYPTION_KEY` | Encrypting Google and Microsoft OAuth tokens in D1 |

Never paste any of these values into GitHub, source code, chat, or a screenshot.

## Part 5 — first safe test

1. Open the normal `assistant-core...workers.dev` address.
2. Unlock Silk with your `APP_PASSWORD`.
3. Open **Settings** and confirm:
   - Router: `gpt-5-nano`
   - Routine: `gpt-5.6-luna`
   - Complex: `gpt-5.6-terra`
4. Open **Today**, add a harmless test task, mark it complete, and refresh.
5. Open **Memory**, create or edit a harmless test memory, change its privacy, and refresh.
6. Ask: `Hello Silk`—this should route to Nano.
7. Ask: `Rewrite this sentence more clearly`—this should route to Luna.
8. Ask a difficult comparison question—automatic mode should route to Terra.

The first authenticated API request runs the safe D1 schema check. New tables and columns are added with `IF NOT EXISTS` or guarded column checks; existing rows are retained.

## Part 6 — Google Calendar after the app works

Calendar uses Google OAuth, so Google secures the email sign-in. Silk’s owner passphrase still protects the dashboard itself.

1. In Google Cloud, make sure the Calendar API and OAuth web client are enabled.
2. Add this authorized redirect URI to the Google OAuth client:

   `https://assistant-core.jaedennm.workers.dev/api/google/callback`

   If your final Workers URL is different, use that exact origin followed by `/api/google/callback`.
3. Add the three Google secrets listed above in Cloudflare.
4. Open Silk → **Calendar → Connect Google**.
5. Approve Calendar access on Google’s screen.

Google events become linked Today items. Marking one complete in Silk does not delete or modify the Google event.

Calendar creation, updates, and deletion are deliberately two-step operations. Silk first creates an item in **Activity → Approval queue**. The external change runs only after you select **Approve & run**.

## Part 7 — Microsoft OneNote after Calendar works

Microsoft Graph and OneNote do not require a paid Azure subscription for this personal connection. You do need a free Microsoft Entra app registration.

1. Open [Microsoft Entra admin center](https://entra.microsoft.com/) and go to **Applications → App registrations → New registration**.
2. Name it `Silk OneNote`.
3. Choose **Accounts in any organizational directory and personal Microsoft accounts**.
4. Add this **Web** redirect URI:

   `https://assistant-core.jaedennm.workers.dev/api/microsoft/callback`

   If your Workers address differs, use its exact origin followed by `/api/microsoft/callback`.
5. Under **API permissions → Microsoft Graph → Delegated permissions**, add `User.Read` and `Notes.ReadWrite`. `openid`, `email`, and `offline_access` are requested during sign-in.
6. Under **Certificates & secrets**, create a client secret. Copy its **Value** immediately.
7. In Cloudflare **Variables and Secrets**, add the Application (client) ID as `MICROSOFT_CLIENT_ID` and the secret value as `MICROSOFT_CLIENT_SECRET`. Save both as **Secret**.
8. Confirm `TOKEN_ENCRYPTION_KEY` already exists. If it does not, generate a long random value in a password manager and save it as a Cloudflare Secret.
9. Open Silk → **Connections → Connect Microsoft**.
10. After sign-in, choose the OneNote section that should receive study records and leave automatic sync on.

Silk saves the structured study record to D1 first. If OneNote is unavailable, the D1 record remains safe and shows a failed-sync status so it can be retried later.

## If something goes wrong

### Build failed

Open **assistant-core → Deployments → View build history → failed build** and read the final red error. Check these first:

- `wrangler.cloudflare.jsonc` contains the real D1 database ID.
- The Worker name is still `assistant-core`.
- The root directory is blank or `/`.
- The build and deploy commands match this guide exactly.

### “D1 database binding is missing”

Add the `DB` D1 binding to `assistant-memory`, then deploy the settings change.

### “OpenAI rejected the API key or its permissions”

Confirm `OPENAI_API_KEY` is a Cloudflare **Secret** and the restricted OpenAI key has write permission for **Responses**. Do not send the key to anyone.

### A model ID is rejected

The model may not be enabled for that OpenAI project. In Cloudflare Variables and Secrets, temporarily change the rejected model variable to one that appears in your OpenAI project’s model list, then redeploy. Do not change all three at once; test the router first.

### Roll back

Open **assistant-core → Deployments → Version history**, select the version immediately before Silk OS v0.7, and use Cloudflare’s rollback control. The database is separate from Worker code and is not deleted by a code rollback.

## What you never need to do

- You do not paste this multi-file app into Cloudflare’s one-file editor.
- You do not put an API key in React.
- You do not run database SQL manually for this upgrade.
- You do not install Node, npm, React, Wrangler, or a terminal tool for this browser-only path.
