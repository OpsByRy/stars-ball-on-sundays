/* Standard box-score grading of already published selections. No research engine. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const board=require('../assets/pick-board.js');
const availability=require('../assets/availability.js');
const root=path.resolve(__dirname,'..');
const resultFields=['actual','minutesPlayed','checkedAt','eventStatus','statisticalOutcome','sportsbookSettlement','source'];
function publicResult(result){return Object.fromEntries(resultFields.filter(k=>result[k]!==undefined).map(k=>[k,result[k]]));}
function sorted(value){return Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;}
function version(body){const {version:ignored,...content}=body;return crypto.createHash('sha256').update(JSON.stringify(sorted(content))).digest('hex').slice(0,16);}
function savedVersion(raw){
  // Older Python publications contain numeric literals such as 0.0. Retain those
  // lexemes while checking their canonical digest; new Node result editions use 0.
  const body=JSON.parse(raw,(key,value,context)=>typeof value==='number'?JSON.rawJSON(context.source):value);
  delete body.version;
  const canonical=value=>JSON.isRawJSON(value)?value:Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
  return crypto.createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex').slice(0,16);
}
function write(file,body){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(body,null,2)+'\n');}
function equivalent(a,b){const strip=r=>{const {checkedAt,...rest}=r||{};return rest;};return JSON.stringify(sorted(strip(a)))===JSON.stringify(sorted(strip(b)));}
async function refresh({fetchJSON,fetchNBAJSON,fetchInjuriesJSON,now=new Date(),directory=root,eventIds=null}={}){
  const siteRoot=path.resolve(directory);
  const indexPath=path.join(siteRoot,'data/editions/manifest.json'),index=JSON.parse(fs.readFileSync(indexPath));
  if(index.schemaVersion!=='public-1')throw Error('Unsupported publication index');
  const targets=JSON.parse(fs.readFileSync(path.join(siteRoot,'data/stat-targets.json'))).targets;
  const identities=new Map(targets.map(t=>[board.identity(t),{eventId:t.espnEventId,athleteId:t.espnAthleteId,expectedTeam:t.expectedTeam}]));
  const statusPath=path.join(siteRoot,'data/player-availability.json'),statusFacts=fs.existsSync(statusPath)?JSON.parse(fs.readFileSync(statusPath)):{updates:[]};
  const included=eventIds?new Set(eventIds):null;
  const nbaCache=new Map();let statusChanged=false,injuryRequest;
  const easternDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  fetchInjuriesJSON ||= async()=>{const r=await fetch(availability.SOURCE,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Availability source unavailable');return r.json();};
  async function announcedResult(row,source){
    const saved=availability.savedStatus(row,statusFacts);let result=availability.resultFor(row,saved);
    if(row.date!==easternDay||!(Date.parse(row.startTime)>now.getTime()))return result;
    try{
      injuryRequest ||= Promise.resolve().then(()=>fetchInjuriesJSON());
      const update=availability.injuryStatus(await injuryRequest,row,source,now.toISOString());
      if(update&&(update.status==='out'||saved?.status==='out')){
        if(!saved||saved.status!==update.status){statusFacts.updates.push(update);statusChanged=true;}
        result=availability.resultFor({...row,result:result||row.result},update)||result;
      }
    }catch{/* Preserve the last verified announcement when the report cannot be retrieved. */}
    return result;
  }
  fetchNBAJSON ||= async id=>{if(!/^\d{10}$/.test(id))throw Error('Invalid NBA game');const r=await fetch('https://stats.nba.com/stats/boxscoresummaryv3?GameID='+id,{headers:{Referer:'https://www.nba.com/','User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('NBA inactive list unavailable');return r.json();};
  async function supplementInactive(row){
    if(!['unavailable','out'].includes(row.result?.statisticalOutcome)||row.result.statisticalOutcome==='unavailable'&&row.result.eventStatus!=='final'||!/^nba:\d{10}$/.test(row.canonicalEventId||row.eventId||'')||!/^nba:\d+$/.test(row.playerId||''))return false;
    const id=(row.canonicalEventId||row.eventId).slice(4);
    try{
      if(!nbaCache.has(id))nbaCache.set(id,Promise.resolve().then(()=>fetchNBAJSON(id)));
      const update=availability.nbaInactive(await nbaCache.get(id),row,now.toISOString()),result=availability.resultFor(row,update);if(!result)return false;
      row.result=result;
      const old=availability.savedStatus(row,statusFacts);
      if(!old||old.status!==update.status){statusFacts.updates.push(update);statusChanged=true;}
      return true;
    }catch{return false;}
  }
  const latest=new Map();for(const e of index.editions)latest.set(e.channel+':'+e.date,e);
  const cache=new Map();let editions=0,failures=0;
  fetchJSON ||= async id=>{if(!/^\d+$/.test(id))throw Error('Invalid result game');const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Result source unavailable');return r.json();};
  for(const e of latest.values()){
    const age=now.getTime()-Date.parse(e.date+'T12:00:00Z');if(age<0||age>7*86400000)continue;
    if(e.path!==`${e.channel}/${e.date}/${e.version}.json`||!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||!/^[0-9a-f]{16}$/.test(e.version)||!['daily','sunday'].includes(e.channel))throw Error('Invalid publication path');
    const body=JSON.parse(fs.readFileSync(path.join(siteRoot,'data/editions',e.path)));if(version(body)!==e.version)throw Error('Publication digest mismatch');
    let changed=false;
    for(const row of body.props){
      const source=row.resultSource||identities.get(board.identity(row));if(!source||included&&!included.has(source.eventId))continue;
      const announced=await announcedResult(row,source);if(announced&&!equivalent(row.result,announced)){row.result=announced;changed=true;}
      const start=Date.parse(row.startTime||'');if(start>now.getTime())continue;
      try{
        if(!cache.has(source.eventId))cache.set(source.eventId,Promise.resolve().then(()=>fetchJSON(source.eventId)));
        const next=board.mergeResult(row.result,publicResult(board.parseSummary(await cache.get(source.eventId),source,row,now.toISOString())));
        if(!equivalent(row.result,next)){row.result=next;changed=true;}
      }catch{failures++;}
      if(await supplementInactive(row))changed=true;
    }
    if(!changed)continue;
    body.updatedAt=now.toISOString();body.version=version(body);
    const relative=`${body.channel}/${body.date}/${body.version}.json`,file=path.join(siteRoot,'data/editions',relative);
    if(fs.existsSync(file)&&JSON.stringify(sorted(JSON.parse(fs.readFileSync(file))))!==JSON.stringify(sorted(body)))throw Error('Immutable edition collision');
    write(file,body);index.editions.push({...e,version:body.version,path:relative,updatedAt:body.updatedAt});editions++;
  }
  if(editions)write(indexPath,index);
  // Parlay legs are published selections too, including exact lines absent from the Daily board.
  // Save results in a new immutable parlay edition; original prices and ticket membership stay fixed.
  const parlayIndexPath=path.join(siteRoot,'data/plus-money/manifest.json');let parlayEditions=0;
  if(fs.existsSync(parlayIndexPath)){
    const pm=require('../assets/plus-money.js'),parlayIndex=JSON.parse(fs.readFileSync(parlayIndexPath));
    if(parlayIndex.schemaVersion!=='public-plus-money-manifest-1')throw Error('Unsupported parlay index');
    const dates=new Map();for(const e of parlayIndex.editions){pm.safePath(e);dates.set(e.date,e);}
    for(const e of dates.values()){
      const age=now.getTime()-Date.parse(e.date+'T12:00:00Z');if(age<0||age>7*86400000)continue;
      const raw=fs.readFileSync(path.join(siteRoot,'data/plus-money',e.path),'utf8'),body=JSON.parse(raw);if(savedVersion(raw)!==e.version)throw Error('Parlay digest mismatch');
      let changed=false;
      for(const row of body.tickets.flatMap(t=>t.legs)){
        const source=row.resultSource||identities.get(board.identity(row));if(!source||included&&!included.has(source.eventId))continue;
        const announced=await announcedResult(row,source);if(announced&&!equivalent(row.result,announced)){row.result=announced;changed=true;}
        if(Date.parse(row.startTime)>now.getTime())continue;
        try{
          if(!cache.has(source.eventId))cache.set(source.eventId,Promise.resolve().then(()=>fetchJSON(source.eventId)));
          const next=board.mergeResult(row.result,publicResult(board.parseSummary(await cache.get(source.eventId),source,row,now.toISOString())));
          if(!equivalent(row.result,next)){row.result=next;changed=true;}
        }catch{failures++;}
        if(await supplementInactive(row))changed=true;
      }
      if(!changed)continue;
      body.updatedAt=now.toISOString();body.version=version(body);const relative=`${body.date}/${body.version}.json`,file=path.join(siteRoot,'data/plus-money',relative);
      if(fs.existsSync(file)&&JSON.stringify(sorted(JSON.parse(fs.readFileSync(file))))!==JSON.stringify(sorted(body)))throw Error('Immutable parlay edition collision');
      write(file,body);parlayIndex.editions.push({...e,version:body.version,path:relative,updatedAt:body.updatedAt});parlayEditions++;
    }
    if(parlayEditions)write(parlayIndexPath,parlayIndex);
  }
  if(statusChanged)write(statusPath,statusFacts);
  return {editions,sourceFailures:failures,...(fs.existsSync(parlayIndexPath)?{parlayEditions}:{})};
}
module.exports={refresh,version,savedVersion,equivalent};
if(require.main===module)refresh().then(r=>{console.log(JSON.stringify(r));if(r.sourceFailures)console.warn('Some box scores were unavailable; verified updates were saved and other records retained.');}).catch(()=>{console.error('Public result refresh failed; existing records retained.');process.exitCode=1;});
