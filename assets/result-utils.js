(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.STARS_RESULT_UTILS = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const fields = { BLK: ['blocks'], STL: ['steals'], PTS: ['points'], AST: ['assists'], REB: ['rebounds'], '3PM': ['threes'], PRA: ['points', 'rebounds', 'assists'], PR: ['points', 'rebounds'], PA: ['points', 'assists'], RA: ['rebounds', 'assists'] };
  const aliases = { blocks: 'BLK', steals: 'STL', points: 'PTS', assists: 'AST', rebounds: 'REB', threes: '3PM', '3pt': '3PM', '3pm': '3PM', pra: 'PRA', pr: 'PR', pa: 'PA', ra: 'RA' };
  const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  // Editorial tracking policy, added October 29. The original test slate stays archived.
  const TEST_SLATE_DATE='2026-10-26';
  function isTestSlate(row){return typeof row==='string'?row===TEST_SLATE_DATE:row?.date===TEST_SLATE_DATE||(row?.legs||[]).some(isTestSlate);}
  function trackingScope(rows,scope){return scope||((new Set(rows.flatMap(row=>row.date?[row.date]:(row.legs||[]).map(leg=>leg.date)).filter(Boolean))).size>1?'cumulative':'slate');}
  function trackingRows(rows,{scope}={}){return trackingScope(rows,scope)==='cumulative'?rows.filter(row=>!isTestSlate(row)):rows;}
  function testSlateNotice(day){
    if(!isTestSlate(day))return '';
    return '<aside class="test-slate-notice" role="note" aria-label="Initial algorithm test slate"><strong>October 26 · Initial algorithm test slate</strong><p>This was our first day using the algorithm. We substantially revised the model and tightened pick qualifications throughout the day, so the slate does not represent one consistent selection or staking approach. Unit returns shown here apply your current stake settings; they are hypothetical, not a record of stakes placed that day.</p><p><strong>Preserved for transparency. Excluded from cumulative win-rate and unit P/L totals.</strong> This tracking exclusion was added October 29, 2026. Every original pick, price and recorded result remains available below.</p></aside>';
  }
  function normalizeContract(prop) {
    if (!prop || typeof prop !== 'object') return null;
    let market = owns(fields, prop.market) ? prop.market : aliases[String(prop.market).toLowerCase()];
    let line = prop.line;
    let operator = prop.operator;
    if (line === undefined && prop.prop) {
      const match = String(prop.prop || '').match(/^(\d+(?:\.\d+)?)\+ (Points|Assists|Threes|Rebounds|PRA|PR|PA|RA)$/i);
      if (!match) return null;
      const displayMarket = aliases[match[2].toLowerCase()];
      if (prop.market !== undefined && market !== displayMarket) return null;
      market = displayMarket; line = Number(match[1]); operator = '>=';
    }
    operator = { gt: '>', gte: '>=', lt: '<', lte: '<=', over: '>', under: '<', at_least: '>=' }[operator] || operator || ({ over: '>', under: '<' }[prop.side]);
    if (!owns(fields, market) || !Number.isFinite(line) || line < 0 || !['>', '>=', '<', '<='].includes(operator)) return null;
    if (prop.side && !['over', 'under'].includes(prop.side)) return null;
    if ((prop.side === 'over' && operator.startsWith('<')) || (prop.side === 'under' && operator.startsWith('>'))) return null;
    if (prop.period && !['full_game', 'full-game', 'game', 'full', 'FT'].includes(prop.period)) return null;
    return { market, line, operator };
  }
  function statValue(stats, name) {
    const alias = { blocks: 'BLK', steals: 'STL', points: 'PTS', assists: 'AST', rebounds: 'REB', threes: '3PM' }[name];
    const raw = stats[name] ?? stats[alias] ?? (name === 'threes' ? stats['3PT'] : null);
    const value = name === 'threes' && typeof raw === 'string' && /^\d+-\d+$/.test(raw) ? Number(raw.split('-')[0]) : raw;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isInteger(value) ? value : null;
  }
  function evaluateStructured(prop, result) {
    const contract = normalizeContract(prop);
    const eventStatus = result?.eventStatus || (result?.completed === true ? 'final' : result?.completed === false ? 'live' : 'unknown');
    const base = { actual: null, unit: contract?.market || '', eventStatus, statisticalOutcome: 'unavailable', sportsbookSettlement: result?.sportsbookSettlement || result?.settlement || 'unknown', final: eventStatus === 'final', checkedAt: result?.checkedAt ?? null, source: result?.source ?? null, revision: result?.revision ?? null };
    if (['canceled', 'cancelled', 'postponed'].includes(eventStatus)) return { ...base, statisticalOutcome: eventStatus === 'cancelled' ? 'canceled' : eventStatus, final: false };
    if (result?.didNotPlay) return { ...base, statisticalOutcome: 'dnp' };
    if (!contract || !result) return base;
    const values = fields[contract.market].map(field => statValue(result.stats || result, field));
    if (values.includes(null)) return base;
    const actual = values.reduce((a, b) => a + b, 0);
    if (!['final', 'live'].includes(eventStatus)) return { ...base, actual };
    const { line, operator } = contract;
    const wins = operator === '>' ? actual > line : operator === '>=' ? actual >= line : operator === '<' ? actual < line : actual <= line;
    // Equality is a push for strict sportsbook lines, never for an n+ offer.
    const push = actual === line && ['>', '<'].includes(operator);
    return { ...base, actual, statisticalOutcome: base.final ? (push ? 'push' : wins ? 'win' : 'loss') : (wins && operator.startsWith('>') ? 'reached' : !wins && !push && operator.startsWith('<') ? 'not_reached' : 'pending') };
  }
  // Preserve the original card/table contract while grading structured terms internally.
  function evaluate(prop, player) {
    const result = evaluateStructured(prop, player);
    const labels = { unavailable: 'Unavailable', dnp: 'DNP', canceled: 'Canceled', postponed: 'Postponed', win: 'Hit', loss: 'Miss', push: 'Push', reached: 'Reached', not_reached: 'Not reached', pending: 'Pending' };
    return { ...result, label: labels[result.statisticalOutcome], tone: result.statisticalOutcome === 'win' ? 'hit' : result.statisticalOutcome === 'loss' ? 'miss' : ['reached', 'pending'].includes(result.statisticalOutcome) ? 'live' : 'pending' };
  }
  // A reached live over can count now, while remaining open to source corrections.
  function isLiveHit(prop) {
    const r=prop?.result,c=normalizeContract(prop);
    return r?.eventStatus==='live'&&['reached','win'].includes(r.statisticalOutcome)&&
      !!c&&c.operator.startsWith('>')&&Number.isInteger(r.actual)&&r.actual>=0&&
      (c.operator==='>'?r.actual>c.line:r.actual>=c.line);
  }
  function isStatisticalHit(prop) {
    return prop?.result?.eventStatus==='final'&&prop.result.statisticalOutcome==='win'||isLiveHit(prop);
  }
  // Counting-stat unders cannot recover after exceeding the line, except for
  // source corrections. Strict integer equality can still push, so stays pending.
  // Read legacy pending snapshots too; never rewrite them as final losses.
  function isLiveMiss(prop) {
    const r=prop?.result,c=normalizeContract(prop);
    return r?.eventStatus==='live'&&['pending','not_reached'].includes(r.statisticalOutcome)&&
      !!c&&c.operator.startsWith('<')&&Number.isInteger(r.actual)&&r.actual>=0&&r.actual>c.line;
  }
  function isStatisticalMiss(prop) {
    return prop?.result?.eventStatus==='final'&&prop.result.statisticalOutcome==='loss'||isLiveMiss(prop);
  }
  function isVoidedLeg(prop){
    const r=prop?.result||{};
    return r.statisticalOutcome==='out'||r.statisticalOutcome==='dnp'&&r.eventStatus==='final'||r.statisticalOutcome==='push'&&r.eventStatus==='final'||r.statisticalOutcome==='canceled'&&r.eventStatus==='canceled';
  }
  function parlayLegs(ticket){const all=ticket?.legs||[];return {all,active:all.filter(p=>!isVoidedLeg(p)),voided:all.filter(isVoidedLeg)};}
  function parlayDecimal(ticket,{adjusted=true}={}){
    const split=parlayLegs(ticket),legs=adjusted?split.active:split.all;
    if(!split.all.length)return null;
    if(adjusted&&!legs.length)return 1;
    const price=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)>=100?1+(v>0?v/100:100/Math.abs(v)):null;
    if(ticket.priceKind==='posted')return adjusted&&split.voided.length?null:price(ticket.americanOdds);
    const prices=legs.map(p=>price(p.americanOdds));if(!prices.every(v=>v!==null))return null;
    const value=prices.reduce((a,b)=>a*b,1);return Number.isFinite(value)?value:null;
  }
  // Ticket records count each published parlay once, regardless of leg count or price view.
  function parlayOutcome(ticket) {
    const split=parlayLegs(ticket),legs=split.active,live=split.all.some(p=>p.result?.eventStatus==='live');
    if(!split.all.length)return {outcome:'pending',live:false};
    if(!legs.length)return {outcome:'void',live};
    if(legs.some(isStatisticalMiss))return {outcome:'loss',live};
    if(legs.every(isStatisticalHit))return {outcome:'win',live};
    if(legs.every(p=>isStatisticalHit(p)||p.result?.statisticalOutcome==='postponed'))return {outcome:'review',live};
    return {outcome:'pending',live};
  }
  function parlaySummary(tickets,{scope}={}) {
    tickets=trackingRows(tickets,{scope});
    const unique=[...new Map(tickets.map(t=>[t.id||JSON.stringify(t.legs.map(p=>[p.date,p.canonicalEventId||p.eventId,p.playerId,normalizeContract(p)]).sort()),t])).values()];
    const s={total:unique.length,hits:0,misses:0,pending:0,review:0,live:0,voided:0,winsWithVoids:0};
    for(const ticket of unique){const r=parlayOutcome(ticket);s[{win:'hits',loss:'misses',pending:'pending',review:'review',void:'voided'}[r.outcome]]++;if(r.live)s.live++;if(r.outcome==='win'&&parlayLegs(ticket).voided.length)s.winsWithVoids++;}
    s.hitRate=s.hits+s.misses?s.hits/(s.hits+s.misses):null;return s;
  }
  function personalPrice(record,{requireEvidence=false}={}) {
    const value=record?.americanOdds,evidence=record?.priceEvidence;
    if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)<100)return null;
    if(record?.recordKind==='selection_snapshot')return Array.isArray(record.legs)&&record.legs.length>=2&&record.legs.length<=12&&record.placedAt===null&&record.quoteBasis==='unboosted'&&typeof record.oddsChangedAtCapture==='boolean'&&evidence?.source==='screenshot'&&evidence.context==='selection_snapshot'&&(evidence.observedAt===null||Number.isFinite(Date.parse(evidence.observedAt)))?value:null;
    if(!evidence)return requireEvidence?null:value; // Original screenshot records predate evidence metadata.
    return ['screenshot','share_link'].includes(evidence.source)&&evidence.context==='original_slip'&&Number.isFinite(Date.parse(evidence.observedAt))?value:null;
  }
  function personalParlays(body) {
    if(Array.isArray(body?.personalSlips)){
      const rows=new Map((body.props||[]).filter(p=>p.group==='ry').map(p=>[p.id,p]));
      return body.personalSlips.flatMap(s=>{
        if(!Array.isArray(s.legs)||s.legs.length<2||s.legs.some(l=>!rows.has(l.pickId)))return [];
        const legs=s.legs.map(l=>({...rows.get(l.pickId),americanOdds:personalPrice(l),priceEvidence:l.priceEvidence,book:s.book,bookPrices:undefined,priceCheck:undefined}));
        return [{id:s.id,date:body.date,...(s.label?{label:s.label}:{}),...(s.recordKind==='selection_snapshot'?{recordKind:s.recordKind,quoteBasis:s.quoteBasis,oddsChangedAtCapture:s.oddsChangedAtCapture}:{}),legs,groups:s.groups,americanOdds:personalPrice(s),priceEvidence:s.priceEvidence,shareUrl:s.shareUrl,book:s.book,priceKind:'posted',ryFavorite:s.ryFavorite===true,placedAt:s.placedAt,postedAt:body.personalPublication?.publishedAt??null,recordedAt:body.personalPublication?.recordedAt??null}];
      });
    }
    const legs=(body?.props||[]).filter(p=>p.group==='ry');
    // Legacy editions explicitly identify one posted slip. Favorite flags alone are not tickets.
    return legs.length&&(body.sharedBetslipUrl||Number.isFinite(body.sharedBetslipOdds))?[{id:'ry:'+body.date+':'+(body.sharedBetslipUrl||body.favoritesPostedAt||'posted-slip'),date:body.date,legs,americanOdds:body.sharedBetslipOdds??null,shareUrl:body.sharedBetslipUrl,book:legs.find(r=>r.book)?.book||(body.sharedBetslipUrl?'fanduel':null),priceKind:'posted',postedAt:body.favoritesPostedAt??null}]:[];
  }
  function parlayRecordHTML(tickets,{scope='parlays',label='Slate parlay record'}={}) {
    const s=parlaySummary(tickets),escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    return `<div class="record-summary" data-record-summary="${escape(scope)}" aria-label="${escape(label)}"><span><strong>${s.total}</strong> ${s.total===1?'parlay':'parlays'}</span><span class="record-hits"><strong>${s.hits}</strong> hit</span><span class="record-misses"><strong>${s.misses}</strong> missed</span><span><strong>${s.hitRate===null?'—':(s.hitRate*100).toFixed(1)+'%'}</strong> parlay hit rate</span>${s.winsWithVoids?`<span>${s.winsWithVoids} won with voids</span>`:''}${s.voided?`<span>${s.voided} fully voided</span>`:''}${s.pending?`<span>${s.pending} pending</span>`:''}${s.review?`<span>${s.review} settlement review</span>`:''}${s.live?`<span class="row-live-flag">● ${s.live} live</span>`:''}</div><p class="parlay-record-note">${escape(label)} · one result per posted parlay. Voided legs are removed; a ticket wins when every remaining leg hits. Fully voided, pending and review tickets are excluded from hit rate. Prices and P/L are statistical estimates, not verified sportsbook settlement.</p>`;
  }
  function applyRevisions(snapshot, revisions) {
    const players = Object.fromEntries(Object.entries(snapshot.players || {}).map(([name, player]) => [name, { ...player }]));
    const games = (snapshot.games || []).map(game => ({ ...game }));
    const appliedRevisions = [];
    let checkedAt = snapshot.checkedAt, checkedAtLabel = snapshot.checkedAtLabel;
    for (const revision of (Array.isArray(revisions) ? revisions : []).filter(row => row && typeof row === 'object').sort((a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt))) {
      if (!revision || !Number.isFinite(Date.parse(revision.checkedAt))) continue;
      const changedPlayers = [], changedGames = [];
      for (const replacement of Object.values(revision.players || {})) {
        if (!replacement || typeof replacement !== 'object') continue;
        // Names are display-only: a correction must match both original IDs.
        const entry = Object.entries(players).find(([, player]) => replacement.athleteId && replacement.gameId && player.athleteId === replacement.athleteId && player.gameId === replacement.gameId);
        if (!entry || !Number.isFinite(Date.parse(replacement.checkedAt)) || Date.parse(replacement.checkedAt) <= Date.parse(entry[1].checkedAt)) continue;
        players[entry[0]] = { ...entry[1], ...replacement }; changedPlayers.push(entry[0]);
      }
      for (const replacement of revision.games || []) {
        if (!replacement || typeof replacement !== 'object') continue;
        const index = games.findIndex(game => game.id && game.id === replacement.id);
        if (index < 0 || !Number.isFinite(Date.parse(replacement.checkedAt)) || Date.parse(replacement.checkedAt) <= Date.parse(games[index].checkedAt)) continue;
        games[index] = { ...games[index], ...replacement }; changedGames.push(replacement.id);
      }
      if (!changedPlayers.length && !changedGames.length) continue;
      appliedRevisions.push({ id: revision.id, checkedAt: revision.checkedAt, checkedAtLabel: revision.checkedAtLabel, sourceName: revision.sourceName, source: revision.source, changedPlayers, changedGames });
      if (Date.parse(revision.checkedAt) > Date.parse(checkedAt)) { checkedAt = revision.checkedAt; checkedAtLabel = revision.checkedAtLabel; }
    }
    return { ...snapshot, players, games, checkedAt, checkedAtLabel, appliedRevisions };
  }
  return { TEST_SLATE_DATE,isTestSlate,trackingScope,trackingRows,testSlateNotice,evaluate, evaluateStructured, normalizeContract, applyRevisions, isLiveHit, isStatisticalHit, isLiveMiss, isStatisticalMiss, isVoidedLeg, parlayLegs, parlayDecimal, parlayOutcome, parlaySummary, personalPrice, personalParlays, parlayRecordHTML };
});
