/* Saved statistical all-win estimates. No pricing, selection or inference. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./result-utils.js'):root.STARS_RESULT_UTILS);if(typeof module==='object'&&module.exports)module.exports=api;else root.SBOS_TICKET_PROBABILITY=api;})(typeof window!=='undefined'?window:this,function(results){
  'use strict';
  const finite=x=>typeof x==='number'&&Number.isFinite(x),prob=x=>finite(x)&&x>=0&&x<=1;
  const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),text=x=>typeof x==='string'&&x.trim().length>0;
  const slateClock=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
  function slateDate(start){const parts=Object.fromEntries(slateClock.formatToParts(new Date(Number(start/1000000n))).map(p=>[p.type,p.value]));return parts.year+'-'+parts.month+'-'+parts.day;}
  function clock(x){
    const m=typeof x==='string'&&x.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/);
    if(!m||Number(m[2])>23||Number(m[3])>59||Number(m[4]||0)>59)return null;
    const day=Date.parse(m[1]+'T12:00:00Z'),base=Date.parse(m[1]+'T'+m[2]+':'+m[3]+':'+(m[4]||'00')+m[6]);
    if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==m[1]||!Number.isFinite(base))return null;
    return BigInt(base)*1000000n+BigInt((m[5]||'').padEnd(9,'0'));
  }
  const atoms={PTS:['PTS','3PM'],AST:['AST'],REB:['REB'],'3PM':['3PM'],PA:['PTS','3PM','AST'],PR:['PTS','3PM','REB'],RA:['REB','AST'],PRA:['PTS','3PM','REB','AST'],BLK:['BLK'],STL:['STL']};
  const assumptions=Object.freeze(['Conditional on all players appearing; participation probability is not estimated.','All original legs must win. Pushes and voids are not counted as wins.','Independence across different games is an approximation; shared factors can still affect outcomes.','This is a statistical estimate, not a sportsbook-implied probability, offered price, payout forecast or guarantee.']);
  function identity(r){
    const event=r?.canonicalEventId||r?.eventId,c=results.normalizeContract(r);
    if(!c||typeof event!=='string'||!/^nba:\d{10}$/.test(event)||typeof r.playerId!=='string'||!/^nba:[1-9]\d{0,9}$/.test(r.playerId)||!text(r.book)||typeof r.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(Date.parse(r.date+'T12:00:00Z'))||new Date(r.date+'T12:00:00Z').toISOString().slice(0,10)!==r.date||
      r.eventId!==undefined&&r.eventId!==null&&typeof r.eventId!=='string'||r.canonicalEventId&&typeof r.eventId==='string'&&r.eventId.startsWith('nba:')&&r.eventId!==r.canonicalEventId||
      r.period&&r.period!=='full_game'||r.product&&r.product!=='sportsbook'||clock(r.startTime)===null)return null;
    if(slateDate(clock(r.startTime))!==r.date)return null;
    // Win-outcome equivalence is for duplicate detection only. Exact joint
    // binding retains the original normalized operator/line and push contract.
    const over=c.operator.startsWith('>'),line=over?(c.operator==='>'?Math.floor(c.line)+1:Math.ceil(c.line)):(c.operator==='<'?Math.ceil(c.line)-1:Math.floor(c.line));
    if(r.overtime!==undefined&&r.overtime!==null&&typeof r.overtime!=='boolean'||r.settlementTerms!==undefined&&r.settlementTerms!==null&&typeof r.settlementTerms!=='string')return null;
    return {event,date:r.date,player:r.playerId,market:c.market,canPush:['>','<'].includes(c.operator)&&Number.isInteger(c.line),
      outcomeKey:JSON.stringify([r.date,event,r.playerId,c.market,over?'>=':'<=',line]),
      key:JSON.stringify(['exact-stat-contract-2',r.date,event,r.playerId,c.market,c.operator,c.line,r.book,'full_game','sportsbook',r.overtime??null,r.settlementTerms??null,clock(r.startTime).toString()])};
  }
  const contractKey=r=>identity(r)?.key??null;
  function held(r){return ['review','unavailable'].includes(r.confidenceUpdate?.status)||['does_not_qualify','unavailable'].includes(r.confidenceUpdate?.qualification)||['held','unavailable'].includes(r.publicDisplay?.state);}
  function jointReviewCurrent(rows,reviewedAt){
    const reviewed=clock(reviewedAt);if(reviewed===null)return false;
    return rows.every(r=>{
      const e=r.confidenceUpdate?r.confidenceUpdate.estimate:r.estimate;
      const clocks=[...(r.confidenceUpdate?[r.confidenceUpdate.checkedAt]:[]),...(e?.asOf!==undefined?[e.asOf]:[]),...(e?.completedAt!=null?[e.completedAt]:[])];
      return clocks.every(value=>clock(value)!==null&&clock(value)<=reviewed)&&!(e?.modelVersion&&r.modelVersion&&e.modelVersion!==r.modelVersion);
    });
  }
  function marginal(r,id,now){
    if(held(r))return {reason:'leg_review_hold'};
    const latest=!!r.confidenceUpdate,e=latest?r.confidenceUpdate.estimate:r.estimate;
    if(!e||!prob(e.winProbability))return {reason:latest?'latest_probability_missing':'leg_probability_missing'};
    if(e.probabilitySource!==undefined&&e.probabilitySource!=='model')return {reason:'not_a_model_probability'};
    // Explicit scope must match the supported per-player conditional contract.
    // Unrecorded legacy scope is an assumption, never a fabricated source flag.
    if(e.conditionalOnAppearing!==undefined&&e.conditionalOnAppearing!==true||['scope','forecastScope','probabilityScope','conditionalOnAllPlayersAppearing'].some(k=>Object.hasOwn(e,k)))return {reason:'forecast_scope_unverified'};
    if(!['provisional','validated'].includes(e.status))return {reason:'estimate_status_unverified'};
    const asOf=clock(e.asOf),completed=e.completedAt==null?null:clock(e.completedAt),start=clock(r.startTime);
    if(asOf===null||asOf>=start||asOf>now||e.completedAt!=null&&(completed===null||completed<asOf||completed>=start||completed>now)||
      latest&&clock(r.confidenceUpdate.checkedAt)!==asOf)return {reason:'forecast_clock_unverified'};
    if(e.modelVersion&&r.modelVersion&&e.modelVersion!==r.modelVersion)return {reason:'forecast_version_conflict'};
    const complete=e.pushProbability!==undefined||e.lossProbability!==undefined;
    if(complete&&(!prob(e.pushProbability)||!prob(e.lossProbability)||Math.abs(e.winProbability+e.pushProbability+e.lossProbability-1)>1e-7||!id.canPush&&e.pushProbability>1e-7))return {reason:'invalid_probability_mass'};
    return {p:e.winProbability,noLoss:complete?e.winProbability+e.pushProbability:null,source:{legId:r.id??null,contractKey:id.key,
      estimateSource:latest?'latest_saved_review':'original_saved_estimate',asOf:e.asOf,completedAt:e.completedAt??null,modelVersion:e.modelVersion??r.modelVersion??null,
      quoteObservedAt:r.priceCapturedAt??r.capturedAt??null,reviewedAt:latest?r.confidenceUpdate.checkedAt:null,conditionalOnAppearing:e.conditionalOnAppearing??null,
      scopeBasis:e.conditionalOnAppearing===true?'explicit_appearance_conditional':'legacy_scope_unrecorded_assumed_conditional'}};
  }
  function joint(group,records,now){
    const keys=group.map(x=>x.id.key).sort(),candidates=records.filter(j=>j&&j.eventId===group[0].id.event&&j.date===group[0].id.date);
    if(candidates.length!==1)return {reason:candidates.length?'ambiguous_joint_group':'same_game_joint_missing'};
    const j=candidates[0],validKeys=Array.isArray(j.contractKeys)&&j.contractKeys.length===keys.length&&new Set(j.contractKeys).size===keys.length&&[...j.contractKeys].sort().every((k,i)=>k===keys[i]);
    const asOf=clock(j.asOf),completed=clock(j.completedAt),reviewed=clock(j.reviewedAt),start=group.map(x=>clock(x.row.startTime)).reduce((a,b)=>a<b?a:b);
    if(!validKeys||j.schemaVersion!=='sbos-event-joint-probability-1'||j.method!=='paired-role-residual-v1'||j.reviewStatus!=='reviewed_provisional'||
      j.validationStatus!=='reviewed_supported'||!text(j.modelVersion)||!hash(j.sourceHash)||!hash(j.artifactHash)||!Number.isInteger(j.sampleGames)||j.sampleGames<1||
      j.conditionalOnAllPlayersAppearing!==true||asOf===null||completed===null||reviewed===null||asOf>completed||completed>reviewed||reviewed>=start||reviewed>now||
      ![j.winProbability,j.pushProbability,j.lossProbability].every(prob)||Math.abs(j.winProbability+j.pushProbability+j.lossProbability-1)>1e-7||
      !group.some(x=>x.id.canPush)&&j.pushProbability>1e-7)return {reason:'joint_group_evidence_invalid'};
    if(j.winProbability===0||j.winProbability===1||!jointReviewCurrent(group.map(x=>x.row),j.reviewedAt))return {reason:'joint_group_support_or_context_unverified'};
    // Joint-engine marginals must come from its own bound distribution, not a
    // different card model or an odds-implied percentage.
    if(!Array.isArray(j.marginals)||j.marginals.length!==keys.length)return {reason:'joint_marginals_missing'};
    if(Array.from(j.marginals).some(m=>!m||typeof m!=='object'||!text(m.contractKey)||!prob(m.winProbability)))return {reason:'joint_marginals_invalid'};
    const ms=new Map(j.marginals.map(m=>[m.contractKey,m.winProbability]));
    if(ms.size!==keys.length||keys.some(k=>!prob(ms.get(k))))return {reason:'joint_marginals_invalid'};
    const ps=keys.map(k=>ms.get(k));
    if(j.winProbability<Math.max(0,ps.reduce((a,b)=>a+b,0)-ps.length+1)-1e-7||j.winProbability>Math.min(...ps)+1e-7)return {reason:'joint_marginals_incoherent'};
    return {p:j.winProbability,noLoss:j.winProbability+j.pushProbability,source:{method:j.method,modelVersion:j.modelVersion,asOf:j.asOf,completedAt:j.completedAt,
      reviewedAt:j.reviewedAt,sourceHash:j.sourceHash,artifactHash:j.artifactHash,sampleGames:j.sampleGames,contractKeys:keys,marginals:j.marginals.map(m=>({contractKey:m.contractKey,winProbability:m.winProbability})),
      conditionalOnAllPlayersAppearing:true,note:'Reviewed provisional joint artifact; support review is not proof of future calibration.'}};
  }
  function evaluate(ticket,{now=Date.now()}={}){
    const validNow=Number.isSafeInteger(now)&&now>=0&&now<=8640000000000000;
    const base={status:'unavailable',probability:null,basis:null,reason:null,groups:[],missingInputs:[],legSources:[],assumptions,participationProbability:null,
      allWinProbability:null,noLossProbability:null,pushWithoutLossProbability:null,bookmakerImpliedProbability:null,settlementWinProbability:null,
      calculatedAt:validNow?new Date(now).toISOString():null,derivation:'display_time_algebra_not_a_new_pregame_freeze'};
    const fail=reason=>({...base,reason});
    if(!validNow||!Array.isArray(ticket?.legs)||ticket.legs.length<2||ticket.legs.length>32)return fail('invalid_ticket_census');
    const rows=Array.from(ticket.legs,row=>({row,id:identity(row)}));if(rows.some(x=>!x.id))return fail('exact_native_contract_missing');
    const events=new Map();for(const x of rows){const stamp=JSON.stringify([x.id.date,clock(x.row.startTime).toString()]);if(events.has(x.id.event)&&events.get(x.id.event)!==stamp)return fail('event_schedule_conflict');events.set(x.id.event,stamp);}
    if(new Set(rows.map(x=>x.id.outcomeKey)).size!==rows.length)return fail('duplicate_outcome');
    for(let i=0;i<rows.length;i++)for(let k=i+1;k<rows.length;k++){
      const a=rows[i],b=rows[k];
      if(a.id.event===b.id.event&&a.id.player===b.id.player&&atoms[a.id.market].some(x=>atoms[b.id.market].includes(x)))return fail('overlapping_same_player_outcomes');
    }
    if(rows.some(x=>held(x.row)))return fail('leg_review_hold');
    const grouped=new Map();for(const r of rows){const key=JSON.stringify([r.id.date,r.id.event]);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(r);}
    const records=ticket.eventJointEstimates===undefined?[]:ticket.eventJointEstimates;
    if(!Array.isArray(records)||records.length>32)return fail('invalid_joint_group_records');
    const groups=[],missingInputs=[];let usedJoint=false;
    for(const group of grouped.values()){
      const read=group.length===1?marginal(group[0].row,group[0].id,BigInt(now)*1000000n):joint(group,records,BigInt(now)*1000000n);
      if(read.reason){missingInputs.push({eventId:group[0].id.event,date:group[0].id.date,legCount:group.length,reason:read.reason});continue;}
      const item={eventId:group[0].id.event,date:group[0].id.date,legCount:group.length,probability:read.p,noLossProbability:read.noLoss,source:read.source};groups.push(item);
      if(group.length===1)base.legSources.push(read.source);else usedJoint=true;
    }
    if(missingInputs.length)return {...fail(missingInputs[0].reason),groups,missingInputs};
    const allWin=groups.reduce((p,g)=>p*g.probability,1),noLoss=groups.every(g=>g.noLossProbability!==null)?groups.reduce((p,g)=>p*g.noLossProbability,1):null;
    if(allWin===0&&groups.every(g=>g.probability>0))return {...fail('probability_below_numeric_resolution'),groups};
    const changed=rows.some(x=>results.isVoidedLeg(x.row)||['postponed','canceled','dnp','out'].includes(x.row.result?.statisticalOutcome));
    return {...base,status:changed?'changed_ticket':grouped.size===1?'provisional':'approximate',probability:changed?null:allWin,allWinProbability:allWin,
      fromOriginalInputsProbability:changed?allWin:null,noLossProbability:noLoss,pushWithoutLossProbability:noLoss===null?null:Math.max(0,noLoss-allWin),
      basis:grouped.size===1?'reviewed_same_game_joint':usedJoint?'between_game_independence_with_joint_groups':'cross_game_independence',
      label:grouped.size===1?'Provisional joint all-win estimate':'Approx. all-win · independence',reason:changed?'original_ticket_changed_by_push_or_void':null,groups,
      forecastScope:'saved_pregame_not_live_conditional',settlementTermsVerified:false,settlementTermsRecorded:rows.every(x=>typeof x.row.overtime==='boolean'&&text(x.row.settlementTerms)),
      modelIdentityComplete:groups.every(g=>text(g.source.modelVersion)),conditionalScopeComplete:groups.every(g=>g.legCount>1||g.source.conditionalOnAppearing===true),jointValidated:false};
  }
  function format(value){if(!prob(value))return 'Unavailable';if(value>0&&value<.01)return '<1%';if(value<1&&value>=.995)return '>99%';return '~'+Math.round(value*100)+'%';}
  function explanation(read){
    if(read.status==='changed_ticket')return 'The calculation from original saved pregame inputs is '+format(read.fromOriginalInputsProbability)+'. A push, void or unavailable participant changed this ticket; no replacement payout probability is inferred. This calculation is not an archived whole-ticket pregame forecast.';
    if(read.status==='unavailable')return ({same_game_joint_missing:'Same-game legs need a reviewed joint forecast for this exact group; individual percentages are insufficient.',leg_review_hold:'A leg remains held by its saved review. An older estimate is not substituted.',latest_probability_missing:'The latest review has no probability. An older estimate is not substituted.',leg_probability_missing:'A saved leg probability is missing.',exact_native_contract_missing:'Exact event, player, line or pregame clock identity is missing.',not_a_model_probability:'Bookmaker-implied or scenario probabilities cannot replace model forecasts.',forecast_clock_unverified:'The saved forecast or review clocks could not be verified before scheduled tip.',invalid_probability_mass:'The saved probabilities are incomplete or inconsistent.',forecast_version_conflict:'The recorded forecast versions disagree.',forecast_scope_unverified:'The explicit forecast scope is unsupported or is not conditional on appearing.',event_schedule_conflict:'The saved dates or scheduled starts conflict for the same event.',duplicate_outcome:'The same statistical outcome appears more than once.',overlapping_same_player_outcomes:'Same-player component, combo or overlapping outcomes require correction.',joint_group_evidence_invalid:'The same-game joint record does not match these exact contracts or lacks required source, support and clock evidence.',joint_group_support_or_context_unverified:'The joint forecast has unsupported tail output or needs review against later leg information.',ambiguous_joint_group:'More than one joint record claims this same-game group.',joint_marginals_missing:'The joint model’s own marginal support is missing.',joint_marginals_invalid:'The joint model’s own marginal support is inconsistent.',joint_marginals_incoherent:'The joint forecast contradicts its own marginal probabilities.',probability_below_numeric_resolution:'The product is too small to represent reliably; it is not a model zero.'}[read.reason]||'The exact saved probability or joint-group evidence is unavailable.')+(read.missingInputs?.length>1?' '+read.missingInputs.length+' game groups have missing or unverified forecast inputs. Quote prices cannot fill those gaps.':'');
    return (read.basis==='cross_game_independence'?'Multiplication of saved leg estimates across different games.':read.basis==='between_game_independence_with_joint_groups'?'Reviewed same-game group forecasts combined with an independence approximation across different games.':'Saved correlation-aware joint forecast for this exact same-game group.')+' This estimates all original legs winning, conditional on all players appearing. Different games can still share risk. Pushes, voids and sportsbook settlement are separate; this is not a quote-implied probability, live update or guarantee.'+(read.status==='approximate'?' Calculated on display from saved pregame inputs, not a frozen whole-ticket forecast.':'')+(!read.conditionalScopeComplete?' Legacy marginal inputs do not record appearance scope; the displayed calculation assumes appearance-conditional inputs rather than asserting a verified source flag.':'')+(!read.modelIdentityComplete?' Full model-version identity is not present in every saved input.':'')+(!read.settlementTermsVerified?' Exact overtime/void terms are not verified in every saved input.':'');
  }
  return {evaluate,contractKey,jointReviewCurrent,format,explanation};
});
