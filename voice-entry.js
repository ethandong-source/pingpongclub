(function(root,factory) {
  if (typeof module === 'object' && module.exports) module.exports=factory(require('./voice-result'));
  else root.VoiceEntry=factory(root.VoiceResult);
})(globalThis,function(parser) {
  'use strict';
  function mount({root,roster,canEdit,apply,signature,Recognition}) {
    const get=id=>root.querySelector('#'+id),doc=root.ownerDocument;
    const mic=get('voiceStart'),panel=get('voiceTranscriptPanel'),text=get('voiceTranscript'),status=get('voiceStatus');
    const choices=get('voiceChoices'),pickers=get('voicePickers');
    const toggle=get('voiceTextToggle');
    let recognition=null,timer=null,pending=null,selects=[];
    const say=message=>{status.textContent=message;};
    function showTranscript(open) {
      panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));
      toggle.textContent=open?'Hide transcript':text.value?'Edit transcript':'Type a result instead';
    }
    function stop() {
      const previous=recognition;
      recognition=null;
      clearTimeout(timer);
      mic.setAttribute('aria-pressed','false');
      get('voiceButtonText').textContent='Speak result';
      if (previous) { try { previous.abort(); } catch {} }
    }
    function reset() {
      stop();pending=null;selects=[];choices.hidden=true;pickers.replaceChildren();text.value='';showTranscript(false);say('');
    }
    function fill(parsed,names) {
      if (!canEdit()) { say('Unlock the editor before filling a result.');return; }
      const result=parser.result(parsed,names),active=new Set(roster().filter(p=>!p.archived).map(p=>p.name));
      if (![...result.winnerNames,...result.loserNames].every(n=>active.has(n))) throw new Error('The roster changed. Please check the player names again.');
      apply(result);
      choices.hidden=true;pending=null;
      showTranscript(false);
      say(`${result.winnerNames.join(' & ')} ${result.winnerScore}–${result.loserScore} ${result.loserNames.join(' & ')}. Fields filled — check the result, then save.`);
    }
    function review(parsed) {
      pending=parsed;selects=[];pickers.replaceChildren();choices.hidden=false;
      parsed.slots.forEach((slot,index)=>{
        if (slot.name) return;
        const label=doc.createElement('label'),select=doc.createElement('select');
        select.id='voiceName'+index;label.htmlFor=select.id;
        label.textContent=`Who did you mean by “${slot.spoken}”?`;
        const ordered=[...slot.candidates.map(p=>p.name),...roster().filter(p=>!p.archived).map(p=>p.name)];
        const placeholder=doc.createElement('option');placeholder.value='';placeholder.textContent='Choose a club member…';select.append(placeholder);
        for (const name of new Set(ordered)) {const option=doc.createElement('option');option.value=name;option.textContent=name;select.append(option);}
        selects.push({index,select});pickers.append(label,select);
      });
      say('I need help with a name. Choose the club member below; your match fields have not changed.');
      selects[0]?.select.focus();
    }
    function interpret(transcript) {
      if (!canEdit()) return;
      choices.hidden=true;pending=null;
      try {
        const parsed=parser.parse(transcript,roster());
        if (parsed.slots.every(s=>s.name)) fill(parsed);
        else review(parsed);
      } catch(error) {say(error.message);}
    }
    function sync() {
      mic.disabled=!Recognition;
      if (!Recognition) get('voiceSupport').textContent='Voice entry is unavailable in this browser. You can type the same sentence below.';
      if (!canEdit() && recognition) {stop();say('Listening stopped. Open Matches and unlock the editor to try again.');}
    }
    toggle.onclick=()=>{stop();showTranscript(panel.hidden);if(!panel.hidden)text.focus();};
    get('voiceFill').onclick=()=>{stop();interpret(text.value);};
    text.oninput=()=>{pending=null;choices.hidden=true;};
    get('voiceChoose').onclick=()=>{
      if (!pending) return;
      const names=pending.slots.map(s=>s.name);
      selects.forEach(({index,select})=>{names[index]=select.value;});
      try {fill(pending,names);} catch(error) {say(error.message);}
    };
    mic.onclick=()=>{
      if (!canEdit() || !Recognition) return;
      if (recognition) {stop();say('Listening cancelled. Tap Speak result to try again.');return;}
      const initial=signature();
      choices.hidden=true;pending=null;text.value='';showTranscript(true);
      try {
        const current=new Recognition();recognition=current;
        current.lang='en-US';current.continuous=false;current.interimResults=true;current.maxAlternatives=5;
        mic.setAttribute('aria-pressed','true');get('voiceButtonText').textContent='Cancel listening';
        say('Listening… say both names and the score.');
        current.onresult=event=>{
          if (recognition!==current || !canEdit()) return;
          const final=Array.from(event.results).find(r=>r.isFinal);
          if (!final) {text.value=Array.from(event.results).map(r=>r[0]?.transcript||'').join(' ');return;}
          const alternatives=Array.from(final).map(a=>a.transcript);
          // Prefer a complete roster match from the browser's alternatives, then
          // ask for clarification rather than guessing an uncertain name.
          const parsed=alternatives.map(transcript=>{
            try {return {transcript,result:parser.parse(transcript,roster())};} catch {return {transcript};}
          });
          const best=parsed.find(p=>p.result?.slots.every(s=>s.name)) || parsed.find(p=>p.result) || parsed[0];
          text.value=best?.transcript||'';
          stop();
          if (signature()!==initial) {say('Your form changed while listening. Choose Fill fields to use this transcript.');return;}
          interpret(text.value);
        };
        current.onerror=event=>{
          if (recognition!==current) return;
          stop();
          say(({
            'not-allowed':'Microphone access was blocked. Allow it in your browser, or type the result below.',
            'service-not-allowed':'Speech recognition is unavailable. Type the result below instead.',
            'audio-capture':'No microphone was found. Check your microphone or type the result below.',
            'network':'Speech recognition could not connect. Try again, or type the result below.',
            'no-speech':'I did not hear a result. Try again, or type the result below.',
            'aborted':'Listening cancelled.'
          })[event.error] || 'I could not transcribe that. Try again, or type the result below.');
        };
        current.onend=()=>{if(recognition===current){stop();say('No complete result was heard. Try again, or edit the transcript and choose Fill fields.');}};
        timer=setTimeout(()=>{if(recognition===current){stop();say('Listening timed out. Try a short sentence with both names and the score.');}},15000);
        current.start();
      } catch {stop();say('Speech recognition could not start. Try again, or type the result below.');}
    };
    sync();
    return {sync,reset,stop};
  }
  return {mount};
});
