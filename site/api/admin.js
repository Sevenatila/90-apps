// api/admin.js
// Porta unica das telas do painel: /api/admin?view=stats|funnel|heatmap|...
//
// Por que uma rota so em vez de uma por tela: a Vercel conta cada arquivo de
// api/ como uma Serverless Function e o plano tem teto. As telas vivem em
// api/_views/ — pasta com underscore nao vira rota, e o codigo continua
// separado por assunto.

const { requireAdmin } = require('./_auth');

const VIEWS = {
  stats:    require('./_views/stats'),
  funnel:   require('./_views/funnel'),
  heatmap:  require('./_views/heatmap'),
  sessions: require('./_views/sessions'),
  events:   require('./_views/events'),
  quiz:     require('./_views/quiz'),
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireAdmin(req, res)) return;

  const q = req.query || {};
  const view = VIEWS[String(q.view || '')];
  if (!view) {
    return res.status(400).json({ error: 'view invalida', aceitas: Object.keys(VIEWS) });
  }

  try {
    const dados = await view(q, req);
    return res.status(200).json(dados);
  } catch (err) {
    console.error('admin/' + q.view + ':', err.message);
    return res.status(500).json({ error: 'Falha ao montar a tela', detail: err.message });
  }
};
