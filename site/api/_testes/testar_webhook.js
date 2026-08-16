/* Testa a leitura do payload do webhook da Singlr (sem banco, sem rede).
 *
 * Roda com:  node site/api/_testes/testar_webhook.js
 *
 * O que esta aqui sao os formatos que quebraram na pratica: evento no topo com
 * o status verdadeiro la dentro, email do vendedor antes do email do comprador,
 * e corpo chegando como texto em vez de JSON.
 */
const { findEmail, findStatusTextos, ATIVO_HINTS, REEMBOLSO_HINTS } =
  require('../webhook-singlr')._internos;

const casa = (textos, hints) => textos.some(t => hints.some(h => t.includes(h)));
function decidir(payload) {
  const textos = findStatusTextos(payload);
  if (casa(textos, REEMBOLSO_HINTS)) return 'reembolsado';
  if (casa(textos, ATIVO_HINTS)) return 'ativo';
  return 'ignorado';
}

const ok = [];
const erros = [];
const check = (nome, real, esperado) =>
  (real === esperado ? ok : erros).push(nome + ' -> esperado ' + esperado + ', veio ' + real);

// ── email do comprador vs email de quem vende ──────────────────────────────
check('email: comprador aninhado, vendedor no topo',
  findEmail({
    seller_email: 'vendedor@igorstorm.com',
    customer: { name: 'Ana', email: 'ana@gmail.com' }
  }), 'ana@gmail.com');

check('email: chave crua na raiz',
  findEmail({ email: 'joao@gmail.com', status: 'paid' }), 'joao@gmail.com');

check('email: buyer_email',
  findEmail({ support_email: 'suporte@x.com', buyer_email: 'maria@hotmail.com' }),
  'maria@hotmail.com');

check('email: so tem email de vendedor -> nao libera ninguem',
  findEmail({ producer: { email: 'produtor@x.com' } }), null);

check('email: payload sem email', findEmail({ status: 'paid' }), null);

// ── status: o evento do topo nao pode esconder o status de baixo ───────────
check('status: event=created + status=paid',
  decidir({ event: 'order.created', data: { status: 'paid' } }), 'ativo');

check('status: aprovado em portugues',
  decidir({ situacao: 'Compra aprovada' }), 'ativo');

check('status: success',
  decidir({ event: 'payment.success' }), 'ativo');

check('status: pendente nao libera',
  decidir({ event: 'order.created', data: { status: 'pending' } }), 'ignorado');

check('status: reembolso ganha de tudo',
  decidir({ event: 'order.paid', data: { status: 'refunded' } }), 'reembolsado');

check('status: chargeback',
  decidir({ status: 'chargeback' }), 'reembolsado');

// ── caso completo, no formato que a Singlr costuma mandar ──────────────────
const vendaReal = {
  event: 'transaction.updated',
  data: {
    id: 'trx_123',
    status: 'approved',
    amount: 9700,
    seller: { email: 'loja@igorstorm.com' },
    customer: { name: 'Cliente Teste', email: 'Cliente@Gmail.COM ' }
  }
};
check('venda real: email', findEmail(vendaReal), 'cliente@gmail.com');
check('venda real: decisao', decidir(vendaReal), 'ativo');

// ── resultado ──────────────────────────────────────────────────────────────
console.log('\n' + ok.length + ' passaram');
if (erros.length) {
  console.log('\n' + erros.length + ' FALHARAM:');
  erros.forEach(e => console.log('  x ' + e));
  process.exit(1);
}
console.log('tudo certo.\n');
