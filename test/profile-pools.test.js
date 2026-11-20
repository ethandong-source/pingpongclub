'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ClubRatings=require('../ratings'),PlayerStats=require('../player-stats'),PlayerActivity=require('../player-activity');
test('profile header uses the selected pool for its rating, record and win percentage',()=>{
  const source=fs.readFileSync(require.resolve('../player.js'),'utf8');
  const player={name:'A',elo:1200,wins:9,losses:1,archived:false,doubles:{elo:950,wins:2,losses:3}};
  for(const [type,expected,rating] of [['singles','9 wins, 1 losses · 90% win rate',1200],['doubles','2 wins, 3 losses · 40% win rate',950]]){
    const nodes=new Map();
    const node=()=>({value:'',textContent:'',append(){},replaceChildren(){},setAttribute(){}});
    const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node};
    document.getElementById('profileMode').value=type;
    const context={document,ClubRatings,PlayerStats,PlayerActivity,data:{players:[player],matches:[]}};
    vm.runInNewContext(source.slice(0,source.lastIndexOf('load();'))+'\nrenderChart=()=>{};render(data,data.players[0]);',context);
    assert.equal(nodes.get('record').textContent,expected);
    assert.equal(nodes.get('currentRating').textContent,rating);
  }
});
