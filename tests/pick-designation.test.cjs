'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const api=require('../assets/pick-designation.js'),fixture=require('./fixtures/pick-designation-synthetic.json');
const fresh=()=>structuredClone(fixture),opts={allowSynthetic:true,now:Date.parse('2026-11-01T22:00:00Z')};
const view=f=>api.buildView(f.record,f.context,opts),html=f=>api.render(f.record,f.context,opts);
for(const designation of ['questionable','gtd','probable','doubtful'])test(designation+' is an informational tag with saved price and no exclusion/settlement authority',()=>{
 const f=fresh();f.record.designation=designation;const v=view(f);assert.equal(v.designation,designation);assert.equal(v.voidPrice,false);assert.equal(v.quote,140);assert.equal(Object.hasOwn(v,'eligible'),false);assert.match(html(f),/alone does not exclude/);assert.match(html(f),/\+140/);
});
test('fresh reliable Available removes the old injury/Out tag without changing records',()=>{
 const f=fresh();f.record.lastVerified={designation:'out',source:{...f.record.source,effectiveAt:'2026-11-01T20:30:00Z',reportedAt:'2026-11-01T20:31:00Z',observedAt:'2026-11-01T20:32:00Z'}};f.record.designation='available';
 const before=JSON.stringify(f),v=view(f),s=html(f);assert.equal(v.label,'');assert.equal(v.voidPrice,false);assert.doesNotMatch(s,/designation-tag|>OUT</);assert.match(s,/Available update/);assert.equal(JSON.stringify(f),before);
});
test('an older Available or same-effective contradictory update cannot clear a later OUT',()=>{
 for(const effectiveAt of ['2026-11-01T21:00:00Z','2026-11-01T21:00:00.000000001Z']){const f=fresh();f.record.designation='available';f.record.lastVerified={designation:'out',source:{...f.record.source,effectiveAt}};assert.equal(view(f).state,'invalid_data');assert.doesNotMatch(html(f),/Available update/);}
});
test('reliable Out effective after actual posting shows a red OUT flag and provisional VOID, preserving +140',()=>{
 const f=fresh();f.record.designation='out';const v=view(f),s=html(f);assert.equal(v.voidPrice,true);assert.equal(v.quote,140);assert.match(s,/designation-danger">OUT/);assert.match(s,/designation-price-void">VOID/);assert.match(s,/SBOS provisional/);assert.match(s,/Original posted pick price: <strong>\+140/);assert.match(s,/Sportsbook wager settlement is unverified/);
});
test('only actual first-row publication supports the after-posting claim',()=>{
 for(const publication of [{kind:'unknown',at:null},{kind:'first_known_deployed_presence',at:'2026-11-01T20:00:00Z'}]){const f=fresh();f.record.designation='out';f.context.publication=publication;assert.equal(view(f).voidPrice,false);assert.doesNotMatch(html(f),/designation-price-void/);}
});
test('a newly observed old Out report is not a new post-publication Out',()=>{
 const f=fresh();f.record.designation='out';f.record.source.effectiveAt='2026-11-01T19:59:59.999999999Z';assert.equal(view(f).voidPrice,false);
 f.record.source.effectiveAt=f.context.publication.at;assert.equal(view(f).voidPrice,false);
});
test('one nanosecond after posting qualifies; one nanosecond before does not',()=>{
 const f=fresh();f.record.designation='out';f.context.publication.at='2026-11-01T20:00:00.000000002Z';
 f.record.source.effectiveAt='2026-11-01T20:00:00.000000003Z';assert.equal(view(f).voidPrice,true);
 f.record.source.effectiveAt='2026-11-01T20:00:00.000000001Z';assert.equal(view(f).voidPrice,false);
});
for(const [name,mutate] of [
 ['played',f=>f.context.participation='played'],['final',f=>f.context.eventStatus='final'],['canceled',f=>f.context.eventStatus='canceled'],['postponed',f=>f.context.eventStatus='postponed'],['unknown event',f=>f.context.eventStatus='unknown'],
 ['post-start capture',f=>{f.context.binding.startTime=f.record.binding.startTime='2026-11-01T21:01:00Z';f.context.eventStatus='live';}]
])test(name+' cannot become an automatic Out void',()=>{const f=fresh();f.record.designation='out';mutate(f);assert.equal(view(f).voidPrice,false);assert.doesNotMatch(html(f),/designation-price-void/);});
test('pregame captured Out can remain provisional while live and not verified as played',()=>{const f=fresh();f.record.designation='out';f.context.eventStatus='live';assert.equal(view(f).voidPrice,true);});
test('Out from before posting with a later observation must be reviewed',()=>{const f=fresh();f.record.designation='out';f.record.source.effectiveAt='2026-11-01T19:00:00Z';assert.equal(view(f).voidPrice,false);assert.match(html(f),/not verified as effective after/);});
test('freshness cutoff is inclusive expiry; stale Out cannot assert a current void',()=>{
 const f=fresh();f.record.designation='out';f.record.source.validUntil='2026-11-01T22:00:00Z';const v=view(f);assert.equal(v.state,'stale');assert.equal(v.voidPrice,false);assert.equal(v.lastVerified.designation,'out');assert.match(html(f),/historical status/);assert.match(html(f),/Last verified observation/);assert.match(html(f),/\+140/);
});
test('expired Available is not clearance of a current injury flag',()=>{const f=fresh();f.record.designation='available';f.record.source.validUntil='2026-11-01T21:30:00Z';assert.equal(view(f).label,'STATUS STALE');assert.doesNotMatch(html(f),/Available update/);});
for(const state of ['unknown','conflicting','unverified'])test(state+' keeps last verified designation historical and cannot clear/void',()=>{
 const f=fresh();f.record.lastVerified={designation:'questionable',source:f.record.source};Object.assign(f.record,{state,designation:null,source:null});const v=view(f);assert.equal(v.voidPrice,false);assert.equal(v.lastVerified.designation,'questionable');assert.match(html(f),/historical status/);assert.match(html(f),/\+140/);
});
test('missing record is explicit unknown, never Available',()=>{const f=fresh();f.record=null;assert.equal(view(f).state,'unknown');assert.match(html(f),/Missing status does not mean Available/);});
for(const [key,value] of [['recordId','other'],['editionVersion','b'.repeat(16)],['slateDate','2026-11-02'],['eventId','nba:3'],['playerId','nba:2'],['book','fanduel'],['market','PTS'],['operator','>='],['line',4],['period','first_half'],['product','fantasy'],['overtime',false],['settlementRules','other rules'],['jurisdiction','other'],['startTime','2026-11-02T01:00:00Z']])test('exact binding rejects '+key+' mismatch',()=>{const f=fresh();f.record.binding[key]=value;assert.equal(view(f).state,'invalid_data');assert.equal(view(f).voidPrice,false);});
test('synthetic fixtures are denied by default, including original fixture prices',()=>{const f=fresh(),s=api.render(f.record,f.context);assert.match(s,/STATUS UNAVAILABLE/);assert.doesNotMatch(s,/\+140|VOID/);});
test('minimal accepted-public shape uses the same display checks but confers no adapter authority',()=>{const f=fresh();f.context.dataKind=f.record.dataKind='accepted_public';assert.equal(api.buildView(f.record,f.context,{now:opts.now}).state,'current');});
for(const value of ['2026-02-30T21:00:00Z','2026-11-01','2026-11-01T21:00:00','2026-11-01T21:00:00.0000000001Z','2026-11-01T21:00:00+14:01'])test('invalid/unsupported clock '+value+' fails closed',()=>{const f=fresh();f.record.source.effectiveAt=value;assert.equal(view(f).state,'invalid_data');assert.doesNotMatch(html(f),/designation-price-void/);});
test('timezone offsets compare chronologically rather than lexically',()=>{const f=fresh();f.record.designation='out';f.context.publication.at='2026-11-01T15:00:00-05:00';f.record.source.effectiveAt='2026-11-01T16:00:00-05:00';assert.equal(view(f).voidPrice,true);});
test('equivalent offset clocks and exact scheduled-start capture do not cross strict boundaries',()=>{const f=fresh();f.record.designation='out';f.context.publication.at='2026-11-01T16:00:00-05:00';assert.equal(view(f).voidPrice,false);f.context.publication.at='2026-11-01T20:00:00Z';f.context.binding.startTime=f.record.binding.startTime=f.record.source.observedAt;assert.equal(view(f).voidPrice,false);});
test('future/backdated/inverted evidence cannot produce an accepted tag',()=>{
 for(const mutate of [f=>f.record.asOf='2026-11-01T23:00:00Z',f=>f.record.source.reportedAt='2026-11-01T21:03:00Z',f=>f.record.source.validUntil='2026-11-01T21:01:00Z',f=>f.record.source.validUntil=null,f=>f.context.originalSelection.capturedAt='2026-11-01T20:01:00Z']){const f=fresh();mutate(f);assert.match(view(f).state,/invalid/);assert.equal(view(f).voidPrice,false);}
});
test('private nested data and accessor inputs are rejected without interpolation/invocation',()=>{
 const f=fresh();f.record.source.privatePath='/Users/private';assert.equal(view(f).state,'invalid_data');assert.doesNotMatch(html(f),/\/Users\/private/);
 const g=fresh();let called=0;Object.defineProperty(g.record,'designation',{enumerable:true,get(){called++;return 'out';}});assert.equal(view(g).state,'invalid_data');assert.equal(called,0);
});
test('missing original price/clock stays unknown while provisional display never fabricates a quote',()=>{const f=fresh();f.context.originalSelection={americanOdds:null,capturedAt:null,selectedAt:null};f.record.designation='out';assert.equal(view(f).voidPrice,true);assert.match(html(f),/Original posted pick price: <strong>Unavailable/);assert.doesNotMatch(html(f),/\+0|\+140/);});
test('render and repeated mount clear superseded OUT/VOID/Q tags; they never mutate source or financial state',()=>{
 const f=fresh();f.record.designation='out';const before=JSON.stringify(f),node={innerHTML:''};api.mount(node,f.record,f.context,opts);assert.match(node.innerHTML,/designation-price-void/);assert.equal(JSON.stringify(f),before);
 f.record.designation='available';api.mount(node,f.record,f.context,opts);assert.doesNotMatch(node.innerHTML,/designation-tag|designation-price-void/);
 f.record=null;api.mount(node,f.record,f.context,opts);assert.match(node.innerHTML,/STATUS UNKNOWN/);assert.doesNotMatch(node.innerHTML,/Available update|designation-price-void/);
 assert.equal(Object.keys(api).some(k=>/result|settle|eligib|fetch/i.test(k)),false);
});
test('renderer is inactive and inaccessible to production pages/build; no fetch/storage/data writer is added',()=>{
 const root=path.join(__dirname,'..');for(const p of ['scripts/build.py','assets/publication.js','assets/pick-board.js'])assert.doesNotMatch(fs.readFileSync(path.join(root,p),'utf8'),/pick-designation/);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'assets/pick-designation.js'),'utf8'),/\bfetch\(|localStorage|sessionStorage|indexedDB|\.result\s*=/);
});
