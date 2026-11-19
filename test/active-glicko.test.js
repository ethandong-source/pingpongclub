const {test} = require('node:test');
const assert = require('node:assert/strict');
const r = require('../ratings');
const {addMatch,undoMatch} = require('../club-actions');
const {migrateDatabase} = require('../lib/club-schema');
const date='2026-11-18T12:00:00Z';
const player=(name,elo=1000,rd=50)=>({name,elo,rd,wins:0,losses:0,lastRatedAt:null,archived:false});
const config={...r.DEFAULTS,name:r.SCORE_SYSTEM,version:3};
const opts=(w,l)=>r.forNewMatch({...config,winnerScore:w,loserScore:l});

test('active policy rewards score above expectation, gives winners at least one, and adjusts for opponent strength',()=>{
  const favorite=player('A',1400),underdog=player('B');
  const close=r.preview(favorite,underdog,date,opts(11,9));
  const decisive=r.preview(favorite,underdog,date,opts(11,0));
  assert.equal(close.winnerChange,1);
  assert.equal(close.loserChange,0);
  assert.equal(close.loser.elo,underdog.elo);
  assert.ok(decisive.loserChange>0);
  const equal=r.preview(underdog,player('C'),date,opts(11,0));
  assert.ok(decisive.winnerChange<equal.winnerChange);
  const upset=r.preview(underdog,favorite,date,opts(11,9));
  assert.ok(upset.winnerChange>close.winnerChange);
  assert.deepEqual([favorite.elo,underdog.elo],[1400,1000]);
});

test('scores drive movement; responsiveness persists after hundreds of matches',()=>{
  const changes=[[11,9],[11,7],[11,0]].map(([w,l])=>r.preview(player('A'),player('B'),date,opts(w,l)).winnerChange);
  assert.deepEqual(changes,[16,36,160]);
  let a=player('A'),b=player('B');
  for(let i=0;i<500;i++) {
    const x=r.preview(a,b,date,opts(11,7));
    a={...a,...x.winner,lastRatedAt:date}; b={...b,...x.loser,lastRatedAt:date};
    assert.ok(a.rd>=250 && b.rd>=250);
    [a,b]=[b,a];
  }
  // Experienced players at equal strength still get a substantial adjustment.
  b.elo=a.elo;
  assert.ok(r.preview(a,b,date,opts(11,7)).winnerChange>=36);
});

test('all valid score margins have finite rounded changes and protect each winning doubles player',()=>{
  for(const elo of [400,1000,1600]) for(const rd of [30,250,350]) for(let l=0;l<11;l++) {
    const result=r.preview(player('A',elo,rd),player('B',1000,rd),date,opts(11,l));
    assert.ok(Number.isInteger(result.winnerChange) && result.winnerChange>=1);
    assert.ok(Number.isInteger(result.loserChange) && result.loserChange>=0);
    assert.ok(result.loser.elo<=1000);
  }
  const winners=[player('A',1400,50),player('B',1400,300)];
  const losers=[player('C',1000,50),player('D',1000,350)];
  const next=r.previewDoubles(winners,losers,date,opts(11,9));
  assert.deepEqual(next.winnerChanges,[1,1]);
  assert.deepEqual(next.loserChanges,[0,0]);
  assert.deepEqual(next.losers.map(p=>p.elo),losers.map(p=>p.elo));
  const decisive=r.previewDoubles(winners,losers,date,opts(11,0));
  assert.ok(decisive.loserChanges.every(n=>n>0));
  assert.ok(decisive.loserChanges[0]!==decisive.loserChanges[1]);
  const reverse=r.previewDoubles([...winners].reverse(),[...losers].reverse(),date,opts(11,9));
  assert.deepEqual(reverse.winners,[...next.winners].reverse());
  assert.deepEqual(reverse.losers,[...next.losers].reverse());
});

test('new policy is versioned per match without changing stored metadata or historical results; undo is exact',()=>{
  const old={winnerName:'A',loserName:'B',score:'11-9',date:'2026-01-01',ratingSystem:r.SCORE_SYSTEM,winnerChange:0,loserChange:-20,enteredBy:'legacy'};
  const db={version:2,players:[player('A',1400),player('B'),player('C',1400),player('D')],matches:[old],ratingSystem:config};
  for(const payload of [{winnerName:'A',loserName:'B',winnerScore:11,loserScore:9},{type:'doubles',winnerNames:['A','C'],loserNames:['B','D'],winnerScore:11,loserScore:9}]) {
    const before=structuredClone(db);
    addMatch(db,payload,{username:'test'});
    assert.equal(db.matches.at(-1).ratingSystem,r.ACTIVE_SYSTEM);
    assert.deepEqual(db.matches.slice(0,-1),before.matches);
    assert.deepEqual(db.ratingSystem,before.ratingSystem);
    assert.deepEqual(migrateDatabase(db),db);
    assert.throws(()=>r.replay(db),/forward-only/);
    undoMatch(db);
    assert.deepEqual(db,before);
  }
});
