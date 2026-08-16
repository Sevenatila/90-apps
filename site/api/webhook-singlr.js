const { neon } = require('@neondatabase/serverless');
const db = require('./_db');

const ATIVO_HINTS = [
  'aprovad', 'approved', 'paid', 'pago', 'pagamento_confirmado',
  'completed', 'complete', 'confirmed', 'confirmad',
  'success', 'sucesso', 'authorized', 'autorizad', 'liberad',
  'sale', 'venda', 'purchase'
];
const REEMBOLSO_HINTS = ['reembols', 'refund', 'chargeback', 'estorn', 'cancel', 'disput'];

// Chaves que quase sempre guardam o email de OUTRA pessoa (vendedor, suporte,
// afiliado). Se o caminho ate o valor passa por uma delas, o email nao serve.
const DONO_ERRADO = /seller|vendor|producer|produtor|vendedor|support|suporte|afiliad|affiliate|company|empresa|noreply|no_reply|owner|admin/i;
// Chaves que apontam pro comprador — quando aparecem, o email vale mais.
const DONO_CERTO = /customer|buyer|client|cliente|comprador|payer|pagador|contact|contato|lead/i;

// Percorre o payload inteiro juntando (caminho, valor) das chaves que casam.
// Diferente de "pega a primeira que aparecer": aqui da pra escolher a melhor.
function coletar(obj, pattern, caminho, saida, profundidade) {
  if (!obj || typeof obj !== 'object' || profundidade > 6) return saida;
  for (const [k, v] of Object.entries(obj)) {
    const aqui = caminho ? caminho + '.' + k : k;
    if (typeof v === 'string' && pattern.test(k)) saida.push({ caminho: aqui, valor: v });
    else if (v && typeof v === 'object') coletar(v, pattern, aqui, saida, profundidade + 1);
  }
  return saida;
}

// Antes pegava a PRIMEIRA chave com "email" no nome — e em payload de gateway
// isso costuma ser o email do vendedor, nao o do comprador. Agora pontua.
function findEmail(payload) {
  const candidatos = coletar(payload, /e-?mail/i, '', [], 0)
    .filter(c => c.valor.includes('@'))
    .map(c => {
      let nota = 0;
      if (DONO_CERTO.test(c.caminho)) nota += 2;
      if (DONO_ERRADO.test(c.caminho)) nota -= 3;
      if (/^e-?mail$/i.test(c.caminho)) nota += 1; // "email" cru na raiz
      return { email: c.valor.toLowerCase().trim(), nota };
    })
    .sort((a, b) => b.nota - a.nota);

  const melhor = candidatos[0];
  if (!melhor || melhor.nota < 0) return null;
  return melhor.email;
}

// Antes olhava so a PRIMEIRA chave de status/event. Um payload com
// {"event":"order.created", ..., "status":"paid"} caia fora e o cliente
// pagava sem receber. Agora todo status/evento do payload e considerado.
function findStatusTextos(payload) {
  return coletar(payload, /status|event|situacao|situa[cç][aã]o|acao|action/i, '', [], 0)
    .map(c => c.valor.toLowerCase());
}

// ── Extras so pro painel ────────────────────────────────────────────────────
// Nada aqui pode interferir na liberacao de acesso: se falhar, falha calado.

function findNumberByKeyPattern(obj, pattern, depth) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (!pattern.test(k)) continue;
    const num = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() && !isNaN(Number(v)) ? Number(v) : null);
    if (num != null && num > 0) return num;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const achou = findNumberByKeyPattern(v, pattern, depth + 1);
      if (achou != null) return achou;
    }
  }
  return null;
}

function findByKeyPattern(obj, pattern, depth) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && pattern.test(k)) return v;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = findByKeyPattern(v, pattern, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function findId(payload) {
  const id = findByKeyPattern(payload, /^(id|transaction_?id|order_?id|codigo|code|hash)$/i, 0);
  return id ? String(id).slice(0, 255) : null;
}

// Os dois produtos custam R$ 97 e R$ 67. Gateway costuma mandar em centavos —
// por isso a divisao quando o numero e grande demais pra ser reais.
function findValor(payload) {
  let v = findNumberByKeyPattern(payload, /amount|valor|price|preco|total/i, 0);
  if (v == null) return null;
  if (v >= 1000) v = v / 100;
  return Math.round(v * 100) / 100;
}

function planoPorValor(v) {
  if (v == null) return null;
  if (v >= 85 && v <= 130) return '90apps';
  if (v >= 55 && v <= 84)  return '30apps';
  return null;
}

// A Vercel entrega req.body ja parseado quando o content-type e JSON ou form.
// Quando o gateway manda text/plain (acontece), vem string crua — e antes disso
// virava "payload sem email", ou seja: venda perdida sem ninguem saber.
function lerPayload(req) {
  const body = req.body;
  if (!body) return {};
  if (typeof body === 'object') return body;
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch (e) { /* segue pro form */ }
    try {
      const params = new URLSearchParams(body);
      const obj = {};
      for (const [k, v] of params) obj[k] = v;
      return obj;
    } catch (e) { return {}; }
  }
  return {};
}

// A liberacao de acesso nao pode depender do schema estar pronto: se a tabela
// sumir, o insert estoura 500 e a venda se perde no meio do caminho.
async function garantirTabelas(sql) {
  await sql`
    create table if not exists compradores (
      email        varchar(255) primary key,
      status       varchar(20)  not null default 'ativo',
      criado_em    timestamptz  not null default now(),
      atualizado_em timestamptz not null default now()
    )`;
  await sql`
    create table if not exists webhook_log (
      id      bigserial   primary key,
      payload jsonb,
      ts      timestamptz not null default now()
    )`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false });
    return;
  }
  if (req.query.secret !== process.env.WEBHOOK_SECRET) {
    res.status(401).json({ ok: false });
    return;
  }

  const sql = neon(process.env.DATABASE_URL);
  const payload = lerPayload(req);

  let email = null;
  let decisao = 'ignorado';

  try {
    await garantirTabelas(sql);

    email = findEmail(payload);
    const textos = findStatusTextos(payload);
    const casa = (hints) => textos.some(t => hints.some(h => t.includes(h)));

    const ehReembolso = casa(REEMBOLSO_HINTS);
    const ehAtivo = !ehReembolso && casa(ATIVO_HINTS);

    if (email && ehReembolso) {
      await sql`
        insert into compradores (email, status)
        values (${email}, 'reembolsado')
        on conflict (email) do update set status = 'reembolsado', atualizado_em = now()
      `;
      decisao = 'reembolsado';
    } else if (email && ehAtivo) {
      await sql`
        insert into compradores (email, status)
        values (${email}, 'ativo')
        on conflict (email) do update set status = 'ativo', atualizado_em = now()
      `;
      decisao = 'ativo';
    } else if (!email) {
      decisao = 'sem-email';
    } else {
      decisao = 'status-nao-reconhecido:' + textos.join('|').slice(0, 120);
    }

    // ── Espelho da venda pro /painel ───────────────────────────────────────
    // Em try/catch proprio: o painel nunca pode atrapalhar a liberacao.
    if (ehAtivo || ehReembolso) {
      try {
        await db.initDb();
        const valor = findValor(payload);
        const externalId = findId(payload) || (email ? email + ':' + decisao : 'sem-id:' + Date.now());
        await db.query(
          `INSERT INTO lp_payments (provider, external_id, email, plan, amount, currency, status)
           VALUES ('singlr', $1, $2, $3, $4, 'BRL', $5)
           ON CONFLICT (provider, external_id) DO UPDATE
             SET status = EXCLUDED.status,
                 amount = COALESCE(EXCLUDED.amount, lp_payments.amount)`,
          [externalId, email, planoPorValor(valor), valor, ehReembolso ? 'refunded' : 'paid']
        );
      } catch (err) {
        console.error('lp_payments (silencioso):', err.message);
      }
    }
  } catch (err) {
    // 500 de proposito: a Singlr reenvia o webhook, e a venda nao se perde.
    console.error('webhook-singlr FALHOU', JSON.stringify({ email, erro: err.message }));
    await registrarLog(sql, payload, 'erro:' + err.message);
    res.status(500).json({ ok: false });
    return;
  }

  // O log vem por ultimo e nunca derruba a resposta: antes ele era a primeira
  // coisa a rodar, entao qualquer problema nele engolia a liberacao de acesso.
  await registrarLog(sql, payload, decisao);

  console.log('webhook-singlr', JSON.stringify({ email, decisao }));
  res.status(200).json({ ok: true, decisao });
};

async function registrarLog(sql, payload, decisao) {
  try {
    await sql`insert into webhook_log (payload) values (${JSON.stringify({ decisao, payload })}::jsonb)`;
  } catch (err) {
    console.error('webhook_log (silencioso):', err.message);
  }
}

// So pro teste de _testes/testar_webhook.js — nao e rota nem e usado em prod.
module.exports._internos = { findEmail, findStatusTextos, lerPayload, ATIVO_HINTS, REEMBOLSO_HINTS };
