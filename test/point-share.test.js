const {test} = require('node:test');
const assert = require('node:assert/strict');
const r = require('../ratings');
const {addMatch,undoMatch} = require('../club-actions');
const {migrateDatabase} = require('../lib/club-schema');
const {summarize} = require('../player-stats');
const date = '2026-01-01T00:00:00Z';
const config = {name:r.SCORE_SYSTEM,version:3,...r.DEFAULTS,ratingRounding:'nearest-integer-per-match'};
const player = (name,elo=1000,rd=350) => ({name,elo,rd,wins:0,losses:0,lastRatedAt:null,archived:false});
const options = (winnerScore,loserScore) => ({...config,winnerScore,loserScore});

test('close losses above expectation can gain rating, while underperforming winners can lose',()=>{
  const winner=player('Favorite',1400,80),loser=player('Underdog',1000,260);
  const close=r.preview(winner,loser,date,options(12,10));
  assert.ok(close.winnerChange<0);
  assert.ok(close.loserChange<0);
  assert.ok(-close.loserChange>Math.abs(close.winnerChange));
  const decisive=r.preview(winner,loser,date,options(12,0));
  assert.ok(decisive.winnerChange>0);
  assert.ok(decisive.loserChange>0);
  assert.ok(decisive.loser.elo<close.loser.elo);
  assert.deepEqual([winner.elo,loser.elo],[1400,1000]);
});

test('point share controls magnitude, preserves Glicko sensitivity, and has no 30-point cap',()=>{
  const a=player('A'),b=player('B');
  const close=r.preview(a,b,date,options(11,9));
  const shutout=r.preview(a,b,date,options(11,0));
  const legacy=r.preview(a,b,date,r.DEFAULTS);
  assert.ok(close.winnerChange>0 && close.winnerChange<shutout.winnerChange);
  assert.deepEqual(shutout,legacy);
  assert.ok(shutout.winnerChange>30);
  assert.deepEqual(r.preview(a,b,date,options(22,18)),close);
  assert.equal(r.formatChange(close.winnerChange),`+${close.winnerChange}`);
  assert.equal(r.formatChange(-close.loserChange),`−${close.loserChange}`);
  assert.equal(r.formatChange(0),'0');
  for(const scores of [[0,0],[11,-1],[11,11],[11,12],[100,0],[11.5,2],[NaN,0]]) {
    assert.throws(()=>r.preview(a,b,date,options(...scores)),/valid winner and loser scores/);
  }
  assert.throws(()=>r.preview(a,b,date,config),/valid winner and loser scores/);
  assert.throws(()=>r.updateRating(a,[{opponent:b,score:Infinity}]),/between 0 and 1/);
});

test('doubles uses both team means, individual uncertainty, and signed changes independent of outcome',()=>{
  const w=[player('A',1400,60),player('B',1400,260)];
  const l=[player('C',1000,80),player('D',1000,300)];
  const result=r.previewDoubles(w,l,date,options(11,9));
  assert.ok(result.winnerChanges.every(n=>n<0));
  assert.ok(result.loserChanges.every(n=>n<0));
  assert.ok(Math.abs(result.winnerChanges[1])>Math.abs(result.winnerChanges[0]));
  const swapped=r.previewDoubles([...w].reverse(),[...l].reverse(),date,options(11,9));
  assert.deepEqual(swapped.winners,[...result.winners].reverse());
  assert.deepEqual(swapped.losers,[...result.losers].reverse());
});

test('forward-only cutover preserves existing ratings and history through saves, restore, charts and undo',()=>{
  const db={version:2,ratingSystem:{name:'glicko-1',version:2,...r.DEFAULTS,ratingRounding:'nearest-integer-per-match'},
    players:[player('A',1400,80),player('B',1000,260),player('C',1250,100),player('D',900,200)],matches:[]};
  addMatch(db,{winnerName:'A',loserName:'B',winnerScore:11,loserScore:7},{username:'admin'});
  const existing=structuredClone(db);
  db.ratingSystem={...config};
  assert.deepEqual(db.players,existing.players);
  assert.deepEqual(db.matches,existing.matches);
  assert.deepEqual(migrateDatabase(db),db);
  assert.throws(()=>r.replay(db),/forward-only/);
  for(const body of [
    {winnerName:'A',loserName:'B',winnerScore:12,loserScore:10},
    {type:'doubles',winnerNames:['A','C'],loserNames:['B','D'],winnerScore:11,loserScore:9}
  ]) {
    const before=structuredClone(db);
    addMatch(db,body,{username:'Club editor'});
    const match=db.matches.at(-1);
    assert.equal(match.ratingSystem,r.SCORE_SYSTEM);
    assert.deepEqual(db.matches.slice(0,-1),existing.matches);
    const restored=migrateDatabase(db);
    assert.deepEqual(restored,db);
    for(const p of db.players) {
      const profile=summarize(p,db.matches);
      if(profile.points.length) assert.equal(profile.points.at(-1).rating,p.elo);
    }
    const b=db.players.find(p=>p.name==='B'),profile=summarize(b,db.matches);
    assert.equal(profile.history.at(-1).won,false);
    assert.ok(profile.history.at(-1).delta>0);
    assert.ok(profile.bestWin.delta>0);
    undoMatch(db);
    assert.deepEqual(db,before);
  }
});
