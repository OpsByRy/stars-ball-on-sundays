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
        const disqualified=update?.qualification==='does_not_qualify'||update?.status==='unavailable';
        const withdrawn=!active.has(id)||disqualified;
        const status=withdrawn?'withdrawn':'active';
        const previous=record.history.at(-1);
        const reason=withdrawn?((disqualified?update?.summary:null)||(previous?.status==='withdrawn'?previous.reason:null)||'Removed by a later board refresh; reason not recorded.'):'Included in the published board.';
        if(!previous||previous.status!==status||status==='withdrawn'&&previous.reason!==reason){
          record.history.push({status,observedAt:entry.updatedAt,effectiveAt:withdrawn&&disqualified&&update?.checkedAt||null,reason,sourceVersion:entry.version});
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
  function graphic(row,{base=''}={}){
    const initials=String(row.player||'?').split(/\s+/).map(x=>x[0]).slice(0,2).join('');
    const portrait=typeof window!=='undefined'&&window.SBOS_PICK_RESEARCH?.portrait?window.SBOS_PICK_RESEARCH.portrait(row,{base,className:'history-avatar'}):`<span class="history-avatar history-initials">${esc(initials)}</span>`;
    return `<span class="history-person">${portrait}<span class="history-team">${esc(row.team||'NBA')}</span></span>`;
  }
  function reasonSummary(event){
    if(['validation_requirements_not_met','probability_and_role_validation_missing'].includes(event?.reasonCode))return 'Win estimates have not passed accuracy validation; playing roles or availability were unconfirmed.';
    return event?.reason||'Earlier removal details are unavailable in the saved record.';
  }
  function html(body,{lineLabel=row=>`${row.market} ${row.operator} ${row.line}`,base=''}={}){
    if(body.schemaVersion!=='public-published-picks-1'||!Array.isArray(body.records))throw Error('Invalid published-pick history');
    const s=summary(body.records),price=n=>typeof n==='number'?(n>0?'+':'')+n:'Not recorded';
    const card=record=>{
      const row=record.original,event=record.history.at(-1),result=record.result||{};
      const outcome=['out','dnp','canceled','postponed'].includes(result.statisticalOutcome)?'Void':result.eventStatus==='final'?({win:'Hit',loss:'Miss',push:'Push'}[result.statisticalOutcome]||'Unknown'):'Pending';
      const tone={Hit:'hit',Miss:'miss',Pending:'pending'}[outcome]||'neutral',icon={Hit:'✓',Miss:'×',Pending:'◷'}[outcome]||'—';
      const source=/^(daily|sunday)\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{16}\.json$/.test(record.source.path)?new URL('data/editions/'+record.source.path,base||'https://invalid.local/').href:null;
      return `<article class="published-pick-history-row history-card" data-published-status="${esc(record.status)}"><header class="history-card-top">${graphic(row,{base})}<div><h4>${esc(row.player)}</h4><p class="history-line">${esc(lineLabel(row))}</p></div><span class="history-outcome ${tone}" title="Statistical result"><b aria-hidden="true">${icon}</b>${outcome}${typeof result.actual==='number'?`<small>Actual ${esc(result.actual)}</small>`:''}</span></header><div class="history-card-meta"><span class="history-status">${record.status==='withdrawn'?'↶ Withdrawn':'On board'}</span><span>Original <strong>${esc(price(row.americanOdds))}</strong> · ${esc(row.book)}</span></div>${record.status==='withdrawn'?`<p class="history-reason">${esc(reasonSummary(event))}</p>`:''}<details class="history-audit"><summary>Original pick &amp; publication details</summary><p>Saved posting record ${esc(stamp(record.firstPostedAt))}. Odds observed ${esc(stamp(row.capturedAt))}.</p>${record.status==='withdrawn'?`<p>${event?.effectiveAt?'Update recorded '+esc(stamp(event.effectiveAt))+'.':'First absent or withdrawn in saved refresh '+esc(stamp(event?.observedAt))+'. Withdrawal time not recorded.'}</p>`:''}${event?.reason?`<p>${esc(event.reason)}</p>`:''}${source?`<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">Original saved publication ↗</a>`:''}<ul>${record.history.map(e=>`<li>${esc(e.status==='withdrawn'?'Withdrawn':'On board')} · saved refresh ${esc(stamp(e.observedAt))} · ${esc(e.reason)}</li>`).join('')}</ul><p>${record.revisions.length} saved quote / identity revisions; counted once. Statistical result; sportsbook settlement unverified.</p></details></article>`;
    };
    const withdrawn=body.records.filter(r=>r.status==='withdrawn'),active=body.records.filter(r=>r.status!=='withdrawn');
    return `<section class="pick-group published-pick-history" id="published-single-picks" aria-label="All published single picks"><header class="history-section-top"><span class="history-section-icon" aria-hidden="true">↶</span><div><p class="history-eyebrow">THE COMPLETE RECORD</p><h3>Withdrawn &amp; replaced picks <span class="history-count">${s.withdrawn}</span></h3><p>Off the board. Still on the record.</p></div></header><div class="history-score-strip" aria-label="${s.hits} hit · ${s.misses} missed · ${s.pending} pending"><span><b>${s.total}</b> all published single picks</span><span><b>${s.hits}</b> hit</span><span><b>${s.misses}</b> missed</span><span><b>${s.pending}</b> pending / unknown</span></div><div id="withdrawn-single-picks" class="withdrawn-grid">${withdrawn.map(card).join('')||'<p class="history-empty">No withdrawn picks for this slate.</p>'}</div>${active.length?`<details class="history-active"><summary>On-board publication records · ${active.length}</summary><div class="withdrawn-grid">${active.map(card).join('')}</div></details>`:''}<p class="history-caption">All published single picks remain visible with original prices and outcomes. Withdrawals do not erase results. ${s.voids} void / unavailable · ${s.pushes} pushed. Personal picks and Bench research are separate.</p></section>`;
  }
  return {key,selected,mergeResult,collect,summary,html,graphic,reasonSummary};
});
