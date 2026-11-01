const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const api=require('../assets/sgp-ideas.js');
function fixture(){return {schemaVersion:'public-sgp-ideas-1',ideas:[{
 id:'synthetic-idea',kind:'research_idea',date:'2026-11-01',book:'FanDuel',bookEventId:'10000001',eventLabel:'Fictional A @ Fictional B',nativeEventId:null,officialStart:null,
 legs:[{player:'Synthetic One',nativePlayerId:null,nativeTeamId:null,market:'AST',operator:'>',side:'over',threshold:3.5,americanOdds:-120,period:'full_game',overtime:null,settlementTermsState:'unverified'},
 {player:'Synthetic Two',nativePlayerId:null,nativeTeamId:null,market:'PTS',operator:'>=',side:'over',threshold:20,americanOdds:140,period:'full_game',overtime:null,settlementTermsState:'unverified'}],
 observed:{captureId:'fictional-capture',startedAt:'2026-11-01T17:28:56.735Z',completedAt:'2026-11-01T17:28:58.384Z',bookUpdatedAt:null},combinedPrice:{kind:'observed_sportsbook_quote',americanOdds:211},
 holds:['native_identity_unverified','official_start_unverified','current_role_availability_unverified','terms_jurisdiction_unverified','quote_not_execution','joint_probability_unavailable'],jointWinProbability:null,ticketEV:null,betReady:false,algorithmQualified:false,compatibility:{state:'unavailable',value:null,selectionUse:'informational_only'}
 }],resolutions:[]};}
function reject(change){const b=fixture();change(b,b.ideas[0]);assert.throws(()=>api.validate(b));}
test('committed dataset is an empty reviewed-data boundary',()=>{const b=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/sgp-ideas.json')));api.validate(b);assert.deepEqual(b.ideas,[]);assert.deepEqual(b.resolutions,[]);});
test('literal integer alt contract and exact prices retained',()=>{const b=fixture(),copy=structuredClone(b);assert.equal(api.validate(b),b);assert.deepEqual(b,copy);assert.equal(b.ideas[0].legs[1].operator,'>=');});
test('unknown native identity remains unverified',()=>reject((b,a)=>a.holds=a.holds.filter(x=>x!=='native_identity_unverified')));
test('book event ID cannot masquerade as NBA event',()=>reject((b,a)=>a.nativeEventId=a.bookEventId));
test('unknown official start keeps its hold',()=>reject((b,a)=>a.holds=a.holds.filter(x=>x!=='official_start_unverified')));
test('unknown terms remain held',()=>reject((b,a)=>a.holds=a.holds.filter(x=>x!=='terms_jurisdiction_unverified')));
for(const key of ['jointWinProbability','ticketEV','betReady','algorithmQualified'])test('no qualification through '+key,()=>reject((b,a)=>a[key]=1));
for(const key of ['rawPath','screenshot','sourceSHA256','modelParameters','privateIndex'])test('reject private field '+key,()=>reject((b,a)=>a[key]='private'));
test('deep leg private fields reject',()=>reject((b,a)=>a.legs[0].internalFeature=1));
test('side cannot contradict operator',()=>reject((b,a)=>a.legs[0].side='under'));
test('no product of marginal estimates becomes price',()=>reject((b,a)=>a.combinedPrice.kind='independence_estimate'));
test('combined price may be honestly unavailable',()=>{const b=fixture();b.ideas[0].combinedPrice={kind:'unavailable',americanOdds:null};api.validate(b);assert.equal(api.american(null),'Unavailable');});
test('capture start/completion preserve subsecond ordering',()=>reject((b,a)=>a.observed.completedAt='2026-11-01T17:28:56.734Z'));
test('future capture rejects',()=>{assert.throws(()=>api.validate(fixture(),Date.parse('2026-11-01T17:28:58.383Z')));});
test('book update after acquisition rejects',()=>reject((b,a)=>a.observed.bookUpdatedAt=a.observed.completedAt));
for(const value of ['2026-02-30T17:28:58Z','2026-11-01T17:28:58','2026-11-01T17:28:58.384001Z'])test('invalid/ambiguous unsupported clock '+value,()=>reject((b,a)=>a.observed.completedAt=value));
test('post-tip observation rejects',()=>reject((b,a)=>a.officialStart='2026-11-01T17:28:58.383Z'));
test('DST display uses EST on Nov1',()=>{assert.match(api.et('2026-11-01T17:28:58.384Z'),/12:28:58 PM EST/);assert.match(api.et('2026-10-31T17:28:58.384Z'),/1:28:58 PM EDT/);});
test('same-player combo/component rejects',()=>reject((b,a)=>{a.legs[1].player=a.legs[0].player;a.legs[1].market='PA';}));
for(const market of ['PTS','PA','PR','PRA'])test('same-player threes plus '+market+' rejects',()=>reject((b,a)=>{a.legs[1].player=a.legs[0].player;a.legs[0].market='3PM';a.legs[1].market=market;}));
test('mixed null/native IDs cannot duplicate a named exact contract',()=>reject((b,a)=>{a.legs[1]=structuredClone(a.legs[0]);a.legs[1].nativePlayerId='nba:1';}));
test('same name with contradictory native identity rejects',()=>reject((b,a)=>{a.legs[1].player=a.legs[0].player;a.legs[0].nativePlayerId='nba:1';a.legs[1].nativePlayerId='nba:2';}));
test('native identity with an alternate label still detects component overlap',()=>reject((b,a)=>{a.legs[0].nativePlayerId='nba:1';a.legs[1].nativePlayerId='nba:1';a.legs[1].market='PA';}));
test('duplicate contract rejects',()=>reject((b,a)=>a.legs[1]=structuredClone(a.legs[0])));
test('compatibility is unavailable, never a gate',()=>reject((b,a)=>a.compatibility.value=.8));
test('pending is not a zero result',()=>{const s=api.summary(fixture());assert.equal(s.hitRate,null);assert.equal(s.pending,1);assert.equal(s.loss,0);});
function resolved(results){const b=fixture(),a=b.ideas[0];a.nativeEventId='nba:0000000001';a.officialStart='2026-11-01T18:00:00Z';a.legs.forEach((l,i)=>{l.nativePlayerId='nba:'+(i+1);l.nativeTeamId='nba:100';});b.resolutions=[{ideaId:a.id,sourceRef:'fictional-final',nativeEventId:a.nativeEventId,finalAt:'2026-11-01T20:30:00Z',observedAt:'2026-11-01T20:31:00Z',identityVerified:true,eventState:'final',finalityVerified:true,resultBasis:'statistical_only_not_book_settlement',legResults:results}];return b;}
test('verified statistical wins/losses only enter denominator',()=>{assert.equal(api.summary(resolved(['win','win']),Date.parse('2026-11-02T00:00:00Z')).hitRate,1);assert.equal(api.summary(resolved(['win','loss']),Date.parse('2026-11-02T00:00:00Z')).hitRate,0);});
test('fully observed loss plus push is a statistical miss',()=>{const b=resolved(['loss','push']),other=resolved(['win','win']);other.ideas[0].id='synthetic-win';other.resolutions[0].ideaId='synthetic-win';b.ideas.push(other.ideas[0]);b.resolutions.push(other.resolutions[0]);const s=api.summary(b,Date.parse('2026-11-02T00:00:00Z'));assert.equal(s.loss,1);assert.equal(s.push,0);assert.equal(s.hitRate,.5);});
for (const x of ['push','dnp','unknown'])test(x+' remains outside hit rate',()=>{const s=api.summary(resolved(['win',x]),Date.parse('2026-11-02T00:00:00Z'));assert.equal(s.hitRate,null);assert.equal(s[x],1);});
test('results require verified native event/player binding',()=>{const b=resolved(['win','win']);b.ideas[0].nativeEventId=null;assert.throws(()=>api.validate(b));});
test('live or pre-start final receipt rejects',()=>{const b=resolved(['win','win']);b.resolutions[0].finalAt='2026-11-01T17:59:00Z';assert.throws(()=>api.validate(b));});
test('resolution missing stat/leg rejects',()=>{const b=resolved(['win']);assert.throws(()=>api.validate(b));});
test('HTML consumer uses text nodes and no private/code/financial controls',()=>{const js=fs.readFileSync(path.join(__dirname,'../assets/sgp-ideas.js'),'utf8');assert.doesNotMatch(js,/innerHTML|eval\(/);const html=fs.readFileSync(path.join(__dirname,'../research/sgp/index.html'),'utf8');assert.doesNotMatch(html,/<input|data-unit-tracker|personalSlips/);assert.match(html,/no units or profit\/loss/);});
test('new route and assets are in explicit publication allowlist',()=>{const m=JSON.parse(fs.readFileSync(path.join(__dirname,'../site-manifest.json')));for(const p of ['research/sgp/index.html','assets/sgp-ideas.js','assets/sgp-ideas-page.js','assets/sgp-ideas.json','assets/sgp-ideas.css'])assert(m.files.includes(p));});

test('live after tip does not count as final',()=>{const b=resolved(['win','win']);b.resolutions[0].eventState='live';assert.throws(()=>api.validate(b,Date.parse('2026-11-02T00:00:00Z')));});
