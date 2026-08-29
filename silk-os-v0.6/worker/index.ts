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
      return withSecurityHeaders(await silkCore.fetch(request, routedEnv, ctx));
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
