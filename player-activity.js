(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PlayerActivity = factory();
})(globalThis, function() {
  "use strict";
  const INACTIVE_AFTER = 30 * 24 * 60 * 60 * 1000;
  function lastMatches(matches) {
    const dates = new Map();
    for (const match of matches) {
      const time = Date.parse(match.date);
      if (!Number.isFinite(time)) continue;
      const names = match.type === "doubles" ? [...(match.winnerNames || []), ...(match.loserNames || [])] : [match.winnerName, match.loserName];
      for (const name of names) if (typeof name === "string" && time > (dates.get(name) ?? -Infinity)) dates.set(name,time);
    }
    return dates;
  }
  function isInactive(player, dates = new Map(), now = Date.now()) {
    const times = [Date.parse(player.lastRatedAt), dates.get(player.name)].filter(Number.isFinite);
    // Creation only starts the clock for players who have never played.
    if (!times.length) {
      const created = Date.parse(player.createdAt);
      if (Number.isFinite(created)) times.push(created);
    }
    return times.length > 0 && now - Math.max(...times) > INACTIVE_AFTER;
  }
  function isArchived(player, dates, now) {
    return !!player.archived || isInactive(player, dates, now);
  }
  return {INACTIVE_AFTER, lastMatches, isInactive, isArchived};
});
