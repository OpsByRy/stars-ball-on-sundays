const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const pm=require('../assets/plus-money.js'),refresh=require('../scripts/refresh-results.cjs');
const root=path.resolve(__dirname,'..'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name)));
const original=read('data/plus-money/2026-10-30/bacdcb962a1648f2.json'),withdrawn=original.modelTargets[0];
// Result refreshes append statistical grades; every original contract, quote,
// forecast and ticket field must remain identical while those grades advance.
const frozenTickets=tickets=>tickets.map(t=>({...t,legs:t.legs.map(({result,...leg})=>leg)}));

test('withdrawal suppresses both original immutable editions while preserving every unrelated ticket and input byte',()=>{
 for(const name of ['e1ada600bbb721ec','bacdcb962a1648f2']){
  const body=read(`data/plus-money/2026-10-30/${name}.json`),before=JSON.stringify(body),cleaned=pm.applyWithdrawals(body);
  assert.equal(pm.modelTargets(body).length,0);assert.equal(pm.boardRows(body).length,20);
  assert.deepEqual(cleaned.tickets,body.tickets);assert.deepEqual(cleaned.modelTargets||[],[]);
  if(body.modelTargets?.length)assert.equal(pm.ticketRow(body.modelTargets[0],0),'');assert.equal(JSON.stringify(body),before);
 }
});
test('same contracts stay withdrawn after reordered legs, changed IDs, prices, source times and results',()=>{
 const t=structuredClone(withdrawn);t.id='republished-new-id';t.legs.reverse();
 for(const r of t.legs){r.id='new-'+r.market;r.book='fanduel';r.americanOdds=-150;r.capturedAt='2026-10-30T23:00:00Z';r.result={eventStatus:'live',statisticalOutcome:'pending'};}
 assert.ok(pm.withdrawalFor(t));assert.deepEqual(pm.applyWithdrawals({tickets:[t],modelTargets:[t]}),{tickets:[],modelTargets:[]});
 assert.equal(pm.boardRows({tickets:[t]}).length,0);
});
test('withdrawal is scoped to the date and exact combination, preserving individual picks and other targets',()=>{
 const other=structuredClone(withdrawn);other.id='another-target';other.legs[0].line=26;assert.equal(pm.withdrawalFor(other),undefined);
 const later=structuredClone(withdrawn);for(const r of later.legs)r.date='2026-10-31';assert.equal(pm.withdrawalFor(later),undefined);
 assert.equal(pm.withdrawalFor({id:'single',legs:[withdrawn.legs[0]]}),undefined);
 assert.equal(pm.applyWithdrawals({tickets:[],modelTargets:[other]}).modelTargets.length,1);
});
test('latest October 30 publication cannot restore the target, and original quotes and 20 other parlays are unchanged',()=>{
 const entry=read('data/plus-money/manifest.json').editions.filter(e=>e.date==='2026-10-30').at(-1),current=read('data/plus-money/'+entry.path);
 assert.equal(current.modelTargets.length,0);assert.deepEqual(frozenTickets(current.tickets),frozenTickets(original.tickets));
 for(const k of ['firstPublishedAt','quoteObservedAt'])assert.equal(current[k],original[k]);
 assert.notEqual(current.version,original.version);assert.ok(Date.parse(current.updatedAt)>Date.parse(original.updatedAt));
});
test('withdrawal preservation permits result updates but still detects contract, price and forecast changes',()=>{
 const next=structuredClone(original.tickets);next[0].legs[0].result={actual:20,eventStatus:'final',statisticalOutcome:'win'};
 assert.deepEqual(frozenTickets(next),frozenTickets(original.tickets));
 for(const change of [leg=>leg.line+=1,leg=>leg.americanOdds=-110,leg=>leg.book='changed-book',leg=>leg.estimate.asOf='2099-01-01T00:00:00Z']){
  const mutated=structuredClone(next);change(mutated[0].legs[0]);assert.notDeepEqual(frozenTickets(mutated),frozenTickets(original.tickets));
 }
});
test('dated withdrawal notice appears only on the affected slate without presenting new prices or probabilities',()=>{
 const html=pm.withdrawalNoticeHTML('2026-10-30');assert.match(html,/Withdrawal recorded/);assert.match(html,/has been withdrawn/);assert.match(html,/Do not play this target/);
 assert.doesNotMatch(html,/-496|-110|83\.2|data-parlay-id/);assert.equal(pm.withdrawalNoticeHTML('2026-10-29'),'');
});
test('scheduled result refresh removes a restored target even with no statistical changes and preserves the old edition',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sbos-withdrawal-')),write=(name,b)=>{const p=path.join(directory,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(b));};
 try{
  const body={...structuredClone(original),tickets:[]};body.version=refresh.version(body);const oldPath=body.date+'/'+body.version+'.json',saved=JSON.stringify(body);
  write('data/editions/manifest.json',{schemaVersion:'public-1',editions:[]});write('data/stat-targets.json',{targets:[]});write('data/plus-money/'+oldPath,body);
  write('data/plus-money/manifest.json',{schemaVersion:'public-plus-money-manifest-1',editions:[{date:body.date,path:oldPath,version:body.version,count:0,updatedAt:body.updatedAt}]});
  const reject=async()=>{throw Error('No collector should run for this test');};
  const outcome=await refresh.refresh({directory,now:new Date('2026-10-30T23:15:00Z'),fetchJSON:reject,fetchNBAJSON:reject,fetchInjuriesJSON:reject});
  assert.equal(outcome.parlayEditions,1);const index=JSON.parse(fs.readFileSync(path.join(directory,'data/plus-money/manifest.json'))),next=JSON.parse(fs.readFileSync(path.join(directory,'data/plus-money',index.editions.at(-1).path)));
  assert.deepEqual(next.modelTargets,[]);assert.equal(fs.readFileSync(path.join(directory,'data/plus-money',oldPath),'utf8'),saved);
  assert.equal((await refresh.refresh({directory,now:new Date('2026-10-30T23:16:00Z'),fetchJSON:reject,fetchNBAJSON:reject,fetchInjuriesJSON:reject})).parlayEditions,0);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
