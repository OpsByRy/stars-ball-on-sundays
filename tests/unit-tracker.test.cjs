'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),units=require('../assets/unit-tracker.js');
const prop=(id,{category='value_safe',odds=-200,outcome='win',live=false,group='research'}={})=>({id,category,group,americanOdds:odds,date:'2026-10-28',playerId:'nba:'+id,market:'PTS',operator:'>=',line:10,result:{eventStatus:live?'live':'final',statisticalOutcome:live&&outcome==='win'?'reached':outcome,actual:outcome==='win'?15:8}});
const approx=(x,y)=>assert.ok(Math.abs(x-y)<1e-9,`${x} != ${y}`);
test('shared pick returns use category stakes and dollars, with personal singles separate from tracking',()=>{
 const settings={unitDollars:100};
 const layup=units.pickPayoutHTML(prop('a'),{settings});assert.match(layup,/2u wins \$100/);assert.match(layup,/\$300 Payout/);
 const lob=units.pickPayoutHTML(prop('b',{category:'high_probability_aggressive',odds:150}),{settings});assert.match(lob,/1u wins \$150/);assert.match(lob,/\$250 Payout/);
 const personal=prop('c',{group:'ry'}),original=JSON.stringify(personal),html=units.pickPayoutHTML(personal,{settings});assert.match(html,/Single return/);assert.match(html,/0.5u wins \$25/);assert.match(html,/\$75 Payout/);assert.equal(units.summarize([personal]).decided,0);assert.equal(JSON.stringify(personal),original);
 assert.equal(units.pickPayoutHTML(prop('bench',{category:'honorable_mention'}),{settings}),'');
 const custom=units.pickPayoutHTML(prop('d'),{settings:{unitDollars:25,sizes:{layup:3}}});assert.match(custom,/3u wins \$37.50/);assert.match(custom,/\$112.50 Payout/);
 const refund=units.pickPayoutHTML(prop('e',{outcome:'dnp'}),{settings});assert.match(refund,/2u refunded/);assert.match(refund,/\$200 Refund/);
 const fallback=units.pickPayoutHTML(prop('f'),{settings:{unitDollars:null}});assert.match(fallback,/2u wins 1u/);assert.match(fallback,/3u Payout/);assert.match(fallback,/Set your unit/);
});
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
 assert.deepEqual(units.defaults,{layup:2,lob:1,plus_money:1,longshot:.25,personal:.5,free_throw:2,floater:1,daily_lob:.75,parlay_layup:1,mid_range:.5,parlay_longshot:.25,logo_lotto:.05});
 const rows=[prop('1',{odds:-250}),prop('2',{category:'high_probability_aggressive',odds:150}),prop('3',{outcome:'loss'})];
 const a=units.summarize(rows),b=units.summarize(rows,{settings:{unitDollars:25}});
 approx(a.netUnits,.3);assert.equal(a.decided,3);approx(a.netDollars,3);approx(b.netDollars,7.5);assert.equal(a.netUnits,b.netUnits);
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
 const missing=units.payoutHTML(101,{settings:{unitDollars:null}});assert.match(missing,/1u wins 1.01u/);assert.match(missing,/2.01u Payout/);assert.match(missing,/Set your unit \$/);assert.doesNotMatch(missing,/wins \$/);
 const refund=units.payout(null,{voided:true,settings});assert.equal(refund.profitDollars,0);assert.equal(refund.payoutDollars,100);
 assert.match(units.payoutHTML(null,{voided:true,settings}),/1u refunded/);assert.equal(units.payout(null).available,false);
});


test('new Daily tiers use separate stake keys while historical defaults and visitor overrides stay intact',()=>{
 const current=(id,odds,category='value_safe')=>({...prop(id,{odds,category}),date:'2026-10-30'});
 const free=current('free',-300),floater=current('floater',-200),lob=current('lob',120,'high_probability_aggressive');
 const settings={unitDollars:100,sizes:{layup:4,lob:2,free_throw:3}};
 assert.equal(units.propType(free),'free_throw');assert.equal(units.propType(floater),'floater');assert.equal(units.propType(lob),'daily_lob');
 assert.match(units.pickPayoutHTML(free,{settings}),/3u wins \$100/);
 assert.match(units.pickPayoutHTML(floater,{settings}),/1u wins \$50/);
 assert.match(units.pickPayoutHTML(lob,{settings}),/0.75u wins \$90/);
 assert.match(units.pickPayoutHTML(prop('old'),{settings}),/4u wins \$200/);
 assert.equal(units.summarize([free,floater,lob]).netUnits,2/3+.5+.9);
 const frozen=require('../assets/slate-policy.js').freezeDaily(free);
 assert.equal(units.propType({...frozen,americanOdds:150}),'free_throw');
});
test('Bench hypothetical research is opt-in, uses price tiers, and never recommends a stake',()=>{
 const bench={...prop('bench',{category:'honorable_mention',odds:150}),date:'2026-10-30'};
 assert.equal(units.propType(bench),null);assert.equal(units.benchType(bench),'daily_lob');
 assert.equal(units.pickPayoutHTML(bench),'');assert.equal(units.stakeHTML(bench),'');
 assert.equal(units.summarize([bench]).decided,0);assert.equal(units.recordHTML([bench]),'');
 const tracked=units.summarize([bench],{bench:true});assert.equal(tracked.decided,1);assert.equal(tracked.netUnits,1.125);
 const html=units.recordHTML([bench],{bench:true});assert.match(html,/Bench hypothetical net/);assert.match(html,/excluded from official pick records/);assert.match(html,/No stake recommendation/);
});
test('new parlay stakes follow original tier after voids and omit model targets entirely',()=>{
 const leg=(id,odds,outcome='win')=>({...prop(id,{odds,outcome}),date:'2026-10-30'});
 const make=(id,odds)=>({id,indicativeAmericanOdds:odds,legs:[leg(id+'a',-200),leg(id+'b',100)]});
 const tickets=[make('a',200),make('b',300),make('c',650),make('d',1200)];
 assert.deepEqual(tickets.map(units.ticketType),['parlay_layup','mid_range','parlay_longshot','logo_lotto']);
 const s=units.summarize(tickets,{kind:'parlays'});assert.deepEqual(s.stakes,{parlay_layup:1,mid_range:.5,parlay_longshot:.25,logo_lotto:.05});assert.equal(s.decided,4);
 const ticket=require('../assets/slate-policy.js').freezeParlay(tickets[2]);ticket.legs[1].result={eventStatus:'final',statisticalOutcome:'dnp'};ticket.indicativeAmericanOdds=-200;
 assert.equal(units.ticketType(ticket),'parlay_longshot');assert.equal(units.summarize([ticket],{kind:'parlays'}).netUnits,.125);
 const target={...tickets[0],priceKind:'model_target'};assert.equal(units.ticketType(target),null);assert.equal(units.summarize([target],{kind:'parlays'}).decided,0);assert.equal(units.summarize([target],{kind:'parlays'}).pending,0);
});

test('new visitors start at $10 per unit while saved dollar and units-only choices persist',()=>{
 for(const saved of [undefined,null,{}, {sizes:{layup:3}}])assert.equal(units.preferences(saved).unitDollars,10);
 for(const unitDollars of [5,25,12.75,null]){
  const saved=JSON.parse(JSON.stringify({unitDollars,sizes:{layup:3,longshot:0}}));
  const next=units.preferences(saved);assert.equal(next.unitDollars,unitDollars);assert.equal(next.sizes.layup,3);assert.equal(next.sizes.longshot,0);
  assert.deepEqual(units.preferences(JSON.parse(JSON.stringify(next))),next);
 }
 const payout=units.payout(100);assert.equal(payout.profitDollars,10);assert.equal(payout.payoutDollars,20);
 assert.match(units.recordHTML([prop('default')]),/Set your units · \$10/);
});

test('all basketball panel and seam button palettes meet normal-text contrast',()=>{
 const fs=require('node:fs'),path=require('node:path'),tokens=fs.readFileSync(path.join(__dirname,'../assets/brand-tokens.css'),'utf8'),css=fs.readFileSync(path.join(__dirname,'../assets/unit-tracker.css'),'utf8');
 const luminance=hex=>{const c=hex.match(/[a-f\d]{2}/gi).map(c=>parseInt(c,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
 const contrast=(a,b)=>{const values=[luminance(a),luminance(b)].sort((a,b)=>a-b);return (values[1]+.05)/(values[0]+.05);};
 const positive=css.match(/\.unit-net\.positive\{color:(#[a-f\d]{6})\}/i)[1],negative=css.match(/\.unit-net\.negative\{color:(#[a-f\d]{6})\}/i)[1];
 for(const brand of ['classic','violet','forest','volt']){
  const declarations=tokens.match(new RegExp('\\[data-brand='+brand+'\\]\\{([^}]+)\\}'))[1];
  const color=name=>declarations.match(new RegExp('--'+name+':(#[a-f\\d]{6})','i'))[1];
  for(const text of [color('brand-ink'),positive,negative])assert.ok(contrast(color('brand-trim'),text)>=4.5,brand+' panel contrast');
  assert.ok(contrast(color('brand-accent'),color('unit-button-text'))>=4.5,brand+' button contrast');
 }
});
