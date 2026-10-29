/* One header, with horizontal submenus centered beneath each parent. */
(()=>{
  'use strict';
  const script=document.querySelector('script[data-sbos-navigation]'),header=document.querySelector('.site-header');if(!header)return;
  const topbar=header.querySelector('.sbos-topbar'),primary=header.querySelector('nav[aria-label="Main navigation"]'),triggers=[...header.querySelectorAll('[data-nav-menu]')];
  const base=script?new URL('../',script.src):new URL('./',location.href),routes=window.SBOS_ROUTES;let active=null,frame=0;
  function position(){
    frame=0;if(!active){header.style.setProperty('--submenu-space','0px');return;}
    const nav=document.getElementById(active.getAttribute('aria-controls'));if(!nav)return;
    const parent=header.getBoundingClientRect(),button=active.getBoundingClientRect(),width=nav.getBoundingClientRect().width;
    const bottom=Math.max(button.bottom,...[...primary.children].map(item=>item.getBoundingClientRect().bottom));
    nav.style.setProperty('--submenu-left',Math.max(16+width/2,Math.min(parent.width-16-width/2,button.left+button.width/2-parent.left))+'px');
    nav.style.setProperty('--submenu-top',(bottom-parent.top+2)+'px');
    header.style.setProperty('--submenu-space',Math.max(0,bottom-parent.top+nav.getBoundingClientRect().height+12-topbar.getBoundingClientRect().height)+'px');
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(position);}
  function close({focus=false}={}){const prior=active;for(const trigger of triggers){trigger.setAttribute('aria-expanded','false');const nav=document.getElementById(trigger.getAttribute('aria-controls'));if(nav)nav.hidden=true;}active=null;position();if(focus)prior?.focus();}
  function open(trigger){close();active=trigger;trigger.setAttribute('aria-expanded','true');const nav=document.getElementById(trigger.getAttribute('aria-controls'));if(nav)nav.hidden=false;position();}
  for(const trigger of triggers){trigger.addEventListener('click',()=>active===trigger?close():open(trigger));trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();open(trigger);document.getElementById(trigger.getAttribute('aria-controls'))?.querySelector('a')?.focus();}});}
  document.addEventListener('pointerdown',event=>{if(active&&!header.contains(event.target))close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&active){event.preventDefault();close({focus:true});}});
  header.addEventListener('focusout',event=>{if(active&&!header.contains(event.relatedTarget))close();});
  function normalizeLinks(root){if(!routes)return;for(const link of root.querySelectorAll('a[href]')){const href=link.getAttribute('href');if(!href||href.startsWith('#')||/^(mailto|tel|javascript):/i.test(href))continue;const next=routes.canonicalURL(link.href,base);if(next.href!==link.href)link.href=next.href;}}
  normalizeLinks(document);
  if(routes){const next=routes.canonicalURL(location.href,base);if(next.href!==location.href&&!document.body.dataset.redirectRoute)history.replaceState(null,'',next.href);}
  const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1){if(node.matches?.('a[href]')){const next=routes?.canonicalURL(node.href,base);if(next&&next.href!==node.href)node.href=next.href;}normalizeLinks(node);}});observer.observe(document.body,{subtree:true,childList:true});
  window.addEventListener('resize',schedule);primary?.addEventListener('scroll',schedule,{passive:true});
  if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(schedule);observer.observe(topbar);observer.observe(primary);for(const nav of header.querySelectorAll('.sbos-subnav'))observer.observe(nav);}
  document.fonts?.ready.then(schedule);position();
})();
