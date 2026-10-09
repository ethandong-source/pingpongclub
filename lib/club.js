"use strict";

const crypto = require("node:crypto");

const { STORAGE_TYPE, runStorageRequest, getDatabase, saveDatabase, getRevision } = require("./firestore-storage");
const { normalizeName } = require("./club-schema");
const { makeAdmin, getAdmin, verifyPassword } = require("./admin-auth");
const SESSION_TTL = 8 * 60 * 60;
const COOKIE = "club_admin";
const loginFailures = new Map();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function fail(status, message) { throw new HttpError(status, message); }
async function withDatabase(operation, write = false, expectedRevision) {
  return runStorageRequest(async () => {
    const db = await getDatabase();
    if (expectedRevision !== undefined && expectedRevision !== getRevision()) {
      fail(409, "The club data changed. Refresh before entering this result again.");
    }
    const result = await operation(db);
    if (write) await saveDatabase(db);
    return { ...result, revision: getRevision() };
  });
}

function safeEqual(a, b) {
  const first = crypto.createHash("sha256").update(String(a)).digest();
  const second = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(first, second);
}
function sessionSignature(payload, c) {
  // Changing either the password or secret invalidates existing sessions.
  return crypto.createHmac("sha256", c.sessionSecret).update(payload).update("\0").update(c.passwordHash).digest("base64url");
}
async function getSession(req) {
  try {
    const cookie = String(req.headers.cookie || "").split(";").map(c => c.trim()).find(c => c.startsWith(`${COOKIE}=`));
    if (!cookie) return null;
    const [payload, signature, extra] = cookie.slice(COOKIE.length + 1).split(".");
    if (!payload || !signature || extra) return null;
    const admin = await getAdmin();
    if (!safeEqual(signature, sessionSignature(payload, admin))) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.username !== admin.username || !Number.isFinite(data.exp) || data.exp <= Date.now()) return null;
    return data;
  } catch { return null; }
}
function secureCookie(req) {
  return process.env.NODE_ENV === "production" || !!process.env.VERCEL || req.socket?.encrypted ||
    String(req.headers["x-forwarded-proto"] || "").split(",")[0] === "https";
}
function setCookie(req, res, token, maxAge) {
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookie(req) ? "; Secure" : ""}`);
}
async function requireAdmin(req) {
  const session = await getSession(req);
  if (!session) fail(401, "Log in as admin to make changes.");
  return session;
}
function checkWriteRequest(req) {
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) fail(415, "Send JSON requests.");
  if (req.headers["sec-fetch-site"] === "cross-site") fail(403, "Cross-site requests are not allowed.");
  const origin = req.headers.origin;
  if (origin) {
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
    const scheme = secureCookie(req) ? "https" : "http";
    const allowed = process.env.APP_ORIGIN || `${scheme}://${host}`;
    if (origin !== allowed) fail(403, "Request origin is not allowed.");
  }
}
async function readBody(req) {
  if (req.body !== undefined) {
    const text = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(text) > 32768) fail(413, "Request is too large.");
    try { return JSON.parse(text); } catch { fail(400, "Invalid JSON."); }
  }
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 32768) fail(413, "Request is too large.");
  }
  try { return JSON.parse(text || "{}"); } catch { fail(400, "Invalid JSON."); }
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(data));
}

function playerName(value) {
  const name = normalizeName(value);
  if (!name || name.length > 80) fail(400, "Player name must be 1–80 characters.");
  return name;
}
function snapshot(p) { return { elo: p.elo, wins: p.wins, losses: p.losses }; }

async function handle(req, res) {
  try {
    const route = new URL(req.url, "http://localhost").pathname.replace(/\/$/, "");
    const method = req.method;
    if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) fail(405, "Method not allowed.");
    if (method !== "GET") checkWriteRequest(req);

    if (method === "GET" && route === "/api/admin/session") {
      const session = await getSession(req);
      return send(res, 200, { success: true, admin: session ? { username: session.username } : null });
    }
    if (method === "POST" && route === "/api/admin/login") {
      const c = await getAdmin();
      // A bounded per-process throttle; add host-level rate limiting for public deployments.
      const address = req.socket?.remoteAddress || "serverless";
      const now = Date.now();
      for (const [key, value] of loginFailures) if (value.until < now) loginFailures.delete(key);
      const previous = loginFailures.get(address);
      if (previous?.count >= 8) fail(429, "Too many login attempts. Try again in 15 minutes.");
      const body = await readBody(req);
      if (!safeEqual(body.username || "", c.username) || !(await verifyPassword(body.password, c))) {
        if (loginFailures.size > 1000) loginFailures.clear();
        loginFailures.set(address, { count: (previous?.count || 0) + 1, until: previous?.until || now + 15 * 60 * 1000 });
        fail(401, "Incorrect admin username or password.");
      }
      loginFailures.delete(address);
      const payload = Buffer.from(JSON.stringify({ username: c.username, exp: now + SESSION_TTL * 1000 })).toString("base64url");
      setCookie(req, res, `${payload}.${sessionSignature(payload, c)}`, SESSION_TTL);
      return send(res, 200, { success: true, admin: { username: c.username } });
    }
    if (method === "POST" && route === "/api/admin/settings") {
      await requireAdmin(req);
      const body = await readBody(req);
      const next = await makeAdmin(body.username, body.password);
      await withDatabase(db => { db.admin = next; return {}; }, true);
      const payload = Buffer.from(JSON.stringify({ username: next.username, exp: Date.now() + SESSION_TTL * 1000 })).toString("base64url");
      setCookie(req, res, `${payload}.${sessionSignature(payload, next)}`, SESSION_TTL);
      return send(res, 200, { success: true, admin: { username: next.username } });
    }
    if (method === "POST" && route === "/api/admin/logout") {
      setCookie(req, res, "", 0);
      return send(res, 200, { success: true });
    }
    if (method === "GET" && route === "/api/data") {
      return send(res, 200, await withDatabase(db => ({ success: true, players: db.players, matches: db.matches, serverTime: new Date().toISOString() })));
    }
    if (method === "GET" && route === "/api/status") {
      return send(res, 200, await withDatabase(db => ({ status: "online", storage: STORAGE_TYPE, storageFormat: "native-object", persistent: true, counts: { players: db.players.length, matches: db.matches.length } })));
    }
    if (method === "GET" && route === "/api/backup") {
      await requireAdmin(req);
      return send(res, 200, await withDatabase(db => ({ success: true, timestamp: new Date().toISOString(), data: { version: db.version, players: db.players, matches: db.matches } })));
    }
    if (method === "POST" && route === "/api/players") {
      await requireAdmin(req);
      const name = playerName((await readBody(req)).name);
      return send(res, 201, await withDatabase(db => {
        if (db.players.some(p => p.name.toLowerCase() === name.toLowerCase())) fail(409, "A player with that name already exists.");
        const player = { name, elo: 1000, wins: 0, losses: 0, archived: false };
        db.players.push(player);
        return { success: true, player };
      }, true));
    }
    if (method === "PATCH" && route === "/api/players") {
      await requireAdmin(req);
      const body = await readBody(req);
      return send(res, 200, await withDatabase(db => {
        const player = db.players.find(p => p.name === body.currentName);
        if (!player) fail(404, "Player not found.");
        if (body.name !== undefined) {
          const name = playerName(body.name);
          if (db.players.some(p => p !== player && p.name.toLowerCase() === name.toLowerCase())) fail(409, "A player with that name already exists.");
          for (const match of db.matches) {
            if (match.winnerName === player.name) match.winnerName = name;
            if (match.loserName === player.name) match.loserName = name;
          }
          player.name = name;
        }
        if (body.archived !== undefined) {
          if (typeof body.archived !== "boolean") fail(400, "Archived must be true or false.");
          player.archived = body.archived;
        }
        return { success: true, player };
      }, true));
    }
    if (method === "POST" && route === "/api/matches") {
      const admin = await requireAdmin(req);
      const body = await readBody(req);
      if (!Number.isSafeInteger(body.revision) || body.revision < 0) fail(400, "Refresh the club data before entering a match.");
      return send(res, 201, await withDatabase(db => {
        const winner = db.players.find(p => p.name === body.winnerName && !p.archived);
        const loser = db.players.find(p => p.name === body.loserName && !p.archived);
        if (!winner || !loser) fail(400, "Choose two active players by name.");
        if (winner === loser) fail(400, "Winner and loser must be different players.");
        const ws = body.winnerScore, ls = body.loserScore;
        if (!Number.isInteger(ws) || !Number.isInteger(ls) || ls < 0 || ws > 99 || ws <= ls) fail(400, "Scores must be integers from 0–99, with the winner's score higher.");
        const expected = 1 / (1 + Math.pow(10, (loser.elo - winner.elo) / 400));
        const delta = Math.max(1, Math.round(32 * (1 - expected)));
        const before = { winner: snapshot(winner), loser: snapshot(loser) };
        winner.elo += delta;
        loser.elo = Math.max(100, loser.elo - delta); // Preserve the original minimum rating.
        winner.wins += 1;
        loser.losses += 1;
        const match = {
          winnerName: winner.name, loserName: loser.name, score: `${ws}-${ls}`,
          date: new Date().toISOString(), winnerChange: delta,
          loserChange: before.loser.elo - loser.elo, 
          enteredBy: admin.username, before
        };
        db.matches.push(match);
        return { success: true, match };
      }, true, body.revision));
    }
    if (method === "DELETE" && route === "/api/matches/latest") {
      await requireAdmin(req);
      const body = await readBody(req);
      if (!Number.isSafeInteger(body.revision) || body.revision < 0) fail(400, "Refresh the club data before undoing a match.");
      return send(res, 200, await withDatabase(db => {
        const match = db.matches.at(-1);
        if (!match?.before) fail(409, "This legacy match has no saved prior ratings and cannot be safely undone.");
        const winner = db.players.find(p => p.name === match.winnerName);
        const loser = db.players.find(p => p.name === match.loserName);
        if (!winner || !loser) fail(409, "Match players are missing.");
        Object.assign(winner, match.before.winner);
        Object.assign(loser, match.before.loser);
        db.matches.pop();
        return { success: true };
      }, true, body.revision));
    }
    // Old signup, participant confirmation, sync, restore and reset routes are deliberately removed.
    fail(404, "Endpoint not found.");
  } catch (err) {
    if (!err.status) console.error("Club API error:", err.message);
    send(res, err.status || err.statusCode || 503, { success: false, error: (err.status || err.statusCode) ? err.message : "Club storage is unavailable. Please try again." });
  }
}
module.exports = { handle };
