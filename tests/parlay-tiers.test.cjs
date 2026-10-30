'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const pm=require('../assets/plus-money.js'),routes=require('../assets/routes.js'),units=require('../assets/unit-tracker.js');
const base='https://example.test/stars-ball-on-sundays/';
const leg=(id,extra={})=>({id,player:id,playerId:'nba:'+id,date:'2026-10-30',team:'Team '+id,opponent:'Opponent',canonicalEventId:'nba:'+id,startTime:'2026-10-30T23:00:00Z',operator:'>=',line:15,market:'PTS',book:'draftkings',americanOdds:-200,capturedAt:'2026-10-30T14:00:00Z',estimate:{winProbability:.85,asOf:'2026-10-30T14:00:00Z'},...extra});
const ticket=(id,price,extra={})=>({id,section:'plus_money',book:'draftkings',legs:[leg(id),leg(id+'b')],indicativeAmericanOdds:price,fitReasons:[],...extra});
test('prospective parlay boundaries use frozen original total price; historical sections remain unchanged',()=>{
 const rows=[ticket('a',-110),ticket('b',200),ticket('c',201),ticket('d',499),ticket('e',500),ticket('f',999),ticket('g',1000)];
 assert.deepEqual(rows.map(pm.section),['layups','layups','mid_range','mid_range','longshots','longshots','logo_lottos']);
 assert.deepEqual(pm.tabCounts(rows),{all:7,layups:2,mid_range:2,longshots:2,logo_lottos:1,same_game:0,favorites:0});
 assert.deepEqual(Object.keys(pm.titlesForDate('2026-10-30')),['all','layups','mid_range','longshots','logo_lottos']);
 const old=ticket('old',1000,{legs:[leg('x',{date:'2026-10-29'}),leg('y',{date:'2026-10-29'})]});
 assert.equal(pm.section(old),'plus_money');assert.equal(units.ticketType(old),'plus_money');
 assert.match(pm.ticketRow(old,0),/Plus Money Parlay 1/);assert.match(pm.ticketRow(rows[2],0),/Mid-Range Parlay 1/);
 assert.match(pm.ticketRow(rows[6],0),/Logo Lotto Parlay 1/);
});
test('book preference and void repricing never move the original tier or its unit stake',()=>{
 const quoteLeg=id=>leg(id,{bookPrices:{checkedAt:'2026-10-30T14:00:00Z',quotes:[{book:'draftkings',americanOdds:-200,capturedAt:'2026-10-30T14:00:00Z',operator:'>=',line:15},{book:'fanduel',americanOdds:100,capturedAt:'2026-10-30T14:00:00Z',operator:'>',line:14.5}]}});
 const source=ticket('anchor',190,{legs:[quoteLeg('a'),quoteLeg('b')]}),before=JSON.stringify(source),fd=pm.pricedTicket(source,'fanduel'),dk=pm.pricedTicket(fd,'draftkings');
 assert.equal(fd.indicativeAmericanOdds,300);assert.equal(pm.section(fd),'layups');assert.equal(pm.section(dk),'layups');assert.equal(units.ticketType(fd),'parlay_layup');
 assert.deepEqual(pm.filterTickets([fd],pm.readState('?date=2026-10-30','#layups')).map(t=>t.id),['anchor']);assert.equal(pm.filterTickets([fd],pm.readState('?date=2026-10-30','#mid-range')).length,0);
 const voided={...dk,legs:[{...dk.legs[0],result:{eventStatus:'final',statisticalOutcome:'win'}},{...dk.legs[1],result:{eventStatus:'final',statisticalOutcome:'dnp'}}]};
 assert.equal(pm.effectiveOdds(voided),-200);assert.equal(pm.section(voided),'layups');assert.equal(units.ticketType(voided),'parlay_layup');assert.match(pm.ticketRow(voided,0),/Won with 1 void/);
 assert.equal(JSON.stringify(source),before);
});
test('same game is independent of modern price tiers and requires exact game identities',()=>{
 const same=ticket('sgp',650,{legs:[leg('a'),leg('b',{canonicalEventId:'nba:a'})]}),cross=ticket('cross',650);
 assert.equal(pm.section(same),'longshots');assert.equal(pm.isSameGame(same),true);assert.equal(units.ticketType(same),'parlay_longshot');
 const state=pm.readState('?date=2026-10-30&sameGame=1','#longshots');assert.deepEqual(pm.filterTickets([same,cross],state).map(t=>t.id),['sgp']);
 assert.match(pm.ticketRow(same,0),/pm-sgp-badge/);assert.doesNotMatch(pm.ticketRow(cross,0),/pm-sgp-badge/);
 assert.deepEqual(pm.readState('?'+pm.stateQuery(state,'2026-10-30')),state);
});
test('current routes preserve date and filters through new hashes and old Plus Money/SGP aliases',()=>{
 for(const [hash,type] of [['layups','layups'],['mid-range','mid_range'],['longshots','longshots'],['logo-lottos','logo_lottos']]){
  const u=routes.canonicalURL(base+'parlays/?date=2026-10-30&minimum=70&favorite=1&sameGame=1#'+hash,base);
  assert.equal(pm.readState(u.search,u.hash).type,type);assert.equal(u.searchParams.get('date'),'2026-10-30');assert.equal(u.searchParams.get('minimum'),'70');assert.equal(u.searchParams.get('favorite'),'1');assert.equal(u.searchParams.get('sameGame'),'1');assert.equal(u.hash,'#'+hash);
 }
 const defaultRedirect=routes.canonicalURL(base+'plus-money/?date=2026-10-30&favorite=1',base);assert.equal(defaultRedirect.hash,'#layups');assert.equal(defaultRedirect.searchParams.get('favorite'),'1');
 const old=routes.canonicalURL(base+'plus-money/?date=2026-10-30&minimum=75&type=plus_money',base);assert.equal(old.pathname,'/stars-ball-on-sundays/parlays/');assert.equal(old.hash,'#layups');assert.equal(old.searchParams.get('minimum'),'75');
 const sgp=routes.canonicalURL(base+'plus-money/?date=2026-10-30&minimum=75#sgp-plus',base);assert.equal(sgp.hash,'');assert.equal(sgp.searchParams.get('sameGame'),'1');assert.equal(pm.readState(sgp.search,sgp.hash).type,'all');
 const historical=routes.canonicalURL(base+'plus-money/?date=2026-10-29#plus-money',base);assert.equal(historical.hash,'#plus-money');assert.equal(pm.readState(historical.search,historical.hash).type,'plus_money');
});
test('Daily aliases are date aware without changing legacy category identities',()=>{
 assert.equal(routes.categoryId('layups','2026-10-29'),'value_safe');assert.equal(routes.categoryName('value_safe','2026-10-29'),'layups');
 for(const value of ['layups','value_safe','free-throws','free_throws'])assert.equal(routes.categoryId(value,'2026-10-30'),'free_throws');
 assert.equal(routes.categoryName('value_safe','2026-10-30'),'free-throws');assert.equal(routes.categoryId('floaters','2026-10-30'),'floaters');assert.equal(routes.categoryId('lobs','2026-10-30'),'high_probability_aggressive');
 const u=routes.canonicalURL(base+'daily/?date=2026-10-30&type=value_safe&favorites=1',base);assert.equal(u.searchParams.get('type'),'free-throws');assert.equal(u.searchParams.get('favorites'),'1');
 const nested=routes.canonicalURL(base+'players/profile.html?board=date%3D2026-10-30%26type%3Dvalue_safe',base);assert.equal(nested.searchParams.get('board'),'date=2026-10-30&type=free-throws');
});
test('new conditional targets have a -110 minimum quote floor without acquiring a tier, price or stake',()=>{
 const a=leg('a'),b=leg('b',{market:'AST',line:4,canonicalEventId:'nba:a'}),t={id:'idea',priceKind:'model_target',status:'provisional',compatibility:'Shared opportunity evidence remains provisional.',legs:[a,b],jointEstimate:{asOf:'2026-10-30T14:00:00Z',winProbability:.7,pushProbability:0,lossProbability:.3,fairAmericanOdds:-233,minimumAmericanOdds:-200,lowerProbability:.5,upperProbability:.8,sampleGames:40}};
 const before=JSON.stringify(t);assert.equal(pm.isModelTarget(t),true);assert.equal(pm.targetMinimum(t),-110);assert.equal(pm.section(t),'same_game');assert.equal(units.ticketType(t),null);
 const html=pm.ticketRow(t,0);assert.match(html,/Target book price -110 or better/);assert.match(html,/<strong>-233<\/strong>/);assert.doesNotMatch(html,/data-parlay-payout|class="pm-payout"/);
 const body=pm.boardRows({tickets:[],modelTargets:[t]});assert.equal(pm.categoryTickets(body,'layups').length,0);assert.equal(pm.tabCounts(body).all,1);assert.equal(pm.tabCounts(body).same_game,1);assert.equal(JSON.stringify(t),before);
 const old={...t,legs:t.legs.map(r=>({...r,date:'2026-10-29',startTime:'2026-10-30T00:00:00Z'})),jointEstimate:{...t.jointEstimate,asOf:'2026-10-29T14:00:00Z'}};assert.equal(pm.targetMinimum(old),-200);
});
