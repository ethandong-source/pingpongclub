"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { fakeFirestore } = require("./mock-firestore.cjs");
const { createStore, INITIAL_DB } = require("../lib/firestore-storage");

const original = {
  version: 1, accounts: [{ id: 1, username: "alex", password: "existing-password" }],
  players: [{ id: 1, name: "Alex", elo: 1100, wins: 3, losses: 2 }],
  matches: [{ id: 50, winnerId: 1, loserId: 2, eloApplied: false, confirmations: { 1: true } }]
};
test("import preserves accounts, player IDs, ratings and pending confirmations", async () => {
  const db = fakeFirestore(); const store = createStore(db, "clubs/test");
  assert.deepEqual((await store.read()).db, INITIAL_DB);
  await store.importIfEmpty(original);
  assert.deepEqual((await store.read()).db, original);
  await assert.rejects(store.importIfEmpty(INITIAL_DB), { statusCode: 409 });
  assert.deepEqual((await store.read()).db, original);
});
test("stale saves cannot overwrite another instance's changes", async () => {
  const db = fakeFirestore(); const first = createStore(db, "clubs/test"); const second = createStore(db, "clubs/test");
  const a = await first.read(); const b = await second.read();
  a.db.players.push({ id: 1, name: "First", elo: 1000 });
  await first.write(a.db, a.revision);
  b.db.players.push({ id: 2, name: "Stale", elo: 1000 });
  await assert.rejects(second.write(b.db, b.revision), { statusCode: 409 });
  assert.deepEqual((await second.read()).db.players, a.db.players);
});
test("failed writes and malformed or oversized data do not replace saved state", async () => {
  const db = fakeFirestore(); const store = createStore(db, "clubs/test");
  await store.importIfEmpty(original);
  db.setWriteFailure(true);
  await assert.rejects(store.write(INITIAL_DB, 1), /outage/);
  assert.deepEqual((await store.read()).db, original);
  await assert.rejects(store.write({}, 1), /Invalid club database/);
  await assert.rejects(store.write({ ...INITIAL_DB, matches: [{ note: "x".repeat(910000) }] }, 1), { statusCode: 413 });
});

async function port() {
  const s = net.createServer(); s.listen(0, "127.0.0.1"); await once(s, "listening");
  const p = s.address().port; await new Promise(resolve => s.close(resolve)); return p;
}
async function workflow(base) {
  async function call(route, body) {
    const response = await fetch(base + route, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    return { status: response.status, data: await response.json() };
  }
  const status = await call("/api/status");
  assert.equal(status.data.storage, "firebase-firestore"); assert.equal(status.data.persistent, true);
  const username = `player-${Math.random()}`;
  const first = await call("/api/auth/signup", { name: "Alex", username, password: "12345" });
  assert.equal(first.status, 201);
  const secondName = `sam-${Math.random()}`;
  const second = await call("/api/auth/signup", { name: "Sam", username: secondName, password: "12345" });
  assert.equal(second.status, 201);
  assert.equal((await call("/api/auth/login", { username, password: "12345" })).status, 200);
  const winnerId = first.data.user.id, loserId = second.data.user.id;
  assert.notEqual(winnerId, loserId);
  const match = await call("/api/matches", { winnerId, loserId, reporterId: winnerId, score: "11-7" });
  assert.equal(match.status, 201); assert.equal(match.data.match.eloApplied, false);
  let data = (await call("/api/data")).data;
  assert.equal(data.players.find(p => p.id === winnerId).elo, 1000);
  const confirmed = await call(`/api/matches/${match.data.match.id}/confirm`, { userId: loserId });
  assert.equal(confirmed.status, 200); assert.equal(confirmed.data.eloApplied, true);
  data = (await call("/api/data")).data;
  assert.equal(data.players.find(p => p.id === winnerId).elo, 1016);
  assert.equal(data.players.find(p => p.id === loserId).elo, 984);
}

test("Render Node backend still supports player login and dual-confirmation matches", async t => {
  const p = await port();
  const env = { ...process.env, PORT: String(p), FIREBASE_PROJECT_ID: "demo-club", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", NODE_ENV: "test" };
  for (const name of ["RENDER", "VERCEL"]) delete env[name];
  const child = spawn(process.execPath, ["--require", path.join(__dirname, "mock-firestore.cjs"), "server.js"], { cwd: path.join(__dirname, ".."), env, stdio: "pipe" });
  let errors = ""; child.stderr.on("data", chunk => errors += chunk);
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, "exit"); } });
  const base = `http://127.0.0.1:${p}`;
  let ready = false;
  for (let i=0; i<100; i++) {
    try { await fetch(base + "/api/status"); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 25)); }
  }
  assert.ok(ready, errors);
  await workflow(base);
  assert.equal((await fetch(base + "/data/db.json")).status, 404);
});
test("Vercel API uses the same persistent storage without changing match confirmation", async t => {
  process.env.FIREBASE_PROJECT_ID = "demo-club";
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  process.env.NODE_ENV = "test";
  const handler = require("../api/index.js");
  const server = http.createServer(handler); server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  await workflow(`http://127.0.0.1:${server.address().port}`);
});
