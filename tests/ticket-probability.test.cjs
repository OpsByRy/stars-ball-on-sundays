const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const math=require('../assets/ticket-probability.js'),pm=require('../assets/plus-money.js');
const NOW=Date.parse('2026-11-01T19:00:00Z');
const leg=(id,event='0022600154',p=.8,extra={})=>({id,player:'Fixture '+id,playerId:'nba:'+id,date:'2026-11-01',eventId:'nba:'+event,canonicalEventId:'nba:'+event,
 startTime:'2026-11-02T01:00:00Z',market:'PTS',operator:'>=',line:15,period:'full_game',product:'sportsbook',overtime:true,settlementTerms:'fixture-statistical-full-game',
 book:'fanduel',americanOdds:-300,capturedAt:'2026-11-01T17:00:00Z',estimate:{status:'provisional',winProbability:p,pushProbability:0,lossProbability:1-p,asOf:'2026-11-01T18:00:00Z',modelVersion:'fixture-marginal-1'},...extra});
const cross=()=>({id:'fixture-cross',status:'provisional',priceKind:'indicative',legs:[leg('1'),leg('2','0022600155',.7)]});
const read=t=>math.evaluate(t,{now:NOW});
function joint(rows,p=.6){return {schemaVersion:'sbos-event-joint-probability-1',eventId:rows[0].canonicalEventId,date:rows[0].date,contractKeys:rows.map(math.contractKey),
 method:'paired-role-residual-v1',reviewStatus:'reviewed_provisional',validationStatus:'reviewed_supported',modelVersion:'fixture-joint-1',
 sourceHash:'a'.repeat(64),artifactHash:'b'.repeat(64),sampleGames:40,conditionalOnAllPlayersAppearing:true,
 asOf:'2026-11-01T18:00:00Z',completedAt:'2026-11-01T18:01:00Z',reviewedAt:'2026-11-01T18:02:00Z',
 winProbability:p,pushProbability:0,lossProbability:1-p,marginals:rows.map((r,i)=>({contractKey:math.contractKey(r),winProbability:i?.7:.8}))};}
test('different-game saved marginals give a visibly qualified all-win approximation',()=>{
 const t=cross(),before=JSON.stringify(t),r=read(t);assert.equal(r.status,'approximate');assert.ok(Math.abs(r.probability-.56)<1e-12);
 assert.equal(r.basis,'cross_game_independence');assert.equal(r.settlementWinProbability,null);assert.equal(r.participationProbability,null);
 assert.equal(r.bookmakerImpliedProbability,null);assert.match(math.explanation(r),/Different games can still share risk/);assert.match(math.explanation(r),/not a frozen whole-ticket/);
 assert.match(pm.probabilityHTML(t),/independence approx/);assert.match(pm.probabilityHTML(t),/~56%/);assert.equal(JSON.stringify(t),before);
 assert.equal(r.calculatedAt,new Date(NOW).toISOString());assert.equal(r.legSources[0].asOf,t.legs[0].estimate.asOf);assert.equal(r.legSources[0].quoteObservedAt,t.legs[0].capturedAt);
});
test('prices, odds-implied guesses and observed wins/losses do not change source algebra',()=>{
 const t=cross(),p=read(t).probability;t.indicativeAmericanOdds=99999;t.legs.forEach(r=>{r.americanOdds=12000;r.result={eventStatus:'final',statisticalOutcome:'win'};});assert.equal(read(t).probability,p);
 t.legs[0].result.statisticalOutcome='loss';assert.equal(read(t).probability,p);
 t.legs[0].estimate.probabilitySource='bookmaker_implied';assert.equal(read(t).reason,'not_a_model_probability');
});
test('recorded terms are not independently verified terms or a payout probability',()=>{const r=read(cross());assert.equal(r.settlementTermsRecorded,true);assert.equal(r.settlementTermsVerified,false);assert.equal(r.settlementWinProbability,null);});
for(const p of [0,1,.000001,.999999])test('finite boundary and display precision '+p,()=>{
 const t=cross();t.legs[0]=leg('1','0022600154',p);const r=read(t);assert.equal(r.status,'approximate');assert.equal(r.probability,p*.7);assert.ok(!/\d\.\d/.test(math.format(r.probability)));
});
test('underflow never masquerades as a model zero',()=>{const t=cross();t.legs.forEach(r=>{r.estimate.winProbability=1e-300;r.estimate.lossProbability=1;});assert.equal(read(t).reason,'probability_below_numeric_resolution');});
for(const change of ['missing','NaN','out-of-range','projection-only','bad-status','bad-mass','future-clock','post-tip','late-completion','no-timezone','version-conflict','held','latest-missing'])test('unavailable input cannot borrow a substitute: '+change,()=>{
 const t=cross(),r=t.legs[0],e=r.estimate;
 if(change==='missing')delete e.winProbability;if(change==='NaN')e.winProbability=NaN;if(change==='out-of-range')e.winProbability=1.1;
 if(change==='projection-only'){delete e.winProbability;e.projection=20;}if(change==='bad-status')e.status='unverified';if(change==='bad-mass')e.lossProbability=.9;
 if(change==='future-clock')e.asOf='2026-11-01T20:00:00Z';if(change==='post-tip')e.asOf=r.startTime;if(change==='late-completion')e.completedAt=r.startTime;
 if(change==='no-timezone')e.asOf='2026-11-01T18:00:00';if(change==='version-conflict')r.modelVersion='other';if(change==='held')r.confidenceUpdate={status:'review',estimate:e,checkedAt:e.asOf};
 if(change==='latest-missing')r.confidenceUpdate={status:'available',checkedAt:e.asOf};assert.equal(read(t).probability,null,change);
});
test('latest probability replaces only its own leg, preserving version and clock identity',()=>{
 const t=cross(),r=t.legs[0];r.confidenceUpdate={status:'available',checkedAt:'2026-11-01T18:30:00Z',estimate:{...r.estimate,winProbability:.6,lossProbability:.4,asOf:'2026-11-01T18:30:00Z',modelVersion:'fixture-v2'}};
 assert.ok(Math.abs(read(t).probability-.42)<1e-12);assert.equal(read(t).legSources[0].modelVersion,'fixture-v2');assert.equal(r.estimate.winProbability,.8);
 r.confidenceUpdate.checkedAt='2026-11-01T18:31:00Z';assert.equal(read(t).reason,'forecast_clock_unverified');
});
test('win-only inputs keep all-win available and push/no-loss mass unknown',()=>{const t=cross();delete t.legs[0].estimate.pushProbability;delete t.legs[0].estimate.lossProbability;const r=read(t);assert.equal(r.status,'approximate');assert.equal(r.noLossProbability,null);assert.equal(r.pushWithoutLossProbability,null);});
test('an honest null completion stays unknown without changing an otherwise supported saved marginal',()=>{const t=cross(),p=read(t).probability;t.legs[0].estimate.completedAt=null;const r=read(t);assert.equal(r.probability,p);assert.equal(r.legSources[0].completedAt,null);});
test('strict integer pushes are separate from all wins and do not imply sportsbook settlement',()=>{
 const t=cross();for(const r of t.legs){r.operator='>';r.line=15;r.estimate={...r.estimate,winProbability:.6,pushProbability:.1,lossProbability:.3};}
 const r=read(t);assert.ok(Math.abs(r.allWinProbability-.36)<1e-12);assert.ok(Math.abs(r.noLossProbability-.49)<1e-12);assert.ok(Math.abs(r.pushWithoutLossProbability-.13)<1e-12);assert.equal(r.settlementWinProbability,null);
 t.legs[0].result={eventStatus:'final',statisticalOutcome:'push'};const changed=read(t);assert.equal(changed.status,'changed_ticket');assert.equal(changed.probability,null);assert.equal(changed.fromOriginalInputsProbability,r.probability);assert.match(math.explanation(changed),/not an archived whole-ticket/);
});
for(const outcome of ['out','dnp','canceled','postponed'])test('known '+outcome+' keeps original source inputs but supplies no adjusted payout probability',()=>{const t=cross(),before=read(t).probability;t.legs[0].result={eventStatus:'final',statisticalOutcome:outcome};const r=read(t);assert.equal(r.probability,null);assert.equal(r.fromOriginalInputsProbability,before);assert.equal(r.settlementWinProbability,null);});
test('same-game marginal products and sportsbook group prices are never joint forecasts',()=>{
 const t=cross();t.legs[1]=leg('2','0022600154',.7);t.groups=[{kind:'same_game',americanOdds:250,pickIds:['1','2']}];
 assert.equal(read(t).reason,'same_game_joint_missing');assert.match(math.explanation(read(t)),/individual percentages are insufficient/);
});
test('reviewed exact joint artifact works on a priced ticket, independent of model-target presentation',()=>{
 const t=cross();t.legs[1]=leg('2','0022600154',.7);t.priceKind='posted';t.eventJointEstimates=[joint(t.legs)];
 const r=read(t);assert.equal(r.status,'provisional');assert.equal(r.probability,.6);assert.notEqual(r.probability,.8*.7);assert.equal(r.basis,'reviewed_same_game_joint');assert.equal(r.groups[0].source.method,'paired-role-residual-v1');
});
test('SGP+ multiplies supported event groups, never correlated leg marginals',()=>{
 const t=cross();t.legs[1]=leg('2','0022600154',.7);t.eventJointEstimates=[joint(t.legs)];t.legs.push(leg('3','0022600155',.8));
 const r=read(t);assert.equal(r.status,'approximate');assert.equal(r.probability,.6*.8);assert.equal(r.basis,'between_game_independence_with_joint_groups');assert.equal(r.groups.length,2);
 delete t.eventJointEstimates;assert.equal(read(t).probability,null);assert.equal(read(t).reason,'same_game_joint_missing');
});
test('SGP+ reports every missing event-group input without producing a partial total',()=>{const t=cross();t.legs[1]=leg('2','0022600154',.7);t.legs.push(leg('3','0022600155'));delete t.legs[2].estimate;const r=read(t);assert.equal(r.probability,null);assert.deepEqual(r.missingInputs.map(x=>x.reason),['same_game_joint_missing','leg_probability_missing']);assert.match(math.explanation(r),/2 game groups/);});
test('a paired joint forecast cannot be multiplied by a third leg in that same game',()=>{const t=cross();t.legs[1]=leg('2','0022600154',.7);t.eventJointEstimates=[joint(t.legs)];t.legs.push(leg('3','0022600154',.8));assert.equal(read(t).probability,null);assert.equal(read(t).reason,'joint_group_evidence_invalid');});
test('later available leg updates cannot silently revive an older joint review',()=>{
 const t=cross();t.legs[1]=leg('2','0022600154',.7);t.eventJointEstimates=[joint(t.legs)];
 t.legs[0].confidenceUpdate={status:'available',checkedAt:'2026-11-01T18:30:00Z',estimate:{...t.legs[0].estimate,asOf:'2026-11-01T18:30:00Z'}};
 assert.equal(read(t).probability,null);t.eventJointEstimates[0].reviewedAt='2026-11-01T18:31:00Z';assert.equal(read(t).probability,.6);
 t.legs[0].confidenceUpdate.checkedAt='2026-11-01T18:31:00.000000001Z';assert.equal(read(t).probability,null);
});
test('known engine unsupported zero/one joint tails remain unavailable',()=>{for(const p of [0,1]){const t=cross();t.legs[1]=leg('2','0022600154',.7);const j=joint(t.legs,p);j.marginals.forEach(m=>m.winProbability=p);t.eventJointEstimates=[j];assert.equal(read(t).probability,null);}});
for(const change of ['contracts','missing-method','unreviewed','unsupported-method','future-review','missing-hash','bad-marginals','incoherent-marginals','duplicate-record'])test('joint evidence fails closed: '+change,()=>{
 const t=cross();t.legs[1]=leg('2','0022600154',.7);const j=joint(t.legs);t.eventJointEstimates=[j];
 if(change==='contracts')j.contractKeys[0]='wrong';if(change==='missing-method')delete j.method;if(change==='unreviewed')j.validationStatus='pending';if(change==='unsupported-method')j.method='raw-stat-correlation';
 if(change==='future-review')j.reviewedAt=t.legs[0].startTime;if(change==='missing-hash')delete j.sourceHash;if(change==='bad-marginals')j.marginals=[];
 if(change==='incoherent-marginals')j.marginals.forEach(m=>m.winProbability=.1);if(change==='duplicate-record')t.eventJointEstimates.push({...j});assert.equal(read(t).probability,null);
});
for(const change of ['duplicate-alias','component','threes-points','missing-native-event','event-conflict','date-conflict','start-conflict','side-conflict'])test('exact outcome/group boundaries: '+change,()=>{
 const t=cross();
 if(change==='duplicate-alias'){t.legs[1]={...t.legs[0],id:'alias',operator:'>',line:14.5};}
 if(change==='component'){t.legs[1]={...t.legs[0],id:'combo',market:'PRA',line:25};}
 if(change==='threes-points'){t.legs[1]={...t.legs[0],id:'three',market:'3PM',line:3};}
 if(change==='missing-native-event'){delete t.legs[0].canonicalEventId;t.legs[0].eventId='book:123';}
 if(change==='event-conflict')t.legs[0].eventId='nba:0022600159';
 if(change==='date-conflict'){t.legs[1].eventId=t.legs[1].canonicalEventId=t.legs[0].eventId;t.legs[1].date='2026-11-02';}
 if(change==='start-conflict'){t.legs[1].eventId=t.legs[1].canonicalEventId=t.legs[0].eventId;t.legs[1].startTime='2026-11-02T02:00:00Z';}
 if(change==='side-conflict')t.legs[0].side='under';assert.equal(read(t).probability,null);
});
test('equivalent clock spellings preserve semantic binding; source strings are unchanged',()=>{const a=leg('1'),b={...a,startTime:'2026-11-01T20:00:00-05:00'};assert.equal(math.contractKey(a),math.contractKey(b));assert.equal(b.startTime,'2026-11-01T20:00:00-05:00');});
test('sub-millisecond future source clock is not truncated into the current cutoff',()=>{const t=cross();t.legs[0].estimate.asOf='2026-11-01T19:00:00.000000001Z';assert.equal(read(t).reason,'forecast_clock_unverified');});
test('completion just after tip remains after tip at fractional precision',()=>{const t=cross();t.legs[0].startTime='2026-11-02T01:00:00.000000100Z';t.legs[0].estimate.completedAt='2026-11-02T01:00:00.000000101Z';assert.equal(read(t).reason,'forecast_clock_unverified');});
test('a genuine pre-tip sub-millisecond source is valid, with original fractional bytes preserved',()=>{const t=cross(),r=t.legs[0];r.startTime='2026-11-01T20:00:00.000000200Z';r.estimate.asOf='2026-11-01T20:00:00.000000100Z';const result=math.evaluate(t,{now:Date.parse('2026-11-01T20:00:00.001Z')});assert.equal(result.status,'approximate');assert.equal(result.legSources[0].asOf,r.estimate.asOf);});
test('fractional scheduled-start changes cannot share joint contract bindings',()=>{const a=leg('1'),b={...a,startTime:'2026-11-02T01:00:00.000000001Z'};assert.notEqual(math.contractKey(a),math.contractKey(b));});
test('malformed JSON identities and null joint marginals withhold instead of coercing or throwing',()=>{
 for(const change of [r=>{r.eventId=123;},r=>{r.canonicalEventId=[r.canonicalEventId];},r=>{r.date=[r.date];}]){const t=cross();change(t.legs[0]);assert.equal(read(t).probability,null);}
 const t=cross();t.legs[1]=leg('2','0022600154',.7);const j=joint(t.legs);j.marginals[0]=null;t.eventJointEstimates=[j];assert.equal(read(t).reason,'joint_marginals_invalid');
});
test('actual November 1 saved tickets reproduce direct original-leg arithmetic without changing their bytes',()=>{
 const root=path.resolve(__dirname,'..'),file=path.join(root,'data/plus-money/2026-11-01/d7fe3cdd49d82f8f.json'),raw=fs.readFileSync(file),body=JSON.parse(raw);
 assert.equal(body.tickets.length,6);for(const t of body.tickets){const r=math.evaluate(t);assert.equal(r.status,'approximate');assert.equal(r.probability,t.legs.reduce((p,l)=>p*l.estimate.winProbability,1));assert.match(pm.ticketRow(t,0),/independence approx/);assert.match(pm.probabilityNoteHTML(t),/not a frozen whole-ticket/);}assert.deepEqual(fs.readFileSync(file),raw);
});
test('every browser consumer loads result helpers then probability adapter before the parlay renderer',()=>{
 const root=path.resolve(__dirname,'..');for(const file of ['parlays/index.html','daily/parlays/index.html','sundays/ry/index.html','sundays/index.html','sundays/week.html','daily/index.html']){const s=fs.readFileSync(path.join(root,file),'utf8');assert.ok(s.indexOf('assets/result-utils.js')<s.indexOf('assets/ticket-probability.js'));assert.ok(s.indexOf('assets/ticket-probability.js')<s.indexOf('assets/plus-money.js'));assert.equal((s.match(/assets\/ticket-probability\.js/g)||[]).length,1);}
});
