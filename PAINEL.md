# Painel de monitoramento (`/painel`)

Rastreio próprio do site de vendas (`/`) e do quiz (`/quiz`), com funil, mapa
de calor, sessões e log de eventos. Roda no mesmo Neon que já guarda
`compradores` e `leads_quiz` — nenhum banco novo.

## Variáveis de ambiente na Vercel

| Variável | Para quê | Já existia? |
|---|---|---|
| `DATABASE_URL` | conexão com o Neon (use a string com `-pooler`) | sim |
| `ADMIN_USERNAME` | usuário do login do painel | **não — criar** |
| `ADMIN_PASSWORD` | senha do login do painel | **não — criar** |
| `PAINEL_SECRET` | segredo que assina o token de sessão (string longa e aleatória) | **não — criar** |

Sem as três novas, o login responde `500` explicando o que falta. Depois de
criá-las, é preciso **redeploy** para valerem.

Gerar um segredo:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Estrutura

```
site/
  js/track.js          rastreio no navegador (site + quiz), passivo e silencioso
  painel/index.html    o painel inteiro (login, filtros, telas)
  api/track.js         ingestão pública dos lotes de evento/clique/sessão
  api/admin-login.js   login (HMAC-SHA256 do crypto do Node, sem dependência)
  api/admin.js         porta única das telas → ?view=stats|funnel|heatmap|sessions|events|quiz
  api/_views/*.js      uma tela por arquivo (pasta com _ não vira rota na Vercel)
  api/_db.js           pool Postgres + criação das tabelas sob demanda
db/painel-schema.sql   o mesmo schema, pra conferir no SQL Editor do Neon
```

As tabelas (`lp_events`, `lp_clicks`, `lp_sessions`, `lp_payments`,
`lp_rate_limit`) são criadas sozinhas no primeiro acesso.

## Como o mapa de calor funciona

O painel abre a própria página num `<iframe>` e desenha as manchas por cima.
Os cliques são gravados em percentual da tela (0..1), não em pixels — por isso
o mapa vale igual em celular e desktop.

- **Site**: `/?notrack=1`, página inteira.
- **Quiz**: `/quiz/?notrack=1&passo=oferta`. O quiz aceita `?passo=` justamente
  pra o painel conseguir abrir a última tela sem responder o quiz inteiro.
  No quiz é obrigatório escolher a tela: as coordenadas foram medidas com
  aquela tela na frente.

## Filtros

Barra do topo, vale para todas as telas: **período** (atalhos + datas),
**página** (site / quiz / os dois), **aparelho** e **origem (UTM)**.
A tela de mapa de calor tem ainda os seus: página e seção/tela.

## Detalhes que evitam número mentiroso

- Rolagem no quiz só é medida dentro da tela de oferta — as outras cabem na
  tela. A base da curva são as sessões que chegaram na oferta.
- Tempo na página só conta com a aba visível.
- Vendas vêm do webhook da Singlr (`lp_payments`), não do navegador. Como o
  checkout é em outro domínio, elas **não** se ligam a uma sessão: aparecem no
  total do período, não por página.
- O rastreio não roda dentro de iframe (senão o painel mediria a si mesmo) nem
  com `?notrack=1` na URL.

## Depurar

1. `/painel` → aba **Eventos**. Tem linha? A captação está de pé.
2. Zerado: veja se `/js/track.js` carrega (aba Network), se `DATABASE_URL`
   está na Vercel e se você não está com `?notrack=1`.
3. Para navegar sem sujar os dados: `localStorage.setItem('ap_notrack','1')`.
