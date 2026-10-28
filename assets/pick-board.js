(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./math.js'):root.STARS_MATH,typeof module==='object'&&module.exports?require('./result-utils.js'):root.STARS_RESULT_UTILS);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SBOS_PICK_BOARD=api;
})(typeof window!=='undefined'?window:this,function(math,contracts){
  'use strict';
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const odds=v=>math.decimalOdds(v)===null?'—':math.formatOdds(v);
  const stamp=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value)):'Time unavailable';
  const identity=row=>JSON.stringify([row.date,row.canonicalEventId||row.eventId,row.playerId]);
  const slot=row=>JSON.stringify([row.date,row.canonicalEventId||row.eventId,row.playerId||row.id,contracts.normalizeContract(row)?.market,row.period||'full_game']);
  const sameOutcome=(a,b)=>JSON.stringify(contracts.normalizeContract(a))===JSON.stringify(contracts.normalizeContract(b));
  function parseMinutes(value){
    if(typeof value==='string'&&/^\d+:[0-5]\d$/.test(value)){const [m,s]=value.split(':').map(Number);return m+s/60<=1440?m+s/60:null;}
    return (typeof value==='number'||typeof value==='string'&&/^\d+(\.\d+)?$/.test(value))&&finite(Number(value))&&Number(value)>=0&&Number(value)<=1440?Number(value):null;
  }
  function minutesLabel(value){if(!finite(value)||value<0)return '—';const seconds=Math.round(value*60);return seconds%60?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:String(seconds/60);}
  function estimateDisplay(estimate){
    const win=estimate?.winProbability,projection=estimate?.projection;
    const hasWin=finite(win)&&win>=0&&win<=1,hasProjection=finite(projection)&&projection>=0;
    return {available:hasWin||hasProjection,win:hasWin?`${(win*100).toFixed(1)}%`:'—',projection:hasProjection?projection.toFixed(1):'—',status:estimate?.status==='validated'?'Validated':'Provisional'};
  }
  function addLeg(legs,row){
    if(!contracts.normalizeContract(row)||math.decimalOdds(row.americanOdds)===null)return {legs,action:'unpriced'};
    const index=legs.findIndex(p=>slot(p)===slot(row));
    if(index>=0&&sameOutcome(legs[index],row))return {legs:legs.filter((_,i)=>i!==index),action:'removed'};
    const next=[...legs];if(index>=0)next[index]={...row};else next.push({...row});
    return {legs:next,action:index>=0?'replaced':'added'};
  }
  function calculate(legs,stake){
    const prices=legs.map(p=>math.decimalOdds(p.americanOdds));
    const decimal=legs.length&&prices.every(p=>p!==null)?prices.reduce((a,b)=>a*b,1):null;
    const validStake=finite(stake)&&stake>0&&stake<=1000000;
    const keys=legs.filter(row=>row.canonicalEventId||row.eventId||row.game).map(row=>row.game?.trim().toLowerCase()||JSON.stringify([row.date,row.canonicalEventId||row.eventId]));
    const players=legs.filter(row=>row.playerId&&!row.manual).map(row=>JSON.stringify([row.date,row.playerId]));
    const correlated=new Set(keys).size<keys.length||new Set(players).size<players.length;
    return {decimal,american:decimal&&Number.isFinite(decimal)?math.americanOdds(decimal):null,returnAmount:validStake&&decimal?stake*decimal:null,profit:validStake&&decimal?stake*(decimal-1):null,correlated};
  }
  function rowStatus(row){
    const r=row.result||{},final=r.eventStatus==='final';
    const unit={PTS:'pts',AST:'ast',REB:'reb','3PM':r.actual===1?'three':'threes',PRA:'total',PR:'total',PA:'total',RA:'total'}[row.market]||row.market||'';
    const actual=finite(r.actual)?`${r.actual} ${unit}`:'—';
    if(final&&r.statisticalOutcome==='win')return {tone:'hit',icon:'✓',label:'Hit',actual};
    if(final&&r.statisticalOutcome==='loss')return {tone:'miss',icon:'✕',label:'Miss',actual};
    if(final&&r.statisticalOutcome==='push')return {tone:'neutral',icon:'↔',label:'Push',actual};
    if(['dnp','canceled','postponed'].includes(r.statisticalOutcome))return {tone:'neutral',icon:'—',label:{dnp:'DNP',canceled:'Canceled',postponed:'Postponed'}[r.statisticalOutcome],actual:'—'};
    if(r.eventStatus==='live')return {tone:'live',icon:'●',label:'Live',actual};
    if(final)return {tone:'neutral',icon:'—',label:'Stats unavailable',actual};
    const start=row.startTime||row.providerStartTime;
    return {tone:'neutral',icon:'',label:start&&Date.parse(start)>Date.now()?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}).format(new Date(start)):'Pending',actual:'—'};
  }
  function parseSummary(body,source,row,now){
    if(!/^\d+$/.test(source.eventId)||!/^\d+$/.test(source.athleteId)||String(body.header?.id)!==source.eventId||body.header?.competitions?.length!==1)throw Error('Box score identity mismatch');
    const status=body.header.competitions[0].status?.type||{},name=String(status.name||'');
    const eventStatus=/CANCEL/i.test(name)?'canceled':/POSTPON/i.test(name)?'postponed':status.completed?'final':status.state==='in'?'live':'scheduled';
    const matches=[];
    for(const team of body.boxscore?.players||[]){
      if(source.expectedTeam&&team.team?.displayName!==source.expectedTeam)continue;
      for(const group of team.statistics||[])for(const athlete of group.athletes||[])if(String(athlete.athlete?.id)===source.athleteId)matches.push({athlete,raw:Object.fromEntries((group.labels||[]).map((label,i)=>[label,athlete.stats?.[i]]))});
    }
    const stats={};
    if(matches.length===1){
      for(const key of ['PTS','REB','AST'])if(/^\d+$/.test(String(matches[0].raw[key]??'')))stats[key]=Number(matches[0].raw[key]);
      if(/^\d+-\d+$/.test(String(matches[0].raw['3PT']??'')))stats['3PM']=Number(matches[0].raw['3PT'].split('-')[0]);
    }
    const dnp=eventStatus==='final'&&matches.length===1&&matches[0].athlete.didNotPlay===true;
    const result=contracts.evaluateStructured(row,{eventStatus,stats,didNotPlay:dnp,checkedAt:now,source:`https://www.espn.com/nba/boxscore/_/gameId/${source.eventId}`,sportsbookSettlement:'unverified'});
    const minutes=matches.length===1?parseMinutes(matches[0].raw.MIN):null;
    if(minutes!==null||dnp)result.minutesPlayed=minutes??0;
    return result;
  }
  function mergeResult(previous,next){
    const resolved=new Set(['win','loss','push','dnp','canceled']);
    if(previous?.eventStatus==='final'&&(next.eventStatus!=='final'||resolved.has(previous.statisticalOutcome)&&!resolved.has(next.statisticalOutcome)))return previous;
    if(previous?.eventStatus==='final'&&next.eventStatus==='final'&&previous.actual===next.actual&&previous.statisticalOutcome===next.statisticalOutcome&&finite(previous.minutesPlayed)&&!finite(next.minutesPlayed))return {...next,minutesPlayed:previous.minutesPlayed};
    return next;
  }
  function create({base,lineLabel,onResults=()=>{}}){
    let records=new Map(),legs=[],serial=0,currentDate=null,busy=false,pendingRefresh=false,targets=new Map(),cache=new Map(),lastCheck=null;
    const opened=new Set(),byId=id=>document.getElementById(id);
    const statusHTML=row=>{const s=rowStatus(row);return `<span class="row-status ${s.tone}"><strong><span aria-hidden="true">${s.icon}</span> ${escape(s.label)}</strong><small>${escape(s.actual)}<span class="row-mobile-minutes"> · MP ${escape(minutesLabel(row.result?.minutesPlayed))}</span></small></span>`;};
    const dialog=document.createElement('dialog');dialog.className='parlay-dialog';dialog.id='your-parlay';dialog.setAttribute('aria-labelledby','parlay-title');
    dialog.innerHTML='<div class="parlay-top"><div><span class="sbos-kicker">YOUR PICKS / YOUR COMBINATION</span><h2 id="parlay-title">Your parlay calculator</h2></div><button type="button" data-close-parlay aria-label="Close calculator">✕</button></div><p class="parlay-caption">Saved prices · illustrative combined odds. Check current sportsbook terms.</p><div id="parlay-empty">Add a pick from any row to start your combination.</div><ul id="parlay-legs"></ul><div class="parlay-math"><div><span>Illustrative odds</span><strong id="parlay-odds">—</strong></div><label>Stake ($)<input id="parlay-stake" type="number" min="0.01" max="1000000" step="0.01" placeholder="10.00" inputmode="decimal"></label><div><span>Potential return</span><strong id="parlay-return">—</strong></div><div><span>Potential net profit</span><strong id="parlay-profit">—</strong></div></div><p id="parlay-correlation" class="parlay-caption" hidden>Same-game or same-player legs are correlated. The sportsbook’s combined price may differ from this calculation.</p><p class="parlay-caption">One line per player and stat in each game. Adding a different line replaces your earlier choice. Statistical results do not verify sportsbook settlement.</p><button type="button" id="parlay-clear" class="outline-button">Clear your picks</button>';
    document.body.append(dialog);
    const launcher=document.createElement('button');launcher.type='button';launcher.className='parlay-launcher';launcher.setAttribute('aria-haspopup','dialog');launcher.innerHTML='<span>Your parlay <strong id="parlay-count">0</strong></span><span id="parlay-launch-odds">Add picks to start</span><span>Open calculator ↗</span>';document.body.append(launcher);document.body.classList.add('has-pick-calculator');
    const rrMount=document.createElement('div');dialog.append(rrMount);const rr=window.SBOS_ROUND_ROBIN?.create(rrMount,()=>legs,{label:row=>row.player+' '+lineLabel(row)});const fullLink=document.createElement('a');fullLink.className='parlay-tools-link';fullLink.textContent='Add your own picks / full calculator ↗';dialog.append(fullLink);
    const liveNote=document.querySelector('[data-live-note]');
    const cartKey=day=>'sbos-parlay:'+day;
    function saveCart(){if(!currentDate)return;try{const fields=['id','date','canonicalEventId','eventId','playerId','player','market','operator','line','side','period','americanOdds','book','startTime'];sessionStorage.setItem(cartKey(currentDate),JSON.stringify(legs.map(row=>Object.fromEntries(fields.filter(k=>row[k]!==undefined).map(k=>[k,row[k]])))));}catch{}}
    function show(){renderCalculator();dialog.showModal();}
    launcher.addEventListener('click',show);
    dialog.querySelector('[data-close-parlay]').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>launcher.focus({preventScroll:true}));
    dialog.addEventListener('click',e=>{if(e.target===dialog){const rect=dialog.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)dialog.close();}});
    function renderCalculator(){
      saveCart();rr?.update();fullLink.href=new URL('calculator/?'+new URLSearchParams({date:currentDate||'',import:'board'}),base).href;
      const r=calculate(legs,Number(byId('parlay-stake').value));
      const money=v=>finite(v)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v):'—';
      byId('parlay-count').textContent=legs.length;
      byId('parlay-launch-odds').textContent=legs.length?`${odds(r.american)} illustrative odds`:'Add picks to start';
      byId('parlay-odds').textContent=odds(r.american);byId('parlay-return').textContent=money(r.returnAmount);byId('parlay-profit').textContent=money(r.profit);
      byId('parlay-empty').hidden=legs.length>0;byId('parlay-clear').disabled=!legs.length;byId('parlay-correlation').hidden=!r.correlated;
      byId('parlay-legs').innerHTML=legs.map((row,i)=>`<li><div><strong>${escape(row.player)}</strong><span>${escape(lineLabel(row))} · ${escape(odds(row.americanOdds))}</span></div><button type="button" data-remove-leg="${i}" aria-label="Remove ${escape(row.player)} ${escape(lineLabel(row))}">✕</button></li>`).join('');
      for(const [token,row] of records){const button=document.querySelector(`[data-add-pick="${token}"]`);if(!button)continue;const active=legs.some(p=>slot(p)===slot(row)&&sameOutcome(p,row));button.setAttribute('aria-pressed',String(active));button.textContent=active?'✓':'+';button.setAttribute('aria-label',`${active?'Remove':'Add'} ${row.player} ${lineLabel(row)} ${active?'from':'to'} your parlay calculator`);}
    }
    byId('parlay-stake').addEventListener('input',renderCalculator);
    byId('parlay-clear').addEventListener('click',()=>{legs=[];renderCalculator();});
    dialog.addEventListener('click',e=>{const button=e.target.closest('[data-remove-leg]');if(button){const index=Number(button.dataset.removeLeg);legs.splice(index,1);renderCalculator();(byId('parlay-legs').querySelector('button')||byId('parlay-clear')).focus();}});
    document.addEventListener('click',event=>{
      const add=event.target.closest('[data-add-pick]'),expand=event.target.closest('[data-expand-pick]');
      if(add){const row=records.get(add.dataset.addPick);if(!row)return;const update=addLeg(legs,row);legs=update.legs;renderCalculator();const note=byId('pick-action-status');if(note)note.textContent=update.action==='replaced'?`Replaced your earlier ${row.player} ${row.market} line.`:`${row.player} ${update.action==='removed'?'removed from':'added to'} your parlay.`;}
      if(expand){const panel=byId(expand.getAttribute('aria-controls')),key=expand.dataset.expandPick;if(!panel)return;panel.hidden=!panel.hidden;expand.setAttribute('aria-expanded',String(!panel.hidden));panel.hidden?opened.delete(key):opened.add(key);}
    });
    function renderRow(row,{scope='picks',detail='',personal=false,typeLabel='',context='',warning='',gameLogURL=null}={}){
      const token=String(++serial),key=scope+':'+row.id,panel='pick-detail-'+token;
      records.set(token,row);
      const selected=legs.some(p=>slot(p)===slot(row)&&sameOutcome(p,row)),priced=math.decimalOdds(row.americanOdds)!==null;
      const canAdd=priced&&!!contracts.normalizeContract(row);
      const update=row.confidenceUpdate,estimate=estimateDisplay(update?update.estimate:row.estimate),original=estimateDisplay(row.estimate);
      const estimateHTML=`<span class="row-estimate" title="${estimate.status} win estimate. Expand the pick for projection and research."><small class="mobile-cell-label">Win est.</small><strong>${estimate.win}</strong>${update&&original.win!==estimate.win?`<small class="row-original-estimate">Was ${original.win}</small>`:''}</span>`;
      const book={fanduel:'FanDuel',draftkings:'DraftKings'}[String(row.book).toLowerCase()]||row.book||'Book unavailable';
      const updateLabels={supported:'Updated',reduced:'Confidence lower',improved:'Confidence higher',review:'Review update',unavailable:'Update unavailable'};
      const updateBadge=update?`<span class="pick-update-badge update-${escape(update.status)}" title="${escape(update.summary+' Checked '+stamp(update.checkedAt))}">${update.qualification==='does_not_qualify'?'No longer qualifies':update.qualification==='unavailable'?'Price unavailable':update.status==='review'?'Line review':updateLabels[update.status]||'Updated'}</span>`:'';
      const badges=`${updateBadge}${typeLabel?`<span class="pick-type-badge">${escape(typeLabel)}</span>`:''}${personal?'<span class="ry-favorite-badge"><span aria-hidden="true">★</span> Ry’s Favorite</span>':''}${warning?`<span class="pick-warning-badge" title="${escape(warning)}">Price check</span>`:''}`;
      return `<article class="pick-row${personal?' ry-pick-row':''}" data-pick-row="${token}" data-pick-id="${escape(row.id)}"><div class="pick-row-main"><button type="button" class="pick-expand" data-expand-pick="${escape(key)}" aria-expanded="${opened.has(key)}" aria-controls="${panel}"><span class="row-chevron" aria-hidden="true">›</span><span class="row-pick"><span class="row-player"><strong>${escape(row.player)}</strong>${badges}</span><span>${escape(lineLabel(row))} <small>· ${escape(book)}</small></span>${context?`<small class="row-game-context">${escape(context)}</small>`:''}</span></button><span class="row-price"><small class="mobile-cell-label">Price</small><strong>${escape(odds(row.americanOdds))}</strong></span>${estimateHTML}${gameLogURL?`<a class="row-log-link" href="${escape(gameLogURL)}" aria-label="View ${escape(row.player)} player profile for ${escape(lineLabel(row))}">Profile ↗</a>`:''}<span class="row-minutes" data-row-minutes title="Minutes played">${escape(minutesLabel(row.result?.minutesPlayed))}</span><span class="row-result" data-row-result>${statusHTML(row)}</span><button type="button" class="pick-add" data-add-pick="${token}" aria-pressed="${selected}" aria-label="${selected?'Remove':'Add'} ${escape(row.player)} ${escape(lineLabel(row))} ${selected?'from':'to'} your parlay calculator" ${canAdd?'':'disabled title="A saved price and exact line are required"'}>${selected?'✓':'+'}</button></div><div id="${panel}" class="pick-row-detail" ${opened.has(key)?'':'hidden'}>${detail}<p class="row-result-source" data-row-result-source>${resultSource(row)}</p></div></article>`;
    }
    function resultSource(row){const r=row.result;if(!r)return 'Results will appear when verified box-score stats are available.';const link=/^https:\/\/www\.espn\.com\/nba\/boxscore\/_\/gameId\/\d+$/.test(r.source||'')?`<a href="${escape(r.source)}" target="_blank" rel="noopener noreferrer">Box score ↗</a> · `:'';return `${link}Stats checked ${escape(stamp(r.checkedAt))}. Sportsbook settlement unverified.`;}
    function beginDate(day){if(day!==currentDate){saveCart();currentDate=day;records.clear();legs=[];try{const saved=JSON.parse(sessionStorage.getItem(cartKey(day))||'[]');if(Array.isArray(saved))legs=saved.filter(row=>row.date===day&&typeof row.player==='string'&&contracts.normalizeContract(row)&&math.decimalOdds(row.americanOdds)!==null).slice(0,50);}catch{}opened.clear();renderCalculator();}}
    function sourceFor(row){
      const own=row.resultSource,target=targets.get(identity(row));
      const source=own||target&&{eventId:target.espnEventId,athleteId:target.espnAthleteId,expectedTeam:target.expectedTeam};
      return source&&/^\d+$/.test(source.eventId)&&/^\d+$/.test(source.athleteId)?source:null;
    }
    async function poll(force=false){
      if(document.hidden)return;if(busy){pendingRefresh=true;return;}busy=true;let failures=0,checked=0;
      const current=[...records].filter(([token])=>document.querySelector(`[data-pick-row="${token}"]`));records=new Map(current);
      const events=new Map();for(const [,row] of current){const source=sourceFor(row),start=Date.parse(row.startTime||row.providerStartTime||'');if(start>Date.now()+300000)continue;if(source&&!events.has(source.eventId)&&events.size<16)events.set(source.eventId,source);}
      for(const [id] of events){
        const known=cache.get(id);if(known&&!force&&(known.final||Date.now()-known.at<55000))continue;
        try{const response=await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Stats unavailable');const body=await response.json();if(String(body.header?.id)!==id)throw Error('Stats mismatch');cache.set(id,{body,at:Date.now(),checkedAt:new Date().toISOString(),final:body.header?.competitions?.[0]?.status?.type?.completed===true});checked++;}catch{failures++;}
      }
      for(const [token,row] of current){const source=sourceFor(row),record=source&&cache.get(source.eventId);if(!record)continue;try{row.result=mergeResult(row.result,parseSummary(record.body,source,row,record.checkedAt));const node=document.querySelector(`[data-pick-row="${token}"]`);if(!node)continue;node.querySelector('[data-row-result]').innerHTML=statusHTML(row);node.querySelector('[data-row-minutes]').textContent=minutesLabel(row.result?.minutesPlayed);node.querySelector('[data-row-result-source]').innerHTML=resultSource(row);}catch{failures++;}}
      onResults(current.map(([,row])=>row));
      if(checked)lastCheck=new Date().toISOString();if(liveNote)liveNote.textContent=failures?'Live source unavailable for some games; latest known stats stay visible.':lastCheck?`Stats checked ${stamp(lastCheck)} · live games refresh every minute while this page is open.`:'Waiting for verified box-score stats.';
      busy=false;
      if(pendingRefresh){pendingRefresh=false;poll();}
    }
    async function loadTargets(){try{const response=await fetch(new URL('data/stat-targets.json',base),{cache:'no-store',credentials:'omit'});if(!response.ok)return;const body=await response.json();if(body.schemaVersion!=='public-1'||!Array.isArray(body.targets))return;for(const t of body.targets)if(/^\d+$/.test(t.espnEventId)&&/^\d+$/.test(t.espnAthleteId))targets.set(identity(t),t);}catch{} }
    const ready=loadTargets();
    const interval=setInterval(()=>poll(),60000);window.addEventListener('pagehide',()=>clearInterval(interval),{once:true});document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
    return {renderRow,beginDate,showCalculator:show,refresh:async(force=false)=>{await ready;renderCalculator();return poll(force);}};
  }
  const columns=()=>'<div class="pick-columns" aria-hidden="true"><span>Player / pick</span><span>Price</span><span>Our win est.</span><span title="Minutes played">MP</span><span>Live / result</span><span>Add</span></div>';
  return {create,columns,rowStatus,parseSummary,mergeResult,addLeg,calculate,identity,slot,estimateDisplay,parseMinutes,minutesLabel};
});
