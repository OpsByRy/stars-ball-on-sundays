'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),a=require('../assets/availability.js'),board=require('../assets/pick-board.js'),results=require('../assets/result-utils.js');
const NOW='2026-10-29T17:00:00Z',row={date:'2026-10-29',canonicalEventId:'nba:0022600144',playerId:'nba:1',player:'Fixture Player',team:'Cleveland Cavaliers',startTime:'2026-10-30T00:00:00Z',market:'PTS',operator:'>=',line:10},source={eventId:'123',athleteId:'99',expectedTeam:row.team};
const body=status=>({status:'success',timestamp:NOW,injuries:[{displayName:row.team,injuries:[{date:NOW,status,athlete:{id:'99',links:[{href:'https://www.espn.com/nba/player/_/id/99/fixture'}]}}]}]});
test('Out announcements require exact player/team and a fresh same-day pregame report',()=>{
 const update=a.injuryStatus(body('Out'),row,source,NOW);assert.equal(update.status,'out');
 const shown={...row,result:a.resultFor(row,update)};assert.equal(results.isVoidedLeg(shown),true);assert.equal(board.rowStatus(shown).label,'Void · Out');
 assert.equal(a.injuryStatus(body('Out'),row,{...source,athleteId:'98'},NOW),null);
 assert.equal(a.injuryStatus(body('Out'),{...row,team:'Boston Celtics'},{...source,expectedTeam:'Boston Celtics'},NOW),null);
 assert.equal(a.injuryStatus({...body('Out'),timestamp:'2026-10-28T12:00:00Z'},row,source,NOW),null);
 assert.equal(a.injuryStatus(body('Out'),{...row,date:'2026-10-28'},source,NOW),null);
 assert.equal(a.injuryStatus(body('Out'),{...row,startTime:'2026-10-29T16:00:00Z'},source,NOW),null);
});
test('questionable is not a void, missing entries are not clearance, and explicit changed status can undo an announcement',()=>{
 const out=a.injuryStatus(body('Out'),row,source,NOW),prior={...row,result:a.resultFor(row,out)};
 const uncertain=a.injuryStatus(body('Questionable'),row,source,NOW);assert.equal(uncertain.status,'uncertain');assert.equal(a.resultFor(row,uncertain),null);
 assert.equal(a.resultFor(prior,uncertain).statisticalOutcome,'pending');assert.equal(a.injuryStatus({...body('Out'),injuries:[]},row,source,NOW),null);
 const played={...prior,result:{eventStatus:'live',actual:0,minutesPlayed:12,statisticalOutcome:'pending'}};assert.equal(a.resultFor(played,out),null);
 assert.equal(board.mergeResult(prior.result,{eventStatus:'live',statisticalOutcome:'unavailable',actual:null}).statisticalOutcome,'out');
 assert.equal(board.mergeResult(prior.result,{eventStatus:'scheduled',statisticalOutcome:'unavailable',actual:0,minutesPlayed:0}).statisticalOutcome,'out');
 assert.equal(board.mergeResult(prior.result,{eventStatus:'scheduled',statisticalOutcome:'unavailable',actual:0,minutesPlayed:0,checkedAt:'2026-10-29T17:10:00Z'}).checkedAt,NOW);
 assert.equal(board.mergeResult(prior.result,{eventStatus:'live',statisticalOutcome:'pending',actual:0,minutesPlayed:2}).statisticalOutcome,'pending');
});
test('a voided calculator leg stays visible but contributes no odds or stake loss',()=>{
 const inactive={...row,americanOdds:-200,result:{statisticalOutcome:'out',eventStatus:'scheduled'}},active={...row,playerId:'nba:2',americanOdds:-150};
 assert.equal(board.addLeg([],inactive).action,'void');
 const adjusted=board.calculate([inactive,active],10);assert.ok(Math.abs(adjusted.decimal-5/3)<1e-10);assert.ok(Math.abs(adjusted.returnAmount-50/3)<1e-10);
 assert.equal(board.calculate([inactive],10).returnAmount,10);assert.equal(board.calculate([inactive],10).profit,0);
});
test('official NBA inactives require exact game/date/player; they do not infer a DNP from missing stats',()=>{
 const fixture={boxScoreSummary:{gameId:'0022600144',gameTimeUTC:'2026-10-30T00:00:00Z',gameStatus:3,homeTeam:{inactives:[{personId:1}]},awayTeam:{inactives:[]}}};
 const update=a.nbaInactive(fixture,row,NOW);assert.equal(update.status,'dnp');assert.equal(a.resultFor(row,update).eventStatus,'final');
 assert.equal(a.nbaInactive(fixture,{...row,playerId:'nba:2'},NOW),null);assert.equal(a.nbaInactive(fixture,{...row,date:'2026-10-28'},NOW),null);
 assert.equal(a.nbaInactive(fixture,{...row,canonicalEventId:'nba:0022600145'},NOW),null);
 assert.equal(a.resultFor(row,{...update,status:'unknown'}),null);
});
test('one exact availability observation voids every market/book for that player but no other player or game',()=>{
 const update={date:row.date,eventId:row.canonicalEventId,playerId:row.playerId,status:'out',asOf:NOW,source:a.SOURCE},feed={updates:[update]};
 for(const market of ['PTS','AST','PRA'])for(const book of ['fanduel','draftkings'])assert.equal(a.resultFor({...row,market,book},a.savedStatus({...row,market,book},feed)).statisticalOutcome,'out');
 assert.equal(a.savedStatus({...row,playerId:'nba:2'},feed),null);assert.equal(a.savedStatus({...row,canonicalEventId:'nba:0022600145'},feed),null);
});
