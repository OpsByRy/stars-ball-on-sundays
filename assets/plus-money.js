/* Consumer presentation of frozen parlay publications. No research or selection. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.SBOS_PLUS_MONEY=api;document.addEventListener('DOMContentLoaded',()=>api.init());}})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const prices=typeof window==='undefined'?require('./book-prices.js'):window.SBOS_BOOK_PRICES;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const odds=value=>typeof value==='number'?(value>0?'+':'')+value:'—';
  const bookName=value=>({fanduel:'FanDuel',draftkings:'DraftKings',mixed:'Mixed price sources'}[value]||value);
  const label=r=>{
    const name={PTS:'points',AST:'assists',REB:'rebounds','3PM':'threes',PRA:'points + rebounds + assists',PA:'points + assists',PR:'points + rebounds',RA:'rebounds + assists',BLK:'blocks',STL:'steals'}[r.market]||r.market;
    const native=r.operator==='>='&&(r.market==='3PM'||r.market==='PTS'&&[5,10,15,20,25,30,35].includes(r.line)||['REB','AST'].includes(r.market)&&[4,6,8,10].includes(r.line)||['PRA','PA','PR','RA'].includes(r.market)&&r.line>=10&&r.line%5===0);
    return `${native?r.line+'+':r.operator==='>='?'Alt O'+(Math.ceil(r.line)-.5):r.operator==='<='?'Alt U'+(Math.floor(r.line)+.5):(r.operator==='>'?'Over ':'Under ')+r.line} ${name}`;
  };
  const stamp=value=>new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
  function safePath(entry){if(!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)||!Number.isFinite(Date.parse(entry.date))||!/^[a-f0-9]{16}$/.test(entry.version)||entry.path!==`${entry.date}/${entry.version}.json`)throw Error('Invalid parlay publication path');return entry.path;}
  function visibleTickets(body,book='all',sort='reviewed'){
    const tickets=body.tickets.filter(t=>book==='all'||t.book===book);
    if(sort==='price_asc')tickets.sort((a,b)=>a.indicativeAmericanOdds-b.indicativeAmericanOdds);
    if(sort==='price_desc')tickets.sort((a,b)=>b.indicativeAmericanOdds-a.indicativeAmericanOdds);
    return tickets;
  }
  function pricedTicket(ticket,preferred=prices.getPreferredBook()){
    const legs=ticket.legs.map(r=>prices.pricedPick(r,preferred));
    const decimal=legs.every(r=>typeof r.americanOdds==='number')?legs.reduce((d,r)=>d*(1+(r.americanOdds>0?r.americanOdds/100:100/Math.abs(r.americanOdds))),1):null;
    const books=new Set(legs.map(r=>r.book));
    return {...ticket,legs,book:books.size===1?legs[0].book:'mixed',indicativeAmericanOdds:decimal?Math.round(decimal>=2?(decimal-1)*100:-100/(decimal-1)):null,sourceCoverage:prices.coverage(ticket)};
  }
  function card(ticket,index){
    return `<article class="pm-card"><div class="pm-card-top"><span>${escape(bookName(ticket.book))} · ${ticket.legs.length} legs</span><span class="pm-tag">${ticket.section==='longshots'?'Longshot':'Algorithm picks'}</span></div><div class="pm-price"><div><span>Estimated combined price</span><strong>${escape(odds(ticket.indicativeAmericanOdds))}</strong></div><small>Option ${index+1}</small></div>${ticket.book==='mixed'?'<p class="pm-mixed-note">Mixed-book calculation. Recheck the full ticket at your sportsbook.</p>':''}<ol class="pm-legs">${ticket.legs.map(r=>`<li><div><h3>${escape(r.player)}</h3><p>${escape(r.team)} vs ${escape(r.opponent)}</p></div><div><strong>${escape(label(r))}</strong><span>${escape(odds(r.americanOdds))}</span></div><div class="pm-leg-estimate"><span>${(r.estimate.winProbability*100).toFixed(1)}% leg estimate</span><span>${escape(bookName(r.book||ticket.book))}${r.priceFallback?' · fallback':''}</span></div><small>Leg price captured ${escape(stamp(r.capturedAt))}</small></li>`).join('')}</ol><details><summary>Why these legs fit & saved research</summary><div class="pm-fit"><h4>Compatibility review</h4><ul>${ticket.fitReasons.filter(s=>!['All saved leg prices are from the same sportsbook.','Each player appears once, with one exact stat line.','Saved leg prices come from different sportsbooks; confirm the full ticket at your book.'].includes(s)).map(s=>`<li>${escape(s)}</li>`).join('')}</ul></div><p>Provisional single-leg estimates:</p>${ticket.legs.map(r=>`<p><strong>${escape(r.player)}</strong>: ${(r.estimate.winProbability*100).toFixed(1)}% · estimated ${escape(stamp(r.estimate.asOf))}. Full game; sportsbook overtime and settlement terms must be confirmed.</p>`).join('')}${ticket.legs.map(r=>`<div class="pm-saved-prices"><h4>${escape(r.player)}</h4>${prices.quoteDetails(r)}</div>`).join('')}<p>These percentages apply to individual legs. No verified combined win probability has been assigned.</p></details></article>`;
  }
  function sections(tickets){
    return [{key:'plus_money',title:'Plus Money',note:'Shorter combinations reviewed at +100 or above, with strong individual legs and reviewed roles. The displayed price can vary by sportsbook.'},{key:'longshots',title:'Longshots',note:'Higher-payout combinations reviewed at +400 or above; the price can vary by sportsbook. More legs mean more ways for the ticket to miss, even when each individual pick has a strong provisional estimate.'}].map(section=>{
      const rows=tickets.filter(t=>(t.section||'plus_money')===section.key);
      const groups=[['both','Both sportsbooks'],['fanduel','FanDuel Exclusive Lines'],['draftkings','DraftKings Exclusive Lines'],['mixed','Mixed-Source Ideas']].map(([key,title])=>{
        const options=rows.filter(t=>(t.sourceCoverage||prices.coverage(t))===key);
        if(!options.length)return '';
        return `<section class="pm-price-group"><h3>${title} <small>${options.length}</small></h3>${key==='both'?'<p>The same exact picks have saved prices at both books.</p>':key==='mixed'?'<p>No complete price set is saved at either book. These are combination ideas; confirm the exact lines and a full quote at your book.</p>':`<p>A complete price set is saved only at ${key==='fanduel'?'FanDuel':'DraftKings'}. The other book is missing at least one matching line. Choose ${key==='fanduel'?'FanDuel':'DraftKings'} above for its complete saved price set.</p>`}<div class="pm-grid">${options.map(card).join('')}</div></section>`;
      }).join('');
      return `<details class="pm-section" id="${section.key==='longshots'?'longshots':'plus-money'}-section" open><summary><span>${section.title}</span><span class="pm-section-count">${rows.length} option${rows.length===1?'':'s'}</span><span class="pm-section-toggle" aria-hidden="true"></span></summary><p class="pm-section-note">${section.note}</p>${groups||'<p class="pm-empty">No reviewed combinations in this section for the selected date. We won’t add weaker legs to fill it.</p>'}</details>`;
    }).join('');
  }
  async function init(){
    const script=document.querySelector('script[data-plus-money]');if(!script)return;
    const base=new URL('../',script.src),dataRoot=new URL('data/plus-money/',base);
    const target=document.getElementById('plus-money-cards'),dateSelect=document.getElementById('parlay-date'),sort=document.getElementById('parlay-sort'),context=document.getElementById('parlay-context');
    document.getElementById('parlay-book-preference').innerHTML=prices.controlHTML();
    let editions=[],body=null,serial=0;
    async function json(url,immutable=false){const r=await fetch(url,{cache:immutable?'force-cache':'no-store',credentials:'omit'});if(!r.ok)throw Error('Publication unavailable');return r.json();}
    function render(){const cards=visibleTickets({tickets:body.tickets.map(t=>pricedTicket(t))},'all',sort?.value);target.innerHTML=sections(cards);document.getElementById('parlay-count').textContent=`${cards.length} reviewed combination${cards.length===1?'':'s'}`;}
    async function loadDate(){const n=++serial,entry=editions.find(e=>e.date===dateSelect.value);const saved=await json(new URL(safePath(entry),dataRoot),true);if(n!==serial)return;if(!['public-plus-money-1','public-plus-money-2'].includes(saved.schemaVersion)||saved.version!==entry.version||saved.date!==entry.date||!Array.isArray(saved.tickets))throw Error('Publication mismatch');body=saved;context.textContent=`Saved leg prices: ${stamp(body.quoteObservedAt)}. ${Date.now()-Date.parse(body.quoteObservedAt)>900000?'Prices need checking again. ':''}${body.priceNote}`;render();const url=new URL(location.href);url.searchParams.set('date',body.date);history.replaceState(null,'',url);}
    try{const index=await json(new URL('manifest.json',dataRoot));if(index.schemaVersion!=='public-plus-money-manifest-1')throw Error('Invalid publication');const latest=new Map();for(const e of index.editions){safePath(e);latest.set(e.date,e);}editions=[...latest.values()].sort((a,b)=>b.date.localeCompare(a.date));if(!editions.length){target.textContent='No Plus Money combinations have been published yet.';return;}dateSelect.innerHTML=editions.map(e=>`<option value="${escape(e.date)}">${escape(e.date)}</option>`).join('');const requested=new URL(location.href).searchParams.get('date');if(editions.some(e=>e.date===requested))dateSelect.value=requested;dateSelect.disabled=false;await loadDate();dateSelect.addEventListener('change',()=>loadDate().catch(showError));window.addEventListener('sbos:bookchange',render);sort?.addEventListener('change',render);document.getElementById('refresh-parlays').addEventListener('click',()=>location.reload());}
    catch{showError();}
    function showError(){target.innerHTML='<p role="alert" class="site-error">The saved parlay board is unavailable. Refresh to try again.</p>';}
  }
  return {escape,label,safePath,visibleTickets,pricedTicket,card,sections,init};
});
