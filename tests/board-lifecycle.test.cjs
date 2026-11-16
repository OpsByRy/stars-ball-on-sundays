const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const core=require('../assets/board-lifecycle-core.js'),api=require('../assets/board-lifecycle.js'),revisions=require('../scripts/board-revisions.cjs');
const day='2026-11-17',r={date:day,id:'sample',canonicalEventId:'nba:001',eventId:'nba:001',playerId:'nba:1',player:'Player <test>',market:'PTS',operator:'>',line:21.5,book:'draftkings',americanOdds:-150,selected:true,group:'research',category:'value_safe',startTime:'2026-11-18T00:00:00Z',postedAt:'2026-11-17T17:00:00Z',capturedAt:'2026-11-17T16:55:00Z'};
const entry={date:day,channel:'daily',version:'b'.repeat(16),updatedAt:'2026-11-17T17:00:00Z',path:'daily/'+day+'/'+'b'.repeat(16)+'.json'};
test('A prospective sidecar preserves immutable inputs, clocks and exact-book identities',()=>{
 const groups=new Map(),body={firstPublishedAt:r.postedAt,props:[r]},before=JSON.stringify(body);revisions.add(groups,entry,body);const other={...r,book:'fanduel',americanOdds:-140};revisions.add(groups,{...entry,version:'c'.repeat(16),updatedAt:'2026-11-17T18:00:00Z'},{...body,props:[other]});const data=revisions.finish(groups,[])['data/board-revisions/'+day+'.json'];assert.equal(JSON.stringify(body),before);assert.equal(data.allPublishedSingles.length,2);assert.equal(data.current.rows[0].book,'fanduel');assert.equal(data.allPublishedSingles[0].capturedAt,r.capturedAt);assert.equal(data.games['nba:001'].startTime,r.startTime);
});
test('Historical editions never gain finalization sidecars or retrospective status',()=>{
 const groups=new Map();revisions.add(groups,{...entry,date:'2026-11-16'},{firstPublishedAt:r.postedAt,props:[{...r,date:'2026-11-16'}]});assert.deepEqual(revisions.finish(groups,[]),{});
});
test('Built/unposted candidates cannot enter the publication census',()=>{
 const groups=new Map();revisions.add(groups,entry,{props:[r]});assert.equal(groups.size,0);revisions.add(groups,entry,{firstPublishedAt:r.postedAt,props:[{...r,postedAt:null}]});assert.equal(revisions.finish(groups,[])['data/board-revisions/'+day+'.json'].allPublishedSingles.length,0);
});
test('Eligibility holds do not become finalized picks',()=>{
 const input={date:day,current:{rows:[{...r,confidenceUpdate:{qualification:'does_not_qualify',summary:'Role changed'}}],version:entry.version,sourcePath:'data/editions/'+entry.path},allPublishedSingles:[r],tickets:[]};const lock=core.freeze(input,{id:'nba:001',startTime:r.startTime},'2026-11-17T23:25:00Z','2026-11-17T23:31:00Z');assert.equal(lock.singles.length,0);assert.equal(lock.held.length,1);
});
test('Final-board decoration changes only display rows and leaves personal history intact',async()=>{
 const input={date:day,current:{rows:[r],version:entry.version,sourcePath:'data/editions/'+entry.path},allPublishedSingles:[r],tickets:[]};const lock=core.freeze(input,{id:'nba:001',startTime:r.startTime},'2026-11-17T23:25:00Z','2026-11-17T23:31:00Z');
 const old=global.fetch;global.fetch=async()=>Response.json({schemaVersion:'public-board-lifecycle-1',date:day,effectiveDate:core.EFFECTIVE,active:true,locks:[lock],games:[lock.game],allPublishedSingles:[r],alerts:[]});try{
  const body={date:day,channel:'daily',props:[{...r,line:22.5,id:'later',americanOdds:120},{...r,id:'personal',group:'ry'}]},before=JSON.stringify(body);const changed=await api.decorate(body,new URL('https://example.test/'));
  assert.equal(JSON.stringify(body),before);assert.equal(changed.props.filter(x=>x.group==='research').length,1);assert.equal(changed.props.find(x=>x.group==='research').line,21.5);assert.equal(changed.props.find(x=>x.group==='ry').id,'personal');
 }finally{global.fetch=old;}
});
test('Record presentation escapes content and never advertises indicative prices as offered quotes',()=>{
 const history={records:[{key:core.statKey(r),original:r,result:{eventStatus:'final',statisticalOutcome:'loss'}}]};const body={date:day,publishedPickHistory:history,_boardLifecycle:{active:true,locks:[],games:[],allPublishedSingles:[r]}};const html=api.html(body);assert.match(html,/Final Board/);assert.doesNotMatch(html,/Player <test>/);assert.match(html,/All Published/);
});
test('Historical all-published records stay visible without recalculating historical unit records',()=>{
 const old={...r,date:'2026-11-16'},body={date:old.date,publishedPickHistory:{records:[{key:core.statKey(old),original:old,result:{eventStatus:'final',statisticalOutcome:'loss'}}]},_boardLifecycle:{active:false,locks:[]}};const html=api.html(body);assert.match(html,/Policy starts November 17/);assert.match(html,/0–1/);assert.match(html,/−150/);assert.doesNotMatch(html,/>-1.00u</);
});
test('Statistical identity joins exact outcomes across books while contract identity preserves the book',()=>{assert.equal(core.statKey(r),core.statKey({...r,book:'fanduel'}));assert.notEqual(core.exactKey(r),core.exactKey({...r,book:'fanduel'}));assert.equal(core.statKey(r),core.statKey({...r,operator:'>=',line:22}));assert.notEqual(core.exactKey(r),core.exactKey({...r,operator:'>=',line:22}));});
test('Early/late ticket snapshot retains all legs and an indicative price without probability multiplication',()=>{
 const late={...r,id:'late',playerId:'nba:2',canonicalEventId:'nba:002',startTime:'2026-11-18T03:00:00Z'},ticket={legs:[r,late],priceKind:'indicative',indicativeAmericanOdds:180};const input={date:day,current:{rows:[r,late],version:entry.version,sourcePath:'data/editions/'+entry.path},allPublishedSingles:[r,late],tickets:[{key:'t',kind:'cross_game_reference',status:'active',firstPostedAt:r.postedAt,original:ticket,legs:[{original:r},{original:late}],source:{version:entry.version}}]};const lock=core.freeze(input,{id:'nba:001',startTime:r.startTime},'2026-11-17T23:25:00Z','2026-11-17T23:31:00Z');assert.equal(lock.tickets[0].legs.length,2);assert.equal(lock.tickets[0].legs[1].row.startTime,late.startTime);assert.equal(lock.tickets[0].quote.americanOdds,180);assert.equal(lock.tickets[0].quote.kind,'indicative');assert.equal(lock.tickets[0].jointProbability,undefined);
});
test('The browser loader registers without requiring a body before DOMContentLoaded',()=>{
 const callbacks=[];const context={globalThis:null,module:{exports:{}},require:()=>core,Map,Date,URL,AbortSignal,console,document:{readyState:'loading',addEventListener:(name,fn)=>callbacks.push(name)}};context.globalThis=context;vm.runInNewContext(fs.readFileSync(require.resolve('../assets/board-lifecycle.js'),'utf8'),context);assert.ok(callbacks.includes('DOMContentLoaded'));assert.ok(context.module.exports.decorate);
});
