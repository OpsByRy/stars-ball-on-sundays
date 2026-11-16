'use strict';
// Public, derived publication revisions. No model run and no historical edits.
const EFFECTIVE='2026-11-17',crypto=require('node:crypto');
const clone=x=>JSON.parse(JSON.stringify(x));
const id=r=>JSON.stringify([r.date,r.canonicalEventId||r.eventId,r.playerId,r.market,r.operator,r.line,r.period||'full_game',r.product||'sportsbook',r.overtime??null,r.book]);
function add(groups,entry,body){
 if(entry.channel!=='daily'||entry.date<EFFECTIVE||!body.firstPublishedAt)return;
 let g=groups.get(entry.date);if(!g){g={schemaVersion:'public-board-revisions-1',date:entry.date,effectiveDate:EFFECTIVE,games:{},snapshots:[],allPublishedSingles:[],tickets:[]};groups.set(entry.date,g);}
 for(const r of body.props)if((r.canonicalEventId||r.eventId)&&Number.isFinite(Date.parse(r.startTime))){
  const key=r.canonicalEventId||r.eventId;g.games[key]={id:key,startTime:r.startTime,matchup:r.matchup||'',team:r.team||'',opponent:r.opponent||''};
 }
 const selected=body.props.filter(r=>r.group==='research'&&r.selected===true&&r.postedAt&&Date.parse(r.postedAt)<=Date.parse(entry.updatedAt));
 const rows=selected.map(r=>{const row=clone(r);delete row.result;delete row.resultSource;return row;});
 const keys=new Set(g.allPublishedSingles.map(id));for(const row of rows)if(!keys.has(id(row))){g.allPublishedSingles.push(clone(row));keys.add(id(row));}
 const snapshot={version:entry.version,sourcePath:'data/editions/'+entry.path,sourceAt:entry.updatedAt,firstPublishedAt:body.firstPublishedAt,rows};
 // Keep the real edition clock even when a statistical-results edition changes no selections.
 g.snapshots.push(snapshot);
}
function finish(groups,parlays){
 const out={};for(const [date,g]of groups){
  const body=parlays.find(b=>b.date===date);g.tickets=body?clone(body.records):[];
  const latest=g.snapshots.at(-1);g.current=latest;delete g.snapshots;
  g.version=crypto.createHash('sha256').update(JSON.stringify(g)).digest('hex').slice(0,24);
  if(Buffer.byteLength(JSON.stringify(g))>8000000)throw Error('Public board revisions exceed the bounded feed size');
  out['data/board-revisions/'+date+'.json']=g;
 }return out;
}
module.exports={EFFECTIVE,id,add,finish};
