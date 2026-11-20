// Explicit, offline migration only. Never runs while reading or saving club data.
'use strict';
const ratings = require('./ratings');
function rebuild(database) {
  const db = structuredClone(database);
  if (!Array.isArray(db.players) || !Array.isArray(db.matches)) throw new Error('Invalid club data.');
  const baseline = () => ({elo:1000,rd:350,lastRatedAt:null,wins:0,losses:0});
  const participants = new Map();
  for (const p of db.players) {
    if (!p.name || participants.has(p.name)) throw new Error('Missing or duplicate player name.');
    Object.assign(p,baseline(),{doubles:baseline()});
    participants.set(p.name,p);
  }
  const ordered = db.matches.map((match,index)=>({match,index,time:Date.parse(match.date)}));
  if (ordered.some(m=>!Number.isFinite(m.time))) throw new Error('Every match must have a valid date.');
  ordered.sort((a,b)=>a.time-b.time || a.index-b.index);
  const snapshot = p => ({elo:p.elo,rd:p.rd,lastRatedAt:p.lastRatedAt,wins:p.wins,losses:p.losses});
  for (const {match:m} of ordered) {
    const type=m.type === 'doubles' ? 'doubles' : 'singles';
    if (m.type && !['singles','doubles'].includes(m.type)) throw new Error('Unsupported match type.');
    const names=ratings.matchTeams(m),size=type==='doubles'?2:1;
    if (!names.every(t=>Array.isArray(t)&&t.length===size&&t.every(n=>typeof n==='string'&&n)) || new Set(names.flat()).size!==size*2) throw new Error('Invalid match participants.');
    const score=String(m.score).match(/^(\d+)\s*[-–:]\s*(\d+)$/);
    if (!score) throw new Error('Every match needs a recorded score.');
    const options=ratings.forNewMatch({...ratings.DEFAULTS,name:ratings.SCORE_SYSTEM,winnerScore:Number(score[1]),loserScore:Number(score[2])});
    // Deleted members are simulated as opponents without recreating their accounts.
    const teams=names.map(team=>team.map(name=>{
      if (!participants.has(name)) participants.set(name,{name,...baseline(),doubles:baseline()});
      return ratings.ratingFor(participants.get(name),type);
    }));
    if (type==='doubles') {
      const next=ratings.previewDoubles(...teams,m.date,options);
      m.before={winners:teams[0].map(snapshot),losers:teams[1].map(snapshot)};
      m.winnerChanges=next.winnerChanges;m.loserChanges=next.loserChanges;
      teams.forEach((team,side)=>team.forEach((p,i)=>{
        Object.assign(p,next[side===0?'winners':'losers'][i],{lastRatedAt:m.date});
        p[side===0?'wins':'losses']++;
      }));
    } else {
      const w=teams[0][0],l=teams[1][0],next=ratings.preview(w,l,m.date,options);
      m.before={winner:snapshot(w),loser:snapshot(l)};
      m.winnerChange=next.winnerChange;m.loserChange=next.loserChange;
      Object.assign(w,next.winner,{lastRatedAt:m.date,wins:w.wins+1});
      Object.assign(l,next.loser,{lastRatedAt:m.date,losses:l.losses+1});
    }
    m.ratingPool=type;m.ratingSystem=ratings.ACTIVE_SYSTEM;m.ratingPolicyVersion=ratings.ACTIVE_POLICY.version;
  }
  db.matches=ordered.map(({match})=>match);
  return db;
}
module.exports={rebuild};
