"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname,"..");
const dist = path.join(root,"dist");
async function build() {
  const supplied = JSON.parse(process.env.FIREBASE_WEB_CONFIG || "{}");
  const firebaseConfig = Object.fromEntries(["apiKey","projectId","appId"].filter(k => typeof supplied[k] === "string").map(k => [k,supplied[k]]));
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) {
    throw new Error("Set FIREBASE_WEB_CONFIG to the Firebase web app config JSON (apiKey, projectId, appId).");
  }
  const editorCode = process.env.CLUB_EDIT_CODE;
  if (!editorCode?.trim()) throw new Error("Set CLUB_EDIT_CODE to the public editor password. Do not reuse a private password.");
  const databaseId = process.env.FIREBASE_DATABASE_ID || "(default)";
  // Only these public files are copied. Server code, seed data and credentials stay outside dist.
  const files = ["index.html","player.html","player.css","player.js","player-stats.js","ratings.js","club-actions.js","static-club.mjs","player-picker.js"];
  const images = (await fs.readdir(path.join(root,"assets"),{withFileTypes:true}))
    .filter(f => f.isFile() && /\.(png|jpe?g|webp)$/i.test(f.name)).map(f => "assets/"+f.name);
  await fs.rm(dist,{recursive:true,force:true});
  await fs.mkdir(path.join(dist,"assets"),{recursive:true});
  await Promise.all([...files,...images].map(f=>fs.copyFile(path.join(root,f),path.join(dist,f))));
  const configs = {firebaseConfig,databaseId,editorCode,localEmulator:process.env.LOCAL_FIRESTORE_EMULATOR === "true"};
  await fs.writeFile(path.join(dist,"static-config.mjs"),Object.entries(configs).map(([k,v])=>`export const ${k} = ${JSON.stringify(v)};\n`).join(""));
  console.log("Built the static site in dist/.");
}
build().catch(error => { console.error(error.message); process.exitCode=1; });
