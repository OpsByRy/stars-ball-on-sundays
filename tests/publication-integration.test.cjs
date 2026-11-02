const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const pub=require('../assets/publication.js'),board=require('../assets/pick-board.js');

test('one polling callback suppresses unavailable Research while preserving Favorites and legacy result updates',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../assets/publication.js'),'utf8'),start=source.indexOf('onResults:rows=>{')+'onResults:rows=>{'.length,end=source.indexOf('}}):null;',start);
 assert.ok(start>0&&end>start);
 const research={id:'research',group:'research',playerId:'nba:1',canonicalEventId:'nba:0022600001',market:'PTS',operator:'>',line:8.5,period:'full_game',product:'sportsbook',date:'2026-10-31',startTime:'2026-10-31T22:00:00Z',estimate:{winProbability:.8,pushProbability:0,lossProbability:.2,asOf:'2026-10-31T20:00:00Z',status:'provisional'}};
 assert.equal(board.researchProbability(research).status,'available');
 const favorite={id:'favorite',group:'ry',market:'AST',operator:'<',line:3.5,period:'full_game',product:'sportsbook'};
 const ticketOnly={id:'ticket-only',group:'ry',sourceType:'user_supplied_parlay_snapshot',ryFavorite:false,selected:false,market:'PTS',operator:'>=',line:20};
 const elements={'research-lines':{querySelectorAll(){return [{dataset:{pickId:'research'}}];}},'research-market':{},'slate-context':{}},coverage={},record={dataset:{recordScope:'all'}},favoriteRecord={},voidNote={},payout={},fit={},calls=[];
 const groups={'[data-record-scope]':[record],'[data-favorite-pick-record]':[favoriteRecord],'[data-personal-void-note]':[voidNote],'[data-personal-ticket-payout]':[payout],'[data-personal-fit]':[fit]};
 const context={activeBody:{props:[research,favorite,ticketOnly]},researchState:{rows:[research],market:'all'},kind:'research',individualFavorites:pub.individualFavorites,
  $:id=>elements[id],document:{querySelector(){return coverage;},querySelectorAll:selector=>groups[selector]||[]},
  publicResearchPage:pub.publicResearchPage,publicResearchRows:pub.publicResearchRows,publicResearchCoverageHTML:pub.publicResearchCoverageHTML,publicResearchMarketOptions:pub.publicResearchMarketOptions,
  refreshResearch(){calls.push('research');assert.equal(research.result.statisticalOutcome,'dnp');},
  sectionRows:rows=>rows,recordSummary:rows=>{calls.push('record');assert.equal(rows[1].result.actual,5);assert.equal(rows[2].result.actual,20);return 'updated record';},
  refreshPersonalSlips(){calls.push('parlays');},favoritePickRecord:rows=>{calls.push('favorites');assert.deepEqual(rows.map(r=>r.id),['favorite']);return board.rowStatus(rows[0]).label;},
  personalVoidNote:()=>{calls.push('void');return 'void update';},personalPayoutHTML:()=>{calls.push('payout');return 'payout update';},personalFitHTML:()=>{calls.push('fit');return 'fit update';}};
 const callback=vm.runInNewContext('(rows)=>{'+source.slice(start,end)+'}',context);
 callback([{id:'research',result:{eventStatus:'final',statisticalOutcome:'dnp'}},{id:'favorite',result:{eventStatus:'live',statisticalOutcome:'pending',actual:5,minutesPlayed:32}},{id:'ticket-only',result:{eventStatus:'live',statisticalOutcome:'pending',actual:20}}]);
 assert.deepEqual(calls,['research','record','parlays','favorites','void','payout','fit']);
 assert.match(coverage.outerHTML,/<strong>0<\/strong> lines/);assert.match(elements['slate-context'].textContent,/^0 lines/);
 assert.equal(record.outerHTML,'updated record');assert.equal(favoriteRecord.innerHTML,'Miss');assert.equal(voidNote.innerHTML,'void update');assert.equal(payout.innerHTML,'payout update');assert.equal(fit.innerHTML,'fit update');
});
