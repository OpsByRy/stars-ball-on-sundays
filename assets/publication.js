/* Public renderer: consumes reviewed publication records, never raw research inputs. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.SBOS_PUBLICATION=api;api.init();}})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const results=typeof window==='undefined'?require('./result-utils.js'):window.STARS_RESULT_UTILS;
  const routes=typeof window==='undefined'?require('./routes.js'):window.SBOS_ROUTES;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const markets={PTS:'points',AST:'assists',REB:'rebounds','3PM':'made threes',PRA:'points + rebounds + assists',PR:'points + rebounds',PA:'points + assists',RA:'rebounds + assists',BLK:'blocks',STL:'steals'};
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  const dateLabel=day=>validDate(day)?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'long',day:'numeric',year:'numeric'}).format(new Date(day+'T12:00:00Z')):'Date unavailable';
  const stamp=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+' ET':'Unavailable';
  function etDay(now=new Date()){const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;}
  function nextSunday(now=new Date()){const d=new Date(etDay(now)+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+((7-d.getUTCDay())%7||7));return d.toISOString().slice(0,10);}
  function lineLabel(row){
    const c=(typeof window==='undefined'?require('./result-utils.js'):window.STARS_RESULT_UTILS).normalizeContract(row);if(!c)return 'Contract unavailable';
    const name=markets[c.market]||c.market,native=c.operator==='>='&&Number.isInteger(c.line)&&c.line>0&&(c.market==='3PM'||c.market==='PTS'&&[5,10,15,20,25,30,35].includes(c.line)||['REB','AST'].includes(c.market)&&[4,6,8,10].includes(c.line)||['PRA','PR','PA','RA'].includes(c.market)&&c.line>=10&&c.line%5===0);
    if(native)return `${c.line}+ ${name}`;
    const alternate=['>=','<='].includes(c.operator)||['milestone','alternate','alt'].includes(row.lineType);
    if(c.operator==='>=')return `Alt O${Math.ceil(c.line)-.5} ${name}`;
    if(c.operator==='<=')return `Alt U${Math.floor(c.line)+.5} ${name}`;
    return alternate?`Alt ${c.operator==='>'?'O':'U'}${c.line} ${name}`:`${c.operator==='>'?'Over':'Under'} ${c.line} ${name}`;
  }
  function latestEntries(entries){const map=new Map();for(const e of entries||[])if(['daily','sunday'].includes(e.channel)&&validDate(e.date))map.set(e.channel+':'+e.date,e);return [...map.values()].sort((a,b)=>b.date.localeCompare(a.date));}
  function summary(rows,options={}){rows=results.trackingRows(rows,options);const count=outcome=>rows.filter(p=>p.result?.eventStatus==='final'&&p.result?.statisticalOutcome===outcome).length;const hits=rows.filter(results.isStatisticalHit).length,misses=count('loss'),pushes=count('push'),other=rows.filter(p=>['out','dnp','canceled','postponed'].includes(p.result?.statisticalOutcome)).length;return {total:rows.length,hits,misses,pushes,other,pending:rows.length-hits-misses-pushes-other};}
  function safeEditionURL(entry,root){if(!/^[0-9a-f]{16}$/.test(entry.version)||!validDate(entry.date)||!['daily','sunday'].includes(entry.channel)||entry.path!==`${entry.channel}/${entry.date}/${entry.version}.json`)throw Error('Invalid publication path');return new URL(entry.path,root);}
  const categoryTitles={value_safe:'Layups',high_probability_aggressive:'Lobs',not_a_pick:'Not a Pick',honorable_mention:'Bench'};
  function publishedCategory(row){
    if(row.group!=='research')return null;
    if(Object.hasOwn(categoryTitles,row.category))return row.category;
    // Older editions contained selected research only. Route those frozen records
    // to their original display section without recalculating eligibility/estimates.
    return typeof row.americanOdds==='number'&&row.americanOdds<=-200?'value_safe':'high_probability_aggressive';
  }
  function editionGroups(body){const research=body.props.filter(p=>p.group==='research');return {ry:body.props.filter(p=>p.group==='ry'),value_safe:research.filter(p=>publishedCategory(p)==='value_safe'),high_probability_aggressive:research.filter(p=>publishedCategory(p)==='high_probability_aggressive'),research};}
  const gameKey=row=>JSON.stringify([row.date,row.canonicalEventId||row.eventId||row.id]);
  function favoriteKey(row){
    const c=(typeof window==='undefined'?require('./result-utils.js'):window.STARS_RESULT_UTILS).normalizeContract(row);if(!c)return null;
    // Half-point overs and integer milestones settle identically for counting stats.
    // Strict whole-number lines retain their push boundary.
    let {operator,line}=c;if(!Number.isInteger(line)){line=operator.startsWith('>')?Math.ceil(line):Math.floor(line);operator=operator.startsWith('>')?'>=':'<=';}
    return JSON.stringify([gameKey(row),row.playerId||row.player.trim().toLowerCase(),c.market,operator,line,row.period||'full_game',row.product||'sportsbook',row.overtime??null]);
  }
  function favoriteKeys(body){return new Set(body.props.filter(p=>p.group==='ry'||p.ryFavorite===true).map(favoriteKey).filter(Boolean));}
  function isFavorite(row,keys){return row.ryFavorite===true||keys.has(favoriteKey(row));}
  function allPicks(body){return body.props.filter(p=>['value_safe','high_probability_aggressive'].includes(publishedCategory(p)));}
  function honorableMentions(body){return body.props.filter(p=>p.group==='research'&&publishedCategory(p)==='honorable_mention');}
  function dailyRows(body,type='all'){return type==='honorable_mention'?honorableMentions(body):allPicks(body);}
  const statOrder=['PTS','REB','AST','3PM','PRA','PR','PA','RA','BLK','STL'];
  const compareText=(a,b)=>String(a||'').localeCompare(String(b||''),undefined,{numeric:true,sensitivity:'base'});
  const latestEstimate=p=>p.confidenceUpdate?p.confidenceUpdate.estimate:p.estimate;
  const probability=p=>typeof latestEstimate(p)?.winProbability==='number'&&Number.isFinite(latestEstimate(p).winProbability)?latestEstimate(p).winProbability:null;
  const payout=p=>{const price=pricedPick(p).americanOdds;return typeof price==='number'&&Number.isFinite(price)&&Math.abs(price)>=100?price>0?1+price/100:1+100/Math.abs(price):null;};
  function sortPicks(rows,sort='game'){
    const base=(a,b)=>(Date.parse(a.startTime)||Infinity)-(Date.parse(b.startTime)||Infinity)||compareText(gameKey(a),gameKey(b))||compareText(a.team,b.team)||compareText(a.player,b.player)||statOrder.indexOf(a.market)-statOrder.indexOf(b.market)||a.line-b.line||compareText(a.id,b.id);
    const numeric=(a,b,get,desc)=>{const x=get(a),y=get(b);return x===null?y===null?0:1:y===null?-1:desc?y-x:x-y;};
    return [...rows].sort((a,b)=>{
      if(sort==='probability_desc'||sort==='probability_asc')return numeric(a,b,probability,sort.endsWith('desc'))||base(a,b);
      if(sort==='price_desc'||sort==='price_asc')return numeric(a,b,payout,sort.endsWith('desc'))||base(a,b);
      if(sort==='team')return compareText(a.team,b.team)||base(a,b);
      if(sort==='player')return compareText(a.player,b.player)||base(a,b);
      if(sort==='stat')return statOrder.indexOf(a.market)-statOrder.indexOf(b.market)||base(a,b);
      return base(a,b);
    });
  }
  function filterPicks(rows,{query='',minimum=0,type='all',favoritesOnly=false,game='all',team='all',market='all',sort='game'}={},keys=new Set()){
    const value=Number(minimum),threshold=Number.isFinite(value)?Math.max(0,Math.min(100,value))/100:0;
    return sortPicks(rows.filter(p=>(!threshold||probability(p)!==null&&probability(p)+1e-12>=threshold)&&(type==='all'||publishedCategory(p)===type)&&(!favoritesOnly||isFavorite(p,keys))&&(game==='all'||gameKey(p)===game)&&(team==='all'||p.team===team)&&(market==='all'||p.market===market)&&`${p.player} ${p.team||''} ${p.opponent||''} ${markets[p.market]||p.market}`.toLowerCase().includes(query.trim().toLowerCase())),sort);
  }
  function gameGroups(rows){
    const groups=new Map();for(const p of sortPicks(rows)){const key=gameKey(p);if(!groups.has(key))groups.set(key,{key,rows:[]});groups.get(key).rows.push(p);}
    return [...groups.values()].map(g=>({...g,title:g.rows.find(p=>p.matchup)?.matchup||[...new Set(g.rows.flatMap(p=>[p.team,p.opponent]).filter(Boolean))].sort(compareText).join(' vs ')||'Game unavailable',startTime:g.rows.find(p=>p.startTime)?.startTime}));
  }
  function pricedPick(pick){
    const books=typeof window==='undefined'?require('./book-prices.js'):window.SBOS_BOOK_PRICES;
    if(books)return books.pricedPick(pick);
    if(pick.confidenceUpdate)return {...pick,americanOdds:pick.confidenceUpdate.americanOdds??null};
    const quote=pick.priceCheck;
    return pick.americanOdds==null&&quote?.status==='returned'&&typeof quote.americanOdds==='number'&&Number.isFinite(quote.americanOdds)&&Math.abs(quote.americanOdds)>=100?{...pick,americanOdds:quote.americanOdds}:pick;
  }
  function confidenceDetails(pick){
    const update=pick.confidenceUpdate;if(!update)return '';
    const latest=update.estimate,old=pick.estimate;
    const pct=e=>typeof e?.winProbability==='number'?(100*e.winProbability).toFixed(1)+'%':'unavailable';
    const price=v=>typeof v==='number'?(v>0?'+':'')+v:'unavailable';
    return `<div class="confidence-details" data-confidence-status="${escape(update.status)}"><p><strong>Pregame update · ${escape(stamp(update.checkedAt))}</strong><br>${escape(update.summary)}</p><p>Latest provisional win estimate: <strong>${pct(latest)}</strong>${typeof latest?.projection==='number'?' · projected total '+latest.projection.toFixed(1)+' '+escape(pick.market):''}. Latest same-book price: <strong>${escape(price(update.americanOdds))}</strong>${update.capturedAt?' · captured '+escape(stamp(update.capturedAt)):''}.</p><p>Original posted estimate: <strong>${pct(old)}</strong> · original price <strong>${escape(price(pick.americanOdds))}</strong>. The original contract, category and result record remain saved. This update does not erase a pick from our tracked record.</p></div>`;
  }
  function personalVoidNote(body){
    const legs=(body.props||[]).filter(p=>p.group==='ry'),split=results.parlayLegs({legs});if(!split.voided.length)return '';
    const decimal=results.parlayDecimal({legs:legs.map(pricedPick)}),american=decimal>1?Math.round(decimal>=2?(decimal-1)*100:-100/(decimal-1)):null;
    return '<strong>'+split.voided.length+' void'+(split.voided.length===1?'':'s')+':</strong> '+split.voided.map(p=>escape(p.player)).join(', ')+'. '+(split.active.length?split.active.length+' active legs · '+(american!==null?'Remaining-leg estimate <strong>'+(american>0?'+':'')+american+'</strong> (saved straight prices). Your sportsbook’s revised SGP quote may differ.':'Repriced SGP quote unavailable; check your sportsbook.'):'All legs void · net P/L 0u.');
  }
  function favoritesNotice(body){
    const posted=body.favoritesPostedAt?`<strong>Posted <time datetime="${escape(body.favoritesPostedAt)}">${escape(stamp(body.favoritesPostedAt))}</time></strong>`:'';
    const url=body.sharedBetslipUrl,validURL=typeof url==='string'&&/^https:\/\/sportsbook\.fanduel\.com\/addToBetslip\?shareCode=[a-zA-Z0-9]{1,64}$/.test(url);
    const odds=body.sharedBetslipOdds,priced=typeof odds==='number'&&Number.isFinite(odds)&&Math.abs(odds)>=100;
    const slip=[validURL?`<a class="sbos-text-link" target="_blank" rel="noopener noreferrer" href="${escape(url)}">Open Ry’s shared FanDuel slip ↗</a>`:'',priced?`Full-slip screenshot price: <strong>${odds>0?'+':''}${escape(odds)}</strong>`:''].filter(Boolean).join(' · ');
    if(!posted&&!slip)return '';
    const favorites=(body.props||[]).filter(p=>p.group==='ry'),allPriced=favorites.length>0&&favorites.every(p=>typeof pricedPick(p).americanOdds==='number');
    const checks=favorites.map(p=>p.priceCheck?.checkedAt).filter(v=>v&&Number.isFinite(Date.parse(v))).sort((a,b)=>Date.parse(a)-Date.parse(b));
    const updated=checks.length?`<br>Prices updated ${escape(stamp(checks.at(-1)))}`:'';
    return `<div class="publication-note favorites-posted">${posted}${posted&&slip?'<br>':''}${slip}${updated}${priced?allPriced?'<br>Straight prices appear below. FanDuel’s SGP quote can differ from our calculator’s multiplied straight prices. Check current odds and availability.':'<br>Individual leg prices were not supplied. Check FanDuel for current odds and availability.':''}<div data-personal-void-note>${personalVoidNote(body)}</div></div>`;
  }
  function researchPage(rows,{query='',market='all',status='all',page=0,size=40}={}){
    const filtered=rows.filter(p=>(market==='all'||p.market===market)&&(status==='all'||publishedCategory(p)===status)&&`${p.player} ${p.team||''} ${p.opponent||''}`.toLowerCase().includes(query.toLowerCase()));
    const pages=Math.max(1,Math.ceil(filtered.length/size)),current=Math.max(0,Math.min(page,pages-1));return {rows:filtered.slice(current*size,(current+1)*size),total:filtered.length,pages,page:current};
  }
  const pickTypes=['all','value_safe','high_probability_aggressive','honorable_mention'];
  const pickSorts=['game','probability_desc','probability_asc','price_desc','price_asc','team','player','stat'];
  function readPickState(search=''){
    const params=new URLSearchParams(search),minimum=Number(params.get('min'));
    return {query:params.get('q')||'',minimum:Number.isFinite(minimum)?Math.max(0,Math.min(100,minimum)):0,type:routes.categoryId(params.get('type')),favoritesOnly:params.get('favorites')==='1',game:params.get('game')||'all',team:params.get('team')||'all',market:statOrder.includes(params.get('stat'))?params.get('stat'):'all',sort:pickSorts.includes(params.get('sort'))?params.get('sort'):'game'};
  }
  function pickSearch(day,state={}){
    const params=new URLSearchParams({date:day}),defaults=readPickState();
    for(const [key,param] of Object.entries({type:'type',query:'q',minimum:'min',favoritesOnly:'favorites',game:'game',team:'team',market:'stat',sort:'sort'}))if(state[key]!==undefined&&state[key]!==defaults[key])params.set(param,key==='favoritesOnly'?'1':key==='type'?routes.categoryName(state[key]):state[key]);
    return params.toString();
  }
  function tabCounts(body){const picks=allPicks(body),keys=favoriteKeys(body);return {all:picks.length,value_safe:picks.filter(p=>publishedCategory(p)==='value_safe').length,high_probability_aggressive:picks.filter(p=>publishedCategory(p)==='high_probability_aggressive').length,favorites:picks.filter(p=>isFavorite(p,keys)).length,honorable_mention:honorableMentions(body).length};}
  async function init(){
    const script=document.querySelector('script[data-publication]');if(!script)return;
    const base=new URL('../',script.src),dataRoot=new URL('data/editions/',base),kind=document.body.dataset.page;
    if(!kind)return;
    const $=id=>document.getElementById(id),link=path=>new URL(path,base).href;
    const dailyURL=day=>link('daily/?date='+encodeURIComponent(day)),weeklyURL=day=>link('sundays/week.html?date='+encodeURIComponent(day));
    let activeBody=null,ryKeys=new Set(),pickState={};
    const board=['daily','research','parlays','sundays','week','sunday-personal'].includes(kind)?window.SBOS_PICK_BOARD.create({base,lineLabel,onResults:rows=>{
      if(!activeBody)return;const updates=new Map(rows.map(p=>[p.id,p.result]));for(const p of activeBody.props)if(updates.has(p.id))p.result=updates.get(p.id);
      for(const element of document.querySelectorAll('[data-record-scope]')){
        element.outerHTML=recordSummary(sectionRows(activeBody.props,element.dataset.recordScope),element.dataset.recordScope);
      }
      for(const element of document.querySelectorAll('[data-personal-void-note]'))element.innerHTML=personalVoidNote(activeBody);
    }}):null;
    function personalSundayContent(body){const rows=editionGroups(body).ry;return `<div class="edition-panel"><div class="edition-heading"><h2>${dateLabel(body.date)}</h2><a class="back-to-board" href="${escape(weeklyURL(body.date))}">← Sunday Edition board</a></div><p class="board-intro">Ry’s personal selections, separately attributed and preserved as posted. Favorite flags do not change algorithm selection or tracking.</p>${favoritesNotice(body)}${recordSummary(rows,'ry')}${pickList(rows,'ry')}</div>`;}
    let entries=[],allVersions=[],request=0,researchState={rows:[],query:"",market:"all",status:"all",page:0};
    async function loadJSON(url,immutable=false){const r=await fetch(url,{cache:immutable?'force-cache':'no-store',credentials:'omit'});if(!r.ok)throw Error('Publication unavailable');return r.json();}
    async function loadEdition(entry,compact=false){
      let body;
      if(compact){const view=await loadJSON(safeEditionURL(entry,new URL('data/boards/',base)),true);if(view.schemaVersion!=='public-board-1'||view.sourceVersion!==entry.version||!view.edition||!Array.isArray(view.edition.props)||view.edition.props.some(p=>p.category==='not_a_pick'))throw Error('Board mismatch');body={...view.edition,version:view.sourceVersion};}
      else body=await loadJSON(safeEditionURL(entry,dataRoot),true);
      if(body.schemaVersion!=='public-1'||body.channel!==entry.channel||body.date!==entry.date||body.version!==entry.version||!Array.isArray(body.props))throw Error('Publication mismatch');return body;
    }
    function sectionRows(rows,scope){const unique=[...new Map(rows.map(p=>[p.id,p])).values()];return scope==='all'?filterPicks(allPicks({props:unique}),pickState,ryKeys):unique.filter(p=>scope==='research'?p.group==='research':scope==='ry'?p.group==='ry':publishedCategory(p)===scope);}
    function row(pick,scope=pick.group,context=''){
      const check=pick.priceCheck;
      const priceWarning=check?.qualification==='does_not_qualify'?' · Price/value checks no longer pass':check?.qualification==='unavailable'?' · Price unavailable':'';
      const typeLabel=({value_safe:"Layups",high_probability_aggressive:'Lobs',not_a_pick:'Not a Pick',honorable_mention:'Bench'})[publishedCategory(pick)]||'Posted pick';
      return `<div class="reviewed-row">${board.renderRow(pricedPick(pick),{scope,personal:isFavorite(pick,ryKeys),typeLabel,context,gameLogURL:window.SBOS_GAME_LOGS?.propURL(pick,{base,channel:activeBody.channel,boardSearch:kind==='daily'?pickSearch(activeBody.date,pickState):new URL(location.href).searchParams.get('board')||pickSearch(activeBody.date)}),warning:priceWarning.slice(3),detail:''})}</div>`;
    }
    function statRecordSummary(rows,group){if(group==='ry')return results.parlayRecordHTML(results.personalParlays({...activeBody,props:rows}),{scope:'ry',label:'Ry’s slate parlay record'});const s=summary(rows),decided=s.hits+s.misses,liveHits=rows.filter(results.isLiveHit).length;return `<div class="record-summary" data-record-summary="${group}"><span><strong>${s.total}</strong> ${group==='research'?'reviewed':group==='all'?'shown':group==='honorable_mention'?'bench props':'picks'}</span>${decided?`<span class="record-hits"><strong>${s.hits}</strong> hit</span><span class="record-misses"><strong>${s.misses}</strong> missed</span><span><strong>${(100*s.hits/decided).toFixed(1)}%</strong> hit rate${liveHits?` · includes ${liveHits} live hit${liveHits===1?'':'s'}`:''}</span>`:''}${s.pushes?`<span>${s.pushes} pushed</span>`:''}${s.other?`<span>${s.other} DNP / canceled / postponed</span>`:''}${s.pending?`<span>${s.pending} pending / unavailable</span>`:''}</div>`;}
    function recordSummary(rows,group){
      const units=window.SBOS_UNITS,financial=!units||['research','honorable_mention'].includes(group)?'':group==='ry'?units.recordHTML(results.personalParlays({...activeBody,props:rows}),{kind:'parlays',personal:true}):units.recordHTML(rows.map(p=>({...p,category:publishedCategory(p)})));
      return `<div class="tracked-record" data-record-scope="${escape(group)}">${statRecordSummary(rows,group)}${financial}</div>`;
    }
    function pickList(rows,scope,sort='game'){
      if(!rows.length)return '<p class="pick-empty">No picks match these filters.</p>';
      if(sort!=='game')return `<div class="pick-list">${window.SBOS_PICK_BOARD.columns()}${rows.map(p=>row(p,scope,[p.team,p.opponent?'vs '+p.opponent:''].filter(Boolean).join(' · '))).join('')}</div>`;
      return gameGroups(rows).map(g=>`<section class="game-board" aria-label="${escape(g.title)}"><header class="game-heading"><strong>${window.SBOS_PICK_RESEARCH?.matchupHeading(g.title,[g.rows[0].team,g.rows[0].opponent],g.rows[0])||escape(g.title)}</strong><span>${escape(g.startTime?stamp(g.startTime):'Time unavailable')} · ${g.rows.length} ${scope==='honorable_mention'?(g.rows.length===1?'bench prop':'bench props'):(g.rows.length===1?'pick':'picks')}</span></header><div class="pick-list">${window.SBOS_PICK_BOARD.columns()}${[...new Set(g.rows.map(p=>p.team||'Team unavailable'))].map(team=>`<div class="pick-team-heading">${window.SBOS_PICK_RESEARCH?.teamIcon(team)||''}${escape(team)}</div>${g.rows.filter(p=>(p.team||'Team unavailable')===team).map(p=>row(p,scope)).join('')}`).join('')}</div></section>`).join('');
    }
    function group(title,rows,scope,open=false,intro=''){return `<details id="${scope==='ry'?'ry-parlays':scope+'-section'}" class="pick-group" ${open?'open':''}><summary><h3>${title} <span class="count">${rows.length}</span></h3></summary><div class="pick-group-body">${intro}${recordSummary(rows,scope)}${rows.length?pickList(rows,scope):'<p class="pick-empty">No selections published in this section for this date.</p>'}</div></details>`;}
    function allPickList(){const rows=filterPicks(dailyRows(activeBody,pickState.type),pickState,ryKeys),s=summary(rows);return `${recordSummary(rows,pickState.type==='honorable_mention'?'honorable_mention':'all')}${pickList(rows,pickState.type==='honorable_mention'?'honorable_mention':'all',pickState.sort)}`;}
    function allPickGroup(body){
      pickState={query:'',minimum:0,type:'all',favoritesOnly:false,game:'all',team:'all',market:'all',sort:'game'};
      const picks=allPicks(body),games=gameGroups(picks),options=(values,label)=>values.map(v=>`<option value="${escape(v)}">${escape(label?label(v):v)}</option>`).join('');
      return `<details id="all-picks-section" class="pick-group all-picks" open><summary><h3>All Picks <span class="count">${picks.length}</span></h3></summary><div class="pick-group-body"><p class="board-intro">Our selected Layups and Lobs props. Estimates remain provisional. <span>★ Ry’s Favorite marks Ry’s personal choices.</span></p><details class="pick-filter-panel"><summary>Filter &amp; sort picks <span data-pick-filter-count>${picks.length} picks</span></summary><div class="pick-controls"><label class="pick-search">Find a pick<input data-pick-filter="query" type="search" placeholder="Player, team or stat" autocomplete="off"></label><label>Min. win estimate (%)<input data-pick-filter="minimum" type="number" min="0" max="100" step="1" value="0" inputmode="decimal"></label><label>Pick type<select data-pick-filter="type"><option value="all">Layups + Lobs</option><option value="value_safe">Layups</option><option value="high_probability_aggressive">Lobs</option></select></label><label>Sort by<select data-pick-filter="sort"><option value="game">Game → team → player → stat</option><option value="probability_desc">Win estimate: high to low</option><option value="probability_asc">Win estimate: low to high</option><option value="price_desc">Price: highest payout</option><option value="price_asc">Price: lowest payout</option><option value="team">Team A–Z</option><option value="player">Player A–Z</option><option value="stat">Stat</option></select></label></div><div class="pick-filter-actions"><label class="favorite-filter"><input type="checkbox" data-pick-filter="favoritesOnly"> <span>★ Ry’s Favorites only</span></label><details class="more-pick-filters"><summary>Game, team & stat</summary><div class="pick-controls secondary-filters"><label>Game<select data-pick-filter="game"><option value="all">All games</option>${games.map(g=>`<option value="${escape(g.key)}">${escape(g.title)}</option>`).join('')}</select></label><label>Team<select data-pick-filter="team"><option value="all">All teams</option>${options([...new Set(picks.map(p=>p.team).filter(Boolean))].sort(compareText))}</select></label><label>Stat<select data-pick-filter="market"><option value="all">All stats</option>${options(statOrder.filter(m=>picks.some(p=>p.market===m)),m=>markets[m])}</select></label></div></details><button type="button" data-reset-pick-filters class="outline-button">Reset filters</button></div><p class="pick-sort-note">Default: game time → team → player → stat. Probability and price sorts rank all matching picks. Prices are saved quotes.</p></details><div id="all-pick-lines" aria-live="polite">${allPickList()}</div></div></details>`;
    }
    function supportingURL(page,player=''){
      const search=kind==='daily'?pickSearch(activeBody.date,pickState):new URL(location.href).searchParams.get('board')||pickSearch(activeBody.date);
      const params=new URLSearchParams({date:activeBody.date,board:search});if(player)params.set('player',player);
      return link(page+'/?'+params);
    }
    function dailyTabs(body){const counts=tabCounts(body);return `<div class="daily-tabs" role="tablist" aria-label="Daily pick category">${[['all','All Picks'],['value_safe','Layups'],['high_probability_aggressive','Lobs'],['honorable_mention','Bench']].map(([type,label])=>`<span class="pick-category-tab" role="presentation"><button type="button" role="tab" id="pick-tab-${type}" aria-controls="daily-picks-panel" aria-selected="${pickState.type===type}" tabindex="${pickState.type===type?'0':'-1'}" data-pick-tab="${type}"><span>${label}</span><strong>${counts[type]}</strong></button>${type==='all'?'':`<button type="button" class="pick-category-info" data-category-info="${type}" aria-label="About ${escape(label)}" aria-expanded="false" aria-controls="pick-category-description-${type}" aria-describedby="pick-category-description-${type}"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10 9v5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10" cy="6" r=".9" fill="currentColor"/></svg></button>`}</span>`).join('')}</div>`;}
    function dailyControls(body){
      const picks=[...allPicks(body),...honorableMentions(body)],games=gameGroups(picks),counts=tabCounts(body),options=(values,label)=>values.map(v=>`<option value="${escape(v)}">${escape(label?label(v):v)}</option>`).join('');
      return `<div class="daily-filter-bar"><div class="pick-controls daily-essential-filters"><label class="pick-search">Find a pick<input data-pick-filter="query" type="search" placeholder="Player, team or stat" autocomplete="off"></label><label>Min. win estimate (%)<input data-pick-filter="minimum" type="number" min="0" max="100" step="1" value="0" inputmode="decimal"></label><label>Sort by<select data-pick-filter="sort"><option value="game">Game → team → player → stat</option><option value="probability_desc">Win estimate: high to low</option><option value="probability_asc">Win estimate: low to high</option><option value="price_desc">Price: highest payout</option><option value="price_asc">Price: lowest payout</option><option value="team">Team A–Z</option><option value="player">Player A–Z</option><option value="stat">Stat</option></select></label></div><div class="daily-filter-actions"><button type="button" class="favorite-toggle" data-favorite-toggle aria-pressed="${pickState.favoritesOnly}"><span aria-hidden="true">★</span> Ry’s Favorites <strong>${counts.favorites}</strong></button><details class="more-pick-filters"><summary>More filters</summary><div class="pick-controls secondary-filters"><label>Game<select data-pick-filter="game"><option value="all">All games</option>${games.map(g=>`<option value="${escape(g.key)}">${escape(g.title)}</option>`).join('')}</select></label><label>Team<select data-pick-filter="team"><option value="all">All teams</option>${options([...new Set(picks.map(p=>p.team).filter(Boolean))].sort(compareText))}</select></label><label>Stat<select data-pick-filter="market"><option value="all">All stats</option>${options(statOrder.filter(m=>picks.some(p=>p.market===m)),m=>markets[m])}</select></label></div></details><button type="button" data-reset-pick-filters class="text-button">Reset</button></div></div>`;
    }
    function syncDailyControls(writeURL=true,push=false){
      if(kind!=='daily'||!activeBody)return;
      const type=pickState.type||'all';
      for(const tab of document.querySelectorAll('[data-pick-tab]')){const selected=tab.dataset.pickTab===type;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}
      for(const control of document.querySelectorAll('[data-pick-filter]')){const value=pickState[control.dataset.pickFilter];if(document.activeElement!==control)control.value=value??'';}
      document.querySelector('[data-favorite-toggle]')?.setAttribute('aria-pressed',String(!!pickState.favoritesOnly));
      $('daily-picks-panel')?.setAttribute('aria-labelledby','pick-tab-'+type);
      if($('daily-list-title'))$('daily-list-title').textContent=type==='all'?'All Picks':categoryTitles[type];
      const total=dailyRows(activeBody,type).filter(p=>type==='all'||publishedCategory(p)===type).length,shown=filterPicks(dailyRows(activeBody,pickState.type),pickState,ryKeys).length;
      if($('daily-pick-count'))$('daily-pick-count').textContent=`${shown} of ${total} ${type==='honorable_mention'?'bench props':'picks'}`;
      if($('daily-category-note'))$('daily-category-note').textContent=type==='honorable_mention'?'The Depth Chart · sharp leans and alt lines to watch · 70%+ provisional win estimates · −500 or better. For review only; excluded from our official picks and hit/miss record.':'Latest provisional win estimates shown. Updated or review badges explain pregame changes; original picks remain in the record. Expand a pick to compare snapshots.';
      for(const anchor of document.querySelectorAll('[data-supporting-page]'))anchor.href=supportingURL(anchor.dataset.supportingPage,anchor.dataset.researchPlayer||'');
      if(writeURL){const next='?'+pickSearch(activeBody.date,pickState);if(location.search+location.hash!==next)history[push?'pushState':'replaceState'](null,'',next);}
    }
    function personalSpotlight(body){
      const rows=editionGroups(body).ry;
      return `<details class="ry-spotlight" id="ry-personal-picks"><summary><span class="ry-spotlight-star" aria-hidden="true">★</span><span><strong>Ry’s Personal Picks</strong><small>${rows.length?`${rows.length} picks · personal parlays, projections & results`:'Personal selections and posted parlays'}</small></span><span class="ry-spotlight-action">View picks</span></summary><div class="ry-spotlight-body"><p>See what Ry is playing, with our provisional estimate alongside each selection. Expand a row for its model basis and role uncertainty.</p><a class="sbos-text-link" href="${escape(supportingURL('daily/parlays'))}">Open Ry’s Picks page ↗</a>${rows.length?favoritesNotice(body)+recordSummary(rows,'ry')+pickList(rows,'ry-spotlight'):'<p class="pick-empty">Ry hasn’t posted personal picks for this date yet.</p>'}</div></details>`;
    }
    function renderDailyEdition(body){
      const picks=allPicks(body),settled=picks.length>0&&summary(picks).pending===0&&!picks.some(p=>p.result?.eventStatus==='live'),ry=editionGroups(body).ry;
      return `${results.testSlateNotice(body.date)}${personalSpotlight(body)}<div class="edition-panel daily-edition"><div class="edition-heading"><div><p class="sbos-kicker">DAILY BOARD</p><h2>${dateLabel(body.date)}</h2><p class="edition-asof">Updated ${escape(stamp(body.updatedAt))}</p></div><span class="edition-status">${settled?'Final results':'Published picks'}</span></div><div class="daily-destinations"><a data-supporting-page="research" href="${escape(supportingURL('research'))}">SBOS Research ↗</a><a href="${link('players/')}">Player Profiles ↗</a>${ry.length?`<a data-supporting-page="daily/parlays" href="${escape(supportingURL('daily/parlays'))}">${(body.sharedBetslipUrl||body.sharedBetslipOdds)?'Ry’s Posted Parlay':'Ry’s Posted Picks'} ↗</a>`:''}<a href="${link('guide/')}">How Our Picks Work ↗</a></div>${dailyTabs(body)}${window.SBOS_BOOK_PRICES?.controlHTML()||''}${dailyControls(body)}<section id="daily-picks-panel" class="daily-picks-panel" role="tabpanel" aria-labelledby="pick-tab-${pickState.type}" tabindex="0"><div class="daily-list-heading"><h3 id="daily-list-title">${pickState.type==='all'?'All Picks':categoryTitles[pickState.type]}</h3><span id="daily-pick-count" role="status"></span></div><p id="daily-category-note" class="board-intro">Provisional win estimates · expand a pick for details and research.</p><div id="all-pick-lines" aria-live="polite">${allPickList()}</div></section><p class="daily-caption">Prices are saved quotes. MP means minutes played. Hit rates include reached live overs and exclude pending picks, pushes and DNPs. Live stats can be corrected; statistical results do not verify sportsbook settlement.</p><details class="model-policy edition-record"><summary>About this board & saved versions</summary><p class="publication-note">${escape(body.priceNote)}<br>First published: ${escape(stamp(body.firstPublishedAt))}. Last saved update: ${escape(stamp(body.updatedAt))}.</p>${versionHistory(body)}</details></div>`;
    }
    function refreshPicks(push=false){const target=$('all-pick-lines');if(target){target.innerHTML=allPickList();const count=document.querySelector('[data-pick-filter-count]');if(count)count.textContent=`${filterPicks(dailyRows(activeBody,pickState.type),pickState,ryKeys).length} of ${allPicks(activeBody).length} picks`;syncDailyControls(true,push);board.refresh();}}
    document.addEventListener('input',event=>{const key=event.target.dataset?.pickFilter;if(key==='query'||key==='minimum'){pickState[key]=event.target.value;refreshPicks();}});
    document.addEventListener('change',event=>{const key=event.target.dataset?.pickFilter;if(key&&key!=='query'&&key!=='minimum'){pickState[key]=key==='favoritesOnly'?event.target.checked:event.target.value;refreshPicks();}});
    document.addEventListener('click',event=>{
      if(event.target.closest('[data-reset-pick-filters]')){pickState=readPickState();for(const el of document.querySelectorAll('[data-pick-filter]')){el.type==='checkbox'?el.checked=false:el.value=pickState[el.dataset.pickFilter];}refreshPicks();}
      const tab=event.target.closest('[data-pick-tab]');if(tab){pickState.type=tab.dataset.pickTab;refreshPicks(true);}
      if(event.target.closest('[data-favorite-toggle]')){pickState.favoritesOnly=!pickState.favoritesOnly;refreshPicks();}
      const jump=event.target.closest('[data-pick-jump]');if(jump){const section=$(jump.dataset.pickJump);if(section)section.open=true;}
    });
    document.addEventListener('keydown',event=>{
      const tab=event.target.closest('[data-pick-tab]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const tabs=[...document.querySelectorAll('[data-pick-tab]')],index=tabs.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
      tabs[next].focus();pickState.type=tabs[next].dataset.pickTab;refreshPicks(true);
    });
    window.addEventListener('sbos:bookchange',()=>{if(kind==='daily')refreshPicks();else if(kind==='research')refreshResearch();else if(activeBody){const target=$({parlays:'daily-content',sundays:'sunday-current','sunday-personal':'sunday-current',week:'week-content'}[kind]);if(target){target.innerHTML=kind==='sunday-personal'?personalSundayContent(activeBody):renderEdition(activeBody);board.refresh();}}});
    window.addEventListener('popstate',()=>{if(kind==='daily'&&activeBody){const day=new URL(location.href).searchParams.get('date');if(day&&day!==activeBody.date){$('slate-date').value=day;showDaily(day).catch(showError);}else{pickState=readPickState(location.search);refreshPicks();}}});
    function researchList(){const page=researchPage(researchState.rows,researchState);researchState.page=page.page;return `<div class="research-page-status">${page.total} reviewed lines · page ${page.page+1} of ${page.pages}</div><div class="pick-list">${window.SBOS_PICK_BOARD.columns()}${page.rows.map(p=>row(p,'research')).join('')||'<p class="pick-empty">No reviewed lines match these filters.</p>'}</div><div class="research-pagination"><button type="button" class="outline-button" data-research-page="-1" ${page.page===0?'disabled':''}>Previous</button><button type="button" class="outline-button" data-research-page="1" ${page.page+1===page.pages?'disabled':''}>Next</button></div>`;}
    function researchGroup(rows,standalone=false){researchState={rows,query:standalone?new URL(location.href).searchParams.get('player')||'':'',market:'all',status:'all',page:0};return `${standalone?'<section class="research-library standalone-research">':'<details class="pick-group research-library"><summary><h3>SBOS Research <span class="count">'+rows.length+'</span></h3></summary>'}<div class="pick-group-body"><p class="publication-note">Every reviewed line in this edition, including <strong>Not a Pick</strong>. Reviewed lines are not all recommendations. Prices below −800 are outside the research scope. Your sportsbook preference changes the displayed saved price, while every selected line stays fixed.</p><div class="research-controls"><label>Search player or team<input id="research-search" value="${escape(researchState.query)}" type="search" placeholder="Player or team" autocomplete="off"></label><label>Market<select id="research-market"><option value="all">All markets</option>${[...new Set(rows.map(p=>p.market))].sort().map(m=>`<option value="${escape(m)}">${escape(markets[m]||m)}</option>`).join('')}</select></label><label>Review<select id="research-status"><option value="all">All reviewed lines</option>${Object.entries(categoryTitles).map(([key,title])=>`<option value="${key}">${title}</option>`).join('')}</select></label></div><div id="research-lines" aria-live="polite">${researchList()}</div></div>${standalone?'</section>':'</details>'}`;}
    function refreshResearch(){const target=$('research-lines');if(target){target.innerHTML=researchList();board.refresh();}}
    document.addEventListener('input',event=>{if(event.target.id==='research-search'){researchState.query=event.target.value;researchState.page=0;refreshResearch();}});
    document.addEventListener('change',event=>{if(event.target.id==='research-market'||event.target.id==='research-status'){researchState[event.target.id==='research-market'?'market':'status']=event.target.value;researchState.page=0;refreshResearch();}});
    document.addEventListener('click',event=>{const button=event.target.closest('[data-research-page]');if(button){researchState.page+=Number(button.dataset.researchPage);refreshResearch();}});
    function versionHistory(body){const versions=allVersions.filter(e=>e.channel===body.channel&&e.date===body.date);return versions.length>1?`<details class="model-policy"><summary>Saved versions of this edition</summary><ul>${versions.map(e=>`<li><a href="${escape(safeEditionURL(e,dataRoot).href)}">${escape(stamp(e.updatedAt))} · saved record ${escape(e.version.slice(0,8))}</a></li>`).join('')}</ul><p>Earlier snapshots remain unchanged. JSON records contain published picks, reviewed lines, saved estimates, and statistical outcomes.</p></details>`:'';}
    function renderEdition(body){
      activeBody=body;ryKeys=favoriteKeys(body);board.beginDate(body.date);
      if(kind==='daily')return renderDailyEdition(body);
      const {ry,value_safe,high_probability_aggressive,research}=editionGroups(body),picks=allPicks(body),settled=picks.length>0&&summary(picks).pending===0&&!picks.some(p=>p.result?.eventStatus==='live');
      const jumps=[['all-picks-section','All Picks',picks.length],['value_safe-section','Layups',value_safe.length],['high_probability_aggressive-section','Lobs',high_probability_aggressive.length],...(ry.length?[['ry-parlays','Ry’s Picks (optional)',ry.length]]:[])];
      return `${results.testSlateNotice(body.date)}<div class="edition-panel"><div class="edition-heading"><div><p class="sbos-kicker">${body.channel==='sunday'?'SUNDAY EDITION':'DAILY BOARD'}</p><h2>${dateLabel(body.date)}</h2></div><span class="edition-status">${settled?'Final results':'Published picks'}</span></div><nav class="pick-jumps" aria-label="Pick sections">${jumps.map(([id,label,count])=>`<a href="#${id}" data-pick-jump="${id}">${label} <strong>${count}</strong></a>`).join('')}</nav><details class="model-policy edition-record"><summary>About this board · updated ${escape(stamp(body.updatedAt))}</summary><p class="publication-note">${escape(body.priceNote)}<br>First published: ${escape(stamp(body.firstPublishedAt))}. Source record timestamp: ${escape(stamp(body.recordedAt))}. Last saved update: ${escape(stamp(body.updatedAt))}. Win estimates remain provisional unless marked validated. MP means minutes played.</p></details>${allPickGroup(body)}${group('Layups',value_safe,'value_safe')}${group('Lobs',high_probability_aggressive,'high_probability_aggressive')}${ry.length?group((body.sharedBetslipUrl||body.sharedBetslipOdds)?'Ry’s posted parlay (optional)':'Ry’s posted picks (optional)',ry,'ry',false,favoritesNotice(body)+'<p class="board-intro">Ry’s personal selections, preserved as posted. Matching props carry a ★ Ry’s Favorite badge throughout the board. Historical personal legs outside our featured categories stay here.</p>'):''}${researchGroup(research)}<p class="daily-caption">All Picks contains our selected Layups and Lobs props. SBOS Research also includes lines we passed on. Category names and win estimates do not guarantee results or establish profitability. Hit rates include reached live overs and exclude pending picks, pushes and DNPs. Live stats can be corrected. Multiple lines for a player can share the same underlying result.</p><a class="sbos-text-link" href="${link('guide/')}">How our picks & results work ↗</a>${versionHistory(body)}</div>`;
    }
    function archiveCard(e){return `<a class="archive-card" href="${e.channel==='sunday'?weeklyURL(e.date):dailyURL(e.date)}"><span class="sbos-kicker">${e.channel==='sunday'?'SUNDAY EDITION':'DAILY RESEARCH'}</span><h3>${dateLabel(e.date)}</h3>${results.isTestSlate(e.date)?'<span class="test-slate-badge">Test slate · excluded from cumulative totals</span>':''}<p>${e.count} of Ry’s picks · ${e.researchCount} reviewed lines.</p><span class="archive-link">Picks & recorded outcomes ↗</span></a>`;}
    async function showDaily(day){
      const serial=++request,entry=entries.find(e=>e.channel==='daily'&&e.date===day);if(!entry)throw Error('No published date');
      const body=await loadEdition(entry,true);if(serial!==request)return;
      pickState=readPickState(location.search);
      if(!new URL(location.href).searchParams.has('type')){const legacy={'#value_safe-section':'value_safe','#high_probability_aggressive-section':'high_probability_aggressive'}[location.hash];if(legacy)pickState.type=legacy;}
      $('daily-content').innerHTML=renderEdition(body);syncDailyControls();
      $('slate-context').textContent=`${day<etDay()?'Archived':day>etDay()?'Upcoming':'Current'} board · saved prices and dated estimates.`;board.refresh();
    }
    async function showSupporting(day){
      const serial=++request,entry=entries.find(e=>e.channel==='daily'&&e.date===day);if(!entry)throw Error('No published date');
      const body=await loadEdition(entry,kind==='parlays');if(serial!==request)return;
      activeBody=body;ryKeys=favoriteKeys(body);board.beginDate(body.date);
      const params=new URL(location.href).searchParams,back=link('daily/?'+pickSearch(day,readPickState(params.get('board')||''))),ry=editionGroups(body).ry;
      const heading=`<div class="edition-heading"><div><p class="sbos-kicker">${kind==='research'?'REVIEWED LINES':'RY’S PERSONAL SELECTIONS'}</p><h2>${dateLabel(day)}</h2></div><a class="back-to-board" href="${escape(back)}">← Back to Daily Board</a></div>`;
      $('daily-content').innerHTML=`<div class="edition-panel supporting-edition">${heading}${results.testSlateNotice(body.date)}${kind==='research'?researchGroup(editionGroups(body).research,true):ry.length?`<p class="board-intro">Ry’s choices, with our provisional win estimates and projections. Personal picks can fall outside the algorithm’s selection rules; expand each row for the model basis and limitations.</p>${favoritesNotice(body)}${recordSummary(ry,'ry')}${pickList(ry,'ry')}`:'<p class="pick-empty">Ry has not posted a personal parlay or picks for this date. Explore our selections on Daily Board.</p>'}<p class="daily-caption">${kind==='research'?'Reviewed lines include Not a Pick records and are not all recommendations. ':''}Win estimates remain provisional. Statistical results do not verify sportsbook settlement.</p>${versionHistory(body)}</div>`;
      $('slate-context').textContent=`${kind==='research'?entry.researchCount+' reviewed lines':'Ry’s posted picks'} · saved prices and dated estimates.`;board.refresh();
    }
    try{
      const index=await loadJSON(new URL('manifest.json',dataRoot));if(index.schemaVersion!=='public-1'||!Array.isArray(index.editions))throw Error('Unsupported publications');allVersions=index.editions;entries=latestEntries(index.editions);
      const sundays=entries.filter(e=>e.channel==='sunday'),daily=entries.filter(e=>e.channel==='daily');
      if(kind==='home')$('home-current').innerHTML=`${sundays[0]?`<a class="preview-entry" href="${link('sundays/')}"><span>SUNDAY EDITION / ${dateLabel(sundays[0].date)}</span><strong>Sunday Edition <em>Explore the board ↗</em></strong></a>`:''}${daily[0]?`<a class="preview-entry" href="${dailyURL(daily[0].date)}"><span>DAILY RESEARCH / ${dateLabel(daily[0].date)}</span><strong>Daily Board <em>Explore selections ↗</em></strong></a><details class="home-personal-view"><summary>Ry’s Picks · optional personal view</summary><a class="preview-entry" href="${link('daily/parlays/?date='+daily[0].date)}"><strong>Ry’s personal selections <em>View picks & parlays ↗</em></strong></a></details>`:''}`;
      if(kind==='archives'){$('sunday-archive').innerHTML=sundays.map(archiveCard).join('')||'<p>No Sunday editions yet.</p>';$('daily-archive').innerHTML=daily.map(archiveCard).join('')||'<p>No daily editions yet.</p>';}
      if(kind==='sundays'){if($('next-sunday-date'))$('next-sunday-date').textContent=dateLabel(nextSunday());$('sunday-current').innerHTML=sundays[0]?renderEdition(await loadEdition(sundays[0])):'<p>No Sunday edition published yet.</p>';board.refresh();}
      if(kind==='sunday-personal'){
        const select=$('sunday-personal-date');select.innerHTML=sundays.map(e=>`<option value="${e.date}">${dateLabel(e.date)}</option>`).join('');
        async function showPersonalSunday(day){const entry=sundays.find(e=>e.date===day);if(!entry){$('sunday-current').textContent='No saved Sunday edition for this date.';return;}const body=await loadEdition(entry);activeBody=body;ryKeys=favoriteKeys(body);board.beginDate(day);$('sunday-current').innerHTML=personalSundayContent(body);board.refresh();}
        const day=new URL(location.href).searchParams.get('date')||sundays[0]?.date;if(day){select.value=day;await showPersonalSunday(day);}else $('sunday-current').textContent='No saved Sunday personal selections yet.';
        select.addEventListener('change',()=>{history.replaceState(null,'','?date='+encodeURIComponent(select.value));showPersonalSunday(select.value).catch(showError);});
      }
      if(kind==='week'){const day=document.body.dataset.date||new URL(location.href).searchParams.get('date'),e=sundays.find(e=>e.date===day);if(e){$('week-title').textContent=dateLabel(e.date)+'.';$('week-content').innerHTML=renderEdition(await loadEdition(e));board.refresh();}else $('week-content').textContent='No published Sunday edition for that date. Choose an edition in Results.';}
      if(['daily','research','parlays'].includes(kind)){
        const select=$('slate-date');select.innerHTML=daily.map(e=>`<option value="${e.date}">${dateLabel(e.date)}${results.isTestSlate(e.date)?' · Test slate':''}</option>`).join('');select.disabled=!daily.length;
        const requested=new URL(location.href).searchParams.get('date'),show=kind==='daily'?showDaily:showSupporting;
        if(requested&&!daily.some(e=>e.date===requested)){$('daily-content').textContent='No published board for this date. Choose an available date above.';$('slate-context').textContent='Requested board unavailable.';}
        else if(daily.length){select.value=requested||daily[0].date;await show(select.value);}
        else $('daily-content').textContent='No daily research published yet.';
        select.addEventListener('change',()=>{history.replaceState(null,'','?date='+encodeURIComponent(select.value));show(select.value).catch(showError);});
        $('reload-data').addEventListener('click',()=>location.reload());
      }
    }catch{showError();}
    function showError(){const id={daily:'daily-content',research:'daily-content',parlays:'daily-content',home:'home-current',sundays:'sunday-current','sunday-personal':'sunday-current',week:'week-content',archives:'sunday-archive'}[kind];if(id&&$(id))$(id).innerHTML='<p class="site-error" role="alert">The publication record is unavailable. Refresh to try again.</p>';}
  }
  return {latestEstimate,confidenceDetails,init,validDate,dateLabel,etDay,nextSunday,lineLabel,latestEntries,summary,safeEditionURL,publishedCategory,editionGroups,researchPage,favoritesNotice,pricedPick,gameKey,favoriteKey,favoriteKeys,isFavorite,allPicks,honorableMentions,dailyRows,sortPicks,filterPicks,gameGroups,readPickState,pickSearch,tabCounts};
});
