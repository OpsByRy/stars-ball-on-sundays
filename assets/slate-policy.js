/* Versioned display/stake tiers. These helpers never qualify or generate picks. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SBOS_SLATE_POLICY=api;})(typeof window==='undefined'?this:window,function(){
  'use strict';
  const EFFECTIVE_DATE='2026-10-30';
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  const validOdds=n=>finite(n)&&Math.abs(n)>=100;
  const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'));
  const labels=Object.freeze({free_throws:'Free Throws',floaters:'Floaters',lobs:'Lobs',bench:'Bench',legacy_layups:'Layups',legacy_lobs:'Lobs',layups:'Layups',mid_range:'Mid-Range',longshots:'Longshots',logo_lottos:'Logo Lottos',legacy_plus_money:'Plus Money',legacy_longshots:'Longshots'});
  function dateOf(row){
    if(validDate(row?.date))return row.date;
    const dates=[...new Set((row?.legs||[]).map(r=>r.date))];
    return dates.length===1&&validDate(dates[0])?dates[0]:null;
  }
  function isCurrent(row){const date=typeof row==='string'?row:dateOf(row);return validDate(date)&&date>=EFFECTIVE_DATE;}
  function originalDailyOdds(row){return Object.hasOwn(row||{},'slateOriginalAmericanOdds')?row.slateOriginalAmericanOdds:row?.americanOdds;}
  function originalParlayOdds(ticket){
    if(Object.hasOwn(ticket||{},'slateOriginalAmericanOdds'))return ticket.slateOriginalAmericanOdds;
    return ticket?.americanOdds??ticket?.indicativeAmericanOdds??ticket?.estimatedAmericanOdds??null;
  }
  // Freeze before applying a preferred-book/current-price/result-price overlay.
  // The anchor is an in-memory presentation field, not a new publication contract.
  function freezeDaily(row){return {...row,slateOriginalAmericanOdds:originalDailyOdds(row)};}
  function freezeParlay(ticket){return {...ticket,slateOriginalAmericanOdds:originalParlayOdds(ticket)};}
  function priceTier(odds){
    if(!validOdds(odds)||odds< -500)return null;
    return odds<=-250?'free_throws':odds< -110?'floaters':'lobs';
  }
  function dailyTier(row){
    if(row?.group!=='research')return null;
    if(row.category==='honorable_mention')return 'bench';
    if(!['value_safe','high_probability_aggressive'].includes(row.category))return null;
    if(!isCurrent(row))return row.category==='value_safe'?'legacy_layups':'legacy_lobs';
    return priceTier(originalDailyOdds(row));
  }
  const dailyTitle=row=>labels[dailyTier(row)]||'';
  function parlayTier(ticket){
    if(ticket?.priceKind==='model_target')return null;
    if(!isCurrent(ticket))return ticket?.section==='longshots'?'legacy_longshots':'legacy_plus_money';
    const odds=originalParlayOdds(ticket);
    if(!validOdds(odds)||odds< -110)return null;
    return odds<=200?'layups':odds<500?'mid_range':odds<1000?'longshots':'logo_lottos';
  }
  const parlayTitle=ticket=>labels[parlayTier(ticket)]||'';
  function acceptableSGPPrice(price,date){return validOdds(price)&&(!isCurrent(date)||price>=-110);}
  function minimumSGPPrice(price,date){return validOdds(price)?isCurrent(date)?Math.max(-110,price):price:null;}
  return {EFFECTIVE_DATE,labels,dateOf,isCurrent,validOdds,priceTier,dailyTier,dailyTitle,parlayTier,parlayTitle,freezeDaily,freezeParlay,originalDailyOdds,originalParlayOdds,acceptableSGPPrice,minimumSGPPrice};
});
