/* Presentation of frozen, reviewed parlays. Filters never generate selections. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.SBOS_PLUS_MONEY=api;document.addEventListener('DOMContentLoaded',()=>api.init());}})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const prices=typeof window==='undefined'?require('./book-prices.js'):window.SBOS_BOOK_PRICES;
  const ticketProbability=typeof window==='undefined'?require('./ticket-probability.js'):window.SBOS_TICKET_PROBABILITY;
  const board=typeof window==='undefined'?require('./pick-board.js'):window.SBOS_PICK_BOARD;
  const results=typeof window==='undefined'?require('./result-utils.js'):window.STARS_RESULT_UTILS;
  const routes=typeof window==='undefined'?require('./routes.js'):window.SBOS_ROUTES;
  const policy=typeof window==='undefined'?require('./slate-policy.js'):window.SBOS_SLATE_POLICY;
  const units=typeof window==='undefined'?require('./unit-tracker.js'):window.SBOS_UNITS;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const odds=value=>finite(value)?(value>0?'+':'')+value:'—';
  const bookName=value=>({fanduel:'FanDuel',draftkings:'DraftKings',mixed:'Mixed price sources'}[value]||value);
  const markets={PTS:'points',AST:'assists',REB:'rebounds','3PM':'threes',PRA:'points + rebounds + assists',PA:'points + assists',PR:'points + rebounds',RA:'rebounds + assists',BLK:'blocks',STL:'steals'};
  const titles={all:'All Parlays',plus_money:'Plus Money',same_game:'Same Game Parlays',longshots:'Longshots'};
  const currentTitles={all:'All Parlays',layups:'Layups',mid_range:'Mid-Range',longshots:'Longshots',logo_lottos:'Logo Lottos'};
  const titlesForDate=date=>policy.isCurrent(date)?currentTitles:titles;
  const coverageNames={both:'Both sportsbooks',fanduel:'FanDuel Exclusive Lines',draftkings:'DraftKings Exclusive Lines',mixed:'Mixed-Source Ideas'};
  const sorts=['reviewed','probability_desc','probability_asc','price_desc','price_asc','legs_asc','legs_desc','game'];
  const defaults={type:'all',sameGame:false,query:'',minimum:0,minPrice:0,favorite:false,coverage:'all',legs:'all',market:'all',game:'all',team:'all',sort:'reviewed'};
  const section=t=>isModelTarget(t)?'same_game':policy.isCurrent(t)?policy.parlayTier(t)||'unclassified':t.section||'plus_money';
  const ticketOrdinal=(tickets,ticket)=>tickets.filter(t=>section(t)===section(ticket)).findIndex(t=>t.id===ticket.id)+1;
  const asAmerican=decimal=>finite(decimal)&&decimal>1?Math.round(decimal>=2?(decimal-1)*100:-100/(decimal-1)):null;
  const effectiveOdds=t=>isModelTarget(t)?null:results.parlayLegs(t).voided.length?asAmerican(results.parlayDecimal(t)):t.indicativeAmericanOdds;
  const isFavorite=t=>t.ryFavorite===true;
  const eventId=r=>r.canonicalEventId||r.eventId;
  const gameIdentity=row=>typeof row.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.date)&&typeof eventId(row)==='string'&&eventId(row).trim()?JSON.stringify([row.date,eventId(row)]):null;
  // This is an overlapping view of original tickets, not a new payout tier.
  function isSameGame(ticket){const identities=(ticket.legs||[]).map(gameIdentity);return identities.length>1&&identities.every(Boolean)&&new Set(identities).size<identities.length;}
  const decimal=value=>finite(value)&&Math.abs(value)>=100?1+(value>0?value/100:100/Math.abs(value)):null;
  function isModelTarget(t){
    const j=t?.jointEstimate;
    return t?.priceKind==='model_target'&&t.status==='provisional'&&typeof t.id==='string'&&Array.isArray(t.legs)&&t.legs.length>=2&&t.legs.length<=6&&t.legs.every(r=>r&&typeof r==='object')&&isSameGame(t)&&
      new Set(t.legs.map(r=>r.date)).size===1&&typeof t.compatibility==='string'&&t.compatibility.trim().length>0&&
      j&&finite(j.winProbability)&&j.winProbability>0&&j.winProbability<1&&j.pushProbability===0&&finite(j.lossProbability)&&Math.abs(j.winProbability+j.lossProbability-1)<1e-7&&
      finite(j.lowerProbability)&&finite(j.upperProbability)&&j.lowerProbability>=0&&j.upperProbability<=1&&j.lowerProbability<=j.winProbability&&j.upperProbability>=j.winProbability&&
      Number.isInteger(j.sampleGames)&&j.sampleGames>0&&Number.isFinite(Date.parse(j.asOf))&&t.legs.every(r=>Number.isFinite(Date.parse(r.startTime))&&Date.parse(j.asOf)<Date.parse(r.startTime))&&
      decimal(j.fairAmericanOdds)!==null&&(Math.abs(j.fairAmericanOdds-asAmerican(1/j.winProbability))<=1||Math.abs(j.fairAmericanOdds)===100&&Math.abs(asAmerican(1/j.winProbability))===100)&&
      decimal(j.minimumAmericanOdds)!==null&&decimal(j.minimumAmericanOdds)>=decimal(j.fairAmericanOdds)-1e-7;
  }
  // Editorial withdrawals survive result editions, new IDs, reordering and book-price refreshes.
  let withdrawals=typeof window==='undefined'?require('./parlay-withdrawals.json'):null;
  const legContract=r=>JSON.stringify([r.date,eventId(r),r.playerId,r.market,r.operator,r.line,r.period||'full_game']);
  function withdrawalFor(ticket){
    if(!withdrawals)throw Error('Withdrawal register unavailable');
    const legs=(ticket?.legs||[]).map(legContract).sort();
    return withdrawals.withdrawals.find(w=>(ticket?.legs||[]).some(r=>r.date===w.date)&&(w.ticketIds.includes(ticket.id)||legs.length===w.legs.length&&legs.every((v,i)=>v===w.legs.map(r=>JSON.stringify(r)).sort()[i])));
  }
  function applyWithdrawals(body){return {...body,tickets:(body.tickets||[]).filter(t=>!withdrawalFor(t)),...(Array.isArray(body.modelTargets)?{modelTargets:body.modelTargets.filter(t=>!withdrawalFor(t))}:{})};}
  function withdrawalNoticeHTML(date){
    if(!withdrawals)throw Error('Withdrawal register unavailable');
    return withdrawals.withdrawals.filter(w=>w.date===date).map(w=>`<p role="note" class="pm-withdrawal-notice"><strong>Withdrawal recorded ${escape(stamp(w.recordedAt))}.</strong> ${escape(w.notice)}</p>`).join('');
  }
  function modelTargets(body){return Array.isArray(body?.modelTargets)?body.modelTargets.filter(t=>isModelTarget(t)&&!withdrawalFor(t)):[];}
  function boardRows(body){return [...(body?.tickets||[]).filter(t=>!withdrawalFor(t)).map(policy.freezeParlay),...modelTargets(body)];}
  const targetMinimum=t=>policy.minimumSGPPrice(t.jointEstimate.minimumAmericanOdds,policy.dateOf(t));
  function targetNeedsReview(ticket){return results.parlayLegs(ticket).voided.length>0||ticket.legs.some(r=>r.confidenceUpdate&&(['does_not_qualify','unavailable'].includes(r.confidenceUpdate.qualification)||['review','unavailable'].includes(r.confidenceUpdate.status)));}
  function categoryTickets(tickets,type='all'){const seen=new Set();return tickets.filter(t=>{if(t.id&&seen.has(t.id))return false;if(t.id)seen.add(t.id);return type==='all'||(type==='same_game'?isSameGame(t):section(t)===type);});}
  const estimate=r=>r.confidenceUpdate?r.confidenceUpdate.estimate:r.estimate;
  const probability=r=>{const p=estimate(r)?.winProbability;return finite(p)&&p>=0&&p<=1?p:null;};
  function lowestProbability(ticket){const values=results.parlayLegs(ticket).active.map(probability);return values.length&&values.every(finite)?Math.min(...values):null;}
  // Every headline uses the same complete event-group/source/clock rules.
  // Unbound legacy jointEstimate values remain visible only in their audit.
  function totalSlipProbability(ticket,options){return ticketProbability.evaluate(ticket,options);}
  const percent=p=>finite(p)?(p*100).toFixed(1)+'%':'—';
  function probabilityHTML(ticket){
    const total=totalSlipProbability(ticket),available=finite(total.probability),approx=total.status==='approximate',value=available?(Object.hasOwn(total,'allWinProbability')?ticketProbability.format(total.probability):percent(total.probability)):'Unavailable';
    const caption=approx?'All-win · independence approx.':total.basis==='reviewed_same_game_joint'?'Joint all-win · provisional':'Total slip est.',accessible=approx?'Approximate all-win probability, assuming independence across games: ':'Total slip probability: ';
    return `<span class="pm-lowest-leg"><span class="sr-only">Lowest individual leg win estimate: </span><small aria-hidden="true">Lowest leg est.</small><strong>${percent(lowestProbability(ticket))}</strong></span><span class="pm-total-slip"><span class="sr-only">${accessible}</span><small aria-hidden="true">${caption}</small><strong class="${available?'':'pm-probability-unavailable'}">${value}</strong></span>`;
  }
  function probabilityNoteHTML(ticket){const read=totalSlipProbability(ticket);return '<p class="pm-joint-note">'+(finite(read.probability)?'':'Total slip probability: <strong>Unavailable</strong>. No verified combined win probability has been assigned. ')+escape(Object.hasOwn(read,'allWinProbability')?ticketProbability.explanation(read):read.reason||read.note||'Joint forecast unavailable.')+'</p>';}
  const label=r=>{
    const native=r.operator==='>='&&(r.market==='3PM'||r.market==='PTS'&&[5,10,15,20,25,30,35].includes(r.line)||['REB','AST'].includes(r.market)&&[4,6,8,10].includes(r.line)||['PRA','PA','PR','RA'].includes(r.market)&&r.line>=10&&r.line%5===0);
    return `${native?r.line+'+':r.operator==='>='?'Alt O'+(Math.ceil(r.line)-.5):r.operator==='<='?'Alt U'+(Math.floor(r.line)+.5):(r.operator==='>'?'Over ':'Under ')+r.line} ${markets[r.market]||r.market}`;
  };
  const stamp=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET':'Time unavailable';
  function safePath(entry){if(!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)||!Number.isFinite(Date.parse(entry.date))||!/^[a-f0-9]{16}$/.test(entry.version)||entry.path!==`${entry.date}/${entry.version}.json`)throw Error('Invalid parlay publication path');return entry.path;}
  function readState(search='',hash=''){
    const p=new URLSearchParams(search),minimum=Number(p.get('minimum')),minPrice=Number(p.get('minPrice'));
    return {...defaults,type:routes.parlayType(search,hash),sameGame:routes.sameGameFilter(search,hash),query:(p.get('query')||'').slice(0,120),
      minimum:Number.isFinite(minimum)&&minimum>=0&&minimum<=100?minimum:0,minPrice:Number.isFinite(minPrice)&&minPrice>=100&&minPrice<=1000000?minPrice:0,
      favorite:p.get('favorite')==='1',coverage:Object.hasOwn(coverageNames,p.get('coverage'))?p.get('coverage'):'all',
      legs:/^[2-6]$/.test(p.get('legs'))?p.get('legs'):'all',market:Object.hasOwn(markets,p.get('market'))?p.get('market'):'all',
      game:(p.get('game')||'all').slice(0,100),team:(p.get('team')||'all').slice(0,100),sort:sorts.includes(p.get('sort'))?p.get('sort'):'reviewed'};
  }
  function stateQuery(state,date){const p=new URLSearchParams();if(date)p.set('date',date);for(const [key,value] of Object.entries(defaults))if(state[key]!==value)p.set(key,['favorite','sameGame'].includes(key)?'1':String(state[key]));return p.toString();}
  function tabCounts(tickets,date){const unique=categoryTickets(tickets),day=date||policy.dateOf(unique[0]);return {...Object.fromEntries(Object.keys(titlesForDate(day)).map(type=>[type,categoryTickets(unique,type).length])),same_game:categoryTickets(unique,'same_game').length,favorites:unique.filter(isFavorite).length};}
  function pricedTicket(ticket,preferred=prices.getPreferredBook()){
    ticket=policy.freezeParlay(ticket);
    const legs=ticket.legs.map(r=>prices.pricedPick(r,preferred));
    if(isModelTarget(ticket))return {...ticket,legs,indicativeAmericanOdds:null,sourceCoverage:prices.coverage(ticket)};
    const decimal=legs.length&&legs.every(r=>finite(r.americanOdds)&&Math.abs(r.americanOdds)>=100)?legs.reduce((d,r)=>d*(1+(r.americanOdds>0?r.americanOdds/100:100/Math.abs(r.americanOdds))),1):null;
    const books=new Set(legs.map(r=>r.book));
    return {...ticket,legs,book:books.size===1?legs[0].book:'mixed',indicativeAmericanOdds:decimal?Math.round(decimal>=2?(decimal-1)*100:-100/(decimal-1)):null,sourceCoverage:prices.coverage(ticket)};
  }
  function filterTickets(tickets,state){
    const query=state.query.trim().toLocaleLowerCase();
    const rows=categoryTickets(tickets,state.type).filter(t=>{
      const low=lowestProbability(t);
      return (!state.sameGame||isSameGame(t))&&(!state.favorite||isFavorite(t))&&
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
    if(isModelTarget(ticket))return {summary:ticket.compatibility,saved:[],basis:'provisional-joint-model'};
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
  function compatibilityHTML(ticket){const fit=compatibilityExplanation(ticket);return `<section class="pm-fit-intro" aria-label="Why these legs fit"><h3>Why these legs fit</h3><p>${escape(fit.summary)}</p><small>${{'saved-projections':'From saved projections and exact lines','saved-individual-estimates':'From saved individual estimates and exact lines','saved-contracts':'From the saved lines','provisional-joint-model':'Provisional joint model · actual ticket quote required'}[fit.basis]}</small>${fit.saved.length?`<div class="pm-saved-fit"><strong>Saved compatibility review</strong><ul>${fit.saved.map(reason=>`<li>${escape(reason)}</li>`).join('')}</ul></div>`:''}</section>`;}
  function emptyStateHTML(counts,state){
    if(state.type==='same_game'&&!counts.same_game)return '<p class="pick-empty">No reviewed Same Game Parlay tickets have been published for this slate yet. <a href="../calculator/#sgp-analyzer">Explore your own combination in the same-game analyzer ↗</a></p>';
    return `<p class="pick-empty">${state.favorite&&!counts.favorites?'Ry hasn’t flagged any parlays for this slate yet.':!counts[state.type]?`No qualifying ${state.type==='longshots'?'Longshots':state.type==='plus_money'?'Plus Money parlays':currentTitles[state.type]?currentTitles[state.type]+' parlays':'parlays'} in this edition. Browse Daily Board for our individual selections.`:'No published parlays match your filters. Try lowering the minimum or reset your filters.'}</p>`;
  }
  function personalGroupsHTML(ticket){
    const groups=(ticket.groups||[]).filter(g=>g.kind==='same_game');
    return groups.length?`<section class="personal-group-prices" aria-label="Same-game group prices"><h4>SGP group prices</h4>${groups.map((group,index)=>{const price=results.personalPrice(group,{requireEvidence:true});return `<p>Same-game group ${index+1} · ${group.pickIds.length} legs: <strong>${price===null?'Unavailable':escape(odds(price))}</strong>${price===null?' · No verified original group quote saved.':` · ${escape(group.priceEvidence.source==='share_link'?'Shared-slip quote':'Screenshot quote')} observed ${escape(stamp(group.priceEvidence.observedAt))}`}</p>`;}).join('')}<p>Group prices are separate sportsbook quotes; individual leg prices are not multiplied into SGP prices.</p></section>`:'';
  }
  function personalTicketRow(ticket,index,{open=false,base}={}){
    const result=results.parlayOutcome(ticket),split=results.parlayLegs(ticket),status={win:'Hit',loss:'Miss',pending:'Pending',review:'Settlement review',void:'Fully voided'}[result.outcome];
    const snapshot=ticket.recordKind==='selection_snapshot';
    const price=results.personalPrice(ticket),adjusted=split.voided.length&&split.active.length,payout=snapshot?'':adjusted?'<p class="pm-void-note">Revised full-ticket quote required after voids; winning return withheld.</p>':units.payoutHTML(price,{type:'personal',voided:!split.active.length});
    const validURL=!snapshot&&typeof ticket.shareUrl==='string'&&/^https:\/\/sportsbook\.fanduel\.com\/addToBetslip\?shareCode=[a-zA-Z0-9]{1,64}$/.test(ticket.shareUrl);
    const preview=ticket.legs.map(r=>`${escape(r.player)} <span>${escape(label(r))}</span>`).join(' + ');
    const timing=snapshot?`<details class="personal-ticket-provenance"><summary>Posting &amp; screenshot source</summary><p>${ticket.postedAt?'Publicly posted '+escape(stamp(ticket.postedAt))+'.':'Public posting time awaiting deployment verification.'} ${ticket.recordedAt?'Recorded for the site '+escape(stamp(ticket.recordedAt))+'.':''}</p><p>Placement and acceptance unverified. Quote time ${ticket.priceEvidence?.observedAt?escape(stamp(ticket.priceEvidence.observedAt)):'unavailable'}. Saved unboosted screenshot quote only; current odds and availability were not checked. No wager amount or settlement was supplied.</p><p>All four selections were reported by Ry. The screenshot does not expose the folded SGP group membership or accepted component prices. Group prices remain unavailable.</p></details>`:`<details class="personal-ticket-provenance"><summary>Posting, placement &amp; price sources</summary><p>${ticket.postedAt?`Publicly posted <time datetime="${escape(ticket.postedAt)}">${escape(stamp(ticket.postedAt))}</time>`:'Public posting time awaiting deployment verification'}. ${ticket.recordedAt?'Recorded for the site '+escape(stamp(ticket.recordedAt))+'. ':''}${ticket.placedAt?'Recorded placement time: '+escape(stamp(ticket.placedAt))+'.':'Placement time not supplied.'}</p><p>${ticket.priceEvidence?`Full-slip source: ${escape(ticket.priceEvidence.source)} · observed ${escape(stamp(ticket.priceEvidence.observedAt))}. Saved prices supplied by Ry; current odds and availability were not checked.`:'Historical screenshot prices supplied by Ry; current odds and availability were not checked.'} Individual ticket prices stay with their original slip. An earlier unsubmitted selection or a later shared-link quote does not establish prices for a recorded placed ticket.</p>${validURL?`<p><a class="sbos-text-link" target="_blank" rel="noopener noreferrer" href="${escape(ticket.shareUrl)}">Open shared FanDuel slip ↗</a> · Current availability may differ.</p>`:''}</details>`;
    return `<details class="pm-row personal-parlay-row" data-personal-slip-id="${escape(ticket.id)}"${open?' open':''}><summary><span class="pm-row-chevron" aria-hidden="true">›</span><span class="pm-row-label"><span class="pm-row-title"><strong>★ ${escape(ticket.label||`Ry’s favorite parlay ${index+1}`)}</strong><small>${ticket.legs.length} legs${snapshot?' · Placement unverified'+(ticket.oddsChangedAtCapture?' · Odds changed at capture':''):''}</small><span class="pm-ticket-result ${result.outcome}">${escape(status)}${result.live?' · ● Live':''}</span></span><span class="pm-row-preview">${preview}</span></span><span class="pm-row-games">${ticketGamesHTML(ticket)}</span><span class="pm-row-price"><small class="pm-price-caption">${snapshot?'Saved unboosted quote':'Saved full-slip price'}</small><strong>${price===null?'Unavailable':escape(odds(price))}</strong>${payout}</span><span class="pm-row-probability">${probabilityHTML(ticket)}</span><span class="pm-row-coverage">${escape(bookName(ticket.book)||'Book unavailable')}<br>${snapshot?'Quote time unavailable':ticket.priceEvidence?.source==='share_link'?'Shared-slip quote':'Screenshot quote'}</span></summary><div class="pm-row-detail">${snapshot?'<p class="publication-note">Personal selection snapshot · placement and acceptance unverified. Saved unboosted quote; no stake or actual wager P/L. '+(ticket.oddsChangedAtCapture?'Odds changed at capture; this saved price may be unavailable.':'')+'</p>':''}<p class="personal-slip-placement">${ticket.legs.length} legs · ${escape(bookName(ticket.book)||'Book unavailable')} full-ticket ${ticket.priceEvidence?.source==='share_link'?'shared-slip':'screenshot'} quote · ${escape(status)}${result.live?' · Live':''}</p>${personalGroupsHTML(ticket)}<div class="pm-leg-columns" aria-hidden="true"><span>Player / pick</span><span>Saved leg price</span><span>Leg win est.</span></div>${legListHTML(ticket,{personal:true,base})}<details class="pm-fit"><summary>Why these legs fit</summary>${compatibilityHTML(ticket)}</details>${timing}${probabilityNoteHTML(ticket)}<p class="pm-joint-note">Saved pregame estimates remain historical inputs; a display-time calculation is not an archived whole-ticket forecast. Statistical results are not verified sportsbook settlement; live stats can be corrected.</p></div></details>`;
  }
  function ticketRow(ticket,index,{open=false}={}){
    if(withdrawalFor(ticket))return '';
    if(ticket.priceKind==='model_target'){
      if(!isModelTarget(ticket))throw Error('Invalid unquoted model target');
      return modelTargetRow(ticket,index,{open});
    }
    const kind=section(ticket),coverage=ticket.sourceCoverage||prices.coverage(ticket),title=`${policy.isCurrent(ticket)?({layups:'Layup',mid_range:'Mid-Range',longshots:'Longshot',logo_lottos:'Logo Lotto'}[kind]||'Recorded'):kind==='longshots'?'Longshot':'Plus Money'} Parlay ${index+1}`,favorite=isFavorite(ticket);
    const split=results.parlayLegs(ticket),voids=split.voided.length,result=results.parlayOutcome(ticket),resultLabel=voids&&result.outcome==='win'?`✓ Won with ${voids} void${voids===1?'':'s'}`:({win:'✓ Hit',loss:'✕ Miss',pending:'Pending',review:'Settlement review',void:'All legs void'})[result.outcome];
    const preview=ticket.legs.map(r=>`${board.playerNameHTML(r)} <span class="${results.isVoidedLeg(r)?'pm-voided-label':''}">${escape(label(r))}${results.isVoidedLeg(r)?' · Void':''}</span>`).join(' + ');
    const displayed=effectiveOdds(ticket),priceHeading=voids?'After voids (est.)':'Estimated combined price',voidNote=voids?`<p class="pm-void-note"><strong>${voids} void${voids===1?'':'s'}:</strong> ${split.voided.map(r=>escape(r.player)).join(', ')}. ${split.active.length} active ${split.active.length===1?'leg remains':'legs remain'}. ${split.active.length?'Estimated odds remove the voided legs.':'The ticket is fully voided; net P/L is zero.'} Original selections and full-ticket price stay saved.</p>`:'';
    return `<details class="pm-row" data-parlay-id="${escape(ticket.id)}" ${open?'open':''}><summary><span class="pm-row-chevron" aria-hidden="true">›</span><span class="pm-row-label"><span class="pm-row-title"><strong>${title}</strong>${isSameGame(ticket)?'<span class="pm-sgp-badge">Same game</span>':''}<small>${ticket.legs.length} legs${voids?' · '+voids+' void'+(voids===1?'':'s'):''}</small><span class="pm-ticket-result ${result.outcome}">${resultLabel}${result.live?' · ● Live':''}</span>${favorite?'<span class="ry-favorite-badge">★ Ry’s Favorite</span>':''}</span><span class="pm-row-preview">${preview}</span></span><span class="pm-row-games">${ticketGamesHTML(ticket)}</span><span class="pm-row-price"><span class="sr-only">${priceHeading}: </span><small class="pm-price-caption${voids?' adjusted':''}" aria-hidden="true">${priceHeading}</small><strong>${result.outcome==='void'?'Refund':escape(odds(displayed))}</strong>${voids?`<small class="pm-before-void">Full ticket ${escape(odds(ticket.indicativeAmericanOdds))}</small>`:''}${units.payoutHTML(displayed,{type:units.ticketType(ticket),voided:result.outcome==='void'})}</span><span class="pm-row-probability">${probabilityHTML(ticket)}</span><span class="pm-row-coverage">${coverageNames[coverage]}</span></summary><div class="pm-row-detail">${compatibilityHTML(ticket)}${ticket.selectedAt?`<p class="pm-ticket-timing">Selected ${escape(stamp(ticket.selectedAt))} · ${ticket.postedAt?`Posted ${escape(stamp(ticket.postedAt))}`:"Public posting time pending verification"}. Odds refreshed at ${escape(stamp(ticket.legs.map(r=>r.capturedAt).filter(Boolean).sort().at(-1)))}.</p>`:""}${voidNote}<div class="pm-leg-columns" aria-hidden="true"><span>Player / pick</span><span>Saved price</span><span>Leg win est.</span></div>${legListHTML(ticket)}<details class="pm-price-coverage"><summary>Saved pricing & exact-line coverage</summary><p class="pm-coverage-note">${coverageNote(coverage)}${ticket.book==='mixed'?' Displayed prices use mixed sources.':''}</p></details>${probabilityNoteHTML(ticket)}</div></details>`;
  }
  function modelTargetRow(ticket,index,{open=false}={}){
    const j=ticket.jointEstimate,minimum=targetMinimum(ticket),voided=targetNeedsReview(ticket);
    const preview=ticket.legs.map(r=>`${board.playerNameHTML(r)} <span>${escape(label(r))}</span>`).join(' + ');
    return `<details class="pm-row pm-model-target" data-parlay-id="${escape(ticket.id)}" ${open?'open':''}><summary><span class="pm-row-chevron" aria-hidden="true">›</span><span class="pm-row-label"><span class="pm-row-title"><strong>Same Game Model Target ${index+1}</strong><small>${ticket.legs.length} legs</small><span class="pm-model-badge">${voided?'Needs new review':'Provisional · Not quoted'}</span>${isFavorite(ticket)?'<span class="ry-favorite-badge">★ Ry’s Favorite</span>':''}</span><span class="pm-row-preview">${preview}</span></span><span class="pm-row-games">${ticketGamesHTML(ticket)}</span><span class="pm-row-price"><small class="pm-model-caption">Fair model odds · saved audit</small><strong>${voided?'—':escape(odds(j.fairAmericanOdds))}</strong><small class="pm-model-price">${voided?'A leg needs fresh role or contract review.':'Target book price '+escape(odds(minimum))+' or better · saved audit only'}</small></span><span class="pm-row-probability">${probabilityHTML(ticket)}</span><span class="pm-row-coverage">Ticket quote needed</span></summary><div class="pm-row-detail">${compatibilityHTML(ticket)}<div class="pm-leg-columns" aria-hidden="true"><span>Player / pick</span><span>Saved leg price</span><span>Leg win est.</span></div>${legListHTML(ticket)}<section class="pm-model-support" aria-label="Joint model support">${probabilityNoteHTML(ticket)}<p>Saved joint method: ${escape(j.method||'Unrecorded')}. This legacy scalar is audit-only; it is not bound to the complete current ticket. A current headline needs the separate exact event-group artifact.</p><p><strong>Saved original joint estimate:</strong> ${percent(j.winProbability)} · model range ${percent(j.lowerProbability)}–${percent(j.upperProbability)} · ${j.sampleGames} shared games.</p><p>Estimate as of ${escape(stamp(j.asOf))}. Role, lineup and dependence uncertainty remain; this is not validated performance.</p><p class="pm-model-calibration">${escape(j.calibrationNote||"Limited calibration evidence; this model is provisional.")}</p><p>Saved fair odds and the original target-price threshold are audit-only. They do not qualify this current ticket or establish an offered sportsbook price.</p><a href="../calculator/#sgp-analyzer">Enter your actual ticket quote in the analyzer ↗</a><p class="pm-model-record-note">An actual ticket quote is required for payout and P/L. Unquoted model targets are excluded from our hit-rate and unit records.</p></section><details class="pm-price-coverage"><summary>Individual leg prices & exact-line coverage</summary><p class="pm-coverage-note">${coverageNote(ticket.sourceCoverage||prices.coverage(ticket))} These are individual line observations, not a combined sportsbook quote.</p></details></div></details>`;
  }
  function legListHTML(ticket,{personal=false,base}={}){return `<ol class="pm-leg-list">${ticket.legs.map(r=>`<li><div class="pm-leg-row${results.isVoidedLeg(r)?' pm-leg-voided':''}"><span><span class="pm-leg-person">${typeof window!=='undefined'&&window.SBOS_PICK_RESEARCH?window.SBOS_PICK_RESEARCH.portrait(r,{href:board.playerProfileURL(r,{base})}):''}<span><strong>${board.playerNameHTML(r,{base})}</strong><span>${escape(label(r))}</span></span></span><small>${typeof window!=='undefined'&&window.SBOS_PICK_RESEARCH?window.SBOS_PICK_RESEARCH.matchupHeading(r.team+' vs '+r.opponent,[r.team,r.opponent],r):escape(r.team)+' vs '+escape(r.opponent)} · ${escape(stamp(r.startTime))}</small>${legResultHTML(r)}${personal?personalLegContext(r,ticket):''}</span><span><strong>${personal&&r.americanOdds==null?'Unavailable':escape(odds(r.americanOdds))}</strong><small>${escape(bookName(r.book||ticket.book))}</small></span><span><strong>${percent(probability(r))}</strong><small>${personal&&r.sourceType==='user_supplied_parlay_snapshot'?'No model estimate':'Provisional'}</small></span></div><details class="pm-leg-research"><summary>${escape(r.player)} · pick research</summary>${typeof window!=='undefined'&&window.SBOS_PICK_RESEARCH?window.SBOS_PICK_RESEARCH.panel(r,{label:label(r)}):''}<details class="pick-audit"><summary>Saved prices & sources</summary>${personal?personalLegPriceSource(r):prices.quoteDetails(r)}<p>Forecast saved ${escape(stamp(estimate(r)?.asOf))}.</p><a href="${escape(board.playerProfileURL(r,{base})||'../players/')}" target="_blank" rel="noopener noreferrer">View player profile ↗</a></details></details></li>`).join('')}</ol>`;}
  function personalLegContext(row,ticket){
    const group=ticket.groups?.find(g=>g.pickIds.includes(row.id)),name=group?(group.kind==='standalone'?'Standalone selection':'Same-game group '+(ticket.groups.filter(g=>g.kind==='same_game').indexOf(group)+1)):'';
    const posted=ticket.postedAt&&Number.isFinite(Date.parse(row.startTime))?(Date.parse(ticket.postedAt)>=Date.parse(row.startTime)?'Posted after scheduled tip':'Posted before scheduled tip'):'Public posting time awaiting verification';
    return `<small>${escape(name)}${name?' · ':''}${escape(posted)}</small>`;
  }
  function personalLegPriceSource(row){const source=row.priceEvidence?.source==='share_link'?'shared slip':'screenshot';return `<p>${row.americanOdds==null?'Original ticket leg price unavailable.':`Saved ${source} leg price: <strong>${escape(odds(row.americanOdds))}</strong>.`}${row.priceEvidence?` Source: ${escape(source)} · observed ${escape(stamp(row.priceEvidence.observedAt))} · ${row.priceEvidence.context==='original_slip'?'original slip':'later quote; excluded from original ticket pricing'}.`:''}</p>`;}
  function legResultHTML(row){const board=typeof window==='undefined'?require('./pick-board.js'):window.SBOS_PICK_BOARD,s=board.rowStatus(row);return `<small class="pm-leg-result ${s.tone}">${escape(s.icon+' '+s.label)}${s.live?' · ● Live':''} · ${escape(s.actual)} · MP ${escape(board.minutesLabel(row.result?.minutesPlayed))}</small>`;}
  async function init(){
    const script=document.querySelector('script[data-plus-money]');if(!script)return;
    const base=new URL('../',script.src),dataRoot=new URL('data/plus-money/',base),$=id=>document.getElementById(id);
    const target=$('parlay-list'),dateSelect=$('parlay-date'),context=$('parlay-context');
    let editions=[],body=null,serial=0,state=readState(location.search,location.hash);const opened=new Set();
    const tracker=window.SBOS_PICK_BOARD.watchResults({base,onResults:()=>render()});
    $('parlay-book-preference').innerHTML=prices.controlHTML();
    async function json(url,immutable=false){const r=await fetch(url,{cache:immutable?'force-cache':'no-store',credentials:'omit'});if(!r.ok)throw Error('Publication unavailable');return r.json();}
    function syncURL(push=false){const url=routes.canonicalURL(location.href,base);const target=routes.parlayLocation('?'+stateQuery(state,body.date),state.type,{date:body.date,sameGame:state.sameGame});url.search=target.search;url.hash=target.hash;if(url.href!==location.href)history[push?'pushState':'replaceState'](null,'',url);}
    function render(push=false){
      if(!body)return;
      const modern=policy.isCurrent(body.date),activeTitles=titlesForDate(body.date);
      if(modern&&state.type==='plus_money')state.type='layups';
      if(modern&&state.type==='same_game'){state.type='all';state.sameGame=true;}
      if(!modern&&state.sameGame){state.type='same_game';state.sameGame=false;}
      if(!modern&&state.type==='layups')state.type='plus_money';
      if(!Object.hasOwn(activeTitles,state.type))state.type='all';
      const tickets=boardRows(body).map(t=>pricedTicket(t)),counts=tabCounts(tickets,body.date),rows=filterTickets(tickets,state);
      if(modern)rows.sort((a,b)=>Number(isModelTarget(a))-Number(isModelTarget(b)));
      $('parlay-tabs').classList.toggle('pm-current-tabs',modern);
      $('parlay-same-game').hidden=!modern;$('parlay-same-game').setAttribute('aria-pressed',String(state.sameGame));$('parlay-same-game-count').textContent=counts.same_game;
      $('parlay-policy-note').textContent=modern?'Layups: -110 through +200, 1u. Mid-Range: above +200 and below +500, 0.5u. Longshots: +500 through below +1000, 0.25u. Logo Lottos: +1000 or better, 0.05u. Tiers use original saved ticket prices; same-game is an independent filter. Confirm the actual ticket quote.':'This historical slate keeps its original Plus Money / Longshots categories and stake settings. Switching sportsbooks keeps the exact picks and can change the displayed price.';
      const columnHead=document.querySelector('.pm-columns');
      if(columnHead&&modelTargets(body).length){if(columnHead.children[3])columnHead.children[3].textContent='Model / saved pricing';if(columnHead.children[4])columnHead.children[4].textContent='Win estimates';}
      // Search, price and probability filters never hide losses from the category record.
      const tracked=categoryTickets(body.tickets,state.type).filter(t=>!state.sameGame||isSameGame(t));
      const targetCount=categoryTickets(modelTargets(body),state.type).filter(t=>!state.sameGame||isSameGame(t)).length;
      $('parlay-record').innerHTML=results.parlayRecordHTML(tracked,{label:activeTitles[state.type]+(state.sameGame?' · same game':'')+' · posted-parlay record'})+(window.SBOS_UNITS?.recordHTML(tracked,{kind:'parlays'})||'')+(targetCount?`<p class="pm-model-record-note">${targetCount} provisional model target${targetCount===1?' is':'s are'} unquoted and excluded from this hit-rate and unit record.</p>`:'');
      $('parlay-tabs').innerHTML=Object.entries(activeTitles).map(([key,title])=>`<button type="button" role="tab" id="parlay-tab-${key}" aria-controls="parlay-panel" aria-selected="${state.type===key}" tabindex="${state.type===key?0:-1}" data-parlay-tab="${key}"><span>${title}</span><strong>${counts[key]}</strong></button>`).join('');
      $('parlay-panel').setAttribute('aria-labelledby','parlay-tab-'+state.type);
      $('combinations-heading').textContent=activeTitles[state.type]+(state.sameGame?' · Same game':'');$('parlay-count').textContent=`${rows.length} of ${counts[state.type]} ${targetCount?'parlays / model targets':'parlays'}`;
      $('parlay-favorites').setAttribute('aria-pressed',String(state.favorite));$('parlay-favorite-count').textContent=counts.favorites;
      for(const el of document.querySelectorAll('[data-parlay-filter]'))el.value=state[el.dataset.parlayFilter]||'';
      let ideasHeading=false;target.innerHTML=withdrawalNoticeHTML(body.date)+(rows.length?rows.map(t=>{const heading=modern&&isModelTarget(t)&&!ideasHeading?(ideasHeading=true,'<div class="pm-ideas-heading"><h3>Unquoted model ideas</h3><p>Conditional research targets, not priced picks. No payout, stake or official record.</p></div>'):'';return heading+ticketRow(t,ticketOrdinal(tickets,t)-1,{open:opened.has(t.id)});}).join(''):emptyStateHTML(counts,state));
      syncURL(push);window.SBOS_PICK_RESEARCH?.hydrate(target);
    }
    function options(){
      const tickets=boardRows(body),legs=tickets.flatMap(t=>t.legs),games=new Map(legs.map(r=>[eventId(r),[r.team,r.opponent].sort().join(' vs ')]));
      for(const [id,values] of [['parlay-legs',[...new Set(tickets.map(t=>String(t.legs.length)))].sort().map(n=>[n,n+' legs'])],['parlay-market',[...new Set(legs.map(r=>r.market))].sort().map(m=>[m,markets[m]||m])],['parlay-game',[...games].sort((a,b)=>a[1].localeCompare(b[1]))],['parlay-team',[...new Set(legs.map(r=>r.team))].sort().map(t=>[t,t])]]){
        $(id).innerHTML='<option value="all">All '+({ 'parlay-legs':'leg counts','parlay-market':'stats','parlay-game':'games','parlay-team':'teams'}[id])+'</option>'+values.map(([value,name])=>`<option value="${escape(value)}">${escape(name)}</option>`).join('');
      }
      for(const key of ['legs','market','game','team'])if(![...document.querySelector(`[data-parlay-filter="${key}"]`).options].some(o=>o.value===state[key]))state[key]='all';
    }
    async function loadDate(){
      const n=++serial,entry=editions.find(e=>e.date===dateSelect.value);target.textContent='Loading the published parlay board…';
      const saved=await json(new URL(safePath(entry),dataRoot),true);if(n!==serial)return;
      if(!['public-plus-money-1','public-plus-money-2'].includes(saved.schemaVersion)||saved.version!==entry.version||saved.date!==entry.date||!Array.isArray(saved.tickets))throw Error('Publication mismatch');
      if(saved.modelTargets!==undefined&&(!Array.isArray(saved.modelTargets)||saved.modelTargets.some(t=>!isModelTarget(t))))throw Error('Invalid model-target publication');
      if(body?.date!==saved.date)opened.clear();body=applyWithdrawals(saved);options();
      context.textContent=`Odds refreshed at ${stamp(body.quoteObservedAt)} · Board updated ${stamp(body.updatedAt)}.`;
      $('parlay-price-note').textContent=body.priceNote;render();
      tracker.setRows(boardRows(body).flatMap(t=>t.legs));
    }
    function filterChange(event){const key=event.target.dataset?.parlayFilter;if(!key)return;state=readState('?'+new URLSearchParams({...state,[key]:event.target.value,favorite:state.favorite?'1':'0',sameGame:state.sameGame?'1':'0'}));render();}
    $('parlay-filters').addEventListener('input',event=>{if(event.target.tagName==='INPUT')filterChange(event);});
    $('parlay-filters').addEventListener('change',event=>{if(event.target.tagName==='SELECT')filterChange(event);});
    $('parlay-same-game').addEventListener('click',()=>{state.sameGame=!state.sameGame;render(true);});
    $('parlay-favorites').addEventListener('click',()=>{state.favorite=!state.favorite;render();});
    $('parlay-reset').addEventListener('click',()=>{state={...defaults,type:state.type};render();});
    $('parlay-tabs').addEventListener('click',event=>{const tab=event.target.closest('[data-parlay-tab]');if(!tab)return;state.type=tab.dataset.parlayTab;render(true);$('parlay-tab-'+state.type).focus({preventScroll:true});});
    $('parlay-tabs').addEventListener('keydown',event=>{const tab=event.target.closest('[data-parlay-tab]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const keys=Object.keys(titlesForDate(body?.date)),i=keys.indexOf(tab.dataset.parlayTab),next=event.key==='Home'?0:event.key==='End'?keys.length-1:(i+(event.key==='ArrowRight'?1:-1)+keys.length)%keys.length;state.type=keys[next];render(true);$('parlay-tab-'+state.type).focus({preventScroll:true});});
    target.addEventListener('toggle',event=>{const row=event.target;if(row.matches('details[data-parlay-id]'))row.open?opened.add(row.dataset.parlayId):opened.delete(row.dataset.parlayId);},true);
    window.addEventListener('popstate',()=>{state=readState(location.search,location.hash);const date=new URL(location.href).searchParams.get('date');if(date&&date!==body?.date&&editions.some(e=>e.date===date)){dateSelect.value=date;loadDate().catch(showError);}else render();});
    try{
      withdrawals=await json(new URL('assets/parlay-withdrawals.json',base));
      if(withdrawals.schemaVersion!=='sbos-parlay-withdrawals-1'||!Array.isArray(withdrawals.withdrawals))throw Error('Invalid withdrawal register');
      const index=await json(new URL('manifest.json',dataRoot));if(index.schemaVersion!=='public-plus-money-manifest-1')throw Error('Invalid publication');
      const latest=new Map();for(const e of index.editions){safePath(e);latest.set(e.date,e);}editions=[...latest.values()].sort((a,b)=>b.date.localeCompare(a.date));
      if(!editions.length){target.textContent='No parlays have been published yet.';return;}
      dateSelect.innerHTML=editions.map(e=>`<option value="${escape(e.date)}">${escape(e.date)}</option>`).join('');
      const requested=new URL(location.href).searchParams.get('date');if(editions.some(e=>e.date===requested))dateSelect.value=requested;
      dateSelect.disabled=false;await loadDate();dateSelect.addEventListener('change',()=>loadDate().catch(showError));
      window.addEventListener('sbos:bookchange',()=>render());window.addEventListener('hashchange',()=>{const next=readState(location.search,location.hash);if(next.type!==state.type||next.sameGame!==state.sameGame){state=next;render();}});$('refresh-parlays').addEventListener('click',()=>location.reload());
    }catch{showError();}
    function showError(){target.innerHTML='<p role="alert" class="site-error">The saved parlay board is unavailable. Refresh to try again.</p>';}
  }
  return {withdrawalFor,applyWithdrawals,withdrawalNoticeHTML,titles,currentTitles,titlesForDate,section,targetMinimum,isSameGame,isModelTarget,modelTargets,boardRows,targetNeedsReview,categoryTickets,emptyStateHTML,compatibilityExplanation,compatibilityHTML,ticketOrdinal,effectiveOdds,ticketGames,ticketGamesHTML,escape,label,safePath,readState,stateQuery,tabCounts,isFavorite,lowestProbability,totalSlipProbability,probabilityHTML,probabilityNoteHTML,pricedTicket,filterTickets,personalTicketRow,personalGroupsHTML,ticketRow,init};
});
