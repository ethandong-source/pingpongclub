'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const r=require('../ratings'),{rebuild}=require('../split-ratings'),{plan}=require('../scripts/rebuild-split-ratings'),{encode,decode}=require('../scripts/firestore');
// Reproduce the previous deployed 0.5 sensitivity without altering shared modules.
const oldModule={exports:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../ratings'),'utf8').replace('responsiveness: 1 / 3','responsiveness: 0.5'),{module:oldModule});
const oldReplay={exports:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../split-ratings'),'utf8'),{module:oldReplay,require:()=>oldModule.exports,structuredClone,Intl});
function data(){return {version:2,revision:8,ratingSystem:{...r.DEFAULTS,name:r.SCORE_SYSTEM,version:3},players:['A','B','C','D'].map(name=>({name,elo:1000,rd:350,wins:0,losses:0,lastRatedAt:null,archived:false})),matches:[
 {winnerName:'A',loserName:'B',score:'11-9',date:'2026-11-19T05:59:59Z',enteredBy:'old'},
 {winnerName:'B',loserName:'A',score:'11-7',date:'2026-11-19T06:00:00Z',enteredBy:'old'},
 {type:'doubles',winnerNames:['A','C'],loserNames:['B','D'],score:'11-2',date:'2026-11-20T01:00:00Z',enteredBy:'old'},
 {winnerName:'C',loserName:'A',score:'11-8',date:'2026-11-20T05:59:59Z',enteredBy:'old'}]};}
const clean=x=>JSON.parse(JSON.stringify(x));
test('day replay preserves earlier results and opening state, includes Chicago midnight boundaries and is repeatable',()=>{
 const before=clean(oldReplay.exports.rebuild(data())),original=structuredClone(before),after=rebuild(before,{day:'2026-11-19'});
 assert.deepEqual(before,original);assert.deepEqual(after.matches[0],before.matches[0]);
 assert.deepEqual(after.matches[1].before,before.matches[1].before);
 assert.deepEqual(after.matches[2].before,before.matches[2].before);
 assert.ok(after.matches[1].winnerChange<before.matches[1].winnerChange);
 assert.ok(after.matches[2].winnerChanges[0]<before.matches[2].winnerChanges[0]);
 assert.deepEqual(rebuild(after,{day:'2026-11-19'}),after);
 for(let i=1;i<after.matches.length;i++){
  assert.equal(after.matches[i].ratingPolicyVersion,11);
  for(const k of ['winnerName','loserName','winnerNames','loserNames','score','date','enteredBy'])assert.deepEqual(after.matches[i][k],before.matches[i][k]);
 }
 assert.deepEqual(after.players.map(p=>[p.wins,p.losses,p.doubles.wins,p.doubles.losses]),before.players.map(p=>[p.wins,p.losses,p.doubles.wins,p.doubles.losses]));
});
test('typed day migration keeps earlier records exact and refuses missing snapshots or later dependencies',()=>{
 const before=clean(oldReplay.exports.rebuild(data()));
 const raw={fields:encode(before).mapValue.fields,updateTime:'2026-11-20T06:01:00Z'};
 const result=plan(raw,'2026-11-19');
 assert.deepEqual(result.patch.fields.matches.arrayValue.values[0],raw.fields.matches.arrayValue.values[0]);
 assert.equal(decode(result.patch.fields.revision),9);
 const later=structuredClone(before);later.matches.push({...later.matches[1],date:'2026-11-20T06:00:00Z'});
 assert.throws(()=>rebuild(later,{day:'2026-11-19'}),/Later matches/);
 const invalid=structuredClone(before);delete invalid.matches[1].before;
 assert.throws(()=>rebuild(invalid,{day:'2026-11-19'}),/pre-match state/);
 assert.throws(()=>rebuild(before,{day:'2026-11-21'}),/No matches/);
});
