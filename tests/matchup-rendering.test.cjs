'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const research=require('../assets/pick-research.js'),root=path.resolve(__dirname,'..');
const game={date:'2026-10-29',eventIds:['nba:0022600144','espn:401909900'],awayTeam:{name:'Cleveland Cavaliers',abbreviation:'CLE'},homeTeam:{name:'Atlanta Hawks',abbreviation:'ATL'}};
const teams=[{name:'Cleveland Cavaliers',abbreviation:'CLE',logo:'https://a.espncdn.com/i/teamlogos/nba/500/cle.png'},{name:'Atlanta Hawks',abbreviation:'ATL',logo:'https://a.espncdn.com/i/teamlogos/nba/500/atl.png'}];
const pick={date:game.date,canonicalEventId:game.eventIds[0],team:'Atlanta Hawks',opponent:'Cleveland Cavaliers',startTime:'2026-10-29T23:00:00Z'};

test('verified matchup lookup checks every saved identity, date and team pair',()=>{
 const directory=research.createMatchupDirectory({games:[game],teams});
 assert.equal(directory.resolve(pick),game);
 assert.equal(directory.resolve({...pick,canonicalEventId:'propline:123',eventId:'espn:401909900'}),game);
 assert.equal(directory.resolve({...pick,canonicalEventId:null,resultSource:{eventId:'401909900'}}),game);
 assert.equal(directory.resolve({...pick,canonicalEventId:null,eventAliases:['missing','espn:401909900']}),game);
 assert.equal(directory.resolve({...pick,date:'2026-10-30'}),null);
 assert.equal(directory.resolve({...pick,team:'Memphis Grizzlies'}),null);
 const conflicting={...game,eventIds:['nba:0022600999'],homeTeam:{name:'Utah Jazz',abbreviation:'UTA'}};
 assert.equal(research.createMatchupDirectory({games:[game,conflicting]}).resolve({...pick,eventId:'nba:0022600999'}),null);
 const html=research.compactMatchup(pick,directory);assert.match(html,/CLE <span class="matchup-at">@<\/span> ATL/);assert.match(html,/Cleveland Cavaliers @ Atlanta Hawks/);
});

test('an uncovered slate keeps actual teams and both logos without inventing home/away',()=>{
 const directory=research.createMatchupDirectory({teams}),row={...pick,date:'2026-10-31'};
 for(const html of [research.compactMatchup(row,directory),research.matchupHeading('Saved game',[row.team,row.opponent],row,directory)]){
  assert.match(html,/Atlanta Hawks vs Cleveland Cavaliers/);assert.match(html,/>vs<\/span>/);
  assert.match(html,/data-team-logo="ATL"/);assert.match(html,/data-team-logo="CLE"/);
  assert.doesNotMatch(html,/>@<\/span>|Matchup unavailable|Matchup loading/);
 }
 const aliasDirectory=research.createMatchupDirectory({teams:[{name:'Washington Wizards',abbreviation:'WAS'},{name:'New Orleans Pelicans',abbreviation:'NOP'}]});
 const html=research.compactMatchup({...row,team:'WSH',opponent:'NO'},aliasDirectory);assert.match(html,/WAS <span class="matchup-at">vs<\/span> NOP/);
});

test('true missing teams stay explicit and all saved labels are escaped',()=>{
 assert.match(research.compactMatchup({date:'2026-10-31'}),/Matchup unavailable/);
 const one=research.compactMatchup({date:'2026-10-31',team:'Cleveland Cavaliers'});assert.match(one,/opponent unavailable/);assert.doesNotMatch(one,/>@<\/span>/);
 const hostile=research.matchupHeading('<script>title</script>',['<img src=x onerror=alert(1)>','Other'],{});
 assert.doesNotMatch(hostile,/<script>|<img src=x/);assert.match(hostile,/&lt;img/);
});

function painter(fetchJSON){
 const sandbox={module:{exports:{}},require:()=>require('../assets/result-utils.js'),URL,Intl,fetch:async()=>({ok:true,json:fetchJSON})};
 vm.runInNewContext(fs.readFileSync(path.join(root,'assets/pick-research.js'),'utf8'),sandbox);
 return sandbox.module.exports;
}
function headingNode(compact=false){
 return {dataset:{[compact?'compactMatchup':'matchupHeading']:JSON.stringify([pick.date,pick.canonicalEventId]),matchupEvents:JSON.stringify([pick.canonicalEventId]),matchupTeams:JSON.stringify([pick.team,pick.opponent]),tipTime:pick.startTime},innerHTML:'Saved teams and time',textContent:'Saved teams and time',hasAttribute:name=>compact&&name==='data-compact-matchup'};
}
function headingRoot(node){return {querySelector:()=>node,querySelectorAll:selector=>selector.includes('[data-matchup-heading]')?[node]:[]};}

test('async hydration paints a heading-only root and preserves known teams when directory has no game',async()=>{
 const api=painter(async()=>({schemaVersion:'public-player-portraits-1',players:[],teams,games:[]}));
 for(const compact of [false,true]){
  const node=headingNode(compact);await api.paintImages(headingRoot(node),new URL('https://example.com/'));
  assert.match(node.innerHTML,/data-team-logo="ATL"/);assert.match(node.innerHTML,/data-team-logo="CLE"/);assert.match(node.innerHTML,/>vs<\/span>/);assert.doesNotMatch(node.innerHTML,/Matchup unavailable/);
  if(compact)assert.match(node.innerHTML,/10\/29 7:00 PM ET/);
 }
});

test('optional artwork failure cannot erase the pick’s rendered team names',async()=>{
 const api=painter(async()=>{throw Error('directory unavailable');}),node=headingNode(true),before=node.innerHTML;
 await api.paintImages(headingRoot(node),new URL('https://example.com/'));assert.equal(node.innerHTML,before);
});

test('artwork still accepts only approved ESPN URLs and restores fallback labels on image failure',async()=>{
 const callbacks={},img={dataset:{teamLogo:'CLE'},hidden:true,previousElementSibling:{hidden:true},hasAttribute:()=>false,classList:{add(){},remove(){}},addEventListener:(event,fn)=>{callbacks[event]=fn;}};
 const api=painter(async()=>({schemaVersion:'public-player-portraits-1',players:[],teams,games:[]}));
 const target={querySelector:()=>img,querySelectorAll:selector=>selector.startsWith('img')?[img]:[]};
 await api.paintImages(target,new URL('https://example.com/'));assert.equal(img.src,teams[0].logo);assert.equal(img.hidden,false);callbacks.error();assert.equal(img.hidden,true);assert.equal(img.previousElementSibling.hidden,false);
 const bad=painter(async()=>({schemaVersion:'public-player-portraits-1',players:[],games:[],teams:[{...teams[0],logo:'https://unapproved.example/logo.png'}]}));
 delete img.src;await bad.paintImages(target,new URL('https://example.com/'));assert.equal(img.src,undefined);
});

test('all immutable editions retain matchup labels and logo hooks, including uncovered dates',()=>{
 const read=name=>JSON.parse(fs.readFileSync(path.join(root,name))),directory=research.createMatchupDirectory({...read('data/matchups.json'),teams});
 let covered=0,uncovered=0;
 for(const entry of read('data/editions/manifest.json').editions){
  const edition=read('data/editions/'+entry.path),unique=new Map(edition.props.map(row=>[JSON.stringify([row.date,row.canonicalEventId||row.eventId,row.team,row.opponent]),row]));
  for(const row of unique.values()){
   if(!row.team||!row.opponent)continue;
   const html=research.compactMatchup(row,directory);
   assert.doesNotMatch(html,/Matchup unavailable|Matchup loading/);
   assert.equal((html.match(/data-team-logo=/g)||[]).length,2);
   if(directory.resolve(row)){covered++;assert.match(html,/>@<\/span>/);}else{uncovered++;assert.match(html,/>vs<\/span>/);}
  }
 }
 assert.ok(covered>0);assert.ok(uncovered>0);
});
