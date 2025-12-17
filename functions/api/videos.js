export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(50, parseInt(url.searchParams.get("limit") || "24", 10)));

  const { results } = await env.DB.prepare(
    `SELECT id, title, category, views, created_at
     FROM videos
     ORDER BY created_at DESC
     LIMIT ?1`
  ).bind(limit).all();

  const videos = (results || []).map(row => ({
    id: row.id,
    title: row.title,
    category: row.category,
    views: row.views ?? 0,
    age: row.created_at ? humanAge(row.created_at) : "",
    thumb: null, // you can add thumbnails later
    playbackUrl: `/v/${row.id}`
  }));

  return new Response(JSON.stringify({ videos }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function humanAge(sqliteDateTime) {
  // sqlite 'YYYY-MM-DD HH:MM:SS'
  const iso = sqliteDateTime.replace(" ", "T") + "Z";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d`;
  const w = Math.floor(d / 7);
  return `${w}w`;
}