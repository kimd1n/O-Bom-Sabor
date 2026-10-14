(function(){
  document.addEventListener('keydown',function(e){
    if(e.key!=='Escape') return;
    const ids=['modal-ficha-detalhes-overlay','modal-editar-item-overlay','modal-backups-nuvem-overlay','modal-apagar-overlay'];
    for(const id of ids){const el=document.getElementById(id);if(el&&getComputedStyle(el).display!=='none'){el.style.display='none';document.body.style.overflow='';break;}}
  });
  window.addEventListener('resize',function(){
    document.querySelectorAll('.tabela-wrap').forEach(x=>{if(x.scrollLeft>x.scrollWidth-x.clientWidth)x.scrollLeft=0});
  });
})();
