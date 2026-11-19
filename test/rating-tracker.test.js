"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const tracker = require("../rating-tracker");

test("tracks monthly points from singles and doubles without changing input", () => {
  const players = [{elo:1000},{elo:1200},{elo:1500,archived:true}];
  const matches = [
    {date:"2026-01-01",winnerChange:3,loserChange:0},
    {date:"2026-01-03",type:"doubles",winnerChanges:[3,3],loserChanges:[2,1]},
    {date:"2026-02-01",winnerChange:10,loserChange:12},
    {date:"2026-02-02",winnerChange:3,loserChange:-2},
    {date:"bad",winnerChange:3,loserChange:0},
    {date:"2026-01-04",winnerChange:3},
    {date:"2026-01-05",type:"doubles",winnerChanges:[3],loserChanges:[0,0]}
  ];
  const original = JSON.stringify({players,matches});
  assert.deepEqual(tracker.summarize(players,matches), {average:1100,players:2,months:[
    {month:"2026-02",matches:2,change:3}, {month:"2026-01",matches:2,change:6}
  ],excluded:3});
  assert.equal(JSON.stringify({players,matches}),original);
});
test("handles an empty club", () => {
  assert.deepEqual(tracker.summarize([],[]), {average:null,players:0,months:[],excluded:0});
});
