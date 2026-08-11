// api/_views/quiz.js
// Tela "Respostas do quiz": o que as pessoas escolhem e o que cada escolha
// faz com o resto do funil.
//
// Nicho/tempo/experiencia ficam na propria sessao (nao sao dado pessoal, sao
// segmentacao). Os e-mails ficam em leads_quiz, que ja existia — aqui a gente
// so le, quem grava e /api/captar-lead.

const db = require('../_db');
const { periodFilter, baseFilter } = require('../_auth');

const NICHOS = {
  emagrecimento: 'Emagrecimento e saúde',
  fitness: 'Fitness e corpo',
  mental: 'Mente e bem-estar',
  confeitaria: 'Confeitaria',
  espiritualidade: 'Fé e espiritualidade',
  renda: 'Renda online',
};
const TEMPOS = { '15min': 'Até 15 min/dia', '30min': '~30 min/dia', '1h': '1h ou mais/dia' };
const EXPERIENCIAS = {
  nunca: 'Nunca vendeu online',
  tentei: 'Já gastou validando e não vingou',
  vendo: 'Já vende, cansou de criar do zero',
};

// Distribuicao de uma resposta + o que ela vira la na frente. Sempre restrita
// ao quiz: as colunas quiz_* so existem em sessao vinda de /quiz.
async function distribuicao(coluna, rotulos, S) {
  const { rows } = await db.query(
    `SELECT ${coluna} AS valor,
            COUNT(*)::int                                   AS sessoes,
            COUNT(*) FILTER (WHERE viu_oferta)::int         AS viram_oferta,
            COUNT(*) FILTER (WHERE reached_checkout)::int   AS checkouts,
            COUNT(*) FILTER (WHERE deu_email)::int          AS leads
       FROM lp_sessions
      WHERE ${S.clause} AND page = 'quiz' AND ${coluna} IS NOT NULL
      GROUP BY 1 ORDER BY sessoes DESC`,
    S.params
  );
  return rows.map(r => ({ ...r, label: rotulos[r.valor] || r.valor }));
}

module.exports = async function quiz(q) {
  await db.initDb();

  // page fica de fora do baseFilter aqui — esta tela e sempre do quiz.
  const semPagina = { ...q, page: undefined };
  const S = baseFilter(semPagina, 'first_ts');

  const [nicho, tempo, experiencia] = await Promise.all([
    distribuicao('quiz_nicho', NICHOS, S),
    distribuicao('quiz_tempo', TEMPOS, S),
    distribuicao('quiz_experiencia', EXPERIENCIAS, S),
  ]);

  const resumo = await db.query(
    `SELECT COUNT(*)::int                                 AS sessoes,
            COUNT(*) FILTER (WHERE quiz_nicho IS NOT NULL)::int      AS responderam_1,
            COUNT(*) FILTER (WHERE quiz_experiencia IS NOT NULL)::int AS responderam_tudo,
            COUNT(*) FILTER (WHERE deu_email)::int        AS leads,
            COUNT(*) FILTER (WHERE viu_oferta)::int       AS viram_oferta,
            COUNT(*) FILTER (WHERE reached_checkout)::int AS checkouts
       FROM lp_sessions
      WHERE ${S.clause} AND page = 'quiz'`,
    S.params
  );

  // ── Leads captados ────────────────────────────────────────────────────────
  // leads_quiz e criada sob demanda por /api/captar-lead; se ninguem deixou
  // e-mail ainda, a tabela pode nao existir — isso nao e erro do painel.
  let leads = [], totalLeads = 0;
  try {
    const L = periodFilter(q, 'criado_em', 1);
    const t = await db.query(`SELECT COUNT(*)::int AS n FROM leads_quiz WHERE ${L.clause}`, L.params);
    totalLeads = Number(t.rows[0] ? t.rows[0].n : 0);
    const r = await db.query(
      `SELECT email, respostas, criado_em FROM leads_quiz
        WHERE ${L.clause} ORDER BY criado_em DESC LIMIT 100`,
      L.params
    );
    leads = r.rows;
  } catch (err) {
    console.warn('leads_quiz indisponível:', err.message);
  }

  return {
    resumo: resumo.rows[0] || {},
    nicho, tempo, experiencia,
    leads, totalLeads,
  };
};
