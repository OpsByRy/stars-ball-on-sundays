'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),units=require('../assets/unit-tracker.js');
const prop=(id,{category='value_safe',odds=-200,outcome='win',live=false,group='research'}={})=>({id,category,group,americanOdds:odds,date:'2026-10-28',playerId:'nba:'+id,market:'PTS',operator:'>=',line:10,result:{eventStatus:live?'live':'final',statisticalOutcome:live&&outcome==='win'?'reached':outcome,actual:outcome==='win'?15:8}});
const approx=(x,y)=>assert.ok(Math.abs(x-y)<1e-9,`${x} != ${y}`);
test('the October 26 test slate stays visible on its date but cannot enter cumulative P/L or win rates',()=>{
 const results=require('../assets/result-utils.js'),publication=require('../assets/publication.js');
 const testLoss={...prop('test-loss',{outcome:'loss'}),date:'2026-10-26'},testWin={...prop('test-win'),date:'2026-10-26'},laterLoss=prop('later-loss',{outcome:'loss'}),laterWin=prop('later-win');
 const rows=[testLoss,testWin,laterLoss,laterWin],saved=JSON.stringify(rows);
 assert.equal(units.summarize([testLoss,testWin]).netUnits,-1); // the archived date retains its actual recorded outcomes
 assert.equal(units.summarize(rows).netUnits,-1);assert.equal(units.summarize(rows).decided,2);
 assert.equal(units.summarize([testLoss,testWin],{scope:'cumulative'}).decided,0);
 assert.equal(publication.summary([testLoss,testWin]).total,2);assert.equal(publication.summary(rows).total,2);assert.equal(publication.summary(rows).misses,1);
 assert.equal(publication.summary([testLoss,testWin],{scope:'cumulative'}).total,0);
 const testTicket={id:'test-ticket',legs:[testLoss]},laterTicket={id:'later-ticket',legs:[laterWin]};
 assert.equal(results.parlaySummary([testTicket,laterTicket]).misses,0);assert.equal(results.parlaySummary([testTicket,laterTicket]).hits,1);
 assert.equal(units.summarize([testTicket,laterTicket],{kind:'parlays'}).netUnits,.5);
 assert.match(units.recordHTML([testLoss,testWin]),/Test-run net/);assert.match(units.recordHTML([testLoss,testWin]),/Excluded from cumulative/);
 assert.match(results.testSlateNotice('2026-10-26'),/first day using the algorithm/);assert.match(results.testSlateNotice('2026-10-26'),/added October 29, 2026/);
 assert.equal(results.testSlateNotice('2026-10-27'),'');assert.equal(JSON.stringify(rows),saved);
});

test('default sizes match Ry’s policy; dollar values scale net without changing units or outcomes',()=>{
 assert.deepEqual(units.defaults,{layup:2,lob:1,plus_money:1,longshot:.25,personal:.5});
 const rows=[prop('1',{odds:-250}),prop('2',{category:'high_probability_aggressive',odds:150}),prop('3',{outcome:'loss'})];
 const a=units.summarize(rows),b=units.summarize(rows,{settings:{unitDollars:25}});
 approx(a.netUnits,.3);assert.equal(a.decided,3);assert.equal(a.netDollars,null);approx(b.netDollars,7.5);assert.equal(a.netUnits,b.netUnits);
});
test('custom stakes apply by category; favorite flags do not convert a Layup into a personal ticket',()=>{
 const row={...prop('1',{odds:100}),ryFavorite:true};
 const s=units.summarize([row],{settings:{unitDollars:20,sizes:{layup:3,personal:.5}}});
 assert.equal(s.netUnits,3);assert.equal(s.netDollars,60);assert.equal(s.stakes.layup,3);
 assert.equal(units.summarize([prop('2',{category:'honorable_mention'}),prop('3',{group:'ry'})]).netUnits,0);
});
test('original saved odds, duplicate identity and missing winning prices are handled honestly',()=>{
 const row={...prop('1'),bookPrices:{quotes:[{americanOdds:1000}]},confidenceUpdate:{americanOdds:500}};
 const s=units.summarize([row,row,prop('2',{odds:null}),prop('3',{odds:null,outcome:'loss'})]);
 assert.equal(s.netUnits,-1);assert.equal(s.decided,2);assert.equal(s.unpriced,1);
});
test('pending, pushes and DNPs do not create profits; reached live overs can be corrected',()=>{
 const pending=prop('1',{outcome:'pending'}),push=prop('2',{outcome:'push'}),dnp=prop('3',{outcome:'dnp'}),live=prop('4',{live:true});
 let s=units.summarize([pending,push,dnp,live]);assert.equal(s.netUnits,1);assert.equal(s.pending,1);assert.equal(s.openUnits,2);assert.equal(s.liveHits,1);
 live.result={eventStatus:'live',statisticalOutcome:'not_reached',actual:9};s=units.summarize([pending,push,dnp,live]);assert.equal(s.netUnits,0);assert.equal(s.openUnits,4);
});
test('parlay P/L grades whole tickets once, with separate Plus Money and Longshot stakes',()=>{
 const a={id:'plus',section:'plus_money',legs:[prop('1'),prop('2')]};
 const b={id:'long',section:'longshots',legs:[prop('3',{odds:200}),prop('4',{odds:300})]};
 const s=units.summarize([a,a,b],{kind:'parlays',settings:{unitDollars:10}});
 assert.equal(s.decided,2);assert.equal(s.netUnits,4);assert.equal(s.netDollars,40);assert.equal(s.indicative,true);
 b.legs[0].result={eventStatus:'final',statisticalOutcome:'loss',actual:0};
 assert.equal(units.summarize([b],{kind:'parlays'}).netUnits,-.25);
});
test('Ry’s personal parlay uses the full-ticket quote at 0.5u, never a product of SGP leg prices',()=>{
 const ticket={id:'personal',priceKind:'posted',americanOdds:547,legs:[prop('1'),prop('2')]};
 approx(units.summarize([ticket],{kind:'parlays',personal:true}).netUnits,2.735);
 ticket.americanOdds=null;assert.equal(units.summarize([ticket],{kind:'parlays',personal:true}).unpriced,1);
 const quote=units.firstPersonalPrice(ticket,[{ticketId:'personal',legIds:['1','2'],americanOdds:527}]);
 assert.equal(quote.americanOdds,527);approx(units.summarize([quote],{kind:'parlays',personal:true}).netUnits,2.635);
 ticket.legs.push(prop('3'));assert.equal(units.firstPersonalPrice(ticket,[{ticketId:'personal',legIds:['1','2'],americanOdds:527}]).americanOdds,null);
});
test('push/DNP generated parlay legs reduce payouts; quoted SGPs still require the repriced quote',()=>{
 const ticket={id:'one',legs:[prop('1'),prop('2',{outcome:'push'})]};
 const s=units.summarize([ticket],{kind:'parlays'});assert.equal(s.netUnits,.5);assert.equal(s.review,0);assert.equal(s.decided,1);
 const quoted=units.summarize([{...ticket,priceKind:'posted',americanOdds:500}],{kind:'parlays',personal:true});assert.equal(quoted.netUnits,0);assert.equal(quoted.unpriced,1);
});
test('invalid preferences cannot become stakes or dollars; zero stake is an intentional opt-out',()=>{
 const p=units.preferences({unitDollars:-50,sizes:{layup:NaN,lob:-1,longshot:0,personal:.5,plus_money:1e10}});
 assert.equal(p.unitDollars,null);assert.equal(p.sizes.layup,2);assert.equal(p.sizes.lob,1);assert.equal(p.sizes.longshot,0);assert.equal(p.sizes.plus_money,1);
 assert.equal(units.units(-2.5),'−2.50u');assert.equal(units.dollars(25),'+$25.00');
});
test('parlay row return uses the displayed American price and visitor-sized stake',()=>{
 const settings={unitDollars:100},plus=units.payout(101,{settings});
 assert.equal(plus.available,true);assert.equal(plus.stakeUnits,1);approx(plus.profitUnits,1.01);approx(plus.payoutUnits,2.01);approx(plus.profitDollars,101);approx(plus.payoutDollars,201);
 const html=units.payoutHTML(101,{settings});assert.match(html,/1u wins \$101/);assert.match(html,/\$201 Payout/);assert.doesNotMatch(html,/1u · \$100/);
 const long=units.payout(400,{type:'longshot',settings});assert.equal(long.profitDollars,100);assert.equal(long.payoutDollars,125);assert.equal(long.stakeUnits,.25);
 const custom=units.payout(-200,{settings:{unitDollars:25,sizes:{plus_money:2}}});assert.equal(custom.profitDollars,25);assert.equal(custom.payoutDollars,75);
 const missing=units.payoutHTML(101);assert.match(missing,/1u wins 1.01u/);assert.match(missing,/2.01u Payout/);assert.match(missing,/Set your unit \$/);assert.doesNotMatch(missing,/wins \$/);
 const refund=units.payout(null,{voided:true,settings});assert.equal(refund.profitDollars,0);assert.equal(refund.payoutDollars,100);
 assert.match(units.payoutHTML(null,{voided:true,settings}),/1u refunded/);assert.equal(units.payout(null).available,false);
});
