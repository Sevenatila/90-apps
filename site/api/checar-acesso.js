const { neon } = require('@neondatabase/serverless');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false });
    return;
  }

  const email = ((req.body && req.body.email) || '').toLowerCase().trim();
  if (!email) {
    res.status(400).json({ ok: false });
    return;
  }

  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`select status from compradores where email = ${email} limit 1`;

  const ok = rows.length > 0 && rows[0].status === 'ativo';
  res.status(200).json({ ok });
};
