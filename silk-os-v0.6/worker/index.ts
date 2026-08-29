/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import silkCore from "./silk-core.js";
import { classifyAutomaticChatTier, routeAutomaticModelEnv } from "./model-routing.js";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  APP_PASSWORD?: string;
  OPENAI_API_KEY?: string;
  OPENAI_ROUTER_MODEL?: string;
  OPENAI_ROUTINE_MODEL?: string;
  OPENAI_COMPLEX_MODEL?: string;
  OPENAI_SPEND_LIMIT_USD?: string;
  PRIMARY_AI_PROVIDER?: string;
  TAVILY_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/") || url.pathname === "/manifest.webmanifest") {
      const routedEnv = await chatRoutingEnv(request, url, env);
      const response = await silkCore.fetch(request, routedEnv, ctx);
      const setupHelp = response.status === 503
        ? connectionSetupResponse(request, url, env)
        : null;
      return withSecurityHeaders(setupHelp || response);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return withSecurityHeaders(await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths));
    }

    return withSecurityHeaders(await handler.fetch(request, env, ctx));
  },
};

async function chatRoutingEnv(request: Request, url: URL, env: Env): Promise<Env> {
  if (request.method !== "POST" || !["/api/chat", "/api/chat/stream"].includes(url.pathname)) {
    return env;
  }

  // Explicit Routine/Complex selections stay authoritative. The policy below
  // only corrects the Automatic router's model choice.
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'model_mode'")
      .first<{ value?: string }>();
    const mode = String(row?.value || "automatic").trim().toLowerCase();
    if (mode !== "automatic") return env;
  } catch {
    // On a fresh database the core will initialize the schema and use its
    // default Automatic setting. Continue with the automatic policy here too.
  }

  let message = "";
  try {
    const body = await request.clone().json() as { message?: unknown };
    message = typeof body?.message === "string" ? body.message : "";
  } catch {
    return env;
  }
  if (!message.trim()) return env;

  const tier = classifyAutomaticChatTier(message);
  return routeAutomaticModelEnv(env, tier) as Env;
}

function connectionSetupResponse(request: Request, url: URL, env: Env): Response | null {
  if (request.method !== "GET") return null;

  let name = "";
  let description = "";
  let callbackPath = "";
  let secrets: Array<[string, string | undefined]> = [];

  if (url.pathname === "/api/google/connect") {
    name = "Google Calendar";
    description = "Google sign-in can start as soon as the server-side OAuth credentials are configured.";
    callbackPath = "/api/google/callback";
    secrets = [
      ["GOOGLE_CLIENT_ID", env.GOOGLE_CLIENT_ID],
      ["GOOGLE_CLIENT_SECRET", env.GOOGLE_CLIENT_SECRET],
      ["TOKEN_ENCRYPTION_KEY", env.TOKEN_ENCRYPTION_KEY],
    ];
  } else if (url.pathname === "/api/microsoft/connect") {
    name = "Microsoft OneNote";
    description = "Microsoft sign-in can start as soon as the server-side OAuth credentials are configured.";
    callbackPath = "/api/microsoft/callback";
    secrets = [
      ["MICROSOFT_CLIENT_ID", env.MICROSOFT_CLIENT_ID],
      ["MICROSOFT_CLIENT_SECRET", env.MICROSOFT_CLIENT_SECRET],
      ["TOKEN_ENCRYPTION_KEY", env.TOKEN_ENCRYPTION_KEY],
    ];
  } else {
    return null;
  }

  const missing = secrets.filter(([, value]) => !value).map(([key]) => key);
  if (!missing.length) return null;

  const callback = new URL(callbackPath, request.url).toString();
  const missingItems = missing.map((key) => `<li><code>${escapeHtml(key)}</code></li>`).join("");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(name)} setup · SILK</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#030a0f;color:#eaf8ff}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 70% 0,rgba(42,190,225,.13),transparent 35%),#030a0f}
    main{width:min(680px,100%);border:1px solid rgba(114,231,255,.18);border-radius:18px;padding:28px;background:rgba(7,22,30,.94);box-shadow:0 28px 90px rgba(0,0,0,.4)}
    .eyebrow{font:700 11px ui-monospace,monospace;letter-spacing:.18em;color:#72e7ff}h1{margin:10px 0 8px;font-size:28px}p{color:#91aab6;line-height:1.65}ol{padding-left:24px;color:#cfe7ef}li{margin:9px 0}code{color:#72ffd4;background:rgba(114,255,212,.06);border:1px solid rgba(114,255,212,.12);border-radius:7px;padding:3px 6px}.callback{display:block;overflow-wrap:anywhere;margin:10px 0 20px;padding:12px;border:1px solid rgba(114,231,255,.12);border-radius:9px;background:#02070a;color:#bcefff}a{display:inline-flex;text-decoration:none;color:#031014;background:#72e7ff;border-radius:9px;padding:10px 14px;font-weight:700}.note{font-size:12px;color:#6f8a97}
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">SILK CONNECTION SETUP</div>
    <h1>${escapeHtml(name)} needs configuration</h1>
    <p>${escapeHtml(description)}</p>
    <p>Add these missing values as <strong>encrypted Worker secrets</strong> in Cloudflare:</p>
    <ol>${missingItems}</ol>
    <p>Use this authorized redirect/callback URI in the provider console:</p>
    <code class="callback">${escapeHtml(callback)}</code>
    <p class="note">Never place client secrets, encryption keys, passwords, or OAuth tokens in GitHub or browser code.</p>
    <a href="/">Back to SILK</a>
  </main>
</body>
</html>`;

  return new Response(html, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return character;
    }
  });
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), geolocation=(self), microphone=(self), payment=(), usb=()");
  if ((headers.get("content-type") || "").includes("text/html")) {
    headers.set("Cache-Control", "no-store");
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default worker;
