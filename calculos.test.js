const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./calculos.js');
const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} esperado ${b}, veio ${a}`);
const TAXA = 0.262;

test('repasse sem desconto e sem frete', () => {
  const r = C.calcularRepasse(50, 0, TAXA, 0);
  perto(r.valorTaxa, 13.1); perto(r.repasse, 36.9);
});
test('taxa zero é respeitada (não vira 26,2%)', () => {
  perto(C.calcularRepasse(50, 0, 0, 0).repasse, 50);
});
test('item de pedido com desconto', () => {
  const r = C.calcularNumerosItemPedido(40, 5, 12, 26.2, 0);
  perto(r.valorCliente, 35); perto(r.valorTaxa, 9.17); perto(r.repasse, 25.83);
  perto(r.lucro, 13.83); perto(r.margem, 34.575);
});
test('item de pedido com frete pago pela loja', () => {
  const r = C.calcularNumerosItemPedido(40, 0, 12, 26.2, 6);
  perto(r.repasse, 23.52); perto(r.lucro, 11.52);
});
test('cenários: promoção x frete, pior caso', () => {
  const c = C.calcularCenariosIfood(40, 12, 6, TAXA);
  perto(c.lucroPromo, 13.092); perto(c.lucroFrete, 11.52); perto(c.lucroPior, 11.52);
});
test('benefício maior que o preço é limitado ao preço', () => {
  const c = C.calcularCenariosIfood(10, 4, 50, TAXA);
  perto(c.beneficio, 10); perto(c.lucroPromo, -4);
});
test('custo zero: meta em valor e em %', () => {
  perto(C.precoMinimoParaMeta(0, 0, 5, 'valor', TAXA), 5 / 0.738);
  perto(C.precoMinimoParaMeta(0, 0, 10, 'margem', TAXA), 0);
});
test('meta em valor: o preço mínimo realmente entrega a meta', () => {
  const p = C.precoMinimoParaMeta(12, 6, 5, 'valor', TAXA);
  perto(p, 23 / 0.738);
  perto(C.calcularCenariosIfood(p, 12, 6, TAXA).lucroPior, 5);
});
test('meta em %: o preço mínimo realmente entrega a margem', () => {
  const p = C.precoMinimoParaMeta(12, 0, 20, 'margem', TAXA);
  perto(p, 12 / 0.538);
  perto(C.calcularCenariosIfood(p, 12, 0, TAXA).lucroPior / p * 100, 20);
});
test('meta impossível devolve Infinity', () => {
  assert.equal(C.precoMinimoParaMeta(12, 0, 80, 'margem', TAXA), Infinity);
  assert.equal(C.precoMinimoParaMeta(12, 0, 5, 'valor', 1), Infinity);
});
test('ficha técnica: componentes + embalagem', () => {
  perto(C.custoFichaAtual([{ custo: 2, usado: 3 }, { custo: 0.5, usado: 10 }], 1.5), 12.5);
  perto(C.custoFichaAtual([], 0), 0);
});
test('receita com rendimento (e rendimento vazio conta como 1)', () => {
  perto(C.custoFichaPorRendimento(12.5, 5), 2.5);
  perto(C.custoFichaPorRendimento(12.5, 0), 12.5);
});
test('produto: ficha, custo manual e sem nada', () => {
  perto(C.custoDoProduto(8, 5, 4), 8);
  perto(C.custoDoProduto(null, 5, 4), 5);
  perto(C.custoDoProduto(null, 0, 4), 4);
  perto(C.custoDoProduto(null, 0, 0), 0);
});
test('insumo: kg, aproveitamento e quantidade zero', () => {
  perto(C.custoInsumoPorUnidade(30, 2, 'kg', 100), 0.015);
  perto(C.custoInsumoPorUnidade(30, 2, 'kg', 80), 0.01875);
  perto(C.custoInsumoPorUnidade(24, 12, 'un', 100), 2);
  perto(C.custoInsumoPorUnidade(30, 2, 'kg', 0), 0.015); // 0 vira 100%, como no app
  perto(C.custoInsumoPorUnidade(30, 0, 'kg', 100), 0);
});
