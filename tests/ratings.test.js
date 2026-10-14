const test = require('node:test');
const assert = require('node:assert/strict');
const { updateRating, preview, beforeMatch, replay } = require('../ratings');
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const match = (id, winnerId, loserId, date, eloApplied = true) => ({ id, winnerId, loserId, date, eloApplied });

test('published Glicko worked example: rating 1464.106 and RD 151.399', () => {
  const next = updateRating({ elo: 1500, rd: 200 }, [
    { opponent: { elo: 1400, rd: 30 }, score: 1 },
    { opponent: { elo: 1550, rd: 100 }, score: 0 },
    { opponent: { elo: 1700, rd: 300 }, score: 0 }
  ]);
  close(next.elo, 1464.1064627569112);
  close(next.rd, 151.39890244796933);
});

test('both participants use pre-match values and unequal RD gives unequal changes', () => {
  const result = preview({ elo: 1000, rd: 50 }, { elo: 1000, rd: 350 }, '2026-01-01');
  assert.ok(result.winnerChange < result.loserChange);
  close(result.winner.elo, 1000 + result.winnerChange);
  close(result.loser.elo, 1000 - result.loserChange);
  assert.ok(result.winner.rd < 50);
  assert.ok(result.loser.rd < 350);
});

test('inactivity increases uncertainty and is capped at 350', () => {
  const player = { elo: 1000, rd: 50, lastRatedAt: '2026-01-01T00:00:00Z' };
  const active = beforeMatch(player, '2026-01-02T00:00:00Z');
  close(active.rd, Math.sqrt(2500 + 1200));
  assert.equal(beforeMatch(player, '2027-01-01').rd, 350);
  assert.throws(() => beforeMatch(player, '2025-01-01'), /precedes/);
});

test('chronological replay excludes pending, preserves accounts, and is repeatable', () => {
  const input = {
    accounts: [{ id: 'a', name: 'Account' }],
    players: [{ id: 'a', elo: 2000 }, { id: 'b', elo: 800 }],
    matches: [match(2, 'b', 'a', '2026-01-02'), match(1, 'a', 'b', '2026-01-01'), match(3, 'a', 'b', '2026-01-03', false)]
  };
  const before = JSON.stringify(input), result = replay(input);
  assert.equal(result.appliedMatches, 2);
  assert.equal(result.pendingMatches, 1);
  close(result.database.matches[1].winnerChange, 162);
  assert.ok(result.database.matches[0].winnerChange > result.database.matches[1].winnerChange);
  assert.equal(result.database.players[0].wins, 1);
  assert.equal(result.database.players[0].losses, 1);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(result.database.accounts, input.accounts);
  assert.deepEqual(replay(result.database), result);
  const voided = replay({ ...input, matches: [input.matches[0]] }).database;
  close(voided.players[1].elo, 1162);
  close(voided.matches[0].winnerChange, 162);
});

test('same-date matches sort by numeric ID; invalid history stops migration', () => {
  const input = { players: [{ id: 'a' }, { id: 'b' }], matches: [match(10, 'a', 'b', '2026-01-01'), match(2, 'b', 'a', '2026-01-01')] };
  const result = replay(input).database;
  close(result.matches[1].winnerChange, 162);
  input.matches[0].loserId = null;
  assert.throws(() => replay(input), /missing participant/);
  input.matches[0].loserId = 'b';
  input.matches[0].date = 'invalid';
  assert.throws(() => replay(input), /valid date/);
});

test('deleted participants are replayed without recreating accounts or active players', () => {
  const input = { players: [{ id: 'a' }], matches: [match(1, 'a', 'deleted', '2026-01-01'), match(2, 'deleted', 'a', '2026-01-02')] };
  const result = replay(input);
  assert.equal(result.database.players.length, 1);
  assert.equal(result.appliedMatches, 2);
  close(result.database.matches[0].winnerChange, 162);
  assert.ok(result.database.matches[1].winnerChange > 162);
});

test('each match rounds saved ratings before the next match and stores integer deltas', () => {
  const date = '2026-01-01T00:00:00Z';
  let winner = { elo: 1000, rd: 350 }, loser = { elo: 1000, rd: 350 };
  for (let i = 0; i < 20; i++) {
    const expectedWinner = Math.round(updateRating(winner, [{ opponent: loser, score: 1 }]).elo);
    const expectedLoser = Math.round(updateRating(loser, [{ opponent: winner, score: 0 }]).elo);
    const next = preview(winner, loser, date);
    assert.equal(next.winner.elo, expectedWinner);
    assert.equal(next.loser.elo, expectedLoser);
    assert.equal(next.winnerChange, expectedWinner - winner.elo);
    assert.equal(next.loserChange, loser.elo - expectedLoser);
    for (const value of [next.winner.elo, next.loser.elo, next.winnerChange, next.loserChange]) assert.ok(Number.isInteger(value));
    winner = next.loser;
    loser = next.winner;
  }
});

test('historical replay keeps all stored ratings, changes, and undo rating snapshots whole', () => {
  const input = { players: [{ id: 'a' }, { id: 'b' }], matches: Array.from({ length: 20 }, (_, i) => ({
    ...match(i + 1, i % 2 ? 'b' : 'a', i % 2 ? 'a' : 'b', '2026-01-01'), before: {}
  })) };
  const result = replay(input).database;
  for (const player of result.players) assert.ok(Number.isInteger(player.elo));
  for (const m of result.matches) {
    for (const value of [m.winnerChange, m.loserChange, m.before.winner.elo, m.before.loser.elo]) assert.ok(Number.isInteger(value));
  }
  assert.equal(result.ratingSystem.ratingRounding, 'nearest-integer-per-match');
  assert.deepEqual(replay(result).database, result);
});
