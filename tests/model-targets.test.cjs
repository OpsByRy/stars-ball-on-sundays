const test=require('node:test'),assert=require('node:assert/strict');
const pm=require('../assets/plus-money.js'),results=require('../assets/result-utils.js');
const leg=(id,p=.85)=>({id,player:id,playerId:'nba:123'+id,date:'2026-10-29',team:'Cleveland Cavaliers',opponent:'Atlanta Hawks',canonicalEventId:'nba:0022600144',eventId:'nba:0022600144',startTime:'2026-10-30T00:00:00Z',operator:'>=',line:15,market:'PTS',book:'draftkings',americanOdds:-300,capturedAt:'2026-10-29T23:00:00Z',estimate:{winProbability:p,asOf:'2026-10-29T23:00:00Z'},bookPrices:{checkedAt:'2026-10-29T23:00:00Z',quotes:[{book:'draftkings',americanOdds:-300,capturedAt:'2026-10-29T23:00:00Z',operator:'>=',line:15},{book:'fanduel',americanOdds:-220,capturedAt:'2026-10-29T23:00:00Z',operator:'>',line:14.5}]}});
const target=(extra={})=>({id:'model1',priceKind:'model_target',status:'provisional',compatibility:'These scoring and assist lines share a modeled opportunity sample. Rotation uncertainty still matters.',legs:[leg('A'),{...leg('B'),market:'AST',line:4}],jointEstimate:{asOf:'2026-10-29T23:00:00Z',winProbability:.7,pushProbability:0,lossProbability:.3,fairAmericanOdds:-233,minimumAmericanOdds:-200,lowerProbability:.5,upperProbability:.8,sampleGames:40},...extra});

test('only explicitly supplied coherent joint model targets are admitted; leg products create no target',()=>{
 const t=target();assert.equal(pm.isModelTarget(t),true);
 const bad=[{...t,priceKind:'indicative'},{...t,jointEstimate:undefined},{...t,legs:[leg('A'),{...leg('B'),canonicalEventId:'nba:other',eventId:'nba:other'}]},
  {...t,jointEstimate:{...t.jointEstimate,winProbability:.9}},
  {...t,jointEstimate:{...t.jointEstimate,fairAmericanOdds:150}},
  {...t,jointEstimate:{...t.jointEstimate,minimumAmericanOdds:-400}},
  {...t,jointEstimate:{...t.jointEstimate,lowerProbability:.75}},
  {...t,jointEstimate:{...t.jointEstimate,sampleGames:0}}];
 for(const row of bad)assert.equal(Boolean(pm.isModelTarget(row)),false);
 assert.deepEqual(pm.modelTargets({modelTargets:bad}),[]);
 assert.throws(()=>pm.ticketRow(bad[1],0));
 const even=target({jointEstimate:{...t.jointEstimate,winProbability:.5,lossProbability:.5,fairAmericanOdds:-100,minimumAmericanOdds:110,lowerProbability:.3}});
 assert.equal(pm.isModelTarget(even),true); // -100 and +100 have the same decimal price.
});

test('book preference changes individual prices without inferring ticket odds or changing joint forecasts',()=>{
 const t=target(),original=JSON.stringify(t),fd=pm.pricedTicket(t,'fanduel'),dk=pm.pricedTicket(t,'draftkings');
 assert.equal(fd.legs[0].book,'fanduel');assert.equal(fd.legs[0].americanOdds,-220);
 assert.equal(dk.legs[0].americanOdds,-300);assert.deepEqual(fd.jointEstimate,t.jointEstimate);
 assert.deepEqual(dk.jointEstimate,t.jointEstimate);assert.equal(pm.effectiveOdds(fd),null);
 assert.equal(fd.indicativeAmericanOdds,null);assert.equal(JSON.stringify(t),original);
 assert.notEqual(t.jointEstimate.winProbability,t.legs.reduce((p,r)=>p*r.estimate.winProbability,1));
});

test('all and same-game counts include targets while posted hit and unit records only receive posted tickets',()=>{
 const t=target({ryFavorite:true}),quoted={id:'quoted',section:'plus_money',legs:[{...leg('Q'),result:{eventStatus:'final',statisticalOutcome:'win'}},{...leg('R'),canonicalEventId:'nba:other',result:{eventStatus:'final',statisticalOutcome:'win'}}],indicativeAmericanOdds:120};
 const body={tickets:[quoted],modelTargets:[t]},rows=pm.boardRows(body);
 assert.equal(pm.tabCounts(rows).all,2);assert.equal(pm.tabCounts(rows).same_game,1);assert.equal(pm.tabCounts(rows).plus_money,1);assert.equal(pm.tabCounts(rows).favorites,1);
 const record=results.parlaySummary(pm.categoryTickets(body.tickets,'all'));
 assert.equal(record.total,1);assert.equal(record.hits,1);assert.equal(record.pending,0);
 assert.equal(pm.categoryTickets(body.tickets,'same_game').length,0);
});

test('target filters use saved marginal probabilities and exact game/stat/favorite membership; unquoted price is missing',()=>{
 const t=target({ryFavorite:true}),rows=pm.boardRows({tickets:[],modelTargets:[t]});
 const state=pm.readState('?type=same_game&favorite=1&minimum=80&market=AST&game=nba%3A0022600144&query=Atlanta');
 assert.equal(pm.filterTickets(rows,state).length,1);
 assert.equal(pm.filterTickets(rows,{...state,minimum:90}).length,0);
 assert.equal(pm.filterTickets(rows,{...state,minPrice:100}).length,0);
 assert.equal(pm.filterTickets(rows,{...state,market:'REB'}).length,0);
 assert.equal(pm.filterTickets(rows,{...state,type:'longshots'}).length,0);
});

test('target row shows model pricing and support without a payout, with compatibility before its legs',()=>{
 const t=target({compatibility:'Scoring overlaps with creation. <script>not executable</script>'}),html=pm.ticketRow(t,0);
 assert.match(html,/Provisional · Not quoted/);assert.match(html,/Fair model odds/);assert.match(html,/Target book price -200 or better/);assert.match(html,/Total slip est\./);assert.match(html,/Lowest leg est\./);
 assert.match(html,/40 shared games/);assert.match(html,/model range 50\.0%–80\.0%/);assert.match(html,/excluded from our hit-rate and unit records/);
 assert.doesNotMatch(html,/data-parlay-payout|\$[0-9]|class="pm-payout"|Estimated combined price|<script>/);
 assert.match(html,/&lt;script&gt;/);assert.ok(html.indexOf('Why these legs fit')<html.indexOf('pm-leg-columns'));
 assert.ok(html.indexOf('Joint model support')>html.indexOf('</ol>'));
});

test('voided or withdrawn legs require a new target review and cannot synthesize reduced joint pricing',()=>{
 const t=target(),voided=target({legs:[{...t.legs[0],result:{eventStatus:'final',statisticalOutcome:'dnp'}},t.legs[1]]});
 assert.equal(pm.targetNeedsReview(voided),true);assert.equal(pm.effectiveOdds(voided),null);
 const html=pm.ticketRow(voided,0);assert.match(html,/Needs new review/);assert.match(html,/Saved original joint estimate/);assert.doesNotMatch(html,/After voids \(est\.\)|data-parlay-payout/);
 const withdrawn=target({legs:[{...t.legs[0],confidenceUpdate:{status:'review',qualification:'does_not_qualify'}},t.legs[1]]});
 assert.equal(pm.targetNeedsReview(withdrawn),true);
});
