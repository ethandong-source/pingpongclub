"use strict";
(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClubElo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  function kFactor(player) {
    const games = player.wins + player.losses;
    return games < 10 ? 30 : games < 30 ? 20 : 16;
  }
  function ratingChanges(winner, loser, winnerScore, loserScore) {
    for (const player of [winner,loser]) {
      if (!player || !Number.isFinite(player.elo) || player.elo < 100 || ![player.wins,player.losses].every(n => Number.isSafeInteger(n) && n >= 0)) throw new RangeError("Invalid player rating or record.");
    }
    if (![winnerScore,loserScore].every(Number.isInteger) || winnerScore <= loserScore || loserScore < 0 || winnerScore > 99) throw new RangeError("Enter a valid winning score.");
    const expected = 1 / (1 + Math.pow(10, (loser.elo - winner.elo) / 400));
    const margin = 0.5 + 0.5 * (winnerScore - loserScore) / winnerScore;
    const change = player => Math.min(30,Math.max(0,Math.round(kFactor(player) * (1 - expected) * margin)));
    return { winnerChange: change(winner), loserChange: Math.min(change(loser),loser.elo - 100) };
  }
  return { ratingChanges, kFactor };
});
