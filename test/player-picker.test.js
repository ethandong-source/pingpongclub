const {test}=require('node:test');
const assert=require('node:assert/strict');
const {filter,mount}=require('../player-picker');
const players=['Sharan Vangala','Swadhin','Dhruv Singh','Alok Desai','Ethan dong','Ethan Mugilan'].map((name,i)=>({name,elo:1000+i}));
test('suggestions narrow by a case-insensitive name prefix, including surnames',()=>{
  assert.deepEqual(filter(players,'s').map(p=>p.name),['Sharan Vangala','Swadhin']);
  assert.deepEqual(filter(players,'Sh').map(p=>p.name),['Sharan Vangala']);
  assert.deepEqual(filter(players,'sHAra').map(p=>p.name),['Sharan Vangala']);
  assert.deepEqual(filter(players,'des').map(p=>p.name),['Alok Desai']);
  assert.equal(filter(players,'Ethan M').length,1);
  assert.deepEqual(filter([...players,{name:'Vachan Dave'}],'Va').map(p=>p.name),['Vachan Dave']);
  assert.equal(filter(players,'zzz').length,0);
  assert.equal(filter([...players,{name:'Shawn',archived:true}],'sh').length,1);
});
class Element{
  constructor(){this.children=[];this.attrs={};this.events={};this.value='';}
  setAttribute(k,v){this.attrs[k]=v;}
  getAttribute(k){return this.attrs[k];}
  removeAttribute(k){delete this.attrs[k];}
  replaceChildren(...children){this.children=children;}
  append(...children){this.children.push(...children);}
  addEventListener(event,fn){(this.events[event]??=[]).push(fn);}
  contains(node){return node===this || this.children.some(c=>c.contains(node));}
  matches(){return this.disabled||false;}
  setCustomValidity(message){this.error=message;}
  scrollIntoView(){}
  focus(){this.onfocus?.();}
}
function setup(){
  const input=new Element(),list=new Element(),container=new Element(),form=new Element();
  input.id='winner';input.setAttribute('aria-controls','winnerOptions');
  input.parentElement=container;container.append(input,list);input.form=form;
  input.ownerDocument={getElementById:()=>list,createElement:()=>new Element()};
  let changes=0;
  const picker=mount(input,{onChange:()=>changes++});picker.setRoster(players);
  function type(value){input.value=value;input.oninput();}
  function key(key){let prevented=false;input.onkeydown({key,preventDefault:()=>{prevented=true;}});return prevented;}
  return {input,list,container,form,picker,type,key,changes:()=>changes};
}
test('typing filters the menu; arrows and Enter choose a canonical member without submitting',()=>{
  const ui=setup();ui.type('sh');
  assert.equal(ui.input.attrs['aria-expanded'],'true');assert.equal(ui.list.children.length,1);
  assert.match(ui.input.error,/Choose a player/);
  ui.key('ArrowDown');assert.equal(ui.input.attrs['aria-activedescendant'],'winnerOption0');
  assert.equal(ui.key('Enter'),true);assert.equal(ui.input.value,'Sharan Vangala');
  assert.equal(ui.input.error,'');assert.equal(ui.list.hidden,true);assert.ok(ui.changes()>0);
});
test('Tab completes a unique suggestion but leaves ambiguous names for an explicit choice',()=>{
  const ui=setup();ui.type('alo');assert.equal(ui.key('Tab'),false);assert.equal(ui.input.value,'Alok Desai');
  ui.type('Ethan');ui.key('Tab');assert.equal(ui.input.value,'Ethan');assert.match(ui.input.error,/Choose a player/);
  ui.input.onfocus();assert.equal(ui.list.children.length,2);ui.list.children[1].onclick();
  assert.equal(ui.input.value,'Ethan Mugilan');assert.equal(ui.input.error,'');
});
test('Escape closes suggestions, no matches cannot select, and removed players become invalid',()=>{
  const ui=setup();ui.type('zzzz');assert.equal(ui.list.children[0].textContent,'No matching players');
  ui.key('Enter');assert.equal(ui.input.value,'zzzz');ui.key('Escape');assert.equal(ui.list.hidden,true);
  ui.type('alok desai');assert.equal(ui.input.value,'Alok Desai');assert.equal(ui.input.error,'');
  ui.picker.setRoster(players.filter(p=>p.name!=='Alok Desai'));assert.match(ui.input.error,/Choose a player/);
  ui.input.disabled=true;ui.input.onfocus();assert.equal(ui.list.hidden,true);
});
test('form reset clears validity; partial text survives roster refreshes while typing',async()=>{
  const ui=setup();ui.type('Sh');ui.picker.setRoster(players.map(p=>({...p,elo:p.elo+5})));
  assert.equal(ui.input.value,'Sh');assert.equal(ui.list.children.length,1);
  ui.form.events.reset[0]();ui.input.value='';await Promise.resolve();assert.equal(ui.input.error,'');assert.equal(ui.list.hidden,true);
});
