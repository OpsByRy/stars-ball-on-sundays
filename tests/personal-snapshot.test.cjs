const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const results=require('../assets/result-utils.js'),publication=require('../assets/publication.js'),units=require('../assets/unit-tracker.js');
const read=p=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',p))),entries=read('data/editions/manifest.json').editions.filter(e=>e.channel==='daily'&&e.date==='2026-11-01');
const first=entries.findIndex(e=>read('data/editions/'+e.path).personalSlips?.some(s=>s.recordKind==='selection_snapshot'&&s.label==='Run It Back'));
assert.ok(first>0,'The first immutable snapshot must retain its preceding Daily source');
const body=read('data/editions/'+entries[first].path),prior=read('data/editions/'+entries[first-1].path);

test('selection snapshot projects the known unboosted quote and null component/placement clocks',()=>{
 const before=JSON.stringify(body),[ticket]=results.personalParlays(body);
 assert.equal(ticket.recordKind,'selection_snapshot');assert.equal(ticket.label,'Run It Back');assert.equal(ticket.americanOdds,467);assert.equal(ticket.placedAt,null);assert.equal(ticket.priceEvidence.observedAt,null);
 assert.deepEqual(ticket.legs.map(r=>r.americanOdds),[null,null,null,null]);assert.equal(ticket.groups,undefined);
 assert.deepEqual(body.props.slice(-4).map(r=>r.americanOdds),[-245,-150,null,null]);assert.deepEqual(body.props.slice(-4).map(r=>[r.player,r.playerId,r.canonicalEventId,r.market,r.operator,r.line]),[['Darius Garland','nba:1629636','nba:0022600156','PTS','>=',20],['RJ Barrett','nba:1629628','nba:0022600157','PTS','>=',20],['Luka Doncic','nba:1629029','nba:0022600157','PTS','>=',30],['Keaton Wagler','nba:1643413','nba:0022600156','3PM','>=',2]]);assert.equal(JSON.stringify(body),before);
});
test('the snapshot price guard does not treat missing metadata or a leg as the full-ticket exception',()=>{
 const record=body.personalSlips[0];assert.equal(results.personalPrice(record),467);
 for(const key of ['quoteBasis','oddsChangedAtCapture','priceEvidence','legs']){const copy=structuredClone(record);delete copy[key];assert.equal(results.personalPrice(copy),null,key);}
 assert.equal(results.personalPrice({...record,placedAt:'2026-11-01T22:00:00Z'}),null);
 assert.equal(results.personalPrice({...record,priceEvidence:{source:'screenshot',context:'original_slip',observedAt:null}}),null);
 assert.equal(results.personalPrice({americanOdds:-245,recordKind:'selection_snapshot',quoteBasis:'unboosted',placedAt:null,oddsChangedAtCapture:true,priceEvidence:record.priceEvidence}),null);
});
test('ticket-only membership creates no individual Favorites Picks, badges, filter matches or algorithm picks',()=>{
 assert.equal(publication.individualFavorites(body).length,0);assert.equal(publication.favoriteKeys(body).size,0);
 for(const row of body.props.slice(-4))assert.equal(publication.isFavorite(row,publication.favoriteKeys(body)),false);
 const old=prior;assert.deepEqual(publication.allPicks(body),publication.allPicks(old));
 assert.equal(results.personalParlays(body).length,1);
 const legacy=read('data/editions/daily/2026-10-30/3c26a5cf7d231094.json');assert.equal(publication.individualFavorites(legacy).length,9);assert.equal(publication.favoriteKeys(legacy).size,9);
});
test('snapshot UI exposes source limitations, no promotion/CTA and no accepted-wager or financial claim',()=>{
 const html=publication.personalSlipsHTML(body);
 assert.match(html,/Run It Back/);assert.match(html,/Saved unboosted quote/);assert.match(html,/\+467/);assert.match(html,/Placement unverified/);assert.match(html,/Quote time unavailable/);assert.match(html,/<small>4 legs · Placement unverified · Odds changed at capture<\/small>/);assert.equal((html.match(/No model estimate/g)||[]).length,4);
 assert.match(html,/All four selections were reported by Ry/);assert.match(html,/folded SGP group membership/);assert.match(html,/No wager amount or settlement was supplied/);assert.match(html,/Selection snapshots have no unit or P\/L record/);assert.doesNotMatch(html,/Returns use your illustrative unit settings|wager amounts are not published/);
 assert.doesNotMatch(html,/this placed ticket|addToBetslip|shareCode|Profit Boost|\+608|libfile_|IMG_[0-9]+|data-parlay-payout/i);
 assert.equal((html.match(/data-personal-slip-id=/g)||[]).length,1);assert.equal((html.match(/class="pm-leg-row/g)||[]).length,4);
 assert.match(html,/Total slip probability: <strong>Unavailable/);
});
test('statistical personal ticket outcomes remain while snapshot unit accounting stays excluded',()=>{
 const [ticket]=results.personalParlays(body);assert.equal(results.parlaySummary([ticket]).total,1);
 const summary=units.summarize([ticket],{kind:'parlays',personal:true});assert.equal(summary.netUnits,0);assert.equal(summary.decided,0);assert.equal(summary.pending,0);assert.deepEqual(summary.stakes,{});
 assert.equal(units.recordHTML([ticket],{kind:'parlays',personal:true}),'');
 const old=read('data/editions/sunday/2026-11-01/d4f152ee753c9df6.json');assert.equal(results.personalParlays(old)[0].americanOdds,530);assert.ok(units.recordHTML(results.personalParlays(old),{kind:'parlays',personal:true}));
});
