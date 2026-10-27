/* Standard box-score grading of already published selections. No research engine. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const board=require('../assets/pick-board.js');
const root=path.resolve(__dirname,'..');
const resultFields=['actual','checkedAt','eventStatus','statisticalOutcome','sportsbookSettlement','source'];
function publicResult(result){return Object.fromEntries(resultFields.filter(k=>result[k]!==undefined).map(k=>[k,result[k]]));}
function sorted(value){return Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;}
function version(body){const {version:ignored,...content}=body;return crypto.createHash('sha256').update(JSON.stringify(sorted(content))).digest('hex').slice(0,16);}
function write(file,body){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(body,null,2)+'\n');}
function equivalent(a,b){const strip=r=>{const {checkedAt,...rest}=r||{};return rest;};return JSON.stringify(sorted(strip(a)))===JSON.stringify(sorted(strip(b)));}
async function refresh({fetchJSON,now=new Date(),directory=root}={}){
  const siteRoot=path.resolve(directory);
  const indexPath=path.join(siteRoot,'data/editions/manifest.json'),index=JSON.parse(fs.readFileSync(indexPath));
  if(index.schemaVersion!=='public-1')throw Error('Unsupported publication index');
  const targets=JSON.parse(fs.readFileSync(path.join(siteRoot,'data/stat-targets.json'))).targets;
  const identities=new Map(targets.map(t=>[board.identity(t),{eventId:t.espnEventId,athleteId:t.espnAthleteId,expectedTeam:t.expectedTeam}]));
  const latest=new Map();for(const e of index.editions)latest.set(e.channel+':'+e.date,e);
  const cache=new Map();let editions=0,failures=0;
  fetchJSON ||= async id=>{if(!/^\d+$/.test(id))throw Error('Invalid result game');const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Result source unavailable');return r.json();};
  for(const e of latest.values()){
    const age=now.getTime()-Date.parse(e.date+'T12:00:00Z');if(age<0||age>7*86400000)continue;
    if(e.path!==`${e.channel}/${e.date}/${e.version}.json`||!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||!/^[0-9a-f]{16}$/.test(e.version)||!['daily','sunday'].includes(e.channel))throw Error('Invalid publication path');
    const body=JSON.parse(fs.readFileSync(path.join(siteRoot,'data/editions',e.path)));if(version(body)!==e.version)throw Error('Publication digest mismatch');
    let changed=false;
    for(const row of body.props){
      const source=row.resultSource||identities.get(board.identity(row));if(!source)continue;
      const start=Date.parse(row.startTime||'');if(start>now.getTime())continue;
      try{
        if(!cache.has(source.eventId))cache.set(source.eventId,Promise.resolve().then(()=>fetchJSON(source.eventId)));
        const next=board.mergeResult(row.result,publicResult(board.parseSummary(await cache.get(source.eventId),source,row,now.toISOString())));
        if(!equivalent(row.result,next)){row.result=next;changed=true;}
      }catch{failures++;}
    }
    if(!changed)continue;
    body.updatedAt=now.toISOString();body.version=version(body);
    const relative=`${body.channel}/${body.date}/${body.version}.json`,file=path.join(siteRoot,'data/editions',relative);
    if(fs.existsSync(file)&&JSON.stringify(sorted(JSON.parse(fs.readFileSync(file))))!==JSON.stringify(sorted(body)))throw Error('Immutable edition collision');
    write(file,body);index.editions.push({...e,version:body.version,path:relative,updatedAt:body.updatedAt});editions++;
  }
  if(editions)write(indexPath,index);
  return {editions,sourceFailures:failures};
}
module.exports={refresh,version,equivalent};
if(require.main===module)refresh().then(r=>{console.log(JSON.stringify(r));if(r.sourceFailures)process.exitCode=1;}).catch(()=>{console.error('Public result refresh failed; existing records retained.');process.exitCode=1;});
