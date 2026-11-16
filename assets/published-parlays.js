/* Immutable publication membership and statistical outcomes; no ticket selection. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./published-picks.js'):root.SBOS_PUBLISHED_PICKS);if(typeof module==='object'&&module.exports)module.exports=api;else root.SBOS_PUBLISHED_PARLAYS=api;})(typeof window==='undefined'?this:window,function(picks){
 'use strict';
 const clone=x=>JSON.parse(JSON.stringify(x)),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const stamp=x=>x&&Number.isFinite(Date.parse(x))?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}).format(new Date(x))+' ET':'Not recorded';
 const legs=t=>t.legs.map(l=>l.pick||l);
 const kind=t=>t.recordKind==='sgp_research_suggestion'?'same_game_research':t.priceKind==='model_target'?'model_target':'cross_game_reference';
 function key(t){const ids=legs(t).map(picks.key);if(ids.some(x=>!x))throw Error('Published ticket has incomplete leg identity');return JSON.stringify([kind(t),ids.sort()]);}
 function collect(snapshots,{withdrawals=[]}={}){
  if(!snapshots.length)return null;
  snapshots=[...snapshots].sort((a,b)=>Date.parse(a.entry.updatedAt)-Date.parse(b.entry.updatedAt));
  const records=new Map(),latest=snapshots.at(-1),facts=new Map();
  for(const {entry,body} of snapshots){
   const sgp=body.schemaVersion==='public-sgp-research-1';
   if(body.date!==latest.body.date)throw Error('Mixed parlay dates');
   const all=sgp?body.suggestions:[...(body.tickets||[]),...(body.modelTargets||[])];
   for(const t of all)for(const row of legs(t))facts.set(picks.key(row),picks.mergeResult(facts.get(picks.key(row)),row.result));
   if(!sgp&&!body.firstPublishedAt)continue;
   const posted=sgp?all:all.filter(t=>t.postedAt||body.schemaVersion==='public-plus-money-1');
   for(const ticket of posted){const id=key(ticket);if(!records.has(id))records.set(id,{key:id,kind:kind(ticket),original:clone(ticket),source:{folder:sgp?'sgp-research':'plus-money',path:entry.path,version:entry.version,id:ticket.id},firstPostedAt:sgp?body.postedAt||null:ticket.postedAt||null,firstSnapshotAt:entry.updatedAt,status:'active',history:[],revisions:[]});
    const r=records.get(id),quote={id:ticket.id,version:entry.version,priceKind:ticket.priceKind||null,book:ticket.book||ticket.priceSources||null,americanOdds:ticket.americanOdds??ticket.indicativeAmericanOdds??null};
    const prev=r.revisions.at(-1);if(!prev||['id','priceKind','book','americanOdds'].some(k=>prev[k]!==quote[k]))r.revisions.push(quote);
   }
   if(posted.length!==all.length)continue;
   const present=new Set(posted.map(key));
   for(const [id,r] of records){
    const explicit=withdrawals.find(w=>Date.parse(w.recordedAt)<=Date.parse(entry.updatedAt)&&w.date===body.date&&(w.ticketIds.includes(r.original.id)||JSON.stringify(w.legs.map(l=>JSON.stringify(l)).sort())===JSON.stringify(legs(r.original).map(l=>JSON.stringify([l.date,l.canonicalEventId||l.eventId,l.playerId,l.market,l.operator,l.line,l.period||'full_game'])).sort())));
    const prior=r.history.at(-1),status=explicit||!present.has(id)?'withdrawn':'active';
    const reason=explicit?.notice||(status==='withdrawn'?(prior?.status==='withdrawn'?prior.reason:'Removed by a later board refresh; reason not recorded.'):'Included in this published set.');
    if(!prior||prior.status!==status||prior.reason!==reason)r.history.push({status,observedAt:entry.updatedAt,effectiveAt:explicit?.recordedAt||null,reason,sourceVersion:entry.version});
    r.status=status;
   }
  }
  for(const r of records.values())r.legs=legs(r.original).map(original=>({original,result:facts.get(picks.key(original))||original.result||{eventStatus:'unknown',statisticalOutcome:'unavailable'}}));
  return {schemaVersion:'public-published-parlays-1',date:latest.body.date,sourceVersion:latest.entry.version,records:[...records.values()]};
 }
 function outcome(record){
  const rows=record.legs.map(l=>l.result||{}),voided=r=>['dnp','out','canceled','postponed'].includes(r.statisticalOutcome);
  if(rows.some(r=>r.eventStatus==='final'&&r.statisticalOutcome==='loss'))return 'loss';
  const active=rows.filter(r=>!voided(r));if(!active.length)return 'void';
  if(active.every(r=>r.eventStatus==='final'&&['win','push'].includes(r.statisticalOutcome)))return active.every(r=>r.statisticalOutcome==='push')?'void':'win';
  return rows.some(r=>r.eventStatus==='final'&&r.statisticalOutcome==='unavailable')?'unknown':'pending';
 }
 function summary(records){const s={total:records.length,active:0,withdrawn:0,hits:0,misses:0,voids:0,pending:0,unknown:0};for(const r of records){s[r.status==='withdrawn'?'withdrawn':'active']++;s[{win:'hits',loss:'misses',void:'voids',pending:'pending',unknown:'unknown'}[outcome(r)]]++;}return s;}
 function html(body,{lineLabel=r=>`${r.market} ${r.operator} ${r.line}`,base=''}={}){
  if(!body||body.schemaVersion!=='public-published-parlays-1'||!Array.isArray(body.records))throw Error('Invalid parlay publication history');
  const titles={cross_game_reference:'Published parlay references',same_game_research:'Same-game research suggestions',model_target:'Unquoted model targets'};
  return `<section class="pick-group published-pick-history" id="published-parlay-history"><h2>Every published parlay &amp; combination</h2><p>Withdrawals and replacements remain visible with their original legs and statistical outcomes. Current-board filters above do not change this full publication record. Research suggestions and model targets remain separately labeled; no sportsbook settlement, joint validation or profitability is implied.</p>${Object.entries(titles).map(([type,title])=>{
   const records=body.records.filter(r=>r.kind===type);if(!records.length)return '';const s=summary(records);
   return `<section><h3>${title} · ${s.total}</h3><p>${s.active} on board · ${s.withdrawn} withdrawn · ${s.hits} statistical hit · ${s.misses} statistical miss · ${s.voids} void · ${s.pending} pending · ${s.unknown} unknown</p>${type!=='cross_game_reference'?'<p>Research-only combinations; these totals are statistical tracking, not a record of accepted sportsbook tickets.</p>':''}<ol>${records.map(r=>{
    const e=r.history.at(-1),grade={win:'Hit',loss:'Miss',void:'Void',pending:'Pending',unknown:'Unknown'}[outcome(r)],safe=/^\d{4}-\d{2}-\d{2}\/[a-f0-9]{16}\.json$/.test(r.source.path),url=safe?new URL('data/'+r.source.folder+'/'+r.source.path,base||'https://invalid.local/').href:null;
    return `<li class="published-pick-history-row" data-published-status="${esc(r.status)}"><p><strong>${esc(r.status==='withdrawn'?'Withdrawn':'On board')} · ${grade}</strong> · ${r.legs.length} legs</p><p>Recorded posting time: ${esc(stamp(r.firstPostedAt))}. First saved edition: ${esc(stamp(r.firstSnapshotAt))}.</p>${r.status==='withdrawn'?`<p>${esc(e?.reason)} ${e?.effectiveAt?'Withdrawal recorded '+esc(stamp(e.effectiveAt))+'.':'First absent from saved refresh '+esc(stamp(e?.observedAt))+'. Withdrawal time not recorded.'}</p>`:''}<ul>${r.legs.map(({original:l,result})=>`<li>${esc(l.player)} · ${esc(lineLabel(l))} · original ${esc(l.book)} ${esc(typeof l.americanOdds==='number'?(l.americanOdds>0?'+':'')+l.americanOdds:'price not recorded')} · ${esc(result?.statisticalOutcome||'unknown')}${typeof result?.actual==='number'?' (actual '+esc(result.actual)+')':''}</li>`).join('')}</ul><details><summary>Publication changes &amp; original record</summary>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Original saved publication ↗</a>`:''}<ul>${r.history.map(e=>`<li>${esc(e.status)} · saved refresh ${esc(stamp(e.observedAt))} · ${esc(e.reason)}</li>`).join('')}</ul><p>${r.revisions.length} saved identity / quote revisions; counted once for these exact statistical outcomes.</p></details></li>`;
   }).join('')}</ol></section>`;
  }).join('')}</section>`;
 }
 return {legs,key,kind,collect,outcome,summary,html};
});
