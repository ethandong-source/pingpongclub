"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {previewDoubles,preview}=require('../ratings');
const {migrateDatabase}=require('../lib/club-schema');
const {prepare}=require('../lib/glicko');
const {fakeFirestore}=require('./mock-firestore.cjs');
const {createStore}=require('../lib/firestore-storage');
const date='2026-11-03T18:00:00Z';
const player=(name,elo=1000,rd=350)=>({name,elo,rd,lastRatedAt:null,wins:0,losses:0,archived:false});
test('doubles uses team strength and individual uncertainty with simultaneous, symmetric updates',()=>{
 const players=[player('A',1200,50),player('B',800,300),player('C'),player('D')];
 const original=structuredClone(players),next=previewDoubles(players.slice(0,2),players.slice(2),date);
 assert.ok(next.winnerChanges[0]>0);assert.ok(next.winnerChanges[0]<next.winnerChanges[1]);
 assert.deepEqual(players,original);
 const stronger=previewDoubles([player('A',1200,50),player('B',1600,300)],players.slice(2),date);
 assert.ok(stronger.winnerChanges[0]<next.winnerChanges[0]);
 const swapped=previewDoubles([...players.slice(0,2)].reverse(),[...players.slice(2)].reverse(),date);
 assert.deepEqual(swapped.winners,[...next.winners].reverse());
 const equal=previewDoubles([player('A'),player('B')],[player('C'),player('D')],date);
 assert.equal(equal.winnerChanges[0],equal.winnerChanges[1]);assert.deepEqual(equal.winnerChanges,equal.loserChanges);
 for(const p of [...next.winners,...next.losers]){assert.ok(Number.isInteger(p.elo));assert.ok(p.rd>0&&p.rd<=350);}
 assert.throws(()=>previewDoubles([players[0]],players.slice(2),date),/two players/);
});
test('mixed singles/doubles replay and Firestore round trips preserve all four snapshots',async()=>{
 const source={version:2,players:['A','B','C','D'].map(n=>player(n)),matches:[
  {winnerName:'A',loserName:'C',score:'11-7',date:'2026-11-03T17:00:00Z'},
  {type:'doubles',winnerNames:['A','B'],loserNames:['C','D'],winnerChanges:[0,0],loserChanges:[0,0],score:'11-9',date}
 ]};
 const replayed=migrateDatabase(source),again=migrateDatabase(replayed);
 assert.deepEqual(again,replayed);assert.deepEqual(prepare(replayed).database,replayed);
 assert.equal(replayed.players[0].wins,2);assert.equal(replayed.players[1].wins,1);
 assert.equal(replayed.players[2].losses,2);assert.equal(replayed.players[3].losses,1);
 const first=preview(source.players[0],source.players[2],source.matches[0].date);
 assert.equal(replayed.matches[0].winnerChange,first.winnerChange);
 assert.equal(replayed.matches[1].before.winners[0].elo,first.winner.elo);
 const db=fakeFirestore(),store=createStore(db,'clubs/doubles');await store.importIfEmpty(replayed);
 const saved=await store.read();assert.deepEqual(saved.db,replayed);assert.equal((await store.read()).revision,saved.revision);
 const deleted={...replayed,players:replayed.players.filter(p=>p.name!=='D')};
 assert.equal(prepare(deleted).database.players.length,3);
 assert.deepEqual(prepare(deleted).database.matches,replayed.matches);
 for(const mutation of [m=>m.winnerNames=['A','A'],m=>m.loserNames=['C'],m=>m.winnerChanges=[1]]){
  const bad=structuredClone(replayed);mutation(bad.matches[1]);assert.throws(()=>migrateDatabase(bad));
 }
});
