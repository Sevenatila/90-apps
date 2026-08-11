const { neon } = require('@neondatabase/serverless');
const db = require('./_db');

const ATIVO_HINTS = ['aprovad', 'approved', 'paid', 'pago', 'completed', 'confirmed', 'confirmad'];
const REEMBOLSO_HINTS = ['reembols', 'refund', 'chargeback', 'estorn', 'cancel', 'disput'];

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

function findEmail(payload) {
  const direct = findByKeyPattern(payload, /email/i, 0);
  if (direct && direct.includes('@')) return direct.toLowerCase().trim();
  return null;
}

function findStatus(payload) {
  return findByKeyPattern(payload, /status|event|situacao|situa[cç][aã]o/i, 0);
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
  const payload = req.body || {};

  await sql`insert into webhook_log (payload) values (${JSON.stringify(payload)}::jsonb)`;

  const email = findEmail(payload);
  const statusTexto = (findStatus(payload) || '').toLowerCase();

  const ehReembolsoGlobal = REEMBOLSO_HINTS.some(h => statusTexto.includes(h));
  const ehAtivoGlobal = ATIVO_HINTS.some(h => statusTexto.includes(h));

  // ── Espelho da venda pro /painel ─────────────────────────────────────────
  // Em try/catch proprio: o painel nunca pode atrapalhar a liberacao de acesso.
  if (ehAtivoGlobal || ehReembolsoGlobal) {
    try {
      await db.initDb();
      const valor = findValor(payload);
      const externalId = findId(payload) || (email ? email + ':' + statusTexto : 'sem-id:' + Date.now());
      await db.query(
        `INSERT INTO lp_payments (provider, external_id, email, plan, amount, currency, status)
         VALUES ('singlr', $1, $2, $3, $4, 'BRL', $5)
         ON CONFLICT (provider, external_id) DO UPDATE
           SET status = EXCLUDED.status,
               amount = COALESCE(EXCLUDED.amount, lp_payments.amount)`,
        [externalId, email, planoPorValor(valor), valor, ehReembolsoGlobal ? 'refunded' : 'paid']
      );
    } catch (err) {
      console.error('lp_payments (silencioso):', err.message);
    }
  }

  if (email) {
    const ehReembolso = ehReembolsoGlobal;
    const ehAtivo = ehAtivoGlobal;
    if (ehReembolso) {
      await sql`
        insert into compradores (email, status)
        values (${email}, 'reembolsado')
        on conflict (email) do update set status = 'reembolsado', atualizado_em = now()
      `;
    } else if (ehAtivo) {
      await sql`
        insert into compradores (email, status)
        values (${email}, 'ativo')
        on conflict (email) do update set status = 'ativo', atualizado_em = now()
      `;
    }
  }

  res.status(200).json({ ok: true });
};
