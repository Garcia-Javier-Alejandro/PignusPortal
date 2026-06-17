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

async function safeLoad(label, fn) {
  try {
    return { label, items: await fn() };
  } catch (err) {
    console.error(`[feedback] ${label} failed:`, err.message);
    return { label, items: [], error: err.message };
  }
}

export async function onRequestGet({ env }) {
  const [d1, fac, inv] = await Promise.all([
    safeLoad('inventario', () => fromD1(env.INVENTARIO_DB)),
    safeLoad('facturacion', () => fromKV(env.FACTURACION_KV, 'facturacion')),
    safeLoad('inversiones', () => fromKV(env.INVERSIONES_KV, 'inversiones')),
  ]);

  const reports = [...d1.items, ...fac.items, ...inv.items].sort(
    (a, b) => b.created_at.localeCompare(a.created_at)
  );

  const errors = [d1, fac, inv]
    .filter((s) => s.error)
    .map((s) => `${s.label}: ${s.error}`);

  return json({ reports, ...(errors.length ? { errors } : {}) });
}
