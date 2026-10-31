'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const publication=require('../assets/publication.js');
const forecast=probability=>({winProbability:probability,pushProbability:0,lossProbability:1-probability,projection:12,status:'provisional',asOf:'2026-10-30T14:00Z'});
const row=(id,extra={})=>({id,date:'2026-10-30',eventId:'nba:0022600017',playerId:'nba:1',player:'José Example',team:'Team One',opponent:'Team Two',market:'PTS',operator:'>',line:8.5,side:'over',period:'full_game',product:'sportsbook',startTime:'2026-10-30T23:00Z',capturedAt:'2026-10-30T15:00Z',group:'research',category:'not_a_pick',book:'fanduel',americanOdds:-150,estimate:forecast(.65),...extra});
const ids=(rows,state={})=>publication.researchPage(rows,{size:500,...state}).rows.map(r=>r.id);

test('probability sorting puts real zero and one at their boundaries and unknown/held estimates last in either direction',()=>{
 const rows=[row('missing',{estimate:undefined}),row('one',{estimate:forecast(1)}),row('held',{confidenceUpdate:{status:'review',estimate:forecast(.99)}}),row('zero',{estimate:forecast(0)}),row('middle'),row('equal'),row('stale',{estimate:{...forecast(.9),asOf:'invalid'}})],before=JSON.stringify(rows);
 assert.deepEqual(ids(rows,{sort:'probability_asc'}),['zero','middle','equal','one','missing','held','stale']);
 assert.deepEqual(ids(rows,{sort:'probability_desc'}),['one','middle','equal','zero','missing','held','stale']);
 assert.deepEqual(ids(rows,{sort:'reviewed'}),rows.map(r=>r.id));
 assert.deepEqual(ids(rows,{minProbability:'0',maxProbability:'100',sort:'probability_asc'}),['zero','middle','equal','one']);
 assert.equal(JSON.stringify(rows),before);
});

test('percentage range endpoints are inclusive and use saved probability before display rounding',()=>{
 const rows=[row('zero',{estimate:forecast(0)}),row('decimal',{estimate:forecast(.29)}),row('below-rounded',{estimate:forecast(.74499)}),row('exact',{estimate:forecast(.745)}),row('above',{estimate:forecast(.74501)}),row('one',{estimate:forecast(1)}),row('unknown',{estimate:undefined})];
 assert.deepEqual(ids(rows,{minProbability:'29',maxProbability:'29'}),['decimal']);
 assert.deepEqual(ids(rows,{minProbability:'74.5',maxProbability:'74.5'}),['exact']);
 assert.deepEqual(ids(rows,{maxProbability:'0'}),['zero']);
 assert.deepEqual(ids(rows,{minProbability:'100'}),['one']);
 assert.deepEqual(ids(rows,{minProbability:'74.5'}),['exact','above','one']);
});

test('American price sorting follows payout across the sign boundary, with equivalent even money tied stably',()=>{
 const rows=[row('missing',{americanOdds:null}),row('plus-even',{americanOdds:100}),row('long',{americanOdds:300}),row('short',{americanOdds:-800}),row('minus-even',{americanOdds:-100}),row('favorite',{americanOdds:-200}),row('plus',{americanOdds:125}),row('invalid-zero',{americanOdds:0}),row('invalid-string',{americanOdds:'200'})],before=JSON.stringify(rows);
 assert.deepEqual(ids(rows,{sort:'price_asc'}),['short','favorite','plus-even','minus-even','plus','long','missing','invalid-zero','invalid-string']);
 assert.deepEqual(ids(rows,{sort:'price_desc'}),['long','plus','plus-even','minus-even','favorite','short','missing','invalid-zero','invalid-string']);
 assert.deepEqual(ids(rows,{minPrice:'-200',maxPrice:'+125',sort:'price_asc'}),['favorite','plus-even','minus-even','plus']);
 assert.deepEqual(ids(rows,{minPrice:'-100',maxPrice:'+100'}),['plus-even','minus-even']);
 assert.deepEqual(ids(rows,{minPrice:'+100',maxPrice:'-100'}),['plus-even','minus-even']);
 assert.deepEqual(ids(rows,{maxPrice:'-800'}),['short']);
 assert.equal(JSON.stringify(rows),before);
});

test('invalid limits are explicit errors, not silently reversed, clamped or interpreted as zero',()=>{
 for(const [key,values] of Object.entries({minProbability:['-1','100.1','NaN','1e2','Infinity','-'],maxProbability:['101','abc'],minPrice:['0','99','-99','+','1e3'],maxPrice:['-50','Infinity']}))for(const value of values){
  const state={[key]:value},result=publication.researchPage([row('known')],state);
  assert.ok(result.errors[key],key+' '+value);assert.equal(result.rows.length,0);assert.equal(result.total,0);
 }
 for(const state of [{minProbability:'90',maxProbability:'70'},{minPrice:'+200',maxPrice:'-200'}]){
  const result=publication.researchPage([row('known')],state);assert.equal(Object.keys(result.errors).length,2);assert.equal(result.rows.length,0);
 }
 assert.deepEqual(publication.researchRanges({minProbability:' 0 ',maxProbability:'100',minPrice:'−200',maxPrice:'+200'}).errors,{});
 assert.deepEqual(publication.researchRanges({minProbability:'',maxProbability:'',minPrice:'',maxPrice:''}).values,{minProbability:null,maxProbability:null,minPrice:null,maxPrice:null});
});

test('search, every existing filter, ranges and sorting combine before pagination without mutating sources',()=>{
 const rows=Array.from({length:45},(_,i)=>row('match-'+i,{estimate:forecast(.5+i/100),americanOdds:100+i}));
 rows.push(row('wrong-player',{player:'Someone Else'}),row('wrong-market',{market:'AST'}),row('wrong-category',{category:'honorable_mention'}),row('wrong-side',{side:'under',operator:'<'}),row('wrong-line',{line:18.5}),row('held',{confidenceUpdate:{status:'review',estimate:forecast(.9)}}));
 const state={query:'jose team two over 8.5 points',market:'PTS',status:'not_a_pick',probability:'with_probability',side:'over',line:'8.5',minProbability:'60',maxProbability:'80',minPrice:'+110',maxPrice:'+130',sort:'probability_desc',size:5},before=JSON.stringify(rows);
 const first=publication.researchPage(rows,state),second=publication.researchPage(rows,{...state,page:1});
 assert.equal(first.total,21);assert.equal(first.pages,5);assert.deepEqual(first.rows.map(r=>r.id),['match-30','match-29','match-28','match-27','match-26']);
 assert.deepEqual(second.rows.map(r=>r.id),['match-25','match-24','match-23','match-22','match-21']);
 assert.equal(JSON.stringify(rows),before);
});

test('price ordering and ranges use the displayed preferred-book quote and its existing fallback',()=>{
 const quote=(book,americanOdds)=>({book,americanOdds,operator:'>',line:8.5,capturedAt:'2026-10-30T15:00Z'});
 const rows=[row('two-books',{americanOdds:-500,bookPrices:{quotes:[quote('fanduel',-200),quote('draftkings',150)]}}),row('one-book',{americanOdds:110}),row('no-price',{americanOdds:null})],before=JSON.stringify(rows);
 assert.deepEqual(ids(rows,{sort:'price_asc',preferredBook:'fanduel'}),['two-books','one-book','no-price']);
 assert.deepEqual(ids(rows,{sort:'price_asc',preferredBook:'draftkings'}),['one-book','two-books','no-price']);
 assert.deepEqual(ids(rows,{minPrice:'+120',preferredBook:'fanduel'}),[]);
 assert.deepEqual(ids(rows,{minPrice:'+120',preferredBook:'draftkings'}),['two-books']);
 assert.equal(JSON.stringify(rows),before);
});

test('a known saved price remains usable independently of a held probability, without reviving its estimate',()=>{
 const held=row('held',{confidenceUpdate:{status:'review',estimate:forecast(.99)}});
 assert.deepEqual(ids([held],{minPrice:'-200',maxPrice:'-100'}),['held']);
 assert.deepEqual(ids([held],{minProbability:'0'}),[]);
});

test('sort and all range values survive reload/date URLs along with encoded board-return state',()=>{
 const search='?date=2026-10-30&q=Jose&market=PTS&review=not_a_pick&probability=with_probability&side=over&line=8.5&sort=price_desc&win_min=0&win_max=75.5&price_min=-200&price_max=%2B200&board=date%3D2026-10-29%26type%3Dlobs';
 const state=publication.readResearchState(search);assert.equal(state.minProbability,'0');assert.equal(state.maxPrice,'+200');assert.equal(state.sort,'price_desc');
 const next=publication.researchSearch('2026-10-31',state,search),params=new URLSearchParams(next);assert.equal(params.get('date'),'2026-10-31');assert.equal(params.get('board'),'date=2026-10-29&type=lobs');assert.deepEqual(publication.readResearchState(next),state);
 const reset=new URLSearchParams(publication.researchSearch('2026-10-31',publication.readResearchState(),next));for(const key of ['sort','win_min','win_max','price_min','price_max','q'])assert.equal(reset.has(key),false);
 assert.equal(publication.readResearchState('?sort=private').sort,'reviewed');
 for(const query of ['all','reviewed'])assert.equal(new URLSearchParams(publication.researchSearch('2026-10-31',{query})).get('q'),query);
 const invalid=publication.readResearchState('?win_min=bad&price_min=0');assert.ok(publication.researchRanges(invalid).errors.minProbability);assert.ok(publication.researchRanges(invalid).errors.minPrice);
});

test('range markup groups fields, describes inclusive units, exposes errors and opens for saved limits',()=>{
 const html=publication.researchValueControls({minProbability:'0',maxPrice:'+200'});
 assert.match(html,/<details class="research-numeric-filters" open>/);assert.match(html,/<legend>Win estimate \(%\)<\/legend>/);assert.match(html,/Minimum price \(American\)/);assert.match(html,/role="alert"/);
 for(const id of ['research-win-min','research-win-max','research-price-min','research-price-max'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/before rounding/);assert.match(html,/even-money prices are equivalent/);assert.match(html,/value="0"/);assert.match(html,/value="\+200"/);
 assert.doesNotMatch(publication.researchValueControls(),/<details class="research-numeric-filters" open>/);
});
