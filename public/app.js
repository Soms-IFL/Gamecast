/* IFL Simulator — client. Talks to server.js when hosted; falls back to exhibition-only when opened as a file. */
(function () {
'use strict';
const T = IFL.TEAMS;
const $ = s => document.querySelector(s);
const el = (tag, attrs, html) => { const e = document.createElement(tag); if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lum = hex => { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ink = hex => lum(hex) > 0.4 ? '#111' : '#fff';
const store = {
  get(k, sess) { try { return JSON.parse((sess ? sessionStorage : localStorage).getItem(k)); } catch (e) { return null; } },
  set(k, v, sess) { try { (sess ? sessionStorage : localStorage).setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k, sess) { try { (sess ? sessionStorage : localStorage).removeItem(k); } catch (e) {} },
};
const fmt = IFL.fmtClock;
const qLabel = q => q <= 4 ? ['', '1st', '2nd', '3rd', '4th'][q] : (q === 5 ? 'OT' : 'OT' + (q - 4));
const teamById = id => T.find(t => t.id === id);
// ---------------------------------------------------------------- logos & crests
// Logos come from public/logos (server lists them at /api/logos). Teams without one get a colour badge.
let LOGOS = {};
async function loadLogos() {
  try { const r = await fetch('/api/logos', { cache: 'no-store' }); if (r.ok) { LOGOS = await r.json(); return; } } catch (e) {}
  // opened as a file (no server): probe a few likely names
  const probe = src => new Promise(res => { const i = new Image(); i.onload = () => res(src); i.onerror = () => res(null); i.src = src; });
  await Promise.all(T.map(async t => {
    for (const n of [t.id, t.name.toLowerCase().replace(/ /g, '-'), t.city.toLowerCase().replace(/ /g, '-')]) { const ok = await probe('logos/' + n + '.png'); if (ok) { LOGOS[t.id] = ok; return; } }
  }));
}
// small inline mark: logo if present, else colour square
const sw = (t, sz) => LOGOS[t.id] ? `<img class="lgi" src="${LOGOS[t.id]}" alt="" style="width:${Math.max(18, sz || 0)}px;height:${Math.max(18, sz || 0)}px">` : `<span class="sw" style="background:${t.colors[0]}${sz ? `;width:${sz}px;height:${sz}px` : ''}"></span>`;
// team crest: logo if present, else rounded badge with the abbreviation
function crest(t, size) {
  size = size || 40;
  if (LOGOS[t.id]) return `<span class="crest img" style="width:${size}px;height:${size}px"><img src="${LOGOS[t.id]}" alt="${esc(t.full)}"></span>`;
  return `<span class="crest" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px;background:${t.colors[0]};color:${ink(t.colors[0])};box-shadow:inset 0 -${Math.max(2, Math.round(size / 12))}px 0 ${t.colors[1]}">${t.abbr}</span>`;
}
// regular-season record so far in the current season (aired games only)
// teams playing this season (expansion teams join when the next season starts)
function seasonDivisions() { const S = NET.state && NET.state.season; return IFL.divisionsFor(S && S.teams ? S.teams : (S ? IFL.ORIGINAL_TEAMS : IFL.TEAMS.map(t => t.id))); }
function divOfTeam(id) { return seasonDivisions().find(d => d.teams.includes(id)) || IFL.DIVISIONS.find(d => d.teams.includes(id)); }
function inSeason(id) { const S = NET.state && NET.state.season; return !S || !S.teams || S.teams.includes(id); }
function recordOf(id) {
  const r = { w: 0, l: 0, t: 0 };
  for (const g of seasonGames()) {
    if (!g.result || g.playoff || (g.home !== id && g.away !== id)) continue;
    const [h, a] = g.result.score, mine = g.home === id ? h : a, theirs = g.home === id ? a : h;
    if (mine > theirs) r.w++; else if (mine < theirs) r.l++; else r.t++;
  }
  return r;
}
const recStr = r => `${r.w}-${r.l}${r.t ? '-' + r.t : ''}`;
const raf = cb => { let fired = false; const f = () => { if (fired) return; fired = true; cb(); }; return { a: requestAnimationFrame(f), b: setTimeout(f, 50) }; };
const caf = id => { if (id) { cancelAnimationFrame(id.a); clearTimeout(id.b); } };
const lerp = (a, b, p) => a + (b - a) * Math.max(0, Math.min(1, p));

// time helpers
function fmtWhen(ms) {
  const d = new Date(ms), n = new Date(serverNow());
  const day0 = x => { const y = new Date(x); y.setHours(0, 0, 0, 0); return y.getTime(); };
  const dd = Math.round((day0(d) - day0(n)) / 86400000);
  const tm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (dd === 0) return 'Today ' + tm;
  if (dd === 1) return 'Tomorrow ' + tm;
  if (dd === -1) return 'Yesterday ' + tm;
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + tm;
}
function fmtIn(ms) {
  if (ms < 0) ms = 0;
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  if (h >= 24) { const d = Math.floor(h / 24); return d + 'd ' + (h % 24) + 'h'; }
  if (h) return h + 'h ' + String(m).padStart(2, '0') + 'm';
  return m + ':' + String(x).padStart(2, '0');
}

// where a game is played: "Boulder Dome, Miskauga" (+ "neutral site" when the home team isn't the host)
function venueText(v, home, short) {
  if (!v) return home.city;
  const where = v.name ? (short ? v.name : `${v.name}, ${v.town}`) : v.town;
  return where + (v.host !== home.id ? (short ? ' (neutral)' : ' · neutral site') : '');
}

// ---------------------------------------------------------------- server connection
const NET = { online: false, state: null, offset: 0, rev: 0, history: null };
function serverNow() { return Date.now() + NET.offset; }
async function poll() {
  try {
    const t0 = Date.now();
    const r = await fetch('/api/state' + (NET.rev ? '?rev=' + NET.rev : ''), { cache: 'no-store' });
    if (!r.ok) throw new Error('bad');
    const s = await r.json();
    const t1 = Date.now();
    NET.offset = s.now + (t1 - t0) / 2 - t1;
    NET.online = true;
    if (!s.unchanged) { NET.state = s; NET.rev = s.rev; NET.history = null; onState(); }
  } catch (e) {
    if (!NET.online) { NET.online = false; onState(); }
  }
}
function curRosters() { return NET.state && NET.state.season && NET.state.season.rosters ? NET.state.season.rosters : IFL.DEFAULT_ROSTERS; }
const seasonCache = {};
async function seasonDetail(n) {
  if (NET.state && NET.state.season && NET.state.season.number === n) return NET.state.season;
  if (!seasonCache[n]) { const r = await fetch('/api/history/' + n, { cache: 'no-store' }); seasonCache[n] = await r.json(); }
  return seasonCache[n];
}
async function seasonRosters(n) { try { return (await seasonDetail(n)).rosters || IFL.DEFAULT_ROSTERS; } catch (e) { return IFL.DEFAULT_ROSTERS; } }
function seasonGames() { return NET.state && NET.state.season ? NET.state.season.games : []; }
function liveGame() { const n = serverNow(); return seasonGames().find(g => g.airStart != null && g.airStart <= n && n < g.airStart + g.dur) || null; }
function nextGame() { const n = serverNow(); return seasonGames().filter(g => g.airStart != null && g.airStart > n && !g.result).sort((a, b) => a.airStart - b.airStart)[0] || null; }
function lastFinished() { const n = serverNow(); return seasonGames().filter(g => g.airStart != null && g.airStart + g.dur <= n).sort((a, b) => b.airStart - a.airStart)[0] || null; }
function gameLabel(g) { return g.label ? g.label : 'Week ' + g.week; }

// ---------------------------------------------------------------- tabs
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => showView(b.dataset.v));
let view = 'game';
function showView(v) {
  view = v;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.v === v));
  document.querySelectorAll('.view').forEach(x => x.classList.toggle('on', x.id === 'v-' + v));
  if (v === 'home') renderHome();
  if (v === 'season') renderSeason();
  if (v === 'history') renderHistory();
  if (v === 'teams') renderTeams();
  if (v === 'map') renderMap();
  if (v === 'admin') renderAdmin();
  store.set('ifl-tab', v);
  if (NET.online) renderEvBanner();
  if (v !== 'game' && Theater.on) Theater.exit();
}

// ---------------------------------------------------------------- field drawing
const SVGNS = 'http://www.w3.org/2000/svg';
const field = $('#field');
const X = a => (a + 10) * 10;
const Y = y => y * 10;
const setA = (e, k, v) => { if (typeof v === 'string' && v.startsWith('var(')) e.style.setProperty(k, v); else e.setAttribute(k, v); };
function s(tag, attrs, parent) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) setA(e, k, attrs[k]); (parent || field).appendChild(e); return e; }
let L = {};
function drawField(home, away) {
  field.innerHTML = '';
  const gr = s('g', {});
  for (let i = 0; i < 20; i++) s('rect', { x: X(i * 5), y: 0, width: 50, height: 533.3, fill: i % 2 ? 'var(--grass-b)' : 'var(--grass-a)' }, gr);
  L.rz = s('rect', { x: 0, y: 0, width: 200, height: 533.3, fill: '#ff2d2d', opacity: 0 }, gr); // red zone tint
  const ez = (x, t, rot) => {
    s('rect', { x, y: 0, width: 100, height: 533.3, fill: t.colors[0] }, gr);
    s('rect', { x: rot < 0 ? x + 88 : x, y: 0, width: 12, height: 533.3, fill: t.colors[1], opacity: .9 }, gr);
    // wordmark in the middle; logos (if any) get their own space near each sideline, never overlapping
    const hasLogo = !!LOGOS[t.id], avail = hasLogo ? 300 : 480;
    const cx = rot < 0 ? x + 44 : x + 56; // keep clear of the inner stripe
    const tx = s('text', { x: cx, y: 266.6, fill: ink(t.colors[0]), 'font-family': 'Barlow Condensed', 'font-weight': 800, 'font-size': 62, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'letter-spacing': 6, transform: `rotate(${rot} ${cx} 266.6)`, opacity: .95 }, gr);
    tx.textContent = t.name.toUpperCase();
    L.fit = L.fit || [];
    L.fit.push(() => { // measured fit: shrink the name only if it's too long for the space
      tx.removeAttribute('textLength'); tx.removeAttribute('lengthAdjust');
      let w = 0; try { w = tx.getComputedTextLength(); } catch (e) {}
      if (!w) w = t.name.length * 36;
      if (w > avail) { tx.setAttribute('textLength', avail); tx.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
    });
    if (hasLogo) for (const cy of [62, 471]) s('image', { href: LOGOS[t.id], x: cx - 36, y: cy - 36, width: 72, height: 72, preserveAspectRatio: 'xMidYMid meet', transform: `rotate(${rot} ${cx} ${cy})` }, gr);
  };
  L.fit = [];
  ez(0, home, -90); ez(1100, away, 90);
  const lines = s('g', { stroke: 'rgba(255,255,255,.9)', 'stroke-width': 2 }, gr);
  for (let yd = 0; yd <= 100; yd += 5) s('line', { x1: X(yd), y1: 0, x2: X(yd), y2: 533.3, 'stroke-width': (yd === 0 || yd === 100) ? 4 : 2 }, lines);
  s('rect', { x: 1, y: 1, width: 1198, height: 531.3, fill: 'none', 'stroke-width': 4 }, lines);
  for (let yd = 1; yd < 100; yd++) {
    if (yd % 5 === 0) continue;
    for (const hy of [Y(0.6), Y(23.58), Y(29.75 - 0.7), Y(53.3 - 1.3)]) s('line', { x1: X(yd), y1: hy, x2: X(yd), y2: hy + 7, 'stroke-width': 1.6 }, lines);
  }
  const nums = s('g', { fill: 'rgba(255,255,255,.9)', 'font-family': 'Barlow Condensed', 'font-weight': 700, 'font-size': 44, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, gr);
  for (let yd = 10; yd <= 90; yd += 10) {
    const n = yd <= 50 ? yd : 100 - yd;
    const t1 = s('text', { x: X(yd), y: Y(12) - 10 }, nums); t1.textContent = n;
    const t2 = s('text', { x: X(yd), y: Y(53.3 - 12) + 10, transform: `rotate(180 ${X(yd)} ${Y(53.3 - 12) + 10})` }, nums); t2.textContent = n;
  }
  // midfield: home logo if available, otherwise the IFL shield
  if (LOGOS[home.id]) {
    // light disc behind the logo so any colour scheme stands out on the grass
    s('circle', { cx: X(50), cy: Y(26.65), r: 74, fill: 'rgba(255,255,255,.9)', stroke: home.colors[0], 'stroke-width': 5 }, gr);
    s('image', { href: LOGOS[home.id], x: X(50) - 58, y: Y(26.65) - 58, width: 116, height: 116, preserveAspectRatio: 'xMidYMid meet' }, gr);
  } else {
    const sh = s('g', { transform: `translate(${X(50) - 34} ${Y(26.65) - 40}) scale(2)`, opacity: .88 }, gr);
    s('path', { d: 'M17 1 L32 6 V19 C32 29 25 35 17 39 C9 35 2 29 2 19 V6 Z', fill: '#fff' }, sh);
    s('path', { d: 'M17 4 L29 8 V19 C29 27.5 23.5 32.5 17 35.8 C10.5 32.5 5 27.5 5 19 V8 Z', fill: home.colors[0] }, sh);
    s('path', { d: 'M17 4 L29 8 V15 H5 V8 Z', fill: home.colors[1] }, sh);
    const mt = s('text', { x: 17, y: 27.5, 'text-anchor': 'middle', 'font-family': 'Barlow Condensed', 'font-weight': 800, 'font-size': 11.5, fill: ink(home.colors[0]) }, sh); mt.textContent = 'IFL';
  }
  L.trail = s('g', {});
  L.lines = s('g', {});
  L.los = s('rect', { x: 0, y: 0, width: 4, height: 533.3, fill: '#2f7bff', opacity: 0 }, L.lines);
  L.fd = s('rect', { x: 0, y: 0, width: 4, height: 533.3, fill: '#ffd400', opacity: 0 }, L.lines);
  // sideline chain crew: line-to-gain stick, line-of-scrimmage stick and the down box
  L.chain = s('g', { opacity: 0 });
  L.chLink = s('line', { x1: 0, x2: 0, y1: 9, y2: 9, stroke: '#ff8a00', 'stroke-width': 2, 'stroke-dasharray': '4 3' }, L.chain);
  L.chA = s('rect', { x: 0, y: 1, width: 5, height: 18, rx: 1.5, fill: '#ff8a00', stroke: '#000', 'stroke-width': .8 }, L.chain);
  L.chB = s('rect', { x: 0, y: 1, width: 5, height: 18, rx: 1.5, fill: '#ff8a00', stroke: '#000', 'stroke-width': .8 }, L.chain);
  L.dbox = s('g', {}, L.chain);
  s('rect', { x: -11, y: 1, width: 22, height: 20, rx: 3, fill: '#ff8a00', stroke: '#000', 'stroke-width': .8 }, L.dbox);
  L.dnum = s('text', { x: 0, y: 15.5, 'text-anchor': 'middle', 'font-family': 'Barlow Condensed', 'font-weight': 800, 'font-size': 16, fill: '#111' }, L.dbox);
  L.flag = s('g', { opacity: 0 });
  s('path', { d: 'M0 0 L18 -6 L0 -12 Z', fill: '#f5c400', stroke: '#8a6d00', 'stroke-width': 1.2 }, L.flag);
  s('line', { x1: 0, y1: 0, x2: 0, y2: 10, stroke: '#8a6d00', 'stroke-width': 2 }, L.flag);
  L.shadow = s('ellipse', { cx: 0, cy: 0, rx: 9, ry: 5, fill: 'rgba(0,0,0,.35)' });
  L.tag = s('g', { opacity: 0 });
  L.tagBg = s('rect', { x: 0, y: 0, width: 10, height: 22, rx: 1.5, fill: 'rgba(0,0,0,.78)' }, L.tag);
  L.tagTx = s('text', { x: 0, y: 15.5, 'text-anchor': 'middle', 'font-family': 'Inter', 'font-weight': 800, 'font-size': 13, fill: '#fff' }, L.tag);
  L.ball = s('g', {});
  s('ellipse', { cx: 0, cy: 0, rx: 9, ry: 5.6, fill: '#8b4a22', stroke: '#3d1d08', 'stroke-width': 1.2 }, L.ball);
  s('line', { x1: -4, y1: 0, x2: 4, y2: 0, stroke: '#fff', 'stroke-width': 1.2 }, L.ball);
  setBall(50, 26.65, 0, 90);
  const runFit = () => L.fit.forEach(f => f());
  runFit(); requestAnimationFrame(runFit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(runFit);
}
function setBall(ax, y, h, ang) {
  const px = X(ax), py = Y(y), sc = 1 + h / 12;
  L.shadow.setAttribute('cx', px); L.shadow.setAttribute('cy', py);
  L.shadow.setAttribute('opacity', h > 0 ? Math.max(.25, 1 - h / 30) : 1);
  L.ball.setAttribute('transform', `translate(${px} ${py - h * 2.2}) rotate(${ang || 0}) scale(${sc})`);
}
function setLines(snap) {
  if (snap && snap.phase === 'play' && !snap.over) {
    L.los.setAttribute('x', X(snap.ballAbs) - 2); L.los.setAttribute('opacity', .9);
    L.fd.setAttribute('x', X(snap.fdAbs) - 2); L.fd.setAttribute('opacity', snap.ball + snap.togo >= 100 ? 0 : .95);
    const goalToGo = snap.ball + snap.togo >= 100, xa = X(snap.ballAbs), xb = X(snap.fdAbs);
    L.chain.setAttribute('opacity', 1);
    L.chA.setAttribute('x', xa - 2.5); L.chB.setAttribute('x', xb - 2.5); L.chB.setAttribute('opacity', goalToGo ? 0 : 1);
    L.chLink.setAttribute('x1', xa); L.chLink.setAttribute('x2', goalToGo ? xa : xb);
    L.dbox.setAttribute('transform', `translate(${xa} 22)`); L.dnum.textContent = snap.down;
    // red zone: tint the 20 yards in front of the goal the offense is attacking
    const inRz = snap.ball >= 80;
    L.rz.setAttribute('opacity', inRz ? .09 : 0);
    if (inRz) L.rz.setAttribute('x', snap.attackRight ? X(80) : X(0));
  } else { L.los.setAttribute('opacity', 0); L.fd.setAttribute('opacity', 0); if (L.chain) L.chain.setAttribute('opacity', 0); if (L.rz) L.rz.setAttribute('opacity', 0); }
}
function restingBall(snap) {
  if (!snap) return;
  if (snap.phase === 'kickoff' || snap.phase === 'freekick') setBall(snap.kickAbs, 26.65, 0, 90);
  else setBall(snap.ballAbs, snap.ballY, 0, 0);
}
function showFlag(f, animate) {
  if (!f) { L.flag.setAttribute('opacity', 0); return; }
  L.flag.setAttribute('opacity', 1);
  const px = X(f.abs), py = Y(Math.max(3, Math.min(50, (f.y || 26.65) - 3)));
  if (animate && L.flag.animate) L.flag.animate([{ transform: `translate(${px}px, ${py - 60}px) rotate(-40deg)` }, { transform: `translate(${px}px, ${py}px) rotate(0deg)` }], { duration: 400, easing: 'cubic-bezier(.3,1.4,.6,1)', fill: 'forwards' });
  else L.flag.setAttribute('transform', `translate(${px} ${py})`);
}
function trailAdd(path, color) {
  if (!path || path.length < 2) return;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], air = b.m === 'air' || b.m === 'kick';
    s('line', { x1: X(a.x), y1: Y(a.y), x2: X(b.x), y2: Y(b.y), stroke: color, 'stroke-width': air ? 2.5 : 4, 'stroke-dasharray': air ? '7 6' : 'none', 'stroke-linecap': 'round', opacity: .8 }, L.trail);
  }
}
function trailClear() { if (L.trail) L.trail.innerHTML = ''; }
function pathSegs(path) {
  const segs = []; let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const v = b.m === 'kick' ? 30 : b.m === 'air' ? 22 : 8.5;
    const dur = Math.max(0.18, Math.hypot(b.x - a.x, b.y - a.y) / v) + (b.m === 'kick' ? 0.25 : 0);
    segs.push({ a, b, dur, t0: total }); total += dur;
  }
  return { segs, total };
}
function drawPathAt(ps, p) {
  const t = Math.max(0, Math.min(1, p)) * ps.total;
  let sg = ps.segs[ps.segs.length - 1], lt = 1;
  for (const g of ps.segs) { if (t <= g.t0 + g.dur) { sg = g; lt = (t - g.t0) / g.dur; break; } }
  lt = Math.max(0, Math.min(1, lt));
  const x = sg.a.x + (sg.b.x - sg.a.x) * lt, y = sg.a.y + (sg.b.y - sg.a.y) * lt;
  const h = (sg.b.m === 'air' || sg.b.m === 'kick') ? (sg.b.h || 2) * 4 * lt * (1 - lt) : 0;
  setBall(x, y, h, Math.atan2(sg.b.y - sg.a.y, sg.b.x - sg.a.x) * 180 / Math.PI);
  // name tag on the ball carrier (hidden while the ball is in the air)
  if (!P || !P.names || !L.tag) return;
  const idx = ps.segs.indexOf(sg), inAir = sg.b.m === 'air' || sg.b.m === 'kick';
  const afterThrow = P.airIdx >= 0 && (idx > P.airIdx || (idx === P.airIdx && lt >= 1));
  const name = inAir && lt < 1 ? null : afterThrow ? P.names.after : P.names.before;
  if (!name || p >= 1) { L.tag.setAttribute('opacity', 0); return; }
  if (L.tagTx.textContent !== name) {
    L.tagTx.textContent = name;
    let w = 0; try { w = L.tagTx.getComputedTextLength(); } catch (e) {}
    L.tagBg.setAttribute('width', (w || name.length * 7.5) + 14); L.tagBg.setAttribute('x', -((w || name.length * 7.5) + 14) / 2);
  }
  const ty = Math.max(4, Y(y) - 42);
  L.tag.setAttribute('transform', `translate(${X(x)} ${ty})`); L.tag.setAttribute('opacity', 1);
}

// ---------------------------------------------------------------- broadcast player
// A Player runs a pre-simulated game (deterministic from its seed) on the shared timeline.
// mode 'live': position = server time - airStart (everyone in sync). mode 'local': own clock with play/pause/speed.
// Pre-roll before kickoff: the matchup intro, then a 3-2-1 countdown. Live games run it in the
// seconds before the scheduled start, so kickoff itself stays exactly on schedule.
const PRE_INTRO = 3600, PRE_CD = 3000, PRE = PRE_INTRO + PRE_CD;
let P = null;
let game = null; // the incrementally-stepped Game used for live stats
let followLive = true;
let localSpeed = store.get('ifl-speed2') || 1;

function loadPlayer(o) {
  if (P) caf(P.anim);
  const gopts = { playoff: !!o.playoff, rosters: o.rosters || curRosters(), out: o.out || [], venue: o.venue || undefined };
  const full = IFL.simulateGame(o.home, o.away, o.seed, gopts);
  const stage = IFL.stageOf(o);
  const tl = IFL.timeline(full.events, stage);
  const last = tl[tl.length - 1];
  game = new IFL.Game(o.home, o.away, Object.assign({ seed: o.seed }, gopts));
  P = { o, stage, full, tl, N: full.events.length, total: last.start + last.dur, idx: 0, began: -1, ps: null, flagShown: false, done: false,
    vt: o.mode === 'live' ? 0 : -PRE, wall: performance.now(), paused: o.mode !== 'live', lastPoss: null, anim: null };
  const H = game.teams[0], A = game.teams[1];
  drawField(H, A);
  $('#log').innerHTML = ''; $('#logCount').textContent = ''; pbpOpen.clear();
  $('#lpSit').textContent = ''; $('#lpTxt').innerHTML = o.mode === 'live' ? '' : 'Press <b>Play</b> to kick off.';
  ['#banner', '#gLow', '#gFd', '#gTag'].forEach(id => $(id).classList.remove('show'));
  $('#overlay').innerHTML = ''; P.ov = null;
  P.wp = [{ t: 0, p: IFL.winProb(game), ev: null }];
  P.drivesSeen = 0;
  renderBoard(game.snapshot());
  renderBox();
  renderWP();
  renderStage();
  const vl = $('#venueLine');
  vl.innerHTML = o.venue ? `<b>${esc(o.venue.name || o.venue.town)}</b>${o.venue.name ? ' · ' + esc(o.venue.town) : ''}${o.venue.host !== o.home ? ' · <span class="neutral">Neutral site</span>' : ''}` : (o.mode === 'exh' ? '' : `<b>${esc(H.city)}</b>`);
  vl.classList.toggle('hide', !vl.innerHTML);
  // inactive (injured) players for this game
  const outIds = new Set(gopts.out);
  const outBy = [A, H].map(tm => tm.players.filter(p => outIds.has(p.id)).map(p => `${p.pos} ${esc(p.short)}`));
  const inact = $('#inactive');
  inact.innerHTML = outBy.some(x => x.length) ? '<b>Inactive (injured):</b> ' + [A, H].map((tm, i) => outBy[i].length ? `${tm.abbr}: ${outBy[i].join(', ')}` : '').filter(Boolean).join(' · ') : '';
  inact.classList.toggle('hide', !outBy.some(x => x.length));
  $('#controls').classList.toggle('hide', o.mode === 'live');
  updateButtons(); renderBar();
  P.anim = raf(frame);
}
function vtime() {
  if (!P) return 0;
  if (P.o.mode === 'live') return serverNow() - P.o.airStart;
  const w = performance.now();
  if (!P.paused) P.vt += (w - P.wall) * (P.vt < 0 ? 1 : localSpeed);
  P.wall = w;
  return P.vt;
}
function frame() {
  if (!P) return;
  const t = vtime();
  if (t < 0) {
    const left = -t, waiting = P.o.mode !== 'live' && P.paused && P.idx === 0;
    if (left > PRE || waiting) pregame(left); else preroll(left);
    P.anim = raf(frame); return;
  }
  if (P.cd && !P.kicked) { P.kicked = true; kickoffFlash(); }
  let completed = 0;
  while (P.idx < P.N) {
    const sg = P.tl[P.idx], endAct = sg.start + sg.pre + sg.act;
    if (t < endAct) break;
    completeNext(t - endAct < 1200 * (P.o.mode === 'live' ? 1 : Math.max(1, localSpeed)));
    completed++;
  }
  if (completed) { renderBox(); renderWP(); }
  const waitingLocal = P.o.mode !== 'live' && P.paused && P.idx === 0 && t <= 0;
  if (waitingLocal && P.ov !== 'pre') setOverlay('pre');
  if (P.ov === 'pre' && t >= 0 && !waitingLocal) setOverlay(null);
  if (P.idx >= P.N) {
    if (!P.done) { P.done = true; onPlayerDone(); }
    return;
  }
  const sg = P.tl[P.idx];
  if (t >= sg.start) {
    const ev = P.full.events[P.idx];
    if (P.began !== P.idx) beginEvent(ev);
    const lt = t - sg.start, sameQ = ev.pre.qtr === ev.post.qtr;
    if (lt < sg.pre) { if (sameQ) setClock(lerp(ev.pre.clock, ev.snapClock, lt / sg.pre)); }
    else {
      const p = sg.act ? (lt - sg.pre) / sg.act : 1;
      if (P.ps) drawPathAt(P.ps, p);
      if (sameQ) setClock(lerp(ev.snapClock, ev.post.clock, p));
      if (ev.flag && !P.flagShown && p > 0.35) { showFlag(ev.flag, true); P.flagShown = true; }
    }
  }
  if (P.o.mode === 'local') updateEta(t);
  P.anim = raf(frame);
}
function beginEvent(ev) {
  P.began = P.idx; P.flagShown = false;
  showFlag(null);
  if (P.ov === 'half' && ev.kind !== 'period') setOverlay(null);
  const snap = ev.pre;
  if (ev.kind === 'period' || (ev.kind === 'info' && /coin toss/.test(ev.text))) trailClear();
  if (snap.phase === 'kickoff' || snap.phase === 'freekick') trailClear();
  if (P.lastPoss !== null && snap.phase === 'play' && snap.poss !== P.lastPoss) trailClear();
  setLines(snap.phase === 'play' ? snap : null);
  $('#lpSit').textContent = qLabel(ev.qtr) + ' ' + fmt(ev.clockStart) + (ev.preText ? ' · ' + ev.preText : '');
  P.ps = ev.path && ev.path.length > 1 ? pathSegs(ev.path) : null;
  if (L.tag) L.tag.setAttribute('opacity', 0);
  const nm = (ev.text.match(/[A-Z]. [A-Z][A-Za-z'-]+/g) || []);
  const pick = (ev.text.match(/INTERCEPTED by ([A-Z]. [A-Z][A-Za-z'-]+)/) || [])[1];
  const passFail = /incomplete|thrown away|spiked/.test(ev.text);
  P.names = { before: nm[0] || null, after: pick || (passFail ? null : nm[1] || null) };
  P.airIdx = P.ps ? P.ps.segs.findIndex(x => x.b.m === 'air' || x.b.m === 'kick') : -1;
  if (ev.kind === 'kickoff' || ev.kind === 'punt' || ev.kind === 'fg' || ev.kind === 'pat') P.names.before = null;
  if (P.ps) setBall(ev.path[0].x, ev.path[0].y, 0, 0);
}
function completeNext(fresh) {
  const drivesBefore = game.drives.length;
  const ev = game.step();
  tagDrive(ev, drivesBefore);
  if (P.began !== P.idx) beginEvent(ev);
  const color = game.teams[ev.pre.poss].colors[0];
  if (ev.path && ev.path.length > 1) trailAdd(ev.path, color);
  if (ev.flag) showFlag(ev.flag, false);
  const post = ev.post;
  renderBoard(post);
  setLines(post.phase === 'play' ? post : null);
  if (P.ps && fresh) drawPathAt(P.ps, 1);
  if (!(post.phase === 'play' || post.phase === 'pat' || post.phase === 'kickoff' || post.phase === 'freekick') && P.ps) drawPathAt(P.ps, 1);
  else restingBall(post);
  if (post.phase === 'play') P.lastPoss = post.poss;
  $('#lpTxt').innerHTML = chipHTML(ev) + esc(ev.text);
  addLog(ev);
  // win probability after this play (x = game seconds elapsed)
  const otLen = game.playoff ? 900 : 600;
  const tg = post.qtr <= 4 ? (post.qtr - 1) * 900 + (900 - post.clock) : 3600 + (post.qtr - 5) * otLen + (otLen - post.clock);
  P.wp.push({ t: Math.max(tg, P.wp[P.wp.length - 1].t), p: IFL.winProb(game), ev });
  if (fresh) {
    if (ev.banner === 'FINAL') playOutro(ev);
    if (ev.banner) showBanner(ev);
    else if (isFirstDown(ev)) showFirstDown(ev);
    const done = game.drives.filter(d => d.result);
    if (done.length > P.drivesSeen) showDrive(done[done.length - 1], ev);
    if (ev.kind === 'period' && ev.banner === 'HALFTIME') setOverlay('half');
    Sound.play(ev);
  }
  P.drivesSeen = game.drives.filter(d => d.result).length;
  P.idx++;
}
function isFirstDown(ev) {
  const a = ev.pre, b = ev.post;
  return a.phase === 'play' && b.phase === 'play' && a.poss === b.poss && b.down === 1 && b.ball !== a.ball && a.qtr === b.qtr && !(ev.kind === 'kickoff' || ev.kind === 'punt');
}
function setClock(c) { $('#sbClock').textContent = fmt(c); }
function pregame(msLeft) {
  $('#sbQ').textContent = 'Pregame';
  $('#sbClock').textContent = '15:00';
  $('#sbDD').textContent = 'Kickoff in ' + fmtIn(msLeft);
  if (P.ov !== 'pre') setOverlay('pre');
  const k = $('#ovKick'); if (k && P.o.mode === 'live') k.textContent = 'Kickoff in ' + fmtIn(msLeft);
}
function onPlayerDone() {
  const me = P, wait = (P.outroUntil || 0) - performance.now();
  if (wait > 0) setTimeout(() => { if (P === me && P.done) setOverlay('final'); }, wait); else setOverlay('final');
  updateButtons();
  if (P.o.mode === 'live') setTimeout(poll, 1500);
  renderBar();
}
function updateEta(t) {
  const left = Math.max(0, P.total - t) / localSpeed;
  $('#eta').textContent = P.done ? '' : (P.paused ? 'Paused · ' : '') + fmtIn(left) + ' left';
}

// ---------------------------------------------------------------- scoreboard / log / banner
function renderBoard(snap) {
  const g = game, H = g.teams[0], A = g.teams[1];
  const over = snap.over, inLeague = NET.online && P && (P.o.mode === 'live' || P.o.gid);
  const side = (t, i, el) => {
    el.style.setProperty('--tc', t.colors[0]);
    el.classList.toggle('won', over && snap.score[i] > snap.score[1 - i]);
    el.classList.toggle('lost', over && snap.score[i] < snap.score[1 - i]);
    const rec = inLeague && !g.playoff ? recStr(recordOf(t.id)) : '';
    el.innerHTML = `${crest(t, 54)}
      <div class="nm"><div class="city">${esc(t.city)}</div><div class="mascot">${esc(t.name)}</div>
        ${rec ? `<div class="rec">${rec}</div>` : ''}
        <div class="tos" title="Timeouts">${[0, 1, 2].map(k => `<i class="${k < snap.to[i] ? 'on' : ''}"></i>`).join('')}</div></div>
      <div class="poss ${snap.poss === i && snap.phase === 'play' && !over ? 'on' : ''}" title="Possession"></div>
      <div class="score">${snap.score[i]}</div>`;
  };
  side(A, 1, $('#tmAway')); side(H, 0, $('#tmHome'));
  const dd = $('#sbDD');
  dd.classList.remove('rz');
  if (over) { $('#sbQ').textContent = 'Final' + (snap.qtr >= 5 ? ' / OT' : ''); $('#sbClock').textContent = '0:00'; dd.textContent = ''; return; }
  const pre = !g.events.length;
  $('#sbQ').textContent = pre ? 'Pregame' : (snap.phase === 'kickoff' && snap.qtr === 3 && snap.clock === 900 ? 'Halftime' : qLabel(snap.qtr) + (snap.qtr <= 4 ? ' Quarter' : ''));
  $('#sbClock').textContent = fmt(snap.clock);
  let txt = '';
  if (snap.phase === 'play') {
    const t = g.teams[snap.poss], goal = snap.ball + snap.togo >= 100;
    const sp = snap.ball === 50 ? '50' : snap.ball < 50 ? t.abbr + ' ' + snap.ball : g.teams[1 - snap.poss].abbr + ' ' + (100 - snap.ball);
    txt = `${['', '1st', '2nd', '3rd', '4th'][snap.down]} & ${goal ? 'Goal' : snap.togo} · ${sp}`;
    if (snap.ball >= 80) dd.classList.add('rz');
  } else if (snap.phase === 'pat') txt = 'Extra Point';
  else if (!pre && (snap.phase === 'kickoff' || snap.phase === 'freekick')) txt = 'Kickoff';
  dd.textContent = txt;
}

// ---------------------------------------------------------------- on-field graphics
const BIG = ['TOUCHDOWN', 'PICK SIX', 'KICK RETURN TD', 'PUNT RETURN TD', 'FIELD GOAL', 'SAFETY', 'INTERCEPTED', 'FUMBLE', 'MUFFED PUNT', 'BLOCKED', 'BLOCKED PUNT', 'TURNOVER ON DOWNS', 'ONSIDE RECOVERED', 'OVERTIME'];
const gfxT = {};
function holdMs(min) {
  const hold = P.tl[P.idx] ? P.tl[P.idx].post : 2000;
  return Math.max(min || 900, hold * 0.9 / (P.o.mode === 'live' ? 1 : localSpeed));
}
function flash(id, html, ms, setup) {
  const e = $(id);
  if (setup) setup(e);
  e.innerHTML = html;
  e.classList.add('show');
  clearTimeout(gfxT[id]);
  gfxT[id] = setTimeout(() => e.classList.remove('show'), ms);
}
function showBanner(ev) {
  if (ev.banner === 'FINAL' || ev.banner === 'HALFTIME') return; // the overlay card covers these
  const scoreLine = `${game.teams[1].abbr} ${ev.post.score[1]} – ${game.teams[0].abbr} ${ev.post.score[0]}`;
  if (BIG.includes(ev.banner)) {
    const t = ev.scoring != null ? game.teams[ev.scoring] : (ev.banner === 'OVERTIME' ? null : game.teams[ev.post.poss]);
    const fill = ev.scoring != null && /TOUCHDOWN|TD|PICK SIX|SAFETY/.test(ev.banner);
    const sub = ev.scoring != null ? `${t.full} · ${scoreLine}` : t ? `${t.full} ball` : 'Both teams get the ball';
    flash('#banner', `${t ? crest(t, 64) : ''}<div><div class="t1">${esc(ev.banner)}</div><div class="t2">${esc(sub)}</div></div>`, holdMs(1400), e => {
      e.className = 'g-big' + (fill ? ' fill' : '');
      if (t) { e.style.setProperty('--tc', t.colors[0]); e.style.setProperty('--tc2', t.colors[1]); e.style.setProperty('--ti', ink(t.colors[0])); }
      else e.style.setProperty('--tc', 'var(--text)');
    });
    return;
  }
  let t1 = ev.banner, t2 = '', cls = 'g-low', team = game.teams[ev.pre.poss];
  if (ev.banner === 'FLAG') { cls += ' flag'; t1 = 'Flag'; const ft = ev.flag && ev.flag.team != null ? game.teams[ev.flag.team] : null; t2 = (ev.flag && ev.flag.name ? ev.flag.name : 'Penalty') + (ft ? ' · ' + ft.abbr : ''); team = ft || team; }
  else if (ev.banner === 'INJURY' && ev.injury) { t1 = 'Injury'; team = game.teams.find(x => x.id === ev.injury.team) || team; t2 = `${ev.injury.pos} ${ev.injury.short} · ${ev.injury.part}`; }
  else if (ev.scoring != null) { team = game.teams[ev.scoring]; t2 = scoreLine; }
  else if (ev.banner === 'TWO-MINUTE WARNING') t2 = scoreLine;
  else if (ev.banner === 'KICKOFF') { t2 = ev.text.split('.')[0]; team = null; }
  else t2 = team ? team.full : '';
  flash('#gLow', `${team ? crest(team, 34) : ''}<div><div class="t1">${esc(t1)}</div><div class="t2">${esc(t2)}</div></div>`, holdMs(1300), e => {
    e.className = cls; e.style.setProperty('--tc', team ? team.colors[0] : 'var(--text)');
  });
}
function showFirstDown(ev) {
  const t = game.teams[ev.post.poss];
  flash('#gFd', `<div><div class="t1">1st Down</div><div class="t2">${t.abbr}</div></div>`, 1400 / (P.o.mode === 'live' ? 1 : Math.min(localSpeed, 2)), e => { e.className = 'g-low fd'; });
}
function showDrive(d, ev) {
  if (/End of/.test(d.result || '')) return;
  const t = game.teams[d.team];
  const text = `${d.plays} play${d.plays === 1 ? '' : 's'}, ${d.yds} yd${Math.abs(d.yds) === 1 ? '' : 's'}, ${fmt(d.top)} · ${d.result}`;
  // after a score the big card is up first, so the drive summary waits a moment
  const delay = ev.banner && BIG.includes(ev.banner) ? holdMs(1400) * 0.55 : 0;
  setTimeout(() => {
    if (!P || P.ov) return;
    flash('#gLow', `${crest(t, 34)}<div><div class="t1">${t.abbr} Drive</div><div class="t2">${esc(text)}</div></div>`, holdMs(1800), e => { e.className = 'g-low'; e.style.setProperty('--tc', t.colors[0]); });
  }, delay);
}

// ---------------------------------------------------------------- pregame / halftime / final cards
function leadersOf(g) {
  const best = (key, fmt2) => {
    let b = null;
    for (const ti of [0, 1]) for (const p of g.teams[ti].players) { const s = g.ps[p.id]; if (s && (s[key] || 0) > 0 && (!b || s[key] > b.s[key])) b = { p, s, t: g.teams[ti] }; }
    return b ? `<div class="v"><span>${sw(b.t, 16)} ${esc(b.p.short)} <span class="muted">${b.t.abbr}</span></span><b>${fmt2(b.s)}</b></div>` : '<div class="v muted">—</div>';
  };
  return `<div class="k">Passing</div>${best('py', s => `${s.pc || 0}/${s.pa || 0}, ${s.py} yds${s.ptd ? ', ' + s.ptd + ' TD' : ''}`)}
    <div class="k">Rushing</div>${best('ry', s => `${s.ra} car, ${s.ry} yds${s.rtd ? ', ' + s.rtd + ' TD' : ''}`)}
    <div class="k">Receiving</div>${best('recy', s => `${s.rec} rec, ${s.recy} yds${s.rectd ? ', ' + s.rectd + ' TD' : ''}`)}`;
}
function playerOfGame(g) {
  const sc = s => (s.py || 0) / 25 + (s.ptd || 0) * 4 - (s.pint || 0) * 2 + (s.ry || 0) / 10 + (s.rtd || 0) * 6 + (s.recy || 0) / 10 + (s.rectd || 0) * 6 + (s.sacks || 0) * 3 + (s.ints || 0) * 4 + (s.tk || 0) * 0.4 + (s.deftd || 0) * 6 + (s.fgm || 0) * 1.5;
  const w = g.score[0] === g.score[1] ? null : (g.score[0] > g.score[1] ? 0 : 1);
  let b = null;
  for (const ti of w == null ? [0, 1] : [w]) for (const p of g.teams[ti].players) { const s = g.ps[p.id]; if (s) { const v = sc(s); if (!b || v > b.v) b = { p, s, v, t: g.teams[ti] }; } }
  if (!b) return '';
  const s = b.s, bits = [];
  if (s.pa) bits.push(`${s.pc}/${s.pa}, ${s.py} pass yds, ${s.ptd || 0} TD`);
  if (s.ra) bits.push(`${s.ry} rush yds${s.rtd ? ', ' + s.rtd + ' TD' : ''}`);
  if (s.rec) bits.push(`${s.rec} rec, ${s.recy} yds${s.rectd ? ', ' + s.rectd + ' TD' : ''}`);
  if (s.sacks) bits.push(`${s.sacks} sack${s.sacks > 1 ? 's' : ''}`);
  if (s.ints) bits.push(`${s.ints} INT`);
  if (s.tk && !bits.length) bits.push(`${s.tk} tackles`);
  if (s.fgm && !bits.length) bits.push(`${s.fgm}/${s.fga} FG`);
  return `<div class="k">Player of the game</div><div class="v" style="grid-column:1/-1"><span>${sw(b.t, 16)} <b>${esc(b.p.name)}</b> <span class="muted">${b.t.abbr} ${b.p.pos}</span></span><span class="muted">${esc(bits.join(' · '))}</span></div>`;
}
function setOverlay(kind) {
  const box = $('#overlay');
  if (!P) return;
  P.ov = kind;
  if (!kind) { box.innerHTML = ''; return; }
  const g = game, H = g.teams[0], A = g.teams[1];
  const inLeague = NET.online && (P.o.mode === 'live' || P.o.gid);
  const rec = t => inLeague ? recStr(recordOf(t.id)) : '';
  const stage = P.stage || 'reg', S0 = NET.state && NET.state.season;
  let cls = '', hero = '';
  const teamCol = t => `<div class="ot">${crest(t, 64)}<b>${esc(t.name)}</b><span>${esc(t.city)}${rec(t) ? ' · ' + rec(t) : ''}</span></div>`;
  let head, mid, body = '', extra = '';
  if (kind === 'pre') {
    head = `<span>${esc(P.o.label || 'Exhibition')}</span><span id="ovKick">${P.o.mode === 'live' ? '' : 'Press Play to kick off'}</span>`;
    mid = `<div class="ovs">@<small>${esc(venueText(P.o.venue, H, true))}</small></div>`;
    const wp = P.wp[0].p, ap = Math.round((1 - wp) * 100), hp = 100 - ap;
    extra = `<div class="pbl"><span>${A.abbr} ${ap}%</span><span class="muted">Pregame win probability</span><span>${hp}% ${H.abbr}</span></div>
      <div class="pbar"><i style="width:${ap}%;background:${A.colors[0]}"></i><i style="width:${hp}%;background:${H.colors[0]}"></i></div>`;
    const qb = t => t.depth.QB[0];
    if (stage !== 'reg') {
      const info = S0 && S0.playoffs && S0.playoffs.info ? S0.playoffs.info : [];
      const seedTxt = t => { const x = info.find(i => i.id === t.id); return x ? `#${x.seed} seed · ${x.how}` : ''; };
      if (stage === 'bowl') {
        cls = 'bowl';
        hero = `<div class="hero">${TROPHY}<b>The IFL Bowl</b><span>Season ${S0 ? S0.number : ''} Championship</span></div>`;
        const semi = t => { const sg = S0 ? S0.games.find(x => x.playoff && x.gid !== 'P-F' && x.result && (x.home === t.id || x.away === t.id)) : null; if (!sg) return ''; const o = teamById(sg.home === t.id ? sg.away : sg.home), mine = sg.home === t.id ? sg.result.score[0] : sg.result.score[1], th = sg.home === t.id ? sg.result.score[1] : sg.result.score[0]; return `Semifinal: beat ${o.abbr} ${mine}–${th}`; };
        extra = `<div class="path">${[A, H].map(t => `<div><b>${esc(t.full)}</b>${seedTxt(t)}<br>${rec(t) ? 'Regular season ' + rec(t) + '<br>' : ''}${semi(t)}</div>`).join('')}</div>` + extra;
      } else {
        hero = `<div class="hero"><b style="font-size:22px">IFL Playoffs</b><span>Semifinal · winner goes to the IFL Bowl</span></div>`;
        extra = `<div class="path">${[A, H].map(t => `<div><b>${esc(t.full)}</b>${seedTxt(t)}${rec(t) ? ' · ' + rec(t) : ''}</div>`).join('')}</div>` + extra;
      }
    }
    body = `<div class="k">Team rating</div><div class="v"><span>${sw(A, 16)} ${A.abbr} overall</span><b>${A.rt.ovr}</b></div><div class="v"><span>${sw(H, 16)} ${H.abbr} overall</span><b>${H.rt.ovr}</b></div>
      <div class="k">Starting quarterbacks</div><div class="v"><span>${sw(A, 16)} ${esc(qb(A).name)}</span><b>${qb(A).r}</b></div><div class="v"><span>${sw(H, 16)} ${esc(qb(H).name)}</span><b>${qb(H).r}</b></div>`;
  } else {
    const fin = kind === 'final';
    head = `<span>${fin ? 'Final' + (g.qtr >= 5 ? ' / OT' : '') : 'Halftime'}</span><span>${esc(P.o.label || '')}</span>`;
    mid = `<div class="ovs">${g.score[1]} – ${g.score[0]}<small>${fin ? 'Final' : 'Half'}</small></div>`;
    body = (fin ? playerOfGame(g) : '') + leadersOf(g);
    if (fin && stage === 'bowl' && g.score[0] !== g.score[1]) {
      const ch = g.teams[g.score[0] > g.score[1] ? 0 : 1];
      cls = 'champ';
      hero = `<div class="hero">${TROPHY}<b>${esc(ch.full)}</b><span>Season ${S0 ? S0.number : ''} IFL Bowl Champions</span></div>`;
      if (!P.confettiDone) { P.confettiDone = true; confetti([ch.colors[0], ch.colors[1], '#f3d27a', '#ffffff']); }
    }
  }
  box.innerHTML = `<div class="overlay" title="${kind === 'pre' ? '' : 'Click to close'}"><div class="ocard ${cls} k-${kind}"><div class="oh">${head}</div>${hero}<div class="om">${teamCol(A)}${mid}${teamCol(H)}</div>${extra}<div class="ob">${body}</div>${kind === 'pre' ? '' : '<div class="muted" style="text-align:center;font-size:11px;padding:0 0 10px">Click anywhere to close</div>'}</div></div>`;
  if (kind !== 'pre') box.firstChild.onclick = () => { box.innerHTML = ''; P.ov = null; };
  fitOverlay();
}

// ---------------------------------------------------------------- playoffs / IFL Bowl presentation
const TROPHY = '<svg class="trophy" viewBox="0 0 40 48" aria-hidden="true"><path d="M11 3h18v10c0 7-4 12-9 12s-9-5-9-12z" fill="#f3d27a" stroke="#8a6416" stroke-width="1.5"/><path d="M11 6H4c0 7 3 10 8 11M29 6h7c0 7-3 10-8 11" fill="none" stroke="#c99a2e" stroke-width="2.5"/><rect x="17" y="25" width="6" height="8" fill="#c99a2e"/><path d="M11 33h18l2 7H9z" fill="#c99a2e" stroke="#8a6416" stroke-width="1.2"/><rect x="7" y="40" width="26" height="5" rx="1" fill="#5a420e"/><path d="M16 9l2 4 4 .5-3 3 .8 4-3.8-2-3.8 2 .8-4-3-3 4-.5z" fill="#fff8e1" opacity=".9"/></svg>';
function bracketHTML(S) {
  if (!S || !S.playoffs) return '';
  const g3 = S.games.filter(g => g.playoff), seed = id => { const x = (S.playoffs.info || []).find(i => i.id === id); return x ? x.seed : ''; };
  const n = serverNow();
  const cell = (g, lab) => {
    if (!g) return `<div class="m"><span class="lab">${lab}</span><span class="l">TBD</span><span></span></div>`;
    const aired = g.result && g.airStart + g.dur <= n, A = teamById(g.away), H = teamById(g.home);
    const line = (t, sc, w) => `<span class="${aired ? (w ? 'w' : 'l') : 'w'}">(${seed(t.id)}) ${t.abbr}</span><span class="${aired ? (w ? 'w' : 'l') : 'w'}">${aired ? sc : ''}</span>`;
    return `<div class="m"><span class="lab">${lab}</span>${line(A, aired && g.result.score[1], aired && g.result.score[1] > g.result.score[0])}${line(H, aired && g.result.score[0], aired && g.result.score[0] > g.result.score[1])}</div>`;
  };
  return `<div class="bracket">${cell(g3.find(g => g.gid === 'P-SF1'), 'Semifinal')}${cell(g3.find(g => g.gid === 'P-SF2'), 'Semifinal')}${cell(g3.find(g => g.gid === 'P-F'), 'IFL Bowl')}</div>`;
}
function renderStage() {
  const box = $('#stageBar'), hd = document.querySelector('.gamehd');
  const st = P ? P.stage : 'reg', S = NET.state && NET.state.season;
  hd.style.borderTop = st === 'bowl' ? '4px solid var(--gold)' : st === 'semi' ? '4px solid var(--text)' : '';
  if (!P || st === 'reg') { box.innerHTML = ''; return; }
  const num = S ? S.number : '';
  box.innerHTML = st === 'bowl'
    ? `<div class="stagebar bowl">${TROPHY}<div class="ttl"><small>Season ${num} Championship${P.o.venue ? ' · ' + esc(venueText(P.o.venue, teamById(P.o.home)).replace(' · neutral site', '')) : ''}</small>The IFL Bowl</div>${bracketHTML(S)}</div>`
    : `<div class="stagebar"><div class="ttl"><small>Season ${num} · Win and you're in the IFL Bowl</small>IFL Playoffs · Semifinal</div>${bracketHTML(S)}</div>`;
}
// site-wide banner while the playoffs or the IFL Bowl are on (or about to start)
function renderEvBanner() {
  const bar = $('#evBanner'), box = $('#evBannerIn');
  const S = NET.state && NET.state.season;
  if (!NET.online || !S) { bar.classList.add('hide'); return; }
  const n = serverNow(), soon = 90 * 60000;
  const g = S.games.filter(x => x.playoff && x.airStart != null && n < x.airStart + x.dur && x.airStart - n < soon).sort((a, b) => a.airStart - b.airStart)[0];
  const watching = view === 'game' && P && P.o.mode === 'live' && g && P.o.gid === g.gid;
  if (!g || watching) { bar.classList.add('hide'); return; }
  const A = teamById(g.away), H = teamById(g.home), on = g.airStart <= n, bowl = g.gid === 'P-F';
  const h = `${bowl ? TROPHY : ''}<b>${bowl ? 'The IFL Bowl' : 'IFL Playoffs'}</b><span>${A.full} vs ${H.full}</span><span style="opacity:.8">${on ? '· Live now' : '· Kickoff in ' + fmtIn(g.airStart - n)}</span><button class="btn" id="evWatch">${on ? 'Watch live' : 'Go to game'}</button>`;
  bar.classList.remove('hide');
  if (box._last === h) return;
  box._last = h; box.innerHTML = h;
  $('#evWatch').onclick = () => { followLive = true; showView('game'); syncLive(true); };
}
// confetti for the champions
function confetti(colors) {
  const cv = $('#confetti'); if (!cv || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  cv.classList.remove('hide');
  const ctx = cv.getContext('2d'), W = cv.width = innerWidth, H = cv.height = innerHeight;
  const parts = Array.from({ length: 180 }, () => ({ x: Math.random() * W, y: -20 - Math.random() * H * 0.6, vx: (Math.random() - .5) * 2.4, vy: 2 + Math.random() * 3.5, r: Math.random() * 6.3, vr: (Math.random() - .5) * .3, w: 6 + Math.random() * 6, h: 3 + Math.random() * 5, c: colors[Math.floor(Math.random() * colors.length)] }));
  const t0 = performance.now();
  const step = now => {
    const el = now - t0; ctx.clearRect(0, 0, W, H);
    for (const p of parts) { p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vy += 0.02; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - el / 6500); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); }
    if (el < 6500) requestAnimationFrame(step); else { ctx.clearRect(0, 0, W, H); cv.classList.add('hide'); }
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------- fullscreen ("theater") mode
// Moves the scoreboard, field and last-play strip into a full-screen stage; everything keeps running.
const Theater = (() => {
  let on = false, slots = [];
  const parts = () => [$('#board'), document.querySelector('.fieldcard .fieldwrap'), document.querySelector('.fieldcard .lastplay')];
  function enter() {
    if (on) return; on = true;
    const th = $('#theater'); th.classList.remove('hide');
    slots = parts().map(el => { const mark = document.createComment('slot'); el.parentNode.insertBefore(mark, el); return { el, mark }; });
    const stage = $('#theaterStage');
    slots.forEach(({ el }) => stage.appendChild(el));
    document.body.style.overflow = 'hidden';
    const fs = th.requestFullscreen || th.webkitRequestFullscreen;
    if (fs) { try { const pr = fs.call(th); if (pr && pr.catch) pr.catch(() => {}); } catch (e) {} }
    if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    fsIcon(); requestAnimationFrame(fitOverlay); setTimeout(fitOverlay, 300);
  }
  function exit() {
    if (!on) return; on = false;
    slots.forEach(({ el, mark }) => { mark.parentNode.insertBefore(el, mark); mark.remove(); });
    slots = [];
    $('#theater').classList.add('hide');
    document.body.style.overflow = '';
    const fe = document.fullscreenElement || document.webkitFullscreenElement;
    if (fe) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {} }
    if (screen.orientation && screen.orientation.unlock) try { screen.orientation.unlock(); } catch (e) {}
    fsIcon(); renderWP(); requestAnimationFrame(fitOverlay);
  }
  function fsIcon() {
    $('#btnFs').innerHTML = on
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
    $('#btnFs').title = on ? 'Exit fullscreen (Esc)' : 'Fullscreen';
  }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && on) exit(); });
  document.addEventListener('webkitfullscreenchange', () => { if (!document.webkitFullscreenElement && on) exit(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && on) exit(); if ((e.key === 'f' || e.key === 'F') && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && view === 'game') (on ? exit : enter)(); });
  return { enter, exit, toggle: () => (on ? exit() : enter()), icon: fsIcon, get on() { return on; } };
})();
$('#btnFs').onclick = () => Theater.toggle();
$('#theaterClose').onclick = () => Theater.exit();
Theater.icon();

// ---------------------------------------------------------------- pre-roll: intro, countdown, kickoff
function preroll(left) {
  if (P.ov === 'pre') setOverlay(null);
  $('#sbQ').textContent = 'Pregame'; $('#sbClock').textContent = '15:00';
  $('#sbDD').textContent = 'Kickoff in ' + fmtIn(left);
  if (!P.introDone) { P.introDone = true; if (left > PRE_CD + 900) playIntro(left - PRE_CD); }
  if (left <= PRE_CD) {
    const n = Math.max(1, Math.ceil(left / 1000));
    if (P.cd !== n) {
      P.cd = n;
      const c = $('#cdown');
      c.className = 'cdown'; void c.offsetWidth; // restart the pop animation
      c.innerHTML = `<span>${n}</span><small>Kickoff</small>`; c.className = 'cdown show' + (P.stage === 'bowl' ? ' gold' : '');
      Sound.tick();
    }
  }
}
function kickoffFlash() {
  const c = $('#cdown');
  c.className = 'cdown'; void c.offsetWidth;
  c.innerHTML = '<span class="go">Kickoff!</span>'; c.className = 'cdown show go' + (P.stage === 'bowl' ? ' gold' : '');
  Sound.kick();
  clearTimeout(c._t); c._t = setTimeout(() => { c.className = 'cdown'; c.innerHTML = ''; }, 1100);
}

// ---------------------------------------------------------------- winning animation (final whistle)
function playOutro(ev) {
  if (!P || !game || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = $('#intro'), sc = ev.post.score, tie = sc[0] === sc[1];
  const wi = tie ? 0 : (sc[0] > sc[1] ? 0 : 1), W = game.teams[wi], Lt = game.teams[1 - wi];
  const big = t => LOGOS[t.id] ? `<img src="${LOGOS[t.id]}" alt="">` : `<span class="ib" style="background:${t.colors[1]};color:${ink(t.colors[1])}">${t.abbr}</span>`;
  const bowl = P.stage === 'bowl' && !tie, S0 = NET.state && NET.state.season;
  const word = tie ? 'Final' : bowl ? 'Champions' : 'Win';
  const lab = tie ? 'Final · Tie game' : bowl ? `Season ${S0 ? S0.number : ''} IFL Bowl Champions` : P.stage === 'semi' ? 'Advances to the IFL Bowl' : (P.o.mode === 'exh' ? 'Exhibition' : (P.o.label || '').split(' · ').slice(0, 2).join(' · ') || 'Final');
  box.innerHTML = `<div class="pa" style="--c:${W.colors[0]};--i:${ink(W.colors[0])}"><div class="ic">${big(W)}<div><small>${esc(W.city)}</small><b>${esc(W.name)}</b><em class="${bowl ? 'gold' : ''}">${word}</em></div></div></div>
    <div class="pb" style="--c:${Lt.colors[0]};--i:${ink(Lt.colors[0])}"><div class="ic">${big(Lt)}<div><small>${esc(Lt.city)}</small><b>${esc(Lt.name)}</b></div></div></div>
    <svg class="seam" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="72" y1="0" x2="48" y2="100" pathLength="100" vector-effect="non-scaling-stroke"/></svg>
    <div class="fsc${bowl ? ' gold' : ''}"><b>${Math.max(sc[0], sc[1])}–${Math.min(sc[0], sc[1])}</b><small>${game.qtr >= 5 ? 'Final / OT' : 'Final'}</small></div>
    <div class="ilab${bowl ? ' gold' : ''}">${esc(lab)}</div>`;
  const dur = 4400 / (P.o.mode === 'live' ? 1 : Math.min(localSpeed, 2));
  box.className = 'intro win' + (tie ? ' tie' : '') + ' play';
  box.style.setProperty('--d', dur + 'ms');
  P.outroUntil = performance.now() + dur;
  if (bowl && !P.confettiDone) { P.confettiDone = true; confetti([W.colors[0], W.colors[1], '#f3d27a', '#ffffff']); }
  clearTimeout(box._t); box._t = setTimeout(() => { box.className = 'intro'; box.innerHTML = ''; }, dur + 50);
}

// ---------------------------------------------------------------- matchup intro (diagonal team-vs-team sweep)
function playIntro(ms) {
  if (!P || !game || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = $('#intro'), A = game.teams[1], H = game.teams[0];
  const big = t => LOGOS[t.id] ? `<img src="${LOGOS[t.id]}" alt="">` : `<span class="ib" style="background:${t.colors[1]};color:${ink(t.colors[1])}">${t.abbr}</span>`;
  const lab = P.stage === 'bowl' ? 'The IFL Bowl' : P.stage === 'semi' ? 'IFL Playoffs · Semifinal' : (P.o.mode === 'exh' ? 'Exhibition' : (P.o.label || '').split(' · ').slice(0, 2).join(' · '));
  box.innerHTML = `<div class="pa" style="--c:${A.colors[0]};--i:${ink(A.colors[0])};--c2:${A.colors[1]}"><div class="ic">${big(A)}<div><small>${esc(A.city)}</small><b>${esc(A.name)}</b></div></div></div>
    <div class="pb" style="--c:${H.colors[0]};--i:${ink(H.colors[0])};--c2:${H.colors[1]}"><div class="ic">${big(H)}<div><small>${esc(H.city)}</small><b>${esc(H.name)}</b></div></div></div>
    <svg class="seam" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="64" y1="0" x2="40" y2="100" pathLength="100" vector-effect="non-scaling-stroke"/></svg><div class="vs${P.stage === 'bowl' ? ' gold' : ''}">VS</div>${lab ? `<div class="ilab${P.stage === 'bowl' ? ' gold' : ''}">${esc(lab)}</div>` : ''}`;
  box.className = 'intro play';
  const dur = Math.max(900, ms || PRE_INTRO);
  box.style.setProperty('--d', dur + 'ms');
  clearTimeout(box._t); box._t = setTimeout(() => { box.className = 'intro'; box.innerHTML = ''; }, dur + 50);
}

// scale the pregame / halftime / final card so it always fits inside the field (no scrollbars)
function fitOverlay() {
  const card = document.querySelector('#overlay .ocard'); if (!card) return;
  const wrap = card.closest('.fieldwrap'); if (!wrap) return;
  card.style.transform = '';
  const avail = wrap.clientHeight - 14, h = card.offsetHeight;
  if (h > avail && avail > 0) card.style.transform = 'scale(' + Math.max(0.4, avail / h).toFixed(3) + ')';
}
window.addEventListener('resize', () => requestAnimationFrame(fitOverlay));

// ---------------------------------------------------------------- win probability chart
function renderWP() {
  const svg = $('#wpChart'), now = $('#wpNow');
  if (!P || !game) return;
  const H = game.teams[0], A = game.teams[1], pts = P.wp;
  const cur = pts[pts.length - 1].p;
  const hp = Math.round(cur * 100), ap = 100 - hp;
  now.innerHTML = `<span class="s">${sw(A, 22)} ${A.abbr} <b>${ap}%</b></span><span class="s">${sw(H, 22)} ${H.abbr} <b>${hp}%</b></span>`;
  const W = Math.max(280, svg.clientWidth || 600), Ht = 170, ml = 40, mr = 10, mt = 10, mb = 20;
  const lastT = pts[pts.length - 1].t, maxT = Math.max(3600, lastT, game.qtr >= 5 ? 3600 + (game.playoff ? 900 : 600) * (game.qtr - 4) : 0);
  const x = t => ml + (W - ml - mr) * t / maxT, y = p => mt + (Ht - mt - mb) * (1 - p);
  const surf = 'var(--surface)';
  let h = `<defs><clipPath id="wpTop"><rect x="0" y="0" width="${W}" height="${y(.5)}"/></clipPath><clipPath id="wpBot"><rect x="0" y="${y(.5)}" width="${W}" height="${Ht}"/></clipPath></defs>`;
  // recessive grid + quarter markers
  for (const p of [0, .25, .5, .75, 1]) h += `<line x1="${ml}" x2="${W - mr}" y1="${y(p)}" y2="${y(p)}" stroke="var(--border)" stroke-width="${p === .5 ? 1.5 : 1}" ${p === .5 ? '' : 'stroke-dasharray="2 4"'}/>`;
  const qs = [[0, 'Q1'], [900, 'Q2'], [1800, 'Q3'], [2700, 'Q4']]; if (maxT > 3600) qs.push([3600, 'OT']);
  for (const [t, l] of qs) h += `${t ? `<line x1="${x(t)}" x2="${x(t)}" y1="${mt}" y2="${Ht - mb}" stroke="var(--border)"/>` : ''}<text x="${x(t) + 4}" y="${Ht - 6}" font-size="10" font-weight="700" fill="var(--muted)">${l}</text>`;
  h += `<text x="${ml - 6}" y="${y(1) + 4}" text-anchor="end" font-size="10.5" font-weight="800" fill="var(--text-2)">${H.abbr}</text>`;
  h += `<text x="${ml - 6}" y="${y(.5) + 4}" text-anchor="end" font-size="10" font-weight="700" fill="var(--muted)">50%</text>`;
  h += `<text x="${ml - 6}" y="${y(0)}" text-anchor="end" font-size="10.5" font-weight="800" fill="var(--text-2)">${A.abbr}</text>`;
  if (pts.length > 1) {
    const line = pts.map((q, i) => `${i ? 'L' : 'M'}${x(q.t).toFixed(1)} ${y(q.p).toFixed(1)}`).join(' ');
    const area = `${line} L${x(lastT).toFixed(1)} ${y(.5)} L${x(0)} ${y(.5)} Z`;
    h += `<path d="${area}" fill="${H.colors[0]}" opacity=".22" clip-path="url(#wpTop)"/><path d="${area}" fill="${A.colors[0]}" opacity=".22" clip-path="url(#wpBot)"/>`;
    h += `<path d="${line}" fill="none" stroke="var(--text)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    // scoring plays
    for (const q of pts) if (q.ev && q.ev.scoring != null && q.ev.kind !== 'pat') {
      const t = game.teams[q.ev.scoring];
      h += `<circle cx="${x(q.t)}" cy="${y(q.p)}" r="4.5" fill="${t.colors[0]}" stroke="${surf}" stroke-width="2"/>`;
    }
    const lp = pts[pts.length - 1];
    h += `<circle cx="${x(lp.t)}" cy="${y(lp.p)}" r="4" fill="var(--text)" stroke="${surf}" stroke-width="2"/>`;
  } else {
    h += `<text x="${(ml + W) / 2}" y="${y(.5) - 8}" text-anchor="middle" font-size="12" fill="var(--muted)">The chart fills in as the game is played.</text>`;
  }
  h += `<line id="wpX" x1="0" x2="0" y1="${mt}" y2="${Ht - mb}" stroke="var(--muted)" stroke-width="1" opacity="0"/><circle id="wpDot" r="5" fill="var(--text)" stroke="${surf}" stroke-width="2" opacity="0"/>`;
  h += `<rect x="${ml}" y="0" width="${W - ml - mr}" height="${Ht}" fill="transparent" id="wpHit"/>`;
  svg.setAttribute('viewBox', `0 0 ${W} ${Ht}`);
  svg.innerHTML = h;
  // hover: crosshair + tooltip with the play at that moment
  const hit = $('#wpHit'), tip = $('#wpTip');
  const move = e => {
    if (pts.length < 2) return;
    const r = svg.getBoundingClientRect(), mx = (e.clientX - r.left) * W / r.width;
    const t = (mx - ml) / (W - ml - mr) * maxT;
    let q = pts[0]; for (const c of pts) { if (c.t <= t) q = c; else break; }
    const cx = x(q.t), cy = y(q.p);
    $('#wpX').setAttribute('x1', cx); $('#wpX').setAttribute('x2', cx); $('#wpX').setAttribute('opacity', 1);
    $('#wpDot').setAttribute('cx', cx); $('#wpDot').setAttribute('cy', cy); $('#wpDot').setAttribute('opacity', 1);
    const ev = q.ev, hp2 = Math.round(q.p * 100);
    tip.innerHTML = `<div style="font-weight:700;margin-bottom:2px">${ev ? qLabel(ev.post.qtr) + ' ' + fmt(ev.post.clock) + ' · ' + game.teams[1].abbr + ' ' + ev.post.score[1] + '–' + ev.post.score[0] + ' ' + game.teams[0].abbr : 'Kickoff'}</div>
      <div>${A.abbr} <b>${100 - hp2}%</b> · ${H.abbr} <b>${hp2}%</b></div>${ev ? `<div class="muted" style="margin-top:3px">${esc(ev.text.length > 120 ? ev.text.slice(0, 117) + '…' : ev.text)}</div>` : ''}`;
    tip.classList.add('show');
    const px = cx * r.width / W, wrapW = $('#wpWrap').clientWidth;
    tip.style.left = Math.min(Math.max(8, px + 14), wrapW - tip.offsetWidth - 8) + 'px';
    tip.style.top = '6px';
  };
  hit.onmousemove = move;
  hit.onmouseleave = () => { tip.classList.remove('show'); $('#wpX').setAttribute('opacity', 0); $('#wpDot').setAttribute('opacity', 0); };
}
let wpResizeT = null;
window.addEventListener('resize', () => { clearTimeout(wpResizeT); wpResizeT = setTimeout(renderWP, 150); });

// ---------------------------------------------------------------- sound (synthesised, off by default)
const Sound = (() => {
  let on = !!store.get('ifl-sound'), ctx = null, bed = null, noiseBuf = null;
  function init() {
    if (ctx) return;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; return; }
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); let b = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = b * 3.5 + w * 0.15; }
  }
  function noise(gain, freq, q) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(ctx.destination); src.start();
    return { src, g };
  }
  function startBed() { if (!ctx || bed) return; bed = noise(0.035, 700, 0.6); }
  function stopBed() { if (bed) { bed.src.stop(); bed = null; } }
  function roar(level, secs) {
    if (!ctx) return;
    const n = noise(0, 900, 0.7), t = ctx.currentTime;
    n.g.gain.setValueAtTime(0, t);
    n.g.gain.linearRampToValueAtTime(0.32 * level, t + 0.35);
    n.g.gain.exponentialRampToValueAtTime(0.0008, t + secs);
    n.src.stop(t + secs + 0.1);
  }
  function whistle() {
    if (!ctx) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 2900; lfo.frequency.value = 38; lg.gain.value = 120;
    lfo.connect(lg); lg.connect(o.frequency); o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.02); g.gain.setValueAtTime(0.05, t + 0.32); g.gain.linearRampToValueAtTime(0, t + 0.4);
    o.start(t); lfo.start(t); o.stop(t + 0.45); lfo.stop(t + 0.45);
  }
  function play(ev) {
    if (!on || !ctx || !P || (P.o.mode !== 'live' && (P.paused || localSpeed > 2))) return;
    if (ctx.state === 'suspended') ctx.resume();
    const big = /TOUCHDOWN|PICK SIX|RETURN TD/.test(ev.banner || '');
    const gain = ev.post && ev.pre && ev.pre.poss === ev.post.poss ? ev.post.ball - ev.pre.ball : 0;
    if (big) roar(1, 4.5);
    else if (ev.tags.includes('TO') || ev.banner === 'SAFETY' || ev.banner === 'FIELD GOAL') roar(0.7, 3);
    else if (gain >= 20 || ev.tags.includes('2PT')) roar(0.5, 2.4);
    if (ev.tags.includes('FLAG') || ev.tags.includes('TIMEOUT') || ev.kind === 'period' || /incomplete|ran ob|out of bounds/.test(ev.text) || ev.scoring != null) whistle();
  }
  function icon() {
    const b = $('#btnSound');
    b.classList.toggle('on', on);
    b.title = 'Sound effects (' + (on ? 'on' : 'off') + ')';
    b.innerHTML = on
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>';
  }
  function toggle() {
    on = !on; store.set('ifl-sound', on);
    if (on) { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); startBed(); whistle(); } else stopBed();
    icon();
  }
  // browsers only allow audio after a click: arm it on the first interaction if sound was left on
  document.addEventListener('pointerdown', () => { if (on && !ctx) { init(); startBed(); } }, { once: true });
  function beep(f, len, vol) {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + len);
    o.start(t); o.stop(t + len + 0.05);
  }
  const live = () => on && ctx && P && !(P.o.mode !== 'live' && P.paused);
  function tick() { if (live()) { if (ctx.state === 'suspended') ctx.resume(); beep(880, 0.18, 0.06); } }
  function kick() { if (live()) { whistle(); roar(0.55, 3); } }
  return { play, toggle, icon, tick, kick };
})();
$('#btnSound').onclick = () => Sound.toggle();
Sound.icon();

// ---------------------------------------------------------------- theme toggle
function applyTheme(t) {
  if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
  const dark = t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
  $('#btnTheme').innerHTML = dark
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  if (P) renderWP();
}
$('#btnTheme').onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const dark = cur === 'dark' || (!cur && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = dark ? 'light' : 'dark';
  store.set('ifl-theme', next); applyTheme(next);
};
applyTheme(store.get('ifl-theme') || 'dark');
$('#brandHome').onclick = e => { e.preventDefault(); followLive = true; showView('game'); syncLive(true); };

function chipHTML(ev) {
  const order = ['TD', 'FG', 'SAFETY', '2PT', 'TO', 'DOWNS', 'MISS', 'FLAG', 'INJ', 'TIMEOUT', 'ONSIDE'];
  return ev.tags.filter((t, i, a) => order.includes(t) && a.indexOf(t) === i).map(t => `<span class="chip ${t === '2PT' ? 'c2PT' : t}">${t === 'TO' ? 'TURNOVER' : t}</span>`).join('');
}
function addLog(ev) { /* play-by-play is rendered from game.events, grouped by drive */ }

// ---------------------------------------------------------------- broadcast bar
function renderBar() {
  const bar = $('#bcast');
  if (!NET.online) {
    bar.innerHTML = `<span class="pill replay">Exhibition</span><span class="lbl2">${P ? esc(teamById(P.o.away).full + ' @ ' + teamById(P.o.home).full) : ''}</span><span class="spacer"></span><span class="muted">League mode is off: start the server (node server.js) to get live broadcasts, seasons and history.</span>`;
    return;
  }
  const lg = liveGame(), ng = nextGame(), st = NET.state;
  let h = '';
  if (P && P.o.mode === 'live') {
    const sg = seasonGames().find(g => g.gid === P.o.gid);
    const isLive = lg && lg.gid === P.o.gid;
    const pre = sg && serverNow() < sg.airStart;
    h += `<span class="pill ${isLive && !pre ? 'live' : pre ? 'next' : 'final'}">${isLive && !pre ? 'Live' : pre ? 'Up next' : 'Final'}</span>`;
    h += `<span class="lbl2">${esc(P.o.label || '')}</span>`;
    if (!isLive && ng && ng.gid !== P.o.gid) h += `<span class="muted">Next: ${esc(teamById(ng.away).abbr)} @ ${esc(teamById(ng.home).abbr)} · ${fmtWhen(ng.airStart)} (in ${fmtIn(ng.airStart - serverNow())})</span>`;
  } else if (P) {
    h += `<span class="pill replay">${P.o.mode === 'exh' ? 'Exhibition' : 'Replay'}</span><span class="lbl2">${esc(P.o.label || '')}</span>`;
    h += `<span class="spacer"></span>`;
    if (lg) h += `<span class="pill live">Live</span><span>${esc(teamById(lg.away).abbr)} @ ${esc(teamById(lg.home).abbr)}</span>`;
    h += `<button class="btn primary" id="btnBackLive">${lg ? 'Watch live' : 'Back to broadcast'}</button>`;
  }
  if (!P || P.o.mode === 'live') {
    if (st.settings.paused) h += `<span class="spacer"></span><span class="muted">Broadcast schedule is paused by the admin.</span>`;
    else if (!ng && !lg && st.season && st.season.champion) h += `<span class="spacer"></span><span class="muted">Season ${st.season.number} is over. ${st.nextSeasonAt ? 'Season ' + (st.season.number + 1) + ' starts ' + fmtWhen(st.nextSeasonAt) + '.' : 'The next season starts when the admin begins it.'}</span>`;
  }
  if (bar._last === h) return;
  bar._last = h; bar.innerHTML = h;
  const b = $('#btnBackLive'); if (b) b.onclick = () => { followLive = true; syncLive(true); };
}

// ---------------------------------------------------------------- scores ticker (this week's slate)
function renderTicker() {
  const bar = $('#ticker'), box = $('#tickerIn');
  const games = seasonGames();
  if (!NET.online || !games.length) { bar.classList.add('hide'); return; }
  const n = serverNow(), lg = liveGame(), ng = nextGame();
  const focus = lg || ng || lastFinished();
  if (!focus) { bar.classList.add('hide'); return; }
  const slate = games.filter(g => g.week === focus.week).sort((a, b) => (a.airStart || 0) - (b.airStart || 0));
  const label = focus.playoff ? 'Playoffs' : 'Week ' + focus.week;
  let h = `<div class="lab">${label}</div>`;
  for (const g of slate) {
    const A = teamById(g.away), H = teamById(g.home);
    const onAir = g.airStart != null && g.airStart <= n && n < g.airStart + g.dur;
    let sc = null, st;
    if (onAir) {
      const live = P && P.o.mode === 'live' && P.o.gid === g.gid && game && game.events.length ? game : null;
      sc = live ? [live.score[0], live.score[1]] : null;
      st = `<div class="st live">Live${live && !live.over ? ' · ' + qLabel(live.qtr) : ''}</div>`;
    } else if (g.result) { sc = g.result.score; st = `<div class="st">Final${g.result.ot ? '/OT' : ''}</div>`; }
    else st = `<div class="st">${g.airStart ? fmtWhen(g.airStart).replace('Today ', '').replace('Tomorrow', 'Tmrw') : 'TBD'}</div>`;
    const done = g.result && !onAir;
    const aw = done && sc[1] > sc[0], hw = done && sc[0] > sc[1];
    h += `<button class="tk${P && P.o.gid === g.gid ? ' cur' : ''}" data-gid="${g.gid}">
      <span class="tm${done && !aw ? ' lose' : ''}">${sw(A, 18)}${A.abbr}</span><span class="sc">${sc ? sc[1] : ''}</span>
      <span class="tm${done && !hw ? ' lose' : ''}">${sw(H, 18)}${H.abbr}</span><span class="sc">${sc ? sc[0] : ''}</span>${st}</button>`;
  }
  bar.classList.remove('hide');
  if (box._last === h) return;
  box._last = h; box.innerHTML = h;
  box.querySelectorAll('.tk').forEach(b => b.onclick = () => {
    const g = seasonGames().find(x => x.gid === b.dataset.gid); if (!g) return;
    const on = g.airStart != null && g.airStart <= serverNow() && serverNow() < g.airStart + g.dur;
    if (on) { followLive = true; showView('game'); syncLive(true); }
    else if (g.result) watchLocal(g, 'replay', `Season ${NET.state.season.number} · ${gameLabel(g)} · ${teamById(g.away).abbr} @ ${teamById(g.home).abbr}`);
    else { selWeek = g.week; showView('season'); }
  });
}

// pick what the Live tab should show when following the broadcast
function syncLive(force) {
  if (!NET.online || !followLive) return;
  const lg = liveGame();
  let target = lg;
  if (!target) {
    const lf = lastFinished(), ng = nextGame();
    if (lf && serverNow() - (lf.airStart + lf.dur) < 3 * 60000) target = lf;
    else target = ng || lf;
  }
  if (!target) return;
  if (!force && P && P.o.mode === 'live' && P.o.gid === target.gid && P.o.airStart === target.airStart) return;
  const sn = NET.state.season.number;
  loadPlayer({ mode: 'live', gid: target.gid, home: target.home, away: target.away, seed: target.seed, playoff: target.playoff, airStart: target.airStart, out: target.out, venue: target.venue, rosters: NET.state.season.rosters,
    label: `Season ${sn} · ${gameLabel(target)} · ${teamById(target.away).abbr} @ ${teamById(target.home).abbr}` });
}

// ---------------------------------------------------------------- local controls (replay / exhibition)
function updateButtons() {
  const local = P && P.o.mode !== 'live';
  const over = !P || P.done;
  $('#btnPlay').textContent = P && !P.paused && !over ? '⏸ Pause' : '▶ Play';
  $('#btnPlay').disabled = !local || over; $('#btnStep').disabled = !local || over; $('#btnSimEnd').disabled = !local || over;
  if (over) $('#eta').textContent = '';
}
$('#btnPlay').onclick = () => { if (!P || P.o.mode === 'live') return; vtime(); P.paused = !P.paused; P.wall = performance.now(); updateButtons(); };
$('#btnStep').onclick = () => {
  if (!P || P.o.mode === 'live' || P.done) return;
  vtime();
  const sg = P.tl[P.idx]; if (!sg) return;
  const endAct = sg.start + sg.pre + sg.act;
  P.vt = P.vt < sg.start ? sg.start : Math.max(P.vt, endAct);
};
$('#btnSimEnd').onclick = () => {
  if (!P || P.o.mode === 'live' || P.done) return;
  // land on the final whistle so the winning animation still plays; cancel any intro/countdown in progress
  const last = P.tl[P.N - 1];
  P.vt = Math.max(P.vt, last.start + last.pre + last.act);
  P.introDone = true; P.kicked = true;
  const ib = $('#intro'); clearTimeout(ib._t); ib.className = 'intro'; ib.innerHTML = '';
  const cd = $('#cdown'); cd.className = 'cdown'; cd.innerHTML = '';
  if (P.ov === 'pre') setOverlay(null);
  P.paused = false; updateButtons();
};
document.querySelectorAll('#speed button').forEach(b => {
  b.classList.toggle('on', +b.dataset.s === localSpeed);
  b.onclick = () => { if (P) vtime(); localSpeed = +b.dataset.s; document.querySelectorAll('#speed button').forEach(x => x.classList.toggle('on', x === b)); store.set('ifl-speed2', localSpeed); };
});
document.addEventListener('keydown', e => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.code === 'Space' && P && P.o.mode !== 'live') { e.preventDefault(); $('#btnPlay').click(); }
  if (e.code === 'ArrowRight') $('#btnStep').click();
});
function watchLocal(g, mode, label, rosters) {
  followLive = false;
  showView('game');
  loadPlayer({ mode, gid: g.gid, home: g.home, away: g.away, seed: g.seed, playoff: !!g.playoff, out: g.out || [], venue: g.venue || undefined, rosters: rosters || curRosters(), label });
  P.paused = false; P.wall = performance.now(); updateButtons();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// exhibition
const selH = $('#selHome'), selA = $('#selAway');
T.forEach(t => { selH.append(el('option', { value: t.id }, esc(t.full))); selA.append(el('option', { value: t.id }, esc(t.full))); });
selH.value = 'GHB'; selA.value = 'PAR';
$('#btnNew').onclick = () => {
  if (selH.value === selA.value) { alert('Pick two different teams.'); return; }
  const seed = $('#seed').value.trim() || String(Math.floor(Math.random() * 1e9));
  $('#seed').value = seed;
  watchLocal({ home: selH.value, away: selA.value, seed }, 'exh', `${teamById(selA.value).abbr} @ ${teamById(selH.value).abbr} · seed ${seed}`);
};

// ---------------------------------------------------------------- gamecast tabs
let gcTab = 'cast', boxSide = 1, pbpOpenAll = false;
const pbpOpen = new Set();
document.querySelectorAll('#gcTabs button').forEach(b => b.onclick = () => {
  gcTab = b.dataset.g;
  document.querySelectorAll('#gcTabs button').forEach(x => x.classList.toggle('on', x === b));
  for (const k of ['cast', 'box', 'pbp', 'stats']) $('#gc-' + k).classList.toggle('hide', k !== gcTab);
  renderBox();
  if (gcTab === 'cast') renderWP();
});
$('#pbpToggle').onclick = () => { pbpOpenAll = !pbpOpenAll; pbpOpen.clear(); $('#pbpToggle').textContent = pbpOpenAll ? 'Collapse all' : 'Expand all'; renderPBP(); };

// which drive each event belongs to (index into game.drives; -1 = between drives)
function tagDrive(ev, drivesBefore) {
  if (ev.kind === 'period' || (ev.kind === 'info' && !game.drive)) { ev.drv = -1; return; }
  const n = game.drives.length;
  if (n > drivesBefore) ev.drv = n - 1;            // this play ended a drive
  else if (game.drive) ev.drv = n;                  // drive in progress
  else ev.drv = n - 1;                              // e.g. extra point after a TD
}
function driveObj(i) {
  if (i < game.drives.length) return game.drives[i];
  return game.drive ? Object.assign({}, game.drive, { result: null, top: game.ts[game.drive.team].top - game.drive.top0 }) : null;
}

function linescore() {
  const g = game, nq = g.qtr > 4 ? 5 : 4;
  const hdr = ['1', '2', '3', '4'].concat(nq > 4 ? ['OT'] : []);
  const row = i => { const t = g.teams[i]; const q = g.qs[i]; const cells = [0, 1, 2, 3].map(k => q[k] || 0); if (nq > 4) cells.push(q[4] || 0); return `<tr><td class="l"><span class="tcell">${crest(t, 22)} ${t.abbr}</span></td>${cells.map(c => `<td>${c}</td>`).join('')}<td><b>${g.score[i]}</b></td></tr>`; };
  return `<table class="t"><tr><th></th>${hdr.map(h => `<th>${h}</th>`).join('')}<th>T</th></tr>${row(1)}${row(0)}</table>`;
}
function renderLeadersBox() {
  const g = game, A = g.teams[1], H = g.teams[0];
  const best = (ti, key) => { let b = null; for (const p of g.teams[ti].players) { const s = g.ps[p.id]; if (s && (s[key] || 0) > 0 && (!b || s[key] > b.s[key])) b = { p, s }; } return b; };
  const cats = [
    ['Passing Yards', 'py', s => `<b>${s.py}</b> YDS · ${s.pc}/${s.pa}${s.ptd ? ' · ' + s.ptd + ' TD' : ''}${s.pint ? ' · ' + s.pint + ' INT' : ''}`],
    ['Rushing Yards', 'ry', s => `<b>${s.ry}</b> YDS · ${s.ra} CAR${s.rtd ? ' · ' + s.rtd + ' TD' : ''}`],
    ['Receiving Yards', 'recy', s => `<b>${s.recy}</b> YDS · ${s.rec} REC${s.rectd ? ' · ' + s.rectd + ' TD' : ''}`],
    ['Tackles', 'tk', s => `<b>${s.tk}</b> TKL${s.sacks ? ' · ' + s.sacks + ' SACK' : ''}${s.ints ? ' · ' + s.ints + ' INT' : ''}`],
  ];
  const cell = (ti, key, f, right) => { const b = best(ti, key), t = g.teams[ti]; return b ? `<div class="p${right ? ' r' : ''}">${crest(t, 26)}<div style="min-width:0"><div class="n">${esc(b.p.short)}</div><div class="s">${f(b.s)}</div></div></div>` : `<div class="p${right ? ' r' : ''} muted" style="font-size:12px">—</div>`; };
  if (!Object.keys(g.ps).length) { $('#leadersBox').innerHTML = `<div class="empty">Game leaders appear after kickoff.</div>`; return; }
  $('#leadersBox').innerHTML = `<div style="display:flex;justify-content:space-between;padding-top:8px;font-weight:900;font-size:12px"><span class="tcell">${A.abbr}</span><span class="tcell">${H.abbr}</span></div>` +
    cats.map(([n, k, f]) => `<div class="cat">${n}</div><div class="pair">${cell(1, k, f)}${cell(0, k, f, true)}</div>`).join('');
}
function renderScoring() {
  // ESPN-style: the try after a touchdown is folded into the touchdown line
  const g = game, items = [];
  g.events.forEach((e, i) => {
    if (e.kind === 'pat') {
      const last = items[items.length - 1], prev = g.events[i - 1];
      if (last && prev && last.ev === prev) {
        const two = /TWO-POINT/.test(e.text), ok = e.scoring != null;
        const kicker = (e.text.match(/^([A-Z]\. [A-Za-z'-]+)/) || [])[1];
        last.note = two ? `(2-pt conversion ${ok ? 'good' : 'failed'})` : `(${kicker || 'PAT'} kick${ok ? '' : ' failed'})`;
        if (ok) last.post = e.post;
        return;
      }
    }
    if (e.scoring != null) items.push({ ev: e, post: e.post, note: '' });
  });
  $('#scoringBox').innerHTML = items.length ? items.map(({ ev: e, post, note }) => {
    const t = g.teams[e.scoring];
    const what = e.kind === 'pat' ? (/TWO-POINT/.test(e.text) ? '2-Pt Conversion' : 'Extra Point') : e.banner === 'FIELD GOAL' ? 'Field Goal' : e.banner === 'SAFETY' ? 'Safety' : 'Touchdown';
    const txt = e.text.length > 110 ? e.text.slice(0, 107) + '…' : e.text;
    return `<div class="it">${crest(t, 28)}<div style="min-width:0"><div style="font-weight:800">${what} <span class="q">· ${qLabel(e.qtr)} ${fmt(e.post.clock)}</span></div><div class="muted" style="font-size:12px">${esc(txt)} ${esc(note)}</div></div><div class="sc">${post.score[1]}–${post.score[0]}</div></div>`;
  }).join('') : '<p class="muted" style="padding:2px 14px 12px;margin:0">No scoring yet.</p>';
}
function renderDriveBar() {
  const bar = $('#driveBar'), g = game;
  const d = g.drive && !g.over ? driveObj(g.drives.length) : null;
  if (!d) {
    const last = g.drives.filter(x => x.result).slice(-1)[0];
    bar.innerHTML = last ? `<span class="lbl3">Last drive</span>${crest(g.teams[last.team], 22)}<span>${g.teams[last.team].abbr} · ${last.plays} plays, ${last.yds} yds, ${fmt(last.top)} · <b>${esc(last.result)}</b></span>` : `<span class="lbl3">Drive</span><span class="muted">Waiting for kickoff</span>`;
    return;
  }
  const t = g.teams[d.team], startY = d.start, nowY = g.ball;
  const lo = Math.min(startY, nowY), hi = Math.max(startY, nowY);
  bar.innerHTML = `<span class="lbl3">Current drive</span>${crest(t, 22)}<span>${t.abbr} · ${d.plays} play${d.plays === 1 ? '' : 's'}, ${d.yds} yds, ${fmt(d.top)}</span>
    <div class="track" title="Drive progress toward the end zone"><i style="left:${lo}%;width:${Math.max(1.5, hi - lo)}%;background:${t.colors[0]}"></i><i style="left:calc(${nowY}% - 2px);width:4px;background:var(--text)"></i></div>`;
}
function renderPBP() {
  const g = game, box = $('#log');
  const groups = []; let cur = null;
  for (const ev of g.events) {
    if (ev.drv == null) continue;
    if (ev.drv < 0) { groups.push({ sep: ev }); cur = null; continue; }
    if (!cur || cur.i !== ev.drv) { cur = { i: ev.drv, evs: [] }; groups.push(cur); }
    cur.evs.push(ev);
  }
  const lastIdx = groups.length ? groups[groups.length - 1].i : null;
  const rows = groups.slice().reverse().map(gr => {
    if (gr.sep) return `<div class="sep">${esc(gr.sep.text)}</div>`;
    const d = driveObj(gr.i); if (!d) return '';
    const t = g.teams[d.team], lastEv = gr.evs[gr.evs.length - 1];
    const open = pbpOpenAll || pbpOpen.has(gr.i) || (gr.i === lastIdx && !g.over);
    const res = d.result || 'In progress';
    const plays = gr.evs.slice().reverse().map(ev => {
      const cls = ev.scoring != null ? 'score' : ev.tags.includes('TO') || ev.tags.includes('DOWNS') ? 'to' : '';
      return `<div class="pl ${cls}"><div class="t">${qLabel(ev.qtr)} ${fmt(ev.clockStart)}</div><div>${ev.preText ? `<div class="s">${esc(ev.preText)}</div>` : ''}${chipHTML(ev)}${esc(ev.text)}</div></div>`;
    }).join('');
    return `<div class="drv${open ? ' open' : ''}" data-i="${gr.i}"><button class="dh">${crest(t, 30)}<div style="min-width:0"><div class="res">${esc(res)}</div><div class="sum">${d.plays} play${d.plays === 1 ? '' : 's'}, ${d.yds} yds, ${fmt(d.top || 0)} · ${qLabel(d.qtr)} ${fmt(d.clock)}</div></div><div class="sc">${lastEv.post.score[1]}–${lastEv.post.score[0]}</div><span class="car">▸</span></button><div class="plays">${plays}</div></div>`;
  }).join('');
  box.innerHTML = rows || '<p class="muted" style="padding:12px 14px;margin:0">No plays yet.</p>';
  box.querySelectorAll('.drv').forEach(dv => dv.querySelector('.dh').onclick = () => {
    const i = +dv.dataset.i;
    if (dv.classList.toggle('open')) pbpOpen.add(i); else pbpOpen.delete(i);
  });
  $('#logCount').textContent = g.events.length + ' plays';
}
function renderTeamStats() {
  const g = game, A = g.teams[1], H = g.teams[0], a = g.ts[1], h = g.ts[0];
  const pct = (c, n) => n ? Math.round(100 * c / n) + '%' : '0%';
  const rows = [
    ['First Downs', x => x.fd], ['Total Yards', x => x.yds], ['Passing Yards', x => x.py - x.sky], ['Rushing Yards', x => x.ry],
    ['Yards per Play', x => +(x.yds / Math.max(1, x.pa + x.ra + x.sk)).toFixed(1)], ['3rd Down', x => x.d3c, x => `${x.d3c}/${x.d3a} (${pct(x.d3c, x.d3a)})`],
    ['Completions', x => x.pc, x => `${x.pc}/${x.pa}`], ['Sacks Allowed', x => x.sk, x => `${x.sk}-${x.sky}`], ['Turnovers', x => x.to],
    ['Penalties', x => x.pen, x => `${x.pen}-${x.peny}`], ['Possession', x => x.top, x => fmt(x.top)],
  ];
  $('#teamStats').innerHTML = `<div class="hdr"><span>${crest(A, 28)} ${A.abbr}</span><span>${H.abbr} ${crest(H, 28)}</span></div>` + rows.map(([n, f, lab]) => {
    const av = f(a), hv = f(h), tot = Math.max(1e-9, Math.abs(av) + Math.abs(hv));
    return `<div class="tsr"><div class="lab"><b>${lab ? lab(a) : av}</b><span>${n}</span><b>${lab ? lab(h) : hv}</b></div>
      <div class="bars"><div><i style="width:${100 * Math.abs(av) / tot}%;background:${A.colors[0]}"></i></div><div><i style="width:${100 * Math.abs(hv) / tot}%;background:${H.colors[0]}"></i></div></div></div>`;
  }).join('');
}
function renderBox() {
  if (!game) return;
  renderLeadersBox();
  $('#lineScore').innerHTML = linescore();
  renderDriveBar();
  if (gcTab === 'cast') renderScoring();
  else if (gcTab === 'pbp') renderPBP();
  else if (gcTab === 'stats') renderTeamStats();
  else if (gcTab === 'box') {
    const seg = $('#boxTeam');
    seg.innerHTML = [1, 0].map(i => `<button data-i="${i}" class="${boxSide === i ? 'on' : ''}">${game.teams[i].abbr}</button>`).join('');
    seg.querySelectorAll('button').forEach(b => b.onclick = () => { boxSide = +b.dataset.i; renderBox(); });
    const t = game.teams[boxSide];
    $('#box').innerHTML = `<div class="sect" style="font-size:13px">${crest(t, 22)} ${esc(t.full)}</div>` + statTables(game.ps, t.players, t.colors[0], 10);
  }
}
function tableSec(title, color, head, rows) {
  if (!rows.length) return '';
  return `<div class="sect"><span class="sw" style="background:${color}"></span>${title}</div><div class="tblscroll"><table class="t"><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="l"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</table></div>`;
}
const pn = p => `${esc(p.short)} <span class="muted">#${p.num}</span>`;
function statRows(ps, players, filter) { return players.filter(p => ps[p.id] && filter(ps[p.id])).map(p => [p, ps[p.id]]); }
function teamBox(ti) {
  const g = game, t = g.teams[ti];
  return `<div class="sect" style="margin-top:18px;font-size:16px">${sw(t, 14)}${esc(t.full)}</div>` + statTables(g.ps, t.players, t.colors[0], 8);
}
function statTables(ps, players, c, defN) {
  const v = (s, k) => s[k] || 0;
  let h = '';
  h += tableSec('Passing', c, ['Player', 'C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'SCK'], statRows(ps, players, s => s.pa).map(([p, s]) => [pn(p), `${v(s, 'pc')}/${v(s, 'pa')}`, v(s, 'py'), (v(s, 'py') / Math.max(1, v(s, 'pa'))).toFixed(1), v(s, 'ptd'), v(s, 'pint'), `${v(s, 'sk')}-${v(s, 'sky')}`]));
  h += tableSec('Rushing', c, ['Player', 'CAR', 'YDS', 'AVG', 'TD', 'LNG'], statRows(ps, players, s => s.ra).sort((a, b) => v(b[1], 'ry') - v(a[1], 'ry')).map(([p, s]) => [pn(p), v(s, 'ra'), v(s, 'ry'), (v(s, 'ry') / Math.max(1, v(s, 'ra'))).toFixed(1), v(s, 'rtd'), v(s, 'rlng')]));
  h += tableSec('Receiving', c, ['Player', 'REC', 'YDS', 'AVG', 'TD', 'LNG', 'TGT'], statRows(ps, players, s => s.tgt).sort((a, b) => v(b[1], 'recy') - v(a[1], 'recy')).map(([p, s]) => [pn(p), v(s, 'rec'), v(s, 'recy'), (v(s, 'recy') / Math.max(1, v(s, 'rec'))).toFixed(1), v(s, 'rectd'), v(s, 'reclng'), v(s, 'tgt')]));
  h += tableSec('Defense', c, ['Player', 'TKL', 'SACK', 'INT', 'FF', 'FR'], statRows(ps, players, s => s.tk || s.sacks || s.ints || s.ff || s.fr).sort((a, b) => v(b[1], 'tk') - v(a[1], 'tk')).slice(0, defN).map(([p, s]) => [pn(p) + ` <span class="muted">${p.pos}</span>`, v(s, 'tk'), v(s, 'sacks'), v(s, 'ints'), v(s, 'ff'), v(s, 'fr')]));
  h += tableSec('Kicking', c, ['Player', 'FG', 'LNG', 'XP', 'PTS'], statRows(ps, players, s => s.fga || s.xpa).map(([p, s]) => [pn(p), `${v(s, 'fgm')}/${v(s, 'fga')}`, v(s, 'fglng'), `${v(s, 'xpm')}/${v(s, 'xpa')}`, v(s, 'fgm') * 3 + v(s, 'xpm')]));
  h += tableSec('Punting', c, ['Player', 'NO', 'YDS', 'AVG'], statRows(ps, players, s => s.pn).map(([p, s]) => [pn(p), v(s, 'pn'), v(s, 'pny'), (v(s, 'pny') / Math.max(1, v(s, 'pn'))).toFixed(1)]));
  h += tableSec('Returns', c, ['Player', 'KR', 'YDS', 'PR', 'YDS', 'TD'], statRows(ps, players, s => s.kr || s.pr).map(([p, s]) => [pn(p), v(s, 'kr'), v(s, 'kry'), v(s, 'pr'), v(s, 'pry'), v(s, 'krtd') + v(s, 'prtd')]));
  return h;
}

// ---------------------------------------------------------------- SEASON
let selWeek = null;
function offlineNote(where) { return `<div class="card notice">League mode needs the server. Start it with <code>node server.js</code> and open the address it prints. ${where || ''}</div>`; }
function standingsTable(rows, cutoff, seedOf, showDiv, clin) {
  return `<tr><th>#</th><th style="text-align:left">Team</th><th>W</th><th>L</th><th>T</th><th>PCT</th>${showDiv ? '<th>DIV</th>' : ''}<th>PF</th><th>PA</th><th>DIFF</th><th class="o">HOME</th><th class="o">AWAY</th><th class="o">STRK</th></tr>` +
    rows.map((r, i) => {
      const t = teamById(r.id), d = r.pf - r.pa, sd = seedOf ? seedOf[r.id] : null;
      return `<tr style="${cutoff && i === cutoff - 1 ? 'border-bottom:2px solid var(--text)' : ''}"><td>${i + 1}</td><td class="l"><span class="tcell">${crest(t, 24)} ${esc(t.full)}${clin && clin[r.id] ? `<span class="clin ${clin[r.id]}">${clin[r.id] === 'e' ? '-e' : '-' + clin[r.id]}</span>` : ''}${sd ? `<span class="seedb" title="Playoff seed">${sd}</span>` : ''}</span></td><td>${r.w}</td><td>${r.l}</td><td>${r.t}</td><td>${r.pct.toFixed(3).replace(/^0/, '')}</td>${showDiv ? `<td>${r.dw}-${r.dl}${r.dt ? '-' + r.dt : ''}</td>` : ''}<td>${r.pf}</td><td>${r.pa}</td><td style="color:${d > 0 ? 'var(--good)' : d < 0 ? 'var(--bad)' : 'inherit'}">${d > 0 ? '+' : ''}${d}</td><td class="o">${r.hw}-${r.hl}</td><td class="o">${r.aw}-${r.al}</td><td class="o">${r.strk}</td></tr>`;
    }).join('');
}
// Division tables + playoff picture. seeds: the final seeds ({id, seed, how}) once set, otherwise the current projection is shown.
function standingsHTML(games, divisional, seeds) {
  const reg = games.filter(g => !g.playoff);
  if (!divisional) return `<div class="tblscroll"><table class="t">${standingsTable(IFL.standings(reg), 4)}</table></div>`;
  const pic = seeds || (reg.some(g => g.result) ? IFL.playoffSeeds(reg) : null);
  const seedOf = {}; if (pic) pic.forEach(x => seedOf[x.id] = x.seed);
  const clin = seeds ? null : clinchMarks(reg);
  let h = IFL.divisionStandings(reg).map(d => `<div class="sect">${d.name}</div><div class="tblscroll"><table class="t">${standingsTable(d.rows, 0, seedOf, true, clin)}</table></div>`).join('');
  if (clin && Object.keys(clin).length) h += '<div class="legend">z = clinched top seed · y = clinched division · x = clinched playoff spot · e = eliminated</div>';
  if (pic) h += `<div class="sect">${seeds ? 'Playoff seeds' : 'Playoff picture (if the season ended today)'}</div><div class="pic">${pic.map(x => { const t = teamById(x.id); return `<span class="s">${x.seed}</span><span>${sw(t)} ${esc(t.full)}</span><span class="muted">${x.how}</span>`; }).join('')}</div>`;
  return h;
}
// Conservative clinch / elimination marks (ties count against the team, so a mark is never wrong).
function clinchMarks(reg) {
  if (!reg.some(g => g.result) || reg.every(g => g.result)) return null;
  const st = IFL.standings(reg), left = {};
  for (const g of reg) if (!g.result) { left[g.home] = (left[g.home] || 0) + 1; left[g.away] = (left[g.away] || 0) + 1; }
  const maxW = r => r.w + (left[r.id] || 0); // ties never add wins
  const wildCards = Math.max(0, IFL.PLAYOFF_TEAMS - IFL.divisionStandings(reg).length);
  const out = {};
  for (const r of st) {
    const others = st.filter(o => o.id !== r.id);
    const rivals = others.filter(o => o.div === r.div);
    const threat = others.filter(o => maxW(o) >= r.w).length;
    if (!others.some(o => maxW(o) >= r.w)) out[r.id] = 'z';
    else if (!rivals.some(o => maxW(o) >= r.w)) out[r.id] = 'y';
    else if (threat <= wildCards) out[r.id] = 'x';
    else {
      const above = others.filter(o => o.w > maxW(r));
      if (rivals.some(o => o.w > maxW(r)) && above.length >= IFL.PLAYOFF_TEAMS) out[r.id] = 'e';
    }
  }
  return out;
}
function maxWeek(reg) { return reg.reduce((m, g) => Math.max(m, +g.week || 0), 0) || 10; }
function renderSeason() {
  if (!NET.online || !NET.state || !NET.state.season) { $('#v-season').querySelector('.sgrid').classList.add('hide'); $('#champ').innerHTML = offlineNote(); $('#seasonTitle').textContent = 'Season'; $('#seasonStatus').textContent = ''; return; }
  $('#v-season').querySelector('.sgrid').classList.remove('hide');
  const S = NET.state.season, st = NET.state, games = S.games;
  const reg = games.filter(g => !g.playoff);
  const n = serverNow();
  const lg = liveGame(), ng = nextGame();
  const focus = lg || ng;
  if (selWeek == null) selWeek = focus ? focus.week : (S.playoffs ? 'P' : 1);
  $('#seasonTitle').textContent = `IFL Season ${S.number}`;
  let status = '';
  if (S.champion) status = 'Season complete';
  else if (st.settings.paused) status = 'Schedule paused';
  else if (focus) {
    const started = !!lg || games.some(g => g.result);
    status = (!started ? `Starts ${fmtWhen(focus.airStart)}` : focus.playoff ? 'Playoffs' : `Week ${focus.week} of ${maxWeek(reg)}`) + (st.estimatedEnd ? ` · IFL Bowl around ${fmtWhen(st.estimatedEnd)}` : '');
  }
  $('#seasonStatus').textContent = status;
  const ch = S.champion ? teamById(S.champion) : null;
  const prev = st.historyIndex && st.historyIndex[0];
  const dc = !ch && prev && prev.champion && !games.some(g => g.result) ? teamById(prev.champion) : null;
  $('#champ').innerHTML = ch ? `<div class="card champ" style="margin-bottom:12px;border-left:8px solid ${ch.colors[0]}">${crest(ch, 44)} ${esc(ch.full)} are Season ${S.number} IFL Bowl champions 🏆${st.nextSeasonAt ? `<span class="muted" style="font-family:Inter;font-size:13px;margin-left:auto">Season ${S.number + 1} starts ${fmtWhen(st.nextSeasonAt)}</span>` : ''}</div>`
    : dc ? `<div class="card champ" style="margin-bottom:12px;border-left:8px solid ${dc.colors[0]};font-size:18px">${crest(dc, 34)} Defending champions: ${esc(dc.full)} (Season ${prev.number})</div>` : '';
  if (S.offseason) $('#champ').insertAdjacentHTML('beforeend', `<div style="margin-bottom:12px">${offseasonHTML(S.offseason, S.number)}</div>`);
  if (S.playoffs) $('#champ').insertAdjacentHTML('beforeend', `<div class="card panel" style="margin-bottom:10px"><div class="hd"><h3>Playoff Bracket</h3></div>${bracketBig(S)}</div>`);
  { const nd = IFL.divisionStandings(reg).length, wc = Math.max(0, IFL.PLAYOFF_TEAMS - nd); const sub = document.querySelector('#v-season .sgrid .card .hd .muted'); if (sub) sub.textContent = `Division winners + ${wc} wild card${wc === 1 ? '' : 's'} make the playoffs`; }
  $('#standings').innerHTML = standingsHTML(games, true, S.playoffs && S.playoffs.info);
  // weeks
  const wk = $('#weeks'); wk.innerHTML = '';
  for (let i = 1; i <= maxWeek(reg); i++) {
    const wg = reg.filter(g => g.week === i);
    const b = el('button', { class: (selWeek === i ? 'on ' : '') + (wg.length && wg.every(g => g.result) ? 'done' : '') }, i);
    b.onclick = () => { selWeek = i; renderSeason(); }; wk.append(b);
  }
  const pb = el('button', { class: selWeek === 'P' ? 'on' : '' }, 'Playoffs'); pb.onclick = () => { selWeek = 'P'; renderSeason(); }; wk.append(pb);
  const gs = games.filter(g => g.week === selWeek);
  const box = $('#weekGames'); box.innerHTML = '';
  if (!gs.length) box.innerHTML = '<p class="muted" style="padding:12px 16px">Playoffs start once the regular season is complete. The top 4 teams qualify: 1 vs 4 and 2 vs 3, then the IFL Bowl.</p>';
  gs.forEach(g => box.append(gameRow(g, n, S.number)));
  renderLeaders(S.stats, $('#leaders'));
}
function gameRow(g, n, seasonNo, histMode) {
  const H = teamById(g.home), A = teamById(g.away), r = g.result;
  const onAir = !histMode && g.airStart != null && g.airStart <= n && n < g.airStart + g.dur;
  const played = !!r && !onAir;
  const showRec = !histMode && !g.playoff;
  const line = (t, sc, win) => `<div class="ln ${played ? (win ? 'w' : 'lose') : ''}">${crest(t, 30)}<div style="min-width:0"><div class="n">${esc(t.full)}</div>${showRec ? `<div class="r">${recStr(recordOf(t.id))}</div>` : ''}</div><b>${played ? sc : ''}</b></div>`;
  const row = el('div', { class: 'gm' + (onAir ? ' onair' : '') });
  let tag;
  if (onAir) tag = '<span class="pill live">Live</span> On air now';
  else if (played) tag = '<span class="pill final">Final' + (r.ot ? '/OT' : '') + '</span>' + (r.instant ? 'Simmed' : g.airStart ? fmtWhen(g.airStart) : '');
  else tag = g.airStart ? fmtWhen(g.airStart) + ' · ' + esc(venueText(g.venue, H)) : 'Not scheduled yet' + (NET.state && NET.state.settings.paused ? ' (paused)' : '');
  row.innerHTML = `<div style="min-width:0">${g.label ? `<div class="tag" style="color:var(--text);margin-bottom:2px">${g.label}</div>` : ''}${line(A, played && r.score[1], played && r.score[1] > r.score[0])}${line(H, played && r.score[0], played && r.score[0] > r.score[1])}<div class="tag" style="margin-top:4px">${tag}</div></div>`;
  const act = el('div', { class: 'act' });
  if (onAir) {
    const b = el('button', { class: 'btn primary' }, 'Watch Live');
    b.onclick = () => { followLive = true; showView('game'); syncLive(true); };
    act.append(b);
  } else if (played) {
    const b = el('button', { class: 'btn' }, 'Replay');
    b.onclick = async () => watchLocal(g, 'replay', `Season ${seasonNo} · ${gameLabel(g)} · ${A.abbr} @ ${H.abbr}`, histMode ? await seasonRosters(seasonNo) : null);
    act.append(b);
  } else if (!histMode && NET.state && NET.state.season) {
    const p = IFL.pregameWinProb(g.home, g.away, { rosters: NET.state.season.rosters, out: g.out || [], playoff: !!g.playoff, venue: g.venue || undefined });
    const fav = p >= 0.5 ? H : A, pct = Math.round(Math.max(p, 1 - p) * 100);
    act.innerHTML = `<span class="muted" style="font-size:11.5px;font-weight:700;text-align:right">${fav.abbr} ${pct}%<br><span style="font-weight:600">win chance</span></span>`;
  }
  row.append(act);
  return row;
}
function renderLeaders(stats, target, rosters) {
  const all = []; Object.values(rosters || curRosters()).forEach(list => list.forEach(p => { if (stats[p.id]) all.push([p, stats[p.id]]); }));
  const top = fn => all.map(([p, s]) => [p, fn(s)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const cats = [
    ['Passing Yards', s => s.py || 0], ['Passing TD', s => s.ptd || 0], ['Rushing Yards', s => s.ry || 0], ['Receiving Yards', s => s.recy || 0],
    ['Total TD', s => (s.rtd || 0) + (s.rectd || 0) + (s.krtd || 0) + (s.prtd || 0) + (s.deftd || 0)], ['Sacks', s => s.sacks || 0], ['Interceptions', s => s.ints || 0], ['Tackles', s => s.tk || 0],
  ];
  target.innerHTML = cats.map(([nm, fn]) => { const rows = top(fn); return `<div class="lb"><h4>${nm}</h4>${rows.length ? rows.map(([p, v]) => `<div><span>${sw(T[p.team])} ${esc(p.short)} <span class="muted">${T[p.team].abbr} · ${p.pos}</span></span><b>${v}</b></div>`).join('') : '<div class="muted">—</div>'}</div>`; }).join('');
}

// ---------------------------------------------------------------- HOME (ESPN-style front page)
const simCache = {};
function simOf(g, rosters) { // re-run a finished game (deterministic) to get its box score
  if (!simCache[g.gid + g.seed]) simCache[g.gid + g.seed] = IFL.simulateGame(g.home, g.away, g.seed, { playoff: !!g.playoff, rosters: rosters || curRosters(), out: g.out || [], venue: g.venue || undefined });
  return simCache[g.gid + g.seed];
}
function starOf(sim, ti) {
  let b = null;
  const sc = s => (s.py || 0) / 25 + (s.ptd || 0) * 4 - (s.pint || 0) * 2 + (s.ry || 0) / 10 + (s.rtd || 0) * 6 + (s.recy || 0) / 10 + (s.rectd || 0) * 6 + (s.sacks || 0) * 3 + (s.ints || 0) * 4;
  for (const p of sim.teams[ti].players) { const s = sim.ps[p.id]; if (s) { const v = sc(s); if (!b || v > b.v) b = { p, s, v }; } }
  if (!b) return null;
  const s = b.s;
  const td = (s.rtd || 0) + (s.rectd || 0);
  const line = s.pa ? `${s.py} passing yards and ${s.ptd || 0} TD` : (s.ry || 0) >= 30 && (s.recy || 0) >= 30 ? `${s.ry} rushing and ${s.recy} receiving yards${td ? ', ' + td + ' TD' : ''}` : s.ra && (s.ry || 0) >= (s.recy || 0) ? `${s.ry} rushing yards${s.rtd ? ' and ' + s.rtd + ' TD' : ''}` : s.rec ? `${s.recy} receiving yards${s.rectd ? ' and ' + s.rectd + ' TD' : ''}` : s.sacks ? `${s.sacks} sacks` : `${s.ints || 0} interceptions`;
  return { p: b.p, line };
}
function headlines() {
  const S = NET.state.season, n = serverNow(), out = [];
  const aired = S.games.filter(g => g.result && g.airStart + g.dur <= n).sort((a, b) => ((b.result.at || 0) - (a.result.at || 0)) || (b.airStart - a.airStart));
  for (const g of aired.slice(0, 6)) {
    const sim = simOf(g), [hs, as] = g.result.score, wi = hs > as ? 0 : as > hs ? 1 : -1;
    if (wi < 0) { out.push({ t: g.airStart, team: teamById(g.home), h: `${teamById(g.away).full} and ${teamById(g.home).full} play to a ${hs}–${as} tie` }); continue; }
    const W = teamById(wi === 0 ? g.home : g.away), Lt = teamById(wi === 0 ? g.away : g.home), ws = Math.max(hs, as), ls = Math.min(hs, as);
    const star = starOf(sim, wi);
    const p = IFL.pregameWinProb(g.home, g.away, { rosters: curRosters(), out: g.out || [], playoff: !!g.playoff, venue: g.venue || undefined });
    const wp = wi === 0 ? p : 1 - p;
    const verb = ws - ls >= 21 ? 'rout' : ws - ls <= 3 ? 'edge' : 'beat';
    let h = g.gid === 'P-F' ? `${W.full} win the IFL Bowl, ${ws}–${ls} over the ${Lt.name}` : `${W.name} ${verb} ${Lt.name} ${ws}–${ls}${g.result.ot ? ' in overtime' : ''}`;
    let sub = star ? `${star.p.name} led the way with ${star.line}.` : '';
    if (wp < 0.35 && g.gid !== 'P-F') sub = `Upset: the ${W.name} had a ${Math.round(wp * 100)}% chance before kickoff. ` + sub;
    if (g.playoff && g.gid !== 'P-F') sub = `${W.full} advance to the IFL Bowl. ` + sub;
    out.push({ t: g.airStart, team: W, h, sub, gid: g.gid, tag: g.playoff ? (g.gid === 'P-F' ? 'IFL Bowl' : 'Playoffs') : 'Week ' + g.week });
  }
  // long-term injuries to starters
  const inj = Object.entries(S.injuries || {}).filter(([, x]) => x.total >= 4).slice(0, 3);
  for (const [, x] of inj) { const t = teamById(x.team); out.push({ t: 0, team: t, h: `${t.name} lose ${x.pos} ${x.name} ${x.total >= 99 ? 'for the season' : 'for ' + x.total + ' games'}`, sub: `${x.part.charAt(0).toUpperCase() + x.part.slice(1)} injury.`, tag: 'Injury' }); }
  // streaks and clinches
  const reg = S.games.filter(g => !g.playoff), st = IFL.standings(reg);
  for (const r of st) if (r.strk && /^W[3-9]/.test(r.strk)) out.push({ t: 0, team: teamById(r.id), h: `${teamById(r.id).name} have won ${r.strk.slice(1)} straight`, tag: 'Streak' });
  const cl = clinchMarks(reg) || {};
  for (const [id, m] of Object.entries(cl)) if (m !== 'e') out.push({ t: 0, team: teamById(id), h: `${teamById(id).full} clinch ${m === 'z' ? 'the top seed' : m === 'y' ? 'the ' + (divOfTeam(id) || {}).name + ' title' : 'a playoff spot'}`, tag: 'Clinched' });
  // expansion news
  const S1 = NET.state.season, newbies = IFL.TEAMS.filter(t => S1.teams && !S1.teams.includes(t.id));
  if (newbies.length) out.splice(Math.min(1, out.length), 0, { t: 0, team: newbies[0], h: `${newbies.map(t => t.full).join(' and ')} join the IFL in Season ${S1.number + 1}`, sub: newbies.map(t => `${t.name}: ${IFL.divName(t.div)}`).join(' · ') + `. The league grows to ${IFL.TEAMS.length} teams in ${IFL.DIVISIONS.length} divisions (${IFL.DIVISIONS.map(d => d.name).join(', ')}) with a ${((NET.state.calendar || {}).next || {}).weeks || ''}-game season.`, tag: 'Expansion' });
  const exp = S1.offseason && S1.offseason.expansion;
  if (exp && !S1.games.some(g => g.result)) out.unshift({ t: 0, team: teamById(exp[0]), h: `Welcome to the IFL: ${exp.map(id => teamById(id).full).join(' and ')}`, sub: 'The expansion teams play their first season.', tag: 'Expansion' });
  return out.slice(0, 9);
}
function featuredGame() {
  const lg = liveGame(), ng = nextGame(), lf = lastFinished();
  return lg ? { g: lg, kind: 'live' } : ng ? { g: ng, kind: 'next' } : lf ? { g: lf, kind: 'final' } : null;
}
function renderHome() {
  const body = $('#homeBody');
  if (!NET.online || !NET.state || !NET.state.season) { body.innerHTML = offlineNote('The Live tab still plays exhibition games.'); return; }
  const S = NET.state.season, n = serverNow(), f = featuredGame();
  let hero = '';
  if (f) {
    const g = f.g, A = teamById(g.away), H = teamById(g.home), bowl = g.gid === 'P-F';
    const liveSim = f.kind === 'live' && P && P.o.mode === 'live' && P.o.gid === g.gid && game ? game : null;
    const sc = f.kind === 'final' ? [g.result.score[0], g.result.score[1]] : liveSim ? liveSim.score : null;
    const status = f.kind === 'live' ? `<span class="pill live">Live</span>${liveSim && liveSim.events.length ? ' ' + qLabel(liveSim.qtr) + ' Quarter' : ''}` : f.kind === 'next' ? `<span class="pill next">Up next</span> ${fmtWhen(g.airStart)} · kickoff in ${fmtIn(g.airStart - n)}` : '<span class="pill final">Final</span>';
    const p = IFL.pregameWinProb(g.home, g.away, { rosters: S.rosters, out: g.out || [], playoff: !!g.playoff, venue: g.venue || undefined });
    const side = (t, score, right) => `<div class="hs${right ? ' r' : ''}">${crest(t, 76)}<div><div class="hc">${esc(t.city)}</div><div class="hn">${esc(t.name)}</div><div class="hr">${g.playoff ? '' : recStr(recordOf(t.id))}</div></div>${score != null ? `<div class="hsc">${score}</div>` : ''}</div>`;
    hero = `<div class="card herocard${bowl ? ' bowl' : g.playoff ? ' po' : ''}">
      <div class="hhd">${bowl ? TROPHY + '<b>The IFL Bowl</b>' : g.playoff ? '<b>IFL Playoffs · Semifinal</b>' : `<b>Season ${S.number} · Week ${g.week}</b>`}<span>${status}</span></div>
      <div class="hbody">${side(A, sc ? sc[1] : null)}<div class="hvs">${sc ? '–' : '@'}</div>${side(H, sc ? sc[0] : null, true)}</div>
      <div class="hft"><span class="muted">${f.kind === 'next' ? `Pregame odds: ${A.abbr} ${Math.round((1 - p) * 100)}% · ${H.abbr} ${Math.round(p * 100)}%` : esc(venueText(g.venue, H)) + ' · ' + gameLabel(g)}</span>
      <button class="btn ${f.kind === 'live' ? 'live' : 'primary'}" id="heroBtn">${f.kind === 'live' ? 'Watch live' : f.kind === 'next' ? 'Go to Gamecast' : 'Replay'}</button></div></div>`;
  }
  const hl = headlines();
  const hlHTML = hl.length ? hl.map((x, i) => `<div class="hl${i === 0 ? ' top' : ''}">${crest(x.team, i === 0 ? 46 : 32)}<div><div class="tg">${x.tag || 'News'}</div><div class="hh">${esc(x.h)}</div>${x.sub ? `<div class="hs2">${esc(x.sub)}</div>` : ''}</div></div>`).join('') : '<p class="muted" style="padding:12px 14px;margin:0">Headlines appear once games are played.</p>';
  const focusWeek = f ? f.g.week : 1;
  const reg = S.games.filter(g => !g.playoff);
  const mini = IFL.divisionStandings(reg).map(d => `<div class="sect" style="margin:10px 0 4px">${d.name}</div><table class="t">${d.rows.map(r => { const t = teamById(r.id); return `<tr><td class="l"><span class="tcell">${crest(t, 22)} ${esc(t.name)}</span></td><td>${recStr(r)}</td></tr>`; }).join('')}</table>`).join('');
  body.innerHTML = `<div class="homegrid">
    <div>${hero}${S.playoffs ? `<div class="card panel" style="margin-bottom:10px"><div class="hd"><h3>Playoff Bracket</h3></div>${bracketBig(S)}</div>` : ''}
      <div class="card panel" style="margin-bottom:10px"><div class="hd"><h3>Top Headlines</h3></div><div class="hls">${hlHTML}</div></div>
      <div class="card panel"><div class="hd"><h3>${focusWeek === 'P' ? 'Playoffs' : 'Week ' + focusWeek} Scoreboard</h3></div><div class="slate" id="homeSlate"></div></div></div>
    <aside><div class="card panel" style="margin-bottom:10px"><div class="hd"><h3>Standings</h3></div><div style="padding:0 12px 12px">${mini}</div></div>
      <div class="card panel"><div class="hd"><h3>League Leaders</h3></div><div class="leaders" id="homeLeaders" style="grid-template-columns:1fr"></div></div></aside></div>`;
  const slate = $('#homeSlate');
  S.games.filter(g => g.week === focusWeek).forEach(g => slate.append(gameRow(g, n, S.number)));
  renderLeaders(S.stats, $('#homeLeaders'));
  $('#homeLeaders').querySelectorAll('.lb').forEach((lb, i) => { if (i > 3) lb.remove(); else lb.querySelectorAll('div').forEach((d, j) => { if (j >= 3) d.remove(); }); });
  const hb = $('#heroBtn');
  if (hb) hb.onclick = () => { const g = f.g; if (f.kind === 'final') watchLocal(g, 'replay', `Season ${S.number} · ${gameLabel(g)} · ${teamById(g.away).abbr} @ ${teamById(g.home).abbr}`); else { followLive = true; showView('game'); syncLive(true); } };
}
// a larger bracket for the Home and Season pages
function bracketBig(S) {
  const g3 = S.games.filter(g => g.playoff), info = S.playoffs.info || [], n = serverNow();
  const seed = id => { const x = info.find(i => i.id === id); return x ? x.seed : ''; };
  const m = (g, lab, ids) => {
    const aired = g && g.result && g.airStart + g.dur <= n;
    const teams = g ? [g.away, g.home] : ids;
    const rows = teams.map((id, k) => {
      if (!id) return `<div class="br-t muted">TBD</div>`;
      const t = teamById(id), sc = aired ? g.result.score[k === 0 ? 1 : 0] : '', w = aired && sc > g.result.score[k === 0 ? 0 : 1];
      return `<div class="br-t${aired && !w ? ' l' : ''}"><span class="sd">${seed(id)}</span>${crest(t, 22)}<span class="nm">${esc(t.name)}</span><b>${sc}</b></div>`;
    }).join('');
    const on = g && g.airStart != null && g.airStart <= n && n < g.airStart + g.dur;
    return `<div class="br-m"><div class="br-l">${lab}${on ? ' · <span style="color:var(--live)">LIVE</span>' : g && g.airStart && !aired ? ' · ' + fmtWhen(g.airStart) : ''}</div>${rows}</div>`;
  };
  const s = info.map(x => x.id);
  const sf1 = g3.find(g => g.gid === 'P-SF1'), sf2 = g3.find(g => g.gid === 'P-SF2'), fin = g3.find(g => g.gid === 'P-F');
  return `<div class="bracketbig"><div class="br-col">${m(sf1, 'Semifinal · 1 vs 4', [s[3], s[0]])}${m(sf2, 'Semifinal · 2 vs 3', [s[2], s[1]])}</div><div class="br-col fin">${m(fin, 'IFL Bowl', [null, null])}${S.champion ? `<div class="br-ch">${TROPHY}<b>${esc(teamById(S.champion).full)}</b><span>Champions</span></div>` : ''}</div></div>`;
}

// ---------------------------------------------------------------- HISTORY
let histSel = null;
async function renderHistory() {
  const body = $('#histBody');
  if (!NET.online) { body.innerHTML = offlineNote(); return; }
  if (!NET.history) {
    body.innerHTML = '<p class="muted">Loading history…</p>';
    try { const r = await fetch('/api/history', { cache: 'no-store' }); NET.history = (await r.json()).history; } catch (e) { body.innerHTML = '<p class="muted">Could not load history.</p>'; return; }
  }
  const H = NET.history, S = NET.state.season;
  // all-time records include the current season's results
  const seasons = H.map(h => ({ number: h.number, games: h.games, champion: h.champion, runnerUp: h.runnerUp, seeds: h.seeds, done: h.done, stats: h.stats, standings: h.standings, format: h.format, seedInfo: h.seedInfo }));
  if (S) seasons.unshift({ number: S.number, games: S.games.filter(g => g.result && g.airStart + g.dur <= serverNow()), champion: S.champion, seeds: S.playoffs ? S.playoffs.seeds : null, current: true, stats: S.stats, format: S.format, seedInfo: S.playoffs && S.playoffs.info });
  const at = {}; T.forEach(t => at[t.id] = { id: t.id, w: 0, l: 0, t: 0, pf: 0, pa: 0, titles: 0, apps: 0, finals: 0 });
  const allGames = [];
  seasons.forEach(se => {
    se.games.forEach(g => {
      if (!g.result) return;
      allGames.push(Object.assign({ season: se.number }, g));
      const [hs, as] = g.result.score, h = at[g.home], a = at[g.away];
      h.pf += hs; h.pa += as; a.pf += as; a.pa += hs;
      if (hs > as) { h.w++; a.l++; } else if (as > hs) { a.w++; h.l++; } else { h.t++; a.t++; }
    });
    if (se.champion) at[se.champion].titles++;
    if (se.seeds) se.seeds.forEach(id => at[id].apps++);
    const fin = se.games.find(g => g.gid === 'P-F'); if (fin) { at[fin.home].finals++; at[fin.away].finals++; }
  });
  const atRows = Object.values(at).filter(r => r.w + r.l + r.t > 0 || inSeason(r.id)).sort((a, b) => b.titles - a.titles || (b.w + b.t / 2) / Math.max(1, b.w + b.l + b.t) - (a.w + a.t / 2) / Math.max(1, a.w + a.l + a.t));
  const champs = seasons.filter(se => se.champion);
  // records
  const recs = [];
  if (allGames.length) {
    const desc = g => `${teamById(g.away).abbr} ${g.result.score[1]} @ ${teamById(g.home).abbr} ${g.result.score[0]} · S${g.season} ${gameLabel(g)}`;
    const hi = allGames.reduce((b, g) => Math.max(...g.result.score) > Math.max(...b.result.score) ? g : b);
    const tot = allGames.reduce((b, g) => g.result.score[0] + g.result.score[1] > b.result.score[0] + b.result.score[1] ? g : b);
    const mar = allGames.reduce((b, g) => Math.abs(g.result.score[0] - g.result.score[1]) > Math.abs(b.result.score[0] - b.result.score[1]) ? g : b);
    const lo = allGames.reduce((b, g) => g.result.score[0] + g.result.score[1] < b.result.score[0] + b.result.score[1] ? g : b);
    recs.push(['Most points by a team', Math.max(...hi.result.score), desc(hi)], ['Highest-scoring game', tot.result.score[0] + tot.result.score[1], desc(tot)], ['Biggest blowout', '+' + Math.abs(mar.result.score[0] - mar.result.score[1]), desc(mar)], ['Lowest-scoring game', lo.result.score[0] + lo.result.score[1], desc(lo)]);
  }
  if (histSel == null || !seasons.find(x => x.number === histSel)) histSel = (H[0] || seasons[0] || {}).number;
  const sel = seasons.find(x => x.number === histSel);
  body.innerHTML = `
  <div class="hgrid" style="margin-bottom:12px">
    <div class="card panel"><div class="hd"><h3>Champions</h3><span class="muted">${champs.length} title${champs.length === 1 ? '' : 's'} awarded</span></div>
      <div class="champs">${champs.length ? champs.map(se => { const c = teamById(se.champion), ru = se.runnerUp ? teamById(se.runnerUp) : null; return `<div class="c"><span class="n">Season ${se.number}</span>${sw(c, 14)}<b>${esc(c.full)}</b>${ru ? `<span class="muted">def. ${esc(ru.abbr)}</span>` : ''}</div>`; }).join('') : '<p class="muted" style="padding:0 16px">No champions crowned yet.</p>'}</div></div>
    <div class="card panel"><div class="hd"><h3>All-Time Standings</h3><span class="muted">${allGames.length} games played across ${seasons.length} season${seasons.length === 1 ? '' : 's'}</span></div>
      <div class="tblscroll" style="padding:4px 10px 10px"><table class="t"><tr><th style="text-align:left">Team</th><th>Titles</th><th>Finals</th><th>Playoffs</th><th>W</th><th>L</th><th>T</th><th>PCT</th><th>PF</th><th>PA</th></tr>
      ${atRows.map(r => { const t = teamById(r.id), gp = r.w + r.l + r.t; return `<tr><td class="l">${sw(t)} ${esc(t.full)}</td><td><b>${r.titles}</b></td><td>${r.finals}</td><td>${r.apps}</td><td>${r.w}</td><td>${r.l}</td><td>${r.t}</td><td>${gp ? ((r.w + r.t / 2) / gp).toFixed(3).replace(/^0/, '') : '—'}</td><td>${r.pf}</td><td>${r.pa}</td></tr>`; }).join('')}</table></div></div>
  </div>
  ${recs.length ? `<div class="card panel" style="margin-bottom:12px"><div class="hd"><h3>League Records</h3></div><div class="tblscroll" style="padding:4px 10px 10px"><table class="t">${recs.map(r => `<tr><td class="l">${r[0]}</td><td><b>${r[1]}</b></td><td class="l muted">${esc(r[2])}</td></tr>`).join('')}</table></div></div>` : ''}
  <div class="card panel"><div class="hd"><h3>Season Archive</h3><select id="histSeason">${seasons.map(se => `<option value="${se.number}" ${se.number === histSel ? 'selected' : ''}>Season ${se.number}${se.current ? ' (current)' : se.done ? '' : ' (unfinished)'}</option>`).join('')}</select></div>
    <div id="histSeasonBody"></div></div>`;
  $('#histSeason').onchange = e => { histSel = +e.target.value; renderHistory(); };
  if (sel) {
    const sb = $('#histSeasonBody');
    sb.innerHTML = '<p class="muted" style="padding:12px 16px">Loading season…</p>';
    let det = {};
    try { det = sel.current ? NET.state.season : await seasonDetail(sel.number); } catch (e) {}
    if (histSel !== sel.number) return; // user switched seasons while loading
    sb.innerHTML = `<div class="sgrid" style="padding:12px 16px"><div><div class="sect">${sel.current ? 'Standings' : 'Final standings'}</div>${standingsHTML(sel.games, !!sel.format && String(sel.format).startsWith('div'), sel.seedInfo)}<div class="sect">Leaders</div><div class="leaders" id="histLeaders" style="padding:0"></div></div><div><div class="sect">Results</div><div id="histGames" class="slate" style="padding:0"></div></div></div>` +
      (det.offseason ? `<div style="padding:0 16px 14px">${offseasonHTML(det.offseason, sel.number)}</div>` : '');
    renderLeaders(det.stats || sel.stats || {}, $('#histLeaders'), det.rosters);
    const hg = $('#histGames');
    const order = g => (g.playoff ? 100 : g.week) * 10 + (g.gid === 'P-F' ? 5 : 0);
    const list = sel.games.slice().sort((a, b) => order(b) - order(a) || (b.airStart || 0) - (a.airStart || 0));
    if (!list.length) hg.innerHTML = '<p class="muted">No games played.</p>';
    list.forEach(g => hg.append(gameRow(g, serverNow(), sel.number, true)));
  }
}

// Offseason report: retirements, draft, biggest rating changes. Shown in the Season tab and History.
function offseasonHTML(rep, seasonNo) {
  const tm = id => { const t = teamById(id); return `${sw(t)} ${t.abbr}`; };
  const arrow = m => { const d = m.to - m.from; return `<b style="color:${d >= 0 ? 'var(--good)' : 'var(--bad)'}">${d >= 0 ? '▲' : '▼'}${Math.abs(d)}</b>`; };
  const rounds = {};
  rep.drafted.forEach(d => (rounds[d.round] = rounds[d.round] || []).push(d));
  return `<details class="card exh" style="margin:0"><summary>Offseason before Season ${seasonNo} <span class="muted" style="font-weight:500">· ${rep.retired.length} retirements · ${rep.drafted.length} rookies drafted</span></summary>
    <div class="two" style="padding:0 16px 14px">
      <div>
        <div class="sect">Draft</div>
        <div class="tblscroll"><table class="t"><tr><th>Pick</th><th style="text-align:left">Team</th><th style="text-align:left">Player</th><th>Pos</th><th>Age</th><th>OVR</th></tr>
        ${rep.drafted.map(d => `<tr><td>${d.round}.${String(d.pick).padStart(2, '0')}</td><td class="l">${tm(d.team)}</td><td class="l">${esc(d.name)}</td><td>${d.pos}</td><td>${d.age}</td><td><b>${d.r}</b></td></tr>`).join('')}</table></div>
      </div>
      <div>
        <div class="sect">Retired</div>
        <div class="tblscroll"><table class="t"><tr><th style="text-align:left">Team</th><th style="text-align:left">Player</th><th>Pos</th><th>Age</th><th>Seasons</th><th>OVR</th></tr>
        ${rep.retired.slice().sort((a, b) => b.r - a.r).map(p => `<tr><td class="l">${tm(p.team)}</td><td class="l">${esc(p.name)}</td><td>${p.pos}</td><td>${p.age}</td><td>${p.yrs || '—'}</td><td>${p.r}</td></tr>`).join('')}</table></div>
        <div class="sect">Biggest jumps</div>
        <table class="t">${rep.improved.slice(0, 5).map(m => `<tr><td class="l">${tm(m.team)} ${esc(m.name)} <span class="muted">${m.pos}, ${m.age}</span></td><td>${m.from} → ${m.to}</td><td>${arrow(m)}</td></tr>`).join('')}</table>
        <div class="sect">Biggest drops</div>
        <table class="t">${rep.declined.slice(0, 5).map(m => `<tr><td class="l">${tm(m.team)} ${esc(m.name)} <span class="muted">${m.pos}, ${m.age}</span></td><td>${m.from} → ${m.to}</td><td>${arrow(m)}</td></tr>`).join('')}</table>
      </div>
    </div></details>`;
}
function injuryLabel(inj) { return inj.total >= 99 ? 'Out for season' : `Out ${inj.left} more game${inj.left === 1 ? '' : 's'}`; }

// ---------------------------------------------------------------- TEAMS
let selTeam = 'MIS';
function stadiumLine(t) {
  const V = NET.state && NET.state.venues;
  const st = V && V.stadiums[t.id];
  if (st) return `🏟 ${esc(st.name)} · ${esc(st.town)}`;
  const owners = V ? Object.keys(V.stadiums) : [];
  if (!owners.length) return `Home games in ${esc(t.city)} · X ${t.x.toLocaleString()}, Z ${t.z.toLocaleString()}`;
  const at = owners.includes(V.homeAt[t.id]) ? V.homeAt[t.id] : owners.includes('MIS') ? 'MIS' : owners[0];
  return `No stadium yet · home games at ${esc(V.stadiums[at].name)}, ${esc(V.stadiums[at].town)}`;
}
function renderTeams() {
  // team picker: every team visible, grouped by division
  const chips = $('#teamChips'); chips.innerHTML = '';
  for (const d of IFL.DIVISIONS) {
    const grp = el('div', { class: 'tpgrp' }, `<div class="tplab">${esc(d.name)}</div>`);
    const grid = el('div', { class: 'tpgrid' });
    for (const id of d.teams) {
      const t = teamById(id);
      const b = el('button', { class: 'tp' + (t.id === selTeam ? ' on' : ''), style: `--tc:${t.colors[0]}`, 'aria-pressed': t.id === selTeam ? 'true' : 'false' },
        `${crest(t, 30)}<span><small>${esc(t.city)}${inSeason(t.id) ? '' : ' · <em class="joins">Joins next season</em>'}</small><b>${esc(t.name)}</b></span>`);
      b.onclick = () => { selTeam = t.id; renderTeams(); };
      grid.append(b);
    }
    grp.append(grid); chips.append(grp);
  }
  const S = NET.state && NET.state.season;
  if (!inSeason(selTeam)) {
    const tt = teamById(selTeam), c0 = tt.colors[0];
    const tile0 = LOGOS[tt.id] ? crest(tt, 84) : `<span style="background:#fff;border-radius:3px;padding:5px;display:inline-flex">${crest(tt, 74)}</span>`;
    $('#teamDetail').innerHTML = `<div class="card">
      <div class="thero" style="--tc:${c0};--tc2:${tt.colors[1]};--ti:${ink(c0)}"><div class="in">${tile0}
        <div><h2>${esc(tt.full)}</h2><div class="sub">Expansion team · joins ${esc(IFL.divName(tt.div))} in Season ${S.number + 1}</div><div class="sub" style="margin-top:3px">${stadiumLine(tt)}</div></div></div><div class="stripe"></div></div>
      <div class="pad" style="padding:18px 20px">
        <p style="margin:0 0 8px;font-weight:700">The ${esc(tt.name)} start playing when Season ${S.number + 1} begins.</p>
        <p class="muted" style="margin:0">Their roster of new players is created at that moment, together with the offseason for the rest of the league, so it isn't shown yet. From then on they play a full ${((NET.state.calendar || {}).next || {}).weeks || ''}-game season in ${esc(IFL.divName(tt.div))}.</p>
      </div></div>`;
    return;
  }
  const rosters = curRosters();
  const injuries = (S && S.injuries) || {};
  const injIds = Object.keys(injuries).filter(pid => injuries[pid].team === selTeam);
  const t = IFL.buildTeam(selTeam, rosters[selTeam], injIds), c = t.colors[0], rt = t.rt;
  const healthy = IFL.buildTeam(selTeam, rosters[selTeam]).rt;
  const bar = (n, v) => `<div class="rate"><span>${n}</span><div class="b"><i style="width:${Math.max(0, Math.min(100, (v - 45) / 54 * 100))}%;background:${c}"></i></div><b>${Math.round(v)}</b></div>`;
  const groups = [['Offense', ['QB', 'RB', 'WR', 'TE', 'OL']], ['Defense', ['DL', 'LB', 'CB', 'S']], ['Special Teams', ['K', 'P']]];
  const status = (p, i) => {
    if (injuries[p.id]) return `<span style="color:var(--bad);font-weight:600">${injuryLabel(injuries[p.id])}</span>`;
    if (p.rookie) return '<span class="chip FLAG" style="margin:0">ROOKIE</span>';
    return i < IFL.STARTERS[p.pos] ? 'Starter' : '<span class="muted">Backup</span>';
  };
  const delta = p => { if (p.prevR == null) return '<span class="muted">—</span>'; const d = p.r - p.prevR; return d === 0 ? '<span class="muted">0</span>' : `<span style="color:${d > 0 ? 'var(--good)' : 'var(--bad)'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>`; };
  const rosterTbl = pos => `<div class="tblscroll"><table class="t"><tr><th>Pos</th><th>#</th><th style="text-align:left">Name</th><th>Age</th><th>OVR</th><th>±</th><th style="text-align:left">Status</th></tr>${pos.flatMap(ps => {
    const list = t.depth[ps].filter(p => !p.filler).concat(t.players.filter(p => p.pos === ps && t.out.has(p.id)));
    return list.map((p, i) => `<tr><td class="l">${p.pos}</td><td>${p.num}</td><td class="l">${esc(p.name)}</td><td>${p.age}</td><td><b>${p.r}</b></td><td>${delta(p)}</td><td class="l">${status(p, i)}</td></tr>`);
  }).join('')}</table></div>`;
  // rating history across seasons
  const hist = [];
  ((NET.state && NET.state.historyIndex) || []).slice().reverse().forEach(h => { if (h.teamRatings && h.teamRatings[selTeam]) hist.push([h.number, h.teamRatings[selTeam].ovr, h.champion === selTeam]); });
  if (S && S.teamRatings && S.teamRatings[selTeam]) hist.push([S.number, S.teamRatings[selTeam].ovr, S.champion === selTeam]);
  const injList = injIds.map(pid => injuries[pid]).sort((a, b) => b.left - a.left);
  // record + place in the division this season
  let place = (divOfTeam(t.id) || {}).name || IFL.divName(t.div), recTxt = '';
  if (S) {
    const reg = S.games.filter(g => !g.playoff);
    if (reg.some(g => g.result)) {
      const d = IFL.divisionStandings(reg).find(x => x.rows.some(row => row.id === t.id));
      const i = d ? d.rows.findIndex(r => r.id === t.id) : -1;
      if (i >= 0) place = `${['1st', '2nd', '3rd', '4th', '5th', '6th'][i] || (i + 1) + 'th'} in ${d.name}`;
      recTxt = recStr(recordOf(t.id));
    }
  }
  const tile = LOGOS[t.id] ? crest(t, 84) : `<span style="background:#fff;border-radius:3px;padding:5px;display:inline-flex">${crest(t, 74)}</span>`;
  $('#teamDetail').innerHTML = `<div class="card">
    <div class="thero" style="--tc:${c};--tc2:${t.colors[1]};--ti:${ink(c)}"><div class="in">${tile}
      <div><h2>${esc(t.full)}</h2><div class="sub">${recTxt ? recTxt + ' · ' : ''}${esc(place)}</div><div class="sub" style="margin-top:3px">${stadiumLine(t)}</div></div>
      <div class="stats"><div><b>${rt.ovr}</b><span>Overall</span></div><div><b>${rt.off}</b><span>Offense</span></div><div><b>${rt.def}</b><span>Defense</span></div></div></div><div class="stripe"></div></div>
    <div class="pad two">
      <div>${bar('Quarterback', rt.qb)}${bar('Running Back', rt.rb)}${bar('Receivers', rt.rec)}${bar('Offensive Line', rt.ol)}${bar('Pass Rush', rt.rush)}${bar('Run Defense', rt.runD)}${bar('Coverage', rt.cov)}${bar('Kicker', rt.k)}${bar('Punter', rt.p)}</div>
      <div>
        <div class="sect">Injury report</div>
        ${injList.length ? `<table class="t">${injList.map(x => `<tr><td class="l">${x.pos} ${esc(x.short)}</td><td class="l muted">${x.part}</td><td class="l" style="color:var(--bad)">${injuryLabel(x)}</td></tr>`).join('')}</table>
          <p class="muted" style="font-size:12px">Healthy, this team rates ${healthy.ovr} overall.</p>` : '<p class="muted">No injuries.</p>'}
        <div class="sect">Rating by season</div>
        ${hist.length ? `<div class="row" style="gap:6px">${hist.map(([n, o, ch]) => `<span class="chip TIMEOUT" style="font-size:12px;padding:3px 8px">S${n} <b style="color:var(--text)">${o}</b>${ch ? ' 🏆' : ''}</span>`).join('')}</div>` : '<p class="muted">—</p>'}
        <p class="muted" style="font-size:12px;margin-top:12px">Players age every offseason: young players usually improve, veterans decline and eventually retire, and the draft brings in new rookies (worst team picks first). Injuries keep players out for a number of games; the best healthy player starts.</p>
      </div>
    </div>
    <div class="pad two" style="padding-top:0">${groups.map(([n, ps]) => `<div><div class="sect">${n}</div>${rosterTbl(ps)}</div>`).join('')}</div>
  </div>`;
  if (S) {
    $('#teamDetail').insertAdjacentHTML('beforeend', '<div class="card panel" style="margin-top:10px"><div class="hd"><h3>Schedule &amp; Results</h3></div><div class="slate" id="teamSlate"></div></div>');
    const slate = $('#teamSlate'), n = serverNow();
    S.games.filter(g => g.home === selTeam || g.away === selTeam).forEach(g => slate.append(gameRow(g, n, S.number)));
  }
}

// ---------------------------------------------------------------- MAP
let mapSel = null;
function renderMap() {
  const svg = $('#map'); svg.innerHTML = '';
  const xs = T.map(t => t.x), zs = T.map(t => t.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const pad = 80, W = 1000, H = 560;
  const sc = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
  const ox = (W - (maxX - minX) * sc) / 2, oz = (H - (maxZ - minZ) * sc) / 2;
  const Pt = t => [ox + (t.x - minX) * sc, oz + (t.z - minZ) * sc];
  const ns = (tag, a, par) => { const e = document.createElementNS(SVGNS, tag); for (const k in a) setA(e, k, a[k]); (par || svg).appendChild(e); return e; };
  const g = ns('g', { stroke: 'var(--border)', 'stroke-width': 1 });
  for (let x = Math.ceil(minX / 2000) * 2000 - 4000; x <= maxX + 4000; x += 2000) { const px = ox + (x - minX) * sc; if (px > 0 && px < W) { ns('line', { x1: px, y1: 0, x2: px, y2: H }, g); const tx = ns('text', { x: px + 4, y: H - 8, fill: 'var(--muted)', 'font-size': 11, stroke: 'none' }, g); tx.textContent = 'X ' + x; } }
  for (let z = Math.ceil(minZ / 2000) * 2000 - 4000; z <= maxZ + 4000; z += 2000) { const pz = oz + (z - minZ) * sc; if (pz > 0 && pz < H) { ns('line', { x1: 0, y1: pz, x2: W, y2: pz }, g); const tz = ns('text', { x: 6, y: pz - 4, fill: 'var(--muted)', 'font-size': 11, stroke: 'none' }, g); tz.textContent = 'Z ' + z; } }
  const nt = ns('text', { x: W - 30, y: 34, fill: 'var(--muted)', 'font-size': 14, 'font-weight': 700, 'text-anchor': 'middle' }); nt.textContent = 'N ↑';
  if (mapSel) {
    const a = teamById(mapSel);
    T.forEach(t => { if (t.id === mapSel) return; const [x1, y1] = Pt(a), [x2, y2] = Pt(t);
      ns('line', { x1, y1, x2, y2, stroke: a.colors[0], 'stroke-width': 2, 'stroke-dasharray': '5 5', opacity: .8 });
      const lb = ns('text', { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 4, fill: 'var(--text)', 'font-size': 11, 'font-weight': 600, 'text-anchor': 'middle', 'paint-order': 'stroke', stroke: 'var(--surface-2)', 'stroke-width': 4 }); lb.textContent = IFL.travelDist(a, t).toLocaleString(); });
  }
  const nudge = { DEN: 26, PAR: 26, ARG: 26 };
  const anchor = { GHB: 'end', DEN: 'start' };
  T.forEach(t => {
    const [x, y] = Pt(t);
    const grp = ns('g', { style: 'cursor:pointer' });
    ns('circle', { cx: x, cy: y, r: mapSel === t.id ? 13 : 10, fill: t.colors[0], stroke: t.colors[1], 'stroke-width': 3 }, grp);
    const lb = ns('text', { x: x + (anchor[t.id] === 'end' ? -8 : anchor[t.id] === 'start' ? 8 : 0), y: y + (nudge[t.id] || -18), fill: 'var(--text)', 'font-size': 13, 'font-weight': 700, 'text-anchor': anchor[t.id] || 'middle', 'paint-order': 'stroke', stroke: 'var(--surface-2)', 'stroke-width': 4 }, grp);
    lb.textContent = t.city;
    const ttl = ns('title', {}, grp); ttl.textContent = `${t.full}  (X ${t.x}, Z ${t.z})`;
    grp.onclick = () => { mapSel = mapSel === t.id ? null : t.id; renderMap(); };
  });
  $('#matrix').innerHTML = `<tr><th></th>${T.map(t => `<th>${t.abbr}</th>`).join('')}</tr>` + T.map(a => `<tr><td class="l">${sw(a)} ${esc(a.city)}</td>${T.map(b => `<td class="${mapSel && (a.id === mapSel || b.id === mapSel) && a.id !== b.id ? 'hi' : ''}">${a.id === b.id ? '—' : IFL.travelDist(a, b).toLocaleString()}</td>`).join('')}</tr>`).join('');
}

// ---------------------------------------------------------------- ADMIN
let adminKey = store.get('ifl-admin', true);
let adminMsg = null;
async function adminCall(action, body) {
  const r = await fetch('/api/admin/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey || '' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Request failed'), { status: r.status });
  return j;
}
function stadiumAdminHTML() {
  const V = (NET.state && NET.state.venues) || { stadiums: {}, homeAt: {} }, bv = NET.state && NET.state.bowlVenue, S = NET.state && NET.state.season;
  const rows = T.map(t => {
    const st = V.stadiums[t.id] || {};
    return `<tr data-id="${t.id}"><td class="l"><span class="tcell">${crest(t, 24)} ${esc(t.full)}</span></td>
      <td class="l"><input type="text" class="stName" maxlength="40" placeholder="No stadium" value="${esc(st.name || '')}"></td>
      <td class="l"><input type="text" class="stTown" maxlength="30" placeholder="${esc(t.city)}" value="${esc(st.town || '')}"></td>
      <td class="l"><select class="stAt"></select></td></tr>`;
  }).join('');
  const bowlTxt = bv ? (bv.name ? `${esc(bv.name)}, ${esc(bv.town)}` : esc(bv.town)) : '—';
  return `<div class="card panel" style="margin-top:12px"><div class="hd"><h3>Stadiums</h3><span class="muted" style="font-size:12.5px">Leave the name empty if a team has no stadium yet.</span></div>
    <div class="kv" style="padding-bottom:4px"><span>Season ${S ? S.number : ''} IFL Bowl</span><span><b>${bowlTxt}</b> <span class="muted">· ${S && S.number > 1 ? "previous champion's stadium (Miskauga if they have none)" : 'hosted by Miskauga, the founding team'}</span></span></div>
    <div class="tblscroll" style="padding:4px 12px 4px"><table class="t stadtbl"><tr><th style="text-align:left">Team</th><th style="text-align:left">Stadium name</th><th style="text-align:left">Town</th><th style="text-align:left">Home games without a stadium</th></tr>${rows}</table></div>
    <div class="muted" style="padding:6px 16px 0;font-size:12px">Teams without a stadium play home games at the stadium you pick, a neutral site with no home advantage unless that stadium's team is playing. With no stadiums at all, every team hosts in its own city. Changes apply to games that haven't started yet.</div>
    <div class="row" style="padding:10px 16px 14px"><button class="btn primary" id="btnStadiums">Save stadiums</button></div></div>`;
}
function wireStadiumAdmin(act) {
  const V = (NET.state && NET.state.venues) || { stadiums: {}, homeAt: {} };
  const tbl = document.querySelector('.stadtbl'); if (!tbl) return;
  const refresh = () => { // the "home games at" choice only applies to teams without a stadium, and lists teams that have one
    const rows = [...tbl.querySelectorAll('tr[data-id]')];
    const owners = rows.filter(tr => tr.querySelector('.stName').value.trim()).map(tr => tr.dataset.id);
    rows.forEach(tr => {
      const id = tr.dataset.id, sel = tr.querySelector('.stAt'), has = !!tr.querySelector('.stName').value.trim();
      const prev = sel.value || V.homeAt[id] || '';
      if (has) { sel.innerHTML = '<option>Own stadium</option>'; sel.disabled = true; return; }
      sel.disabled = !owners.length;
      if (!owners.length) { sel.innerHTML = '<option>Own city (no stadiums yet)</option>'; return; }
      const def = owners.includes('MIS') ? 'MIS' : owners[0];
      sel.innerHTML = owners.map(o => { const nm = rows.find(x => x.dataset.id === o).querySelector('.stName').value.trim(); return `<option value="${o}">${esc(nm)} (${teamById(o).abbr})</option>`; }).join('');
      sel.value = owners.includes(prev) ? prev : def;
    });
  };
  tbl.querySelectorAll('.stName').forEach(i => i.addEventListener('input', refresh));
  refresh();
  $('#btnStadiums').onclick = () => {
    const stadiums = {}, homeAt = {};
    tbl.querySelectorAll('tr[data-id]').forEach(tr => {
      const id = tr.dataset.id, name = tr.querySelector('.stName').value.trim();
      let town = tr.querySelector('.stTown').value.trim();
      if (name) stadiums[id] = { name, town: town || teamById(id).city };
      else if (!tr.querySelector('.stAt').disabled) homeAt[id] = tr.querySelector('.stAt').value;
    });
    act(() => adminCall('stadiums', { stadiums, homeAt }), 'Stadiums saved. Upcoming games now use them.');
  };
}
function renderAdmin() {
  const body = $('#adminBody');
  if (!NET.online) { body.innerHTML = offlineNote(); return; }
  if (!adminKey) {
    body.innerHTML = `<div class="card panel" style="max-width:460px"><div class="hd"><h3>Admin sign-in</h3></div>
      <form class="form" id="loginForm" style="grid-template-columns:1fr"><label>Admin password<input type="password" id="pw" autocomplete="current-password"></label>
      <div class="row"><button class="btn primary" type="submit">Sign in</button><span class="msg err" id="loginMsg"></span></div>
      <div class="hint muted" style="font-size:12px">The password is set by whoever runs the server (see README). Everyone else can watch without signing in.</div></form></div>`;
    $('#loginForm').onsubmit = async e => {
      e.preventDefault();
      adminKey = $('#pw').value;
      try { await adminCall('check'); store.set('ifl-admin', adminKey, true); renderAdmin(); }
      catch (er) { adminKey = null; $('#loginMsg').textContent = er.message; }
    };
    return;
  }
  const st = NET.state, s = st.settings, S = st.season;
  const played = S ? S.games.filter(g => g.result).length : 0;
  const total = S ? S.games.filter(g => !g.playoff).length + 3 : 0;
  const lg = liveGame(), ng = nextGame();
  body.innerHTML = `
  <div class="hgrid">
  <div>
    <div class="card panel" style="margin-bottom:12px"><div class="hd"><h3>Broadcast status</h3><span style="flex:1"></span><button class="btn" id="btnSignOut">Sign out</button></div>
      <div class="kv">
        <span>Season</span><span>${S ? 'Season ' + S.number + (S.champion ? ' (complete)' : '') : '—'}</span>
        <span>Games played</span><span>${played} of ${total}</span>
        <span>On air</span><span>${lg ? `${teamById(lg.away).abbr} @ ${teamById(lg.home).abbr} (${gameLabel(lg)})` : 'Nothing right now'}</span>
        <span>Next game</span><span>${ng ? `${teamById(ng.away).abbr} @ ${teamById(ng.home).abbr} · ${fmtWhen(ng.airStart)}` : s.paused ? 'Paused' : '—'}</span>
        <span>IFL Bowl</span><span>${S && S.champion ? 'Played' : st.estimatedEnd ? 'around ' + fmtWhen(st.estimatedEnd) : '—'}</span>
        <span>Schedule</span><span>${s.paused ? '<b style="color:var(--bad)">Paused</b>' : 'Running'}</span>
        ${st.nextSeasonAt ? `<span>Next season</span><span>${fmtWhen(st.nextSeasonAt)}</span>` : ''}
        <span>Server time zone</span><span>${esc(st.tz)}</span>
      </div>
      <div class="row" style="padding:0 16px 14px">
        <button class="btn ${s.paused ? 'primary' : ''}" id="btnPause">${s.paused ? 'Resume schedule' : 'Pause schedule'}</button>
        <button class="btn" id="btnAirNow" ${lg ? 'disabled' : ''}>Start next game now</button>
        <button class="btn" id="btnSimNext">Sim next game instantly</button>
      </div>
    </div>
    <div class="card panel"><div class="hd"><h3>Season</h3></div>
      <div class="form">
        <label>New season first game<input type="datetime-local" id="nsAt"><span class="hint">Leave empty to start at the next daily slot.</span></label>
      </div>
      <div class="row" style="padding:0 16px 14px">
        <button class="btn" id="btnNewSeason">Start new season</button>
        <button class="btn" id="btnSimAll">Finish season instantly</button>
      </div>
      <div class="muted" style="padding:0 16px 14px;font-size:12px">Starting a new season archives the current one in History, even if it isn't finished. "Instantly" options skip the broadcast and only record results.</div>
    </div>
    <div class="card panel" style="margin-top:12px;border-color:color-mix(in srgb, var(--bad) 45%, var(--border))"><div class="hd"><h3 style="color:var(--bad)">Reset league</h3></div>
      <div class="muted" style="padding:12px 16px 0;font-size:13px">Starts over at <b>Season 1</b> with the original rosters. All seasons, history, records, injuries and roster changes are erased. Schedule settings and the admin password are kept. A backup of the old league is saved in the server's <code>data</code> folder. The first game uses the date above if set, otherwise the next daily slot.</div>
      <div class="form" style="grid-template-columns:1fr">
        <label>Type RESET to confirm<input type="text" id="resetConfirm" autocomplete="off" placeholder="RESET"></label>
      </div>
      <div class="row" style="padding:0 16px 14px"><button class="btn" id="btnReset" style="color:var(--bad);border-color:var(--bad)" disabled>Reset league to Season 1</button></div>
    </div>
  </div>
  <div class="card panel"><div class="hd"><h3>Schedule settings</h3></div>
    <form class="form" id="setForm">
      <label>First game each day<input type="time" id="sDaily" value="${s.dailyStart}"><span class="hint">Server time (${esc(st.tz)}).</span></label>
      <label>Season length (days)<input type="number" id="sDays" min="1" max="60" value="${s.seasonDays}"><span class="hint">From the first kickoff to the IFL Bowl. The last day is finals day.</span></label>
      <label>Minutes between game starts<input type="number" id="sGap" min="9" max="240" value="${s.gapMin}"><span class="hint">A game airs for about 7 min (8–9 with overtime).</span></label>
      <label>Break between seasons (days)<input type="number" id="sBreak" min="0" max="60" value="${s.breakDays}"><span class="hint">0 = next season starts the day after the IFL Bowl.</span></label>
      <label style="flex-direction:row;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)"><input type="checkbox" id="sAuto" ${s.autoNext ? 'checked' : ''}> Start the next season automatically</label>
    </form>
    <div class="kv" id="preview" style="padding-top:0"></div>
    <div class="row" style="padding:0 16px 14px"><button class="btn primary" id="btnSave">Save schedule</button><span class="msg" id="setMsg"></span></div>
  </div>
  </div>
  ${stadiumAdminHTML()}
  <p class="msg ${adminMsg && adminMsg.err ? 'err' : 'ok'}" id="adminMsg">${adminMsg ? esc(adminMsg.text) : ''}</p>`;
  // mirrors the server's calendar: regular weeks spread over the first days, semis on the second-to-last day, IFL Bowl on the last
  const preview = () => {
    const D = Math.max(1, Math.min(60, Math.round(+$('#sDays').value || 1)));
    const gap = Math.max(9, +$('#sGap').value || 9), brk = Math.max(0, Math.round(+$('#sBreak').value || 0));
    const [hh, mm] = ($('#sDaily').value || '19:00').split(':').map(Number);
    const regDays = Math.max(1, D - 1), semis = D - 1, fin = D - 1;
    const days = {};
    const cal = (NET.state && NET.state.calendar) || {}, nWeeks = cal.regWeeks || 10, perWeek = cal.perWeek || 4;
    for (let w = 1; w <= nWeeks; w++) { const d = Math.floor((w - 1) * regDays / nWeeks); (days[d] = days[d] || { weeks: [], n: 0 }).weeks.push(w); days[d].n += perWeek; }
    (days[semis] = days[semis] || { weeks: [], n: 0 }).semis = true; days[semis].n += 2;
    (days[fin] = days[fin] || { weeks: [], n: 0 }).bowl = true; days[fin].n += 1;
    const clock = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    const rows = Object.keys(days).map(Number).sort((a, b) => a - b).map(d => {
      const x = days[d], parts = [];
      if (x.weeks.length) parts.push(x.weeks.length > 1 ? `Weeks ${x.weeks[0]}–${x.weeks[x.weeks.length - 1]}` : `Week ${x.weeks[0]}`);
      if (x.semis) parts.push('Semifinals'); if (x.bowl) parts.push('IFL Bowl');
      const end = hh * 60 + mm + (x.n - 1) * gap + 7;
      return `<span>Day ${d + 1}</span><span>${parts.join(' + ')} · ${x.n} game${x.n === 1 ? '' : 's'}, ${clock(hh * 60 + mm)}–${clock(end)}${(x.n * gap > 1440) ? ' <b style="color:var(--bad)">(too many for one day)</b>' : ''}</span>`;
    });
    rows.push(`<span>Next season</span><span>${$('#sAuto').checked ? `starts on day ${D + brk + 1}` : 'started manually'}</span>`);
    if (cal.next && cal.next.teams > (cal.teamsNow || 0)) {
      const nd = Math.max(1, D - 1), per = {};
      for (let w = 1; w <= cal.next.weeks; w++) { const d = Math.floor((w - 1) * nd / cal.next.weeks); per[d] = (per[d] || 0) + cal.next.perWeek; }
      const most = Math.max(...Object.values(per)), end = hh * 60 + mm + (most - 1) * gap + 7;
      rows.push(`<span>From next season</span><span>${cal.next.teams} teams, ${cal.next.weeks} weeks of ${cal.next.perWeek} games · busiest night ${most} games, ${clock(hh * 60 + mm)}–${clock(end)}${cal.next.autoBump && D < cal.next.recommendedDays ? ` <span class="muted">(the season length moves to ${cal.next.recommendedDays} days automatically when the new teams join, unless you change it)</span>` : ''}</span>`);
    }
    $('#preview').innerHTML = rows.join('');
  };
  ['#sDaily', '#sDays', '#sGap', '#sBreak', '#sAuto'].forEach(id => { $(id).oninput = preview; $(id).onchange = preview; }); preview();
  const act = async (fn, okText) => { try { await fn(); adminMsg = { text: okText }; NET.rev = 0; await poll(); renderAdmin(); } catch (er) { if (er.status === 401) { adminKey = null; store.del('ifl-admin', true); } adminMsg = { text: er.message, err: true }; renderAdmin(); } };
  $('#btnSignOut').onclick = () => { adminKey = null; store.del('ifl-admin', true); adminMsg = null; renderAdmin(); };
  $('#btnPause').onclick = () => act(() => adminCall('pause', { paused: !s.paused }), s.paused ? 'Schedule resumed.' : 'Schedule paused.');
  $('#btnAirNow').onclick = () => act(() => adminCall('airNow'), 'Next game is starting now.');
  $('#btnSimNext').onclick = () => act(() => adminCall('simNext'), 'Next game simulated.');
  $('#btnSimAll').onclick = () => { if (confirm('Finish the rest of this season instantly? Remaining games will not be broadcast.')) act(() => adminCall('simAll'), 'Season finished.'); };
  $('#resetConfirm').oninput = e => { $('#btnReset').disabled = e.target.value.trim() !== 'RESET'; };
  $('#btnReset').onclick = () => {
    if (!confirm('Erase the whole league and start over at Season 1? This cannot be undone from the site.')) return;
    const v = $('#nsAt').value; const at = v ? new Date(v).getTime() : null;
    act(async () => { const r = await adminCall('resetLeague', { confirm: $('#resetConfirm').value.trim(), startAt: at }); NET.history = null; for (const k in seasonCache) delete seasonCache[k]; histSel = null; followLive = true; return r; }, 'League reset. Season 1 is scheduled. The old league was backed up on the server.');
  };
  $('#btnNewSeason').onclick = () => {
    if (!confirm('Start a new season now? The current season will be moved to History.')) return;
    const v = $('#nsAt').value; const at = v ? new Date(v).getTime() : null;
    act(() => adminCall('newSeason', { startAt: at }), 'New season created.');
  };
  wireStadiumAdmin(act);
  $('#btnSave').onclick = () => act(() => adminCall('settings', { dailyStart: $('#sDaily').value, seasonDays: +$('#sDays').value, gapMin: +$('#sGap').value, breakDays: +$('#sBreak').value, autoNext: $('#sAuto').checked }), 'Schedule saved and games rescheduled.');
}

// ---------------------------------------------------------------- state changes
function onState() {
  if (NET.online) syncLive(false);
  renderBar(); renderTicker(); renderEvBanner();
  if (P) renderStage();
  if (view === 'home') renderHome();
  if (view === 'season') renderSeason();
  if (view === 'teams') renderTeams();
  if (view === 'history' && !NET.history) renderHistory();
  if (view === 'admin' && !document.activeElement.closest('#adminBody')) renderAdmin();
}
// once a second: keep the broadcast bar countdown fresh and switch to newly started games
setInterval(() => {
  if (!NET.online) return;
  syncLive(false);
  renderBar(); renderTicker(); renderEvBanner();
  if (P && P.o.mode === 'live' && vtime() < -PRE) pregame(-vtime());
}, 1000);
setInterval(poll, 10000);
setInterval(() => { if (view === 'home' && NET.online && !document.hidden) renderHome(); }, 15000);

// ---------------------------------------------------------------- init
(async function init() {
  await loadLogos();
  await poll();
  if (!NET.online) {
    loadPlayer({ mode: 'exh', home: 'GHB', away: 'PAR', seed: String(Math.floor(Math.random() * 1e9)), label: 'Parikia @ Greene Hill' });
    $('#exh').open = true;
  } else if (!P) {
    // nothing scheduled: show an exhibition preview so the field isn't empty
    loadPlayer({ mode: 'exh', home: 'GHB', away: 'PAR', seed: '1', label: 'Exhibition' });
  }
  renderBar();
  const tab = store.get('ifl-tab') || (NET.online ? 'home' : 'game'); if (tab !== 'game') showView(NET.online || tab !== 'home' ? tab : 'game');
})();
})();
