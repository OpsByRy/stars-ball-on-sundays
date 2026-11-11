/* Frozen SGP research display. No selection, source collection or financial tracking. */
(function(root,factory){
  const node=typeof module==='object'&&module.exports;
  const api=factory(node?require('./sgp-math.js'):root.SBOS_SGP_MATH,
    node?require('./result-utils.js'):root.STARS_RESULT_UTILS,
    node?require('node:crypto').webcrypto:root.crypto);
  if(node)module.exports=api;else root.SBOS_SGP_RESEARCH=api;
})(typeof window==='undefined'?this:window,function(math,results,crypto){
  'use strict';
  const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
  const finite=x=>typeof x==='number'&&Number.isFinite(x);
  const clone=x=>JSON.parse(JSON.stringify(x));
  const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
  const fail=(ok,message)=>{if(!ok)throw Error(message);};
  const keys=(x,list)=>fail(x&&typeof x==='object'&&!Array.isArray(x)&&
    Object.keys(x).sort().join('|')===list.slice().sort().join('|'),'Unexpected research fields');
  const text=x=>typeof x==='string'&&x.length>0&&x.length<=1200&&!/[<>\u0000-\u001f]/.test(x);
  const hex=(x,n)=>typeof x==='string'&&new RegExp('^[0-9a-f]{'+n+'}$').test(x);
  const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
    Number.isFinite(Date.parse(x))&&new Date(x+'T12:00:00Z').toISOString().slice(0,10)===x;
  function clock(x,now=Date.now(),physical=true){
    fail(typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(x),'Aware research clock required');
    const m=x.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)/).slice(1).map(Number);
    fail(m[1]>=1&&m[1]<=12&&m[2]>=1&&m[2]<=new Date(Date.UTC(m[0],m[1],0)).getUTCDate()&&m[3]<24&&m[4]<60&&m[5]<60,'Invalid calendar clock');
    const n=Date.parse(x);fail(Number.isFinite(n)&&(!physical||n<=now),'Invalid or future physical clock');return n;
  }
  const dayAt=x=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x));
  const price=x=>Number.isInteger(x)&&Math.abs(x)>=100&&Math.abs(x)<=1000000;
  const pickFields=['id','date','player','playerId','eventId','canonicalEventId','team','opponent','matchup','startTime','period','product','market','side','operator','line','lineType','americanOdds','book','overtime','group','capturedAt','sourceType','evidence','result','resultSource','estimate','category','assessment','postedAt','ryFavorite','selected'];
  function validatePick(p,body,now){
    keys(p,pickFields);
    fail(text(p.id)&&text(p.player)&&p.date===body.date&&/^nba:\d{1,12}$/.test(p.playerId)&&
      /^nba:\d{10}$/.test(p.eventId)&&p.canonicalEventId===p.eventId,'Exact research leg identity required');
    fail(['PTS','AST','REB','3PM','PRA','PA','PR','RA','BLK','STL'].includes(p.market)&&
      ['>','>=','<','<='].includes(p.operator)&&finite(p.line)&&p.line>=0&&p.line<=1000&&
      p.side===(p.operator.startsWith('>')?'over':'under')&&['main','alternate','milestone'].includes(p.lineType),'Invalid leg contract');
    fail(['fanduel','draftkings'].includes(p.book)&&price(p.americanOdds)&&p.period==='full_game'&&
      p.product==='sportsbook'&&p.overtime===null,'Exact saved scope and price required');
    fail(/^[A-Z]{2,4}$/.test(p.team)&&/^[A-Z]{2,4}$/.test(p.opponent)&&p.team!==p.opponent&&text(p.matchup),'Invalid team identity');
    const start=clock(p.startTime,now,false);
    fail(dayAt(start)===body.date&&clock(body.nominatedAt,now)<start,'Nomination must retain its original pregame date');
    fail(clock(p.capturedAt,now)<=clock(body.sourceSelectionAt,now),'Quote after original selection');
    fail(p.group==='research'&&p.selected===true&&p.ryFavorite===false&&p.postedAt===null&&
      p.sourceType==='saved_sportsbook_quote_statistical_comparison'&&
      ['value_safe','high_probability_aggressive'].includes(p.category)&&text(p.evidence)&&text(p.assessment),'Unsupported original pick');
    keys(p.estimate,['winProbability','pushProbability','lossProbability','asOf','status','projection']);
    const probabilities=['winProbability','pushProbability','lossProbability'].map(k=>p.estimate[k]);
    fail(probabilities.every(x=>finite(x)&&x>=0&&x<=1)&&Math.abs(probabilities.reduce((a,b)=>a+b,0)-1)<1e-7&&
      finite(p.estimate.projection)&&p.estimate.projection>=0&&p.estimate.status==='provisional'&&
      clock(p.estimate.asOf,now)<=clock(body.sourceSelectionAt,now),'Invalid saved forecast');
    keys(p.result,['eventStatus','statisticalOutcome','sportsbookSettlement']);
    fail(p.result.eventStatus==='scheduled'&&p.result.statisticalOutcome==='pending'&&
      p.result.sportsbookSettlement==='unverified','Original research result must remain pending');
    keys(p.resultSource,['eventId','athleteId','expectedTeam','provider']);
    fail(/^\d+$/.test(p.resultSource.eventId)&&/^\d+$/.test(p.resultSource.athleteId)&&
      p.resultSource.expectedTeam===p.team&&p.resultSource.provider==='espn','Exact result target required');
  }
  function validateJoint(m,body,legs,now){
    keys(m,['status','reason','modelVersion','estimatedAt','inputCutoff','winProbability','pushProbability','lossProbability','fairAmericanOdds','sampleGames','limitations']);
    fail(['experimental','unavailable'].includes(m.status)&&(m.reason===null||text(m.reason))&&(m.modelVersion===null||text(m.modelVersion)),'Invalid joint model metadata');
    const cutoff=clock(m.inputCutoff,now),estimated=clock(m.estimatedAt,now);
    fail(cutoff<=estimated&&estimated<=clock(body.assembledAt,now)&&cutoff<Math.min(...legs.map(l=>clock(l.pick.startTime,now,false))),'Invalid joint model clock order');
    fail(Array.isArray(m.limitations)&&m.limitations.length>=1&&m.limitations.length<=32&&m.limitations.every(text),'Explicit joint model limitations required');
    if(m.status==='unavailable'){
      fail(text(m.reason)&&['winProbability','pushProbability','lossProbability','fairAmericanOdds','sampleGames'].every(k=>m[k]===null),'Unavailable model requires reason and null numbers');return;
    }
    fail(text(m.modelVersion)&&m.reason===null,'Experimental model version required');
    const ps=[m.winProbability,m.pushProbability,m.lossProbability];
    fail(ps.every(x=>finite(x)&&x>=0&&x<=1)&&Math.abs(ps.reduce((a,b)=>a+b,0)-1)<1e-7,'Invalid joint model probabilities');
    fail(Number.isSafeInteger(m.sampleGames)&&m.sampleGames>=1,'Invalid joint model sample count');
    if(m.pushProbability>0||m.winProbability===0||m.winProbability===1)fail(m.fairAmericanOdds===null,'No finite fair price with pushes or boundary probability');
    else{const d=1/m.winProbability, fair=d>=2?(d-1)*100:-100/(d-1);
      fail(Number.isSafeInteger(m.fairAmericanOdds)&&Math.abs(m.fairAmericanOdds-fair)<=.500000001,'Joint fair price does not reproduce');}
  }
  // One player may appear more than once only with stats that do not overlap (same table as
  // sgp-math.js): 25+ points with 2+ made threes is fine; points with points + assists is not.
  const statParts={PTS:['PTS'],AST:['AST'],REB:['REB'],'3PM':['3PM'],BLK:['BLK'],STL:['STL'],PRA:['PTS','REB','AST'],PA:['PTS','AST'],PR:['PTS','REB'],RA:['REB','AST']};
  function overlappingSamePlayer(legs){
    for(let i=0;i<legs.length;i++)for(let j=i+1;j<legs.length;j++){
      const a=legs[i],b=legs[j];if(a.playerId!==b.playerId)continue;
      const x=statParts[a.market]||[a.market],y=statParts[b.market]||[b.market];
      if(x.some(k=>y.includes(k)))return true;
    }
    return false;
  }
  function validate(body,now=Date.now()){
    keys(body,['schemaVersion','date','version','sourceDaily','sourceSelectionAt','nominatedAt','assembledAt','postedAt','suggestions']);
    fail(body.schemaVersion==='public-sgp-research-1'&&date(body.date)&&hex(body.version,16),'Invalid research publication');
    keys(body.sourceDaily,['version','path']);
    fail(hex(body.sourceDaily.version,16)&&body.sourceDaily.path==='daily/'+body.date+'/'+body.sourceDaily.version+'.json','Invalid original Daily source');
    fail(clock(body.sourceSelectionAt,now)<=clock(body.nominatedAt,now)&&
      clock(body.nominatedAt,now)<=clock(body.assembledAt,now),'Invalid research clock order');
    fail(body.postedAt===null||clock(body.nominatedAt,now)<=clock(body.postedAt,now)&&clock(body.postedAt,now)<=clock(body.assembledAt,now),'Invalid posting clock');
    fail(Array.isArray(body.suggestions)&&body.suggestions.length<=64,'Bounded suggestions required');
    const ids=new Set(),memberships=new Set(),copies=new Map();
    for(const a of body.suggestions){
      keys(a,['id','recordKind','kind','priceSources','legs','combinedQuote','straightOddsBenchmark','compatibility','jointWinProbability','ticketEV','betReady','tracking',...(own(a,'jointModel')?['jointModel']:[])]);
      if(own(a,'jointModel'))validateJoint(a.jointModel,body,a.legs,now);
      fail(typeof a.id==='string'&&new RegExp('^sgp-research-'+body.date+'-[0-9a-f]{16}$').test(a.id)&&!ids.has(a.id)&&a.recordKind==='sgp_research_suggestion','Unique research identity required');ids.add(a.id);
      fail(Array.isArray(a.legs)&&a.legs.length>=2&&a.legs.length<=6,'Two to six original legs required');
      for(const leg of a.legs){
        keys(leg,['pick','providerAsOf','forecastCutoff','availability','role','settlementTerms']);
        validatePick(leg.pick,body,now);
        fail(clock(leg.providerAsOf,now)<=clock(leg.pick.capturedAt,now)&&
          clock(leg.forecastCutoff,now)<=clock(leg.pick.estimate.asOf,now),'Original observation/forecast clocks changed');
        fail(leg.availability==='unknown'&&leg.role==='unknown'&&leg.settlementTerms==='unverified','Unknown context must remain explicit');
        const prior=copies.get(leg.pick.id),value=JSON.stringify(stable(leg));
        fail(prior===undefined||prior===value,'Conflicting repeated research leg');copies.set(leg.pick.id,value);
      }
      const legs=a.legs.map(l=>l.pick),classification=math.classify(legs),check=math.contractIssues(legs);
      const membership=JSON.stringify(legs.map(l=>l.id).sort());
      fail(!memberships.has(membership)&&!overlappingSamePlayer(legs),'Duplicate or unsupported research membership');memberships.add(membership);
      fail(!check.error&&['sgp','sgp_plus'].includes(classification.type)&&a.kind===classification.type,'Invalid or impossible SGP grouping');
      const books=new Set(legs.map(l=>l.book));
      fail(a.priceSources===(books.size===1?legs[0].book:'mixed'),'Incorrect sportsbook attribution');
      fail(a.combinedQuote===null&&a.jointWinProbability===null&&a.ticketEV===null&&
        a.betReady===false&&a.tracking==='hit_rate_only','Research cannot become an executable or financial record');
      keys(a.compatibility,['logicalChecks','metric','selectionUse']);
      fail(a.compatibility.logicalChecks==='passed'&&a.compatibility.metric===null&&
        a.compatibility.selectionUse==='informational_only','No manufactured compatibility score');
      if(a.straightOddsBenchmark!==null){
        const b=a.straightOddsBenchmark;keys(b,['method','decimalOdds','americanOdds','calculatorSHA256']);
        const arithmetic=math.analyze(legs);
        fail(b.method==='unadjusted_straight_odds_product'&&hex(b.calculatorSHA256,64)&&
          finite(b.decimalOdds)&&Math.abs(b.decimalOdds-arithmetic.independentDecimal)<1e-10&&
          Number.isSafeInteger(b.americanOdds)&&b.americanOdds===arithmetic.independentAmerican,'Calculator benchmark does not reproduce');
      }
    }
    return body;
  }
  function validateIndex(index,now=Date.now()){
    keys(index,['schemaVersion','editions']);
    fail(index.schemaVersion==='public-sgp-research-index-1'&&Array.isArray(index.editions)&&index.editions.length<=3660,'Invalid research index');
    const seen=new Set();
    for(const e of index.editions){
      keys(e,['date','version','path','sha256','count','updatedAt']);
      fail(date(e.date)&&hex(e.version,16)&&hex(e.sha256,64)&&e.path===e.date+'/'+e.version+'.json'&&
        Number.isInteger(e.count)&&e.count>=0&&e.count<=64&&!seen.has(e.path),'Invalid research index entry');
      clock(e.updatedAt,now);seen.add(e.path);
    }
    return index;
  }
  async function open(raw,entry,now=Date.now()){
    validateIndex({schemaVersion:'public-sgp-research-index-1',editions:[entry]},now);
    fail(typeof raw==='string'&&raw.length<=2000000,'Bounded research body required');
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
    const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
    fail(hash===entry.sha256,'Research body hash mismatch');
    const body=validate(JSON.parse(raw),now);
    fail(body.date===entry.date&&body.version===entry.version&&body.suggestions.length===entry.count&&body.assembledAt===entry.updatedAt,'Research manifest/body mismatch');
    return body;
  }
  async function load(base,day,fetcher=fetch){
    fail(date(day),'Exact requested slate required');
    const root=new URL('data/sgp-research/',base),indexResponse=await fetcher(new URL('manifest.json',root),{credentials:'omit',cache:'no-store'});
    fail(indexResponse.ok&&(!indexResponse.url||new URL(indexResponse.url).origin===root.origin),'SGP research index unavailable');
    const index=validateIndex(await indexResponse.json()),entry=index.editions.filter(e=>e.date===day).at(-1);
    if(!entry)return null;
    const response=await fetcher(new URL(entry.path,root),{credentials:'omit',cache:'force-cache'});
    fail(response.ok&&(!response.url||new URL(response.url).origin===root.origin),'SGP research body unavailable');
    return open(await response.text(),entry);
  }
  function runtimeRows(body){return body?body.suggestions.flatMap(a=>a.legs.map(l=>clone(l.pick))):[];}
  function legOutcome(leg,resolved,now){
    const p=leg.pick,r=resolved.get(p.id)||p.result;
    if(r.eventStatus!=='final')return ['canceled','postponed','unknown'].includes(r.eventStatus)?'unknown':'pending';
    if(r.source!=='https://www.espn.com/nba/boxscore/_/gameId/'+p.resultSource.eventId||
      !Number.isFinite(Date.parse(r.checkedAt))||Date.parse(r.checkedAt)>now||Date.parse(r.checkedAt)<Date.parse(p.startTime))return 'unknown';
    if(['dnp','out'].includes(r.statisticalOutcome))return 'dnp';
    if(!finite(r.minutesPlayed)||r.minutesPlayed<=0||!Number.isInteger(r.actual)||r.actual<0)return 'unknown';
    const c=results.normalizeContract(p),wins=c.operator==='>'?r.actual>c.line:c.operator==='>='?r.actual>=c.line:c.operator==='<'?r.actual<c.line:r.actual<=c.line;
    const outcome=r.actual===c.line&&['>','<'].includes(c.operator)?'push':wins?'win':'loss';
    return r.statisticalOutcome===outcome?outcome:'unknown';
  }
  function outcome(a,resolved=new Map(),now=Date.now()){
    const states=a.legs.map(l=>legOutcome(l,resolved,now));
    if(states.includes('unknown'))return 'unknown';
    if(states.includes('dnp'))return 'dnp';
    if(states.includes('pending'))return 'pending';
    if(states.includes('loss'))return 'miss';
    if(states.includes('push'))return 'push';
    return states.every(x=>x==='win')?'hit':'unknown';
  }
  function summary(body,resolved=new Map(),now=Date.now()){
    const s={hit:0,miss:0,pending:0,push:0,dnp:0,unknown:0};
    for(const a of body.suggestions)s[outcome(a,resolved,now)]++;
    return {...s,hitRate:s.hit+s.miss?s.hit/(s.hit+s.miss):null};
  }
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const odds=x=>(x>0?'+':'')+x;
  const book=x=>({fanduel:'FanDuel',draftkings:'DraftKings',mixed:'Mixed books'}[x]);
  const stamp=x=>new Date(x).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET';
  const names={PTS:'points',AST:'assists',REB:'rebounds','3PM':'made threes',PRA:'points + rebounds + assists',PA:'points + assists',PR:'points + rebounds',RA:'rebounds + assists',BLK:'blocks',STL:'steals'};
  const label=p=>p.player+' · '+(p.operator==='>='?p.line+'+':p.operator==='<='?'At most '+p.line:(p.operator==='>'?'Over ':'Under ')+p.line)+' '+names[p.market];
  function jointHTML(a){
    const m=a.jointModel;
    if(!m)return '<p class="sgpr-model">Experimental joint model: unavailable for this saved edition.</p>';
    const pct=x=>(x*100).toFixed(1)+'%';
    return '<section class="sgpr-model" aria-label="Experimental joint model"><p><strong>Experimental joint model'+(m.status==='unavailable'?': unavailable.':'.')+'</strong> '+
      (m.status==='unavailable'?esc(m.reason):'Estimated joint win probability: <strong>'+pct(m.winProbability)+'</strong> · push '+pct(m.pushProbability)+' · loss '+pct(m.lossProbability)+'. Fair model odds: <strong>'+(m.fairAmericanOdds===null?'Unavailable':odds(m.fairAmericanOdds))+'</strong>.'+(m.pushProbability>0?' No fair price: reduced-ticket settlement after a push is unknown.':m.fairAmericanOdds===null?' No finite fair price at a boundary probability.':''))+
      '</p><p>'+(m.status==='unavailable'?'No supported joint estimate is available for this exact ticket.':'This is a model estimate, not an observed sportsbook quote or evidence of ticket acceptance.')+' It does not establish ticket EV or betting readiness.</p>'+
      '<small>Model '+esc(m.modelVersion||'unavailable')+' · estimated '+esc(stamp(m.estimatedAt))+' · input cutoff '+esc(stamp(m.inputCutoff))+(m.sampleGames===null?'':' · '+m.sampleGames+' sample games')+'</small><ul>'+m.limitations.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></section>';
  }
  function renderHTML(body,rows=[],now=Date.now(),opened=new Set()){
    validate(body,now);
    const resolved=new Map(rows.map(r=>[r.id,r.result])),s=summary(body,resolved,now);
    return '<div class="sgpr-heading"><h2 id="sgp-research-title">SGP research suggestions</h2><span>'+body.suggestions.length+' saved combinations</span></div>'+
      '<p>Unquoted research suggestions, not executable sportsbook tickets. Individual prices retain their original books and clocks. The filters and price tiers above apply to priced references, not these suggestions.</p>'+
      '<p class="sgpr-record" role="status">Statistical hit rate: <strong>'+(s.hitRate===null?'Unavailable':(s.hitRate*100).toFixed(1)+'%')+'</strong> · '+s.hit+' hits · '+s.miss+' misses · '+s.pending+' pending · '+s.push+' pushes · '+s.dnp+' DNP · '+s.unknown+' unknown.</p>'+
      '<p class="sgpr-note">All original legs must have final, played results for a hit or miss. Pushes, DNP, unknown and pending cohorts stay separate. Repeated legs and games are correlated; this is descriptive hit-rate tracking only.</p>'+
      body.suggestions.map((a,i)=>'<details class="sgpr-card" data-sgp-research-id="'+esc(a.id)+'"'+(opened.has(a.id)?' open':'')+'><summary><span><strong>'+esc(a.kind==='sgp'?'SGP':'SGP+')+' research '+(i+1)+'</strong><small>'+a.legs.length+' original legs · '+book(a.priceSources)+'</small>'+(a.jointModel?.status==='unavailable'?'<small class="sgpr-warning">Review: '+esc(a.jointModel.reason)+'</small>':'')+'</span><span class="sgpr-state">'+outcome(a,resolved,now)+'</span></summary>'+
        '<p class="sgpr-quote"><strong>Combined sportsbook quote: unverified / not observed.</strong></p>'+
        (a.priceSources==='mixed'?'<p class="sgpr-warning">Mixed-book combination: the saved prices come from FanDuel and DraftKings. No single-book ticket price or acceptance is established.</p>':'')+
        '<ol>'+a.legs.map(l=>'<li><strong>'+esc(label(l.pick))+'</strong><span>'+book(l.pick.book)+' '+odds(l.pick.americanOdds)+'</span><small>'+esc(gameText(l.pick))+' · '+esc(stamp(l.pick.startTime))+'</small><small>Provider observation '+esc(stamp(l.providerAsOf))+' · captured '+esc(stamp(l.pick.capturedAt))+'</small><small>Forecast input cutoff '+esc(stamp(l.forecastCutoff))+' · forecast saved '+esc(stamp(l.pick.estimate.asOf))+'</small></li>').join('')+'</ol>'+
        jointHTML(a)+
        '<p class="sgpr-benchmark">Straight-odds benchmark: <strong>'+(a.straightOddsBenchmark?odds(a.straightOddsBenchmark.americanOdds):'Unavailable')+'</strong>. Calculator multiplication of saved straight-leg prices, unadjusted for same-game dependence. This is not an SGP quote, correlation-adjusted estimate, fair price or win probability.</p>'+
        '<p>Original recorded availability and role: unknown. Later review notices above remain separate. Overtime and settlement terms: unverified. '+(a.jointModel?'Statistical compatibility score and ticket EV: unavailable.':'Statistical compatibility score, joint win probability and ticket EV: unavailable.')+' Basic logical checks recorded no conflicts; compatibility is informational only.</p>'+
        '<p class="sgpr-note">Original selections '+esc(stamp(body.sourceSelectionAt))+' · nominated '+esc(stamp(body.nominatedAt))+' · '+(body.postedAt?'posting verified '+esc(stamp(body.postedAt)):'public posting time awaiting verification')+'. Original membership is retained; no leg is removed after a push or DNP.</p></details>').join('');
  }
  // "Away @ Home" from the board (NBA schedule); older rows only know team vs opponent, not home/away.
  function gameText(pick){return / @ /.test(pick.matchup||'')?pick.matchup:pick.team+' vs '+pick.opponent;}
  return {validate,validateIndex,open,load,runtimeRows,outcome,summary,renderHTML,overlappingSamePlayer,gameText};
});
