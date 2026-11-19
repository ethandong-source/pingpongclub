"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const activity = require("../player-activity");
const actions = require("../club-actions");
const ratings = require("../ratings");

test("archives only after 30 days, preserving unknown and future dates", () => {
  const start = Date.parse("2026-01-01T00:00:00Z"), p = {name:"A",lastRatedAt:new Date(start).toISOString()};
  assert.equal(activity.isArchived(p,new Map(),start + activity.INACTIVE_AFTER), false);
  assert.equal(activity.isArchived(p,new Map(),start + activity.INACTIVE_AFTER + 1), true);
  assert.equal(activity.isArchived({name:"Unknown"},new Map(),start), false);
  assert.equal(activity.isArchived({name:"New",createdAt:new Date(start).toISOString()},new Map(),start + activity.INACTIVE_AFTER + 1), true);
  assert.equal(activity.isArchived(p,new Map(),start - 1), false);
  assert.equal(activity.isArchived({archived:true},new Map(),start), true);
});
test("finds singles and doubles activity and returns when a match is recorded", () => {
  const old = '2026-01-01T00:00:00Z', recent = '2026-03-01T00:00:00Z';
  const matches = [{winnerName:'A',loserName:'B',date:old},{type:'doubles',winnerNames:['A','C'],loserNames:['D','E'],date:recent}];
  const dates = activity.lastMatches(matches), now = Date.parse(recent);
  assert.equal(activity.isArchived({name:'B'},dates,now), true);
  assert.equal(activity.isArchived({name:'C'},dates,now), false);
  assert.equal(activity.isArchived({name:'C',archived:true},dates,now), true);
  matches.push({winnerName:'B',loserName:'A',date:recent});
  assert.equal(activity.isArchived({name:'B'},activity.lastMatches(matches),now), false);
  matches.pop();
  assert.equal(activity.isArchived({name:'B'},activity.lastMatches(matches),now), true);
});
test("new players get a creation date", () => {
  const db = {players:[],matches:[],ratingSystem:ratings.settings()};
  const player = actions.addPlayer(db,'A').player;
  assert.ok(Number.isFinite(Date.parse(player.createdAt)));
});
test("an inactive player can play, return, and become inactive again if the match is undone", () => {
  const db = {players:[],matches:[],ratingSystem:ratings.settings()};
  const a = actions.addPlayer(db,'A').player;
  actions.addPlayer(db,'B');
  a.createdAt = '2020-01-01T00:00:00Z';
  assert.equal(activity.isArchived(a,activity.lastMatches(db.matches)), true);
  actions.addMatch(db,{winnerName:'A',loserName:'B',winnerScore:11,loserScore:9},{username:'editor'});
  assert.equal(activity.isArchived(a,activity.lastMatches(db.matches)), false);
  actions.undoMatch(db);
  assert.equal(activity.isArchived(a,activity.lastMatches(db.matches)), true);
});
