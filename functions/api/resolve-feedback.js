const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'INVALID_JSON' }, 400);
  }

  const { id, source } = body;
  if (!id || !source) return json({ error: 'MISSING_FIELDS' }, 400);
  if (!['inventario', 'facturacion', 'inversiones'].includes(source)) {
    return json({ error: 'INVALID_SOURCE' }, 400);
  }

  const resolvedBy = request.headers.get('CF-Access-Authenticated-User-Email') ?? 'unknown';
  const resolvedAt = new Date().toISOString();

  if (source === 'inventario') {
    const info = await env.INVENTARIO_DB.prepare(
      "UPDATE feedback_reports SET status='resolved', resolved_by=?, resolved_at=? WHERE id=?"
    ).bind(resolvedBy, resolvedAt, id).run();
    if (info.meta.changes === 0) return json({ error: 'NOT_FOUND' }, 404);
    return json({ ok: true });
  }

  const kv = source === 'facturacion' ? env.FACTURACION_KV : env.INVERSIONES_KV;
  const existing = await kv.get(`feedback:${id}`, 'json');
  if (!existing) return json({ error: 'NOT_FOUND' }, 404);

  await kv.put(
    `feedback:${id}`,
    JSON.stringify({ ...existing, status: 'resolved', resolved_by: resolvedBy, resolved_at: resolvedAt })
  );

  return json({ ok: true });
}
