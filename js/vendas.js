// Pedido do Dia v2: plataforma, repasse real e painel Hoje/Semana/Mês.
function salvarPlataformaPedido(v){ const p=getPedidoAtual(); p.plataforma=v||'ifood'; setPedidoAtual(p); renderPedidoItens(); }
function salvarRepasseRealPedido(v){ const p=getPedidoAtual(); const n=parseFloat(v); p.repasseReal=Number.isFinite(n)?n:null; setPedidoAtual(p); renderPedidoItens(); }
function plataformaPedido(){ const v=getPedidoAtual().plataforma||'ifood'; return v==='99food'?'ifood':v; }
function calcularItemPorPlataforma(item, plataforma){
  const preco=Number(item.preco)||0, custo=Number(item.custo)||0;
  if(plataforma==='direto') return {valorCliente:preco, repasse:preco, lucro:preco-custo, margem:preco?((preco-custo)/preco*100):0};
  return calcularNumerosItemPedido(preco,Number(item.desconto)||0,custo,Number(item.taxa)||Number(getConfig().taxa)||26.2,Number(item.freteVal)||0);
}
const _totaisDoPedidoOriginal=totaisDoPedido;
totaisDoPedido=function(itens){
  const plat=plataformaPedido(); let totalVendido=0,repasseTotal=0,custoTotal=0,lucroTotal=0;
  itens.forEach(i=>{const n=calcularItemPorPlataforma(i,plat),q=Number(i.qtd)||0; totalVendido+=n.valorCliente*q; repasseTotal+=n.repasse*q; custoTotal+=(Number(i.custo)||0)*q; lucroTotal+=n.lucro*q;});
  // REGRA: repasse (real, se informado; senão o estimado) - custo dos produtos = sobra.
  // A sobra é dividida entre despesas (padrão 50%) e lucro (o restante).
  const repasseEstimado=repasseTotal, pedAtual=getPedidoAtual();
  const realInf=(pedAtual.repasseReal!==null&&pedAtual.repasseReal!==undefined&&pedAtual.repasseReal!==''&&Number.isFinite(Number(pedAtual.repasseReal)));
  if(realInf){ repasseTotal=Number(pedAtual.repasseReal); lucroTotal=repasseTotal-custoTotal; }
  const margemMedia=totalVendido?lucroTotal/totalVendido*100:0, pctDespesas=getPedidoPctDespesas(), despesas=Math.max(0,lucroTotal)*(pctDespesas/100), lucroReal=lucroTotal-despesas;
  return {totalVendido,repasseTotal,repasseEstimado,usandoRepasseReal:realInf,custoTotal,lucroTotal,margemMedia,pctDespesas,despesas,lucroReal};
};
const _renderPedidoItensV1=renderPedidoItens;
renderPedidoItens=function(){
  _renderPedidoItensV1(); const p=getPedidoAtual(), plat=document.getElementById('ped-plataforma'), rr=document.getElementById('ped-repasse-real');
  if(plat) plat.value=(p.plataforma==='99food'?'ifood':p.plataforma)||'ifood'; if(rr && document.activeElement!==rr) rr.value=(p.repasseReal===null||p.repasseReal===undefined)?'':p.repasseReal;
  const box=document.getElementById('ped-comparacao-real'); if(box && p.itens.length){const t=totaisDoPedido(p.itens); if(p.repasseReal!==null&&p.repasseReal!==undefined&&p.repasseReal!==''){const real=Number(p.repasseReal)||0,d=real-t.repasseEstimado; box.style.display='block'; box.innerHTML='<strong>Estimado × real</strong><br>Repasse estimado: '+fmt(t.repasseEstimado)+' · Repasse real: '+fmt(real)+' · Diferença: <strong>'+fmtSigned(d)+'</strong><br><span style="font-size:12px;color:var(--cinza-texto)">Sobra (repasse real − custo): '+fmtSigned(t.lucroTotal)+' → despesas '+fmt(t.despesas)+' · lucro '+fmtSigned(t.lucroReal)+'</span>';}else box.style.display='none';}
};
const _salvarFechamentoV1=salvarFechamentoDia;
salvarFechamentoDia=function(){
  const ped=getPedidoAtual(); if(!ped.itens.length){alert('Adicione ao menos uma venda antes de salvar.');return;}
  capturarUndo(); const t=totaisDoPedido(ped.itens), fs=getFechamentos(), idx=fs.findIndex(f=>f.data===ped.data && (f.plataforma||'ifood')===(ped.plataforma||'ifood'));
  const real=(ped.repasseReal!==null&&ped.repasseReal!==undefined&&ped.repasseReal!=='')?Number(ped.repasseReal):null;
  const reg={id:idx>=0?fs[idx].id:Date.now(),data:ped.data,plataforma:ped.plataforma||'ifood',itens:ped.itens,faturamento:t.totalVendido,repasseEstimado:t.repasseEstimado,repasseTotal:t.repasseTotal,repasseReal:real,custoTotal:t.custoTotal,lucroTotal:t.lucroTotal,margemMedia:t.margemMedia,pctDespesas:t.pctDespesas,despesas:t.despesas,lucroReal:t.lucroReal,salvoEm:Date.now()};
  if(idx>=0){if(!confirm('Já existe um fechamento desta plataforma nessa data. Substituir?'))return;fs[idx]=reg;}else fs.unshift(reg); setFechamentos(fs); setPedidoAtual({data:hojeISO(),itens:[],plataforma:ped.plataforma||'ifood',repasseReal:null}); renderPedidoDia(); alert('Fechamento salvo!');
};
function renderPainelVendas(){
 const fs=getFechamentos(), now=new Date(), hoje=hojeISO(), inicioSemana=new Date(now); inicioSemana.setHours(0,0,0,0); inicioSemana.setDate(now.getDate()-((now.getDay()+6)%7)); const ym=hoje.slice(0,7);
 const fat=a=>a.reduce((s,f)=>s+(Number(f.faturamento)||0),0), luc=a=>a.reduce((s,f)=>s+(Number(f.lucroReal ?? f.lucroTotal)||0),0);
 const h=fs.filter(f=>f.data===hoje), w=fs.filter(f=>{const d=new Date((f.data||'')+'T00:00:00');return d>=inicioSemana&&d<=now}), m=fs.filter(f=>(f.data||'').startsWith(ym));
 const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v}; set('vendas-hoje',fmt(fat(h)));set('vendas-semana',fmt(fat(w)));set('vendas-mes',fmt(fat(m)));set('lucro-mes',fmtSigned(luc(m)));set('ticket-medio',fmt(m.length?fat(m)/m.length:0));set('qtd-fechamentos',String(m.length));
 const names={ifood:'iFood','99food':'99Food',direto:'Venda direta'}, box=document.getElementById('vendas-plataformas'); if(box){const g={};m.forEach(f=>{const k=f.plataforma||'ifood';g[k]=(g[k]||0)+(Number(f.faturamento)||0)});box.innerHTML=Object.keys(g).length?'No mês: '+Object.entries(g).map(([k,v])=>'<strong>'+names[k]+':</strong> '+fmt(v)).join(' · '):'Nenhuma venda salva neste mês.';}
}
const _renderPedidoDiaV1=renderPedidoDia; renderPedidoDia=function(){_renderPedidoDiaV1();renderPainelVendas();};

// Correção única: fechamentos antigos salvos com repasse real não separavam as despesas do lucro.
function corrigirFechamentosAntigos(){
  try{
    if(localStorage.getItem('bomsabor_migr_repasse_v1')) return;
    const fs=getFechamentos();
    const errados=fs.filter(f=>f.repasseReal!==null&&f.repasseReal!==undefined&&f.repasseReal!==''&&Number.isFinite(Number(f.repasseReal))
      && Math.abs((Number(f.lucroReal)||0)-(Number(f.lucroTotal)||0))<0.005 && (Number(f.lucroTotal)||0)>0.005);
    localStorage.setItem('bomsabor_migr_repasse_v1','1');
    if(!errados.length) return;
    if(!confirm('Encontrei '+errados.length+' fechamento(s) salvo(s) com repasse real em que as despesas não foram separadas do lucro. Corrigir agora (repasse − custo, dividindo entre despesas e lucro)?')) return;
    capturarUndo();
    errados.forEach(f=>{
      const rep=Number(f.repasseReal), custo=Number(f.custoTotal)||0, sobra=rep-custo;
      const pct=Number.isFinite(Number(f.pctDespesas))?Number(f.pctDespesas):50;
      const desp=Math.max(0,sobra)*pct/100;
      f.repasseTotal=rep; f.lucroTotal=sobra; f.pctDespesas=pct; f.despesas=desp; f.lucroReal=sobra-desp;
    });
    setFechamentos(fs); renderPedidoDia();
  }catch(e){console.error('Correção de fechamentos antigos:',e);}
}
setTimeout(corrigirFechamentosAntigos,1200);
