(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./ratings"));
  else root.ClubActions = factory(root.ClubRatings);
})(globalThis, function(ratings) {
  "use strict";
  const {preview, previewDoubles, matchTeams} = ratings;
  function fail(status, message) { throw Object.assign(new Error(message), {status}); }
  function normalizeName(value) {
    return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  }
  function playerName(value) {
    const name = normalizeName(value);
    if (!name || name.length > 80) fail(400, "Player name must be 1–80 characters.");
    return name;
  }
  function snapshot(p) { return { elo: p.elo, wins: p.wins, losses: p.losses, rd: p.rd, lastRatedAt: p.lastRatedAt }; }
  function addPlayer(db, name) {
    if (db.players.some(p => p.name.toLowerCase() === name.toLowerCase())) fail(409, "A player with that name already exists.");
    if (db.matches.some(m => matchTeams(m).flat().some(n => n.toLowerCase() === name.toLowerCase()))) fail(409, "That name belongs to a player in recorded match history. Use a distinct name.");
    const player = { name, elo: db.ratingSystem.startingRating, rd: db.ratingSystem.initialRD, lastRatedAt: null, wins: 0, losses: 0, archived: false };
    db.players.push(player);
    return { success: true, player };
  }
  function updatePlayer(db, body) {
    const player = db.players.find(p => p.name === body.currentName);
    if (!player) fail(404, "Player not found.");
    if (body.name !== undefined) {
      const name = playerName(body.name);
      if (db.players.some(p => p !== player && p.name.toLowerCase() === name.toLowerCase())) fail(409, "A player with that name already exists.");
      if (name.toLowerCase() !== player.name.toLowerCase() && db.matches.some(m => matchTeams(m).flat().some(n => n.toLowerCase() === name.toLowerCase()))) fail(409, "That name belongs to a player in recorded match history. Use a distinct name.");
      for (const match of db.matches) {
        if (match.winnerName === player.name) match.winnerName = name;
        if (match.loserName === player.name) match.loserName = name;
        if (match.type === "doubles") {
          match.winnerNames = match.winnerNames.map(n => n === player.name ? name : n);
          match.loserNames = match.loserNames.map(n => n === player.name ? name : n);
        }
      }
      player.name = name;
    }
    if (body.archived !== undefined) {
      if (typeof body.archived !== "boolean") fail(400, "Archived must be true or false.");
      player.archived = body.archived;
    }
    return { success: true, player };
  }
  function deletePlayer(db, name) {
    const index = db.players.findIndex(p => p.name === name);
    if (index < 0) fail(404, "Player not found.");
    db.players.splice(index,1);
    return { success: true };
  }
  function addMatch(db, body, admin) {
    const type = body.type || "singles";
    if (!["singles","doubles"].includes(type)) fail(400,"Choose singles or doubles.");
    const names = type === "doubles" ? [body.winnerNames,body.loserNames] : [[body.winnerName],[body.loserName]];
    const size = type === "doubles" ? 2 : 1;
    if (!names.every(team => Array.isArray(team) && team.length === size && team.every(n => typeof n === "string" && n.trim()))) fail(400,`Choose ${size} player${size === 1 ? "" : "s"} per team.`);
    if (new Set(names.flat().map(n => n.toLowerCase())).size !== size*2) fail(400,"Choose different players for every position.");
    const teams = names.map(team => team.map(name => db.players.find(p => p.name === name && !p.archived)));
    if (teams.flat().some(p => !p)) fail(400,"Choose active players for every position.");
    const [[winner],[loser]] = teams;
    const ws = body.winnerScore, ls = body.loserScore;
    if (!Number.isInteger(ws) || !Number.isInteger(ls) || ls < 0 || ws > 99 || ws <= ls) fail(400, "Scores must be integers from 0–99, with the winner's score higher.");
    const date = new Date().toISOString();
    const ratingOptions = {...db.ratingSystem, winnerScore:ws, loserScore:ls};
    if (type === "doubles") {
      const [winners,losers] = teams, changes = previewDoubles(winners,losers,date,ratingOptions);
      const before = { winners:winners.map(snapshot), losers:losers.map(snapshot) };
      teams.forEach((team,side) => team.forEach((p,i) => {
        const counter = side === 0 ? "wins" : "losses";
        Object.assign(p,changes[side === 0 ? "winners" : "losers"][i],{ lastRatedAt:date, [counter]:p[counter]+1 });
      }));
      const match = { type, winnerNames:names[0], loserNames:names[1], score:`${ws}-${ls}`, date, ratingSystem:db.ratingSystem.name, winnerChanges:changes.winnerChanges, loserChanges:changes.loserChanges, enteredBy:admin.username, before };
      db.matches.push(match);
      return { success:true, match };
    }
    const changes = preview(winner, loser, date, ratingOptions);
    const before = { winner: snapshot(winner), loser: snapshot(loser) };
    Object.assign(winner, changes.winner, { lastRatedAt: date });
    Object.assign(loser, changes.loser, { lastRatedAt: date });
    winner.wins += 1;
    loser.losses += 1;
    const match = {
      winnerName: winner.name, loserName: loser.name, score: `${ws}-${ls}`,
      date, ratingSystem: db.ratingSystem.name, winnerChange: changes.winnerChange,
      loserChange: before.loser.elo - loser.elo,
      enteredBy: admin.username, before
    };
    db.matches.push(match);
    return { success: true, match };
  }
  function undoMatch(db) {
    const match = db.matches.at(-1);
    if (!match?.before) fail(409, "This legacy match has no saved prior ratings and cannot be safely undone.");
    const teams = matchTeams(match).map(team => team.map(name => db.players.find(p => p.name === name)));
    if (teams.flat().some(p => !p)) fail(409,"Match players are missing.");
    const snapshots = match.type === "doubles" ? [match.before.winners,match.before.losers] : [[match.before.winner],[match.before.loser]];
    teams.forEach((team,side) => team.forEach((p,i) => Object.assign(p,snapshots[side][i])));
    db.matches.pop();
    return { success: true };
  }
  return {normalizeName, playerName, addPlayer, updatePlayer, deletePlayer, addMatch, undoMatch};
});
