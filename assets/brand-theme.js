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
  function initialPreference(stored, launchBrand, installBrand) {
    const preference=normalize(stored);
    if(Object.hasOwn(BRANDS,installBrand))preference.brand=installBrand;
    else if(!Object.hasOwn(BRANDS,stored?.brand)&&Object.hasOwn(BRANDS,launchBrand))preference.brand=launchBrand;
    return preference;
  }
  function iconURLs(brand, base) {
    const name=Object.hasOwn(BRANDS,brand)?brand:'classic';
    return {manifest:new URL(`assets/icons/manifest-${name}.webmanifest`,base).href,
      touch:new URL(`assets/icons/calendar-${name}-180.png`,base).href,
      preview:new URL(`assets/icons/calendar-${name}-192.png`,base).href,
      install:new URL(`app/${name}/`,base).href};
  }
  function init(win, doc) {
    let stored;
    try { stored=JSON.parse(win.localStorage.getItem(KEY)); } catch {}
    const launchBrand=new URLSearchParams(win.location?.search||'').get('app-theme');
    const installBrand=doc.documentElement.dataset.installBrand;
    let preference=initialPreference(stored,launchBrand,installBrand);
    if(Object.hasOwn(BRANDS,installBrand)||(!Object.hasOwn(BRANDS,stored?.brand)&&Object.hasOwn(BRANDS,launchBrand))){
      try { win.localStorage.setItem(KEY,JSON.stringify(preference)); } catch {}
    }
    let system;
    try { system = win.matchMedia('(prefers-color-scheme: dark)'); } catch {}
    const script = doc.currentScript;
    const assetBase = new URL('brand/', script.src);
    const siteBase = new URL('../', script.src);
    function apply() {
      const mode = resolveMode(preference.appearance, system ? system.matches : true);
      doc.documentElement.dataset.brand = preference.brand;
      doc.documentElement.dataset.mode = mode;
      doc.documentElement.dataset.appearance = preference.appearance;
      doc.querySelectorAll('[data-brand-logo]').forEach(img => {
        const kind=img.dataset.logoKind==='compact'?'compact':'full';
        img.src = new URL(`sbos-primary-${kind}-${preference.brand}-720.webp`, assetBase).href;
      });
      const icons=iconURLs(preference.brand,siteBase);
      doc.querySelectorAll('[data-app-manifest]').forEach(link=>{link.href=icons.manifest;});
      doc.querySelectorAll('[data-touch-icon]').forEach(link=>{link.href=icons.touch;});
      doc.querySelectorAll('[data-app-icon-preview]').forEach(img=>{img.src=icons.preview;img.alt=`${BRANDS[preference.brand]} Calendar home-screen icon`;});
      doc.querySelectorAll('[data-install-link]').forEach(link=>{link.href=icons.install;});
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
        settings.innerHTML = `<summary aria-label="Appearance settings"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></svg><span class="settings-caption">Appearance</span></summary><div class="appearance-panel"><p class="sbos-kicker">MAKE IT YOUR BOARD</p><label for="sbos-brand-setting">Brand theme</label><select id="sbos-brand-setting">${Object.entries(BRANDS).map(([value, name]) => `<option value="${value}">${name}</option>`).join('')}</select><label for="sbos-mode-setting">Appearance</label><select id="sbos-mode-setting"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select><p id="sbos-appearance-status" role="status" aria-live="polite"></p><div class="home-screen-setting"><img data-app-icon-preview width="64" height="64" alt="Calendar home-screen icon"><div><span>Your home-screen icon</span><a data-install-link class="sbos-text-link">Add SBOS to home screen ↗</a></div></div></div>`;
        header.append(settings);
        doc.getElementById('sbos-brand-setting').addEventListener('change', event => {
          preference.brand=normalize({brand:event.target.value}).brand;save();
          if(Object.hasOwn(BRANDS,installBrand)&&preference.brand!==installBrand)win.location.assign(iconURLs(preference.brand,siteBase).install);
        });
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
        try { preference = initialPreference(JSON.parse(event.newValue),null,installBrand); } catch { preference = initialPreference(null,null,installBrand); }
        apply();
      }
    });
  }
  return { KEY, BRANDS, normalize, resolveMode, initialPreference, iconURLs, init };
});
