/* Keep Research links inside the shared header, centered under their parent. */
(()=>{
  'use strict';
  const trigger=document.querySelector('.research-nav-trigger'),nav=document.getElementById('research-subnav');
  if(!trigger||!nav)return;
  const header=trigger.closest('.site-header'),primary=trigger.closest('nav'),topbar=trigger.closest('.sbos-topbar');
  if(!header||!primary||!topbar)return;
  let frame=0;
  function position(){
    frame=0;if(nav.hidden)return;
    const parent=header.getBoundingClientRect(),button=trigger.getBoundingClientRect(),width=nav.getBoundingClientRect().width;
    const center=button.left+button.width/2-parent.left,margin=16;
    // A wrapped primary menu must finish before its submenu begins.
    const lastRowBottom=Math.max(button.bottom,...[...primary.children].map(item=>item.getBoundingClientRect().bottom));
    const left=Math.max(margin+width/2,Math.min(parent.width-margin-width/2,center));
    nav.style.setProperty('--research-left',left+'px');
    nav.style.setProperty('--research-top',(lastRowBottom-parent.top+2)+'px');
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(position);}
  function toggle(open){nav.hidden=!open;trigger.setAttribute('aria-expanded',String(open));position();}
  trigger.addEventListener('click',()=>toggle(nav.hidden));
  trigger.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();toggle(true);nav.querySelector('a')?.focus();}});
  nav.addEventListener('keydown',e=>{if(e.key==='Escape'){toggle(false);trigger.focus();}});
  window.addEventListener('resize',schedule);
  primary.addEventListener('scroll',schedule,{passive:true});
  if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(schedule);observer.observe(topbar);observer.observe(primary);observer.observe(nav);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});
  document.fonts?.ready.then(schedule);
  position();
})();
