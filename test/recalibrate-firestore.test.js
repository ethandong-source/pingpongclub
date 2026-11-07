const test = require('node:test');
const assert = require('node:assert/strict');
const { encode, decode, replacement, apply, documentURL } = require('../scripts/firestore');
const { replay } = require('../ratings');

function fixture() {
  const database = { players: [{ id: 'a', elo: 1500 }, { id: 'b', elo: 1200 }], matches: [{ id: 1, winnerId: 'a', loserId: 'b', date: '2026-01-01', eloApplied: true }] };
  const original = { updateTime: '2026-10-13T00:00:00Z', fields: { players: encode(database.players), matches: encode(database.matches), accounts: encode([{ id: 'a' }]), title: encode('Club') } };
  original.fields.matches.arrayValue.values[0].mapValue.fields.date = { timestampValue: '2026-01-01T00:00:00Z' };
  original.fields.players.arrayValue.values[0].mapValue.fields.joined = { timestampValue: '2025-01-01T00:00:00Z' };
  return { original, replayed: replay(database).database };
}

test('Firestore conversion retains supported JSON values and rejects unsafe integers', () => {
  const value = { array: [null, true, 12, 1.5, 'text', { nested: [] }] };
  assert.deepEqual(decode(encode(value)), value);
  assert.throws(() => decode({ integerValue: '9007199254740993' }), /precision/);
});

test('migration preserves non-rating fields and timestamp types', () => {
  const { original, replayed } = fixture(), patch = replacement(original, replayed);
  assert.deepEqual(Object.keys(patch.fields).sort(), ['matches', 'players', 'ratingSystem']);
  assert.deepEqual(patch.fields.players.arrayValue.values[0].mapValue.fields.joined, { timestampValue: '2025-01-01T00:00:00Z' });
  assert.deepEqual(patch.fields.matches.arrayValue.values[0].mapValue.fields.date, { timestampValue: '2026-01-01T00:00:00Z' });
  assert.equal(decode(patch.fields.players)[0].elo, replayed.players[0].elo);
  assert.equal(decode(original.fields.players)[0].elo, 1500);
});

test('live update uses an update mask and optimistic version precondition', async () => {
  const { original, replayed } = fixture();
  const url = documentURL('carrollpingpongclub', 'clubs/carroll-pingpong');
  await apply(url, 'test-token', original, replayed, async (destination, options) => {
    const parsed = new URL(destination);
    assert.equal(parsed.searchParams.get('currentDocument.updateTime'), original.updateTime);
    assert.deepEqual(parsed.searchParams.getAll('updateMask.fieldPaths'), ['players', 'matches', 'ratingSystem']);
    assert.equal(options.method, 'PATCH');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return { ok: true, json: async () => ({ fields: JSON.parse(options.body).fields }) };
  });
  await assert.rejects(apply(url, 'test-token', original, replayed, async () => ({ ok: false, status: 409 })), /HTTP 409/);
});
