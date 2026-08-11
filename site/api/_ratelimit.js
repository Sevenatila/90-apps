// api/_ratelimit.js
// Rate limit por janela deslizante, guardado no proprio Postgres — serverless
// nao tem memoria entre invocacoes, entao contador em RAM nao serve.
//
// Politica: FAIL-OPEN. Se o banco cair, a checagem libera em vez de bloquear:
// um limitador quebrado nunca pode derrubar a captacao de evento nem o login.

const db = require('./_db');

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim().slice(0, 45);
  return (req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown')
    .toString().slice(0, 45);
}

async function checkRateLimit({ key, limit, windowMinutes }) {
  try {
    await db.initDb();
    const minutos = Math.max(1, Math.round(windowMinutes || 60));
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM lp_rate_limit
        WHERE key = $1 AND ts > NOW() - ($2 || ' minutes')::interval`,
      [key, String(minutos)]
    );
    const count = rows[0] ? rows[0].n : 0;
    if (count >= limit) return { allow: false, count };

    await db.query(`INSERT INTO lp_rate_limit (key) VALUES ($1)`, [key]);

    // Faxina oportunista (~5%): sem isso a tabela cresce pra sempre.
    if (Math.random() < 0.05) {
      db.query(`DELETE FROM lp_rate_limit WHERE ts < NOW() - INTERVAL '24 hours'`).catch(() => {});
    }
    return { allow: true, count: count + 1 };
  } catch (err) {
    console.error('rate limit indisponivel (liberando):', err.message);
    return { allow: true, count: 0 };
  }
}

module.exports = { checkRateLimit, getClientIp };
