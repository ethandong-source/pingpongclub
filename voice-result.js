(function(root,factory) {
  if (typeof module === 'object' && module.exports) module.exports=factory();
  else root.VoiceResult=factory();
})(globalThis,function() {
  'use strict';
  const units=['zero','one','two','three','four','five','six','seven','eight','nine'];
  const teens=['ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const tens=['twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  const numberPattern=`(?:\\d{1,2}|(?:${tens.join('|')})(?:[ -](?:${units.slice(1).join('|')}))?|${[...units,...teens,'oh','nil','love','won','ate'].join('|')})`;
  const ending=new RegExp(`\\b(${numberPattern})\\s*(?:[-–—:/,]|\\bto\\b|\\bdash\\b|\\bhyphen\\b|\\bby\\b|\\s)\\s*(${numberPattern})(?:\\s+points?)?[.!?\\s]*$`,'i');
  function normalized(text) {
    return String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  }
  function number(text) {
    if (/^\d+$/.test(text)) return Number(text);
    const words=normalized(text).split(' ');
    if (words.length===2 && tens.includes(words[0]) && units.includes(words[1])) return (tens.indexOf(words[0])+2)*10+units.indexOf(words[1]);
    if (units.includes(words[0])) return units.indexOf(words[0]);
    if (teens.includes(words[0])) return teens.indexOf(words[0])+10;
    if (tens.includes(words[0])) return (tens.indexOf(words[0])+2)*10;
    return ({oh:0,nil:0,love:0,won:1,ate:8})[words[0]];
  }
  function distance(a,b) {
    let previous=Array.from({length:b.length+1},(_,i)=>i);
    for (let i=1;i<=a.length;i++) {
      const row=[i];
      for (let j=1;j<=b.length;j++) row[j]=Math.min(row[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));
      previous=row;
    }
    return previous[b.length];
  }
  function phonetic(text) {
    return text.replace(/ph/g,'f').replace(/sh|ch/g,'s').replace(/ck|qu|c|q/g,'k').replace(/[aeiouy\s]/g,'').replace(/(.)\1+/g,'$1');
  }
  function aliases(name) {
    const full=normalized(name),parts=full.split(' ').filter(p=>!['ii','iii','iv','jr','sr'].includes(p));
    return [...new Set([full,parts[0],parts.at(-1)])];
  }
  function resolveName(spoken,roster) {
    const phrase=normalized(spoken),compact=phrase.replace(/ /g,'');
    const players=roster.filter(p=>!p.archived);
    const exact=players.filter(p=>aliases(p.name).some(a=>a===phrase || a.replace(/ /g,'')===compact));
    if (exact.length) return {spoken,candidates:exact.map(p=>({name:p.name,score:1})),name:exact.length===1?exact[0].name:null};
    const candidates=players.map(p=>({name:p.name,score:Math.max(...aliases(p.name).map(alias=>{
      const key=alias.replace(/ /g,'');
      let score=compact.length<3?0:1-distance(compact,key)/Math.max(compact.length,key.length);
      const sound=phonetic(key);
      if (compact.length>=3 && sound.length>=2 && sound===phonetic(compact)) score=Math.max(score,.86);
      return score;
    }))})).filter(p=>p.score>=.45).sort((a,b)=>b.score-a.score || a.name.localeCompare(b.name));
    const best=candidates[0],runner=candidates[1];
    return {spoken,candidates:candidates.slice(0,4),name:best && best.score>=.74 && (!runner || best.score-runner.score>=.12)?best.name:null};
  }
  function clean(text) {
    return text.trim().replace(/^[\s,.:;]+|[\s,.:;]+$/g,'').replace(/^(?:please\s+)?(?:record\s+(?:that\s+)?|add\s+(?:a\s+)?(?:match\s+)?)?/i,'').replace(/\s+(?:by|with(?:\s+a)?(?:\s+score(?:\s+of)?)?|score(?:\s+of)?)$/i,'').trim();
  }
  function parse(transcript,roster) {
    const text=String(transcript).trim();
    const score=text.match(ending);
    if (!score) throw new Error('Include both scores, for example: “Sharan won against Alok, nine to one.”');
    const scores=[number(score[1]),number(score[2])];
    if (scores.some(n=>!Number.isInteger(n) || n<0 || n>99) || scores[0]===scores[1]) throw new Error('Use different whole-number scores from 0 to 99.');
    const names=text.slice(0,score.index).trim();
    const relation=/\b(lost\s+(?:to|against)|(?:won|one|1)\s+(?:against|over|versus)|beat|beats|defeated|defeats|versus|vs\.?|against|won|one|1)\b/i.exec(names);
    if (!relation) throw new Error('Say who played whom: “Sharan against Alok, nine to one.”');
    const left=clean(names.slice(0,relation.index)),right=clean(names.slice(relation.index+relation[0].length));
    const team=text=>text.split(/\s*(?:&|\band\b|\bplus\b)\s*/i).map(clean);
    const sides=[team(left),team(right)];
    if (sides.some(t=>t.some(n=>!n)) || sides[0].length!==sides[1].length || ![1,2].includes(sides[0].length)) {
      throw new Error('Say one player on each side, or two per team joined with “and”.');
    }
    const verb=relation[0].toLowerCase();
    const lost=verb.startsWith('lost'),won=/^(?:won|one|1|beat|defeat)/.test(verb);
    if ((lost && scores[0]>scores[1]) || (won && scores[0]<scores[1])) {
      throw new Error('The scores conflict with who won. Say each side’s score in the same order as the names.');
    }
    const winner=scores[0]>scores[1]?0:1;
    const slots=[...sides[winner],...sides[1-winner]].map(n=>resolveName(n,roster));
    const selected=slots.map(s=>s.name).filter(Boolean);
    if (new Set(selected).size!==selected.length) throw new Error('Each position needs a different player. Please say the full names.');
    return {type:sides[0].length===2?'doubles':'singles',teamSize:sides[0].length,slots,winnerScore:scores[winner],loserScore:scores[1-winner]};
  }
  function result(parsed,names=parsed.slots.map(s=>s.name)) {
    if (names.length!==parsed.slots.length || names.some(n=>!n) || new Set(names).size!==names.length) throw new Error('Choose a different player for every position.');
    return {type:parsed.type,winnerNames:names.slice(0,parsed.teamSize),loserNames:names.slice(parsed.teamSize),winnerScore:parsed.winnerScore,loserScore:parsed.loserScore};
  }
  return {parse,result,resolveName};
});
