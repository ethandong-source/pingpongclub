(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RatingTracker = factory();
})(globalThis, function() {
  "use strict";
  function matchChange(match) {
    if (match.type === "doubles") {
      if (!Array.isArray(match.winnerChanges) || !Array.isArray(match.loserChanges) ||
          match.winnerChanges.length !== 2 || match.loserChanges.length !== 2 ||
          ![...match.winnerChanges, ...match.loserChanges].every(Number.isFinite)) return null;
      return match.winnerChanges.reduce((a,b) => a+b, 0) - match.loserChanges.reduce((a,b) => a+b, 0);
    }
    if (!Number.isFinite(match.winnerChange) || !Number.isFinite(match.loserChange)) return null;
    return match.winnerChange - match.loserChange;
  }
  function summarize(players, matches) {
    const active = players.filter(p => !p.archived && Number.isFinite(p.elo));
    const average = active.length ? active.reduce((sum,p) => sum+p.elo, 0) / active.length : null;
    const months = new Map();
    let excluded = 0;
    for (const match of matches) {
      const time = Date.parse(match.date), change = matchChange(match);
      if (!Number.isFinite(time) || change === null) { excluded++; continue; }
      const month = new Date(time).toISOString().slice(0,7);
      const row = months.get(month) || {month, matches:0, change:0};
      row.matches++; row.change += change; months.set(month,row);
    }
    return {average, players:active.length, months:[...months.values()].sort((a,b) => b.month.localeCompare(a.month)), excluded};
  }
  return {matchChange, summarize};
});
