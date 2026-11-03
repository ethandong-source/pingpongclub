const { replay, settings, matchTeams } = require('../ratings');

// The live club document uses player names and an array of completed matches.
// The repository backend uses IDs and explicit confirmation flags.
function prepare(database, options = {}) {
  if (!Array.isArray(database.players) || !Array.isArray(database.matches)) throw new Error('Expected players and matches arrays.');
  if (database.players.every(p => p.id != null) && database.matches.every(m => m.id != null)) {
    return { ...replay(database, options), schema: 'id-confirmed' };
  }
  if (!database.players.every(p => p.id === undefined && typeof p.name === 'string' && p.name.trim()) || !database.matches.every(m => m.id === undefined && matchTeams(m).every(team => Array.isArray(team) && team.length === (m.type === 'doubles' ? 2 : 1) && team.every(n => typeof n === 'string')) && m.eloApplied === undefined)) {
    throw new Error('Mixed or unsupported club record schema.');
  }
  if (new Set(database.players.map(p => p.name)).size !== database.players.length) throw new Error('Player names are not unique; cannot identify historical participants.');
  const normalized = {
    ...database,
    players: database.players.map(p => ({ ...p, id: `name:${p.name}` })),
    matches: database.matches.map((m, index) => ({ ...m, id: index + 1, ...(m.type === 'doubles' ? { winnerIds:m.winnerNames.map(n => `name:${n}`), loserIds:m.loserNames.map(n => `name:${n}`) } : { winnerId:`name:${m.winnerName}`, loserId:`name:${m.loserName}` }), eloApplied: true, before: m.before || {} }))
  };
  const result = replay(normalized, options);
  result.database.players = result.database.players.map(({ id, ...p }) => p);
  result.database.matches = result.database.matches.map(({ id, winnerId, loserId, winnerIds, loserIds, eloApplied, ...m }) => m);
  return { ...result, schema: 'named-history' };
}

function ratingSystem(options = {}) {
  return { name: 'glicko-1', version: 2, ratingRounding: 'nearest-integer-per-match', ...settings(options) };
}
// Recover uncertainty from full history when an older deployment stripped RD.
// Once migrated, reads preserve saved ratings rather than replaying every request.
function ensureRatings(database) {
  const config = ratingSystem(database.ratingSystem || {});
  if (!database.matches.length) return { ...database, ratingSystem: config,
    players: database.players.map(p => ({ ...p, rd: p.rd ?? config.initialRD, lastRatedAt: p.lastRatedAt ?? null })) };
  const completeSnapshot = p => Number.isFinite(p?.rd) && p.rd > 0 && p.rd <= 350;
  const completeMatch = m => {
    const snapshots = m.type === 'doubles' ? [...(m.before?.winners || []), ...(m.before?.losers || [])] : [m.before?.winner,m.before?.loser];
    return m.ratingSystem === 'glicko-1' && snapshots.length === (m.type === 'doubles' ? 4 : 2) && snapshots.every(completeSnapshot);
  };
  const complete = database.ratingSystem?.name === 'glicko-1' && database.ratingSystem?.version === 2 &&
    database.players.every(p => completeSnapshot(p) && (p.wins + p.losses === 0 || Number.isFinite(Date.parse(p.lastRatedAt)))) &&
    database.matches.every(completeMatch);
  return complete ? { ...database, ratingSystem: config } : prepare(database, config).database;
}
module.exports = { prepare, ensureRatings, ratingSystem };
