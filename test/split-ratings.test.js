'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {rebuild}=require('../split-ratings'),r=require('../ratings');
const {addMatch,undoMatch,addPlayer}=require('../club-actions');
const {migrateDatabase}=require('../lib/club-schema');
const {summarize}=require('../player-stats');
const config={...r.DEFAULTS,name:r.SCORE_SYSTEM,version:3};
const player=(name)=>({name,elo:1300,rd:80,wins:4,losses:2,lastRatedAt:'2026-01-10T00:00:00Z',archived:false});
function fixture(){return {version:2,ratingSystem:config,revision:8,players:['A','B','C','D','New'].map(player),matches:[
  {winnerName:'A',loserName:'B',score:'11-9',date:'2026-01-01T00:00:00Z',enteredBy:'old'},
  {type:'doubles',winnerNames:['A','C'],loserNames:['B','D'],score:'11-2',date:'2026-01-02T00:00:00Z',enteredBy:'old'},
  {winnerName:'B',loserName:'A',score:'11-6',date:'2026-01-03T00:00:00Z',enteredBy:'old'},
  {type:'doubles',winnerNames:['B','C'],loserNames:['A','D'],score:'11-8',date:'2026-01-04T00:00:00Z',enteredBy:'old'}]};}
const singles=p=>({elo:p.elo,rd:p.rd,wins:p.wins,losses:p.losses,lastRatedAt:p.lastRatedAt});

test('full chronological replay isolates both pools and is deterministic, preserving match facts and accounts',()=>{
  const db=fixture(),original=structuredClone(db),out=rebuild(db);
  assert.deepEqual(db,original);
  assert.deepEqual(rebuild(out),out);
  assert.deepEqual(out.ratingSystem,db.ratingSystem);
  assert.deepEqual(out.players.map(p=>[p.name,p.archived]),db.players.map(p=>[p.name,p.archived]));
  const onlySingles=rebuild({...db,matches:db.matches.filter(m=>m.type!=='doubles')});
  const onlyDoubles=rebuild({...db,matches:db.matches.filter(m=>m.type==='doubles')});
  out.players.forEach((p,i)=>{
    assert.deepEqual(singles(p),singles(onlySingles.players[i]));
    assert.deepEqual(p.doubles,onlyDoubles.players[i].doubles);
    for(const type of ['singles','doubles']){
      const stats=summarize(p,out.matches,type);
      const pool=r.ratingFor(p,type);
      assert.equal(stats.history.length,pool.wins+pool.losses);
      if(stats.points.length)assert.equal(stats.points.at(-1).rating,pool.elo);
    }
  });
  assert.deepEqual(singles(out.players.at(-1)),{elo:1000,rd:350,wins:0,losses:0,lastRatedAt:null});
  for(let i=0;i<db.matches.length;i++)for(const key of ['score','date','enteredBy','winnerName','loserName','winnerNames','loserNames'])assert.deepEqual(out.matches[i][key],db.matches[i][key]);
  assert.deepEqual({...migrateDatabase(out),revision:out.revision},out);
});

test('new match, reload, exact undo and new members keep singles and doubles independent',()=>{
  const db=rebuild(fixture());
  for(const body of [{winnerName:'A',loserName:'B',winnerScore:11,loserScore:7},{type:'doubles',winnerNames:['A','C'],loserNames:['B','D'],winnerScore:11,loserScore:9}]){
    const before=structuredClone(db);
    addMatch(db,body,{username:'test'});
    assert.equal(db.matches.at(-1).ratingPool,body.type==='doubles'?'doubles':'singles');
    for(let i=0;i<db.players.length;i++) assert.deepEqual(body.type==='doubles'?singles(db.players[i]):db.players[i].doubles,body.type==='doubles'?singles(before.players[i]):before.players[i].doubles);
    const restored={...migrateDatabase(db),revision:db.revision};
    undoMatch(restored);
    assert.deepEqual(restored,before);
    undoMatch(db);assert.deepEqual(db,before);
  }
  addPlayer(db,'New member');
  assert.deepEqual(db.players.at(-1).doubles,{elo:1000,rd:350,lastRatedAt:null,wins:0,losses:0});
});

test('deleted participants are simulated without restoration; archived members and invalid input are handled safely',()=>{
  const db=fixture();db.players=db.players.filter(p=>p.name!=='D');db.players[0].archived=true;
  const out=rebuild(db);
  assert.ok(!out.players.some(p=>p.name==='D'));assert.equal(out.players[0].archived,true);
  const bad=fixture();bad.matches[0].score='unknown';assert.throws(()=>rebuild(bad),/score/);
  bad.matches[0].score='11-9';bad.matches[0].date='unknown';assert.throws(()=>rebuild(bad),/date/);
});
