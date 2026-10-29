const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const results=require('../assets/result-utils.js'),board=require('../assets/pick-board.js'),pm=require('../assets/plus-money.js'),refresher=require('../scripts/refresh-results.cjs');
const leg=(actual,status='final',operator='>=',line=15)=>{const p={id:'leg-'+actual,date:'2026-10-28',playerId:'nba:1',canonicalEventId:'nba:2',market:'PTS',operator,line};return {...p,result:results.evaluateStructured(p,{eventStatus:status,stats:{PTS:actual}})};};
test('parlay records count tickets, not winning legs; price views do not change the record',()=>{
 const win={id:'win',legs:[leg(20),leg(25),leg(30),leg(18)]},loss={id:'loss',legs:[leg(20),leg(25),leg(30),leg(10)]};
 assert.deepEqual(results.parlaySummary([win,loss,{...win,book:'draftkings'}]),{total:2,hits:1,misses:1,pending:0,review:0,live:0,voided:0,winsWithVoids:0,hitRate:.5});
 assert.equal(results.parlayOutcome(loss).outcome,'loss');assert.equal(results.parlaySummary([{id:'pending',legs:[leg(20),leg(4,'live')]}]).hitRate,null);
 assert.match(results.parlayRecordHTML([win,loss]),/50.0%/);
});
test('reached live overs count only when every leg hits; a final losing leg busts a live ticket',()=>{
 const hit={id:'a',legs:[leg(16,'live'),leg(20)]};assert.deepEqual(results.parlayOutcome(hit),{outcome:'win',live:true});
 hit.legs[0]=leg(14,'live');assert.equal(results.parlayOutcome(hit).outcome,'pending');
 hit.legs[1]=leg(10);assert.deepEqual(results.parlayOutcome(hit),{outcome:'loss',live:true});
 assert.equal(results.parlayOutcome({legs:[leg(5,'live','<',15),leg(20)]}).outcome,'pending');
});
test('voided legs produce wins at reduced odds; fully voided tickets do not dilute hit rate',()=>{
 for(const neutral of [leg(15,'final','>',15),{result:{eventStatus:'final',statisticalOutcome:'dnp'}}]){
  const winning={...leg(20),americanOdds:-200},ticket={id:'reduced',legs:[winning,neutral]};
  assert.equal(results.parlayOutcome(ticket).outcome,'win');assert.equal(results.parlaySummary([ticket]).hitRate,1);
  assert.equal(results.parlayDecimal(ticket),1.5);assert.equal(results.parlaySummary([ticket]).winsWithVoids,1);
  assert.equal(results.parlayOutcome({legs:[neutral]}).outcome,'void');assert.equal(results.parlaySummary([{id:'allvoid',legs:[neutral]}]).hitRate,null);
 }
 assert.equal(results.parlayOutcome({legs:[]}).outcome,'pending');
 assert.equal(results.parlayOutcome({legs:[leg(20),{result:{eventStatus:'final',statisticalOutcome:'unavailable'}}]}).outcome,'pending');
});
test('personal slip attribution counts once; ordinary favorite flags do not create a ticket',()=>{
 const body={date:'2026-10-28',sharedBetslipOdds:522,favoritesPostedAt:'2026-10-29T01:00:00Z',props:[{...leg(20),group:'ry'},{...leg(25),group:'ry'},{...leg(30),group:'research',ryFavorite:true}]};
 assert.equal(results.personalParlays(body).length,1);assert.equal(results.personalParlays(body)[0].legs.length,2);
 assert.equal(results.personalParlays({...body,sharedBetslipOdds:null}).length,0);
 assert.equal(results.personalParlays({...body,sharedBetslipOdds:547})[0].id,results.personalParlays(body)[0].id);
});
test('Plus Money rows expose ticket outcome and preserve a separate live flag and MP',()=>{
 const t={id:'a',section:'plus_money',legs:[{...leg(20,'live'),player:'A',team:'Team',opponent:'Opponent',book:'fanduel',americanOdds:-200,estimate:{winProbability:.8},result:{...leg(20,'live').result,minutesPlayed:25}}],fitReasons:[],indicativeAmericanOdds:120};
 const html=pm.ticketRow(t,0);assert.match(html,/✓ Hit · ● Live/);assert.match(html,/MP 25/);
});
test('result refresh grades the exact published parlay line and preserves immutable quotes and old editions',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sbos-parlay-results-')),write=(name,body)=>{const p=path.join(directory,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(body));};
 try{
  const row={id:'parlay-leg',date:'2026-10-28',eventId:'nba:2',playerId:'nba:1',market:'PTS',operator:'>',line:14.5,americanOdds:-250,capturedAt:'2026-10-28T18:00:00Z',resultSource:{eventId:'123',athleteId:'456',expectedTeam:'Team'}};
  const body={schemaVersion:'public-plus-money-2',date:row.date,quoteObservedAt:row.capturedAt,updatedAt:row.capturedAt,tickets:[{id:'ticket',legs:[row]}]};body.version=refresher.version(body);const saved=JSON.stringify(body),originalPath=`${body.date}/${body.version}.json`;
  write('data/editions/manifest.json',{schemaVersion:'public-1',editions:[]});write('data/stat-targets.json',{schemaVersion:'public-1',targets:[]});write('data/plus-money/'+originalPath,body);
  write('data/plus-money/manifest.json',{schemaVersion:'public-plus-money-manifest-1',editions:[{date:body.date,version:body.version,path:originalPath,updatedAt:body.updatedAt,count:1}]});
  let calls=0;const fetchJSON=async()=>{calls++;return {header:{id:'123',competitions:[{status:{type:{completed:true,state:'post',name:'STATUS_FINAL'}}}]},boxscore:{players:[{team:{displayName:'Team'},statistics:[{labels:['PTS','MIN','BLK','STL'],athletes:[{athlete:{id:'456'},stats:['15','29','2','1']}]}]}]}};};
  assert.deepEqual(await refresher.refresh({directory,fetchJSON,now:new Date('2026-10-29T04:00:00Z')}),{editions:0,parlayEditions:1,sourceFailures:0});
  const index=JSON.parse(fs.readFileSync(path.join(directory,'data/plus-money/manifest.json'))),next=JSON.parse(fs.readFileSync(path.join(directory,'data/plus-money',index.editions.at(-1).path)));
  assert.equal(index.editions.length,2);assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(directory,'data/plus-money',originalPath)))),saved);
  const {result,...unchanged}=next.tickets[0].legs[0];assert.deepEqual(unchanged,row);assert.equal(result.statisticalOutcome,'win');assert.equal(result.minutesPlayed,29);assert.equal(result.sportsbookSettlement,'unverified');assert.equal(calls,1);
  assert.equal((await refresher.refresh({directory,fetchJSON,now:new Date('2026-10-29T04:01:00Z')})).parlayEditions,0);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('result refresh uses exact inactive facts and fresh Out announcements across Daily and every parlay',async()=>{
 for(const mode of ['missing-row','source-failure','out-source-failure','pregame']){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sbos-inactive-results-')),write=(name,body)=>{const p=path.join(directory,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(body));};
 try{
  const row={id:'inactive-leg',date:'2026-10-28',eventId:'nba:0022600143',canonicalEventId:'nba:0022600143',playerId:'nba:1',team:'Team',market:'PTS',operator:'>=',line:15,americanOdds:-250,startTime:'2026-10-29T02:00:00Z',resultSource:{eventId:'123',athleteId:'456',expectedTeam:'Team'}};
  if(mode==='source-failure')row.result={eventStatus:'final',statisticalOutcome:'unavailable',actual:null};
  if(mode==='out-source-failure')row.result={eventStatus:'scheduled',statisticalOutcome:'out',actual:null,minutesPlayed:0};
  const daily={schemaVersion:'public-1',channel:'daily',date:row.date,updatedAt:'2026-10-28T18:00:00Z',props:[row]};daily.version=refresher.version(daily);
  const parlay={schemaVersion:'public-plus-money-2',date:row.date,updatedAt:daily.updatedAt,tickets:[{id:'ticket',legs:[row]}]};parlay.version=refresher.version(parlay);
  write('data/editions/daily/'+row.date+'/'+daily.version+'.json',daily);write('data/editions/manifest.json',{schemaVersion:'public-1',editions:[{channel:'daily',date:row.date,version:daily.version,path:'daily/'+row.date+'/'+daily.version+'.json'}]});
  write('data/plus-money/'+row.date+'/'+parlay.version+'.json',parlay);write('data/plus-money/manifest.json',{schemaVersion:'public-plus-money-manifest-1',editions:[{date:row.date,version:parlay.version,path:row.date+'/'+parlay.version+'.json'}]});write('data/stat-targets.json',{targets:[]});
  let calls=0,injuryCalls=0;const checkAt=mode==='pregame'?'2026-10-28T20:00:00Z':'2026-10-29T06:00:00Z';
  await refresher.refresh({directory,now:new Date(checkAt),fetchJSON:async()=>{if(mode.endsWith('source-failure'))throw Error('Unavailable');return {header:{id:'123',competitions:[{status:{type:{completed:true,state:'post'}}}]},boxscore:{players:[]}};},fetchNBAJSON:async()=>{calls++;return {boxScoreSummary:{gameId:'0022600143',gameTimeUTC:'2026-10-29T02:00:00Z',gameStatus:3,homeTeam:{inactives:[{personId:1}]},awayTeam:{inactives:[]}}};},fetchInjuriesJSON:async()=>{injuryCalls++;return {status:'success',timestamp:checkAt,injuries:[{displayName:'Team',injuries:[{date:checkAt,status:'Out',athlete:{id:'456'}}]}]};}});
  for(const [folder,field] of [['editions','props'],['plus-money','tickets']]){const index=JSON.parse(fs.readFileSync(path.join(directory,'data',folder,'manifest.json'))),next=JSON.parse(fs.readFileSync(path.join(directory,'data',folder,index.editions.at(-1).path))),saved=field==='props'?next.props[0]:next.tickets[0].legs[0];assert.equal(saved.result.statisticalOutcome,mode==='pregame'?'out':'dnp',mode);assert.equal(saved.result.minutesPlayed,0);assert.equal(saved.americanOdds,-250);assert.equal(saved.result.sportsbookSettlement,'unverified');}
  assert.equal(calls,mode==='pregame'?0:1);assert.equal(injuryCalls,mode==='pregame'?1:0);assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'data/player-availability.json'))).updates.length,1);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
 }
});
