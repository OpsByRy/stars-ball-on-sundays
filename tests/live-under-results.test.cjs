const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const results=require('../assets/result-utils.js'),board=require('../assets/pick-board.js');
const publication=require('../assets/publication.js'),units=require('../assets/unit-tracker.js');
const parlays=require('../assets/plus-money.js'),refresher=require('../scripts/refresh-results.cjs');
const prop=(operator='<',line=3.5,market='AST')=>({id:'under',date:'2026-10-31',group:'research',category:'high_probability_aggressive',player:'Brandon Miller',playerId:'nba:1641706',eventId:'nba:0022600148',canonicalEventId:'nba:0022600148',team:'Charlotte Hornets',opponent:'Philadelphia 76ers',startTime:'2026-10-31T22:00:00Z',market,operator,line,period:'full_game',americanOdds:-166,book:'fanduel'});
const grade=(p,actual,eventStatus='live')=>({...p,result:results.evaluateStructured(p,{eventStatus,stats:{[p.market]:actual},checkedAt:'2026-11-01T00:10:00Z',sportsbookSettlement:'unverified'})});
const over=()=>grade({...prop('>=',10,'PTS'),id:'over',player:'Other player'},15);
const ticket=(under)=>({id:'ticket',date:under.date,section:'plus_money',legs:[under,over()],priceKind:'posted',americanOdds:630});

test('live half-line unders become provisional misses while unreached overs and winning unders remain pending',()=>{
 const row=grade(prop(),5),before=JSON.stringify(row);
 assert.equal(row.result.statisticalOutcome,'not_reached');assert.equal(row.result.eventStatus,'live');assert.equal(row.result.final,false);assert.equal(row.result.sportsbookSettlement,'unverified');
 assert.equal(results.isLiveMiss(row),true);assert.equal(results.isStatisticalMiss(row),true);assert.equal(results.isStatisticalHit(row),false);
 assert.deepEqual(board.rowStatus(row),{tone:'miss',icon:'✕',label:'Miss',actual:'5 ast',live:true});
 assert.deepEqual(publication.summary([row]),{total:1,hits:0,misses:1,pushes:0,other:0,pending:0});
 for(const r of [grade(prop(),3),grade(prop('>',3.5),3)]){assert.equal(results.isLiveMiss(r),false);assert.equal(results.isStatisticalHit(r),false);assert.equal(publication.summary([r]).pending,1);}
 assert.equal(JSON.stringify(row),before);
});

test('legacy live pending snapshots with exceeded unders render correctly without rewriting their data',()=>{
 const row=grade(prop(),5);row.result.statisticalOutcome='pending';const before=JSON.stringify(row);
 assert.equal(results.isLiveMiss(row),true);assert.equal(board.rowStatus(row).label,'Miss');assert.equal(board.rowStatus(row).live,true);
 assert.equal(results.parlayOutcome(ticket(row)).outcome,'loss');assert.equal(JSON.stringify(row),before);
});

test('strict integer equality stays pending live and pushes only at final; inclusive operators have no equality push',()=>{
 for(const operator of ['<','>']){
  const p=prop(operator,4),row=grade(p,4),final=grade(p,4,'final');
  assert.equal(row.result.statisticalOutcome,'pending');assert.equal(results.isLiveMiss(row),false);assert.equal(results.isLiveHit(row),false);
  assert.equal(publication.summary([row]).pending,1);assert.equal(final.result.statisticalOutcome,'push');assert.equal(board.rowStatus(final).label,'Push');assert.equal(results.isVoidedLeg(final),true);
 }
 for(const [operator,actual,liveMiss,liveHit,finalOutcome] of [['<',5,true,false,'loss'],['<=',4,false,false,'win'],['<=',5,true,false,'loss'],['>',5,false,true,'win'],['>=',4,false,true,'win'],['>=',3,false,false,'loss']]){
  const p=prop(operator,4),row=grade(p,actual);assert.equal(results.isLiveMiss(row),liveMiss,operator);assert.equal(results.isLiveHit(row),liveHit,operator);
  assert.equal(grade(p,actual,'final').result.statisticalOutcome,finalOutcome,operator);
 }
});

test('live under grading covers every supported counting-stat family and rejects incomplete combo stats',()=>{
 for(const [market,stats] of [['PTS',{PTS:5}],['REB',{REB:5}],['AST',{AST:5}],['3PM',{'3PM':5}],['BLK',{BLK:5}],['STL',{STL:5}],['PRA',{PTS:2,REB:2,AST:1}],['PR',{PTS:2,REB:3}],['PA',{PTS:2,AST:3}],['RA',{REB:2,AST:3}]]){
  const p=prop('<',3.5,market),row={...p,result:results.evaluateStructured(p,{eventStatus:'live',stats})};assert.equal(results.isLiveMiss(row),true,market);
 }
 const p=prop('<',3.5,'RA'),row={...p,result:results.evaluateStructured(p,{eventStatus:'live',stats:{REB:5}})};
 assert.equal(row.result.statisticalOutcome,'unavailable');assert.equal(results.isLiveMiss(row),false);
});

test('void, DNP, unavailable, scheduled and invalid facts cannot become provisional live misses',()=>{
 for(const statisticalOutcome of ['out','dnp','canceled','postponed','unavailable','push']){
  const row={...prop(),result:{eventStatus:'live',statisticalOutcome,actual:5}};assert.equal(results.isLiveMiss(row),false,statisticalOutcome);
 }
 for(const eventStatus of ['scheduled','unknown','postponed','canceled'])assert.equal(results.isLiveMiss({...prop(),result:{eventStatus,statisticalOutcome:'pending',actual:5}}),false);
 for(const actual of [-1,4.5,NaN,Infinity,'5',null])assert.equal(results.isLiveMiss({...prop(),result:{eventStatus:'live',statisticalOutcome:'pending',actual}}),false);
 assert.equal(results.isLiveMiss({...grade(prop(),5),period:'first_half'}),false);
 const dnp={...prop(),result:results.evaluateStructured(prop(),{eventStatus:'final',didNotPlay:true,stats:{AST:5},sportsbookSettlement:'unverified'})};
 assert.equal(results.isVoidedLeg(dnp),true);assert.equal(results.isStatisticalMiss(dnp),false);assert.equal(board.rowStatus(dnp).label,'Void · DNP');
 const out={...prop(),result:{eventStatus:'scheduled',statisticalOutcome:'out',actual:null}};
 assert.equal(results.parlayOutcome({legs:[out,over()]}).outcome,'win');assert.equal(results.parlayOutcome({legs:[out,dnp]}).outcome,'void');
});

test('live stat corrections remove a miss and final results cannot regress to a live state',()=>{
 const p=prop(),miss=grade(p,5),corrected=grade(p,3),row={...p,result:board.mergeResult(miss.result,corrected.result)};
 assert.equal(board.rowStatus(row).label,'Live');assert.equal(publication.summary([row]).misses,0);assert.equal(results.parlayOutcome(ticket(row)).outcome,'pending');
 const final=grade(p,5,'final');assert.equal(final.result.statisticalOutcome,'loss');assert.equal(board.mergeResult(final.result,corrected.result),final.result);
 const finalCorrection=grade(p,3,'final'),merged={...p,result:board.mergeResult(final.result,finalCorrection.result)};
 assert.equal(board.rowStatus(merged).label,'Hit');assert.equal(board.rowStatus(merged).live,false);assert.equal(merged.result.sportsbookSettlement,'unverified');
});

test('personal and algorithm parlay legs and records share the provisional Miss / Live display',()=>{
 const root=path.resolve(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(root,'data/editions/manifest.json'))),entry=manifest.editions.filter(e=>e.channel==='daily'&&e.date==='2026-10-31').at(-1);
 const originalBytes=fs.readFileSync(path.join(root,'data/editions',entry.path)),body=JSON.parse(originalBytes);
 const row=body.props.find(r=>r.group==='ry'&&r.player==='Brandon Miller'&&r.market==='AST'&&r.operator==='<'&&r.line===3.5);assert.ok(row);
 row.result=grade(row,5).result;const beforeRender=JSON.stringify(body),personal=results.personalParlays(body)[0];
 assert.deepEqual(results.parlayOutcome(personal),{outcome:'loss',live:true});
 const html=publication.personalSlipsHTML(body);assert.match(html,/full-ticket screenshot quote · Miss · Live/);assert.match(html,/Miss · ● Live · 5 ast/);
 assert.match(results.parlayRecordHTML([personal]),/1 live/);assert.equal(results.parlaySummary([personal]).misses,1);
 const generated={...ticket(row),priceKind:'indicative',indicativeAmericanOdds:130,fitReasons:[]};
 const generatedHTML=parlays.ticketRow(generated,0);assert.match(generatedHTML,/✕ Miss · ● Live/);assert.match(generatedHTML,/Miss · ● Live · 5 ast/);
 assert.equal(JSON.stringify(body),beforeRender);
 // Only the in-memory current result was changed; immutable source and posting fields are untouched.
 assert.deepEqual(fs.readFileSync(path.join(root,'data/editions',entry.path)),originalBytes);
});

test('statistical unit tracking mirrors provisional live hits and reverses live misses after corrections',()=>{
 const row=grade(prop(),5),settings=units.preferences({unitDollars:25}),before=JSON.stringify(row);
 let s=units.summarize([row],{settings});assert.equal(s.netUnits,-1);assert.equal(s.netDollars,-25);assert.equal(s.liveMisses,1);assert.equal(s.liveHits,0);
 const personal=ticket(row);s=units.summarize([personal],{kind:'parlays',personal:true,settings});assert.equal(s.netUnits,-.5);assert.equal(s.netDollars,-12.5);assert.equal(s.liveMisses,1);assert.equal(personal.americanOdds,630);
 s=units.summarize([{...personal,legs:[grade(prop(),3),over()]}],{kind:'parlays',personal:true,settings});assert.equal(s.netUnits,0);assert.equal(s.pending,1);assert.equal(s.liveMisses,0);
 assert.equal(JSON.stringify(row),before);assert.equal(row.result.sportsbookSettlement,'unverified');assert.equal(row.result.final,false);
 // Personal legs do not become separate tracked wagers and historical stake defaults stay unchanged.
 assert.equal(units.summarize([{...row,group:'ry'}],{settings}).decided,0);assert.equal(settings.sizes.personal,.5);
});

test('result refresh appends provisional under results and corrections without rewriting original contracts or editions',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sbos-live-under-')),write=(name,body)=>{const p=path.join(directory,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(body));};
 try{
  const row={...prop(),resultSource:{eventId:'123',athleteId:'456',expectedTeam:'Charlotte Hornets'}},clock='2026-10-31T21:00:00Z';
  const daily={schemaVersion:'public-1',channel:'daily',date:row.date,updatedAt:clock,firstPublishedAt:clock,props:[row]};daily.version=refresher.version(daily);
  const parlay={schemaVersion:'public-plus-money-2',date:row.date,updatedAt:clock,tickets:[{id:'ticket',legs:[row],postedAt:clock}]};parlay.version=refresher.version(parlay);
  const dailyPath=`daily/${row.date}/${daily.version}.json`,parlayPath=`${row.date}/${parlay.version}.json`;
  write('data/editions/'+dailyPath,daily);write('data/editions/manifest.json',{schemaVersion:'public-1',editions:[{channel:'daily',date:row.date,version:daily.version,path:dailyPath}]});
  write('data/plus-money/'+parlayPath,parlay);write('data/plus-money/manifest.json',{schemaVersion:'public-plus-money-manifest-1',editions:[{date:row.date,version:parlay.version,path:parlayPath}]});write('data/stat-targets.json',{targets:[]});
  const originals=new Map([dailyPath,parlayPath].map((p,i)=>{const full=path.join(directory,'data',i?'plus-money':'editions',p);return [full,fs.readFileSync(full)];}));
  for(const [actual,eventStatus,outcome,time] of [[5,'live','not_reached','00:10'],[3,'live','pending','00:11'],[5,'final','loss','00:12']]){
   const now=new Date(`2026-11-01T${time}:00Z`),fetchJSON=async()=>({header:{id:'123',competitions:[{status:{type:{completed:eventStatus==='final',state:eventStatus==='final'?'post':'in'}}}]},boxscore:{players:[{team:{displayName:'Charlotte Hornets'},statistics:[{labels:['AST','MIN'],athletes:[{athlete:{id:'456'},stats:[String(actual),'29']}]}]}]}});
   await refresher.refresh({directory,fetchJSON,now});
   for(const [folder,field] of [['editions','props'],['plus-money','tickets']]){
    const index=JSON.parse(fs.readFileSync(path.join(directory,'data',folder,'manifest.json'))),body=JSON.parse(fs.readFileSync(path.join(directory,'data',folder,index.editions.at(-1).path))),saved=field==='props'?body.props[0]:body.tickets[0].legs[0];
    assert.equal(saved.result.statisticalOutcome,outcome);assert.equal(saved.result.eventStatus,eventStatus);assert.equal(saved.result.sportsbookSettlement,'unverified');assert.equal(saved.result.checkedAt,now.toISOString());
    const {result,...contract}=saved;assert.deepEqual(contract,row);if(field==='props')assert.equal(body.firstPublishedAt,clock);else assert.equal(body.tickets[0].postedAt,clock);
   }
   for(const [p,bytes] of originals)assert.deepEqual(fs.readFileSync(p),bytes);
  }
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
