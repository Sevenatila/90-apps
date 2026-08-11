const { neon } = require('@neondatabase/serverless');

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

  if (email) {
    const ehReembolso = REEMBOLSO_HINTS.some(h => statusTexto.includes(h));
    const ehAtivo = ATIVO_HINTS.some(h => statusTexto.includes(h));
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
