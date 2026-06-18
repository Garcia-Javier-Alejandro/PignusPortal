const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

const APP_LABELS = { inventario: 'Inventario', facturacion: 'Facturación', inversiones: 'Inversiones' };

function getReporterEmail(request) {
  const header = request.headers.get('CF-Access-Authenticated-User-Email');
  if (header) return header;
  const jwt = request.headers.get('CF-Access-Jwt-Assertion');
  if (!jwt) return 'unknown';
  try {
    let b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    b64 += '='.repeat((4 - b64.length % 4) % 4);
    return JSON.parse(atob(b64)).email ?? 'unknown';
  } catch { return 'unknown'; }
}

async function sendEmail(apiKey, { to, subject, html }) {
  if (!apiKey || !to || to === 'unknown' || !to.includes('@')) return;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Pignus <noreply@pignuslabs.com.ar>', to, subject, html }),
    });
    if (!res.ok) console.error(`[email] Resend error ${res.status}`);
  } catch (err) {
    console.error('[email] Failed:', err.message);
  }
}

function buildResolvedHtml({ source, type, screen, tried, expected, happened, impact, proposed_change, justification, resolvedBy }) {
  const appLabel = APP_LABELS[source] ?? source;
  const esc = (s) => s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
  const row = (label, val) => val ? `<tr><td style="padding:8px 0;border-bottom:1px solid #e8e2d9;font-size:13px;color:#6b7280;width:150px;vertical-align:top">${label}</td><td style="padding:8px 0;border-bottom:1px solid #e8e2d9;font-size:13px;color:#1c1814;white-space:pre-wrap">${esc(val)}</td></tr>` : '';
  const typeLabel = type === 'bug' ? 'Problema' : 'Mejora';
  const detailRows = type === 'bug'
    ? row('¿Qué intentaste?', tried) + row('¿Qué esperabas?', expected) + row('¿Qué pasó?', happened) + row('Impacto', impact)
    : row('Cambio propuesto', proposed_change) + row('Justificación', justification);
  const tableRows = row('Tipo', typeLabel) + row('Pantalla', screen) + detailRows + row('Resuelto por', resolvedBy);
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f5f0e8;font-family:Georgia,serif;color:#1c1814;"><table style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);" cellpadding="0" cellspacing="0" width="100%"><tr><td style="background:#1c1814;padding:24px 32px;"><p style="margin:0;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#a89880;">Pignus ${appLabel}</p><h1 style="margin:4px 0 0;font-size:22px;font-weight:500;color:#f5f0e8;">Reporte resuelto</h1></td></tr><tr><td style="padding:24px 32px;"><p style="margin:0 0 16px;font-size:15px;">El reporte que enviaste fue marcado como resuelto.</p><table cellpadding="0" cellspacing="0" width="100%">${tableRows}</table></td></tr><tr><td style="padding:16px 32px;background:#f5f0e8;border-top:1px solid #e8e2d9;"><p style="margin:0;font-size:11px;color:#9ca3af;font-family:sans-serif;">Este correo fue enviado automáticamente al resolverse tu reporte.</p></td></tr></table></body></html>`;
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

  const resolvedBy = getReporterEmail(request);
  const resolvedAt = new Date().toISOString();

  if (source === 'inventario') {
    const record = await env.INVENTARIO_DB.prepare(
      "SELECT reported_by, type, screen, tried, expected, happened, impact, proposed_change, justification FROM feedback_reports WHERE id = ? AND status = 'open'"
    ).bind(id).first();
    if (!record) return json({ error: 'NOT_FOUND' }, 404);

    await env.INVENTARIO_DB.prepare(
      "UPDATE feedback_reports SET status='resolved', resolved_by=?, resolved_at=? WHERE id=?"
    ).bind(resolvedBy, resolvedAt, id).run();

    await sendEmail(env.RESEND_API_KEY, {
      to: record.reported_by,
      subject: `Tu reporte fue resuelto — Pignus Inventario`,
      html: buildResolvedHtml({ source, type: record.type, screen: record.screen, tried: record.tried, expected: record.expected, happened: record.happened, impact: record.impact, proposed_change: record.proposed_change, justification: record.justification, resolvedBy }),
    });

    return json({ ok: true });
  }

  const kv = source === 'facturacion' ? env.FACTURACION_KV : env.INVERSIONES_KV;
  const existing = await kv.get(`feedback:${id}`, 'json');
  if (!existing) return json({ error: 'NOT_FOUND' }, 404);

  await kv.put(
    `feedback:${id}`,
    JSON.stringify({ ...existing, status: 'resolved', resolved_by: resolvedBy, resolved_at: resolvedAt })
  );

  await sendEmail(env.RESEND_API_KEY, {
    to: existing.reported_by,
    subject: `Tu reporte fue resuelto — Pignus ${APP_LABELS[source]}`,
    html: buildResolvedHtml({ source, type: existing.type, screen: existing.screen, tried: existing.tried, expected: existing.expected, happened: existing.happened, impact: existing.impact, proposed_change: existing.proposed_change, justification: existing.justification, resolvedBy }),
  });

  return json({ ok: true });
}
