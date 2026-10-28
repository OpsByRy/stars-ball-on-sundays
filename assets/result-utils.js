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
    return { ...base, actual, statisticalOutcome: base.final ? (push ? 'push' : wins ? 'win' : 'loss') : (wins && operator.startsWith('>') ? 'reached' : 'pending') };
  }
  // Preserve the original card/table contract while grading structured terms internally.
  function evaluate(prop, player) {
    const result = evaluateStructured(prop, player);
    const labels = { unavailable: 'Unavailable', dnp: 'DNP', canceled: 'Canceled', postponed: 'Postponed', win: 'Hit', loss: 'Miss', push: 'Push', reached: 'Reached', pending: 'Pending' };
    return { ...result, label: labels[result.statisticalOutcome], tone: result.statisticalOutcome === 'win' ? 'hit' : result.statisticalOutcome === 'loss' ? 'miss' : ['reached', 'pending'].includes(result.statisticalOutcome) ? 'live' : 'pending' };
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
  return { evaluate, evaluateStructured, normalizeContract, applyRevisions };
});
