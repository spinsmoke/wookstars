export async function onRequestPost({ request, env }) {
  try {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return json({ error: "Expected multipart/form-data" }, 400);
    }

    const form = await request.formData();
    const title = (form.get("title") || "").toString().trim();
    const category = (form.get("category") || "").toString().trim();
    const desc = (form.get("desc") || "").toString().trim();
    const file = form.get("file");

    if (!title) return json({ error: "Missing title" }, 400);
    if (!category) return json({ error: "Missing category" }, 400);
    if (!file || typeof file === "string") return json({ error: "Missing file" }, 400);

    // Cloudflare Workers gives you a global crypto; do NOT import 'crypto'
    const id = crypto.randomUUID();

    // Basic validation
    const contentType = file.type || "application/octet-stream";
    if (!contentType.startsWith("video/")) {
      return json({ error: "Only video uploads are allowed (video/*)." }, 415);
    }

    // Store object in R2
    const key = `videos/${id}`;
    await env.VIDEOS.put(key, file.stream(), {
      httpMetadata: { contentType },
      customMetadata: {
        title,
        category
      }
    });

    // Save metadata in D1
    await env.DB.prepare(
      `INSERT INTO videos (id, title, category, description, r2_key, content_type, views, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, datetime('now'))`
    ).bind(id, title, category, desc, key, contentType).run();

    return json({
      id,
      playbackUrl: `/v/${id}`
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return json({ error: err?.message || "Upload failed" }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}