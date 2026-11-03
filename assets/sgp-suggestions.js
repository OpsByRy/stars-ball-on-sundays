/* Inactive public v2 reader. No collection, model inputs, or betting qualification. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SBOSSgpSuggestions = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const HOLDS = ['native_identity_unverified', 'official_start_unverified', 'current_role_availability_unverified', 'terms_jurisdiction_unverified', 'quote_not_execution', 'joint_probability_unavailable'];
  const RESULTS = ['win', 'loss', 'push', 'dnp', 'unknown'];
  const COMPONENTS = {PTS: ['PTS'], REB: ['REB'], AST: ['AST'], '3PM': ['3PM'], PRA: ['PTS', 'REB', 'AST'], PR: ['PTS', 'REB'], PA: ['PTS', 'AST'], RA: ['REB', 'AST']};
  const ESTIMATE_METHOD = 'product_of_saved_decimal_leg_prices_no_sgp_adjustment';
  const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

  function check(ok, message) { if (!ok) throw new Error(message); }
  function keys(value, names) {
    check(value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'Public object required');
    const actual = Reflect.ownKeys(value);
    check(actual.length === names.length && actual.every(key => typeof key === 'string' && names.includes(key)), 'Unexpected public fields');
  }
  function array(value, min, max) {
    check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length >= min && value.length <= max, 'Bounded public array required');
    check(Reflect.ownKeys(value).length === value.length + 1 && Array.from({length: value.length}, (_, i) => Object.hasOwn(value, i)).every(Boolean), 'Dense public array required');
  }
  function label(value) { return typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[<>\u0000-\u001f\u007f]/.test(value); }
  function opaqueId(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value); }
  function nativeId(value, event = false) { return value === null || typeof value === 'string' && (event ? /^nba:\d{10}$/ : /^nba:\d+$/).test(value); }
  function price(value) { return Number.isInteger(value) && Math.abs(value) >= 100 && Math.abs(value) <= 1000000; }
  function integer(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }
  function percentagePoints(value) { return Number.isFinite(value) && value >= -100 && value <= 100; }

  // Date validates the actual calendar second; fractions stay exact in microseconds.
  function clock(value) {
    check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value), 'UTC microsecond clock required');
    const second = value.slice(0, 19), milliseconds = Date.parse(second + 'Z');
    check(Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 19) === second, 'Invalid UTC calendar clock');
    const fraction = value.slice(19, -1).replace('.', '').padEnd(6, '0');
    return BigInt(milliseconds) * 1000n + BigInt(fraction);
  }
  function dateAt(value) {
    return new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(value));
  }
  function normalizedName(leg) { return leg.player.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(); }

  // Standard odds arithmetic only: multiply exact saved straight-price fractions,
  // then round the American conversion halfway away from zero.
  function savedPriceProduct(legs) {
    let numerator = 1n, denominator = 1n;
    for (const leg of legs) {
      const absolute = BigInt(Math.abs(leg.americanOdds));
      numerator *= absolute + 100n;
      denominator *= leg.americanOdds > 0 ? 100n : absolute;
    }
    const positive = numerator >= 2n * denominator;
    const top = positive ? 100n * (numerator - denominator) : 100n * denominator;
    const bottom = positive ? denominator : numerator - denominator;
    const rounded = (2n * top + bottom) / (2n * bottom);
    return {american: positive ? rounded : -rounded, decimal: Number(numerator) / Number(denominator)};
  }
  function decimalPrice(value) {
    if (typeof value !== 'string' || !/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return false;
    const digits = value.replace(/^\+/, '').split(/[eE]/)[0].replace('.', '').replace(/^0+/, '');
    return digits.length <= 18 && Number.isFinite(Number(value)) && Number(value) > 1;
  }
  function validateEstimate(estimate, legs) {
    keys(estimate, ['kind', 'americanOdds', 'decimalOdds', 'method', 'sportsbookVerified']);
    check(estimate.method === ESTIMATE_METHOD && estimate.sportsbookVerified === false, 'Unverified saved straight-price product required');
    const product = savedPriceProduct(legs), absolute = product.american < 0n ? -product.american : product.american;
    if (absolute > MAX_SAFE) {
      check(estimate.kind === 'unavailable_display_range' && estimate.americanOdds === null && estimate.decimalOdds === null, 'Out-of-range estimate must be unavailable');
    } else {
      check(estimate.kind === 'estimated_saved_leg_price_product' && Number.isSafeInteger(estimate.americanOdds) && Math.abs(estimate.americanOdds) >= 100 && BigInt(estimate.americanOdds) === product.american, 'Exact saved-price American product required');
      check(decimalPrice(estimate.decimalOdds) && Math.abs(Number(estimate.decimalOdds) - product.decimal) <= product.decimal * 1e-15, 'Matching decimal product with at most 18 significant digits required');
    }
  }
  function validateCompatibility(metric) {
    keys(metric, ['state', 'metric', 'value', 'units', 'evidenceGames', 'interval95', 'vintageMode', 'selectionUse', 'validated']);
    check(metric.metric === 'historical_all_win_excess_pp' && metric.units === 'percentage_points' && metric.selectionUse === 'informational_only' && metric.validated === false && integer(metric.evidenceGames, 0, 256), 'Informational historical summary required');
    if (metric.state === 'unavailable') {
      check(metric.value === null && metric.interval95 === null && metric.vintageMode === null && metric.evidenceGames === 0, 'Unavailable history must remain empty');
    } else {
      check(metric.state === 'descriptive_only' && percentagePoints(metric.value) && metric.evidenceGames >= 1 && ['strict_asof', 'retrospective_revised'].includes(metric.vintageMode), 'Signed descriptive history and explicit vintage required');
      if (metric.interval95 !== null) {
        array(metric.interval95, 2, 2);
        check(metric.evidenceGames >= 10 && metric.interval95.every(percentagePoints) && metric.interval95[0] <= metric.interval95[1], 'Bounded historical interval requires at least ten games');
      }
    }
  }
  function validate(body, now = Date.now()) {
    check(Number.isSafeInteger(now), 'Exact millisecond now required');
    const current = BigInt(now) * 1000n;
    keys(body, ['schemaVersion', 'ideas', 'resolutions', 'coverage']);
    check(body.schemaVersion === 'public-sgp-ideas-2', 'Unsupported SGP suggestions');
    array(body.ideas, 0, 64); array(body.resolutions, 0, 64);
    keys(body.coverage, ['availableIdeas', 'displayedIdeas', 'omittedIdeas', 'searchComplete']);
    const coverage = body.coverage;
    check(integer(coverage.availableIdeas, 0, 256) && integer(coverage.displayedIdeas, 0, 64) && integer(coverage.omittedIdeas, 0, 256) && typeof coverage.searchComplete === 'boolean' && coverage.displayedIdeas === body.ideas.length && coverage.availableIdeas === coverage.displayedIdeas + coverage.omittedIdeas, 'Exact bounded coverage required');

    const ideas = new Map();
    for (const idea of body.ideas) {
      keys(idea, ['id', 'kind', 'date', 'book', 'bookEventId', 'eventLabel', 'nativeEventId', 'officialStart', 'legs', 'observed', 'combinedPrice', 'estimatedCombinedPrice', 'holds', 'jointWinProbability', 'ticketEV', 'betReady', 'algorithmQualified', 'compatibility']);
      check(opaqueId(idea.id) && !ideas.has(idea.id) && idea.kind === 'research_idea', 'Unique opaque research ideas required');
      ideas.set(idea.id, idea);
      check(typeof idea.date === 'string' && /^\d{4}-\d\d-\d\d$/.test(idea.date), 'Exact slate date required');
      clock(idea.date + 'T12:00:00Z');
      check(['FanDuel', 'DraftKings'].includes(idea.book) && typeof idea.bookEventId === 'string' && /^\d{1,24}$/.test(idea.bookEventId) && label(idea.eventLabel) && nativeId(idea.nativeEventId, true), 'Literal book event identity required');
      const official = idea.officialStart === null ? null : clock(idea.officialStart);
      check(official === null || dateAt(idea.officialStart) === idea.date, 'Official start/slate mismatch');
      keys(idea.observed, ['captureId', 'startedAt', 'completedAt', 'bookUpdatedAt']);
      check(opaqueId(idea.observed.captureId), 'Opaque capture reference required');
      const started = clock(idea.observed.startedAt), completed = clock(idea.observed.completedAt);
      check(started <= completed && completed <= current && (official === null || completed < official), 'Invalid pregame observation interval');
      check(idea.observed.bookUpdatedAt === null || clock(idea.observed.bookUpdatedAt) <= started, 'Book update after acquisition');
      keys(idea.combinedPrice, ['kind', 'americanOdds']);
      check(idea.combinedPrice.kind === 'observed_sportsbook_quote' && price(idea.combinedPrice.americanOdds) || idea.combinedPrice.kind === 'unavailable' && idea.combinedPrice.americanOdds === null, 'Actual observed ticket price or unavailable required');

      array(idea.legs, 2, 6);
      for (const leg of idea.legs) {
        keys(leg, ['player', 'nativePlayerId', 'nativeTeamId', 'market', 'operator', 'side', 'threshold', 'americanOdds', 'period', 'overtime', 'settlementTermsState']);
        check(label(leg.player) && normalizedName(leg).length > 0 && nativeId(leg.nativePlayerId) && nativeId(leg.nativeTeamId) && typeof leg.market === 'string' && Object.hasOwn(COMPONENTS, leg.market), 'Exact player/stat required');
        check(['>', '>=', '<', '<='].includes(leg.operator) && leg.side === (leg.operator.startsWith('>') ? 'over' : 'under') && Number.isFinite(leg.threshold) && leg.threshold >= 0 && leg.threshold <= 1000 && !(leg.operator === '<' && leg.threshold === 0) && price(leg.americanOdds), 'Possible exact counting contract and saved price required');
        check(leg.period === 'full_game' && [null, true, false].includes(leg.overtime) && leg.overtime === idea.legs[0].overtime && ['unverified', 'verified'].includes(leg.settlementTermsState), 'Matching explicit scope and terms required');
      }
      for (let i = 0; i < idea.legs.length; i++) for (let j = i + 1; j < idea.legs.length; j++) {
        const x = idea.legs[i], y = idea.legs[j];
        const sameName = normalizedName(x) === normalizedName(y), sameId = x.nativePlayerId !== null && x.nativePlayerId === y.nativePlayerId;
        check(!sameName || x.nativePlayerId === null || y.nativePlayerId === null || x.nativePlayerId === y.nativePlayerId, 'Contradictory player identity');
        if (!sameName && !sameId) continue;
        check(x.nativeTeamId === null || y.nativeTeamId === null || x.nativeTeamId === y.nativeTeamId, 'Contradictory player team');
        check(!COMPONENTS[x.market].some(component => COMPONENTS[y.market].includes(component)) && !([x.market, y.market].includes('3PM') && [x, y].some(leg => COMPONENTS[leg.market].includes('PTS'))), 'Same-player component overlap');
      }
      validateEstimate(idea.estimatedCombinedPrice, idea.legs);
      array(idea.holds, 3, HOLDS.length);
      check(new Set(idea.holds).size === idea.holds.length && idea.holds.every(hold => HOLDS.includes(hold)) && ['quote_not_execution', 'joint_probability_unavailable', 'current_role_availability_unverified'].every(hold => idea.holds.includes(hold)), 'Research holds required');
      check(idea.nativeEventId !== null && idea.legs.every(leg => leg.nativePlayerId !== null && leg.nativeTeamId !== null) || idea.holds.includes('native_identity_unverified'), 'Missing native identity hold');
      check(official !== null || idea.holds.includes('official_start_unverified'), 'Missing start hold');
      check(idea.legs.every(leg => leg.settlementTermsState === 'verified' && leg.overtime !== null) || idea.holds.includes('terms_jurisdiction_unverified'), 'Missing terms hold');
      check(idea.jointWinProbability === null && idea.ticketEV === null && idea.betReady === false && idea.algorithmQualified === false, 'Ideas cannot become qualified forecasts');
      validateCompatibility(idea.compatibility);
    }

    const resolved = new Set();
    for (const resolution of body.resolutions) {
      keys(resolution, ['ideaId', 'sourceRef', 'nativeEventId', 'finalAt', 'observedAt', 'identityVerified', 'eventState', 'finalityVerified', 'resultBasis', 'legResults']);
      const idea = ideas.get(resolution.ideaId);
      check(idea && !resolved.has(resolution.ideaId), 'Unique existing resolution required');
      resolved.add(resolution.ideaId);
      check(opaqueId(resolution.sourceRef) && resolution.identityVerified === true && idea.nativeEventId !== null && resolution.nativeEventId === idea.nativeEventId && idea.officialStart !== null && idea.legs.every(leg => leg.nativePlayerId !== null && leg.nativeTeamId !== null), 'Verified exact native identity required for results');
      const final = clock(resolution.finalAt), observed = clock(resolution.observedAt);
      check(resolution.eventState === 'final' && resolution.finalityVerified === true && clock(idea.officialStart) < final && final <= observed && observed <= current, 'Explicit nonfuture final source clock required');
      array(resolution.legResults, idea.legs.length, idea.legs.length);
      check(resolution.resultBasis === 'statistical_only_not_book_settlement' && resolution.legResults.every(result => RESULTS.includes(result)), 'Complete statistical resolution required');
    }
    return body;
  }
  function resultFor(idea, resolutions) {
    const resolution = resolutions.find(value => value.ideaId === idea.id);
    if (!resolution) return 'pending';
    for (const result of ['unknown', 'dnp', 'loss', 'push']) if (resolution.legResults.includes(result)) return result;
    return resolution.legResults.every(result => result === 'win') ? 'win' : 'loss';
  }
  function summary(body, now = Date.now()) {
    validate(body, now);
    const counts = {win: 0, loss: 0, push: 0, dnp: 0, unknown: 0, pending: 0};
    body.ideas.forEach(idea => counts[resultFor(idea, body.resolutions)]++);
    return {...counts, hitRate: counts.win + counts.loss ? counts.win / (counts.win + counts.loss) : null};
  }
  function american(value) { return value === null ? 'Unavailable' : (value > 0 ? '+' : '') + value; }
  function et(value) {
    return new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short'}).format(new Date(value));
  }
  function signed(value) { return (value >= 0 ? '+' : '') + value; }
  function render(body, document, container, now = Date.now()) {
    const tracking = summary(body, now); // Reject before changing the existing view.
    container.replaceChildren();
    const add = (parent, tag, text, className) => {
      const node = document.createElement(tag);
      node.textContent = text;
      if (className) node.className = className;
      parent.append(node);
      return node;
    };
    const coverage = body.coverage;
    add(container, 'p', `Supplied-pool coverage: ${coverage.availableIdeas} available · ${coverage.displayedIdeas} displayed · ${coverage.omittedIdeas} omitted. Search ${coverage.searchComplete ? 'complete for the supplied pool' : 'incomplete; additional combinations may be absent'}. Display follows fixed contract order.`, 'coverage');
    if (!body.ideas.length) { add(container, 'p', 'No reviewed SGP suggestions have been published yet.', 'empty'); return; }
    add(container, 'p', `Statistical hit rate: ${tracking.hitRate === null ? 'Unavailable — no resolved ideas' : (100 * tracking.hitRate).toFixed(1) + '%'} · ${tracking.win} wins · ${tracking.loss} losses · ${tracking.pending} pending · ${tracking.push} pushes · ${tracking.dnp} DNP · ${tracking.unknown} unknown. Repeated legs and games are correlated; this is descriptive tracking.`, 'tracking');
    for (const idea of body.ideas) {
      const card = add(container, 'article', '', 'idea');
      add(card, 'p', `${idea.book} · research idea · ${idea.date}`, 'eyebrow');
      add(card, 'h2', idea.eventLabel);
      const list = add(card, 'ul', '');
      idea.legs.forEach(leg => add(list, 'li', `${leg.player} ${leg.market} ${leg.operator} ${leg.threshold} · ${american(leg.americanOdds)}`));
      add(card, 'p', `Observed ticket price: ${american(idea.combinedPrice.americanOdds)}`, 'ticket-price');
      const estimate = idea.estimatedCombinedPrice;
      add(card, 'p', `Estimated combined price · saved straight-price product: ${estimate.kind === 'unavailable_display_range' ? 'Unavailable — outside safe display range' : american(estimate.americanOdds) + ' American · ' + estimate.decimalOdds + ' decimal'}`, 'estimated-price');
      add(card, 'p', 'Unverified estimate. This is not a sportsbook quote, fair price, EV or probability. No SGP dependence or sportsbook repricing is modeled.');
      const metric = idea.compatibility;
      if (metric.state === 'unavailable') {
        add(card, 'p', 'Historical all-win excess: unavailable · evidence games: 0 · history vintage: unavailable · Exploratory historical game-sample 95% interval: unavailable.', 'compatibility');
      } else {
        add(card, 'p', `Historical all-win excess: ${signed(metric.value)} percentage points · evidence games: ${metric.evidenceGames} · ${metric.vintageMode === 'retrospective_revised' ? 'Retrospective revised history' : 'Strict as-of history'}.`, 'compatibility');
        add(card, 'p', metric.interval95 === null ? 'Exploratory historical game-sample 95% interval: unavailable.' : `Exploratory historical game-sample 95% interval: [${signed(metric.interval95[0])}, ${signed(metric.interval95[1])}] percentage points.`);
      }
      add(card, 'p', 'Historical compatibility is descriptive, informational only and unvalidated. It is not used for eligibility, order, probability or value claims.');
      add(card, 'p', `Captured ${et(idea.observed.startedAt)} to ${et(idea.observed.completedAt)}. Historical observation; current availability and execution are unverified.`);
      add(card, 'p', idea.observed.bookUpdatedAt === null ? 'Bookmaker update time: unknown.' : `Bookmaker update: ${et(idea.observed.bookUpdatedAt)}.`);
      add(card, 'p', 'Joint win probability and ticket EV: unavailable. Algorithm qualification: no.');
      add(card, 'p', `Tracking: ${resultFor(idea, body.resolutions)}. Statistical results do not assert sportsbook settlement.`);
      const details = add(card, 'details', '');
      add(details, 'summary', 'Review and scope');
      add(details, 'p', 'Full-game contracts as displayed. Overtime terms and jurisdiction require review when unverified. Native identities, official start, roles and availability are not inferred from a sportsbook offer.');
      add(details, 'p', 'Open reviews: ' + idea.holds.map(hold => hold.replaceAll('_', ' ')).join('; ') + '.');
    }
  }
  return Object.freeze({validate, summary, resultFor, american, et, render});
});
