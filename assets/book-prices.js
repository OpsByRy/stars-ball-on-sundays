/* Saved exact-line prices. A book preference never selects a different prop. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.SBOS_BOOK_PRICES=api;document.addEventListener('click',event=>{const button=event.target.closest('[data-preferred-book]');if(button)api.setPreferredBook(button.dataset.preferredBook);});window.addEventListener('storage',event=>{if(event.key==='sbos-preferred-book'&&['fanduel','draftkings'].includes(event.newValue))api.setPreferredBook(event.newValue);});}})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const books=['fanduel','draftkings'],names={fanduel:'FanDuel',draftkings:'DraftKings'};
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const valid=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)>=100;
  let memoryPreference=null;
  function getPreferredBook(){if(memoryPreference)return memoryPreference;try{return books.includes(localStorage.getItem('sbos-preferred-book'))?localStorage.getItem('sbos-preferred-book'):'fanduel';}catch{return 'fanduel';}}
  function setPreferredBook(book){if(!books.includes(book))return;memoryPreference=book;try{localStorage.setItem('sbos-preferred-book',book);}catch{}document.querySelectorAll('[data-preferred-book]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.preferredBook===book)));window.dispatchEvent(new CustomEvent('sbos:bookchange',{detail:{book}}));}
  function quotes(row){
    if(row.bookPrices)return row.bookPrices.quotes||[];
    const update=row.confidenceUpdate,check=row.priceCheck;
    const price=update?update.americanOdds:row.americanOdds??(check?.status==='returned'?check.americanOdds:null);
    return valid(price)?[{book:row.book,americanOdds:price,capturedAt:update?.capturedAt||check?.sourceAsOf||row.capturedAt,operator:row.operator,line:row.line}]:[];
  }
  function selectedQuote(row,preferred=getPreferredBook()){
    const available=quotes(row).filter(q=>(!row.bookPrices||books.includes(q.book))&&valid(q.americanOdds));
    const quote=available.find(q=>q.book===preferred)||available[0];
    return quote?{...quote,fallback:books.includes(quote.book)&&quote.book!==preferred,preferred}:null;
  }
  function pricedPick(row,preferred=getPreferredBook()){
    const q=selectedQuote(row,preferred);
    return {...row,book:q?q.book:preferred,americanOdds:q?.americanOdds??null,priceFallback:!!q?.fallback,preferredBook:preferred,priceCapturedAt:q?.capturedAt||null};
  }
  function coverage(ticket){const has=book=>ticket.legs.every(r=>quotes(r).some(q=>q.book===book&&valid(q.americanOdds)));const fd=has('fanduel'),dk=has('draftkings');return fd&&dk?'both':fd?'fanduel':dk?'draftkings':'mixed';}
  function controlHTML(preferred=getPreferredBook()){return `<div class="book-preference" role="group" aria-label="Preferred sportsbook"><span>Preferred sportsbook</span><div>${books.map(book=>`<button type="button" data-preferred-book="${book}" aria-pressed="${book===preferred}">${names[book]}</button>`).join('')}</div><small>Same picks. Your book’s saved price first; another book only when yours is missing.</small></div>`;}
  function quoteDetails(row,preferred=getPreferredBook()){
    const available=quotes(row),chosen=selectedQuote(row,preferred);
    const stamp=value=>value?new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'capture time unavailable';
    return `<div class="saved-book-prices"><p><strong>Saved prices for this exact pick</strong></p>${books.map(book=>{const q=available.find(q=>q.book===book);return `<p>${names[book]}: <strong>${q?escape((q.americanOdds>0?'+':'')+q.americanOdds):'No matching saved price'}</strong>${q?' · '+escape(stamp(q.capturedAt)):''}${chosen?.book===book?' · shown':''}</p>`;}).join('')}<p>Switching books keeps this pick and its win estimate. Prices and availability need checking; value at another price can differ.</p></div>`;
  }
  return {getPreferredBook,setPreferredBook,quotes,selectedQuote,pricedPick,coverage,controlHTML,quoteDetails};
});
