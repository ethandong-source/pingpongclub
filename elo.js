"use strict";
(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClubElo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  function ratingChange(winnerElo, loserElo, winnerScore, loserScore) {
    if (![winnerElo, loserElo].every(Number.isFinite) || ![winnerScore, loserScore].every(Number.isInteger) || winnerScore <= loserScore || loserScore < 0 || winnerScore > 99) throw new RangeError("Enter a valid winning score.");
    const expected = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
    const margin = 0.5 + 0.5 * (winnerScore - loserScore) / winnerScore;
    return Math.max(1, Math.round(32 * (1 - expected) * margin));
  }
  return { ratingChange };
});
