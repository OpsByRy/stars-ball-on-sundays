/* The publication census is separate from the current recommendation list. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SBOS_PUBLISHED_PICKS=api;})(typeof window==='undefined'?this:window,function(){
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stamp=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+' ET':'Not recorded';
  function key(row){
    let op={gte:'>=',lte:'<=',gt:'>',lt:'<'}[row.operator]||row.operator,line=row.line;
    if(!row.playerId||!(row.canonicalEventId||row.eventId)||!['>','<','>=','<='].includes(op)||typeof line!=='number'||!Number.isFinite(line))return null;
    // Only equivalent counting-stat outcomes collapse. Strict integer lines retain pushes.
    if(op==='>=')line=Math.ceil(line);else if(op==='<=')line=Math.floor(line);
    else if(!Number.isInteger(line)){line=op==='>'?Math.ceil(line):Math.floor(line);op=op==='>'?'>=':'<=';}
    return JSON.stringify([row.date,row.canonicalEventId||row.eventId,row.playerId,row.market,op,line,row.period||'full_game',row.product||'sportsbook',row.overtime??null]);
  }
  function selected(row){return row.group==='research'&&(row.selected===true||row.selected===undefined&&['value_safe','high_probability_aggressive'].includes(row.category));}
  function mergeResult(previous,next){
    if(!next)return previous;if(!previous)return copy(next);
    if(previous.eventStatus==='final'&&next.eventStatus!=='final')return previous;
    if(previous.eventStatus==='final'&&['win','loss','push','dnp','canceled'].includes(previous.statisticalOutcome)&&!['win','loss','push','dnp','canceled'].includes(next.statisticalOutcome))return previous;
    if(Date.parse(previous.checkedAt)>Date.parse(next.checkedAt))return previous;
    return copy(next);
  }
  function collect(snapshots){
    if(!snapshots.length)throw Error('Publication history is empty');
    snapshots=[...snapshots].sort((a,b)=>Date.parse(a.entry.updatedAt)-Date.parse(b.entry.updatedAt));
    const latest=snapshots.at(-1),records=new Map(),latestResults=new Map();
    for(const {entry,body} of snapshots){
      if(body.date!==latest.body.date||body.channel!==latest.body.channel)throw Error('Mixed publication history');
      const rows=new Map();
      for(const row of body.props){const id=key(row);if(!id)continue;rows.set(id,row);if(row.result)latestResults.set(id,mergeResult(latestResults.get(id),row.result));}
      // Built-but-unposted candidates must not become published picks or withdrawal events.
      if(!body.firstPublishedAt&&!body.props.some(row=>selected(row)&&row.postedAt))continue;
      const current=body.props.filter(selected);
      const posted=current.filter(row=>row.postedAt&&Number.isFinite(Date.parse(row.postedAt))||row.selected===undefined);
      for(const row of posted){
        const id=key(row);if(!id)throw Error('Published pick lacks a canonical identity');
        if(!records.has(id))records.set(id,{key:id,original:copy(row),source:{version:entry.version,path:entry.path,pickId:row.id},firstPostedAt:row.postedAt||null,revisions:[],history:[],status:'active'});
        const record=records.get(id),quote={pickId:row.id,version:entry.version,book:row.book??null,americanOdds:row.americanOdds??null,capturedAt:row.capturedAt??null};
        const previous=record.revisions.at(-1);
        if(!previous||['pickId','book','americanOdds','capturedAt'].some(k=>previous[k]!==quote[k]))record.revisions.push(quote);
      }
      // A later built body can carry old posting clocks while new picks await posting.
      if(posted.length!==current.length)continue;
      const active=new Set(posted.map(key));
      for(const [id,record] of records){
        const row=rows.get(id),update=row?.confidenceUpdate;
        const withdrawn=!active.has(id)||update?.qualification==='does_not_qualify'||update?.status==='unavailable';
        const status=withdrawn?'withdrawn':'active';
        const previous=record.history.at(-1);
        const reason=withdrawn?(update?.summary||(previous?.status==='withdrawn'?previous.reason:null)||'Removed by a later board refresh; reason not recorded.'):'Included in the published board.';
        if(!previous||previous.status!==status||status==='withdrawn'&&previous.reason!==reason){
          record.history.push({status,observedAt:entry.updatedAt,effectiveAt:withdrawn&&update?.checkedAt||null,reason,sourceVersion:entry.version});
        }
        record.status=status;
      }
    }
    for(const [id,record] of records)record.result=latestResults.get(id)||record.original.result||{eventStatus:'unknown',statisticalOutcome:'unavailable'};
    return {schemaVersion:'public-published-picks-1',date:latest.body.date,channel:latest.body.channel,sourceVersion:latest.entry.version,records:[...records.values()]};
  }
  function summary(records){
    const s={total:records.length,active:0,withdrawn:0,hits:0,misses:0,pushes:0,voids:0,pending:0};
    for(const row of records){s[row.status==='withdrawn'?'withdrawn':'active']++;const r=row.result||{};
      if(['out','dnp','canceled','postponed'].includes(r.statisticalOutcome))s.voids++;
      else if(r.eventStatus==='final'&&['win','loss','push'].includes(r.statisticalOutcome))s[{win:'hits',loss:'misses',push:'pushes'}[r.statisticalOutcome]]++;
      else s.pending++;
    }return s;
  }
  function html(body,{lineLabel=row=>`${row.market} ${row.operator} ${row.line}`,base=''}={}){
    if(body.schemaVersion!=='public-published-picks-1'||!Array.isArray(body.records))throw Error('Invalid published-pick history');
    const s=summary(body.records),price=n=>typeof n==='number'?(n>0?'+':'')+n:'Not recorded';
    const rows=body.records.map(record=>{
      const row=record.original,event=record.history.at(-1),status=record.status==='withdrawn'?'Withdrawn':'On board',result=record.result||{};
      const outcome=['out','dnp','canceled','postponed'].includes(result.statisticalOutcome)?'Void / unavailable':result.eventStatus==='final'?({win:'Hit',loss:'Miss',push:'Push'}[result.statisticalOutcome]||'Unknown'):'Pending';
      const source=/^(daily|sunday)\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{16}\.json$/.test(record.source.path)?new URL('data/editions/'+record.source.path,base||'https://invalid.local/').href:null;
      return `<li class="published-pick-history-row" data-published-status="${esc(record.status)}"><p><strong>${esc(row.player)} · ${esc(lineLabel(row))}</strong> <span class="pick-update-badge ${record.status==='withdrawn'?'update-unavailable':'update-supported'}">${status}</span> <strong>${outcome}</strong>${typeof result.actual==='number'?' · actual '+esc(result.actual):''}</p><p>Saved posting record ${esc(stamp(record.firstPostedAt))} · ${esc(row.book)} ${esc(price(row.americanOdds))} · odds observed ${esc(stamp(row.capturedAt))}.</p>${record.status==='withdrawn'?`<p>${esc(event?.reason)} ${event?.effectiveAt?'Update recorded '+esc(stamp(event.effectiveAt))+'.':'First absent or withdrawn in saved refresh '+esc(stamp(event?.observedAt))+'. Withdrawal time not recorded.'}</p>`:''}<details><summary>Publication changes &amp; original record</summary>${source?`<p><a href="${esc(source)}" target="_blank" rel="noopener noreferrer">Original saved publication ↗</a></p>`:''}<ul>${record.history.map(e=>`<li>${esc(e.status==='withdrawn'?'Withdrawn':'On board')} · saved refresh ${esc(stamp(e.observedAt))} · ${esc(e.reason)}</li>`).join('')}</ul><p>${record.revisions.length} saved quote / identity revision${record.revisions.length===1?'':'s'}; counted once for this statistical outcome. Statistical result; sportsbook settlement unverified.</p></details></li>`;
    }).join('');
    return `<section class="pick-group published-pick-history" aria-label="All published single picks"><h3>All published single picks <span class="count">${s.total}</span></h3><p><strong>${s.active} on board · ${s.withdrawn} withdrawn</strong></p><p>${s.hits} hit · ${s.misses} missed · ${s.pushes} pushed · ${s.voids} void / unavailable · ${s.pending} pending / unknown</p><p>Every published single pick is retained, including withdrawals. Refreshing or withdrawing a pick does not erase its outcome. These totals cover all published picks; category totals above describe the current board. Final results only; personal picks and Bench research are separate.</p><ol>${rows||'<li>No single picks with recorded posting times were found.</li>'}</ol></section>`;
  }
  return {key,selected,mergeResult,collect,summary,html};
});
