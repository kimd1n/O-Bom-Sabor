// ===== MÓDULO: IMPORTAR RELATÓRIO IFOOD =====
let _ifoodDiasPendentes = [];

// Drag & drop
(function(){
  const dz = document.getElementById('ifood-drop-zone');
  if(!dz) return;
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.style.borderColor='var(--verde)'; dz.style.background='var(--verde-claro)'; });
  dz.addEventListener('dragleave', () => { dz.style.borderColor=''; dz.style.background=''; });
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.style.borderColor=''; dz.style.background='';
    if(e.dataTransfer.files[0]) importarRelatorioIfood(e.dataTransfer.files[0]);
  });
})();

function importarRelatorioIfood(file) {
  if(!file) return;
  const status = document.getElementById('ifood-status');
  status.textContent = '⏳ Lendo arquivo...';
  document.getElementById('ifood-preview-card').style.display = 'none';

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      if(typeof XLSX === 'undefined') { status.textContent = '❌ Biblioteca XLSX ainda carregando. Tente novamente em 2 segundos.'; return; }
      const wb = XLSX.read(e.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);

      if(!rows.length) { status.textContent = '❌ Arquivo vazio ou formato não reconhecido.'; return; }

      // Agrupar por data
      const diasMap = {};
      for(const r of rows) {
        const dataStr = r['DATA E HORA DO PEDIDO'] || '';
        const m = String(dataStr).match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if(!m) continue;
        const dataISO = m[3]+'-'+m[2]+'-'+m[1];
        if(!diasMap[dataISO]) diasMap[dataISO] = { data: dataISO, pedidos: 0, faturamento: 0, taxas: 0, repasse: 0 };
        const d = diasMap[dataISO];
        d.pedidos++;
        d.faturamento += parseFloat(r['VALOR DOS ITENS (R$)']) || 0;
        d.taxas += parseFloat(r['TAXAS E COMISSOES (R$)']) || 0;
        d.repasse += parseFloat(r['VALOR LIQUIDO (R$)']) || 0;
      }

      const dias = Object.values(diasMap).sort((a,b) => a.data.localeCompare(b.data));
      if(!dias.length) { status.textContent = '❌ Nenhum pedido reconhecido no arquivo. Verifique se o formato está correto.'; return; }

      // Estimar custo total do dia pelo catálogo
      const produtos = (typeof getProdutosCatalogo === 'function') ? getProdutosCatalogo() : [];
      const fichas = (typeof getFichasHist === 'function') ? getFichasHist() : [];
      function custoMedioEstimado() {
        if(!produtos.length) return 0;
        const total = produtos.reduce((s, p) => {
          const ficha = fichas.find(f => Number(f.id) === Number(p.fichaId));
          const custo = ficha ? (typeof fichaCustoAtual === 'function' ? fichaCustoAtual(ficha) : (p.custoSnapshot || 0)) : (Number(p.custoManual) || p.custoSnapshot || 0);
          return s + custo;
        }, 0);
        return total / produtos.length;
      }
      const crSalvo = getCustoRealSalvo_();
      const custoMed = crSalvo ? crSalvo.custoPorPedido : custoMedioEstimado();
      const pctDesp = (typeof getPedidoPctDespesas === 'function') ? getPedidoPctDespesas() : 50;

      _ifoodDiasPendentes = dias.map(d => {
        const custo = custoMed * d.pedidos;
        const sobra = d.repasse - custo;
        const desp = Math.max(0, sobra) * pctDesp / 100;
        return { ...d, custoEstimado: custo, lucroEstimado: sobra, despesas: desp, lucroReal: sobra - desp, pctDespesas: pctDesp };
      });

      // Renderizar prévia
      const fmt = v => 'R$ ' + Math.abs(Number(v)||0).toFixed(2).replace('.',',');
      const fmtData = s => { const d=new Date(s+'T12:00:00'); return d.toLocaleDateString('pt-BR'); };
      const tbody = document.getElementById('ifood-preview-body');
      const cor = v => v >= 0 ? 'color:#0F6E56;font-weight:600' : 'color:#E24B4A;font-weight:600';
      const sinal = v => (v < 0 ? '−' : '') + fmt(v);
      let linhas = _ifoodDiasPendentes.map(d => {
        return '<tr>' +
          '<td>' + fmtData(d.data) + '</td>' +
          '<td>' + d.pedidos + '</td>' +
          '<td>' + fmt(d.faturamento) + '</td>' +
          '<td style="color:#E24B4A">−' + fmt(Math.abs(d.taxas)) + '</td>' +
          '<td style="color:#0F6E56;font-weight:600">' + fmt(d.repasse) + '</td>' +
          '<td>' + fmt(d.custoEstimado) + '</td>' +
          '<td style="' + cor(d.lucroEstimado) + '">' + sinal(d.lucroEstimado) + '</td>' +
          '<td style="' + cor(d.lucroReal) + '">' + sinal(d.lucroReal) + '</td>' +
          '</tr>';
      }).join('');
      const T = _ifoodDiasPendentes.reduce((a, d) => ({
        ped: a.ped + d.pedidos, fat: a.fat + d.faturamento, tax: a.tax + Math.abs(d.taxas),
        rep: a.rep + d.repasse, cus: a.cus + d.custoEstimado, sob: a.sob + d.lucroEstimado, luc: a.luc + d.lucroReal
      }), { ped: 0, fat: 0, tax: 0, rep: 0, cus: 0, sob: 0, luc: 0 });
      linhas += '<tr style="font-weight:700;border-top:2px solid var(--cinza-borda)">' +
        '<td>TOTAL</td><td>' + T.ped + '</td><td>' + fmt(T.fat) + '</td>' +
        '<td style="color:#E24B4A">−' + fmt(T.tax) + '</td>' +
        '<td style="color:#0F6E56">' + fmt(T.rep) + '</td>' +
        '<td>' + fmt(T.cus) + '</td>' +
        '<td style="' + cor(T.sob) + '">' + sinal(T.sob) + '</td>' +
        '<td style="' + cor(T.luc) + '">' + sinal(T.luc) + '</td></tr>';
      tbody.innerHTML = linhas;

      document.getElementById('ifood-aviso-custo').style.display = produtos.length === 0 ? 'block' : 'none';
      document.getElementById('ifood-preview-card').style.display = 'block';
      status.textContent = '✅ ' + dias.length + ' dia(s) encontrado(s) — ' + rows.length + ' pedidos lidos. Custo por pedido usado: R$ ' + custoMed.toFixed(2).replace('.',',') +
        (crSalvo ? ' (real, do relatório de cardápio ' + crSalvo.periodo + ').' : ' (média simples do catálogo — importe o relatório de cardápio no passo 1 para ficar mais certo). Lucro após despesas usa ' + pctDesp + '% da sobra para despesas (ajustável na aba Vendas).');
    } catch(err) {
      status.textContent = '❌ Erro ao ler arquivo: ' + err.message;
    }
  };
  reader.readAsBinaryString(file);
}

function confirmarImportacaoIfood() {
  if(!_ifoodDiasPendentes.length) return;
  const status = document.getElementById('ifood-status');
  const fechamentos = (typeof getFechamentos === 'function') ? getFechamentos() : [];
  let substituidos = 0, novos = 0;

  const existentes = fechamentos.filter(f =>
    (f.plataforma || 'ifood') === 'ifood' &&
    _ifoodDiasPendentes.some(d => d.data === f.data)
  );

  if(existentes.length > 0) {
    const datas = existentes.map(f => {
      const dt = new Date(f.data + 'T12:00:00');
      return dt.toLocaleDateString('pt-BR');
    }).join(', ');
    if(!confirm(existentes.length + ' fechamento(s) iFood já existem para: ' + datas + '.\n\nSubstituir por dados do relatório?')) return;
    substituidos = existentes.length;
  }

  let novosFechamentos = fechamentos.filter(f =>
    !((f.plataforma || 'ifood') === 'ifood' && _ifoodDiasPendentes.some(d => d.data === f.data))
  );

  for(const d of _ifoodDiasPendentes) {
    const j = novosFechamentos.findIndex(f => f.data === d.data && (f.plataforma||'ifood') === 'ifood');
    const reg = {
      id: Date.now() + Math.random(),
      data: d.data,
      plataforma: 'ifood',
      itens: [],
      faturamento: d.faturamento,
      repasseEstimado: d.repasse,
      repasseTotal: d.repasse,
      repasseReal: d.repasse,
      custoTotal: d.custoEstimado,
      lucroTotal: d.lucroEstimado,
      margemMedia: d.faturamento > 0 ? (d.lucroEstimado / d.faturamento * 100) : 0,
      pctDespesas: d.pctDespesas,
      despesas: d.despesas,
      lucroReal: d.lucroReal,
      salvoEm: Date.now(),
      _fonte: 'importacao-ifood',
      _pedidos: d.pedidos
    };
    if(j >= 0) novosFechamentos[j] = reg; else { novosFechamentos.unshift(reg); novos++; }
  }

  novosFechamentos.sort((a,b) => (b.data||'').localeCompare(a.data||''));
  if(typeof setFechamentos === 'function') setFechamentos(novosFechamentos);
  else localStorage.setItem('bomsabor_fechamentos', JSON.stringify(novosFechamentos));

  if(typeof renderPedidoDia === 'function') renderPedidoDia();

  status.textContent = '✅ Importação concluída! ' + novos + ' novo(s) e ' + substituidos + ' substituído(s). Veja na aba Vendas.';
  document.getElementById('ifood-preview-card').style.display = 'none';
  _ifoodDiasPendentes = [];

  setTimeout(() => {
    if(typeof mudarAba === 'function') mudarAba('pedido');
  }, 1200);
}

function cancelarImportacaoIfood() {
  _ifoodDiasPendentes = [];
  document.getElementById('ifood-preview-card').style.display = 'none';
  document.getElementById('ifood-status').textContent = 'Importação cancelada.';
  document.getElementById('ifood-file-input').value = '';
}
// ===== FIM MÓDULO IMPORTAR IFOOD =====

// ===== CUSTO REAL PELO RELATÓRIO DE CARDÁPIO =====
const CUSTO_REAL_KEY = 'bomsabor_custo_real_ifood';
const MAPA_ITENS_KEY = 'bomsabor_mapa_itens_ifood';
let _cardapioLinhas = [], _cardapioMeta = null;

function escCard_(s){ return String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function semAcento_(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function normItem_(s){ return semAcento_(s).replace(/[^a-z0-9]+/g,''); }
function tokensItem_(s){ return semAcento_(s).replace(/(\d+)\s*ml/g,'$1ml').split(/[^a-z0-9]+/).filter(Boolean); }
function brl_(v){ return 'R$ ' + (Number(v)||0).toFixed(2).replace('.',','); }
function lerJson_(k, padrao){ try{ const v = JSON.parse(localStorage.getItem(k)); return v==null ? padrao : v; }catch(e){ return padrao; } }
function getCustoRealSalvo_(){ const c = lerJson_(CUSTO_REAL_KEY, null); return c && Number(c.custoPorPedido) > 0 ? c : null; }

function custoProdutoCat_(p){
  const f = getFichasHist().find(x => Number(x.id) === Number(p.fichaId));
  return Calculos.custoDoProduto(f ? fichaCustoAtual(f) : null, p.custoManual, p.custoSnapshot);
}

function sugerirProdutoCardapio_(nomeItem, produtos, mapa){
  const k = normItem_(nomeItem);
  if(Object.prototype.hasOwnProperty.call(mapa, k)) return mapa[k];
  const exato = produtos.find(p => normItem_(p.nome) === k);
  if(exato) return exato.nome;
  const ta = new Set(tokensItem_(nomeItem));
  let best = null, bs = 0;
  produtos.forEach(p => {
    const tb = new Set(tokensItem_(p.nome));
    let inter = 0; ta.forEach(t => { if(tb.has(t)) inter++; });
    const s = inter / Math.max(ta.size, tb.size, 1);
    if(s > bs){ bs = s; best = p; }
  });
  return (best && bs >= 0.6) ? best.nome : null;
}

function valorColuna_(row, nomeCol){
  const alvo = normItem_(nomeCol);
  for(const k of Object.keys(row)){ if(normItem_(k) === alvo) return row[k]; }
  return undefined;
}

function mostrarCustoRealSalvo_(){
  const el = document.getElementById('cardapio-saved'); if(!el) return;
  const c = getCustoRealSalvo_();
  if(!c){ el.innerHTML = ''; return; }
  el.innerHTML = '✅ <strong>Custo real salvo:</strong> ' + brl_(c.custoPorPedido) + ' por pedido (' + escCard_(c.periodo) + ', ' + c.pedidos + ' pedidos, ' + Math.round(c.cobertura) + '% dos itens ligados). ' +
    '<a href="#" onclick="limparCustoRealCardapio();return false" style="margin-left:6px">limpar</a>';
}
function limparCustoRealCardapio(){
  if(!confirm('Apagar o custo real salvo? A importação voltará a usar a média simples do catálogo.')) return;
  localStorage.removeItem(CUSTO_REAL_KEY); mostrarCustoRealSalvo_();
}

function lerRelatorioCardapio(file){
  if(!file) return;
  const st = document.getElementById('cardapio-status');
  st.textContent = '⏳ Lendo arquivo...';
  document.getElementById('cardapio-resultado').style.display = 'none';
  const reader = new FileReader();
  reader.onload = function(e){
    try{
      if(typeof XLSX === 'undefined'){ st.textContent = '❌ Biblioteca XLSX ainda carregando. Tente de novo em 2 segundos.'; return; }
      const wb = XLSX.read(e.target.result, { type: 'binary' });
      const nomeAba = wb.SheetNames.find(n => normItem_(n) === 'itens');
      if(!nomeAba){ st.textContent = '❌ Não achei a aba "Itens". Esse arquivo é o relatório de cardápio do iFood?'; return; }
      const itens = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba]);
      const produtos = (typeof getProdutosCatalogo === 'function') ? getProdutosCatalogo() : [];
      if(!produtos.length){ st.textContent = '❌ Nenhum produto no catálogo. Cadastre os produtos na aba Produtos primeiro.'; return; }

      let pedidos = 0, periodo = '';
      const nomeFunil = wb.SheetNames.find(n => normItem_(n).startsWith('funil'));
      if(nomeFunil){
        const f = XLSX.utils.sheet_to_json(wb.Sheets[nomeFunil])[0];
        if(f){ pedidos = Number(valorColuna_(f,'Concluídos')) || 0; periodo = String(valorColuna_(f,'Período') || ''); }
      }
      let pedidosFonte = 'concluídos do funil';
      if(!pedidos){
        pedidos = itens.reduce((s,r) => s + (Number(valorColuna_(r,'Pedidos'))||0), 0);
        pedidosFonte = 'soma dos pedidos por item (pode ficar um pouco alta)';
      }
      if(!periodo && itens[0]) periodo = String(valorColuna_(itens[0],'Período') || '');

      const mapa = lerJson_(MAPA_ITENS_KEY, {});
      _cardapioLinhas = itens.map(r => {
        const nome = String(valorColuna_(r,'Nome do item') || '').trim();
        const qtd = Number(valorColuna_(r,'Vendas total (quantidade)')) || 0;
        const valor = Number(valorColuna_(r,'Valor Total')) || 0;
        return { nome, qtd, valor, produto: sugerirProdutoCardapio_(nome, produtos, mapa) };
      }).filter(l => l.nome && l.qtd > 0);
      if(!_cardapioLinhas.length){ st.textContent = '❌ Nenhum item com vendas no arquivo.'; return; }
      _cardapioMeta = { pedidos, periodo, pedidosFonte };
      renderCardapio_();
      st.textContent = '✅ ' + _cardapioLinhas.length + ' itens lidos. Confira se cada um está ligado ao produto certo e clique em Salvar custo real.';
      document.getElementById('cardapio-resultado').style.display = 'block';
    }catch(err){
      st.textContent = '❌ Erro ao ler arquivo: ' + err.message;
    }
  };
  reader.readAsBinaryString(file);
}

function renderCardapio_(){
  const produtos = getProdutosCatalogo();
  const opts = '<option value="">— ignorar (custo R$ 0) —</option>' + produtos.map(p => '<option value="' + escCard_(p.nome) + '">' + escCard_(p.nome) + '</option>').join('');
  let custoTotal = 0, qtdOk = 0, qtdTot = 0, valorTot = 0;
  const linhas = _cardapioLinhas.map((l, i) => {
    const p = produtos.find(x => x.nome === l.produto);
    l.custoUn = p ? custoProdutoCat_(p) : 0;
    l.custo = l.custoUn * l.qtd;
    qtdTot += l.qtd; valorTot += l.valor;
    if(p){ custoTotal += l.custo; qtdOk += l.qtd; }
    const semLigacao = l.produto === null;
    const sel = '<select onchange="mudarProdutoCardapio(' + i + ',this.value)" style="max-width:220px;' + (semLigacao ? 'border-color:#E24B4A' : '') + '">' +
      (semLigacao ? '<option value="" selected disabled>— escolha o produto —</option>' : '') +
      (semLigacao ? opts : opts.replace('value="' + escCard_(l.produto || '') + '"', 'value="' + escCard_(l.produto || '') + '" selected')) + '</select>';
    return '<tr><td>' + escCard_(l.nome) + '</td><td>' + l.qtd + '</td><td>' + sel + '</td><td>' + (p ? brl_(l.custoUn) : '—') + '</td><td>' + (p ? brl_(l.custo) : '—') + '</td></tr>';
  }).join('');
  document.getElementById('cardapio-body').innerHTML = linhas;
  const cobertura = qtdTot ? qtdOk / qtdTot * 100 : 0;
  const m = _cardapioMeta;
  const custoPorPedido = m.pedidos ? custoTotal / m.pedidos : 0;
  m.custoTotal = custoTotal; m.custoPorPedido = custoPorPedido; m.cobertura = cobertura;
  const pctFat = valorTot ? custoTotal / valorTot * 100 : 0;
  document.getElementById('cardapio-resumo').innerHTML =
    '<strong>Período:</strong> ' + escCard_(m.periodo) + '<br>' +
    '<strong>Custo real dos produtos vendidos:</strong> ' + brl_(custoTotal) + ' (' + pctFat.toFixed(1).replace('.',',') + '% do faturamento dos itens)<br>' +
    '<strong>Pedidos:</strong> ' + m.pedidos + ' <span style="color:var(--cinza-texto)">(' + m.pedidosFonte + ')</span><br>' +
    '<strong>Custo por pedido:</strong> ' + brl_(custoPorPedido) + '<br>' +
    '<strong>Itens ligados a produtos:</strong> ' + Math.round(cobertura) + '% das unidades vendidas' +
    (cobertura < 99.5 ? '<br><span style="color:#E24B4A">⚠️ Itens sem produto entram com custo R$ 0 e deixam o custo subestimado. Escolha o produto certo na lista.</span>' : '');
}

function mudarProdutoCardapio(i, valor){
  if(_cardapioLinhas[i]){ _cardapioLinhas[i].produto = valor; renderCardapio_(); }
}

function salvarCustoRealCardapio(){
  if(!_cardapioMeta || !_cardapioMeta.pedidos || !(_cardapioMeta.custoPorPedido > 0)){
    alert('Não deu para calcular o custo por pedido. Confira se há produtos ligados e se o arquivo tem os pedidos.'); return;
  }
  const semLigacao = _cardapioLinhas.filter(l => l.produto === null).length;
  if(semLigacao && !confirm(semLigacao + ' item(ns) sem produto vão entrar com custo R$ 0. Salvar mesmo assim?')) return;
  localStorage.setItem(CUSTO_REAL_KEY, JSON.stringify({
    periodo: _cardapioMeta.periodo, custoPorPedido: _cardapioMeta.custoPorPedido, pedidos: _cardapioMeta.pedidos,
    custoTotal: _cardapioMeta.custoTotal, cobertura: _cardapioMeta.cobertura, salvoEm: Date.now()
  }));
  const mapa = lerJson_(MAPA_ITENS_KEY, {});
  _cardapioLinhas.forEach(l => { if(l.produto !== null) mapa[normItem_(l.nome)] = l.produto; });
  localStorage.setItem(MAPA_ITENS_KEY, JSON.stringify(mapa));
  document.getElementById('cardapio-resultado').style.display = 'none';
  document.getElementById('cardapio-file-input').value = '';
  document.getElementById('cardapio-status').textContent = '✅ Custo real salvo. Agora importe o relatório de pedidos no passo 2.';
  mostrarCustoRealSalvo_();
}

function cancelarCustoRealCardapio(){
  _cardapioLinhas = []; _cardapioMeta = null;
  document.getElementById('cardapio-resultado').style.display = 'none';
  document.getElementById('cardapio-file-input').value = '';
  document.getElementById('cardapio-status').textContent = 'Cancelado.';
}
mostrarCustoRealSalvo_();
// ===== FIM CUSTO REAL CARDÁPIO =====

