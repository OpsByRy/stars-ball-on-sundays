'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const research=require('../assets/pick-research.js');
const row={playerId:'nba:1',player:'Test Player',date:'2026-10-29',market:'PTS',operator:'>',line:20};
const game=(date,points=21,id=date)=>({eventId:id,date,team:'CLE',opponent:'ATL',home:true,stats:{MIN:30,PTS:points,REB:5,AST:4,'3PM':2}});

test('recent windows stay in the current season, before the pick and exclude DNPs without padding',()=>{
 const games=[game('2026-04-20',99),game('2026-10-21',0),game('2026-10-23',20),game('2026-10-25',22),game('2026-10-27',23),game('2026-10-29',100),game('2026-10-30',100),{...game('2026-10-26'),status:'dnp'}],before=JSON.stringify(games);
 for(const n of [5,10,20]){const s=research.recentSample(games,row,n);assert.equal(s.available,4);assert.equal(s.points.length,4);assert.equal(s.requested,n);assert.equal(s.hits,2);assert.equal(s.misses,1);assert.equal(s.pushes,1);assert.equal(s.average,16.25);assert.equal(s.rate,2/3);assert.equal(s.season,'2026-27');}
 assert.equal(JSON.stringify(games),before);
 assert.equal(research.seasonFor('2026-09-30'),'2025-26');assert.equal(research.seasonFor('2026-10-01'),'2026-27');
});
test('combo charts require every component; zeroes remain real observations and equality remains a push',()=>{
 const games=[game('2026-10-25',20),{...game('2026-10-26',20),stats:{MIN:30,PTS:20,REB:5}},{...game('2026-10-27',0),stats:{MIN:3,PTS:0,REB:0,AST:0}}];
 const s=research.recentSample(games,{...row,market:'PRA',line:29},10);
 assert.equal(s.points[0].actual,0);assert.equal(s.points[1].actual,null);assert.equal(s.points[2].outcome,'push');assert.equal(s.hits,0);assert.equal(s.misses,1);assert.equal(s.average,14.5);
});
test('early-season comparison is a separate first-N sample and cannot substitute spring or recent prior-season games',()=>{
 const s=research.earlySeasonSample([game('2025-10-21',10),game('2025-10-23',20),game('2025-11-10',100),game('2026-04-20',200),game('2024-10-21',400)],row,2);
 assert.equal(s.season,'2025-26');assert.equal(s.count,2);assert.equal(s.average,15);assert.equal(s.minutes,30);
});
test('on-demand logs match exact NBA or explicit ESPN identities and reject unsafe paths',async()=>{
 const base=new URL('https://example.com/sbos/'),version='0123456789abcdef',seen=[];
 const catalog={schemaVersion:'public-game-log-catalog-1',seasons:[{season:'2026-27',path:'2026-27/index.json'}]};
 const index={schemaVersion:'public-game-logs-1',season:'2026-27',dataThrough:'2026-10-28',players:[{id:'nba:1',espnId:'99',path:'2026-27/1/'+version+'.json',version}]};
 const body={playerId:'nba:1',season:'2026-27',version,games:[game('2026-10-25')]};
 const source=research.createSource({base,fetchJSON:async url=>{seen.push(url);return url.endsWith('catalog.json')?catalog:url.endsWith('index.json')?index:body;}});
 assert.equal((await source.log({...row,playerId:'espn:99'},'2026-27')).playerId,'nba:1');await source.log(row,'2026-27');assert.equal(seen.length,3);
 index.players[0].path='../../engine.sqlite3';const bad=research.createSource({base,fetchJSON:async url=>url.endsWith('catalog.json')?catalog:index});
 await assert.rejects(bad.log(row,'2026-27'),/path/);
});
test('defender full-game source pins both identities, rejects path escapes and excludes target-day games',async()=>{
 const version='0123456789abcdef',index={schemaVersion:'public-career-defender-games-index-1',matchups:[{playerId:'nba:1',defenderId:'nba:2',version,path:'1/2/'+version+'.json'}]},body={schemaVersion:'public-career-defender-games-1',playerId:'nba:1',defenderId:'nba:2',version,games:[game('2026-10-28'),game('2026-10-29')]};
 const make=()=>research.createSource({base:new URL('https://example.com/'),fetchJSON:async url=>url.endsWith('index.json')?index:body});
 assert.equal((await make().defenderGames('nba:1','nba:2','2026-10-29')).games.length,1);
 await assert.rejects(make().defenderGames('nba:1','nba:1','2026-10-29'),/identities/);
 index.matchups[0].path='1/3/'+version+'.json';await assert.rejects(make().defenderGames('nba:1','nba:2','2026-10-29'),/path/);
});
test('guarded stats never borrow full-game rebounds, blocks or steals and both views are explicitly labeled',()=>{
 const d={playerId:'nba:2',player:'Test Defender',source:'https://www.nba.com/stats/player/1/head-to-head',history:[{season:'2025-26',games:2,possessions:40,minutes:'9:30',stats:{PTS:0,AST:3,'3PM':0}}]};
 const html=research.trackedTable(d,'PTS');for(const k of ['REB','AST','BLK','STL'])assert.ok(html.includes('>'+k+'</th>'));assert.match(html,/Not supplied by this tracking feed/);assert.match(html,/0\.0 points/);
 const tabs=research.defenderHistoryMarkup('nba:1',d,'PTS',{base:new URL('https://example.com/'),before:row.date});assert.match(tabs,/Career vs defender: Test Defender/);assert.match(tabs,/Guarded by defender/);assert.match(tabs,/Full game vs defender’s team/);
});
test('full-game view preserves the defender’s earlier team, complete stats and zeroes',()=>{
 const g={...game('2024-01-05',0),season:'2023-24',defenderTeam:'NOP',opponent:'NOP',stats:{MIN:32,PTS:0,REB:6,AST:8,'3PM':0,BLK:0,STL:2,TO:1,FGM:0,FGA:5,'FG%':0,'3PA':2,'3P%':0,FTM:0,FTA:0,'FT%':null}};
 const html=research.defenderGameTable({player:'Test Player',defender:'Test Defender',requestedFromSeason:'2023-24',through:'2026-10-28',missingSeasons:[],source:'https://stats.nba.com/stats/leaguegamelog',games:[g]},'PTS');
 assert.match(html,/@ |vs /);assert.match(html,/NOP/);assert.match(html,/<td>6<\/td><td>8<\/td><td>0<\/td><td>0<\/td><td>2<\/td>/);assert.match(html,/0\/5/);assert.match(html,/direct guarding is not required/);
});
test('matchup headings put the away logo first and the home logo last around Away @ Home',()=>{
 const html=research.matchupHTML({awayTeam:{name:'Cleveland Cavaliers',abbreviation:'CLE'},homeTeam:{name:'Atlanta Hawks',abbreviation:'ATL'}});
 assert.ok(html.indexOf('data-team-logo="CLE"')<html.indexOf('Cleveland Cavaliers'));
 assert.ok(html.indexOf('Cleveland Cavaliers')<html.indexOf('>@</span>'));
 assert.ok(html.indexOf('>@</span>')<html.indexOf('Atlanta Hawks'));
 assert.ok(html.indexOf('Atlanta Hawks')<html.indexOf('data-team-logo="ATL"'));
});
test('compact parlay matchup uses verified away/home abbreviations and Eastern date/time',()=>{
 const game={awayTeam:{abbreviation:'CLE',name:'Cleveland Cavaliers'},homeTeam:{abbreviation:'ATL',name:'Atlanta Hawks'}};
 const html=research.compactMatchupHTML(game,'2026-10-30T00:00:00Z');
 assert.match(html,/Cleveland Cavaliers @ Atlanta Hawks/);assert.match(html,/CLE <span class="matchup-at">@<\/span> ATL/);assert.match(html,/10\/29 8:00 PM ET/);assert.ok(html.indexOf('data-team-logo="CLE"')<html.indexOf('data-team-logo="ATL"'));
 const missing=research.compactMatchup({date:'2026-10-29',canonicalEventId:'nba:0000000000',team:'Atlanta Hawks',opponent:'Cleveland Cavaliers',startTime:'2026-10-30T00:00:00Z'});
 assert.match(missing,/Matchup loading/);assert.doesNotMatch(missing,/Atlanta Hawks @ Cleveland/);assert.equal(research.compactTime(null),'Tip time unavailable');
});
