"use strict";

const crypto = require("node:crypto");
const { playerName, addPlayer, updatePlayer, deletePlayer, addMatch, undoMatch } = require("../club-actions");

const { STORAGE_TYPE, runStorageRequest, getDatabase, saveDatabase, getRevision } = require("./firestore-storage");
const { getAdmin, verifyPassword } = require("./admin-auth");
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
    if (method === "POST" && route === "/api/admin/logout") {
      setCookie(req, res, "", 0);
      return send(res, 200, { success: true });
    }
    if (method === "GET" && route === "/api/data") {
      return send(res, 200, await withDatabase(db => ({ success: true, players: db.players, matches: db.matches, ratingSystem: db.ratingSystem, serverTime: new Date().toISOString() })));
    }
    if (method === "GET" && route === "/api/status") {
      await getAdmin();
      return send(res, 200, await withDatabase(db => ({ status: "online", storage: STORAGE_TYPE, storageFormat: "native-object", persistent: true, counts: { players: db.players.length, matches: db.matches.length } })));
    }
    if (method === "GET" && route === "/api/backup") {
      await requireAdmin(req);
      return send(res, 200, await withDatabase(db => ({ success: true, timestamp: new Date().toISOString(), data: { version: db.version, players: db.players, matches: db.matches, ratingSystem: db.ratingSystem } })));
    }
    if (method === "POST" && route === "/api/players") {
      await requireAdmin(req);
      const name = playerName((await readBody(req)).name);
      return send(res, 201, await withDatabase(db => addPlayer(db, name), true));
    }
    if (method === "PATCH" && route === "/api/players") {
      await requireAdmin(req);
      const body = await readBody(req);
      return send(res, 200, await withDatabase(db => updatePlayer(db, body), true));
    }
    if (method === "DELETE" && route === "/api/players") {
      await requireAdmin(req);
      const body = await readBody(req);
      if (!Number.isSafeInteger(body.revision) || body.revision < 0) fail(400, "Refresh the roster before deleting a player.");
      const name = playerName(body.name);
      return send(res, 200, await withDatabase(db => deletePlayer(db, name), true, body.revision));
    }
    if (method === "POST" && route === "/api/matches") {
      const admin = await requireAdmin(req);
      const body = await readBody(req);
      if (!Number.isSafeInteger(body.revision) || body.revision < 0) fail(400, "Refresh the club data before entering a match.");
      return send(res, 201, await withDatabase(db => addMatch(db, body, admin), true, body.revision));
    }
    if (method === "DELETE" && route === "/api/matches/latest") {
      await requireAdmin(req);
      const body = await readBody(req);
      if (!Number.isSafeInteger(body.revision) || body.revision < 0) fail(400, "Refresh the club data before undoing a match.");
      return send(res, 200, await withDatabase(db => undoMatch(db), true, body.revision));
    }
    // Old signup, participant confirmation, sync, restore and reset routes are deliberately removed.
    fail(404, "Endpoint not found.");
  } catch (err) {
    if (!err.status) console.error("Club API error:", err.message);
    send(res, err.status || err.statusCode || 503, { success: false, error: (err.status || err.statusCode) ? err.message : "Club storage is unavailable. Please try again." });
  }
}
module.exports = { handle };
