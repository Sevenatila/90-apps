// api/_views/events.js
// Tela "Eventos": o log cru, pra conferir se o rastreio esta chegando.
// E a primeira tela que voce abre quando desconfia que "o painel esta zerado":
// se aqui tem linha, o problema e de leitura; se esta vazio, e de captacao.

const db = require('../_db');
const { baseFilter } = require('../_auth');

module.exports = async function events(q) {
  await db.initDb();

  const E = baseFilter(q, 'ts', { utmVia: 'session' });
  const params = [...E.params];
  let where = E.clause;

  if (q.name) {
    params.push(String(q.name).slice(0, 60));
    where += ` AND event_name = $${params.length}`;
  }
  if (q.session) {
    params.push(String(q.session).slice(0, 40));
    where += ` AND session_id = $${params.length}`;
  }

  const limit = Math.min(300, Math.max(10, parseInt(q.limit, 10) || 150));
  const offset = Math.max(0, parseInt(q.offset, 10) || 0);

  const porTipo = await db.query(
    `SELECT event_name, page,
            COUNT(*)::int                   AS n,
            COUNT(DISTINCT session_id)::int AS sessoes,
            MAX(ts)                         AS ultimo
       FROM lp_events WHERE ${E.clause}
      GROUP BY 1,2 ORDER BY n DESC`,
    E.params
  );

  const total = await db.query(`SELECT COUNT(*)::int AS n FROM lp_events WHERE ${where}`, params);

  params.push(limit, offset);
  const linhas = await db.query(
    `SELECT id, session_id, page, event_name, step_index, section, label, device, ts
       FROM lp_events WHERE ${where}
      ORDER BY ts DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const n = Number(total.rows[0] ? total.rows[0].n : 0);
  return { porTipo: porTipo.rows, total: n, eventos: linhas.rows, hasMore: offset + linhas.rows.length < n };
};
