'use strict';const test=require('node:test'),assert=require('node:assert/strict'),sgp=require('../assets/sgp-math.js');
const legs=[{id:'a',date:'2026-10-29',eventId:'game1',americanOdds:-110},{id:'b',date:'2026-10-29',eventId:'game1',americanOdds:-110}];
test('two Bernoulli outcomes use exact bounded correlation arithmetic',()=>{
 assert.equal(sgp.pairJoint(.5,.5,.4).probability,.35);assert.equal(sgp.pairJoint(.5,.5,-1).probability,0);assert.equal(sgp.pairJoint(.5,.5,1).probability,.5);
 assert.ok(sgp.pairJoint(.95,.95,-.5).error);assert.ok(sgp.pairJoint(1,.5,0).error);assert.ok(sgp.pairJoint(.8,.7,NaN).error);
 for(const a of [.1,.4,.7,.95])for(const b of [.2,.5,.8]){const r=sgp.pairJoint(a,b,0);assert.ok(Math.abs(r.probability-a*b)<1e-12);assert.ok(r.probability>=r.bounds.lower&&r.probability<=r.bounds.upper);}
});
test('actual quoted payout and break-even do not depend on invented correlation or leg products',()=>{
 const r=sgp.analyze(legs,{offeredOdds:250,stake:10});assert.equal(r.type,'sgp');assert.equal(r.payout,35);assert.equal(r.profit,25);assert.equal(r.breakEven,1/3.5);assert.equal(r.scenario,null);assert.equal(r.validatedModel,false);
 assert.equal(sgp.analyze(legs).quotedDecimal,null);assert.equal(sgp.analyze(legs).payout,null);assert.equal(sgp.analyze(legs,{offeredOdds:99}).scenario,undefined);
 const scenario=sgp.analyze(legs,{offeredOdds:250,stake:10,probabilities:[.5,.5],method:'pair',correlation:.4});assert.ok(Math.abs(scenario.scenario.expectedProfit-2.25)<1e-12);assert.equal(scenario.scenario.validated,false);
});
test('positive quote gaps are not automatically classified as positive EV',()=>{
 const r=sgp.analyze(legs,{offeredOdds:400,method:'joint',jointProbability:.1});assert.ok(r.quoteDifference>0);assert.equal(r.scenario.expectedReturnPerUnit,-.5);assert.equal(r.scenario.validated,false);
});
test('three or more legs require a joint scenario rather than guessed pairwise aggregation',()=>{
 const three=[...legs,{id:'c',eventId:'game2',americanOdds:100}];const r=sgp.analyze(three,{probabilities:[.5,.5,.5],method:'pair',correlation:.2});assert.match(r.scenarioError,/three-or-more/);assert.equal(r.scenario,null);assert.equal(r.type,'sgp_plus');
 assert.deepEqual(sgp.bounds([.9,.8,.7]),{lower:.40000000000000036,upper:.7});assert.ok(sgp.analyze(three,{probabilities:[.9,.8,.7],method:'joint',jointProbability:.2}).scenarioError);
 // Pairwise-independent fair Bernoulli triples can have P(all)=0 or .25.
 const parity=[[0,0,0],[0,1,1],[1,0,1],[1,1,0]],odd=parity.map(x=>x.map(y=>1-y));for(const rows of [parity,odd]){assert.equal(rows.filter(x=>x[0]&&x[1]).length/4,.25);assert.equal(rows.filter(x=>x[0]).length/4,.5);}assert.equal(parity.filter(x=>x.every(Boolean)).length,0);assert.equal(odd.filter(x=>x.every(Boolean)).length/4,.25);
});
test('game identities include dates; missing manual labels cannot imply independence',()=>{
 assert.equal(sgp.classify(legs.map((r,i)=>({...r,eventId:'game'+i}))).type,'cross_game');assert.equal(sgp.classify(legs.map(r=>({...r,eventId:null}))).type,'unconfirmed');
 assert.equal(sgp.classify([{game:' NYK @ BOS '},{game:'nyk @ bos'}]).type,'sgp');assert.equal(sgp.classify([{eventId:'g',date:'2026-10-28'},{eventId:'g',date:'2026-10-29'}]).type,'cross_game');
});
test('known contracts reject duplicates, nested ladders, impossible totals and voided prices',()=>{
 const a={...legs[0],playerId:'nba:1',market:'PTS',operator:'>=',line:20},b={...legs[1],playerId:'nba:1',market:'PTS',operator:'>',line:19.5};
 assert.match(sgp.analyze([a,b]).error,/equivalent/);assert.match(sgp.analyze([a,{...b,operator:'<',line:20}]).error,/cannot win/);
 assert.match(sgp.analyze([a,{...b,market:'PRA',operator:'<',line:20}]).error,/impossible/);
 const overlap=sgp.analyze([a,{...b,market:'PRA',operator:'>=',line:30}]);assert.equal(overlap.error,null);assert.equal(overlap.contractWarnings.length,1);
 assert.equal(sgp.analyze([{...a,operator:'<=',line:20},{...b,market:'PRA',operator:'>=',line:20}]).error,null);
 assert.match(sgp.analyze([a,{...legs[1],result:{eventStatus:'final',statisticalOutcome:'dnp'}}]).error,/voided/);
});
test('three-leg component constraints reject impossible totals and honor inclusive integer limits',()=>{
 const base={date:'2026-10-29',eventId:'g',playerId:'nba:1',americanOdds:-110};
 const p={...base,id:'points',market:'PTS',operator:'>=',line:20},r={...base,id:'rebounds',market:'REB',operator:'>=',line:10},c={...base,id:'combo',market:'PRA',operator:'<',line:30};
 assert.match(sgp.analyze([p,r,c]).error,/impossible/);
 assert.match(sgp.analyze([p,r,{...c,operator:'<=',line:29}]).error,/impossible/);
 assert.equal(sgp.analyze([p,r,{...c,operator:'<=',line:30}]).error,null);
 const threes={...base,id:'threes',market:'3PM',operator:'>=',line:3};
 assert.match(sgp.analyze([threes,{...r,line:5},{...c,market:'PR',operator:'<=',line:13}]).error,/impossible/);
 assert.equal(sgp.analyze([threes,{...r,line:5},{...c,market:'PR',operator:'<=',line:14}]).error,null);
 assert.equal(sgp.analyze([p,r,{...c,eventId:'different-game'}]).error,null);
 assert.equal(sgp.analyze([p,r,{...c,date:'2026-10-30'}]).error,null);
});
test('invalid entered marginal estimates block scenarios without hiding valid quoted payouts',()=>{
 for(const probabilities of [[2,.7],[-.1,.7],[NaN,.7],[Infinity,.7],null]){
  const r=sgp.analyze(legs,{offeredOdds:250,stake:10,method:'joint',jointProbability:.4,probabilities});
  assert.match(r.scenarioError,/individual win estimates/);assert.equal(r.scenario,null);assert.equal(r.payout,35);
 }
 for(const probabilities of [[],[null,.7],[undefined,.7]]){
  const r=sgp.analyze(legs,{method:'joint',jointProbability:.4,probabilities});
  assert.equal(r.scenarioError,null);assert.equal(r.scenario.probability,.4);assert.equal(r.marginalBounds,null);
 }
});

test('derived-stat ladders cannot masquerade as added parlay outcomes',()=>{const a={...legs[0],playerId:'nba:1',market:'PTS',operator:'>=',line:30},b={...legs[1],playerId:'nba:1',market:'PRA',operator:'>=',line:20};assert.match(sgp.analyze([a,b]).error,/implied/);assert.match(sgp.analyze([{...a,market:'3PM',line:5},{...b,market:'PTS',line:10}]).error,/implied/);});
