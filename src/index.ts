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
  ALLOWED_ORIGINS?: string; // optional
}

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) },
  });

function cors(req: Request, env: Env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);

  const allowOrigin = !origin
    ? (allowed[0] || "*")
    : (allowed.includes(origin) ? origin : (allowed[0] || "*"));

  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,range",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "upload.bin";
}

function pathOf(url: URL) {
  if (url.pathname !== "/" && url.pathname.endsWith("/")) return url.pathname.slice(0, -1);
  return url.pathname;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = pathOf(url);

    // Preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(req, env) });
    }

    try {
      // ✅ Health
      if (req.method === "GET" && path === "/api/health") {
        return json({ ok: true, service: "wookstars-api" }, { headers: cors(req, env) });
      }

      // ✅ List videos
      if (req.method === "GET" && path === "/api/videos") {
        const category = (url.searchParams.get("category") || "").trim();
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "24", 10) || 24, 60);

        let stmt;
        if (category && category !== "All") {
          stmt = q
            ? env.DB.prepare(
                `SELECT id,title,category,created_at,views
                 FROM videos
                 WHERE category = ?1 AND (lower(title) LIKE ?2 OR lower(coalesce(description,'')) LIKE ?2)
                 ORDER BY created_at DESC
                 LIMIT ?3`
              ).bind(category, `%${q}%`, limit)
            : env.DB.prepare(
                `SELECT id,title,category,created_at,views
                 FROM videos
                 WHERE category = ?1
                 ORDER BY created_at DESC
                 LIMIT ?2`
              ).bind(category, limit);
        } else {
          stmt = q
            ? env.DB.prepare(
                `SELECT id,title,category,created_at,views
                 FROM videos
                 WHERE (lower(title) LIKE ?1 OR lower(coalesce(description,'')) LIKE ?1)
                 ORDER BY created_at DESC
                 LIMIT ?2`
              ).bind(`%${q}%`, limit)
            : env.DB.prepare(
                `SELECT id,title,category,created_at,views
                 FROM videos
                 ORDER BY created_at DESC
                 LIMIT ?1`
              ).bind(limit);
        }

        const res = await stmt.all();
        return json({ ok: true, items: res.results || [] }, { headers: cors(req, env) });
      }

      // ✅ Upload (anonymous) — multipart form: title, category, description, file
      if (req.method === "POST" && path === "/api/upload") {
        const ct = req.headers.get("content-type") || "";
        if (!ct.includes("multipart/form-data")) {
          return json({ ok: false, error: "Expected multipart/form-data" }, { status: 400, headers: cors(req, env) });
        }

        const form = await req.formData();
        const title = String(form.get("title") || "").trim();
        const category = String(form.get("category") || "").trim() || "Uncategorized";
        const description = String(form.get("description") || "").trim();
        const file = form.get("file");

        if (!title) return json({ ok: false, error: "Missing title" }, { status: 400, headers: cors(req, env) });
        if (!(file instanceof File)) return json({ ok: false, error: "Missing file" }, { status: 400, headers: cors(req, env) });

        // keep beta small; later we’ll do direct-to-R2 multipart
        const maxBytes = 50 * 1024 * 1024;
        if (file.size > maxBytes) {
          return json({ ok: false, error: "File too large (max 50MB for now)." }, { status: 400, headers: cors(req, env) });
        }

        const id = crypto.randomUUID();
        const safeName = sanitizeFilename(file.name);
        const ext = safeName.includes(".") ? safeName.split(".").pop()!.toLowerCase() : "bin";
        const key = `videos/${id}.${ext}`;
        const contentType = file.type || "application/octet-stream";

        await env.VIDEOS.put(key, await file.arrayBuffer(), {
          httpMetadata: { contentType },
          customMetadata: { title, category },
        });

        const createdAt = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO videos (id,title,category,description,r2_key,content_type,created_at,views)
           VALUES (?1,?2,?3,?4,?5,?6,?7,0)`
        ).bind(id, title, category, description || null, key, contentType, createdAt).run();

        return json({ ok: true, id }, { headers: cors(req, env) });
      }

      // ✅ Stream: GET /api/videos/:id/stream (Range supported)
      if (req.method === "GET" && path.startsWith("/api/videos/") && path.endsWith("/stream")) {
        const parts = path.split("/");
        const id = parts[3]; // /api/videos/{id}/stream

        if (!id) return json({ ok: false, error: "Missing id" }, { status: 400, headers: cors(req, env) });

        const row = await env.DB.prepare(`SELECT r2_key, content_type FROM videos WHERE id = ?1`)
          .bind(id)
          .first<{ r2_key: string; content_type: string }>();

        if (!row) return new Response("Not Found", { status: 404, headers: cors(req, env) });

        const rangeHeader = req.headers.get("Range") || undefined;

        let r2Range: R2Range | undefined;
        if (rangeHeader) {
          const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
          if (m) {
            const start = m[1] ? Number(m[1]) : undefined;
            const end = m[2] ? Number(m[2]) : undefined;
            if (start !== undefined && !Number.isNaN(start)) {
              r2Range =
                end !== undefined && !Number.isNaN(end) && end >= start
                  ? { offset: start, length: end - start + 1 }
                  : { offset: start };
            }
          }
        }

        const obj = await env.VIDEOS.get(row.r2_key, r2Range ? { range: r2Range } : undefined);
        if (!obj) return new Response("Not Found", { status: 404, headers: cors(req, env) });

        // simple view count bump only on non-range initial load
        if (!rangeHeader) {
          await env.DB.prepare(`UPDATE videos SET views = views + 1 WHERE id = ?1`).bind(id).run();
        }

        const headers = new Headers(cors(req, env));
        headers.set("content-type", row.content_type || "video/mp4");
        headers.set("accept-ranges", "bytes");

        if (obj.range) {
          headers.set("content-range", `bytes ${obj.range.offset}-${obj.range.end}/${obj.size}`);
          headers.set("content-length", String(obj.range.length));
          return new Response(obj.body, { status: 206, headers });
        }

        headers.set("content-length", String(obj.size));
        return new Response(obj.body, { status: 200, headers });
      }

      return new Response("Not Found", { status: 404, headers: cors(req, env) });
    } catch (err: any) {
      return json({ ok: false, error: err?.message || "Unknown error" }, { status: 500, headers: cors(req, env) });
    }
  },
};
