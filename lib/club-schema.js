"use strict";
const INITIAL_DB = { version: 2, players: [], matches: [] };
function invalid(message) {
  const error = new Error(message); error.statusCode = 503; throw error;
}
function normalizeName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}
function migrateDatabase(raw) {
  if (!raw || ![1, 2].includes(raw.version) || !Array.isArray(raw.players) || !Array.isArray(raw.matches)) {
    invalid("Invalid club database: version, players and matches are required.");
  }
  const names = new Set();
  const players = raw.players.map(p => {
    const name = normalizeName(p.name);
    if (!name || name.length > 80 || names.has(name.toLowerCase())) invalid("Every player must have a unique name before migration.");
    names.add(name.toLowerCase());
    if (!Number.isFinite(p.elo) || !Number.isInteger(p.wins ?? 0) || !Number.isInteger(p.losses ?? 0)) invalid("Stored player ratings or records are invalid.");
    return { name, elo: p.elo, wins: p.wins ?? 0, losses: p.losses ?? 0, archived: !!p.archived };
  });
  function matchName(match, side) {
    const byId = raw.version === 1 && match[side + "Id"] !== undefined && raw.players.find(p => String(p.id) === String(match[side + "Id"]));
    const name = normalizeName(byId ? byId.name : match[side + "Name"]);
    if (!name) invalid("A stored match has no player name.");
    return players.find(p => p.name.toLowerCase() === name.toLowerCase())?.name || name;
  }
  const matches = raw.matches.filter(m => raw.version === 2 || m.eloApplied === true).map(m => ({
    winnerName: matchName(m, "winner"), loserName: matchName(m, "loser"),
    score: String(m.score || "Score unrecorded"),
    ...(m.date ? { date: String(m.date) } : {}),
    winnerChange: Number.isFinite(m.winnerChange) ? m.winnerChange : 0,
    loserChange: Number.isFinite(m.loserChange) ? m.loserChange : 0,
    enteredBy: String(m.enteredBy || "legacy"),
    ...(m.before ? { before: {
      winner: { elo: m.before.winner.elo, wins: m.before.winner.wins, losses: m.before.winner.losses },
      loser: { elo: m.before.loser.elo, wins: m.before.loser.wins, losses: m.before.loser.losses }
    } } : {})
  }));
  let admin;
  if (raw.admin !== undefined) {
    const value = raw.admin;
    if (!value || typeof value.username !== "string" || !value.username.trim() ||
        !/^[a-f0-9]{32}$/.test(value.passwordSalt) || !/^[a-f0-9]{128}$/.test(value.passwordHash) ||
        !/^[a-f0-9]{64}$/.test(value.sessionSecret)) invalid("The Firestore admin record is invalid.");
    admin = { username: value.username, passwordSalt: value.passwordSalt, passwordHash: value.passwordHash, sessionSecret: value.sessionSecret };
  }
  return { version: 2, players, matches, ...(admin ? { admin } : {}) };
}
module.exports = { INITIAL_DB, migrateDatabase, normalizeName };
