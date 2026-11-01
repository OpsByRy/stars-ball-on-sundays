const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const pub=require('../assets/publication.js'),board=require('../assets/pick-board.js');
const root=path.resolve(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p)));
const estimate=p=>({winProbability:p,pushProbability:0,lossProbability:1-p,projection:12,status:'provisional',asOf:'2026-10-30T14:00Z'});
const row=(id,extra={})=>({id,date:'2026-10-30',eventId:'nba:0022600017',playerId:'nba:1',player:'Example Player',team:'Team One',opponent:'Team Two',market:'PTS',operator:'>',line:8.5,side:'over',period:'full_game',product:'sportsbook',startTime:'2026-10-30T23:00Z',group:'research',category:'not_a_pick',book:'fanduel',americanOdds:-150,estimate:estimate(.65),...extra});

test('public inclusion follows the actual latest-review reader, preserving zero and one without reviving held originals',()=>{
 const rows=[row('zero',{estimate:estimate(0)}),row('one',{estimate:estimate(1)}),row('held',{confidenceUpdate:{status:'review',estimate:estimate(.99)}}),row('missing',{estimate:undefined}),row('projection',{estimate:{projection:12}}),row('unavailable',{confidenceUpdate:{status:'unavailable'}}),row('stale',{estimate:{...estimate(.9),asOf:'invalid'}})],before=JSON.stringify(rows);
 assert.deepEqual(pub.publicResearchRows(rows).map(r=>r.id),['zero','one']);
 for(const probability of ['all','without_probability','needs_review','with_probability']){
  const page=pub.publicResearchPage(rows,{probability,size:100});assert.equal(page.total,2);assert.ok(page.rows.every(r=>board.researchProbability(r).status==='available'));
 }
 assert.equal(JSON.stringify(rows),before);
 rows[0].result={eventStatus:'final',statisticalOutcome:'dnp'};assert.deepEqual(pub.publicResearchRows(rows).map(r=>r.id),['one']);
});

test('legacy probability URLs, dates and reset state cannot reopen unavailable research',()=>{
 const input='?date=2026-10-30&probability=needs_review&q=Example&market=PTS&review=not_a_pick&board=date%3D2026-10-29%26type%3Dlobs';
 const state=pub.readPublicResearchState(input);assert.equal(state.probability,'with_probability');assert.equal(pub.readPublicResearchState().probability,'with_probability');
 const search=pub.publicResearchSearch('2026-10-31',{...state,probability:'all'},input),params=new URLSearchParams(search);
 assert.equal(params.get('date'),'2026-10-31');assert.equal(params.get('probability'),'with_probability');assert.equal(params.get('q'),'Example');assert.equal(params.get('board'),'date=2026-10-29&type=lobs');
});

test('search, selection filters, price/probability ranges and pagination use the same supported population',()=>{
 const rows=Array.from({length:85},(_,i)=>row(String(i),{estimate:estimate(.5+i/200),confidenceUpdate:i%3===0?{status:'review'}:undefined})),before=JSON.stringify(rows);
 const state={query:'example over 8.5 points',market:'PTS',status:'not_a_pick',minProbability:'60',maxProbability:'80',minPrice:'-200',maxPrice:'+100',sort:'probability_desc',size:7};
 const all=pub.publicResearchPage(rows,{...state,size:500}),pages=[];
 for(let page=0;page<Math.max(1,Math.ceil(all.total/state.size));page++){
  const chunk=pub.publicResearchPage(rows,{...state,page});pages.push(chunk);
  if(page+1>=chunk.pages)break;
 }
 assert.ok(all.total>7);assert.equal(pages.flatMap(p=>p.rows).length,all.total);assert.equal(new Set(pages.flatMap(p=>p.rows).map(r=>r.id)).size,all.total);
 assert.deepEqual(pages.flatMap(p=>p.rows).map(r=>r.id),all.rows.map(r=>r.id));assert.equal(JSON.stringify(rows),before);
});

test('current public edition matches Research census while selected/personal/result records remain intact',()=>{
 const manifest=read('data/editions/manifest.json'),entry=manifest.editions.filter(e=>e.channel==='daily'&&e.date==='2026-10-31').at(-1),body=read('data/editions/'+entry.path),before=JSON.stringify(body),rows=body.props.filter(r=>r.group==='research');
 assert.equal(entry.version,'24fe9b55d8c4d31c');assert.equal(rows.length,6753);assert.equal(pub.publicResearchRows(rows).length,3687);
 const page=pub.publicResearchPage(rows,{size:10000});assert.equal(page.total,3687);assert.ok(page.rows.every(r=>board.researchProbability(r).status==='available'));
 assert.equal(rows.filter(r=>board.researchProbability(r).status==='held').length,1554);assert.equal(body.props.filter(r=>r.group==='ry').length,7);assert.equal(pub.allPicks(body).length,25);assert.equal(JSON.stringify(body),before);
});

test('public labels count supported estimates and never equate suppressed outputs with no assessment',()=>{
 const rows=[row('available'),row('held',{market:'AST',confidenceUpdate:{status:'review'}})];
 const html=pub.publicResearchCoverageHTML(rows),options=pub.publicResearchMarketOptions(rows),empty=pub.publicResearchEmptyMessage(rows,{market:'AST'});
 assert.match(html,/<strong>1<\/strong> lines with an available saved win estimate/);assert.match(html,/Zero displayed estimates does not mean no assessment occurred/);assert.doesNotMatch(html,/saved reviewed lines/);
 assert.match(options,/Assists \(AST\) · 0 · no saved supported estimate/);assert.match(empty,/No saved supported estimate for assists \(AST\)/);assert.doesNotMatch(empty,/no saved evaluation|0%|never assessed/i);
 const source=fs.readFileSync(path.join(root,'assets/publication.js'),'utf8');assert.doesNotMatch(source,/<select id="research-probability">/);assert.match(source,/rows=publicResearchRows\(rows\);researchState=/);assert.match(source,/const page=publicResearchPage\(researchState.rows,researchState\)/);
});
