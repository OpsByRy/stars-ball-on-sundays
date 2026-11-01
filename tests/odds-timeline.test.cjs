const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const api=require('../assets/odds-timeline.js'),fixture=require('./fixtures/odds-timeline.synthetic.json');
const opts={allowSynthetic:true,now:Date.parse('2026-10-31T22:30:00Z')};
const fresh=()=>structuredClone(fixture);
const view=f=>api.buildView(f.record,f.context,opts);
const html=f=>api.render(f.record,f.context,opts);
const event=(id,at,odds,status='usable',retractedAt=null)=>({id,capturedAt:at,americanOdds:odds,status,retractedAt});
const early='2026-10-31T13:00:00Z',later='2026-10-31T15:00:00Z';
test('original pick/quote/posting clocks stay separate from first/latest and payout range',()=>{
 const f=fresh(),before=JSON.stringify(f),v=view(f),s=html(f);
 assert.equal(v.available,true);assert.equal(v.first.americanOdds,-180);assert.equal(v.latest.americanOdds,-120);
 assert.equal(v.longest.americanOdds,-110);assert.equal(v.shortest.americanOdds,-190);assert.equal(v.direction,'better');
 assert.equal(v.context.originalSelection.americanOdds,-150);assert.equal(v.context.originalSelection.selectedAt,null);
 assert.match(s,/SBOS pick price/);assert.match(s,/First published:/);assert.match(s,/Oct 31, 10:05:00 AM EDT/);
 assert.match(s,/Synthetic example/);assert.equal(JSON.stringify(f),before);
});
test('latest missing capture never refreshes or replaces the retained quote',()=>{
 const f=fresh(),v=view(f),s=html(f);assert.equal(v.latestPresence,'missing');
 assert.equal(v.latest.capturedAt,'2026-10-31T21:50:00Z');assert.equal(v.lastCheckAt,'2026-10-31T22:00:00Z');
 assert.match(s,/latest comparable snapshot returned no matching quote/);assert.match(s,/5:50:00 PM EDT/);
});
test('synthetic examples are rejected by default, including the original-price context',()=>{
 const f=fresh(),v=api.buildView(f.record,f.context),s=api.render(f.record,f.context);
 assert.equal(v.available,false);assert.equal(v.context,null);assert.doesNotMatch(s,/-150|-180|-120/);
});
for(const status of ['stale','missing','unverified'])test(status+' history fails closed while original accepted record remains visible',()=>{
 const f=fresh();f.record.status=status;
 const v=view(f),s=html(f);assert.equal(v.available,false);assert.equal(v.reason,status);
 assert.match(s,/-150/);assert.doesNotMatch(s,/-180|-120|Better payout|<table/);
});
test('absent history preserves original quote and publication without inferred history',()=>{
 const f=fresh(),s=api.render(null,f.context,opts);assert.match(s,/-150/);assert.match(s,/First published:/);assert.doesNotMatch(s,/<table|Better payout/);
});
for(const [field,value]of [['recordId','another-line'],['editionVersion','b'.repeat(16)],['book','draftkings'],['operator','>'],['line',19.5],['eventId','nba:8888888888'],['playerId','nba:8888888'],['overtime',false],['settlementRules','Other exact rules'],['jurisdiction','other-region']])test('exact binding rejects '+field+' mismatch',()=>{
 const f=fresh();f.record.binding[field]=value;const v=view(f);assert.equal(v.available,false);assert.equal(v.reason,'mismatch');
});
for(const field of ['overtime','settlementRules','jurisdiction'])test('unknown '+field+' cannot establish verified history',()=>{
 const f=fresh();f.record.binding[field]=null;f.context.binding[field]=null;assert.equal(view(f).reason,'terms');
});
test('a whole private-shaped package/unknown nested fields are never a public input',()=>{
 for(const mutate of [f=>f.record.snapshots=[],f=>f.record.receipt={path:'/Users/private'},f=>f.record.events[0].sourceOfferId='private',f=>f.context.binding.provider='private']){
  const f=fresh();mutate(f);assert.equal(view(f).available,false);assert.doesNotMatch(html(f),/\/Users\/private|sourceOfferId/);
 }
});
for(const invalid of [0,99,-99,'+150',NaN,Infinity])test('invalid price '+String(invalid)+' is unavailable, not zero',()=>{
 const f=fresh();f.record.events[0].americanOdds=invalid;assert.equal(view(f).available,false);assert.doesNotMatch(html(f),/Better payout|<table/);
});
test('valid null unusable first retains its actual first time and holds default movement',()=>{
 const f=fresh();f.record.events=[event('invalid',early,null,'unusable'),event('later',later,130)];
 const v=view(f);assert.equal(v.firstState,'unusable');assert.equal(v.first.capturedAt,early);assert.equal(v.firstUsable.capturedAt,later);assert.equal(v.direction,null);
 const s=html(f);assert.match(s,/Original price is unusable/);assert.match(s,/does not replace the original baseline/);
});
test('all-invalid and all-missing observations remain unavailable without fabricated zero prices',()=>{
 for(const status of ['unusable','missing']){const f=fresh();f.record.events=[event('only',early,null,status)];const v=view(f);assert.equal(v.latest,null);assert.equal(v.direction,null);assert.doesNotMatch(html(f),/>0<\/|Better payout/);}
});
for(const [a,b]of [[100,-100],[120,120.0]])test('equal-payout same-time aliases retain both observations without conflict: '+a+'/'+b,()=>{
 const f=fresh();f.record.events=[event('a',early,a),event('b',early,b)];const v=view(f);
 assert.equal(v.firstState,'usable');assert.equal(v.direction,'unchanged');assert.equal(v.events.length,2);assert.equal(v.hasConflicts,false);
});
test('same-time different payouts, usable/unusable and returned/missing remain conflicted',()=>{
 for(const other of [event('b',early,130),event('b',early,null,'unusable'),event('b',early,null,'missing')]){
  const f=fresh();f.record.events=[event('a',early,120),other,event('later',later,140)];const v=view(f);
  assert.equal(v.firstState,'conflicted');assert.equal(v.direction,null);assert.equal(v.longest,null);assert.equal(v.latest.americanOdds,140);
  assert.equal(v.firstUsable.id,'later');assert.equal(v.events[0].frameConflicted,true);
  assert.match(html(f),/>Conflicting<\/td>/);
 }
});
test('a retracted original remains visible but cannot become a payout baseline',()=>{
 const f=fresh();f.record.events=[event('first',early,120,'usable','2026-10-31T17:00:00Z'),event('later',later,130)];
 const v=view(f);assert.equal(v.firstState,'retracted');assert.equal(v.first.americanOdds,120);assert.equal(v.latest.americanOdds,130);assert.equal(v.direction,null);
 const s=html(f);assert.match(s,/<s>\+120<\/s>/);assert.match(s,/original first observation was retracted/);
});
test('single capture is not presented as observed movement; point range is explicit',()=>{
 const f=fresh();f.record.events=[event('only',early,120)];assert.equal(view(f).direction,null);assert.match(html(f),/One captured quote/);
 assert.equal(view(f).longest.americanOdds,120);assert.equal(view(f).shortest.americanOdds,120);
});
test('first ever captured and Eastern-day range may differ without mixing scopes',()=>{
 const f=fresh();f.record.events=[event('prior','2026-10-30T23:00:00-04:00',200),event('today',early,120)];
 const v=view(f);assert.equal(v.first.americanOdds,200);assert.equal(v.longest.americanOdds,120);assert.equal(v.shortest.americanOdds,120);
 assert.match(html(f),/Eastern calendar day/);
});
test('UTC midnight within Eastern slate stays in the right range and explicit dates',()=>{
 const f=fresh();f.context.binding.slateDate='2026-11-01';f.context.binding.startTime='2026-11-02T03:00:00Z';f.record.binding={...f.context.binding};
 f.record.asOf='2026-11-02T02:00:00Z';f.record.events=[event('a','2026-11-02T00:30:00Z',120),event('b','2026-11-02T01:00:00Z',130)];
 const v=api.buildView(f.record,f.context,{...opts,now:Date.parse('2026-11-02T02:30:00Z')});
 assert.equal(v.available,true);assert.equal(v.longest.americanOdds,130);
});
test('invalid dates, date-only clocks and future observations fail closed',()=>{
 for(const time of ['2026-02-30T13:00:00Z','2026-10-31','2026-10-31T14:00:00','2026-11-02T00:00:00Z']){
  const f=fresh();f.record.events[0].capturedAt=time;assert.equal(view(f).available,false);
 }
});
test('a usable post-start quote and backdated correction are rejected',()=>{
 const f=fresh();f.record.asOf='2026-11-01T00:00:00Z';f.record.events=[event('after','2026-10-31T23:00:00Z',120)];
 assert.equal(api.buildView(f.record,f.context,{...opts,now:Date.parse('2026-11-01T00:01:00Z')}).available,false);
 const g=fresh();g.record.events[0].retractedAt='2026-10-31T12:00:00Z';assert.equal(view(g).available,false);
});
test('known deployed presence is never labeled actual first publication',()=>{
 const f=fresh();f.context.publication={kind:'first_known_deployed_presence',at:'2026-10-31T14:05:00Z'};
 const s=html(f);assert.match(s,/Known online by:/);assert.match(s,/Actual first publication time unavailable/);assert.doesNotMatch(s,/First published:/);
});
test('unknown selection/publication clocks remain unknown and do not assert never selected',()=>{
 const f=fresh();f.context.originalSelection=null;f.context.recordType='research';f.context.publication={kind:'unknown',at:null};
 const s=html(f);assert.match(s,/First publication time unavailable/);assert.match(s,/Quote: <span>Time unavailable/);assert.doesNotMatch(s,/never selected|Not selected|First published:/i);
});
test('original selection quote may not follow publication when selectedAt is unknown',()=>{
 const f=fresh();f.context.originalSelection.capturedAt='2026-10-31T16:00:00Z';assert.equal(view(f).available,false);
});
test('same-time original quote contradiction rejects history without changing context',()=>{
 const f=fresh();f.record.events.find(e=>e.id==='synthetic-selection-quote').americanOdds=200;
 const s=html(f);assert.match(s,/-150/);assert.doesNotMatch(s,/<table/);
});
test('bounded events and unique IDs reject instead of silently truncating',()=>{
 const f=fresh();f.record.events=Array.from({length:api.MAX_EVENTS+1},(_,i)=>event('e'+i,early,120));assert.equal(view(f).available,false);
 const g=fresh();g.record.events[1].id=g.record.events[0].id;assert.equal(view(g).available,false);
});
test('range ties are deterministic under input order and preserve earliest extrema',()=>{
 const f=fresh();f.record.events=[event('a',early,120),event('b',later,120)];const a=view(f);
 f.record.events.reverse();const b=view(f);assert.equal(a.longest.id,'a');assert.equal(b.longest.id,'a');assert.equal(b.shortest.id,'a');
});
test('accessible native disclosure/table semantics and consumer escaping',()=>{
 const f=fresh();f.context.binding.recordId='"><img src=x onerror=alert(1)>';f.record.binding.recordId=f.context.binding.recordId;
 const s=html(f);assert.match(s,/<caption>/);assert.match(s,/scope="col"/);assert.match(s,/<summary data-ot-focus="history"/);assert.doesNotMatch(s,/<img|onerror=/);
});
test('draft renderer and synthetic fixtures are not deployed or loaded by any current page',()=>{
 const root=path.join(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(root,'site-manifest.json'),'utf8'));
 assert(!manifest.files.includes('assets/odds-timeline.js'));assert(!manifest.files.includes('assets/odds-timeline.css'));
 assert(!manifest.files.some(p=>p.includes('odds-timeline.synthetic')));
 for(const name of manifest.files.filter(p=>p.endsWith('.html')))assert.doesNotMatch(fs.readFileSync(path.join(root,name),'utf8'),/odds-timeline\.(js|css)/);
});
