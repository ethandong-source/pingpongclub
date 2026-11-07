"use strict";
const { ensureRatings, ratingSystem } = require("./glicko");
const INITIAL_DB = { version: 2, players: [], matches: [], ratingSystem: ratingSystem() };
function invalid(message) {
  const error = new Error(message); error.statusCode = 503; throw error;
}
const { normalizeName } = require("../club-actions");
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
    return { name, elo: p.elo, wins: p.wins ?? 0, losses: p.losses ?? 0, archived: !!p.archived, ...(p.rd !== undefined ? { rd: p.rd } : {}), ...(p.lastRatedAt !== undefined ? { lastRatedAt: p.lastRatedAt } : {}) };
  });
  function matchName(match, side) {
    const byId = raw.version === 1 && match[side + "Id"] !== undefined && raw.players.find(p => String(p.id) === String(match[side + "Id"]));
    const name = normalizeName(byId ? byId.name : match[side + "Name"]);
    if (!name) invalid("A stored match has no player name.");
    return players.find(p => p.name.toLowerCase() === name.toLowerCase())?.name || name;
  }
  function snapshot(p) {
    if (!p || !Number.isFinite(p.elo) || !Number.isInteger(p.wins) || !Number.isInteger(p.losses)) invalid("Invalid match rating snapshot.");
    return { elo:p.elo, wins:p.wins, losses:p.losses, ...(p.rd !== undefined ? { rd:p.rd } : {}), ...(p.lastRatedAt !== undefined ? { lastRatedAt:p.lastRatedAt } : {}) };
  }
  const matches = raw.matches.filter(m => raw.version === 2 || m.eloApplied === true).map(m => {
    if (m.type !== undefined && !["singles","doubles"].includes(m.type)) invalid("Unknown match type.");
    const base = { score:String(m.score || "Score unrecorded"), ...(m.date ? { date:String(m.date) } : {}), enteredBy:String(m.enteredBy || "legacy"), ...(m.ratingSystem ? { ratingSystem:m.ratingSystem } : {}) };
    if (m.type === "doubles") {
      const team = names => {
        if (!Array.isArray(names) || names.length !== 2 || names.some(n => !normalizeName(n))) invalid("Doubles requires two player names per team.");
        return names.map(n => players.find(p => p.name.toLowerCase() === normalizeName(n).toLowerCase())?.name || normalizeName(n));
      };
      const winnerNames=team(m.winnerNames), loserNames=team(m.loserNames);
      if (new Set([...winnerNames,...loserNames].map(n => n.toLowerCase())).size !== 4) invalid("Doubles requires four distinct players.");
      const changes = values => {
        if (!Array.isArray(values) || values.length !== 2 || !values.every(Number.isFinite)) invalid("Invalid doubles rating changes.");
        return [...values];
      };
      if (m.before && ![m.before.winners,m.before.losers].every(v => Array.isArray(v) && v.length === 2)) invalid("Invalid doubles snapshots.");
      return { ...base, type:"doubles", winnerNames, loserNames, winnerChanges:changes(m.winnerChanges), loserChanges:changes(m.loserChanges), ...(m.before ? { before:{ winners:m.before.winners.map(snapshot), losers:m.before.losers.map(snapshot) } } : {}) };
    }
    return { ...base, winnerName:matchName(m,"winner"), loserName:matchName(m,"loser"), winnerChange:Number.isFinite(m.winnerChange) ? m.winnerChange : 0, loserChange:Number.isFinite(m.loserChange) ? m.loserChange : 0, ...(m.before ? { before:{ winner:snapshot(m.before.winner), loser:snapshot(m.before.loser) } } : {}) };
  });
  let admin;
  if (raw.admin !== undefined) {
    const value = raw.admin;
    if (!value || typeof value.username !== "string" || !value.username.trim() ||
        !/^[a-f0-9]{32}$/.test(value.passwordSalt) || !/^[a-f0-9]{128}$/.test(value.passwordHash) ||
        !/^[a-f0-9]{64}$/.test(value.sessionSecret)) invalid("The Firestore admin record is invalid.");
    admin = { username: value.username, passwordSalt: value.passwordSalt, passwordHash: value.passwordHash, sessionSecret: value.sessionSecret };
  }
  try { return ensureRatings({ version: 2, players, matches, ...(raw.ratingSystem ? { ratingSystem: raw.ratingSystem } : {}), ...(admin ? { admin } : {}) }); }
  catch (error) { invalid(`Cannot initialize Glicko: ${error.message}`); }
}
module.exports = { INITIAL_DB, migrateDatabase, normalizeName };
