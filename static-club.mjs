import {initializeApp} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import {getFirestore, doc, onSnapshot, runTransaction, connectFirestoreEmulator} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import {firebaseConfig, databaseId, editorCode, localEmulator} from "./static-config.mjs";

const db = getFirestore(initializeApp(firebaseConfig), databaseId);
if (localEmulator && ["localhost","127.0.0.1","[::1]"].includes(location.hostname)) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
const ref = doc(db, "clubPublic", "carroll-pingpong");
const sessionKey = "carroll-pingpong-static-editor";
let unlocked = false;
try { unlocked = sessionStorage.getItem(sessionKey) === editorCode; } catch {}

export function editorOpen() { return unlocked; }
export function unlock(code) {
  if (code !== editorCode) throw new Error("Incorrect editor password.");
  unlocked = true;
  try { sessionStorage.setItem(sessionKey, editorCode); } catch {}
}
export function lock() {
  unlocked = false;
  try { sessionStorage.removeItem(sessionKey); } catch {}
}
function read(snapshot) {
  if (!snapshot.exists()) throw new Error("Club data hasn’t been imported into the static site yet.");
  const {version, players, matches, ratingSystem, revision} = snapshot.data();
  if (version !== 2 || !Array.isArray(players) || !Array.isArray(matches) ||
      ratingSystem?.name !== "glicko-1" || !Number.isSafeInteger(revision)) {
    throw new Error("The club data is invalid. Ask a club admin to check the backup.");
  }
  return {version, players, matches, ratingSystem, revision};
}
export function subscribe(onData,onError) {
  return onSnapshot(ref, snapshot => {
    let state;
    try { state = read(snapshot); } catch (error) { onError(error); return; }
    onData(state);
  }, onError);
}
export async function change(operation, payload, revision) {
  if (!unlocked) throw new Error("Unlock the editor first.");
  const {playerName,addPlayer,updatePlayer,deletePlayer,addMatch,undoMatch} = globalThis.ClubActions;
  return runTransaction(db, async tx => {
    const data = read(await tx.get(ref));
    if (data.revision !== revision) throw new Error("The club data changed. Check the updated roster or results and try again.");
    switch (operation) {
      case "addPlayer": addPlayer(data,playerName(payload.name)); break;
      case "updatePlayer": updatePlayer(data,payload); break;
      case "deletePlayer": deletePlayer(data,playerName(payload.name)); break;
      case "addMatch": addMatch(data,payload,{username:"Club editor"}); break;
      case "undoMatch": undoMatch(data); break;
      default: throw new Error("Unknown club operation.");
    }
    data.revision++;
    tx.set(ref,data);
    return data;
  });
}
