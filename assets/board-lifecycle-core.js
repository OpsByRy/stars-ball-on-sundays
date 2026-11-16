/* Prospective published-board accounting. No selection/model/quote generation. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SBOS_BOARD_LIFECYCLE_CORE=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
 'use strict';
 const EFFECTIVE='2026-11-17',POLICY='sbos-board-lifecycle-1',clone=x=>JSON.parse(JSON.stringify(x));
 const instant=x=>typeof x==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x))?Date.parse(x):NaN;
 const eventId=r=>r.canonicalEventId||r.eventId;
 function exactKey(r){if(!r||!/^\d{4}-\d{2}-\d{2}$/.test(r.date||'')||!eventId(r)||!r.playerId||!r.market||!['>','<','>=','<='].includes(r.operator)||!Number.isFinite(r.line)||!['fanduel','draftkings'].includes(r.book))throw Error('Invalid exact published contract');return JSON.stringify([r.date,eventId(r),r.playerId,r.market,r.operator,r.line,r.period||'full_game',r.product||'sportsbook',r.overtime??null,r.book]);}
 function statKey(r){let op={gte:'>=',lte:'<=',gt:'>',lt:'<'}[r?.operator]||r?.operator,line=r?.line;if(!r?.playerId||!eventId(r)||!['>','<','>=','<='].includes(op)||!Number.isFinite(line))return null;if(op==='>=')line=Math.ceil(line);else if(op==='<=')line=Math.floor(line);else if(!Number.isInteger(line)){line=op==='>'?Math.ceil(line):Math.floor(line);op=op==='>'?'>=':'<=';}return JSON.stringify([r.date,eventId(r),r.playerId,r.market,op,line,r.period||'full_game',r.product||'sportsbook',r.overtime??null]);}
 const legs=t=>(t.legs||[]).map(l=>l.pick||l);
 const ticketKey=t=>JSON.stringify([t.recordKind||t.priceKind||'reference',t.book||t.priceSources||null,legs(t).map(exactKey).sort()]);
 function deadline(row){const times=row.legs?legs(row).map(r=>instant(r.startTime)):[instant(row.startTime)];if(!times.length||times.some(t=>!Number.isFinite(t)))throw Error('Known game time required');return new Date(Math.min(...times)-1800000).toISOString();}
 function stake(r,kind='single'){
  if(Number.isFinite(r.stakeUnits)&&r.stakeUnits>=0)return r.stakeUnits;
  const o=r.americanOdds??r.indicativeAmericanOdds;if(!Number.isFinite(o)||Math.abs(o)<100)return null;
  if(kind==='parlay')return o<=200?1:o<500?.5:o<1000?.25:.05;
  return o<=-250?2:o< -110?1:.75;
 }
 const qualified=r=>r.selected===true&&r.group==='research'&&!['unavailable','review'].includes(r.confidenceUpdate?.status)&&r.confidenceUpdate?.qualification!=='does_not_qualify'&&r.priceCheck?.qualification!=='does_not_qualify';
 function validateInput(input,now){
  if(input?.schemaVersion!=='public-board-revisions-1'||input.date<EFFECTIVE||input.effectiveDate!==EFFECTIVE||!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!/^[a-f0-9]{24}$/.test(input.version)||!Array.isArray(input.current?.rows)||!Array.isArray(input.allPublishedSingles)||!Array.isArray(input.tickets)||!input.games||Array.isArray(input.games))throw Error('Invalid public board revisions');
  if(!Number.isFinite(instant(input.current.sourceAt))||instant(input.current.sourceAt)>now||!/^data\/editions\/daily\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{16}\.json$/.test(input.current.sourcePath))throw Error('Invalid publication source clock/path');
  if(input.current.rows.length>500||input.allPublishedSingles.length>2500||input.tickets.length>500||Object.keys(input.games).length>30)throw Error('Published board exceeds bounds');
  for(const r of [...input.current.rows,...input.allPublishedSingles]){exactKey(r);if(r.date!==input.date||!Number.isFinite(instant(r.postedAt))||instant(r.postedAt)>now||!Number.isFinite(instant(r.startTime)))throw Error('Unposted or undated selection');if(!Number.isFinite(r.americanOdds)||Math.abs(r.americanOdds)<100)throw Error('Saved quote required');}
  for(const [id,g]of Object.entries(input.games))if(id!==g.id||!/^[a-zA-Z0-9:_-]{1,80}$/.test(id)||!Number.isFinite(instant(g.startTime)))throw Error('Invalid game identity/time');
  for(const t of input.tickets){if(!Array.isArray(t.legs)||t.legs.length<2||t.legs.length>20)throw Error('Invalid ticket membership');for(const l of t.legs){exactKey(l.original);if(l.original.date!==input.date||!Number.isFinite(instant(l.original.startTime)))throw Error('Invalid ticket leg');}}
  return input;
 }
 function freeze(input,game,observedAt,recordedAt){
  const cutoff=new Date(instant(game.startTime)-1800000).toISOString(),cut=instant(cutoff);
  if(instant(observedAt)>cut||instant(recordedAt)<cut)throw Error('No prospectively observed source at cutoff');
  const original=new Map(input.allPublishedSingles.map(r=>[exactKey(r),r]));
  const selected=input.current.rows.filter(r=>eventId(r)===game.id&&instant(r.postedAt)<=cut);
  const singles=selected.filter(qualified).map(r=>({key:exactKey(r),row:clone(r),firstPostedAt:original.get(exactKey(r))?.postedAt||r.postedAt,stakeUnits:stake(original.get(exactKey(r))||r),quote:{book:r.book,americanOdds:r.americanOdds,observedAt:r.capturedAt||null},sourceVersion:input.current.version}));
  const held=selected.filter(r=>!qualified(r)).map(r=>({key:exactKey(r),reason:r.confidenceUpdate?.summary||'The latest published eligibility review holds this selection.'}));
  const tickets=[];
  for(const record of input.tickets.filter(t=>t.status==='active'&&t.kind==='cross_game_reference')){
   const t=record.original,rows=record.legs.map(l=>l.original),times=rows.map(r=>instant(r.startTime));
   const firstGame=rows.filter(r=>instant(r.startTime)===Math.min(...times)).map(eventId).sort()[0];if(game.id!==firstGame)continue;
   if(Math.min(...times)-1800000!==cut||!rows.some(r=>eventId(r)===game.id)||!Number.isFinite(instant(record.firstPostedAt))||instant(record.firstPostedAt)>cut)continue;
   const valid=rows.every(r=>qualified({...r,selected:true,group:'research'})&&instant(r.capturedAt)<=cut);
   if(!valid){held.push({key:record.key,reason:'The published ticket contains a held or unpriced leg.'});continue;}
   // An indicative price remains an indicative price. Never multiply leg prices or probabilities.
   const quote=Number.isFinite(t.americanOdds)?{americanOdds:t.americanOdds,kind:t.priceKind||'saved_quote',observedAt:t.capturedAt||null}:Number.isFinite(t.indicativeAmericanOdds)?{americanOdds:t.indicativeAmericanOdds,kind:'indicative',observedAt:t.capturedAt||null}:null;
   tickets.push({key:record.key,exactKey:ticketKey(t),original:clone(t),kind:record.kind,firstPostedAt:record.firstPostedAt,quote,stakeUnits:stake(t,'parlay'),legs:rows.map(r=>({key:exactKey(r),row:clone(r),firstPostedAt:r.postedAt||record.firstPostedAt,quote:{book:r.book,americanOdds:r.americanOdds,observedAt:r.capturedAt||null},committedAt:cutoff})),source:clone(record.source)});
  }
  return {schemaVersion:'public-board-game-lock-1',policyVersion:POLICY,date:input.date,gameId:game.id,game:clone(game),cutoffAt:cutoff,recordedAt,reviewedAt:recordedAt,sourceObservedAt:observedAt,sourceVersion:input.current.version,sourcePath:input.current.sourcePath,singles,tickets,held};
 }
 function statusAt(record,cutoff){return [...(record.history||[])].filter(e=>instant(e.observedAt)<=instant(cutoff)).at(-1)?.status||null;}
 function alertsFor(locks,input,at){
  const active=new Map(input.current.rows.filter(qualified).map(r=>[exactKey(r),r])),alerts=[];
  for(const lock of locks){const rows=[...lock.singles.map(s=>({key:s.key,row:s.row,ticketKey:null})),...lock.tickets.flatMap(t=>t.legs.map(l=>({...l,ticketKey:t.key})))];
   for(const r of rows)if(!active.has(r.key))alerts.push({gameId:lock.gameId,key:r.key,ticketKey:r.ticketKey,observedAt:at,sourceVersion:input.current.version,reason:'A later published board no longer recommends '+r.row.player+' '+r.row.market+' '+r.row.operator+' '+r.row.line+'. The finalized selection and any committed ticket leg remain in the record.'});
  }return alerts;
 }
 function decimal(n){return n>0?1+n/100:1+100/-n;}
 function grade(rows,resultFor){const s={count:rows.length,hits:0,misses:0,pushes:0,voids:0,pending:0,unknown:0,units:0,risk:0,unpriced:0,indicative:0};
  for(const r of rows){const result=resultFor(r)||{},o=result.outcome||result.statisticalOutcome,status=result.eventStatus;
   const outcome=['dnp','out','canceled','postponed','void'].includes(o)?'voids':o==='push'&&status==='final'?'pushes':o==='win'&&status==='final'?'hits':o==='loss'&&status==='final'?'misses':status==='final'?'unknown':'pending';s[outcome]++;
   const q=r.quote?.americanOdds??r.row?.americanOdds,units=r.stakeUnits;if(r.quote?.kind==='indicative')s.indicative++;
   if(result.repricingRequired||!Number.isFinite(q)||Math.abs(q)<100||!Number.isFinite(units)){s.unpriced++;continue;}
   if(['hits','misses','pushes'].includes(outcome)){s.risk+=units;s.units+=outcome==='hits'?units*(decimal(q)-1):outcome==='misses'?-units:0;}
  }s.roi=s.risk?s.units/s.risk:null;return s;
 }
 return {EFFECTIVE,POLICY,instant,eventId,exactKey,statKey,ticketKey,legs,deadline,stake,qualified,validateInput,freeze,statusAt,alertsFor,grade};
});
