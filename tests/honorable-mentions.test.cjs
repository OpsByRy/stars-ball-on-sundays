const test=require('node:test');const assert=require('node:assert/strict');const pub=require('../assets/publication.js');
test('mentions have a fourth category and never enter selected picks or their counts',()=>{
 const row={id:'selected',date:'2026-10-28',eventId:'game',playerId:'one',player:'One',market:'PTS',operator:'>=',line:15,group:'research',category:'value_safe'};
 const mention={...row,id:'mention',playerId:'two',category:'honorable_mention',americanOdds:-200,estimate:{winProbability:.75}};
 const body={props:[row,mention,{...row,id:'passed',category:'not_a_pick'}]};
 assert.deepEqual(pub.allPicks(body).map(r=>r.id),['selected']);
 assert.deepEqual(pub.dailyRows(body,'honorable_mention').map(r=>r.id),['mention']);
 assert.equal(pub.tabCounts(body).all,1);assert.equal(pub.tabCounts(body).honorable_mention,1);
 const state=pub.readPickState('?type=honorable_mention&min=75');assert.equal(state.type,'honorable_mention');
 assert.deepEqual(pub.filterPicks(pub.dailyRows(body,state.type),state).map(r=>r.id),['mention']);
 assert.equal(pub.publishedCategory(mention),'honorable_mention');
});
