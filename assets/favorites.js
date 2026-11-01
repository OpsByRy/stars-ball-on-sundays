/* Personal Favorites navigation. Display choices never change saved selections or wagers. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.SBOS_FAVORITES=api;api.init();}})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const readTab=search=>new URLSearchParams(search).get('favorites_view')==='parlays'?'parlays':'picks';
  function searchWithTab(search,tab){const params=new URLSearchParams(search);if(tab==='parlays')params.set('favorites_view','parlays');else params.delete('favorites_view');return params.toString();}
  function shell({id='ry-favorites',tab='picks',pickCount=0,parlayCount=0,picksHTML='',parlaysHTML=''}){
    const selected=tab==='parlays'?'parlays':'picks';
    return `<section class="favorites-view" data-favorites-view><div class="daily-tabs favorites-tabs" role="tablist" aria-label="Ry’s Favorites">${[['picks','Picks',pickCount],['parlays','Parlays',parlayCount]].map(([key,label,count])=>`<button type="button" role="tab" id="${escape(id)}-tab-${key}" aria-controls="${escape(id)}-panel-${key}" aria-selected="${selected===key}" tabindex="${selected===key?'0':'-1'}" data-favorites-tab="${key}"><span>${label}</span><strong>${count}</strong></button>`).join('')}</div>${[['picks',picksHTML],['parlays',parlaysHTML]].map(([key,html])=>`<section id="${escape(id)}-panel-${key}" role="tabpanel" aria-labelledby="${escape(id)}-tab-${key}" tabindex="0" data-favorites-panel="${key}"${selected===key?'':' hidden'}>${html}</section>`).join('')}</section>`;
  }
  function select(view,tab){
    for(const node of view.querySelectorAll('[data-favorites-tab]')){const active=node.dataset.favoritesTab===tab;node.setAttribute('aria-selected',String(active));node.tabIndex=active?0:-1;}
    for(const panel of view.querySelectorAll('[data-favorites-panel]'))panel.hidden=panel.dataset.favoritesPanel!==tab;
  }
  function init(){
    const activate=tab=>{select(tab.closest('[data-favorites-view]'),tab.dataset.favoritesTab);const url=new URL(location.href);url.search=searchWithTab(url.search,tab.dataset.favoritesTab);if(url.href!==location.href)history.pushState(null,'',url);};
    document.addEventListener('click',event=>{const tab=event.target.closest('[data-favorites-tab]');if(tab)activate(tab);});
    document.addEventListener('keydown',event=>{
      const tab=event.target.closest('[data-favorites-tab]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const tabs=[...tab.closest('[role="tablist"]').querySelectorAll('[data-favorites-tab]')],index=tabs.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
      tabs[next].focus();activate(tabs[next]);
    });
    window.addEventListener('popstate',()=>{for(const view of document.querySelectorAll('[data-favorites-view]'))select(view,readTab(location.search));});
  }
  return {readTab,searchWithTab,shell,select,init};
});
