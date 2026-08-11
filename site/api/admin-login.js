// api/admin-login.js
// Login do painel. As credenciais ficam so nas env vars da Vercel — nada de
// senha no HTML, que e o erro classico de painel caseiro.

const { assinar } = require('./_auth');
const { checkRateLimit, getClientIp } = require('./_ratelimit');

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 10 tentativas / 10 min por IP: folga de sobra pra voce, parede pra quem
  // estiver chutando senha.
  const rl = await checkRateLimit({ key: 'login:' + getClientIp(req), limit: 10, windowMinutes: 10 });
  if (!rl.allow) return res.status(429).json({ error: 'Muitas tentativas. Espere alguns minutos.' });

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    const { username, password } = body || {};

    const USER = process.env.ADMIN_USERNAME;
    const PASS = process.env.ADMIN_PASSWORD;
    const SECRET = process.env.PAINEL_SECRET || process.env.JWT_SECRET;

    if (!USER || !PASS || !SECRET) {
      return res.status(500).json({
        error: 'Servidor sem ADMIN_USERNAME / ADMIN_PASSWORD / PAINEL_SECRET',
      });
    }
    if (username !== USER || password !== PASS) {
      await new Promise(r => setTimeout(r, 800)); // atraso artificial contra forca bruta
      return res.status(401).json({ error: 'Credenciais invalidas' });
    }

    return res.status(200).json({ token: assinar({ role: 'admin' }, 8) });
  } catch (err) {
    console.error('Erro no login:', err.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
};
