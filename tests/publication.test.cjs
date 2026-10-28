'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const publication=require('../assets/publication.js'),board=require('../assets/pick-board.js'),contracts=require('../assets/result-utils.js'),refresher=require('../scripts/refresh-results.cjs');
const root=path.resolve(__dirname,'..');
const row={date:'2026-10-25',eventId:'game',playerId:'player',player:'Example',market:'AST',operator:'>=',line:8,side:'over',period:'full_game',product:'sportsbook',americanOdds:-150};
test('exact posted operators retain their boundary behavior',()=>{
  assert.equal(publication.lineLabel(row),'8+ assists');
  const over={...row,operator:'>',line:8};assert.equal(publication.lineLabel(over),'Over 8 assists');
  assert.equal(contracts.evaluateStructured(row,{eventStatus:'final',stats:{AST:8}}).statisticalOutcome,'win');
  assert.equal(contracts.evaluateStructured(over,{eventStatus:'final',stats:{AST:8}}).statisticalOutcome,'push');
});
test('record counts separate final outcomes, DNPs, and incomplete results',()=>{
  const result=(eventStatus,statisticalOutcome)=>({result:{eventStatus,statisticalOutcome}});
  assert.deepEqual(publication.summary([result('final','win'),result('final','loss'),result('final','push'),result('final','dnp'),result('live','reached'),{}]),{total:6,hits:1,misses:1,pushes:1,other:1,pending:2});
});
test('version paths cannot escape the publication directory',()=>{
  const rootURL=new URL('https://example.com/sbos/data/editions/');
  assert.throws(()=>publication.safeEditionURL({channel:'daily',date:'2026-10-25',version:'0123456789abcdef',path:'../../../secret.json'},rootURL));
  assert.equal(publication.safeEditionURL({channel:'daily',date:'2026-10-25',version:'0123456789abcdef',path:'daily/2026-10-25/0123456789abcdef.json'},rootURL).origin,rootURL.origin);
});
test('public result versions match the Python publisher hashes',()=>{
  const index=JSON.parse(fs.readFileSync(path.join(root,'data/editions/manifest.json')));
  for(const e of index.editions)assert.equal(refresher.version(JSON.parse(fs.readFileSync(path.join(root,'data/editions',e.path)))),e.version);
});
test('result source identity mismatches fail and final records survive source regressions',()=>{
  assert.throws(()=>board.parseSummary({header:{id:'999'}},{eventId:'123',athleteId:'456'},row,new Date().toISOString()));
  const final={eventStatus:'final',statisticalOutcome:'win',actual:8};assert.equal(board.mergeResult(final,{eventStatus:'live',statisticalOutcome:'pending'}),final);
  assert.ok(refresher.equivalent({...final,checkedAt:'earlier'},{...final,checkedAt:'later'}));
});
test('calculator uses saved prices and replaces competing lines',()=>{
  const legs=board.addLeg([],row).legs;const update=board.addLeg(legs,{...row,line:10});assert.equal(update.action,'replaced');assert.equal(update.legs.length,1);
  const result=board.calculate(legs,10);assert.ok(Math.abs(result.returnAmount-16.6666666667)<1e-8);
});
test('published estimates format saved outputs and preserve unavailable values',()=>{
  assert.deepEqual(board.estimateDisplay({projection:23.56,winProbability:0.724,status:'provisional'}),{available:true,win:'72.4%',projection:'23.6',status:'Provisional'});
  assert.equal(board.estimateDisplay().available,false);
  assert.equal(board.estimateDisplay({projection:0,winProbability:0,status:'validated'}).win,'0.0%');
  assert.equal(board.estimateDisplay({projection:19,status:'provisional'}).win,'—');
});
test('favorite notice shows the Eastern posting day and distinguishes the full-slip price',()=>{
  const notice=publication.favoritesNotice({favoritesPostedAt:'2026-10-28T02:20:48+00:00',sharedBetslipUrl:'https://sportsbook.fanduel.com/addToBetslip?shareCode=yr6GfmU',sharedBetslipOdds:527});
  assert.match(notice,/Posted <time datetime="2026-10-28T02:20:48\+00:00">Oct 27, 2026, 10:20 PM ET/);
  assert.match(notice,/Full-slip screenshot price: <strong>\+527/);
  assert.match(notice,/Individual leg prices were not supplied/);
  assert.equal(publication.favoritesNotice({}),'');
  assert.doesNotMatch(publication.favoritesNotice({sharedBetslipUrl:'javascript:alert(1)',sharedBetslipOdds:527}),/href=/);
});
test('late-game favorites preserve the five supplied contracts and existing research',()=>{
  const index=JSON.parse(fs.readFileSync(path.join(root,'data/editions/manifest.json')));
  const editions=index.editions.filter(e=>e.date==='2026-10-27').map(e=>JSON.parse(fs.readFileSync(path.join(root,'data/editions',e.path))));
  const body=editions.find(e=>e.sharedBetslipUrl?.endsWith('shareCode=yr6GfmU'));
  const favorites=body.props.filter(p=>p.group==='ry');assert.equal(favorites.length,5);
  assert.deepEqual(favorites.map(p=>[p.player,p.market,p.operator,p.line]).sort(),[
    ['Jrue Holiday','AST','>',2.5],['Sandro Mamukelashvili','PTS','>',5.5],['Ziaire Williams','PTS','>',6.5],['Ja Morant','AST','>=',6],['Quentin Grimes','PTS','>',6.5]
  ].sort());
  assert.ok(favorites.every(p=>p.book==='fanduel'&&p.americanOdds===null&&p.postedAt===body.favoritesPostedAt&&p.resultSource.eventId==='401909880'));
  assert.equal(publication.lineLabel(favorites.find(p=>p.player==='Ja Morant')),'6+ assists');
  assert.deepEqual(body.props.filter(p=>p.group==='research'),editions.find(e=>e.version==='cc92106688ce1637').props.filter(p=>p.group==='research'));
});
test('supplied favorite prices enable the calculator without rewriting original snapshots',()=>{
  const index=JSON.parse(fs.readFileSync(path.join(root,'data/editions/manifest.json')));
  const snapshots=index.editions.filter(e=>e.date==='2026-10-27').map(e=>JSON.parse(fs.readFileSync(path.join(root,'data/editions',e.path))));
  const body=snapshots.find(b=>b.sharedBetslipOdds===510),original=snapshots.find(b=>b.version==='1029b2eca7b20356');
  const favorites=body.props.filter(p=>p.group==='ry');
  const expected={'Jrue Holiday':-310,'Sandro Mamukelashvili':-280,'Ziaire Williams':-270,'Ja Morant':-162,'Quentin Grimes':-250};
  let legs=[];
  for(const pick of favorites){
    const display=publication.pricedPick(pick);assert.equal(display.americanOdds,expected[pick.player]);assert.equal(pick.americanOdds,null);
    assert.equal(pick.id,original.props.find(p=>p.player===pick.player&&p.group==='ry').id);
    assert.equal(pick.postedAt,original.favoritesPostedAt);legs=board.addLeg(legs,display).legs;
  }
  assert.equal(legs.length,5);assert.ok(Number.isFinite(board.calculate(legs,10).returnAmount));
  assert.equal(body.favoritesPostedAt,original.favoritesPostedAt);
  assert.match(publication.favoritesNotice(body),/Full-slip screenshot price: <strong>\+510/);
  assert.doesNotMatch(publication.favoritesNotice(body),/prices were not supplied/);
  assert.match(publication.favoritesNotice(body),/calculator’s multiplied straight prices/);
  assert.equal(publication.pricedPick({...row,priceCheck:{status:'returned',americanOdds:-200}}).americanOdds,-150);
  assert.equal(publication.pricedPick({americanOdds:null,priceCheck:{status:'not_returned',americanOdds:null}}).americanOdds,null);
});
test('latest supplied SGP has five priced, researched favorites and separate posting and price times',()=>{
  const index=JSON.parse(fs.readFileSync(path.join(root,'data/editions/manifest.json')));
  const snapshots=index.editions.filter(e=>e.date==='2026-10-27').map(e=>JSON.parse(fs.readFileSync(path.join(root,'data/editions',e.path))));
  const body=snapshots.find(b=>b.sharedBetslipOdds===547),prior=snapshots.find(b=>b.sharedBetslipOdds===510),favorites=body.props.filter(p=>p.group==='ry');
  assert.equal(favorites.length,5);assert.equal(body.favoritesPostedAt,prior.favoritesPostedAt);
  const prices={'Jrue Holiday':-300,'Sandro Mamukelashvili':-260,'Ziaire Williams':-280,'Ja Morant':-162,'Quentin Grimes':-250};
  for(const pick of favorites){assert.equal(publication.pricedPick(pick).americanOdds,prices[pick.player]);assert.ok(board.estimateDisplay(pick.estimate).available);assert.ok(Date.parse(pick.estimate.asOf)<Date.parse(pick.startTime));}
  for(const [player,win,projection] of [['Ziaire Williams','81.1%','13.4'],['Quentin Grimes','69.9%','12.2']]){
    const pick=favorites.find(p=>p.player===player),display=board.estimateDisplay(pick.estimate);
    assert.equal(pick.operator,'>');assert.equal(pick.line,6.5);assert.equal(display.win,win);assert.equal(display.projection,projection);assert.equal(display.status,'Provisional');
  }
  assert.match(publication.favoritesNotice(body),/Full-slip screenshot price: <strong>\+547/);
  assert.match(publication.favoritesNotice(body),/Posted <time/);assert.match(publication.favoritesNotice(body),/Prices updated/);
  assert.deepEqual(body.props.filter(p=>p.group==='research'),prior.props.filter(p=>p.group==='research'));
});
test('result refresh appends corrections without rewriting picks or old versions',async()=>{
  const os=require('node:os'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'sbos-public-results-'));
  const write=(name,value)=>{const file=path.join(directory,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
  try{
    const body={schemaVersion:'public-1',channel:'daily',date:row.date,timezone:'America/New_York',firstPublishedAt:null,recordedAt:'2026-10-25T18:00:00Z',updatedAt:'2026-10-25T18:00:00Z',favoritesPostedAt:'2026-10-25T22:00:00Z',sharedBetslipOdds:527,sharedBetslipUrl:'https://sportsbook.fanduel.com/addToBetslip?shareCode=yr6GfmU',priceNote:'Saved observation.',props:[{...row,id:'published-pick',group:'research',postedAt:'2026-10-25T22:00:00Z',resultSource:{provider:'espn',eventId:'123',athleteId:'456'}}]};
    body.version=refresher.version(body);const firstPath=`daily/${row.date}/${body.version}.json`;
    write('data/editions/'+firstPath,body);write('data/editions/manifest.json',{schemaVersion:'public-1',editions:[{channel:'daily',date:row.date,version:body.version,path:firstPath,count:0,researchCount:1,updatedAt:body.updatedAt}]});write('data/stat-targets.json',{schemaVersion:'public-1',targets:[]});
    const original=fs.readFileSync(path.join(directory,'data/editions',firstPath),'utf8');
    let actual=8;const fetchJSON=async id=>{assert.equal(id,'123');return {header:{id:'123',competitions:[{status:{type:{completed:true,state:'post',name:'STATUS_FINAL'}}}]},boxscore:{players:[{statistics:[{labels:['AST'],athletes:[{athlete:{id:'456'},stats:[String(actual)]}]}]}]}};};
    assert.deepEqual(await refresher.refresh({directory,fetchJSON,now:new Date('2026-10-26T01:00:00Z')}),{editions:1,sourceFailures:0});
    assert.equal(fs.readFileSync(path.join(directory,'data/editions',firstPath),'utf8'),original);
    assert.deepEqual(await refresher.refresh({directory,fetchJSON,now:new Date('2026-10-26T02:00:00Z')}),{editions:0,sourceFailures:0});
    actual=7;assert.deepEqual(await refresher.refresh({directory,fetchJSON,now:new Date('2026-10-26T03:00:00Z')}),{editions:1,sourceFailures:0});
    const index=JSON.parse(fs.readFileSync(path.join(directory,'data/editions/manifest.json')));assert.equal(index.editions.length,3);
    const last=JSON.parse(fs.readFileSync(path.join(directory,'data/editions',index.editions.at(-1).path)));assert.equal(last.props[0].result.statisticalOutcome,'loss');assert.equal(last.props[0].line,8);assert.equal(last.props[0].americanOdds,-150);assert.equal(refresher.version(last),last.version);
    assert.deepEqual(Object.keys(last.props[0].result).sort(),['actual','checkedAt','eventStatus','source','sportsbookSettlement','statisticalOutcome']);
    assert.equal(last.favoritesPostedAt,body.favoritesPostedAt);assert.equal(last.props[0].postedAt,body.props[0].postedAt);assert.equal(last.sharedBetslipOdds,527);assert.equal(last.sharedBetslipUrl,body.sharedBetslipUrl);
    assert.deepEqual(await refresher.refresh({directory,fetchJSON:async()=>{throw Error('source down');},now:new Date('2026-10-26T04:00:00Z')}),{editions:0,sourceFailures:1});
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'data/editions/manifest.json'))).editions.length,3);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('daily sections use published categories and retain rejected research lines',()=>{
  const body={props:[{...row,id:'ry',group:'ry'},{...row,id:'safe',group:'research',category:'value_safe'},{...row,id:'aggressive',group:'research',category:'high_probability_aggressive'},{...row,id:'pass',group:'research',category:'not_a_pick'}]};
  const groups=publication.editionGroups(body);
  assert.deepEqual(groups.ry.map(r=>r.id),['ry']);assert.deepEqual(groups.value_safe.map(r=>r.id),['safe']);assert.deepEqual(groups.high_probability_aggressive.map(r=>r.id),['aggressive']);assert.equal(groups.research.length,3);
  const archived={...row,id:'historical',group:'research',americanOdds:-250};const before=JSON.stringify(archived);
  assert.equal(publication.publishedCategory(archived),'value_safe');assert.equal(JSON.stringify(archived),before);
});
test('research pagination and combined filters retain every reviewed line',()=>{
  const rows=Array.from({length:85},(_,i)=>({...row,id:String(i),group:'research',player:'Player '+i,category:i%2?'not_a_pick':'value_safe',market:i<50?'PTS':'AST'}));
  const first=publication.researchPage(rows),second=publication.researchPage(rows,{page:1});assert.equal(first.total,85);assert.equal(first.pages,3);assert.equal(second.rows[0].id,'40');assert.equal(publication.researchPage(rows,{page:99}).rows.length,5);
  const filtered=publication.researchPage(rows,{query:'player',market:'AST',status:'not_a_pick',page:8});assert.equal(filtered.total,17);assert.equal(filtered.page,0);assert.ok(filtered.rows.every(r=>r.market==='AST'&&r.category==='not_a_pick'));
});
