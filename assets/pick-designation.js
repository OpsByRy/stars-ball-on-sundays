/* Inactive presentation contract. No source requests, selection, result writes or settlement. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SBOS_PICK_DESIGNATION=api;})(typeof window==='undefined'?this:window,function(){
  'use strict';
  const VERSION='sbos-public-pick-designation-1';
  const mountedHistory=new WeakMap();
  const bindingKeys=['recordId','editionVersion','slateDate','eventId','playerId','book','market','operator','line','period','product','overtime','settlementRules','jurisdiction','startTime'];
  const designations=['available','questionable','gtd','probable','doubtful','out'];
  const labels={available:'Available',questionable:'QUESTIONABLE',gtd:'GTD',probable:'PROBABLE',doubtful:'DOUBTFUL',out:'OUT'};
  const sourceNames=['NBA official injury report','Team announcement','Verified status source','Synthetic status source'];
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fail=()=>{throw Error('Unverified designation input');};
  function keys(v,names){
    if(!v||typeof v!=='object'||Array.isArray(v))fail();
    const d=Object.getOwnPropertyDescriptors(v),k=Reflect.ownKeys(d);
    if(k.length!==names.length||k.some(x=>typeof x!=='string'||!names.includes(x)||!Object.hasOwn(d[x],'value')))fail();
  }
  function text(v,max=160){if(typeof v!=='string'||!v||v.length>max||/[\u0000-\u001f]|\/(?:Users|home)\/|file:\/\/|Bearer\s/i.test(v))fail();}
  function clock(v,nullable=false){
    if(nullable&&v===null)return null;
    const m=typeof v==='string'&&v.match(/^(\d{4})-(\d\d)-(\d\d)T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,9}))?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/);
    if(!m||m[8]!=='Z'&&m[8].slice(1,3)==='14'&&m[8].slice(4)!=='00')fail();
    const [y,mo,d]=m.slice(1,4).map(Number),date=new Date(Date.UTC(y,mo-1,d));
    if(y<2000||y>2100||date.getUTCFullYear()!==y||date.getUTCMonth()!==mo-1||date.getUTCDate()!==d)fail();
    const whole=Date.parse(v.replace(/\.\d+(?=Z|[+-]\d\d:\d\d$)/,''));
    if(!Number.isSafeInteger(whole))fail();
    return BigInt(whole)*1000000n+BigInt((m[7]||'').padEnd(9,'0'));
  }
  const validPrice=v=>v===null||typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)>=100;
  function binding(b){
    keys(b,bindingKeys);text(b.recordId);if(!/^[a-f0-9]{16,64}$/.test(b.editionVersion))fail();
    if(!/^\d{4}-\d\d-\d\d$/.test(b.slateDate)||!/^nba:\d{1,12}$/.test(b.eventId)||!/^nba:\d{1,12}$/.test(b.playerId))fail();
    if(!['fanduel','draftkings'].includes(b.book)||!['PTS','AST','REB','3PM','PRA','PA','PR','RA','BLK','STL'].includes(b.market)||!['>','>=','<','<='].includes(b.operator)||typeof b.line!=='number'||!Number.isFinite(b.line)||b.line<0||b.period!=='full_game'||b.product!=='sportsbook')fail();
    if(b.overtime!==null&&typeof b.overtime!=='boolean')fail();
    for(const k of ['settlementRules','jurisdiction'])if(b[k]!==null)text(b[k],400);
    const start=clock(b.startTime),day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Number(start/1000000n)));
    if(day!==b.slateDate)fail();return start;
  }
  function source(s,asOf){
    keys(s,['name','effectiveAt','reportedAt','observedAt','validUntil']);
    if(!sourceNames.includes(s.name))fail();
    const effective=clock(s.effectiveAt),reported=clock(s.reportedAt,true),observed=clock(s.observedAt),until=clock(s.validUntil,true);
    if(effective>observed||reported!==null&&(effective>reported||reported>observed)||observed>asOf||until!==null&&until<observed)fail();
    return {effective,reported,observed,until};
  }
  function buildView(record,context,options={}){
    let c,start,posted,now;
    try{
      const ms=options.now??Date.now();if(!Number.isSafeInteger(ms))fail();now=BigInt(ms)*1000000n;
      keys(context,['dataKind','binding','originalSelection','publication','eventStatus','participation']);c=context;
      if(!['synthetic','accepted_public'].includes(c.dataKind)||c.dataKind==='synthetic'&&options.allowSynthetic!==true)fail();
      start=binding(c.binding);
      if(!['scheduled','live','final','postponed','canceled','unknown'].includes(c.eventStatus)||!['unverified','played','inactive'].includes(c.participation))fail();
      keys(c.originalSelection,['americanOdds','capturedAt','selectedAt']);if(!validPrice(c.originalSelection.americanOdds))fail();
      const q=clock(c.originalSelection.capturedAt,true),selected=clock(c.originalSelection.selectedAt,true);
      keys(c.publication,['kind','at']);posted=clock(c.publication.at,true);
      if(!['actual_first_row_publication','first_known_deployed_presence','unknown'].includes(c.publication.kind)||(c.publication.kind==='unknown')!==(posted===null))fail();
      if([q,selected,posted].some(t=>t!==null&&t>now)||q!==null&&selected!==null&&q>selected||posted!==null&&[q,selected].some(t=>t!==null&&t>posted))fail();
    }catch{return {state:'invalid_context',label:'STATUS UNAVAILABLE',tone:'warning',voidPrice:false,quote:null,detail:'Status could not be bound to this exact pick. Saved records remain unchanged.'};}
    const base={quote:c.originalSelection.americanOdds,quoteAt:c.originalSelection.capturedAt,selectedAt:c.originalSelection.selectedAt,publication:{...c.publication},voidPrice:false,lastVerified:null,source:null};
    if(record==null)return {...base,state:'unknown',label:'STATUS UNKNOWN',tone:'warning',detail:'No verified availability update is saved. Missing status does not mean Available.'};
    let times;
    try{
      keys(record,['schemaVersion','dataKind','binding','asOf','state','designation','source','lastVerified']);
      if(record.schemaVersion!==VERSION||record.dataKind!==c.dataKind)fail();binding(record.binding);
      if(bindingKeys.some(k=>record.binding[k]!==c.binding[k]))fail();
      const asOf=clock(record.asOf);if(asOf>now||!['current','stale','unknown','conflicting','unverified'].includes(record.state))fail();
      if(record.designation!==null&&!designations.includes(record.designation))fail();
      if(['current','stale'].includes(record.state)&&(record.source===null||record.designation===null))fail();
      if(record.source!==null)times=source(record.source,asOf);
      if(record.state==='current'&&times.until===null)fail();
      if(['unknown','conflicting','unverified'].includes(record.state)&&(record.designation!==null||record.source!==null))fail();
      if(record.lastVerified!==null){
        keys(record.lastVerified,['designation','source']);if(!designations.includes(record.lastVerified.designation))fail();
        const prior=source(record.lastVerified.source,asOf);
        if(times&&(prior.observed>times.observed||prior.effective>times.effective||prior.effective===times.effective&&record.lastVerified.designation!==record.designation))fail();
      }
    }catch{return {...base,state:'invalid_data',label:'STATUS UNVERIFIED',tone:'warning',detail:'The availability update could not be verified for this exact pick. Saved price retained.'};}
    const state=record.state==='current'&&times.until<=now?'stale':record.state;
    const prior=record.lastVerified?{designation:record.lastVerified.designation,source:{...record.lastVerified.source}}:null;
    if(state!=='current'){
      const last=['stale'].includes(state)?{designation:record.designation,source:{...record.source}}:prior;
      return {...base,state,label:{stale:'STATUS STALE',unknown:'STATUS UNKNOWN',conflicting:'STATUS CONFLICT',unverified:'STATUS UNVERIFIED'}[state],tone:'warning',lastVerified:last,detail:{stale:'The saved status needs a reliable refresh. It does not establish current availability or a void.',unknown:'Missing status does not mean Available.',conflicting:'Availability sources conflict. No automatic clearance or void is inferred.',unverified:'Availability could not be verified. No automatic clearance or void is inferred.'}[state]};
    }
    const common={...base,state,source:{...record.source},designation:record.designation,label:labels[record.designation],tone:record.designation==='out'?'danger':'warning'};
    if(record.designation==='available')return {...common,label:'',tone:'clear',detail:'Reliable update: Available. This clears the injury tag only; saved forecasts and other reviews are unchanged.'};
    if(record.designation!=='out')return {...common,detail:'Participation is uncertain. This designation alone does not exclude the pick or settle a wager; saved forecasts may assume participation.'};
    const provenPost=posted!==null&&c.publication.kind==='actual_first_row_publication'&&times.effective>posted;
    const pregame=times.effective<start&&times.observed<start;
    const voidPrice=provenPost&&pregame&&['scheduled','live'].includes(c.eventStatus)&&c.participation!=='played';
    const detail=c.participation==='played'?'OUT conflicts with verified participation. Review required; no automatic void.':c.eventStatus==='final'?'Game is final. Use separately verified results; this designation does not settle the wager.':!pregame?'OUT was captured at or after the scheduled start. Participation and terms require review before a void indication.':!provenPost?'OUT is not verified as effective after this pick’s actual first publication. Review required.':voidPrice?'SBOS provisional void indication after posting. Sportsbook wager settlement is unverified and may depend on participation and book-specific terms.':'Event status requires review; no automatic void indication.';
    return {...common,voidPrice,detail};
  }
  function stamp(v){if(v===null||v===undefined)return 'Unknown';const n=clock(v);return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(Number(n/1000000n)));}
  const time=v=>v===null||v===undefined?'Unknown':`<time datetime="${escape(v)}" title="${escape(v)}">${escape(stamp(v))}</time>`;
  const odds=v=>v===null?'Unavailable':v>0?'+'+v:String(v).replace('-','−');
  function renderView(v){
    const badge=v.label?`<strong class="designation-tag designation-${escape(v.tone)}">${escape(v.label)}</strong>`:'';
    const priorBadge=v.lastVerified&&v.lastVerified.designation!=='available'?`<span class="designation-tag designation-${v.lastVerified.designation==='out'?'danger':'warning'} designation-historical">Last verified: ${escape(labels[v.lastVerified.designation])}</span>`:'';
    const statusTime=v.source?`<small>${v.designation==='available'?'Available update · ':''}${v.source.reportedAt===null?'Status observed':'Status reported'} ${time(v.source.reportedAt??v.source.observedAt)}</small>`:v.lastVerified?`<small>Last verified observation ${time(v.lastVerified.source.observedAt)}</small>`:'';
    const price=v.voidPrice?'<strong class="designation-price-void">VOID</strong><small>SBOS provisional</small>':`<strong>${escape(odds(v.quote))}</strong><small>Saved pick price</small>`;
    const sourceHTML=s=>`<dl><dt>Source</dt><dd>${escape(s.name)}</dd><dt>Effective</dt><dd>${time(s.effectiveAt)}</dd><dt>Reported</dt><dd>${time(s.reportedAt)}</dd><dt>Observed</dt><dd>${time(s.observedAt)}</dd><dt>Freshness cutoff</dt><dd>${time(s.validUntil)}</dd></dl>`;
    const history=v.lastVerified?`<p>Last verified designation: <strong>${escape(labels[v.lastVerified.designation])}</strong>. This is historical status.</p>${sourceHTML(v.lastVerified.source)}`:'';
    const saved=v.publication?`<p>Original posted pick price: <strong>${escape(odds(v.quote))}</strong> · quote captured ${time(v.quoteAt)}. Selection recorded ${time(v.selectedAt)}.</p><p>${v.publication.kind==='actual_first_row_publication'?'First published':v.publication.kind==='first_known_deployed_presence'?'First known deployed presence (actual first publication unverified)':'First publication unknown'}: ${time(v.publication.at)}.</p>`:'';
    return `<section class="pick-designation" data-designation-state="${escape(v.state)}" aria-label="Pick availability and saved price"><div class="designation-compact"><span class="designation-status">${badge}${priorBadge}${statusTime}</span><span class="designation-price" aria-label="${v.voidPrice?'VOID — SBOS provisional tracking; sportsbook settlement unverified':'Saved pick price'}">${price}</span></div><details class="designation-details"><summary>Availability &amp; saved-price details</summary><p>${escape(v.detail)}</p>${v.source?sourceHTML(v.source):''}${history}${saved}<p>Sportsbook settlement is separate. Original quotes, statistical results, submitted exposure and financial records are unchanged.</p></details></section>`;
  }
  const render=(record,context,options={})=>renderView(buildView(record,context,options));
  function mount(container,record,context,options={}){
    let v=buildView(record,context,options);const key=v.publication?JSON.stringify([context.dataKind,...bindingKeys.map(k=>context.binding[k])]):null,old=mountedHistory.get(container);
    const prior=old?.key===key&&key&&clock(old.last.source.observedAt)<=BigInt(options.now??Date.now())*1000000n?old.last:null;
    if(v.state==='current'&&prior){
      const nextAt=clock(v.source.effectiveAt),oldAt=clock(prior.source.effectiveAt);
      if(nextAt<oldAt||nextAt===oldAt&&v.designation!==prior.designation)v={...v,state:'conflicting',label:'STATUS CONFLICT',tone:'warning',voidPrice:false,source:null,lastVerified:prior,detail:'An older or contradictory update cannot clear the last verified designation. A reliable newer update is required.'};
    }
    if(v.state==='current')mountedHistory.set(container,{key,last:{designation:v.designation,source:{...v.source}}});
    else if(key){
      if(prior&&v.lastVerified&&clock(v.lastVerified.source.effectiveAt)===clock(prior.source.effectiveAt)&&v.lastVerified.designation!==prior.designation){
        const last=prior.designation==='out'?prior:v.lastVerified.designation==='out'?v.lastVerified:prior.designation==='available'?v.lastVerified:prior;
        v={...v,state:'conflicting',label:'STATUS CONFLICT',tone:'warning',voidPrice:false,source:null,lastVerified:last,detail:'Conflicting historical designations cannot establish clearance. A reliable newer update is required.'};
      }
      if(prior&&(!v.lastVerified||clock(v.lastVerified.source.effectiveAt)<clock(prior.source.effectiveAt)))v={...v,lastVerified:prior};
      if(v.lastVerified)mountedHistory.set(container,{key,last:{designation:v.lastVerified.designation,source:{...v.lastVerified.source}}});else mountedHistory.delete(container);
    }else mountedHistory.delete(container);
    container.innerHTML=renderView(v);return v;
  }
  return {VERSION,buildView,render,mount};
});
