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
