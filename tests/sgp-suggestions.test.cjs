const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const api = require('../assets/sgp-suggestions.js');
const NOW = Date.parse('2026-11-03T00:00:00Z');

// Every identity, event, capture, and result in these fixtures is fictional.
function fixture() {
  return {schemaVersion: 'public-sgp-ideas-2', ideas: [{
    id: 'fictional-idea', kind: 'research_idea', date: '2026-11-01', book: 'FanDuel',
    bookEventId: '0009007199254740993', eventLabel: 'Fictional A @ Fictional B',
    nativeEventId: 'nba:0000000001', officialStart: '2026-11-01T20:00:00.000001Z',
    legs: [
      {player: 'Fictional One', nativePlayerId: 'nba:1', nativeTeamId: 'nba:100', market: 'AST', operator: '>', side: 'over', threshold: 3.5, americanOdds: -120, period: 'full_game', overtime: true, settlementTermsState: 'verified'},
      {player: 'Fictional Two', nativePlayerId: 'nba:2', nativeTeamId: 'nba:200', market: 'PTS', operator: '>=', side: 'over', threshold: 20, americanOdds: 140, period: 'full_game', overtime: true, settlementTermsState: 'verified'}
    ],
    observed: {captureId: 'fictional-capture', startedAt: '2026-11-01T17:28:56.735123Z', completedAt: '2026-11-01T17:28:58.384321Z', bookUpdatedAt: '2026-11-01T17:28:56.735122Z'},
    combinedPrice: {kind: 'unavailable', americanOdds: null},
    estimatedCombinedPrice: {kind: 'estimated_saved_leg_price_product', americanOdds: 340, decimalOdds: '4.4', method: 'product_of_saved_decimal_leg_prices_no_sgp_adjustment', sportsbookVerified: false},
    holds: ['quote_not_execution', 'joint_probability_unavailable', 'current_role_availability_unverified'],
    jointWinProbability: null, ticketEV: null, betReady: false, algorithmQualified: false,
    compatibility: {state: 'descriptive_only', metric: 'historical_all_win_excess_pp', value: -2.75, units: 'percentage_points', evidenceGames: 12, interval95: [-10.25, 4.5], vintageMode: 'strict_asof', selectionUse: 'informational_only', validated: false}
  }], resolutions: [], coverage: {availableIdeas: 1, displayedIdeas: 1, omittedIdeas: 0, searchComplete: true}};
}
function reject(change, message) {
  const body = fixture();
  change(body, body.ideas[0]);
  assert.throws(() => api.validate(body, NOW), message);
}
function unavailable(metric) {
  Object.assign(metric, {state: 'unavailable', value: null, evidenceGames: 0, interval95: null, vintageMode: null});
}
function odds(body, values, american, decimal) {
  const idea = body.ideas[0], template = idea.legs[0];
  idea.legs = values.map((value, i) => ({...template, player: 'Fictional Player ' + i, nativePlayerId: 'nba:' + (i + 1), americanOdds: value}));
  Object.assign(idea.estimatedCombinedPrice, {
    kind: american === null ? 'unavailable_display_range' : 'estimated_saved_leg_price_product',
    americanOdds: american, decimalOdds: decimal
  });
  return body;
}
function resolved(results = ['win', 'win']) {
  const body = fixture(), idea = body.ideas[0];
  body.resolutions.push({ideaId: idea.id, sourceRef: 'fictional-final', nativeEventId: idea.nativeEventId,
    finalAt: '2026-11-01T22:30:00.000001Z', observedAt: '2026-11-01T22:31:00.000001Z',
    identityVerified: true, eventState: 'final', finalityVerified: true,
    resultBasis: 'statistical_only_not_book_settlement', legResults: results});
  return body;
}
function empty() { return {schemaVersion: 'public-sgp-ideas-2', ideas: [], resolutions: [], coverage: {availableIdeas: 0, displayedIdeas: 0, omittedIdeas: 0, searchComplete: false}}; }

test('v2 is inactive, uses only public history, and leaves v1 publication unchanged', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../site-manifest.json')));
  assert(!manifest.files.includes('assets/sgp-suggestions.js'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/sgp-ideas.json'))), {schemaVersion: 'public-sgp-ideas-1', ideas: [], resolutions: []});
  for (const name of ['../assets/sgp-ideas-page.js', '../research/sgp/index.html']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, name), 'utf8'), /sgp-suggestions|SBOSSgpSuggestions/);
  }
  const js = fs.readFileSync(path.join(__dirname, '../assets/sgp-suggestions.js'), 'utf8');
  assert.doesNotMatch(js, /fetch\(|require\(|import\s|innerHTML|eval\(/);
  const original = {unchanged: true}, context = {SBOSSgpIdeas: original};
  vm.runInNewContext(js, context);
  assert.equal(context.SBOSSgpIdeas, original);
  assert.equal(typeof context.SBOSSgpSuggestions.validate, 'function');
});
test('valid v2 input is returned intact without reordering or mutation', () => {
  const body = fixture(), before = structuredClone(body);
  assert.equal(api.validate(body, NOW), body);
  assert.deepEqual(body, before);
  assert.equal(body.ideas[0].bookEventId, '0009007199254740993');
  assert.equal(body.ideas[0].legs[1].operator, '>=');
  api.validate(empty(), NOW);
});
test('v1 and v2 reject each other rather than changing v1 behavior', () => {
  const v1 = require('../assets/sgp-ideas.js');
  assert.throws(() => v1.validate(fixture(), NOW));
  assert.throws(() => api.validate({schemaVersion: 'public-sgp-ideas-1', ideas: [], resolutions: []}, NOW));
});

for (const [name, target] of [
  ['root', b => b], ['idea', b => b.ideas[0]], ['coverage', b => b.coverage],
  ['leg', b => b.ideas[0].legs[0]], ['observed', b => b.ideas[0].observed],
  ['combined price', b => b.ideas[0].combinedPrice], ['estimate', b => b.ideas[0].estimatedCombinedPrice],
  ['compatibility', b => b.ideas[0].compatibility]
]) test('exact allowlist rejects private fields at ' + name, () => {
  for (const key of ['sourceRows', 'legAudit', 'originalSelections', 'retainedExposure', 'model', 'features', 'history', 'weights', 'rawPath', 'receiptHash', 'reason', 'sourcePoolComplete']) {
    reject(body => { target(body)[key] = 'private'; });
  }
  reject(body => { target(body)[Symbol('private')] = 'private'; });
  reject(body => { Object.setPrototypeOf(target(body), {private: true}); });
  reject(body => { delete target(body)[Object.keys(target(body))[0]]; });
});
test('resolution fields and nested result arrays also reject private extras', () => {
  for (const mutate of [b => { b.resolutions[0].sourceRows = []; }, b => { b.resolutions[0].legResults.rawPath = 'private'; }]) {
    const body = resolved(); mutate(body); assert.throws(() => api.validate(body, NOW));
  }
});
test('arrays reject holes, extra fields, oversized payloads, and duplicate ideas', () => {
  for (const key of ['ideas', 'resolutions']) reject(body => { body[key].private = true; });
  reject((b, a) => { delete a.legs[0]; });
  reject((b, a) => { a.holds.private = true; });
  reject((b, a) => { a.compatibility.interval95.private = true; });
  reject(b => { b.ideas = Array(65).fill(b.ideas[0]); b.coverage.displayedIdeas = b.coverage.availableIdeas = 65; });
  reject(b => { b.resolutions = Array(65).fill({}); });
  reject(b => { b.ideas.push(structuredClone(b.ideas[0])); b.coverage.displayedIdeas = b.coverage.availableIdeas = 2; });
  reject((b, a) => { a.legs = a.legs.slice(0, 1); });
  reject((b, a) => { a.legs = Array(7).fill(a.legs[0]); });
});
test('coverage bounds and arithmetic are exact; search completeness is explicit', () => {
  for (const [key, value] of [['availableIdeas', 2], ['displayedIdeas', 0], ['omittedIdeas', -1], ['omittedIdeas', 0.5], ['availableIdeas', 257], ['searchComplete', 1]]) {
    reject(b => { b.coverage[key] = value; });
  }
  const body = fixture(); Object.assign(body.coverage, {availableIdeas: 256, omittedIdeas: 255, searchComplete: false});
  api.validate(body, NOW);
});
test('literal book identity and opaque public references never coerce', () => {
  for (const value of [123, JSON.parse('9007199254740993'), new String('123'), 'uuid-event', '1'.repeat(25), '', '１２３']) reject((b, a) => { a.bookEventId = value; });
  for (const value of ['draftkings', 'OtherBook']) reject((b, a) => { a.book = value; });
  for (const value of [1, new String('opaque'), '../receipt', 'sha256:private', 'a'.repeat(101)]) {
    reject((b, a) => { a.id = value; }); reject((b, a) => { a.observed.captureId = value; });
  }
  reject((b, a) => { a.kind = 'qualified_bet'; });
});
test('native event and leg IDs use distinct exact namespaces', () => {
  for (const value of ['0000000001', 'nba:1', 'nba:12345678901', 1, 'provider-uuid']) reject((b, a) => { a.nativeEventId = value; });
  for (const value of ['player:1', 'nba:', 1, new String('nba:1')]) for (const key of ['nativePlayerId', 'nativeTeamId']) reject((b, a) => { a.legs[0][key] = value; });
});
test('market requires a primitive string before any component-key conversion', () => {
  for (const market of [JSON.parse('["AST"]'), JSON.parse('[[["AST"]]]'),
    Object.assign(['AST'], {sourceRows: [{privateReceipt: 'FICTIONAL_PRIVATE_SENTINEL'}]}),
    Object.assign(new String('AST'), {privateReceipt: 'FICTIONAL_PRIVATE_SENTINEL'}),
    Object.defineProperty(['AST'], 'sourceRows', {value: ['FICTIONAL_PRIVATE_SENTINEL']})]) {
    reject((b, a) => { a.legs[0].market = market; });
  }
  let conversions = 0;
  for (const market of [
    {toString() { conversions++; return 'AST'; }},
    {valueOf() { conversions++; return 'AST'; }},
    {[Symbol.toPrimitive]() { conversions++; return 'AST'; }}
  ]) reject((b, a) => { a.legs[0].market = market; });
  assert.equal(conversions, 0, 'Malformed market objects must reject without invoking conversion hooks');
});
test('every string enum rejects nested arrays, boxed strings and coercible metadata objects', () => {
  const fields = [
    [b => b, 'schemaVersion'], [b => b.ideas[0], 'kind'], [b => b.ideas[0], 'book'],
    ...['market', 'operator', 'side', 'period', 'settlementTermsState'].map(key => [b => b.ideas[0].legs[0], key]),
    [b => b.ideas[0].combinedPrice, 'kind'], [b => b.ideas[0].estimatedCombinedPrice, 'kind'],
    [b => b.ideas[0].estimatedCombinedPrice, 'method'],
    ...['state', 'metric', 'units', 'vintageMode', 'selectionUse'].map(key => [b => b.ideas[0].compatibility, key]),
    [b => b.ideas[0].holds, 0], [b => b.resolutions[0], 'eventState'],
    [b => b.resolutions[0], 'resultBasis'], [b => b.resolutions[0].legResults, 0]
  ];
  for (const [locate, key] of fields) for (const wrap of [
    value => [[[value]]], value => Object.assign(new String(value), {sourceRows: ['FICTIONAL_PRIVATE_SENTINEL']}),
    value => ({privateReceipt: 'FICTIONAL_PRIVATE_SENTINEL', toString() { return value; }})
  ]) {
    const body = resolved(), target = locate(body);
    target[key] = wrap(target[key]);
    assert.throws(() => api.validate(body, NOW));
  }
});
test('boolean contract states reject boxed booleans and coercible containers', () => {
  const fields = [
    [b => b.coverage, 'searchComplete'], [b => b.ideas[0], 'betReady'], [b => b.ideas[0], 'algorithmQualified'],
    [b => b.ideas[0].legs[0], 'overtime'], [b => b.ideas[0].estimatedCombinedPrice, 'sportsbookVerified'],
    [b => b.ideas[0].compatibility, 'validated'], [b => b.resolutions[0], 'identityVerified'],
    [b => b.resolutions[0], 'finalityVerified']
  ];
  for (const [locate, key] of fields) for (const wrap of [value => [value], value => new Boolean(value), value => ({valueOf() { return value; }})]) {
    const body = resolved(), target = locate(body);
    target[key] = wrap(target[key]);
    assert.throws(() => api.validate(body, NOW));
  }
});
test('nullable v1 identity/start/terms states need the original holds', () => {
  const body = fixture(), a = body.ideas[0];
  a.nativeEventId = a.officialStart = null;
  a.legs.forEach(l => { l.nativePlayerId = l.nativeTeamId = l.overtime = null; l.settlementTermsState = 'unverified'; });
  a.holds.push('native_identity_unverified', 'official_start_unverified', 'terms_jurisdiction_unverified');
  api.validate(body, NOW);
  for (const hold of a.holds) {
    const copy = structuredClone(body); copy.ideas[0].holds = copy.ideas[0].holds.filter(x => x !== hold);
    assert.throws(() => api.validate(copy, NOW));
  }
  reject((b, a) => { a.holds.push('private_eligibility_reason'); });
  reject((b, a) => { a.holds.push(a.holds[0]); });
});
test('same-player stat/combo overlaps and points/3PM combinations always reject', () => {
  const components = {PTS: ['PTS'], REB: ['REB'], AST: ['AST'], '3PM': ['3PM'], PRA: ['PTS', 'REB', 'AST'], PR: ['PTS', 'REB'], PA: ['PTS', 'AST'], RA: ['REB', 'AST']};
  for (const x of Object.keys(components)) for (const y of Object.keys(components)) {
    if (!components[x].some(c => components[y].includes(c)) && !([x, y].includes('3PM') && [x, y].some(m => components[m].includes('PTS')))) continue;
    reject((b, a) => { a.legs[1].player = a.legs[0].player; a.legs[1].nativePlayerId = a.legs[0].nativePlayerId; a.legs[1].nativeTeamId = a.legs[0].nativeTeamId; a.legs[0].market = x; a.legs[1].market = y; });
  }
});
test('nonoverlapping same-player stats remain descriptive ideas', () => {
  const body = fixture(), a = body.ideas[0];
  Object.assign(a.legs[1], {player: a.legs[0].player, nativePlayerId: a.legs[0].nativePlayerId, nativeTeamId: a.legs[0].nativeTeamId});
  api.validate(body, NOW);
});
test('normalized labels, alias IDs, conflicting IDs/teams, and duplicates fail closed', () => {
  reject((b, a) => { a.legs[1].player = '  Ｆｉｃｔｉｏｎａｌ   Ｏｎｅ '; });
  reject((b, a) => { a.legs[1].nativePlayerId = a.legs[0].nativePlayerId; });
  reject((b, a) => { a.legs[1].nativePlayerId = a.legs[0].nativePlayerId; a.legs[1].nativeTeamId = a.legs[0].nativeTeamId; a.legs[1].market = 'PA'; });
  reject((b, a) => { a.legs[1] = structuredClone(a.legs[0]); });
  reject((b, a) => { a.legs[1] = {...a.legs[0], nativePlayerId: null}; a.holds.push('native_identity_unverified'); });
});
test('impossible counting under zero, unknown stats, contradictory side and mixed scope reject', () => {
  for (const patch of [
    {operator: '<', side: 'under', threshold: 0}, {threshold: -1}, {threshold: 1001}, {threshold: NaN},
    {threshold: Infinity}, {threshold: '3.5'}, {side: 'under'}, {operator: '='}, {market: 'BLK'},
    {period: 'first_half'}, {overtime: false}, {overtime: null}, {settlementTermsState: 'inferred'}, {player: '   '}
  ]) reject((b, a) => { Object.assign(a.legs[1], patch); });
  const body = fixture(); Object.assign(body.ideas[0].legs[1], {operator: '<=', side: 'under', threshold: 0});
  api.validate(body, NOW);
});
test('no probabilities, EV, qualification, units or P&L can enter the contract', () => {
  for (const key of ['jointWinProbability', 'ticketEV', 'betReady', 'algorithmQualified']) reject((b, a) => { a[key] = 1; });
  for (const key of ['units', 'pnl', 'profit', 'stake', 'probability']) reject((b, a) => { a[key] = 1; });
});

test('saved-price products include exact signed conversion and half-away-from-zero rounding', () => {
  for (const [values, american, decimal] of [
    [[-120, 140], 340, '4.4'], [[-200, -300], 100, '2'], [[150, 125], 463, '5.625'],
    [[-134, -702], -101, '1.99502487562189055'], [[-400, -400], -178, '1.5625'],
    [[-1000000, -1000000], -499975, '1.00020001'],
    [[1000000, 1000000, 1000000], 100030003000000, '1.000300030001e12']
  ]) api.validate(odds(fixture(), values, american, decimal), NOW);
  assert.throws(() => api.validate(odds(fixture(), [150, 125], 462, '5.625'), NOW));
  assert.throws(() => api.validate(odds(fixture(), [-134, -702], -100, '1.99502487562189055'), NOW));
});
test('overflow is explicitly unavailable, and available products cannot hide behind that state', () => {
  for (const length of [4, 6]) api.validate(odds(fixture(), Array(length).fill(1000000), null, null), NOW);
  assert.throws(() => api.validate(odds(fixture(), [-120, 140], null, null), NOW));
  const overflow = odds(fixture(), Array(6).fill(1000000), null, null);
  Object.assign(overflow.ideas[0].estimatedCombinedPrice, {kind: 'estimated_saved_leg_price_product', americanOdds: Number.MAX_SAFE_INTEGER, decimalOdds: '1.00060015002000150e24'});
  assert.throws(() => api.validate(overflow, NOW));
  overflow.ideas[0].estimatedCombinedPrice.kind = 'unavailable_display_range';
  assert.throws(() => api.validate(overflow, NOW));
});
test('estimate method, verification state and exact American value cannot be tampered with', () => {
  for (const patch of [
    {kind: 'observed_sportsbook_quote'}, {kind: 'unavailable'}, {americanOdds: 341}, {americanOdds: 340.1},
    {americanOdds: '340'}, {americanOdds: 0}, {americanOdds: 99}, {americanOdds: Number.MAX_SAFE_INTEGER + 1},
    {decimalOdds: '4.41'}, {decimalOdds: null}, {method: 'fair_price'}, {sportsbookVerified: true}
  ]) reject((b, a) => { Object.assign(a.estimatedCombinedPrice, patch); });
});
test('decimal strings allow exponents and 18 significant digits, and reject ambiguity or excess precision', () => {
  for (const decimal of ['4.4', '4.40000000000000000', '44e-1', '0.44E+1', '+4.4', '0004.4']) {
    const body = fixture(); body.ideas[0].estimatedCombinedPrice.decimalOdds = decimal; api.validate(body, NOW);
  }
  for (const decimal of [4.4, '4.400000000000000000', 'Infinity', 'NaN', '0x4', ' 4.4 ', '4_4', '1', '-4.4', '0', '1e9999', '4.40000000001']) reject((b, a) => { a.estimatedCombinedPrice.decimalOdds = decimal; });
});
test('actual observed quote remains separate from the estimate and keeps v1 range', () => {
  const body = fixture(); body.ideas[0].combinedPrice = {kind: 'observed_sportsbook_quote', americanOdds: 211};
  api.validate(body, NOW);
  assert.equal(body.ideas[0].estimatedCombinedPrice.americanOdds, 340);
  for (const patch of [{kind: 'estimated_saved_leg_price_product', americanOdds: 340}, {kind: 'unavailable', americanOdds: 340}, {kind: 'observed_sportsbook_quote', americanOdds: 1000001}]) reject((b, a) => { a.combinedPrice = patch; });
  for (const value of [99, 0, 1000001, 100.5, '140']) reject((b, a) => { a.legs[0].americanOdds = value; });
});

test('historical summary admits signed endpoints, explicit vintage and unavailable history', () => {
  for (const value of [-100, 0, 100]) for (const vintageMode of ['strict_asof', 'retrospective_revised']) {
    const body = fixture(); Object.assign(body.ideas[0].compatibility, {value, interval95: [-100, 100], evidenceGames: 256, vintageMode}); api.validate(body, NOW);
  }
  const body = fixture(); unavailable(body.ideas[0].compatibility); api.validate(body, NOW);
  Object.assign(body.ideas[0].compatibility, {state: 'descriptive_only', value: -1, evidenceGames: 1, vintageMode: 'strict_asof'}); api.validate(body, NOW);
});
test('historical summary rejects score bands, probability/value implications and invalid intervals', () => {
  for (const patch of [
    {state: 'high'}, {metric: 'joint_win_probability'}, {units: 'probability'}, {value: NaN}, {value: Infinity},
    {value: -100.01}, {value: 100.01}, {value: '2'}, {evidenceGames: 0}, {evidenceGames: 257},
    {evidenceGames: 10.5}, {evidenceGames: 9}, {interval95: [5, -5]}, {interval95: [-101, 0]},
    {interval95: [0, 101]}, {interval95: [NaN, 1]}, {interval95: [1]}, {interval95: [0, 1, 2]},
    {vintageMode: null}, {vintageMode: 'live'}, {selectionUse: 'ranking'}, {validated: true}
  ]) reject((b, a) => { Object.assign(a.compatibility, patch); });
  for (const patch of [{value: 0}, {evidenceGames: 1}, {interval95: [0, 1]}, {vintageMode: 'strict_asof'}]) reject((b, a) => { unavailable(a.compatibility); Object.assign(a.compatibility, patch); });
});

test('microsecond chronology accepts exact order and retains the literal fractions', () => {
  const body = fixture(), a = body.ideas[0];
  Object.assign(a.observed, {startedAt: '2026-11-01T19:59:59.999998Z', completedAt: '2026-11-01T20:00:00.000000Z', bookUpdatedAt: '2026-11-01T19:59:59.999997Z'});
  api.validate(body, NOW);
  assert.equal(a.observed.completedAt, '2026-11-01T20:00:00.000000Z');
  for (let digits = 1; digits <= 6; digits++) {
    const copy = fixture(); copy.ideas[0].observed.completedAt = '2026-11-01T17:28:58.' + '1'.repeat(digits) + 'Z'; api.validate(copy, NOW);
  }
  a.observed.bookUpdatedAt = a.observed.startedAt;
  api.validate(body, NOW);
});
test('one-microsecond capture/provider/pregame inversions reject', () => {
  reject((b, a) => { a.observed.completedAt = '2026-11-01T17:28:56.735122Z'; });
  reject((b, a) => { a.observed.bookUpdatedAt = '2026-11-01T17:28:56.735124Z'; });
  reject((b, a) => { a.officialStart = '2026-11-01T17:28:58.384320Z'; });
  reject((b, a) => { a.officialStart = a.observed.completedAt; });
  const body = fixture(); body.ideas[0].observed.completedAt = '2026-11-01T17:28:58.384001Z';
  assert.throws(() => api.validate(body, Date.parse('2026-11-01T17:28:58.384Z')));
});
test('actual UTC calendars, clock precision and millisecond now are required', () => {
  for (const value of ['2026-02-30T17:28:58Z', '2026-13-01T17:28:58Z', '2026-11-01T24:00:00Z', '2026-11-01T17:28:60Z', '2026-11-01T17:28:58', '2026-11-01T17:28:58+00:00', '2026-11-01T17:28:58.1234567Z', '2026-11-01T17:28:58.Z']) reject((b, a) => { a.observed.completedAt = value; });
  reject((b, a) => { a.date = '2026-02-30'; });
  for (const value of [NaN, Infinity, '2026-11-03', NOW + 0.5]) assert.throws(() => api.validate(fixture(), value));
  const body = fixture(); body.ideas[0].observed.completedAt = '2026-11-01T17:28:58.384Z';
  api.validate(body, Date.parse('2026-11-01T17:28:58.384Z'));
});
test('official slate dates use ET across UTC midnight and the DST transition', () => {
  const body = fixture(); body.ideas[0].officialStart = '2026-11-02T00:00:00.000001Z'; api.validate(body, NOW);
  reject((b, a) => { a.officialStart = '2026-11-02T05:00:00Z'; });
  assert.match(api.et('2026-11-01T17:28:58.384321Z'), /12:28:58 PM EST/);
  assert.match(api.et('2026-10-31T17:28:58.384321Z'), /1:28:58 PM EDT/);
});

test('statistical tracking preserves pending/push/DNP/unknown outside the win-loss denominator', () => {
  assert.equal(api.summary(fixture(), NOW).hitRate, null);
  assert.equal(api.summary(fixture(), NOW).pending, 1);
  assert.equal(api.summary(resolved(), NOW).hitRate, 1);
  assert.equal(api.summary(resolved(['win', 'loss']), NOW).hitRate, 0);
  assert.equal(api.summary(resolved(['loss', 'push']), NOW).loss, 1);
  for (const result of ['push', 'dnp', 'unknown']) {
    const summary = api.summary(resolved(['win', result]), NOW);
    assert.equal(summary[result], 1); assert.equal(summary.hitRate, null);
  }
});
test('results require exact native bindings, complete statistical results and explicit finality', () => {
  for (const change of [
    b => { b.resolutions[0].nativeEventId = 'nba:0000000002'; }, b => { b.resolutions[0].identityVerified = false; },
    b => { b.resolutions[0].finalityVerified = false; }, b => { b.resolutions[0].eventState = 'live'; },
    b => { b.resolutions[0].resultBasis = 'book_settlement'; }, b => { b.resolutions[0].legResults = ['win']; },
    b => { b.resolutions[0].legResults = ['win', 'void']; }, b => { b.resolutions[0].ideaId = 'missing'; },
    b => { b.resolutions[0].sourceRef = '../source'; }, b => { b.resolutions.push(structuredClone(b.resolutions[0])); },
    b => { b.ideas[0].nativeEventId = null; b.ideas[0].holds.push('native_identity_unverified'); },
    b => { b.ideas[0].legs[0].nativeTeamId = null; b.ideas[0].holds.push('native_identity_unverified'); },
    b => { b.ideas[0].officialStart = null; b.ideas[0].holds.push('official_start_unverified'); }
  ]) { const body = resolved(); change(body); assert.throws(() => api.validate(body, NOW)); }
});
test('final resolutions preserve exact microsecond ordering and reject future observations', () => {
  const body = resolved(), r = body.resolutions[0];
  r.finalAt = '2026-11-01T20:00:00.000002Z'; r.observedAt = r.finalAt; api.validate(body, NOW);
  r.finalAt = '2026-11-01T20:00:00.000001Z'; assert.throws(() => api.validate(body, NOW));
  r.finalAt = '2026-11-01T22:30:00.000002Z'; r.observedAt = '2026-11-01T22:30:00.000001Z'; assert.throws(() => api.validate(body, NOW));
  r.observedAt = r.finalAt; assert.throws(() => api.validate(body, Date.parse('2026-11-01T22:30:00.000Z')));
});

// A minimal text-only DOM makes accidental HTML parsing or attribute interpolation fail.
class TextNode {
  constructor(tag) { this.tag = tag; this.children = []; this._text = ''; this.className = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set innerHTML(_) { throw new Error('HTML parsing is forbidden'); }
  append(node) { assert(node instanceof TextNode); this.children.push(node); }
  replaceChildren() { this.children = []; this._text = ''; }
}
function view(body) {
  const container = new TextNode('main');
  api.render(body, {createElement: tag => new TextNode(tag)}, container, NOW);
  return container;
}
function escaped(node) {
  const text = node._text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  return '<' + node.tag + '>' + text + node.children.map(escaped).join('') + '</' + node.tag + '>';
}
test('rendering persistently separates actual and estimated prices with the required explanation', () => {
  const body = fixture(); body.ideas[0].combinedPrice = {kind: 'observed_sportsbook_quote', americanOdds: 211};
  const text = view(body).textContent;
  assert.match(text, /Observed ticket price: \+211/);
  assert.match(text, /Estimated combined price · saved straight-price product: \+340 American · 4.4 decimal/);
  assert.match(text, /not a sportsbook quote, fair price, EV or probability/);
  assert.match(text, /No SGP dependence or sportsbook repricing is modeled/);
  assert.match(view(odds(fixture(), Array(6).fill(1000000), null, null)).textContent, /Estimated combined price · saved straight-price product: Unavailable — outside safe display range/);
});
test('rendering shows signed history, sample, interval and plainly labeled revised vintage', () => {
  const body = fixture(), metric = body.ideas[0].compatibility;
  let text = view(body).textContent;
  assert.match(text, /Historical all-win excess: -2.75 percentage points · evidence games: 12 · Strict as-of history/);
  assert.match(text, /95% interval: \[-10.25, \+4.5\] percentage points/);
  assert.match(text, /Exploratory historical game-sample 95% interval/);
  assert.match(text, /descriptive, informational only and unvalidated/);
  Object.assign(metric, {value: 7, vintageMode: 'retrospective_revised', interval95: null});
  text = view(body).textContent;
  assert.match(text, /excess: \+7 percentage points/); assert.match(text, /Retrospective revised history/); assert.match(text, /95% interval: unavailable/);
  unavailable(metric); assert.match(view(body).textContent, /excess: unavailable · evidence games: 0 · history vintage: unavailable/);
});
test('coverage and cards follow fixed input order independently of compatibility', () => {
  const body = fixture(), second = structuredClone(body.ideas[0]);
  second.id = 'fictional-second'; second.eventLabel = 'Fictional Second'; second.compatibility.value = 100;
  body.ideas.push(second); Object.assign(body.coverage, {availableIdeas: 4, displayedIdeas: 2, omittedIdeas: 2, searchComplete: false});
  const before = structuredClone(body), rendered = view(body), cards = rendered.children.filter(n => n.tag === 'article');
  assert.match(rendered.textContent, /Supplied-pool coverage: 4 available · 2 displayed · 2 omitted. Search incomplete; additional combinations may be absent/);
  assert.deepEqual(cards.map(n => n.children.find(c => c.tag === 'h2').textContent), ['Fictional A @ Fictional B', 'Fictional Second']);
  assert.deepEqual(body, before);
  assert.match(view(empty()).textContent, /No reviewed SGP suggestions have been published yet/);
});
test('text-only rendering escapes quotes, ampersands and the literal under operator', () => {
  const body = fixture(); body.ideas[0].eventLabel = 'Fictional "A" & B';
  Object.assign(body.ideas[0].legs[0], {player: "Fictional 'One' & Co", operator: '<', side: 'under'});
  const rendered = view(body), html = escaped(rendered);
  assert.match(rendered.textContent, /Fictional "A" & B/);
  assert.match(html, /Fictional &quot;A&quot; &amp; B/);
  assert.match(html, /Fictional &#39;One&#39; &amp; Co AST &lt; 3.5/);
  for (const value of ['<script>alert(1)</script>', 'A\u0000B', 'A\nB']) {
    reject((b, a) => { a.eventLabel = value; }); reject((b, a) => { a.legs[0].player = value; });
  }
});
test('invalid input rejects before replacing an existing rendered view', () => {
  const container = new TextNode('main'); container.textContent = 'Existing view';
  const body = fixture(); body.ideas[0].sourceRows = [];
  assert.throws(() => api.render(body, {createElement: tag => new TextNode(tag)}, container, NOW));
  assert.equal(container.textContent, 'Existing view');
});
