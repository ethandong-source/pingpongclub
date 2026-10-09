"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fakeFirestore } = require("./mock-firestore.cjs");
const { createStore, INITIAL_DB } = require("../lib/firestore-storage");
const { migrateDatabase } = require("../lib/club-schema");
const original = {
  version: 1, accounts: [{ id: 1, username: "old", password: "old-password" }],
  players: [{ id: 1, accountId: 1, username: "old", name: "Alex", elo: 1120, wins: 4, losses: 2 },
    { id: 2, name: "Sam", elo: 980, wins: 1, losses: 3 }],
  matches: [{ id: 50, winnerId: 1, loserId: 2, winnerName: "Old name", loserName: "Sam", score: "11-7", eloApplied: true, confirmations: { 1: true, 2: true } },
    { id: 51, winnerId: 2, loserId: 1, eloApplied: false }]
};
const clean = migrateDatabase(original);
test("legacy native and serialized data migrate without player accounts, IDs or confirmation fields", async () => {
  for (const legacy of [{ ...original, revision: 7 }, { state: JSON.stringify(original), revision: 7 }]) {
    const db = fakeFirestore(); db.records.set("clubs/test", legacy);
    const results = await Promise.all([createStore(db, "clubs/test").read(), createStore(db, "clubs/test").read()]);
    for (const result of results) { assert.deepEqual(result.db, clean); assert.equal(result.revision, 8); }
    const saved = db.records.get("clubs/test");
    assert.equal(saved.version, 2); assert.equal(saved.players[0].elo, 1120);
    assert.equal(saved.matches[0].winnerName, "Alex"); assert.equal(saved.matches.length, 1);
    assert.doesNotMatch(JSON.stringify(saved), /"(?:accounts|id|accountId|winnerId|loserId|confirmations|eloApplied|username|password|state)":/);
  }
});
test("native field order does not trigger migration or invalidate a form revision", async () => {
  const db = fakeFirestore();
  db.records.set("clubs/test", { matches: clean.matches, revision: 3, players: clean.players, updatedAt: "old", version: 2 });
  const store = createStore(db, "clubs/test");
  assert.equal((await store.read()).revision, 3); assert.equal((await store.read()).revision, 3);
});
test("imports refuse to overwrite existing native documents even without revision metadata", async () => {
  const db = fakeFirestore(); const store = createStore(db, "clubs/test");
  assert.deepEqual((await store.read()).db, INITIAL_DB);
  await store.importIfEmpty(original); assert.deepEqual((await store.read()).db, clean);
  await assert.rejects(store.importIfEmpty(INITIAL_DB), { statusCode: 409 });
  db.records.set("clubs/test", clean);
  await assert.rejects(store.importIfEmpty(INITIAL_DB), { statusCode: 409 });
});
test("stale writes cannot overwrite another backend instance", async () => {
  const db = fakeFirestore(); const first = createStore(db, "clubs/test"); const second = createStore(db, "clubs/test");
  const a = await first.read(); const b = await second.read();
  a.db.players.push({ name: "Alex", elo: 1000, wins: 0, losses: 0, archived: false });
  await first.write(a.db, a.revision);
  await assert.rejects(second.write(b.db, b.revision), { statusCode: 409 });
  assert.deepEqual((await second.read()).db, a.db);
});
test("failed migration, invalid data and oversized writes leave the stored document intact", async () => {
  const db = fakeFirestore(); const legacy = { state: JSON.stringify(original), revision: 4 };
  db.records.set("clubs/test", legacy); db.setWriteFailure(true);
  const store = createStore(db, "clubs/test");
  await assert.rejects(store.read(), /outage/); assert.deepEqual(db.records.get("clubs/test"), legacy);
  db.setWriteFailure(false); await store.read();
  await assert.rejects(store.write({}, 5), /Invalid club database/);
  await assert.rejects(store.write({ ...clean, matches: [{ winnerName: "Alex", loserName: "Sam", score: "x".repeat(910000) }] }, 5), { statusCode: 413 });
  assert.deepEqual((await store.read()).db, clean);
});
test("ambiguous player names cannot silently merge ratings during migration", () => {
  assert.throws(() => migrateDatabase({ ...original, players: [...original.players, { ...original.players[0], name: " alex " }] }), /unique name/);
});
