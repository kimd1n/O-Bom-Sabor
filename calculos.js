/* O Bom Sabor — cálculos puros (sem tela, sem localStorage).
 * Funciona no navegador (window.Calculos) e no Node (require). Taxas em FRAÇÃO (0,262 = 26,2%),
 * exceto calcularNumerosItemPedido, que mantém a assinatura antiga (taxa em %). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Calculos = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  const n = (v) => Number(v) || 0;

  // Quanto o restaurante recebe de um item: taxa incide sobre o valor pago pelo cliente.
  function calcularRepasse(preco, desconto, taxaFrac, freteVal) {
    const valorCliente = Math.max(0, n(preco) - n(desconto));
    const valorTaxa = valorCliente * n(taxaFrac);
    const repasse = valorCliente - valorTaxa - n(freteVal);
    return { valorCliente, valorTaxa, repasse };
  }

  // Mesma conta do index.html (calcularNumerosItemPedido); taxa em %.
  function calcularNumerosItemPedido(preco, desconto, custo, taxa, freteVal) {
    const r = calcularRepasse(preco, desconto, n(taxa) / 100, freteVal);
    const lucro = r.repasse - custo;
    const margem = preco > 0 ? (lucro / preco) * 100 : 0;
    return { valorCliente: r.valorCliente, valorBaseTaxa: r.valorCliente, valorTaxa: r.valorTaxa, repasse: r.repasse, lucro, margem };
  }

  // Promoção (reduz a base da comissão) x frete grátis (comissão no preço cheio). Pior caso = menor lucro.
  function calcularCenariosIfood(preco, custo, beneficio, taxaFrac) {
    preco = n(preco); custo = n(custo); taxaFrac = n(taxaFrac);
    const b = Math.min(Math.max(0, n(beneficio)), Math.max(0, preco));
    const basePromo = Math.max(0, preco - b);
    const taxaPromo = basePromo * taxaFrac;
    const repassePromo = basePromo - taxaPromo;
    const lucroPromo = repassePromo - custo;
    const taxaFrete = preco * taxaFrac;
    const repasseFrete = preco - taxaFrete - b;
    const lucroFrete = repasseFrete - custo;
    return { beneficio: b, basePromo, taxaPromo, repassePromo, lucroPromo,
             taxaFrete, repasseFrete, lucroFrete, lucroPior: Math.min(lucroPromo, lucroFrete) };
  }

  // Menor preço no iFood que atinge a meta no pior cenário (frete). Infinity se for impossível.
  function precoMinimoParaMeta(custo, beneficio, meta, metaTipo, taxaFrac) {
    custo = n(custo); beneficio = Math.max(0, n(beneficio)); meta = n(meta);
    const fator = 1 - n(taxaFrac);
    if (metaTipo === 'margem') {
      const divisor = fator - meta / 100;
      return divisor > 0 ? (custo + beneficio) / divisor : Infinity;
    }
    return fator > 0 ? (meta + custo + beneficio) / fator : Infinity;
  }

  // itens já com o custo atual resolvido: [{ custo, usado }]. Soma componentes + embalagem.
  function custoFichaAtual(itens, embalagem) {
    const comp = (itens || []).reduce((s, i) => s + n(i.custo) * n(i.usado), 0);
    return comp + n(embalagem);
  }

  // Receita: divide o custo total pelo rendimento (rendimento vazio/0 conta como 1, como no app).
  function custoFichaPorRendimento(custoTotal, rendimento) {
    return n(custoTotal) / Math.max(0.000001, Number(rendimento) || 1);
  }

  // Custo do produto no catálogo: ficha (se houver), senão custo manual, senão custo salvo.
  function custoDoProduto(custoFicha, custoManual, custoSnapshot) {
    if (custoFicha !== null && custoFicha !== undefined) return n(custoFicha);
    return n(custoManual) || n(custoSnapshot) || 0;
  }

  // Custo por unidade-base (g/ml/un) considerando o aproveitamento (1 a 100%).
  function custoInsumoPorUnidade(preco, quantidadeCompra, unidadeCompra, aproveitamento) {
    const u = String(unidadeCompra || '').toLowerCase();
    const fator = (u === 'kg' || u === 'l') ? 1000 : 1;
    const aprov = Math.max(1, Math.min(100, parseFloat(aproveitamento) || 100));
    const qtdUtil = n(quantidadeCompra) * fator * (aprov / 100);
    return qtdUtil > 0 ? n(preco) / qtdUtil : 0;
  }

  return { calcularRepasse, calcularNumerosItemPedido, calcularCenariosIfood, precoMinimoParaMeta,
           custoFichaAtual, custoFichaPorRendimento, custoDoProduto, custoInsumoPorUnidade };
});
