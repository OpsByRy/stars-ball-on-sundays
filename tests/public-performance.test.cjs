const test=require('node:test'),assert=require('node:assert/strict'),units=require('../assets/unit-tracker.js'),results=require('../assets/result-utils.js');
const row=(id,outcome='win',odds=-200)=>({id,date:'2026-11-01',group:'research',category:'value_safe',americanOdds:odds,market:'PTS',operator:'>',line:10.5,result:{eventStatus:'final',statisticalOutcome:outcome,actual:20}});
test('flat 1u uses original posted price and ignores settings and later offers',()=>{
 const win={...row('w'),slateOriginalAmericanOdds:-200,americanOdds:900,confidenceUpdate:{americanOdds:700}},loss=row('l','loss',100),before=JSON.stringify([win,loss]);
 const s=units.publicSummary([win,win,loss],{settings:{unitDollars:999,sizes:{floater:200}}});assert.equal(s.priced,2);assert.equal(s.netUnits,-.5);assert.equal(s.roi,-.25);assert.equal(JSON.stringify([win,loss]),before);
 const html=units.recordHTML([win,loss]);assert.match(html,/Hypothetical flat-1u return/);assert.doesNotMatch(html,/Set your units|Tracked net|\$/);
 for(const method of ['stakeHTML','pickPayoutHTML','payoutHTML'])assert.equal(units[method](win),'');
});
test('live, pushes, voids, unpriced decisions, test slate and corrections have explicit denominators',()=>{
 const live=row('live');live.result.eventStatus='live';live.result.statisticalOutcome='reached';
 const rows=[row('w'),row('l','loss'),row('p','push'),row('v','dnp'),live,row('uw','win',null),row('ul','loss',null),{...row('test'),date:'2026-10-26'}];
 let s=units.publicSummary(rows);assert.deepEqual([s.wins,s.losses,s.pushes,s.voids,s.pending,s.unpriced,s.priced],[2,2,1,1,1,2,2]);assert.equal(s.netUnits,-.5);
 rows[0].result.statisticalOutcome='loss';s=units.publicSummary(rows);assert.equal(s.netUnits,-2);assert.equal(s.roi,-1);
});
test('whole-ticket quotes are required and void-adjusted or live tickets never fabricate returns',()=>{
 const ticket={id:'a',priceKind:'posted',americanOdds:300,legs:[row('1'),row('2')]};
 assert.equal(units.publicSummary([ticket],{kind:'parlays'}).netUnits,3);
 for(const t of [{...ticket,priceKind:'indicative'},{...ticket,americanOdds:null},{...ticket,legs:[row('1'),row('2','push')]}])assert.equal(units.publicSummary([t],{kind:'parlays'}).unpriced,1);
 const losing={...ticket,priceKind:'indicative',legs:[row('1','loss'),row('2')]};assert.equal(units.publicSummary([losing],{kind:'parlays'}).priced,0);
 const live={...ticket,legs:[row('1'),{...row('2'),result:{eventStatus:'live',statisticalOutcome:'reached',actual:20}}]};
 assert.equal(units.publicSummary([live],{kind:'parlays'}).pending,1);assert.match(results.parlayRecordHTML([live]),/0 graded decisions/);
 assert.equal(units.publicSummary([{...ticket,recordKind:'selection_snapshot'}],{kind:'parlays'}).total,0);
});
