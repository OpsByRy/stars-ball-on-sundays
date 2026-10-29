'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const routes=require('../assets/routes.js'),publication=require('../assets/publication.js'),root=path.join(__dirname,'..'),base='https://example.test/stars-ball-on-sundays/';
test('consumer category URLs round trip to unchanged stored category identities',()=>{
 for(const [name,id] of [['layups','value_safe'],['lobs','high_probability_aggressive'],['bench','honorable_mention']]){
  assert.equal(routes.categoryId(name),id);assert.equal(publication.readPickState('?date=2026-10-28&type='+name+'&favorites=1').type,id);
  assert.equal(new URLSearchParams(publication.pickSearch('2026-10-28',{type:id,favoritesOnly:true})).get('type'),name);
  assert.equal(publication.readPickState('?type='+id).type,id);
 }
 assert.equal(routes.categoryId('private'),'all');
});
test('legacy destinations preserve dates, filters, project prefixes and matching parlay tabs',()=>{
 const plus=routes.canonicalURL(base+'plus-money/?date=2026-10-28&type=longshots&minimum=80&sort=price_desc',base);
 assert.equal(plus.pathname,'/stars-ball-on-sundays/parlays/');assert.equal(plus.hash,'#longshots');assert.equal(plus.searchParams.get('date'),'2026-10-28');assert.equal(plus.searchParams.get('minimum'),'80');assert.equal(plus.searchParams.get('sort'),'price_desc');assert.equal(plus.searchParams.has('type'),false);
 assert.equal(routes.canonicalURL(base+'plus-money/?favorite=1#plus-money',base).hash,'#plus-money');
 for(const [old,next] of [['archive','results'],['philosophy','about']]){const u=routes.canonicalURL(base+old+'/?date=2026-10-27#section',base);assert.equal(u.pathname,'/stars-ball-on-sundays/'+next+'/');assert.equal(u.search,'?date=2026-10-27');assert.equal(u.hash,'#section');}
 const sunday=routes.canonicalURL(base+'archive/sundays/2026-10-25/index.html?favorites=1#ry-parlays',base);assert.equal(sunday.pathname,'/stars-ball-on-sundays/sundays/week.html');assert.equal(sunday.searchParams.get('date'),'2026-10-25');assert.equal(sunday.searchParams.get('favorites'),'1');assert.equal(sunday.hash,'#ry-parlays');
 const external='https://another.example/archive/?date=2026-10-26';assert.equal(routes.canonicalURL(external,base).href,external);
 const nested=routes.canonicalURL(base+'players/profile.html?player=nba%3A1&board=date%3D2026-10-28%26type%3Dvalue_safe',base);assert.equal(nested.searchParams.get('board'),'date=2026-10-28&type=layups');
});
test('same-game links and preferred-name aliases resolve to one shareable tab without dropping filters',()=>{
 for(const location of ['parlays/?date=2026-10-29&minimum=80&type=same_game','parlays/?date=2026-10-29&minimum=80#same-game','parlays/?date=2026-10-29&minimum=80#sgp-plus','plus-money/?date=2026-10-29&minimum=80#sgpx']){
  const url=routes.canonicalURL(base+location,base);assert.equal(url.pathname,'/stars-ball-on-sundays/parlays/');assert.equal(url.hash,'#same-game');assert.equal(url.searchParams.get('date'),'2026-10-29');assert.equal(url.searchParams.get('minimum'),'80');assert.equal(url.searchParams.has('type'),false);
 }
 assert.deepEqual(routes.parlayLocation('?date=2026-10-29&type=same_game&favorite=1','same_game'),{search:'?date=2026-10-29&favorite=1',hash:'#same-game'});
});
test('every full public page has the same ordered main menu and Private Lab stays last in Research',()=>{
 const files=JSON.parse(fs.readFileSync(path.join(root,'site-manifest.json'))).files.filter(f=>f.endsWith('.html'));
 for(const file of files){const html=fs.readFileSync(path.join(root,file),'utf8');if(html.includes('data-redirect-route'))continue;
  const main=html.match(/<nav aria-label="Main navigation">(.*?)<\/nav>/)?.[1];if(!main)continue;
  const labels=[...main.matchAll(/>(Home|Daily Board|Sunday Edition|Parlays|Research|Results|About SBOS)(?: <span|<)/g)].map(m=>m[1]);assert.deepEqual(labels,['Home','Daily Board','Sunday Edition','Parlays','Research','Results','About SBOS'],file);
  assert.doesNotMatch(main,/>Ry’s Picks<|>Plus Money</,file);
  const research=html.match(/<nav id="research-subnav"[^>]*>(.*?)<\/nav>/)?.[1];assert.ok(research,file);assert.match(research,/<svg class="nav-lock"[^>]*fill="currentColor"/);assert.match(research,/Private Lab<\/a><\/div>$/);assert.doesNotMatch(research,/🔒/);assert.match(research,/href=\"https:\/\/sbos-private-parlay-lab\.stormydill1024\.chatgpt\.site\"/);
 }
});
test('category information is exact, icon-scoped and separate from category switching',()=>{
 const code=fs.readFileSync(path.join(root,'assets/pick-category-release.js'),'utf8'),css=fs.readFileSync(path.join(root,'assets/pick-category-release.css'),'utf8');
 for(const text of ['More conservative lines with higher estimated hit probability.','More aggressive lines with greater payout potential, still screened for value.','Additional props our model flags for potential value. For review only; excluded from our official picks and hit/miss record.'])assert.ok(code.includes(text));
 assert.match(code,/closest\?\.\('\[data-category-info\]'\)/);assert.match(code,/stopPropagation\(\)/);assert.match(code,/event\.key === 'Escape'/);assert.match(code,/pointerdown/);assert.match(css,/\.pick-category-info:hover/);
 assert.doesNotMatch(code,/addEventListener\('focusin'/);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'assets/publication.js'),'utf8'),/All Daily Board/);
});
