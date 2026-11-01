const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const pub=require('../assets/publication.js'),results=require('../assets/result-utils.js'),parlays=require('../assets/plus-money.js');
const body=()=>JSON.parse(fs.readFileSync(__dirname+'/../data/editions/sunday/2026-11-01/bb42e33e7a59f527.json'));

test('Sunday personal ticket keeps five exact targets, two quoted groups and one full-slip record',()=>{
 const b=body(),ticket=results.personalParlays(b)[0];assert.equal(results.personalParlays(b).length,1);
 assert.equal(ticket.label,'Ry’s Sunday Pick');assert.equal(ticket.americanOdds,530);assert.equal(results.parlayDecimal(ticket),6.3);
 assert.deepEqual(ticket.legs.map(r=>[r.player,r.market,r.operator,r.line]),[['Jayson Tatum','PTS','>=',25],['Franz Wagner','PTS','>=',20],['RJ Barrett','PTS','>=',20],['Luka Doncic','PTS','>=',30],['Darius Garland','PTS','>=',20]]);
 assert.deepEqual(ticket.groups.map(g=>[g.kind,g.pickIds.length,g.americanOdds??null]),[['same_game',2,110],['same_game',2,117],['standalone',1,null]]);
 assert.ok(b.props.every(r=>r.group==='ry'&&r.selected===false&&!r.estimate&&!r.category));
});

test('pre-placement straight prices never become accepted SGP component prices',()=>{
 const b=body(),ticket=results.personalParlays(b)[0],html=pub.personalSlipsHTML(b);
 assert.deepEqual(b.props.map(r=>r.americanOdds),[-194,-225,-162,-280,-265]);
 assert.ok(b.props.every(r=>r.capturedAt===null&&/Pre-placement/.test(r.evidence)));
 assert.deepEqual(ticket.legs.map(r=>r.americanOdds),[null,null,null,null,-265]);
 for(const price of [-194,-225,-162,-280])assert.doesNotMatch(html,new RegExp('>'+price+'<'));
 assert.equal((html.match(/Original ticket leg price unavailable/g)||[]).length,4);
 assert.match(html,/Same-game group 1 · 2 legs: <strong>\+110/);assert.match(html,/Same-game group 2 · 2 legs: <strong>\+117/);
 assert.match(html,/Saved screenshot leg price: <strong>-265/);assert.match(html,/Total slip probability: <strong>Unavailable/);
});

test('minute-precision placement stays separate from unknown public posting and quote refreshes',()=>{
 const b=body(),ticket=results.personalParlays(b)[0],html=pub.personalSlipsHTML(b);
 assert.equal(ticket.placedAt,'2026-11-01T12:33-05:00');assert.equal(Date.parse(ticket.placedAt),Date.parse('2026-11-01T17:33:00Z'));
 assert.equal(ticket.postedAt,null);assert.equal(b.firstPublishedAt,null);
 assert.ok(ticket.groups.filter(g=>g.kind==='same_game').every(g=>g.priceEvidence.observedAt===ticket.placedAt));
 assert.match(html,/Public posting time awaiting deployment verification/);assert.match(html,/Recorded placement time: Nov 1, 12:33 PM ET/);
 assert.doesNotMatch(html,/Publicly posted <time/);assert.match(html,/CeC45QU/);
});

test('personal label is escaped and legacy labels retain their existing fallback',()=>{
 const ticket=results.personalParlays(body())[0];assert.match(parlays.personalTicketRow(ticket,0),/<strong>★ Ry’s Sunday Pick<\/strong>/);
 assert.match(parlays.personalTicketRow({...ticket,label:'<img src=x onerror=alert(1)>'},0),/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.doesNotMatch(parlays.personalTicketRow({...ticket,label:'<img src=x onerror=alert(1)>'},0),/<img src=x/);
 const copy={...ticket};delete copy.label;assert.match(parlays.personalTicketRow(copy,2),/<strong>★ Ry’s favorite parlay 3<\/strong>/);
});

test('whole-slip statistical grading preserves the original quote and withholds repricing after a void',()=>{
 const b=body();for(const r of b.props)r.result={eventStatus:'final',statisticalOutcome:'win',actual:40};
 let ticket=results.personalParlays(b)[0];assert.equal(results.parlayOutcome(ticket).outcome,'win');assert.equal(results.parlaySummary([ticket]).hits,1);assert.equal(results.parlayDecimal(ticket),6.3);
 b.props[0].result={eventStatus:'final',statisticalOutcome:'dnp'};ticket=results.personalParlays(b)[0];assert.equal(results.parlayDecimal(ticket),null);assert.match(pub.personalSlipsHTML(b),/Revised full-ticket quote required after voids/);
});
