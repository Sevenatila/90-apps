const { neon } = require('@neondatabase/serverless');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false });
    return;
  }

  const email = ((req.body && req.body.email) || '').toLowerCase().trim();
  if (!email || !email.includes('@')) {
    res.status(400).json({ ok: false });
    return;
  }

  const respostas = (req.body && req.body.respostas) || {};
  const sql = neon(process.env.DATABASE_URL);

  await sql`
    create table if not exists leads_quiz (
      id bigserial primary key,
      email text not null,
      respostas jsonb,
      criado_em timestamptz not null default now()
    )
  `;

  await sql`
    insert into leads_quiz (email, respostas)
    values (${email}, ${JSON.stringify(respostas)}::jsonb)
  `;

  res.status(200).json({ ok: true });
};
