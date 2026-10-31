'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const board=require('../assets/pick-board.js'),publication=require('../assets/publication.js'),results=require('../assets/result-utils.js');
const now=Date.parse('2026-10-30T20:00Z');
const estimate=(p=.65)=>({winProbability:p,pushProbability:0,lossProbability:1-p,projection:12,status:'provisional',asOf:'2026-10-30T14:00Z'});
const row=(id='one',extra={})=>({id,date:'2026-10-30',eventId:'nba:0022600017',playerId:'nba:1',player:'José Example',team:'Team One',opponent:'Team Two',market:'PTS',operator:'>',line:8.5,side:'over',period:'full_game',product:'sportsbook',startTime:'2026-10-30T23:00Z',capturedAt:'2026-10-30T15:00Z',group:'research',category:'not_a_pick',estimate:estimate(),...extra});

test('saved exact-line probabilities require complete outcomes, identities, supported status and pregame clocks',()=>{
 const r=row(),before=JSON.stringify(r),read=board.researchProbability(r,{now});assert.equal(read.status,'available');assert.equal(read.probability,.65);assert.equal(read.started,false);
 for(const change of [{estimate:estimate(0)},{estimate:estimate(1)},{estimate:{...estimate(),status:'validated'}},{americanOdds:null}])assert.equal(board.researchProbability({...r,...change},{now}).status,'available');
 for(const change of [{estimate:{...estimate(),winProbability:NaN}},{estimate:{...estimate(),pushProbability:undefined}},{estimate:{...estimate(),lossProbability:.8}},{estimate:{...estimate(),status:'unknown'}},{side:'under'},{playerId:null},{eventId:null},{operator:'?'},{line:-1},{period:'first_quarter'},{product:'unknown'}])assert.equal(board.researchProbability({...r,...change},{now}).status,'unavailable');
 assert.equal(JSON.stringify(r),before);
});

test('review, unavailable and missing latest estimates never fall back to an older probability',()=>{
 const original=row();
 for(const status of ['review','unavailable']){
  const r={...original,confidenceUpdate:{status,checkedAt:original.estimate.asOf,estimate:original.estimate,qualification:'qualifies'}};
  assert.equal(board.researchProbability(r,{now}).status,status==='review'?'held':'unavailable');assert.equal(board.researchProbability(r,{now}).probability,null);assert.equal(board.researchAnalysis(r).display.win,'—');
 }
 const missing={...original,confidenceUpdate:{status:'supported',checkedAt:'2026-10-30T16:00Z'}};
 assert.equal(board.researchProbability(missing,{now}).status,'unavailable');assert.equal(board.researchAnalysis(missing).display.win,'—');
 assert.match(board.researchFreshnessHTML(missing),/Forecast saved unavailable/);assert.doesNotMatch(board.researchFreshnessHTML(missing),/14:00/);
 const quoteUnavailable={...original,confidenceUpdate:{status:'supported',checkedAt:original.estimate.asOf,qualification:'unavailable',americanOdds:null,estimate:original.estimate}};
 assert.equal(board.researchProbability(quoteUnavailable,{now}).status,'available'); // A missing quote is independent of an exact-line forecast.
 for(const outcome of ['out','dnp','canceled','postponed'])assert.equal(board.researchProbability({...original,result:{statisticalOutcome:outcome}},{now}).status,'unavailable');
});

test('missing, future, post-start and superseded forecast clocks are marked for freshness review',()=>{
 for(const asOf of [undefined,'not a time','2026-10-30T14:00','2026-10-30T22:00Z','2026-10-30T23:00Z'])assert.equal(board.researchProbability(row('time',{estimate:{...estimate(),asOf}}),{now}).status,'stale');
 const mismatched=row('update',{confidenceUpdate:{status:'supported',checkedAt:'2026-10-30T16:00Z',estimate:estimate()}});assert.equal(board.researchProbability(mismatched,{now}).status,'stale');
 const archive=board.researchProbability(row(),{now:Date.parse('2026-10-31T12:00Z')});assert.equal(archive.status,'available');assert.equal(archive.started,true);
 assert.match(board.researchFreshnessHTML(row(),archive),/Pregame snapshot; game has started/);
});

test('sample hit rates and projections do not become probabilities; source clocks remain distinct',()=>{
 const none=row('none',{estimate:undefined,evidence:'9 of 10 hit (90%)'});assert.equal(board.researchProbability(none,{now}).status,'unassessed');assert.equal(board.researchAnalysis(none).display.win,'—');
 assert.equal(board.researchProbability(row('projection',{estimate:{projection:12,status:'provisional',asOf:'2026-10-30T14:00Z'}}),{now}).status,'projection_only');
 const html=board.researchFreshnessHTML(row());assert.match(html,/2026-10-30T14:00Z/);assert.match(html,/2026-10-30T15:00Z/);
 const missingQuote=board.researchFreshnessHTML(row('quote',{priceCapturedAt:null}));assert.match(missingQuote,/Odds saved unavailable/);assert.doesNotMatch(missingQuote,/2026-10-30T15:00Z/);
});

test('probability filters combine with player/team, market, review category, side, line and pagination',()=>{
 const rows=Array.from({length:85},(_,i)=>row(String(i),{market:i<60?'PTS':'AST',category:i%2?'not_a_pick':'value_safe',estimate:i%3?estimate():undefined}));
 const before=JSON.stringify(rows),all=publication.researchPage(rows,{probability:'with_probability',size:200});assert.equal(all.total,56);assert.ok(all.rows.some(r=>r.category==='not_a_pick'));
 const filtered=publication.researchPage(rows,{query:'jose team two 8.5',market:'PTS',status:'not_a_pick',probability:'with_probability',side:'over',line:'8.5'});
 assert.equal(filtered.total,20);assert.ok(filtered.rows.every(r=>r.market==='PTS'&&r.category==='not_a_pick'&&r.estimate));
 assert.equal(publication.researchPage(rows,{probability:'with_probability',page:1}).rows.length,16);
 assert.equal(publication.researchPage(rows,{probability:'without_probability',size:200}).total,29);
 assert.equal(publication.researchPage(rows,{query:'missing'}).total,0);assert.equal(publication.researchPage(rows,{line:'18.5'}).total,0);assert.equal(JSON.stringify(rows),before);
});

test('numeric queries do not match nearby lines, projections or sample rates; strict boundaries retain pushes',()=>{
 const rows=[row('over',{operator:'>',line:8}),row('atleast',{operator:'>=',line:8}),row('under',{operator:'<',side:'under',line:8}),row('other',{line:18.5})];
 assert.deepEqual(publication.researchPage(rows,{query:'over 8 points'}).rows.map(r=>r.id),['over']);
 assert.deepEqual(publication.researchPage(rows,{query:'>=8'}).rows.map(r=>r.id),['atleast']);
 assert.deepEqual(publication.researchPage(rows,{query:'8+'}).rows.map(r=>r.id),['atleast']);
 assert.deepEqual(publication.researchPage(rows,{query:'under 8 points'}).rows.map(r=>r.id),['under']);
 assert.equal(publication.researchPage(rows,{query:'18'}).total,0);
 assert.equal(results.evaluateStructured(rows[0],{eventStatus:'final',stats:{PTS:8}}).statisticalOutcome,'push');assert.equal(results.evaluateStructured(rows[1],{eventStatus:'final',stats:{PTS:8}}).statisticalOutcome,'win');
 const alt=row('alt',{operator:'>=',line:9});assert.equal(publication.lineLabel(alt),'Alt O8.5 points');assert.equal(publication.researchPage([alt],{query:'over 8.5 points',line:'8.5'}).total,1);
});

test('research URLs retain board-return state and all combined filters across dates',()=>{
 const input='?date=2026-10-30&player=Jose&board=date%3D2026-10-29%26type%3Dlobs&market=AST&review=not_a_pick&probability=with_probability&side=under&line=8.5';
 const state=publication.readResearchState(input);assert.equal(state.query,'Jose');assert.equal(state.market,'AST');
 const search=publication.researchSearch('2026-10-29',state,input),params=new URLSearchParams(search);assert.equal(params.get('date'),'2026-10-29');assert.equal(params.get('board'),'date=2026-10-29&type=lobs');assert.equal(params.has('player'),false);assert.deepEqual(publication.readResearchState(search),state);
 const invalid=publication.readResearchState('?probability=secret&market=UNKNOWN&review=private&side=both&line=-1');assert.equal(invalid.probability,'all');assert.equal(invalid.market,'all');assert.equal(invalid.status,'all');assert.equal(invalid.side,'all');assert.equal(invalid.line,'');
});

test('published coverage and filtered results agree without inventing estimates for unsupported markets',()=>{
 const root=path.join(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(root,'data/editions/manifest.json'))),entry=manifest.editions.filter(e=>e.channel==='daily'&&e.date==='2026-10-30'&&e.version==='0dd109039fab5142').at(-1),edition=JSON.parse(fs.readFileSync(path.join(root,'data/editions',entry.path))),rows=edition.props.filter(r=>r.group==='research'),before=JSON.stringify(rows);
 const coverage=publication.researchCoverage(rows);assert.equal(coverage.reduce((n,c)=>n+c.reviewed,0),11497);assert.equal(coverage.find(c=>c.market==='3PM').estimates,0);
 const available=publication.researchPage(rows,{probability:'with_probability',size:20000});assert.equal(available.total,coverage.reduce((n,c)=>n+c.estimates,0));assert.ok(available.total>7000);assert.ok(available.rows.some(r=>r.category==='not_a_pick'));
 assert.equal(publication.researchPage(rows,{market:'3PM',probability:'with_probability'}).total,0);assert.equal(publication.researchPage(rows,{market:'3PM'}).total,1605);assert.match(publication.researchEmptyMessage(rows,{market:'3PM',probability:'with_probability'}),/No available saved probabilities/);assert.equal(JSON.stringify(rows),before);
});
