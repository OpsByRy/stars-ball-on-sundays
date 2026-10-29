/* Shared public availability facts. Out announcements never alter saved forecasts or prices. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SBOS_AVAILABILITY=api;})(typeof window==='undefined'?this:window,function(){
  'use strict';
  const SOURCE='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries';
  const key=p=>JSON.stringify([p.date,p.canonicalEventId||p.eventId,p.playerId]),sameTeam=(a,b)=>String(a||'').replace('Los Angeles Clippers','LA Clippers')===String(b||'').replace('Los Angeles Clippers','LA Clippers');
  function injuryStatus(body,row,source,now){
    const time=Date.parse(now),stamp=Date.parse(body?.timestamp),start=Date.parse(row.startTime),day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
    if(body?.status!=='success'||!Number.isFinite(stamp)||time-stamp>6*3600000||stamp-time>60000||!(start>time)||row.date!==day||!source?.athleteId||!(source.expectedTeam||row.team))return null;
    const statuses=[];
    for(const team of body.injuries||[]){if(!sameTeam(team.displayName,source.expectedTeam||row.team))continue;
      for(const injury of team.injuries||[]){if(!(Date.parse(injury.date)<=time))continue;
        const ids=new Set((injury.athlete?.links||[]).map(l=>/^https:\/\/www\.espn\.com\/nba\/player\/_\/id\/(\d+)\//.exec(l.href||'')?.[1]).filter(Boolean));if(injury.athlete?.id)ids.add(String(injury.athlete.id));
        if(ids.size===1&&ids.has(String(source.athleteId)))statuses.push(String(injury.status||'').toLowerCase());
      }
    }
    if(!statuses.length)return null;
    return {date:row.date,eventId:row.canonicalEventId||row.eventId,playerId:row.playerId,status:statuses.every(s=>s==='out')?'out':'uncertain',asOf:body.timestamp,source:SOURCE};
  }
  function resultFor(row,update){
    if(!update||!['out','dnp','uncertain'].includes(update.status)||key(row)!==key({date:update.date,eventId:update.eventId,playerId:update.playerId}))return null;
    const old=row.result||{};
    // A verified appearance, including a real zero, takes precedence over an injury announcement.
    if(old.minutesPlayed>0||Number.isFinite(old.actual)&&old.actual>0)return null;
    if(update.status==='uncertain')return old.statisticalOutcome==='out'?{actual:null,eventStatus:'scheduled',statisticalOutcome:'pending',sportsbookSettlement:'unverified',checkedAt:update.asOf,source:update.source}:null;
    if(update.status==='out'&&old.eventStatus==='final')return null;
    return {actual:null,minutesPlayed:0,eventStatus:update.status==='dnp'?'final':old.eventStatus==='live'?'live':'scheduled',statisticalOutcome:update.status==='dnp'?'dnp':'out',sportsbookSettlement:'unverified',checkedAt:update.asOf,source:update.source};
  }
  function nbaInactive(body,row,now){
    const g=body?.boxScoreSummary,event=row.canonicalEventId||row.eventId;
    if(!g||event!=='nba:'+g.gameId||!/^nba:\d+$/.test(row.playerId||'')||![1,2,3].includes(g.gameStatus)||!Number.isFinite(Date.parse(g.gameTimeUTC)))return null;
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(g.gameTimeUTC));if(day!==row.date)return null;
    const id=row.playerId.slice(4),matches=['homeTeam','awayTeam'].flatMap(side=>(g[side]?.inactives||[]).filter(p=>String(p.personId)===id));if(matches.length!==1)return null;
    return {date:row.date,eventId:event,playerId:row.playerId,status:g.gameStatus===3?'dnp':'out',asOf:now,source:'https://stats.nba.com/stats/boxscoresummaryv3?GameID='+g.gameId};
  }
  function savedStatus(row,body){return (body?.updates||[]).filter(u=>key(row)===key({date:u.date,eventId:u.eventId,playerId:u.playerId})).sort((a,b)=>Date.parse(b.asOf)-Date.parse(a.asOf))[0]||null;}
  const caches=new Map();let injuryCache=null,injuryAt=0,injuryPending=null;
  async function apply(rows,sourceFor,base){
    const name=String(base),cached=caches.get(name);let body=cached?.body;
    if(!cached||Date.now()-cached.at>60000){try{const r=await fetch(new URL('data/player-availability.json',base),{credentials:'omit',cache:'no-store'});if(r.ok){const fresh=await r.json();if(fresh.schemaVersion==='public-player-availability-1'){body=fresh;caches.set(name,{body,at:Date.now()});}}}catch{}}
    for(const row of rows){const result=resultFor(row,savedStatus(row,body));if(result)row.result=result;}
    const now=new Date().toISOString(),future=rows.filter(p=>Date.parse(p.startTime)>Date.now());if(!future.length)return;
    if(Date.now()-injuryAt>60000){
      if(!injuryPending)injuryPending=fetch(SOURCE,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(12000)}).then(r=>r.ok?r.json():null).then(b=>{if(b){injuryCache=b;injuryAt=Date.now();}}).catch(()=>{}).finally(()=>{injuryPending=null;});
      await injuryPending;
    }
    for(const row of future){const result=resultFor(row,injuryStatus(injuryCache,row,sourceFor(row),now));if(result)row.result=result;}
  }
  return {SOURCE,key,injuryStatus,nbaInactive,resultFor,savedStatus,apply};
});
