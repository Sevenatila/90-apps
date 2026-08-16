const { neon } = require('@neondatabase/serverless');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false });
    return;
  }

  const bruto = (req.body && req.body.email) || '';
  const email = String(bruto).toLowerCase().trim();
  if (!email || !email.includes('@')) {
    res.status(400).json({ ok: false, motivo: 'email-invalido' });
    return;
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`select status from compradores where lower(email) = ${email} limit 1`;

    if (rows.length === 0) {
      res.status(200).json({ ok: false, motivo: 'nao-encontrado' });
      return;
    }
    if (rows[0].status !== 'ativo') {
      res.status(200).json({ ok: false, motivo: rows[0].status });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    // Sem isto a falha de banco virava 500 e a tela dizia "e-mail nao
    // encontrado" pra quem tinha pago. Agora ela diz "tente de novo".
    console.error('checar-acesso:', err.message);
    res.status(503).json({ ok: false, motivo: 'indisponivel' });
  }
};
