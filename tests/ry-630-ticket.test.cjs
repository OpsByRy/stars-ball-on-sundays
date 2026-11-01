const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const pub=require('../assets/publication.js'),results=require('../assets/result-utils.js');
const read=p=>JSON.parse(fs.readFileSync(p));
const body=read(__dirname+'/../data/editions/daily/2026-10-31/7d5c2b47eb40c3ff.json');
test('seven unsubmitted favorite quotes do not become placed-ticket component prices',()=>{
 const rows=body.props.filter(r=>r.group==='ry'),ticket=results.personalParlays(body)[0];
 assert.equal(rows.length,7);assert.deepEqual(rows.map(r=>r.americanOdds),[-166,-400,-220,-390,-360,-240,-295]);
 assert.ok(rows.every(r=>r.book===null&&r.capturedAt===null&&!r.estimate&&r.sourceType==='user_supplied_unsubmitted_favorite'));
 assert.equal(ticket.americanOdds,630);assert.equal(ticket.placedAt,null);assert.equal(ticket.postedAt,null);assert.equal(results.personalParlays(body).length,1);
 assert.ok(ticket.legs.every(r=>r.americanOdds===null));assert.deepEqual(ticket.groups.map(g=>[g.kind,g.pickIds.length]),[['same_game',3],['same_game',2],['standalone',1],['standalone',1]]);
 const bey=rows.find(r=>r.player==='Saddiq Bey');assert.equal(bey.operator,'>');assert.equal(bey.line,8.5);assert.notEqual(pub.favoriteKey(bey),pub.favoriteKey({...bey,operator:'>=',line:8}));
 const sabonis=rows.find(r=>r.player==='Domantas Sabonis');assert.equal(sabonis.market,'PA');assert.equal(sabonis.line,20);
});
test('placed ticket renders unknowns, original groups and unavailable joint probability honestly',()=>{
 const html=pub.personalSlipsHTML(body);assert.match(html,/\+630/);assert.doesNotMatch(html,/\+790|>null<|NaN|libfile_|IMG_/);
 assert.match(html,/earlier unsubmitted selection/);assert.match(html,/Total slip probability: <strong>Unavailable/);assert.match(html,/Same-game group 1/);assert.match(html,/Same-game group 2/);assert.match(html,/Standalone selection/);
 assert.equal((html.match(/Original ticket leg price unavailable/g)||[]).length,7);assert.match(html,/Placement time not supplied/);
 const posted=structuredClone(body);posted.personalPublication.publishedAt='2026-10-31T22:05:00Z';const later=pub.personalSlipsHTML(posted);assert.equal((later.match(/Posted after scheduled tip/g)||[]).length,1);assert.equal((later.match(/Posted before scheduled tip/g)||[]).length,6);
});
test('one whole ticket is graded with known full price, and a void never invents revised SGP odds',()=>{
 const b=structuredClone(body);for(const r of b.props.filter(r=>r.group==='ry'))r.result={eventStatus:'final',statisticalOutcome:'win',actual:50};
 let t=results.personalParlays(b)[0];assert.equal(results.parlayOutcome(t).outcome,'win');assert.equal(results.parlayDecimal(t),7.3);assert.equal(results.parlaySummary([t]).hits,1);
 b.props.find(r=>r.group==='ry').result={eventStatus:'final',statisticalOutcome:'dnp'};t=results.personalParlays(b)[0];assert.equal(results.parlayDecimal(t),null);
});
