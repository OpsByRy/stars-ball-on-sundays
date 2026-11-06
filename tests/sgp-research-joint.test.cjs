const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),api=require('../assets/sgp-research.js');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
function body(){const e=read('data/sgp-research/manifest.json').editions.find(e=>e.date==='2026-11-06');return read('data/sgp-research/'+e.path);}
function augmented(){const b=body();b.suggestions[0].jointModel={status:'experimental',reason:null,modelVersion:'paired-test-1',estimatedAt:b.assembledAt,inputCutoff:b.sourceSelectionAt,winProbability:.4,pushProbability:0,lossProbability:.6,fairAmericanOdds:150,sampleGames:30,limitations:['Experimental and uncalibrated; settlement is unverified.']};return b;}
test('experimental model is separate from unobserved quote and preserves membership and history',()=>{
 const b=augmented(),before=JSON.stringify(b),html=api.renderHTML(b,[],Date.now(),new Set([b.suggestions[0].id]));
 assert.match(html,/Estimated joint win probability: <strong>40.0%/);assert.match(html,/Fair model odds: <strong>\+150/);
 assert.match(html,/Combined sportsbook quote: unverified/);assert.match(html,/not an observed sportsbook quote/);assert.match(html,/sample games/);
 assert.match(html,new RegExp(b.suggestions[0].id+'" open'));assert.equal(JSON.stringify(b),before);
 assert.deepEqual(b.suggestions[0].legs,body().suggestions[0].legs);
});
test('push estimates cannot be represented as simple full-ticket fair odds',()=>{
 const b=augmented(),m=b.suggestions[0].jointModel;m.pushProbability=.1;m.lossProbability=.5;m.fairAmericanOdds=null;
 assert.match(api.renderHTML(b),/reduced-ticket settlement after a push is unknown/);m.fairAmericanOdds=125;assert.throws(()=>api.validate(b));
});
test('unsupported model displays explicit reason',()=>{
 const b=augmented(),m=b.suggestions[0].jointModel;Object.assign(m,{status:'unavailable',reason:'No paired history',modelVersion:null});
 for(const k of ['winProbability','pushProbability','lossProbability','fairAmericanOdds','sampleGames'])m[k]=null;
 assert.match(api.renderHTML(b),/No paired history/);m.reason=null;assert.throws(()=>api.validate(b));
});
test('invalid estimates fail closed including nonfinite and unsupported extra fields',()=>{
 for(const [k,v] of [['status','ready'],['reason','bad'],['modelVersion',null],['estimatedAt','2099-01-01T00:00:00Z'],['inputCutoff','2099-01-01T00:00:00Z'],['winProbability',true],['winProbability',NaN],['winProbability',Infinity],['lossProbability',.7],['fairAmericanOdds',149],['sampleGames',0],['sampleGames',true],['limitations',[]],['limitations',['<script>']],['ticketEV',.1]]){const b=augmented();b.suggestions[0].jointModel[k]=v;assert.throws(()=>api.validate(b),k);}
});
