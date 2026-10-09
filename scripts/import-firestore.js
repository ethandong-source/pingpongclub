"use strict";

// Run locally against a private backup. No backup data or credentials are committed.
const fs = require("node:fs/promises");
const { migrateDatabase } = require("../lib/club-schema");
const { importDatabase } = require("../lib/firestore-storage");

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npm run import:firestore -- /absolute/path/to/private-backup.json");
  const backup = JSON.parse(await fs.readFile(file, "utf8"));
  const db = migrateDatabase(backup.data || backup);
  await importDatabase(db);
  console.log(`Imported ${db.players.length} players and ${db.matches.length} matches into Firestore.`);
}
main().then(() => process.exit(0)).catch(error => {
  console.error(error.statusCode === 409 ? "Import stopped: Firestore already contains club data. Nothing was overwritten." : error.message);
  process.exit(1);
});
