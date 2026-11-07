// Legacy Glicko-1 and the club's point-share adaptation, shared with the browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClubRatings = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULTS = Object.freeze({ startingRating: 1000, initialRD: 350, inactivityRDPerDay: Math.sqrt((350 ** 2 - 50 ** 2) / 100) });
  const Q = Math.log(10) / 400;
  const DAY = 86400000;
  const SCORE_SYSTEM = 'point-share-glicko-1';
  function settings(options = {}) {
    const config = { ...DEFAULTS, ...options };
    if (!Number.isSafeInteger(config.startingRating) || !Number.isFinite(config.initialRD) || config.initialRD <= 0 || config.initialRD > 350 || !Number.isFinite(config.inactivityRDPerDay) || config.inactivityRDPerDay < 0) throw new Error('Invalid Glicko settings; starting rating must be a whole number.');
    return config;
  }
  function validate(player) {
    if (!Number.isFinite(player.elo) || !Number.isFinite(player.rd) || player.rd <= 0 || player.rd > 350) throw new Error('Glicko requires a finite rating and RD between 0 and 350.');
  }
  function g(rd) { return 1 / Math.sqrt(1 + 3 * Q ** 2 * rd ** 2 / Math.PI ** 2); }
  function expectedScore(player, opponent) {
    validate(player); validate(opponent);
    return 1 / (1 + 10 ** (-g(opponent.rd) * (player.elo - opponent.elo) / 400));
  }
  function updateRating(player, results) {
    validate(player);
    let information = 0, performance = 0;
    for (const { opponent, score } of results) {
      if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error('Score must be between 0 and 1.');
      const expected = expectedScore(player, opponent), weight = g(opponent.rd);
      information += Q ** 2 * weight ** 2 * expected * (1 - expected);
      performance += weight * (score - expected);
    }
    const variance = 1 / (1 / player.rd ** 2 + information);
    return { elo: player.elo + Q * variance * performance, rd: Math.sqrt(variance) };
  }
  function beforeMatch(player, date, options = {}) {
    const config = settings(options), current = { elo: Math.round(player.elo), rd: player.rd ?? config.initialRD };
    validate(current);
    const time = Date.parse(date);
    if (!Number.isFinite(time)) throw new Error('Match date is invalid.');
    if (player.lastRatedAt) {
      const previous = Date.parse(player.lastRatedAt);
      if (!Number.isFinite(previous) || previous > time) throw new Error('Match precedes the last rated match. Replay history first.');
      current.rd = Math.min(350, Math.sqrt(current.rd ** 2 + config.inactivityRDPerDay ** 2 * ((time - previous) / DAY)));
    }
    return current;
  }
  // This is a club adaptation, not the official UTR algorithm. One match is one
  // observation; its actual performance is points won / total points played.
  // The usual Glicko opponent adjustment and individual RD still set sensitivity.
  function performanceScore(options) {
    if (options.name !== SCORE_SYSTEM) return 1;
    const {winnerScore:w, loserScore:l} = options;
    if (!Number.isInteger(w) || !Number.isInteger(l) || l < 0 || w > 99 || w <= l) {
      throw new Error('Enter valid winner and loser scores to preview the rating.');
    }
    return w / (w + l);
  }
  function preview(winner, loser, date, options = {}) {
    const w = beforeMatch(winner, date, options), l = beforeMatch(loser, date, options);
    const score = performanceScore(options);
    // Simultaneous updates: both players use the same pre-match ratings and RD.
    const nextWinner = updateRating(w, [{ opponent: l, score }]);
    const nextLoser = updateRating(l, [{ opponent: w, score: 1-score }]);
    // Round after each match, before these ratings feed the next update.
    nextWinner.elo = Math.round(nextWinner.elo);
    nextLoser.elo = Math.round(nextLoser.elo);
    return { winner: nextWinner, loser: nextLoser, winnerChange: nextWinner.elo - w.elo, loserChange: l.elo - nextLoser.elo };
  }
  // Club doubles adaptation: team means determine the expected outcome, while
  // each player's own RD determines how far their individual rating moves.
  function previewDoubles(winners, losers, date, options = {}) {
    if (![winners, losers].every(team => Array.isArray(team) && team.length === 2)) throw new Error('Doubles requires two players per team.');
    const teams = [winners, losers].map(team => team.map(p => beforeMatch(p, date, options)));
    const score = performanceScore(options);
    const means = teams.map(team => team.reduce((sum,p) => sum+p.elo,0)/2);
    const deviations = teams.map(team => Math.hypot(...team.map(p => p.rd))/2);
    const next = teams.map((team, side) => team.map(p => {
      const opponent = { elo: p.elo + means[1-side] - means[side], rd: deviations[1-side] };
      const rating = updateRating(p, [{ opponent, score: side === 0 ? score : 1-score }]);
      rating.elo = Math.round(rating.elo);
      return rating;
    }));
    return { winners: next[0], losers: next[1],
      winnerChanges: next[0].map((p,i) => p.elo-teams[0][i].elo),
      loserChanges: next[1].map((p,i) => teams[1][i].elo-p.elo) };
  }
  function matchTeams(match) {
    return match.type === 'doubles' ? [match.winnerNames, match.loserNames] : [[match.winnerName], [match.loserName]];
  }
  function replay(database, options = database.ratingSystem || {}) {
    if (options.name === SCORE_SYSTEM || database.ratingSystem?.name === SCORE_SYSTEM) throw new Error('Point-share ratings are forward-only. Do not replay historical matches.');
    const config = settings(options);
    if (!Array.isArray(database.players) || !Array.isArray(database.matches)) throw new Error('Database must contain players and matches arrays.');
    const result = JSON.parse(JSON.stringify(database)), players = new Map();
    for (const player of result.players) {
      if (player.id == null || players.has(String(player.id))) throw new Error('Missing or duplicate player ID.');
      Object.assign(player, { elo: config.startingRating, rd: config.initialRD, lastRatedAt: null, wins: 0, losses: 0 });
      players.set(String(player.id), player);
    }
    const ids = new Set(), official = [];
    for (const match of result.matches) {
      if (match.id == null || ids.has(String(match.id))) throw new Error('Missing or duplicate match ID.');
      ids.add(String(match.id));
      if (!match.eloApplied) continue;
      const sides = match.type === 'doubles' ? [match.winnerIds, match.loserIds] : [[match.winnerId], [match.loserId]];
      const size = match.type === 'doubles' ? 2 : 1;
      if (!sides.every(team => Array.isArray(team) && team.length === size && team.every(id => id != null && String(id) !== ''))) throw new Error(`Match ${match.id} has missing participant IDs.`);
      const time = Date.parse(match.date);
      if (!Number.isFinite(time)) throw new Error(`Match ${match.id} has no valid date.`);
      if (new Set(sides.flat().map(String)).size !== size*2) throw new Error(`Match ${match.id} has identical participants.`);
      // Deleted accounts still have identifiable historical opponents. Reconstruct
      // their rating state from the same baseline without restoring their account.
      for (const id of sides.flat()) {
        if (!players.has(String(id))) players.set(String(id), { id, elo: config.startingRating, rd: config.initialRD, lastRatedAt: null, wins: 0, losses: 0 });
      }
      official.push({ match, time });
    }
    official.sort((a, b) => a.time - b.time || String(a.match.id).localeCompare(String(b.match.id), 'en', { numeric: true }));
    for (const { match } of official) {
      if (match.type === 'doubles') {
        const winners = match.winnerIds.map(id => players.get(String(id))), losers = match.loserIds.map(id => players.get(String(id)));
        const snapshot = p => ({ elo:p.elo, rd:p.rd, lastRatedAt:p.lastRatedAt, wins:p.wins, losses:p.losses });
        match.before = { winners:winners.map(snapshot), losers:losers.map(snapshot) };
        const next = previewDoubles(winners,losers,match.date,config);
        for (const [side,team] of [winners,losers].entries()) team.forEach((p,i) => Object.assign(p, next[side === 0 ? 'winners' : 'losers'][i], { lastRatedAt:match.date, [side === 0 ? 'wins' : 'losses']:p[side === 0 ? 'wins' : 'losses']+1 }));
        match.winnerChanges=next.winnerChanges; match.loserChanges=next.loserChanges; match.ratingSystem='glicko-1';
        continue;
      }
      const winner = players.get(String(match.winnerId)), loser = players.get(String(match.loserId));
      if (match.before !== undefined) {
        const snapshot = p => ({ elo: p.elo, rd: p.rd, lastRatedAt: p.lastRatedAt, wins: p.wins, losses: p.losses });
        match.before = { ...match.before, winner: { ...match.before?.winner, ...snapshot(winner) }, loser: { ...match.before?.loser, ...snapshot(loser) } };
      }
      const next = preview(winner, loser, match.date, config);
      Object.assign(winner, next.winner, { lastRatedAt: match.date, wins: winner.wins + 1 });
      Object.assign(loser, next.loser, { lastRatedAt: match.date, losses: loser.losses + 1 });
      match.winnerChange = next.winnerChange;
      match.loserChange = next.loserChange;
      match.ratingSystem = 'glicko-1';
    }
    result.ratingSystem = { name: 'glicko-1', version: 2, ratingRounding: 'nearest-integer-per-match', startingRating: config.startingRating, initialRD: config.initialRD, inactivityRDPerDay: config.inactivityRDPerDay };
    return { database: result, appliedMatches: official.length, pendingMatches: result.matches.length - official.length };
  }
  function formatChange(delta) {
    return delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '0';
  }
  return { DEFAULTS, SCORE_SYSTEM, settings, expectedScore, updateRating, beforeMatch, preview, previewDoubles, matchTeams, replay, formatChange };
});
