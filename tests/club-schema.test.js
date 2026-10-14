const test = require('node:test');
const assert = require('node:assert/strict');
const { prepare } = require('../scripts/club-schema');
const { encode, decode, replacement, apply, documentURL } = require('../scripts/firestore');

test('live name-based schema replays all results and rebuilds undo snapshots', () => {
  const input = { players: [{ name: 'A', elo: 900, archived: true }, { name: 'B', elo: 1100, archived: false }], matches: [
    { winnerName: 'B', loserName: 'A', date: '2026-01-02', enteredBy: 'admin', score: '11-8' },
    { winnerName: 'A', loserName: 'B', date: '2026-01-01', enteredBy: 'admin', score: '11-5' }
  ] };
  const before = JSON.stringify(input), result = prepare(input);
  assert.equal(result.schema, 'named-history');
  assert.equal(result.appliedMatches, 2);
  assert.equal(result.database.players[0].archived, true);
  assert.equal(result.database.matches[0].before.winner.elo, result.database.matches[1].before.loser.elo - result.database.matches[1].loserChange);
  assert.equal(result.database.matches[1].before.winner.elo, 1000);
  assert.equal(result.database.matches[0].score, '11-8');
  assert.equal(result.database.players[0].id, undefined);
  assert.equal(result.database.matches[0].eloApplied, undefined);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(prepare(result.database), result);
  const original = { fields: { players: encode(input.players), matches: encode(input.matches), admin: encode({ untouched: true }) } };
  const patch = replacement(original, result.database, result.schema);
  assert.deepEqual(decode(patch.fields.players), result.database.players);
  assert.deepEqual(decode(patch.fields.matches), result.database.matches);
  assert.equal(patch.fields.admin, undefined);
});

test('ambiguous name identities stop the migration', () => {
  assert.throws(() => prepare({ players: [{ name: 'A' }, { name: 'A' }], matches: [] }), /not unique/);
});

test('live schema update increments revision and preserves update-time field type', async () => {
  const input = { players: [{ name: 'A', elo: 1000 }], matches: [] };
  const original = { updateTime: '2026-01-01T00:00:00Z', fields: { players: encode(input.players), matches: encode([]), revision: encode(29), updatedAt: encode('2026-01-01T00:00:00Z') } };
  const result = prepare(input);
  await apply(documentURL('carrollpingpongclub', 'clubs/carroll-pingpong'), undefined, original, result.database, async (url, options) => {
    const fields = JSON.parse(options.body).fields;
    assert.equal(decode(fields.revision), 30);
    assert.ok(fields.updatedAt.stringValue);
    assert.ok(new URL(url).searchParams.getAll('updateMask.fieldPaths').includes('revision'));
    return { ok: true, json: async () => ({ fields }) };
  }, result.schema);
});
