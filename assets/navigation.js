/* Shared desktop dropdowns, mobile disclosures and canonical public links. */
(() => {
  'use strict';
  const script = document.querySelector('script[data-sbos-navigation]');
  const header = document.querySelector('.site-header');
  if (!header) return;
  const topbar = header.querySelector('.sbos-topbar');
  const primary = header.querySelector('nav[aria-label="Main navigation"]');
  if (!topbar || !primary) return;
  const triggers = [...header.querySelectorAll('[data-nav-menu]')];
  const base = script ? new URL('../', script.src) : new URL('./', location.href);
  const routes = window.SBOS_ROUTES;
  const mobile = window.matchMedia('(max-width: 1100px)');
  let active = null, frame = 0, tabFrame = 0;

  // Reuse the same links at each size, retaining their URLs and selected states.
  const panel = document.createElement('div');
  panel.id = 'sbos-navigation';
  panel.className = 'sbos-navigation';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'sbos-menu-toggle';
  toggle.setAttribute('aria-controls', panel.id);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path class="menu-lines" d="M2 5h16M2 10h16M2 15h16"/><path class="menu-close" d="m4 4 12 12M16 4 4 16"/></svg><span>Menu</span>';
  topbar.insertBefore(toggle, primary);
  topbar.insertBefore(panel, primary);
  panel.append(primary);
  const submenus = triggers.map(trigger => {
    const nav = document.getElementById(trigger.getAttribute('aria-controls'));
    const home = document.createComment('Desktop submenu position');
    nav?.before(home);
    return { trigger, nav, home };
  });
  header.classList.add('sbos-nav-ready');

  function position() {
    frame = 0;
    if (mobile.matches || !active) {
      header.style.setProperty('--submenu-space', '0px');
      return;
    }
    const nav = document.getElementById(active.getAttribute('aria-controls'));
    if (!nav) return;
    const parent = header.getBoundingClientRect();
    const button = active.getBoundingClientRect();
    const width = nav.getBoundingClientRect().width;
    const bottom = Math.max(button.bottom, ...[...primary.children].map(item => item.getBoundingClientRect().bottom));
    nav.style.setProperty('--submenu-left', Math.max(16 + width / 2, Math.min(parent.width - 16 - width / 2, button.left + button.width / 2 - parent.left)) + 'px');
    nav.style.setProperty('--submenu-top', (bottom - parent.top + 2) + 'px');
    header.style.setProperty('--submenu-space', Math.max(0, bottom - parent.top + nav.getBoundingClientRect().height + 12 - topbar.getBoundingClientRect().height) + 'px');
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(position); }
  function close({ focus = false } = {}) {
    const prior = active;
    for (const { trigger, nav } of submenus) {
      trigger.setAttribute('aria-expanded', 'false');
      if (nav) nav.hidden = true;
    }
    active = null;
    position();
    if (focus) prior?.focus();
  }
  function open(trigger) {
    close();
    active = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    const nav = document.getElementById(trigger.getAttribute('aria-controls'));
    if (nav) nav.hidden = false;
    position();
  }
  function closeMenu({ focus = false } = {}) {
    close();
    toggle.setAttribute('aria-expanded', 'false');
    if (mobile.matches) panel.hidden = true;
    if (focus) toggle.focus();
  }
  function changeLayout() {
    const focusWasInNav = panel.contains(document.activeElement) || submenus.some(({ nav }) => nav?.contains(document.activeElement));
    const prior = active;
    close();
    for (const { trigger, nav, home } of submenus) {
      if (nav) (mobile.matches ? trigger : home).after(nav);
    }
    toggle.hidden = !mobile.matches;
    toggle.setAttribute('aria-expanded', 'false');
    panel.hidden = mobile.matches;
    if (focusWasInNav && mobile.matches) toggle.focus();
    else if (document.activeElement === toggle || focusWasInNav) (prior || primary.querySelector('a'))?.focus();
    position();
  }
  toggle.addEventListener('click', () => {
    if (toggle.getAttribute('aria-expanded') === 'true') closeMenu();
    else {
      header.querySelector('.appearance-settings')?.removeAttribute('open');
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
    }
  });
  for (const trigger of triggers) {
    trigger.addEventListener('click', () => active === trigger ? close() : open(trigger));
    trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        open(trigger);
        document.getElementById(trigger.getAttribute('aria-controls'))?.querySelector('a')?.focus();
      }
    });
  }
  document.addEventListener('pointerdown', event => {
    if (!header.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (active) { event.preventDefault(); close({ focus: true }); }
    else if (mobile.matches && !panel.hidden) { event.preventDefault(); closeMenu({ focus: true }); }
  });
  header.addEventListener('focusout', event => {
    if (!header.contains(event.relatedTarget)) closeMenu();
  });
  header.addEventListener('click', event => {
    if (mobile.matches && event.target.closest('a[href]')) closeMenu();
    // Appearance and navigation should not compete for a small screen.
    if (event.target.closest('.appearance-settings > summary')) closeMenu();
  });
  mobile.addEventListener('change', changeLayout);
  changeLayout();

  function normalizeLinks(root) {
    if (!routes) return;
    for (const link of root.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue;
      const next = routes.canonicalURL(link.href, base);
      if (next.href !== link.href) link.href = next.href;
    }
  }
  normalizeLinks(document);
  if (routes) {
    const next = routes.canonicalURL(location.href, base);
    if (next.href !== location.href && !document.body.dataset.redirectRoute) history.replaceState(null, '', next.href);
  }

  // Scroll only the category strip; never move the page when a tab is selected.
  function revealTab(tab) {
    const list = tab?.closest('.daily-tabs');
    if (!list || list.scrollWidth <= list.clientWidth) return;
    const item = (tab.closest('.pick-category-tab') || tab).getBoundingClientRect();
    const box = list.getBoundingClientRect();
    if (item.left < box.left) list.scrollLeft -= box.left - item.left + 4;
    else if (item.right > box.right) list.scrollLeft += item.right - box.right + 4;
  }
  function revealSelectedTabs() {
    if (tabFrame) return;
    tabFrame = requestAnimationFrame(() => {
      tabFrame = 0;
      for (const tab of document.querySelectorAll('.daily-tabs [role="tab"][aria-selected="true"]')) revealTab(tab);
    });
  }
  document.addEventListener('focusin', event => revealTab(event.target));
  document.addEventListener('click', event => {
    if (event.target.closest('.daily-tabs [role="tab"]')) revealSelectedTabs();
  });
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) {
      if (node.matches?.('a[href]')) {
        const next = routes?.canonicalURL(node.href, base);
        if (next && next.href !== node.href) node.href = next.href;
      }
      normalizeLinks(node);
    }
    revealSelectedTabs();
  });
  observer.observe(document.body, { subtree: true, childList: true });
  window.addEventListener('resize', () => { schedule(); revealSelectedTabs(); });
  primary.addEventListener('scroll', schedule, { passive: true });
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(schedule);
    observer.observe(topbar);
    observer.observe(primary);
    for (const { nav } of submenus) if (nav) observer.observe(nav);
  }
  document.fonts?.ready.then(() => { schedule(); revealSelectedTabs(); });
  position();
})();
