(function(root,factory){
  if(typeof module==='object' && module.exports) module.exports=factory();
  else root.PlayerPicker=factory();
})(globalThis,function(){
  'use strict';
  const normalize=value=>String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
  function filter(players,query){
    const text=normalize(query);
    const active=players.filter(p=>!p.archived).sort((a,b)=>a.name.localeCompare(b.name));
    if(!text)return active;
    const first=active.filter(p=>normalize(p.name).startsWith(text));
    // First names take priority so "Va" finds Vachan rather than also matching
    // Sharan Vangala. Surnames remain searchable when no first name matches.
    return first.length?first:active.filter(p=>normalize(p.name).split(' ').slice(1).some(word=>word.startsWith(text)));
  }
  function mount(input,{onChange}){
    const doc=input.ownerDocument,list=doc.getElementById(input.getAttribute('aria-controls')),container=input.parentElement;
    let roster=[],shown=[],active=-1,open=false;
    function close(){open=false;list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;}
    function validate(){
      const exact=roster.find(p=>!p.archived && normalize(p.name)===normalize(input.value));
      if(exact) input.value=exact.name;
      input.setCustomValidity(input.value && !exact?'Choose a player from the suggestions.':'');
      return exact;
    }
    function highlight(index){
      active=index;
      [...list.children].forEach((item,i)=>item.setAttribute('aria-selected',String(i===active)));
      if(active>=0){input.setAttribute('aria-activedescendant',list.children[active].id);list.children[active].scrollIntoView({block:'nearest'});}
      else input.removeAttribute('aria-activedescendant');
    }
    function choose(player){
      if(input.matches(':disabled') || !roster.some(p=>!p.archived && p.name===player.name)) return;
      input.value=player.name;validate();close();onChange();
    }
    function show(){
      if(input.matches(':disabled')){close();return;}
      shown=filter(roster,input.value);list.replaceChildren();
      shown.forEach((player,index)=>{
        const item=doc.createElement('li'),name=doc.createElement('span'),rating=doc.createElement('span');
        item.setAttribute('role','option');item.id=input.id+'Option'+index;item.setAttribute('aria-selected','false');
        item.tabIndex=-1;item.className='player-option';
        name.textContent=player.name;rating.textContent=player.elo+' rating';rating.className='player-option-rating';
        item.append(name,rating);item.onmousedown=event=>event.preventDefault();
        item.onclick=()=>{choose(player);input.focus();close();};
        list.append(item);
      });
      if(!shown.length){const empty=doc.createElement('li');empty.textContent='No matching players';empty.className='player-no-match';empty.setAttribute('role','option');empty.setAttribute('aria-disabled','true');list.append(empty);}
      open=true;list.hidden=false;input.setAttribute('aria-expanded','true');highlight(-1);
    }
    input.onfocus=show;
    input.oninput=()=>{validate();show();onChange();};
    input.onkeydown=event=>{
      if(event.key==='ArrowDown' || event.key==='ArrowUp'){
        event.preventDefault();if(!open)show();
        if(shown.length)highlight(event.key==='ArrowDown'?(active+1)%shown.length:(active<=0?shown.length:active)-1);
      }else if(event.key==='Enter'){
        event.preventDefault();if(!open)show();
        if(shown.length)choose(shown[active<0?0:active]);
      }else if(event.key==='Escape'){event.preventDefault();close();}
      else if(event.key==='Tab'){
        const matches=filter(roster,input.value);
        if(input.value.trim() && matches.length===1)choose(matches[0]);
        close();
      }
    };
    container.addEventListener('focusout',event=>{if(!container.contains(event.relatedTarget)){validate();close();onChange();}});
    input.form?.addEventListener('reset',()=>{close();queueMicrotask(()=>validate());});
    return {close,setRoster(players){roster=players;validate();if(input.matches(':disabled'))close();else if(open)show();}};
  }
  return {filter,mount};
});
