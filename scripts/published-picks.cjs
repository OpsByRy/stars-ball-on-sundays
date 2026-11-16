'use strict';
const fs=require('node:fs'),path=require('node:path');
const history=require('../assets/published-picks.js'),parlays=require('../assets/published-parlays.js'),crypto=require('node:crypto');
const {savedVersion}=require('./refresh-results.cjs');
function collectFromSite(root,{days=null,observations=new Map(),sourceHashes=null}={}){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'data/editions/manifest.json'))),groups=new Map();
  if(manifest.schemaVersion!=='public-1'||!Array.isArray(manifest.editions))throw Error('Invalid publication manifest');
  const known=new Map();
  for(const entry of [...manifest.editions].sort((a,b)=>Date.parse(a.updatedAt)-Date.parse(b.updatedAt))){
    if(!['daily','sunday'].includes(entry.channel)||days&&!days.has(entry.date))continue;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)||!/^[a-f0-9]{16}$/.test(entry.version)||entry.path!==`${entry.channel}/${entry.date}/${entry.version}.json`)throw Error('Invalid history source path');
    const raw=fs.readFileSync(path.join(root,'data/editions',entry.path),'utf8'),body=JSON.parse(raw);
    const valid=sourceHashes?sourceHashes['data/editions/'+entry.path]===crypto.createHash('sha256').update(raw).digest('hex'):savedVersion(raw)===entry.version;
    if(body.version!==entry.version||body.date!==entry.date||body.channel!==entry.channel||!valid)throw Error('History source digest mismatch');
    const key=entry.channel+':'+entry.date;if(!groups.has(key)){groups.set(key,[]);known.set(key,new Set());}
    const census=known.get(key);
    // Retain only selected lines and their later observations, never the full
    // research pool across hundreds of large immutable versions in memory.
    body.props=body.props.filter(row=>{
      const id=history.key(row);if(history.selected(row)&&id)census.add(id);
      return history.selected(row)||id&&census.has(id);
    });
    for(const row of body.props)if(row.result)observations.set(history.key(row),history.mergeResult(observations.get(history.key(row)),row.result));
    groups.get(key).push({entry,body});
  }
  return [...groups.values()].map(history.collect);
}
function savedResults(root){
  const file=path.join(root,'data/published-selection-results.json');
  const body=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{schemaVersion:'public-published-selection-results-1',results:{}};
  if(body.schemaVersion!=='public-published-selection-results-1'||!body.results||typeof body.results!=='object'||Array.isArray(body.results)||Object.keys(body).some(k=>!['schemaVersion','results','updatedAt'].includes(k)))throw Error('Invalid published-pick results');
  for(const [key,result] of Object.entries(body.results)){
    const contract=JSON.parse(key);
    if(!Array.isArray(contract)||contract.length!==9||typeof result!=='object'||!result||Object.keys(result).some(k=>!['actual','minutesPlayed','checkedAt','eventStatus','statisticalOutcome','sportsbookSettlement','source'].includes(k)))throw Error('Invalid published-pick result contract');
    if(!['scheduled','live','final','postponed','canceled','unknown'].includes(result.eventStatus)||!['win','loss','push','out','dnp','canceled','postponed','pending','unavailable','reached','not_reached'].includes(result.statisticalOutcome)||![undefined,null,'unverified'].includes(result.sportsbookSettlement))throw Error('Invalid saved statistical result');
    for(const field of ['actual','minutesPlayed'])if(result[field]!==undefined&&result[field]!==null&&(typeof result[field]!=='number'||!Number.isFinite(result[field])||result[field]<0||field==='minutesPlayed'&&result[field]>1440))throw Error('Invalid saved statistic');
    if(['win','loss','push'].includes(result.statisticalOutcome)&&(result.eventStatus!=='final'||typeof result.actual!=='number'))throw Error('Final result needs final stats');
    if(result.checkedAt&&!Number.isFinite(Date.parse(result.checkedAt)))throw Error('Invalid result clock');
    if(result.source&&!/^https:\/\/(?:www\.espn\.com\/nba\/boxscore\/_\/gameId\/\d+|stats\.nba\.com\/stats\/boxscoresummaryv3\?GameID=\d{10}|site\.api\.espn\.com\/apis\/site\/v2\/sports\/basketball\/nba\/injuries)$/.test(result.source))throw Error('Invalid result source');
  }
  return body;
}
function collectParlaysFromSite(root,{days=null}={}){
  const groups=new Map(),withdrawalFile=path.join(root,'assets/parlay-withdrawals.json');
  const withdrawals=fs.existsSync(withdrawalFile)?JSON.parse(fs.readFileSync(withdrawalFile)).withdrawals:[];
  for(const [folder,schema] of [['plus-money','public-plus-money-manifest-1'],['sgp-research','public-sgp-research-index-1']]){
    const file=path.join(root,'data',folder,'manifest.json');if(!fs.existsSync(file))continue;
    const index=JSON.parse(fs.readFileSync(file));if(index.schemaVersion!==schema||!Array.isArray(index.editions))throw Error('Invalid parlay history manifest');
    const byDate=new Map();
    for(const entry of index.editions){
      if(days&&!days.has(entry.date))continue;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)||!/^[a-f0-9]{16}$/.test(entry.version)||entry.path!==`${entry.date}/${entry.version}.json`)throw Error('Invalid parlay history source path');
      const raw=fs.readFileSync(path.join(root,'data',folder,entry.path),'utf8'),body=JSON.parse(raw);
      if(body.date!==entry.date||body.version!==entry.version||savedVersion(raw)!==entry.version||folder==='sgp-research'&&crypto.createHash('sha256').update(raw).digest('hex')!==entry.sha256)throw Error('Parlay history digest mismatch');
      if(!byDate.has(entry.date))byDate.set(entry.date,[]);byDate.get(entry.date).push({entry,body});
    }
    for(const [day,snapshots] of byDate){
      const body=parlays.collect(snapshots,{withdrawals});
      if(!groups.has(day))groups.set(day,{schemaVersion:'public-published-parlays-1',date:day,sourceVersions:{},records:[]});
      const all=groups.get(day);all.sourceVersions[folder]=body.sourceVersion;all.records.push(...body.records);
    }
  }
  const reasonPath=path.join(root,'data/parlay-withdrawal-reasons.json');
  const log=fs.existsSync(reasonPath)?JSON.parse(fs.readFileSync(reasonPath)):{schemaVersion:'public-parlay-withdrawal-reasons-1',reasons:[]};
  validateRemovalReasons(log);
  for(const body of groups.values())applyRemovalReasons(body,log.reasons);
  return [...groups.values()];
}
function validateRemovalReasons(log){
 if(log.schemaVersion!=='public-parlay-withdrawal-reasons-1'||!Array.isArray(log.reasons)||Object.keys(log).some(k=>!['schemaVersion','reasons'].includes(k)))throw Error('Invalid parlay withdrawal reasons');
 const seen=new Set();
 for(const r of log.reasons){
  if(Object.keys(r).some(k=>!['date','key','sourceVersion','recordedAt','reasonCode','notice'].includes(k))||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!/^[a-f0-9]{16}$/.test(r.sourceVersion)||!Number.isFinite(Date.parse(r.recordedAt))||typeof r.reasonCode!=='string'||!r.reasonCode.trim()||typeof r.notice!=='string'||!r.notice.trim()||r.notice.length>1800)throw Error('Invalid parlay removal explanation');
  const key=JSON.parse(r.key);if(!Array.isArray(key)||key.length!==2||!['cross_game_reference','same_game_research','model_target'].includes(key[0])||!Array.isArray(key[1])||key[1].length<2)throw Error('Invalid removal membership');
  const id=JSON.stringify([r.date,r.key,r.sourceVersion]);if(seen.has(id))throw Error('Duplicate parlay removal explanation');seen.add(id);
 }
 return log;
}
function applyRemovalReasons(body,reasons){
 for(const r of reasons.filter(x=>x.date===body.date)){
  const record=body.records.find(x=>x.key===r.key);if(!record)throw Error('Removal explanation has no published ticket');
  const event=record.history.find(x=>x.status==='withdrawn'&&x.sourceVersion===r.sourceVersion);if(!event)throw Error('Removal explanation has no matching withdrawal');
  if(Date.parse(r.recordedAt)<Date.parse(event.observedAt))throw Error('Removal explanation predates its saved withdrawal');
  event.reason=r.notice;event.reasonCode=r.reasonCode;event.explanationRecordedAt=r.recordedAt;
 }
 return body;
}
function views(root,{sourceHashes=null}={}){
  const results=savedResults(root),out={},observations=new Map();
  const singles=collectFromSite(root,{sourceHashes,observations});
  for(const body of singles){
    for(const record of body.records)record.result=history.mergeResult(record.result,results.results[record.key]);
    out[`data/published-picks/${body.channel}/${body.date}.json`]=body;
  }
  const parlayIndex={schemaVersion:'public-published-parlays-index-1',editions:[]};
  for(const body of collectParlaysFromSite(root)){
    for(const record of body.records)for(const leg of record.legs){const id=history.key(leg.original);leg.result=history.mergeResult(history.mergeResult(leg.result,observations.get(id)),results.results[id]);}
    out[`data/published-parlays/${body.date}.json`]=body;parlayIndex.editions.push({date:body.date,sourceVersions:body.sourceVersions});
  }
  out['data/published-parlays/manifest.json']=parlayIndex;
  return out;
}
module.exports={collectFromSite,collectParlaysFromSite,savedResults,views,validateRemovalReasons,applyRemovalReasons};
if(require.main===module){const sourceHashes=process.argv.includes('--verified-source-hashes')?JSON.parse(fs.readFileSync(0,'utf8')):null;process.stdout.write(JSON.stringify(views(path.resolve(process.argv[2]),{sourceHashes})));}
