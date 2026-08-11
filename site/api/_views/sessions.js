// api/_views/sessions.js
// Tela "Sessoes": a lista de visitas e a jornada individual.
//
// Sem ?id= → lista paginada, com filtro de comportamento.
// Com ?id= → a linha do tempo daquela visita, evento por evento.
//   Ver 5 jornadas de quem quase comprou ensina mais que qualquer media.

const db = require('../_db');
const { baseFilter } = require('../_auth');

module.exports = async function sessions(q) {
  await db.initDb();

  // ── Detalhe de uma sessao ─────────────────────────────────────────────────
  if (q.id) {
    const id = String(q.id).slice(0, 40);
    const sessao = await db.query(`SELECT * FROM lp_sessions WHERE session_id = $1`, [id]);
    if (!sessao.rows.length) return { erro: 'Sessão não encontrada' };

    const eventos = await db.query(
      `SELECT event_name, step_index, section, label, ts
         FROM lp_events WHERE session_id = $1 ORDER BY ts ASC LIMIT 500`,
      [id]
    );
    const cliques = await db.query(
      `SELECT section, label, x_pct, y_pct, is_cta, dead, ts
         FROM lp_clicks WHERE session_id = $1 ORDER BY ts ASC LIMIT 300`,
      [id]
    );
    return { sessao: sessao.rows[0], eventos: eventos.rows, cliques: cliques.rows };
  }

  // ── Lista ─────────────────────────────────────────────────────────────────
  const S = baseFilter(q, 's.first_ts', { prefix: 's.' });
  const params = [...S.params];
  let where = S.clause;

  const filtro = String(q.filtro || 'all');
  if (filtro === 'checkout')      where += ` AND s.reached_checkout`;
  else if (filtro === 'cta')      where += ` AND s.cta_clicks > 0 AND NOT s.reached_checkout`;
  else if (filtro === 'oferta')   where += ` AND s.viu_oferta AND NOT s.reached_checkout`;
  else if (filtro === 'lead')     where += ` AND s.deu_email`;
  else if (filtro === 'engajou')  where += ` AND s.max_scroll >= 50 AND s.cta_clicks = 0`;
  else if (filtro === 'rejeitou') where += ` AND s.max_scroll < 25 AND s.duration_sec < 10`;
  else if (filtro === 'raiva')    where += ` AND EXISTS (SELECT 1 FROM lp_events e
                                              WHERE e.session_id = s.session_id AND e.event_name = 'rage_click')`;

  const limit = Math.min(200, Math.max(10, parseInt(q.limit, 10) || 60));
  const offset = Math.max(0, parseInt(q.offset, 10) || 0);

  const total = await db.query(`SELECT COUNT(*)::int AS n FROM lp_sessions s WHERE ${where}`, params);

  params.push(limit, offset);
  const lista = await db.query(
    `SELECT s.session_id, s.page, s.first_ts, s.device, s.max_scroll, s.last_section,
            s.duration_sec, s.cta_clicks, s.reached_checkout, s.viu_oferta, s.deu_email,
            s.utm_source, s.utm_campaign, s.country, s.quiz_nicho
       FROM lp_sessions s
      WHERE ${where}
      ORDER BY s.first_ts DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const n = Number(total.rows[0] ? total.rows[0].n : 0);
  return { total: n, sessoes: lista.rows, hasMore: offset + lista.rows.length < n };
};
