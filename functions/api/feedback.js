const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

async function fromD1(db) {
  const { results } = await db.prepare(
    'SELECT id, type, screen, tried, expected, happened, impact, proposed_change, justification, reported_by, created_at, status, resolved_by, resolved_at FROM feedback_reports ORDER BY created_at DESC'
  ).all();
  return results.map((r) => ({ ...r, source: 'inventario' }));
}

async function fromKV(kv, source) {
  const list = await kv.list({ prefix: 'feedback:' });
  const items = await Promise.all(
    list.keys.map((k) => kv.get(k.name, 'json'))
  );
  return items
    .filter(Boolean)
    .map((r) => ({
      id: r.id,
      source,
      type: r.type,
      screen: r.screen ?? null,
      tried: r.tried ?? null,
      expected: r.expected ?? null,
      happened: r.happened ?? null,
      impact: r.impact ?? null,
      proposed_change: r.proposed_change ?? null,
      justification: r.justification ?? null,
      reported_by: r.reported_by ?? null,
      created_at: r.created_at,
      status: r.status ?? 'open',
      resolved_by: r.resolved_by ?? null,
      resolved_at: r.resolved_at ?? null,
    }));
}

export async function onRequestGet({ env }) {
  const [d1Items, facItems, invItems] = await Promise.all([
    fromD1(env.INVENTARIO_DB),
    fromKV(env.FACTURACION_KV, 'facturacion'),
    fromKV(env.INVERSIONES_KV, 'inversiones'),
  ]);

  const reports = [...d1Items, ...facItems, ...invItems].sort(
    (a, b) => b.created_at.localeCompare(a.created_at)
  );

  return json({ reports });
}
