// Usage: node scripts/rebuild-split-ratings.js BACKUP.json OUTPUT.json [--apply]
// Always save the original typed Firestore document before running this command.
'use strict';
const fs=require('node:fs');
const {isDeepStrictEqual:equal}=require('node:util');
const {decode,encode,documentURL,request}=require('./firestore');
const {rebuild}=require('../split-ratings');
function plan(original) {
  if(!original.updateTime || !original.fields?.revision) throw new Error('Need a full document backup with updateTime and revision.');
  const db=decode({mapValue:{fields:original.fields}}),next=rebuild(db);
  if(!Number.isSafeInteger(db.revision))throw new Error('Invalid revision.');
  // Keep unrelated Firestore fields and their exact serialized types.
  const players=original.fields.players.arrayValue.values.map((entry,i)=>{
    const copy=structuredClone(entry);
    for(const k of ['elo','rd','lastRatedAt','wins','losses','doubles'])copy.mapValue.fields[k]=encode(next.players[i][k]);
    return copy;
  });
  const ordered=db.matches.map((m,i)=>({m,i})).sort((a,b)=>Date.parse(a.m.date)-Date.parse(b.m.date)||a.i-b.i);
  const matches=ordered.map(({i},index)=>{
    const copy=structuredClone(original.fields.matches.arrayValue.values[i]),m=next.matches[index];
    const keys=['before','ratingSystem','ratingPool','ratingPolicyVersion',...(m.type==='doubles'?['winnerChanges','loserChanges']:['winnerChange','loserChange'])];
    for(const k of keys)copy.mapValue.fields[k]=encode(m[k]);
    return copy;
  });
  const patch={fields:{players:{arrayValue:{values:players}},matches:{arrayValue:{values:matches}},revision:encode(db.revision+1)}};
  const merged={...original.fields,...patch.fields},decoded=decode({mapValue:{fields:merged}});
  if(!equal(decoded.players,next.players) || !equal(decoded.matches,next.matches) || !equal(decoded.ratingSystem,db.ratingSystem))throw new Error('Migration dropped a field or changed metadata.');
  return {patch,next,revision:db.revision+1};
}
async function main(){
  const [backup,output,apply]=process.argv.slice(2);
  if(!backup||!output)throw new Error('Usage: BACKUP.json OUTPUT.json [--apply]');
  const raw=JSON.parse(fs.readFileSync(backup)),result=plan(raw);
  fs.writeFileSync(output,JSON.stringify(result.next,null,2));
  const summary={players:result.next.players.length,singles:result.next.matches.filter(m=>m.type!=='doubles').length,doubles:result.next.matches.filter(m=>m.type==='doubles').length,revision:result.revision};
  if(apply==='--apply'){
    const query=new URLSearchParams({'currentDocument.updateTime':raw.updateTime});
    for(const k of ['players','matches','revision'])query.append('updateMask.fieldPaths',k);
    const saved=await request(documentURL('carrollpingpongclub','clubPublic/carroll-pingpong')+'?'+query,'',{method:'PATCH',body:JSON.stringify(result.patch)});
    if(!equal(saved.fields.players,result.patch.fields.players) || !equal(saved.fields.matches,result.patch.fields.matches))throw new Error('Saved document differs from migration plan.');
    fs.writeFileSync(output+'.firestore.json',JSON.stringify(saved,null,2));
    summary.applied=true;
  }
  console.log(JSON.stringify(summary));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={plan};
