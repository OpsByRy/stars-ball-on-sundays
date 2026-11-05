const test=require('node:test'),assert=require('node:assert/strict');
const math=require('../assets/ticket-probability.js'),pm=require('../assets/plus-money.js');
const NOW=Date.parse('2026-11-01T19:00:00Z'),copy=x=>JSON.parse(JSON.stringify(x));
const leg=(id,event='0000001001',p=.8)=>({id:'synthetic-'+id,player:'Fictional '+id,playerId:'nba:'+id,date:'2026-11-01',eventId:'nba:'+event,canonicalEventId:'nba:'+event,startTime:'2026-11-02T01:00:00Z',market:'PTS',operator:'>=',side:'over',line:15,period:'full_game',product:'sportsbook',overtime:true,settlementTerms:'synthetic-reference',book:'fictional',estimate:{winProbability:p,pushProbability:0,lossProbability:1-p,status:'provisional',asOf:'2026-11-01T18:00:00Z',modelVersion:'synthetic-marginal-1'}});
const cross=()=>({id:'fictional-cross',status:'provisional',priceKind:'indicative',legs:[leg('101'),leg('102','0000001002',.7)]});
const read=t=>math.evaluate(t,{now:NOW});
function joint(rows,p=.6,push=0){return {schemaVersion:'sbos-event-joint-probability-1',eventId:rows[0].canonicalEventId,date:rows[0].date,contractKeys:rows.map(math.contractKey),method:'paired-role-residual-v1',reviewStatus:'reviewed_provisional',validationStatus:'reviewed_supported',modelVersion:'synthetic-joint-1',sourceHash:'a'.repeat(64),artifactHash:'b'.repeat(64),sampleGames:40,conditionalOnAllPlayersAppearing:true,asOf:'2026-11-01T18:00:00Z',completedAt:'2026-11-01T18:01:00Z',reviewedAt:'2026-11-01T18:02:00Z',winProbability:p,pushProbability:push,lossProbability:1-p-push,marginals:rows.map((r,i)=>({contractKey:math.contractKey(r),winProbability:i?.8:.7}))};}
function legacy(){const rows=[leg('101'),leg('102','0000001001',.7)];rows[1].market='AST';rows[1].line=4;return {id:'fictional-legacy',priceKind:'model_target',status:'provisional',compatibility:'Fictional descriptive context',legs:rows,jointEstimate:{asOf:'2026-11-01T18:00:00Z',winProbability:.7,pushProbability:0,lossProbability:.3,fairAmericanOdds:-233,minimumAmericanOdds:-110,lowerProbability:.5,upperProbability:.8,sampleGames:40,method:'Synthetic historical joint',reviewStatus:'reviewed_provisional',reviewedAt:'2026-11-01T18:02:00Z'}};}

for(const mutation of ['none','future-review','at-tip-review','third-same-game','unavailable-other-game'])test('legacy scalar cannot bypass complete group/source checks: '+mutation,()=>{
 const t=legacy();if(mutation==='future-review')t.jointEstimate.reviewedAt='2026-11-03T12:00:00Z';if(mutation==='at-tip-review')t.jointEstimate.reviewedAt=t.legs[0].startTime;
 if(mutation==='third-same-game'||mutation==='unavailable-other-game'){const r=leg('103',mutation==='third-same-game'?'0000001001':'0000001002');delete r.estimate;t.legs.push(r);}
 const original=JSON.stringify(t);assert.equal(pm.isModelTarget(t),true);assert.equal(pm.totalSlipProbability(t,{now:NOW}).probability,null);assert.match(pm.probabilityHTML(t),/Unavailable/);assert.match(pm.ticketRow(t,0),/Saved original joint estimate/);assert.match(pm.ticketRow(t,0),/legacy scalar is audit-only/);assert.equal(JSON.stringify(t),original);
});
test('a legacy row can use only a separately complete typed artifact, leaving the old scalar audit-only',()=>{
 const t=legacy();t.eventJointEstimates=[joint(t.legs)];const r=pm.totalSlipProbability(t,{now:NOW});assert.equal(r.probability,.6);assert.notEqual(r.probability,t.jointEstimate.winProbability);
 assert.match(pm.probabilityHTML(t),/~60%/);const html=pm.ticketRow(t,0);assert.match(html,/Saved original joint estimate:<\/strong> 70\.0%/);assert.match(html,/legacy scalar is audit-only/);
 t.legs.push(leg('103','0000001002',.5));assert.equal(pm.totalSlipProbability(t,{now:NOW}).probability,.3);
 delete t.legs[2].estimate;assert.equal(pm.totalSlipProbability(t,{now:NOW}).probability,null);
});
for(const q of ['does_not_qualify','unavailable'])test('available review cannot silently clear explicit qualification '+q,()=>{
 const t=cross(),r=t.legs[0];r.confidenceUpdate={status:'available',qualification:q,checkedAt:r.estimate.asOf,estimate:copy(r.estimate)};const before=JSON.stringify(t);
 assert.equal(read(t).reason,'leg_review_hold');assert.equal(pm.totalSlipProbability(t,{now:NOW}).probability,null);assert.match(pm.probabilityHTML(t),/Unavailable/);assert.equal(JSON.stringify(t),before);
 const sg=legacy();sg.eventJointEstimates=[joint(sg.legs)];sg.legs[0].confidenceUpdate={...r.confidenceUpdate};assert.equal(read(sg).reason,'leg_review_hold');
});
test('matching qualification remains usable without altering the source snapshot',()=>{const t=cross(),r=t.legs[0];r.confidenceUpdate={status:'available',qualification:'qualifies',checkedAt:r.estimate.asOf,estimate:copy(r.estimate)};assert.equal(read(t).probability,.8*.7);});
test('exact strict push contract and equivalent inclusive win outcome have separate artifact keys',()=>{
 const a=leg('101'),b=leg('102');a.operator='>';a.line=15;a.estimate={...a.estimate,winProbability:.7,pushProbability:.1,lossProbability:.2};b.market='AST';b.line=4;
 const inclusive=copy(a);inclusive.operator='>=';inclusive.line=16;inclusive.estimate.pushProbability=0;inclusive.estimate.lossProbability=.3;
 assert.notEqual(math.contractKey(a),math.contractKey(inclusive));
 const t={legs:[a,b],eventJointEstimates:[joint([inclusive,b])]};assert.equal(read(t).reason,'joint_group_evidence_invalid');
 const distribution=[[16,4,.6],[15,4,.1],[16,3,.1],[14,4,.1],[14,3,.1]],all=distribution.filter(([x,y])=>x>15&&y>=4).reduce((s,r)=>s+r[2],0),noLoss=distribution.filter(([x,y])=>x>=15&&y>=4).reduce((s,r)=>s+r[2],0);
 t.eventJointEstimates=[joint([a,b],all,noLoss-all)];const r=read(t);assert.equal(r.probability,all);assert.ok(Math.abs(r.noLossProbability-.7)<1e-12);assert.ok(Math.abs(r.pushWithoutLossProbability-.1)<1e-12);
 const duplicate={legs:[a,{...inclusive,id:'equivalent-win'}]};assert.equal(read(duplicate).reason,'duplicate_outcome');
 const under={...a,side:'under',operator:'<',line:15},inclusiveUnder={...under,operator:'<=',line:14};assert.notEqual(math.contractKey(under),math.contractKey(inclusiveUnder));assert.equal(read({legs:[under,inclusiveUnder]}).reason,'duplicate_outcome');
});
for(const id of ['just-a-name','espn:101','nba:0','nba:001','nba:-101',101])test('unsupported player identity rejects without name inference: '+id,()=>{const t=cross();t.legs[0].playerId=id;assert.equal(read(t).reason,'exact_native_contract_missing');});
test('joint contract keys retain exact sportsbook identity while duplicate win outcomes ignore it',()=>{const a=leg('101'),b={...a,book:'other-fixture-book'};assert.notEqual(math.contractKey(a),math.contractKey(b));assert.equal(read({legs:[a,b]}).reason,'duplicate_outcome');delete a.book;assert.equal(math.contractKey(a),null);});
test('NBA slate date must be the New York date of the exact scheduled instant, including DST and midnight',()=>{
 const t=cross();t.legs[0].date='2026-11-02';assert.equal(read(t).reason,'exact_native_contract_missing');
 const r=leg('101');r.startTime='2026-11-02T04:59:59.999999999Z';assert.notEqual(math.contractKey(r),null);r.startTime='2026-11-02T05:00:00Z';assert.equal(math.contractKey(r),null);r.date='2026-11-02';assert.notEqual(math.contractKey(r),null);
 r.startTime='2026-11-01T04:30:00Z';r.date='2026-11-01';assert.notEqual(math.contractKey(r),null);r.startTime='2026-11-01T03:30:00Z';assert.equal(math.contractKey(r),null);r.date='2026-10-31';assert.notEqual(math.contractKey(r),null);
});
for(const value of [false,null,'true','false',1])test('explicit unsupported participation scope is unavailable: '+JSON.stringify(value),()=>{const t=cross();t.legs[0].estimate.conditionalOnAppearing=value;assert.equal(read(t).reason,'forecast_scope_unverified');assert.match(math.explanation(read(t)),/explicit forecast scope/);});
test('explicit conditional scope and legacy unrecorded scope remain distinguishable',()=>{
 const t=cross(),legacy=read(t);assert.equal(legacy.legSources[0].conditionalOnAppearing,null);assert.equal(legacy.conditionalScopeComplete,false);assert.match(math.explanation(legacy),/do not record appearance scope/);
 t.legs.forEach(r=>r.estimate.conditionalOnAppearing=true);const explicit=read(t);assert.equal(explicit.probability,legacy.probability);assert.equal(explicit.conditionalScopeComplete,true);assert.equal(explicit.legSources[0].conditionalOnAppearing,true);assert.doesNotMatch(math.explanation(explicit),/do not record appearance scope/);
});
for(const key of ['scope','forecastScope','probabilityScope','conditionalOnAllPlayersAppearing'])test('alternate marginal scope claims require a reviewed adapter: '+key,()=>{const t=cross();t.legs[0].estimate[key]='unconditional';assert.equal(read(t).reason,'forecast_scope_unverified');});
test('nonunit probability cannot round to an apparent hundred percent',()=>{const t=cross();t.legs.forEach(r=>{r.estimate.winProbability=.999;r.estimate.lossProbability=.001;});const r=read(t);assert.ok(r.probability<1);assert.equal(math.format(r.probability),'>99%');assert.match(pm.probabilityHTML(t),/>99%/);assert.equal(math.format(1),'~100%');assert.equal(math.format(0),'~0%');});
