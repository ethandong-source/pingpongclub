"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {summarize}=require("../player-stats");

test("player profile uses the correct doubles slot and preserves gaps in rating history",()=>{
  const player={name:"A & B",elo:1014}, name=player.name;
  const matches=[
    {type:"doubles",winnerNames:["C","D"],loserNames:["E",name],loserChanges:[30,8],before:{losers:[{elo:900},{elo:1022}]},score:"11-9",date:"2026-11-05T19:00:00Z"},
    {winnerName:name,loserName:"C",winnerChange:22,before:{winner:{elo:1000}},score:"11-7",date:"2026-11-05T17:00:00Z"},
    {winnerName:name,loserName:"D",score:"11-5",date:"2026-11-05T18:00:00Z"}
  ];
  const result=summarize(player,matches);
  assert.deepEqual(result.points.map(p=>[p.number,p.rating]),[[0,1000],[1,1022],[3,1014]]);
  assert.equal(result.history[2].teammate,"E");
  assert.deepEqual(result.history[2].opponents,["C","D"]);
  assert.equal(result.history[2].score,"9–11");
  assert.equal(result.history[2].delta,-8);
  assert.deepEqual(result.records,[{wins:2,losses:0},{wins:0,losses:1}]);
  assert.equal(result.streak,-1);
  assert.equal(result.bestStreak,2);
  assert.equal(result.peak,1022);
  assert.equal(result.bestWin.delta,22);
});
test("player with no matches has no invented chart points",()=>{
  const result=summarize({name:"New player",elo:1000},[]);
  assert.deepEqual(result.points,[]);
  assert.equal(result.peak,1000);
  assert.equal(result.streak,0);
});
