/* Public allowlist reader. No model, quote synthesis, or betting qualification. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SBOSSgpIdeas = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const HOLDS = ['native_identity_unverified', 'official_start_unverified', 'current_role_availability_unverified', 'terms_jurisdiction_unverified', 'quote_not_execution', 'joint_probability_unavailable'];
  const RESULT = ['win', 'loss', 'push', 'dnp', 'unknown'];
  const components = {PTS:['PTS'], REB:['REB'], AST:['AST'], '3PM':['3PM'], PRA:['PTS','REB','AST'], PR:['PTS','REB'], PA:['PTS','AST'], RA:['REB','AST']};
  function check(ok, message) { if (!ok) throw new Error(message); }
  function keys(x, names) { check(x && Object.getPrototypeOf(x) === Object.prototype && Object.keys(x).sort().join('|') === names.slice().sort().join('|'), 'Unexpected public fields'); }
  function label(x) { return typeof x === 'string' && x.length > 0 && x.length <= 160 && !/[<>\u0000-\u001f]/.test(x); }
  function id(x) { return typeof x === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(x); }
  function native(x, event=false) { return x === null || typeof x === 'string' && (event ? /^nba:\d{10}$/ : /^nba:\d+$/).test(x); }
  function price(x) { return Number.isInteger(x) && Math.abs(x) >= 100 && Math.abs(x) <= 1000000; }
  function clock(x) {
    check(typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(x), 'UTC millisecond clock required');
    const n = Date.parse(x); check(Number.isFinite(n) && new Date(n).toISOString().replace('.000Z','Z') === x.replace(/\.(\d{1,2})Z$/,(_,s)=>'.'+s.padEnd(3,'0')+'Z').replace('.000Z','Z'), 'Invalid clock'); return n;
  }
  function dateAt(x) { return new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x)); }
  function semanticLeg(l) { return [l.nativePlayerId || l.player, l.market, l.operator, l.threshold, l.period, l.overtime].join('|'); }
  function validate(body, now = Date.now()) {
    keys(body, ['schemaVersion','ideas','resolutions']); check(body.schemaVersion === 'public-sgp-ideas-1', 'Unsupported SGP ideas');
    check(Array.isArray(body.ideas) && body.ideas.length <= 64 && Array.isArray(body.resolutions) && body.resolutions.length <= 64, 'Bounded ideas required');
    const ids = new Map();
    for (const a of body.ideas) {
      keys(a, ['id','kind','date','book','bookEventId','eventLabel','nativeEventId','officialStart','legs','observed','combinedPrice','holds','jointWinProbability','ticketEV','betReady','algorithmQualified','compatibility']);
      check(id(a.id) && !ids.has(a.id) && a.kind === 'research_idea', 'Unique research ideas required'); ids.set(a.id,a);
      check(/^\d{4}-\d\d-\d\d$/.test(a.date) && new Date(a.date+'T12:00:00Z').toISOString().slice(0,10) === a.date, 'Exact slate date required');
      check(['FanDuel','DraftKings'].includes(a.book) && /^\d+$/.test(a.bookEventId) && label(a.eventLabel) && native(a.nativeEventId,true), 'Book event identity required');
      check(a.officialStart === null || dateAt(clock(a.officialStart)) === a.date, 'Official start/slate mismatch');
      keys(a.observed,['captureId','startedAt','completedAt','bookUpdatedAt']); check(id(a.observed.captureId), 'Opaque capture reference required');
      const start=clock(a.observed.startedAt), end=clock(a.observed.completedAt);
      check(start <= end && end <= now && (a.officialStart === null || end < clock(a.officialStart)), 'Invalid observation interval');
      check(a.observed.bookUpdatedAt === null || clock(a.observed.bookUpdatedAt) <= start, 'Book update after acquisition');
      keys(a.combinedPrice,['kind','americanOdds']);
      check(a.combinedPrice.kind === 'observed_sportsbook_quote' && price(a.combinedPrice.americanOdds) || a.combinedPrice.kind === 'unavailable' && a.combinedPrice.americanOdds === null, 'Actual observed ticket price or unavailable required');
      check(Array.isArray(a.legs) && a.legs.length >= 2 && a.legs.length <= 6, 'Two to six exact legs required');
      const seen = new Set();
      for (const l of a.legs) {
        keys(l,['player','nativePlayerId','nativeTeamId','market','operator','side','threshold','americanOdds','period','overtime','settlementTermsState']);
        check(label(l.player) && native(l.nativePlayerId) && native(l.nativeTeamId) && Object.hasOwn(components,l.market), 'Exact player/stat required');
        check(['>','>=','<','<='].includes(l.operator) && l.side === (l.operator.startsWith('>')?'over':'under') && Number.isFinite(l.threshold) && l.threshold >= 0 && l.threshold <= 1000 && price(l.americanOdds), 'Exact leg contract/price required');
        check(l.period === 'full_game' && [null,true,false].includes(l.overtime) && ['unverified','verified'].includes(l.settlementTermsState), 'Explicit scope/terms required');
        const key=semanticLeg(l); check(!seen.has(key), 'Duplicate leg'); seen.add(key);
      }
      for (let i=0;i<a.legs.length;i++) for (let j=i+1;j<a.legs.length;j++) {
        const x=a.legs[i],y=a.legs[j];
        const name=l=>l.player.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
        const sameName=name(x)===name(y), sameId=x.nativePlayerId !== null && x.nativePlayerId===y.nativePlayerId;
        check(!sameName || x.nativePlayerId === null || y.nativePlayerId === null || x.nativePlayerId === y.nativePlayerId, 'Contradictory player identity');
        if (!sameName && !sameId) continue;
        check(x.nativeTeamId === null || y.nativeTeamId === null || x.nativeTeamId === y.nativeTeamId, 'Contradictory player team');
        check(!components[x.market].some(c=>components[y.market].includes(c)) && !([x.market,y.market].includes('3PM') && [x,y].some(l=>components[l.market].includes('PTS'))), 'Same-player component overlap');
      }
      check(Array.isArray(a.holds) && new Set(a.holds).size === a.holds.length && a.holds.every(x=>HOLDS.includes(x)) && a.holds.includes('quote_not_execution') && a.holds.includes('joint_probability_unavailable'), 'Research holds required');
      check(a.nativeEventId !== null && a.legs.every(l=>l.nativePlayerId !== null && l.nativeTeamId !== null) || a.holds.includes('native_identity_unverified'), 'Missing native identity hold');
      check(a.officialStart !== null || a.holds.includes('official_start_unverified'), 'Missing start hold');
      check(a.legs.every(l=>l.settlementTermsState === 'verified' && l.overtime !== null) || a.holds.includes('terms_jurisdiction_unverified'), 'Missing terms hold');
      check(a.holds.includes('current_role_availability_unverified'), 'Current context remains unverified in this projection');
      check(a.jointWinProbability === null && a.ticketEV === null && a.betReady === false && a.algorithmQualified === false, 'Ideas cannot become qualified forecasts');
      keys(a.compatibility,['state','value','selectionUse']); check(a.compatibility.state === 'unavailable' && a.compatibility.value === null && a.compatibility.selectionUse === 'informational_only', 'No inferred compatibility');
    }
    const resolved=new Set();
    for (const r of body.resolutions) {
      keys(r,['ideaId','sourceRef','nativeEventId','finalAt','observedAt','identityVerified','eventState','finalityVerified','resultBasis','legResults']);
      const a=ids.get(r.ideaId); check(a && !resolved.has(r.ideaId), 'Unique existing resolution required'); resolved.add(r.ideaId);
      check(id(r.sourceRef) && r.identityVerified === true && a.nativeEventId !== null && r.nativeEventId === a.nativeEventId && a.officialStart !== null && a.legs.every(l=>l.nativePlayerId !== null && l.nativeTeamId !== null), 'Verified exact native identity required for results');
      check(r.eventState === 'final' && r.finalityVerified === true && clock(a.officialStart) < clock(r.finalAt) && clock(r.finalAt) <= clock(r.observedAt) && clock(r.observedAt) <= now, 'Explicit final source clock required');
      check(r.resultBasis === 'statistical_only_not_book_settlement' && Array.isArray(r.legResults) && r.legResults.length === a.legs.length && r.legResults.every(x=>RESULT.includes(x)), 'Complete statistical resolution required');
    }
    return body;
  }
  function resultFor(a, resolutions) {
    const r=resolutions.find(x=>x.ideaId === a.id); if (!r) return 'pending';
    if (r.legResults.includes('unknown')) return 'unknown';
    if (r.legResults.includes('dnp')) return 'dnp';
    if (r.legResults.includes('loss')) return 'loss';
    if (r.legResults.includes('push')) return 'push';
    return r.legResults.every(x=>x==='win')?'win':'loss';
  }
  function summary(body, now=Date.now()) {
    validate(body,now); const s={win:0,loss:0,push:0,dnp:0,unknown:0,pending:0};
    body.ideas.forEach(a=>s[resultFor(a,body.resolutions)]++);
    return {...s,hitRate:s.win+s.loss ? s.win/(s.win+s.loss) : null};
  }
  function american(x) { return x === null?'Unavailable':(x>0?'+':'')+x; }
  function et(x) { return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(x)); }
  function render(body, document, container) {
    validate(body); container.replaceChildren();
    const add=(parent,tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;parent.append(n);return n;};
    if (!body.ideas.length) { add(container,'p','No reviewed SGP ideas have been published yet.','empty'); return; }
    const s=summary(body);
    add(container,'p',`Statistical hit rate: ${s.hitRate === null?'Unavailable — no resolved ideas':(100*s.hitRate).toFixed(1)+'%'} · ${s.win} wins · ${s.loss} losses · ${s.pending} pending · ${s.push} pushes · ${s.dnp} DNP · ${s.unknown} unknown. Repeated legs and games are correlated; this is descriptive tracking.`,'tracking');
    for (const a of body.ideas) {
      const card=add(container,'article','','idea'); add(card,'p',`${a.book} · research idea · ${a.date}`,'eyebrow'); add(card,'h2',a.eventLabel);
      const list=add(card,'ul',''); a.legs.forEach(l=>add(list,'li',`${l.player} ${l.market} ${l.operator} ${l.threshold} · ${american(l.americanOdds)}`));
      add(card,'p',`Observed ticket price: ${american(a.combinedPrice.americanOdds)}`,'ticket-price');
      add(card,'p',`Captured ${et(a.observed.startedAt)} to ${et(a.observed.completedAt)}. Historical observation; current availability and execution are unverified.`);
      add(card,'p',a.observed.bookUpdatedAt === null?'Bookmaker update time: unknown.':`Bookmaker update: ${et(a.observed.bookUpdatedAt)}.`);
      add(card,'p','Joint win probability, ticket EV and compatibility: unavailable. Algorithm qualification: no.');
      add(card,'p',`Tracking: ${resultFor(a,body.resolutions)}. Statistical results do not assert sportsbook settlement.`);
      const details=add(card,'details',''); add(details,'summary','Review and scope');
      add(details,'p','Full-game contracts as displayed. Overtime terms and jurisdiction require review when unverified. Native identities, official start, roles and availability are not inferred from a sportsbook offer.');
      add(details,'p','Open reviews: '+a.holds.map(x=>x.replaceAll('_',' ')).join('; ')+'.');
    }
  }
  return {validate,summary,resultFor,american,et,render};
});
