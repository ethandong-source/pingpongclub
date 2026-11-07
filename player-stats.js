(function(root,factory){
  if (typeof module === "object" && module.exports) module.exports = factory(require("./ratings"));
  else root.PlayerStats = factory(root.ClubRatings);
})(globalThis, function(ratings){
  "use strict";
  const {matchTeams} = ratings;
  function summarize(player, matches) {
    const history = matches.flatMap((match,index) => {
      const teams = matchTeams(match);
      const side = teams.findIndex(team => team.includes(player.name));
      if (side < 0) return [];
      const won = side === 0, slot = teams[side].indexOf(player.name), doubles = match.type === "doubles";
      const before = doubles ? (won ? match.before?.winners : match.before?.losers)?.[slot]?.elo : (won ? match.before?.winner : match.before?.loser)?.elo;
      const change = doubles ? (won ? match.winnerChanges : match.loserChanges)[slot] : (won ? match.winnerChange : match.loserChange);
      const delta = Number.isFinite(change) ? change * (won ? 1 : -1) : null;
      const parts = String(match.score ?? "—").split(/\s*[-–:]\s*/);
      return [{index, date:match.date, won, doubles, teammate:teams[side].find(n => n !== player.name), opponents:teams[1-side],
        score:!won && parts.length === 2 ? parts.reverse().join("–") : parts.join("–"), before,
        rating:Number.isFinite(before) && delta !== null ? before+delta : null, delta}];
    }).sort((a,b) => (Date.parse(a.date)||0)-(Date.parse(b.date)||0) || a.index-b.index);
    const points = history.flatMap((m,i) => m.rating === null ? [] : [{...m, number:i+1}]);
    if (Number.isFinite(history[0]?.before)) points.unshift({number:0,date:history[0].date,rating:history[0].before});
    let streak = 0, bestStreak = 0, run = 0;
    for (const m of history) {
      run = m.won ? run+1 : 0;
      bestStreak = Math.max(bestStreak,run);
      streak = m.won ? Math.max(0,streak)+1 : Math.min(0,streak)-1;
    }
    const records = [false,true].map(doubles => {
      const games = history.filter(m => m.doubles === doubles);
      const wins = games.filter(m => m.won).length;
      return {wins,losses:games.length-wins};
    });
    const bestWin = history.filter(m => m.delta !== null && m.delta > 0).reduce((best,m) => !best || m.delta > best.delta ? m : best,null);
    return {history,points,streak,bestStreak,records,bestWin,peak:Math.max(player.elo,...points.map(p => p.rating))};
  }
  return {summarize};
});
