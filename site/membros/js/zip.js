/*!
 * zip.js — monta um .zip no proprio navegador, sem biblioteca nenhuma.
 * ---------------------------------------------------------------------------
 * Existe pra area de membros conseguir entregar "baixe este app" sem depender
 * de CDN de terceiro (foi justamente disso que a gente acabou de se livrar) e
 * sem precisar de servidor pra empacotar.
 *
 * Formato: ZIP classico (PKZIP 2.0). Comprime com deflate-raw pela
 * CompressionStream do proprio navegador; onde ela nao existe, grava sem
 * compressao (metodo "store") — o arquivo fica maior, mas abre igual.
 *
 * Uso:  const blob = await criarZip([{ nome: 'index.html', dados: uint8 }]);
 */
(function () {
  'use strict';

  var raiz = typeof window !== 'undefined' ? window : globalThis;

  // ── CRC-32 ────────────────────────────────────────────────────────────────
  var TABELA = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = TABELA[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // ── Compressao ────────────────────────────────────────────────────────────
  // deflate-raw e exatamente o que o ZIP espera no metodo 8.
  async function comprimir(u8) {
    if (typeof CompressionStream === 'undefined') return { metodo: 0, dados: u8 };
    try {
      var fluxo = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      var saida = new Uint8Array(await new Response(fluxo).arrayBuffer());
      // se comprimir nao valeu a pena (imagem ja comprimida), grava cru
      return saida.length < u8.length ? { metodo: 8, dados: saida } : { metodo: 0, dados: u8 };
    } catch (_) {
      return { metodo: 0, dados: u8 };
    }
  }

  // ── Data/hora no formato do MS-DOS, que e o que o ZIP usa ─────────────────
  function dataDos(d) {
    return {
      hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      data: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  /**
   * @param {Array<{nome: string, dados: Uint8Array}>} arquivos
   * @returns {Promise<Blob>}
   */
  async function criarZip(arquivos) {
    var codificador = new TextEncoder();
    var quando = dataDos(new Date());
    var partes = [];      // o corpo do zip, na ordem
    var diretorio = [];   // os registros do indice final
    var posicao = 0;

    for (var i = 0; i < arquivos.length; i++) {
      var nome = codificador.encode(arquivos[i].nome);
      var cru = arquivos[i].dados;
      var soma = crc32(cru);
      var c = await comprimir(cru);

      // cabecalho local (30 bytes) + nome + dados
      var cab = new DataView(new ArrayBuffer(30));
      cab.setUint32(0, 0x04034B50, true);  // assinatura
      cab.setUint16(4, 20, true);          // versao necessaria
      cab.setUint16(6, 0x0800, true);      // bit 11: nome em UTF-8
      cab.setUint16(8, c.metodo, true);
      cab.setUint16(10, quando.hora, true);
      cab.setUint16(12, quando.data, true);
      cab.setUint32(14, soma, true);
      cab.setUint32(18, c.dados.length, true);
      cab.setUint32(22, cru.length, true);
      cab.setUint16(26, nome.length, true);
      cab.setUint16(28, 0, true);          // sem campo extra
      partes.push(new Uint8Array(cab.buffer), nome, c.dados);

      // registro do indice (46 bytes) + nome
      var reg = new DataView(new ArrayBuffer(46));
      reg.setUint32(0, 0x02014B50, true);
      reg.setUint16(4, 20, true);          // versao de quem criou
      reg.setUint16(6, 20, true);          // versao necessaria
      reg.setUint16(8, 0x0800, true);
      reg.setUint16(10, c.metodo, true);
      reg.setUint16(12, quando.hora, true);
      reg.setUint16(14, quando.data, true);
      reg.setUint32(16, soma, true);
      reg.setUint32(20, c.dados.length, true);
      reg.setUint32(24, cru.length, true);
      reg.setUint16(28, nome.length, true);
      reg.setUint16(30, 0, true);          // extra
      reg.setUint16(32, 0, true);          // comentario
      reg.setUint16(34, 0, true);          // disco
      reg.setUint16(36, 0, true);          // atributos internos
      reg.setUint32(38, 0, true);          // atributos externos
      reg.setUint32(42, posicao, true);    // onde comeca o cabecalho local
      diretorio.push(new Uint8Array(reg.buffer), nome);

      posicao += 30 + nome.length + c.dados.length;
    }

    var tamanhoDir = diretorio.reduce(function (s, p) { return s + p.length; }, 0);

    // fecho do arquivo (22 bytes)
    var fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054B50, true);
    fim.setUint16(4, 0, true);
    fim.setUint16(6, 0, true);
    fim.setUint16(8, arquivos.length, true);
    fim.setUint16(10, arquivos.length, true);
    fim.setUint32(12, tamanhoDir, true);
    fim.setUint32(16, posicao, true);
    fim.setUint16(20, 0, true);

    return new Blob(partes.concat(diretorio, [new Uint8Array(fim.buffer)]),
                    { type: 'application/zip' });
  }

  raiz.criarZip = criarZip;
})();
