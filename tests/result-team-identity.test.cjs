const test=require('node:test'),assert=require('node:assert/strict');
const board=require('../assets/pick-board.js');
const source={eventId:'123',athleteId:'456',expectedTeam:'DET'};
const row={market:'PTS',operator:'>=',line:10,period:'full_game'};
const now='2026-11-05T02:00:00Z';
function summary({final=false,dnp=false}={}){
 return {header:{id:'123',competitions:[{status:{type:{completed:final,state:final?'post':'in'}}}]},boxscore:{players:[
  {team:{displayName:'Detroit Pistons',abbreviation:'DET'},statistics:[{labels:['PTS','REB','AST','3PT','MIN'],athletes:[{athlete:{id:'456'},stats:['20','5','3','2-4','30:15'],didNotPlay:dnp}]}]},
  {team:{displayName:'Philadelphia 76ers',abbreviation:'PHI'},statistics:[{labels:['PTS','MIN'],athletes:[{athlete:{id:'789'},stats:['12','25']}]}]}
 ]}};
}
test('ESPN team abbreviations recover live stats, minutes and reached hit status',()=>{
 const result=board.parseSummary(summary(),source,row,now);
 assert.equal(result.actual,20);assert.equal(result.minutesPlayed,30.25);
 assert.equal(result.statisticalOutcome,'reached');assert.equal(result.eventStatus,'live');
 assert.equal(result.sportsbookSettlement,'unverified');
 assert.deepEqual(board.rowStatus({...row,result}),{tone:'hit',icon:'✓',label:'Hit',actual:'20 pts',live:true});
});
test('legacy full team names and unscoped sources preserve their existing results',()=>{
 const abbreviation=board.parseSummary(summary(),source,row,now);
 assert.deepEqual(board.parseSummary(summary(),{...source,expectedTeam:'Detroit Pistons'},row,now),abbreviation);
 assert.deepEqual(board.parseSummary(summary(),{...source,expectedTeam:undefined},row,now),abbreviation);
});
test('known ESPN and NBA abbreviation aliases match in either direction',()=>{
 for(const [espn,nba] of [['NO','NOP'],['NY','NYK'],['GS','GSW'],['SA','SAS'],['UTAH','UTA'],['WSH','WAS']]){
  for(const [actual,expected] of [[espn,nba],[nba,espn]]){
   const body=summary();body.boxscore.players[0].team={displayName:'Unchanged full team name',abbreviation:actual};
   const result=board.parseSummary(body,{...source,expectedTeam:expected},row,now);
   assert.equal(result.actual,20,`${expected} / ${actual}`);assert.equal(result.minutesPlayed,30.25);
  }
 }
});
test('wrong teams and partial names cannot select another team’s athlete',()=>{
 for(const expectedTeam of ['PHI','Philadelphia 76ers','Pistons','DE','det','Unknown']){
  const result=board.parseSummary(summary(),{...source,expectedTeam},row,now);
  assert.equal(result.actual,null,expectedTeam);assert.equal(result.statisticalOutcome,'unavailable',expectedTeam);
  assert.equal(result.minutesPlayed,undefined,expectedTeam);
 }
});
test('exact event and athlete identity checks remain mandatory',()=>{
 assert.throws(()=>board.parseSummary(summary(),{...source,eventId:'124'},row,now),/identity mismatch/);
 assert.throws(()=>board.parseSummary(summary(),{...source,athleteId:'invalid'},row,now),/identity mismatch/);
 const result=board.parseSummary(summary(),{...source,athleteId:'789'},row,now);
 assert.equal(result.actual,null);assert.equal(result.statisticalOutcome,'unavailable');
});
test('duplicate matching athlete rows still fail closed',()=>{
 const body=summary(),athletes=body.boxscore.players[0].statistics[0].athletes;
 athletes.push({...athletes[0]});
 const result=board.parseSummary(body,source,row,now);
 assert.equal(result.actual,null);assert.equal(result.statisticalOutcome,'unavailable');
});
test('abbreviated sources also preserve live under misses, pending lines and final grading',()=>{
 const under={...row,operator:'<',line:19.5},pending={...row,line:25};
 const miss=board.parseSummary(summary(),source,under,now);
 assert.equal(miss.statisticalOutcome,'not_reached');
 assert.equal(board.rowStatus({...under,result:miss}).label,'Miss');
 assert.equal(board.rowStatus({...under,result:miss}).live,true);
 assert.equal(board.parseSummary(summary(),source,pending,now).statisticalOutcome,'pending');
 assert.equal(board.parseSummary(summary({final:true}),source,under,now).statisticalOutcome,'loss');
 assert.equal(board.parseSummary(summary({final:true}),source,row,now).statisticalOutcome,'win');
});
test('final DNPs stay void with abbreviated team identities',()=>{
 const result=board.parseSummary(summary({final:true,dnp:true}),source,row,now);
 assert.equal(result.statisticalOutcome,'dnp');assert.equal(board.rowStatus({...row,result}).label,'Void · DNP');
});
