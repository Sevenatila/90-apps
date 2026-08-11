// api/_views/heatmap.js
// Tela "Mapa de Calor": onde o dedo do visitante encosta.
//
// O painel NAO recebe milhares de pontos crus — isso travaria o navegador e
// gastaria banda a toa. O agrupamento acontece aqui no Postgres: a pagina e
// dividida numa grade e o que viaja e a contagem por celula. 100k cliques
// viram ~2k celulas.
//
// Filtros que importam aqui:
//   ?page=quiz&section=oferta → o mapa da ULTIMA tela do quiz
//   ?page=site                → o mapa da pagina de vendas inteira
//   ?device=                  → o mapa muda MUITO entre mobile e desktop

const db = require('../_db');
const { baseFilter } = require('../_auth');

module.exports = async function heatmap(q) {
  await db.initDb();

  const cols = Math.min(120, Math.max(20, parseInt(q.cols, 10) || 60));
  const rows = Math.min(400, Math.max(50, parseInt(q.rows, 10) || 220));

  const C = baseFilter(q, 'ts', { utmVia: 'session' });
  const params = [...C.params];
  let where = C.clause;
  if (q.section) {
    params.push(String(q.section).slice(0, 40));
    where += ` AND section = $${params.length}`;
  }

  // ── Grade de calor ──────────────────────────────────────────────────────
  // FLOOR(x * cols) joga cada clique na sua celula; o painel pinta a celula
  // com intensidade proporcional a n / maior_n.
  const gradeParams = [...params, cols, rows];
  const iCols = gradeParams.length - 1, iRows = gradeParams.length;
  const grade = await db.query(
    `SELECT LEAST($${iCols}::int - 1, FLOOR(x_pct * $${iCols}::int))::int AS gx,
            LEAST($${iRows}::int - 1, FLOOR(y_pct * $${iRows}::int))::int AS gy,
            COUNT(*)::int                       AS n,
            COUNT(*) FILTER (WHERE is_cta)::int  AS n_cta,
            COUNT(*) FILTER (WHERE dead)::int    AS n_mortos
       FROM lp_clicks
      WHERE ${where}
      GROUP BY 1,2
      ORDER BY n DESC
      LIMIT 4000`,
    gradeParams
  );

  // ── Ranking de elementos clicados ───────────────────────────────────────
  const elementos = await db.query(
    `SELECT COALESCE(label, '(sem rótulo)') AS label,
            COALESCE(section, '—')          AS section,
            COUNT(*)::int                   AS cliques,
            COUNT(DISTINCT session_id)::int AS sessoes,
            BOOL_OR(is_cta)                 AS is_cta
       FROM lp_clicks
      WHERE ${where}
      GROUP BY 1,2 ORDER BY cliques DESC LIMIT 40`,
    params
  );

  // ── Cliques mortos ──────────────────────────────────────────────────────
  // Gente clicando em coisa que nao e clicavel. Cada linha aqui e uma imagem
  // ou texto que PARECE botao — dinheiro parado na mesa.
  const mortos = await db.query(
    `SELECT COALESCE(section, '—')             AS section,
            COALESCE(label, '(área sem ação)') AS label,
            COUNT(*)::int                      AS cliques,
            COUNT(DISTINCT session_id)::int    AS sessoes
       FROM lp_clicks
      WHERE ${where} AND dead
      GROUP BY 1,2 ORDER BY cliques DESC LIMIT 20`,
    params
  );

  // ── Cliques por secao ───────────────────────────────────────────────────
  const porSecaoParams = [...C.params];
  const porSecao = await db.query(
    `SELECT COALESCE(section, '—') AS section,
            COUNT(*)::int                       AS cliques,
            COUNT(*) FILTER (WHERE is_cta)::int  AS cta,
            COUNT(*) FILTER (WHERE dead)::int    AS mortos,
            COUNT(DISTINCT session_id)::int      AS sessoes
       FROM lp_clicks
      WHERE ${C.clause}
      GROUP BY 1 ORDER BY cliques DESC`,
    porSecaoParams
  );

  // ── Curva de rolagem ────────────────────────────────────────────────────
  // Quantos % das sessoes chegaram a cada decil da pagina.
  // No quiz o cliente so mede rolagem DENTRO da tela de oferta, entao aqui a
  // base sao as sessoes que chegaram nela — senao a curva viraria ficcao.
  const S = baseFilter(q, 'first_ts');
  const sWhere = q.page === 'quiz' ? `${S.clause} AND viu_oferta` : S.clause;
  const rolagem = await db.query(
    `WITH base AS (SELECT max_scroll FROM lp_sessions WHERE ${sWhere})
     SELECT g.d AS ate,
            COUNT(b.max_scroll)::int AS sessoes,
            CASE WHEN (SELECT COUNT(*) FROM base) > 0
                 THEN ROUND(COUNT(b.max_scroll) * 100.0 / (SELECT COUNT(*) FROM base), 1)
                 ELSE 0 END AS pct
       FROM generate_series(10, 100, 10) AS g(d)
       LEFT JOIN base b ON b.max_scroll >= g.d
      GROUP BY g.d ORDER BY g.d`,
    S.params
  );

  const total = grade.rows.reduce((a, r) => a + Number(r.n), 0);
  const pico  = grade.rows.reduce((m, r) => Math.max(m, Number(r.n)), 0);

  return {
    grade:     { cols, rows, pico, total, celulas: grade.rows },
    elementos: elementos.rows,
    mortos:    mortos.rows,
    porSecao:  porSecao.rows,
    rolagem:   rolagem.rows,
    filtro:    { page: q.page || 'todas', device: q.device || 'todos', section: q.section || null },
  };
};
