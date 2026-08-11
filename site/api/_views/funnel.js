// api/_views/funnel.js
// Tela "Funil": onde a visita morre.
//
// Sao DOIS funis diferentes, porque sao dois produtos de trafego diferentes:
//   site → pagina longa, o funil e de rolagem
//   quiz → sequencia de telas, o funil e de passos ate a ultima tela (oferta)
// Com o filtro de pagina em "todas", o painel mostra os dois lado a lado.

const db = require('../_db');
const { baseFilter } = require('../_auth');

const PASSOS = {
  site: [
    { key: 'visit',          step: 0, label: 'Chegou no site' },
    { key: 'scroll_25',      step: 1, label: 'Rolou 25%' },
    { key: 'scroll_50',      step: 2, label: 'Rolou 50%' },
    { key: 'scroll_75',      step: 3, label: 'Rolou 75%' },
    { key: 'scroll_90',      step: 4, label: 'Rolou 90%' },
    { key: 'cta_click',      step: 5, label: 'Clicou num CTA' },
    { key: 'checkout_click', step: 6, label: 'Foi pro checkout' },
  ],
  quiz: [
    { key: 'visit',            step: 0, label: 'Abriu o quiz' },
    { key: 'quiz_start',       step: 1, label: 'Começou a responder' },
    { key: 'quiz_q1',          step: 2, label: 'Respondeu a 1ª' },
    { key: 'quiz_q2',          step: 3, label: 'Respondeu a 2ª' },
    { key: 'quiz_q3',          step: 4, label: 'Respondeu a 3ª' },
    { key: 'quiz_diagnostico', step: 5, label: 'Viu o diagnóstico' },
    { key: 'quiz_oferta',      step: 6, label: 'Chegou na oferta' },
    { key: 'checkout_click',   step: 7, label: 'Foi pro checkout' },
  ],
};

module.exports = async function funnel(q) {
  await db.initDb();

  const E = baseFilter(q, 'ts', { utmVia: 'session' });
  const S = baseFilter(q, 'first_ts');

  // ── 1. Funil cumulativo por pagina ────────────────────────────────────────
  // Conta SESSOES DISTINTAS por step. Contar por step exato daria um funil
  // furado (quem pula um evento sumiria), por isso o acumulado vem depois.
  const bruto = await db.query(
    `SELECT page, step_index, COUNT(DISTINCT session_id)::int AS sessoes
       FROM lp_events
      WHERE ${E.clause} AND (step_index > 0 OR event_name = 'visit')
      GROUP BY 1,2`,
    E.params
  );

  const paginas = q.page === 'site' || q.page === 'quiz' ? [q.page] : ['site', 'quiz'];
  const funis = paginas.map(pg => {
    const porStep = new Map(
      bruto.rows.filter(r => r.page === pg).map(r => [Number(r.step_index), Number(r.sessoes)])
    );
    // Cumulativo de tras pra frente: quem chegou no 6 conta no 5, no 4...
    const maxStep = Math.max(0, ...Array.from(porStep.keys()));
    const cumulativo = new Map();
    let acc = 0;
    for (let i = maxStep; i >= 0; i--) {
      acc += porStep.get(i) || 0;
      cumulativo.set(i, acc);
    }
    const topo = cumulativo.get(0) || 0;
    const passos = PASSOS[pg].map(p => ({
      ...p,
      sessoes: cumulativo.get(p.step) || 0,
      pct_do_topo: topo ? Number((((cumulativo.get(p.step) || 0) / topo) * 100).toFixed(1)) : 0,
    }));
    // Queda entre passos consecutivos — o maior numero aqui e o gargalo.
    for (let i = 1; i < passos.length; i++) {
      const ant = passos[i - 1].sessoes;
      passos[i].perdeu = Math.max(0, ant - passos[i].sessoes);
      passos[i].pct_do_anterior = ant ? Number(((passos[i].sessoes / ant) * 100).toFixed(1)) : 0;
    }
    return { page: pg, passos };
  }).filter(f => f.passos[0].sessoes > 0 || paginas.length === 1);

  // ── 2. Alcance por secao/tela ─────────────────────────────────────────────
  const secoes = await db.query(
    `SELECT page, section, COUNT(DISTINCT session_id)::int AS sessoes
       FROM lp_events
      WHERE event_name = 'section_view' AND section IS NOT NULL AND ${E.clause}
      GROUP BY 1,2 ORDER BY sessoes DESC`,
    E.params
  );

  // ── 3. Onde as sessoes PARARAM ────────────────────────────────────────────
  const abandono = await db.query(
    `SELECT page, COALESCE(last_section, 'não registrada') AS section,
            COUNT(*)::int AS sessoes
       FROM lp_sessions
      WHERE ${S.clause} AND NOT reached_checkout
      GROUP BY 1,2 ORDER BY sessoes DESC LIMIT 24`,
    S.params
  );

  // ── 4. Quais CTAs trabalham de verdade ────────────────────────────────────
  const ctas = await db.query(
    `SELECT page, COALESCE(section, '—') AS section,
            COALESCE(label, 'CTA')       AS label,
            COUNT(*)::int                   AS cliques,
            COUNT(DISTINCT session_id)::int AS sessoes
       FROM lp_events
      WHERE event_name IN ('cta_click','checkout_click') AND ${E.clause}
      GROUP BY 1,2,3 ORDER BY cliques DESC LIMIT 30`,
    E.params
  );

  return {
    funis,
    secoes:   secoes.rows,
    abandono: abandono.rows,
    ctas:     ctas.rows,
  };
};
