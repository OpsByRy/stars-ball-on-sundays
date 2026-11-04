/* Presentation only. No fetching, persistence, source import or serving activation. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./math.js'):root.STARS_MATH);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SBOS_ODDS_TIMELINE=api;
})(typeof window!=='undefined'?window:this,function(math){
  'use strict';
  const VERSION='sbos-public-odds-timeline-1',MAX_EVENTS=512,mountedKeys=new WeakMap();
  const bindingKeys=['recordId','editionVersion','slateDate','eventId','playerId','book','market','operator','line','period','product','overtime','settlementRules','jurisdiction','startTime'];
  const kinds=['accepted_public','synthetic'],states=['usable','unusable','conflicted','missing'];
  const books={fanduel:'FanDuel',draftkings:'DraftKings'};
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fail=()=>{throw Error('Invalid public timeline');};
  function keys(v,expected){
    if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==expected.length||
      !expected.every(k=>Object.hasOwn(v,k))||Object.keys(v).some(k=>!expected.includes(k)))fail();
  }
  function text(v,max=160){if(typeof v!=='string'||!v||v.length>max||/[\u0000-\u001f]|\/(?:Users|home)\/|file:\/\/|Bearer\s/i.test(v))fail();return v;}
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const payout=v=>finite(v)&&Math.abs(v)>=100&&math?math.decimalOdds(v):null;
  function validPrice(v){const d=payout(v);return finite(d)&&d>1;}
  const localDay=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Math.floor(at/1000)));
  function day(v){
    if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))fail();
    const [y,m,d]=v.split('-').map(Number),t=new Date(Date.UTC(y,m-1,d));
    if(y<2000||y>2100||t.getUTCFullYear()!==y||t.getUTCMonth()!==m-1||t.getUTCDate()!==d)fail();
  }
  function clock(v,nullable=false){
    if(nullable&&v===null)return null;
    const match=typeof v==='string'&&v.match(/^(\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,6}))?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/);
    if(!match)fail();day(match[1].slice(0,10));
    // Parse only whole seconds through Date; retain every declared fractional
    // digit as exact integer microseconds. Years 2000–2100 fit safely in Number.
    const at=Date.parse(match[1]+match[3])*1000+Number((match[2]||'').padEnd(6,'0'));
    if(!Number.isSafeInteger(at))fail();return at;
  }
  function binding(b){
    keys(b,bindingKeys);text(b.recordId);if(!/^[a-f0-9]{16,64}$/.test(b.editionVersion))fail();day(b.slateDate);
    for(const k of ['eventId','playerId'])if(typeof b[k]!=='string'||!/^nba:\d{1,12}$/.test(b[k]))fail();
    if(!Object.hasOwn(books,b.book)||!['PTS','AST','REB','3PM','PRA','PA','PR','RA','BLK','STL'].includes(b.market)||
      !['>','<','>=','<='].includes(b.operator)||!finite(b.line)||b.line<0||b.period!=='full_game'||b.product!=='sportsbook'||
      b.overtime!==null&&typeof b.overtime!=='boolean')fail();
    for(const k of ['settlementRules','jurisdiction'])if(b[k]!==null)text(b[k],400);
    const start=clock(b.startTime);
    const local=localDay(start);
    if(local!==b.slateDate)fail();
  }
  function sameBinding(a,b){return bindingKeys.every(k=>a[k]===b[k]);}
  function context(c,now,allowSynthetic){
    keys(c,['dataKind','recordType','binding','originalSelection','publication']);
    if(!kinds.includes(c.dataKind)||!['pick','research'].includes(c.recordType))fail();
    if(c.dataKind==='synthetic'&&!allowSynthetic)throw Error('synthetic');
    binding(c.binding);
    if(c.originalSelection!==null){
      const s=c.originalSelection;keys(s,['americanOdds','capturedAt','selectedAt']);
      if(s.americanOdds!==null&&!validPrice(s.americanOdds))fail();
      const quote=clock(s.capturedAt,true),selected=clock(s.selectedAt,true);
      if(quote!==null&&quote>now||selected!==null&&selected>now||quote!==null&&selected!==null&&quote>selected)fail();
    }
    const p=c.publication;keys(p,['kind','at']);
    if(!['actual_first_row_publication','first_known_deployed_presence','unknown'].includes(p.kind))fail();
    const posted=clock(p.at,true);
    if((p.kind==='unknown')!==(p.at===null)||posted!==null&&posted>now)fail();
    if(posted!==null&&c.originalSelection){
      for(const k of ['capturedAt','selectedAt'])if(c.originalSelection[k]!==null&&clock(c.originalSelection[k])>posted)fail();
    }
    return c;
  }
  const reasonText={
    invalid_context:'Saved price history is unavailable.',
    synthetic:'Synthetic examples are disabled outside the explicit preview.',
    invalid_data:'Saved price history could not be verified for this exact line.',
    mismatch:'History belongs to a different record, edition, book or raw line.',
    unverified:'The event, player or exact contract mapping has not been accepted.',
    stale:'This history snapshot needs a verified refresh.',
    missing:'Saved price history is not available.',
    terms:'History comparison is unavailable while settlement terms are unverified.'
  };
  function buildView(record,c,options={}){
    const nowMillis=options.now??Date.now(),allowSynthetic=options.allowSynthetic===true;
    let safe,now;
    try{
      if(!Number.isSafeInteger(nowMillis))fail();now=nowMillis*1000;
      if(!Number.isSafeInteger(now))fail();safe=context(c,now,allowSynthetic);
    }
    catch(e){return {available:false,reason:e.message==='synthetic'?'synthetic':'invalid_context',context:null};}
    const unavailable=reason=>({available:false,reason,context:safe});
    try{
      keys(record,['schemaVersion','dataKind','status','asOf','binding','events']);
      if(record.schemaVersion!==VERSION||!kinds.includes(record.dataKind)||record.dataKind!==safe.dataKind)fail();
      if(record.dataKind==='synthetic'&&!allowSynthetic)return unavailable('synthetic');
      binding(record.binding);
      if(!sameBinding(record.binding,safe.binding))return unavailable('mismatch');
      if(!['available','stale','missing','unverified'].includes(record.status))fail();
      if(record.status!=='available')return unavailable(record.status);
      if(record.binding.overtime===null||record.binding.settlementRules===null||record.binding.jurisdiction===null)return unavailable('terms');
      const asOf=clock(record.asOf);if(asOf>now)fail();
      if(!Array.isArray(record.events)||record.events.length>MAX_EVENTS)fail();
      const ids=new Set(),events=record.events.map(e=>{
        keys(e,['id','capturedAt','americanOdds','status','retractedAt']);text(e.id);
        if(ids.has(e.id)||!states.includes(e.status))fail();ids.add(e.id);
        const at=clock(e.capturedAt),retracted=clock(e.retractedAt,true);
        if(at>asOf||retracted!==null&&(retracted<at||retracted>asOf))fail();
        if(e.americanOdds!==null&&!validPrice(e.americanOdds))fail();
        if(e.status==='usable'&&(e.americanOdds===null||at>=clock(record.binding.startTime)))fail();
        if(e.status==='missing'&&(e.americanOdds!==null||e.retractedAt!==null))fail();
        return {...e,at};
      }).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
      const selected=safe.originalSelection;
      if(selected?.capturedAt&&validPrice(selected.americanOdds)&&events.some(e=>
        e.status!=='missing'&&e.at===clock(selected.capturedAt)&&validPrice(e.americanOdds)&&payout(e.americanOdds)!==payout(selected.americanOdds)))fail();
      const groups=new Map();
      for(const e of events){if(!groups.has(e.at))groups.set(e.at,[]);groups.get(e.at).push(e);}
      function frameConflict(list){
        const active=list.filter(e=>e.retractedAt===null);
        if(active.some(e=>e.status==='conflicted'))return true;
        if(active.some(e=>e.status==='missing')&&active.some(e=>e.status!=='missing'))return true;
        const quotes=active.filter(e=>e.status!=='missing');
        return new Set(quotes.map(e=>JSON.stringify([e.americanOdds===null?null:payout(e.americanOdds),e.status]))).size>1;
      }
      const conflicts=new Set([...groups].filter(([,g])=>frameConflict(g)).map(([at])=>at));
      const quotes=events.filter(e=>e.status!=='missing'),first=quotes[0]??null;
      const firstFrame=first?groups.get(first.at).filter(e=>e.status!=='missing'):[];
      const originalSignatures=new Set(firstFrame.map(e=>JSON.stringify([e.americanOdds===null?null:payout(e.americanOdds),e.status])));
      const firstState=!first?'not_recorded':originalSignatures.size>1||conflicts.has(first.at)?'conflicted':first.retractedAt!==null?'retracted':first.status;
      const usable=events.filter(e=>e.status==='usable'&&e.retractedAt===null);
      const lastCandidate=usable.at(-1)??null;
      const latest=lastCandidate&&!conflicts.has(lastCandidate.at)?lastCandidate:null;
      const firstUsable=usable.find(e=>!conflicts.has(e.at))??null;
      const dayQuotes=usable.filter(e=>localDay(e.at)===record.binding.slateDate);
      const range=dayQuotes.length&&!conflicts.size?[...dayQuotes].sort((a,b)=>payout(a.americanOdds)-payout(b.americanOdds)||a.at-b.at||a.id.localeCompare(b.id)):null;
      const longest=range?range.find(e=>payout(e.americanOdds)===payout(range.at(-1).americanOdds)):null;
      let direction=null;
      if(quotes.length>1&&firstState==='usable'&&latest&&!conflicts.size){
        const a=payout(first.americanOdds),b=payout(latest.americanOdds);
        direction=b>a?'better':b<a?'lower':'unchanged';
      }
      const last=events.at(-1),lastGroup=last?groups.get(last.at):[];
      const latestPresence=!last?'not_recorded':conflicts.has(last.at)?'conflicted':
        lastGroup.every(e=>e.status==='missing')?'missing':lastGroup.some(e=>e.status==='usable'&&e.retractedAt===null)?'returned':'unusable';
      return {available:true,context:safe,asOf:record.asOf,events:events.map(e=>({...e,frameConflicted:conflicts.has(e.at)})),first,firstState,firstUsable,latest,direction,
        longest,shortest:range?.[0]??null,latestPresence,lastCheckAt:last?.capturedAt??null,
        quoteCount:quotes.length,hasConflicts:conflicts.size>0};
    }catch{return unavailable('invalid_data');}
  }
  const format=v=>validPrice(v)?math.formatOdds(v):'Unavailable';
  function stamp(v){
    if(v===null||v===undefined)return 'Time unavailable';
    return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(v));
  }
  const time=v=>v?'<time datetime="'+escape(v)+'">'+escape(stamp(v))+'</time>':'<span>Time unavailable</span>';
  function recordHTML(c){
    if(!c)return '';
    const s=c.originalSelection,p=c.publication;
    const label=c.recordType==='pick'?'SBOS pick price':'Saved research quote';
    let posted=p.kind==='actual_first_row_publication'?'First published: '+time(p.at):
      p.kind==='first_known_deployed_presence'?'Known online by: '+time(p.at)+'<br>Actual first publication time unavailable.':'First publication time unavailable.';
    return '<div class="ot-record"><div><span class="ot-label">'+label+' · '+escape(books[c.binding.book])+'</span><p>Quote: '+time(s?.capturedAt)+
      (s?.selectedAt?'<br>Selected: '+time(s.selectedAt):'')+'<br>'+posted+'</p></div><strong>'+escape(format(s?.americanOdds))+'</strong></div>';
  }
  function metric(label,point,fallback='Unavailable'){
    return '<div><dt>'+escape(label)+'</dt><dd>'+escape(point?format(point.americanOdds):fallback)+'</dd>'+(point?time(point.capturedAt):'')+'</div>';
  }
  function render(record,c,options={}){
    const v=buildView(record,c,options),demo=v.context?.dataKind==='synthetic'?'<p class="ot-demo">Synthetic example · no real picks or quotes.</p>':'';
    const open=options.open===true?' open':'';
    let html='<section class="odds-timeline" aria-label="Saved price history" tabindex="-1" data-odds-timeline>'+demo+recordHTML(v.context);
    if(!v.available)return html+'<p class="ot-unavailable" role="status">'+escape(reasonText[v.reason]||reasonText.invalid_data)+'</p></section>';
    const latestLabel=v.latest?format(v.latest.americanOdds)+' · '+stamp(v.latest.capturedAt):'Latest captured unavailable';
    html+='<details data-ot-details="history"'+open+'><summary data-ot-focus="history"><span>Price history</span><span class="ot-summary-price">'+escape(latestLabel)+'</span></summary><div class="ot-content">';
    const firstDisplay=v.firstState==='usable'||v.firstState==='retracted'?v.first:null;
    html+='<dl class="ot-metrics">'+metric('First observation',firstDisplay,v.firstState==='conflicted'?'Conflicting quotes':v.firstState==='unusable'?'Unusable price':'Unavailable')+
      metric('Latest captured',v.latest)+'</dl>';
    if(v.first&&!firstDisplay)html+='<p class="ot-note">First observed: '+time(v.first.capturedAt)+'. Original price is '+escape(v.firstState)+'.</p>';
    if(v.firstState==='retracted')html+='<p class="ot-note">The original first observation was retracted. Its record is retained; movement from it is unavailable.</p>';
    if(v.firstUsable&&v.firstState!=='usable')html+='<p class="ot-note">First retained usable quote: <strong>'+escape(format(v.firstUsable.americanOdds))+'</strong> · '+time(v.firstUsable.capturedAt)+'. This does not replace the original baseline.</p>';
    const directions={better:'↑ Better payout vs first observation',lower:'↓ Lower payout vs first observation',unchanged:'Unchanged payout vs first observation'};
    html+='<p class="ot-direction'+(v.direction?' ot-'+v.direction:'')+'">'+escape(v.direction?directions[v.direction]+' · equal stakes':v.quoteCount===1?'One captured quote · no observed movement comparison.':'Movement from the first observation is unavailable.')+'</p>';
    html+='<p class="ot-note">Observed range for '+escape(c.binding.slateDate)+' · Eastern calendar day.</p><dl class="ot-range">'+metric('Shortest observed',v.shortest)+metric('Longest observed',v.longest)+'</dl>';
    const presence={missing:'The latest comparable snapshot returned no matching quote. The earlier captured price keeps its original time.',
      unusable:'The latest observation is unusable. Any retained usable quote keeps its original time.',
      conflicted:'Same-time captures disagree. Latest availability is unverified.',not_recorded:'No quote observations were recorded.'};
    if(presence[v.latestPresence])html+='<p class="ot-status" role="status">'+escape(presence[v.latestPresence])+(v.lastCheckAt?' Check: '+time(v.lastCheckAt)+'.':'')+'</p>';
    html+='<p class="ot-note">'+v.quoteCount+' quote observations · '+eventsLabel(v.events.length)+' · snapshot as of '+time(v.asOf)+'.</p>';
    html+='<div class="ot-table-wrap"><table><caption>Captured history · '+escape(books[c.binding.book])+' · '+escape(c.binding.operator+' '+c.binding.line+' '+c.binding.market)+'. Times are Eastern.</caption><thead><tr><th scope="col">Observed</th><th scope="col">Price</th><th scope="col">Status</th></tr></thead><tbody>';
    html+=v.events.map(e=>'<tr><td>'+time(e.capturedAt)+'</td><td>'+(e.retractedAt?'<s>':'')+escape(e.status==='missing'?'—':format(e.americanOdds))+(e.retractedAt?'</s>':'')+'</td><td>'+escape(e.retractedAt?'Retracted':e.frameConflicted?'Conflicting':{usable:'Captured',unusable:'Unusable',missing:'Not returned',conflicted:'Conflicting'}[e.status])+(e.retractedAt?'<br>'+time(e.retractedAt):'')+'</td></tr>').join('');
    html+='</tbody></table></div><p class="ot-note">Captured observations only; prices between captures are unknown. First observed is not the opening price, and the last saved pregame price is not an official close. A quote observed before posting was not guaranteed at publication.</p>';
    html+='<details data-ot-details="explain"><summary data-ot-focus="explain">How payout movement works</summary><p>Positive +150 means $150 profit on a winning $100 stake. Negative −150 means staking $150 to make $100 profit. We compare equal-stake payouts: −180 to −120 pays more, +150 to +120 pays less, and +100/−100 pay the same. This does not revise the pick or its saved win estimate.</p></details></div></details></section>';
    return html;
  }
  function eventsLabel(n){return n+' saved events';}
  function mount(target,record,c,options={}){
    if(!target||typeof target.querySelector!=='function')throw Error('Timeline target required');
    const v=buildView(record,c,options),b=v.context?.binding;
    const key=b?JSON.stringify(bindingKeys.filter(k=>k!=='editionVersion').map(k=>b[k])):null;
    const same=key!==null&&mountedKeys.get(target)===key;
    const opened={};
    for(const name of ['history','explain'])opened[name]=same&&target.querySelector('[data-ot-details="'+name+'"]')?.open===true;
    const active=target.ownerDocument?.activeElement;
    const hadFocus=!!active&&target.contains(active);
    const focus=target.contains(active)?active?.getAttribute?.('data-ot-focus'):null;
    target.innerHTML=render(record,c,options);
    mountedKeys.set(target,key);
    for(const name of ['history','explain']){const el=target.querySelector('[data-ot-details="'+name+'"]');if(el&&opened[name])el.open=true;}
    if(hadFocus){
      const restored=same&&['history','explain'].includes(focus)?target.querySelector('[data-ot-focus="'+focus+'"]'):null;
      (restored??target.querySelector('[data-odds-timeline]'))?.focus();
    }
    return target;
  }
  return {VERSION,MAX_EVENTS,buildView,render,mount};
});
