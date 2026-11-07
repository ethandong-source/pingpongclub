// Run against the local Firestore emulator: never against a real project.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
const {encode,decode} = require("../scripts/firestore");
const {ratingSystem} = require("../lib/glicko");
const {addMatch} = require("../club-actions");

const base = "http://127.0.0.1:8080/v1/projects/demo-club/databases/(default)/documents";
const publicPath = "/clubPublic/carroll-pingpong";
const privatePath = "/clubs/carroll-pingpong";
const data = {version:2,revision:0,ratingSystem:ratingSystem(),matches:[],
  players:["Alex","Morgan","Sam","Riley"].map((name,i)=>({name,elo:950+i*50,rd:350,lastRatedAt:null,wins:0,losses:0,archived:false}))};
function request(path,method="GET",value,owner=false) {
  const headers = { ...(owner ? {Authorization:"Bearer owner"} : {}), ...(value ? {"Content-Type":"application/json"} : {}) };
  return fetch(base+path,{method,headers,...(value ? {body:JSON.stringify({fields:encode(value).mapValue.fields})} : {})});
}
async function status(response,expected) {
  const res = await response;
  if (res.status !== expected) assert.fail(`Expected ${expected}, got ${res.status}: ${await res.text()}`);
  return res;
}
await status(request(publicPath,"DELETE",undefined,true),200);
await status(request(publicPath,"PATCH",data),403);
await status(request(publicPath,"PATCH",data,true),200);
await status(request(privatePath,"PATCH",{admin:{passwordHash:"dummy"}},true),200);
await status(request(privatePath),403);
await status(request("/clubPublic"),403);
await status(request("/clubPublic/other","PATCH",data),403);
await status(request(publicPath,"DELETE"),403);
await status(request(publicPath,"PATCH",{...data,revision:1,admin:{passwordHash:"dummy"}}),403);
await status(request(publicPath,"PATCH",data),403);
addMatch(data,{type:"doubles",winnerNames:["Alex","Morgan"],loserNames:["Sam","Riley"],winnerScore:11,loserScore:8},{username:"Club editor"});
data.revision = 1;
await status(request(publicPath,"PATCH",data),200);
await status(request(publicPath,"PATCH",data),403);
const snapshot = await (await status(request(publicPath),200)).json();
assert.deepEqual(decode({mapValue:{fields:snapshot.fields}}),data);
console.log("Static Firestore rules passed: public read and doubles save; stale, private, delete, and extra-field requests denied.");
