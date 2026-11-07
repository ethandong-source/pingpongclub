"use strict";
// Test double only: npm test does not require credentials or contact a Firebase project.
const Module = require("node:module");
function fakeFirestore() {
  const records = new Map();
  let queue = Promise.resolve();
  let rejectWrites = false;
  function snapshot(path) {
    const value = records.get(path);
    return { exists: value !== undefined, data: () => structuredClone(value) };
  }
  return {
    records,
    setWriteFailure(value) { rejectWrites = value; },
    doc(path) { return { path, get: async () => snapshot(path) }; },
    runTransaction(callback) {
      const run = async () => {
        const writes = [];
        const result = await callback({
          get: async ref => snapshot(ref.path),
          set: (ref, data) => writes.push([ref.path, structuredClone(data)])
        });
        if (rejectWrites) throw new Error("Simulated Firestore outage");
        for (const [path, data] of writes) records.set(path, data);
        return result;
      };
      const next = queue.then(run, run); queue = next.catch(() => {}); return next;
    }
  };
}
const database = fakeFirestore();
// Isolated test credentials; never use or seed the production login in tests.
const crypto = require("node:crypto");
database.records.set("clubs/carroll-pingpong", {
  version: 2, players: [], matches: [], revision: 1,
  admin: {
    username: "admin", passwordSalt: "0".repeat(32),
    passwordHash: crypto.scryptSync("test-password-at-least-12", "0".repeat(32), 64).toString("hex"),
    sessionSecret: "1".repeat(64)
  }
});
const originalLoad = Module._load;
Module._load = function(name, parent, isMain) {
  if (name === "firebase-admin/app") return { getApps: () => [], cert: c => c, initializeApp: () => ({ name: "pingpong-storage" }) };
  if (name === "firebase-admin/firestore") return { getFirestore: () => database };
  return originalLoad.call(this, name, parent, isMain);
};
module.exports = { fakeFirestore, database };
