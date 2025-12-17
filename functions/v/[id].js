export async function onRequestGet({ request, env, params }) {
  const id = params.id;

  // Look up object key + type
  const row = await env.DB.prepare(
    `SELECT r2_key, content_type FROM videos WHERE id = ?1`
  ).bind(id).first();

  if (!row?.r2_key) return new Response("Not found", { status: 404 });

  const rangeHeader = request.headers.get("Range");
  const head = {
    "accept-ranges": "bytes",
    "content-type": row.content_type || "application/octet-stream",
    "cache-control": "public, max-age=3600"
  };

  if (!rangeHeader) {
    const obj = await env.VIDEOS.get(row.r2_key);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, { headers: { ...head, "content-length": String(obj.size) } });
  }

  // Parse "bytes=start-end"
  const m = /^bytes=(\d+)-(\d+)?$/i.exec(rangeHeader);
  if (!m) return new Response("Invalid Range", { status: 416, headers: head });

  const start = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : null;

  const meta = await env.VIDEOS.head(row.r2_key);
  if (!meta) return new Response("Not found", { status: 404 });

  const size = meta.size;
  if (start >= size) {
    return new Response("Range Not Satisfiable", {
      status: 416,
      headers: { ...head, "content-range": `bytes */${size}` }
    });
  }

  const safeEnd = end === null ? Math.min(start + 1024 * 1024 * 8 - 1, size - 1) : Math.min(end, size - 1);
  const length = safeEnd - start + 1;

  const obj = await env.VIDEOS.get(row.r2_key, { range: { offset: start, length } });
  if (!obj) return new Response("Not found", { status: 404 });

  return new Response(obj.body, {
    status: 206,
    headers: {
      ...head,
      "content-length": String(length),
      "content-range": `bytes ${start}-${safeEnd}/${size}`
    }
  });
}