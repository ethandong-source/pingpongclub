"use strict";
const fs = require("node:fs/promises");
const {initializeApp, applicationDefault} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const {migrateDatabase} = require("../lib/club-schema");
async function main() {
  const [file] = process.argv.slice(2);
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!file || !projectId) throw new Error("Set FIREBASE_PROJECT_ID and pass a club backup JSON path.");
  const source = JSON.parse(await fs.readFile(file,"utf8"));
  const {version, players, matches, ratingSystem} = migrateDatabase(source.data || source);
  const app = initializeApp({projectId,credential:applicationDefault()});
  const db = getFirestore(app,process.env.FIREBASE_DATABASE_ID || "(default)");
  // create() fails if the public document exists, so a second import cannot erase new matches.
  await db.doc("clubPublic/carroll-pingpong").create({version, players, matches, ratingSystem, revision:0});
  console.log(`Imported ${players.length} players and ${matches.length} matches into clubPublic/carroll-pingpong.`);
}
main().catch(error => {
  console.error(error.code === 6 ? "The static club document already exists. No data was overwritten." : error.message);
  process.exitCode = 1;
});
