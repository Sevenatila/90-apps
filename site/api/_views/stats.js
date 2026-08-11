// api/_views/stats.js
// Tela "Visao Geral": os numeros do topo + series por dia, pagina, aparelho
// e origem. Tudo respeita a barra de filtros (periodo, pagina, aparelho, UTM).

const db = require('../_db');
const { periodFilter, baseFilter } = require('../_auth');

module.exports = async function stats(q) {
  await db.initDb();

  const S = baseFilter(q, 's.first_ts', { prefix: 's.' });
  const P = periodFilter(q, 'ts', 1);   // pagamentos nao tem pagina/aparelho

  // ── Resumo das sessoes ────────────────────────────────────────────────────
  // "rejeicao" = nao passou de 25% da pagina E ficou menos de 10s. E o
  // criterio honesto: bateu o olho e saiu.
  const resumo = await db.query(
    `SELECT
       COUNT(*)::int                                              AS sessoes,
       COUNT(*) FILTER (WHERE s.cta_clicks > 0)::int              AS com_cta,
       COUNT(*) FILTER (WHERE s.reached_checkout)::int            AS checkouts,
       COUNT(*) FILTER (WHERE s.viu_oferta)::int                  AS viram_oferta,
       COUNT(*) FILTER (WHERE s.deu_email)::int                   AS leads,
       COUNT(*) FILTER (WHERE s.max_scroll < 25 AND s.duration_sec < 10)::int AS rejeicoes,
       COALESCE(ROUND(AVG(s.duration_sec)::numeric, 1), 0)        AS tempo_medio,
       COALESCE(ROUND(AVG(s.max_scroll)::numeric, 1), 0)          AS scroll_medio,
       COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.duration_sec), 0) AS tempo_mediano
     FROM lp_sessions s
     WHERE ${S.clause}`,
    S.params
  );

  // ── Vendas confirmadas ────────────────────────────────────────────────────
  // Vem do webhook da Singlr, nao do navegador. Nao da pra amarrar a venda a
  // uma sessao (o checkout e fora do dominio), entao esse numero e do periodo
  // inteiro — nao muda com o filtro de pagina/aparelho.
  const receita = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'paid')::int      AS vendas,
       COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) AS bruto,
       COUNT(*) FILTER (WHERE status = 'refunded')::int  AS reembolsos,
       COUNT(*) FILTER (WHERE plan = '90apps' AND status = 'paid')::int AS plano_90,
       COUNT(*) FILTER (WHERE plan = '30apps' AND status = 'paid')::int AS plano_30
     FROM lp_payments
     WHERE ${P.clause}`,
    P.params
  );

  // ── Serie por dia ─────────────────────────────────────────────────────────
  const porDia = await db.query(
    `SELECT TO_CHAR(s.first_ts, 'YYYY-MM-DD')             AS dia,
            COUNT(*)::int                                 AS sessoes,
            COUNT(*) FILTER (WHERE s.cta_clicks > 0)::int AS ctas,
            COUNT(*) FILTER (WHERE s.reached_checkout)::int AS checkouts
       FROM lp_sessions s
      WHERE ${S.clause}
      GROUP BY 1 ORDER BY 1`,
    S.params
  );

  // ── Site x Quiz ───────────────────────────────────────────────────────────
  // O corte que responde "vale a pena mandar trafego pro quiz?".
  const porPagina = await db.query(
    `SELECT s.page,
            COUNT(*)::int                                   AS sessoes,
            COUNT(*) FILTER (WHERE s.cta_clicks > 0)::int    AS ctas,
            COUNT(*) FILTER (WHERE s.reached_checkout)::int  AS checkouts,
            COUNT(*) FILTER (WHERE s.deu_email)::int         AS leads,
            COALESCE(ROUND(AVG(s.duration_sec)::numeric,1),0) AS tempo_medio
       FROM lp_sessions s
      WHERE ${S.clause}
      GROUP BY 1 ORDER BY sessoes DESC`,
    S.params
  );

  const porDispositivo = await db.query(
    `SELECT COALESCE(s.device, 'desconhecido')              AS device,
            COUNT(*)::int                                   AS sessoes,
            COUNT(*) FILTER (WHERE s.reached_checkout)::int AS checkouts,
            COALESCE(ROUND(AVG(s.max_scroll)::numeric, 1),0)  AS scroll_medio,
            COALESCE(ROUND(AVG(s.duration_sec)::numeric, 1),0) AS tempo_medio
       FROM lp_sessions s
      WHERE ${S.clause}
      GROUP BY 1 ORDER BY sessoes DESC`,
    S.params
  );

  const porOrigem = await db.query(
    `SELECT COALESCE(NULLIF(s.utm_source,''), 'direto')     AS origem,
            COALESCE(NULLIF(s.utm_campaign,''), '—')        AS campanha,
            COUNT(*)::int                                   AS sessoes,
            COUNT(*) FILTER (WHERE s.cta_clicks > 0)::int    AS ctas,
            COUNT(*) FILTER (WHERE s.reached_checkout)::int  AS checkouts
       FROM lp_sessions s
      WHERE ${S.clause}
      GROUP BY 1,2 ORDER BY sessoes DESC LIMIT 25`,
    S.params
  );

  // Lista de origens pro seletor de filtro (30 dias, independe do periodo).
  const origensDisponiveis = await db.query(
    `SELECT DISTINCT COALESCE(NULLIF(utm_source,''), 'direto') AS origem
       FROM lp_sessions WHERE first_ts > NOW() - INTERVAL '60 days'
      ORDER BY 1 LIMIT 40`
  );

  const r = resumo.rows[0] || {};
  const rec = receita.rows[0] || {};

  return {
    resumo: {
      sessoes:       Number(r.sessoes || 0),
      com_cta:       Number(r.com_cta || 0),
      checkouts:     Number(r.checkouts || 0),
      viram_oferta:  Number(r.viram_oferta || 0),
      leads:         Number(r.leads || 0),
      rejeicoes:     Number(r.rejeicoes || 0),
      tempo_medio:   Number(r.tempo_medio || 0),
      tempo_mediano: Number(r.tempo_mediano || 0),
      scroll_medio:  Number(r.scroll_medio || 0),
    },
    receita: {
      vendas:     Number(rec.vendas || 0),
      bruto:      Number(rec.bruto || 0),
      reembolsos: Number(rec.reembolsos || 0),
      plano_90:   Number(rec.plano_90 || 0),
      plano_30:   Number(rec.plano_30 || 0),
    },
    porDia:         porDia.rows,
    porPagina:      porPagina.rows,
    porDispositivo: porDispositivo.rows,
    porOrigem:      porOrigem.rows,
    origens:        origensDisponiveis.rows.map(x => x.origem),
  };
};
