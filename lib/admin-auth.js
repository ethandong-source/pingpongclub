"use strict";
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
const { runStorageRequest, getDatabase, saveDatabase } = require("./firestore-storage");
function error(message, statusCode = 503) { return Object.assign(new Error(message), { statusCode }); }
async function makeAdmin(username, password) {
  username = typeof username === "string" ? username.trim() : "";
  if (!username || username.length > 80 || typeof password !== "string" || password.length < 4 || password.length > 256) {
    throw error("Enter a username and a password of 4–256 characters.", 400);
  }
  const passwordSalt = crypto.randomBytes(16).toString("hex");
  const passwordHash = (await scrypt(password, passwordSalt, 64)).toString("hex");
  return { username, passwordSalt, passwordHash, sessionSecret: crypto.randomBytes(32).toString("hex") };
}
async function getAdmin() {
  // Create the requested initial login once. Existing Firestore credentials always win.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await runStorageRequest(async () => {
        const db = await getDatabase();
        if (db.admin) return db.admin;
        const initial = require("./initial-admin.json");
        db.admin = { ...initial, sessionSecret: crypto.randomBytes(32).toString("hex") };
        await saveDatabase(db);
        return db.admin;
      });
    } catch (err) { if (err.statusCode !== 409 || attempt === 1) throw err; }
  }
}
async function verifyPassword(password, admin) {
  if (typeof password !== "string" || password.length > 256) return false;
  const derived = await scrypt(password, admin.passwordSalt, 64);
  return crypto.timingSafeEqual(derived, Buffer.from(admin.passwordHash, "hex"));
}
module.exports = { makeAdmin, getAdmin, verifyPassword };
