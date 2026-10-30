/* Public URL vocabulary. Stored publication identities and categories never change. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.SBOS_ROUTES=api;const script=document.querySelector('script[data-sbos-routes]');if(script&&document.body?.dataset.redirectRoute){const base=new URL('../',script.src),next=api.canonicalURL(location.href,base);if(next.href!==location.href)location.replace(next.href);}}})(typeof window==='undefined'?this:window,function(){
  'use strict';
  const names={all:'all',value_safe:'layups',high_probability_aggressive:'lobs',honorable_mention:'bench',free_throws:'free-throws',floaters:'floaters'};
  const ids={all:'all',layups:'value_safe',lobs:'high_probability_aggressive',bench:'honorable_mention',value_safe:'value_safe',high_probability_aggressive:'high_probability_aggressive',honorable_mention:'honorable_mention','free-throws':'free_throws',free_throws:'free_throws',floaters:'floaters'};
  const current=day=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&day>='2026-10-30';
  function categoryId(value,day){const id=Object.hasOwn(ids,value)?ids[value]:'all';return current(day)&&id==='value_safe'?'free_throws':id;}
  const categoryName=(value,day)=>names[categoryId(value,day)];
  function boardSearch(search){const p=new URLSearchParams(search);if(p.has('type'))p.set('type',categoryName(p.get('type'),p.get('date')));return p.toString();}
  const parlayHashes={plus_money:'plus-money',layups:'layups',mid_range:'mid-range',same_game:'same-game',longshots:'longshots',logo_lottos:'logo-lottos'};
  function parlayType(search='',hash='',day){
    const p=new URLSearchParams(search),date=day||p.get('date'),fragment=String(hash).replace(/^#/,'');
    const fragmentType=Object.entries(parlayHashes).find(([,value])=>value===fragment)?.[0]||(['sgp-plus','sgpx'].includes(fragment)?'same_game':null);
    const requested=fragmentType||(Object.hasOwn(parlayHashes,p.get('type'))?p.get('type'):'all');
    return current(date)?requested==='plus_money'?'layups':requested==='same_game'?'all':requested:requested;
  }
  function sameGameFilter(search='',hash='',day){const p=new URLSearchParams(search),date=day||p.get('date');return p.get('sameGame')==='1'||current(date)&&(['same-game','sgp-plus','sgpx'].includes(String(hash).replace(/^#/,''))||p.get('type')==='same_game');}
  function parlayLocation(search='',type='all',options={}){
    const p=new URLSearchParams(search),date=options.date||p.get('date');p.delete('type');
    let chosen=type;
    if(current(date)){if(chosen==='plus_money')chosen='layups';if(chosen==='same_game'){chosen='all';p.set('sameGame','1');}}
    if(options.sameGame===true)p.set('sameGame','1');else if(options.sameGame===false)p.delete('sameGame');
    return {search:p.size?'?'+p.toString():'',hash:parlayHashes[chosen]?'#'+parlayHashes[chosen]:''};
  }
  function canonicalURL(input,base){
    const root=new URL(base),url=new URL(input,root);if(url.origin!==root.origin||!url.pathname.startsWith(root.pathname))return url;
    let relative=url.pathname.slice(root.pathname.length).replace(/^\//,'');
    if(/^plus-money\/?(?:index\.html)?$/.test(relative)){relative='parlays/';if(!url.hash&&!url.searchParams.has('type'))url.hash='#plus-money';}
    else if(/^archive\/?(?:index\.html)?$/.test(relative))relative='results/';
    else if(/^philosophy\/?(?:index\.html)?$/.test(relative))relative='about/';
    else {const sunday=/^archive\/sundays\/(\d{4}-\d{2}-\d{2})\/(?:index\.html)?$/.exec(relative);if(sunday){relative='sundays/week.html';if(!url.searchParams.has('date'))url.searchParams.set('date',sunday[1]);}}
    url.pathname=root.pathname+relative;
    if(/^daily\/?(?:index\.html)?$/.test(relative)&&url.searchParams.has('type'))url.searchParams.set('type',categoryName(url.searchParams.get('type'),url.searchParams.get('date')));
    if(url.searchParams.has('board'))url.searchParams.set('board',boardSearch(url.searchParams.get('board')));
    if(/^parlays\/?(?:index\.html)?$/.test(relative)){
      const type=parlayType(url.search,url.hash);if(type!=='all'||sameGameFilter(url.search,url.hash)){const state=parlayLocation(url.search,type,{sameGame:sameGameFilter(url.search,url.hash)});url.search=state.search;url.hash=state.hash;}
    }
    return url;
  }
  return {categoryId,categoryName,boardSearch,parlayType,sameGameFilter,parlayLocation,canonicalURL};
});
