/* Consumer category descriptions; pick identities and recorded categories stay stable. */
(() => {
  'use strict';
  const categories = {
    value_safe: {
      label: 'Layups', heading: 'Layups',
      description: 'The Core Lineup. Higher-probability, value-screened props priced from −500 to −200.'
    },
    high_probability_aggressive: {
      label: 'Lobs', heading: 'Lobs',
      description: 'The Highlight Reel. Aggressive, high-flying value targets at −200 or better.'
    },
    honorable_mention: {
      label: 'Bench', heading: 'Bench',
      description: 'The Depth Chart. Honorable mentions, sharp leans, and alt lines to watch. For review only; excluded from our official picks and hit/miss record.'
    }
  };
  const descriptions = new Map();
  let activeInfo = null;
  let pinned = false;
  let hideTimer;
  for (const [key, category] of Object.entries(categories)) {
    const tooltip = document.createElement('div');
    tooltip.id = 'pick-category-description-' + key;
    tooltip.className = 'pick-category-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.textContent = category.description;
    tooltip.hidden = true;
    document.body.append(tooltip);
    descriptions.set(key, tooltip);
    tooltip.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    tooltip.addEventListener('pointerleave', event => {
      if (!pinned && !activeInfo?.contains(event.relatedTarget) && document.activeElement !== activeInfo) scheduleHide();
    });
  }

  function hide() {
    clearTimeout(hideTimer);
    for (const tooltip of descriptions.values()) tooltip.hidden = true;
    activeInfo?.setAttribute('aria-expanded', 'false');
    activeInfo = null;
    pinned = false;
  }
  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 180);
  }
  function show(info, pin = false) {
    if (activeInfo === info && pinned && !pin) return;
    const tooltip = descriptions.get(info?.dataset.categoryInfo);
    hide();
    if (!tooltip) return;
    activeInfo = info;
    pinned = pin;
    info.setAttribute('aria-expanded', 'true');
    tooltip.hidden = false;
    const rect = info.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    const left = Math.max(12, Math.min(rect.left + (rect.width - box.width) / 2, innerWidth - box.width - 12));
    const top = rect.bottom + box.height + 12 <= innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - box.height - 8);
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }
  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const info = event.target.closest?.('[data-category-info]');
    if (info && !info.contains(event.relatedTarget)) show(info);
  });
  document.addEventListener('pointerout', event => {
    const info = event.target.closest?.('[data-category-info]');
    const tooltip = descriptions.get(info?.dataset.categoryInfo);
    if (!info || info.contains(event.relatedTarget) || tooltip?.contains(event.relatedTarget)) return;
    if (!pinned && document.activeElement !== info) scheduleHide();
  });
  document.addEventListener('focusin', event => {
    const info = event.target.closest?.('[data-category-info]');
    if (info) show(info);
  });
  document.addEventListener('focusout', event => {
    if (event.target === activeInfo && !activeInfo.matches(':hover')) hide();
  });
  document.addEventListener('click', event => {
    const info = event.target.closest?.('[data-category-info]');
    if (!info) return;
    if (activeInfo === info && pinned) hide();
    else show(info, true);
  });
  document.addEventListener('pointerdown', event => {
    if (activeInfo && !activeInfo.contains(event.target) && !descriptions.get(activeInfo.dataset.categoryInfo)?.contains(event.target)) hide();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hide();
  });
  window.addEventListener('resize', hide);
  window.addEventListener('scroll', hide, {capture: true, passive: true});
})();
