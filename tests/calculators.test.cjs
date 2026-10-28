'use strict';const test=require('node:test'),assert=require('node:assert/strict'),rr=require('../assets/round-robin.js'),board=require('../assets/pick-board.js'),profiles=require('../assets/player-profiles.js');
const legs=[1,2,3].map(n=>({id:String(n),player:'Player '+n,eventId:'event'+n,date:'2026-10-28',americanOdds:100}));
test('round robin stake is per combination, returns include stake, and loss scenarios pay only surviving combinations',()=>{
  const r=rr.calculate(legs,[2],10);assert.equal(r.totals.combinations,3);assert.equal(r.totals.stake,30);assert.equal(r.totals.allWinReturn,120);assert.equal(r.totals.allWinProfit,90);
  const loss=rr.calculate(legs,[2],10,{outcomes:{'3':'loss'}});assert.equal(loss.totals.scenarioReturn,40);assert.equal(loss.totals.scenarioProfit,10);
  const push=rr.calculate(legs,[2],10,{outcomes:{'1':'push','3':'loss'}});assert.equal(push.totals.scenarioReturn,20);assert.equal(push.totals.scenarioProfit,-10);
  assert.equal(rr.calculate(legs,[2],10,{outcomes:{'1':'push','2':'push','3':'push'}}).totals.scenarioProfit,0);
  assert.equal(rr.calculate(legs,[2],10,{outcomes:{'1':'pending'}}).totals.scenarioReturn,null);
});
test('same-game exclusion removes only ineligible combinations and works with manual game labels',()=>{
  const same=[legs[0],{...legs[1],eventId:legs[0].eventId},legs[2]];
  assert.equal(rr.calculate(same,[2],10).totals.combinations,2);assert.equal(rr.calculate(same,[2],10,{excludeSameGame:false}).totals.combinations,3);
  assert.equal(rr.calculate(same,[3],10).totals.combinations,0);
  const manual=[{...legs[0],game:'NYK vs BOS'},{...legs[1],game:' nyk VS bos '},legs[2]];
  assert.equal(rr.calculate(manual,[2],10).totals.combinations,2);
  assert.equal(rr.calculate(legs.map(({eventId,...l})=>l),[2],10).totals.combinations,3);
});
test('multiple sizes count each ticket once and reject invalid odds or excess selections',()=>{
  const r=rr.calculate(legs,[2,2,3],1);assert.equal(r.totals.combinations,4);assert.equal(r.totals.allWinReturn,20);
  assert.equal(rr.calculate([{id:'x',americanOdds:0}],[],1).rows.length,0);
  assert.ok(rr.calculate(Array(21).fill(legs[0]),[2],1).error);
  assert.equal(rr.calculate(legs,[2],0).totals.stake,null);
  assert.equal(rr.calculate(legs,[2],NaN).totals.allWinReturn,null);
  assert.equal(rr.calculate(legs,[2],1000001).totals.stake,null);
});
test('dynamic combination totals agree with independently enumerated tickets for mixed prices and game groups',()=>{
  const sample=[-200,150,-110,220,-300,100].map((americanOdds,i)=>({id:String(i),americanOdds,eventId:String(Math.floor(i/2))}));
  for(const size of [2,3])for(const excludeSameGame of [true,false]){
    let count=0,sum=0,scenario=0;function visit(chosen,start){if(chosen.length===size){if(excludeSameGame&&new Set(chosen.map(i=>sample[i].eventId)).size<size)return;count++;sum+=chosen.reduce((a,i)=>a*(sample[i].americanOdds>0?1+sample[i].americanOdds/100:1+100/-sample[i].americanOdds),1);scenario+=chosen.reduce((a,i)=>a*(i===0?0:i===1?1:sample[i].americanOdds>0?1+sample[i].americanOdds/100:1+100/-sample[i].americanOdds),1);return;}for(let i=start;i<sample.length;i++)visit([...chosen,i],i+1);}visit([],0);
    const r=rr.calculate(sample,[size],2,{excludeSameGame,outcomes:{0:'loss',1:'push'}});assert.equal(r.totals.combinations,count);assert.ok(Math.abs(r.totals.allWinReturn-2*sum)<1e-9);assert.ok(Math.abs(r.totals.scenarioReturn-2*scenario)<1e-9);
  }
});
test('personal parlay calculation uses entered odds without requiring an SBOS forecast or manufacturing correlation',()=>{
  const r=board.calculate([{id:'one',manual:true,player:'My pick',americanOdds:-200},{id:'two',manual:true,player:'Another',americanOdds:150}],10);
  assert.equal(r.decimal,3.75);assert.equal(r.american,275);assert.equal(r.returnAmount,37.5);assert.equal(r.profit,27.5);assert.equal(r.correlated,false);
});
test('profile averages use made/attempted totals for shooting and preserve zero defensive stats',()=>{
  const stats=profiles.seasonSummary([{stats:{PTS:0,REB:4,AST:2,FGM:1,FGA:2}},{stats:{PTS:20,REB:6,AST:4,FGM:1,FGA:8}}]);assert.deepEqual(stats,{PTS:10,REB:5,AST:3,'FG%':20});
  assert.equal(profiles.seasonSummary([])['FG%'],null);
});
