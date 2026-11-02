const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const pub=require('../assets/publication.js'),results=require('../assets/result-utils.js');
const read=p=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',p)));
const sunday=()=>{const entry=read('data/editions/manifest.json').editions.filter(e=>e.channel==='sunday'&&e.date==='2026-11-01').at(-1);return read('data/editions/'+entry.path);};
const dailyEntry=()=>read('data/editions/manifest.json').editions.filter(e=>e.channel==='daily'&&e.date==='2026-11-01').at(-1);
const daily=()=>read('data/editions/'+dailyEntry().path);

test('Sunday uses the latest same-date Daily source without duplicating its recommendations',()=>{
 const index=read('data/editions/manifest.json'),before=JSON.stringify(index),sources=pub.sundaySourceEntries(index.editions,'2026-11-01');
 assert.equal(sources.personalEntry.version,sunday().version);assert.equal(sources.boardEntry.version,dailyEntry().version);assert.equal(sources.boardEntry.channel,'daily');
 assert.equal(pub.allPicks(daily()).length,10);assert.equal(pub.tabCounts(daily()).favorites,0);
 assert.equal(pub.allPicks(sunday()).length,0);assert.equal(results.personalParlays(sunday()).length,1);assert.equal(JSON.stringify(index),before);
});

test('a later same-date result edition advances the board while Stars retain their own source',()=>{
 const entries=read('data/editions/manifest.json').editions,before=JSON.stringify(entries),last=dailyEntry();
 const newer={...last,version:'f'.repeat(16),path:'daily/2026-11-01/'+'f'.repeat(16)+'.json',updatedAt:new Date(Date.parse(last.updatedAt)+1000).toISOString()};
 const selected=pub.sundaySourceEntries([...entries,newer],'2026-11-01');
 assert.equal(selected.boardEntry,newer);assert.equal(selected.personalEntry.version,sunday().version);assert.equal(JSON.stringify(entries),before);
});

test('historical Sundays retain their own source when no same-date Daily record exists',()=>{
 const index=read('data/editions/manifest.json'),sources=pub.sundaySourceEntries(index.editions,'2026-10-25');
 assert.equal(sources.boardEntry,sources.personalEntry);assert.equal(sources.boardEntry.channel,'sunday');
 assert.equal(pub.sundaySourceEntries(index.editions,'2026-10-26'),null);
 assert.equal(pub.sundaySourceEntries(index.editions,'2099-11-01'),null);
 assert.equal(pub.sundaySourceEntries(index.editions,'../../daily'),null);
});

test('Sunday Stars renders one personal parlay, never an inferred individual-favorites list',()=>{
 const b=sunday(),before=JSON.stringify(b),html=pub.sundayStarsHTML(b);
 assert.match(html,/<h2 id="sunday-stars-title">Ry’s Sunday Stars<\/h2>/);assert.ok(html.includes('data-sunday-source-version="'+b.version+'"'));
 assert.equal((html.match(/data-personal-slip-id=/g)||[]).length,1);assert.match(html,/\+530/);assert.match(html,/\+110/);assert.match(html,/\+117/);
 assert.match(html,/Parlay membership does not mark individual picks as favorites/);assert.doesNotMatch(html,/data-favorites-tab=|data-favorite-pick-record|role="tablist"/);
 assert.match(html,/not an algorithm-qualified recommendation/);assert.match(html,/pre-placement observations, not accepted component prices/);assert.equal(JSON.stringify(b),before);
});

test('Sunday and dated Sunday pages share Daily layout controls and preserve route identity',()=>{
 for(const name of ['sundays/index.html','sundays/week.html']){
  const html=fs.readFileSync(path.join(__dirname,'..',name),'utf8');
  assert.match(html,/<body data-page="daily" data-board-channel="sunday">/);assert.match(html,/assets\/daily\.css/);assert.match(html,/class="shell daily-main"/);
  for(const id of ['slate-date','slate-context','reload-data','daily-content'])assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/<h1 id="week-title">Sunday Edition\.<\/h1>/);
 }
 const old=fs.readFileSync(path.join(__dirname,'../sundays/week.html'),'utf8');assert.match(old,/rel="canonical" href="https:\/\/opsbyry.github.io\/stars-ball-on-sundays\/sundays\/week.html"/);
 assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../daily/index.html'),'utf8'),/data-board-channel="sunday"/);
});

async function mountedSunday(day='2026-11-01'){
 const script=fs.readFileSync(path.join(__dirname,'../assets/publication.js'),'utf8'),elements={},listeners={},watch={};let address=new URL('https://example.com/project/sundays/?date='+day);
 const element=id=>elements[id]||(elements[id]={innerHTML:'',textContent:'',value:'',disabled:false,addEventListener(){},setAttribute(){},removeAttribute(){}});
 for(const id of ['daily-content','slate-date','slate-context','reload-data'])element(id);
 const slot={dataset:{personalSource:'sunday'},innerHTML:'',querySelectorAll(){return [];}};
 const document={body:{dataset:{page:'daily',boardChannel:'sunday'}},activeElement:null,getElementById:id=>elements[id]||null,addEventListener(name,fn){(listeners[name]||=[]).push(fn);},querySelector(selector){return selector==='script[data-publication]'?{src:'https://example.com/project/assets/publication.js'}:selector==='[data-sunday-stars-record]'?element('stars-record'):null;},querySelectorAll(selector){return selector==='[data-personal-slips]'?[slot]:[];}};
 const board={...require('../assets/pick-board.js'),create(){return {beginDate(){},renderRow(row){return '<article data-test-pick="'+row.id+'"></article>';},refresh(){return Promise.resolve();}};},watchResults(options){watch.callback=options.onResults;return {setRows(rows){watch.rows=rows;},stop(){}};}};
 const window={SBOS_SLATE_POLICY:require('../assets/slate-policy.js'),STARS_RESULT_UTILS:results,SBOS_ROUTES:require('../assets/routes.js'),SBOS_FAVORITES:require('../assets/favorites.js'),SBOS_PICK_BOARD:board,SBOS_PLUS_MONEY:require('../assets/plus-money.js'),SBOS_UNITS:require('../assets/unit-tracker.js'),addEventListener(){}};
 const all=read('data/editions/manifest.json'),historicalEntry=pub.sundaySourceEntries(all.editions,'2026-10-25').personalEntry,historical=read('data/editions/'+historicalEntry.path),bodies=new Map([[daily().version,daily()],[sunday().version,sunday()],[historical.version,historical]]),requests=[];
 const fetch=async input=>{const url=new URL(input);requests.push(url.pathname);let value;if(url.pathname.endsWith('/manifest.json'))value=all;else {const version=path.basename(url.pathname,'.json'),b=bodies.get(version);assert.ok(b,'Unexpected source '+url.pathname);value=url.pathname.includes('/data/boards/')?{schemaVersion:'public-board-1',sourceVersion:version,edition:{...b,props:b.props.filter(r=>r.category!=='not_a_pick')}}:b;}return {ok:true,json:async()=>JSON.parse(JSON.stringify(value))};};
 const location={get href(){return address.href;},get search(){return address.search;},get hash(){return address.hash;}};
 const history={replaceState(_a,_b,url){address=new URL(url,address);},pushState(_a,_b,url){address=new URL(url,address);}};
 const context={module:{exports:{}},window,document,location,history,fetch,URL,URLSearchParams,setTimeout,clearTimeout};vm.runInNewContext(script,context);await context.module.exports.init();
 return {elements,slot,watch,requests,location};
}

test('actual Sunday initialization places Stars first and reuses the Daily tabs and exact source',async()=>{
 const mounted=await mountedSunday(),html=mounted.elements['daily-content'].innerHTML;
 assert.ok(html.indexOf('id="ry-sunday-stars"')<html.indexOf('class="edition-panel daily-edition"'));
 assert.ok(html.includes('data-board-source="daily:'+daily().version+'"'));assert.match(html,/All Sunday Picks/);assert.match(html,/aria-label="Sunday pick category"/);
 assert.match(html,/Free Throws<\/span><strong>6/);assert.match(html,/Floaters<\/span><strong>4/);assert.equal((html.match(/data-test-pick=/g)||[]).length,10);
 assert.equal(mounted.watch.rows.length,5);assert.ok(mounted.requests.every(p=>p.startsWith('/project/data/')));assert.equal(mounted.location.href,'https://example.com/project/sundays/?date=2026-11-01');
 assert.ok(mounted.requests.includes('/project/data/editions/sunday/2026-11-01/'+sunday().version+'.json'));assert.ok(!mounted.requests.some(p=>p.includes('/data/boards/sunday/')));
});

test('verified posting appends an immutable successor without rewriting ticket or source facts',()=>{
 const original=read('data/editions/sunday/2026-11-01/bb42e33e7a59f527.json'),posted=read('data/editions/sunday/2026-11-01/3b91e2be313d30e2.json');
 const first='2026-11-01T19:02:17.705924Z';
 assert.equal(original.firstPublishedAt,null);assert.equal(original.personalPublication.publishedAt,null);
 assert.equal(posted.firstPublishedAt,first);assert.equal(posted.personalPublication.publishedAt,first);
 assert.equal(posted.personalPublication.recordedAt,original.personalPublication.recordedAt);assert.deepEqual(posted.personalSlips,original.personalSlips);
 assert.equal(posted.props.length,original.props.length);
 posted.props.forEach((row,i)=>{assert.equal(original.props[i].postedAt,null);assert.equal(row.postedAt,first);assert.ok(Date.parse(first)<Date.parse(row.startTime));const withoutPosting=({postedAt,...rest})=>rest;assert.deepEqual(withoutPosting(row),withoutPosting(original.props[i]));});
 assert.doesNotMatch(posted.priceNote,/awaiting deployment/);assert.match(posted.priceNote,/First public posting verified/);
});

test('Sunday ticket polling retains the owner source and cannot turn it into the Daily board',async()=>{
 const mounted=await mountedSunday();for(const row of mounted.watch.rows)row.result={eventStatus:'final',statisticalOutcome:'win',actual:40};
 mounted.watch.callback();assert.match(mounted.elements['stars-record'].innerHTML,/>1<\/strong> hit/);assert.match(mounted.slot.innerHTML,/Ry’s Sunday Pick/);assert.match(mounted.slot.innerHTML,/\+530/);
 assert.ok(mounted.elements['daily-content'].innerHTML.includes('data-board-source="daily:'+daily().version+'"'));
 assert.equal((mounted.elements['daily-content'].innerHTML.match(/data-test-pick=/g)||[]).length,10);
});

test('an archived Sunday with no Daily source retains local saved research and personal-record access',async()=>{
 const mounted=await mountedSunday('2026-10-25'),html=mounted.elements['daily-content'].innerHTML;
 assert.match(html,/data-board-source="sunday:/);assert.match(html,/href="#sunday-saved-research"/);assert.match(html,/id="sunday-saved-research"/);
 assert.ok(!mounted.requests.some(p=>p.includes('/data/boards/sunday/')));assert.ok(mounted.requests.some(p=>p.includes('/data/editions/sunday/2026-10-25/')));
});
