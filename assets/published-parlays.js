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
  // A withdrawal register can advance without another immutable board snapshot.
  // Apply that recorded event after replaying snapshots, using its own clock.
  for(const r of records.values()){
   const explicit=withdrawals.filter(w=>w.date===latest.body.date&&Date.parse(w.recordedAt)>Date.parse(latest.entry.updatedAt)&&(w.ticketIds.includes(r.original.id)||JSON.stringify(w.legs.map(l=>JSON.stringify(l)).sort())===JSON.stringify(legs(r.original).map(l=>JSON.stringify([l.date,l.canonicalEventId||l.eventId,l.playerId,l.market,l.operator,l.line,l.period||'full_game'])).sort()))).sort((a,b)=>Date.parse(a.recordedAt)-Date.parse(b.recordedAt)).at(-1);
   if(explicit){r.status='withdrawn';r.history.push({status:'withdrawn',observedAt:explicit.recordedAt,effectiveAt:explicit.recordedAt,reason:explicit.notice,sourceVersion:latest.entry.version});}
   r.legs=legs(r.original).map(original=>({original,result:facts.get(picks.key(original))||original.result||{eventStatus:'unknown',statisticalOutcome:'unavailable'}}));
  }
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
  const card=r=>{const e=r.history.at(-1),grade={win:'Hit',loss:'Miss',void:'Void',pending:'Pending',unknown:'Unknown'}[outcome(r)],tone={Hit:'hit',Miss:'miss',Pending:'pending'}[grade]||'neutral',icon={Hit:'✓',Miss:'×',Pending:'◷'}[grade]||'—';
   const safe=/^\d{4}-\d{2}-\d{2}\/[a-f0-9]{16}\.json$/.test(r.source.path),url=safe?new URL('data/'+r.source.folder+'/'+r.source.path,base||'https://invalid.local/').href:null;
   return `<article class="published-pick-history-row history-card history-parlay-card" data-published-status="${esc(r.status)}"><header class="history-card-top"><div class="history-avatar-stack">${r.legs.slice(0,3).map(l=>picks.graphic(l.original,{base})).join('')}</div><div><h4>${r.legs.length}-leg ${r.kind==='same_game_research'?'same-game research':'parlay reference'}</h4><span class="history-status">${r.status==='withdrawn'?'↶ Withdrawn':'On board'}</span></div><span class="history-outcome ${tone}"><b aria-hidden="true">${icon}</b>${grade}</span></header>${r.status==='withdrawn'?`<p class="history-reason">${esc(picks.reasonSummary(e))}</p>`:''}${typeof r.original.indicativeAmericanOdds==='number'?`<p class="history-card-meta">Original estimated price <strong>${r.original.indicativeAmericanOdds>0?'+':''}${esc(r.original.indicativeAmericanOdds)}</strong></p>`:''}<ul class="history-leg-list">${r.legs.map(({original:l,result})=>`<li><span><strong>${esc(l.player)}</strong><small>${esc(lineLabel(l))} · ${esc({fanduel:'FanDuel',draftkings:'DraftKings'}[l.book]||l.book||'Book unrecorded')}</small></span><span><strong>${esc(typeof l.americanOdds==='number'?(l.americanOdds>0?'+':'')+l.americanOdds:'—')}</strong><small>${esc(result?.statisticalOutcome||'unknown')}${typeof result?.actual==='number'?' · '+esc(result.actual):''}</small></span></li>`).join('')}</ul><details class="history-audit"><summary>Publication changes &amp; original record</summary><p>Recorded posting time: ${esc(stamp(r.firstPostedAt))}. First saved edition: ${esc(stamp(r.firstSnapshotAt))}.</p>${r.status==='withdrawn'?`<p>${e?.effectiveAt?'Withdrawal recorded '+esc(stamp(e.effectiveAt))+'.':'First absent from saved refresh '+esc(stamp(e?.observedAt))+'. Withdrawal time not recorded.'}</p>`:''}${e?.reason?`<p>${esc(e.reason)}</p>`:''}${e?.explanationRecordedAt?`<p>Explanation recorded ${esc(stamp(e.explanationRecordedAt))}.</p>`:''}${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Original saved publication ↗</a>`:''}<ul>${r.history.map(x=>`<li>${esc(x.status)} · saved refresh ${esc(stamp(x.observedAt))} · ${esc(x.reason)}</li>`).join('')}</ul><p>${r.revisions.length} saved identity / quote revisions; counted once for these exact statistical outcomes.</p>${r.kind!=='cross_game_reference'?'<p>Research-only combinations. No verified whole-ticket quote or joint probability.</p>':''}</details></article>`;};
  const all=summary(body.records),withdrawn=body.records.filter(r=>r.status==='withdrawn'),active=body.records.filter(r=>r.status!=='withdrawn');
  return `<section class="pick-group published-pick-history" id="published-parlay-history"><header class="history-section-top"><span class="history-section-icon" aria-hidden="true">↶</span><div><p class="history-eyebrow">THE COMPLETE RECORD</p><h2>Withdrawn &amp; replaced parlays <span class="history-count">${all.withdrawn}</span></h2><p>Original legs. Original prices. Every outcome.</p></div></header><div class="history-score-strip"><span><b>${all.total}</b> published</span><span><b>${all.active}</b> on board</span><span><b>${all.withdrawn}</b> withdrawn</span><span><b>${all.hits}</b> hit</span><span><b>${all.misses}</b> missed</span><span><b>${all.pending}</b> pending</span></div>${Object.entries(titles).map(([type,title])=>{const rows=body.records.filter(r=>r.kind===type);if(!rows.length)return '';const s=summary(rows);return `<p class="history-kind-summary"><strong>${title} · ${s.total}</strong> · ${s.hits} hit / ${s.misses} missed${type!=='cross_game_reference'?' · Research-only combinations':''}</p>`;}).join('')}<div id="withdrawn-parlays" class="withdrawn-grid">${withdrawn.map(card).join('')||'<p class="history-empty">No withdrawn parlays for this slate.</p>'}</div>${active.length?`<details class="history-active"><summary>On-board publication records · ${active.length}</summary><div class="withdrawn-grid">${active.map(card).join('')}</div></details>`:''}<p class="history-caption">Every published parlay &amp; combination remains in the record. Statistical results are not verified sportsbook settlement. Research suggestions and model targets remain separately labeled.</p></section>`;
 }
 return {legs,key,kind,collect,outcome,summary,html};
});
