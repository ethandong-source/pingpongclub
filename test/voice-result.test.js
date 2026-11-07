const {test}=require('node:test');
const assert=require('node:assert/strict');
const voice=require('../voice-result');
const roster=['Sharan Vangala','Alok Desai','Ethan dong','Ethan Mugilan','Cody Li','Vachan Dave','Ketan Parkith','Agasthya Akella','Jack McJunkin III'].map(name=>({name}));
test('spoken scores and won/one/1 transcripts fill canonical roster names',()=>{
  for(const phrase of [
    'Sharan won against Alok nine to one',
    'Sharan 1 against Alok 9-1',
    'Sharan one against Alok 9 – 1.',
    'Sharan beat Alok nine one',
    'Sharan defeated Alok 9:1',
    'Sharan versus Alok 9/1',
    'Please record Sharan beat Alok by nine to one'
  ]) {
    assert.deepEqual(voice.result(voice.parse(phrase,roster)),{type:'singles',winnerNames:['Sharan Vangala'],loserNames:['Alok Desai'],winnerScore:9,loserScore:1},phrase);
  }
});
test('sound-alike names and first/last/full names resolve only to active club members',()=>{
  const parsed=voice.parse('Sharon won against a lock nine to one',roster);
  assert.deepEqual(voice.result(parsed).winnerNames,['Sharan Vangala']);
  assert.deepEqual(voice.result(parsed).loserNames,['Alok Desai']);
  for(const [spoken,expected] of [['Kody','Cody Li'],['Vangala','Sharan Vangala'],['Alok Desai','Alok Desai'],['McJunkin','Jack McJunkin III']]) assert.equal(voice.resolveName(spoken,roster).name,expected);
  assert.equal(voice.resolveName('Alok',[...roster.filter(p=>p.name!=='Alok Desai'),{name:'Alok Desai',archived:true}]).name,null);
  assert.equal(voice.resolveName('zzzzzzzz',roster).name,null);
});
test('ambiguous first names require a choice; no arbitrary Ethan is selected',()=>{
  const parsed=voice.parse('Ethan against Cody eleven to nine',roster);
  assert.equal(parsed.slots[0].name,null);
  assert.deepEqual(parsed.slots[0].candidates.map(p=>p.name),['Ethan dong','Ethan Mugilan']);
  assert.throws(()=>voice.result(parsed),/different player/);
  assert.equal(voice.result(parsed,['Ethan Mugilan','Cody Li']).winnerNames[0],'Ethan Mugilan');
  assert.equal(voice.parse('Ethan Dong beat Ethan Mugilan 11-9',roster).slots[0].name,'Ethan dong');
});
test('losses and neutral versus phrasing keep each score attached to its named side',()=>{
  for(const phrase of ['Alok lost to Sharan one to nine','Alok against Sharan 1-9']) {
    assert.deepEqual(voice.result(voice.parse(phrase,roster)),{type:'singles',winnerNames:['Sharan Vangala'],loserNames:['Alok Desai'],winnerScore:9,loserScore:1});
  }
  for(const phrase of ['Alok beat Sharan 1-9','Alok lost to Sharan 9-1']) assert.throws(()=>voice.parse(phrase,roster),/conflict/);
});
test('doubles, deuce scores, and compound spoken numbers are supported',()=>{
  const parsed=voice.result(voice.parse('Sharan and Vachan against Cody and Alok twenty-one to nineteen',roster));
  assert.deepEqual(parsed,{type:'doubles',winnerNames:['Sharan Vangala','Vachan Dave'],loserNames:['Cody Li','Alok Desai'],winnerScore:21,loserScore:19});
  assert.equal(voice.parse('Sharan beat Alok ninety nine to ninety seven',roster).winnerScore,99);
  assert.equal(voice.parse('Sharan beat Alok eleven nil',roster).loserScore,0);
});
test('invalid or incomplete commands do not invent a score or duplicate participants',()=>{
  for(const phrase of ['','Sharan beat Alok','Sharan beat Alok 11-11','Sharan beat Alok 100-9','Sharan beat Sharan 11-9','Sharan and Cody beat Alok 11-9','Sharan Alok 11-9']) assert.throws(()=>voice.parse(phrase,roster),undefined,phrase);
});
