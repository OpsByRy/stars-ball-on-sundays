/* Public URL vocabulary. Stored publication identities and categories never change. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.SBOS_ROUTES=api;const script=document.querySelector('script[data-sbos-routes]');if(script&&document.body?.dataset.redirectRoute){const base=new URL('../',script.src),next=api.canonicalURL(location.href,base);if(next.href!==location.href)location.replace(next.href);}}})(typeof window==='undefined'?this:window,function(){
  'use strict';
  const names={all:'all',value_safe:'layups',high_probability_aggressive:'lobs',honorable_mention:'bench'};
  const ids={all:'all',layups:'value_safe',lobs:'high_probability_aggressive',bench:'honorable_mention',value_safe:'value_safe',high_probability_aggressive:'high_probability_aggressive',honorable_mention:'honorable_mention'};
  const categoryId=value=>Object.hasOwn(ids,value)?ids[value]:'all';
  const categoryName=value=>names[categoryId(value)];
  function boardSearch(search){const p=new URLSearchParams(search);if(p.has('type'))p.set('type',categoryName(p.get('type')));return p.toString();}
  function parlayType(search='',hash=''){
    const fragment=String(hash).replace(/^#/,'');
    if(fragment==='plus-money')return 'plus_money';if(fragment==='longshots')return 'longshots';
    const type=new URLSearchParams(search).get('type');return ['plus_money','longshots'].includes(type)?type:'all';
  }
  function parlayLocation(search='',type='all'){
    const p=new URLSearchParams(search);p.delete('type');return {search:p.size?'?'+p.toString():'',hash:type==='plus_money'?'#plus-money':type==='longshots'?'#longshots':''};
  }
  function canonicalURL(input,base){
    const root=new URL(base),url=new URL(input,root);if(url.origin!==root.origin||!url.pathname.startsWith(root.pathname))return url;
    let relative=url.pathname.slice(root.pathname.length).replace(/^\//,'');
    if(/^plus-money\/?(?:index\.html)?$/.test(relative))relative='parlays/';
    else if(/^archive\/?(?:index\.html)?$/.test(relative))relative='results/';
    else if(/^philosophy\/?(?:index\.html)?$/.test(relative))relative='about/';
    else {const sunday=/^archive\/sundays\/(\d{4}-\d{2}-\d{2})\/(?:index\.html)?$/.exec(relative);if(sunday){relative='sundays/week.html';if(!url.searchParams.has('date'))url.searchParams.set('date',sunday[1]);}}
    url.pathname=root.pathname+relative;
    if(/^daily\/?(?:index\.html)?$/.test(relative)&&url.searchParams.has('type'))url.searchParams.set('type',categoryName(url.searchParams.get('type')));
    if(url.searchParams.has('board'))url.searchParams.set('board',boardSearch(url.searchParams.get('board')));
    if(/^parlays\/?(?:index\.html)?$/.test(relative)){
      const type=parlayType(url.search,url.hash);if(type!=='all'||['#plus-money','#longshots'].includes(url.hash)){const state=parlayLocation(url.search,type);url.search=state.search;url.hash=state.hash;}
    }
    return url;
  }
  return {categoryId,categoryName,boardSearch,parlayType,parlayLocation,canonicalURL};
});
