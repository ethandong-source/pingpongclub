const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mount}=require('../voice-entry');
class Element {
  constructor(){this.children=[];this.value='';this.hidden=false;this.attributes={};this.textContent='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  setAttribute(key,value){this.attributes[key]=value;}
  focus(){this.focused=true;}
}
function setup(t,support=true){
  const ids=['voiceStart','voiceTranscriptPanel','voiceTranscript','voiceStatus','voiceChoices','voicePickers','voiceButtonText','voiceSupport','voiceTextToggle','voiceFill','voiceChoose'];
  const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
  elements.voiceChoices.hidden=true;elements.voiceTranscriptPanel.hidden=true;
  const root={querySelector:selector=>elements[selector.slice(1)],ownerDocument:{createElement:()=>new Element()}};
  const state={editable:true,signature:'unchanged',roster:['Sharan Vangala','Alok Desai','Ethan dong','Ethan Mugilan'].map(name=>({name})),applied:[],instances:[]};
  class Recognition {
    constructor(){state.instances.push(this);}
    start(){this.started=true;}
    abort(){this.aborted=true;}
    result(transcripts,final=true){this.onresult({results:[Object.assign(transcripts.map(transcript=>({transcript})),{isFinal:final})]});}
  }
  const controller=mount({root,roster:()=>state.roster,canEdit:()=>state.editable,signature:()=>state.signature,apply:result=>state.applied.push(result),Recognition:support?Recognition:undefined});
  t.after(()=>controller.stop());
  return {e:elements,state,controller};
}
test('typed fallback fills a draft and ambiguous names wait for explicit selection',t=>{
  const {e,state}=setup(t,false);
  assert.equal(e.voiceStart.disabled,true);
  e.voiceTextToggle.onclick();assert.equal(e.voiceTranscriptPanel.hidden,false);
  e.voiceTranscript.value='Sharan won against Alok 9-1';e.voiceFill.onclick();
  assert.equal(state.applied.length,1);assert.equal(state.applied[0].winnerScore,9);
  e.voiceTranscript.value='Ethan won against Alok 11-9';e.voiceFill.onclick();
  assert.equal(state.applied.length,1);assert.equal(e.voiceChoices.hidden,false);
  const picker=e.voicePickers.children[1];picker.value='Ethan Mugilan';e.voiceChoose.onclick();
  assert.equal(state.applied.length,2);assert.equal(state.applied[1].winnerNames[0],'Ethan Mugilan');
  assert.match(e.voiceStatus.textContent,/check the result, then save/);
});
test('recognition alternatives use roster-aware matching; interim speech never fills the draft',t=>{
  const {e,state}=setup(t);e.voiceStart.onclick();const recognition=state.instances[0];
  assert.equal(recognition.maxAlternatives,5);assert.equal(recognition.continuous,false);
  recognition.result(['Sharon'],false);assert.equal(state.applied.length,0);
  recognition.result(['random words without score','Sharon won against a lock nine one']);
  assert.equal(state.applied.length,1);assert.equal(state.applied[0].loserNames[0],'Alok Desai');
  assert.equal(recognition.aborted,true);assert.equal(e.voiceStart.attributes['aria-pressed'],'false');
});
test('voice results cannot overwrite a manually edited or locked form',t=>{
  const {e,state,controller}=setup(t);e.voiceStart.onclick();const recognition=state.instances[0];
  state.signature='manually edited';recognition.result(['Sharan beat Alok 11-9']);
  assert.equal(state.applied.length,0);assert.match(e.voiceStatus.textContent,/form changed/);
  e.voiceFill.onclick();assert.equal(state.applied.length,1);
  e.voiceStart.onclick();const second=state.instances[1];state.editable=false;controller.sync();
  assert.equal(second.aborted,true);second.result(['Sharan beat Alok 11-1']);assert.equal(state.applied.length,1);
});
test('microphone errors, cancellation, and reset leave scores untouched and enable retry',t=>{
  const {e,state,controller}=setup(t);e.voiceStart.onclick();
  state.instances[0].onerror({error:'not-allowed'});
  assert.match(e.voiceStatus.textContent,/Microphone access was blocked/);assert.equal(state.applied.length,0);
  e.voiceStart.onclick();e.voiceStart.onclick();assert.equal(state.instances[1].aborted,true);
  assert.match(e.voiceStatus.textContent,/cancelled/);
  controller.reset();assert.equal(e.voiceTranscript.value,'');assert.equal(e.voiceTranscriptPanel.hidden,true);
});
test('a roster change while resolving a name cannot fill an archived or deleted player',t=>{
  const {e,state}=setup(t);e.voiceTranscript.value='Ethan beat Alok 11-9';e.voiceFill.onclick();
  e.voicePickers.children[1].value='Ethan Mugilan';state.roster=state.roster.filter(p=>p.name!=='Ethan Mugilan');
  e.voiceChoose.onclick();assert.equal(state.applied.length,0);assert.match(e.voiceStatus.textContent,/roster changed/);
});
