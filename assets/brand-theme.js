/* Runs synchronously in the head so stored appearance is resolved before paint.
   Owns only its namespaced preference key; board/calculator state is untouched. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.init(root, document);
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const KEY = 'sbos.appearance.v1';
  const BRANDS = { classic: 'Classic', violet: 'Violet Ice', forest: 'Forest Fire', volt: 'Volt' };
  const MODES = ['system', 'light', 'dark'];
  function normalize(value) {
    return { brand: Object.hasOwn(BRANDS, value?.brand) ? value.brand : 'classic',
      appearance: MODES.includes(value?.appearance) ? value.appearance : 'system' };
  }
  function resolveMode(appearance, systemDark = true) {
    return appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance;
  }
  function init(win, doc) {
    let preference;
    try { preference = normalize(JSON.parse(win.localStorage.getItem(KEY))); } catch { preference = normalize(); }
    let system;
    try { system = win.matchMedia('(prefers-color-scheme: dark)'); } catch {}
    const script = doc.currentScript;
    const assetBase = new URL('brand/', script.src);
    function apply() {
      const mode = resolveMode(preference.appearance, system ? system.matches : true);
      doc.documentElement.dataset.brand = preference.brand;
      doc.documentElement.dataset.mode = mode;
      doc.documentElement.dataset.appearance = preference.appearance;
      doc.querySelectorAll('[data-brand-logo]').forEach(img => {
        const kind=img.dataset.logoKind==='compact'?'compact':'full';
        img.src = new URL(`sbos-primary-${kind}-${preference.brand}-720.webp`, assetBase).href;
      });
      const brand = doc.getElementById('sbos-brand-setting'), appearance = doc.getElementById('sbos-mode-setting');
      if (brand) brand.value = preference.brand;
      if (appearance) appearance.value = preference.appearance;
      const status = doc.getElementById('sbos-appearance-status');
      if (status) status.textContent = `${BRANDS[preference.brand]} · ${mode} appearance`;
      const meta = doc.querySelector('meta[name="theme-color"]');
      if (meta && doc.readyState !== 'loading') meta.content = win.getComputedStyle(doc.documentElement).getPropertyValue('--canvas').trim();
    }
    apply();
    function save() {
      try { win.localStorage.setItem(KEY, JSON.stringify(preference)); } catch {}
      apply();
    }
    function ready() {
      const header = doc.querySelector('.sbos-topbar');
      if (header) {
        const settings = doc.createElement('details');
        settings.className = 'appearance-settings';
        settings.innerHTML = `<summary aria-label="Appearance settings"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></svg><span class="settings-caption">Appearance</span></summary><div class="appearance-panel"><p class="sbos-kicker">MAKE IT YOUR BOARD</p><label for="sbos-brand-setting">Brand theme</label><select id="sbos-brand-setting">${Object.entries(BRANDS).map(([value, name]) => `<option value="${value}">${name}</option>`).join('')}</select><label for="sbos-mode-setting">Appearance</label><select id="sbos-mode-setting"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select><p id="sbos-appearance-status" role="status" aria-live="polite"></p></div>`;
        header.append(settings);
        doc.getElementById('sbos-brand-setting').addEventListener('change', event => { preference.brand = event.target.value; save(); });
        doc.getElementById('sbos-mode-setting').addEventListener('change', event => { preference.appearance = event.target.value; save(); });
        doc.addEventListener('keydown', event => { if (event.key === 'Escape' && settings.open) { settings.open = false; settings.querySelector('summary').focus(); } });
        doc.addEventListener('click', event => { if (settings.open && !settings.contains(event.target)) settings.open = false; });
      }
      apply();
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', ready, { once: true }); else ready();
    if (system?.addEventListener) system.addEventListener('change', apply);
    else if (system?.addListener) system.addListener(apply);
    win.addEventListener('storage', event => {
      if (event.key === KEY || event.key === null) {
        try { preference = normalize(JSON.parse(event.newValue)); } catch { preference = normalize(); }
        apply();
      }
    });
  }
  return { KEY, BRANDS, normalize, resolveMode, init };
});
