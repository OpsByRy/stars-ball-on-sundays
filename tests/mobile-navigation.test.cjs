'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// A small DOM fixture for the shared navigation's state and link identity.
// Actual CSS geometry, tab order and touch-target sizes are checked in a browser.
function fixture(isMobile = true) {
  let document;
  class Element {
    constructor(tag = 'div', attrs = {}) {
      this.tagName = tag.toUpperCase(); this.attrs = attrs; this.children = [];
      this.parentElement = null; this.listeners = {}; this.hidden = false;
      this.nodeType = 1; this.dataset = {}; this.style = {setProperty() {}};
      this.rect = {left:0, right:100, top:0, bottom:44, width:100, height:44};
      this.classList = {add: name => this.className = (this.className + ' ' + name).trim()};
    }
    get id() { return this.attrs.id; } set id(value) { this.attrs.id = value; }
    get className() { return this.attrs.class || ''; } set className(value) { this.attrs.class = value; }
    get href() { return this.attrs.href; } set href(value) { this.attrs.href = value; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    removeAttribute(name) { delete this.attrs[name]; }
    detach(node) { if (node.parentElement) node.parentElement.children.splice(node.parentElement.children.indexOf(node), 1); node.parentElement = null; }
    insertBefore(node, before) { this.detach(node); this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node); node.parentElement = this; }
    append(node) { this.insertBefore(node, null); }
    before(node) { this.parentElement.insertBefore(node, this); }
    after(node) { const parent = this.parentElement; parent.detach(node); parent.insertBefore(node, parent.children[parent.children.indexOf(this) + 1]); }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    matches(selector) {
      if (this.nodeType !== 1) return false;
      if (selector === '.daily-tabs [role="tab"][aria-selected="true"]') return this.attrs.role === 'tab' && this.attrs['aria-selected'] === 'true' && this.parentElement?.closest('.daily-tabs');
      if (selector === '.daily-tabs [role="tab"]') return this.attrs.role === 'tab' && this.parentElement?.closest('.daily-tabs');
      if (selector === '.appearance-settings > summary') return this.tagName === 'SUMMARY' && this.parentElement?.matches('.appearance-settings');
      if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
      if (selector === 'nav[aria-label="Main navigation"]') return this.tagName === 'NAV' && this.attrs['aria-label'] === 'Main navigation';
      if (selector === '[data-nav-menu]') return 'data-nav-menu' in this.attrs;
      if (selector === 'script[data-sbos-navigation]') return false;
      if (selector === 'a[href]') return this.tagName === 'A' && 'href' in this.attrs;
      return this.tagName.toLowerCase() === selector;
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getBoundingClientRect() { return this.rect; }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    emit(type, extra = {}) {
      const event = {type, target:this, defaultPrevented:false, preventDefault() {this.defaultPrevented = true;}, ...extra};
      for (let node = this; node; node = node.parentElement) for (const callback of node.listeners[type] || []) callback(event);
      return event;
    }
    focus() { const prior = document.activeElement; document.activeElement = this; prior?.emit('focusout', {relatedTarget:this}); this.emit('focusin'); }
  }
  document = new Element('document'); document.body = new Element('body'); document.append(document.body);
  document.activeElement = document.body;
  document.createElement = tag => new Element(tag);
  document.createComment = () => {const node = new Element(); node.nodeType = 8; return node;};
  document.getElementById = id => {let found; const visit = node => {if (node.id === id) found = node; node.children.forEach(visit);}; visit(document); return found;};
  const header = new Element('header', {class:'site-header'}), topbar = new Element('div', {class:'sbos-topbar'});
  const primary = new Element('nav', {'aria-label':'Main navigation'});
  document.body.append(header); header.append(topbar); topbar.append(primary);
  const menus = {};
  primary.append(new Element('a', {href:'https://example.test/'}));
  for (const name of ['daily', 'sunday', 'research']) {
    const trigger = new Element('button', {'data-nav-menu':name, 'aria-controls':name+'-subnav', 'aria-expanded':'false'});
    const nav = new Element('nav', {id:name+'-subnav', class:'sbos-subnav'}); nav.hidden = true;
    const link = new Element('a', {href:'https://example.test/'+name+'/?date=2026-10-29#saved'});
    nav.append(link); primary.append(trigger); header.append(nav); menus[name] = {trigger, nav, link};
  }
  const results = new Element('a', {href:'https://example.test/results/'}); primary.append(results);
  const settings = new Element('details', {class:'appearance-settings', open:''}), summary = new Element('summary');
  settings.append(summary); topbar.append(settings);
  const outside = new Element('main'); document.body.append(outside);
  const frames = [];
  const media = {matches:isMobile, addEventListener(type, callback) {this.change = callback;}};
  const window = {matchMedia:() => media, addEventListener() {}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/navigation.js'), 'utf8'), {
    document, window, URL, location:{href:'https://example.test/'}, requestAnimationFrame:callback => frames.push(callback), MutationObserver:class {observe() {}},
  });
  const toggle = topbar.querySelector('.sbos-menu-toggle'), panel = topbar.querySelector('.sbos-navigation');
  return {document, header, topbar, primary, menus, results, settings, summary, outside, toggle, panel,
    click(el) {el.focus(); el.emit('click');}, key(el, key) {el.focus(); return el.emit('keydown', {key});},
    resize(value) {media.matches = value; media.change();}, flush() {while (frames.length) frames.shift()();}, Element};
}

test('mobile menu uses one link set, hiding it until explicitly opened', () => {
  const f = fixture();
  assert.equal(f.panel.hidden, true); assert.equal(f.toggle.hidden, false);
  assert.equal(f.toggle.getAttribute('aria-controls'), f.panel.id);
  for (const {trigger, nav} of Object.values(f.menus)) {
    assert.equal(nav.parentElement, f.primary);
    assert.equal(f.primary.children[f.primary.children.indexOf(trigger)+1], nav);
  }
  f.click(f.toggle);
  assert.equal(f.panel.hidden, false); assert.equal(f.toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(f.settings.getAttribute('open'), null);
  f.click(f.menus.research.trigger); f.click(f.menus.daily.trigger);
  assert.equal(f.menus.research.nav.hidden, true); assert.equal(f.menus.daily.nav.hidden, false);
  assert.equal(f.primary.children.at(-1), f.results);
});

test('Arrow Down enters a group and Escape restores parent then Menu focus', () => {
  const f = fixture(); f.click(f.toggle);
  assert.equal(f.key(f.menus.daily.trigger, 'ArrowDown').defaultPrevented, true);
  assert.equal(f.document.activeElement, f.menus.daily.link);
  f.key(f.menus.daily.link, 'Escape');
  assert.equal(f.document.activeElement, f.menus.daily.trigger);
  assert.equal(f.menus.daily.nav.hidden, true); assert.equal(f.panel.hidden, false);
  f.key(f.menus.daily.trigger, 'Escape');
  assert.equal(f.document.activeElement, f.toggle); assert.equal(f.panel.hidden, true);
});

test('touch outside, focus departure, appearance and link activation dismiss the mobile menu', () => {
  for (const dismiss of [
    f => f.outside.emit('pointerdown', {pointerType:'touch'}),
    f => f.outside.focus(),
    f => f.click(f.summary),
    f => f.click(f.menus.daily.link),
  ]) {
    const f = fixture(); f.click(f.toggle); f.click(f.menus.daily.trigger);
    const href = f.menus.daily.link.href; dismiss(f);
    assert.equal(f.panel.hidden, true); assert.equal(f.menus.daily.nav.hidden, true);
    assert.equal(f.toggle.getAttribute('aria-expanded'), 'false'); assert.equal(f.menus.daily.link.href, href);
  }
});

test('resizing repeatedly restores desktop dropdowns without duplicating or losing links', () => {
  const f = fixture(); const links = f.header.querySelectorAll('a');
  f.click(f.toggle); f.key(f.menus.research.trigger, 'ArrowDown');
  for (let i=0; i<3; i++) {
    f.resize(false); assert.equal(f.toggle.hidden, true); assert.equal(f.panel.hidden, false);
    for (const {nav} of Object.values(f.menus)) {assert.equal(nav.parentElement, f.header); assert.equal(nav.hidden, true);}
    assert.deepEqual(f.header.querySelectorAll('a').slice().sort((a,b) => a.href.localeCompare(b.href)), links.slice().sort((a,b) => a.href.localeCompare(b.href)));
    f.click(f.menus.daily.trigger); assert.equal(f.menus.daily.nav.hidden, false);
    f.resize(true); assert.equal(f.panel.hidden, true); assert.equal(f.toggle.hidden, false);
    assert.equal(f.document.activeElement, f.toggle);
  }
});

test('focusing an offscreen category scrolls its strip while preserving page focus', () => {
  const f = fixture(), list = new f.Element('div', {class:'daily-tabs'}), tab = new f.Element('button', {role:'tab'});
  list.scrollWidth = 600; list.clientWidth = 300; list.scrollLeft = 0;
  list.rect = {left:10,right:310}; tab.rect = {left:350,right:450}; list.append(tab); f.document.body.append(list);
  tab.focus(); assert.equal(list.scrollLeft, 144); assert.equal(f.document.activeElement, tab);
});
