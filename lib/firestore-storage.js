"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");
const context = new AsyncLocalStorage();
const { isDeepStrictEqual } = require("node:util");
const { INITIAL_DB, migrateDatabase } = require("./club-schema");
const STORAGE_TYPE = "firebase-firestore";
let store;
let queue = Promise.resolve();

function storageError(message, statusCode = 503) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
function createStore(firestore, documentPath) {
  const reference = firestore.doc(documentPath);
  function decode(snapshot) {
    if (!snapshot.exists) return { db: structuredClone(INITIAL_DB), revision: 0 };
    const { revision = 0, updatedAt, state, ...fields } = snapshot.data();
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw storageError("The Firestore club document has an invalid revision.");
    }
    let db = fields;
    // Compatibility with the previous backend's serialized snapshot.
    if (state !== undefined) {
      if (typeof state !== "string") throw storageError("The Firestore club document has an unsupported format.");
      try { db = JSON.parse(state); }
      catch { throw storageError("The Firestore club document contains invalid JSON."); }
    }
    return { db: migrateDatabase(db), revision };
  }
  function encode(db, revision) {
    const json = JSON.stringify(migrateDatabase(db));
    // Leave room below Firestore's document size limit for field names and metadata.
    if (Buffer.byteLength(json, "utf8") > 900000) {
      throw storageError("Club data is too large for the current Firestore document. Split it into collections before adding more records.", 413);
    }
    const fields = JSON.parse(json);
    // Storage metadata must never become part of a club backup.
    delete fields.state;
    delete fields.revision;
    delete fields.updatedAt;
    return { ...fields, revision, updatedAt: new Date().toISOString() };
  }
  return {
    async read() {
      const snapshot = await reference.get();
      const current = decode(snapshot);
      const needsMigration = value => value.exists && (value.data().state !== undefined ||
        !isDeepStrictEqual(decode(value).db, (({ revision, updatedAt, ...fields }) => fields)(value.data())));
      if (!needsMigration(snapshot)) return current;
      // Re-read inside the transaction so migration cannot replace a concurrent save.
      return firestore.runTransaction(async transaction => {
        const latest = await transaction.get(reference);
        const result = decode(latest);
        if (needsMigration(latest)) {
          result.revision += 1;
          transaction.set(reference, encode(result.db, result.revision));
        }
        return result;
      });
    },
    async write(db, expectedRevision) {
      const document = encode(db, expectedRevision + 1);
      return firestore.runTransaction(async transaction => {
        const current = decode(await transaction.get(reference));
        if (current.revision !== expectedRevision) {
          throw storageError("The club data changed during this request. Refresh and try again.", 409);
        }
        transaction.set(reference, document);
        return document.revision;
      });
    },
    async importIfEmpty(db) {
      const document = encode(db, 1);
      return firestore.runTransaction(async transaction => {
        if ((await transaction.get(reference)).exists) {
          throw storageError("The club document already exists. Import will not overwrite existing data.", 409);
        }
        transaction.set(reference, document);
        return document.revision;
      });
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
function getRevision() { return context.getStore()?.revision; }
async function importDatabase(db) { return getStore().importIfEmpty(db); }
module.exports = { INITIAL_DB, STORAGE_TYPE, runStorageRequest, getDatabase, saveDatabase, importDatabase, createStore, getRevision };
