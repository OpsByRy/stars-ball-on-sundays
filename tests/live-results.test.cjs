const test=require('node:test'),assert=require('node:assert/strict');
const contracts=require('../assets/result-utils.js'),board=require('../assets/pick-board.js'),pub=require('../assets/publication.js');
const prop=(operator='>=',line=10,market='PTS')=>({operator,line,market,period:'full_game'});
const grade=(p,stats,eventStatus='live')=>({...p,result:contracts.evaluateStructured(p,{eventStatus,stats})});
test('reached live counting-stat overs display Hit and count as wins while remaining live',()=>{
 for(const [p,stats] of [[prop(),{PTS:10}],[prop('>',9.5),{PTS:10}],[prop('>=',4,'AST'),{AST:4}],[prop('>=',15,'RA'),{REB:9,AST:6}]]){
  const row=grade(p,stats);assert.equal(contracts.isLiveHit(row),true);assert.equal(board.rowStatus(row).label,'Hit');assert.equal(board.rowStatus(row).live,true);
  assert.deepEqual(pub.summary([row]),{total:1,hits:1,misses:0,pushes:0,other:0,pending:0});assert.equal(row.result.eventStatus,'live');assert.notEqual(row.result.sportsbookSettlement,'won');
 }
});
test('strict-line equality, unders and missing components cannot be counted as live wins',()=>{
 for(const row of [grade(prop('>',10),{PTS:10}),grade(prop('<',10),{PTS:3}),grade(prop('>=',15,'RA'),{REB:15}),{...prop('<',10),result:{eventStatus:'live',statisticalOutcome:'reached',actual:3}}]){
  assert.equal(contracts.isStatisticalHit(row),false);assert.equal(pub.summary([row]).hits,0);assert.equal(pub.summary([row]).pending,1);
 }
 const final=grade(prop('<',10),{PTS:3},'final');assert.equal(pub.summary([final]).hits,1);assert.equal(board.rowStatus(final).live,false);
});
test('official live corrections can remove a reached hit and final corrections remain final',()=>{
 const p=prop(),hit=grade(p,{PTS:10}),corrected=grade(p,{PTS:9});
 const merged={...p,result:board.mergeResult(hit.result,corrected.result)};assert.equal(pub.summary([merged]).hits,0);assert.equal(pub.summary([merged]).pending,1);
 const final=grade(p,{PTS:9},'final');assert.equal(pub.summary([final]).misses,1);assert.equal(board.mergeResult(final.result,hit.result),final.result);
});
