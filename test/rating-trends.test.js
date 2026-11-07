const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSeries,valueAt,inRange}=require('../rating-trends');
const day=86400000,start=Date.parse('2026-11-01T12:00:00Z');
test('club trends align players by date and preserve saved singles/doubles changes, including loser gains',()=>{
  const players=[{name:'A',elo:1030},{name:'B',elo:995},{name:'C',elo:1020,archived:true},{name:'New',elo:1000}];
  const matches=[{winnerName:'A',loserName:'B',score:'11-9',date:new Date(start).toISOString(),before:{winner:{elo:1000},loser:{elo:1000}},winnerChange:10,loserChange:-5},
    {type:'doubles',winnerNames:['A','C'],loserNames:['B','Deleted'],score:'11-5',date:new Date(start+day).toISOString(),before:{winners:[{elo:1010},{elo:1000}],losers:[{elo:1005},{elo:1000}]},winnerChanges:[20,20],loserChanges:[10,15]}];
  const original=structuredClone({players,matches});
  const model=buildSeries(players,matches,start+2*day),a=model.series.find(s=>s.name==='A'),b=model.series.find(s=>s.name==='B'),c=model.series.find(s=>s.name==='C'),fresh=model.series.find(s=>s.name==='New');
  assert.equal(valueAt(a.points,start),1010);assert.equal(valueAt(b.points,start),1005);
  assert.equal(valueAt(a.points,start+day),1030);assert.equal(valueAt(b.points,start+day),995);
  assert.equal(valueAt(c.points,start),null);assert.equal(valueAt(c.points,start+day),1020);assert.equal(c.archived,true);
  assert.equal(fresh.points.length,1);assert.equal(valueAt(fresh.points,start),null);assert.equal(valueAt(fresh.points,model.end),1000);
  assert.deepEqual({players,matches},original);
});
test('range clipping carries the last saved rating to the range boundary without inventing earlier ratings',()=>{
  const points=[{time:start,rating:1000},{time:start+day,rating:1100},{time:start+3*day,rating:1050}];
  assert.deepEqual(inRange(points,start+2*day,start+3*day),[{time:start+2*day,rating:1100},{time:start+3*day,rating:1050}]);
  assert.equal(valueAt(points,start-1),null);
});
test('missing match snapshots leave gaps rather than creating false zero ratings',()=>{
  const players=[{name:'A',elo:1012}];
  const matches=[{winnerName:'A',loserName:'B',date:new Date(start).toISOString(),score:'11-9',winnerChange:10,before:{winner:{elo:1000}}},
    {winnerName:'B',loserName:'A',date:new Date(start+day).toISOString(),score:'11-9'},
    {winnerName:'A',loserName:'B',date:new Date(start+2*day).toISOString(),score:'11-9',winnerChange:12,before:{winner:{elo:1000}}}];
  const series=buildSeries(players,matches,start+3*day).series[0];
  assert.equal(valueAt(series.points,start+day),null);assert.equal(valueAt(series.points,start+2*day),1012);
});
