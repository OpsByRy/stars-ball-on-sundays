/* One-day civic notice. No board, research, price, account or result writes. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{const source=document.currentScript;if(source)api.boot(root,document,new URL('./',source.src));}})(typeof window==='undefined'?this:window,function(){
  'use strict';
  const START=Date.parse('2026-11-03T05:00:00Z'),END=Date.parse('2026-11-04T05:00:00Z');
  const KEY='sbos.election-day.2026-11-03.dismissed';
  const POLLING='https://www.vote.org/polling-place-locator/';
  const DISCLOSURE='Gambling involves risk. All picks, projections and probabilities published by Stars Ball On Sundays are model-generated estimates for informational and entertainment purposes and are not guarantees of winning or positive returns. You are solely responsible for your wagering decisions. Never wager more than you can afford to lose. If you or someone you know has a gambling problem, call or text 1-800-GAMBLER';
  const active=now=>Number.isFinite(now)&&now>=START&&now<END;
  function boot(win,doc,base){
    const now=()=>win.Date.now();
    if(!active(now())||!doc.body||doc.getElementById('sbos-election-dialog'))return null;
    let closed=false,previous=null,destroyed=false,expiry=null;
    try{closed=win.sessionStorage.getItem(KEY)==='1';}catch{}
    const dialog=doc.createElement('dialog');dialog.id='sbos-election-dialog';dialog.className='sbos-election-dialog';
    dialog.setAttribute('aria-labelledby','sbos-election-title');dialog.setAttribute('aria-describedby','sbos-election-message');
    dialog.innerHTML='<button type="button" class="sbos-election-close" aria-label="Dismiss Election Day notice" data-election-close>×</button><div class="sbos-election-art"><img class="sbos-election-logo" alt="Stars Ball On Sundays" width="140" height="66"><p class="sbos-election-date">NOVEMBER 3, 2026</p><h2 id="sbos-election-title"><span class="sbos-election-happy">HAPPY </span><span>ELECTION </span><span>DAY<span class="sbos-election-punctuation">!</span></span></h2><p id="sbos-election-message">NO NBA GAME SCHEDULED, <strong>PLEASE GO VOTE!</strong></p><div class="sbos-election-actions"><a class="sbos-election-polling" target="_blank" rel="noopener noreferrer">Find Your Polling Place<span class="sbos-election-sr"> (opens in a new tab)</span><span aria-hidden="true"> ↗</span></a><button type="button" class="sbos-election-continue" data-election-continue>Continue browsing the site</button><a class="sbos-election-archive" data-election-history>Browse history ↗</a></div></div><p class="sbos-election-disclosure"></p>';
    dialog.querySelector('.sbos-election-logo').src=new URL('brand/sbos-primary-compact-classic-720.webp',base).href;
    const poll=dialog.querySelector('.sbos-election-polling');poll.href=POLLING;
    const history=dialog.querySelector('[data-election-history]');history.href=new URL('../archive/',base).href;
    dialog.querySelector('.sbos-election-disclosure').textContent=DISCLOSURE;
    const banner=doc.createElement('aside');banner.id='sbos-election-banner';banner.className='sbos-election-banner';banner.setAttribute('aria-label','Election Day notice');
    banner.innerHTML='<span>Election Day · No NBA game scheduled.</span><button type="button">Voting info</button>';
    const reopen=banner.querySelector('button');
    const native=typeof dialog.showModal==='function';
    function remember(){closed=true;try{win.sessionStorage.setItem(KEY,'1');}catch{}}
    function finish(){doc.documentElement.classList.remove('sbos-election-is-open');banner.hidden=false;if(previous&&previous!==doc.body&&previous.isConnected)previous.focus();else if(!destroyed)reopen.focus();}
    function dismiss(){remember();if(dialog.open)dialog.close();else finish();}
    function open(){if(destroyed||!active(now())||!native)return;previous=doc.activeElement;banner.hidden=true;dialog.showModal();doc.documentElement.classList.add('sbos-election-is-open');dialog.querySelector('[data-election-close]').focus();}
    function destroy(){if(destroyed)return;destroyed=true;if(dialog.open)dialog.close();doc.documentElement.classList.remove('sbos-election-is-open');dialog.remove();banner.remove();style.remove();if(expiry!==null)win.clearTimeout(expiry);doc.removeEventListener('visibilitychange',checkExpiry);}
    function checkExpiry(){if(!active(now()))destroy();}
    dialog.querySelector('[data-election-close]').addEventListener('click',dismiss);
    dialog.querySelector('[data-election-continue]').addEventListener('click',dismiss);
    poll.addEventListener('click',dismiss);history.addEventListener('click',dismiss);
    dialog.addEventListener('cancel',remember);dialog.addEventListener('close',finish);reopen.addEventListener('click',open);
    const style=doc.createElement('link');style.rel='stylesheet';style.href=new URL('election-day.css?v=20261103-1',base).href;
    function ready(){if(destroyed||!active(now()))return;const header=doc.querySelector('.site-header');if(header)header.insertAdjacentElement('afterend',banner);else doc.body.prepend(banner);doc.body.append(dialog);if(!native){dialog.remove();banner.innerHTML='<span>Election Day · No NBA game scheduled.</span><a href="'+POLLING+'" target="_blank" rel="noopener noreferrer">Find Your Polling Place</a><button type="button" aria-label="Dismiss Election Day notice">Dismiss</button>';banner.hidden=closed;banner.querySelector('button').addEventListener('click',()=>{remember();banner.hidden=true;});return;}if(!closed&&!doc.querySelector('dialog[open]'))open();}
    style.addEventListener('load',ready,{once:true});style.addEventListener('error',destroy,{once:true});doc.head.append(style);
    expiry=win.setTimeout(destroy,Math.max(0,END-now()));doc.addEventListener('visibilitychange',checkExpiry);
    return{dialog,banner,open,dismiss,destroy,ready};
  }
  return{START,END,KEY,POLLING,DISCLOSURE,active,boot};
});
