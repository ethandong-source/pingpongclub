"use strict";
const $ = id => document.getElementById(id);
const dateFormat = new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",month:"short",day:"numeric",year:"numeric"});
const dateLabel = date => Number.isFinite(Date.parse(date)) ? dateFormat.format(new Date(date)) : "Date unavailable";
const signed = n => n === null ? "—" : n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
function element(tag,text,classes) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (classes) el.className = classes;
  return el;
}
let chartObserver;
function renderChart(points,matchCount) {
  chartObserver?.disconnect();
  $("chart").replaceChildren();
  $("chartContent").hidden = true;
  $("chartEmpty").hidden = points.length > 0;
  if (!points.length) return;
  $("chartContent").hidden = false;
  const chart = $("chart"), range = $("matchPoint"), NS = "http://www.w3.org/2000/svg";
  $("startDate").textContent = dateLabel(points[0].date);
  $("endDate").textContent = points[0].date === points.at(-1).date ? "" : dateLabel(points.at(-1).date);
  range.max = points.length-1;
  range.value = range.max;
  range.disabled = points.length === 1;
  const vals = points.map(p => p.rating), min = Math.min(...vals), max = Math.max(...vals);
  const step = Math.max(10,Math.ceil((max-min)/40)*10);
  const low = Math.floor((min-step/2)/step)*step, high = Math.ceil((max+step/2)/step)*step;
  let marker, guide, coords, width;
  function select() {
    const i = Number(range.value), p = points[i], [x,y] = coords[i];
    marker.setAttribute("cx",x); marker.setAttribute("cy",y);
    guide.setAttribute("x1",x); guide.setAttribute("x2",x);
    const detail = p.number === 0 ? `Before first match: ${p.rating} rating` :
      `${dateLabel(p.date)} · ${p.won ? "Win" : "Loss"} ${p.score} ${p.teammate ? "with "+p.teammate+" " : ""}vs ${p.opponents.join(" & ")} · ${p.rating} rating (${signed(p.delta)})`;
    range.setAttribute("aria-valuetext",detail);
    $("pointDetail").textContent = detail;
  }
  function draw() {
    width = Math.max(240,Math.round(chart.clientWidth));
    const height = 222, left = 44, right = width-12, bottom = height-15;
    const svg = document.createElementNS(NS,"svg");
    svg.setAttribute("viewBox",`0 0 ${width} ${height}`);
    svg.setAttribute("role","img"); svg.setAttribute("aria-label","Rating trend. Use the slider below to inspect individual matches.");
    const add = (tag,attrs,text) => {
      const el = document.createElementNS(NS,tag);
      for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
      if (text !== undefined) el.textContent = text;
      svg.append(el); return el;
    };
    const y = rating => bottom-(rating-low)/(high-low)*(bottom-13);
    const x = n => left+(right-left)*n/Math.max(1,matchCount);
    for (let n=low;n<=high;n+=step) {
      add("line",{x1:left,x2:right,y1:y(n),y2:y(n),stroke:"#d8e1d9"});
      add("text",{x:left-8,y:y(n)+4,"text-anchor":"end","font-size":12,fill:"#53695e"},n);
    }
    coords = points.map(p => [x(p.number),y(p.rating)]);
    const path = coords.map(([cx,cy],i) => `${i && points[i].number===points[i-1].number+1 ? "L" : "M"}${cx} ${cy}`).join(" ");
    add("path",{d:path,fill:"none",stroke:"#1e5138","stroke-width":2.7,"stroke-linejoin":"round"});
    coords.forEach(([cx,cy]) => add("circle",{cx,cy,r:points.length>60?1.4:2.5,fill:"#1e5138"}));
    guide = add("line",{y1:13,y2:bottom,stroke:"#9f7927","stroke-dasharray":"4 4"});
    marker = add("circle",{r:5,fill:"#d5a440",stroke:"#1e5138","stroke-width":2});
    svg.addEventListener("pointerdown",e => {
      const rect = svg.getBoundingClientRect(), px = (e.clientX-rect.left)*width/rect.width;
      range.value = coords.reduce((best,point,i) => Math.abs(point[0]-px)<Math.abs(coords[best][0]-px)?i:best,0);
      select();
    });
    chart.replaceChildren(svg); select();
  }
  range.oninput = select;
  draw();
  chartObserver = new ResizeObserver(entries => { if (Math.round(entries[0].contentRect.width) !== width) draw(); });
  chartObserver.observe(chart);
}
function render(data,player) {
  document.title = `${player.name} | Carroll Ping Pong Club`;
  const {history,points,streak,bestStreak,records,bestWin,peak} = PlayerStats.summarize(player,data.matches);
  const leaders = data.players.filter(p => !p.archived).sort((a,b) => b.elo-a.elo || a.name.localeCompare(b.name));
  const rank = leaders.indexOf(player)+1, total = player.wins+player.losses;
  $("rank").textContent = rank ? `#${rank} on the club leaderboard` : "Archived player";
  $("playerName").textContent = player.name;
  $("record").textContent = `${player.wins} wins, ${player.losses} losses${total ? ` · ${Math.round(player.wins/total*100)}% win rate` : ""}`;
  $("currentRating").textContent = player.elo;
  for (const id of ["highlights","recentForm","history"]) $(id).replaceChildren();
  const stats = [
    ["Peak recorded rating",peak],["Current streak",streak ? `${Math.abs(streak)} ${streak>0?"W":"L"}` : "—"],
    ["Longest win streak",bestStreak ? `${bestStreak} W` : "—"],
    ["Singles record",`${records[0].wins}–${records[0].losses}`],["Doubles record",`${records[1].wins}–${records[1].losses}`],
    ["Biggest rating gain",bestWin ? `${signed(bestWin.delta)} pts` : "—"]
  ];
  for (const [label,value] of stats) {
    const row = element("div");row.append(element("dt",label),element("dd",value));$("highlights").append(row);
  }
  if (history.length) {
    $("recentForm").append(element("strong","Last 5 results"));
    for (const m of history.slice(-5)) {
      const chip = element("span",m.won?"W":"L",m.won?"result":"result loss");
      chip.setAttribute("aria-label",m.won?"Win":"Loss"); $("recentForm").append(chip);
    }
  }
  $("historyEmpty").hidden = history.length > 0;
  for (const m of [...history].reverse()) {
    const li = element("li"), body = element("div");
    body.append(element("p",`${m.teammate ? "With "+m.teammate+" · " : ""}vs ${m.opponents.join(" & ")}`),
      element("p",`${m.doubles?"Doubles":"Singles"} · ${m.score} · ${dateLabel(m.date)}`,"meta"));
    const result = element("span",m.won?"W":"L",m.won?"result":"result loss");
    result.setAttribute("aria-label",m.won?"Win":"Loss");
    li.append(result,body,element("span",signed(m.delta),"delta")); $("history").append(li);
  }
  $("status").hidden = true; $("profile").hidden = false;
  renderChart(points,history.length);
}
async function load() {
  const name = new URLSearchParams(location.search).get("name");
  if (!name) { $("status").textContent = "Choose a player from the leaderboard or roster."; return; }
  const showError = text => {
    $("status").hidden = false; $("profile").hidden = true;
    $("status").textContent = text;
  };
  try {
    const {subscribe} = await import("/static-club.mjs");
    subscribe(data => {
      const player = data.players.find(p => p.name === name);
      if (player) render(data,player);
      else showError("Player not found. Check the roster for their current name.");
    }, () => showError("Could not load club data. Refresh to try again."));
  } catch { showError("Could not connect to the club data. Refresh to try again."); }
}
load();
