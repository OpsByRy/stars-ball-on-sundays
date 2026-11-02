const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const favorites=require('../assets/favorites.js'),publication=require('../assets/publication.js'),results=require('../assets/result-utils.js'),parlays=require('../assets/plus-money.js'),units=require('../assets/unit-tracker.js');
const root=path.resolve(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p)));
const five=()=>read('data/editions/daily/2026-10-30/3c26a5cf7d231094.json'),seven=()=>read('data/editions/daily/2026-10-31/7d5c2b47eb40c3ff.json');

test('Favorites tabs have independent labelled panels, counts, roving focus and Picks as the default',()=>{
 const html=favorites.shell({pickCount:9,parlayCount:5,picksHTML:'NORMAL_PICK_ROWS',parlaysHTML:'SAVED_PARLAY_CARDS'});
 assert.match(html,/role="tablist" aria-label="Ry’s Favorites"/);
 assert.match(html,/id="ry-favorites-tab-picks"[^>]+aria-selected="true" tabindex="0"/);
 assert.match(html,/id="ry-favorites-tab-parlays"[^>]+aria-selected="false" tabindex="-1"/);
 assert.match(html,/data-favorites-panel="picks">NORMAL_PICK_ROWS<\/section>/);
 assert.match(html,/data-favorites-panel="parlays" hidden>SAVED_PARLAY_CARDS<\/section>/);
 assert.match(html,/>Picks<\/span><strong>9/);assert.match(html,/>Parlays<\/span><strong>5/);
 assert.equal(favorites.readTab('?favorites_view=invalid'),'picks');assert.equal(favorites.readTab('?favorites_view=parlays'),'parlays');
});

test('shareable tab state preserves dates, board-return filters, prefix-independent queries and other URL state',()=>{
 const query='date=2026-10-30&board=q%3DAllen%26stat%3DPTS&q=Brandon&type=lobs';
 const next=favorites.searchWithTab(query,'parlays'),p=new URLSearchParams(next);
 assert.equal(p.get('date'),'2026-10-30');assert.equal(p.get('board'),'q=Allen&stat=PTS');assert.equal(p.get('q'),'Brandon');assert.equal(p.get('type'),'lobs');
 assert.equal(favorites.searchWithTab(next,'picks'),query);
});

test('keyboard activation and browser history toggle panels without replacing card state',()=>{
 const listeners={},windowListeners={},location={href:'https://example.com/project/daily/parlays/?date=2026-10-30&board=q%3DAllen#saved'};
 Object.defineProperty(location,'search',{get(){return new URL(this.href).search;}});
 const panels=['picks','parlays'].map(key=>({dataset:{favoritesPanel:key},hidden:key!=='picks'}));
 const view={querySelectorAll(selector){return selector==='[data-favorites-tab]'?tabs:panels;}};
 const list={querySelectorAll(){return tabs;}};
 let focused=null,pushed=0;
 const tabs=['picks','parlays'].map(key=>({dataset:{favoritesTab:key},attrs:{},tabIndex:key==='picks'?0:-1,setAttribute(k,v){this.attrs[k]=v;},focus(){focused=this;},closest(selector){return selector==='[data-favorites-view]'?view:selector==='[role="tablist"]'?list:this;}}));
 const sandbox={module:{exports:{}},URL,URLSearchParams,location,history:{pushState(_a,_b,url){pushed++;location.href=String(url);}},window:{addEventListener(k,v){windowListeners[k]=v;}},document:{addEventListener(k,v){listeners[k]=v;},querySelectorAll(){return [view];}}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'assets/favorites.js'),'utf8'),sandbox);sandbox.module.exports.init();
 let prevented=false;listeners.keydown({target:tabs[0],key:'End',preventDefault(){prevented=true;}});
 assert.equal(prevented,true);assert.equal(focused,tabs[1]);assert.equal(tabs[1].attrs['aria-selected'],'true');assert.equal(panels[1].hidden,false);assert.equal(panels[0].hidden,true);assert.equal(pushed,1);
 assert.match(location.href,/date=2026-10-30&board=q%3DAllen&favorites_view=parlays#saved$/);
 listeners.keydown({target:tabs[1],key:'ArrowRight',preventDefault(){}});assert.equal(focused,tabs[0]);assert.equal(panels[1].hidden,true);
 location.href='https://example.com/project/daily/parlays/?date=2026-10-30&favorites_view=parlays';windowListeners.popstate();assert.equal(panels[1].hidden,false);
});

test('five real parlays remain five independent collapsed site-format cards with fourteen exact leg occurrences',()=>{
 const body=five(),before=JSON.stringify(body),html=publication.personalSlipsHTML(body);
 assert.equal((html.match(/<details class="pm-row personal-parlay-row"/g)||[]).length,5);
 assert.equal((html.match(/class="pm-leg-row/g)||[]).length,14);assert.doesNotMatch(html,/<details class="pm-row[^>]+ open/);
 for(const slip of body.personalSlips){assert.match(html,new RegExp('data-personal-slip-id="'+slip.id+'"'));assert.match(html,new RegExp('>'+String(slip.americanOdds>0?'+':'').replace('+','\\+')+slip.americanOdds+'<'));}
 assert.equal(JSON.stringify(body),before);
});

test('unsubmitted straight quotes never leak into a placed ticket or its SGP prices',()=>{
 const body=seven(),before=JSON.stringify(body),html=publication.personalSlipsHTML(body);
 assert.match(html,/>\+630<\/strong>/);assert.equal((html.match(/Original ticket leg price unavailable/g)||[]).length,7);
 assert.equal((html.match(/No verified original group quote saved/g)||[]).length,2);
 for(const price of [-166,-400,-220,-390,-360,-240,-295])assert.doesNotMatch(html,new RegExp('>'+price+'<'));
 assert.match(html,/Total slip probability: <strong>Unavailable/);assert.equal(JSON.stringify(body),before);
});

test('original screenshot/share-link group quotes require evidence, and later quotes remain unavailable',()=>{
 const body=seven(),slip=body.personalSlips[0],group=slip.groups[0];slip.shareUrl='https://sportsbook.fanduel.com/addToBetslip?shareCode=Example';
 group.americanOdds=135;assert.match(publication.personalSlipsHTML(body),/Same-game group 1 · 3 legs: <strong>Unavailable/);
 group.priceEvidence={source:'share_link',context:'original_slip',observedAt:body.personalPublication.recordedAt};
 slip.legs[0].americanOdds=-155;slip.legs[0].priceEvidence={...group.priceEvidence};
 let html=publication.personalSlipsHTML(body);assert.match(html,/Same-game group 1 · 3 legs: <strong>\+135/);assert.match(html,/>-155<\/strong>/);assert.match(html,/Open shared FanDuel slip/);
 group.priceEvidence.context='later_quote';slip.legs[0].priceEvidence.context='later_quote';html=publication.personalSlipsHTML(body);
 assert.match(html,/Same-game group 1 · 3 legs: <strong>Unavailable/);assert.doesNotMatch(html,/>-155<\/strong>/);assert.equal(results.personalParlays(body)[0].legs[0].americanOdds,null);
 assert.equal(results.personalParlays(body)[0].americanOdds,630);
});

test('live misses and corrected results keep original ticket prices, separate wagers and void payout holds',()=>{
 const body=seven(),row=body.props.find(r=>r.group==='ry'&&r.player==='Brandon Miller');
 row.result={eventStatus:'live',statisticalOutcome:'pending',actual:5,minutesPlayed:32,sportsbookSettlement:'unverified'};
 let html=publication.personalSlipsHTML(body),ticket=results.personalParlays(body)[0];assert.match(html,/Miss · ● Live/);assert.match(html,/Miss · ● Live · 5 ast/);
 assert.equal(units.summarize([ticket],{kind:'parlays',personal:true}).netUnits,-.5);
 row.result.actual=3;assert.equal(results.parlayOutcome(results.personalParlays(body)[0]).outcome,'pending');
 row.result={eventStatus:'final',statisticalOutcome:'dnp'};html=publication.personalSlipsHTML(body);assert.match(html,/Revised full-ticket quote required after voids/);assert.match(html,/>\+630<\/strong>/);
 for(const r of body.props.filter(r=>r.group==='ry'))r.result={eventStatus:'final',statisticalOutcome:'dnp'};
 html=publication.personalSlipsHTML(body);assert.match(html,/Fully voided/);assert.match(html,/Refund/);assert.equal(results.parlayOutcome(results.personalParlays(body)[0]).outcome,'void');
});

test('every personal entry point loads the shared tab controller/card styles and all immutable source files stay out of this UI contract',()=>{
 for(const file of ['daily/index.html','daily/parlays/index.html','sundays/index.html','sundays/week.html','sundays/ry/index.html']){
  const html=fs.readFileSync(path.join(root,file),'utf8');assert.match(html,/assets\/favorites\.js/);assert.match(html,/assets\/plus-money\.css/);assert.ok(html.indexOf('assets/favorites.js')<html.indexOf('assets/publication.js'));
 }
 assert.ok(read('site-manifest.json').files.includes('assets/favorites.js'));
 const source=fs.readFileSync(path.join(root,'assets/publication.js'),'utf8');assert.match(source,/picksHTML:.*pickList\(rows,id\+'-picks'\).*parlaysHTML:.*recordSummary\(editionGroups\(body\)\.ry,'ry'\)/);
 assert.match(source,/opened=details.map\(node=>node.open\)/);assert.match(source,/node.open=opened\[index\]/);
});


test('personal quote and placement labels preserve shared-link versus screenshot provenance without repricing',()=>{
 const body=seven(),slip=body.personalSlips[0],evidence={source:'share_link',context:'original_slip',observedAt:body.personalPublication.recordedAt};
 slip.shareUrl='https://sportsbook.fanduel.com/addToBetslip?shareCode=Example';slip.priceEvidence={...evidence};slip.legs[0].americanOdds=-155;slip.legs[0].priceEvidence={...evidence};slip.placedAt='2026-10-31T21:45:00Z';
 const before=JSON.stringify(body),html=publication.personalSlipsHTML(body),originalPrice=results.personalParlays(body)[0].americanOdds;
 assert.match(html,/Saved shared slip leg price: <strong>-155/);assert.match(html,/Source: shared slip/);assert.doesNotMatch(html,/Saved screenshot leg price|Screenshot placement time/);
 assert.match(html,/Recorded placement time:/);assert.match(html,/full-ticket shared-slip quote/);assert.equal(originalPrice,630);assert.equal(JSON.stringify(body),before);
 slip.priceEvidence.source='screenshot';slip.legs[0].priceEvidence.source='screenshot';
 const screenshot=publication.personalSlipsHTML(body);assert.match(screenshot,/Saved screenshot leg price: <strong>-155/);assert.match(screenshot,/Source: screenshot/);assert.match(screenshot,/Recorded placement time:/);
 slip.legs[0].priceEvidence={...evidence,context:'later_quote'};
 const later=publication.personalSlipsHTML(body);assert.match(later,/Original ticket leg price unavailable/);assert.doesNotMatch(later,/>-155<\/strong>/);assert.equal(results.personalParlays(body)[0].americanOdds,originalPrice);
});
