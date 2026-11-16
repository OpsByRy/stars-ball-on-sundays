/* Payout movement against the first actual saved quote, per book and exact line. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.SBOS_PRICE_HISTORY=api;api.install(root);}})(typeof window==='undefined'?this:window,function(){
'use strict';
const ENDPOINT='https://sbos-pollers.stars-ball-on-sundays.workers.dev/price-history/';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)>=100;
const decimal=n=>valid(n)?1+(n>0?n/100:100/-n):null;
const odds=n=>(n>0?'+':'')+n;
const cache=new Map(),records=new Map();let browser=null,active=0,queue=[];
function direction(first,last){const delta=decimal(last)-decimal(first);return Math.abs(delta)<1e-10?'flat':delta>0?'up':'down';}
function pointsFor(points,current){
 if(!Array.isArray(points)||!valid(current.americanOdds)||!Number.isFinite(Date.parse(current.capturedAt)))return [];
 const end=Date.parse(current.capturedAt),map=new Map();
 for(const p of points)if(Array.isArray(p)&&valid(p[1])&&Number.isFinite(Date.parse(p[0]))&&Date.parse(p[0])<=end){if(map.has(p[0])&&map.get(p[0])!==p[1])return [];map.set(p[0],p[1]);}
 if(!map.size)return [];
 if(map.has(current.capturedAt)&&map.get(current.capturedAt)!==current.americanOdds)return [];
 map.set(current.capturedAt,current.americanOdds);
 return [...map].sort((a,b)=>Date.parse(a[0])-Date.parse(b[0]));
}
function spark(points){
 const values=points.map(p=>decimal(p[1])),base=values[0],lo=Math.min(...values,base),hi=Math.max(...values,base),span=Math.max(hi-lo,.04),min=lo-span*.18,max=hi+span*.18;
 const t0=Date.parse(points[0][0]),t1=Date.parse(points.at(-1)[0]),x=t=>6+(t1===t0?0:(Date.parse(t)-t0)/(t1-t0)*108),y=v=>24-(v-min)/(max-min)*21,by=y(base);
 const segments=[];
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],av=values[i-1],bv=values[i],ax=x(a[0]),bx=x(b[0]);
  const line=(x1,y1,x2,y2,tone)=>segments.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${tone==='up'?'#3dcb91':tone==='down'?'#f27882':'#e7ebf1'}" stroke-width="1.7"/>`);
  if((av-base)*(bv-base)<0){const cx=ax+(bx-ax)*(base-av)/(bv-av);line(ax,y(av),cx,by,av>base?'up':'down');line(cx,by,bx,y(bv),bv>base?'up':'down');}
  else line(ax,y(av),bx,y(bv),Math.max(av,bv)>base+1e-10?'up':Math.min(av,bv)<base-1e-10?'down':'flat');
 }
 return `<svg class="price-spark" viewBox="0 0 120 28" role="img" aria-label="${points.length} saved price observations, first ${esc(odds(points[0][1]))}, shown ${esc(odds(points.at(-1)[1]))}"><line x1="4" y1="${by.toFixed(2)}" x2="116" y2="${by.toFixed(2)}" stroke="#e7ebf1" stroke-opacity=".35" stroke-dasharray="2 3"/>${segments.join('')}${points.map((p,i)=>`<circle cx="${x(p[0]).toFixed(2)}" cy="${y(values[i]).toFixed(2)}" r="1.7" fill="${values[i]>base+1e-10?'#3dcb91':values[i]<base-1e-10?'#f27882':'#e7ebf1'}"><title>${esc(odds(p[1]))} · ${esc(p[0])}</title></circle>`).join('')}</svg>`;
}
function content(points,current,ambiguousAt=[]){const p=ambiguousAt.some(t=>Date.parse(t)===Date.parse(current.capturedAt))?[]:pointsFor(points,current);if(!p.length)return {tone:'unavailable',html:'Price history unavailable'};const first=p[0][1],last=p.at(-1)[1],tone=direction(first,last),label={up:'↑ Better payout',down:'↓ Lower payout',flat:'↔ Unchanged'}[tone];return {tone,html:`<span class="price-movement-label">${label}</span>${spark(p)}<span class="price-movement-base">First ${esc(odds(first))} · ${p.length} saved quotes</span>`};}
function queryFor(row,quote){if(row.group!=='research'||row.product!=='sportsbook'||(row.period||'full_game')!=='full_game'||row.overtime!=null||!row.playerId||!row.startTime||!['fanduel','draftkings'].includes(quote.book)||!valid(quote.americanOdds))return null;return {date:row.date,player:row.playerId,market:row.market,op:quote.operator||row.operator,line:quote.line??row.line,book:quote.book,start:row.startTime};}
function movementHTML(row){
 const quote=typeof window!=='undefined'?window.SBOS_BOOK_PRICES?.selectedQuote?.(row,row.book):null;
 const q=quote||{book:row.book,americanOdds:row.americanOdds,capturedAt:row.priceCapturedAt||row.capturedAt,operator:row.operator,line:row.line},query=queryFor(row,q);if(!query)return '';
 const key=JSON.stringify(query),id=encodeURIComponent(key);records.set(key,{query,current:q});const saved=cache.get(key),display=saved?.points?content(saved.points,q,saved.ambiguousAt):{tone:'unavailable',html:'Price history loading…'};
 return `<span class="price-movement ${display.tone}" data-price-movement="${esc(id)}" title="Payout compared with the first saved quote for this sportsbook and exact line. Green is better payout; red is lower; white is unchanged.">${display.html}</span>`;
}
function hydrate(){if(!browser)return;for(const el of browser.document.querySelectorAll('[data-price-movement]')){const key=decodeURIComponent(el.dataset.priceMovement),entry=records.get(key),saved=cache.get(key);if(!entry)continue;if(saved?.points){const d=content(saved.points,entry.current,saved.ambiguousAt),signature=d.tone+d.html;if(el.dataset.priceRendered!==signature){el.dataset.priceRendered=signature;el.className='price-movement '+d.tone;el.innerHTML=d.html;}}else if(!saved){cache.set(key,{loading:true});queue.push(key);pump();}else if(saved.failed&&el.textContent!=='Price history unavailable')el.textContent='Price history unavailable';}}
function pump(){while(active<4&&queue.length){const key=queue.shift(),r=records.get(key);if(!r)continue;active++;const {date,...params}=r.query;browser.fetch(ENDPOINT+date+'.json?'+new URLSearchParams(params),{credentials:'omit',cache:'no-store'}).then(async response=>{if(!response.ok)throw Error('No saved history');const b=await response.json();if(b.schema!=='public-price-history-1'||b.date!==date||b.playerId!==params.player||b.market!==params.market||b.operator!==params.op||b.line!==params.line||b.book!==params.book||Date.parse(b.start)!==Date.parse(params.start))throw Error('History contract mismatch');cache.set(key,{points:b.points,ambiguousAt:b.ambiguousAt||[]});}).catch(()=>cache.set(key,{failed:true})).finally(()=>{active--;hydrate();pump();});}}
function install(win){browser=win;const ready=()=>{new win.MutationObserver(()=>hydrate()).observe(win.document.body,{childList:true,subtree:true});hydrate();win.setInterval(()=>{cache.clear();hydrate();},120000);};if(win.document.readyState==='loading')win.document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();}
return {decimal,direction,pointsFor,spark,content,queryFor,movementHTML,install};
});
