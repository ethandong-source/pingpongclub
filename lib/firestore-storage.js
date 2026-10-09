"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");
const context = new AsyncLocalStorage();
const INITIAL_DB = { version: 1, accounts: [], players: [], matches: [] };
const STORAGE_TYPE = "firebase-firestore";
let store;
let queue = Promise.resolve();

function storageError(message, statusCode = 503) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
function validateDatabase(db) {
  if (!db || db.version !== 1 || !Array.isArray(db.accounts) || !Array.isArray(db.players) || !Array.isArray(db.matches)) {
    throw storageError("Invalid club database: version, accounts, players and matches are required.");
  }
  return db;
}
function createStore(firestore, documentPath) {
  const reference = firestore.doc(documentPath);
  function decode(snapshot) {
    if (!snapshot.exists) return { db: structuredClone(INITIAL_DB), revision: 0 };
    const data = snapshot.data();
    if (typeof data.state !== "string" || !Number.isSafeInteger(data.revision) || data.revision < 1) {
      throw storageError("The Firestore club document has an unsupported format.");
    }
    let db;
    try { db = JSON.parse(data.state); }
    catch { throw storageError("The Firestore club document contains invalid JSON."); }
    return { db: validateDatabase(db), revision: data.revision };
  }
  return {
    async read() { return decode(await reference.get()); },
    async write(db, expectedRevision) {
      validateDatabase(db);
      const state = JSON.stringify(db);
      // One small club snapshot fits in one document. Leave room for Firestore metadata.
      if (Buffer.byteLength(state, "utf8") > 900000) {
        throw storageError("Club data is too large for the current Firestore document. Split it into collections before adding more records.", 413);
      }
      return firestore.runTransaction(async transaction => {
        const current = decode(await transaction.get(reference));
        if (current.revision !== expectedRevision) {
          throw storageError("The club data changed during this request. Refresh and try again.", 409);
        }
        const revision = current.revision + 1;
        transaction.set(reference, { state, revision, updatedAt: new Date().toISOString() });
        return revision;
      });
    },
    async importIfEmpty(db) {
      validateDatabase(db);
      return this.write(db, 0); // Existing data is never overwritten by the import script.
    }
  };
}
function getStore() {
  if (store) return store;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw storageError("Set FIREBASE_PROJECT_ID and Firebase server credentials in your hosting environment.");
  const { initializeApp, getApps, cert } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const options = { projectId };
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (!clientEmail || !privateKey) {
      throw storageError("Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in Render's environment settings.");
    }
    options.credential = cert({ projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, "\n") });
  } else if (process.env.NODE_ENV === "production" || process.env.RENDER || process.env.VERCEL) {
    throw storageError("FIRESTORE_EMULATOR_HOST must not be set in production.");
  }
  const appName = "pingpong-storage";
  const app = getApps().find(app => app.name === appName) || initializeApp(options, appName);
  const databaseId = process.env.FIRESTORE_DATABASE_ID || "(default)";
  const firestore = getFirestore(app, databaseId);
  const documentPath = process.env.FIRESTORE_DOCUMENT_PATH || "clubs/carroll-pingpong";
  const segments = documentPath.split("/");
  if (segments.length % 2 !== 0 || segments.some(part => !part)) {
    throw storageError("FIRESTORE_DOCUMENT_PATH must be a document path such as clubs/carroll-pingpong.");
  }
  store = createStore(firestore, documentPath);
  return store;
}
// Each Node/Vercel request has its own expected revision. Local requests are also serialized.
function runStorageRequest(callback) {
  const next = queue.then(() => context.run({}, callback));
  queue = next.catch(() => {});
  return next;
}
async function getDatabase() {
  const request = context.getStore();
  if (!request) throw storageError("Database reads must run inside a storage request.");
  const result = await getStore().read();
  request.revision = result.revision;
  return result.db;
}
async function saveDatabase(db) {
  const request = context.getStore();
  if (!request || !Number.isSafeInteger(request.revision)) {
    throw storageError("Read the database before saving it.");
  }
  request.revision = await getStore().write(db, request.revision);
}
async function importDatabase(db) { return getStore().importIfEmpty(db); }
module.exports = { INITIAL_DB, STORAGE_TYPE, runStorageRequest, getDatabase, saveDatabase, importDatabase, createStore };
