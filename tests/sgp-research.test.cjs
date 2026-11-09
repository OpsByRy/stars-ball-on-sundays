const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.join(__dirname,'..'),api=require('../assets/sgp-research.js'),math=require('../assets/sgp-math.js');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8')),copy=x=>JSON.parse(JSON.stringify(x));
const index=()=>read('data/sgp-research/manifest.json'),entry=()=>index().editions.find(e=>e.date==='2026-11-06'),body=()=>read('data/sgp-research/'+entry().path);
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');

test('all eight saved suggestions retain exact original Daily picks and clocks',async()=>{
 const b=body(),before=JSON.stringify(b),source=read('data/editions/'+b.sourceDaily.path),by=new Map(source.props.map(p=>[p.id,p]));
 assert.equal(b.suggestions.length,8);assert.equal(b.suggestions.filter(a=>a.kind==='sgp').length,2);assert.equal(b.suggestions.filter(a=>a.kind==='sgp_plus').length,6);
 assert.equal(b.suggestions.reduce((n,a)=>n+a.legs.length,0),23);assert.equal(new Set(b.suggestions.flatMap(a=>a.legs.map(l=>l.pick.id))).size,5);
 for(const a of b.suggestions)for(const l of a.legs){assert.deepEqual(l.pick,by.get(l.pick.id));assert.equal(l.pick.capturedAt,'2026-11-06T17:53:58.663600+00:00');assert.equal(l.pick.estimate.asOf,'2026-11-06T15:49:54.796694+00:00');assert.equal(l.forecastCutoff,'2026-11-06T14:58:06.650388+00:00');}
 const opened=await api.open(fs.readFileSync(path.join(root,'data/sgp-research',entry().path),'utf8'),entry());
 assert.deepEqual(opened,b);assert.equal(JSON.stringify(b),before);
});

test('benchmarks reproduce the existing calculator with no quote or joint assumptions',()=>{
 const b=body();assert.deepEqual(b.suggestions.map(a=>a.straightOddsBenchmark.americanOdds),[128,230,317,303,639,484,310,400]);
 for(const a of b.suggestions){const c=math.analyze(a.legs.map(l=>l.pick));assert.equal(c.error,null);assert.equal(a.straightOddsBenchmark.decimalOdds,c.independentDecimal);assert.equal(a.straightOddsBenchmark.americanOdds,c.independentAmerican);assert.equal(c.quotedAmerican,null);assert.equal(c.scenario,null);assert.equal(a.combinedQuote,null);assert.equal(a.jointWinProbability,null);assert.equal(a.ticketEV,null);assert.equal(a.priceSources,'mixed');}
});

test('render separates unverified quotes, benchmarks, unknown context and pending hit-rate tracking',()=>{
 const b=body(),before=JSON.stringify(b),html=api.renderHTML(b);
 assert.equal((html.match(/data-sgp-research-id=/g)||[]).length,8);
 assert.equal((html.match(/Combined sportsbook quote: unverified \/ not observed/g)||[]).length,8);
 assert.equal((html.match(/Mixed-book combination/g)||[]).length,8);
 assert.equal((html.match(/unadjusted for same-game dependence/g)||[]).length,8);
 assert.match(html,/Statistical hit rate: <strong>Unavailable<\/strong> · 0 hits · 0 misses · 8 pending/);
 assert.match(html,/not an SGP quote, correlation-adjusted estimate, fair price or win probability/);
 assert.match(html,/Original recorded availability and role: unknown/);
 assert.match(html,/Statistical compatibility score, joint win probability and ticket EV: unavailable/);
 assert.doesNotMatch(html,/unit-record|pm-win-amount|data-unit|<input|<button|ROI|profit|stake|payout/i);
 assert.equal(JSON.stringify(b),before);
 const open=api.renderHTML(b,[],Date.now(),new Set([b.suggestions[0].id]));assert.match(open,new RegExp(b.suggestions[0].id+'" open'));
});

const bad=[
 ['financial field',b=>b.suggestions[0].stake=10],
 ['qualified quote',b=>b.suggestions[0].combinedQuote={americanOdds:500}],
 ['joint probability',b=>b.suggestions[0].jointWinProbability=.5],
 ['numeric EV',b=>b.suggestions[0].ticketEV=.2],
 ['invented compatibility',b=>b.suggestions[0].compatibility.metric=80],
 ['compatibility selection gate',b=>b.suggestions[0].compatibility.selectionUse='qualification'],
 ['claimed availability',b=>b.suggestions[0].legs[0].availability='available'],
 ['claimed role',b=>b.suggestions[0].legs[0].role='confirmed'],
 ['fake terms',b=>b.suggestions[0].legs[0].settlementTerms='verified'],
 ['missing provider clock',b=>b.suggestions[0].legs[0].providerAsOf=null],
 ['future assembly',b=>b.assembledAt='2099-11-06T18:00:00Z'],
 ['future chain',b=>{b.sourceSelectionAt=b.nominatedAt=b.assembledAt='2099-11-06T18:00:00Z';}],
 ['invalid calendar',b=>b.assembledAt='2026-02-30T12:00:00Z'],
 ['private field',b=>b.suggestions[0].legs[0].features={proprietary:1}],
 ['false book attribution',b=>b.suggestions[0].priceSources='fanduel'],
 ['duplicate ticket',b=>b.suggestions[1]={...copy(b.suggestions[0]),id:'sgp-research-2026-11-06-'+'f'.repeat(16)}],
 ['cross-game mislabeled',b=>b.suggestions[2].kind='sgp'],
 ['changed original result',b=>b.suggestions[0].legs[0].pick.result.statisticalOutcome='win'],
 ['conflicting repeat',b=>b.suggestions[2].legs[0].pick.americanOdds=-201],
 ['benchmark changed',b=>b.suggestions[0].straightOddsBenchmark.americanOdds++],
 ['benchmark misrepresented',b=>b.suggestions[0].straightOddsBenchmark.method='sgp_fair_price']
];
for(const [name,change] of bad)test('research reader rejects '+name,()=>{const b=body();change(b);assert.throws(()=>api.validate(b));});

test('unavailable benchmark remains honest and does not suppress the research record',()=>{
 const b=body();b.suggestions.forEach(a=>a.straightOddsBenchmark=null);assert.equal(api.validate(b),b);assert.equal((api.renderHTML(b).match(/Straight-odds benchmark: <strong>Unavailable/g)||[]).length,8);
});

test('transport integrity and manifest paths fail closed',async()=>{
 const raw=fs.readFileSync(path.join(root,'data/sgp-research',entry().path),'utf8');
 await assert.rejects(api.open(raw+' ',entry()),/hash mismatch/);
 const e={...entry(),path:'../../private.json'};assert.throws(()=>api.validateIndex({schemaVersion:'public-sgp-research-index-1',editions:[e]}));
 await assert.rejects(api.open(raw,{...entry(),date:'2026-11-05'}));
});

function resolved(a,states){
 return a.legs.map((l,i)=>{const p=copy(l.pick),state=states[i],c=p.operator,win=c.startsWith('>')?Math.floor(p.line)+1:Math.max(0,Math.ceil(p.line)-1),loss=c.startsWith('>')?Math.max(0,Math.ceil(p.line)-1):Math.floor(p.line)+1;
 p.result={eventStatus:state==='live'?'live':'final',statisticalOutcome:state==='hit'?'win':state==='miss'?'loss':state==='live'?'reached':state,actual:state==='hit'?win:state==='miss'?loss:state==='push'?p.line:null,minutesPlayed:state==='dnp'?0:28,checkedAt:'2026-11-07T07:00:00Z',source:'https://www.espn.com/nba/boxscore/_/gameId/'+p.resultSource.eventId};return p;});
}
const after=Date.parse('2026-11-08T12:00:00Z');
test('hit-rate uses every original leg and separates incomplete cohorts',()=>{
 const b=body(),a=b.suggestions[0],before=JSON.stringify(a);
 for(const [states,expected] of [[['hit','hit'],'hit'],[['hit','miss'],'miss'],[['miss','dnp'],'dnp'],[['miss','unknown'],'unknown'],[['hit','live'],'pending']]){
  const rows=resolved(a,states),map=new Map(rows.map(r=>[r.id,r.result]));assert.equal(api.outcome(a,map,after),expected);
 }
 assert.equal(JSON.stringify(a),before);assert.equal(api.summary(b).hitRate,null);
});

test('pushes never remove a leg or create a reduced winning ticket',()=>{
 const b=body(),a=copy(b.suggestions[0]);a.legs[0].pick.operator='>';a.legs[0].pick.side='over';
 let rows=resolved(a,['push','hit']);assert.equal(api.outcome(a,new Map(rows.map(r=>[r.id,r.result])),after),'push');
 rows=resolved(a,['push','miss']);assert.equal(api.outcome(a,new Map(rows.map(r=>[r.id,r.result])),after),'miss');
 assert.equal(a.legs.length,2);
});

test('final-looking results without exact source, physical clock, participation or coherent actuals stay unknown',()=>{
 const a=body().suggestions[0];
 for(const change of [r=>r.source='https://example.com/final',r=>r.checkedAt='2099-01-01T00:00:00Z',r=>r.minutesPlayed=null,r=>r.actual=null,r=>r.statisticalOutcome='loss']){
  const rows=resolved(a,['hit','hit']);change(rows[0].result);assert.equal(api.outcome(a,new Map(rows.map(r=>[r.id,r.result])),after),'unknown');
 }
});

test('runtime rows isolate result updates from the immutable research payload',()=>{
 const b=body(),before=JSON.stringify(b),rows=api.runtimeRows(b);rows[0].result.statisticalOutcome='win';rows[0].americanOdds=999;
 assert.equal(JSON.stringify(b),before);assert.equal(rows.length,23);
});

async function mounted({requested='2026-11-06',research=true,gate=null,invalid=false}={}){
 const elements={},listeners={},watch={},address=new URL('https://example.com/project/parlays/?date='+requested);
 const el=id=>elements[id]||(elements[id]={id,innerHTML:'',textContent:'',value:['parlay-date'].includes(id)?requested:'all',disabled:false,hidden:false,dataset:{},options:[{value:'all'}],classList:{toggle(){}},setAttribute(){},addEventListener(name,fn){(this.listeners??={})[name]=fn;},focus(){},querySelector(){return null;}});
 const indexPlus=read('data/plus-money/manifest.json'),latest=new Map(indexPlus.editions.map(e=>[e.date,e]));
 const book=require('../assets/book-prices.js'),board=require('../assets/pick-board.js');
 const fetcher=async input=>{
  const u=new URL(input),suffix=u.pathname.replace('/project/',''),raw=fs.readFileSync(path.join(root,suffix),'utf8');
  let text=raw;
  if(invalid&&suffix.startsWith('data/sgp-research/')&&!suffix.endsWith('manifest.json')){const b=JSON.parse(raw);b.suggestions[0].stake=10;text=JSON.stringify(b);}
  let data=JSON.parse(text);
  if(invalid&&suffix==='data/sgp-research/manifest.json'){const b=body();b.suggestions[0].stake=10;data.editions[0].sha256=hash(JSON.stringify(b));}
  return {ok:true,url:u.href,json:async()=>copy(data),text:async()=>text};
 };
 let readyResolve;const ready=new Promise(r=>readyResolve=r);
 const module=research?{...api,load:async(base,day)=>{try{const b=await api.load(base,day,fetcher);if(gate&&day==='2026-11-06')await gate;return b;}finally{setImmediate(readyResolve);}}}:undefined;
 const document={body:{dataset:{page:'plus-money'}},activeElement:null,addEventListener(){},querySelectorAll(){return [];},getElementById:id=>id==='sgp-research'&&!research?null:el(id),querySelector:s=>s==='script[data-plus-money]'?{src:'https://example.com/project/assets/plus-money.js'}:s.startsWith('[data-parlay-filter=')?{options:[{value:'all'}]}:null};
 const window={SBOS_BOOK_PRICES:book,SBOS_PICK_RESEARCH:{compactMatchup:r=>r.team+' vs '+r.opponent,matchupHeading:s=>s,hydrate(){},panel(){return '';},portrait(){return '';}},SBOS_PICK_BOARD:{...board,playerNameHTML:r=>r.player,playerProfileURL:()=>null,watchResults(options){watch.onResults=options.onResults;return {setRows(rows){watch.rows=rows;},stop(){}};}},STARS_RESULT_UTILS:require('../assets/result-utils.js'),SBOS_ROUTES:require('../assets/routes.js'),SBOS_SLATE_POLICY:require('../assets/slate-policy.js'),SBOS_UNITS:require('../assets/unit-tracker.js'),SBOS_SGP_RESEARCH:module,addEventListener(name,fn){listeners[name]=fn;}};
 const location={get href(){return address.href;},get search(){return address.search;},get hash(){return address.hash;},reload(){}};
 const history={replaceState(_a,_b,u){address.href=new URL(u,address).href;},pushState(_a,_b,u){address.href=new URL(u,address).href;}};
 const context={module:{exports:{}},window,document,fetch:fetcher,URL,URLSearchParams,location,history,Date,setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync(path.join(root,'assets/plus-money.js'),'utf8'),context);
 await context.module.exports.init();
 assert.match(el('parlay-list').innerHTML,/data-parlay-id=/,'Fixture must initialize the real priced board');
 return {elements,watch,ready,el,change:async day=>{el('parlay-date').value=day;await el('parlay-date').listeners.change();},latest};
}

test('actual Parlays initialization adds eight research cards without changing three priced references or their unit record',async()=>{
 const m=await mounted();await m.ready;
 assert.equal((m.el('parlay-list').innerHTML.match(/data-parlay-id=/g)||[]).length,3);
 assert.equal((m.el('sgp-research').innerHTML.match(/data-sgp-research-id=/g)||[]).length,8);
 assert.equal(m.el('parlay-same-game-count').textContent,8);
 assert.doesNotMatch(m.el('parlay-record').innerHTML,/8 parlays|sgp-research/);
 const priced=read('data/plus-money/'+m.latest.get('2026-11-06').path);
 assert.equal(m.watch.rows.length,23+priced.tickets.reduce((n,t)=>n+t.legs.length,0));
 m.el('parlay-same-game').listeners.click();assert.match(m.el('parlay-count').textContent,/8 research suggestions below/);
 assert.doesNotMatch(m.el('parlay-policy-note').textContent,/\du|ROI|stake/i);
 assert.equal((m.el('sgp-research').innerHTML.match(/data-sgp-research-id=/g)||[]).length,8);
});

test('malformed research fails closed without taking down the published priced board',async()=>{
 const m=await mounted({invalid:true});await m.ready;
 assert.equal((m.el('parlay-list').innerHTML.match(/data-parlay-id=/g)||[]).length,3);
 assert.match(m.el('sgp-research').innerHTML,/research record is unavailable/);assert.doesNotMatch(m.el('sgp-research').innerHTML,/data-sgp-research-id=/);
});

test('priced-reference filters do not rank, hide or reprice research suggestions',async()=>{
 const m=await mounted();await m.ready;const original=m.el('sgp-research').innerHTML;
 m.el('parlay-filters').listeners.input({target:{tagName:'INPUT',dataset:{parlayFilter:'query'},value:'no matching priced reference'}});
 assert.doesNotMatch(m.el('parlay-list').innerHTML,/data-parlay-id=/);
 assert.equal(m.el('sgp-research').innerHTML,original);assert.match(m.el('parlay-record').innerHTML,/>3<\/strong> parlays/);
 m.el('parlay-reset').listeners.click();assert.equal((m.el('parlay-list').innerHTML.match(/data-parlay-id=/g)||[]).length,3);
});

test('a late research response cannot leak eight suggestions into another date',async()=>{
 let release;const gate=new Promise(r=>release=r),m=await mounted({gate});
 await m.change('2026-11-05');release();await m.ready;await new Promise(r=>setImmediate(r));
 assert.doesNotMatch(m.el('sgp-research').innerHTML,/data-sgp-research-id=/);assert.equal(m.el('sgp-research').hidden,true);
 assert.equal(m.el('parlay-date').value,'2026-11-05');
});

test('existing consumers without the optional research module retain their original board',async()=>{
 const m=await mounted({research:false});
 assert.equal((m.el('parlay-list').innerHTML.match(/data-parlay-id=/g)||[]).length,3);assert.equal(m.el('parlay-same-game-count').textContent,0);
});

test('a missing exact-date research entry never falls back to November 6',async()=>{
 const requests=[],b=await api.load(new URL('https://example.com/project/'),'2026-11-05',async u=>{requests.push(u.href);return {ok:true,json:async()=>index()};});
 assert.equal(b,null);assert.equal(requests.length,1);
});


test('unavailable-model injury review is visible in the collapsed summary without changing saved legs or tracking',()=>{
 const b=body(),a=b.suggestions[0],before=JSON.stringify(a.legs);
 a.jointModel={status:'unavailable',reason:'A saved leg is Out; current review hold.',modelVersion:null,estimatedAt:b.nominatedAt,inputCutoff:a.legs[0].forecastCutoff,winProbability:null,pushProbability:null,lossProbability:null,fairAmericanOdds:null,sampleGames:null,limitations:['Saved legs and clocks remain original; no replacement estimate.']};
 const html=api.renderHTML(b),summary=html.split('</summary>')[0];
 assert.match(summary,/Review: A saved leg is Out; current review hold/);
 assert.match(html,/Original recorded availability and role: unknown/);
 assert.equal(JSON.stringify(a.legs),before);assert.equal(a.betReady,false);assert.equal(a.ticketEV,null);assert.equal(a.jointWinProbability,null);assert.equal(api.summary(b).pending,8);
});
