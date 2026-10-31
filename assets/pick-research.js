/* Shared, on-demand pick research. Reads only validated public facts; no inference. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./result-utils.js'):root.STARS_RESULT_UTILS);
  if(typeof module==='object'&&module.exports)module.exports=api;else{root.SBOS_PICK_RESEARCH=api;document.addEventListener('DOMContentLoaded',()=>api.init());}
})(typeof window==='undefined'?this:window,function(contracts){
  'use strict';
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const names={PTS:'points',REB:'rebounds',AST:'assists','3PM':'threes',PRA:'points + rebounds + assists',PR:'points + rebounds',PA:'points + assists',RA:'rebounds + assists',BLK:'blocks',STL:'steals'};
  const parts={PTS:['PTS'],REB:['REB'],AST:['AST'],'3PM':['3PM'],PRA:['PTS','REB','AST'],PR:['PTS','REB'],PA:['PTS','AST'],RA:['REB','AST'],BLK:['BLK'],STL:['STL']};
  const fmt=v=>finite(v)?v.toFixed(1):'—',pct=v=>finite(v)?(v*100).toFixed(1)+'%':'—';
  const validDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v));
  const etDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  function seasonFor(day){if(!validDay(day))throw Error('Invalid research date');const y=Number(day.slice(0,4))-(Number(day.slice(5,7))<10?1:0);return y+'-'+String(y+1).slice(-2);}
  const previousSeason=s=>(Number(s.slice(0,4))-1)+'-'+s.slice(2,4);
  const currentEstimate=row=>row.confidenceUpdate?row.confidenceUpdate.estimate:row.estimate;
  const statValue=(game,market)=>parts[market]?.every(k=>finite(game.stats?.[k]))?parts[market].reduce((a,k)=>a+game.stats[k],0):null;
  function appearances(games,day,season=seasonFor(day)){
    const unique=new Map();
    for(const g of games||[])if(validDay(g.date)&&g.date<day&&seasonFor(g.date)===season&&!g.didNotPlay&&g.status!=='dnp')unique.set(g.eventId||g.date,g);
    return [...unique.values()].sort((a,b)=>b.date.localeCompare(a.date)||String(b.eventId).localeCompare(String(a.eventId)));
  }
  function recentSample(games,row,limit=10){
    const day=validDay(row.date)?row.date:etDay(),season=seasonFor(day),all=appearances(games,day,season),rows=all.slice(0,[5,10,20].includes(limit)?limit:10);
    const points=rows.map(game=>({game,actual:statValue(game,row.market),outcome:contracts.evaluateStructured(row,{eventStatus:'final',stats:game.stats}).statisticalOutcome}));
    const values=points.map(p=>p.actual).filter(finite),hits=points.filter(p=>p.outcome==='win').length,misses=points.filter(p=>p.outcome==='loss').length,pushes=points.filter(p=>p.outcome==='push').length;
    return {season,available:all.length,requested:limit,points,hits,misses,pushes,decided:hits+misses,rate:hits+misses?hits/(hits+misses):null,average:values.length?values.reduce((a,b)=>a+b,0)/values.length:null};
  }
  function earlySeasonSample(games,row,count){
    const day=row.date,season=previousSeason(seasonFor(day)),rows=appearances(games,day,season).filter(g=>[10,11].includes(Number(g.date.slice(5,7)))).reverse().slice(0,Math.min(count,20));
    const values=rows.map(g=>statValue(g,row.market)).filter(finite),hits=rows.filter(g=>contracts.evaluateStructured(row,{eventStatus:'final',stats:g.stats}).statisticalOutcome==='win').length;
    const mins=rows.map(g=>g.stats?.MIN).filter(finite);
    return {season,count:rows.length,hits,average:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,minutes:mins.length?mins.reduce((a,b)=>a+b,0)/mins.length:null,teams:[...new Set(rows.map(g=>g.team))]};
  }
  function createSource({base,fetchJSON}){
    const cache=new Map(),get=url=>{const key=String(url);if(!cache.has(key))cache.set(key,Promise.resolve().then(()=>fetchJSON(key)).catch(e=>{cache.delete(key);throw e;}));return cache.get(key);};
    async function log(row,season){
      const catalog=await get(new URL('data/player-logs/catalog.json',base));
      if(catalog.schemaVersion!=='public-game-log-catalog-1')throw Error('Unsupported catalog');
      const entry=catalog.seasons.find(s=>s.season===season);if(!entry)return {games:[],season,playerId:row.playerId};
      if(entry.path!==season+'/index.json')throw Error('Invalid season path');
      const index=await get(new URL('data/player-logs/'+entry.path,base));
      if(index.schemaVersion!=='public-game-logs-1'||index.season!==season)throw Error('Season identity mismatch');
      const players=index.players.filter(p=>p.id===row.playerId||'espn:'+p.espnId===row.playerId);
      if(!players.length)return {games:[],season,playerId:row.playerId};
      if(players.length!==1)throw Error('Ambiguous player');
      const p=players[0],id=p.id.split(':')[1];
      if(!/^nba:\d{1,12}$/.test(p.id)||!/^[a-f0-9]{16}$/.test(p.version)||p.path!==season+'/'+id+'/'+p.version+'.json')throw Error('Invalid player log path');
      const body=await get(new URL('data/player-logs/'+p.path,base));
      if(body.playerId!==p.id||body.season!==season||body.version!==p.version)throw Error('Player log identity mismatch');
      return {...body,dataThrough:index.dataThrough,capturedAt:index.capturedAt};
    }
    async function profile(playerId){
      const index=await get(new URL('data/player-profiles/index.json',base));
      if(index.schemaVersion!=='public-player-profiles-1')throw Error('Invalid profile index');
      const entry=index.players.find(p=>p.id===playerId);if(!entry)return null;
      if(!/^nba:\d{1,12}$/.test(entry.id)||!/^[a-f0-9]{16}$/.test(entry.version)||entry.path!==entry.id.split(':')[1]+'/'+entry.version+'.json')throw Error('Invalid profile path');
      const body=await get(new URL('data/player-profiles/'+entry.path,base));
      if(body.playerId!==playerId||body.version!==entry.version)throw Error('Profile identity mismatch');return body;
    }
    async function research(row){
      const day=validDay(row.date)?row.date:etDay(),body=await log(row,seasonFor(day));
      const p=await profile(body.playerId).catch(()=>null),up=p?.upcoming;
      const sameEvent=up?.date===day&&up.team===row.team&&up.opponent===row.opponent&&(!row.resultSource?.eventId||row.resultSource.eventId===up.espnEventId);
      const market=sameEvent?up.markets.find(m=>m.market===row.market):null;
      return {games:body.games,dataThrough:body.dataThrough,profile:p,upcoming:sameEvent?up:null,market};
    }
    async function defenderGames(playerId,defenderId,before){
      if(!/^nba:\d{1,12}$/.test(playerId)||!/^nba:\d{1,12}$/.test(defenderId)||playerId===defenderId)throw Error('Invalid defender identities');
      const index=await get(new URL('data/defender-games/index.json',base));
      if(index.schemaVersion!=='public-career-defender-games-index-1')throw Error('Invalid defender-game index');
      const entries=index.matchups.filter(p=>p.playerId===playerId&&p.defenderId===defenderId);if(!entries.length)return null;if(entries.length!==1)throw Error('Ambiguous defender pair');
      const entry=entries[0],path=playerId.split(':')[1]+'/'+defenderId.split(':')[1]+'/'+entry.version+'.json';
      if(!/^[a-f0-9]{16}$/.test(entry.version)||entry.path!==path)throw Error('Invalid defender-game path');
      const body=await get(new URL('data/defender-games/'+path,base));
      if(body.schemaVersion!=='public-career-defender-games-1'||body.playerId!==playerId||body.defenderId!==defenderId||body.version!==entry.version)throw Error('Defender-game identity mismatch');
      return {...body,games:body.games.filter(g=>g.date<before)};
    }
    return {log,profile,research,defenderGames,get};
  }
  const instances=new Map(),ranges=new Map(),sources=new Map(),defenders=new Map();let serial=0,defaultBase=null,artwork=null;
  function createMatchupDirectory({games=[],teams=[]}={}){
    const identities=new Map(),events=new Map(),key=value=>String(value||'').trim().toLowerCase();
    for(const team of [...teams,...games.flatMap(game=>[game.awayTeam,game.homeTeam])]){
      identities.set(key(team.name),team);identities.set(key(team.abbreviation),team);
    }
    for(const [alias,abbreviation] of Object.entries({NO:'NOP',NY:'NYK',GS:'GSW',SA:'SAS',UTAH:'UTA',WSH:'WAS','Los Angeles Clippers':'LAC','LA Clippers':'LAC','LA Lakers':'LAL'}))if(identities.has(key(abbreviation)))identities.set(key(alias),identities.get(key(abbreviation)));
    for(const game of games)for(const id of game.eventIds)events.set(JSON.stringify([game.date,id]),game);
    const team=value=>identities.get(key(value));
    function resolve(row,pair=[row.team,row.opponent]){
      const ids=[row.canonicalEventId,row.eventId,row.resultSource?.eventId&&'espn:'+row.resultSource.eventId,...(row.eventAliases||[])].filter(Boolean);
      const matches=[...new Set(ids.map(id=>events.get(JSON.stringify([row.date,id]))).filter(Boolean))];
      if(matches.length!==1)return null;
      const game=matches[0],expected=[game.awayTeam.abbreviation,game.homeTeam.abbreviation];
      // Never attach a known game's home/away order to a different pair of teams.
      if(pair.filter(Boolean).some(value=>!expected.includes(team(value)?.abbreviation)))return null;
      return game;
    }
    return {team,resolve};
  }
  let matchupDirectory=createMatchupDirectory();
  function baseURL(base){return base||defaultBase||new URL('../',document.querySelector('script[data-pick-research]').src);}
  function source(base){
    const key=String(base);
    if(!sources.has(key))sources.set(key,createSource({base,fetchJSON:async url=>{const mutable=/\/(?:index|catalog|player-portraits)\.json$/.test(new URL(url).pathname),r=await fetch(url,{credentials:'omit',cache:mutable?'no-store':'force-cache'});if(!r.ok)throw Error('Research unavailable');return r.json();}}));
    return sources.get(key);
  }
  function portrait(row,{href,base,className=''}={}){
    const id=row.playerId||'',label=row.player||'',initials=label.split(/\s+/).map(s=>s[0]).slice(0,2).join('');
    const image='<span class="portrait-initials" aria-hidden="true">'+esc(initials)+'</span><img data-player-headshot="'+esc(id)+'" alt="" loading="lazy" decoding="async" hidden>';
    return href?'<a class="player-portrait '+esc(className)+'" href="'+esc(href)+'" target="_blank" rel="noopener noreferrer" aria-label="Open '+esc(label)+' player profile in a new tab">'+image+'</a>':'<span class="player-portrait '+esc(className)+'">'+image+'</span>';
  }
  function teamIcon(team,className=''){
    team=String(team||'');
    return '<span class="team-icon '+esc(className)+'" aria-hidden="true"><span>'+esc(team.length<=4?team:'')+'</span><img data-team-logo="'+esc(team)+'" alt="" loading="lazy" decoding="async" hidden></span>';
  }
  function matchupHTML(game){
    return teamIcon(game.awayTeam.abbreviation)+'<span>'+esc(game.awayTeam.name)+' <span class="matchup-at">@</span> '+esc(game.homeTeam.name)+'</span>'+teamIcon(game.homeTeam.abbreviation);
  }
  function knownTeamsHTML(teams,{compact=false,title='Matchup unavailable',directory=matchupDirectory}={}){
    const values=[...new Set((teams||[]).filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()))];
    if(!values.length)return '<span>'+esc(title)+'</span>';
    const pair=[...new Map(values.map(value=>{const team=directory.team(value)||{name:value,abbreviation:value};return [team.abbreviation.toLowerCase(),team];})).values()].slice(0,2);
    const label=pair.map(team=>team.name).join(' vs ')+(pair.length===1?' · opponent unavailable':'');
    return '<span class="'+(compact?'pm-game-teams':'matchup-team-pair')+'" aria-label="'+esc(label)+'">'+teamIcon(pair[0].abbreviation)+'<span>'+esc(compact?pair[0].abbreviation:pair[0].name)+(pair.length===2?' <span class="matchup-at">vs</span> '+esc(compact?pair[1].abbreviation:pair[1].name):' · opponent unavailable')+'</span>'+(pair.length===2?teamIcon(pair[1].abbreviation):'')+'</span>';
  }
  function matchupAttributes(row,teams){
    return ' data-matchup-events="'+esc(JSON.stringify([row.canonicalEventId,row.eventId,row.resultSource?.eventId&&'espn:'+row.resultSource.eventId].filter(Boolean)))+'" data-matchup-teams="'+esc(JSON.stringify(teams||[]))+'"';
  }
  function matchupHeading(title,teams,row={},directory=matchupDirectory){
    const key=JSON.stringify([row.date,row.canonicalEventId||row.eventId]),game=directory.resolve(row,teams);
    return '<span class="matchup-title" data-matchup-heading="'+esc(key)+'"'+matchupAttributes(row,teams)+'>'+(game?matchupHTML(game):knownTeamsHTML(teams,{title,directory}))+'</span>';
  }
  function compactTime(value){
    if(!Number.isFinite(Date.parse(value)))return 'Tip time unavailable';
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'2-digit',day:'2-digit',hour:'numeric',minute:'2-digit',hour12:true}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));
    return p.month+'/'+p.day+' '+p.hour+':'+p.minute+' '+p.dayPeriod+' ET';
  }
  function compactMatchupHTML(game,startTime){
    const title=game.awayTeam.name+' @ '+game.homeTeam.name;
    return '<span class="pm-game-teams" aria-label="'+esc(title)+'">'+teamIcon(game.awayTeam.abbreviation)+'<span>'+esc(game.awayTeam.abbreviation)+' <span class="matchup-at">@</span> '+esc(game.homeTeam.abbreviation)+'</span>'+teamIcon(game.homeTeam.abbreviation)+'</span><time datetime="'+esc(startTime||'')+'">'+esc(compactTime(startTime))+'</time>';
  }
  function compactMatchup(row,directory=matchupDirectory){
    const key=JSON.stringify([row.date,row.canonicalEventId||row.eventId]),teams=[row.team,row.opponent],game=directory.resolve(row);
    return '<span class="pm-game" data-compact-matchup="'+esc(key)+'"'+matchupAttributes(row,teams)+' data-tip-time="'+esc(row.startTime||'')+'">'+(game?compactMatchupHTML(game,row.startTime):knownTeamsHTML(teams,{compact:true,directory})+'<time datetime="'+esc(row.startTime||'')+'">'+esc(compactTime(row.startTime))+'</time>')+'</span>';
  }
  async function paintImages(root=document,base){
    if(!root.querySelector('img[data-player-headshot],img[data-team-logo],[data-compact-matchup],[data-matchup-heading]'))return;
    try{
      if(!artwork)artwork=source(baseURL(base)).get(new URL('data/player-portraits.json',baseURL(base))).catch(e=>{artwork=null;throw e;});
      const body=await artwork;if(body.schemaVersion!=='public-player-portraits-1')return;
      matchupDirectory=createMatchupDirectory(body);
      for(const title of root.querySelectorAll('[data-matchup-heading],[data-compact-matchup]')){
        if(title.dataset.matchupReady)continue;
        const [date,id]=JSON.parse(title.dataset.matchupHeading||title.dataset.compactMatchup),ids=JSON.parse(title.dataset.matchupEvents||'[]'),teams=JSON.parse(title.dataset.matchupTeams||'[]');
        const row={date,eventAliases:ids.length?ids:[id]},game=matchupDirectory.resolve(row,teams),compact=title.hasAttribute('data-compact-matchup');
        title.innerHTML=game?(compact?compactMatchupHTML(game,title.dataset.tipTime):matchupHTML(game)):knownTeamsHTML(teams,{compact,title:title.textContent})+(compact?'<time datetime="'+esc(title.dataset.tipTime||'')+'">'+esc(compactTime(title.dataset.tipTime))+'</time>':'');
        title.dataset.matchupReady=game?'verified':'teams';
      }
      const players=new Map(body.players.map(p=>[p.id,p])),teams=new Map();
      for(const p of body.players)if(p.espnId)players.set('espn:'+p.espnId,p);
      for(const t of body.teams){teams.set(t.abbreviation,t);teams.set(t.name,t);}
      const aliases={NO:'NOP',NY:'NYK',GS:'GSW',SA:'SAS',UTAH:'UTA',WSH:'WAS'};for(const [a,b] of Object.entries(aliases))if(teams.has(b))teams.set(a,teams.get(b));
      for(const img of root.querySelectorAll('img[data-player-headshot],img[data-team-logo]')){
        if(img.hasAttribute('src'))continue;
        const p=img.dataset.playerHeadshot?players.get(img.dataset.playerHeadshot):null,t=img.dataset.teamLogo?teams.get(matchupDirectory.team(img.dataset.teamLogo)?.abbreviation)||teams.get(img.dataset.teamLogo):null,url=p?.headshot||t?.logo;
        if(!url||!/^https:\/\/a\.espncdn\.com\/i\/(?:headshots\/nba\/players\/full\/\d+|teamlogos\/nba\/500\/[a-z]+)\.png$/.test(url))continue;
        img.classList.add('artwork-loading');
        img.addEventListener('load',()=>{img.classList.remove('artwork-loading');img.previousElementSibling.hidden=true;},{once:true});
        img.addEventListener('error',()=>{img.hidden=true;img.previousElementSibling.hidden=false;},{once:true});img.src=url;img.hidden=false;
      }
    }catch{/* Keep the pick's saved team names if the optional artwork directory fails. */}
  }
  function panel(row,{base,label}={}){
    const token=String(++serial),key=JSON.stringify([row.date,row.canonicalEventId||row.eventId,row.playerId,row.market,row.operator,row.line]);
    instances.set(token,{row,base:baseURL(base),label:label||row.market,key,range:ranges.get(key)||10});
    return '<section class="pick-research" data-research-panel="'+token+'" aria-label="'+esc(row.player)+' '+esc(label||row.market)+' research" aria-busy="true"><p class="research-loading">Loading this season’s research…</p></section>';
  }
  function chartHTML(sample,row,availableWidth=600){
    if(!sample.points.length)return '<div class="research-empty">No recorded '+esc(sample.season)+' appearances before this pick.</div>';
    const points=[...sample.points].reverse(),width=Math.max(availableWidth,points.length*50+54),height=215,left=36,right=18,top=23,bottom=44,plot=height-top-bottom;
    const max=Math.max(row.line||0,...points.map(p=>p.actual||0)),ceiling=Math.max(2,Math.ceil(max*1.2)),y=v=>top+plot*(1-v/ceiling),step=(width-left-right)/points.length,bar=Math.min(39,step*.62),lineY=y(row.line);
    const grid=[0,Math.ceil(ceiling/2),ceiling].map(v=>'<line x1="'+left+'" x2="'+(width-right)+'" y1="'+y(v)+'" y2="'+y(v)+'" class="research-grid"/><text x="'+(left-8)+'" y="'+(y(v)+4)+'" text-anchor="end" class="research-axis">'+v+'</text>').join('');
    const bars=points.map((p,i)=>{const x=left+step*(i+.5),tone=({win:'hit',loss:'miss',push:'push'})[p.outcome]||'unavailable',v=p.actual,date=p.game.date.slice(5).replace('-','/'),tip=p.game.date+' '+(p.game.home?'vs ':'@ ')+p.game.opponent+' · '+(finite(v)?v:'Unavailable')+' '+(names[row.market]||row.market)+' · MP '+fmt(p.game.stats?.MIN)+' · '+p.outcome;return '<g tabindex="0" role="button" data-research-game="'+i+'" class="research-bar-group" aria-label="'+esc(tip)+'"><title>'+esc(tip)+'</title><rect class="research-bar '+tone+'" x="'+(x-bar/2)+'" y="'+(finite(v)?y(v):y(0)-3)+'" width="'+bar+'" height="'+(finite(v)?Math.max(2,y(0)-y(v)):3)+'" rx="5"/><text x="'+x+'" y="'+(finite(v)?y(v)-7:y(0)-9)+'" text-anchor="middle" class="research-value">'+(finite(v)?v:'—')+'</text><text x="'+x+'" y="'+(height-20)+'" text-anchor="middle" class="research-axis">'+esc(p.game.opponent)+'</text><text x="'+x+'" y="'+(height-5)+'" text-anchor="middle" class="research-axis date">'+date+'</text></g>';}).join('');
    const logos=points.map(p=>'<span>'+teamIcon(p.game.opponent,'chart-opponent')+'<span>'+esc(p.game.home?'vs':'@')+'</span></span>').join('');
    const threshold=finite(row.line)?'<line x1="'+left+'" x2="'+(width-right)+'" y1="'+lineY+'" y2="'+lineY+'" class="research-threshold"/><text x="'+(width-right)+'" y="'+Math.max(13,lineY-7)+'" text-anchor="end" class="research-threshold-label">Pick line '+esc(row.operator)+' '+row.line+'</text>':'';
    return '<div class="research-chart-scroll"><div class="research-chart-inner" style="min-width:'+width+'px"><svg viewBox="0 0 '+width+' '+height+'" role="group" aria-label="'+esc(row.player)+' '+esc(names[row.market])+' by game, compared with the exact pick line">'+grid+bars+threshold+'</svg><div class="chart-opponents" style="grid-template-columns:repeat('+points.length+',1fr);padding-left:'+left+'px;padding-right:'+right+'px">'+logos+'</div></div></div>';
  }
  function readText(row,sample,label,projection=currentEstimate(row)?.projection){
    const sentences=[];
    if(finite(projection))sentences.push('Our saved projection is '+fmt(projection)+' '+(names[row.market]||row.market)+' for this '+label+' line.');
    if(sample.decided)sentences.push('This exact line hit in '+sample.hits+' of '+sample.decided+' decided '+sample.season+' appearances in this view, with an average of '+fmt(sample.average)+' '+(names[row.market]||row.market)+'.');
    else sentences.push('Current-season game results will provide the comparison for this line.');
    return sentences.join(' ');
  }
  function concern(row,sample,data){
    if(row.confidenceUpdate?.qualification==='does_not_qualify')return 'The latest saved review no longer qualifies this pick. Its original result stays in our record.';
    if(data.market?.teammateImpact&&!data.market.teammateImpact.applied)return 'The listed teammate absences leave the player’s minutes or responsibility uncertain.';
    if(sample.available<10)return 'Early-season sample: only '+sample.available+' recorded '+sample.season+' appearances before this pick.';
    if(sample.rate!==null&&sample.rate<.5)return 'This line has missed in more than half of the current-season games in this view.';
    const last=sample.points[0];if(last?.outcome==='loss')return 'The most recent appearance missed this line with '+last.actual+' '+(names[row.market]||row.market)+'.';
    return null;
  }
  function trackedTable(d,market){
    const history=[...(d.history||[])].sort((a,b)=>b.season.localeCompare(a.season)),coverage=d.coverage;
    const stats=['PTS','REB','AST','3PM','BLK','STL'],poss=history.reduce((n,h)=>n+h.possessions,0),games=history.reduce((n,h)=>n+h.games,0);
    const values=history.map(h=>parts[market]?.every(k=>finite(h.stats[k]))?parts[market].reduce((s,k)=>s+h.stats[k],0):null);
    const total=values.length&&values.every(finite)?values.reduce((s,v)=>s+v,0):null;
    return '<p><strong>'+esc(d.player)+'</strong> guarding this player · partial tracked possessions only.</p>'+(history.length?'<p>'+games+' games · '+fmt(poss)+' tracked possessions'+(finite(total)?' · '+fmt(total)+' '+esc(names[market])+' ('+fmt(total/poss*100)+' per 100 possessions)':'')+'.</p><div class="defender-table-scroll" role="region" tabindex="0" aria-label="Stats while guarded by '+esc(d.player)+'"><table class="defender-stats-table"><thead><tr>'+['Season','Games','Poss.','Tracked MP',...stats].map(k=>'<th scope="col">'+k+'</th>').join('')+'</tr></thead><tbody>'+history.map(h=>'<tr><th scope="row">'+esc(h.season)+'</th><td>'+h.games+'</td><td>'+fmt(h.possessions)+'</td><td>'+esc(h.minutes)+'</td>'+stats.map(k=>'<td>'+ (finite(h.stats[k])?h.stats[k]:'<span title="Not supplied by the tracking feed">—</span>')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<p>No recorded guarding possessions in the available tracking coverage.</p>')+'<p class="defender-note">— Not supplied by this tracking feed. Full-game rebounds, blocks and steals belong in the other view.</p>'+(coverage?'<p class="defender-note">Career coverage requested from '+esc(coverage.requestedFromSeason)+(coverage.missingSeasons.length?' · Tracking unavailable: '+esc(coverage.missingSeasons.join(', ')):'')+'.</p>':'')+'<a class="defender-source" href="'+esc(d.source)+'" target="_blank" rel="noopener noreferrer">NBA matchup tracking ↗</a>';
  }
  function defenderGameTable(body,market){
    const stats=['PTS','REB','AST','3PM','BLK','STL','TO'],combo=['PRA','PR','PA','RA'].includes(market),values=body.games.map(g=>statValue(g,market)).filter(finite);
    const pair=(v,a,b)=>finite(v[a])&&finite(v[b])?v[a]+'/'+v[b]:'—',percent=v=>finite(v)?(100*v).toFixed(1)+'%':'—';
    return '<p><strong>'+body.games.length+' career games</strong> with both players on opposing teams'+(values.length?' · '+fmt(values.reduce((s,v)=>s+v,0)/values.length)+' '+esc(names[market])+' average':'')+'.</p><p>Full-game totals for '+esc(body.player)+'. '+esc(body.defender)+' played for the opponent shown on each date; direct guarding is not required.</p><p class="defender-scroll-hint">Scroll for all game stats →</p>'+(body.games.length?'<div class="defender-table-scroll" role="region" tabindex="0" aria-label="Full game stats versus '+esc(body.defender)+'’s team"><table class="defender-stats-table full-game"><thead><tr>'+['Date','Opponent','MP',...stats,'Team','Season','FG','FG%','3PT','3P%','FT','FT%',...(combo?[market]:[])].map(k=>'<th scope="col">'+k+'</th>').join('')+'</tr></thead><tbody>'+[...body.games].sort((a,b)=>b.date.localeCompare(a.date)).map(g=>'<tr><th scope="row">'+esc(g.date)+'</th><td>'+teamIcon(g.defenderTeam)+' '+(g.home?'vs ':'@ ')+esc(g.defenderTeam)+'</td><td>'+fmt(g.stats.MIN)+'</td>'+stats.map(k=>'<td>'+(finite(g.stats[k])?g.stats[k]:'—')+'</td>').join('')+'<td>'+esc(g.team)+'</td><td>'+esc(g.season)+'</td><td>'+pair(g.stats,'FGM','FGA')+'</td><td>'+percent(g.stats['FG%'])+'</td><td>'+pair(g.stats,'3PM','3PA')+'</td><td>'+percent(g.stats['3P%'])+'</td><td>'+pair(g.stats,'FTM','FTA')+'</td><td>'+percent(g.stats['FT%'])+'</td>'+(combo?'<td>'+fmt(statValue(g,market))+'</td>':'')+'</tr>').join('')+'</tbody></table></div>':'<p>No shared opposing-team appearances in this coverage.</p>')+'<p class="defender-note">Regular season · '+esc(body.requestedFromSeason)+' onward · data through '+esc(body.through)+(body.missingSeasons.length?' · Incomplete seasons: '+esc(body.missingSeasons.join(', ')):'')+'. Earlier team names are preserved. This differs from career games against today’s opposing franchise.</p><a class="defender-source" href="'+esc(body.source)+'" target="_blank" rel="noopener noreferrer">NBA box-score source ↗</a>';
  }
  function defenderHistoryMarkup(playerId,d,market,{base,before=etDay()}={}){
    const token=String(++serial),prefix='defender-history-'+token;
    defenders.set(token,{playerId,d,market,base:baseURL(base),before});
    return '<details class="research-defender-history" data-defender-history="'+token+'"><summary>Career vs defender: '+esc(d.player)+'</summary><div class="defender-history-tabs" role="tablist" aria-label="History against '+esc(d.player)+'">'+[['guarded','Guarded by defender'],['full','Full game vs defender’s team']].map(([key,label])=>'<button type="button" role="tab" id="'+prefix+'-'+key+'-tab" aria-controls="'+prefix+'-'+key+'" aria-selected="'+(key==='guarded')+'" tabindex="'+(key==='guarded'?0:-1)+'" data-defender-view="'+key+'">'+label+'</button>').join('')+'</div><div role="tabpanel" id="'+prefix+'-guarded" aria-labelledby="'+prefix+'-guarded-tab" data-defender-pane="guarded">'+trackedTable(d,market)+'</div><div role="tabpanel" id="'+prefix+'-full" aria-labelledby="'+prefix+'-full-tab" data-defender-pane="full" hidden><p>Open this view to load full-game stats.</p></div></details>';
  }
  async function switchDefender(button){
    const details=button.closest('[data-defender-history]'),state=defenders.get(details?.dataset.defenderHistory);if(!state)return;
    const view=button.dataset.defenderView;
    for(const tab of details.querySelectorAll('[data-defender-view]')){const on=tab===button;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;}
    for(const panel of details.querySelectorAll('[data-defender-pane]'))panel.hidden=panel.dataset.defenderPane!==view;
    if(view!=='full'||state.loaded||state.loading)return;
    const panel=details.querySelector('[data-defender-pane="full"]');state.loading=true;panel.setAttribute('aria-busy','true');panel.innerHTML='<p>Loading career full-game history…</p>';
    try{const body=await source(state.base).defenderGames(state.playerId,state.d.playerId,state.before);panel.innerHTML=body?defenderGameTable(body,state.market):'<p>No verified full-game history is saved for this player/defender pair.</p>';state.loaded=true;paintImages(panel,state.base);}
    catch{panel.innerHTML='<p>Full-game history could not load. Select this view again to retry.</p>';}
    finally{state.loading=false;panel.setAttribute('aria-busy','false');}
  }
  function contextHTML(row,data,base){
    const m=data.market,u=data.upcoming;if(!m||!u)return '';
    const cards=[],t=m.teammateImpact,d=m.opponentDefense,h=u.opponentHistory;
    if(t?.teammates.length)cards.push('<div class="research-context"><span>Teammate availability</span><strong>'+t.teammates.map(x=>esc(x.player)+' · '+esc(x.status)).join('<br>')+'</strong><small>'+esc(t.applied?'Saved projection effect: '+t.direction:'Role effect remains uncertain')+'</small></div>');
    if(h&&h.games&&finite(h.averages[row.market]))cards.push('<div class="research-context"><span>Career vs '+esc(u.opponentAbbreviation)+'</span><strong>'+teamIcon(u.opponentAbbreviation)+' '+fmt(h.averages[row.market])+' '+esc(names[row.market])+'</strong><small>'+h.games+' regular-season appearances · '+esc(h.fromSeason)+' onward</small></div>');
    if(d)cards.push('<div class="research-context"><span>Opponent defense</span><strong>'+teamIcon(u.opponentAbbreviation)+' '+fmt(d.defensiveRating)+'</strong><small>Points allowed / 100 possessions · '+d.games+' recent team games</small></div>');
    if(m.defender){const x=m.defender,poss=x.history.reduce((sum,h)=>sum+(h.possessions||0),0);cards.push('<div class="research-context defender-context">'+portrait({playerId:x.playerId,player:x.player},{className:'defender-photo',href:new URL('players/profile.html?player='+encodeURIComponent(x.playerId),base).href})+'<div><span>Projected primary defender</span><strong>'+esc(x.player)+'</strong><small>Estimated assignment'+(poss?' · '+fmt(poss)+' career tracked possessions':'')+'</small></div></div>');}
    return (cards.length?'<div class="research-context-heading">What matters for this matchup</div><div class="research-context-grid">'+cards.join('')+'</div>':'')+(m.defender?defenderHistoryMarkup(data.profile.playerId,m.defender,row.market,{base,before:row.date||etDay()}):'');
  }
  function render(state){
    const node=document.querySelector('[data-research-panel="'+state.token+'"]');if(!node)return;
    const row=state.row,data=state.data,s=recentSample(data.games,row,state.range),e=currentEstimate(row),m=data.market,sameForecast=data.upcoming?.asOf===e?.asOf,minutes=sameForecast?m?.expectedMinutes:null,projection=finite(e?.projection)?e.projection:sameForecast?m?.projection:null;
    const title=row.category==='honorable_mention'?'Why it’s on our radar':row.category==='not_a_pick'?'Our research read':row.group==='ry'?'Ry’s pick · our research':'Why we like this line';
    const risk=concern(row,s,data),day=row.date||etDay(),early=[10,11].includes(Number(day.slice(5,7)));
    node.setAttribute('aria-busy','false');
    node.innerHTML='<div class="research-read"><div><h4>'+title+'</h4><p>'+esc(readText(row,s,state.label,projection))+'</p></div><span class="research-model-estimate">'+pct(e?.winProbability)+'<small>Our saved win estimate</small></span></div>'+
      '<div class="research-chart-head"><div><h4>Recent '+esc(names[row.market]||row.market)+'</h4><p>'+esc(s.season)+' season · '+s.points.length+' of '+s.requested+' appearances available</p></div><div class="research-ranges" role="group" aria-label="Current-season recent form">'+[5,10,20].map(n=>'<button type="button" data-research-range="'+n+'" aria-pressed="'+(state.range===n)+'">L'+n+'</button>').join('')+'</div></div>'+
      '<div class="research-stat-strip" aria-live="polite"><div><span>Historical hits</span><strong>'+s.hits+' / '+s.decided+'</strong><small>'+pct(s.rate)+' of decided games'+(s.pushes?' · '+s.pushes+' push':'')+'</small></div><div><span>Sample average</span><strong>'+fmt(s.average)+'</strong><small>'+esc(names[row.market])+'</small></div><div><span>Our projection</span><strong>'+fmt(projection)+'</strong><small>'+esc(names[row.market])+'</small></div><div><span>Projected MP</span><strong>'+fmt(minutes)+'</strong><small>'+(finite(minutes)?'Saved minutes estimate':'Not recorded for this forecast')+'</small></div></div>'+
      chartHTML(s,row,node.clientWidth||600)+'<div class="research-legend"><span class="legend-hit">● Hit</span><span class="legend-miss">● Miss</span><span>● Push / unavailable</span></div><p class="research-game-detail" role="status">Tap a bar for date, opponent, stat total and MP.</p>'+
      (risk?'<p class="research-concern"><strong>Keep in mind:</strong> '+esc(risk)+'</p>':'')+contextHTML(row,data,state.base)+
      (early&&s.available?'<details class="research-yoy" data-research-yoy><summary>Compare early-season form year over year</summary><div class="research-yoy-content">Open to load the same number of early-season appearances from the previous year.</div></details>':'')+
      '<p class="research-caption">Historical hit rates describe recorded games; our win estimate is a separate saved forecast.'+(data.dataThrough?' Stats available through '+esc(data.dataThrough)+'.':'')+'</p>';
    paintImages(node,state.base);
  }
  async function loadPanel(node){
    const token=node.dataset.researchPanel,state=instances.get(token);if(!state||state.loading||state.data)return;
    state.token=token;state.loading=true;
    try{state.data=await source(state.base).research(state.row);render(state);}
    catch{node.setAttribute('aria-busy','false');node.innerHTML='<p class="research-empty">Current-season research could not load. <button type="button" data-research-retry>Try again</button></p>';}
    finally{state.loading=false;}
  }
  function hydrate(root=document){
    const nodes=[...(root.matches?.('[data-research-panel]')?[root]:[]),...root.querySelectorAll('[data-research-panel]')];
    for(const node of nodes)if(!node.closest('[hidden]')&&!node.closest('details:not([open])'))loadPanel(node);
    paintImages(root);
  }
  async function loadYearOverYear(details){
    if(!details.open||details.dataset.loaded)return;
    const node=details.closest('[data-research-panel]'),state=instances.get(node.dataset.researchPanel),target=details.querySelector('.research-yoy-content');
    if(!state?.data)return;target.textContent='Loading early-season comparison…';
    try{
      const season=previousSeason(seasonFor(state.row.date)),prior=await source(state.base).log(state.row,season),current=appearances(state.data.games,state.row.date).slice().reverse().slice(0,20),old=earlySeasonSample(prior.games,state.row,current.length);
      const currentValues=current.map(g=>statValue(g,state.row.market)).filter(finite),average=currentValues.length?currentValues.reduce((a,b)=>a+b,0)/currentValues.length:null;
      target.innerHTML='<div class="research-yoy-grid"><div><span>'+esc(seasonFor(state.row.date))+' · first '+current.length+'</span><strong>'+fmt(average)+' '+esc(names[state.row.market])+'</strong></div><div><span>'+esc(old.season)+' · first '+old.count+'</span><strong>'+fmt(old.average)+' '+esc(names[state.row.market])+'</strong><small>'+esc(old.teams.join(' / '))+' · '+fmt(old.minutes)+' MP</small></div></div><p>Separate historical comparison. Changes in team, role and opponents can affect these samples.</p>';details.dataset.loaded='true';
    }catch{target.textContent='The previous season’s early-season sample is unavailable.';}
  }
  function init(){
    defaultBase=new URL('../',document.querySelector('script[data-pick-research]').src);
    document.addEventListener('click',event=>{
      const defender=event.target.closest('[data-defender-view]');if(defender){switchDefender(defender);return;}
      const game=event.target.closest('[data-research-game]');
      if(game){inspectGame(game);return;}
      const button=event.target.closest('[data-research-range],[data-research-retry]');if(!button)return;
      const node=button.closest('[data-research-panel]'),state=instances.get(node?.dataset.researchPanel);if(!state)return;
      if(button.hasAttribute('data-research-retry')){loadPanel(node);return;}
      const range=Number(button.dataset.researchRange);if(![5,10,20].includes(range)||!state.data)return;state.range=range;ranges.set(state.key,range);render(state);node.querySelector('[data-research-range="'+range+'"]').focus({preventScroll:true});
    });
    document.addEventListener('keydown',event=>{
      const current=event.target.closest('[data-defender-view]');
      if(current&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const buttons=[...current.closest('[role="tablist"]').querySelectorAll('[data-defender-view]')],i=buttons.indexOf(current),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next].click();buttons[next].focus();return;}
      const game=event.target.closest('[data-research-game]');if(game&&['Enter',' '].includes(event.key)){event.preventDefault();inspectGame(game);}
    });
    document.addEventListener('toggle',event=>{if(!event.target.open)return;if(event.target.matches('[data-research-yoy]'))loadYearOverYear(event.target);else hydrate(event.target);},true);
    window.addEventListener('resize',()=>{for(const state of instances.values()){const node=state.token&&document.querySelector('[data-research-panel="'+state.token+'"]');if(state.data&&node&&!node.closest('[hidden]')&&!node.closest('details:not([open])'))render(state);}});
    paintImages();
  }
  function inspectGame(button){
    const node=button.closest('[data-research-panel]'),state=instances.get(node?.dataset.researchPanel);
    if(!state?.data)return;
    const sample=recentSample(state.data.games,state.row,state.range),point=[...sample.points].reverse()[Number(button.dataset.researchGame)];
    if(!point)return;
    node.querySelector('.research-game-detail').textContent=point.game.date+' · '+(point.game.home?'vs ':'@ ')+point.game.opponent+' · '+(finite(point.actual)?point.actual:'Unavailable')+' '+(names[state.row.market]||state.row.market)+' · MP '+fmt(point.game.stats?.MIN)+' · '+({win:'Hit',loss:'Miss',push:'Push'}[point.outcome]||'Unavailable');
  }
  return {init,panel,hydrate,paintImages,portrait,teamIcon,createMatchupDirectory,matchupHeading,matchupHTML,compactMatchup,compactMatchupHTML,compactTime,seasonFor,appearances,recentSample,earlySeasonSample,chartHTML,readText,createSource,trackedTable,defenderGameTable,defenderHistoryMarkup};
});
