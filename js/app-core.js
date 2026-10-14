  // ---- SINCRONIZAÇÃO ENTRE APARELHOS (Google Apps Script, grátis) ----
  // Versão 2: sincronização segura por data de alteração.
  // O aparelho com a versão mais nova envia; o mais antigo baixa antes de sobrescrever.
  const LOCAL_DATA_KEYS = [
    'bomsabor_hist', 'bomsabor_cfg', 'bomsabor_ficha',
    'bomsabor_ficha_embalagem', 'bomsabor_fichas_hist', 'bomsabor_meus_insumos',
    'bomsabor_pedido_atual', 'bomsabor_fechamentos', 'bomsabor_pedido_pct_despesas',
    'bomsabor_produtos_catalogo'
  ];
  let syncAutoInterval = null;
  let syncDebounceTimer = null;
  let aplicandoDadosRemotos = false;

  function getCloudUrl() { return localStorage.getItem('bomsabor_cloud_url') || ''; }
  function getCloudToken() { return localStorage.getItem('bomsabor_cloud_token') || ''; }
  function getLocalUpdatedAt() { return parseInt(localStorage.getItem('bomsabor_updated_at') || '0', 10) || 0; }
  function setLocalUpdatedAt(v) { localStorage.setItem('bomsabor_updated_at', String(Number(v) || 0)); }
  function temDadosLocais() { return LOCAL_DATA_KEYS.some(k => localStorage.getItem(k) !== null); }

  // Marca o momento da última sincronização bem-sucedida deste aparelho com a nuvem.
  // Serve para diferenciar "cheguei atualizado por outro aparelho" (normal) de
  // "eu tinha alterações não sincronizadas e elas foram substituídas" (conflito real).
  function getLastSyncedAt() { return parseInt(localStorage.getItem('bomsabor_last_synced_at') || '0', 10) || 0; }
  function setLastSyncedAt(v) { localStorage.setItem('bomsabor_last_synced_at', String(Number(v) || 0)); }

  function avisarConflito(msg) {
    const banner = document.getElementById('conflito-banner');
    const texto = document.getElementById('conflito-msg');
    const mensagem = String(msg || '').trim();
    if (!mensagem) { if (banner) banner.style.display = 'none'; return; }
    if (texto) texto.textContent = mensagem;
    if (banner) banner.style.display = 'flex';
  }
  function fecharConflitoBanner() {
    const banner = document.getElementById('conflito-banner');
    if (banner) banner.style.display = 'none';
  }

  function garantirVersaoLocal() {
    if (!getLocalUpdatedAt() && temDadosLocais()) setLocalUpdatedAt(Date.now());
  }

  function marcarAlteracaoLocal() {
    if (aplicandoDadosRemotos) return;
    setLocalUpdatedAt(Date.now());
    agendarSync();
  }

  function agendarSync() {
    if (!getCloudUrl()) return;
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => sincronizarManual(true), 1800);
  }

  function atualizarStatusSync(msg) {
    const s = document.getElementById('sync-status');
    const b = document.getElementById('sync-badge');
    if (s) s.textContent = msg;
    if (b) b.textContent = getCloudUrl() ? msg : 'Sincronização desligada';
  }

  function salvarCloudConfig() {
    localStorage.setItem('bomsabor_cloud_url', document.getElementById('cfg-cloud-url').value.trim());
    localStorage.setItem('bomsabor_cloud_token', document.getElementById('cfg-cloud-token').value.trim());
    if (getCloudUrl()) {
      garantirVersaoLocal();
      iniciarSyncAutomatico();
      sincronizarManual();
    } else {
      if (syncAutoInterval) clearInterval(syncAutoInterval);
      atualizarStatusSync('Sincronização desligada');
    }
  }

  function coletarSnapshot() {
    return {
      schemaVersion: 2,
      updatedAt: getLocalUpdatedAt(),
      hist: getHistorico(),
      cfg: getConfig(),
      ficha: getFicha(),
      fichaEmbalagem: getFichaEmbalagem(),
      fichasHist: getFichasHist(),
      meusInsumos: getMeusInsumos(),
      pedidoAtual: getPedidoAtual(),
      fechamentos: getFechamentos(),
      pedidoPctDespesas: getPedidoPctDespesas(),
      produtosCatalogo: getProdutosCatalogo()
    };
  }

  function aplicarSnapshot(d, updatedAt, avisarSeConflito = false) {
    if (!d) return;
    // Se este aparelho tinha alterações locais feitas DEPOIS da última sincronização
    // confirmada, essas alterações estão prestes a ser substituídas pelos dados da nuvem.
    const tinhaAlteracaoNaoSincronizada = getLocalUpdatedAt() > getLastSyncedAt();
    aplicandoDadosRemotos = true;
    try {
      if (Array.isArray(d.hist)) setHistorico(d.hist, true);
      if (d.cfg) setConfig(d.cfg, true);
      if (Array.isArray(d.ficha)) setFicha(d.ficha, true);
      if (d.fichaEmbalagem !== undefined) setFichaEmbalagem(d.fichaEmbalagem, true);
      if (Array.isArray(d.fichasHist)) setFichasHist(d.fichasHist, true);
      if (Array.isArray(d.meusInsumos)) setMeusInsumos(d.meusInsumos, true);
      if (d.pedidoAtual) setPedidoAtual(d.pedidoAtual, true);
      if (Array.isArray(d.fechamentos)) setFechamentos(d.fechamentos, true);
      if (d.pedidoPctDespesas !== undefined) setPedidoPctDespesas(d.pedidoPctDespesas, true);
      if (Array.isArray(d.produtosCatalogo)) { localStorage.setItem('bomsabor_produtos_catalogo', JSON.stringify(d.produtosCatalogo)); }
      const novoTs = Number(updatedAt || d.updatedAt || Date.now());
      setLocalUpdatedAt(novoTs);
      setLastSyncedAt(novoTs);
    } finally {
      aplicandoDadosRemotos = false;
    }
    aplicarConfigCampos();
    const cfgInicial=getConfig(); document.getElementById('prod-meta').value=cfgInicial.metaPadrao ?? 5; document.getElementById('prod-meta-tipo').value=cfgInicial.metaTipo || 'valor';
    renderHistorico();
    renderResumo();
    renderFicha();
    renderFichasHist();
    renderMeusInsumos();
    popularFichasProdutos();
    renderProdutosCatalogo();
    renderPedidoDia();
    if (avisarSeConflito && tinhaAlteracaoNaoSincronizada) {
      avisarConflito('Alterações feitas aqui antes de sincronizar foram substituídas pelos dados de outro aparelho. Confira se está tudo certo.');
    }
  }

  async function obterDaNuvem() {
    const url = getCloudUrl();
    if (!url) throw new Error('Link de sincronização não configurado');
    // POST em vez de GET: o token de sincronização vai só no corpo da requisição,
    // nunca aparece na URL (evita ficar gravado em histórico do navegador/proxy).
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: getCloudToken(), action: 'get' }),
      cache: 'no-store', redirect: 'follow'
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const j = await resp.json();
    if (!j || j.ok === false || j.erro) throw new Error(j?.erro || 'Resposta inválida da nuvem');
    return j;
  }

  async function enviarParaNuvem() {
    const url = getCloudUrl();
    if (!url) return null;
    garantirVersaoLocal();
    const snap = coletarSnapshot();
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: getCloudToken(), updatedAt: snap.updatedAt, data: snap }),
      redirect: 'follow'
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const j = await resp.json();
    if (!j || j.ok === false || j.erro) throw new Error(j?.erro || 'Erro ao salvar na nuvem');

    if (j.status === 'saved') {
      // Nosso envio venceu: este aparelho está sincronizado com o que está na nuvem agora.
      setLastSyncedAt(Number(j.updatedAt || snap.updatedAt));
    } else if (j.status === 'kept_remote' && j.data) {
      // Outro aparelho salvou uma versão mais nova antes de nós — nossas alterações
      // locais não sincronizadas foram descartadas pelo servidor. Avisa o usuário.
      aplicarSnapshot(j.data, j.updatedAt, true);
    }
    return j;
  }

  async function buscarDaNuvem(forcar = false) {
    const remoto = await obterDaNuvem();
    if (remoto.data && (forcar || Number(remoto.updatedAt || 0) > getLocalUpdatedAt())) {
      // forcar=true é o botão "Carregar" — o usuário pediu explicitamente para trazer a
      // nuvem por cima do que está aqui, então não é tratado como conflito.
      aplicarSnapshot(remoto.data, remoto.updatedAt, !forcar);
      return 'baixado';
    }
    return remoto.data ? 'igual_ou_antigo' : 'vazio';
  }

  // Compara primeiro as versões. Só depois decide se envia ou baixa.
  async function sincronizarManual(silencioso = false) {
    const url = getCloudUrl();
    if (!url) {
      if (!silencioso) atualizarStatusSync('Configure o link de sincronização em Configurações');
      return;
    }
    const btn = document.getElementById('sync-btn');
    if (btn) { btn.classList.add('sincronizando'); btn.disabled = true; }
    if (!silencioso) atualizarStatusSync('Comparando versões…');
    try {
      garantirVersaoLocal();
      const remoto = await obterDaNuvem();
      const remotoTs = Number(remoto.updatedAt || 0);
      const localTs = getLocalUpdatedAt();

      if (!remoto.data) {
        if (temDadosLocais()) await enviarParaNuvem();
      } else if (remotoTs > localTs) {
        aplicarSnapshot(remoto.data, remotoTs, true);
      } else if (localTs > remotoTs) {
        await enviarParaNuvem();
      } else {
        // Já estávamos em dia com a nuvem.
        setLastSyncedAt(localTs);
      }

      atualizarStatusSync('Sincronizado às ' + new Date().toLocaleTimeString('pt-BR'));
    } catch (e) {
      atualizarStatusSync(navigator.onLine ? 'Erro de sincronização: ' + e.message : 'Sem internet — alterações salvas neste aparelho');
    } finally {
      if (btn) { btn.classList.remove('sincronizando'); btn.disabled = false; }
    }
  }

  // Botão Carregar: força a cópia da nuvem para este aparelho.
  async function carregarDaNuvem() {
    if (!getCloudUrl()) {
      atualizarStatusSync('Configure o link de sincronização em Configurações');
      return;
    }
    const btn = document.getElementById('load-btn');
    if (btn) { btn.classList.add('sincronizando'); btn.disabled = true; }
    atualizarStatusSync('Carregando dados da nuvem…');
    try {
      const resultado = await buscarDaNuvem(true);
      atualizarStatusSync(resultado === 'vazio' ? 'A nuvem ainda está vazia' : 'Dados da nuvem carregados');
    } catch (e) {
      atualizarStatusSync(navigator.onLine ? 'Erro ao carregar: ' + e.message : 'Sem internet — usando dados deste aparelho');
    } finally {
      if (btn) { btn.classList.remove('sincronizando'); btn.disabled = false; }
    }
  }

  function iniciarSyncAutomatico() {
    if (syncAutoInterval) clearInterval(syncAutoInterval);
    syncAutoInterval = setInterval(() => {
      if (getCloudUrl() && navigator.onLine) sincronizarManual(true);
    }, 40000);
  }

  window.addEventListener('online', () => { if (getCloudUrl()) sincronizarManual(true); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && getCloudUrl() && navigator.onLine) sincronizarManual(true);
  });

  function getHistorico() {
    try { return JSON.parse(localStorage.getItem('bomsabor_hist') || '[]'); } catch(e) { return []; }
  }
  function setHistorico(h, fromRemote = false) { localStorage.setItem('bomsabor_hist', JSON.stringify(h)); if (!fromRemote) marcarAlteracaoLocal(); }
  function getConfig() {
    try { return JSON.parse(localStorage.getItem('bomsabor_cfg') || '{"taxa":26.2,"frete":8,"metaPadrao":5,"metaTipo":"valor"}'); } catch(e) { return {taxa:26.2,frete:8,metaPadrao:5,metaTipo:'valor'}; }
  }
  function setConfig(c, fromRemote = false) { localStorage.setItem('bomsabor_cfg', JSON.stringify(c)); if (!fromRemote) marcarAlteracaoLocal(); }
  // Fração (0-1) da taxa iFood configurada, com padrão de segurança de 26,2%
  function getTaxaIfoodFrac() {
    const v = Number(getConfig().taxa);
    return (Number.isFinite(v) && v >= 0 && v <= 100) ? v / 100 : 0.262;
  }

  function aplicarConfigCampos() {
    const cfg = getConfig();
    // Migração: versões antigas usavam 32% como padrão.
    if (Number(cfg.taxa) === 32 && !cfg.taxaAtualizada2026) { cfg.taxa = 26.2; cfg.taxaAtualizada2026 = true; setConfig(cfg); }
    document.getElementById('taxa').value = cfg.taxa ?? 26.2;
    document.getElementById('cfg-taxa').value = cfg.taxa ?? 26.2;
    document.getElementById('frete-val') && (document.getElementById('frete-val').value = cfg.frete);
    document.getElementById('cfg-frete').value = cfg.frete;
    document.getElementById('cfg-meta').value = cfg.metaPadrao ?? 5;
    document.getElementById('cfg-meta-tipo').value = cfg.metaTipo || 'valor';
  }

  function init() {
    aplicarConfigCampos();
    const cfgInicial=getConfig(); document.getElementById('prod-meta').value=cfgInicial.metaPadrao ?? 5; document.getElementById('prod-meta-tipo').value=cfgInicial.metaTipo || 'valor';
    renderHistorico();
    renderResumo();
    renderFicha();
    renderFichasHist();
    renderMeusInsumos();
    popularFichasProdutos();
    renderProdutosCatalogo();
    renderPedidoDia();
    mudarAba('resumo');
    document.getElementById('cfg-cloud-url').value = getCloudUrl();
    document.getElementById('cfg-cloud-token').value = getCloudToken();
    garantirVersaoLocal();
    if (getCloudUrl()) {
      iniciarSyncAutomatico();
      atualizarStatusSync('Sincronização ativa');
      setTimeout(() => sincronizarManual(true), 500);
    } else {
      atualizarStatusSync('Sincronização desligada');
    }
  }

  // Navegação: 5 seções, cada uma com suas telas (ids das páginas "aba-<id>" não mudaram)
  const GRUPOS = [
    {id:'inicio',  abas:[['resumo','Painel']]},
    {id:'vendas',  abas:[['pedido','Fechamentos'],['importar-ifood','Importar iFood']]},
    {id:'precos',  abas:[['calcular','Precificação'],['produtos','Produtos'],['historico','Histórico'],['repasse','Simulações']]},
    {id:'custos',  abas:[['ficha','Fichas Técnicas'],['meusinsumos','Insumos']]},
    {id:'ajustes', abas:[['config','Configurações']]}
  ];
  const ULTIMA_ABA = {};

  function irGrupo(grupoId) {
    const g = GRUPOS.find(x => x.id === grupoId);
    if (g) mudarAba(ULTIMA_ABA[grupoId] || g.abas[0][0]);
  }
  function navTecla(ev, grupoId) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); irGrupo(grupoId); }
  }

  function mudarAba(id) {
    const g = GRUPOS.find(x => x.abas.some(a => a[0] === id));
    const pagina = document.getElementById('aba-' + id);
    if (!g || !pagina) return;
    document.querySelectorAll('.pagina').forEach(p => p.classList.remove('ativo'));
    pagina.classList.add('ativo');
    ULTIMA_ABA[g.id] = id;

    document.querySelectorAll('#nav-grupos .tab').forEach(t => {
      const on = t.dataset.grupo === g.id;
      t.classList.toggle('ativo', on);
      if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
      if (on) t.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });

    const sub = document.getElementById('nav-sub');
    if (g.abas.length > 1) {
      sub.innerHTML = g.abas.map(a =>
        '<div class="subtab' + (a[0] === id ? ' ativo' : '') + '" role="button" tabindex="0"' +
        ' onclick="mudarAba(\'' + a[0] + '\')"' +
        ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();mudarAba(\'' + a[0] + '\')}">' +
        a[1] + '</div>').join('');
      sub.style.display = 'flex';
      const at = sub.querySelector('.ativo');
      if (at) at.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    } else {
      sub.innerHTML = '';
      sub.style.display = 'none';
    }

    if (id === 'produtos') { popularFichasProdutos(); renderProdutosCatalogo(); simularProduto(); }
    if (id === 'historico') renderHistorico();
    if (id === 'resumo') renderResumo();
    if (id === 'ficha') { renderFicha(); renderFichasHist(); }
    if (id === 'repasse') renderRepasseLista();
    if (id === 'meusinsumos') renderMeusInsumos();
    if (id === 'pedido') renderPedidoDia();
  }

  function toggleFrete() {
    const chk = document.getElementById('frete-check');
    const wrap = document.getElementById('frete-wrap');
    if (chk && wrap) wrap.classList.toggle('vis', chk.checked);
  }

  function fmt(v) { return 'R$ ' + Math.abs(v).toFixed(2).replace('.', ','); }
  function fmtSigned(v) { return (v < 0 ? '-' : '') + fmt(v); }
  function pct(v) { return v.toFixed(1).replace('.', ',') + '%'; }

  let ultimoCalculo = null;


  function atualizarPlataforma() {
    const taxa = document.getElementById('taxa');
    const desc = document.getElementById('desconto');
    const labelTaxa = document.getElementById('label-taxa');
    const labelBen = document.getElementById('label-beneficio');
    const ajuda = document.getElementById('ajuda-plataforma');
    taxa.value = '26.2';
    labelTaxa.textContent = 'Taxa iFood (%)';
    labelBen.textContent = 'Valor do benefício iFood (R$)';
    desc.disabled = false;
    ajuda.innerHTML = 'Informe uma única vez o valor do benefício. A calculadora simula automaticamente as duas possibilidades: <b>promoção no produto</b> OU <b>frete grátis pago pela loja</b>. Elas nunca são somadas.';
  }

  function atualizarTipoBeneficio(){
    const tipo=document.getElementById('tipo-beneficio')?.value||'promocao';
    const label=document.getElementById('label-beneficio');
    if(label) label.textContent=tipo==='frete'?'Valor da entrega grátis paga pela loja (R$)':'Valor da promoção no produto (R$)';
  }

  function calcular() {
    const nome = document.getElementById('nome').value.trim() || 'Produto';
    const cat = document.getElementById('categoria').value;
    const preco = parseFloat(document.getElementById('preco').value) || 0;
    const beneficioInformado = parseFloat(document.getElementById('desconto').value) || 0;
    const beneficio = Math.min(preco, Math.max(0, beneficioInformado));
    const custo = parseFloat(document.getElementById('custo').value) || 0;
    const taxa = parseFloat(document.getElementById('taxa').value) || 26.2;
    const plataforma = 'ifood';

    document.getElementById('resultado-ifood').style.display = 'block';

    // Cenários (promoção x frete grátis): a conta vive em calculos.js
    const cenarios_ = Calculos.calcularCenariosIfood(preco, custo, beneficio, taxa / 100);
    const { basePromo, taxaPromo, repassePromo, lucroPromo, taxaFrete, repasseFrete, lucroFrete } = cenarios_;
    const baseFrete = preco;

    // O fechamento principal usa o tipo escolhido pelo usuário.
    // A comparação dos dois cenários continua visível logo abaixo.
    const tipoBeneficio = document.getElementById('tipo-beneficio')?.value || 'promocao';
    const selecionouFrete = tipoBeneficio === 'frete';
    const piorEhFrete = lucroFrete <= lucroPromo;
    const valorCliente = selecionouFrete ? preco : basePromo;
    const valorBaseTaxa = selecionouFrete ? baseFrete : basePromo;
    const valorTaxa = selecionouFrete ? taxaFrete : taxaPromo;
    const repasse = selecionouFrete ? repasseFrete : repassePromo;
    const lucro = selecionouFrete ? lucroFrete : lucroPromo;
    const desconto = selecionouFrete ? 0 : beneficio;
    const fretePago = selecionouFrete && beneficio > 0;
    const freteVal = fretePago ? beneficio : 0;
    const margem = preco > 0 ? (lucro / preco) * 100 : 0;
    const totalDescontos = beneficio + valorTaxa;

    ultimoCalculo = { nome, cat, preco, desconto, beneficio, tipoBeneficio, valorCliente, custo, taxa, baseTaxa: selecionouFrete ? 'preco_cheio' : 'apos_promocao', valorBaseTaxa, fretePago, freteVal, valorTaxa, repasse, lucro, margem, lucroPromo, lucroFrete, piorLucro:Math.min(lucroPromo,lucroFrete), repassePromo, repasseFrete, data: new Date().toLocaleDateString('pt-BR') };

    document.getElementById('res-nome-titulo').textContent = nome;
    document.getElementById('m-preco').textContent = fmt(valorCliente);
    document.getElementById('m-descontos').textContent = '-' + fmt(totalDescontos);
    document.getElementById('m-sub-desc').textContent = (selecionouFrete ? 'Entrega grátis: -' : 'Promoção: -') + fmt(beneficio) + ' | iFood: -' + fmt(valorTaxa);
    document.getElementById('m-repasse').textContent = fmtSigned(repasse);

    // Comparação dos dois cenários
    document.getElementById('cen-promo-lucro').textContent = fmtSigned(lucroPromo);
    document.getElementById('cen-promo-sub').textContent = 'Repasse ' + fmt(repassePromo) + ' · taxa ' + fmt(taxaPromo);
    document.getElementById('cen-frete-lucro').textContent = fmtSigned(lucroFrete);
    document.getElementById('cen-frete-sub').textContent = 'Repasse ' + fmt(repasseFrete) + ' · taxa ' + fmt(taxaFrete);
    const piorEl = document.getElementById('cen-pior-lucro');
    const piorLucro = Math.min(lucroPromo,lucroFrete);
    piorEl.textContent = fmtSigned(piorLucro);
    piorEl.style.color = piorLucro >= 0 ? 'var(--verde-escuro)' : 'var(--vermelho)';

    // Fechamento detalhado do cenário conservador
    document.getElementById('f-preco').textContent = fmt(preco);
    document.getElementById('f-desconto').textContent = '-' + fmt(beneficio);
    document.getElementById('f-cliente').textContent = fmt(valorCliente);
    document.getElementById('f-taxa-pct').textContent = taxa + ' · sobre R$ ' + valorBaseTaxa.toFixed(2).replace('.', ',');
    document.getElementById('f-taxa').textContent = '-' + fmt(valorTaxa);

    const linhaDesconto = document.getElementById('linha-desconto-show');
    linhaDesconto.style.display = (!piorEhFrete && beneficio > 0) ? 'flex' : 'none';
    const linhaFrete = document.getElementById('linha-frete-show');
    if (piorEhFrete && beneficio > 0) {
      linhaFrete.style.display = 'flex';
      document.getElementById('f-frete').textContent = '-' + fmt(beneficio);
    } else {
      linhaFrete.style.display = 'none';
    }

    document.getElementById('f-repasse').textContent = fmtSigned(repasse);
    document.getElementById('f-custo').textContent = '-' + fmt(custo);
    const fl = document.getElementById('f-lucro');
    fl.textContent = fmtSigned(lucro);
    fl.style.color = lucro >= 0 ? 'var(--verde-escuro)' : 'var(--vermelho)';

    const mr = document.getElementById('res-margem');
    mr.textContent = pct(margem);
    mr.style.color = margem >= 20 ? 'var(--verde-escuro)' : margem >= 10 ? '#7A4A00' : 'var(--vermelho)';
    const bf = document.getElementById('barra-fill');
    bf.style.width = Math.max(0, Math.min(100, margem)) + '%';
    bf.style.background = margem >= 20 ? 'var(--verde)' : margem >= 10 ? 'var(--amarelo)' : 'var(--vermelho)';
    document.getElementById('resultado').classList.add('vis');
  }

  function getFicha(){try{return JSON.parse(localStorage.getItem('bomsabor_ficha')||'[]')}catch(e){return[]}}
  function setFicha(f,fromRemote=false){localStorage.setItem('bomsabor_ficha',JSON.stringify(f));if(!fromRemote)marcarAlteracaoLocal()}
  function getFichasHist(){try{return JSON.parse(localStorage.getItem('bomsabor_fichas_hist')||'[]')}catch(e){return[]}}
  function setFichasHist(h,fromRemote=false){localStorage.setItem('bomsabor_fichas_hist',JSON.stringify(h));if(!fromRemote)marcarAlteracaoLocal()}
  let fichaHistEditandoId=null;
  function custoAtualItem(i){
    if(i.origem==='insumo'&&i.refId){const x=getMeusInsumos().find(a=>a.id===i.refId);if(x)return {custo:x.custoPorUnidade||0,un:x.unidade||i.unidade}}
    if(i.origem==='receita'&&i.refId){const r=getFichasHist().find(a=>a.id===i.refId);if(r){const t=custoAtualFichaSalva(r);return {custo:t/Math.max(.000001,Number(r.rendimento)||1),un:r.rendimentoUn||i.unidade}}}
    return {custo:Number(i.custoPorUnidade)||0,un:i.unidade||'un'};
  }
  function custoAtualFichaSalva(f){return (f.itens||[]).reduce((s,i)=>{const a=custoAtualItem(i);return s+a.custo*(Number(i.usado)||0)},0)+(Number(f.embalagem)||0)}
  function popularComponentesFicha(){const el=document.getElementById('ficha-componente');if(!el)return;const ins=getMeusInsumos().map(i=>`<option value="i:${i.id}">${escaparHtmlRelatorio(i.nome)} · ${fmt(i.custoPorUnidade)}/${i.unidade}</option>`);const rec=getFichasHist().filter(f=>f.tipo==='receita'&&f.id!==fichaHistEditandoId).map(f=>{const c=custoAtualFichaSalva(f)/Math.max(.000001,Number(f.rendimento)||1);return `<option value="r:${f.id}">🧪 ${escaparHtmlRelatorio(f.nome)} · ${fmt(c)}/${f.rendimentoUn||'un'}</option>`});el.innerHTML='<option value="">Selecione...</option>'+ins.join('')+(rec.length?'<optgroup label="Receitas / bases">'+rec.join('')+'</optgroup>':'');atualizarComponenteFicha()}
  function atualizarComponenteFicha(){const v=document.getElementById('ficha-componente')?.value||'',q=Number(document.getElementById('ins-usado')?.value)||0,p=document.getElementById('ins-preview');if(!v){if(p)p.textContent='';return}const [t,id0]=v.split(':'),id=Number(id0);let nome='',c=0,u='un';if(t==='i'){const x=getMeusInsumos().find(a=>a.id===id);if(x){nome=x.nome;c=x.custoPorUnidade;u=x.unidade}}else{const r=getFichasHist().find(a=>a.id===id);if(r){nome=r.nome;c=custoAtualFichaSalva(r)/Math.max(.000001,Number(r.rendimento)||1);u=r.rendimentoUn||'un'}}p.innerHTML=`${escaparHtmlRelatorio(nome)}: <strong>${fmt(c)}/${u}</strong>${q>0?` → ${q}${u} = <strong>${fmt(c*q)}</strong>`:''}`}
  function adicionarComponenteFicha(){const v=document.getElementById('ficha-componente').value,q=Number(document.getElementById('ins-usado').value)||0;if(!v||q<=0){alert('Escolha um insumo/receita e informe a quantidade usada.');return}const[t,id0]=v.split(':'),id=Number(id0);let nome='',c=0,u='un';if(t==='i'){const x=getMeusInsumos().find(a=>a.id===id);if(!x)return;nome=x.nome;c=x.custoPorUnidade;u=x.unidade}else{const r=getFichasHist().find(a=>a.id===id);if(!r)return;nome=r.nome;c=custoAtualFichaSalva(r)/Math.max(.000001,Number(r.rendimento)||1);u=r.rendimentoUn||'un'}const f=getFicha();f.push({id:Date.now(),nome,origem:t==='i'?'insumo':'receita',refId:id,unidade:u,usado:q,custoPorUnidade:c,custoNoProduto:c*q});setFicha(f);document.getElementById('ins-usado').value='';renderFicha();atualizarComponenteFicha()}
  function removerInsumo(id){setFicha(getFicha().filter(i=>i.id!==id));renderFicha()}
  function limparFicha(){if(!confirm('Limpar a ficha atual?'))return;setFicha([]);document.getElementById('ficha-nome-produto').value='';document.getElementById('ficha-rendimento').value='1';document.getElementById('ficha-rendimento-un').value='un';fichaHistEditandoId=null;renderFicha();popularComponentesFicha()}
  function getFichaEmbalagem(){return 0} function setFichaEmbalagem(){} function atualizarEmbalagem(){}
  function renderFicha(){const f=getFicha(),body=document.getElementById('ficha-body'),vazio=document.getElementById('ficha-vazio');if(!body)return;if(!f.length){body.innerHTML='';vazio.style.display='block'}else{vazio.style.display='none';body.innerHTML=f.map(i=>{const a=custoAtualItem(i),tot=a.custo*(Number(i.usado)||0);return `<tr><td><strong>${i.origem==='receita'?'🧪 ':''}${escaparHtmlRelatorio(i.nome)}</strong></td><td>${fmt(a.custo)}/${a.un}</td><td>${i.usado} ${a.un}</td><td><strong>${fmt(tot)}</strong></td><td><button class="btn btn-perigo" style="padding:4px 10px;font-size:12px" onclick="removerInsumo(${i.id})">✕</button></td></tr>`}).join('')}const total=f.reduce((s,i)=>{const a=custoAtualItem(i);return s+a.custo*(Number(i.usado)||0)},0),rend=Math.max(.000001,Number(document.getElementById('ficha-rendimento')?.value)||1),un=document.getElementById('ficha-rendimento-un')?.value||'un';document.getElementById('ficha-subtotal').textContent=fmt(total);document.getElementById('ficha-total').textContent=fmt(total);document.getElementById('ficha-custo-rendimento').textContent=fmt(total/rend)+' / '+un}
  function enviarParaCalcular(){const f=getFicha();if(!f.length){alert('Adicione componentes à ficha.');return}const total=f.reduce((s,i)=>{const a=custoAtualItem(i);return s+a.custo*(Number(i.usado)||0)},0),rend=Math.max(.000001,Number(document.getElementById('ficha-rendimento').value)||1),tipo=document.getElementById('ficha-tipo').value,nome=document.getElementById('ficha-nome-produto').value.trim();document.getElementById('custo').value=(tipo==='produto'?total:total/rend).toFixed(2);if(nome)document.getElementById('nome').value=nome;mudarAba('calcular')}
  function salvarFicha(){const f=getFicha(),nome=document.getElementById('ficha-nome-produto').value.trim();if(!nome||!f.length){alert('Informe o nome e adicione pelo menos um componente.');return}const h=getFichasHist(),tipo=document.getElementById('ficha-tipo').value,rendimento=Math.max(.000001,Number(document.getElementById('ficha-rendimento').value)||1),rendimentoUn=document.getElementById('ficha-rendimento-un').value,total=f.reduce((s,i)=>{const a=custoAtualItem(i);return s+a.custo*(Number(i.usado)||0)},0),obj={nome,tipo,rendimento,rendimentoUn,itens:f,total,totalOriginal:total,data:new Date().toLocaleDateString('pt-BR')};if(fichaHistEditandoId!==null){const x=h.find(a=>a.id===fichaHistEditandoId);if(x)Object.assign(x,obj)}else h.unshift({id:Date.now(),...obj});setFichasHist(h);fichaHistEditandoId=null;renderFichasHist();popularComponentesFicha();alert('Ficha salva!')}
  function carregarFicha(id){const x=getFichasHist().find(a=>a.id===id);if(!x)return;setFicha(JSON.parse(JSON.stringify(x.itens||[])));document.getElementById('ficha-nome-produto').value=x.nome;document.getElementById('ficha-tipo').value=x.tipo||'produto';document.getElementById('ficha-rendimento').value=x.rendimento||1;document.getElementById('ficha-rendimento-un').value=x.rendimentoUn||'un';renderFicha();window.scrollTo({top:0,behavior:'smooth'})}
  function verDetalhesFicha(id){const x=getFichasHist().find(a=>a.id===id);if(!x)return;const atual=custoAtualFichaSalva(x),rend=Math.max(.000001,Number(x.rendimento)||1),un=x.rendimentoUn||'un';document.getElementById('det-ficha-tipo').textContent=x.tipo==='receita'?'🧪 RECEITA / BASE':'🍧 PRODUTO FINAL';document.getElementById('det-ficha-nome').textContent=x.nome;document.getElementById('det-ficha-resumo').innerHTML=`<div class="resultado-card"><div class="resultado-label">Rendimento</div><div class="resultado-valor">${x.rendimento||1} ${un}</div></div><div class="resultado-card"><div class="resultado-label">Custo atual</div><div class="resultado-valor">${fmt(atual)}</div></div><div class="resultado-card"><div class="resultado-label">Custo por ${un}</div><div class="resultado-valor">${fmt(atual/rend)}</div></div>`;const itens=x.itens||[];document.getElementById('det-ficha-itens').innerHTML=itens.length?itens.map(i=>{const a=custoAtualItem(i),tot=a.custo*(Number(i.usado)||0),orig=i.origem==='receita'?'🧪 Receita/base':'📦 Insumo';return `<tr><td><strong>${escaparHtmlRelatorio(i.nome)}</strong></td><td>${orig}</td><td>${Number(i.usado)||0} ${a.un}</td><td>${fmt(a.custo)}/${a.un}</td><td><strong>${fmt(tot)}</strong></td></tr>`}).join(''):`<tr><td colspan="5" style="text-align:center;color:var(--cinza-texto)">Esta ficha não possui componentes salvos.</td></tr>`;document.getElementById('det-ficha-total').innerHTML=`<div class="linha-fechamento"><span>Custo total atual</span><strong>${fmt(atual)}</strong></div><div class="linha-fechamento"><span>Custo por ${un}</span><strong>${fmt(atual/rend)}</strong></div>`;document.getElementById('det-ficha-editar').onclick=()=>{fecharDetalhesFicha();editarFichaHist(id)};document.getElementById('det-ficha-duplicar').onclick=()=>{duplicarFicha(id);fecharDetalhesFicha()};document.getElementById('modal-ficha-detalhes-overlay').style.display='flex';document.body.style.overflow='hidden'}
  function fecharDetalhesFicha(){document.getElementById('modal-ficha-detalhes-overlay').style.display='none';document.body.style.overflow=''}
  function editarFichaHist(id){carregarFicha(id);fichaHistEditandoId=id;document.getElementById('ficha-btn-salvar').textContent='Salvar alteração';document.getElementById('ficha-btn-cancelar').style.display='inline-block';popularComponentesFicha()}
  function cancelarEdicaoFicha(){fichaHistEditandoId=null;document.getElementById('ficha-btn-salvar').textContent='Salvar ficha';document.getElementById('ficha-btn-cancelar').style.display='none';popularComponentesFicha()}
  function duplicarFicha(id){const x=getFichasHist().find(a=>a.id===id);if(!x)return;const h=getFichasHist();h.unshift({...JSON.parse(JSON.stringify(x)),id:Date.now(),nome:x.nome+' (cópia)',data:new Date().toLocaleDateString('pt-BR')});setFichasHist(h);renderFichasHist();popularComponentesFicha()}
  function removerFichaHist(id){setFichasHist(getFichasHist().filter(a=>a.id!==id));renderFichasHist();popularComponentesFicha()}
  function limparFichasHist(){if(!confirm('Remover todas as fichas salvas?'))return;setFichasHist([]);renderFichasHist();popularComponentesFicha()}
  function renderFichasHist(){const h=getFichasHist(),body=document.getElementById('fichas-hist-body'),v=document.getElementById('fichas-hist-vazio');if(!body)return;if(!h.length){body.innerHTML='';v.style.display='block';return}v.style.display='none';body.innerHTML=h.map(x=>{const atual=custoAtualFichaSalva(x),ant=Number(x.totalOriginal??x.total)||atual,delta=ant?((atual-ant)/ant*100):0,alerta=Math.abs(delta)>=1?`<div style="font-size:11px;color:${delta>0?'#a65b00':'var(--verde-escuro)'}">${delta>0?'↑':'↓'} ${Math.abs(delta).toFixed(1)}% desde que salvou</div>`:'';return `<tr><td><strong>${escaparHtmlRelatorio(x.nome)}</strong></td><td>${x.tipo==='receita'?'🧪 Receita/base':'🍧 Produto final'}</td><td>${x.rendimento||1} ${x.rendimentoUn||'un'}<div style="font-size:11px;color:var(--cinza-texto)">${fmt(atual/Math.max(.000001,Number(x.rendimento)||1))}/${x.rendimentoUn||'un'}</div></td><td><strong>${fmt(atual)}</strong>${alerta}</td><td style="white-space:nowrap"><button class="btn btn-secundario" style="padding:4px 8px;font-size:12px" onclick="verDetalhesFicha(${x.id})">Ver detalhes</button> <button class="btn btn-secundario" style="padding:4px 8px;font-size:12px" onclick="editarFichaHist(${x.id})">Editar</button> <button class="btn btn-secundario" style="padding:4px 8px;font-size:12px" onclick="duplicarFicha(${x.id})">Duplicar</button> <button class="btn btn-perigo" style="padding:4px 8px;font-size:12px" onclick="removerFichaHist(${x.id})">✕</button></td></tr>`}).join('')}

  // ---- MEUS INSUMOS (base de custos) ----
  function getMeusInsumos() { try { return JSON.parse(localStorage.getItem('bomsabor_meus_insumos') || '[]'); } catch(e) { return []; } }
  function setMeusInsumos(l, fromRemote = false) { localStorage.setItem('bomsabor_meus_insumos', JSON.stringify(l)); if (!fromRemote) marcarAlteracaoLocal(); }
  let miEditandoId = null;
  // Conversão das unidades de compra para a unidade-base usada nos cálculos.
  // kg -> g e L -> ml. Mantém a unidade de compra original para exibição/edição.
  function fatorConversao(unidade) {
    const u=String(unidade||'').toLowerCase();
    if(u==='kg' || u==='l') return 1000;
    return 1;
  }
  function unidadeBase(unidade) {
    const u=String(unidade||'').toLowerCase();
    if(u==='kg') return 'g';
    if(u==='l') return 'ml';
    return u || 'un';
  }
  function miDadosCalculo() {
    const unidadeCompra=document.getElementById('mi-unidade').value, fator=fatorConversao(unidadeCompra), uBase=unidadeBase(unidadeCompra);
    const preco=parseFloat(document.getElementById('mi-preco').value)||0, qtd=parseFloat(document.getElementById('mi-embalagem').value)||0;
    const aproveitamento=Math.max(1,Math.min(100,parseFloat(document.getElementById('mi-aproveitamento').value)||100));
    const qtdBase=qtd*fator, qtdUtil=qtdBase*(aproveitamento/100), custo=Calculos.custoInsumoPorUnidade(preco,qtd,unidadeCompra,aproveitamento);
    return {unidadeCompra,fator,uBase,preco,qtd,aproveitamento,qtdBase,qtdUtil,custo};
  }
  function atualizarPreviewMeuInsumo() {
    const d=miDadosCalculo(), el=document.getElementById('mi-preview');
    if(d.preco>0&&d.qtdBase>0){ el.innerHTML=`Você comprou <strong>${d.qtd} ${d.unidadeCompra}</strong> por <strong>${fmt(d.preco)}</strong>. Quantidade aproveitável: <strong>${Number(d.qtdUtil.toFixed(2))} ${d.uBase}</strong>. Custo real: <strong>${fmt(d.custo)}/${d.uBase}</strong>.`; } else el.textContent='Preencha o valor pago e quanto veio para ver o custo real automaticamente.';
  }
  function limparFormMeuInsumo(){ ['mi-nome','mi-preco','mi-embalagem','mi-loja'].forEach(id=>document.getElementById(id).value=''); document.getElementById('mi-unidade').value='g'; document.getElementById('mi-categoria').value='Frutas'; document.getElementById('mi-aproveitamento').value='100'; atualizarPreviewMeuInsumo(); }
  function salvarMeuInsumo(){
    const nome=document.getElementById('mi-nome').value.trim(), categoria=document.getElementById('mi-categoria').value, loja=document.getElementById('mi-loja').value.trim(), d=miDadosCalculo();
    if(!nome||d.preco<=0||d.qtd<=0){alert('Preencha o nome, quanto você pagou e quanto veio.');return;}
    const l=getMeusInsumos(), agora=new Date(), iso=agora.toISOString(), hoje=agora.toLocaleDateString('pt-BR');
    if(miEditandoId!==null){ const item=l.find(i=>i.id===miEditandoId); if(item){ const mudou=Math.abs((item.preco||0)-d.preco)>0.0001; const hist=Array.isArray(item.historicoPrecos)?item.historicoPrecos:[]; if(mudou&&item.preco) hist.unshift({preco:item.preco,data:item.data||''}); Object.assign(item,{nome,categoria,unidade:d.uBase,preco:d.preco,embalagem:d.qtdBase,embalagemCompra:d.qtd,unidadeCompra:d.unidadeCompra,loja,aproveitamento:d.aproveitamento,custoPorUnidade:d.custo,data:hoje,updatedAt:iso,historicoPrecos:hist.slice(0,10)}); }}
    else l.unshift({id:Date.now(),nome,categoria,unidade:d.uBase,preco:d.preco,embalagem:d.qtdBase,embalagemCompra:d.qtd,unidadeCompra:d.unidadeCompra,loja,aproveitamento:d.aproveitamento,custoPorUnidade:d.custo,data:hoje,updatedAt:iso,historicoPrecos:[]});
    setMeusInsumos(l); cancelarEdicaoMeuInsumo(); renderMeusInsumos();
  }
  function editarMeuInsumo(id){ const i=getMeusInsumos().find(x=>x.id===id); if(!i)return; miEditandoId=id; document.getElementById('mi-nome').value=i.nome; document.getElementById('mi-categoria').value=i.categoria||'Outros'; document.getElementById('mi-unidade').value=i.unidadeCompra||i.unidade; document.getElementById('mi-preco').value=i.preco; document.getElementById('mi-embalagem').value=i.embalagemCompra??i.embalagem; document.getElementById('mi-aproveitamento').value=i.aproveitamento||100; document.getElementById('mi-loja').value=i.loja||''; atualizarPreviewMeuInsumo(); document.getElementById('mi-form-titulo').textContent='Editar insumo'; document.getElementById('mi-btn-salvar').textContent='Salvar alteração'; document.getElementById('mi-btn-cancelar').style.display='inline-block'; window.scrollTo({top:0,behavior:'smooth'}); }
  function cancelarEdicaoMeuInsumo(){ miEditandoId=null; limparFormMeuInsumo(); document.getElementById('mi-form-titulo').textContent='Adicionar insumo'; document.getElementById('mi-btn-salvar').textContent='Adicionar insumo'; document.getElementById('mi-btn-cancelar').style.display='none'; }
  function removerMeuInsumo(id){setMeusInsumos(getMeusInsumos().filter(i=>i.id!==id));if(miEditandoId===id)cancelarEdicaoMeuInsumo();renderMeusInsumos();}
  function limparMeusInsumos(){if(!confirm('Remover todos os insumos cadastrados?'))return;setMeusInsumos([]);cancelarEdicaoMeuInsumo();renderMeusInsumos();}
  function renderLojaCell(loja){if(!loja)return '';const v=loja.trim();if(/^https?:\/\//i.test(v))return `<a href="${v.replace(/"/g,'&quot;')}" target="_blank" rel="noopener noreferrer" style="color:var(--verde-escuro);text-decoration:underline">Fornecedor</a>`;return escaparHtmlRelatorio(v);}
  function usosDoInsumo(nome){ const n=normalizarTexto(nome); const nomes=new Set(); try{getFichasHist().forEach(f=>(f.itens||[]).forEach(i=>{if(normalizarTexto(i.nome)===n)nomes.add(f.nome)}));}catch(e){} return nomes.size; }
  function diasDesde(item){ const t=item.updatedAt?new Date(item.updatedAt):null; if(!t||isNaN(t))return null; return Math.floor((Date.now()-t.getTime())/86400000); }
  function renderMeusInsumos(){
    let l=getMeusInsumos(), body=document.getElementById('mi-body'), vazio=document.getElementById('mi-vazio'); if(!l.length){body.innerHTML='';vazio.textContent='Nenhum insumo cadastrado ainda.';vazio.style.display='block';return;}
    const busca=normalizarTexto(document.getElementById('mi-busca')?.value||''), cat=document.getElementById('mi-filtro-cat')?.value||'', ordem=document.getElementById('mi-ordem')?.value||'recente';
    l=l.filter(i=>(!busca||normalizarTexto(i.nome).includes(busca))&&(!cat||(i.categoria||'Outros')===cat));
    if(ordem==='nome')l.sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR')); else if(ordem==='custo')l.sort((a,b)=>(b.custoPorUnidade||0)-(a.custoPorUnidade||0)); else l.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
    if(!l.length){body.innerHTML='';vazio.textContent='Nenhum insumo encontrado.';vazio.style.display='block';return;} vazio.style.display='none';
    body.innerHTML=l.map(i=>{ const ap=i.aproveitamento||100, usos=usosDoInsumo(i.nome), dias=diasDesde(i), antigo=Array.isArray(i.historicoPrecos)&&i.historicoPrecos[0]?i.historicoPrecos[0].preco:null, variacao=antigo?((i.preco-antigo)/antigo*100):null; const alerta=dias!==null&&dias>=90?`<div style="font-size:11px;color:#a65b00">⚠ há ${dias} dias</div>`:''; const varTxt=variacao===null?'':`<div style="font-size:11px;color:var(--cinza-texto)">${variacao>=0?'↑':'↓'} ${Math.abs(variacao).toFixed(1)}% vs. preço anterior</div>`; return `<tr><td><strong>${escaparHtmlRelatorio(i.nome)}</strong><div style="font-size:11px;color:var(--cinza-texto)">${escaparHtmlRelatorio(i.categoria||'Outros')} ${renderLojaCell(i.loja)?'· '+renderLojaCell(i.loja):''}</div></td><td>${fmt(i.preco)}<div style="font-size:11px;color:var(--cinza-texto)">${i.embalagemCompra??i.embalagem} ${i.unidadeCompra||i.unidade}</div>${varTxt}</td><td>${ap}%</td><td><strong>${fmt(i.custoPorUnidade)}/${i.unidade}</strong></td><td>${usos?`Usado em <strong>${usos}</strong> produto${usos>1?'s':''}`:'Ainda não usado'}</td><td><span style="font-size:12px;color:var(--cinza-texto)">${i.data||'—'}</span>${alerta}</td><td style="white-space:nowrap"><button class="btn btn-secundario" style="padding:4px 10px;font-size:12px" onclick="editarMeuInsumo(${i.id})">Editar</button> <button class="btn btn-perigo" style="padding:4px 10px;font-size:12px" onclick="removerMeuInsumo(${i.id})">✕</button></td></tr>`; }).join('');
  }

  function salvarProduto() {
    if (!ultimoCalculo) return;
    const h = getHistorico();
    h.unshift({ ...ultimoCalculo, id: Date.now() });
    setHistorico(h);
    alert('Produto salvo no histórico!');
    renderHistorico();
    renderResumo();
  }

  function limparFormulario() {
    document.getElementById('nome').value = '';
    document.getElementById('preco').value = '';
    document.getElementById('desconto').value = '';
    document.getElementById('custo').value = '';
    document.getElementById('resultado').classList.remove('vis');
    ultimoCalculo = null;
  }

  const CATEGORIAS = ['Açaí', 'Salada de Frutas', 'Picolé Gourmet', 'Combo', 'Outro'];

  function selectCategoria(id, catAtual) {
    const opcoes = CATEGORIAS.includes(catAtual) ? CATEGORIAS : [catAtual, ...CATEGORIAS];
    const options = opcoes.map(c => `<option value="${c}" ${c === catAtual ? 'selected' : ''}>${c}</option>`).join('');
    return `<select onchange="editarCategoria(${id}, this.value)" style="padding:5px 8px;border:1px solid var(--cinza-borda);border-radius:6px;font-size:13px;font-family:var(--fonte);background:#fff;color:var(--preto)">${options}</select>`;
  }

  function editarCategoria(id, novaCat) {
    const h = getHistorico();
    const item = h.find(p => p.id === id);
    if (!item) return;
    item.cat = novaCat;
    setHistorico(h);
    renderResumo();
  }

  function renderHistorico() {
    const h = getHistorico();
    const body = document.getElementById('hist-body');
    const vazio = document.getElementById('hist-vazio');
    if (h.length === 0) {
      body.innerHTML = '';
      vazio.textContent = 'Nenhum produto salvo ainda.';
      vazio.style.display = 'block';
      sincronizarScrollTopo();
      return;
    }
    const busca = normalizarTexto(document.getElementById('hist-busca')?.value || '');
    const filtrados = busca ? h.filter(p => normalizarTexto(p.nome).includes(busca)) : h;

    if (filtrados.length === 0) {
      body.innerHTML = '';
      vazio.textContent = 'Nenhum produto encontrado para "' + (document.getElementById('hist-busca')?.value || '') + '".';
      vazio.style.display = 'block';
      sincronizarScrollTopo();
      return;
    }
    vazio.style.display = 'none';
    body.innerHTML = filtrados.map(p => {
      const cls = p.margem >= 20 ? 'verde' : p.margem >= 10 ? 'amarelo' : 'vermelho';
      const desconto = p.desconto || 0;
      const valorCliente = p.valorCliente ?? Math.max(0, p.preco - desconto);
      return `<tr>
        <td><strong>${escaparHtmlRelatorio(p.nome)}</strong><br><span style="font-size:11px;color:var(--cinza-texto)">${p.data}</span></td>
        <td>${selectCategoria(p.id, p.cat)}</td>
        <td>${fmt(p.preco)}</td>
        <td>${fmt(desconto)}</td>
        <td>${fmt(valorCliente)}</td>
        <td>${fmt(p.custo)}</td>
        <td>${p.taxa}%</td>
        <td>${fmtSigned(p.repasse)}</td>
        <td style="color:${p.lucro >= 0 ? 'var(--verde-escuro)' : 'var(--vermelho)'};font-weight:600">${fmtSigned(p.lucro)}</td>
        <td><span class="badge ${cls}">${pct(p.margem)}</span></td>
        <td>
          <button class="btn btn-secundario" style="padding:4px 10px;font-size:12px;width:auto;margin-top:0" onclick="atualizarCalculoHistorico(${p.id})" title="Recalcular este produto com os dados salvos">&#8635;</button>
          <button class="btn btn-perigo" style="padding:4px 10px;font-size:12px" onclick="remover(${p.id})">✕</button>
        </td>
      </tr>`;
    }).join('');
    sincronizarScrollTopo();
  }

  // Cria uma barra de rolagem horizontal duplicada, em cima da tabela do
  // histórico, sincronizada com a rolagem de baixo (a tabela pode ficar
  // larga e o usuário não precisa descer até o final pra rolar pros lados).
  let scrollTopoLigado = false;
  function sincronizarScrollTopo() {
    const topo = document.getElementById('hist-scroll-topo');
    const topoInner = document.getElementById('hist-scroll-topo-inner');
    const wrap = document.getElementById('hist-tabela-wrap');
    const tabela = document.getElementById('tabela-hist');
    if (!topo || !topoInner || !wrap || !tabela) return;

    topoInner.style.width = tabela.scrollWidth + 'px';

    if (!scrollTopoLigado) {
      scrollTopoLigado = true;
      topo.addEventListener('scroll', () => { wrap.scrollLeft = topo.scrollLeft; });
      wrap.addEventListener('scroll', () => { topo.scrollLeft = wrap.scrollLeft; });
      window.addEventListener('resize', () => {
        if (document.getElementById('tabela-hist')) topoInner.style.width = tabela.scrollWidth + 'px';
      });
    }
  }

  // Recalcula repasse/lucro/margem de um item do histórico usando os
  // mesmos dados salvos (preço, desconto, custo, taxa, frete) — útil
  // quando a fórmula de cálculo do app é atualizada.
  function atualizarCalculoHistorico(id) {
    const h = getHistorico();
    const item = h.find(p => p.id === id);
    if (!item) return;

    const preco = item.preco || 0;
    const desconto = Math.min(preco, Math.max(0, item.desconto || 0));
    const custo = item.custo || 0;
    const taxa = item.taxa || 0;
    const freteVal = item.fretePago ? (item.freteVal || 0) : 0;

    const baseTaxa = 'apos_promocao';
    const { valorCliente, valorBaseTaxa, valorTaxa, repasse, lucro, margem } = calcularNumerosItemPedido(preco, desconto, custo, taxa, freteVal);

    Object.assign(item, { desconto, valorCliente, baseTaxa, valorBaseTaxa, valorTaxa, repasse, lucro, margem });
    setHistorico(h);
    renderHistorico();
    renderResumo();
  }

  function remover(id) {
    const h = getHistorico().filter(p => p.id !== id);
    setHistorico(h);
    renderHistorico();
    renderResumo();
  }

  function limparHistorico() {
    if (!confirm('Remover todos os produtos do histórico?')) return;
    setHistorico([]);
    renderHistorico();
    renderResumo();
  }

  function renderResumo() {
    const arr=getProdutosCatalogo(), fichas=getFichasHist();
    const body=document.getElementById('resumo-body'), vazio=document.getElementById('resumo-vazio');
    if(!body)return;
    const rows=arr.map(p=>{const f=fichas.find(x=>Number(x.id)===Number(p.fichaId));const custo=f?fichaCustoAtual(f):(Number(p.custoManual)||0);const c=calcProdutoCenarios(p.precoIfood||0,custo,p.beneficio||0);const meta=Number(p.meta)||0,metaTipo=p.metaTipo||'valor';const snap=Number(p.custoSnapshot);const delta=Number.isFinite(snap)?custo-snap:0;const atendeI=metaTipo==='margem'?(p.precoIfood>0&&c.lucroI/p.precoIfood*100>=meta):c.lucroI>=meta;const revisar=(p.precoIfood&&!atendeI);return {p,f,custo,c,meta,metaTipo,delta,revisar};});
    document.getElementById('res-total').textContent=rows.length;
    const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
    const custos=rows.map(r=>r.custo), li=rows.filter(r=>r.p.precoIfood).map(r=>r.c.lucroI);
    document.getElementById('res-custo').textContent=custos.length?fmt(avg(custos)):'—';document.getElementById('res-ifood').textContent=li.length?fmtSigned(avg(li)):'—';
    const revisar=rows.filter(r=>r.revisar).length, aumentos=rows.filter(r=>r.delta>.009).length;
    document.getElementById('res-impacto').innerHTML=`<div style="padding:12px 14px;border:1px solid var(--cinza-borda);border-radius:10px;background:#fafafa"><strong>Resumo de impacto:</strong> ${revisar} produto${revisar===1?'':'s'} precisa${revisar===1?'':'m'} revisar preço · ${aumentos} com aumento de custo detectado.</div>`;
    const filtro=document.getElementById('res-filtro')?.value||'todos';let vis=rows.filter(r=>filtro==='todos'||(filtro==='revisar'&&r.revisar)||(filtro==='custo'&&r.delta>.009)||(filtro==='ifood'&&r.p.precoIfood));
    vazio.style.display=vis.length?'none':'block';
    body.innerHTML=vis.map(r=>{const st=r.revisar?'Revisar preço':r.delta>.009?'Custo aumentou':'OK';const cls=r.revisar?'vermelho':r.delta>.009?'amarelo':'verde';return `<tr><td><strong>${escaparHtmlRelatorio(r.p.nome)}</strong>${r.delta>.009?`<div style="font-size:11px;color:#a65b00">↑ custo ${fmt(r.delta)}</div>`:''}</td><td>${fmt(r.custo)}</td><td>${r.p.precoIfood?fmt(r.p.precoIfood):'—'}</td><td style="font-weight:600">${r.p.precoIfood?fmtSigned(r.c.lucroI):'—'}</td><td>${r.metaTipo==='margem'?r.meta.toFixed(1).replace('.',',')+'%':fmt(r.meta)}</td><td><span class="badge ${cls}">${st}</span></td></tr>`}).join('');
    const mud=rows.filter(r=>Math.abs(r.delta)>.009);document.getElementById('res-mudancas').innerHTML=mud.length?mud.map(r=>`<div style="padding:9px 0;border-bottom:1px solid var(--cinza-borda)"><strong>${escaparHtmlRelatorio(r.p.nome)}</strong>: custo ${r.delta>0?'subiu':'caiu'} ${fmt(Math.abs(r.delta))}${r.p.precoIfood?` · lucro iFood atual ${fmtSigned(r.c.lucroI)}`:''}</div>`).join(''):'Nenhuma alteração de custo detectada desde o último salvamento dos produtos.';
    let rank=[];rows.forEach(r=>{if(r.p.precoIfood)rank.push({n:r.p.nome,pl:'iFood',l:r.c.lucroI,m:r.p.precoIfood?r.c.lucroI/r.p.precoIfood*100:0});});rank.sort((a,b)=>b.l-a.l);document.getElementById('res-ranking').innerHTML=rank.slice(0,10).map((x,i)=>`<tr><td>${i+1}</td><td><strong>${escaparHtmlRelatorio(x.n)}</strong></td><td>${x.pl}</td><td>${fmtSigned(x.l)}</td><td>${pct(x.m)}</td></tr>`).join('')||'<tr><td colspan="5">Cadastre preços nos Produtos para montar o ranking.</td></tr>';
  }

  // ---- PEDIDO DO DIA (vendas reais por dia, agrupadas por mês/ano, com relatório) ----
  function hojeISO() {
    const d = new Date();
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tz).toISOString().slice(0, 10);
  }
  function formatarDataBR(iso) {
    if (!iso) return '';
    const [a, m, d] = iso.split('-');
    return (d && m && a) ? `${d}/${m}/${a}` : iso;
  }
  // Chave de agrupamento "AAAA-MM" a partir de uma data "AAAA-MM-DD".
  function chaveMes(iso) { return (iso || '').slice(0, 7); }
  function nomeMesAno(chave) {
    const [ano, mes] = (chave || '').split('-');
    if (!ano || !mes) return chave || '';
    const nomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const idx = parseInt(mes, 10) - 1;
    return (nomes[idx] || mes) + ' de ' + ano;
  }
  function escaparHtmlRelatorio(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function formatarNumeroRelatorio(v) { return (Number(v) || 0).toFixed(2).replace('.', ','); }

  function getPedidoPctDespesas() {
    const v = parseFloat(localStorage.getItem('bomsabor_pedido_pct_despesas'));
    return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 50;
  }
  function setPedidoPctDespesas(v, fromRemote = false) {
    const n = Math.min(100, Math.max(0, parseFloat(v) || 0));
    localStorage.setItem('bomsabor_pedido_pct_despesas', String(n));
    if (!fromRemote) marcarAlteracaoLocal();
  }
  function salvarPctDespesasPedido(valor) {
    setPedidoPctDespesas(valor);
    renderPedidoItens();
  }

  function getPedidoAtual() {
    try {
      const p = JSON.parse(localStorage.getItem('bomsabor_pedido_atual') || 'null');
      if (p && Array.isArray(p.itens)) return p;
    } catch (e) {}
    return { data: hojeISO(), itens: [] };
  }
  function setPedidoAtual(p, fromRemote = false) {
    localStorage.setItem('bomsabor_pedido_atual', JSON.stringify(p));
    if (!fromRemote) marcarAlteracaoLocal();
  }
  function getFechamentos() {
    try { return JSON.parse(localStorage.getItem('bomsabor_fechamentos') || '[]'); } catch (e) { return []; }
  }
  function setFechamentos(f, fromRemote = false) {
    localStorage.setItem('bomsabor_fechamentos', JSON.stringify(f));
    if (!fromRemote) marcarAlteracaoLocal();
  }

  function renderPedidoBusca() {
    const campo = document.getElementById('ped-busca');
    const box = document.getElementById('ped-busca-resultado');
    if (!campo || !box) return;
    const busca = normalizarTexto(campo.value);
    const lista = getHistorico();
    const resultados = busca ? lista.filter(p => normalizarTexto(p.nome).includes(busca)) : lista;
    if (resultados.length === 0) {
      box.innerHTML = `<div style="padding:12px;font-size:13px;color:var(--cinza-texto)">${lista.length === 0 ? 'Nenhum produto salvo no Histórico ainda.' : 'Nenhum produto encontrado.'}</div>`;
      box.style.display = 'block';
      return;
    }
    box.innerHTML = resultados.slice(0, 8).map(p => `
      <div onclick="adicionarProdutoPedido(${p.id})" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--cinza-borda);font-size:14px" onmousedown="event.preventDefault()">
        <strong>${escaparHtmlRelatorio(p.nome)}</strong>
        <div style="font-size:12px;color:var(--cinza-texto)">${fmt(p.preco)} · margem ${pct(Number(p.margem)||0)}</div>
      </div>`).join('');
    box.style.display = 'block';
  }
  function fecharBuscaPedido() {
    const box = document.getElementById('ped-busca-resultado');
    if (box) box.style.display = 'none';
  }

  // ---- DESFAZER ÚLTIMA AÇÃO (Pedido do dia): guarda uma foto do estado antes da ação
  // e permite voltar a ela por alguns segundos através de um aviso na tela. ----
  let undoSnapshot = null;
  let undoTimer = null;
  function capturarUndo() {
    undoSnapshot = coletarSnapshot();
    clearTimeout(undoTimer);
    const toast = document.getElementById('undo-toast');
    if (toast) toast.style.display = 'flex';
    undoTimer = setTimeout(() => {
      if (toast) toast.style.display = 'none';
      undoSnapshot = null;
    }, 8000);
  }
  function desfazerUltimaAcao() {
    if (!undoSnapshot) return;
    clearTimeout(undoTimer);
    // Carimba com a hora atual para essa reversão "vencer" na próxima sincronização.
    aplicarSnapshot(undoSnapshot, Date.now(), false);
    undoSnapshot = null;
    const toast = document.getElementById('undo-toast');
    if (toast) toast.style.display = 'none';
    if (getCloudUrl()) sincronizarManual();
  }

  // Mesma fórmula usada no Histórico (calcular / atualizarCalculoHistorico), reaproveitada
  // aqui pra todo item do Pedido do dia sempre refletir o repasse líquido de verdade
  // (depois de comissão do iFood, frete e desconto da loja) — não só preço menos custo.
  function calcularNumerosItemPedido(preco, desconto, custo, taxa, freteVal) {
    return Calculos.calcularNumerosItemPedido(preco, desconto, custo, taxa, freteVal);
  }

  function adicionarProdutoPedido(produtoId) {
    capturarUndo();
    const produto = getHistorico().find(p => p.id === produtoId);
    if (!produto) return;
    const semDesconto = document.getElementById('ped-sem-desconto').checked;
    const ped = getPedidoAtual();
    const preco = Number(produto.preco) || 0;
    const custo = Number(produto.custo) || 0;
    const taxa = Number(produto.taxa) || 0;
    const freteVal = produto.fretePago ? (Number(produto.freteVal) || 0) : 0;
    const desconto = semDesconto ? 0 : (Number(produto.desconto) || 0);
    const { valorCliente, repasse, lucro, margem } = calcularNumerosItemPedido(preco, desconto, custo, taxa, freteVal);
    const existente = ped.itens.find(i =>
      i.nome === produto.nome && (Number(i.preco) || 0) === preco && (Number(i.desconto) || 0) === desconto);
    if (existente) {
      existente.qtd = (Number(existente.qtd) || 0) + 1;
    } else {
      ped.itens.push({
        nome: produto.nome,
        preco, desconto, custo, taxa, freteVal,
        valorCliente, repasse, lucro, margem,
        qtd: 1
      });
    }
    setPedidoAtual(ped);
    document.getElementById('ped-busca').value = '';
    document.getElementById('ped-sem-desconto').checked = false;
    fecharBuscaPedido();
    renderPedidoItens();
  }
  function alterarQtdPedido(idx, delta) {
    capturarUndo();
    const ped = getPedidoAtual();
    const item = ped.itens[idx];
    if (!item) return;
    item.qtd = Math.max(1, (Number(item.qtd) || 0) + delta);
    setPedidoAtual(ped);
    renderPedidoItens();
  }
  function definirQtdPedido(idx, valor) {
    capturarUndo();
    const ped = getPedidoAtual();
    const item = ped.itens[idx];
    if (!item) return;
    item.qtd = Math.max(1, parseInt(valor, 10) || 1);
    setPedidoAtual(ped);
    renderPedidoItens();
  }
  // ---- EDITAR ITEM JÁ LANÇADO (nome, preço e custo daquela venda específica) ----
  function abrirModalEditarItemPedido(idx) {
    const ped = getPedidoAtual();
    const item = ped.itens[idx];
    if (!item) return;
    document.getElementById('edit-item-idx').value = idx;
    document.getElementById('edit-item-nome').value = item.nome;
    document.getElementById('edit-item-preco').value = item.preco;
    document.getElementById('edit-item-custo').value = item.custo;
    recalcularPreviaEdicaoItem();
    document.getElementById('modal-editar-item-overlay').style.display = 'flex';
  }
  function fecharModalEditarItemPedido() {
    document.getElementById('modal-editar-item-overlay').style.display = 'none';
  }
  function recalcularPreviaEdicaoItem() {
    const idx = parseInt(document.getElementById('edit-item-idx').value, 10);
    const ped = getPedidoAtual();
    const item = ped.itens[idx];
    const preco = parseFloat(document.getElementById('edit-item-preco').value) || 0;
    const custo = parseFloat(document.getElementById('edit-item-custo').value) || 0;
    const desconto = item ? (Number(item.desconto) || 0) : 0;
    const taxa = item ? (Number(item.taxa) || Number(getConfig().taxa) || 26.2) : 26.2;
    const freteVal = item ? (Number(item.freteVal) || 0) : 0;
    const { lucro, margem } = calcularNumerosItemPedido(preco, desconto, custo, taxa, freteVal);
    let extra = '';
    if (desconto > 0 || taxa > 0 || freteVal > 0) {
      extra = ` (após desconto de ${fmt(desconto)}, comissão de ${taxa}% e frete de ${fmt(freteVal)} já lançados nesse item)`;
    }
    document.getElementById('edit-item-previa').textContent = `lucro ${fmtSigned(lucro)} · margem ${pct(margem)}${extra}`;
  }
  function salvarEdicaoItemPedido() {
    capturarUndo();
    const idx = parseInt(document.getElementById('edit-item-idx').value, 10);
    const nome = document.getElementById('edit-item-nome').value.trim();
    const preco = parseFloat(document.getElementById('edit-item-preco').value) || 0;
    const custo = parseFloat(document.getElementById('edit-item-custo').value) || 0;
    if (!nome) { alert('Informe o nome do item.'); return; }
    const ped = getPedidoAtual();
    const item = ped.itens[idx];
    if (!item) { fecharModalEditarItemPedido(); return; }
    // Mantém o desconto, a comissão do iFood e o frete já gravados nesse item —
    // o modal só deixa mudar nome, preço e custo, mas o lucro continua líquido de verdade.
    const desconto = Number(item.desconto) || 0;
    const taxa = Number(item.taxa) || Number(getConfig().taxa) || 26.2;
    const freteVal = Number(item.freteVal) || 0;
    const { valorCliente, repasse, lucro, margem } = calcularNumerosItemPedido(preco, desconto, custo, taxa, freteVal);
    Object.assign(item, { nome, preco, desconto, custo, taxa, freteVal, valorCliente, repasse, lucro, margem });
    setPedidoAtual(ped);
    renderPedidoItens();
    fecharModalEditarItemPedido();
  }

  function removerItemPedido(idx) {
    capturarUndo();
    const ped = getPedidoAtual();
    ped.itens.splice(idx, 1);
    setPedidoAtual(ped);
    renderPedidoItens();
  }
  function marcarDataPedido() {
    const campo = document.getElementById('ped-data');
    const ped = getPedidoAtual();
    ped.data = campo.value || hojeISO();
    setPedidoAtual(ped);
  }
  function limparPedidoAtual() {
    if (!confirm('Limpar as vendas ainda não salvas deste fechamento?')) return;
    capturarUndo();
    setPedidoAtual({ data: hojeISO(), itens: [] });
    renderPedidoItens();
  }

  function totaisDoPedido(itens) {
    // valorCliente/repasse podem não existir em itens salvos antes desta correção;
    // nesses casos, cai no preço cheio (comportamento antigo) e, para o repasse,
    // reconstrói a partir de lucro+custo (que já era líquido nos itens antigos).
    const totalVendido = itens.reduce((s, i) => s + (i.valorCliente ?? i.preco) * i.qtd, 0);
    const repasseTotal = itens.reduce((s, i) => s + (i.repasse ?? (i.lucro + i.custo)) * i.qtd, 0);
    const custoTotal = itens.reduce((s, i) => s + i.custo * i.qtd, 0);
    const lucroTotal = itens.reduce((s, i) => s + i.lucro * i.qtd, 0);
    const margemMedia = totalVendido > 0 ? (lucroTotal / totalVendido) * 100 : 0;
    const pctDespesas = getPedidoPctDespesas();
    const despesas = lucroTotal * (pctDespesas / 100);
    const lucroReal = lucroTotal - despesas;
    return { totalVendido, repasseTotal, custoTotal, lucroTotal, margemMedia, pctDespesas, despesas, lucroReal };
  }

  function renderPedidoItens() {
    const ped = getPedidoAtual();
    const campoData = document.getElementById('ped-data');
    if (campoData && campoData.value !== ped.data) campoData.value = ped.data;
    const body = document.getElementById('ped-itens-body');
    const vazio = document.getElementById('ped-itens-vazio');
    const totaisCard = document.getElementById('ped-totais-card');
    if (!body) return;

    if (ped.itens.length === 0) {
      body.innerHTML = '';
      vazio.style.display = 'block';
      totaisCard.style.display = 'none';
      return;
    }
    vazio.style.display = 'none';
    totaisCard.style.display = 'block';

    body.innerHTML = ped.itens.map((item, idx) => `
      <tr>
        <td><strong>${escaparHtmlRelatorio(item.nome)}</strong></td>
        <td style="white-space:nowrap">
          <button class="btn btn-secundario" style="padding:2px 8px;font-size:13px;margin-top:0;width:auto" onclick="alterarQtdPedido(${idx},-1)">−</button>
          <input type="number" value="${item.qtd}" min="1" style="width:46px;text-align:center;display:inline-block;margin:0 4px" onchange="definirQtdPedido(${idx}, this.value)" />
          <button class="btn btn-secundario" style="padding:2px 8px;font-size:13px;margin-top:0;width:auto" onclick="alterarQtdPedido(${idx},1)">+</button>
        </td>
        <td>${fmt((item.valorCliente ?? item.preco) * item.qtd)}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-secundario" style="padding:4px 10px;font-size:12px;width:auto" onclick="abrirModalEditarItemPedido(${idx})">✎</button>
          <button class="btn btn-perigo" style="padding:4px 10px;font-size:12px;width:auto" onclick="removerItemPedido(${idx})">✕</button>
        </td>
      </tr>`).join('');

    const t = totaisDoPedido(ped.itens);
    document.getElementById('ped-faturamento').textContent = fmt(t.totalVendido);
    document.getElementById('ped-repasse').textContent = fmt(t.repasseTotal);
    document.getElementById('ped-custo').textContent = fmt(t.custoTotal);
    document.getElementById('ped-lucro').textContent = fmtSigned(t.lucroReal);
    document.getElementById('ped-despesas').textContent = fmt(t.despesas);
    document.getElementById('ped-margem').textContent = pct(t.margemMedia);
    const campoPct = document.getElementById('ped-pct-despesas');
    if (campoPct && document.activeElement !== campoPct) campoPct.value = t.pctDespesas;
  }

  function salvarFechamentoDia() {
    const ped = getPedidoAtual();
    if (ped.itens.length === 0) { alert('Adicione ao menos uma venda antes de salvar.'); return; }
    capturarUndo();
    const t = totaisDoPedido(ped.itens);
    const fechamentos = getFechamentos();
    const existenteIdx = fechamentos.findIndex(f => f.data === ped.data);
    const registro = {
      id: existenteIdx >= 0 ? fechamentos[existenteIdx].id : Date.now(),
      data: ped.data,
      itens: ped.itens,
      faturamento: t.totalVendido, repasseTotal: t.repasseTotal, custoTotal: t.custoTotal, lucroTotal: t.lucroTotal, margemMedia: t.margemMedia,
      pctDespesas: t.pctDespesas, despesas: t.despesas, lucroReal: t.lucroReal,
      salvoEm: Date.now()
    };
    if (existenteIdx >= 0) {
      if (!confirm('Já existe um fechamento salvo para ' + formatarDataBR(ped.data) + '. Substituir pelo fechamento atual?')) return;
      fechamentos[existenteIdx] = registro;
    } else {
      fechamentos.unshift(registro);
    }
    setFechamentos(fechamentos);
    setPedidoAtual({ data: hojeISO(), itens: [] });
    renderPedidoDia();
    alert('Fechamento salvo!');
  }

  let mesesAbertos = new Set(); // controla quais grupos de mês estão expandidos
  let fechamentoAbertoId = null;

  function toggleMesAberto(chave) {
    if (mesesAbertos.has(chave)) mesesAbertos.delete(chave); else mesesAbertos.add(chave);
    renderFechamentosAgrupados();
  }
  function toggleFechamentoDetalhe(id) {
    fechamentoAbertoId = fechamentoAbertoId === id ? null : id;
    renderFechamentosAgrupados();
  }
  function removerFechamento(id) {
    if (!confirm('Remover este fechamento salvo?')) return;
    capturarUndo();
    setFechamentos(getFechamentos().filter(f => f.id !== id));
    renderPedidoDia();
  }
  function limparFechamentos() {
    if (!confirm('Remover TODOS os fechamentos salvos? Isso não apaga o Histórico de produtos.')) return;
    capturarUndo();
    setFechamentos([]);
    renderPedidoDia();
  }

  // Agrupa os fechamentos salvos por "AAAA-MM", já com os totais somados do mês.
  // Fechamentos salvos antes da divisão lucro/despesas não têm "despesas" gravado:
  // nesse caso, tratamos como despesas=0 (não reaplicamos a % atual em dados antigos).
  function agruparFechamentosPorMes() {
    const fechamentos = getFechamentos();
    const grupos = {};
    fechamentos.forEach(f => {
      const chave = chaveMes(f.data);
      if (!grupos[chave]) grupos[chave] = { chave, dias: [], faturamento: 0, custoTotal: 0, lucroTotal: 0, despesasTotal: 0, lucroRealTotal: 0 };
      const despesas = Number(f.despesas) || 0;
      const lucroReal = f.lucroReal !== undefined ? Number(f.lucroReal) || 0 : (Number(f.lucroTotal) || 0);
      grupos[chave].dias.push(f);
      grupos[chave].faturamento += Number(f.faturamento) || 0;
      grupos[chave].custoTotal += Number(f.custoTotal) || 0;
      grupos[chave].lucroTotal += Number(f.lucroTotal) || 0;
      grupos[chave].despesasTotal += despesas;
      grupos[chave].lucroRealTotal += lucroReal;
    });
    return Object.values(grupos)
      .map(g => ({ ...g, margemMedia: g.faturamento > 0 ? (g.lucroTotal / g.faturamento) * 100 : 0 }))
      .sort((a, b) => b.chave.localeCompare(a.chave));
  }

  function renderFechamentosAgrupados() {
    const lista = document.getElementById('ped-fechamentos-lista');
    const vazio = document.getElementById('ped-fechamentos-vazio');
    if (!lista) return;
    const grupos = agruparFechamentosPorMes();
    if (grupos.length === 0) {
      lista.innerHTML = '';
      vazio.style.display = 'block';
      return;
    }
    vazio.style.display = 'none';
    lista.innerHTML = grupos.map(g => {
      const aberto = mesesAbertos.has(g.chave);
      const dias = [...g.dias].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
      const diasHtml = aberto ? dias.map(f => {
        const detalheAberto = fechamentoAbertoId === f.id;
        const despesasDia = Number(f.despesas) || 0;
        const lucroRealDia = f.lucroReal !== undefined ? Number(f.lucroReal) || 0 : (Number(f.lucroTotal) || 0);
        const detalhe = detalheAberto ? `
          <div style="padding:6px 0 2px 12px">
            ${f.itens.map(i => `<div class="linha-fechamento" style="font-size:12px;padding:4px 0"><span>${i.qtd}x ${escaparHtmlRelatorio(i.nome)}</span><span>${fmt((i.valorCliente ?? i.preco) * i.qtd)}</span></div>`).join('')}
          </div>` : '';
        return `<div style="border-top:1px solid var(--cinza-borda);padding:8px 0 8px 8px">
          <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="toggleFechamentoDetalhe(${f.id})">
            <div>
              <strong style="font-size:13px">${formatarDataBR(f.data)}</strong>
              <div style="font-size:11px;color:var(--cinza-texto)">${f.itens.length} produto(s) · margem ${pct(f.margemMedia || 0)}</div>
            </div>
            <div style="text-align:right">
              <div style="font-weight:600;color:var(--verde-escuro);font-size:13px">${fmtSigned(lucroRealDia)}</div>
              <div style="font-size:11px;color:var(--cinza-texto)">${fmt(f.faturamento || 0)} faturado${despesasDia > 0 ? ' · despesas ' + fmt(despesasDia) : ''}</div>
            </div>
          </div>
          ${detalhe}
          <div style="text-align:right;margin-top:4px">
            <button class="btn btn-perigo" style="padding:3px 10px;font-size:11px;width:auto" onclick="removerFechamento(${f.id})">Remover</button>
          </div>
        </div>`;
      }).join('') : '';

      return `<div style="border-bottom:1px solid var(--cinza-borda);padding:10px 0">
        <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="toggleMesAberto('${g.chave}')">
          <div>
            <strong>${aberto ? '▾' : '▸'} ${nomeMesAno(g.chave)}</strong>
            <div style="font-size:12px;color:var(--cinza-texto)">${g.dias.length} dia(s) fechado(s) · margem ${pct(g.margemMedia)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:600;color:var(--verde-escuro)">${fmtSigned(g.lucroRealTotal)}</div>
            <div style="font-size:12px;color:var(--cinza-texto)">${fmt(g.faturamento)} faturado${g.despesasTotal > 0 ? ' · despesas ' + fmt(g.despesasTotal) : ''}</div>
          </div>
        </div>
        ${diasHtml}
      </div>`;
    }).join('');
  }

  function renderRankingVendidos() {
    const box = document.getElementById('ped-ranking');
    const vazio = document.getElementById('ped-ranking-vazio');
    if (!box) return;
    const fechamentos = getFechamentos();
    const contagem = {};
    fechamentos.forEach(f => (f.itens || []).forEach(i => {
      contagem[i.nome] = (contagem[i.nome] || 0) + (Number(i.qtd) || 0);
    }));
    const ranking = Object.entries(contagem).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (ranking.length === 0) {
      box.innerHTML = '';
      vazio.style.display = 'block';
      return;
    }
    vazio.style.display = 'none';
    const max = ranking[0][1];
    box.innerHTML = ranking.map(([nome, qtd], idx) => `
      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
          <span><strong>${idx + 1}º</strong> ${escaparHtmlRelatorio(nome)}</span>
          <span>${qtd} un.</span>
        </div>
        <div style="background:var(--cinza-borda);border-radius:6px;height:6px;overflow:hidden">
          <div style="background:var(--verde-escuro);height:100%;width:${(qtd / max * 100).toFixed(0)}%"></div>
        </div>
      </div>`).join('');
  }

  // Preenche o <select> de meses com todos os meses que têm pelo menos um fechamento salvo.
  function renderSeletorMeses() {
    const select = document.getElementById('ped-mes-select');
    if (!select) return;
    const grupos = agruparFechamentosPorMes();
    if (grupos.length === 0) {
      select.innerHTML = '<option value="">Nenhum fechamento salvo ainda</option>';
      select.disabled = true;
      return;
    }
    select.disabled = false;
    const anterior = select.value;
    select.innerHTML = grupos.map(g => `<option value="${g.chave}">${nomeMesAno(g.chave)}</option>`).join('');
    if (grupos.some(g => g.chave === anterior)) select.value = anterior;
  }

  function renderPedidoDia() {
    renderPedidoItens();
    renderFechamentosAgrupados();
    renderRankingVendidos();
    renderSeletorMeses();
  }

  // ---- Relatório mensal em PDF (abre uma janela de impressão — "Salvar como PDF" no diálogo) ----
  function gerarRelatorioMensalPDF() {
    const select = document.getElementById('ped-mes-select');
    const chave = select ? select.value : '';
    if (!chave) { alert('Nenhum mês com fechamentos salvos para gerar relatório.'); return; }

    const grupos = agruparFechamentosPorMes();
    const grupo = grupos.find(g => g.chave === chave);
    if (!grupo) { alert('Mês não encontrado.'); return; }

    const dias = [...grupo.dias].sort((a, b) => (a.data || '').localeCompare(b.data || ''));
    const contagem = {};
    dias.forEach(f => (f.itens || []).forEach(i => {
      contagem[i.nome] = (contagem[i.nome] || 0) + (Number(i.qtd) || 0);
    }));
    const ranking = Object.entries(contagem).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const agora = new Date();
    const geradoEm = agora.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) +
      ' às ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const logo = document.querySelector('.header-marca img')?.src || '';

    const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Relatório de vendas — ${escaparHtmlRelatorio(nomeMesAno(chave))}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color:#222; padding: 28px; max-width: 820px; margin:0 auto; }
  h1 { font-size: 20px; margin-bottom: 2px; }
  .sub { color:#666; font-size:13px; margin-bottom: 22px; }
  .logo { height: 40px; margin-bottom: 10px; }
  .metricas { display:flex; gap:14px; margin-bottom: 24px; flex-wrap:wrap; }
  .metrica { background:#f6f6f4; border-radius:8px; padding:12px 16px; flex:1; min-width:140px; }
  .metrica .label { font-size:11px; color:#777; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:4px; }
  .metrica .valor { font-size:18px; font-weight:700; }
  table { width:100%; border-collapse: collapse; margin-bottom: 26px; }
  th, td { text-align:left; padding:7px 8px; border-bottom:1px solid #e6e6e2; font-size:13px; }
  th { color:#777; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.03em; }
  h2 { font-size: 15px; margin: 26px 0 10px; }
  .rodape { color:#999; font-size:11px; margin-top:30px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  ${logo ? `<img class="logo" src="${logo}" />` : ''}
  <h1>Relatório de vendas — ${escaparHtmlRelatorio(nomeMesAno(chave))}</h1>
  <div class="sub">Gerado em ${geradoEm} · O Bom Sabor</div>

  <div class="metricas">
    <div class="metrica"><div class="label">Faturamento do mês</div><div class="valor">R$ ${formatarNumeroRelatorio(grupo.faturamento)}</div></div>
    <div class="metrica"><div class="label">Custo total</div><div class="valor">R$ ${formatarNumeroRelatorio(grupo.custoTotal)}</div></div>
    <div class="metrica"><div class="label">Lucro bruto</div><div class="valor">R$ ${formatarNumeroRelatorio(grupo.lucroTotal)}</div></div>
    <div class="metrica"><div class="label">Despesas separadas</div><div class="valor">R$ ${formatarNumeroRelatorio(grupo.despesasTotal)}</div></div>
    <div class="metrica"><div class="label">Lucro líquido (real)</div><div class="valor">R$ ${formatarNumeroRelatorio(grupo.lucroRealTotal)}</div></div>
    <div class="metrica"><div class="label">Margem média</div><div class="valor">${formatarNumeroRelatorio(grupo.margemMedia)}%</div></div>
  </div>

  <h2>Fechamentos por dia (${dias.length})</h2>
  <table>
    <thead><tr><th>Data</th><th>Produtos</th><th>Faturamento</th><th>Custo</th><th>Lucro bruto</th><th>Despesas</th><th>Lucro líquido</th><th>Margem</th></tr></thead>
    <tbody>
      ${dias.map(f => {
        const despesasDia = Number(f.despesas) || 0;
        const lucroRealDia = f.lucroReal !== undefined ? Number(f.lucroReal) || 0 : (Number(f.lucroTotal) || 0);
        return `<tr>
        <td>${formatarDataBR(f.data)}</td>
        <td>${f.itens.length}</td>
        <td>R$ ${formatarNumeroRelatorio(f.faturamento)}</td>
        <td>R$ ${formatarNumeroRelatorio(f.custoTotal)}</td>
        <td>R$ ${formatarNumeroRelatorio(f.lucroTotal)}</td>
        <td>R$ ${formatarNumeroRelatorio(despesasDia)}</td>
        <td>R$ ${formatarNumeroRelatorio(lucroRealDia)}</td>
        <td>${formatarNumeroRelatorio(f.margemMedia)}%</td>
      </tr>`;
      }).join('')}
    </tbody>
  </table>

  <h2>Produtos mais vendidos no mês</h2>
  <table>
    <thead><tr><th>#</th><th>Produto</th><th>Quantidade vendida</th></tr></thead>
    <tbody>
      ${ranking.map(([nome, qtd], idx) => `<tr><td>${idx + 1}º</td><td>${escaparHtmlRelatorio(nome)}</td><td>${qtd} un.</td></tr>`).join('') || '<tr><td colspan="3">Nenhum item registrado.</td></tr>'}
    </tbody>
  </table>

  <div class="rodape">Relatório baseado nos fechamentos salvos na aba "Pedido do dia" do app O Bom Sabor.</div>
  <script>window.onload = () => setTimeout(() => window.print(), 300);<\/script>



</body>
</html>`;

    const janela = window.open('', '_blank');
    if (!janela) { alert('Não foi possível abrir a janela do relatório. Verifique se o navegador bloqueou pop-ups.'); return; }
    janela.document.open();
    janela.document.write(html);
    janela.document.close();
  }

  // ---- SIMULAR REPASSE (multi-seleção de produtos do histórico) ----
  let repasseSelecionados = new Set(); // guarda os ids marcados mesmo quando a busca esconde a linha

  function normalizarTexto(s) {
    return (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function renderRepasseLista() {
    const h = getHistorico();
    const idsValidos = new Set(h.map(p => p.id));
    repasseSelecionados.forEach(id => { if (!idsValidos.has(id)) repasseSelecionados.delete(id); });
    const body = document.getElementById('rep-lista-body');
    const vazio = document.getElementById('rep-lista-vazio');
    if (h.length === 0) {
      body.innerHTML = '';
      vazio.textContent = 'Nenhum produto no histórico ainda. Salve produtos na aba Calcular primeiro.';
      vazio.style.display = 'block';
      return;
    }
    const busca = normalizarTexto(document.getElementById('rep-busca')?.value || '');
    const filtrados = busca ? h.filter(p => normalizarTexto(p.nome).includes(busca)) : h;

    if (filtrados.length === 0) {
      body.innerHTML = '';
      vazio.textContent = 'Nenhum produto encontrado para "' + (document.getElementById('rep-busca')?.value || '') + '".';
      vazio.style.display = 'block';
      return;
    }
    vazio.style.display = 'none';
    body.innerHTML = filtrados.map(p => `
      <tr>
        <td><input type="checkbox" class="rep-check" data-id="${p.id}" ${repasseSelecionados.has(p.id) ? 'checked' : ''} onchange="toggleRepasseSelecao(${p.id}, this.checked)" style="width:16px;height:16px;accent-color:var(--verde);cursor:pointer" /></td>
        <td><strong>${escaparHtmlRelatorio(p.nome)}</strong><br><span style="font-size:11px;color:var(--cinza-texto)">${p.data}</span></td>
        <td>${fmt(p.valorCliente ?? Math.max(0, p.preco - (p.desconto || 0)))}</td>
        <td>${p.taxa}%</td>
        <td>${fmtSigned(p.repasse)}</td>
      </tr>`).join('');
  }

  function toggleRepasseSelecao(id, marcado) {
    if (marcado) repasseSelecionados.add(id); else repasseSelecionados.delete(id);
  }

  function repasseSelecionarTodos(marcar) {
    // Afeta apenas os produtos visíveis na busca atual
    document.querySelectorAll('.rep-check').forEach(c => {
      c.checked = marcar;
      toggleRepasseSelecao(parseInt(c.dataset.id, 10), marcar);
    });
  }

  function calcularRepasseSimulado() {
    const novaTaxa = parseFloat(document.getElementById('rep-taxa').value);
    if (isNaN(novaTaxa) || novaTaxa < 0) {
      alert('Informe uma nova taxa (%) válida.');
      return;
    }
    const idsSelecionados = Array.from(repasseSelecionados);
    if (idsSelecionados.length === 0) {
      alert('Selecione ao menos um produto do histórico.');
      return;
    }
    const h = getHistorico();
    const selecionados = h.filter(p => idsSelecionados.includes(p.id));

    // Soma tudo primeiro (valor que o cliente paga, frete, custo e repasse/lucro
    // atual de cada produto selecionado) e só depois tira a nova taxa UMA VEZ
    // sobre o total.
    let totalCliente = 0, totalFrete = 0, totalAtual = 0, totalCusto = 0;
    selecionados.forEach(p => {
      const valorCliente = p.valorCliente ?? Math.max(0, p.preco - (p.desconto || 0));
      totalCliente += valorCliente;
      totalFrete += (p.freteVal || 0);
      totalAtual += p.repasse;
      totalCusto += (p.custo || 0);
    });

    const valorTaxaNova = totalCliente * (novaTaxa / 100);
    const totalNovo = totalCliente - valorTaxaNova - totalFrete;
    const diffTotal = totalNovo - totalAtual;

    const lucroAtual = totalAtual - totalCusto;
    const lucroNovo = totalNovo - totalCusto;
    const diffLucro = lucroNovo - lucroAtual;

    document.getElementById('rep-total-atual').textContent = fmtSigned(totalAtual);
    document.getElementById('rep-total-novo').textContent = fmtSigned(totalNovo);
    const elDiff = document.getElementById('rep-total-diff');
    elDiff.textContent = (diffTotal >= 0 ? '+' : '-') + fmt(diffTotal);
    elDiff.style.color = diffTotal >= 0 ? 'var(--verde-escuro)' : 'var(--vermelho)';

    document.getElementById('rep-lucro-atual').textContent = fmtSigned(lucroAtual);
    document.getElementById('rep-lucro-novo').textContent = fmtSigned(lucroNovo);
    const elDiffLucro = document.getElementById('rep-lucro-diff');
    elDiffLucro.textContent = (diffLucro >= 0 ? '+' : '-') + fmt(diffLucro);
    elDiffLucro.style.color = diffLucro >= 0 ? 'var(--verde-escuro)' : 'var(--vermelho)';

    document.getElementById('rep-b-cliente').textContent = fmtSigned(totalCliente);
    document.getElementById('rep-b-taxa-pct').textContent = novaTaxa + '%';
    document.getElementById('rep-b-taxa-val').textContent = '- ' + fmt(valorTaxaNova);
    document.getElementById('rep-b-frete').textContent = '- ' + fmt(totalFrete);
    document.getElementById('rep-b-total').textContent = fmtSigned(totalNovo);
    document.getElementById('rep-b-custo').textContent = '- ' + fmt(totalCusto);
    const elBLucro = document.getElementById('rep-b-lucro');
    elBLucro.textContent = fmtSigned(lucroNovo);
    elBLucro.style.color = lucroNovo >= 0 ? 'var(--verde-escuro)' : 'var(--vermelho)';

    document.getElementById('rep-resultado').style.display = 'block';
  }

  function salvarConfig() {
    const taxa = parseFloat(document.getElementById('cfg-taxa').value) || 26.2;
    const frete = parseFloat(document.getElementById('cfg-frete').value) || 8;
    const metaPadrao = Math.max(0, parseFloat(document.getElementById('cfg-meta').value) || 0);
    const metaTipo = document.getElementById('cfg-meta-tipo').value === 'margem' ? 'margem' : 'valor';
    setConfig({ taxa, frete, metaPadrao, metaTipo });
    if (!produtoEditandoId) { document.getElementById('prod-meta').value = metaPadrao; document.getElementById('prod-meta-tipo').value = metaTipo; simularProduto(); }
    document.getElementById('taxa').value = taxa;
    document.getElementById('frete-val') && (document.getElementById('frete-val').value = frete);
    renderProdutosCatalogo?.();
    renderResumo?.();
  }

  function baixarArquivo(conteudo, nomeArquivo, mime) {
    const a = document.createElement('a');
    a.href = 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(conteudo);
    a.download = nomeArquivo;
    a.click();
  }

  // Converte uma lista de objetos (ou um objeto único) em texto CSV simples.
  // Campos que são objeto/array viram uma célula com o JSON daquele campo,
  // já que CSV não representa estrutura aninhada.
  function converterParaCSV(dados) {
    const linhas = Array.isArray(dados) ? dados : [dados];
    if (linhas.length === 0) return '';
    const colunas = [];
    linhas.forEach(l => Object.keys(l || {}).forEach(k => { if (!colunas.includes(k)) colunas.push(k); }));
    const escapar = (v) => {
      if (v === null || v === undefined) return '';
      const s = (typeof v === 'object') ? JSON.stringify(v) : String(v);
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const cabecalho = colunas.map(escapar).join(',');
    const corpo = linhas.map(l => colunas.map(c => escapar(l ? l[c] : '')).join(',')).join('\n');
    return cabecalho + '\n' + corpo;
  }

  function exportarDados(dados, nomeBase, formato) {
    if (!dados || (Array.isArray(dados) && dados.length === 0)) { alert('Nenhum dado para exportar.'); return; }
    if (formato === 'csv') {
      baixarArquivo(converterParaCSV(dados), nomeBase + '.csv', 'text/csv');
    } else {
      baixarArquivo(JSON.stringify(dados, null, 2), nomeBase + '.json', 'application/json');
    }
  }

  // ---- BACKUP COMPLETO (baixar tudo / restaurar tudo pelo próprio app) ----
  function exportarBackupCompleto() {
    const snap = coletarSnapshot();
    snap.__backup = { app:'O Bom Sabor', versao:2, criadoEm:new Date().toISOString(), fechamentos:getFechamentos().length, insumos:getMeusInsumos().length, fichas:getFichasHist().length, produtos:(typeof getProdutos==='function'?getProdutos():[]).length };
    const hoje = hojeISO();
    baixarArquivo(JSON.stringify(snap, null, 2), `BomSabor_Backup_Completo_${hoje}.json`, 'application/json');
    localStorage.setItem('bomsabor_ultimo_backup', new Date().toISOString());
    const st=document.getElementById('backup-status'); if(st) st.textContent='Último backup: agora · '+snap.__backup.fechamentos+' fechamentos · '+snap.__backup.insumos+' insumos · '+snap.__backup.fichas+' fichas';
  }

  function pareceBackupValido(d) {
    if (!d || typeof d !== 'object') return false;
    const chaves = ['hist', 'cfg', 'ficha', 'fichaEmbalagem', 'fichasHist', 'meusInsumos', 'pedidoAtual', 'fechamentos', 'pedidoPctDespesas'];
    return chaves.some(k => Object.prototype.hasOwnProperty.call(d, k));
  }

  function restaurarBackupArquivo(event) {
    const input = event.target;
    const arquivo = input.files && input.files[0];
    const status = document.getElementById('backup-status');
    if (!arquivo) return;

    const leitor = new FileReader();
    leitor.onload = () => {
      input.value = ''; // permite escolher o mesmo arquivo de novo depois, se precisar
      let dados;
      try {
        dados = JSON.parse(leitor.result);
      } catch (e) {
        alert('Esse arquivo não é um backup válido (JSON inválido).');
        return;
      }
      if (!pareceBackupValido(dados)) {
        alert('Esse arquivo não parece ser um backup do O Bom Sabor.');
        return;
      }
      const aviso = 'Restaurar este backup vai SUBSTITUIR todos os dados atuais deste aparelho ' +
        '(histórico, fichas, insumos, configurações e pedido do dia) pelos dados do arquivo.\n\n' +
        'Se você tiver sincronização configurada, essa versão restaurada também será enviada para a nuvem ' +
        'e para os outros aparelhos.\n\nDeseja continuar?';
      if (!confirm(aviso)) return;

      // Sempre carimba com a hora atual: garante que a versão restaurada
      // "vença" na próxima sincronização, em vez de ser sobrescrita pela nuvem.
      aplicarSnapshot(dados, Date.now(), false);
      if (status) status.textContent = 'Backup restaurado às ' + new Date().toLocaleTimeString('pt-BR');
      if (getCloudUrl()) sincronizarManual();
    };
    leitor.onerror = () => alert('Não foi possível ler o arquivo selecionado.');
    leitor.readAsText(arquivo);
  }

  // ---- BACKUPS DA NUVEM (últimos salvamentos automáticos guardados na planilha) ----
  async function abrirBackupsNuvem() {
    if (!getCloudUrl()) { alert('Configure primeiro o link de sincronização em Configurações.'); return; }
    const overlay = document.getElementById('modal-backups-nuvem-overlay');
    const lista = document.getElementById('backups-nuvem-lista');
    lista.innerHTML = '<div style="font-size:13px;color:var(--cinza-texto)">Carregando...</div>';
    overlay.style.display = 'flex';
    try {
      const resp = await fetch(getCloudUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: getCloudToken(), action: 'listar_backups' }),
        cache: 'no-store', redirect: 'follow'
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const j = await resp.json();
      if (!j || j.ok === false || j.erro) throw new Error(j?.erro || 'Resposta inválida da nuvem');
      const backups = Array.isArray(j.backups) ? j.backups : [];
      if (backups.length === 0) {
        lista.innerHTML = '<div style="font-size:13px;color:var(--cinza-texto)">Nenhum backup salvo na nuvem ainda.</div>';
        return;
      }
      lista.innerHTML = backups.map(b => {
        const dataFmt = new Date(b.dataHora).toLocaleString('pt-BR');
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 4px;border-bottom:1px solid var(--cinza-borda);font-size:14px">
          <span>${dataFmt}</span>
          <button class="btn btn-secundario" style="padding:5px 12px;font-size:12px;width:auto;margin-top:0" onclick="restaurarBackupNuvem(${b.updatedAt})">Restaurar</button>
        </div>`;
      }).join('');
    } catch (e) {
      lista.innerHTML = `<div style="font-size:13px;color:var(--vermelho)">Erro ao carregar: ${e.message}</div>`;
    }
  }
  function fecharBackupsNuvem() {
    document.getElementById('modal-backups-nuvem-overlay').style.display = 'none';
  }
  async function restaurarBackupNuvem(updatedAt) {
    const aviso = 'Restaurar este backup da nuvem vai SUBSTITUIR todos os dados atuais deste aparelho ' +
      'pelos dados salvos naquele momento.\n\nDeseja continuar?';
    if (!confirm(aviso)) return;
    try {
      const resp = await fetch(getCloudUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: getCloudToken(), action: 'obter_backup', updatedAt }),
        cache: 'no-store', redirect: 'follow'
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const j = await resp.json();
      if (!j || j.ok === false || j.erro) throw new Error(j?.erro || 'Resposta inválida da nuvem');
      // Sempre carimba com a hora atual: garante que a versão restaurada
      // "vença" na próxima sincronização, em vez de ser sobrescrita pela versão mais recente da nuvem.
      aplicarSnapshot(j.data, Date.now(), false);
      fecharBackupsNuvem();
      const status = document.getElementById('backup-status');
      if (status) status.textContent = 'Backup da nuvem restaurado às ' + new Date().toLocaleTimeString('pt-BR');
      sincronizarManual();
    } catch (e) {
      alert('Erro ao restaurar backup: ' + e.message);
    }
  }

  function exportar(formato) { exportarDados(getHistorico(), 'BomSabor_Historico_Precificacao', formato); }
  function exportarFichas(formato) { exportarDados(getFichasHist(), 'BomSabor_Historico_FichasTecnicas', formato); }
  function exportarMeusInsumos(formato) { exportarDados(getMeusInsumos(), 'BomSabor_MeusInsumos', formato); }
  function exportarConfig(formato) { exportarDados(getConfig(), 'BomSabor_Configuracoes', formato); }

  // ---- APAGAR TUDO: exige digitar "APAGAR" no modal, em vez de um simples confirm() ----
  function abrirModalApagarTudo() {
    const overlay = document.getElementById('modal-apagar-overlay');
    const input = document.getElementById('modal-apagar-input');
    if (input) input.value = '';
    atualizarBotaoApagarTudo();
    if (overlay) overlay.style.display = 'flex';
    if (input) input.focus();
  }
  function fecharModalApagarTudo() {
    const overlay = document.getElementById('modal-apagar-overlay');
    if (overlay) overlay.style.display = 'none';
  }
  function atualizarBotaoApagarTudo() {
    const input = document.getElementById('modal-apagar-input');
    const btn = document.getElementById('modal-apagar-confirmar');
    if (!input || !btn) return;
    const habilitado = input.value.trim().toUpperCase() === 'APAGAR';
    btn.style.opacity = habilitado ? '1' : '0.5';
    btn.style.pointerEvents = habilitado ? 'auto' : 'none';
  }
  function confirmarApagarTudo() {
    const input = document.getElementById('modal-apagar-input');
    if (!input || input.value.trim().toUpperCase() !== 'APAGAR') return;
    aplicandoDadosRemotos = true;
    try {
      localStorage.setItem('bomsabor_hist', '[]');
      localStorage.setItem('bomsabor_cfg', JSON.stringify({taxa:26.2, frete:8, taxaAtualizada2026:true}));
      localStorage.setItem('bomsabor_ficha', '[]');
      localStorage.setItem('bomsabor_ficha_embalagem', '0');
      localStorage.setItem('bomsabor_fichas_hist', '[]');
      localStorage.setItem('bomsabor_meus_insumos', '[]');
      localStorage.setItem('bomsabor_pedido_atual', JSON.stringify({ data: hojeISO(), itens: [] }));
      localStorage.setItem('bomsabor_fechamentos', '[]');
      localStorage.setItem('bomsabor_pedido_pct_despesas', '50');
    } finally {
      aplicandoDadosRemotos = false;
    }
    marcarAlteracaoLocal();
    init();
    fecharModalApagarTudo();
    alert('Dados apagados. A exclusão será sincronizada.');
  }

  // ---- INSTALAÇÃO COMO APP / PWA ----
  let installPromptEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPromptEvent = e;
    const btn = document.getElementById('install-app-btn');
    if (btn) btn.style.display = 'inline-flex';
  });

  async function instalarApp() {
    if (!installPromptEvent) {
      alert('No navegador, abra o menu e escolha “Instalar app” ou “Adicionar à tela inicial”.');
      return;
    }
    installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    installPromptEvent = null;
    const btn = document.getElementById('install-app-btn');
    if (btn) btn.style.display = 'none';
  }

  window.addEventListener('appinstalled', () => {
    const btn = document.getElementById('install-app-btn');
    if (btn) btn.style.display = 'none';
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }

  document.addEventListener('DOMContentLoaded', () => {
    const inputApagar = document.getElementById('modal-apagar-input');
    if (inputApagar) {
      inputApagar.addEventListener('input', atualizarBotaoApagarTudo);
      inputApagar.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmarApagarTudo(); });
    }
    const overlay = document.getElementById('modal-apagar-overlay');
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) fecharModalApagarTudo(); });
  });

  try { init(); } catch (e) { console.error('Erro na inicialização do app:', e); }

  setTimeout(()=>{try{popularComponentesFicha();renderFicha();renderFichasHist()}catch(e){console.error(e)}},0);

  // ===== CATÁLOGO DE PRODUTOS =====
  let produtoEditandoId = null;
  function getProdutosCatalogo(){ try{return JSON.parse(localStorage.getItem('bomsabor_produtos_catalogo')||'[]')}catch(e){return[]} }
  function setProdutosCatalogo(v){ localStorage.setItem('bomsabor_produtos_catalogo',JSON.stringify(v)); marcarAlteracaoLocal(); }
  function fichaCustoAtual(f){
    if(!f) return 0;
    const itens=(Array.isArray(f.itens)?f.itens:[]).map(i=>({custo:custoAtualItem(i).custo,usado:i.usado}));
    const total=Calculos.custoFichaAtual(itens,f.embalagem);
    return f.tipo==='receita' ? Calculos.custoFichaPorRendimento(total,f.rendimento) : total;
  }
  function popularFichasProdutos(){
    const sel=document.getElementById('prod-ficha'); if(!sel)return;
    const atual=sel.value;
    const fichas=getFichasHist().filter(f=>(f.tipo||'produto')==='produto');
    sel.innerHTML='<option value="">Selecione...</option>'+fichas.map(f=>`<option value="${f.id}">${escaparHtmlRelatorio(f.nome)}</option>`).join('');
    if(fichas.some(f=>String(f.id)===String(atual))) sel.value=atual;
  }
  function produtoFichaSelecionada(){ const id=Number(document.getElementById('prod-ficha')?.value); return getFichasHist().find(f=>Number(f.id)===id); }
  function produtoFichaMudou(){ const f=produtoFichaSelecionada(); if(f && !document.getElementById('prod-nome').value.trim()) document.getElementById('prod-nome').value=f.nome; simularProduto(); }
  function calcProdutoCenarios(precoI,custo,beneficio){
    const c=Calculos.calcularCenariosIfood(precoI,custo,beneficio,getTaxaIfoodFrac());
    return {lucroPromo:c.lucroPromo,lucroFrete:c.lucroFrete,lucroI:c.lucroPior};
  }
  function simularProduto(){
    const f=produtoFichaSelecionada(), manual=Number(document.getElementById('prod-custo-manual')?.value)||0, custo=f?fichaCustoAtual(f):manual, temCusto=!!f||manual>0;
    const pi=Number(document.getElementById('prod-preco-ifood')?.value)||0;
    const ben=Number(document.getElementById('prod-beneficio')?.value)||0, meta=Number(document.getElementById('prod-meta')?.value)||0, metaTipo=document.getElementById('prod-meta-tipo')?.value||'valor';
    const info=document.getElementById('prod-custo-info'); if(!info)return;
    info.innerHTML=f?`<b>Custo atual pela ficha:</b> ${fmt(custo)} <span style="color:var(--cinza-texto)">· ${f.itens?.length||0} componentes · atualiza quando os insumos mudam</span>`:(manual>0?`<b>Custo manual:</b> ${fmt(manual)} <span style="color:var(--cinza-texto)">· não muda sozinho, edite o produto para atualizar</span>`:'Selecione uma ficha técnica de Produto final ou digite o custo manual.');
    const c=calcProdutoCenarios(pi,custo,ben);
    const ei=document.getElementById('prod-lucro-ifood');
    ei.textContent=pi?fmtSigned(c.lucroI):'—'; const atendeI=metaTipo==='margem'?(pi>0&&c.lucroI/pi*100>=meta):c.lucroI>=meta; ei.style.color=atendeI?'var(--verde-escuro)':'var(--vermelho)';
    document.getElementById('prod-sub-ifood').textContent=pi?`Promoção ${fmtSigned(c.lucroPromo)} · Frete ${fmtSigned(c.lucroFrete)}`:'';
    // preço necessário: iFood usa pior cenário (frete): (P*(1-taxa))-benefício-custo=meta
    const minI=precoMinimoIfoodParaMeta(custo,ben,meta,metaTipo);
    document.getElementById('prod-preco-meta').textContent=temCusto&&Number.isFinite(minI)?`iFood ${fmt(minI)}`:(temCusto?'Meta acima do limite do modelo':'—');
    document.getElementById('prod-sub-meta').textContent=temCusto?(metaTipo==='margem'?`Preços para buscar margem mínima de ${meta.toFixed(1).replace('.',',')}%.`:'Valores mínimos matemáticos para atingir a meta de lucro informada.'):'';
  }
  function salvarProdutoCatalogo(){
    const f=produtoFichaSelecionada(), nome=document.getElementById('prod-nome').value.trim(), manual=Number(document.getElementById('prod-custo-manual').value)||0;
    if(!nome){alert('Informe o nome do produto.');return}
    if(!f&&!(manual>0)){alert('Selecione uma ficha técnica ou digite o custo manual do produto.');return}
    const arr=getProdutosCatalogo(), custoAgora=f?fichaCustoAtual(f):manual, obj={nome,fichaId:f?f.id:null,custoManual:f?0:manual,precoIfood:Number(document.getElementById('prod-preco-ifood').value)||0,beneficio:Number(document.getElementById('prod-beneficio').value)||0,meta:Number(document.getElementById('prod-meta').value)||0,metaTipo:document.getElementById('prod-meta-tipo').value||'valor',custoSnapshot:custoAgora,atualizado:new Date().toLocaleDateString('pt-BR')};
    if(produtoEditandoId!==null){const x=arr.find(a=>String(a.id)===String(produtoEditandoId));if(x)Object.assign(x,obj);else arr.unshift({id:produtoEditandoId,...obj})}else arr.unshift({id:Date.now(),...obj});
    setProdutosCatalogo(arr); produtoEditandoId=null; renderProdutosCatalogo(); limparProdutoCatalogo(false); alert('Produto salvo!');
  }
  function limparProdutoCatalogo(limpar=true){ produtoEditandoId=null; if(limpar!==false){['prod-nome','prod-preco-ifood','prod-custo-manual'].forEach(id=>document.getElementById(id).value='');document.getElementById('prod-ficha').value='';} simularProduto(); }
  function editarProdutoCatalogo(id){
    const arr=getProdutosCatalogo();
    const p=arr.find(x=>String(x.id)===String(id));
    if(!p){ alert('Produto não encontrado. Atualize a página e tente novamente.'); return; }

    produtoEditandoId=p.id;
    popularFichasProdutos();

    const campos={
      'prod-ficha': p.fichaId ?? '',
      'prod-custo-manual': Number(p.custoManual)||'',
      'prod-nome': p.nome ?? '',
      'prod-preco-ifood': Number(p.precoIfood)||'',
      'prod-beneficio': Number(p.beneficio)||0,
      'prod-meta': p.meta ?? 0,
      'prod-meta-tipo': p.metaTipo||'valor'
    };
    Object.entries(campos).forEach(([idCampo,valor])=>{
      const el=document.getElementById(idCampo);
      if(el) el.value=String(valor);
    });

    simularProduto();

    const aba=document.getElementById('aba-produtos');
    if(aba && !aba.classList.contains('ativa')) mudarAba('produtos');

    const alvo=document.getElementById('prod-ficha') || document.getElementById('prod-nome');
    if(alvo){
      alvo.scrollIntoView({behavior:'smooth',block:'start'});
      setTimeout(()=>{ document.getElementById('prod-nome')?.focus(); },300);
    }
  }
  window.editarProdutoCatalogo=editarProdutoCatalogo;
  function removerProdutoCatalogo(id){
    if(!confirm('Excluir este produto do catálogo?'))return;
    setProdutosCatalogo(getProdutosCatalogo().filter(x=>String(x.id)!==String(id)));
    renderProdutosCatalogo();
  }
  window.removerProdutoCatalogo=removerProdutoCatalogo;
  // Preço iFood mínimo para a meta: usa o pior cenário (entrega grátis), com o benefício do produto.
  // Mesma conta do simulador: (meta + custo + benefício) / (1 - comissão)  ou, por margem, (custo + benefício) / (1 - comissão - margem).
  function precoMinimoIfoodParaMeta(custo,beneficio,meta,metaTipo){
    return Calculos.precoMinimoParaMeta(custo,beneficio,meta,metaTipo,getTaxaIfoodFrac());
  }
  function abrirSugestoesPreco(plat){
    // Só consulta: abre uma janela com os preços sugeridos e NÃO altera nenhum preço cadastrado.
    const arr=getProdutosCatalogo(), fichas=getFichasHist();
    if(!arr.length){alert('Nenhum produto cadastrado.');return}
    const linhas=[], semFicha=[];
    arr.forEach(p=>{
      const f=fichas.find(x=>Number(x.id)===Number(p.fichaId));
      if(!f&&!(Number(p.custoManual)>0)){semFicha.push(p.nome||'Produto');return}
      const custo=f?fichaCustoAtual(f):Number(p.custoManual), meta=Number(p.meta)||0, mt=p.metaTipo||'valor';
      const ben=Math.max(0,Number(p.beneficio)||0);
      const min=precoMinimoIfoodParaMeta(custo,ben,meta,mt);
      linhas.push({nome:p.nome||'Produto',custo,ben,atual:Number(p.precoIfood)||0,sug:Number.isFinite(min)?Math.ceil(min*100)/100:null});
    });
    if(!linhas.length){alert('Não foi possível calcular sugestões. Confira se os produtos têm ficha vinculada.');return}
    const esc=escaparHtmlRelatorio;
    const rows=linhas.map(l=>{
      let dif='—', cor='var(--cinza-texto)';
      if(l.sug===null){ dif='Meta inviável'; cor='var(--vermelho)'; }
      else if(l.atual>0){
        if(l.atual+0.004>=l.sug){ dif='OK'; cor='var(--verde-escuro)'; }
        else { dif='+ '+fmt(l.sug-l.atual); cor='var(--vermelho)'; }
      }
      return `<tr><td><strong>${esc(l.nome)}</strong></td><td>${fmt(l.custo)}</td><td>${l.ben>0?fmt(l.ben):'—'}</td><td>${l.atual>0?fmt(l.atual):'—'}</td><td style="font-weight:700">${l.sug===null?'—':fmt(l.sug)}</td><td style="color:${cor};font-weight:600;white-space:nowrap">${dif}</td></tr>`;
    }).join('');
    let html=`<div class="tabela-wrap"><table><thead><tr><th>Produto</th><th>Custo</th><th>Benefício</th><th>iFood atual</th><th>Sugerido</th><th>Ajuste</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    const fmtPct=v=>(v*100).toFixed(1).replace('.0','').replace('.',',');
    html+=`<p style="font-size:12px;color:var(--cinza-texto);margin-top:12px">Sugestão = menor preço que cobre o custo e a meta de cada produto no pior cenário (entrega grátis), com comissão iFood de ${fmtPct(getTaxaIfoodFrac())}% e o benefício cadastrado em cada produto. "Ajuste" mostra quanto falta para chegar ao sugerido.</p>`;
    if(semFicha.length) html+=`<p style="font-size:12px;color:var(--cinza-texto);margin-top:8px">Sem ficha vinculada (não calculados): ${semFicha.map(esc).join(', ')}.</p>`;
    document.getElementById('sugestoes-titulo').textContent='Preços sugeridos iFood';
    document.getElementById('sugestoes-corpo').innerHTML=html;
    document.getElementById('modal-sugestoes-overlay').style.display='flex';
  }
  function calcularPrecosIfoodMeta(){ abrirSugestoesPreco('ifood'); }
  function fecharSugestoes(){ document.getElementById('modal-sugestoes-overlay').style.display='none'; }
  window.calcularPrecosIfoodMeta=calcularPrecosIfoodMeta; window.abrirSugestoesPreco=abrirSugestoesPreco; window.fecharSugestoes=fecharSugestoes;
    // Texto do balão do selo de status: preço ideal (mínimo) para bater a meta no pior cenário (entrega grátis).
    function dicaPrecoIdeal(p,custo,meta,metaTipo){
      if(!(Number(custo)>0)) return 'Sem custo cadastrado: vincule uma ficha técnica ou informe o custo manual para calcular o preço ideal.';
      const ben=Math.max(0,Number(p.beneficio)||0);
      const min=precoMinimoIfoodParaMeta(custo,ben,meta,metaTipo);
      if(!Number.isFinite(min)) return 'Meta inviável com a comissão atual do iFood: reduza a meta ou o benefício.';
      const ideal=Math.ceil(min*100)/100, atual=Number(p.precoIfood)||0;
      const metaTxt=metaTipo==='margem'?String(meta.toFixed(1)).replace('.',',')+'% de margem':fmt(meta)+' de lucro';
      let t='Preço ideal no iFood: '+fmt(ideal)+' (meta de '+metaTxt+', no pior cenário).';
      if(atual>0){
        if(atual+0.004>=ideal) t+=' Seu preço atual é '+fmt(atual)+' — folga de '+fmt(atual-ideal)+'.';
        else t+=' Seu preço atual é '+fmt(atual)+' — falta '+fmt(ideal-atual)+'.';
      } else t+=' Este produto ainda não tem preço no iFood.';
      return t;
    }
    (function iniciarDicaPreco(){
      let tip=null;
      function mostrar(el){
        if(!tip){tip=document.createElement('div');tip.id='dica-preco';tip.style.cssText='position:fixed;z-index:1200;max-width:260px;background:var(--preto,#222);color:#fff;font-size:12px;line-height:1.4;padding:9px 12px;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.3);pointer-events:none;display:none';document.body.appendChild(tip)}
        tip.textContent=el.getAttribute('data-dica')||'';tip.style.display='block';
        const r=el.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight;
        let left=Math.min(Math.max(8,r.left+r.width/2-w/2),window.innerWidth-w-8);
        let top=r.top-h-8; if(top<8) top=r.bottom+8;
        tip.style.left=left+'px';tip.style.top=top+'px';
      }
      function esconder(){ if(tip) tip.style.display='none'; }
      document.addEventListener('mouseover',e=>{const el=e.target.closest&&e.target.closest('.badge-dica');if(el)mostrar(el)});
      document.addEventListener('mouseout',e=>{if(e.target.closest&&e.target.closest('.badge-dica'))esconder()});
      document.addEventListener('focusin',e=>{const el=e.target.closest&&e.target.closest('.badge-dica');if(el)mostrar(el)});
      document.addEventListener('focusout',e=>{if(e.target.closest&&e.target.closest('.badge-dica'))esconder()});
      document.addEventListener('click',e=>{const el=e.target.closest&&e.target.closest('.badge-dica');if(el)mostrar(el);else esconder()});
      window.addEventListener('scroll',esconder,true);
    })();
    function renderProdutosCatalogo(){
    const body=document.getElementById('prod-body'), vazio=document.getElementById('prod-vazio');if(!body)return;
    const arr=getProdutosCatalogo(), fichas=getFichasHist();
    if(!arr.length){body.innerHTML='';vazio.style.display='block';return}
    vazio.style.display='none';
    body.innerHTML=arr.map(p=>{
      const f=fichas.find(x=>Number(x.id)===Number(p.fichaId));
      const custo=f?fichaCustoAtual(f):(Number(p.custoManual)||0);
      const c=calcProdutoCenarios(p.precoIfood||0,custo,p.beneficio||0);
      const meta=Number(p.meta)||0, metaTipo=p.metaTipo||'valor';
      const atendePromo=metaTipo==='margem'?(p.precoIfood>0&&c.lucroPromo/p.precoIfood*100>=meta):c.lucroPromo>=meta;
      const atendeFrete=metaTipo==='margem'?(p.precoIfood>0&&c.lucroFrete/p.precoIfood*100>=meta):c.lucroFrete>=meta;
      const atendeI=atendePromo&&atendeFrete;
      const ruim=(p.precoIfood&&!atendeI);
      return `<tr>
        <td><strong>${escaparHtmlRelatorio(p.nome)}</strong><div style="font-size:11px;color:var(--cinza-texto)">${f?'Ficha: '+escaparHtmlRelatorio(f.nome):(Number(p.custoManual)>0?'Custo manual':'⚠ sem ficha nem custo')}</div></td>
        <td><strong>${fmt(custo)}</strong></td>
        <td>${p.precoIfood?fmt(p.precoIfood):'—'}</td>
        <td style="font-weight:600;color:${atendePromo?'var(--verde-escuro)':'var(--vermelho)'}">${p.precoIfood?fmtSigned(c.lucroPromo):'—'}</td>
        <td style="font-weight:600;color:${atendeFrete?'var(--verde-escuro)':'var(--vermelho)'}">${p.precoIfood?fmtSigned(c.lucroFrete):'—'}</td>
        <td style="font-weight:700;color:${atendeI?'var(--verde-escuro)':'var(--vermelho)'}">${p.precoIfood?fmtSigned(c.lucroI):'—'}</td>
        <td><span class="badge ${ruim?'vermelho':'verde'} badge-dica" tabindex="0" data-dica="${escaparHtmlRelatorio(dicaPrecoIdeal(p,custo,meta,metaTipo))}">${ruim?'Revisar preço':'Meta atendida'}</span></td>
        <td style="white-space:nowrap"><button class="btn btn-secundario" style="padding:4px 10px;font-size:12px" onclick="window.editarProdutoCatalogo('${String(p.id).replace(/'/g,"\\'")}')">Editar</button> <button class="btn btn-perigo" style="padding:4px 10px;font-size:12px" onclick="window.removerProdutoCatalogo('${String(p.id).replace(/'/g,"\\'")}')">✕</button></td>
      </tr>`}).join('');
  }

