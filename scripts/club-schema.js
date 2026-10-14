const { replay } = require('../ratings');

// The live club document uses player names and an array of completed matches.
// The repository backend uses IDs and explicit confirmation flags.
function prepare(database, options = {}) {
  if (!Array.isArray(database.players) || !Array.isArray(database.matches)) throw new Error('Expected players and matches arrays.');
  if (database.players.every(p => p.id != null) && database.matches.every(m => m.id != null)) {
    return { ...replay(database, options), schema: 'id-confirmed' };
  }
  if (!database.players.every(p => p.id === undefined && typeof p.name === 'string' && p.name.trim()) || !database.matches.every(m => m.id === undefined && typeof m.winnerName === 'string' && typeof m.loserName === 'string' && m.eloApplied === undefined)) {
    throw new Error('Mixed or unsupported club record schema.');
  }
  if (new Set(database.players.map(p => p.name)).size !== database.players.length) throw new Error('Player names are not unique; cannot identify historical participants.');
  const normalized = {
    ...database,
    players: database.players.map(p => ({ ...p, id: `name:${p.name}` })),
    matches: database.matches.map((m, index) => ({ ...m, id: index + 1, winnerId: `name:${m.winnerName}`, loserId: `name:${m.loserName}`, eloApplied: true, before: m.before || {} }))
  };
  const result = replay(normalized, options);
  result.database.players = result.database.players.map(({ id, ...p }) => p);
  result.database.matches = result.database.matches.map(({ id, winnerId, loserId, eloApplied, ...m }) => m);
  return { ...result, schema: 'named-history' };
}
module.exports = { prepare };
