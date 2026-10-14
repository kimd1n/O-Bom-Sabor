(function(){
  const anterior=window.atualizarPlataforma;
  window.atualizarPlataforma=function(){
    if(typeof anterior==='function') anterior();
    const campo=document.getElementById('campo-tipo-beneficio');
    if(campo) campo.style.display='';
    atualizarTipoBeneficio();
  };
  document.addEventListener('DOMContentLoaded',()=>{ atualizarTipoBeneficio(); window.atualizarPlataforma(); });
})();
