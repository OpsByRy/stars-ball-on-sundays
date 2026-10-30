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
    return {unitDollars:finite(saved?.unitDollars)&&saved.unitDollars>0&&saved.unitDollars<=1000000?saved.unitDollars:null,sizes};
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
    if(row.result?.eventStatus==='final'&&row.result.statisticalOutcome==='loss')return 'loss';
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
    for(const row of rows){if(row.priceKind==='model_target')continue;const type=kind==='parlays'?(personal?'personal':ticketType(row)):bench?benchType(row):propType(row);if(!type)continue;
      const id=row.id||JSON.stringify(kind==='parlays'?row.legs?.map(r=>[r.date,r.canonicalEventId||r.eventId,r.playerId,r.market,r.operator,r.line]):[row.date,row.canonicalEventId||row.eventId,row.playerId,row.market,row.operator,row.line]);
      unique.set(id,{row,type});
    }
    const total={netUnits:0,netDollars:null,decided:0,pending:0,review:0,unpriced:0,excluded:0,openUnits:0,settledStake:0,liveHits:0,indicative:false,stakes:{}};
    for(const {row,type} of unique.values()){
      const stake=prefs.sizes[type],grade=kind==='parlays'?results.parlayOutcome(row):{outcome:propOutcome(row),live:results.isLiveHit(row)},outcome=grade.outcome;
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
  function contents(rows,options){
    const testSlate=rows.length>0&&rows.every(results.isTestSlate)&&options.scope!=='cumulative';
    if(options.personal)rows=rows.map(t=>firstPersonalPrice(t));
    const s=summarize(rows,{...options,settings:prefs}),policy=Object.entries(s.stakes).map(([type,stake])=>size(stake)+' / '+titles[type].replace(/parlays$/,'parlay')).join(' · ');
    return '<div class="unit-record-top"><span class="unit-net '+(s.netUnits>0?'positive':s.netUnits<0?'negative':'')+'">'+(testSlate?'Test-run net ':options.bench?'Bench hypothetical net ':s.unpriced?'Partial net ':s.indicative?'Estimated net ':'Tracked net ')+'<strong>'+units(s.netUnits)+'</strong>'+(s.netDollars===null?'':'<span> · '+dollars(s.netDollars)+'</span>')+'</span><button type="button" data-unit-settings-open>'+(prefs.unitDollars===null?'Set your units':'Your unit · $'+Number(prefs.unitDollars.toFixed(2)).toLocaleString('en-US'))+'</button></div><p class="unit-record-note">'+esc(policy)+(s.pending?' · '+size(s.openUnits)+' pending':'')+(s.liveHits?' · includes '+s.liveHits+' live '+(s.liveHits===1?'hit':'hits'):'')+(s.review?' · '+s.review+' ticket'+(s.review===1?'':'s')+' awaiting settlement review':'')+(s.unpriced?' · '+s.unpriced+' winning '+(s.unpriced===1?'return':'returns')+' excluded: price unavailable':'')+'.</p><p class="unit-record-basis">'+(options.bench?'Hypothetical Bench research only; excluded from official pick records. No stake recommendation. ':testSlate?'Hypothetical test-run return at your current stake settings. Excluded from cumulative win-rate and unit P/L totals. ':s.indicative?'Combined estimates use saved leg prices; offered SGP payouts can differ. ':options.personal?'Calculated at the first saved full-ticket quote. ':'Calculated at original saved pick prices. ')+'Statistical P/L; no bets or account balances recorded.</p>';
  }
  function recordHTML(rows,options={}){
    if(!rows.length||options.kind!=='parlays'&&!rows.some(options.bench?benchType:propType))return '';
    const token=String(++serial);summaries.set(token,{rows,options});
    return '<div class="unit-record" data-unit-summary="'+token+'" aria-live="polite">'+contents(rows,options)+'</div>';
  }
  function refresh(){
    for(const [token,state] of summaries){const node=document.querySelector('[data-unit-summary="'+token+'"]');if(node)node.innerHTML=contents(state.rows,state.options);else summaries.delete(token);}
    for(const node of document.querySelectorAll('[data-pick-unit-type]'))node.innerHTML=stakeText(node.dataset.pickUnitType);
    for(const node of document.querySelectorAll('[data-parlay-payout]'))node.innerHTML=payoutContents(Number(node.dataset.parlayOdds),node.dataset.parlayPayoutType,node.dataset.parlayRefund==='true');
  }
  function stakeText(type){const stake=prefs.sizes[type];return finite(stake)?size(stake)+(prefs.unitDollars===null?'':' · $'+Number((stake*prefs.unitDollars).toFixed(2)).toLocaleString('en-US')):'';}
  function stakeHTML(row,{type=propType(row)}={}){return type?'<small class="row-unit-size" data-pick-unit-type="'+esc(type)+'">'+stakeText(type)+'</small>':'';}
  // A personal leg's single-bet illustration does not create a tracked wager.
  function pickPayoutHTML(row,{type=propType(row)||(row.group==='ry'?'personal':null),settings=prefs}={}){
    if(!type)return '';
    return (row.group==='ry'?'<small class="pick-return-kind">Single return</small>':'')+payoutHTML(row.americanOdds,{type,voided:results.isVoidedLeg(row),settings});
  }
  const amount=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:Number.isInteger(Math.round(v*100)/100)?0:2,maximumFractionDigits:2}).format(v);
  function payoutContents(americanOdds,type,voided,settings=prefs){
    const p=payout(americanOdds,{type,settings,voided});if(!p.available)return '<small>Payout unavailable</small>';
    const stake=size(p.stakeUnits),profit=p.profitDollars===null?size(p.profitUnits):amount(p.profitDollars),total=p.payoutDollars===null?size(p.payoutUnits):amount(p.payoutDollars);
    return '<small class="pm-win-amount">'+esc(stake)+(voided?' refunded': ' wins '+esc(profit))+'</small><small class="pm-total-payout">'+esc(total)+' '+(voided?'Refund':'Payout')+'</small>'+(p.profitDollars===null?'<button type="button" class="pm-set-unit" data-unit-settings-open>Set your unit $</button>':'');
  }
  function payoutHTML(americanOdds,{type='plus_money',voided=false,settings=prefs}={}){
    return '<span class="pm-payout" data-parlay-payout data-parlay-odds="'+(finite(americanOdds)?americanOdds:'')+'" data-parlay-payout-type="'+esc(type)+'" data-parlay-refund="'+voided+'">'+payoutContents(americanOdds,type,voided,settings)+'</span>';
  }
  function dialogHTML(){
    return '<dialog id="unit-settings" class="unit-settings" aria-labelledby="unit-settings-title"><form method="dialog"><div class="unit-settings-title"><h2 id="unit-settings-title">Your units</h2><button type="submit" formnovalidate aria-label="Close unit settings">×</button></div><p>Choose your dollar value per unit and the stake sizes used in the trackers. These settings apply to past and upcoming selections in each view.</p><label class="unit-dollar-label">1 unit = $<input type="number" inputmode="decimal" min="0.01" max="1000000" step="0.01" data-unit-dollars placeholder="Enter an amount"></label><fieldset><legend>Stake size in units</legend>'+Object.entries(titles).map(([key,title])=>'<label>'+esc(title)+'<span><input type="number" inputmode="decimal" min="0" max="10000" step="any" data-unit-size="'+key+'" aria-label="'+esc(title)+' stake in units">u</span></label>').join('')+'</fieldset><p class="unit-settings-status" role="status">Saved on this device. No account required.</p><div class="unit-settings-actions"><button type="button" data-unit-reset>Reset stake sizes</button><button type="submit" class="unit-done">Done</button></div></form></dialog>';
  }
  function fillDialog(){const dialog=document.getElementById('unit-settings');dialog.querySelector('[data-unit-dollars]').value=prefs.unitDollars??'';for(const input of dialog.querySelectorAll('[data-unit-size]'))input.value=prefs.sizes[input.dataset.unitSize];}
  function save(){
    try{localStorage.setItem(STORAGE,JSON.stringify(prefs));}catch{document.querySelector('.unit-settings-status').textContent='Settings apply for this visit; this browser is not saving them.';}
    refresh();
  }
  function init(){
    if(initialized)return;initialized=true;
    try{prefs=preferences(JSON.parse(localStorage.getItem(STORAGE)||'null'));}catch{}
    document.body.insertAdjacentHTML('beforeend',dialogHTML());refresh();
    const script=document.querySelector('script[data-unit-tracker]');
    if(script)fetch(new URL('../data/personal-tracking-prices.json',script.src),{credentials:'omit',cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Price record unavailable');return r.json();}).then(body=>{if(body.schemaVersion!=='public-personal-tracking-prices-1'||!Array.isArray(body.tickets))return;personalPrices=body.tickets;refresh();}).catch(()=>{});
    document.addEventListener('click',event=>{if(event.target.closest('[data-unit-settings-open]')){event.preventDefault();event.stopPropagation();fillDialog();document.getElementById('unit-settings').showModal();}if(event.target.closest('[data-unit-reset]')){prefs.sizes={...defaults};fillDialog();save();}});
    document.getElementById('unit-settings').addEventListener('input',event=>{
      const input=event.target;if(!input.matches('[data-unit-dollars],[data-unit-size]'))return;
      const value=input.value===''?null:Number(input.value),isDollar=input.hasAttribute('data-unit-dollars'),valid=isDollar?value===null||finite(value)&&value>0&&value<=1000000:finite(value)&&value>=0&&value<=10000;
      input.setAttribute('aria-invalid',String(!valid));if(!valid)return;
      if(isDollar)prefs.unitDollars=value;else prefs.sizes[input.dataset.unitSize]=value;save();
    });
    window.addEventListener('storage',event=>{if(event.key===STORAGE){try{prefs=preferences(JSON.parse(event.newValue));refresh();}catch{}}});
  }
  return {defaults,preferences,summarize,recordHTML,stakeHTML,pickPayoutHTML,payout,payoutHTML,refresh,init,decimal,ticketDecimal,propType,benchType,ticketType,units,dollars,firstPersonalPrice};
});
