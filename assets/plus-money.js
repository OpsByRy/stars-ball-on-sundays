/* Presentation of frozen, reviewed parlays. Filters never generate selections. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.SBOS_PLUS_MONEY=api;document.addEventListener('DOMContentLoaded',()=>api.init());}})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const prices=typeof window==='undefined'?require('./book-prices.js'):window.SBOS_BOOK_PRICES;
  const board=typeof window==='undefined'?require('./pick-board.js'):window.SBOS_PICK_BOARD;
  const results=typeof window==='undefined'?require('./result-utils.js'):window.STARS_RESULT_UTILS;
  const routes=typeof window==='undefined'?require('./routes.js'):window.SBOS_ROUTES;
  const units=typeof window==='undefined'?require('./unit-tracker.js'):window.SBOS_UNITS;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const odds=value=>finite(value)?(value>0?'+':'')+value:'—';
  const bookName=value=>({fanduel:'FanDuel',draftkings:'DraftKings',mixed:'Mixed price sources'}[value]||value);
  const markets={PTS:'points',AST:'assists',REB:'rebounds','3PM':'threes',PRA:'points + rebounds + assists',PA:'points + assists',PR:'points + rebounds',RA:'rebounds + assists',BLK:'blocks',STL:'steals'};
  const titles={all:'All Parlays',plus_money:'Plus Money',same_game:'Same Game Parlays',longshots:'Longshots'};
  const coverageNames={both:'Both sportsbooks',fanduel:'FanDuel Exclusive Lines',draftkings:'DraftKings Exclusive Lines',mixed:'Mixed-Source Ideas'};
  const sorts=['reviewed','probability_desc','probability_asc','price_desc','price_asc','legs_asc','legs_desc','game'];
  const defaults={type:'all',query:'',minimum:0,minPrice:0,favorite:false,coverage:'all',legs:'all',market:'all',game:'all',team:'all',sort:'reviewed'};
  const section=t=>t.section||'plus_money';
  const ticketOrdinal=(tickets,ticket)=>tickets.filter(t=>section(t)===section(ticket)).findIndex(t=>t.id===ticket.id)+1;
  const asAmerican=decimal=>finite(decimal)&&decimal>1?Math.round(decimal>=2?(decimal-1)*100:-100/(decimal-1)):null;
  const effectiveOdds=t=>results.parlayLegs(t).voided.length?asAmerican(results.parlayDecimal(t)):t.indicativeAmericanOdds;
  const isFavorite=t=>t.ryFavorite===true;
  const eventId=r=>r.canonicalEventId||r.eventId;
  const gameIdentity=row=>typeof row.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.date)&&typeof eventId(row)==='string'&&eventId(row).trim()?JSON.stringify([row.date,eventId(row)]):null;
  // This is an overlapping view of original tickets, not a new payout tier.
  function isSameGame(ticket){const identities=(ticket.legs||[]).map(gameIdentity);return identities.length>1&&identities.every(Boolean)&&new Set(identities).size<identities.length;}
  function categoryTickets(tickets,type='all'){const seen=new Set();return tickets.filter(t=>{if(t.id&&seen.has(t.id))return false;if(t.id)seen.add(t.id);return type==='all'||(type==='same_game'?isSameGame(t):section(t)===type);});}
  const estimate=r=>r.confidenceUpdate?r.confidenceUpdate.estimate:r.estimate;
  const probability=r=>{const p=estimate(r)?.winProbability;return finite(p)&&p>=0&&p<=1?p:null;};
  function lowestProbability(ticket){const values=results.parlayLegs(ticket).active.map(probability);return values.length&&values.every(finite)?Math.min(...values):null;}
  const percent=p=>finite(p)?(p*100).toFixed(1)+'%':'—';
  const label=r=>{
    const native=r.operator==='>='&&(r.market==='3PM'||r.market==='PTS'&&[5,10,15,20,25,30,35].includes(r.line)||['REB','AST'].includes(r.market)&&[4,6,8,10].includes(r.line)||['PRA','PA','PR','RA'].includes(r.market)&&r.line>=10&&r.line%5===0);
    return `${native?r.line+'+':r.operator==='>='?'Alt O'+(Math.ceil(r.line)-.5):r.operator==='<='?'Alt U'+(Math.floor(r.line)+.5):(r.operator==='>'?'Over ':'Under ')+r.line} ${markets[r.market]||r.market}`;
  };
  const stamp=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'Time unavailable';
  function safePath(entry){if(!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)||!Number.isFinite(Date.parse(entry.date))||!/^[a-f0-9]{16}$/.test(entry.version)||entry.path!==`${entry.date}/${entry.version}.json`)throw Error('Invalid parlay publication path');return entry.path;}
  function readState(search='',hash=''){
    const p=new URLSearchParams(search),minimum=Number(p.get('minimum')),minPrice=Number(p.get('minPrice'));
    return {...defaults,type:routes.parlayType(search,hash),query:(p.get('query')||'').slice(0,120),
      minimum:Number.isFinite(minimum)&&minimum>=0&&minimum<=100?minimum:0,minPrice:Number.isFinite(minPrice)&&minPrice>=100&&minPrice<=1000000?minPrice:0,
      favorite:p.get('favorite')==='1',coverage:Object.hasOwn(coverageNames,p.get('coverage'))?p.get('coverage'):'all',
      legs:/^[2-6]$/.test(p.get('legs'))?p.get('legs'):'all',market:Object.hasOwn(markets,p.get('market'))?p.get('market'):'all',
      game:(p.get('game')||'all').slice(0,100),team:(p.get('team')||'all').slice(0,100),sort:sorts.includes(p.get('sort'))?p.get('sort'):'reviewed'};
  }
  function stateQuery(state,date){const p=new URLSearchParams();if(date)p.set('date',date);for(const [key,value] of Object.entries(defaults))if(state[key]!==value)p.set(key,key==='favorite'?'1':String(state[key]));return p.toString();}
  function tabCounts(tickets){const unique=categoryTickets(tickets);return {all:unique.length,plus_money:categoryTickets(unique,'plus_money').length,same_game:categoryTickets(unique,'same_game').length,longshots:categoryTickets(unique,'longshots').length,favorites:unique.filter(isFavorite).length};}
  function pricedTicket(ticket,preferred=prices.getPreferredBook()){
    const legs=ticket.legs.map(r=>prices.pricedPick(r,preferred));
    const decimal=legs.length&&legs.every(r=>finite(r.americanOdds)&&Math.abs(r.americanOdds)>=100)?legs.reduce((d,r)=>d*(1+(r.americanOdds>0?r.americanOdds/100:100/Math.abs(r.americanOdds))),1):null;
    const books=new Set(legs.map(r=>r.book));
    return {...ticket,legs,book:books.size===1?legs[0].book:'mixed',indicativeAmericanOdds:decimal?Math.round(decimal>=2?(decimal-1)*100:-100/(decimal-1)):null,sourceCoverage:prices.coverage(ticket)};
  }
  function filterTickets(tickets,state){
    const query=state.query.trim().toLocaleLowerCase();
    const rows=categoryTickets(tickets,state.type).filter(t=>{
      const low=lowestProbability(t);
      return (!state.favorite||isFavorite(t))&&
        (!query||t.legs.some(r=>[r.player,r.team,r.opponent,label(r)].join(' ').toLocaleLowerCase().includes(query)))&&
        (!state.minimum||low!==null&&low*100>=state.minimum)&&(!state.minPrice||finite(effectiveOdds(t))&&effectiveOdds(t)>=state.minPrice)&&
        (state.coverage==='all'||(t.sourceCoverage||prices.coverage(t))===state.coverage)&&
        (state.legs==='all'||t.legs.length===Number(state.legs))&&(state.market==='all'||t.legs.some(r=>r.market===state.market))&&
        (state.game==='all'||t.legs.some(r=>eventId(r)===state.game))&&(state.team==='all'||t.legs.some(r=>r.team===state.team));
    });
    const compare=(a,b,get,descending=false)=>{const x=get(a),y=get(b);return x===null?y===null?0:1:y===null?-1:(descending?y-x:x-y);};
    if(state.sort.startsWith('price_'))rows.sort((a,b)=>compare(a,b,t=>finite(effectiveOdds(t))?effectiveOdds(t):null,state.sort==='price_desc'));
    if(state.sort.startsWith('probability_'))rows.sort((a,b)=>compare(a,b,lowestProbability,state.sort==='probability_desc'));
    if(state.sort.startsWith('legs_'))rows.sort((a,b)=>(a.legs.length-b.legs.length)*(state.sort==='legs_desc'?-1:1));
    if(state.sort==='game')rows.sort((a,b)=>{const first=t=>Math.min(...t.legs.map(r=>Date.parse(r.startTime)).filter(Number.isFinite));return compare(a,b,t=>Number.isFinite(first(t))?first(t):null);});
    return rows;
  }
  function ticketGames(ticket){
    const games=new Map();for(const row of ticket.legs){const key=JSON.stringify([row.date,eventId(row)]);if(!games.has(key))games.set(key,row);}
    return [...games.values()].sort((a,b)=>(Date.parse(a.startTime)||Infinity)-(Date.parse(b.startTime)||Infinity)||String(eventId(a)).localeCompare(String(eventId(b))));
  }
  function ticketGamesHTML(ticket){
    const research=typeof window==='undefined'?require('./pick-research.js'):window.SBOS_PICK_RESEARCH;
    return ticketGames(ticket).map(row=>research.compactMatchup(row)).join('');
  }
  function coverageNote(key){return key==='both'?'Every leg has a saved exact-line price at both books.':key==='mixed'?'No complete price set is saved at either book. Confirm every exact line and the full ticket at your sportsbook.':`A complete price set is saved only at ${bookName(key)}. The other book is missing at least one matching line; choose ${bookName(key)} for its complete saved price set.`;}
  const genericFitReasons=new Set(['All saved leg prices are from the same sportsbook.','Each player appears once, with one exact stat line.','Saved leg prices come from different sportsbooks; confirm the full ticket at your book.','Algorithm-selected value legs.','Different games limit shared rotation exposure.','Recent role, minutes and opportunity reviewed.','Reviewed.']);
  const joinText=values=>values.length<3?values.join(' and '):values.slice(0,-1).join(', ')+', and '+values.at(-1);
  const number=value=>Number(value.toFixed(1)).toString();
  function projectionFact(row){
    const contract=results.normalizeContract(row),projection=estimate(row)?.projection;if(!contract||!finite(projection)||projection<0)return null;
    const difference=projection-contract.line,position=difference===0?'at its line':number(Math.abs(difference))+' '+(difference>0?'above':'below')+' its line';
    return row.player+' '+label(row)+' has a saved projection of '+number(projection)+' '+(markets[row.market]||row.market)+' ('+position+')';
  }
  function reviewWarnings(legs){return legs.flatMap(row=>{
    const update=row.confidenceUpdate;
    if(update?.qualification==='does_not_qualify')return [row.player+' no longer qualifies under the latest review'];
    if(update?.status==='review')return [row.player+' has an unresolved line review'];
    if(update?.status==='unavailable'||update?.qualification==='unavailable')return [row.player+' has an unavailable latest review'];
    if(row.result?.statisticalOutcome==='postponed')return [row.player+'’s game is postponed'];
    return [];
  });}
  function compatibilityExplanation(ticket){
    const split=results.parlayLegs(ticket),active=split.active,contracts=joinText(active.map(row=>row.player+' '+label(row)));
    const saved=Array.isArray(ticket.fitReasons)?[...new Set(ticket.fitReasons.filter(reason=>typeof reason==='string'&&reason.trim()&&!genericFitReasons.has(reason.trim())).map(reason=>reason.trim()))]:[];
    let summary,basis='saved-contracts';
    if(!active.length)summary='No active legs remain in this ticket. The original selections stay visible below; the ticket has no remaining hit requirements.';
    else {
      const projections=active.map(projectionFact).filter(Boolean),low=lowestProbability(ticket),warnings=reviewWarnings(active),games=active.every(gameIdentity)?ticketGames({...ticket,legs:active}):null;
      let evidence,context;
      if(projections.length){evidence=joinText(projections.slice(0,2));if(projections.length<active.length&&low!==null)evidence+='; the lowest saved individual leg win estimate is '+percent(low);basis='saved-projections';}
      else if(low!==null){evidence=contracts+(active.length===1?' has a saved individual win estimate of '+percent(low):active.length<=3?' have saved individual win estimates of '+joinText(active.map(row=>percent(probability(row))))+', respectively':' have a lowest saved individual leg win estimate of '+percent(low));basis='saved-individual-estimates';}
      else evidence=contracts+' remain the exact recorded targets; at least one active leg has no current saved win estimate';
      if(active.length===1)context=split.voided.length?'Only this selection remains active after voids; the other original selections remain recorded below':'Only one selection is recorded, so multi-leg compatibility cannot be assessed';
      else if(!games)context='The saved record does not establish how their game exposure overlaps; no combined win probability is inferred';
      else if(games.length===active.length)context='These are separate matchups, limiting shared game-script exposure; every active leg still must hit';
      else if(games.length===1)context=saved.length?'They share one game, so pace, rotation changes and a lopsided score can affect them together; the saved compatibility review below does not establish a validated combined win probability':'They share one game with no specific same-game compatibility finding saved; shared pace and rotation exposure is not evidence that the legs help each other hit';
      else context='Some legs share a game and can rise or fail together; every active leg still must hit';
      if(split.voided.length&&active.length>1)context=split.voided.length+' original leg'+(split.voided.length===1?' is':'s are')+' voided; '+context.charAt(0).toLowerCase()+context.slice(1);
      if(warnings.length)context=joinText(warnings)+'; '+context.charAt(0).toLowerCase()+context.slice(1);
      const outcome=results.parlayOutcome(ticket).outcome;
      if(outcome==='loss')context='This ticket has already missed; '+context.charAt(0).toLowerCase()+context.slice(1);
      else if(outcome==='win')context='Every active leg has hit'+(split.voided.length?' after voids':'')+'; '+(warnings.length?joinText(warnings)+'; ':'')+'the saved estimates describe individual legs, not a combined win probability';
      summary=evidence+'. '+context+'.';
    }
    return {summary,saved,basis};
  }
  function compatibilityHTML(ticket){const fit=compatibilityExplanation(ticket);return `<section class="pm-fit-intro" aria-label="Why these legs fit"><h3>Why these legs fit</h3><p>${escape(fit.summary)}</p><small>${{'saved-projections':'From saved projections and exact lines','saved-individual-estimates':'From saved individual estimates and exact lines','saved-contracts':'From the saved lines'}[fit.basis]}</small>${fit.saved.length?`<div class="pm-saved-fit"><strong>Saved compatibility review</strong><ul>${fit.saved.map(reason=>`<li>${escape(reason)}</li>`).join('')}</ul></div>`:''}</section>`;}
  function emptyStateHTML(counts,state){
    if(state.type==='same_game'&&!counts.same_game)return '<p class="pick-empty">No reviewed Same Game Parlay tickets have been published for this slate yet. <a href="../calculator/#sgp-analyzer">Explore your own combination in the same-game analyzer ↗</a></p>';
    return `<p class="pick-empty">${state.favorite&&!counts.favorites?'Ry hasn’t flagged any parlays for this slate yet.':!counts[state.type]?`No qualifying ${state.type==='longshots'?'Longshots':state.type==='plus_money'?'Plus Money parlays':'parlays'} in this edition. Browse Daily Board for our individual selections.`:'No published parlays match your filters. Try lowering the minimum or reset your filters.'}</p>`;
  }
  function ticketRow(ticket,index,{open=false}={}){
    const kind=section(ticket),coverage=ticket.sourceCoverage||prices.coverage(ticket),title=`${kind==='longshots'?'Longshot Parlay':'Plus Money Parlay'} ${index+1}`,favorite=isFavorite(ticket);
    const split=results.parlayLegs(ticket),voids=split.voided.length,result=results.parlayOutcome(ticket),resultLabel=voids&&result.outcome==='win'?`✓ Won with ${voids} void${voids===1?'':'s'}`:({win:'✓ Hit',loss:'✕ Miss',pending:'Pending',review:'Settlement review',void:'All legs void'})[result.outcome];
    const preview=ticket.legs.map(r=>`${board.playerNameHTML(r)} <span class="${results.isVoidedLeg(r)?'pm-voided-label':''}">${escape(label(r))}${results.isVoidedLeg(r)?' · Void':''}</span>`).join(' + ');
    const displayed=effectiveOdds(ticket),priceHeading=voids?'After voids (est.)':'Estimated combined price',voidNote=voids?`<p class="pm-void-note"><strong>${voids} void${voids===1?'':'s'}:</strong> ${split.voided.map(r=>escape(r.player)).join(', ')}. ${split.active.length} active ${split.active.length===1?'leg remains':'legs remain'}. ${split.active.length?'Estimated odds remove the voided legs.':'The ticket is fully voided; net P/L is zero.'} Original selections and full-ticket price stay saved.</p>`:'';
    return `<details class="pm-row" data-parlay-id="${escape(ticket.id)}" ${open?'open':''}><summary><span class="pm-row-chevron" aria-hidden="true">›</span><span class="pm-row-label"><span class="pm-row-title"><strong>${title}</strong><small>${ticket.legs.length} legs${voids?' · '+voids+' void'+(voids===1?'':'s'):''}</small><span class="pm-ticket-result ${result.outcome}">${resultLabel}${result.live?' · ● Live':''}</span>${favorite?'<span class="ry-favorite-badge">★ Ry’s Favorite</span>':''}</span><span class="pm-row-preview">${preview}</span></span><span class="pm-row-games">${ticketGamesHTML(ticket)}</span><span class="pm-row-price"><span class="sr-only">${priceHeading}: </span><small class="pm-price-caption${voids?' adjusted':''}" aria-hidden="true">${priceHeading}</small><strong>${result.outcome==='void'?'Refund':escape(odds(displayed))}</strong>${voids?`<small class="pm-before-void">Full ticket ${escape(odds(ticket.indicativeAmericanOdds))}</small>`:''}${units.payoutHTML(displayed,{type:kind==='longshots'?'longshot':'plus_money',voided:result.outcome==='void'})}</span><span class="pm-row-probability"><span class="sr-only">Lowest individual leg win estimate: </span><small aria-hidden="true">Lowest leg est.</small><strong>${percent(lowestProbability(ticket))}</strong></span><span class="pm-row-coverage">${coverageNames[coverage]}</span></summary><div class="pm-row-detail">${compatibilityHTML(ticket)}${voidNote}<div class="pm-leg-columns" aria-hidden="true"><span>Player / pick</span><span>Saved price</span><span>Leg win est.</span></div><ol class="pm-leg-list">${ticket.legs.map(r=>`<li><div class="pm-leg-row${results.isVoidedLeg(r)?' pm-leg-voided':''}"><span><span class="pm-leg-person">${typeof window!=='undefined'&&window.SBOS_PICK_RESEARCH?window.SBOS_PICK_RESEARCH.portrait(r,{href:board.playerProfileURL(r)}):''}<span><strong>${board.playerNameHTML(r)}</strong><span>${escape(label(r))}</span></span></span><small>${typeof window!=='undefined'&&window.SBOS_PICK_RESEARCH?window.SBOS_PICK_RESEARCH.matchupHeading(r.team+' vs '+r.opponent,[r.team,r.opponent],r):escape(r.team)+' vs '+escape(r.opponent)} · ${escape(stamp(r.startTime))}</small>${legResultHTML(r)}</span><span><strong>${escape(odds(r.americanOdds))}</strong><small>${escape(bookName(r.book||ticket.book))}</small></span><span><strong>${percent(probability(r))}</strong><small>Provisional</small></span></div><details class="pm-leg-research"><summary>${escape(r.player)} · pick research</summary>${typeof window!=='undefined'&&window.SBOS_PICK_RESEARCH?window.SBOS_PICK_RESEARCH.panel(r,{label:label(r)}):''}<details class="pick-audit"><summary>Saved prices & sources</summary>${prices.quoteDetails(r)}<p>Forecast saved ${escape(stamp(estimate(r)?.asOf))}.</p><a href="${escape(board.playerProfileURL(r)||'../players/')}" target="_blank" rel="noopener noreferrer">View player profile ↗</a></details></details></li>`).join('')}</ol><details class="pm-price-coverage"><summary>Saved pricing & exact-line coverage</summary><p class="pm-coverage-note">${coverageNote(coverage)}${ticket.book==='mixed'?' Displayed prices use mixed sources.':''}</p></details><p class="pm-joint-note">The lowest leg estimate describes one leg, not the whole parlay. No verified combined win probability has been assigned. Full game; confirm overtime and settlement terms with your sportsbook.</p></div></details>`;
  }
  function legResultHTML(row){const board=typeof window==='undefined'?require('./pick-board.js'):window.SBOS_PICK_BOARD,s=board.rowStatus(row);return `<small class="pm-leg-result ${s.tone}">${escape(s.icon+' '+s.label)}${s.live?' · ● Live':''} · ${escape(s.actual)} · MP ${escape(board.minutesLabel(row.result?.minutesPlayed))}</small>`;}
  async function init(){
    const script=document.querySelector('script[data-plus-money]');if(!script)return;
    const base=new URL('../',script.src),dataRoot=new URL('data/plus-money/',base),$=id=>document.getElementById(id);
    const target=$('parlay-list'),dateSelect=$('parlay-date'),context=$('parlay-context');
    let editions=[],body=null,serial=0,state=readState(location.search,location.hash);const opened=new Set();
    const tracker=window.SBOS_PICK_BOARD.watchResults({base,onResults:()=>render()});
    $('parlay-book-preference').innerHTML=prices.controlHTML();
    async function json(url,immutable=false){const r=await fetch(url,{cache:immutable?'force-cache':'no-store',credentials:'omit'});if(!r.ok)throw Error('Publication unavailable');return r.json();}
    function syncURL(push=false){const url=routes.canonicalURL(location.href,base);const target=routes.parlayLocation('?'+stateQuery(state,body.date),state.type);url.search=target.search;url.hash=target.hash;if(url.href!==location.href)history[push?'pushState':'replaceState'](null,'',url);}
    function render(push=false){
      if(!body)return;
      const tickets=body.tickets.map(t=>pricedTicket(t)),counts=tabCounts(tickets),rows=filterTickets(tickets,state);
      // Search, price and probability filters never hide losses from the category record.
      const tracked=categoryTickets(body.tickets,state.type);
      $('parlay-record').innerHTML=results.parlayRecordHTML(tracked,{label:titles[state.type]+' · slate record'})+(window.SBOS_UNITS?.recordHTML(tracked,{kind:'parlays'})||'');
      $('parlay-tabs').innerHTML=Object.entries(titles).map(([key,title])=>`<button type="button" role="tab" id="parlay-tab-${key}" aria-controls="parlay-panel" aria-selected="${state.type===key}" tabindex="${state.type===key?0:-1}" data-parlay-tab="${key}"><span>${title}</span><strong>${counts[key]}</strong></button>`).join('');
      $('parlay-panel').setAttribute('aria-labelledby','parlay-tab-'+state.type);
      $('combinations-heading').textContent=titles[state.type];$('parlay-count').textContent=`${rows.length} of ${counts[state.type]} parlays`;
      $('parlay-favorites').setAttribute('aria-pressed',String(state.favorite));$('parlay-favorite-count').textContent=counts.favorites;
      for(const el of document.querySelectorAll('[data-parlay-filter]'))el.value=state[el.dataset.parlayFilter]||'';
      target.innerHTML=rows.length?rows.map(t=>ticketRow(t,ticketOrdinal(body.tickets,t)-1,{open:opened.has(t.id)})).join(''):emptyStateHTML(counts,state);
      syncURL(push);window.SBOS_PICK_RESEARCH?.hydrate(target);
    }
    function options(){
      const legs=body.tickets.flatMap(t=>t.legs),games=new Map(legs.map(r=>[eventId(r),[r.team,r.opponent].sort().join(' vs ')]));
      for(const [id,values] of [['parlay-legs',[...new Set(body.tickets.map(t=>String(t.legs.length)))].sort().map(n=>[n,n+' legs'])],['parlay-market',[...new Set(legs.map(r=>r.market))].sort().map(m=>[m,markets[m]||m])],['parlay-game',[...games].sort((a,b)=>a[1].localeCompare(b[1]))],['parlay-team',[...new Set(legs.map(r=>r.team))].sort().map(t=>[t,t])]]){
        $(id).innerHTML='<option value="all">All '+({ 'parlay-legs':'leg counts','parlay-market':'stats','parlay-game':'games','parlay-team':'teams'}[id])+'</option>'+values.map(([value,name])=>`<option value="${escape(value)}">${escape(name)}</option>`).join('');
      }
      for(const key of ['legs','market','game','team'])if(![...document.querySelector(`[data-parlay-filter="${key}"]`).options].some(o=>o.value===state[key]))state[key]='all';
    }
    async function loadDate(){
      const n=++serial,entry=editions.find(e=>e.date===dateSelect.value);target.textContent='Loading the published parlay board…';
      const saved=await json(new URL(safePath(entry),dataRoot),true);if(n!==serial)return;
      if(!['public-plus-money-1','public-plus-money-2'].includes(saved.schemaVersion)||saved.version!==entry.version||saved.date!==entry.date||!Array.isArray(saved.tickets))throw Error('Publication mismatch');
      if(body?.date!==saved.date)opened.clear();body=saved;options();
      context.textContent=`Saved prices: ${stamp(body.quoteObservedAt)} · Board updated ${stamp(body.updatedAt)}.`;
      $('parlay-price-note').textContent=body.priceNote;render();
      tracker.setRows(body.tickets.flatMap(t=>t.legs));
    }
    function filterChange(event){const key=event.target.dataset?.parlayFilter;if(!key)return;state=readState('?'+new URLSearchParams({...state,[key]:event.target.value,favorite:state.favorite?'1':'0'}));render();}
    $('parlay-filters').addEventListener('input',event=>{if(event.target.tagName==='INPUT')filterChange(event);});
    $('parlay-filters').addEventListener('change',event=>{if(event.target.tagName==='SELECT')filterChange(event);});
    $('parlay-favorites').addEventListener('click',()=>{state.favorite=!state.favorite;render();});
    $('parlay-reset').addEventListener('click',()=>{state={...defaults,type:state.type};render();});
    $('parlay-tabs').addEventListener('click',event=>{const tab=event.target.closest('[data-parlay-tab]');if(!tab)return;state.type=tab.dataset.parlayTab;render(true);$('parlay-tab-'+state.type).focus({preventScroll:true});});
    $('parlay-tabs').addEventListener('keydown',event=>{const tab=event.target.closest('[data-parlay-tab]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const keys=Object.keys(titles),i=keys.indexOf(tab.dataset.parlayTab),next=event.key==='Home'?0:event.key==='End'?keys.length-1:(i+(event.key==='ArrowRight'?1:-1)+keys.length)%keys.length;state.type=keys[next];render(true);$('parlay-tab-'+state.type).focus({preventScroll:true});});
    target.addEventListener('toggle',event=>{const row=event.target;if(row.matches('details[data-parlay-id]'))row.open?opened.add(row.dataset.parlayId):opened.delete(row.dataset.parlayId);},true);
    window.addEventListener('popstate',()=>{state=readState(location.search,location.hash);const date=new URL(location.href).searchParams.get('date');if(date&&date!==body?.date&&editions.some(e=>e.date===date)){dateSelect.value=date;loadDate().catch(showError);}else render();});
    try{
      const index=await json(new URL('manifest.json',dataRoot));if(index.schemaVersion!=='public-plus-money-manifest-1')throw Error('Invalid publication');
      const latest=new Map();for(const e of index.editions){safePath(e);latest.set(e.date,e);}editions=[...latest.values()].sort((a,b)=>b.date.localeCompare(a.date));
      if(!editions.length){target.textContent='No parlays have been published yet.';return;}
      dateSelect.innerHTML=editions.map(e=>`<option value="${escape(e.date)}">${escape(e.date)}</option>`).join('');
      const requested=new URL(location.href).searchParams.get('date');if(editions.some(e=>e.date===requested))dateSelect.value=requested;
      dateSelect.disabled=false;await loadDate();dateSelect.addEventListener('change',()=>loadDate().catch(showError));
      window.addEventListener('sbos:bookchange',()=>render());window.addEventListener('hashchange',()=>{const next=readState(location.search,location.hash);if(next.type!==state.type){state=next;render();}});$('refresh-parlays').addEventListener('click',()=>location.reload());
    }catch{showError();}
    function showError(){target.innerHTML='<p role="alert" class="site-error">The saved parlay board is unavailable. Refresh to try again.</p>';}
  }
  return {titles,isSameGame,categoryTickets,emptyStateHTML,compatibilityExplanation,compatibilityHTML,ticketOrdinal,effectiveOdds,ticketGames,ticketGamesHTML,escape,label,safePath,readState,stateQuery,tabCounts,isFavorite,lowestProbability,pricedTicket,filterTickets,ticketRow,init};
});
