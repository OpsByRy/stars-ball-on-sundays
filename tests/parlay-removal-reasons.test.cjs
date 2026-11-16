const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../scripts/published-picks.cjs'),history=require('../assets/published-parlays.js');
const date='2026-11-16',key=JSON.stringify(['cross_game_reference',['a','b']]);
const body=()=>({date,records:[{key,status:'withdrawn',original:{id:'original'},legs:[{result:{eventStatus:'final',statisticalOutcome:'loss',actual:1}}],history:[{status:'withdrawn',sourceVersion:'0123456789abcdef',observedAt:'2026-11-16T18:00:00Z',effectiveAt:null,reason:'reason not recorded'}]}]});
const reason=()=>({date,key,sourceVersion:'0123456789abcdef',recordedAt:'2026-11-16T21:00:00Z',reasonCode:'validation_missing',notice:'Win estimates have not passed accuracy validation.'});
test('a dated explanation corrects the actual removal without changing originals, results or removal clocks',()=>{
 const b=body(),before=structuredClone(b),r=reason();api.validateRemovalReasons({schemaVersion:'public-parlay-withdrawal-reasons-1',reasons:[r]});api.applyRemovalReasons(b,[r]);
 assert.deepEqual(b.records[0].original,before.records[0].original);assert.deepEqual(b.records[0].legs,before.records[0].legs);assert.equal(history.outcome(b.records[0]),'loss');
 const e=b.records[0].history[0];assert.equal(e.observedAt,before.records[0].history[0].observedAt);assert.equal(e.effectiveAt,null);assert.equal(e.reason,r.notice);assert.equal(e.explanationRecordedAt,r.recordedAt);
});
test('explanations never suppress a later reappearance',()=>{const b=body();b.records[0].status='active';b.records[0].history.push({status:'active',sourceVersion:'aaaaaaaaaaaaaaaa'});api.applyRemovalReasons(b,[reason()]);assert.equal(b.records[0].status,'active');assert.equal(b.records[0].history.at(-1).status,'active');});
test('unbound, duplicate and backdated explanations are rejected',()=>{
 assert.throws(()=>api.applyRemovalReasons(body(),[{...reason(),sourceVersion:'aaaaaaaaaaaaaaaa'}]),/matching withdrawal/);
 assert.throws(()=>api.applyRemovalReasons(body(),[{...reason(),recordedAt:'2026-11-16T17:00:00Z'}]),/predates/);
 assert.throws(()=>api.validateRemovalReasons({schemaVersion:'public-parlay-withdrawal-reasons-1',reasons:[reason(),reason()]}),/Duplicate/);
});
