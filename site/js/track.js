/*!
 * 90 apps — rastreio do site de vendas e do quiz
 * ---------------------------------------------------------------------------
 * Alimenta o /painel. Regras que este arquivo se impoe:
 *
 *  1. NUNCA atrapalhar a pagina. Tudo em try/catch, tudo passivo, zero
 *     dependencia. Se este script explodir, a pagina continua vendendo.
 *  2. Mandar em LOTE. Um sendBeacon a cada 5s ou 15 eventos — nao um por
 *     clique. Beacon nao segura a navegacao quando a pessoa sai.
 *  3. Nada de dado pessoal. Sem e-mail digitado, sem IP aqui. So coordenada,
 *     secao, rotulo de botao, origem de trafego e as escolhas do quiz.
 *
 * A pagina pode falar com o rastreio por window.track90:
 *   track90.evento(nome, secao, rotulo)
 *   track90.passo(nomeDaTela)   → troca de tela do quiz
 *   track90.set(chave, valor)   → quizNicho | quizTempo | quizExperiencia | deuEmail
 * Como este script carrega com defer, quem chama antes dele existir deve
 * empilhar em window.trackFila — a fila e drenada na partida.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var ENDPOINT = '/api/track';
  var FLUSH_MS = 5000;
  var FLUSH_AT = 15;

  // ── Nao rastrear dentro de iframe ─────────────────────────────────────────
  // O /painel abre a pagina num iframe pra desenhar o mapa de calor. Sem esta
  // guarda, cada vez que voce olhasse o mapa criaria visita e clique falsos —
  // o painel medindo a si mesmo.
  try { if (window.self !== window.top) return; } catch (_) { return; }

  // Escape manual pra depurar sem sujar os dados: /?notrack=1
  try {
    if (/[?&]notrack=1/.test(location.search)) return;
    if (localStorage.getItem('ap_notrack') === '1') return;
  } catch (_) {}

  // ── Que pagina e esta ─────────────────────────────────────────────────────
  var PAGE = /^\/quiz(\/|$)/.test(location.pathname) ? 'quiz' : 'site';

  // ── Sessao ────────────────────────────────────────────────────────────────
  // sessionStorage: mesma aba = mesma sessao. Fechou a aba, comeca outra —
  // que e exatamente o comportamento que a gente quer medir aqui.
  var sid;
  try {
    sid = sessionStorage.getItem('ap_sid');
    if (!sid) {
      sid = 'ap' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('ap_sid', sid);
    }
  } catch (_) {
    sid = 'ap' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  var vw = window.innerWidth || document.documentElement.clientWidth;
  var device = vw < 768 ? 'mobile' : (vw < 1024 ? 'tablet' : 'desktop');

  var params = new URLSearchParams(location.search);
  var utm = {
    utm_source:   params.get('utm_source'),
    utm_medium:   params.get('utm_medium'),
    utm_campaign: params.get('utm_campaign'),
    utm_content:  params.get('utm_content'),
    utm_term:     params.get('utm_term'),
    fbclid:       params.get('fbclid')
  };

  // ── Estado ────────────────────────────────────────────────────────────────
  var fila = { events: [], clicks: [] };
  var maxScroll = 0;
  var lastSection = null;
  var ctaClicks = 0;
  var reachedCheckout = false;
  var viuOferta = false;
  var deuEmail = false;
  var quiz = { nicho: null, tempo: null, experiencia: null };
  var marcos = {};        // scroll_25/50/75/90 ja disparados
  var secoesVistas = {};  // section_view ja disparado por secao
  var ativoSeg = 0;       // tempo ATIVO (aba visivel), em segundos
  var timerAtivo = null;
  // No quiz so faz sentido medir rolagem na tela de oferta — as outras cabem
  // na tela. Medir todas daria uma media sem significado nenhum.
  var medirScroll = (PAGE === 'site');

  function evento(name, section, label) {
    fila.events.push({ name: name, section: section || null, label: label || null });
    if (fila.events.length + fila.clicks.length >= FLUSH_AT) enviar(false);
  }

  // ── Envio ─────────────────────────────────────────────────────────────────
  function corpo() {
    return JSON.stringify({
      sessionId: sid,
      page: PAGE,
      device: device,
      events: fila.events,
      clicks: fila.clicks,
      session: {
        vw: vw,
        referrer: document.referrer || null,
        path: location.pathname,
        utm_source: utm.utm_source, utm_medium: utm.utm_medium,
        utm_campaign: utm.utm_campaign, utm_content: utm.utm_content,
        utm_term: utm.utm_term, fbclid: utm.fbclid,
        maxScroll: maxScroll,
        lastSection: lastSection,
        duration: ativoSeg,
        ctaClicks: ctaClicks,
        reachedCheckout: reachedCheckout,
        viuOferta: viuOferta,
        deuEmail: deuEmail,
        quizNicho: quiz.nicho,
        quizTempo: quiz.tempo,
        quizExperiencia: quiz.experiencia
      }
    });
  }

  function enviar(saindo) {
    if (!fila.events.length && !fila.clicks.length && !saindo) return;
    var payload = corpo();
    fila = { events: [], clicks: [] };
    try {
      // Beacon sobrevive ao fechamento da aba; fetch nao (por isso o fallback
      // usa keepalive, que e o equivalente possivel).
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(ENDPOINT, {
          method: 'POST', body: payload, keepalive: true,
          headers: { 'Content-Type': 'application/json' }
        }).catch(function () {});
      }
    } catch (_) {}
  }

  // ── Tempo ativo ───────────────────────────────────────────────────────────
  // Aba em segundo plano nao conta. Sem isso, "tempo medio na pagina" vira
  // ficcao: aba esquecida por 40 min viraria engajamento.
  function ligarRelogio() {
    if (timerAtivo) return;
    timerAtivo = setInterval(function () { if (!document.hidden) ativoSeg++; }, 1000);
  }

  // ── Secoes (site) ─────────────────────────────────────────────────────────
  function observarSecoes() {
    var alvos = document.querySelectorAll('[data-sec]');
    if (!alvos.length) return;
    if (!('IntersectionObserver' in window)) {
      lastSection = alvos[0].getAttribute('data-sec');
      return;
    }
    var io = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) {
        if (!e.isIntersecting) return;
        var nome = e.target.getAttribute('data-sec');
        if (!nome) return;
        lastSection = nome;
        if (!secoesVistas[nome]) {
          secoesVistas[nome] = 1;
          evento('section_view', nome);
        }
      });
    }, { threshold: 0.35 });  // 35% visivel = "viu de verdade"
    Array.prototype.forEach.call(alvos, function (el) { io.observe(el); });
  }

  function secaoDe(el) {
    var n = el;
    while (n && n !== document.body) {
      if (n.getAttribute && n.getAttribute('data-sec')) return n.getAttribute('data-sec');
      n = n.parentElement;
    }
    return lastSection;
  }

  // ── Rolagem ───────────────────────────────────────────────────────────────
  var tickScroll = false;
  function aoRolar() {
    if (!medirScroll || tickScroll) return;
    tickScroll = true;
    requestAnimationFrame(function () {
      tickScroll = false;
      var doc = document.documentElement;
      var altura = Math.max(doc.scrollHeight, document.body.scrollHeight) - window.innerHeight;
      if (altura <= 0) return;
      var pct = Math.round((window.scrollY / altura) * 100);
      if (pct > maxScroll) maxScroll = Math.min(100, pct);

      if (PAGE !== 'site') return;   // marcos de rolagem so sao degrau no site
      [25, 50, 75, 90].forEach(function (m) {
        if (maxScroll >= m && !marcos[m]) {
          marcos[m] = 1;
          evento('scroll_' + m, lastSection);
        }
      });
    });
  }

  // ── Cliques ───────────────────────────────────────────────────────────────
  function rotulo(el) {
    if (!el) return null;
    var t = (el.getAttribute && (el.getAttribute('data-track') || el.getAttribute('aria-label'))) || '';
    if (!t && el.tagName === 'IMG') t = el.getAttribute('alt') || 'imagem';
    if (!t && el.getAttribute) t = el.getAttribute('title') || '';
    if (!t) t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (!t) t = el.tagName.toLowerCase();
    return t.slice(0, 120);
  }

  function acionavel(el) {
    var n = el;
    while (n && n !== document.body) {
      var tag = n.tagName;
      if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' ||
          tag === 'TEXTAREA' || tag === 'SUMMARY') return n;
      if (n.getAttribute && (n.getAttribute('role') === 'button' ||
                             n.hasAttribute('onclick') || n.hasAttribute('data-cta'))) return n;
      n = n.parentElement;
    }
    return null;
  }

  function ehCheckout(el) {
    if (!el) return false;
    if (el.hasAttribute && el.hasAttribute('data-checkout')) return true;
    var href = (el.getAttribute && el.getAttribute('href')) || '';
    return href.indexOf('singlr.com.br') > -1 || href.indexOf('/checkout') > -1;
  }

  // As opcoes do quiz ficam de fora de proposito: elas ja viram quiz_answer,
  // contar as duas coisas encheria o funil de CTA que nao e CTA.
  function ehCta(el) {
    if (!el || !el.classList) return false;
    return el.classList.contains('btn') || el.classList.contains('btn-ghost') ||
           (el.hasAttribute && el.hasAttribute('data-cta'));
  }

  var ultimoClique = { x: 0, y: 0, t: 0, n: 0 };

  function aoClicar(e) {
    try {
      var doc = document.documentElement;
      var alturaDoc = Math.max(doc.scrollHeight, document.body.scrollHeight);
      var x = e.clientX / (window.innerWidth || 1);
      var y = e.pageY / (alturaDoc || 1);

      var alvo = e.target;
      var acao = acionavel(alvo);
      var section = secaoDe(alvo);
      var lab = rotulo(acao || alvo);

      // Posicao dentro da propria secao — o heatmap por secao continua valendo
      // mesmo que a pagina mude de tamanho depois.
      var secPct = null;
      var secEl = alvo.closest ? alvo.closest('[data-sec]') : null;
      if (secEl) {
        var r = secEl.getBoundingClientRect();
        if (r.height > 0) secPct = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      }

      var checkout = ehCheckout(acao);
      var cta = !checkout && ehCta(acao);

      fila.clicks.push({
        section: section, label: lab,
        x: x, y: y, secPct: secPct,
        isCta: checkout || cta,
        dead: !acao,
        vw: window.innerWidth, vh: window.innerHeight
      });

      if (checkout) {
        reachedCheckout = true;
        ctaClicks++;
        evento('checkout_click', section, lab);
        enviar(true);              // sai da pagina agora — despacha ja
      } else if (cta) {
        ctaClicks++;
        evento('cta_click', section, lab);
      } else if (acao && acao.getAttribute && acao.getAttribute('data-ev')) {
        evento(acao.getAttribute('data-ev'), section, lab);
      } else if (acao && acao.tagName === 'SUMMARY') {
        evento('faq_open', section, lab);
      }

      // ── Rage click ────────────────────────────────────────────────────────
      // 3 cliques em ate 1s dentro de 30px = a pessoa achou que aquilo era
      // botao e nao era, ou travou. Vale ouro pra achar atrito.
      var agora = Date.now();
      var perto = Math.abs(e.clientX - ultimoClique.x) < 30 && Math.abs(e.clientY - ultimoClique.y) < 30;
      if (perto && agora - ultimoClique.t < 1000) {
        ultimoClique.n++;
        if (ultimoClique.n === 3) evento('rage_click', section, lab);
      } else {
        ultimoClique.n = 1;
      }
      ultimoClique.x = e.clientX; ultimoClique.y = e.clientY; ultimoClique.t = agora;

      if (fila.clicks.length >= FLUSH_AT) enviar(false);
    } catch (_) {}
  }

  // ── API pra pagina ────────────────────────────────────────────────────────
  var api = {
    evento: function (nome, secao, rot) {
      try { evento(String(nome).slice(0, 60), secao, rot); } catch (_) {}
    },
    // Troca de tela do quiz. Cada tela conta como secao — e assim o funil de
    // telas e o mapa de calor por tela caem no mesmo modelo do site.
    passo: function (nome) {
      try {
        if (!nome) return;
        lastSection = nome;
        if (!secoesVistas[nome]) {
          secoesVistas[nome] = 1;
          evento('section_view', nome);
        }
        if (nome === 'oferta') {
          viuOferta = true;
          // A rolagem passa a valer aqui: e a unica tela do quiz que e longa.
          medirScroll = true;
          maxScroll = 0;
          marcos = {};
        } else if (PAGE === 'quiz') {
          medirScroll = false;
        }
      } catch (_) {}
    },
    set: function (chave, valor) {
      try {
        if (chave === 'quizNicho') quiz.nicho = valor;
        else if (chave === 'quizTempo') quiz.tempo = valor;
        else if (chave === 'quizExperiencia') quiz.experiencia = valor;
        else if (chave === 'deuEmail') deuEmail = !!valor;
      } catch (_) {}
    },
    flush: function () { enviar(true); }
  };

  // ── Partida ───────────────────────────────────────────────────────────────
  function iniciar() {
    try {
      window.track90 = api;

      // Drena o que a pagina pediu antes deste script existir (defer).
      var pendentes = window.trackFila || [];
      window.trackFila = { push: function (c) { chamar(c); } };
      pendentes.forEach(chamar);

      evento('visit', null, location.pathname);
      observarSecoes();
      ligarRelogio();

      window.addEventListener('scroll', aoRolar, { passive: true });
      document.addEventListener('click', aoClicar, { passive: true, capture: true });

      setInterval(function () { enviar(false); }, FLUSH_MS);

      // pagehide cobre o iOS, onde unload nao dispara de forma confiavel
      window.addEventListener('pagehide', function () { evento('exit', lastSection); enviar(true); });
      document.addEventListener('visibilitychange', function () { if (document.hidden) enviar(true); });

      aoRolar();
    } catch (_) {}
  }

  function chamar(c) {
    try { if (c && api[c[0]]) api[c[0]](c[1], c[2], c[3]); } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
