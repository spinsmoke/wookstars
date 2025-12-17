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

export default {
  async fetch(req: Request, env: any) {
    const url = new URL(req.url);

    // ===== CORS =====
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // ===== HEALTH CHECK =====
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true, service: "wookstars-api" }, env);
    }

    // ===== UPLOAD =====
    if (req.method === "POST" && url.pathname === "/api/upload") {
      return handleUpload(req, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};

function json(data: any, env: any) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    },
  });
}

async function handleUpload(req: Request, env: any) {
  const form = await req.formData();
  const file = form.get("file") as File;
  const title = form.get("title")?.toString() || "Untitled";

  if (!file) {
    return new Response("No file uploaded", { status: 400 });
  }

  const id = crypto.randomUUID();
  const ext = file.name.split(".").pop() || "mp4";
  const key = `videos/${id}.${ext}`;

  // Upload to R2
  await env.VIDEOS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  // Save metadata to D1
  await env.DB.prepare(
    `INSERT INTO videos (id, title, r2_key, created_at)
     VALUES (?, ?, ?, datetime('now'))`
  )
    .bind(id, title, key)
    .run();

  return json({ success: true, id }, env);
}
