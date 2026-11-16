const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const history=require('../assets/published-picks.js'),refresher=require('../scripts/refresh-results.cjs'),generator=require('../scripts/published-picks.cjs');
const day='2026-11-14',at='2026-11-14T16:00:00Z';
const row=(id='a',extra={})=>({id,date:day,group:'research',category:'value_safe',selected:true,postedAt:at,player:'Test Player',playerId:'nba:1',canonicalEventId:'nba:0022600001',market:'PTS',operator:'>',line:9.5,period:'full_game',product:'sportsbook',book:'fanduel',americanOdds:-200,capturedAt:at,startTime:'2026-11-14T20:00:00Z',resultSource:{eventId:'123',athleteId:'456',expectedTeam:'DET'},result:{eventStatus:'scheduled',statisticalOutcome:'pending',sportsbookSettlement:'unverified'},...extra});
function snapshot(props,time=at,extra={}){
 const body={schemaVersion:'public-1',date:day,channel:'daily',timezone:'America/New_York',firstPublishedAt:at,updatedAt:time,props,...extra};body.version=refresher.version(body);
 return {body,entry:{date:day,channel:'daily',version:body.version,path:`daily/${day}/${body.version}.json`,updatedAt:time,count:0,researchCount:props.length}};
}
test('two published picks survive an empty replacement with original contracts and prices intact',()=>{
 const first=snapshot([row(),row('b',{playerId:'nba:2',americanOdds:150})]),before=JSON.stringify(first);
 const body=history.collect([first,snapshot([],'2026-11-14T18:00:00Z')]);
 assert.deepEqual(history.summary(body.records),{total:2,active:0,withdrawn:2,hits:0,misses:0,pushes:0,voids:0,pending:2});
 assert.equal(body.records[0].original.americanOdds,-200);assert.equal(body.records[0].firstPostedAt,at);
 assert.match(body.records[0].history.at(-1).reason,/reason not recorded/);assert.equal(body.records[0].history.at(-1).effectiveAt,null);
 assert.equal(JSON.stringify(first),before);
});
test('unposted builds and carried clocks cannot create picks or early withdrawals',()=>{
 const a=row(),b=row('b',{playerId:'nba:2'});
 assert.equal(history.collect([snapshot([row('candidate',{postedAt:null})],at,{firstPublishedAt:null})]).records.length,0);
 const body=history.collect([snapshot([a,b]),snapshot([a,row('new',{playerId:'nba:3',postedAt:null})],'2026-11-14T17:00:00Z')]);
 assert.equal(body.records.length,2);assert.ok(body.records.every(r=>r.status==='active'));
});
test('equivalent outcomes deduplicate across quote, book and ID refreshes without erasing originals',()=>{
 const body=history.collect([snapshot([row()]),snapshot([row('changed',{operator:'>=',line:10,americanOdds:-180,book:'draftkings',capturedAt:'2026-11-14T17:00:00Z'})],'2026-11-14T17:00:00Z')]);
 assert.equal(body.records.length,1);assert.equal(body.records[0].revisions.length,2);assert.equal(body.records[0].original.id,'a');assert.equal(body.records[0].original.book,'fanduel');
 assert.notEqual(history.key(row('strict',{operator:'>',line:10})),history.key(row('milestone',{operator:'>=',line:11})));
 assert.notEqual(history.key(row()),history.key(row('terms',{overtime:true})));
});
test('a changed line stays a separate publication rather than rewriting the earlier pick',()=>{
 const body=history.collect([snapshot([row()]),snapshot([row('higher',{line:11.5})],'2026-11-14T17:00:00Z')]);
 assert.equal(body.records.length,2);assert.equal(body.records[0].status,'withdrawn');assert.equal(body.records[1].status,'active');
 assert.deepEqual(body.records.map(r=>r.original.line),[9.5,11.5]);
});
test('a failed quote lookup does not withdraw a selected pick or refresh its observation clock',()=>{
 const pick=row(),body=history.collect([snapshot([pick]),snapshot([{...pick,priceCheck:{status:'not_returned',checkedAt:'2026-11-14T18:00:00Z'}}],'2026-11-14T18:00:00Z')]);
 assert.equal(body.records[0].status,'active');assert.equal(body.records[0].original.capturedAt,at);assert.equal(body.records[0].revisions.length,1);
});
test('documented withdrawals and reinstatements retain their complete state changes',()=>{
 const drop={...row(),confidenceUpdate:{status:'unavailable',qualification:'does_not_qualify',checkedAt:'2026-11-14T17:00:00Z',summary:'Official report: player out.'}};
 const body=history.collect([snapshot([row()]),snapshot([drop],'2026-11-14T17:00:00Z'),snapshot([row()],'2026-11-14T18:00:00Z')]);
 assert.deepEqual(body.records[0].history.map(e=>e.status),['active','withdrawn','active']);assert.equal(body.records[0].history[1].effectiveAt,drop.confidenceUpdate.checkedAt);assert.equal(body.records[0].history[1].reason,drop.confidenceUpdate.summary);
});
test('a later omission cannot erase an already recorded withdrawal reason',()=>{
 const drop={...row(),confidenceUpdate:{status:'unavailable',qualification:'does_not_qualify',checkedAt:'2026-11-14T17:00:00Z',summary:'Official report: player out.'}};
 const body=history.collect([snapshot([row()]),snapshot([drop],'2026-11-14T17:00:00Z'),snapshot([],'2026-11-14T18:00:00Z')]);
 assert.equal(body.records[0].history.length,2);assert.equal(body.records[0].history.at(-1).reason,drop.confidenceUpdate.summary);
});
test('later non-selected observations resolve removed picks without adding passed research',()=>{
 const result={eventStatus:'final',statisticalOutcome:'loss',actual:8,checkedAt:'2026-11-15T00:00:00Z'};
 const body=history.collect([snapshot([row()]),snapshot([row('passed',{selected:false,postedAt:null,category:'not_a_pick',result}),row('never-picked',{selected:false,postedAt:null,playerId:'nba:99'})],'2026-11-15T00:00:00Z')]);
 assert.equal(body.records.length,1);assert.equal(body.records[0].status,'withdrawn');assert.equal(history.summary(body.records).misses,1);assert.equal(body.records[0].original.result.statisticalOutcome,'pending');
});
test('final results do not regress to pending; newer final corrections remain possible',()=>{
 const final={eventStatus:'final',statisticalOutcome:'win',actual:10,checkedAt:'2026-11-15T00:00:00Z'};
 assert.equal(history.mergeResult(final,{eventStatus:'scheduled',statisticalOutcome:'pending'}),final);
 assert.equal(history.mergeResult(final,{...final,statisticalOutcome:'loss',actual:9,checkedAt:'2026-11-15T01:00:00Z'}).statisticalOutcome,'loss');
});
test('HTML shows withdrawal and result independently, escapes reasons, and links the original source',()=>{
 const body=history.collect([snapshot([row('safe',{player:'<script>x</script>'})]),snapshot([],'2026-11-14T18:00:00Z')]);
 body.records[0].result={eventStatus:'final',statisticalOutcome:'loss',actual:8};
 const html=history.html(body,{base:'https://example.com/'});
 assert.match(html,/Withdrawn/);assert.match(html,/Miss/);assert.match(html,/Withdrawal time not recorded/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/data\/editions\/daily/);assert.match(html,/0 hit · 1 missed/);
});
test('personal picks and Bench rows are excluded from the algorithm publication census',()=>{
 assert.equal(history.collect([snapshot([row('personal',{group:'ry'}),row('bench',{category:'honorable_mention',selected:false})])]).records.length,0);
});
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sbos-published-history-'));
 const first=snapshot([row()]),last=snapshot([],'2026-11-14T18:00:00Z');
 const put=(name,body)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(body));};
 for(const s of [first,last])put('data/editions/'+s.entry.path,s.body);
 put('data/editions/manifest.json',{schemaVersion:'public-1',editions:[first.entry,last.entry]});put('data/stat-targets.json',{targets:[]});
 return {root,first,last,put};
}
test('results refresh grades removed picks without replacing the current board or altering immutable bodies',async()=>{
 const f=fixture();try{
  const files=['data/editions/manifest.json','data/editions/'+f.first.entry.path,'data/editions/'+f.last.entry.path],before=files.map(p=>fs.readFileSync(path.join(f.root,p),'utf8'));
  const options={directory:f.root,now:new Date('2026-11-15T02:00:00Z'),fetchJSON:async()=>({header:{id:'123',competitions:[{status:{type:{completed:true,state:'post'}}}]},boxscore:{players:[{team:{abbreviation:'DET'},statistics:[{labels:['PTS','MIN'],athletes:[{athlete:{id:'456'},stats:['8','25']}]}]}]}})};
  const r=await refresher.refresh(options);assert.equal(r.editions,0);assert.equal(r.publishedPickResults,1);assert.equal(r.sourceFailures,0);
  assert.deepEqual(files.map(p=>fs.readFileSync(path.join(f.root,p),'utf8')),before);
  const body=Object.values(generator.views(f.root))[0];assert.equal(body.records[0].status,'withdrawn');assert.equal(history.summary(body.records).misses,1);
  const sidecar=fs.readFileSync(path.join(f.root,'data/published-selection-results.json'),'utf8');
  await refresher.refresh({...options,now:new Date('2026-11-15T02:10:00Z')});assert.equal(fs.readFileSync(path.join(f.root,'data/published-selection-results.json'),'utf8'),sidecar);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('invalid result sidecars and mismatched immutable source digests fail closed',()=>{
 const f=fixture();try{
  f.put('data/published-selection-results.json',{schemaVersion:'public-published-selection-results-1',results:{[history.key(row())]:{eventStatus:'final',statisticalOutcome:'win',actual:null}}});assert.throws(()=>generator.views(f.root),/Final result/);
  fs.unlinkSync(path.join(f.root,'data/published-selection-results.json'));
  const body={...f.first.body,priceNote:'altered'};f.put('data/editions/'+f.first.entry.path,body);assert.throws(()=>generator.views(f.root),/digest mismatch/);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('history-only backfill grades vanished cross-game and same-game tickets without rolling back the board',async()=>{
 const f=fixture();try{
  const a=row('leg-a'),b=row('leg-b',{player:'Second player',playerId:'nba:2',resultSource:{eventId:'123',athleteId:'789',expectedTeam:'DET'}});
  const putCross=(tickets,time)=>{const body={schemaVersion:'public-plus-money-2',date:day,firstPublishedAt:at,updatedAt:time,tickets};body.version=refresher.version(body);const entry={date:day,version:body.version,path:day+'/'+body.version+'.json',updatedAt:time,count:tickets.length};f.put('data/plus-money/'+entry.path,body);return entry;};
  const first=putCross([{id:'published-ticket',postedAt:at,priceKind:'indicative',legs:[a,b],indicativeAmericanOdds:125}],at),last=putCross([],'2026-11-14T18:00:00Z');
  f.put('data/plus-money/manifest.json',{schemaVersion:'public-plus-money-manifest-1',editions:[first,last]});
  const sgp={schemaVersion:'public-sgp-research-1',date:day,postedAt:null,suggestions:[{id:'research-ticket',recordKind:'sgp_research_suggestion',legs:[{pick:a},{pick:b}]}]};sgp.version=refresher.version(sgp);
  const relative=day+'/'+sgp.version+'.json';f.put('data/sgp-research/'+relative,sgp);const raw=fs.readFileSync(path.join(f.root,'data/sgp-research',relative));
  f.put('data/sgp-research/manifest.json',{schemaVersion:'public-sgp-research-index-1',editions:[{date:day,version:sgp.version,path:relative,sha256:require('node:crypto').createHash('sha256').update(raw).digest('hex'),count:1,updatedAt:at}]});
  const before=fs.readFileSync(path.join(f.root,'data/plus-money/manifest.json'),'utf8');let calls=0;
  const options={directory:f.root,historyOnly:true,now:new Date('2026-11-25T02:00:00Z'),fetchJSON:async()=>{calls++;return {header:{id:'123',competitions:[{status:{type:{completed:true,state:'post'}}}]},boxscore:{players:[{team:{abbreviation:'DET'},statistics:[{labels:['PTS','MIN'],athletes:[{athlete:{id:'456'},stats:['8','25']},{athlete:{id:'789'},stats:['20','30']}]}]}]}};}};
  await refresher.refresh(options);assert.equal(calls,0,'ordinary refresh window stays unchanged');
  const r=await refresher.refresh({...options,allHistory:true});assert.equal(r.editions,0);assert.equal(r.parlayEditions,0);assert.equal(r.sourceFailures,0);assert.equal(calls,1,'shared public box score fetched once');
  const all=Object.values(generator.views(f.root)).find(b=>b.schemaVersion==='public-published-parlays-1');
  assert.equal(all.records.length,2);assert.equal(require('../assets/published-parlays.js').outcome(all.records[0]),'loss');assert.equal(require('../assets/published-parlays.js').outcome(all.records[1]),'loss');
  assert.equal(fs.readFileSync(path.join(f.root,'data/plus-money/manifest.json'),'utf8'),before);assert.deepEqual(fs.readFileSync(path.join(f.root,'data/sgp-research',relative)),raw);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
