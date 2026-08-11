// api/_db.js
// Pool Postgres compartilhado + criacao das tabelas do painel sob demanda.
//
// Conexao: process.env.DATABASE_URL — a MESMA do Neon que ja alimenta
// compradores/leads_quiz. Nada de banco novo, nada de env var nova pra dados.
//
// No Neon prefira a string do POOLER (o host com "-pooler"): serverless abre e
// fecha conexao o tempo todo e a direta estoura o limite de conexoes.

const { Pool } = require('pg');

let connectionString = process.env.DATABASE_URL;

if (connectionString) {
  try {
    // Tira o sslmode da URL pra opcao ssl do Pool valer (senao ela e ignorada)
    const parsed = new URL(connectionString);
    parsed.searchParams.delete('sslmode');
    parsed.searchParams.delete('channel_binding');
    connectionString = parsed.toString();
  } catch (err) {
    console.error('DATABASE_URL malformada:', err.message);
  }
} else {
  console.warn('DATABASE_URL nao definida — as rotas do painel respondem vazio.');
}

const pool = new Pool({
  connectionString,
  ssl: connectionString ? { rejectUnauthorized: false } : false,
  // Cada invocacao serverless tem seu proprio Pool e roda queries em serie:
  // 1 conexao basta. idle curto + allowExitOnIdle devolvem a conexao rapido,
  // que e o que impede o "too many connections" numa rajada de trafego.
  max: 1,
  idleTimeoutMillis: 8000,
  connectionTimeoutMillis: 20000,
  allowExitOnIdle: true,
});

let initialized = false;

// Tabelas do painel. Todas prefixadas lp_ pra nao encostar em compradores,
// leads_quiz e webhook_log — que continuam sendo do fluxo de venda/acesso.
async function initDb() {
  if (initialized) return;
  const c = await pool.connect();
  try {
    // ── EVENTOS ────────────────────────────────────────────────────────────
    // 1 linha por evento. Base do funil, do grafico de secoes e do log cru.
    // page separa o site de venda (/) do quiz (/quiz) — os dois funis vivem
    // na mesma tabela e o painel filtra por essa coluna.
    await c.query(`
      CREATE TABLE IF NOT EXISTS lp_events (
        id          BIGSERIAL PRIMARY KEY,
        session_id  VARCHAR(40)  NOT NULL,
        page        VARCHAR(12)  NOT NULL DEFAULT 'site',
        event_name  VARCHAR(60)  NOT NULL,
        step_index  SMALLINT     NOT NULL DEFAULT 0,
        section     VARCHAR(40),
        label       VARCHAR(120),
        device      VARCHAR(10),
        ts          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_lp_events_ts ON lp_events (ts);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_lp_events_session ON lp_events (session_id);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_lp_events_page_ts ON lp_events (page, ts);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_lp_events_name_ts ON lp_events (event_name, ts);`);

    // ── CLIQUES (MAPA DE CALOR) ────────────────────────────────────────────
    // x_pct/y_pct sao PERCENTUAIS (0..1), nao pixels: um clique no meio do
    // botao e 0.5 tanto num iPhone SE quanto num desktop 1440p.
    //   x_pct   → relativo a LARGURA da viewport
    //   y_pct   → relativo a ALTURA TOTAL do documento
    //   sec_pct → posicao dentro da propria secao (0..1)
    await c.query(`
      CREATE TABLE IF NOT EXISTS lp_clicks (
        id          BIGSERIAL PRIMARY KEY,
        session_id  VARCHAR(40) NOT NULL,
        page        VARCHAR(12) NOT NULL DEFAULT 'site',
        section     VARCHAR(40),
        label       VARCHAR(120),
        x_pct       REAL        NOT NULL,
        y_pct       REAL        NOT NULL,
        sec_pct     REAL,
        is_cta      BOOLEAN     NOT NULL DEFAULT FALSE,
        dead        BOOLEAN     NOT NULL DEFAULT FALSE,
        device      VARCHAR(10),
        vw          SMALLINT,
        vh          SMALLINT,
        ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_lp_clicks_ts ON lp_clicks (ts);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_lp_clicks_page ON lp_clicks (page, section, ts);`);

    // ── SESSOES ────────────────────────────────────────────────────────────
    // 1 linha por visita, atualizada por UPSERT ao longo dela. Daqui saem
    // tempo, rolagem, rejeicao, origem do trafego, onde parou — e, no quiz,
    // as respostas escolhidas (nao e dado pessoal, e segmentacao).
    await c.query(`
      CREATE TABLE IF NOT EXISTS lp_sessions (
        session_id    VARCHAR(40) PRIMARY KEY,
        page          VARCHAR(12) NOT NULL DEFAULT 'site',
        first_ts      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_ts       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        device        VARCHAR(10),
        vw            SMALLINT,
        referrer      TEXT,
        landing_path  VARCHAR(200),
        utm_source    VARCHAR(120),
        utm_medium    VARCHAR(120),
        utm_campaign  VARCHAR(160),
        utm_content   VARCHAR(160),
        utm_term      VARCHAR(160),
        fbclid        VARCHAR(255),
        country       VARCHAR(2),
        max_scroll    SMALLINT    NOT NULL DEFAULT 0,
        last_section  VARCHAR(40),
        duration_sec  INTEGER     NOT NULL DEFAULT 0,
        cta_clicks    SMALLINT    NOT NULL DEFAULT 0,
        reached_checkout BOOLEAN  NOT NULL DEFAULT FALSE,
        viu_oferta    BOOLEAN     NOT NULL DEFAULT FALSE,
        deu_email     BOOLEAN     NOT NULL DEFAULT FALSE,
        quiz_nicho       VARCHAR(30),
        quiz_tempo       VARCHAR(30),
        quiz_experiencia VARCHAR(30)
      );`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_lp_sessions_first ON lp_sessions (first_ts);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_lp_sessions_page ON lp_sessions (page, first_ts);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_lp_sessions_utm ON lp_sessions (utm_source, utm_campaign);`);

    // ── VENDAS ─────────────────────────────────────────────────────────────
    // Alimentada pelo webhook da Singlr. E o unico numero do painel que nao
    // depende do navegador — bloqueador de anuncio nao some com ela.
    await c.query(`
      CREATE TABLE IF NOT EXISTS lp_payments (
        id            BIGSERIAL PRIMARY KEY,
        provider      VARCHAR(20)  NOT NULL DEFAULT 'singlr',
        external_id   VARCHAR(255) NOT NULL,
        email         VARCHAR(255),
        plan          VARCHAR(20),
        amount        NUMERIC(12,2),
        currency      VARCHAR(3)   NOT NULL DEFAULT 'BRL',
        status        VARCHAR(20)  NOT NULL DEFAULT 'paid',
        ts            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );`);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_lp_payments_ext ON lp_payments (provider, external_id);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_lp_payments_ts ON lp_payments (ts);`);

    // ── RATE LIMIT ─────────────────────────────────────────────────────────
    await c.query(`
      CREATE TABLE IF NOT EXISTS lp_rate_limit (
        key VARCHAR(160) NOT NULL,
        ts  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_lp_rate_limit ON lp_rate_limit (key, ts);`);

    initialized = true;
  } finally {
    c.release();
  }
}

async function query(text, params) {
  if (!connectionString) throw new Error('DATABASE_URL nao configurada');
  return pool.query(text, params);
}

module.exports = { pool, query, initDb, hasDb: !!connectionString };
