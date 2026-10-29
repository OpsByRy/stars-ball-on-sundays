/* Basic, sourced box scores and historical line comparisons. No model inference. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./result-utils.js'):root.STARS_RESULT_UTILS);
  if(typeof module==='object'&&module.exports)module.exports=api;else{root.SBOS_GAME_LOGS=api;api.init();}
})(typeof window!=='undefined'?window:this,function(contracts){
  'use strict';
  const markets={BLK:'Blocks',STL:'Steals',PTS:'Points',REB:'Rebounds',AST:'Assists','3PM':'Made threes',PRA:'Points + rebounds + assists',PR:'Points + rebounds',PA:'Points + assists',RA:'Rebounds + assists'};
  const components={BLK:['BLK'],STL:['STL'],PTS:['PTS'],REB:['REB'],AST:['AST'],'3PM':['3PM'],PRA:['PTS','REB','AST'],PR:['PTS','REB'],PA:['PTS','AST'],RA:['REB','AST']};
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  const dayLabel=day=>validDate(day)?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric'}).format(new Date(day+'T12:00:00Z')):'—';
  function lastName(name){const parts=String(name).trim().split(/\s+/);while(parts.length>1&&/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(parts.at(-1)))parts.pop();let start=parts.length-1;while(start>1&&/^(da|de|del|della|di|van|von)$/i.test(parts[start-1]))start--;return parts.slice(start).join(' ');}
  function sortPlayers(players){return [...players].sort((a,b)=>lastName(a.name).localeCompare(lastName(b.name),undefined,{sensitivity:'base'})||a.name.localeCompare(b.name,undefined,{sensitivity:'base'})||a.id.localeCompare(b.id));}
  const playerTeam=p=>p.profileTeam||p.latestTeam||'Team unavailable';
  function teamGroups(players){const teams=new Map();for(const p of players){const team=playerTeam(p);if(!teams.has(team))teams.set(team,[]);teams.get(team).push(p);}return [...teams].sort(([a],[b])=>a.localeCompare(b)).map(([team,rows])=>({team,players:sortPlayers(rows)}));}
  function playerOptions(players){return teamGroups(players).map(g=>`<optgroup label="${escape(g.team)}">${g.players.map(p=>`<option value="${escape(p.id)}">${escape(p.name)}</option>`).join('')}</optgroup>`).join('');}
  const stamp=value=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value)):'Unavailable';
  function statValue(game,market){const keys=components[market];return keys&&keys.every(k=>finite(game.stats?.[k]))?keys.reduce((a,k)=>a+game.stats[k],0):null;}
  function comparisonState(search){const p=new URLSearchParams(search),stat=Object.hasOwn(markets,p.get('stat'))?p.get('stat'):'PTS',raw=p.get('line'),line=raw!==null&&raw.trim()!==''?Number(raw):null,operator=p.get('op');return {stat,operator:['>','>=','<','<='].includes(operator)?operator:'>',comparison:finite(line)?contracts.normalizeContract({market:stat,line,operator}):null,pickDate:validDate(p.get('date'))?p.get('date'):null};}
  function historicalGames(games,{before=null,location='all',limit=0}={}){const rows=games.filter(g=>validDate(g.date)&&(!before||g.date<before)&&g.status!=='dnp'&&!g.didNotPlay&&(location==='all'||location==='home'&&g.home||location==='away'&&!g.home)).sort((a,b)=>b.date.localeCompare(a.date)||String(b.eventId).localeCompare(String(a.eventId)));return limit?rows.slice(0,limit):rows;}
  function compare(game,comparison){return comparison?contracts.evaluateStructured(comparison,{eventStatus:'final',stats:game.stats,didNotPlay:game.didNotPlay||game.status==='dnp'}):{actual:null,statisticalOutcome:'unavailable'};}
  function record(games,comparison){const outcomes=games.map(g=>compare(g,comparison).statisticalOutcome),hits=outcomes.filter(x=>x==='win').length,misses=outcomes.filter(x=>x==='loss').length,pushes=outcomes.filter(x=>x==='push').length;return {hits,misses,pushes,unavailable:outcomes.length-hits-misses-pushes,decided:hits+misses,rate:hits+misses?hits/(hits+misses):null};}
  function safeLogURL(entry,root,season){if(!/^nba:\d{1,12}$/.test(entry.id)||!/^\d{4}-\d{2}$/.test(season)||!/^[a-f0-9]{16}$/.test(entry.version)||entry.path!==`${season}/${entry.id.split(':')[1]}/${entry.version}.json`)throw Error('Invalid game-log path');return new URL(entry.path,root);}
  function propURL(pick,{base,boardSearch='',channel='daily'}={}){
    const player=/^(nba|espn):\d{1,12}$/.test(pick.playerId||'')?pick.playerId:/^\d{1,12}$/.test(pick.resultSource?.athleteId||'')?'espn:'+pick.resultSource.athleteId:null;
    const contract=contracts.normalizeContract(pick);if(!player||!contract)return null;
    const params=new URLSearchParams({player,stat:contract.market,op:contract.operator,line:String(contract.line),channel:channel==='sunday'?'sunday':'daily'});if(validDate(pick.date)){params.set('date',pick.date);const y=Number(pick.date.slice(0,4))-(Number(pick.date.slice(5,7))<7?1:0);params.set('season',`${y}-${String(y+1).slice(-2)}`);}if(boardSearch)params.set('board',boardSearch);
    return new URL('players/profile.html?'+params,base).href;
  }
  function shootingPair(stats,made,attempted){return finite(stats?.[made])&&finite(stats?.[attempted])?`${stats[made]}/${stats[attempted]}`:'—';}
  function shootingPercent(value){return finite(value)&&value>=0&&value<=1?(100*value).toFixed(1)+'%':'—';}
  function init(){
    const kind=document.body.dataset.page;if(!['players','player-log'].includes(kind))return;
    const script=document.querySelector('script[data-game-logs]'),base=new URL('../',script.src),dataRoot=new URL('data/player-logs/',base),$=id=>document.getElementById(id),params=new URL(location.href).searchParams;
    let catalog=null,initialized=false,index=null,entry=null,body=null,state=comparisonState(location.search),scope='last10',locationFilter='all',beforePick=!!state.pickDate,request=0;
    const load=async(url,immutable=false)=>{const r=await fetch(url,{credentials:'omit',cache:immutable?'force-cache':'no-store'});if(!r.ok)throw Error('Game logs unavailable');return r.json();};
    const currentTeams=load(new URL('data/player-profiles/index.json',base)).then(body=>new Map(body.schemaVersion==='public-player-profiles-1'?body.players.filter(p=>p.team).map(p=>[p.id,p.team]):[])).catch(()=>new Map());
    const label=c=>!c?'No line selected':`${c.operator==='>='?c.line+'+':c.operator==='>'?'Over '+c.line:c.operator==='<'?'Under '+c.line:'At most '+c.line} ${markets[c.market].toLowerCase()}`;
    const average=(rows,market)=>{const values=rows.map(g=>market==='MIN'?g.stats?.MIN:statValue(g,market)).filter(finite);return values.length?(values.reduce((a,b)=>a+b,0)/values.length).toFixed(1):'—';};
    function profileURL(player){const p=new URLSearchParams(location.search);p.set('player',player.id);if(kind==='players'){p.delete('q');p.delete('team');}return new URL('players/profile.html?'+p,base).href;}
    function sourceLinks(player){return `<a href="https://www.nba.com/stats/player/${player.id.split(':')[1]}/boxscores-traditional?Season=${index.season}" target="_blank" rel="noopener noreferrer">NBA game log ↗</a>${/^\d{1,12}$/.test(player.espnId||'')?`<a href="https://www.espn.com/nba/player/gamelog/_/id/${player.espnId}/type/nba/year/${Number(index.season.slice(0,4))+1}" target="_blank" rel="noopener noreferrer">ESPN game log ↗</a>`:''}`;}
    function renderDirectory(){const q=$('player-search').value.trim().toLowerCase(),team=$('player-team').value,players=index.players.filter(p=>`${p.name} ${playerTeam(p)} ${p.teams.join(' ')}`.toLowerCase().includes(q)&&(team==='all'||playerTeam(p)===team));$('player-directory-count').textContent=`${players.length} of ${index.players.length} players`;$('player-directory').innerHTML=teamGroups(players).map(g=>`<h2 class="player-team-title">${window.SBOS_PICK_RESEARCH?.teamIcon(g.team)||''}${escape(g.team)}</h2>${g.players.map(p=>`<a class="player-directory-row with-portrait" href="${escape(profileURL(p))}">${window.SBOS_PICK_RESEARCH?.portrait({playerId:p.id,player:p.name})||''}<strong>${escape(p.name)}</strong><span>${escape(g.team)} · ${p.games} ${p.games===1?'game':'games'}</span><span aria-hidden="true">↗</span></a>`).join('')}`).join('')||'<p class="log-empty">No players match your search.</p>';window.SBOS_PICK_RESEARCH?.paintImages($('player-directory'));}
    function boardLink(){const search=new URLSearchParams(params.get('board')||'');if(state.pickDate)search.set('date',state.pickDate);const channel=params.get('channel');return new URL((channel==='sunday'?'sundays/week.html':'daily/')+(search.size?'?'+search:''),base).href;}
    async function showPlayer(player){
      window.SBOS_PROFILES?.cancel();const serial=++request;entry=player;const data=await load(safeLogURL(player,dataRoot,index.season),true);if(serial!==request)return;
      if(data.schemaVersion!=='public-game-log-1'||data.playerId!==player.id||data.version!==player.version||data.season!==index.season||!Array.isArray(data.games))throw Error('Player identity mismatch');body=data;
      document.title=player.name+' Player Profile · SBOS';$('player-name').textContent=player.name;$('player-meta').textContent=`${index.season} regular season · ${player.latestTeam} · ${player.games} recorded ${player.games===1?'appearance':'appearances'}`;
      $('player-source-links').innerHTML=sourceLinks(player);$('player-select').value=player.id;$('game-log-workspace').hidden=false;$('player-missing').hidden=true;
      const next=new URL(location.href);next.searchParams.set('player',player.id);history.replaceState(null,'',next);renderLog();window.SBOS_PROFILES?.show({player,index,body,base,stat:state.stat});
    }
    function renderChart(rows){
      const ordered=[...rows].reverse(),values=ordered.map(g=>statValue(g,state.stat)),maximum=Math.max(1,...values.filter(finite),state.comparison?.line||0)*1.18,width=Math.max(900,ordered.length*55),height=185,baseline=150,step=ordered.length?(width-60)/ordered.length:840,bar=Math.min(54,step*.62);
      const line=state.comparison?`<line x1="30" x2="${width-25}" y1="${baseline-state.comparison.line/maximum*120}" y2="${baseline-state.comparison.line/maximum*120}" class="comparison-line"/><text x="${width-20}" y="${baseline-state.comparison.line/maximum*120-5}" text-anchor="end" class="chart-line-label">${state.comparison.line}</text>`:'';
      return `<svg class="game-log-chart" style="min-width:${Math.max(540,ordered.length*45)}px" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(markets[state.stat])} by game, oldest to newest. Values and line comparisons also appear in the game log below.">${line}${ordered.map((g,i)=>{const v=values[i],x=30+step*i+step/2,h=finite(v)?v/maximum*120:0,outcome=state.comparison?compare(g,state.comparison).statisticalOutcome:'neutral';return `<g><title>${escape(dayLabel(g.date)+' '+(g.home?'vs ':'at ')+g.opponent+': '+(v??'unavailable')+' '+state.stat)}</title><rect x="${x-bar/2}" y="${baseline-h}" width="${bar}" height="${Math.max(h,2)}" rx="3" class="log-bar log-${outcome}"/><text x="${x}" y="${baseline-h-8}" text-anchor="middle" class="chart-value">${v??'—'}</text><text x="${x}" y="170" text-anchor="middle" class="chart-date">${escape(dayLabel(g.date))}</text></g>`;}).join('')}</svg>`;
    }
    function renderLog(){
      if(!body)return;
      const all=historicalGames(body.games,{before:beforePick?state.pickDate:null,location:locationFilter}),limit=scope==='last5'?5:scope==='last10'?10:0,rows=limit?all.slice(0,limit):all,original=comparisonState(location.search),matching=(params.get('player')===entry.id||params.get('player')==='espn:'+entry.espnId)&&JSON.stringify(original.comparison)===JSON.stringify(state.comparison);
      $('comparison-label').textContent=label(state.comparison);$('comparison-legend').hidden=!state.comparison;$('comparison-context').textContent=state.comparison?(matching&&state.pickDate?'Line from the '+dayLabel(state.pickDate)+' pick.':'Your historical line comparison.'):'Choose a line to compare it with past games.';
      $('history-scope').textContent=beforePick&&state.pickDate?'Only games before '+dayLabel(state.pickDate)+', '+state.pickDate.slice(0,4):'All available '+index.season+' regular-season games';
      $('historical-cards').innerHTML=[5,10].map(n=>{const sample=all.slice(0,n),r=record(sample,state.comparison);return `<div><span>LAST ${n} · ${sample.length} AVAILABLE</span><strong>${state.comparison&&r.rate!==null?(r.rate*100).toFixed(0)+'%':'—'}</strong><small>${state.comparison?`${r.hits} hit / ${r.decided} decided${r.pushes?' · '+r.pushes+' push':''}${r.unavailable?' · '+r.unavailable+' unavailable':''}`:'Select a comparison line'}</small></div>`;}).join('')+`<div><span>SEASON · ${all.length} AVAILABLE</span><strong>${average(all,state.stat)}</strong><small>Average ${escape(markets[state.stat].toLowerCase())}</small></div><div><span>MINUTES PLAYED</span><strong>${average(all,'MIN')}</strong><small>Average MP in these games</small></div>`;
      for(const tab of document.querySelectorAll('[data-log-scope]'))tab.setAttribute('aria-pressed',String(tab.dataset.logScope===scope));
      $('log-chart').innerHTML=rows.length?renderChart(rows):'<p class="log-empty">No recorded appearances in this view.</p>';$('log-row-count').textContent=`${rows.length} ${rows.length===1?'game':'games'} shown`;
      $('selected-stat-heading').textContent=state.stat;$('selected-stat-heading').hidden=components[state.stat].length===1;for(const th of document.querySelectorAll('[data-log-stat]'))th.classList.toggle('selected-stat',th.dataset.logStat===state.stat);$('log-game-rows').innerHTML=rows.map(g=>{const r=compare(g,state.comparison),outcome=state.comparison?r.statisticalOutcome:'neutral',value=statValue(g,state.stat);return `<tr><th scope="row">${escape(dayLabel(g.date))}</th><td>${escape(g.team)}</td><td>${g.home?'vs':'@'} ${escape(g.opponent)}</td><td>${g.stats.MIN??'—'}</td><td class="${state.stat==='PTS'?'selected-stat':''}">${g.stats.PTS??'—'}</td><td>${shootingPair(g.stats,'FGM','FGA')}</td><td>${shootingPercent(g.stats['FG%'])}</td><td class="${state.stat==='3PM'?'selected-stat':''}">${shootingPair(g.stats,'3PM','3PA')}</td><td>${shootingPercent(g.stats['3P%'])}</td><td>${shootingPair(g.stats,'FTM','FTA')}</td><td>${shootingPercent(g.stats['FT%'])}</td>${['REB','AST','BLK','STL','TO'].map(k=>`<td class="${k===state.stat?'selected-stat':''}">${g.stats[k]??'—'}</td>`).join('')}<td class="selected-stat" ${components[state.stat].length===1?'hidden':''}>${value??'—'}</td><td><span class="log-outcome log-${outcome}">${state.comparison?({win:'✓ Hit',loss:'✕ Miss',push:'↔ Push',unavailable:'— Unavailable'})[outcome]||'—':'—'}</span></td></tr>`;}).join('')||'<tr><td colspan="18" class="log-empty">No recorded appearances in this view.</td></tr>';
      $('comparison-stat').value=state.stat;$('comparison-operator').value=state.operator;if(document.activeElement!==$('comparison-line'))$('comparison-line').value=state.comparison?.line??'';
    }
    function readControls(){state.stat=$('comparison-stat').value;state.operator=$('comparison-operator').value;const raw=$('comparison-line').value;state.comparison=raw.trim()===''?null:contracts.normalizeContract({market:state.stat,operator:$('comparison-operator').value,line:Number(raw)});renderLog();}
    async function loadSeason(season,playerId=params.get('player')){
      const record=catalog.seasons.find(e=>e.season===season);if(!record||record.path!==season+'/index.json'||!/^\d{4}-\d{2}$/.test(season))throw Error('Unknown season');
      const serial=++request;const nextIndex=await load(new URL(record.path,dataRoot));if(serial!==request)return;
      if(nextIndex.schemaVersion!=='public-game-logs-1'||nextIndex.season!==season||!Array.isArray(nextIndex.players))throw Error('Unsupported game logs');
      const teams=await currentTeams;if(serial!==request)return;index=nextIndex;index.players=sortPlayers(index.players.map(p=>({...p,profileTeam:teams.get(p.id)||p.latestTeam})));$('log-season').value=season;
      const next=new URL(location.href);next.searchParams.set('season',season);history.replaceState(null,'',next);
      $('log-coverage').textContent=`${index.players.length} players · ${index.games} games · through ${dayLabel(index.dataThrough)}, ${index.dataThrough.slice(0,4)}. Stats refreshed ${stamp(index.capturedAt)}.`;
      if(kind==='players'){
        const previousTeam=$('player-team').value;$('player-team').innerHTML='<option value="all">All teams</option>'+teamGroups(index.players).map(g=>`<option>${escape(g.team)}</option>`).join('');
        if([...$('player-team').options].some(o=>o.value===previousTeam))$('player-team').value=previousTeam;
        if(!initialized){$('player-search').addEventListener('input',renderDirectory);$('player-team').addEventListener('change',renderDirectory);initialized=true;}
        renderDirectory();return;
      }
      body=null;$('game-log-workspace').hidden=true;$('back-to-picks').href=boardLink();$('before-pick-wrap').hidden=!state.pickDate;$('before-pick').checked=beforePick;if(state.pickDate)$('before-pick-label').textContent='Only games before '+dayLabel(state.pickDate);
      $('player-select').innerHTML=playerOptions(index.players);
      if(!initialized){
        $('player-select').addEventListener('change',()=>{state.comparison=null;$('comparison-line').value='';const next=new URL(location.href);next.searchParams.delete('line');next.searchParams.delete('op');history.replaceState(null,'',next);params.set('player',$('player-select').value);showPlayer(index.players.find(p=>p.id===$('player-select').value)).catch(showError);});
        for(const id of ['comparison-stat','comparison-operator','comparison-line'])$(id).addEventListener('change',readControls);
        $('comparison-line').addEventListener('input',readControls);
        $('log-location').addEventListener('change',()=>{locationFilter=$('log-location').value;renderLog();});$('before-pick').addEventListener('change',()=>{beforePick=$('before-pick').checked;renderLog();});
        document.addEventListener('click',event=>{const button=event.target.closest('[data-log-scope]');if(button){scope=button.dataset.logScope;renderLog();}});initialized=true;
      }
      const id=playerId,player=index.players.find(p=>p.id===id||'espn:'+p.espnId===id);
      if(!player){
        entry=null;$('player-meta').textContent=index.season+' regular season';$('player-select').selectedIndex=-1;$('player-source-links').innerHTML='';
        if(/^(nba|espn):\d{1,12}$/.test(id||''))$('player-source-links').innerHTML=id.startsWith('nba:')?`<a href="https://www.nba.com/stats/player/${id.split(':')[1]}/boxscores-traditional" target="_blank" rel="noopener noreferrer">NBA game log ↗</a>`:`<a href="https://www.espn.com/nba/player/gamelog/_/id/${id.split(':')[1]}" target="_blank" rel="noopener noreferrer">ESPN game log ↗</a>`;
        $('player-name').textContent='No saved appearances this season.';$('player-missing').hidden=false;$('player-missing').innerHTML='<p>We have no matched appearances for this player in the selected season. Choose another season or player, or open the source game log.</p>';return;
      }
      await showPlayer(player);
    }
    async function start(){
      catalog=await load(new URL('catalog.json',dataRoot));if(catalog.schemaVersion!=='public-game-log-catalog-1'||!Array.isArray(catalog.seasons)||!catalog.seasons.length)throw Error('Unsupported season catalog');
      catalog.seasons.sort((a,b)=>b.season.localeCompare(a.season));$('log-season').innerHTML=catalog.seasons.map(e=>`<option value="${escape(e.season)}">${escape(e.season)}</option>`).join('');
      $('log-season').addEventListener('change',()=>loadSeason($('log-season').value,entry?.id||params.get('player')).catch(showError));
      const requested=params.get('season'),season=catalog.seasons.some(e=>e.season===requested)?requested:catalog.seasons[0].season;
      await loadSeason(season);
    }
    function showError(){$('log-error').hidden=false;$('log-error').textContent='The saved game log is unavailable. Your pick and its saved estimate have not changed. Please refresh to try again.';}
    start().catch(showError);
  }
  return {init,statValue,comparisonState,historicalGames,compare,record,safeLogURL,propURL,lastName,sortPlayers,playerTeam,teamGroups,playerOptions,shootingPair,shootingPercent};
});
