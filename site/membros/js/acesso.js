/*!
 * acesso.js — guarda o e-mail do membro e responde "quem esta logado?".
 * ---------------------------------------------------------------------------
 * Existe porque a trava da area de membros dependia so do localStorage. Quando
 * ele nao grava (navegador dentro do Instagram/Facebook, aba anonima do iOS,
 * cookie de terceiro bloqueado), o login gravava "com sucesso", mandava pra
 * membros.html, membros.html nao achava nada e devolvia pro login — o membro
 * ficava rodando em circulo sem entender por que nao entrava.
 *
 * Agora tenta tres lugares, em ordem, e so diz que gravou depois de reler.
 */
(function () {
  'use strict';

  var CHAVE = 'acesso90-email';
  var raiz = typeof window !== 'undefined' ? window : globalThis;

  function lerCookie() {
    try {
      var alvo = CHAVE + '=';
      var partes = String(document.cookie || '').split(';');
      for (var i = 0; i < partes.length; i++) {
        var p = partes[i].trim();
        if (p.indexOf(alvo) === 0) return decodeURIComponent(p.slice(alvo.length));
      }
    } catch (e) {}
    return null;
  }

  function gravarCookie(valor) {
    try {
      document.cookie = CHAVE + '=' + encodeURIComponent(valor) +
        ';path=/;max-age=31536000;samesite=Lax';
      return lerCookie() === valor;
    } catch (e) { return false; }
  }

  function ler() {
    try { var v = localStorage.getItem(CHAVE); if (v) return v; } catch (e) {}
    try { var s = sessionStorage.getItem(CHAVE); if (s) return s; } catch (e) {}
    return lerCookie();
  }

  // Retorna true se ao menos UM dos tres lugares confirmou a gravacao.
  function gravar(valor) {
    var guardou = false;
    try { localStorage.setItem(CHAVE, valor); guardou = localStorage.getItem(CHAVE) === valor; } catch (e) {}
    try { sessionStorage.setItem(CHAVE, valor); guardou = guardou || sessionStorage.getItem(CHAVE) === valor; } catch (e) {}
    guardou = gravarCookie(valor) || guardou;
    return guardou;
  }

  function apagar() {
    try { localStorage.removeItem(CHAVE); } catch (e) {}
    try { sessionStorage.removeItem(CHAVE); } catch (e) {}
    try { document.cookie = CHAVE + '=;path=/;max-age=0;samesite=Lax'; } catch (e) {}
  }

  raiz.Acesso = { ler: ler, gravar: gravar, apagar: apagar, CHAVE: CHAVE };
})();
