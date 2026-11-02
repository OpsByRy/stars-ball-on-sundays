const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),pm=require('../assets/plus-money.js');
const leg=(id,extra={})=>({id,player:id,playerId:'nba:'+id,date:'2026-10-31',eventId:'nba:same',canonicalEventId:'nba:same',startTime:'2026-11-01T00:00:00Z',market:'PTS',operator:'>=',line:15,book:'draftkings',americanOdds:-300,estimate:{winProbability:.85,asOf:'2026-10-31T20:00:00Z'},...extra});
const target=()=>({id:'joint',priceKind:'model_target',status:'provisional',compatibility:'Reviewed shared model sample.',legs:[leg('a'),leg('b',{market:'AST',line:4})],jointEstimate:{asOf:'2026-10-31T20:00:00Z',winProbability:.7,pushProbability:0,lossProbability:.3,fairAmericanOdds:-233,minimumAmericanOdds:-110,lowerProbability:.5,upperProbability:.8,sampleGames:40,calibrationNote:'Provisional; limited calibration.',method:'Joint scenario model',reviewStatus:'reviewed_provisional',reviewedAt:'2026-10-31T20:02:00Z'}});
test('saved cross-game tickets show a labeled approximation under the new display policy',()=>{
 const root=path.resolve(__dirname,'..'),body=JSON.parse(fs.readFileSync(path.join(root,'data/plus-money/2026-10-31/cb10e36d269532f4.json')));
 assert.equal(body.tickets.length,18);for(const t of body.tickets){const before=JSON.stringify(t),p=pm.totalSlipProbability(t);assert.equal(p.status,'approximate');assert.equal(p.probability,t.legs.reduce((x,l)=>x*l.estimate.winProbability,1));assert.match(pm.ticketRow(t,0),/independence approx/);assert.match(pm.ticketRow(t,0),/Different games can still share risk/);assert.equal(JSON.stringify(t),before);}
});
test('unbound legacy joint value and uncertainty remain audit-only rather than a current total',()=>{
 const t=target(),before=JSON.stringify(t),p=pm.totalSlipProbability(t);assert.equal(p.probability,null);const html=pm.ticketRow(t,0);assert.match(html,/Total slip est\./);assert.match(html,/Unavailable/);assert.match(html,/Saved original joint estimate/);assert.match(html,/70\.0%/);assert.match(html,/model range 50\.0%–80\.0%/);assert.match(html,/legacy scalar is audit-only/);assert.equal(JSON.stringify(t),before);
});
test('changed or voided legs and malformed joint targets cannot display a current total',()=>{
 const t=target();t.legs[0].result={eventStatus:'final',statisticalOutcome:'dnp'};assert.equal(pm.totalSlipProbability(t).probability,null);assert.match(pm.probabilityHTML(t),/Unavailable/);
 const bad=target();bad.jointEstimate.winProbability=.95;assert.equal(pm.totalSlipProbability(bad).probability,null);
 const priced={...target(),priceKind:'indicative',indicativeAmericanOdds:140};assert.equal(pm.totalSlipProbability(priced).probability,null);
});

test('coherent historic model values without an explicit method review remain audit-only',()=>{
 const t=target();delete t.jointEstimate.method;delete t.jointEstimate.reviewStatus;delete t.jointEstimate.reviewedAt;
 assert.equal(pm.isModelTarget(t),true);assert.equal(pm.totalSlipProbability(t).probability,null);assert.match(pm.ticketRow(t,0),/Unavailable/);assert.match(pm.ticketRow(t,0),/Saved original joint estimate/);
});
