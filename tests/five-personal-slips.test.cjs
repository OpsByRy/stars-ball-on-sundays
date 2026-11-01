const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const results=require('../assets/result-utils.js'),publication=require('../assets/publication.js'),units=require('../assets/unit-tracker.js');
const read=p=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',p))),body=read('data/editions/daily/2026-10-30/3c26a5cf7d231094.json'),prior=read('data/editions/daily/2026-10-30/0dd109039fab5142.json');

test('five screenshot slips preserve fourteen leg occurrences and nine unique favorites without a synthetic combined slip',()=>{
 const before=JSON.stringify(body),tickets=results.personalParlays(body);
 assert.equal(tickets.length,5);assert.deepEqual(tickets.map(t=>t.legs.length),[4,2,4,2,2]);assert.equal(new Set(tickets.map(t=>t.id)).size,5);
 assert.deepEqual(tickets.map(t=>t.americanOdds),[447,125,294,109,125]);assert.equal(body.props.filter(r=>r.group==='ry').length,9);
 assert.equal(tickets[0].placedAt,null);assert.equal(tickets[2].placedAt,null);assert.equal(tickets[4].placedAt,'2026-10-30T19:18:00-04:00');
 assert.equal(JSON.stringify(body),before);
});
test('each screenshot leg retains its own FanDuel quote even when another slip or preferred-book view differs',()=>{
 const tickets=results.personalParlays(body);
 assert.deepEqual(tickets.map(t=>t.legs.map(r=>r.americanOdds)),[[-122,-370,-215,-162],[-122,-420],[-128,-215,-420,-450],[-700,-120],[-122,-420]]);
 assert.equal(tickets[0].legs[3].line,3.5);assert.equal(tickets[1].legs[1].line,2.5);
 const changed=structuredClone(body);for(const r of changed.props.filter(r=>r.group==='ry'))r.bookPrices={quotes:[{book:'draftkings',americanOdds:900}]};
 assert.deepEqual(results.personalParlays(changed).map(t=>t.legs.map(r=>r.americanOdds)),tickets.map(t=>t.legs.map(r=>r.americanOdds)));
 for(const t of tickets){assert.equal(t.book,'fanduel');assert.equal(t.priceKind,'posted');assert.equal(results.parlayDecimal(t),1+t.americanOdds/100);}
});
test('each real slip is graded once and shared players or favorite flags never create additional wagers',()=>{
 const copy=structuredClone(body);for(const r of copy.props.filter(r=>r.group==='ry'))r.result={eventStatus:'final',statisticalOutcome:'win',actual:20};
 copy.props.find(r=>r.id==='risacher-reb-over-3-5').result={eventStatus:'final',statisticalOutcome:'loss',actual:3};
 const tickets=results.personalParlays(copy),summary=results.parlaySummary(tickets);assert.equal(summary.total,5);assert.equal(summary.hits,4);assert.equal(summary.misses,1);
 assert.equal(results.personalParlays({...copy,personalSlips:undefined,sharedBetslipOdds:undefined}).length,0);
 assert.equal(results.personalParlays({...copy,props:[copy.props.find(r=>r.group==='ry')]}).length,0);
 const t=tickets[1];t.legs[0].result={eventStatus:'final',statisticalOutcome:'dnp'};assert.equal(results.parlayDecimal(t),null);
});
test('all original research outputs and forecast times remain unchanged and exact-outcome personal forecasts are pregame',()=>{
 assert.deepEqual(body.props.filter(r=>r.group==='research'),prior.props.filter(r=>r.group==='research'));
 for(const r of body.props.filter(r=>r.group==='ry')){
  assert.ok(Date.parse(r.estimate.asOf)<Date.parse(r.startTime));assert.equal(r.capturedAt,null);assert.equal(r.postedAt,null);
  assert.ok(prior.props.some(p=>p.playerId===r.playerId&&p.market===r.market&&publication.favoriteKey(p)===publication.favoriteKey(r)&&JSON.stringify(p.estimate)===JSON.stringify(r.estimate)));
 }
 const keys=publication.favoriteKeys(body);assert.equal(keys.size,9);assert.equal(prior.props.filter(r=>r.selected&&publication.isFavorite(r,keys)).length,8);
});
test('public notice distinguishes actual posting from placement and labels every relevant game after verified deployment',()=>{
 const pending=publication.personalSlipsHTML(body);assert.match(pending,/Public posting time awaiting deployment verification/);assert.doesNotMatch(pending,/Publicly posted <time/);
 assert.equal((pending.match(/data-personal-slip-id=/g)||[]).length,5);assert.equal((pending.match(/class="pm-row personal-parlay-row"/g)||[]).length,5);assert.equal((pending.match(/class="pm-leg-row/g)||[]).length,14);assert.match(pending,/Saved pregame estimates/);
 assert.equal((pending.match(/Placement time not supplied/g)||[]).length,2);assert.match(pending,/current odds and availability were not checked/);
 const posted=structuredClone(body);posted.personalPublication.publishedAt='2026-10-31T00:20:00Z';const html=publication.personalSlipsHTML(posted);
 assert.match(html,/Publicly posted <time datetime="2026-10-31T00:20:00Z"/);assert.match(html,/Posted after scheduled tip/);assert.match(html,/Posted before scheduled tip/);
 for(const t of results.personalParlays(posted))for(const r of t.legs)assert.equal(publication.personalPostingLabel(r,posted.personalPublication),r.player==='Devin Booker'?'Posted before scheduled tip':'Posted after scheduled tip');
 assert.doesNotMatch(html,/BET ID|115\.53|\$25|136\.93|98\.73|52\.38|56\.32|cash.out|100 PTS|location verified|libfile_/i);
});
test('legacy single-slip editions and first-saved full-ticket quote tracking remain compatible',()=>{
 const entries=read('data/editions/manifest.json').editions,legacy=entries.map(e=>read('data/editions/'+e.path)).find(b=>b.sharedBetslipOdds&&b.props.some(r=>r.group==='ry'));
 assert.equal(results.personalParlays(legacy).length,1);assert.match(publication.favoritesNotice(legacy),/Full-slip screenshot price/);
 const t=results.personalParlays(body)[3],record={ticketId:t.id,legIds:t.legs.map(r=>r.id).sort(),americanOdds:109};
 assert.equal(units.firstPersonalPrice({...t,americanOdds:999},[record]).americanOdds,109);
 assert.equal(units.firstPersonalPrice(t,[{...record,ticketId:'another'}]).americanOdds,null);
});
