/* IFL Gamecast — public read-only REST API (v1).
 * Mounted by server.js under /api/v1. JSON in, JSON out, GET only, CORS open, no key needed.
 * See API.md for the endpoint reference.
 *
 * Spoiler rule: this API never reveals more than a viewer of the broadcast would know. A game that
 * has not aired has no score or plays; a game on air only exposes the plays that have already
 * finished airing, with the score as of that moment. Games are deterministic from their seed, so
 * the server re-simulates them on demand and cuts the result at the broadcast clock.
 */
'use strict';

const MAX_LIMIT = 200;
const RATE_PER_MIN = process.env.IFL_API_RATE != null ? +process.env.IFL_API_RATE : 120; // requests / minute / IP, 0 = off

// stat categories for /leaders: key -> [label, value function over a player's season stat line]
const CATEGORIES = {
  passingYards:   ['Passing Yards', s => s.py || 0],
  passingTD:      ['Passing TD', s => s.ptd || 0],
  rushingYards:   ['Rushing Yards', s => s.ry || 0],
  receivingYards: ['Receiving Yards', s => s.recy || 0],
  receptions:     ['Receptions', s => s.rec || 0],
  totalTD:        ['Total TD', s => (s.rtd || 0) + (s.rectd || 0) + (s.krtd || 0) + (s.prtd || 0) + (s.deftd || 0)],
  sacks:          ['Sacks', s => s.sacks || 0],
  interceptions:  ['Interceptions', s => s.ints || 0],
  tackles:        ['Tackles', s => s.tk || 0],
  fieldGoals:     ['Field Goals Made', s => s.fgm || 0],
};

module.exports = function createApi(ctx) {
  const { IFL, getDb, liveGame, estimateEnd, findLogos } = ctx;

  class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
  const notFound = msg => new HttpError(404, msg);
  const bad = msg => new HttpError(400, msg);

  // ------------------------------------------------------------ small helpers
  const iso = ms => (ms == null ? null : new Date(ms).toISOString());
  const int = (v, d, lo, hi) => { if (v == null || v === '') return d; const n = Math.floor(+v); if (!Number.isFinite(n)) throw bad('Expected a whole number, got "' + v + '".'); return Math.max(lo, Math.min(hi, n)); };
  const round = (x, n) => { const k = Math.pow(10, n); return Math.round(x * k) / k; };
  const gameStatus = (g, now) => g.result ? 'final' : (g.airStart != null && g.airStart <= now && now < g.airStart + (g.dur || 0)) ? 'live' : 'scheduled';

  // "season" = the current season or an archived one, in one shape
  function seasonOf(q) {
    const db = getDb(), cur = db.season;
    const raw = q.get('season');
    if (raw == null || raw === '' || raw === 'current' || (cur && +raw === cur.number)) {
      if (!cur) throw notFound('No season has been created yet.');
      return { number: cur.number, current: true, S: cur, teams: cur.teams || IFL.ORIGINAL_TEAMS, games: cur.games, stats: cur.stats || {}, rosters: cur.rosters, champion: cur.champion, playoffs: cur.playoffs, injuries: cur.injuries || {}, ratings: cur.teamRatings || null };
    }
    if (!/^\d+$/.test(raw)) throw bad('season must be a number or "current".');
    const h = db.history.find(x => x.number === +raw);
    if (!h) throw notFound('No season ' + raw + '.');
    return { number: h.number, current: false, S: h, teams: h.teams || IFL.ORIGINAL_TEAMS, games: h.games, stats: h.stats || {}, rosters: h.rosters, champion: h.champion, playoffs: h.seeds ? { seeds: h.seeds, info: h.seedInfo } : null, injuries: {}, ratings: h.teamRatings || null };
  }

  let logos = null, logosAt = 0;
  function logoOf(id) { // re-scan the logo folder at most every 30s
    if (!logos || Date.now() - logosAt > 30000) { try { logos = findLogos(); } catch (e) { logos = {}; } logosAt = Date.now(); }
    return logos[id] ? '/' + logos[id].split('?')[0] : null;
  }
  function teamRef(id) {
    const t = IFL.getTeam(id);
    return { id: t.id, abbr: t.abbr, name: t.full, city: t.city, nickname: t.name, colors: t.colors, logo: logoOf(t.id) };
  }
  const divisionOf = (se, id) => { const d = IFL.divisionsFor(se.teams).find(x => x.teams.includes(id)); return d ? { id: d.id, name: d.name } : null; };
  function venueOut(v) { return v ? { name: v.name || null, town: v.town || null, host: v.host || null } : null; }

  // ------------------------------------------------------------ simulation cache (games are deterministic)
  const simCache = new Map();
  function remember(key, make) {
    if (simCache.has(key)) { const v = simCache.get(key); simCache.delete(key); simCache.set(key, v); return v; }
    const v = make(); simCache.set(key, v);
    if (simCache.size > 24) simCache.delete(simCache.keys().next().value);
    return v;
  }
  const gameOpts = (g, rosters) => ({ playoff: !!g.playoff, rosters, out: g.out || [], venue: g.venue || undefined });
  const gameKey = (se, g) => [se.number, g.gid, g.seed, (g.out || []).join(','), g.venue ? g.venue.host + g.venue.town : ''].join('|');
  function fullSim(se, g) { // the finished game plus its broadcast timeline
    return remember('full|' + gameKey(se, g), () => {
      const sim = IFL.simulateGame(g.home, g.away, g.seed, gameOpts(g, se.rosters));
      return { sim, tl: IFL.timeline(sim.events, IFL.stageOf(g)) };
    });
  }
  // How many plays of a game on air have finished airing (same rule the web client uses).
  function playsAired(tl, elapsed) { let n = 0; while (n < tl.length && tl[n].start + tl[n].pre + tl[n].act <= elapsed) n++; return n; }
  function partialSim(se, g, n) { // a fresh Game stepped n plays forward: running stats and state
    return remember('part|' + n + '|' + gameKey(se, g), () => {
      const game = new IFL.Game(g.home, g.away, Object.assign({ seed: g.seed }, gameOpts(g, se.rosters)));
      for (let i = 0; i < n; i++) game.step();
      return game;
    });
  }

  // What the broadcast shows right now for a game: { n, total, score, state, over }
  function liveView(se, g, now) {
    const { sim, tl } = fullSim(se, g);
    const n = playsAired(tl, Math.max(0, now - g.airStart));
    const ev = n ? sim.events[n - 1] : null;
    const st = ev ? ev.post : sim.events[0].pre;
    return { n, total: sim.events.length, sim, state: st, over: n >= sim.events.length };
  }

  // ------------------------------------------------------------ shapers
  function stateOut(st) {
    if (!st) return null;
    return { quarter: st.qtr, clock: IFL.fmtClock(st.clock), clockSeconds: st.clock, down: st.down, toGo: st.togo, possession: null, phase: st.phase, timeouts: { home: st.to[0], away: st.to[1] } };
  }
  function scoreOut(g, now, se) {
    const status = gameStatus(g, now);
    if (status === 'final') { const r = g.result; return { status, home: r.score[0], away: r.score[1], ot: !!r.ot }; }
    if (status === 'live' && se.current) { const v = liveView(se, g, now); return { status, home: v.state.score[0], away: v.state.score[1], ot: v.state.qtr >= 5 }; }
    return { status, home: null, away: null, ot: false };
  }
  function gameSummary(se, g, now) {
    const sc = scoreOut(g, now, se);
    const stage = IFL.stageOf(g);
    const out = {
      id: g.gid, season: se.number, week: g.week, label: g.label || null, stage, playoff: !!g.playoff,
      status: sc.status, startsAt: iso(g.airStart), startsAtMs: g.airStart == null ? null : g.airStart,
      home: Object.assign(teamRef(g.home), { score: sc.home }), away: Object.assign(teamRef(g.away), { score: sc.away }),
      overtime: sc.ot, venue: venueOut(g.venue),
    };
    if (sc.status === 'final') out.winner = sc.home > sc.away ? g.home : sc.away > sc.home ? g.away : null;
    return out;
  }
  function playerRef(p) { return { id: p.id, name: p.name, short: p.short, position: p.pos, number: p.num, team: IFL.TEAMS[p.team] ? IFL.TEAMS[p.team].id : String(p.id).split('-')[0] }; }
  function statLine(s) { const o = {}; for (const k in s) o[k] = s[k]; return o; }
  function playOut(ev, i, homeId, awayId) {
    return {
      n: i + 1, kind: ev.kind, quarter: ev.pre.qtr, clock: IFL.fmtClock(ev.pre.clock), situation: ev.preText || null, text: ev.text,
      possession: ev.pre.poss === 0 ? homeId : awayId, tags: ev.tags || [], banner: ev.banner || null,
      scoringTeam: ev.scoring == null ? null : (ev.scoring === 0 ? homeId : awayId),
      score: { home: ev.post.score[0], away: ev.post.score[1] },
    };
  }
  function quartersOut(sim) { // one entry per period for both teams (an overtime period shows 0 for the team that did not score)
    const n = Math.max(4, sim.qs[0].length, sim.qs[1].length), pad = a => Array.from({ length: n }, (_, i) => a[i] || 0);
    return { home: pad(sim.qs[0]), away: pad(sim.qs[1]) };
  }
  function boxOut(sim, se, g) { // sim = a Game (finished or stepped part-way)
    const side = ti => {
      const players = sim.teams[ti].players.filter(p => sim.ps[p.id]).map(p => Object.assign(playerRef(p), { stats: statLine(sim.ps[p.id]) }));
      return { team: teamRef(sim.teams[ti].id), stats: sim.ts[ti] ? statLine(sim.ts[ti]) : null, players };
    };
    return { home: side(0), away: side(1) };
  }
  function inactiveOut(se, g) {
    const ids = new Set(g.out || []), out = { home: [], away: [] };
    for (const [k, id] of [['home', g.home], ['away', g.away]]) for (const p of (se.rosters[id] || [])) if (ids.has(p.id)) out[k].push(playerRef(p));
    return out;
  }
  function recordRow(r) {
    return { team: teamRef(r.id), division: r.div, wins: r.w, losses: r.l, ties: r.t, pct: round(r.pct, 3), pointsFor: r.pf, pointsAgainst: r.pa, differential: r.pf - r.pa,
      home: r.hw + '-' + r.hl, away: r.aw + '-' + r.al, divisionRecord: r.dw + '-' + r.dl + (r.dt ? '-' + r.dt : ''), streak: r.strk };
  }

  // ------------------------------------------------------------ route handlers
  const routes = [];
  const route = (re, fn) => routes.push([re, fn]);

  route(/^$/, () => ({
    name: 'IFL Gamecast API', version: 1, docs: 'See API.md in the project, or request the links below.',
    endpoints: ['status', 'teams', 'teams/{id}', 'standings', 'games', 'games/live', 'games/{id}', 'games/{id}/plays', 'players/{id}', 'leaders', 'seasons', 'seasons/{n}'].map(e => '/api/v1/' + e),
    notes: 'Read-only. Add ?season=N to most endpoints to look at an archived season. Times are ISO-8601 UTC plus epoch ms. Nothing is revealed before it has aired.',
  }));

  route(/^status$/, (q, now) => {
    const db = getDb(), S = db.season;
    const live = liveGame(now);
    const upcoming = S ? S.games.filter(g => !g.result && g.airStart != null && g.airStart > now).sort((a, b) => a.airStart - b.airStart)[0] : null;
    const se = S && seasonOf(new URLSearchParams());
    return {
      now: iso(now), nowMs: now, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, engineVersion: IFL.VERSION,
      season: S ? { number: S.number, champion: S.champion, gamesPlayed: S.games.filter(g => g.result).length, gamesTotal: S.games.length, playoffsStarted: !!S.playoffs, done: !!S.champion } : null,
      paused: !!db.settings.paused,
      live: live ? gameSummary(se, live, now) : null,
      next: upcoming ? gameSummary(se, upcoming, now) : null,
      nextSeasonStartsAt: db.nextSeason ? iso(db.nextSeason.firstGame) : null,
      estimatedSeasonEnd: iso(estimateEnd()),
    };
  });

  route(/^teams$/, q => {
    const se = seasonOf(q), recs = {};
    IFL.standings(se.games.filter(g => !g.playoff)).forEach(r => recs[r.id] = r);
    return { season: se.number, teams: se.teams.map(id => {
      const r = recs[id], rt = se.ratings && se.ratings[id];
      return Object.assign(teamRef(id), { division: divisionOf(se, id), record: r ? r.w + '-' + r.l + (r.t ? '-' + r.t : '') : '0-0', rating: rt || null });
    }) };
  });

  route(/^teams\/([A-Za-z]{3})$/, (q, now, m) => {
    const id = m[1].toUpperCase(), se = seasonOf(q);
    if (!se.teams.includes(id)) throw notFound('Team ' + id + ' did not play in season ' + se.number + '.');
    const st = IFL.standings(se.games.filter(g => !g.playoff)).find(r => r.id === id);
    const venues = getDb().venues || { stadiums: {} };
    const roster = (se.rosters[id] || []).map(p => {
      const inj = se.injuries[p.id];
      return Object.assign(playerRef(p), { rating: p.r, age: p.age, yearsPro: p.yrs, injury: inj ? { part: inj.part, gamesLeft: inj.left >= 999 ? null : inj.left, seasonEnding: inj.left >= 999 } : null, stats: se.stats[p.id] ? statLine(se.stats[p.id]) : null });
    });
    const mine = se.games.filter(g => g.home === id || g.away === id).sort((a, b) => (a.airStart == null) - (b.airStart == null) || a.airStart - b.airStart);
    return Object.assign(teamRef(id), {
      season: se.number, division: divisionOf(se, id), rating: se.ratings && se.ratings[id] || null,
      stadium: venues.stadiums && venues.stadiums[id] ? venues.stadiums[id] : null,
      record: st ? recordRow(st) : null, roster,
      schedule: mine.map(g => gameSummary(se, g, now)),
    });
  });

  function standingsFor(q) {
    const se = seasonOf(q), games = se.games.filter(g => !g.playoff);
    const divs = IFL.divisionStandings(games.length ? games : []);
    const overall = IFL.standings(games).map((r, i) => Object.assign({ rank: i + 1 }, recordRow(r)));
    return {
      season: se.number, regularSeasonGamesPlayed: games.filter(g => g.result).length, regularSeasonGames: games.length,
      divisions: divs.map(d => ({ id: d.id, name: d.name, teams: d.rows.map((r, i) => Object.assign({ rank: i + 1 }, recordRow(r))) })),
      overall,
      playoffs: se.playoffs ? { seeds: (se.playoffs.info || se.playoffs.seeds.map((id, i) => ({ id, seed: i + 1 }))).map(x => Object.assign({ seed: x.seed }, teamRef(x.id), { qualified: x.how || null })) } : null,
      champion: se.champion ? teamRef(se.champion) : null,
    };
  }
  route(/^standings$/, standingsFor);

  route(/^games$/, (q, now) => {
    const se = seasonOf(q);
    const limit = int(q.get('limit'), 50, 1, MAX_LIMIT), offset = int(q.get('offset'), 0, 0, 1e6);
    const wk = q.get('week'), team = (q.get('team') || '').toUpperCase(), status = q.get('status'), po = q.get('playoff');
    if (status && !['scheduled', 'live', 'final'].includes(status)) throw bad('status must be scheduled, live or final.');
    if (team && !se.teams.includes(team)) throw notFound('Team ' + team + ' did not play in season ' + se.number + '.');
    let list = se.games.filter(g =>
      (wk == null || String(g.week).toUpperCase() === wk.toUpperCase()) &&
      (!team || g.home === team || g.away === team) &&
      (po == null || !!g.playoff === (po === 'true' || po === '1')) &&
      (!status || gameStatus(g, now) === status));
    list.sort((a, b) => (a.airStart == null) - (b.airStart == null) || a.airStart - b.airStart || (a.gid < b.gid ? -1 : 1));
    return { season: se.number, total: list.length, offset, limit, games: list.slice(offset, offset + limit).map(g => gameSummary(se, g, now)) };
  });

  route(/^games\/live$/, (q, now) => {
    const g = liveGame(now);
    if (!g) return { live: false, game: null };
    return Object.assign({ live: true }, gameDetail(seasonOf(new URLSearchParams()), g, now, { plays: int(q.get('plays'), 5, 0, MAX_LIMIT) }));
  });

  function gameDetail(se, g, now, opt) {
    const sum = gameSummary(se, g, now), status = sum.status;
    const out = { game: sum, inactive: inactiveOut(se, g), venue: venueOut(g.venue) };
    const popts = { rosters: se.rosters, out: g.out || [], playoff: !!g.playoff, venue: g.venue || undefined };
    if (status === 'scheduled') {
      out.winProbability = { home: round(IFL.pregameWinProb(g.home, g.away, popts), 3), basis: 'pregame' };
      return out;
    }
    if (status === 'live') {
      const v = liveView(se, g, now), part = partialSim(se, g, v.n), st = v.state;
      out.progress = { playsAired: v.n, playsTotal: null };
      out.situation = Object.assign(stateOut(st), { possession: st.poss === 0 ? g.home : g.away });
      out.quarters = quartersOut(part);
      out.winProbability = { home: round(IFL.winProb(part), 3), basis: 'live' };
      out.box = boxOut(part, se, g);
      if (opt && opt.plays) out.recentPlays = v.sim.events.slice(Math.max(0, v.n - opt.plays), v.n).map((ev, i) => playOut(ev, Math.max(0, v.n - opt.plays) + i, g.home, g.away));
      return out;
    }
    const { sim } = fullSim(se, g);
    out.quarters = quartersOut(sim);
    out.progress = { playsAired: sim.events.length, playsTotal: sim.events.length };
    out.box = boxOut(sim, se, g);
    out.scoring = sim.events.map((ev, i) => ev.scoring == null ? null : playOut(ev, i, g.home, g.away)).filter(Boolean);
    return out;
  }

  function findGame(se, id) {
    const g = se.games.find(x => x.gid.toUpperCase() === id.toUpperCase());
    if (!g) throw notFound('No game "' + id + '" in season ' + se.number + '.');
    return g;
  }

  route(/^games\/([A-Za-z0-9_-]+)$/, (q, now, m) => gameDetail(seasonOf(q), findGame(seasonOf(q), m[1]), now));

  route(/^games\/([A-Za-z0-9_-]+)\/plays$/, (q, now, m) => {
    const se = seasonOf(q), g = findGame(se, m[1]), status = gameStatus(g, now);
    const since = int(q.get('since'), 0, 0, 1e6), limit = int(q.get('limit'), MAX_LIMIT, 1, 1000);
    if (status === 'scheduled') return { game: g.gid, season: se.number, status, total: 0, plays: [] };
    let upto;
    const { sim, tl } = fullSim(se, g);
    if (status === 'final') upto = sim.events.length; else upto = playsAired(tl, Math.max(0, now - g.airStart));
    const plays = sim.events.slice(since, Math.min(upto, since + limit)).map((ev, i) => playOut(ev, since + i, g.home, g.away));
    return { game: g.gid, season: se.number, status, total: upto, since, next: since + plays.length, plays };
  });

  route(/^players\/([A-Za-z0-9_-]+)$/, (q, now, m) => {
    const se = seasonOf(q), id = m[1].toUpperCase();
    for (const tid of se.teams) {
      const p = (se.rosters[tid] || []).find(x => x.id.toUpperCase() === id);
      if (!p) continue;
      const inj = se.injuries[p.id];
      return Object.assign(playerRef(p), {
        season: se.number, team: teamRef(tid), rating: p.r, age: p.age, yearsPro: p.yrs,
        injury: inj ? { part: inj.part, gamesLeft: inj.left >= 999 ? null : inj.left, seasonEnding: inj.left >= 999, since: inj.gid } : null,
        seasonStats: se.stats[p.id] ? statLine(se.stats[p.id]) : null,
      });
    }
    throw notFound('No player "' + m[1] + '" in season ' + se.number + '.');
  });

  route(/^leaders$/, q => {
    const se = seasonOf(q), limit = int(q.get('limit'), 5, 1, 50), want = q.get('category');
    if (want && !CATEGORIES[want]) throw bad('Unknown category. Use one of: ' + Object.keys(CATEGORIES).join(', ') + '.');
    const all = [];
    for (const tid of se.teams) for (const p of se.rosters[tid] || []) if (se.stats[p.id]) all.push([p, se.stats[p.id], tid]);
    const build = key => {
      const [label, fn] = CATEGORIES[key];
      const rows = all.map(([p, s, tid]) => ({ p, s, tid, v: fn(s) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v || (a.p.id < b.p.id ? -1 : 1)).slice(0, limit);
      return { label, leaders: rows.map((x, i) => Object.assign({ rank: i + 1, value: x.v }, playerRef(x.p), { teamInfo: teamRef(x.tid), gamesPlayed: x.s.gp || 0 })) };
    };
    const cats = want ? [want] : Object.keys(CATEGORIES);
    const out = {}; cats.forEach(k => out[k] = build(k));
    return { season: se.number, categories: out };
  });

  route(/^seasons$/, () => {
    const db = getDb(), out = [];
    if (db.season) out.push({ number: db.season.number, current: true, done: !!db.season.champion, champion: db.season.champion ? teamRef(db.season.champion) : null, runnerUp: null, startedAt: iso(db.season.createdAt), endedAt: iso(db.season.endedAt || null) });
    for (const h of db.history) out.push({ number: h.number, current: false, done: !!h.done, champion: h.champion ? teamRef(h.champion) : null, runnerUp: h.runnerUp ? teamRef(h.runnerUp) : null, startedAt: iso(h.startedAt), endedAt: iso(h.endedAt) });
    return { seasons: out.sort((a, b) => b.number - a.number) };
  });

  route(/^seasons\/(\d+)$/, (q, now, m) => {
    const sq = new URLSearchParams({ season: m[1] }), se = seasonOf(sq);
    const bowl = se.games.find(g => g.gid === 'P-F');
    const std = standingsFor(sq);
    return { season: se.number, current: se.current, champion: se.champion ? teamRef(se.champion) : null, teams: se.teams.map(teamRef),
      iflBowl: bowl ? gameSummary(se, bowl, now) : null, standings: std.divisions, playoffs: std.playoffs,
      links: { games: '/api/v1/games?season=' + se.number, standings: '/api/v1/standings?season=' + se.number, leaders: '/api/v1/leaders?season=' + se.number } };
  });

  // ------------------------------------------------------------ transport
  const hits = new Map();
  function limited(ip) {
    if (!(RATE_PER_MIN > 0)) return 0;
    const t = Date.now(), r = hits.get(ip);
    if (!r || t - r.t >= 60000) { hits.set(ip, { t, n: 1 }); return 0; }
    r.n++;
    return r.n > RATE_PER_MIN ? Math.ceil((60000 - (t - r.t)) / 1000) : 0;
  }
  setInterval(() => { const t = Date.now(); for (const [ip, r] of hits) if (t - r.t >= 60000) hits.delete(ip); }, 60000).unref();

  function reply(res, code, body, extra) {
    res.writeHead(code, Object.assign({
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type',
    }, extra || {}));
    res.end(JSON.stringify(body, null, 2));
  }

  // path is everything after /api/v1/
  function handle(req, res, path, query) {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }); return res.end(); }
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, { error: 'This API is read-only (GET).' }, { Allow: 'GET, HEAD, OPTIONS' });
    const wait = limited(req.socket.remoteAddress || '?');
    if (wait) return reply(res, 429, { error: 'Too many requests. Try again in ' + wait + 's.' }, { 'Retry-After': String(wait) });
    const clean = path.replace(/^\/+|\/+$/g, '');
    try {
      for (const [re, fn] of routes) {
        const m = clean.match(re);
        if (m) return reply(res, 200, fn(query, Date.now(), m));
      }
      return reply(res, 404, { error: 'Unknown endpoint. GET /api/v1 lists them.' });
    } catch (e) {
      if (e instanceof HttpError) return reply(res, e.code, { error: e.message });
      console.error('API error on /api/v1/' + clean + ':', e);
      return reply(res, 500, { error: 'Server error' });
    }
  }

  return { handle };
};
