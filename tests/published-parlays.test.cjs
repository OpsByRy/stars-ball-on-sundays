const test=require('node:test'),assert=require('node:assert/strict');
const history=require('../assets/published-parlays.js'),picks=require('../assets/published-picks.js');
const day='2026-11-14',at='2026-11-14T16:00:00Z';
const leg=(i,extra={})=>({date:day,canonicalEventId:'nba:002260000'+i,playerId:'nba:'+i,player:'Player '+i,market:'AST',operator:'>=',line:3,period:'full_game',book:'fanduel',americanOdds:-200,result:{eventStatus:'scheduled',statisticalOutcome:'pending'},...extra});
const ticket=(id,people=[1,2])=>({id,priceKind:'indicative',postedAt:at,legs:people.map(i=>leg(i))});
const snap=(tickets,time=at,extra={})=>({entry:{date:day,path:day+'/0123456789abcdef.json',version:'0123456789abcdef',updatedAt:time},body:{schemaVersion:'public-plus-money-2',date:day,firstPublishedAt:at,tickets,...extra}});
test('every published ticket survives a zero-ticket refresh and preserves original legs and quote',()=>{
 const first=snap([ticket('one'),ticket('two',[3,4])]),before=JSON.stringify(first);
 const body=history.collect([first,snap([],'2026-11-14T18:00:00Z')]);
 assert.equal(body.records.length,2);assert.ok(body.records.every(r=>r.status==='withdrawn'));assert.equal(history.summary(body.records).pending,2);assert.equal(JSON.stringify(first),before);
});
test('ID, book and equivalent half-point quote refreshes count once, but changed lines stay separate',()=>{
 const a=ticket('a'),b=ticket('b');b.legs[0]={...b.legs[0],book:'draftkings',operator:'>',line:2.5};
 const c=ticket('c');c.legs[0].line=4;
 const body=history.collect([snap([a]),snap([b,c],'2026-11-14T18:00:00Z')]);
 assert.equal(body.records.length,2);assert.equal(body.records[0].revisions.length,2);assert.equal(body.records[0].original.legs[0].book,'fanduel');
});
test('unposted assembled cross-game candidates do not become publication membership',()=>{
 const t=ticket('not-posted');t.postedAt=null;
 assert.equal(history.collect([snap([t],at,{firstPublishedAt:null})]).records.length,0);
});
test('SGP research with an unrecorded public posting time stays visible without fabricating that clock',()=>{
 const suggestion={id:'idea',recordKind:'sgp_research_suggestion',legs:[{pick:leg(1)},{pick:leg(2)}]};
 const a=snap([],at,{schemaVersion:'public-sgp-research-1',postedAt:null,suggestions:[suggestion]}),b=snap([],'2026-11-14T18:00:00Z',{schemaVersion:'public-sgp-research-1',postedAt:null,suggestions:[]});
 const body=history.collect([a,b]);assert.equal(body.records.length,1);assert.equal(body.records[0].firstPostedAt,null);assert.equal(body.records[0].kind,'same_game_research');assert.equal(body.records[0].status,'withdrawn');
 const html=history.html(body,{base:'https://example.com/'});assert.match(html,/Recorded posting time: Not recorded/);assert.match(html,/Research-only combinations/);
});
test('explicit withdrawal does not erase the statistical result or backdate its own clock',()=>{
 const a=ticket('a');for(const l of a.legs)l.result={eventStatus:'final',statisticalOutcome:'win',actual:5};
 const w={date:day,ticketIds:['a'],legs:[],recordedAt:'2026-11-14T17:00:00Z',notice:'Unsupported combination; withdrawn.'};
 const body=history.collect([snap([a]),snap([a],'2026-11-14T18:00:00Z')],{withdrawals:[w]});
 assert.equal(body.records[0].history[0].status,'active');assert.equal(body.records[0].history.at(-1).effectiveAt,w.recordedAt);assert.equal(body.records[0].status,'withdrawn');assert.equal(history.outcome(body.records[0]),'win');
});
test('one final losing leg settles a statistical miss; missing legs never create fabricated wins',()=>{
 const r=history.collect([snap([ticket('a')])]).records[0];r.legs[0].result={eventStatus:'final',statisticalOutcome:'loss',actual:1};assert.equal(history.outcome(r),'loss');
 r.legs[0].result={eventStatus:'final',statisticalOutcome:'win',actual:5};assert.equal(history.outcome(r),'pending');r.legs[1].result={eventStatus:'final',statisticalOutcome:'unavailable'};assert.equal(history.outcome(r),'unknown');
});
test('a later withdrawal register applies without requiring another board refresh',()=>{
 const a=ticket('a');for(const l of a.legs)l.result={eventStatus:'final',statisticalOutcome:'win',actual:5};
 const w={date:day,ticketIds:['a'],legs:[],recordedAt:'2026-11-14T17:00:00Z',notice:'Withdrawn after review.'};
 const body=history.collect([snap([a])],{withdrawals:[w]});
 assert.equal(body.records.length,1);assert.equal(body.records[0].status,'withdrawn');assert.equal(history.outcome(body.records[0]),'win');
 assert.deepEqual(body.records[0].history.map(e=>e.observedAt),[at,w.recordedAt]);
 assert.equal(body.records[0].history.at(-1).effectiveAt,w.recordedAt);
});
test('a later reappearance records reinstatement rather than a new ticket',()=>{
 const body=history.collect([snap([ticket('a')]),snap([],'2026-11-14T17:00:00Z'),snap([ticket('a')],'2026-11-14T18:00:00Z')]);assert.equal(body.records.length,1);assert.deepEqual(body.records[0].history.map(e=>e.status),['active','withdrawn','active']);
});
