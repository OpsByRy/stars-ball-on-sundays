const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
test('personal research adds all four exact-line estimates without changing original picks or algorithm rows',()=>{
 const index=JSON.parse(fs.readFileSync(path.join(root,'data/editions/manifest.json'))),entries=index.editions.filter(e=>e.channel==='daily'&&e.date==='2026-10-28');
 const before=JSON.parse(fs.readFileSync(path.join(root,'data/editions/daily/2026-10-28/8bb54e92a9912f58.json'))),after=JSON.parse(fs.readFileSync(path.join(root,'data/editions',entries.at(-1).path)));
 const selections=body=>body.props.filter(p=>p.group==='research').map(({result,...pick})=>pick);
 // Later box-score editions may add results; frozen selections and estimates stay identical.
 assert.deepEqual(selections(after),selections(before));
 const prior=new Map(before.props.map(p=>[p.id,p]));const personal=after.props.filter(p=>p.group==='ry');assert.equal(personal.length,4);
 for(const p of personal){for(const [k,v] of Object.entries(prior.get(p.id)))assert.deepEqual(p[k],v,k);assert.equal(typeof p.estimate.projection,'number');assert.ok(p.estimate.winProbability>=0&&p.estimate.winProbability<=1);assert.equal(p.estimate.status,'provisional');}
 assert.match(personal.find(p=>p.player==='Walker Kessler').assessment,/Base-model personal research replay/);
});
test('personal page is an optional Daily Board destination with its own heading',()=>{
 const html=fs.readFileSync(path.join(root,'daily/parlays/index.html'),'utf8');assert.match(html,/<h1>Ry’s Picks\.<\/h1>/);assert.match(html,/<nav id="daily-subnav"[^>]*>.*Ry’s Picks/);
 const main=html.match(/<nav aria-label="Main navigation">(.*?)<\/nav>/)[1];assert.match(main,/Daily Board/);assert.doesNotMatch(main,/>Ry’s Picks<|>Plus Money</);
});
test('every board with a personal-slip view loads shared compatibility after its dependencies without starting another parlay board',()=>{
 for(const file of ['daily/index.html','daily/parlays/index.html','sundays/index.html','sundays/week.html','sundays/ry/index.html']){
  const html=fs.readFileSync(path.join(root,file),'utf8'),scripts=[...html.matchAll(/<script\b([^>]*)src="([^"]+)"([^>]*)><\/script>/g)],shared=scripts.filter(m=>/\/assets\/plus-money\.js$/.test(m[2]));
  assert.equal(shared.length,1,file);assert.doesNotMatch(shared[0][0],/data-plus-money/,file);
  const index=scripts.indexOf(shared[0]);
  for(const name of ['slate-policy.js','routes.js','math.js','result-utils.js','pick-board.js','book-prices.js','unit-tracker.js']){const dependency=scripts.findIndex(m=>m[2].split('/').at(-1).split('?')[0]===name);assert.ok(dependency>=0&&dependency<index,file+' '+name);}
  assert.ok(index<scripts.findIndex(m=>/\/publication\.js$/.test(m[2])),file);
 }
 const css=fs.readFileSync(path.join(root,'assets/publication.css'),'utf8');assert.match(css,/\.pm-fit-intro\{/);assert.match(css,/\.pm-saved-fit\{/);
});
test('personal slips show factual shared compatibility first and keep review and void context current',()=>{
 const vm=require('node:vm'),results=require('../assets/result-utils.js'),routes=require('../assets/routes.js'),parlays=require('../assets/plus-money.js'),books=require('../assets/book-prices.js');
 const sandbox={module:{exports:{}},window:{SBOS_SLATE_POLICY:require('../assets/slate-policy.js'),STARS_RESULT_UTILS:results,SBOS_ROUTES:routes,SBOS_PLUS_MONEY:parlays,SBOS_BOOK_PRICES:books}};
 const source=fs.readFileSync(path.join(root,'assets/publication.js'),'utf8');vm.runInNewContext(source,sandbox);const publication=sandbox.module.exports;
 const leg=(player,event,line,market,projection)=>({group:'ry',player,playerId:'nba:'+player,date:'2026-10-29',canonicalEventId:'nba:'+event,market,operator:'>=',line,americanOdds:-200,estimate:{projection,winProbability:.8}});
 const body={favoritesPostedAt:'2026-10-29T21:00:00Z',sharedBetslipOdds:510,props:[leg('Jarrett Allen','a',10,'PTS',13.8),leg('Ja Morant','b',6,'AST',8.2)]},before=JSON.stringify(body),html=publication.favoritesNotice(body);
 assert.match(html,/^<div data-personal-fit><section class="pm-fit-intro"/);assert.ok(html.indexOf('Why these legs fit')<html.indexOf('Full-slip screenshot price'));assert.match(html,/13\.8 points \(3\.8 above its line\)/);assert.match(html,/8\.2 assists \(2\.2 above its line\)/);assert.equal(JSON.stringify(body),before);
 body.props[1].result={statisticalOutcome:'out'};body.props[0].confidenceUpdate={status:'review',estimate:{projection:11,winProbability:.6}};
 const revised=publication.favoritesNotice(body);assert.match(revised,/unresolved line review/);assert.match(revised,/only this selection remains active after voids/i);assert.match(revised,/11 points \(1 above its line\)/);assert.doesNotMatch(revised,/13\.8 points \(3\.8/);
 assert.match(source,/querySelectorAll\('\[data-personal-fit\]'\).*personalFitHTML\(activeBody\)/);
 assert.doesNotMatch(publication.favoritesNotice({favoritesPostedAt:body.favoritesPostedAt}),/No active legs|Why these legs fit/);
});
