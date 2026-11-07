(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory(require('./player-stats'));
  else root.RatingTrends=factory(root.PlayerStats);
})(globalThis,function(stats){
  'use strict';
  const DAY=86400000;
  const colors=['#166447','#1e78a0','#bd6029','#ba404b','#547c22','#277e79','#68543c','#3c68b0','#ab6720','#7e4d50','#348b53','#386b76','#9d5232','#556f38','#9f405c','#496b95','#69753b','#357265','#8b653c'];
  function buildSeries(players,matches,now=Date.now()){
    const validTimes=matches.map(m=>Date.parse(m.date)).filter(Number.isFinite);
    const end=Math.max(now,...validTimes);
    let first=end;
    const series=[...players].sort((a,b)=>a.name.localeCompare(b.name)).map(player=>{
      const {history}=stats.summarize(player,matches),points=[];
      const initial=history[0],initialTime=Date.parse(initial?.date);
      if(Number.isFinite(initialTime) && Number.isFinite(initial.before))points.push({time:initialTime,rating:initial.before});
      for(const match of history){
        const time=Date.parse(match.date);
        if(Number.isFinite(time))points.push({time,rating:match.rating});
      }
      if(points.length)first=Math.min(first,points[0].time);
      // An unplayed member gets a current dot, not an invented historical line.
      points.push({time:end,rating:player.elo,current:true});
      return {name:player.name,archived:!!player.archived,points,current:player.elo};
    });
    return {series,start:first===end?end-DAY:first,end};
  }
  function valueAt(points,time){
    let value=null;
    for(const point of points){if(point.time>time)break;value=point.rating;}
    return value;
  }
  function inRange(points,start,end){
    const earlier=points.some(p=>p.time<start),values=points.filter(p=>p.time>=start && p.time<=end);
    if(earlier)values.unshift({time:start,rating:valueAt(points,start)});
    return values;
  }
  function mount(root){
    const doc=root.ownerDocument,get=id=>root.querySelector('#'+id),NS='http://www.w3.org/2000/svg';
    const chart=get('ratingTrendChart'),legend=get('ratingTrendLegend'),range=get('ratingTrendRange'),slider=get('ratingTrendDate');
    const dateFormat=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
    const shortDate=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric'});
    let data,model,selected=new Set(),known=new Set(),times=[],inspected=null,guide=null,width=0,start=0,end=0;
    const styles=new Map(),values=new Map();
    function style(name){
      if(!styles.has(name)){const index=styles.size;styles.set(name,{color:colors[index%colors.length],dash:['','7 3','2 3'][Math.floor(index/colors.length)%3]});}
      return styles.get(name);
    }
    function inspect(index){
      if(!times.length)return;
      slider.value=String(Math.max(0,Math.min(times.length-1,index)));inspected=times[Number(slider.value)];
      const formatted=dateFormat.format(inspected);
      slider.setAttribute('aria-valuetext',formatted);
      get('ratingTrendReadout').textContent=inspected===model.end?'Current ratings · '+formatted:'Ratings as of '+formatted;
      for(const series of model.series)values.get(series.name).textContent=valueAt(series.points,inspected)??'—';
      if(guide){const x=49+(width-67)*(inspected-start)/(end-start);guide.setAttribute('x1',x);guide.setAttribute('x2',x);}
    }
    function nearest(time){return times.reduce((best,t,i)=>Math.abs(t-time)<Math.abs(times[best]-time)?i:best,0);}
    function draw(){
      if(!model)return;
      width=Math.max(280,Math.round(chart.clientWidth));
      end=model.end;start=range.value==='all'?model.start:Math.max(model.start,end-Number(range.value)*DAY);
      if(start===end)start=end-DAY;
      const visible=model.series.filter(s=>selected.has(s.name));
      times=[...new Set([start,...model.series.flatMap(s=>s.points.filter(p=>p.time>=start && p.time<=end).map(p=>p.time)),end])].sort((a,b)=>a-b);
      slider.max=String(times.length-1);slider.disabled=!visible.length;
      get('ratingTrendCount').textContent=`${visible.length} of ${model.series.length} players shown`;
      get('ratingTrendEmpty').hidden=visible.length>0;
      chart.hidden=!visible.length;get('ratingTrendInspection').hidden=!visible.length;
      chart.replaceChildren();guide=null;
      if(!visible.length)return;
      const height=width<500?280:330,left=49,right=width-18,top=16,bottom=height-37;
      const plots=visible.map(series=>({...series,visible:inRange(series.points,start,end)}));
      const ratings=plots.flatMap(s=>s.visible.filter(p=>Number.isFinite(p.rating)).map(p=>p.rating));
      const min=Math.min(...ratings),max=Math.max(...ratings),rough=Math.max(20,(max-min)/6);
      const power=10**Math.floor(Math.log10(rough)),step=[1,2,5,10].find(n=>n*power>=rough)*power;
      const low=Math.floor((min-step*.15)/step)*step,high=Math.ceil((max+step*.15)/step)*step;
      const x=t=>left+(right-left)*(t-start)/(end-start),y=r=>bottom-(r-low)/(high-low)*(bottom-top);
      const svg=doc.createElementNS(NS,'svg');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','img');
      svg.setAttribute('aria-label','Player rating trends over time. Toggle players below and use the date slider to inspect their ratings.');
      const add=(tag,attrs,text)=>{const el=doc.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);if(text!==undefined)el.textContent=text;svg.append(el);return el;};
      for(let rating=low;rating<=high;rating+=step){
        add('line',{x1:left,x2:right,y1:y(rating),y2:y(rating),stroke:'#dce5de','stroke-dasharray':rating===1000?'4 4':''});
        add('text',{x:left-9,y:y(rating)+4,'text-anchor':'end',fill:'#5a7065','font-size':13},rating);
      }
      const ticks=width<500?2:4;
      for(let i=0;i<=ticks;i++){
        const time=start+(end-start)*i/ticks;
        add('text',{x:x(time),y:height-10,'text-anchor':i===0?'start':i===ticks?'end':'middle',fill:'#5a7065','font-size':13},shortDate.format(time));
      }
      for(const series of plots){
        const appearance=style(series.name);let path='',previous=false,last;
        for(const point of series.visible){
          if(!Number.isFinite(point.rating)){previous=false;continue;}
          path+=previous?` H${x(point.time)} V${y(point.rating)}`:` M${x(point.time)} ${y(point.rating)}`;
          previous=true;last=point;
        }
        add('path',{d:path,fill:'none',stroke:appearance.color,'stroke-width':2,'stroke-dasharray':appearance.dash,'stroke-linejoin':'round','data-player':series.name,opacity:.85});
        if(last)add('circle',{cx:x(last.time),cy:y(last.rating),r:3,fill:appearance.color});
      }
      guide=add('line',{x1:right,x2:right,y1:top,y2:bottom,stroke:'#9a7936','stroke-width':1.5,'stroke-dasharray':'4 4','pointer-events':'none'});
      const pointAt=event=>{const bounds=svg.getBoundingClientRect(),px=(event.clientX-bounds.left)*width/bounds.width;inspect(nearest(start+Math.max(0,Math.min(1,(px-left)/(right-left)))*(end-start)));};
      svg.addEventListener('pointerdown',pointAt);svg.addEventListener('pointermove',event=>{if(event.pointerType==='mouse' || event.buttons)pointAt(event);});
      chart.append(svg);inspect(inspected===null?times.length-1:nearest(inspected));
    }
    function renderLegend(){
      legend.replaceChildren();values.clear();
      for(const series of model.series){
        const label=doc.createElement('label'),input=doc.createElement('input'),swatch=doc.createElement('span'),name=doc.createElement('span'),value=doc.createElement('span');
        label.className='trend-player';input.type='checkbox';input.checked=selected.has(series.name);input.setAttribute('aria-label',series.name);
        const appearance=style(series.name);swatch.className='trend-swatch';swatch.style.borderTopColor=appearance.color;swatch.style.borderTopStyle=appearance.dash?'dashed':'solid';swatch.setAttribute('aria-hidden','true');
        name.textContent=series.name+(series.archived?' · archived':'');name.className='trend-player-name';value.className='trend-player-value';value.textContent=series.current;values.set(series.name,value);
        input.onchange=()=>{if(input.checked)selected.add(series.name);else selected.delete(series.name);draw();};label.append(input,swatch,name,value);legend.append(label);
      }
    }
    range.onchange=()=>{inspected=null;draw();};slider.oninput=()=>inspect(Number(slider.value));
    get('ratingTrendShowAll').onclick=()=>{selected=new Set(model.series.map(s=>s.name));renderLegend();draw();};
    get('ratingTrendClear').onclick=()=>{selected.clear();renderLegend();draw();};
    const observer=new ResizeObserver(()=>{if(Math.max(280,Math.round(chart.clientWidth))!==width)draw();});observer.observe(chart);
    return {update(next){
      if(next===data)return;
      const allSelected=selected.size===known.size,wasCurrent=inspected===null || inspected===model?.end;
      data=next;model=buildSeries(next.players,next.matches);
      selected=new Set(model.series.filter(s=>selected.has(s.name) || (allSelected && !known.has(s.name))).map(s=>s.name));known=new Set(model.series.map(s=>s.name));
      if(wasCurrent)inspected=null;
      renderLegend();draw();
    }};
  }
  return {buildSeries,valueAt,inRange,mount};
});
