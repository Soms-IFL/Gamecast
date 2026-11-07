/* International Football League — broadcast server.
 * Zero dependencies. Run with:  node server.js
 * Settings come from data/config.json (written by the setup scripts): { "port": 3000, "host": "0.0.0.0", "adminPassword": "..." }
 * Env vars override the file (all optional):
 *   PORT=3000                 port to listen on
 *   HOST=0.0.0.0              interface to bind
 *   IFL_ADMIN_PASSWORD=...    admin password (otherwise read from / generated into data/config.json)
 *   IFL_DATA_DIR=./data       where league data is saved
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const IFL = require('./public/engine.js');

const PUB = path.join(__dirname, 'public');
const DATA_DIR = path.resolve(process.env.IFL_DATA_DIR || path.join(__dirname, 'data'));
const DB_FILE = path.join(DATA_DIR, 'league.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const BREAK_MS = 60 * 1000; // minimum break after a game before the next can start
fs.mkdirSync(DATA_DIR, { recursive: true });

// ------------------------------------------------------------------ config / password
function readJSON(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8').trim()); } catch (e) { return fallback; } }
function writeJSON(file, obj, pretty) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, pretty ? 2 : 0));
  fs.renameSync(tmp, file);
}
const config = readJSON(CONFIG_FILE, {});
const PORT = +process.env.PORT || +config.port || 3000;
const HOST = process.env.HOST || config.host || '0.0.0.0';
let ADMIN_PASSWORD = process.env.IFL_ADMIN_PASSWORD || config.adminPassword;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(9).toString('base64url');
  config.adminPassword = ADMIN_PASSWORD;
  writeJSON(CONFIG_FILE, config, true);
  console.log('\n  No admin password was set, so one was generated and saved to data/config.json:');
  console.log('  Admin password: ' + ADMIN_PASSWORD + '\n');
}
const PW_HASH = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
function checkPassword(pw) {
  if (typeof pw !== 'string' || !pw) return false;
  const h = crypto.createHash('sha256').update(pw).digest();
  return crypto.timingSafeEqual(h, PW_HASH);
}

// ------------------------------------------------------------------ database
const DEFAULT_SETTINGS = { dailyStart: '19:00', seasonDays: 4, gapMin: 10, breakDays: 0, autoNext: true, paused: false };
let db = readJSON(DB_FILE, null);
if (!db) db = { version: 2, rev: 1, settings: Object.assign({}, DEFAULT_SETTINGS), seasonNo: 0, season: null, nextSeason: null, history: [] };
db.settings = Object.assign({}, DEFAULT_SETTINGS, db.settings);
db.venues = db.venues || { stadiums: {}, homeAt: {} };
delete db.settings.gamesPerDay; delete db.settings.autoNextHours; delete db.nextSeasonAt;
let dirty = false;
function touch() { db.rev++; dirty = true; }
function save() { if (!dirty) return; dirty = false; try { writeJSON(DB_FILE, db); } catch (e) { console.error('Save failed:', e.message); dirty = true; } }
setInterval(save, 2000);
process.on('SIGINT', () => { save(); process.exit(0); });
process.on('SIGTERM', () => { save(); process.exit(0); });

// ------------------------------------------------------------------ season calendar
// A season spans `seasonDays` calendar days. Regular-season weeks are spread over the first days,
// the semifinals get the second-to-last day and the IFL Bowl the last day. Games on a day start at
// `dailyStart` and follow each other every `gapMin` minutes. All times are the server's local time.
// season format: how many regular-season weeks and games per week
function fmtOf(S) {
  if (!S) return nextFormat();
  const reg = S.games.filter(g => !g.playoff), weeks = reg.reduce((m, g) => Math.max(m, +g.week || 0), 0) || 10;
  return { weeks, perWeek: Math.round(reg.length / weeks) || 4 };
}
let _nextFmt = null;
function recommendedDays(nTeams) { return nTeams >= 12 ? 6 : nTeams >= 10 ? 5 : 4; }
function nextFormat() { // the format the next season will use (all current league teams)
  if (!_nextFmt) { const w = IFL.makeSchedule(IFL.TEAMS.map(t => t.id), 'probe'); _nextFmt = { weeks: w.length, perWeek: w[0].length }; }
  return _nextFmt;
}
function hhmm() { return db.settings.dailyStart.split(':').map(Number); }
function addDays(ms, n) { const d = new Date(ms); d.setDate(d.getDate() + n); d.setHours(0, 0, 0, 0); return d.getTime(); }
function slotTime(S, day, k) { const [hh, mm] = hhmm(); const d = new Date(S.day0); d.setDate(d.getDate() + day); d.setHours(hh, mm, 0, 0); return d.getTime() + k * db.settings.gapMin * 60000; }
function firstDay(after) { const [hh, mm] = hhmm(); const d = new Date(after); d.setHours(hh, mm, 0, 0); if (d.getTime() < after) d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); return d.getTime(); }
// Regular-season weeks are spread evenly over every day but the last; the last day is finals day (both semifinals, then the IFL Bowl).
function layout(s, F) {
  const D = s.seasonDays, regDays = Math.max(1, D - 1);
  return { regDays, semisDay: D - 1, finalDay: D - 1, weeks: (F || nextFormat()).weeks };
}
function weekDay(lay, week) { return Math.floor((week - 1) * lay.regDays / lay.weeks); }
function maxGamesPerDay(s, F) {
  F = F || nextFormat();
  const lay = layout(s, F), per = {};
  for (let w = 1; w <= F.weeks; w++) { const d = weekDay(lay, w); per[d] = (per[d] || 0) + F.perWeek; }
  per[lay.semisDay] = (per[lay.semisDay] || 0) + 2; per[lay.finalDay] = (per[lay.finalDay] || 0) + 1;
  return Math.max(...Object.values(per));
}
function assignPlan(S) {
  const lay = layout(db.settings, fmtOf(S)), k = {};
  for (const g of S.games) {
    if (!g.playoff) g.day = weekDay(lay, g.week);
    else g.day = g.gid === 'P-F' ? lay.finalDay : lay.semisDay;
    k[g.day] = k[g.day] || 0; g.k = k[g.day]++;
  }
  return lay;
}
function liveGame(now) {
  if (!db.season) return null;
  return db.season.games.find(g => g.airStart != null && !g.result && g.airStart <= now && now < g.airStart + g.dur) || null;
}
function reschedule(forceFirstAt) {
  const S = db.season; if (!S) return;
  assignPlan(S);
  const now = Date.now();
  let t = now;
  for (const g of S.games) if (g.airStart != null && g.airStart <= now && !g.result) t = Math.max(t, g.airStart + g.dur + BREAK_MS);
  const pending = S.games.filter(g => !g.result && !(g.airStart != null && g.airStart <= now));
  if (db.settings.paused) { pending.forEach(g => g.airStart = null); touch(); return; }
  // far behind schedule (after a long pause or server downtime): push the whole calendar back by whole days
  if (pending.length && !forceFirstAt) {
    let guard = 0;
    while (slotTime(S, pending[0].day, pending[0].k) < t - 6 * 3600000 && guard++ < 1000) S.day0 = addDays(S.day0, 1);
  }
  let first = true;
  for (const g of pending) {
    const planned = slotTime(S, g.day, g.k);
    // the IFL Bowl gets a 5-minute pregame show after the semifinals
    let floor = t;
    if (g.gid === 'P-F') { const semiEnd = Math.max(0, ...S.games.filter(x => x.playoff && x.gid !== 'P-F' && x.airStart != null).map(x => x.airStart + x.dur)); floor = Math.max(t, semiEnd + 5 * 60000); }
    const at = first && forceFirstAt ? Math.max(forceFirstAt, t) : Math.max(planned, floor);
    g.airStart = at; t = at + g.dur + BREAK_MS; first = false;
  }
  touch();
}
function estimateEnd() {
  const S = db.season; if (!S || db.settings.paused) return null;
  const lay = layout(db.settings, fmtOf(S));
  let last = 0;
  for (const g of S.games) if (g.airStart) last = Math.max(last, g.airStart + g.dur);
  if (!S.games.find(g => g.gid === 'P-F')) {
    const kf = S.games.filter(g => g.day === lay.finalDay && !g.playoff).length + (lay.semisDay === lay.finalDay ? 2 : 0);
    last = Math.max(last, slotTime(S, lay.finalDay, kf) + 7.5 * 60000);
  }
  return last;
}

// ------------------------------------------------------------------ season lifecycle
function simOpts(g, rosters) { return { playoff: !!g.playoff, rosters: rosters || db.season.rosters, out: g.out || [], venue: g.venue || undefined }; }

// ------------------------------------------------------------------ stadiums & venues
// Rules:
//  * A team with a stadium hosts its home games there.
//  * A team without one plays its home games at a neutral stadium the admin picks (default: Miskauga's, else the first one).
//    The stadium's owner gets home advantage only if they're one of the two teams playing.
//  * The IFL Bowl: Season 1 is hosted by Miskauga (the founding team); after that by the previous season's champion.
//    If that champion has no stadium, it falls back to Miskauga.
//  * With no stadiums entered at all, every team hosts in its own city exactly as before.
//  * Only games that haven't started are ever changed, so played games keep how they were played.
const FOUNDER = 'MIS';
const squashTown = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function townCoords(town, fallbackId) {
  const t = IFL.TEAMS.find(x => squashTown(x.city) === squashTown(town)) || IFL.getTeam(fallbackId);
  return { x: t.x, z: t.z };
}
function stadiumVenue(owner) {
  const st = db.venues.stadiums[owner]; if (!st) return null;
  return Object.assign({ name: st.name, town: st.town, host: owner }, townCoords(st.town, owner));
}
function founderVenue() {
  const M = IFL.getTeam(FOUNDER);
  return stadiumVenue(FOUNDER) || { name: null, town: M.city, host: FOUNDER, x: M.x, z: M.z };
}
function bowlVenue(S) {
  if (!S || S.number <= 1) return founderVenue();
  const prev = db.history.find(h => h.number === S.number - 1);
  const champ = prev && prev.champion;
  return (champ && stadiumVenue(champ)) || founderVenue();
}
function venueFor(g, S) {
  if (g.gid === 'P-F') return bowlVenue(S);
  const own = stadiumVenue(g.home);
  if (own) return own;
  const owners = Object.keys(db.venues.stadiums);
  if (!owners.length) return null; // no stadiums at all: original home-city rule
  const pick = db.venues.homeAt[g.home];
  const neutral = owners.includes(pick) ? pick : owners.includes(FOUNDER) ? FOUNDER : owners[0];
  return stadiumVenue(neutral);
}
// give every game that hasn't started its venue; re-time the ones that changed
function applyVenues(S) {
  if (!S) return false;
  const now = Date.now();
  let changed = false;
  for (const g of S.games) {
    if (g.result || (g.airStart != null && g.airStart <= now)) continue;
    const v = venueFor(g, S);
    if (JSON.stringify(v || null) !== JSON.stringify(g.venue || null)) {
      if (v) g.venue = v; else delete g.venue;
      prepGame(g, S.rosters); changed = true;
    }
  }
  return changed;
}
function prepGame(g, rosters) {
  const sim = IFL.simulateGame(g.home, g.away, g.seed, simOpts(g, rosters));
  g.dur = Math.round(IFL.gameDuration(sim, IFL.stageOf(g)));
  return g;
}
function archiveSeason() {
  const S = db.season; if (!S) return;
  const st = IFL.standings(S.games.filter(g => !g.playoff));
  let runnerUp = null;
  const fin = S.games.find(g => g.gid === 'P-F');
  if (fin && fin.result) runnerUp = S.champion === fin.home ? fin.away : fin.home;
  db.history.unshift({
    number: S.number, seed: S.seed, format: S.format || null, teams: S.teams || IFL.ORIGINAL_TEAMS, startedAt: S.createdAt, endedAt: Date.now(), done: !!S.champion,
    champion: S.champion, runnerUp, seeds: S.playoffs ? S.playoffs.seeds : null, seedInfo: S.playoffs ? S.playoffs.info || null : null,
    standings: st.map(r => ({ id: r.id, w: r.w, l: r.l, t: r.t, pf: r.pf, pa: r.pa })),
    games: S.games.filter(g => g.result).map(g => ({ gid: g.gid, week: g.week, home: g.home, away: g.away, seed: g.seed, playoff: !!g.playoff, label: g.label || null, airStart: g.airStart, out: g.out || [], venue: g.venue || null, result: g.result })),
    stats: S.stats, rosters: S.rosters, offseason: S.offseason || null, teamRatings: S.teamRatings || null,
  });
}
function draftOrder(S) {
  const st = IFL.standings(S.games.filter(g => !g.playoff)); // best first
  const worstFirst = st.slice().reverse().map(r => r.id);
  if (!S.playoffs) return worstFirst;
  const fin = S.games.find(g => g.gid === 'P-F');
  const champ = S.champion, runner = fin && fin.result ? (champ === fin.home ? fin.away : fin.home) : null;
  const late = [runner, champ].filter(Boolean);
  const playoff = S.playoffs.seeds.filter(id => !late.includes(id));
  return worstFirst.filter(id => !S.playoffs.seeds.includes(id)).concat(worstFirst.filter(id => playoff.includes(id)), late);
}
function newSeason(firstGameAfter) {
  const prev = db.season;
  if (prev) archiveSeason();
  db.seasonNo++;
  const seed = 'S' + db.seasonNo + '-' + crypto.randomBytes(4).toString('hex');
  let rosters, report = null;
  if (prev && prev.rosters) { const o = IFL.offseason(prev.rosters, draftOrder(prev), seed, db.seasonNo); rosters = o.rosters; report = o.report; }
  else rosters = IFL.initialRosters();
  const teams = IFL.TEAMS.map(t => t.id);
  const joined = teams.filter(id => !rosters[id]);
  for (const id of joined) rosters[id] = IFL.expansionRoster(id, rosters, seed);
  if (joined.length && report) report.expansion = joined;
  // a bigger league needs more nights: lengthen the season once when it grows (the admin can change it back)
  const wantDays = recommendedDays(teams.length);
  if (prev && joined.length && db.settings.seasonDays < wantDays && !db.settings.expansionDays) { db.settings.seasonDays = wantDays; db.settings.expansionDays = true; console.log('League grew: season length set to ' + wantDays + ' days.'); }
  const weeks = IFL.makeSchedule(teams, seed);
  const games = [];
  weeks.forEach(w => w.forEach(g => games.push(prepGame({ gid: g.gid, week: g.week, home: g.home, away: g.away, seed: g.seed, playoff: false, out: [], airStart: null, result: null }, rosters))));
  db.season = { number: db.seasonNo, seed, format: 'div' + weeks.length, teams, divisions: IFL.divisionsFor(teams), createdAt: Date.now(), day0: firstDay(Math.max(Date.now(), firstGameAfter || 0)), games, stats: {}, playoffs: null, champion: null,
    rosters, injuries: {}, offseason: report, teamRatings: IFL.teamRatings(rosters) };
  if (report) console.log(`Offseason: ${report.retired.length} retirements, ${report.drafted.length} rookies drafted.`);
  if (joined.length) console.log('Expansion teams joined: ' + joined.map(id => IFL.getTeam(id).full).join(', '));
  db.nextSeason = null;
  applyVenues(db.season);
  reschedule();
  const g0 = games.slice().sort((a, b) => (a.airStart || 0) - (b.airStart || 0))[0];
  console.log(`Season ${db.seasonNo} created (${games.length} regular-season games). First game: ${g0.airStart ? new Date(g0.airStart).toLocaleString() : 'paused'}`);
}
function finalize(g) {
  const S = db.season;
  const sim = IFL.simulateGame(g.home, g.away, g.seed, simOpts(g));
  const sm = sim.summary();
  g.result = { score: sm.score, qs: sm.qs, ot: sm.ot, at: Date.now(), injuries: sm.injuries };
  applyInjuries(S, g, sm.injuries);
  if (g.airStart == null || g.airStart + g.dur > Date.now()) { g.airStart = Date.now() - g.dur; g.result.instant = true; } // simmed without airing
  for (const [pid, st] of Object.entries(sm.ps)) {
    const tot = S.stats[pid] || (S.stats[pid] = { gp: 0 });
    tot.gp++;
    for (const k in st) { if (/lng$/.test(k)) tot[k] = Math.max(tot[k] || 0, st[k]); else tot[k] = (tot[k] || 0) + st[k]; }
  }
  if (computeOuts(S)) reschedule();
  touch();
  const H = IFL.getTeam(g.home), A = IFL.getTeam(g.away);
  console.log(`Final: ${A.abbr} ${g.result.score[1]} @ ${H.abbr} ${g.result.score[0]}${g.result.ot ? ' (OT)' : ''}  [${g.label || 'Week ' + g.week}]`);
  advance();
}
// Injuries: a player hurt with "games: n" misses his team's next n games (99 = rest of season).
function applyInjuries(S, g, fresh) {
  for (const pid of g.out || []) { const inj = S.injuries[pid]; if (inj) { inj.left--; if (inj.left <= 0) delete S.injuries[pid]; } }
  for (const x of fresh || []) {
    if (x.games <= 0) continue;
    S.injuries[x.pid] = { team: x.team, name: x.name, short: x.short, pos: x.pos, part: x.part, total: x.games, left: x.games >= 99 ? 999 : x.games, gid: g.gid, week: g.week };
  }
}
// Work out who is inactive for every game that hasn't started yet; re-time games whose lineups changed.
function computeOuts(S) {
  const now = Date.now(), k = {};
  let changed = false;
  for (const g of S.games) {
    if (g.result || (g.airStart != null && g.airStart <= now)) continue;
    const out = [];
    for (const t of [g.home, g.away]) {
      const idx = k[t] || 0;
      for (const [pid, inj] of Object.entries(S.injuries)) if (inj.team === t && inj.left > idx) out.push(pid);
      k[t] = idx + 1;
    }
    out.sort();
    if (JSON.stringify(out) !== JSON.stringify(g.out || [])) { g.out = out; prepGame(g, S.rosters); changed = true; }
  }
  return changed;
}
function advance() {
  const S = db.season; if (!S) return;
  const reg = S.games.filter(g => !g.playoff);
  if (!S.playoffs && reg.every(g => g.result)) {
    const seeds = IFL.playoffSeeds(reg);
    const s = seeds.map(x => x.id);
    S.playoffs = { seeds: s, info: seeds };
    S.games.push(prepGame({ gid: 'P-SF1', week: 'P', home: s[0], away: s[3], seed: S.seed + '-SF1', playoff: true, label: 'Semifinal', out: [], airStart: null, result: null }));
    S.games.push(prepGame({ gid: 'P-SF2', week: 'P', home: s[1], away: s[2], seed: S.seed + '-SF2', playoff: true, label: 'Semifinal', out: [], airStart: null, result: null }));
    applyVenues(S); computeOuts(S); reschedule();
  }
  if (S.playoffs && !S.games.find(g => g.gid === 'P-F')) {
    const semis = S.games.filter(g => g.gid === 'P-SF1' || g.gid === 'P-SF2');
    if (semis.length === 2 && semis.every(g => g.result)) {
      const win = g => g.result.score[0] > g.result.score[1] ? g.home : g.away;
      const w1 = win(semis[0]), w2 = win(semis[1]);
      const seedOf = id => S.playoffs.seeds.indexOf(id);
      const [h, a] = seedOf(w1) < seedOf(w2) ? [w1, w2] : [w2, w1];
      S.games.push(prepGame({ gid: 'P-F', week: 'P', home: h, away: a, seed: S.seed + '-F', playoff: true, label: 'IFL Bowl', out: [], airStart: null, result: null }));
      applyVenues(S); computeOuts(S); reschedule();
    }
  }
  const fin = S.games.find(g => g.gid === 'P-F');
  if (fin && fin.result && !S.champion) {
    S.champion = fin.result.score[0] > fin.result.score[1] ? fin.home : fin.away;
    S.endedAt = Date.now();
    planNextSeason();
    console.log(`${IFL.getTeam(S.champion).full} win the IFL Bowl!`);
    touch();
  }
}
// Next season begins on the day after this season's final day (plus any break days).
function planNextSeason() {
  const S = db.season;
  if (!S || !S.champion || !db.settings.autoNext) { db.nextSeason = null; return; }
  const day0 = Math.max(addDays(S.day0, db.settings.seasonDays + db.settings.breakDays), firstDay(Date.now() + 60000));
  const [hh, mm] = hhmm(); const first = new Date(day0); first.setHours(hh, mm, 0, 0);
  db.nextSeason = { firstGame: first.getTime(), createAt: Math.min(Date.now() + 30 * 60000, first.getTime() - 5 * 60000) };
}
function tick() {
  const now = Date.now();
  if (db.season) {
    for (const g of db.season.games) if (!g.result && g.airStart != null && g.airStart + g.dur <= now) finalize(g);
  }
  if (db.nextSeason && now >= db.nextSeason.createAt) newSeason(db.nextSeason.firstGame - 1000);
  save();
}
if (db.season && !db.season.rosters) { // league data from before rosters/injuries existed: start fresh
  console.log('Older league data found: starting a fresh league (Season 1).');
  db = { version: 3, rev: db.rev + 1, settings: db.settings, venues: db.venues, seasonNo: 0, season: null, nextSeason: null, history: [] };
}
if (!db.season) newSeason();
// re-time games that haven't aired yet (e.g. after an update that changed broadcast pacing)
if (db.season) {
  let changed = applyVenues(db.season);
  for (const g of db.season.games) if (!g.result && !(g.airStart != null && g.airStart <= Date.now())) { const d = g.dur; prepGame(g, db.season.rosters); if (g.dur !== d) changed = true; }
  if (changed) reschedule();
}
setInterval(tick, 1000);
tick();

// ------------------------------------------------------------------ http helpers
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' };
// Team logos: any image in public/logos named after the team (id, city, mascot or full name, any case/spacing).
const LOGO_DIR = path.join(PUB, 'logos');
const squash = x => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
function findLogos() {
  let files = [];
  try { files = fs.readdirSync(LOGO_DIR).filter(f => /\.(png|webp|svg|jpe?g|gif)$/i.test(f)); } catch (e) { return {}; }
  const out = {};
  for (const t of IFL.TEAMS) {
    const keys = [t.id, t.city, t.name, t.city + t.name].map(squash);
    const hit = files.find(f => keys.includes(squash(f.replace(/\.[^.]+$/, ''))));
    if (hit) { let v = 0; try { v = Math.round(fs.statSync(path.join(LOGO_DIR, hit)).mtimeMs); } catch (e) {} out[t.id] = 'logos/' + encodeURIComponent(hit) + '?v=' + v; }
  }
  return out;
}
function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 16384) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const fails = new Map();
function rateLimited(ip) {
  const r = fails.get(ip); if (!r) return false;
  if (Date.now() - r.t > 60000) { fails.delete(ip); return false; }
  return r.n >= 10;
}
function noteFail(ip) { const r = fails.get(ip) || { n: 0, t: Date.now() }; r.n++; fails.set(ip, r); }

function publicState() {
  const S = db.season;
  return {
    rev: db.rev, now: Date.now(), engineVersion: IFL.VERSION,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    settings: db.settings, calendar: Object.assign({ maxPerDay: maxGamesPerDay(db.settings, fmtOf(S)), regWeeks: fmtOf(S).weeks, perWeek: fmtOf(S).perWeek,
      next: Object.assign({ maxPerDay: maxGamesPerDay(db.settings, nextFormat()), teams: IFL.TEAMS.length, recommendedDays: recommendedDays(IFL.TEAMS.length), autoBump: !db.settings.expansionDays }, nextFormat()),
      teamsNow: S && S.teams ? S.teams.length : IFL.ORIGINAL_TEAMS.length }, layout(db.settings, fmtOf(S))),
    nextSeasonAt: db.nextSeason ? db.nextSeason.firstGame : null, estimatedEnd: estimateEnd(),
    season: S && { number: S.number, seed: S.seed, format: S.format, teams: S.teams || IFL.ORIGINAL_TEAMS, createdAt: S.createdAt, champion: S.champion, playoffs: S.playoffs, stats: S.stats,
      rosters: S.rosters, injuries: S.injuries, offseason: S.offseason || null, teamRatings: S.teamRatings || null,
      games: S.games.map(g => ({ gid: g.gid, week: g.week, home: g.home, away: g.away, seed: g.seed, playoff: g.playoff, label: g.label || null, airStart: g.airStart, dur: g.dur, out: g.out || [], venue: g.venue || null, result: g.result })) },
    venues: db.venues, bowlVenue: S ? bowlVenue(S) : null,
    historyIndex: db.history.map(h => ({ number: h.number, champion: h.champion, runnerUp: h.runnerUp, done: h.done, endedAt: h.endedAt, teamRatings: h.teamRatings || null })),
  };
}

// ------------------------------------------------------------------ admin actions
const admin = {
  check: () => ({ ok: true }),
  settings: b => {
    const s = Object.assign({}, db.settings); // validate on a copy so a bad value changes nothing
    if (b.dailyStart != null) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.dailyStart)) throw new Error('Daily start must be HH:MM (24h).'); s.dailyStart = b.dailyStart; }
    if (b.seasonDays != null) { const n = Math.round(+b.seasonDays); if (!(n >= 1 && n <= 60)) throw new Error('Season length must be 1–60 days.'); s.seasonDays = n; }
    if (b.gapMin != null) { const n = Math.round(+b.gapMin); if (!(n >= 9 && n <= 240)) throw new Error('Minutes between games must be 9–240 (a game airs for about 7 minutes, up to ~9.5 with overtime).'); s.gapMin = n; }
    if (b.breakDays != null) { const n = Math.round(+b.breakDays); if (!(n >= 0 && n <= 60)) throw new Error('Break between seasons must be 0–60 days.'); s.breakDays = n; }
    if (b.autoNext != null) s.autoNext = !!b.autoNext;
    if (Math.max(maxGamesPerDay(s, fmtOf(db.season)), maxGamesPerDay(s, nextFormat())) * s.gapMin > 1440) throw new Error('That many games per day with that gap does not fit in one day. Use more season days or a shorter gap.');
    Object.assign(db.settings, s);
    if (db.season && db.season.champion) planNextSeason();
    reschedule();
    return { ok: true };
  },
  pause: b => { db.settings.paused = !!b.paused; reschedule(); return { ok: true }; },
  airNow: () => {
    const now = Date.now();
    if (liveGame(now)) throw new Error('A game is already on air.');
    if (!db.season || !db.season.games.some(g => !g.result)) throw new Error('No games left to air this season.');
    db.settings.paused = false;
    reschedule(now + 3000);
    return { ok: true };
  },
  simNext: () => {
    const now = Date.now();
    const g = db.season && db.season.games.find(x => !x.result && !(x.airStart != null && x.airStart <= now));
    if (!g) throw new Error('No upcoming game to sim (a game may be on air).');
    finalize(g); reschedule();
    return { ok: true };
  },
  simAll: () => {
    let guard = 0;
    while (db.season && !db.season.champion && guard++ < 200) {
      const now = Date.now();
      const g = db.season.games.find(x => !x.result && !(x.airStart != null && x.airStart <= now));
      if (!g) break;
      finalize(g);
    }
    reschedule();
    return { ok: true };
  },
  newSeason: b => {
    let at = b && b.startAt ? +b.startAt : null;
    if (at != null && !(at > 0)) throw new Error('Bad start time.');
    newSeason(at && at > Date.now() ? at : null);
    return { ok: true };
  },
  // Wipe every season, all history and roster changes; start over at Season 1. Settings and password are kept.
  stadiums: b => {
    const clean = (x, n) => String(x == null ? '' : x).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
    const ids = IFL.TEAMS.map(t => t.id), stadiums = {}, homeAt = {};
    for (const [id, st] of Object.entries((b && b.stadiums) || {})) {
      if (!ids.includes(id) || !st) continue;
      const name = clean(st.name, 40), town = clean(st.town, 30);
      if (!name) continue;
      if (!town) throw new Error(`Give ${IFL.getTeam(id).full}'s stadium a town.`);
      stadiums[id] = { name, town };
    }
    for (const [id, owner] of Object.entries((b && b.homeAt) || {})) if (ids.includes(id) && stadiums[owner] && !stadiums[id]) homeAt[id] = owner;
    db.venues = { stadiums, homeAt };
    if (applyVenues(db.season)) reschedule();
    touch();
    return { ok: true };
  },
  resetLeague: b => {
    if (!b || b.confirm !== 'RESET') throw new Error('Type RESET to confirm.');
    let at = b.startAt ? +b.startAt : null;
    if (at != null && !(at > 0)) throw new Error('Bad start time.');
    const backup = path.join(DATA_DIR, 'backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    writeJSON(backup, db);
    db = { version: 3, rev: db.rev + 1, settings: Object.assign({}, db.settings, { paused: false }), venues: db.venues, seasonNo: 0, season: null, nextSeason: null, history: [] };
    newSeason(at && at > Date.now() ? at : null);
    console.log('League reset to Season 1. Previous league saved to ' + backup);
    return { ok: true, backup: path.basename(backup) };
  },
};

// ------------------------------------------------------------------ server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/state' && req.method === 'GET') {
      const since = +url.searchParams.get('rev');
      if (since && since === db.rev) return send(res, 200, { rev: db.rev, now: Date.now(), unchanged: true });
      return send(res, 200, publicState());
    }
    if (p === '/api/logos' && req.method === 'GET') return send(res, 200, findLogos());
    if (p === '/api/history' && req.method === 'GET') return send(res, 200, { history: db.history.map(h => Object.assign({}, h, { rosters: undefined, stats: undefined, offseason: undefined })) });
    const hm = p.match(/^\/api\/history\/(\d+)$/);
    if (hm && req.method === 'GET') { const h = db.history.find(x => x.number === +hm[1]); return h ? send(res, 200, h) : send(res, 404, { error: 'No such season' }); }
    if (p.startsWith('/api/admin/') && req.method === 'POST') {
      const ip = req.socket.remoteAddress || '?';
      if (rateLimited(ip)) return send(res, 429, { error: 'Too many wrong passwords. Try again in a minute.' });
      if (!checkPassword(req.headers['x-admin-key'])) { noteFail(ip); return send(res, 401, { error: 'Wrong admin password.' }); }
      const action = p.slice('/api/admin/'.length);
      if (!Object.prototype.hasOwnProperty.call(admin, action)) return send(res, 404, { error: 'Unknown action' });
      const body = await readBody(req);
      try { const out = admin[action](body); save(); return send(res, 200, out); }
      catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    // static files
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
    let rel = decodeURIComponent(p === '/' ? '/index.html' : p);
    const file = path.normalize(path.join(PUB, rel));
    if (!file.startsWith(PUB + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      send(res, 200, data, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Server error' });
  }
});
server.listen(PORT, HOST, () => {
  console.log(`International Football League is live on http://localhost:${PORT}`);
  const lan = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => `http://${a.address}:${PORT}`);
  if (lan.length && HOST !== '127.0.0.1') console.log('Friends on your network can use: ' + lan.join('  '));
  console.log(`Data folder: ${DATA_DIR}`);
});
