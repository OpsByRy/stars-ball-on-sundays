/* Published-board finalization presentation. Never writes a selection or source clock. */
(function(root){'use strict';
 const core=root.SBOS_BOARD_LIFECYCLE_CORE||(typeof module==='object'&&module.exports?require('./board-lifecycle-core.js'):null);if(!core)return;
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const endpoint='https://sbos-pollers.stars-ball-on-sundays.workers.dev/board-lifecycle/',cache=new Map(),states=new Map();
 const clock=x=>Number.isFinite(Date.parse(x))?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}).format(new Date(x))+' ET':'Not recorded';
 const price=n=>Number.isFinite(n)?(n>0?'+':'')+String(n).replace('-','−'):'Not recorded';
 const label=r=>`${r.operator==='>='?r.line+'+':r.operator==='>'?'Over '+r.line:r.operator==='<'?'Under '+r.line:r.line+' or fewer'} ${{PTS:'points',REB:'rebounds',AST:'assists','3PM':'threes',BLK:'blocks',STL:'steals',PRA:'points + rebounds + assists',PR:'points + rebounds',PA:'points + assists',RA:'rebounds + assists'}[r.market]||r.market}`;
 async function json(url){const r=await fetch(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Published record unavailable');return r.json();}
 async function data(day,force=false){if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Invalid date');const known=cache.get(day);if(!force&&known&&Date.now()-known.loadedAt<45000)return known.value;
  const value=await json(endpoint+day+'.json');if(value.schemaVersion!=='public-board-lifecycle-1'||value.date!==day||value.effectiveDate!==core.EFFECTIVE||!Array.isArray(value.locks))throw Error('Finalization record mismatch');
  for(const lock of value.locks){if(lock.date!==day||lock.policyVersion!==core.POLICY||!Number.isFinite(core.instant(lock.cutoffAt))||!Array.isArray(lock.singles)||!Array.isArray(lock.tickets))throw Error('Invalid finalization record');}
  cache.set(day,{value,loadedAt:Date.now()});return value;
 }
 const id=r=>root.SBOS_PUBLISHED_PICKS?.key(r)||core.statKey(r),resultMap=history=>new Map((history?.records||[]).map(r=>[r.key,r.result]));
 async function decorate(body,base=new URL('/',location.href),kind='single'){
  if(!body||!/^\d{4}-\d{2}-\d{2}$/.test(body.date))return body;
  const out={...body};
  try{out._boardLifecycle=body.date<core.EFFECTIVE?{active:false,date:body.date,locks:[]}:await data(body.date);}catch{out._boardLifecycle={active:body.date>=core.EFFECTIVE,unavailable:true,date:body.date,locks:[]};}
  if(kind==='parlay')try{out._parlayHistory=await json(new URL('data/published-parlays/'+body.date+'.json',base));}catch{}
  const l=out._boardLifecycle;if(!l.active||l.unavailable)return out;
  const locked=new Set(l.locks.map(g=>g.gameId));
  if(kind==='single'&&body.channel==='daily'){
   const stats=new Map((body.props||[]).map(r=>[id(r),r.result])),frozen=l.locks.flatMap(g=>g.singles),ids=new Set(frozen.map(r=>r.row.id));
   out.props=(body.props||[]).filter(r=>!(r.group==='research'&&locked.has(core.eventId(r))&&(r.selected===true||['value_safe','high_probability_aggressive','free_throws','floaters','lobs'].includes(r.category)||ids.has(r.id))));
   for(const item of frozen){const row={...item.row,selected:true};if(stats.has(id(row)))row.result=stats.get(id(row));out.props.push(row);}
  }else if(kind==='parlay'){
   const frozen=[...new Map(l.locks.flatMap(g=>g.tickets).map(t=>[t.exactKey,t])).values()];
   out.tickets=(body.tickets||[]).filter(t=>!core.legs(t).some(r=>locked.has(core.eventId(r))));
   const facts=resultMap(out.publishedPickHistory);for(const r of out._parlayHistory?.records||[])for(const leg of r.legs)facts.set(id(leg.original),leg.result);
   for(const item of frozen){const savedRow=(leg)=>({...leg.row,...(facts.has(id(leg.row))?{result:facts.get(id(leg.row))}:{})});out.tickets.push({...item.original,boardFinalization:{exactKey:item.exactKey,firstPostedAt:item.firstPostedAt},legs:item.original.legs.map((raw,i)=>raw.pick?{...raw,pick:savedRow(item.legs[i])}:savedRow(item.legs[i]))});}
  }
  return out;
 }
 const ticketOutcome=(t,facts)=>{
  const rows=t.legs.map(l=>facts.get(id(l.row||l.original))||{}),voided=r=>['dnp','out','canceled','postponed'].includes(r.statisticalOutcome);
  if(rows.some(r=>r.eventStatus==='final'&&r.statisticalOutcome==='loss'))return {eventStatus:'final',statisticalOutcome:'loss'};
  const active=rows.filter(r=>!voided(r));if(!active.length)return {eventStatus:'final',statisticalOutcome:'void'};
  if(active.every(r=>r.eventStatus==='final'&&['win','push'].includes(r.statisticalOutcome)))return {eventStatus:'final',statisticalOutcome:active.every(r=>r.statisticalOutcome==='push')?'void':'win',repricingRequired:rows.some(r=>voided(r)||r.statisticalOutcome==='push')};
  return {eventStatus:rows.some(r=>r.eventStatus==='final'&&r.statisticalOutcome==='unavailable')?'final':'scheduled',statisticalOutcome:'unavailable'};
 };
 function rowsFor(body,kind,basis){
  const l=body._boardLifecycle||{},history=body.publishedPickHistory,parlays=body._parlayHistory;
  if(kind==='single'){
   if(basis==='final')return (l.locks||[]).flatMap(g=>g.singles);
   const originals=l.allPublishedSingles||(history?.records||[]).map(r=>r.original);return originals.map(row=>({key:id(row)||row.id,row,stakeUnits:core.stake(row),quote:{americanOdds:row.americanOdds,observedAt:row.capturedAt,book:row.book}}));
  }
  if(basis==='final')return [...new Map((l.locks||[]).flatMap(g=>g.tickets).map(t=>[t.exactKey,t])).values()];
  return (l.allPublishedParlays||parlays?.records||[]).filter(r=>r.kind==='cross_game_reference').map(r=>({key:r.key,original:r.original,legs:r.legs,stakeUnits:core.stake(r.original,'parlay'),quote:{americanOdds:r.original.americanOdds??r.original.indicativeAmericanOdds,kind:r.original.priceKind==='indicative'||r.original.indicativeAmericanOdds!==undefined?'indicative':r.original.priceKind}}));
 }
 function html(body,kind='single'){
  const l=body._boardLifecycle||{},legacy=body.date<core.EFFECTIVE,basis=legacy?'all':states.get(body.date+':'+kind)||'final';
  const history=body.publishedPickHistory,parlays=body._parlayHistory,facts=resultMap(history);
  for(const r of parlays?.records||[])for(const leg of r.legs)facts.set(id(leg.original),leg.result);
  const rows=rowsFor(body,kind,basis),s=core.grade(rows,r=>kind==='single'?facts.get(id(r.row)):ticketOutcome(r,facts));
  const games=l.games||[],locks=l.locks||[],count=locks.length,all=games.length&&count===games.length;
  const title=legacy?'Published Board':l.unavailable?'Board Review Pending':all?'Finalized Board':count?'Board in Progress':'Preliminary Board';
  const schedule=`<div class="bl-schedule"><span><b>12:00 PM</b>Preliminary review</span><span><b>3:00 PM</b>Afternoon refresh</span><span><b>5:30 PM</b>Pregame refresh</span><span><b>Tip − 30 min</b>Finalized by game</span></div>`;
  const activeGames=games.map(g=>{const lock=locks.find(x=>x.gameId===g.id),cutoff=new Date(Date.parse(g.startTime)-1800000).toISOString(),passed=Date.now()>=Date.parse(cutoff);return `<div class="bl-game"><b>${esc(g.matchup||g.id)}</b><span>${lock?'🔒 Final selection cutoff ':passed?'Review held · cutoff ':'Locks '}${clock(cutoff)}</span>${lock?`<small>Recorded ${clock(lock.recordedAt)} · source observed ${clock(lock.sourceObservedAt)}</small>`:''}</div>`;}).join('');
  const table=rows.length?`<details class="bl-record-details"><summary>Selections behind this record · ${rows.length}</summary><div class="bl-saved-grid">${rows.map(r=>kind==='single'?`<article><b>${esc(r.row.player)}</b><span>${esc(label(r.row))}</span><small>${esc(r.row.book)} · ${price(r.quote.americanOdds)} · ${r.stakeUnits}u</small></article>`:`<article><b>${r.legs.length}-leg ${r.quote?.kind==='indicative'?'reference':'ticket'}</b>${r.legs.map(l=>`<span>${esc((l.row||l.original).player)} · ${esc(label(l.row||l.original))}</span>`).join('')}<small>${r.quote?.kind==='indicative'?'Saved estimated price':'Saved price'} ${price(r.quote?.americanOdds)} · ${r.stakeUnits??'—'}u</small></article>`).join('')}</div></details>`:'';
  const commitments=locks.flatMap(lock=>lock.tickets.map(ticket=>({lock,ticket}))).filter(({ticket})=>ticket.legs.some(leg=>!locks.some(l=>l.gameId===core.eventId(leg.row))));
  return `<section class="bl-panel" data-bl-date="${esc(body.date)}" data-bl-kind="${kind}"><div class="bl-heading"><div><p class="bl-kicker">${legacy?'EXISTING PUBLICATION RECORD':'DAILY SELECTION TRACKING'}</p><h2>${title}</h2></div><span>${legacy?'Policy starts November 17':count+' of '+games.length+' games finalized'}</span></div>${legacy?'<p class="bl-note">The final-board record begins November 17, 2026. Existing picks, parlays and their original grading remain intact.</p>':`<p class="bl-note">Selections finalize by game, 30 minutes before tip. Every earlier recommendation stays in All Published.${l.unavailable?' Finalization data is unavailable; no selection is labeled final.':''}</p>${schedule}<p class="bl-clock">Last published board saved: ${clock(l.lastBoardSavedAt)} · Snapshot checked: ${clock(l.lastCheckedAt)}. Quote and selection times remain on each pick.</p><div class="bl-games">${activeGames}</div>`}<div class="bl-record-top"><h3>${basis==='final'?'Final Board':'All Published'} · ${kind==='single'?'singles':'parlay references'}</h3>${!legacy?`<div class="bl-basis" role="group" aria-label="Grading record"><button type="button" data-bl-basis="final" aria-pressed="${basis==='final'}">Final Board</button><button type="button" data-bl-basis="all" aria-pressed="${basis==='all'}">All Published</button></div>`:''}</div><div class="bl-metrics"><span><b>${s.hits}–${s.misses}</b>Hits–misses</span><span><b>${legacy?'—':(s.units>=0?'+':'−')+Math.abs(s.units).toFixed(2)+'u'}</b>Illustrative net units</span><span><b>${legacy||s.roi===null?'—':(s.roi*100).toFixed(1)+'%'}</b>Settled-stake ROI</span><span><b>${s.pending+s.unknown}</b>Pending / unknown</span><span><b>${s.voids+s.pushes}</b>Void / push</span></div><p class="bl-note">${basis==='final'?'Uses the exact saved contracts, prices and stake basis at finalization.':'Every original published recommendation, including withdrawals and replacements, at its original price.'} ${kind==='parlay'?'Statistical ticket references remain separately labeled; estimated prices are not verified offered quotes or sportsbook settlement.':'Singles and parlay records are separate.'}${s.unpriced?' '+s.unpriced+' unpriced records are excluded from unit calculations.':''}</p>${kind==='parlay'?'<p class="bl-ticket-rule"><b>Early + late games can share a parlay.</b> The complete ticket freezes before its earliest game. Every later leg stays committed to that ticket while its standalone pick remains open until its own cutoff.</p>':''}${commitments.length?`<div class="bl-commitments"><h3>Later legs already committed to finalized parlays</h3>${commitments.map(({lock,ticket})=>`<p>🔒 <b>${ticket.legs.map(l=>esc(l.row.player)).join(' + ')}</b><br>Exact ticket legs saved at the ${clock(lock.cutoffAt)} cutoff. Later standalone selections remain separately reviewable.</p>`).join('')}</div>`:''}${(l.alerts||[]).length?`<details class="bl-late-news" open><summary>Updates affecting finalized selections · ${l.alerts.length}</summary>${l.alerts.map(a=>`<p><b>${clock(a.observedAt)}</b> ${esc(a.reason)}</p>`).join('')}</details>`:''}${table}</section>`;
 }
 function paint(body,kind,host){if(!host)return;host.innerHTML=html(body,kind);host.querySelectorAll('[data-bl-basis]').forEach(b=>b.onclick=()=>{states.set(body.date+':'+kind,b.dataset.blBasis);paint(body,kind,host);});}
 function mount(body,kind,anchor){api.current={body,kind};let host=document.getElementById('board-lifecycle-panel');if(!host){host=document.createElement('div');host.id='board-lifecycle-panel';anchor.before(host);}host._blBody=body;host._blKind=kind;paint(body,kind,host);}
 function bind(){document.querySelectorAll('.bl-panel').forEach(panel=>{if(panel.dataset.blBound)return;panel.dataset.blBound='1';panel.querySelectorAll('[data-bl-basis]').forEach(button=>button.onclick=()=>{const body=panel._blBody||root.SBOS_BOARD_LIFECYCLE.current?.body;if(!body)return;states.set(body.date+':'+panel.dataset.blKind,button.dataset.blBasis);const holder=panel.parentElement;paint(body,panel.dataset.blKind,holder);});});
  const state=root.SBOS_BOARD_LIFECYCLE.current;if(!state)return;const l=state.body._boardLifecycle;if(!l?.active)return;
  const legs=(l.locks||[]).flatMap(lock=>lock.tickets.flatMap(t=>t.legs.map(leg=>({leg,lock}))));
  for(const row of document.querySelectorAll('[data-pick-id]')){const list=legs.filter(x=>x.leg.row.id===row.dataset.pickId);if(!list.length||row.querySelector('.bl-row-commitment'))continue;const note=document.createElement('p');note.className='bl-row-commitment';note.textContent='🔒 Included in a finalized parlay · '+clock(list[0].lock.cutoffAt)+' · exact leg retained in the ticket record.';row.append(note);}
 }
 const api={decorate,html:(body,kind='single')=>{api.current={body,kind};return html(body,kind);},mount,core};root.SBOS_BOARD_LIFECYCLE=api;
 async function resultsPage(){
  const anchor=document.getElementById('daily-history');if(!anchor)return;const base=new URL('/',location.href),controls=document.createElement('div');controls.className='bl-results-controls';anchor.before(controls);
  try{const manifest=await json(new URL('data/editions/manifest.json',base)),dates=[...new Set(manifest.editions.filter(e=>e.channel==='daily'&&e.date>=core.EFFECTIVE).map(e=>e.date))].sort().reverse();
   if(!dates.length){controls.innerHTML='<section class="bl-panel"><p class="bl-kicker">FINAL BOARD RECORD</p><h2>Starts November 17</h2><p class="bl-note">Finalized selections will be tracked here prospectively. Every existing pick, ticket, original price and historical result remains in the records below.</p></section>';return;}
   controls.innerHTML='<label>Final-board date <select id="bl-results-date">'+dates.map(d=>'<option>'+esc(d)+'</option>').join('')+'</select></label><label>Record <select id="bl-results-kind"><option value="single">Singles</option><option value="parlay">Parlay references</option></select></label>';
   const load=async()=>{const day=document.getElementById('bl-results-date').value,kind=document.getElementById('bl-results-kind').value;let history=null;try{history=await json(new URL('data/published-picks/daily/'+day+'.json',base));}catch{}const body=await api.decorate({date:day,channel:'daily',props:[],publishedPickHistory:history},base,kind);mount(body,kind,anchor);};
   controls.querySelectorAll('select').forEach(s=>s.onchange=()=>void load());await load();
  }catch{controls.innerHTML='<p class="bl-note">The final-board record is temporarily unavailable. Existing published history remains below.</p>';}
 }
 function start(){if(!document.body)return;void resultsPage();let timer;new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(bind,80);}).observe(document.body,{childList:true,subtree:true});bind();setInterval(async()=>{const current=api.current;if(!current||current.body.date<core.EFFECTIVE)return;try{const before=current.body._boardLifecycle,next=await data(current.body.date,true);if(api.current!==current)return;const changed=JSON.stringify(before?.locks)!==JSON.stringify(next.locks);current.body._boardLifecycle=next;try{current.body.publishedPickHistory=await json(new URL('data/published-picks/daily/'+current.body.date+'.json',location.origin));}catch{}if(current.kind==='parlay')try{current.body._parlayHistory=await json(new URL('data/published-parlays/'+current.body.date+'.json',location.origin));}catch{}if(changed){const refresh=document.getElementById(current.kind==='parlay'?'refresh-parlays':'reload-data');if(refresh)refresh.click();}else{const host=document.getElementById('board-lifecycle-panel');if(host)paint(current.body,current.kind,host);}}catch{}},60000);}
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(typeof document==='undefined')return;
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(typeof window==='undefined'?globalThis:window);
