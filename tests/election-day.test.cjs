const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const notice=require('../assets/election-day.js');
const vm=require('node:vm');
function fixture({dismissed=false,storageFails=false,native=true,now=Date.parse('2026-11-03T17:00:00Z'),otherDialog=false}={}){
 const writes=[],timers=[],nodes=[];let clock=now;
 const doc={activeElement:null,listeners:new Map(),createElement(tag){const e=new Element(tag);nodes.push(e);return e;},getElementById(id){return nodes.find(e=>e.id===id&&e.isConnected)||null;},querySelector(selector){if(selector==='.site-header')return this.header;if(selector==='dialog[open]')return nodes.find(e=>e.tag==='dialog'&&e.open&&e.isConnected)||null;return null;},addEventListener(type,fn){this.listeners.set(type,fn);},removeEventListener(type){this.listeners.delete(type);}};
 class Element{
  constructor(tag){this.tag=tag;this.listeners=new Map();this.children=[];this.parts={};this.attrs={};this.hidden=false;this.open=false;this.isConnected=false;this.classList={set:new Set(),add:x=>this.classList.set.add(x),remove:x=>this.classList.set.delete(x)};if(tag==='dialog'&&native){this.showModal=()=>{this.open=true;};this.close=()=>{this.open=false;this.emit('close');};}}
  setAttribute(k,v){this.attrs[k]=v;}append(e){this.children.push(e);e.isConnected=this.isConnected;}prepend(e){this.children.unshift(e);e.isConnected=this.isConnected;}insertAdjacentElement(_,e){doc.body.append(e);}remove(){this.isConnected=false;for(const p of nodes)p.children=p.children.filter(e=>e!==this);}addEventListener(type,fn){this.listeners.set(type,fn);}emit(type){const event={type,prevented:false,preventDefault(){this.prevented=true;}};this.listeners.get(type)?.(event);return event;}focus(){doc.activeElement=this;}
  set innerHTML(value){this.markup=value;this.parts={};const keys=this.tag==='dialog'?['.sbos-election-logo','.sbos-election-polling','.sbos-election-disclosure','[data-election-close]','[data-election-continue]']:['button'];for(const key of keys){const e=new Element(key.includes('logo')?'img':key.includes('polling')||key.includes('history')?'a':'button');this.parts[key]=e;}}
  get innerHTML(){return this.markup||'';}querySelector(selector){return this.parts[selector]||null;}
 }
 doc.body=new Element('body');doc.body.isConnected=true;doc.header=new Element('header');doc.header.isConnected=true;doc.head=new Element('head');doc.head.isConnected=true;doc.documentElement=new Element('html');doc.activeElement=doc.body;
 const win={Date:{now:()=>clock},sessionStorage:{getItem(k){assert.equal(k,notice.KEY);if(storageFails)throw Error('Blocked');return dismissed?'1':null;},setItem(k,v){if(storageFails)throw Error('Blocked');writes.push([k,v]);}},setTimeout(fn,delay){timers.push({fn,delay});return timers.length;},clearTimeout(id){if(timers[id-1])timers[id-1].cleared=true;}};
 if(otherDialog){const d=doc.createElement('dialog');d.open=true;doc.body.append(d);}
 const api=notice.boot(win,doc,new URL('https://example.invalid/assets/'));
 return{doc,win,api,writes,timers,nodes,load(){doc.head.children.find(e=>e.tag==='link')?.emit('load');},at(value){clock=value;doc.listeners.get('visibilitychange')?.();}};
}
test('notice is bounded to Nov3 Eastern with an exclusive end, including wrong/invalid clocks',()=>{
 for(const n of [notice.START-1,notice.END,notice.END+1,NaN,Infinity,undefined])assert.equal(notice.active(n),false);
 for(const n of [notice.START,notice.START+1,notice.END-1])assert.equal(notice.active(n),true);
 assert.equal(fixture({now:notice.END}).api,null);
});
test('exact requested copy, verified locator, actual artwork and locked disclosure appear in native dialog',()=>{
 const f=fixture();f.load();const d=f.api.dialog;assert.equal(d.open,true);assert.equal(d.attrs['aria-labelledby'],'sbos-election-title');assert.equal(d.attrs['aria-describedby'],'sbos-election-message');
 assert.match(d.innerHTML,/HAPPY /);assert.match(d.innerHTML,/ELECTION /);assert.match(d.innerHTML,/>DAY<\/span>/);assert.doesNotMatch(d.innerHTML,/DAY!|sbos-election-punctuation|Browse history|data-election-history/);assert.match(d.innerHTML,/NO NBA GAMES SCHEDULED, /);assert.doesNotMatch(d.innerHTML,/NO NBA GAME SCHEDULED/);assert.match(f.api.banner.innerHTML,/No NBA games scheduled/);assert.doesNotMatch(f.api.banner.innerHTML,/No NBA game scheduled/);assert.match(d.innerHTML,/PLEASE GO VOTE!/);
 const a=d.querySelector('.sbos-election-polling');assert.equal(a.href,'https://www.vote.org/polling-place-locator/');assert.match(d.innerHTML,/>Find Your Polling Place/);assert.match(d.innerHTML,/rel="noopener noreferrer"/);
 assert.equal(d.querySelector('.sbos-election-logo').src,'https://example.invalid/assets/brand/sbos-primary-compact-classic-720.webp');assert.equal(d.querySelector('.sbos-election-disclosure').textContent,notice.DISCLOSURE);assert.equal(f.writes.length,0);
});
test('close persists only the dated dismissal and keeps the site/history in place',()=>{
 const f=fixture();const existing={id:'immutable-history',odds:-162};f.doc.body.children.push(existing);f.load();
 f.api.dialog.querySelector('[data-election-close]').emit('click');assert.equal(f.api.dialog.open,false);assert.deepEqual(f.writes,[[notice.KEY,'1']]);assert.equal(f.api.banner.hidden,false);assert.ok(f.doc.body.children.includes(existing));assert.deepEqual(existing,{id:'immutable-history',odds:-162});assert.equal(f.doc.documentElement.classList.set.size,0);
});
test('keyboard focus starts at Close and returns to the previous connected control',()=>{
 const f=fixture(),prior=f.doc.createElement('button');f.doc.body.append(prior);prior.focus();f.load();assert.equal(f.doc.activeElement,f.api.dialog.querySelector('[data-election-close]'));f.api.dismiss();assert.equal(f.doc.activeElement,prior);
});
test('continue and polling actions dismiss without rewriting the current edition',()=>{
 for(const selector of ['[data-election-continue]','.sbos-election-polling']){const f=fixture();f.load();f.api.dialog.querySelector(selector).emit('click');assert.equal(f.api.dialog.open,false);assert.equal(f.writes.length,1);assert.equal(f.api.dialog.querySelector('[data-election-history]'),null);}
});
test('Escape retains the native cancel action and remembers dismissal',()=>{
 const f=fixture();f.load();const event=f.api.dialog.emit('cancel');assert.equal(event.prevented,false);f.api.dialog.close();assert.equal(f.api.banner.hidden,false);assert.equal(f.writes.length,1);
});
test('dismissed navigation stays unobstructed and the banner can deliberately reopen the notice',()=>{
 const f=fixture({dismissed:true});f.load();assert.equal(f.api.dialog.open,false);assert.equal(f.api.banner.hidden,false);f.api.banner.querySelector('button').emit('click');assert.equal(f.api.dialog.open,true);f.api.dismiss();assert.equal(f.api.dialog.open,false);
});
test('storage failure cannot trap the visitor or prevent dismiss/reopen',()=>{
 const f=fixture({storageFails:true});f.load();assert.equal(f.api.dialog.open,true);assert.doesNotThrow(()=>f.api.dismiss());assert.equal(f.api.dialog.open,false);assert.doesNotThrow(()=>f.api.open());assert.equal(f.api.dialog.open,true);
});
test('an existing modal is not interrupted by automatic opening',()=>{
 const f=fixture({otherDialog:true});f.load();assert.equal(f.api.dialog.open,false);assert.equal(f.api.banner.hidden,false);
});
test('non-dialog fallback is a dismissible, nonblocking linked banner',()=>{
 const f=fixture({native:false});f.load();assert.equal(f.api.dialog.isConnected,false);assert.match(f.api.banner.innerHTML,/Find Your Polling Place/);assert.equal(f.doc.documentElement.classList.set.size,0);f.api.banner.querySelector('button').emit('click');assert.equal(f.api.banner.hidden,true);assert.equal(f.writes.length,1);
});
test('expiry removes both notice surfaces and preserves underlying site content',()=>{
 const f=fixture();f.load();f.at(notice.END);assert.equal(f.api.dialog.isConnected,false);assert.equal(f.api.banner.isConnected,false);assert.equal(f.doc.documentElement.classList.set.size,0);assert.equal(f.doc.listeners.has('visibilitychange'),false);assert.doesNotThrow(()=>f.api.open());assert.equal(f.api.dialog.open,false);
});
test('a failed stylesheet leaves no unstyled modal or page lock',()=>{
 const f=fixture();f.doc.head.children[0].emit('error');assert.equal(f.api.dialog.isConnected,false);assert.equal(f.doc.documentElement.classList.set.size,0);assert.equal(f.writes.length,0);
});
test('no data/network/account APIs or HTML rewriting are introduced',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../assets/election-day.js'),'utf8');assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|indexedDB|document\.write|location\.(?:href|assign|replace)\s*=/);assert.match(source,/sessionStorage\.setItem\(KEY,'1'\)/);
});
test('shared loader is date-bound, duplicate-safe and keeps hosted-subpath asset resolution',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../assets/navigation.js'),'utf8'),loader=source.slice(source.indexOf('/* Election Day notice:'));
 for(const[now,count]of [[notice.START-1,0],[notice.START,1],[notice.END-1,1],[notice.END,0]]){
  const loaded=[],doc={querySelector(selector){return selector==='script[data-sbos-navigation]'?{src:'https://example.invalid/stars-ball-on-sundays/assets/navigation.js?v=old'}:loaded[0]||null;},createElement:()=>({dataset:{}}),head:{append:e=>loaded.push(e)}};
  const ctx={document:doc,URL,Date:{now:()=>now,parse:Date.parse}};vm.runInNewContext(loader,ctx);vm.runInNewContext(loader,ctx);assert.equal(loaded.length,count);if(count)assert.equal(loaded[0].src,'https://example.invalid/stars-ball-on-sundays/assets/election-day.js?v=20261103-3');
 }
});
test('manifest adds only the reviewed overlay/font assets without exposing source kits',()=>{
 const names=JSON.parse(fs.readFileSync(path.join(__dirname,'../site-manifest.json'),'utf8')).files;
 for(const n of ['assets/election-day.js','assets/election-day.css','assets/fonts/SBOSAngular-Logo.woff2','assets/fonts/SBOSOxanium-VF.woff2','assets/fonts/SBOSOxanium-OFL.txt','assets/fonts/SBOSAngular-LICENSE.txt'])assert.equal(names.filter(x=>x===n).length,1);
 assert.ok(!names.some(x=>/\.ufo|\.zip$|source\/|private|model/i.test(x)));
});
test('approved font binaries are unchanged, web-licensed and loaded without synthetic styling',()=>{
 const fonts={'SBOSAngular-Logo.woff2':'a4381ca59e7cd1e189e42ab7e9c195c4d01bcc83be19cbd05f370168572eb234','SBOSOxanium-VF.woff2':'e0426a2e556fa7af826d4e117591f99cd8d5b425ba720b4c2bf0c5cd9a4ebfea','SBOSAngular-Solid.woff2':'c3eb52ff1bb2e243f64eca20a3330a4fe0edfeb94150fad5714ec88724a749b8'};
 for(const[n,hash]of Object.entries(fonts)){const b=fs.readFileSync(path.join(__dirname,'../assets/fonts',n));assert.equal(b.subarray(0,4).toString(),'wOF2');assert.equal(crypto.createHash('sha256').update(b).digest('hex'),hash);}
 assert.match(fs.readFileSync(path.join(__dirname,'../assets/fonts/SBOSAngular-LICENSE.txt'),'utf8'),/web embedding/);const css=fs.readFileSync(path.join(__dirname,'../assets/election-day.css'),'utf8');assert.match(css,/font-synthesis:none/);assert.doesNotMatch(css,/sbos-election-punctuation/);
});
test('all overlay content, close control and disclosure use the center axis without a float',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../assets/election-day.css'),'utf8');
 const rule=name=>css.match(new RegExp('\\.'+name+'\\{([^}]+)\\}'))?.[1]||'';
 assert.match(rule('sbos-election-art'),/justify-items:center/);
 assert.match(rule('sbos-election-close'),/float:none/);assert.match(rule('sbos-election-close'),/margin:-16px auto 24px/);
 assert.match(rule('sbos-election-disclosure'),/text-align:center/);assert.doesNotMatch(css,/float:right|text-align:left|justify-content:space-between/);
 assert.match(rule('sbos-election-actions'),/width:100%/);assert.match(rule('sbos-election-actions'),/justify-items:center/);
});
test('post-dismissal banner inherits current palette and accessible focus colors without another preference writer',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../assets/election-day.css'),'utf8');
 const banner=css.match(/\.sbos-election-banner\{([^}]+)\}/)[1];
 for(const token of ['--surface','--text','--border-control'])assert.ok(banner.includes('var('+token+','),token);
 const action=css.match(/\.sbos-election-banner button,\.sbos-election-banner a\{([^}]+)\}/)[1];
 for(const token of ['--action','--action-text'])assert.ok(action.includes('var('+token+','),token);
 assert.match(css,/\.sbos-election-banner :is\(a,button\):focus-visible\{outline:3px solid var\(--focus-ring,/);
 const source=fs.readFileSync(path.join(__dirname,'../assets/election-day.js'),'utf8');assert.doesNotMatch(source,/localStorage|dataset\.(?:brand|mode)|setAttribute\(['"]data-(?:brand|mode)/);
});
