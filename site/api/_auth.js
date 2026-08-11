// api/_auth.js
// Guarda das rotas do painel + montagem dos filtros de periodo/pagina.
//
// O token e um JWT-like assinado com HMAC-SHA256 do modulo crypto do proprio
// Node. Nao ha dependencia nova por causa disso: e o mesmo desenho de um JWT
// HS256 (payload em base64url + assinatura), so que em 30 linhas.

const crypto = require('crypto');

const PAGES = ['site', 'quiz'];
const DEVICES = ['mobile', 'tablet', 'desktop'];

const b64u = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function segredo() {
  return process.env.PAINEL_SECRET || process.env.JWT_SECRET || '';
}

function assinar(payloadObj, horas) {
  const secret = segredo();
  const payload = { ...payloadObj, exp: Math.floor(Date.now() / 1000) + (horas || 8) * 3600 };
  const corpo = b64u(JSON.stringify(payload));
  const sig = b64u(crypto.createHmac('sha256', secret).update(corpo).digest());
  return corpo + '.' + sig;
}

function verificar(token) {
  const secret = segredo();
  if (!secret || !token || token.indexOf('.') < 0) return null;
  const [corpo, sig] = token.split('.');
  const esperado = b64u(crypto.createHmac('sha256', secret).update(corpo).digest());
  // timingSafeEqual exige buffers do mesmo tamanho — o length check vem antes.
  if (sig.length !== esperado.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  try {
    const payload = JSON.parse(unb64u(corpo).toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

/**
 * Valida o Bearer. Se falhar, ja responde e devolve null — o handler so
 * precisa de `if (!requireAdmin(req, res)) return;`
 */
function requireAdmin(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (!segredo()) {
    res.status(500).json({ error: 'PAINEL_SECRET nao configurado na Vercel' });
    return null;
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = token ? verificar(token) : null;
  if (!payload || payload.role !== 'admin') {
    res.status(401).json({ error: 'Sessao expirada' });
    return null;
  }
  return payload;
}

/**
 * Converte ?from=&to= (YYYY-MM-DD) numa clausula SQL segura.
 * Sem periodo informado devolve os ultimos 30 dias — o painel nunca varre a
 * tabela inteira por acidente.
 */
function periodFilter(query, column, startIdx) {
  const idx = startIdx || 1;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : null;

  if (from && to) {
    return {
      clause: `${column} >= $${idx}::date AND ${column} < ($${idx + 1}::date + INTERVAL '1 day')`,
      params: [from, to],
      nextIdx: idx + 2,
    };
  }
  if (from) return { clause: `${column} >= $${idx}::date`, params: [from], nextIdx: idx + 1 };
  return { clause: `${column} > NOW() - INTERVAL '30 days'`, params: [], nextIdx: idx };
}

/**
 * Periodo + pagina + dispositivo numa clausula so. E o filtro que o painel
 * inteiro usa: toda tela respeita a mesma barra de filtros do topo.
 *
 * @param {object} q       req.query
 * @param {string} tsCol   coluna de data da tabela (ts / first_ts / s.first_ts)
 * @param {object} [opts]  { prefix: 's.', utmVia: 'session' }
 *   utmVia:'session' → a tabela nao tem utm_source (eventos/cliques), entao o
 *   filtro de origem vira um IN sobre as sessoes daquela origem.
 */
function baseFilter(q, tsCol, opts) {
  const prefix = (opts && opts.prefix) || '';
  const P = periodFilter(q, tsCol, 1);
  const params = [...P.params];
  let clause = P.clause;

  if (PAGES.includes(q.page)) {
    params.push(q.page);
    clause += ` AND ${prefix}page = $${params.length}`;
  }
  if (DEVICES.includes(q.device)) {
    params.push(q.device);
    clause += ` AND ${prefix}device = $${params.length}`;
  }
  if (q.utm) {
    params.push(String(q.utm).slice(0, 120));
    const i = params.length;
    clause += (opts && opts.utmVia === 'session')
      ? ` AND ${prefix}session_id IN (SELECT session_id FROM lp_sessions
            WHERE COALESCE(NULLIF(utm_source,''),'direto') = $${i})`
      : ` AND COALESCE(NULLIF(${prefix}utm_source,''),'direto') = $${i}`;
  }
  return { clause, params };
}

module.exports = { requireAdmin, assinar, verificar, periodFilter, baseFilter, PAGES, DEVICES };
