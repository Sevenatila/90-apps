/*!
 * baixar-app.js — empacota UM app e entrega o .zip pro membro.
 * ---------------------------------------------------------------------------
 * Tudo acontece no navegador: busca os arquivos do app, monta o zip (zip.js) e
 * dispara o download. Sem servidor, sem CDN, sem biblioteca de terceiro.
 *
 * Os 108 apps tem exatamente a mesma estrutura de arquivos, entao a lista e
 * fixa — nao precisa de API pra listar pasta.
 */
(function () {
  'use strict';

  var raiz = typeof window !== 'undefined' ? window : globalThis;

  var ARQUIVOS = [
    'index.html',
    'manifest.json',
    'sw.js',
    'icon-192.png',
    'icon-512.png',
    'img/logo.jpg'
  ];

  var PASTA = { pt: 'apps', en: 'apps-en', es: 'apps-es' };

  function leiaMe(nomeApp, slug, idioma) {
    return [
      nomeApp + ' — código-fonte',
      '='.repeat(60),
      '',
      'Este é o app inteiro. Não precisa instalar nada, não tem build:',
      'são arquivos estáticos que qualquer hospedagem serve.',
      '',
      'ARQUIVOS',
      '  index.html     o app inteiro (conteúdo, telas e estilos)',
      '  manifest.json  o que faz ele instalar como aplicativo no celular',
      '  sw.js          service worker: deixa o app abrir offline',
      '  icon-192.png   ícone do app',
      '  icon-512.png   ícone do app, tamanho maior',
      '  img/logo.jpg   a logo usada dentro do app',
      '',
      'COMO PUBLICAR',
      '  1. Suba esta pasta inteira na sua hospedagem.',
      '     Vercel e Netlify: arraste a pasta na tela deles e pronto.',
      '     Hospedagem comum (cPanel/FTP): jogue tudo em public_html.',
      '  2. Abra o seu domínio. O app tem que carregar de primeira.',
      '',
      'ANTES DE ANUNCIAR',
      '  - Troque os links de pagamento pelos SEUS dentro do index.html.',
      '    Procure por "checkout" no arquivo pra achar todos.',
      '  - Confira o nome e o texto do app no manifest.json.',
      '',
      'DETALHES QUE EVITAM DOR DE CABEÇA',
      '  - Mantenha os arquivos na mesma pasta, com os mesmos nomes:',
      '    o index.html procura img/logo.jpg nesse caminho exato.',
      '  - O app precisa de HTTPS pra instalar no celular. Vercel, Netlify',
      '    e a maioria das hospedagens já dão isso de graça.',
      '  - Trocou algo e não apareceu? O sw.js guarda cópia offline:',
      '    atualize a página segurando Shift, ou abra numa aba anônima.',
      '',
      'app: ' + slug + '  ·  idioma: ' + idioma.toUpperCase(),
      ''
    ].join('\n');
  }

  /**
   * @param {string} slug     pasta do app em português (ex: yoga_essencial)
   * @param {string} idioma   pt | en | es
   * @param {string} nomeApp  nome de exibição, só pro LEIA-ME
   * @param {function} aviso  recebe mensagens de andamento (opcional)
   */
  async function baixarApp(slug, idioma, nomeApp, aviso) {
    aviso = aviso || function () {};
    var pasta = PASTA[idioma] || PASTA.pt;
    var slugIdioma = idioma === 'pt' ? slug : slug + '_' + idioma;
    var base = pasta + '/' + slugIdioma + '/';

    aviso('Juntando os arquivos…');
    var arquivos = [];
    for (var i = 0; i < ARQUIVOS.length; i++) {
      var caminho = ARQUIVOS[i];
      var r = await fetch(base + caminho, { cache: 'no-store' });
      if (!r.ok) throw new Error('Não achei ' + caminho + ' (erro ' + r.status + ')');
      arquivos.push({ nome: caminho, dados: new Uint8Array(await r.arrayBuffer()) });
      aviso('Juntando os arquivos… ' + (i + 1) + '/' + ARQUIVOS.length);
    }

    arquivos.push({
      nome: 'LEIA-ME.txt',
      dados: new TextEncoder().encode(leiaMe(nomeApp || slug, slugIdioma, idioma))
    });

    aviso('Compactando…');
    var blob = await raiz.criarZip(arquivos);

    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = slugIdioma + '.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);

    return blob.size;
  }

  raiz.baixarApp = baixarApp;
})();
