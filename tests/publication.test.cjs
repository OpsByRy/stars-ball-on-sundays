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
test('result refresh appends corrections without rewriting picks or old versions',async()=>{
  const os=require('node:os'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'sbos-public-results-'));
  const write=(name,value)=>{const file=path.join(directory,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
  try{
    const body={schemaVersion:'public-1',channel:'daily',date:row.date,timezone:'America/New_York',firstPublishedAt:null,recordedAt:'2026-10-25T18:00:00Z',updatedAt:'2026-10-25T18:00:00Z',priceNote:'Saved observation.',props:[{...row,id:'published-pick',group:'research',resultSource:{provider:'espn',eventId:'123',athleteId:'456'}}]};
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
    assert.deepEqual(await refresher.refresh({directory,fetchJSON:async()=>{throw Error('source down');},now:new Date('2026-10-26T04:00:00Z')}),{editions:0,sourceFailures:1});
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'data/editions/manifest.json'))).editions.length,3);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
