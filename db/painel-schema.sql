-- ============================================================================
-- 90 apps — schema do painel de monitoramento (/painel)
-- ============================================================================
-- Fica FORA de site/ de proposito: tudo dentro de site/ e servido na web.
--
-- Nao precisa rodar isto na mao: site/api/_db.js cria tudo sozinho no primeiro
-- acesso (initDb). Este arquivo existe pra voce poder conferir/ajustar direto
-- no SQL Editor do Neon.
--
-- Banco: o MESMO Neon de compradores/leads_quiz (env DATABASE_URL na Vercel).
-- Prefixo lp_ pra nao encostar nas tabelas do fluxo de venda/acesso.
-- ============================================================================

-- ── EVENTOS DO FUNIL ────────────────────────────────────────────────────────
-- page separa o site de vendas (/) do quiz (/quiz): sao dois funis diferentes
-- vivendo na mesma tabela.
CREATE TABLE IF NOT EXISTS lp_events (
  id          BIGSERIAL PRIMARY KEY,
  session_id  VARCHAR(40)  NOT NULL,
  page        VARCHAR(12)  NOT NULL DEFAULT 'site',
  event_name  VARCHAR(60)  NOT NULL,
  step_index  SMALLINT     NOT NULL DEFAULT 0,   -- ordem no funil (0 = engajamento)
  section     VARCHAR(40),                       -- data-sec da pagina / tela do quiz
  label       VARCHAR(120),
  device      VARCHAR(10),                       -- mobile | tablet | desktop
  ts          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lp_events_ts      ON lp_events (ts);
CREATE INDEX IF NOT EXISTS idx_lp_events_session ON lp_events (session_id);
CREATE INDEX IF NOT EXISTS idx_lp_events_page_ts ON lp_events (page, ts);
CREATE INDEX IF NOT EXISTS idx_lp_events_name_ts ON lp_events (event_name, ts);

-- ── CLIQUES (MAPA DE CALOR) ─────────────────────────────────────────────────
-- x_pct/y_pct sao PERCENTUAIS (0..1), nao pixels — e o que faz o mapa valer
-- para telas de tamanhos diferentes.
CREATE TABLE IF NOT EXISTS lp_clicks (
  id          BIGSERIAL PRIMARY KEY,
  session_id  VARCHAR(40) NOT NULL,
  page        VARCHAR(12) NOT NULL DEFAULT 'site',
  section     VARCHAR(40),
  label       VARCHAR(120),
  x_pct       REAL        NOT NULL,   -- relativo a largura da viewport
  y_pct       REAL        NOT NULL,   -- relativo a altura total do documento
  sec_pct     REAL,                   -- posicao dentro da propria secao
  is_cta      BOOLEAN     NOT NULL DEFAULT FALSE,
  dead        BOOLEAN     NOT NULL DEFAULT FALSE,  -- clique em area sem acao
  device      VARCHAR(10),
  vw          SMALLINT,
  vh          SMALLINT,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lp_clicks_ts   ON lp_clicks (ts);
CREATE INDEX IF NOT EXISTS idx_lp_clicks_page ON lp_clicks (page, section, ts);

-- ── SESSOES ─────────────────────────────────────────────────────────────────
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
  max_scroll    SMALLINT    NOT NULL DEFAULT 0,   -- no quiz: rolagem DA OFERTA
  last_section  VARCHAR(40),                      -- ultima secao vista = abandono
  duration_sec  INTEGER     NOT NULL DEFAULT 0,   -- tempo ATIVO (aba visivel)
  cta_clicks    SMALLINT    NOT NULL DEFAULT 0,
  reached_checkout BOOLEAN  NOT NULL DEFAULT FALSE,
  viu_oferta    BOOLEAN     NOT NULL DEFAULT FALSE, -- chegou na ultima tela do quiz
  deu_email     BOOLEAN     NOT NULL DEFAULT FALSE,
  quiz_nicho       VARCHAR(30),
  quiz_tempo       VARCHAR(30),
  quiz_experiencia VARCHAR(30)
);
CREATE INDEX IF NOT EXISTS idx_lp_sessions_first ON lp_sessions (first_ts);
CREATE INDEX IF NOT EXISTS idx_lp_sessions_page  ON lp_sessions (page, first_ts);
CREATE INDEX IF NOT EXISTS idx_lp_sessions_utm   ON lp_sessions (utm_source, utm_campaign);

-- ── VENDAS ──────────────────────────────────────────────────────────────────
-- Espelho do webhook da Singlr. Nao tem session_id: o checkout e em outro
-- dominio, entao nao da pra amarrar a venda a jornada.
CREATE TABLE IF NOT EXISTS lp_payments (
  id            BIGSERIAL PRIMARY KEY,
  provider      VARCHAR(20)  NOT NULL DEFAULT 'singlr',
  external_id   VARCHAR(255) NOT NULL,
  email         VARCHAR(255),
  plan          VARCHAR(20),                      -- 90apps | 30apps
  amount        NUMERIC(12,2),
  currency      VARCHAR(3)   NOT NULL DEFAULT 'BRL',
  status        VARCHAR(20)  NOT NULL DEFAULT 'paid',  -- paid | refunded
  ts            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lp_payments_ext ON lp_payments (provider, external_id);
CREATE INDEX IF NOT EXISTS idx_lp_payments_ts ON lp_payments (ts);

-- ── RATE LIMIT ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_rate_limit (
  key    VARCHAR(160) NOT NULL,
  ts     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lp_rate_limit ON lp_rate_limit (key, ts);
