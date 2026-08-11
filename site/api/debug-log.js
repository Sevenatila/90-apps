const { neon } = require('@neondatabase/serverless');

module.exports = async (req, res) => {
  if (req.query.secret !== process.env.WEBHOOK_SECRET) {
    res.status(401).json({ ok: false });
    return;
  }
  const sql = neon(process.env.DATABASE_URL);
  const logs = await sql`
    select id, recebido_em, payload from webhook_log order by id desc limit 10
  `;
  const compradores = await sql`
    select email, status, criado_em, atualizado_em from compradores order by atualizado_em desc limit 20
  `;
  res.status(200).json({ ok: true, logs, compradores });
};
