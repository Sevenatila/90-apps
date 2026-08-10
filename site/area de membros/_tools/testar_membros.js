/* Testa a logica de membros.html num DOM simulado (sem dependencias). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(BASE, 'membros.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// ---- DOM minimo ----
const feitos = [];
function novoEl(id) {
  const el = {
    id, _html: '', textContent: '', value: '', innerHTML: '',
    dataset: {}, style: { setProperty() {}, background: '' },
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
                 toggle(c, v) { v ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    focus() {}, onclick: null, oninput: null,
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = v; feitos.push({ id, len: v.length }); },
  });
  return el;
}
const els = {};
const criados = [];
const cliques = [];
const abertas = [];
const novoBotao = (dataset) => ({
  dataset,
  classList: { _s: new Set(), toggle(c, v) { v ? this._s.add(c) : this._s.delete(c); },
               add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               contains(c) { return this._s.has(c); } },
  onclick: null,
});
const chips = [];
const chipsPg = [];
const coresBtn = [];
const removeBtns = [];
const baixados = [];
const estilos = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const botaoSalvar = { textContent: 'Salvar' };
const NAV = [novoBotao({ pag: 'apps' }), novoBotao({ pag: 'criativos' })];
const PAGINAS = [novoBotao({ pag: 'apps' }), novoBotao({ pag: 'criativos' })];
const doc = {
  documentElement: { dataset: {} },
  querySelector(s) { if (s === '.b-acoes .principal') return botaoSalvar; return (els[s] ||= novoEl(s)); },
  querySelectorAll(sel) {
    const cat = els['#categorias']?._html || '';
    const cri = els['#lista-criativos']?._html || '';
    const fil = els['#filtros']?._html || '';
    const conta = (txt, re) => (txt.match(re) || []).length;
    let n = 0;
    if (sel === '.hamburguer') n = conta(cat, /class="hamburguer"/g);
    else if (sel === '.app') n = conta(cat, /class="app"/g);
    else if (sel === '#lista .item') n = conta(els['#lista']?._html || '', /class="item"/g);
    else if (sel === '.nav button') return NAV;
    else if (sel === '.pagina') return PAGINAS;
    else if (sel === '#filtros .chip') {
      chips.length = 0;
      for (const m of fil.matchAll(/data-f="([^"]+)"/g)) chips.push(novoBotao({ f: m[1] }));
      return chips;
    }
    else if (sel === '#filtros-pg .chip') {
      chipsPg.length = 0;
      for (const m of (els['#filtros-pg']?._html || '').matchAll(/data-fp="([^"]+)"/g))
        chipsPg.push(novoBotao({ fp: m[1] }));
      return chipsPg;
    }
    else if (sel === '[data-abrir]') {
      const l = els['#lista-paginas']?._html || '';
      return [...l.matchAll(/data-abrir="([^"]+)"/g)].map((m) => novoBotao({ abrir: m[1] }));
    }
    else if (sel === '[data-bullet]') {
      const e = els['#b-editor']?._html || '';
      return [...e.matchAll(/data-bullet="(\d+)"/g)].map((m) => {
        const el = novoEl('bullet' + m[1]);
        el.dataset = { bullet: m[1] };
        el.oninput = null;
        return el;
      });
    }
    else if (sel === '[data-remove]') {
      removeBtns.length = 0;
      for (const m of (els['#b-editor']?._html || '').matchAll(/data-remove="(\d+)"/g))
        removeBtns.push(novoBotao({ remove: m[1] }));
      return removeBtns;
    }
    else if (sel === '[data-cor]') {
      coresBtn.length = 0;
      for (const m of (els['#b-editor']?._html || '').matchAll(/data-cor="([^"]+)"/g))
        coresBtn.push(novoBotao({ cor: m[1] }));
      return coresBtn;
    }
    else if (sel === '.b-acoes .principal') return [botaoSalvar];
    else if (sel === 'style') return [{ textContent: estilos }];
    else if (sel === '[data-todos]') n = conta(cri, /data-todos=/g);
    else if (sel === '[data-ver]') n = conta(cri, /data-ver=/g);
    else if (sel === '[data-baixar]') n = conta(cri, /data-baixar=/g);
    return Array.from({ length: n }, () => ({ dataset: { cat: 'mente', slug: 'antiestresse_app' }, onclick: null }));
  },
  createElement() { return criados[criados.push({ href: '', download: '', click() { cliques.push(this.href); }, remove() {} }) - 1]; },
  body: { appendChild() {}, style: {} },
  addEventListener() {},
};
const store = {};
const ctx = {
  document: doc,
  window: { open(u) { abertas.push(u); }, scrollTo() {} },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
  prompt: () => null,
  Blob: class { constructor(p) { this.parts = p; } },
  URL: { createObjectURL: (b) => { baixados.push(b.parts[0]); return 'blob:x'; }, revokeObjectURL() {} },
  setTimeout: () => {},
  console,
};
ctx.globalThis = ctx;

vm.createContext(ctx);
vm.runInContext(script, ctx, { timeout: 5000 });

// ---- verificacoes ----
const g = (s) => els[s];
const ok = [];
const erros = [];
const check = (nome, cond, extra = '') =>
  (cond ? ok : erros).push(nome + (extra ? ' -> ' + extra : ''));

const catHtml = g('#categorias')._html;
check('6 categorias renderizadas', (catHtml.match(/class="categoria"/g) || []).length === 6,
      (catHtml.match(/class="categoria"/g) || []).length + '');
check('36 cards de app', (catHtml.match(/class="app"/g) || []).length === 36,
      (catHtml.match(/class="app"/g) || []).length + '');
check('6 hamburgueres', (catHtml.match(/class="hamburguer"/g) || []).length === 6,
      (catHtml.match(/class="hamburguer"/g) || []).length + '');

check('avatar com inicial', g('#avatar').textContent === 'M', g('#avatar').textContent);
check('avatar colorido', /^#[0-9a-f]{6}$/i.test(g('#avatar').style.background), g('#avatar').style.background);
check('nome do usuario', g('#nome-usuario').textContent === 'Membro');
check('tema escuro inicial', ctx.document.documentElement.dataset.tema === 'escuro');

// alterna tema
g('#btn-tema').onclick();
check('tema alterna p/ claro', ctx.document.documentElement.dataset.tema === 'claro');
g('#btn-tema').onclick();
check('tema volta p/ escuro', ctx.document.documentElement.dataset.tema === 'escuro');
check('tema persiste', store['tema'] === 'escuro');

// avatar muda com o nome
ctx.aplicarUsuario('Esley');
check('avatar segue o nome', g('#avatar').textContent === 'E', g('#avatar').textContent);
const corE = g('#avatar').style.background;
ctx.aplicarUsuario('Esley');
check('cor estavel p/ mesmo nome', g('#avatar').style.background === corE);
ctx.aplicarUsuario('Ana');
check('cor muda com outro nome', g('#avatar').style.background !== corE);

// sidebar
ctx.abrirLateral('fitness');
check('lateral abre', g('#lateral').classList.contains('on'));
check('titulo da categoria', g('#titulo-lat').textContent === 'Fitness e Movimento', g('#titulo-lat').textContent);
const lista = g('#lista')._html;
check('lateral lista os 36', (lista.match(/class="item"/g) || []).length === 36,
      (lista.match(/class="item"/g) || []).length + '');
const primeiroGrupo = lista.slice(lista.indexOf('<h4>'), lista.indexOf('</h4>'));
check('categoria clicada vem 1o', primeiroGrupo.includes('Fitness e Movimento'),
      primeiroGrupo.replace(/\s+/g, ' ').trim());

// busca
ctx.pintarLista('yoga');
check('busca filtra', (g('#lista')._html.match(/class="item"/g) || []).length === 1,
      (g('#lista')._html.match(/class="item"/g) || []).length + '');
ctx.pintarLista('zzzz');
check('busca vazia avisa', g('#lista')._html.includes('Nenhum app encontrado'));
ctx.pintarLista('');

ctx.fecharLateral();
check('lateral fecha', !g('#lateral').classList.contains('on'));

// modal
ctx.abrirModal('yoga_essencial');
check('modal abre', g('#modal').classList.contains('on'));
const caixa = g('#caixa')._html;
check('modal tem botao Ver', caixa.includes('>Ver<'));
check('modal tem botao Editar', caixa.includes('>Editar<'));
check('modal mostra a categoria', caixa.includes('Fitness e Movimento'));

// editar + salvar
ctx.editarApp('yoga_essencial');
check('tela editar tem campo nome', g('#caixa')._html.includes('Nome do app'));
els['#campo-nome'] = novoEl('#campo-nome');
els['#campo-nome'].value = 'Yoga Renomeado';
ctx.salvarNome('yoga_essencial');
check('nome salvo', store['nome:yoga_essencial'] === 'Yoga Renomeado', store['nome:yoga_essencial']);
check('grade reflete novo nome', g('#categorias')._html.includes('Yoga Renomeado'));

ctx.fecharModal();
check('modal fecha', !g('#modal').classList.contains('on'));

// ---------- pagina de criativos ----------
const cri = g('#lista-criativos')._html;
const dados = JSON.parse(html.match(/const DADOS = (\[[\s\S]*?\]);\r?\n/)[1]);
const totalAds = dados.reduce((s, c) => s + c.apps.reduce((n, a) => n + a.ads.length, 0), 0);
const comAds = dados.reduce((s, c) => s + c.apps.filter((a) => a.ads.length).length, 0);

check('36 blocos de criativo', (cri.match(/class="criativo"/g) || []).length === 36,
      (cri.match(/class="criativo"/g) || []).length + '');
check('70 videos listados', (cri.match(/data-baixar=/g) || []).length === totalAds,
      (cri.match(/data-baixar=/g) || []).length + ' vs ' + totalAds);
check('botao "baixar todos" por app com ads', (cri.match(/data-todos=/g) || []).length === comAds,
      (cri.match(/data-todos=/g) || []).length + ' vs ' + comAds);
check('app sem ads mostra aviso', cri.includes('Nenhum criativo publicado'));
check('filtros: todas as categorias + todos',
      (g('#filtros')._html.match(/class="chip/g) || []).length === 7,
      (g('#filtros')._html.match(/class="chip/g) || []).length + '');

// navegacao entre paginas
ctx.irPara('criativos');
check('nav troca p/ criativos', PAGINAS[1].classList.contains('on') && !PAGINAS[0].classList.contains('on'));
check('pagina persiste', store['pagina'] === 'criativos');
ctx.irPara('apps');
check('nav volta p/ apps', PAGINAS[0].classList.contains('on'));

// filtro por categoria
const chipCulinaria = chips.find((c) => c.dataset.f === 'culinaria');
check('chip de categoria existe', !!chipCulinaria);
chipCulinaria.onclick();
check('filtro reduz a lista', (g('#lista-criativos')._html.match(/class="criativo"/g) || []).length === 5,
      (g('#lista-criativos')._html.match(/class="criativo"/g) || []).length + '');
chips.find((c) => c.dataset.f === 'todos').onclick();
check('filtro "todos" restaura', (g('#lista-criativos')._html.match(/class="criativo"/g) || []).length === 36,
      (g('#lista-criativos')._html.match(/class="criativo"/g) || []).length + '');

// download passa pelo proxy local
ctx.baixarUm('https://eva.igorstorm.com/criativos/yoga/ads1.mp4', 'yoga_essencial-ads1.mp4');
check('download usa /baixar', cliques.length === 1 && cliques[0].startsWith('/baixar?url='), cliques[0]);
check('download leva url codificada',
      cliques[0].includes(encodeURIComponent('https://eva.igorstorm.com/criativos/yoga/ads1.mp4')));
check('download leva nome do arquivo', cliques[0].includes('yoga_essencial-ads1.mp4'));

// ver abre o video
ctx.assistir('https://eva.igorstorm.com/criativos/yoga/ads1.mp4');
check('botao Ver abre o mp4', abertas.at(-1).endsWith('/yoga/ads1.mp4'));

// ---------- pagina "Gerar Pagina" ----------
const listaPg = g('#lista-paginas')._html;
const comPagina = dados.reduce((s, c) => s + c.apps.filter((a) => a.temPagina).length, 0);

check('36 cards de pagina', (listaPg.match(/class="pg-card"/g) || []).length === 36,
      (listaPg.match(/class="pg-card"/g) || []).length + '');
check('12 marcados "Com Pagina"', (listaPg.match(/flag on/g) || []).length === comPagina,
      (listaPg.match(/flag on/g) || []).length + ' vs ' + comPagina);
check('24 marcados "Gerar Nova"', (listaPg.match(/flag new/g) || []).length === 36 - comPagina);
check('card mostra #id e categoria', /#\d\d &middot; [A-Z]/.test(listaPg));
check('3 filtros de pagina', chipsPg.length === 3, chipsPg.length + '');

// filtros
chipsPg.find((c) => c.dataset.fp === 'existing').onclick();
check('filtro "Com Pagina"', (g('#lista-paginas')._html.match(/class="pg-card"/g) || []).length === comPagina,
      (g('#lista-paginas')._html.match(/class="pg-card"/g) || []).length + '');
chipsPg.find((c) => c.dataset.fp === 'generate').onclick();
check('filtro "Gerar Nova"', (g('#lista-paginas')._html.match(/class="pg-card"/g) || []).length === 36 - comPagina);
chipsPg.find((c) => c.dataset.fp === 'todos').onclick();

// busca
g('#busca-pg').oninput({ target: { value: 'yoga' } });
check('busca de pagina filtra', (g('#lista-paginas')._html.match(/class="pg-card"/g) || []).length === 1,
      (g('#lista-paginas')._html.match(/class="pg-card"/g) || []).length + '');
g('#busca-pg').oninput({ target: { value: '' } });

// ---------- builder ----------
ctx.abrirBuilder('astrologia');
check('builder abre', g('#builder').classList.contains('on'));
check('builder mostra o app', g('#b-titulo').textContent.length > 0, g('#b-titulo').textContent);
check('builder mostra #id', g('#b-sub').textContent.startsWith('#69'), g('#b-sub').textContent);

const editor = g('#b-editor')._html;
['f-headline', 'f-sub', 'f-cta', 'f-checkout'].forEach((id) =>
  check('editor tem campo ' + id, editor.includes('id="' + id + '"')));
check('editor tem 3 beneficios', (editor.match(/data-bullet=/g) || []).length === 3,
      (editor.match(/data-bullet=/g) || []).length + '');
check('editor tem paleta de cores', (editor.match(/data-cor=/g) || []).length === 8,
      (editor.match(/data-cor=/g) || []).length + '');

const prev0 = g('#b-preview')._html;
check('preview renderiza titulo', prev0.includes('<h1>'));
check('preview renderiza beneficios', (prev0.match(/class="lp-b"/g) || []).length === 3);
check('preview sem checkout usa <button>', prev0.includes('<button class="lp-cta"'));

// editar titulo reflete no preview
g('#f-headline').oninput({ target: { value: 'Mapa Astral Completo' } });
check('editar titulo atualiza preview', g('#b-preview')._html.includes('Mapa Astral Completo'));

// checkout vira link
g('#f-checkout').oninput({ target: { value: 'https://pay.exemplo.com/astro' } });
check('com checkout vira <a href>', g('#b-preview')._html.includes('<a class="lp-cta" href="https://pay.exemplo.com/astro"'));

// adicionar / remover beneficio (via UI)
g('#add-bullet').onclick();
check('adicionar beneficio', (g('#b-preview')._html.match(/class="lp-b"/g) || []).length === 4,
      (g('#b-preview')._html.match(/class="lp-b"/g) || []).length + '');
removeBtns[0].onclick();
check('remover beneficio', (g('#b-preview')._html.match(/class="lp-b"/g) || []).length === 3,
      (g('#b-preview')._html.match(/class="lp-b"/g) || []).length + '');

// trocar cor (via UI)
coresBtn.find((c) => c.dataset.cor === '#7c6cf0').onclick();
check('trocar cor marca a paleta', g('#b-editor')._html.includes('class="cor on" data-cor="#7c6cf0"'));
check('trocar cor aplica no preview', g('#b-preview')._html.length > 0);

// salvar
ctx.salvarPagina();
check('pagina salva no storage', !!store['pagina-lp:astrologia']);
const salvo = JSON.parse(store['pagina-lp:astrologia']);
check('salvou o titulo editado', salvo.headline === 'Mapa Astral Completo', salvo.headline);
check('salvou o checkout', salvo.checkout === 'https://pay.exemplo.com/astro');
check('salvou a cor', salvo.cor === '#7c6cf0');
check('feedback no botao salvar', botaoSalvar.textContent === 'Salvo!', botaoSalvar.textContent);

// exportar
ctx.exportarPagina();
const exportado = baixados.at(-1);
check('exportou HTML completo', exportado.startsWith('<!doctype html>'));
check('export tem o titulo', exportado.includes('Mapa Astral Completo'));
check('export tem a cor', exportado.includes('#7c6cf0'));
check('export tem o checkout', exportado.includes('https://pay.exemplo.com/astro'));
check('export embute o CSS da landing', exportado.includes('.lp-cta'));
check('nome do arquivo exportado', criados.at(-1).download === 'astrologia-pagina.html',
      criados.at(-1).download);

// reabrir carrega o que foi salvo
ctx.fecharBuilder();
check('builder fecha', !g('#builder').classList.contains('on'));
ctx.abrirBuilder('astrologia');
check('reabrir mantem edicao', g('#b-preview')._html.includes('Mapa Astral Completo'));
ctx.fecharBuilder();

// app editado passa a contar como "com pagina"
check('app salvo vira "Com Pagina"',
      (g('#lista-paginas')._html.match(/flag on/g) || []).length === comPagina + 1,
      (g('#lista-paginas')._html.match(/flag on/g) || []).length + '');

console.log('\nPASSOU (' + ok.length + '):');
ok.forEach((s) => console.log('  ok  ' + s));
if (erros.length) {
  console.log('\nFALHOU (' + erros.length + '):');
  erros.forEach((s) => console.log('  XX  ' + s));
  process.exit(1);
}
console.log('\nTodos os ' + ok.length + ' testes passaram.');
