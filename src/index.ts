/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {
  VIDEOS: R2Bucket;
  DB: D1Database;
  ALLOWED_ORIGINS: [
  "https://wookstars.pages.dev",
  "https://www.wookstars.com",
  "https://wookstars.com"
];
}
function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "*";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
  };
}

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) },
  });

function pickOrigin(req: Request, env: Env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!origin) return allowed[0] || "*";
  return allowed.includes(origin) ? origin : allowed[0] || "*";
}

function parseAllowedOrigins(env: any): string[] {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
  // If Origin is in our allow-list, echo it back.
  // Otherwise don't set ACAO to a mismatched value.
  const allowOrigin = allowed.includes(origin) ? origin : "";

  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Range",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
};

function notFound(req: Request, env: Env) {
  return json({ ok: false, error: "Not found" }, { status: 404, headers: corsHeaders(req, env) });
}
function badRequest(req: Request, env: Env, message: string) {
  return json({ ok: false, error: message }, { status: 400, headers: corsHeaders(req, env) });
}
function serverError(req: Request, env: Env, message: string) {
  return json({ ok: false, error: message }, { status: 500, headers: corsHeaders(req, env) });
}
function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "upload.bin";
}
function getPath(url: URL) {
  if (url.pathname !== "/" && url.pathname.endsWith("/")) return url.pathname.slice(0, -1);
  return url.pathname;
}

function getAllowedOrigin(req: Request, env: any) {
  const origin = req.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // If no Origin header (e.g., curl), just return first allowed or "*"
  if (!origin) return allowed[0] || "*";

  return allowed.includes(origin) ? origin : allowed[0] || "*";
}

function withCors(req: Request, env: any, res: Response) {
  const headers = new Headers(res.headers);

  headers.set("Access-Control-Allow-Origin", getAllowedOrigin(req, env));
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type,Range");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");

  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(req: Request, env: any) {
    const url = new URL(req.url);

    // Preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(req),
      });
    }

    // Health check
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(req),
        },
      });
    }

    // GET /api/videos
    if (url.pathname === "/api/videos" && req.method === "GET") {
      return listVideos(req, env);
    }

    // GET /api/videos/:id
    if (url.pathname.match(/^\/api\/videos\/[^/]+$/) && req.method === "GET") {
      return getVideoMeta(req, env);
    }

    // STREAM
    if (url.pathname.match(/^\/api\/videos\/[^/]+\/stream$/)) {
      return streamVideo(req, env);
    }

    // UPLOAD
    if (url.pathname === "/api/upload" && req.method === "POST") {
      return uploadVideo(req, env);
    }

    return new Response("Not Found", { status: 404 });
  }
};

