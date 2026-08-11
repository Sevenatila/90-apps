// api/track.js
// Ingestao publica: chega do navegador do visitante, via navigator.sendBeacon.
//
// Tres coisas num POST so (o cliente manda em lote pra nao pipocar requisicao):
//   events[]  → funil e log
//   clicks[]  → mapa de calor
//   session{} → tempo, rolagem, origem, dispositivo, respostas do quiz (UPSERT)
//
// Regras de ouro desta rota:
//   1. NUNCA quebra o fluxo do visitante — todo erro e engolido, resposta 200.
//   2. Whitelist rigida de nomes de evento — senao vira deposito de lixo.
//   3. Tetos por lote — um cliente malicioso nao enche o banco numa tacada.

const db = require('./_db');
const { checkRateLimit, getClientIp } = require('./_ratelimit');

// ── Funis ───────────────────────────────────────────────────────────────────
// step_index e a ORDEM no funil, e ela e DIFERENTE em cada pagina: o site de
// venda e uma pagina longa (rolagem), o quiz e uma sequencia de telas.
// O painel monta o funil cumulativo com esse indice.
const STEPS = {
  site: {
    visit: 0,
    scroll_25: 1,
    scroll_50: 2,
    scroll_75: 3,
    scroll_90: 4,
    cta_click: 5,        // clicou em qualquer botao que leva pra oferta
    checkout_click: 6,   // saiu pro checkout da Singlr
  },
  quiz: {
    visit: 0,
    quiz_start: 1,       // clicou em "descobrir por onde eu começo"
    quiz_q1: 2,          // respondeu a pergunta 1
    quiz_q2: 3,
    quiz_q3: 4,          // respondeu a 3a e caiu na tela de e-mail
    quiz_diagnostico: 5, // viu o diagnostico
    quiz_oferta: 6,      // chegou na ULTIMA tela — a oferta
    checkout_click: 7,
  },
};

// Eventos de engajamento: entram no log e nos graficos, mas nao sao degraus
// do funil (step 0) — misturar os dois e o que faz funil mentir.
const ENGAJAMENTO = new Set([
  'section_view',      // secao/tela entrou em cena
  'faq_open',          // abriu uma pergunta do FAQ
  'lang_switch',       // trocou o idioma na vitrine de apps
  'cta_click',         // no site e degrau (step 5); no quiz e so engajamento
  'quiz_answer',       // resposta escolhida (label = valor)
  'quiz_lead',         // deixou o e-mail
  'quiz_pular_email',  // pulou a tela de e-mail
  'quiz_voltar',       // usou o botao voltar
  'rage_click',        // 3+ cliques no mesmo ponto em 1s = frustracao
  'exit',              // saiu da pagina
]);

const MAX_EVENTS = 40;
const MAX_CLICKS = 60;

const str = (v, n) => (v == null ? null : String(v).slice(0, n));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const clamp01 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
};

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  body = body || {};

  const sessionId = str(body.sessionId, 40) || '';
  if (!/^[a-zA-Z0-9_-]{8,40}$/.test(sessionId)) {
    return res.status(200).json({ ok: true, ignored: true });
  }
  const page = body.page === 'quiz' ? 'quiz' : 'site';
  const device = ['mobile', 'tablet', 'desktop'].includes(body.device) ? body.device : null;
  const mapa = STEPS[page];

  // 300 lotes/hora por IP. Uma visita normal manda poucos lotes; isso segura
  // abuso sem pegar visitante real. Fail-open (ver _ratelimit).
  try {
    const rl = await checkRateLimit({ key: 'track:' + getClientIp(req), limit: 300, windowMinutes: 60 });
    if (!rl.allow) return res.status(200).json({ ok: true, skipped: true });
  } catch (_) {}

  try {
    await db.initDb();
  } catch (err) {
    console.error('initDb falhou (silencioso):', err.message);
    return res.status(200).json({ ok: true });
  }

  // ── 1. SESSAO (upsert) ────────────────────────────────────────────────────
  // Os campos "de pico" (max_scroll, duration, cta_clicks) usam GREATEST no
  // update: lotes podem chegar fora de ordem e a sessao nunca pode regredir.
  const s = body.session;
  if (s && typeof s === 'object') {
    try {
      await db.query(
        `INSERT INTO lp_sessions (
           session_id, page, device, vw, referrer, landing_path,
           utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, country,
           max_scroll, last_section, duration_sec, cta_clicks, reached_checkout,
           viu_oferta, deu_email, quiz_nicho, quiz_tempo, quiz_experiencia
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         ON CONFLICT (session_id) DO UPDATE SET
           last_ts          = NOW(),
           max_scroll       = GREATEST(lp_sessions.max_scroll, EXCLUDED.max_scroll),
           duration_sec     = GREATEST(lp_sessions.duration_sec, EXCLUDED.duration_sec),
           cta_clicks       = GREATEST(lp_sessions.cta_clicks, EXCLUDED.cta_clicks),
           reached_checkout = lp_sessions.reached_checkout OR EXCLUDED.reached_checkout,
           viu_oferta       = lp_sessions.viu_oferta OR EXCLUDED.viu_oferta,
           deu_email        = lp_sessions.deu_email  OR EXCLUDED.deu_email,
           last_section     = COALESCE(EXCLUDED.last_section, lp_sessions.last_section),
           quiz_nicho       = COALESCE(EXCLUDED.quiz_nicho, lp_sessions.quiz_nicho),
           quiz_tempo       = COALESCE(EXCLUDED.quiz_tempo, lp_sessions.quiz_tempo),
           quiz_experiencia = COALESCE(EXCLUDED.quiz_experiencia, lp_sessions.quiz_experiencia)`,
        [
          sessionId,
          page,
          device,
          num(s.vw),
          str(s.referrer, 500),
          str(s.path, 200),
          str(s.utm_source, 120),
          str(s.utm_medium, 120),
          str(s.utm_campaign, 160),
          str(s.utm_content, 160),
          str(s.utm_term, 160),
          str(s.fbclid, 255),
          str(req.headers['x-vercel-ip-country'], 2),
          Math.min(100, Math.max(0, num(s.maxScroll) || 0)),
          str(s.lastSection, 40),
          Math.min(86400, Math.max(0, num(s.duration) || 0)),
          Math.min(999, Math.max(0, num(s.ctaClicks) || 0)),
          !!s.reachedCheckout,
          !!s.viuOferta,
          !!s.deuEmail,
          str(s.quizNicho, 30),
          str(s.quizTempo, 30),
          str(s.quizExperiencia, 30),
        ]
      );
    } catch (err) {
      console.error('upsert sessao (silencioso):', err.message);
    }
  }

  // ── 2. EVENTOS (insert em lote) ───────────────────────────────────────────
  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
  const evRows = [];
  for (const ev of events) {
    const name = str(ev && ev.name, 60);
    if (!name) continue;
    const ehStep = Object.prototype.hasOwnProperty.call(mapa, name);
    if (!ehStep && !ENGAJAMENTO.has(name)) continue;
    evRows.push([
      sessionId, page, name, ehStep ? mapa[name] : 0,
      str(ev.section, 40), str(ev.label, 120), device,
    ]);
  }
  if (evRows.length) {
    try {
      const vals = [];
      const ph = evRows.map((r, i) => {
        const b = i * 7;
        vals.push(...r);
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
      }).join(',');
      await db.query(
        `INSERT INTO lp_events (session_id, page, event_name, step_index, section, label, device)
         VALUES ${ph}`,
        vals
      );
    } catch (err) {
      console.error('insert eventos (silencioso):', err.message);
    }
  }

  // ── 3. CLIQUES / MAPA DE CALOR ────────────────────────────────────────────
  const clicks = Array.isArray(body.clicks) ? body.clicks.slice(0, MAX_CLICKS) : [];
  const clRows = [];
  for (const c of clicks) {
    const x = clamp01(c && c.x), y = clamp01(c && c.y);
    if (x == null || y == null) continue;
    clRows.push([
      sessionId, page, str(c.section, 40), str(c.label, 120),
      x, y, clamp01(c.secPct), !!c.isCta, !!c.dead,
      device, num(c.vw), num(c.vh),
    ]);
  }
  if (clRows.length) {
    try {
      const vals = [];
      const ph = clRows.map((r, i) => {
        const b = i * 12;
        vals.push(...r);
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12})`;
      }).join(',');
      await db.query(
        `INSERT INTO lp_clicks (session_id, page, section, label, x_pct, y_pct, sec_pct, is_cta, dead, device, vw, vh)
         VALUES ${ph}`,
        vals
      );
    } catch (err) {
      console.error('insert cliques (silencioso):', err.message);
    }
  }

  // ── 4. Autolimpeza oportunista (~2% das chamadas) ─────────────────────────
  // O painel so olha 30 dias. Sem isso a conta do banco cresce pra sempre.
  if (Math.random() < 0.02) {
    db.query(`DELETE FROM lp_events WHERE ts < NOW() - INTERVAL '60 days'`).catch(() => {});
    db.query(`DELETE FROM lp_clicks WHERE ts < NOW() - INTERVAL '60 days'`).catch(() => {});
    db.query(`DELETE FROM lp_sessions WHERE first_ts < NOW() - INTERVAL '120 days'`).catch(() => {});
  }

  return res.status(200).json({ ok: true });
};

module.exports.config = { api: { bodyParser: { sizeLimit: '128kb' } } };
