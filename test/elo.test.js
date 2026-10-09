"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ratingChanges, kFactor } = require("../elo");
const player = (elo = 1000, games = 0) => ({elo,wins:games,losses:0});
test("expected wins move less than upsets and close scores move less", () => {
  assert.deepEqual(ratingChanges(player(),player(),12,10),{winnerChange:9,loserChange:9});
  assert.deepEqual(ratingChanges(player(),player(),12,0),{winnerChange:15,loserChange:15});
  assert.deepEqual(ratingChanges(player(),player(),11,7),{winnerChange:10,loserChange:10});
  assert.ok(ratingChanges(player(900),player(1100),12,10).winnerChange > ratingChanges(player(1100),player(900),12,10).winnerChange);
  assert.equal(ratingChanges(player(3000),player(1000),12,0).winnerChange,0);
});
test("individual experience permits unequal changes with a strict 30-point cap", () => {
  assert.deepEqual([0,9,10,29,30,50].map(n => kFactor(player(1000,n))),[30,30,20,20,16,16]);
  assert.deepEqual(ratingChanges(player(1400,30),player(1000),12,0),{winnerChange:1,loserChange:3});
  assert.deepEqual(ratingChanges(player(1000),player(1000,30),12,0),{winnerChange:15,loserChange:8});
  for (const elo of [100,1000,3000]) for (const other of [100,1000,3000]) for (const games of [0,10,30]) {
    const c = ratingChanges(player(elo,games),player(other),99,0);
    assert.ok(c.winnerChange >= 0 && c.winnerChange <= 30 && c.loserChange >= 0 && c.loserChange <= 30);
    assert.ok(other-c.loserChange >= 100);
  }
  assert.equal(ratingChanges(player(100),player(3000),12,0).winnerChange,30);
});
test("minimum rating and invalid input are handled safely", () => {
  assert.equal(ratingChanges(player(100),player(101),12,0).loserChange,1);
  for (const score of [[0,0],[12,12],[10,12],[12,-1],[12.5,10],[100,0]]) assert.throws(() => ratingChanges(player(),player(),...score),RangeError);
  assert.throws(() => ratingChanges({...player(),wins:-1},player(),12,0),RangeError);
});
