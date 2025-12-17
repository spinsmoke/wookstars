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

    // CORS
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (url.pathname === "/upload" && req.method === "POST") {
      return handleUpload(req, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};

async function handleUpload(req: Request, env: any) {
  const form = await req.formData();
  const file = form.get("file") as File;
  const title = form.get("title")?.toString() || "Untitled";

  if (!file) {
    return new Response("No file uploaded", { status: 400 });
  }

  const id = crypto.randomUUID();
  const key = `${id}.mp4`;

  // Upload to R2
  await env.VIDEOS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  // Save metadata to D1
  await env.DB.prepare(
    `INSERT INTO videos (id, title, r2_key, created_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).bind(id, title, key).run();

  return new Response(JSON.stringify({ success: true, id }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
