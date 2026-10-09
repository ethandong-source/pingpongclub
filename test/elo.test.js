"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ratingChange } = require("../elo");
test("close games change Elo less than decisive games", () => {
  assert.equal(ratingChange(1000,1000,12,10),9);
  assert.equal(ratingChange(1000,1000,12,0),16);
  assert.equal(ratingChange(1000,1000,11,7),11);
  assert.ok(ratingChange(900,1100,12,10) > ratingChange(1100,900,12,10));
  assert.equal(ratingChange(3000,100,12,10),1);
});
test("invalid scores cannot produce rating changes", () => {
  for (const score of [[0,0],[12,12],[10,12],[12,-1],[12.5,10],[100,0]]) assert.throws(() => ratingChange(1000,1000,...score),RangeError);
});
