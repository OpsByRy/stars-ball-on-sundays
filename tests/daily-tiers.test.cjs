'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const pub=require('../assets/publication.js'),units=require('../assets/unit-tracker.js');
const pick=(id,odds,date='2026-10-30')=>({id,date,player:'Player '+id,playerId:'nba:'+id,group:'research',category:odds<=-200?'value_safe':'high_probability_aggressive',americanOdds:odds,book:'draftkings',market:'PTS',operator:'>=',line:15,eventId:'game',canonicalEventId:'nba:game',estimate:{winProbability:.85,projection:20}});
test('new Daily price tiers filter all original contracts without changing stored categories',()=>{
 const rows=[pick('a',-500),pick('b',-250),pick('c',-249),pick('d',-111),pick('e',-110),pick('f',150)],body={date:'2026-10-30',props:rows},before=JSON.stringify(body);
 assert.deepEqual(pub.dailyCategories(body).map(x=>x[1]),['All Daily Picks','Free Throws','Floaters','Lobs','Bench']);
 assert.equal(pub.allPicks(body).length,6);assert.equal(pub.tabCounts(body).free_throws,2);assert.equal(pub.tabCounts(body).floaters,2);assert.equal(pub.tabCounts(body).high_probability_aggressive,2);
 for(const [type,ids]of [['free_throws',['a','b']],['floaters',['c','d']],['high_probability_aggressive',['e','f']]])assert.deepEqual(pub.filterPicks(rows,{type}).map(r=>r.id),ids);
 assert.equal(JSON.stringify(body),before);
});
test('Daily saved-price preference overlays cannot move a pick between tiers or change its sizing',()=>{
 const row=pick('a',-249);row.bookPrices={quotes:[{book:'fanduel',americanOdds:-270,operator:'>=',line:15,capturedAt:'2026-10-30T14:00:00Z'}]};
 const priced=pub.pricedPick(row);assert.equal(priced.americanOdds,-270);assert.equal(pub.publishedCategory(priced),'floaters');assert.equal(units.propType(priced),'floater');assert.equal(row.americanOdds,-249);
});
test('Daily aliases retain filters and old boards retain original category membership and stake defaults',()=>{
 const future=pub.readPickState('?date=2026-10-30&type=layups&min=80&favorites=1');assert.equal(future.type,'free_throws');assert.equal(future.minimum,80);assert.equal(future.favoritesOnly,true);
 const search=new URLSearchParams(pub.pickSearch('2026-10-30',{...future,type:'floaters'}));assert.equal(search.get('type'),'floaters');assert.equal(search.get('min'),'80');assert.equal(search.get('favorites'),'1');
 const old=pick('old',-150,'2026-10-29');assert.equal(pub.publishedCategory(old),'high_probability_aggressive');assert.equal(units.propType(old),'lob');assert.equal(units.payoutHTML(-150,'lob').includes('1u wins'),true);
});
