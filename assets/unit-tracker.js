/* Visitor-sized, statistical P/L at frozen published prices. No account or wager data. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./result-utils.js'):root.STARS_RESULT_UTILS,typeof module==='object'&&module.exports?require('./slate-policy.js'):root.SBOS_SLATE_POLICY);
  if(typeof module==='object'&&module.exports)module.exports=api;else{root.SBOS_UNITS=api;document.addEventListener('DOMContentLoaded',api.init);}
})(typeof window==='undefined'?this:window,function(results,policy){
  'use strict';
  const finite=v=>typeof v==='number'&&Number.isFinite(v),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const STORAGE='sbos:unit-tracker:v1',defaults=Object.freeze({layup:2,lob:1,plus_money:1,longshot:.25,personal:.5,free_throw:2,floater:1,daily_lob:.75,parlay_layup:1,mid_range:.5,parlay_longshot:.25,logo_lotto:.05});
  const titles={layup:'Historical Daily Layups',lob:'Historical Daily Lobs',plus_money:'Historical Plus Money parlays',longshot:'Historical Longshots',personal:'Ry’s personal parlays',free_throw:'Daily Free Throws',floater:'Daily Floaters',daily_lob:'Daily Lobs',parlay_layup:'Layups parlays',mid_range:'Mid-Range parlays',parlay_longshot:'Longshots parlays',logo_lotto:'Logo Lottos'};
  const decimal=odds=>finite(odds)&&Math.abs(odds)>=100?1+(odds>0?odds/100:100/Math.abs(odds)):null;
  function preferences(saved){
    const sizes={...defaults};for(const key of Object.keys(sizes))if(finite(saved?.sizes?.[key])&&saved.sizes[key]>=0&&saved.sizes[key]<=10000)sizes[key]=saved.sizes[key];
    // An explicit saved null keeps the visitor's units-only display preference.
    const hasDollarChoice=saved!=null&&Object.prototype.hasOwnProperty.call(saved,'unitDollars');
    return {unitDollars:!hasDollarChoice?10:finite(saved.unitDollars)&&saved.unitDollars>0&&saved.unitDollars<=1000000?saved.unitDollars:null,sizes};
  }
  function propType(row){
    if(policy?.isCurrent(row))return {free_throws:'free_throw',floaters:'floater',lobs:'daily_lob'}[policy.dailyTier(row)]||null;
    return row.group==='research'&&row.category==='value_safe'?'layup':row.group==='research'&&row.category==='high_probability_aggressive'?'lob':null;
  }
  function benchType(row){return row.group==='research'&&row.category==='honorable_mention'&&policy?.isCurrent(row)?{free_throws:'free_throw',floaters:'floater',lobs:'daily_lob'}[policy.priceTier(policy.originalDailyOdds(row))]||null:null;}
  function ticketType(row){
    if(row?.priceKind==='model_target')return null;
    if(policy?.isCurrent(row))return {layups:'parlay_layup',mid_range:'mid_range',longshots:'parlay_longshot',logo_lottos:'logo_lotto'}[policy.parlayTier(row)]||null;
    return row.section==='longshots'?'longshot':'plus_money';
  }
  function propOutcome(row){
    if(results.isStatisticalHit(row))return 'win';
    if(results.isStatisticalMiss(row))return 'loss';
    if(row.result?.eventStatus==='final'&&row.result.statisticalOutcome==='push')return 'push';
    if(['out','dnp','canceled','postponed'].includes(row.result?.statisticalOutcome))return 'excluded';
    return 'pending';
  }
  function ticketDecimal(ticket){
    return results.parlayDecimal(ticket);
  }
  function payout(americanOdds,{type='plus_money',settings=preferences(),voided=false}={}){
    const p=preferences(settings),stakeUnits=p.sizes[type],price=voided?1:decimal(americanOdds);
    if(!finite(stakeUnits)||price===null)return {available:false,stakeUnits:stakeUnits??null};
    const profitUnits=stakeUnits*(price-1),payoutUnits=stakeUnits*price;
    if(!finite(profitUnits)||!finite(payoutUnits))return {available:false,stakeUnits};
    return {available:true,stakeUnits,profitUnits,payoutUnits,profitDollars:p.unitDollars===null?null:profitUnits*p.unitDollars,payoutDollars:p.unitDollars===null?null:payoutUnits*p.unitDollars,voided};
  }
  function summarize(rows,{kind='props',personal=false,settings=preferences(),scope,bench=false}={}){
    scope=results.trackingScope(rows,scope);
    rows=results.trackingRows(rows,{scope});
    const prefs=preferences(settings),unique=new Map();
    for(const row of rows){if(row.priceKind==='model_target'||row.recordKind==='selection_snapshot')continue;const type=kind==='parlays'?(personal?'personal':ticketType(row)):bench?benchType(row):propType(row);if(!type)continue;
      const id=row.id||JSON.stringify(kind==='parlays'?row.legs?.map(r=>[r.date,r.canonicalEventId||r.eventId,r.playerId,r.market,r.operator,r.line]):[row.date,row.canonicalEventId||row.eventId,row.playerId,row.market,row.operator,row.line]);
      unique.set(id,{row,type});
    }
    const total={netUnits:0,netDollars:null,decided:0,pending:0,review:0,unpriced:0,excluded:0,openUnits:0,settledStake:0,liveHits:0,liveMisses:0,indicative:false,stakes:{}};
    for(const {row,type} of unique.values()){
      const stake=prefs.sizes[type],grade=kind==='parlays'?results.parlayOutcome(row):{outcome:propOutcome(row),live:results.isLiveHit(row)||results.isLiveMiss(row)},outcome=grade.outcome;
      total.stakes[type]=stake;
      if(kind==='parlays'&&!personal)total.indicative=true;
      if(outcome==='pending'){total.pending++;total.openUnits+=stake;continue;}
      if(outcome==='review'){total.review++;continue;}
      if(outcome==='excluded'||outcome==='void'){total.excluded++;continue;}
      if(outcome==='push'){total.settledStake+=stake;continue;}
      const price=kind==='parlays'?ticketDecimal(row):decimal(row.americanOdds);
      // A losing ticket costs its stake even if its winning payout was not saved.
      if(outcome==='win'&&price===null){total.unpriced++;continue;}
      total.decided++;total.settledStake+=stake;
      total.netUnits+=outcome==='win'?stake*(price-1):-stake;
      if(outcome==='win'&&grade.live)total.liveHits++;
      if(outcome==='loss'&&grade.live)total.liveMisses++;
    }
    if(Math.abs(total.netUnits)<1e-10)total.netUnits=0;
    total.netDollars=prefs.unitDollars===null?null:total.netUnits*prefs.unitDollars;return total;
  }
  const units=v=>(v>0?'+':v<0?'−':'')+Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+'u';
  const dollars=v=>(v>0?'+':v<0?'−':'')+new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Math.abs(v));
  const size=v=>Number(v.toFixed(4)).toString()+'u';
  let prefs=preferences(),serial=0,initialized=false,personalPrices=[];const summaries=new Map();
  function firstPersonalPrice(ticket,records=personalPrices){
    const ids=(ticket.legs||[]).map(r=>r.id).sort(),quote=records.find(r=>r.ticketId===ticket.id&&JSON.stringify(r.legIds)===JSON.stringify(ids));
    return {...ticket,priceKind:'posted',americanOdds:quote?.americanOdds??null};
  }
  // Public accounting is always flat 1u, independent of stored visitor settings.
  // Never manufacture a full-ticket quote by multiplying leg prices.
  function publicSummary(rows,{kind='props',personal=false,scope,bench=false}={}){
    const eligible=results.trackingRows(rows,{scope}).filter(row=>row.priceKind!=='model_target'&&row.recordKind!=='selection_snapshot'&&(kind==='parlays'||row.group==='research'&&(bench?row.category==='honorable_mention':['value_safe','high_probability_aggressive'].includes(row.category))));
    const unique=[...new Map(eligible.map(row=>[row.id||JSON.stringify(row),row])).values()];
    const s={total:unique.length,wins:0,losses:0,pushes:0,voids:0,pending:0,unpriced:0,priced:0,netUnits:0,roi:null};
    for(const row of unique){
      let outcome,price;
      if(kind==='parlays'){
        const legs=row.legs||[];
        if(!legs.length||legs.some(leg=>!results.isVoidedLeg(leg)&&leg.result?.eventStatus!=='final')){s.pending++;continue;}
        outcome=results.parlayOutcome(row).outcome;
        price=row.priceKind==='posted'&&!results.parlayLegs(row).voided.length?decimal(row.americanOdds):null;
      }else{
        const r=row.result||{};
        outcome=['out','dnp','canceled'].includes(r.statisticalOutcome)?'void':r.eventStatus==='final'?({win:'win',loss:'loss',push:'push'}[r.statisticalOutcome]||'pending'):'pending';
        price=decimal(policy.originalDailyOdds(row));
      }
      if(outcome==='void'||outcome==='excluded'){s.voids++;continue;}
      if(outcome==='push'){s.pushes++;continue;}
      if(!['win','loss'].includes(outcome)){s.pending++;continue;}
      s[outcome==='win'?'wins':'losses']++;
      // Exclude both unpriced wins and losses, so missing prices cannot bias ROI.
      if(price===null){s.unpriced++;continue;}
      s.priced++;s.netUnits+=outcome==='win'?price-1:-1;
    }
    if(Math.abs(s.netUnits)<1e-10)s.netUnits=0;
    s.roi=s.priced?s.netUnits/s.priced:null;return s;
  }
  function contents(rows,options){
    const testSlate=rows.length>0&&rows.every(results.isTestSlate)&&options.scope!=='cumulative';
    if(options.personal)rows=rows.map(t=>firstPersonalPrice(t));
    const s=publicSummary(rows,options),label=testSlate?'Test-run hypothetical':options.bench?'Bench hypothetical':'Hypothetical';
    return '<div class="unit-record-top"><span class="unit-net '+(s.netUnits>0?'positive':s.netUnits<0?'negative':'')+'">'+label+' flat-1u return <strong>'+(s.priced?units(s.netUnits):'Unavailable')+'</strong></span><span>'+(s.roi===null?'ROI unavailable':(s.roi*100).toFixed(1)+'% ROI')+'</span></div><p class="unit-record-note">'+s.priced+' priced, finalized decisions · 1u risked per pick or ticket · original posted odds. '+s.unpriced+' finalized decisions excluded from return: original full price unavailable or void-adjusted ticket price unverified.</p><p class="unit-record-basis">Wins and losses only in the ROI stake denominator; pushes and voids return the stake and are excluded. Pending and live outcomes do not enter returns. '+(options.bench?'Bench research is excluded from official pick records. No stake recommendation. ':testSlate?'Excluded from cumulative records. ':'')+'Hypothetical performance, not actual bets, personal profit or an account balance. Stat corrections can change results. Personal stakes and dollar tracking belong in Bankroll Breakdown.</p>';
  }
  function recordHTML(rows,options={}){
    if(options.kind==='parlays')return '';
    rows=rows.filter(row=>row.recordKind!=='selection_snapshot');
    if(!rows.length||options.kind!=='parlays'&&!rows.some(row=>row.group==='research'&&(options.bench?row.category==='honorable_mention':['value_safe','high_probability_aggressive'].includes(row.category))))return '';
    const token=String(++serial);summaries.set(token,{rows,options});
    return '<div class="unit-record" data-unit-summary="'+token+'" aria-live="polite">'+contents(rows,options)+'</div>';
  }
  function refresh(){
    for(const [token,state] of summaries){const node=document.querySelector('[data-unit-summary="'+token+'"]');if(node)node.innerHTML=contents(state.rows,state.options);else summaries.delete(token);}
    for(const node of document.querySelectorAll('[data-pick-unit-type]'))node.innerHTML=stakeText(node.dataset.pickUnitType);
    for(const node of document.querySelectorAll('[data-parlay-payout]'))node.innerHTML=payoutContents(Number(node.dataset.parlayOdds),node.dataset.parlayPayoutType,node.dataset.parlayRefund==='true');
  }
  function stakeText(type){const stake=prefs.sizes[type];return finite(stake)?size(stake)+(prefs.unitDollars===null?'':' · $'+Number((stake*prefs.unitDollars).toFixed(2)).toLocaleString('en-US')):'';}
  function stakeHTML(){return '';}
  function pickPayoutHTML(){return '';}
  const amount=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:Number.isInteger(Math.round(v*100)/100)?0:2,maximumFractionDigits:2}).format(v);
  function payoutContents(americanOdds,type,voided,settings=prefs){
    const p=payout(americanOdds,{type,settings,voided});if(!p.available)return '<small>Payout unavailable</small>';
    const stake=size(p.stakeUnits),profit=p.profitDollars===null?size(p.profitUnits):amount(p.profitDollars),total=p.payoutDollars===null?size(p.payoutUnits):amount(p.payoutDollars);
    return '<small class="pm-win-amount">'+esc(stake)+(voided?' refunded': ' wins '+esc(profit))+'</small><small class="pm-total-payout">'+esc(total)+' '+(voided?'Refund':'Payout')+'</small>'+(p.profitDollars===null?'<button type="button" class="pm-set-unit" data-unit-settings-open>Set your unit $</button>':'');
  }
  function payoutHTML(){return '';}
  function init(){
    if(initialized)return;initialized=true;
    const script=document.querySelector('script[data-unit-tracker]');
    if(script)fetch(new URL('../data/personal-tracking-prices.json',script.src),{credentials:'omit',cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Price record unavailable');return r.json();}).then(body=>{if(body.schemaVersion!=='public-personal-tracking-prices-1'||!Array.isArray(body.tickets))return;personalPrices=body.tickets;refresh();}).catch(()=>{});
  }
  return {publicSummary,defaults,preferences,summarize,recordHTML,stakeHTML,pickPayoutHTML,payout,payoutHTML,refresh,init,decimal,ticketDecimal,propType,benchType,ticketType,units,dollars,firstPersonalPrice};
});
