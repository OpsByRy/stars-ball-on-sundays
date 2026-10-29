'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const logs=require('../assets/game-logs.js');
test('profile teams group players before surname sorting and dropdowns retain exact identities',()=>{
 const rows=[{id:'a',name:'Zach Adams',latestTeam:'BOS',profileTeam:'ATL'},{id:'b',name:'Gary Payton II',latestTeam:'ATL'},{id:'c',name:'Bruce Brown',latestTeam:'BOS'},{id:'d',name:'Jaylen Brown',latestTeam:'ATL'}];
 const before=JSON.stringify(rows),groups=logs.teamGroups(rows);assert.deepEqual(groups.map(g=>[g.team,g.players.map(p=>p.id)]),[['ATL',['a','d','b']],['BOS',['c']]]);
 assert.equal(JSON.stringify(rows),before);const html=logs.playerOptions(rows);assert.match(html,/<optgroup label="ATL">/);assert.match(html,/<option value="b">Gary Payton II<\/option>/);assert.ok(html.indexOf('Jaylen Brown')<html.indexOf('Gary Payton II'));
 assert.equal(logs.playerTeam(rows[0]),'ATL');
});
const game=(date,points=20)=>({eventId:date,date,home:true,team:'PHI',opponent:'BOS',stats:{MIN:32,PTS:points,REB:5,AST:4,'3PM':2}});
test('player names sort by surname, then full name, without sorting suffixes as last names',()=>{
  const names=['Jaylen Brown','Tristan da Silva','Gary Payton II','Bobby Portis Jr.','Aaron Gordon','Bruce Brown','Tim Hardaway Jr.'];
  const rows=names.map((name,id)=>({name,id:String(id)})),before=JSON.stringify(rows);
  assert.deepEqual(logs.sortPlayers(rows).map(p=>p.name),['Bruce Brown','Jaylen Brown','Tristan da Silva','Aaron Gordon','Tim Hardaway Jr.','Gary Payton II','Bobby Portis Jr.']);
  assert.equal(logs.lastName('Terrence Shannon Jr'),'Shannon');assert.equal(logs.lastName('Ron Harper III'),'Harper');assert.equal(logs.lastName('Moussa Diabaté'),'Diabaté');assert.equal(JSON.stringify(rows),before);
});
test('historical game views exclude future games and explicit DNPs without mutating source order',()=>{
  const rows=[game('2026-10-28'),game('2026-10-26'),{...game('2026-10-25'),status:'dnp'},game('2026-10-24'),{...game('2026-10-23'),home:false}],before=JSON.stringify(rows);
  assert.deepEqual(logs.historicalGames(rows,{before:'2026-10-28',limit:2}).map(g=>g.date),['2026-10-26','2026-10-24']);
  assert.equal(logs.historicalGames(rows,{location:'away'}).length,1);assert.equal(JSON.stringify(rows),before);
});
test('comparison retains milestone equality, strict-line pushes and unavailable combo components',()=>{
  const row=game('2026-10-25',20);
  assert.equal(logs.compare(row,{market:'PTS',operator:'>=',line:20}).statisticalOutcome,'win');
  assert.equal(logs.compare(row,{market:'PTS',operator:'>',line:20}).statisticalOutcome,'push');
  assert.equal(logs.compare(row,{market:'PTS',operator:'<',line:20.5}).statisticalOutcome,'win');
  assert.equal(logs.statValue(row,'PRA'),29);assert.equal(logs.statValue({...row,stats:{PTS:20,REB:5}},'PRA'),null);
  assert.equal(logs.compare({...row,stats:{PTS:20,REB:5}},{market:'PRA',operator:'>',line:20}).statisticalOutcome,'unavailable');
});
test('historical percentages count only decided available games and report actual sample size',()=>{
  const rows=[game('2026-10-27',21),game('2026-10-26',20),game('2026-10-25',19),{...game('2026-10-24'),stats:{MIN:30}}];
  assert.deepEqual(logs.record(rows,{market:'PTS',operator:'>',line:20}),{hits:1,misses:1,pushes:1,unavailable:1,decided:2,rate:.5});
  assert.equal(logs.record(rows,null).rate,null);assert.equal(logs.record([],{market:'PTS',operator:'>',line:20}).rate,null);
});
test('exact prop links preserve identity, market, line and board state without leaking other fields',()=>{
  const p={playerId:'nba:1627759',date:'2026-10-28',market:'PTS',operator:'>=',line:15,americanOdds:-442,privateFeature:'never'},base=new URL('https://example.com/sbos/');
  const url=new URL(logs.propURL(p,{base,boardSearch:'date=2026-10-28&type=value_safe'}));
  assert.equal(url.pathname,'/sbos/players/profile.html');assert.equal(url.searchParams.get('player'),'nba:1627759');assert.equal(url.searchParams.get('op'),'>=');assert.equal(url.searchParams.get('line'),'15');assert.equal(url.searchParams.get('board'),'date=2026-10-28&type=value_safe');assert.ok(!url.href.includes('never'));
  assert.equal(logs.propURL({...p,playerId:'bad',resultSource:{athleteId:'4431678'}},{base})?.includes('espn%3A4431678'),true);
  assert.equal(logs.propURL({...p,playerId:'bad'},{base}),null);
});
test('game-log paths fail closed and comparison inputs do not coerce blank lines into zero',()=>{
  const root=new URL('https://example.com/data/'),entry={id:'nba:123',version:'0123456789abcdef',path:'2026-27/123/0123456789abcdef.json'};
  assert.equal(logs.safeLogURL(entry,root,'2026-27').pathname,'/data/2026-27/123/0123456789abcdef.json');
  assert.throws(()=>logs.safeLogURL({...entry,path:'../../private.json'},root,'2026-27'));
  assert.equal(logs.comparisonState('?stat=PTS&op=%3E&line=').comparison,null);
  assert.equal(logs.comparisonState('?stat=PTS&op=%3E&line=NaN').comparison,null);
  assert.equal(logs.comparisonState('?date=2026-02-31').pickDate,null);
});
test('exported log keeps only public basic statistics with stable NBA identities',()=>{
  const root=path.resolve(__dirname,'..'),index=JSON.parse(fs.readFileSync(path.join(root,'data/player-logs/index.json')));
  assert.ok(index.players.length>=400);
  for(const p of index.players){const body=JSON.parse(fs.readFileSync(path.join(root,'data/player-logs',p.path)));assert.equal(body.playerId,p.id);assert.equal(body.games.length,p.games);assert.ok(body.games.every(g=>g.date<=index.dataThrough));}
});
test('season catalog keeps both seasons separate and every exported game has full shooting and defensive stats',()=>{
  const root=path.resolve(__dirname,'..','data/player-logs'),catalog=JSON.parse(fs.readFileSync(path.join(root,'catalog.json')));
  assert.deepEqual(catalog.seasons.map(e=>e.season),['2026-27','2025-26']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'index.json'))).season,'2026-27');
  for(const season of catalog.seasons){
    const index=JSON.parse(fs.readFileSync(path.join(root,season.path)));assert.equal(index.season,season.season);
    for(const p of index.players){const body=JSON.parse(fs.readFileSync(path.join(root,p.path)));assert.equal(body.season,season.season);for(const g of body.games){
      for(const k of ['FGM','FGA','3PM','3PA','FTM','FTA','BLK','STL','TO'])assert.equal(typeof g.stats[k],'number');
      for(const [percent,attempts] of [['FG%','FGA'],['3P%','3PA'],['FT%','FTA']]){if(g.stats[percent]===null)assert.equal(g.stats[attempts],0);else assert.equal(typeof g.stats[percent],'number');}
    }}
  }
});
test('shooting displays preserve made/attempted zeroes and leave missing values unavailable',()=>{
  assert.equal(logs.shootingPair({FGM:0,FGA:0},'FGM','FGA'),'0/0');assert.equal(logs.shootingPair({FGM:3,FGA:7},'FGM','FGA'),'3/7');assert.equal(logs.shootingPair({FGM:3},'FGM','FGA'),'—');
  assert.equal(logs.shootingPercent(.375),'37.5%');assert.equal(logs.shootingPercent(0),'0.0%');assert.equal(logs.shootingPercent(null),'—');
});
test('blocks and steals use exact line comparisons, including zero and pushes',()=>{
  for(const [market,key] of [['BLK','BLK'],['STL','STL']]){
    const row={...game('2026-10-27'),stats:{[key]:2}};
    assert.equal(logs.statValue(row,market),2);
    assert.equal(logs.compare(row,{market,operator:'>=',line:2}).statisticalOutcome,'win');
    assert.equal(logs.compare(row,{market,operator:'>',line:2}).statisticalOutcome,'push');
    assert.equal(logs.compare({...row,stats:{[key]:0}},{market,operator:'<',line:.5}).statisticalOutcome,'win');
    assert.equal(logs.comparisonState('?stat='+market+'&line=1.5').stat,market);
  }
});
