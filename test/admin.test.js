"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const vm = require("node:vm");
require("./mock-firestore.cjs");
const settings = { FIREBASE_PROJECT_ID: "demo-club", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", NODE_ENV: "test", ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "test-password-at-least-12", SESSION_SECRET: "test-secret-at-least-32-characters-long" };
async function workflow(base) {
  let cookie = "";
  async function request(route, method = "GET", body, auth = true, headers = {}) {
    const res = await fetch(base + route, { method,
      headers: { ...(method !== "GET" ? { "Content-Type": "application/json" } : {}), ...(auth ? { Cookie: cookie } : {}), ...headers },
      ...(method !== "GET" ? { body: JSON.stringify(body || {}) } : {}) });
    return { status: res.status, data: await res.json(), res };
  }
  assert.equal((await request("/api/players", "POST", { name: "Alex" }, false)).status, 401);
  assert.equal((await request("/api/matches", "POST", {}, false)).status, 401);
  assert.equal((await request("/api/backup", "GET", null, false)).status, 401);
  for (const route of ["/api/auth/signup", "/api/auth/login", "/api/sync", "/api/reset", "/api/matches/1/confirm"]) {
    assert.equal((await request(route, "POST", {})).status, 404);
  }
  assert.equal((await request("/api/admin/session", "GET", null, false, { Cookie: "club_admin=forged.signature" })).data.admin, null);
  assert.equal((await request("/api/admin/login", "POST", { username: "admin", password: "wrong" })).status, 401);
  const login = await request("/api/admin/login", "POST", { username: "admin", password: settings.ADMIN_PASSWORD });
  assert.equal(login.status, 200); cookie = login.res.headers.get("set-cookie").split(";")[0];
  assert.match(login.res.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  assert.equal((await request("/api/admin/session")).data.admin.username, "admin");
  assert.equal((await request("/api/players", "POST", { name: "Blocked" }, true, { Origin: "https://attacker.example" })).status, 403);
  for (const name of ["Alex", "Sam"]) assert.equal((await request("/api/players", "POST", { name })).status, 201);
  assert.equal((await request("/api/players", "POST", { name: " alex " })).status, 409);
  let data = (await request("/api/data")).data;
  assert.equal(data.players[0].elo, 1000);
  const match = { winnerName: "Alex", loserName: "Sam", winnerScore: 11, loserScore: 7, revision: data.revision };
  assert.equal((await request("/api/matches", "POST", { ...match, loserName: "Alex" })).status, 400);
  assert.equal((await request("/api/matches", "POST", { ...match, winnerScore: 2 })).status, 400);
  const simultaneous = await Promise.all([request("/api/matches", "POST", match), request("/api/matches", "POST", match)]);
  assert.deepEqual(simultaneous.map(r => r.status).sort(), [201, 409]);
  data = (await request("/api/data")).data;
  assert.equal(data.matches.length, 1); assert.equal(data.players[0].elo, 1016); assert.equal(data.players[1].elo, 984);
  assert.equal(data.players[0].wins, 1); assert.equal(data.players[1].losses, 1);
  assert.equal((await request("/api/matches", "POST", match)).status, 409);
  assert.equal((await request("/api/players", "PATCH", { currentName: "Alex", name: "Alex Renamed" })).status, 200);
  data = (await request("/api/data")).data;
  assert.equal(data.matches[0].winnerName, "Alex Renamed");
  assert.equal((await request("/api/matches/latest", "DELETE", { revision: match.revision })).status, 409);
  assert.equal((await request("/api/matches/latest", "DELETE", { revision: data.revision })).status, 200);
  data = (await request("/api/data")).data;
  assert.equal(data.matches.length, 0); assert.equal(data.players[0].elo, 1000); assert.equal(data.players[0].wins, 0);
  assert.equal((await request("/api/players", "PATCH", { currentName: "Sam", archived: true })).status, 200);
  data = (await request("/api/data")).data;
  assert.equal((await request("/api/matches", "POST", { ...match, winnerName: "Alex Renamed", revision: data.revision })).status, 400);
  const backup = (await request("/api/backup")).data.data;
  assert.doesNotMatch(JSON.stringify(backup), /"(?:id|accountId|accounts|winnerId|loserId|confirmations|eloApplied|password|username)":/);
  const status = (await request("/api/status")).data;
  assert.equal(status.storage, "firebase-firestore"); assert.equal(status.persistent, true);
  const logout = await request("/api/admin/logout", "POST", {});
  assert.match(logout.res.headers.get("set-cookie"), /Max-Age=0/);
}
test("Node server supports admin-only name-based match entry", async t => {
  const probe = http.createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = probe.address().port; await new Promise(r => probe.close(r));
  const env = { ...process.env, ...settings, PORT: String(port) };
  for (const key of ["RENDER", "VERCEL", "APP_ORIGIN"]) delete env[key];
  const child = spawn(process.execPath, ["--require", path.join(__dirname, "mock-firestore.cjs"), "server.js"], { cwd: path.join(__dirname, ".."), env, stdio: "pipe" });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, "exit"); } });
  const base = `http://127.0.0.1:${port}`; let ready = false;
  for (let i = 0; i < 100; i++) { try { await fetch(base); ready = true; break; } catch { await new Promise(r => setTimeout(r, 25)); } }
  assert.ok(ready); await workflow(base);
  for (const file of ["/data/db.json", "/.env", "/server.js", "/lib/club.js"]) assert.equal((await fetch(base + file)).status, 404);
});
test("Vercel uses the same admin authentication and name-based results", async t => {
  Object.assign(process.env, settings); delete process.env.APP_ORIGIN; delete process.env.VERCEL;
  const server = http.createServer(require("../api/index.js")); server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(r => server.close(r))); await workflow(`http://127.0.0.1:${server.address().port}`);
});
test("frontend script parses, uses names and removes player signup and confirmation controls", async () => {
  const html = await fs.readFile(path.join(__dirname, "..", "index.html"), "utf8");
  new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  assert.doesNotMatch(html, /signupForm|winnerId|loserId|requestId|p\.id|confirmMatch|setReporterRole/);
  assert.match(html, /winnerName:/); assert.match(html, /\/api\/admin\/login/);
});
