// api/_views/acessos.js
// Tela de suporte: "o cliente pagou e nao recebeu o acesso".
//
// Mostra o status de quem comprou, deixa liberar/bloquear na mao e — o mais
// util — lista os webhooks que chegaram e NAO liberaram ninguem. E ali que
// aparece a venda perdida antes do cliente reclamar.
//
// Leitura e GET. Liberar/bloquear exige POST (mudar acesso por link seria
// pedido pra alguem liberar sem querer ao recarregar a pagina).

const db = require('../_db');

const LIMITE = 50;

async function garantirTabela() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS compradores (
      email         VARCHAR(255) PRIMARY KEY,
      status        VARCHAR(20)  NOT NULL DEFAULT 'ativo',
      atualizado_em TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )`);
}

async function escrever(email, status) {
  await garantirTabela();
  const r = await db.query(
    `INSERT INTO compradores (email, status)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET status = $2, atualizado_em = NOW()
     RETURNING email, status, atualizado_em`,
    [email, status]
  );
  return r.rows[0];
}

module.exports = async function acessos(q, req) {
  const metodo = (req && req.method) || 'GET';
  const email = String(q.email || '').toLowerCase().trim();

  // ── liberar / bloquear ────────────────────────────────────────────────────
  if (q.acao === 'liberar' || q.acao === 'bloquear') {
    if (metodo !== 'POST') throw new Error('Use POST para mudar acesso');
    if (!email || !email.includes('@')) throw new Error('E-mail invalido');
    const linha = await escrever(email, q.acao === 'liberar' ? 'ativo' : 'reembolsado');
    return { feito: q.acao, comprador: linha };
  }

  // ── consulta ─────────────────────────────────────────────────────────────
  await garantirTabela();
  const busca = String(q.busca || '').toLowerCase().trim();

  const compradores = busca
    ? (await db.query(
        `SELECT email, status, atualizado_em FROM compradores
          WHERE email LIKE $1 ORDER BY atualizado_em DESC LIMIT ${LIMITE}`,
        ['%' + busca + '%']
      )).rows
    : (await db.query(
        `SELECT email, status, atualizado_em FROM compradores
          ORDER BY atualizado_em DESC LIMIT ${LIMITE}`
      )).rows;

  // Webhooks que chegaram e nao viraram acesso. So aparece o que o webhook
  // gravou depois da correcao (payload com a chave "decisao"); o que veio
  // antes disso fica de fora porque nao da pra saber o que aconteceu.
  let perdidos = [];
  try {
    perdidos = (await db.query(
      `SELECT id, ts,
              payload->>'decisao' AS decisao,
              payload->'payload'  AS payload
         FROM webhook_log
        WHERE ts > NOW() - INTERVAL '30 days'
          AND payload ? 'decisao'
          AND payload->>'decisao' NOT IN ('ativo', 'reembolsado')
        ORDER BY ts DESC LIMIT 20`
    )).rows;
  } catch (err) {
    console.error('acessos/perdidos (silencioso):', err.message);
  }

  return { compradores, perdidos, busca };
};
