const test=require('node:test');const assert=require('node:assert/strict');
const pm=require('../assets/plus-money.js');
const leg=(id,p=.85,price=-300)=>({id,player:id,playerId:'nba:'+id,date:'2026-10-28',team:'Team '+id,opponent:'Opponent',canonicalEventId:'nba:'+id,operator:'>=',line:15,market:'PTS',book:'draftkings',americanOdds:price,capturedAt:'2026-10-28T17:00:00Z',estimate:{winProbability:p,asOf:'2026-10-28T12:48:00Z'}});
const ticket=(id,extra={})=>({id,book:'draftkings',section:'plus_money',legs:[leg(id),leg(id+'b')],indicativeAmericanOdds:120,fitReasons:['Reviewed.'],...extra});
test('publication paths reject traversal and identity changes',()=>{
 const e={date:'2026-10-28',version:'0123456789abcdef',path:'2026-10-28/0123456789abcdef.json'};
 assert.equal(pm.safePath(e),e.path);assert.throws(()=>pm.safePath({...e,path:'../../private.json'}));assert.throws(()=>pm.safePath({...e,version:'wrong'}));
});
test('tabs include every published parlay once and favorite counts require explicit editorial flags',()=>{
 const rows=[ticket('a',{ryFavorite:true}),ticket('b',{section:'longshots'}),ticket('c',{legs:[{...leg('c'),ryFavorite:true},leg('d')]})];
 assert.deepEqual(pm.tabCounts(rows),{all:3,plus_money:2,longshots:1,favorites:1});
 assert.deepEqual(pm.filterTickets(rows,pm.readState('?type=longshots')).map(t=>t.id),['b']);
 assert.deepEqual(pm.filterTickets(rows,pm.readState('?favorite=1')).map(t=>t.id),['a']);
 assert.deepEqual(pm.filterTickets(rows,pm.readState()).map(t=>t.id),['a','b','c']);
 assert.equal(pm.isFavorite({...rows[0],ryFavorite:'true'}),false);
});
test('probability filters require every leg and preserve missing estimates without inventing a joint probability',()=>{
 const rows=[ticket('a',{legs:[leg('A',.95),leg('B',.72)]}),ticket('b',{legs:[leg('C',.86),leg('D',.9)]}),ticket('c',{legs:[leg('E',null),leg('F',.99)]})];
 assert.equal(pm.lowestProbability(rows[0]),.72);assert.equal(pm.lowestProbability(rows[2]),null);
 assert.deepEqual(pm.filterTickets(rows,pm.readState('?minimum=80')).map(t=>t.id),['b']);
 assert.deepEqual(pm.filterTickets(rows,pm.readState('?sort=probability_desc')).map(t=>t.id),['b','a','c']);
 assert.deepEqual(pm.filterTickets(rows,pm.readState('?sort=probability_asc')).map(t=>t.id),['a','b','c']);
});
test('search and all facets combine on exact published ticket membership without mutating source',()=>{
 const a=ticket('a',{ryFavorite:true,sourceCoverage:'draftkings',indicativeAmericanOdds:550,section:'longshots',legs:[leg('A'),leg('B'),leg('C')]});
 const b=ticket('b');const rows=[a,b],saved=JSON.stringify(rows);
 const state=pm.readState('?type=longshots&query=Team+A&minimum=80&minPrice=500&favorite=1&coverage=draftkings&legs=3&market=PTS&game=nba%3AB&team=Team+C');
 assert.deepEqual(pm.filterTickets(rows,state),[a]);assert.equal(JSON.stringify(rows),saved);
 for(const [key,value] of [['query','absent'],['minimum',90],['minPrice',600],['coverage','fanduel'],['legs','2'],['market','AST'],['game','nba:absent'],['team','absent']])assert.equal(pm.filterTickets(rows,{...state,[key]:value}).length,0,key);
});
test('price sorting uses selected-book quotes and always places unavailable prices last',()=>{
 const rows=[ticket('a',{indicativeAmericanOdds:200}),ticket('b',{indicativeAmericanOdds:null}),ticket('c',{indicativeAmericanOdds:-110})];
 assert.deepEqual(pm.filterTickets(rows,pm.readState('?sort=price_desc')).map(t=>t.id),['a','c','b']);
 assert.deepEqual(pm.filterTickets(rows,pm.readState('?sort=price_asc')).map(t=>t.id),['c','a','b']);
 assert.deepEqual(pm.filterTickets(rows,pm.readState('?minPrice=100')).map(t=>t.id),['a']);
});
test('filter links round trip and reject invalid state',()=>{
 const state=pm.readState('?type=longshots&query=Brown&minimum=80&minPrice=400&sort=price_desc&favorite=1&coverage=mixed&legs=3&market=AST&game=nba%3A123&team=A');
 assert.deepEqual(pm.readState('?'+pm.stateQuery(state,'2026-10-28')),state);
 const bad=pm.readState('?type=private&minimum=101&minPrice=-300&sort=random&favorite=true&coverage=other&legs=99&market=SECRET');
 assert.deepEqual(bad,pm.readState());
});
test('compact rows escape content, expose explicit favorites and keep combined prices separate from leg estimates',()=>{
 assert.equal(pm.label({operator:'>=',line:15,market:'PTS'}),'15+ points');
 const row=ticket('a',{ryFavorite:true,legs:[leg('<script>x</script>'),leg('B')]});
 const html=pm.ticketRow(row,0);
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('Estimated combined price'));assert.ok(html.includes('Lowest leg est.'));
 assert.ok(html.includes('No verified combined win probability'));assert.ok(html.includes('Ry’s Favorite'));assert.ok(!html.includes('pm-card'));
 assert.match(html,/<details class="pm-row"/);assert.ok(pm.ticketRow(row,0,{open:true}).includes(' open>'));
});
