/* IFL Simulator — game engine (no DOM). Works in browser (window.IFL) and Node (module.exports). */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- RNG
  function hashStr(s) {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }
  function makeRng(seed) {
    let a = hashStr(String(seed));
    const f = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const r = {
      f,
      int: (lo, hi) => lo + Math.floor(f() * (hi - lo + 1)),
      chance: p => f() < p,
      pick: arr => arr[Math.floor(f() * arr.length)],
      gauss: (m, s) => { let u = 0, v = 0; while (!u) u = f(); while (!v) v = f(); return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); },
      exp: m => -m * Math.log(1 - f()),
      wpick: (items, weights) => {
        let tot = 0; for (const w of weights) tot += w;
        let x = f() * tot;
        for (let i = 0; i < items.length; i++) { x -= weights[i]; if (x <= 0) return items[i]; }
        return items[items.length - 1];
      },
    };
    return r;
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------------------------------------------------------------- League
  const TEAM_DEFS = [
    { id: 'MIS', div: 'West', city: 'Miskauga', name: 'Boulders', colors: ['#5f646c', '#e07b24'], x: -20500, z: -155 },
    { id: 'LAI', div: 'West', city: 'Laiyford', name: 'Evergreens', colors: ['#1f6b3a', '#d9b23a'], x: -15100, z: -110 },
    { id: 'GHB', div: 'East', city: 'Greene Hill', name: 'Brawlers', colors: ['#b3202a', '#1b1b1b'], x: -4400, z: 180 },
    { id: 'PAR', div: 'Central', city: 'Parikia', name: 'Poseidons', colors: ['#0f7c8c', '#0b2545'], x: -5350, z: 950 },
    { id: 'DEN', div: 'East', city: 'Dennison', name: 'Spears', colors: ['#5b2a86', '#c9c9d4'], x: -4630, z: 170 },
    { id: 'KYL', div: 'Central', city: 'Kyleton', name: 'Polar Bears', colors: ['#2f7fc1', '#e8f1f8'], x: -6470, z: -1750 },
    { id: 'ASH', div: 'West', city: 'Ashford', name: 'Smokers', colors: ['#3d3936', '#e2552b'], x: -14780, z: -3280 },
    { id: 'ARG', div: 'Central', city: 'Argiroupolis', name: 'Silvers', colors: ['#7d8794', '#1d3f8f'], x: -7720, z: 4970 },
    // expansion teams (join in Season 2)
    { id: 'NSO', div: 'West', city: 'New Southington', name: 'Skylines', colors: ['#1f2a5a', '#5bc0eb'], x: -15135, z: 65 },
    { id: 'NWT', div: 'East', city: 'Newtown', name: 'Knights', colors: ['#141414', '#c9a227'], x: 140, z: 325 },
    { id: 'MON', div: 'East', city: 'Montford', name: 'Monarchs', colors: ['#7b1e3a', '#e0b84c'], x: -4140, z: 100 },
    { id: 'BRV', div: 'Central', city: 'Bradyville', name: 'Beavers', colors: ['#6b3f1d', '#f28c28'], x: -11215, z: -160 },
  ];

  const FIRST = ['Aiden','Marcus','Tyrell','Cole','Jalen','Brody','Dante','Owen','Malik','Grant','Rhett','Darius','Kellan','Trey','Javon','Wyatt','Isaiah','Bryce','Nolan','Desmond','Caleb','Xavier','Reid','Andre','Colt','Devin','Elijah','Hayes','Jamal','Keegan','Luca','Mason','Nico','Quinn','Roman','Silas','Terrell','Vince','Zane','Beau','Carter','Damon','Emmett','Felix','Gage','Hunter','Ike','Jace','Kobe','Lane','Miles','Nash','Orlando','Pierce','Ronan','Shane','Tobias','Victor','Wes','Yusuf','Zion','Bennett','Cruz','Dorian','Easton','Flynn','Gideon','Harlan','Jasper','Marlon','Deshawn','Kendrick','Tristan','Boone','Cyrus','Lamar','Mateo','Rashad','Sterling','Thiago'];
  const LAST = ['Hale','Mercer','Vance','Okafor','Brandt','Castillo','Dunmore','Ellison','Fairbanks','Garrow','Holloway','Iverson','Jessup','Kincaid','Lockhart','Maddox','Navarro','Oakes','Prescott','Quarles','Radley','Stroud','Thatcher','Underwood','Voss','Whitlock','Yarbrough','Zeller','Ashby','Blackwell','Crowder','Delacroix','Everhart','Foley','Grimes','Hargrove','Ingram','Jaffe','Kessler','Langford','Mabry','Northcutt','Ortega','Pruitt','Ridley','Sexton','Tillman','Upshaw','Vickers','Waller','Abernathy','Bellamy','Calloway','Draper','Easley','Fontaine','Gentry','Hudgins','Kearse','Lyle','McCrae','Osei','Pemberton','Rollins','Sutter','Talbot','Whitaker','Barlow','Coleman','Dawkins','Fenwick','Garland','Hollis','Keller','Lowry','Merritt','Ness','Overton','Pace','Rourke','Stiles','Tate','Wynn','Adeyemi','Brennan','Corbin','Dalton','Fitzgerald','Harrow','Moreau','Sandoval'];

  // 38-man rosters: starters + bench so injuries can be covered.
  const ROSTER = [['QB', 2], ['RB', 3], ['WR', 5], ['TE', 2], ['OL', 7], ['DL', 6], ['LB', 4], ['CB', 4], ['S', 3], ['K', 1], ['P', 1]];
  const TEMPLATE = Object.fromEntries(ROSTER);
  const STARTERS = { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, DL: 4, LB: 3, CB: 3, S: 2, K: 1, P: 1 };
  const POSITIONS = ROSTER.map(r => r[0]);
  const NUMS = { QB: [[1, 19]], RB: [[20, 39]], WR: [[10, 19], [80, 89]], TE: [[80, 89], [40, 49]], OL: [[60, 79]], DL: [[90, 99], [50, 59]], LB: [[40, 59]], CB: [[20, 39]], S: [[20, 49]], K: [[1, 9]], P: [[1, 9]] };
  const TEAM_BY_ID = Object.fromEntries(TEAM_DEFS.map((d, i) => [d.id, Object.assign({ idx: i, abbr: d.id, full: d.city + ' ' + d.name }, d)]));

  function pickNumber(rng, pos, taken) {
    for (let tries = 0; tries < 60; tries++) { const rg = rng.pick(NUMS[pos]); const n = rng.int(rg[0], rg[1]); if (!taken.has(n)) return n; }
    for (let n = 1; n < 100; n++) if (!taken.has(n)) return n;
    return 0;
  }
  function makeName(rng, usedShort) {
    let first, last, tries = 0;
    do { first = rng.pick(FIRST); last = rng.pick(LAST); } while (usedShort.has(first[0] + last) && ++tries < 500);
    usedShort.add(first[0] + last);
    return { first, last, name: first + ' ' + last, short: first[0] + '. ' + last };
  }

  // Initial league rosters (Season 1). Plain JSON-able objects: {TEAMID: [player...]}
  function initialRosters() {
    const used = new Set(), out = {};
    TEAM_DEFS.forEach((def, ti) => {
      const rng = makeRng('roster:' + def.id + ':v2');
      const boost = rng.gauss(0, 3.5);
      const nums = new Set(), players = [];
      for (const [pos, n] of ROSTER) {
        for (let i = 0; i < n; i++) {
          const nm = makeName(rng, used);
          const num = pickNumber(rng, pos, nums); nums.add(num);
          const starter = i < STARTERS[pos];
          const skill = ['QB', 'RB', 'WR', 'TE', 'CB', 'K', 'P'].includes(pos);
          const mean = starter ? 77 + boost - (skill ? i * 4 : 0) : 66 + boost - (i - STARTERS[pos]) * 2;
          const r = clamp(Math.round(rng.gauss(mean, starter ? 6 : 5)), 45, 95);
          const oldPos = pos === 'QB' || pos === 'K' || pos === 'P';
          const age = clamp(Math.round(rng.gauss(starter ? 27 : 25, 3.2)), 21, oldPos ? 37 : 34);
          players.push(Object.assign({ id: def.id + '-' + pos + (i + 1), team: ti, pos, num, r, age, yrs: Math.max(0, age - 22) }, nm));
        }
      }
      out[def.id] = players;
    });
    return out;
  }
  // Roster for a team joining an existing league: like a starting roster, slightly boosted so it can compete.
  function expansionRoster(id, existing, seed) {
    const def = TEAM_BY_ID[id], rng = makeRng('expansion:' + id + ':' + seed);
    const used = new Set();
    for (const list of Object.values(existing || {})) for (const p of list) used.add(p.first[0] + p.last);
    const boost = 1.5 + rng.gauss(0, 1.5), nums = new Set(), players = [];
    for (const [pos, n] of ROSTER) {
      for (let i = 0; i < n; i++) {
        const nm = makeName(rng, used);
        const num = pickNumber(rng, pos, nums); nums.add(num);
        const starter = i < STARTERS[pos];
        const skill = ['QB', 'RB', 'WR', 'TE', 'CB', 'K', 'P'].includes(pos);
        const mean = starter ? 77 + boost - (skill ? i * 4 : 0) : 66 + boost - (i - STARTERS[pos]) * 2;
        const r = clamp(Math.round(rng.gauss(mean, starter ? 5 : 5)), 45, 92);
        const oldPos = pos === 'QB' || pos === 'K' || pos === 'P';
        const age = clamp(Math.round(rng.gauss(starter ? 27 : 24, 3)), 21, oldPos ? 36 : 33);
        players.push(Object.assign({ id: id + '-' + pos + (i + 1), team: def.idx, pos, num, r, age, yrs: Math.max(0, age - 22), expansion: true }, nm));
      }
    }
    return players;
  }
  function fillerPlayer(team, pos, i) {
    return { id: team.id + '-PS-' + pos + i, team: team.idx, pos, num: 0, r: 50, age: 24, first: 'Practice', last: 'Squad', name: 'Practice Squad ' + pos, short: 'PS ' + pos + (i + 1), filler: true };
  }
  // Rebuild depth charts (best healthy players first) and team ratings.
  function rebuildTeam(t) {
    const depth = {};
    for (const pos of POSITIONS) {
      depth[pos] = t.players.filter(p => p.pos === pos && !t.out.has(p.id)).sort((a, b) => b.r - a.r);
      let i = 0;
      while (depth[pos].length < STARTERS[pos]) depth[pos].push(fillerPlayer(t, pos, i++));
    }
    const avg = a => a.reduce((s, p) => s + p.r, 0) / a.length;
    const top = (pos, n) => depth[pos].slice(0, n || STARTERS[pos]);
    const rt = {
      qb: depth.QB[0].r,
      rb: depth.RB[0].r,
      rec: (depth.WR[0].r * 1.2 + depth.WR[1].r + depth.WR[2].r * 0.8 + depth.TE[0].r) / 4,
      ol: avg(top('OL')),
      rush: avg(top('DL')) * 0.7 + avg(top('LB')) * 0.3,
      runD: avg(top('DL')) * 0.5 + avg(top('LB')) * 0.5,
      cov: avg(top('CB')) * 0.6 + avg(top('S')) * 0.4,
      k: depth.K[0].r, p: depth.P[0].r,
    };
    rt.off = Math.round((rt.qb * 0.4 + rt.rec * 0.25 + rt.ol * 0.2 + rt.rb * 0.15));
    rt.def = Math.round((rt.rush * 0.35 + rt.runD * 0.3 + rt.cov * 0.35));
    rt.ovr = Math.round(rt.off * 0.55 + rt.def * 0.45);
    t.depth = depth; t.rt = rt;
    return t;
  }
  // A team object for a game or a roster page. players: that team's roster; out: ids that can't play.
  function buildTeam(id, players, out) {
    const def = TEAM_BY_ID[id];
    const t = Object.assign({}, def, { players: players || DEFAULT_ROSTERS[id], out: new Set(out || []) });
    return rebuildTeam(t);
  }
  const DEFAULT_ROSTERS = initialRosters();
  const LEAGUE = TEAM_DEFS.map(d => buildTeam(d.id));
  const getTeam = id => LEAGUE.find(t => t.id === id);
  const travelDist = (a, b) => Math.round(Math.hypot(a.x - b.x, a.z - b.z));

  // ---------------------------------------------------------------- Constants
  const HASH_L = 23.58, HASH_R = 29.75, MID = 26.65;
  const ORD = ['', '1st', '2nd', '3rd', '4th'];
  const PEN = {
    FS: { name: 'False Start', side: 'O', yds: 5, pos: ['OL', 'OL', 'OL', 'TE', 'WR'] },
    OFFS: { name: 'Offside', side: 'D', yds: 5, pos: ['DL', 'DL', 'LB'] },
    NZI: { name: 'Neutral Zone Infraction', side: 'D', yds: 5, pos: ['DL'] },
    ENC: { name: 'Encroachment', side: 'D', yds: 5, pos: ['DL'] },
    DOG: { name: 'Delay of Game', side: 'O', yds: 5, pos: ['QB'] },
    OH: { name: 'Offensive Holding', side: 'O', yds: 10, pos: ['OL', 'OL', 'OL', 'TE'] },
    IBB: { name: 'Illegal Block Above the Waist', side: 'O', yds: 10, pos: ['WR', 'TE', 'OL'] },
    OPI: { name: 'Offensive Pass Interference', side: 'O', yds: 10, pos: ['WR', 'TE'] },
    DH: { name: 'Defensive Holding', side: 'D', yds: 5, auto: true, pos: ['CB', 'S', 'LB'] },
    IUH: { name: 'Illegal Use of Hands', side: 'D', yds: 5, auto: true, pos: ['DL', 'CB'] },
    ICT: { name: 'Illegal Contact', side: 'D', yds: 5, auto: true, pos: ['CB'] },
    DPI: { name: 'Defensive Pass Interference', side: 'D', yds: 0, auto: true, spot: true, pos: ['CB', 'CB', 'S'] },
    RTP: { name: 'Roughing the Passer', side: 'D', yds: 15, auto: true, add: true, pos: ['DL', 'LB'] },
    UR: { name: 'Unnecessary Roughness', side: 'D', yds: 15, auto: true, add: true, pos: ['LB', 'S', 'CB', 'DL'] },
    FM: { name: 'Face Mask', side: 'D', yds: 15, auto: true, add: true, pos: ['LB', 'DL', 'S'] },
    UNS: { name: 'Unsportsmanlike Conduct', side: 'D', yds: 15, auto: true, add: true, pos: ['CB', 'S', 'LB'] },
    IG: { name: 'Intentional Grounding', side: 'O', yds: 0, lod: true, pos: ['QB'] },
  };

  function fmtClock(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function qName(q) { return q <= 4 ? ORD[q] + ' Quarter' : (q === 5 ? 'Overtime' : 'OT' + (q - 4)); }

  // ---------------------------------------------------------------- Game
  function newPStats() { return {}; }
  function newTStats() { return { fd: 0, plays: 0, yds: 0, py: 0, ry: 0, pen: 0, peny: 0, to: 0, top: 0, d3a: 0, d3c: 0, d4a: 0, d4c: 0, sk: 0, sky: 0, ra: 0, pa: 0, pc: 0 }; }

  class Game {
    constructor(homeId, awayId, opts) {
      opts = opts || {};
      this.seed = String(opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9));
      this.playoff = !!opts.playoff;
      this.rng = makeRng('game:' + this.seed + ':' + homeId + ':' + awayId);
      // opts.rosters: {TEAMID: [players]} (defaults to the Season 1 rosters); opts.out: player ids that are inactive (injured)
      const ros = opts.rosters || {};
      this.teams = [buildTeam(homeId, ros[homeId], opts.out), buildTeam(awayId, ros[awayId], opts.out)];
      this.inactive = (opts.out || []).slice();
      this.injuries = [];
      this.travel = travelDist(this.teams[0], this.teams[1]);
      // home field + travel fatigue (in rating points)
      // home field + travel fatigue (in rating points).
      // opts.venue = {name, town, x, z, host}: where the game is played. Without it, the home team hosts in its own city
      // (the original rule, kept exactly so games played before venues existed replay identically).
      this.venue = opts.venue || null;
      if (!this.venue) this.adj = [1.5, -Math.min(2.5, this.travel / 8000)];
      else {
        const v = this.venue, tr = t => Math.round(Math.hypot(t.x - v.x, t.z - v.z));
        this.adj = this.teams.map(t => (v.host === t.id ? 1.5 : 0) - Math.min(2.5, tr(t) / 8000));
      }
      this.score = [0, 0]; this.qs = [[0, 0, 0, 0], [0, 0, 0, 0]];
      this.qtr = 1; this.clock = 900; this.to = [3, 3];
      this.poss = 0; this.ball = 25; this.ballY = MID; this.down = 1; this.togo = 10;
      this.phase = 'coin'; this.clockRunning = false; this.over = false; this.tmw = {};
      this.events = []; this.drives = []; this.drive = null;
      this.ps = {}; this.ts = [newTStats(), newTStats()];
      this.otPoss = [false, false];
      this.kicker = 0; this.seq = 0; this.resume = null;
    }

    // ---------- helpers
    R(t, key) { return this.teams[t].rt[key] + this.adj[t]; }
    P(t, pos, i) { const d = this.teams[t].depth[pos]; return d[i || 0] || d[d.length - 1]; }
    on(t, pos) { return this.teams[t].depth[pos].slice(0, STARTERS[pos]); } // players on the field at that position

    // ---------- injuries (about 1.6 per game across both teams, NFL-like)
    injuryCheck(ev, res, o) {
      const rng = this.rng, d = 1 - o;
      if (!rng.chance(0.0115)) return;
      const cands = [];
      if (res.carrier) cands.push([o, res.carrier, 0.3]);
      if (res.tackler) cands.push([d, res.tackler, 0.15]);
      if (res.attempt || res.sack) cands.push([o, this.P(o, 'QB'), res.sack ? 0.25 : 0.06]);
      cands.push([o, rng.pick(this.on(o, rng.pick(['OL', 'OL', 'WR', 'TE', 'RB']))), 0.24]);
      cands.push([d, rng.pick(this.on(d, rng.pick(['DL', 'DL', 'LB', 'CB', 'S']))), 0.22]);
      const [t, p] = rng.wpick(cands, cands.map(c => c[2]));
      if (!p || p.filler || p.pos === 'K' || p.pos === 'P' || this.teams[t].out.has(p.id)) return;
      const games = rng.wpick([0, 1, 2, 3, 4, 6, 8, 99], [0.22, 0.25, 0.17, 0.1, 0.08, 0.07, 0.04, 0.07]);
      const part = rng.pick(['knee', 'ankle', 'hamstring', 'shoulder', 'concussion', 'groin', 'foot', 'ribs', 'hand', 'back']);
      this.teams[t].out.add(p.id);
      rebuildTeam(this.teams[t]);
      const inj = { pid: p.id, team: this.teams[t].id, name: p.name, short: p.short, pos: p.pos, part, games, qtr: this.qtr };
      this.injuries.push(inj);
      ev.injury = inj;
      ev.tags = ev.tags || []; ev.tags.push('INJ');
      ev.text += ` INJURY: ${this.abbr(t)}-${p.short} (${p.pos}, ${part}) is out for the rest of the game.`;
      if (!ev.banner) ev.banner = 'INJURY';
    }
    abbr(t) { return this.teams[t].abbr; }
    attackRight(t) { const odd = (this.qtr % 2) === 1; return (t === 0) === odd; }
    abs(y, t) { return this.attackRight(t) ? y : 100 - y; }
    dir(t) { return this.attackRight(t) ? 1 : -1; }
    spot(y, t) {
      y = Math.round(y);
      if (y === 50) return '50';
      return y < 50 ? this.abbr(t) + ' ' + y : this.abbr(1 - t) + ' ' + (100 - y);
    }
    dd() {
      const goal = this.ball + this.togo >= 100;
      return ORD[this.down] + ' & ' + (goal ? 'Goal' : this.togo) + ' at ' + this.spot(this.ball, this.poss);
    }
    st(p, k, v) { const s = this.ps[p.id] || (this.ps[p.id] = {}); s[k] = (s[k] || 0) + v; }
    stMax(p, k, v) { const s = this.ps[p.id] || (this.ps[p.id] = {}); s[k] = Math.max(s[k] || 0, v); }
    tackler(t, kind) {
      const w = kind === 'run' ? { LB: 0.45, DL: 0.27, S: 0.18, CB: 0.1 } : kind === 'deep' ? { CB: 0.45, S: 0.45, LB: 0.1 } : { CB: 0.38, S: 0.27, LB: 0.3, DL: 0.05 };
      const pos = this.rng.wpick(Object.keys(w), Object.values(w));
      const arr = this.on(t, pos);
      return this.rng.pick(arr);
    }
    lat() { return this.ballY; }
    snapshot() {
      return {
        qtr: this.qtr, clock: this.clock, poss: this.poss, ball: this.ball, ballAbs: this.abs(this.ball, this.poss), ballY: this.ballY,
        down: this.down, togo: this.togo, fdAbs: this.abs(Math.min(100, this.ball + this.togo), this.poss), to: this.to.slice(),
        score: this.score.slice(), phase: this.phase, over: this.over, attackRight: this.attackRight(this.poss), kicker: this.kicker,
        kickAbs: this.abs(this.phase === 'freekick' ? 20 : 35, this.kicker),
      };
    }
    secsLeftGame() { return this.qtr <= 4 ? (4 - this.qtr) * 900 + this.clock : this.clock; }
    lead(t) { return this.score[t] - this.score[1 - t]; }
    isLate() { return this.qtr >= 4; }
    hurry(o) {
      const q = this.qtr, c = this.clock, ld = this.lead(o);
      if (q === 2 && c <= 120) return true;
      if (q >= 4 && ld < 0 && c <= 300) return true;
      if (q >= 4 && ld <= -9 && c <= 600) return true;
      if (q >= 4 && ld <= -17 && c <= 900) return true;
      if (q >= 4 && ld === 0 && c <= 90) return true;
      return false;
    }
    milk(o) { const ld = this.lead(o); return this.qtr >= 4 && ld > 0 && this.clock <= 720; }
    maxFG(o) { return 55 + (this.P(o, 'K').r - 75) / 4; }
    fgProb(o, dist) {
      const k = this.P(o, 'K').r;
      return 0.985 / (1 + Math.exp((dist - (57 + (k - 75) / 4)) / 5.5));
    }

    // ---------- clock
    tick(sec, o) {
      const b = this.clock;
      this.clock = Math.max(0, this.clock - sec);
      if (o != null) this.ts[o].top += b - this.clock;
      if ((this.qtr === 2 || this.qtr >= 4) && b > 120 && this.clock <= 120 && !this.tmw[this.qtr]) {
        this.tmw[this.qtr] = true; this.twoMinNote = true;
      }
    }
    clockStops(oob) {
      // out of bounds stops clock only late in halves
      if (oob) {
        const late = (this.qtr === 2 && this.clock <= 120) || (this.qtr >= 4 && this.clock <= 300);
        this.clockRunning = !late;
        if (!late) this.oobRestart = true;
      }
    }

    // ---------- step
    step() {
      if (this.over) return null;
      const pre = this.snapshot();
      const preText = this.phase === 'play' ? this.dd() : '';
      this.twoMinNote = false; this.snapClock = null;
      let ev;
      switch (this.phase) {
        case 'coin': ev = this.coinToss(); break;
        case 'kickoff': ev = this.kickoff(false); break;
        case 'freekick': ev = this.kickoff(true); break;
        case 'pat': ev = this.pat(); break;
        case 'play': ev = this.scrimmage(); break;
        case 'endperiod': ev = this.endPeriod(); break;
      }
      if (this.twoMinNote && !ev.tmwDone) { ev.text += ' Two-Minute Warning.'; this.clockRunning = false; }
      ev.id = ++this.seq; ev.pre = pre; ev.preText = preText; ev.qtr = pre.qtr; ev.clockStart = pre.clock;
      ev.tags = ev.tags || [];
      if (!this.over && this.clock <= 0 && ['play', 'kickoff', 'freekick'].includes(this.phase)) {
        this.resume = this.phase; this.phase = 'endperiod';
      }
      ev.post = this.snapshot();
      ev.snapClock = this.snapClock != null ? this.snapClock : ((ev.path && ev.path.length > 1) ? pre.clock : ev.post.clock);
      this.events.push(ev);
      return ev;
    }
    simulate() { let n = 0; while (!this.over && n++ < 3000) this.step(); return this; }

    addScore(t, pts) {
      this.score[t] += pts;
      const qi = Math.min(this.qtr, 5) - 1;
      if (!this.qs[t][qi]) this.qs[t][qi] = 0;
      this.qs[t][qi] += pts;
    }

    // ---------- drives
    startDrive() {
      this.drive = { team: this.poss, startAbs: this.abs(this.ball, this.poss), start: this.ball, startSpot: this.spot(this.ball, this.poss), qtr: this.qtr, clock: this.clock, plays: 0, yds: 0, top0: this.ts[this.poss].top, result: null };
      if (this.qtr >= 5) this.otPoss[this.poss] = true;
    }
    endDrive(result) {
      if (!this.drive) return;
      const d = this.drive;
      d.result = result; d.top = this.ts[d.team].top - d.top0;
      this.drives.push(d); this.drive = null;
    }
    changePoss(newBall, result) {
      this.endDrive(result);
      this.poss = 1 - this.poss;
      this.ball = clamp(Math.round(newBall), 1, 99);
      this.down = 1; this.togo = Math.min(10, 100 - this.ball);
      this.clockRunning = false;
      this.phase = 'play';
      if (this.otCheck()) return;
      this.startDrive();
    }
    otCheck() {
      if (this.qtr < 5 || this.over) return false;
      if (this.otPoss[0] && this.otPoss[1] && this.score[0] !== this.score[1]) { this.finish(); return true; }
      return false;
    }
    finish() {
      this.over = true; this.phase = 'final'; this.endDrive(this.drive ? 'End of Game' : null);
    }

    // ---------- coin toss / periods
    coinToss() {
      const w = this.rng.int(0, 1);
      const call = this.rng.chance(0.5) ? 'heads' : 'tails';
      let text;
      if (this.qtr >= 5) {
        this.kicker = 1 - w;
        text = `${this.teams[w].full} win the overtime coin toss (called ${call}) and will receive.`;
      } else {
        this.receiverFirst = w === 0 ? 1 : 0; // winner defers
        this.kicker = w;
        text = `${this.teams[w].full} win the coin toss (called ${call}) and defer to the second half. ${this.teams[1 - w].full} will receive.`;
      }
      this.phase = 'kickoff';
      return { kind: 'info', text, banner: this.qtr >= 5 ? 'OVERTIME' : 'KICKOFF' };
    }
    endPeriod() {
      const q = this.qtr;
      let text, banner = null;
      if (q === 1 || q === 3) {
        text = `End of ${ORD[q]} quarter. Teams change ends.`;
        this.qtr++; this.clock = 900; this.phase = this.resume || 'play';
      } else if (q === 2) {
        this.endDrive('End of Half');
        text = `End of first half — ${this.abbr(1)} ${this.score[1]}, ${this.abbr(0)} ${this.score[0]}.`;
        banner = 'HALFTIME';
        this.qtr = 3; this.clock = 900; this.to = [3, 3]; this.kicker = 1 - this.receiverFirst; this.phase = 'kickoff';
      } else {
        if (this.score[0] === this.score[1] && (q === 4 || this.playoff)) {
          this.endDrive(q === 4 ? 'End of Regulation' : 'End of Period');
          text = q === 4 ? `End of regulation, tied ${this.score[0]}–${this.score[1]}. We're going to overtime!` : `End of overtime period, still tied. Another overtime period.`;
          banner = 'OVERTIME';
          this.qtr = q + 1; this.clock = this.playoff ? 900 : 600; this.to = [2, 2];
          if (q === 4) { this.otPoss = [false, false]; this.phase = 'coin'; }
          else { this.phase = this.resume || 'play'; }
        } else {
          this.finish();
          const w = this.score[0] === this.score[1] ? -1 : (this.score[0] > this.score[1] ? 0 : 1);
          text = w < 0 ? `Final: tie game, ${this.score[1]}–${this.score[0]}.` : `Final: ${this.teams[w].full} win ${Math.max(...this.score)}–${Math.min(...this.score)}.`;
          banner = 'FINAL';
        }
      }
      return { kind: 'period', text, banner };
    }

    // ---------- kickoffs
    kickoff(free) {
      const K = this.kicker, R = 1 - K, rng = this.rng;
      this.poss = K;
      const from = free ? 20 : 35;
      const kAbs = this.abs(from, K);
      const dK = this.dir(K);
      const kick = free ? this.P(K, 'P') : this.P(K, 'K');
      const ret = this.P(R, rng.chance(0.6) ? 'WR' : 'RB', rng.chance(0.7) ? 1 : 0) || this.P(R, 'WR', 1);
      this.ballY = MID;
      const path = [{ x: kAbs, y: MID }];
      const ldK = this.lead(K);
      // onside
      if (!free && this.qtr === 4 && ldK < 0 && ldK >= -16 && this.clock <= 240) {
        const rec = rng.chance(0.13);
        const landR = 100 - (from + rng.int(10, 13)); // in receiving team coords
        path.push({ x: this.abs(100 - landR, K), y: MID + rng.gauss(0, 6), m: 'kick', h: 2 });
        this.tick(rng.int(2, 4), null);
        if (rec) {
          // kicking team keeps ball
          this.endDrive(null);
          this.poss = K; this.ball = 100 - landR; this.down = 1; this.togo = 10; this.phase = 'play'; this.clockRunning = false;
          this.startDrive();
          return { kind: 'kickoff', text: `${kick.short} onside kick... RECOVERED by ${this.abbr(K)} at the ${this.spot(this.ball, K)}!`, path, tags: ['ONSIDE', 'TO'], banner: 'ONSIDE RECOVERED' };
        }
        this.poss = R; this.ball = landR; this.down = 1; this.togo = 10; this.phase = 'play'; this.clockRunning = false;
        this.startDrive();
        return { kind: 'kickoff', text: `${kick.short} onside kick is recovered by ${this.abbr(R)} at the ${this.spot(landR, R)}.`, path, tags: ['ONSIDE'] };
      }
      // normal / free kick
      const tbP = free ? 0.05 : 0.36 + (kick.r - 75) / 200;
      if (rng.chance(tbP)) {
        path.push({ x: this.abs(100 + rng.int(1, 8), K), y: MID + rng.gauss(0, 4), m: 'kick', h: 18 });
        this.poss = R; this.ball = 35; this.down = 1; this.togo = 10; this.phase = 'play'; this.clockRunning = false;
        this.startDrive();
        return { kind: 'kickoff', text: `${kick.short} kicks ${65 + rng.int(1, 8)} yards from ${this.spot(from, K)}, into the end zone. Touchback.`, path, tags: [] };
      }
      // returned
      let catchR = free ? clamp(Math.round(rng.gauss(18, 6)), 5, 35) : rng.int(-4, 6); // receiving team coords (yards from own goal)
      const kickLen = (100 - from) - catchR;
      const cy = MID + rng.gauss(0, 7);
      path.push({ x: this.abs(100 - catchR, K), y: cy, m: 'kick', h: free ? 14 : 16 });
      let end = Math.round(free ? catchR + clamp(rng.gauss(10, 7), 0, 40) : clamp(rng.gauss(28.5, 6.5), 12, 45));
      if (rng.chance(0.035)) end += Math.round(rng.exp(18));
      let tags = [], banner = null, text;
      const retY = Math.max(0, end - Math.max(0, catchR));
      const tk = this.tackler(K, 'deep');
      this.tick(rng.int(4, 7), null);
      // return fumble
      if (end < 100 && rng.chance(0.006)) {
        end = Math.min(end, 99);
        path.push({ x: this.abs(100 - end, K), y: clamp(cy + rng.gauss(0, 8), 2, 51), m: 'carry' });
        this.st(ret, 'kr', 1); this.st(ret, 'kry', end - catchR); this.st(ret, 'fum', 1); this.st(tk, 'ff', 1);
        this.ts[R].to++;
        this.endDrive(null);
        this.poss = K; this.ball = 100 - end; this.down = 1; this.togo = Math.min(10, 100 - this.ball); this.phase = 'play'; this.clockRunning = false; this.startDrive();
        return { kind: 'kickoff', text: `${kick.short} kicks ${kickLen} yards from ${this.spot(from, K)}. ${ret.short} returns to the ${this.spot(end, R)}, FUMBLES, recovered by ${this.abbr(K)} (${tk.short}).`, path, tags: ['TO'], banner: 'FUMBLE' };
      }
      if (end >= 100) {
        path.push({ x: this.abs(-5, K), y: clamp(cy + rng.gauss(0, 10), 3, 50), m: 'carry' });
        this.st(ret, 'kr', 1); this.st(ret, 'kry', 100 - catchR); this.st(ret, 'krtd', 1);
        this.endDrive(null);
        this.poss = R; this.addScore(R, 6); this.phase = 'pat'; this.ball = 85;
        if (this.qtr >= 5 && this.otPoss[K] && this.lead(R) > 0) this.finish();
        return { kind: 'kickoff', text: `${kick.short} kicks ${kickLen} yards from ${this.spot(from, K)}. ${ret.short} returns it ${100 - catchR} yards for a TOUCHDOWN!`, path, tags: ['TD'], banner: 'KICK RETURN TD', scoring: R };
      }
      let note = '';
      // penalty on return
      if (rng.chance(0.055)) {
        const pn = rng.chance(0.6) ? PEN.OH : PEN.IBB;
        const plyr = rng.pick(this.on(R, rng.pick(['LB', 'S', 'TE', 'WR'])));
        const yds = Math.min(10, Math.floor(end / 2));
        note = ` PENALTY on ${this.abbr(R)}-${plyr.short}, ${pn.name}, ${yds} yards, enforced at ${this.spot(end, R)}.`;
        this.ts[R].pen++; this.ts[R].peny += yds; end -= yds; tags.push('FLAG');
        this.flagAt = end;
      }
      path.push({ x: this.abs(100 - (end + (note ? 10 : 0)), K), y: clamp(cy + rng.gauss(0, 9), 1, 52), m: 'carry' });
      this.st(ret, 'kr', 1); this.st(ret, 'kry', retY);
      this.st(tk, 'tk', 1);
      text = `${kick.short} ${free ? 'free kick' : 'kicks'} ${kickLen} yards from ${this.spot(from, K)} to ${catchR <= 0 ? 'the ' + this.abbr(R) + (catchR < 0 ? ' end zone' : ' goal line') : 'the ' + this.spot(catchR, R)}. ${ret.short} returns to the ${this.spot(end + (note ? (Math.min(10, Math.floor((end + 10) / 2))) : 0), R)} for ${retY} yards (${tk.short}).${note}`;
      this.poss = R; this.ball = clamp(end, 1, 99); this.down = 1; this.togo = Math.min(10, 100 - this.ball); this.phase = 'play'; this.clockRunning = false;
      this.ballY = clamp(path[path.length - 1].y, HASH_L, HASH_R);
      this.startDrive();
      const ev = { kind: 'kickoff', text, path, tags, banner };
      if (note) ev.flag = { abs: this.abs(this.ball, R), y: this.ballY };
      return ev;
    }

    // ---------- PAT
    pat() {
      const o = this.poss, rng = this.rng, ld = this.lead(o); // lead after TD
      // two-point decision
      let go2 = false;
      const lateish = this.qtr >= 4 || (this.qtr === 3 && this.clock < 300);
      if (lateish && [-2, -5, -10, -13, 1, 5, -9, 12, -16].includes(ld)) go2 = true;
      if (this.qtr >= 4 && this.clock < 120 && ld === -1) go2 = rng.chance(0.3);
      if (!go2 && rng.chance(0.03)) go2 = true;
      const dAbs = this.dir(o);
      let ev;
      if (go2) {
        const pass = rng.chance(0.6);
        const ok = rng.chance(0.47 + (this.R(o, 'off') - this.R(1 - o, 'def')) / 100);
        const qb = this.P(o, 'QB'), tgt = this.rng.pick([this.P(o, 'WR'), this.P(o, 'WR', 1), this.P(o, 'TE')]), rb = this.P(o, 'RB');
        const path = pass
          ? [{ x: this.abs(98, o) - dAbs * 0, y: MID }, { x: this.abs(93, o), y: MID }, { x: this.abs(ok ? 102 : 104, o), y: MID + rng.gauss(0, 8), m: 'air', h: 3 }]
          : [{ x: this.abs(98, o), y: MID }, { x: this.abs(96, o), y: MID }, { x: this.abs(ok ? 101 : 99, o), y: MID + rng.gauss(0, 3), m: 'carry' }];
        const desc = pass ? `${qb.short} pass to ${tgt.short}` : `${rb.short} rush`;
        if (ok) this.addScore(o, 2);
        ev = { kind: 'pat', text: `TWO-POINT CONVERSION ATTEMPT. ${desc}. ATTEMPT ${ok ? 'SUCCEEDS' : 'FAILS'}.`, path, tags: ok ? ['2PT'] : [], banner: ok ? '2-PT GOOD' : '2-PT FAILS', scoring: ok ? o : null };
      } else {
        const k = this.P(o, 'K');
        const ok = rng.chance(0.945 + (k.r - 75) / 400);
        this.st(k, 'xpa', 1); if (ok) { this.st(k, 'xpm', 1); this.addScore(o, 1); }
        const path = [{ x: this.abs(85, o), y: MID }, { x: this.abs(110, o), y: ok ? MID + rng.gauss(0, 1.2) : MID + (rng.chance(0.5) ? 1 : -1) * rng.int(5, 8), m: 'kick', h: 10 }];
        ev = { kind: 'pat', text: `${k.short} extra point is ${ok ? 'GOOD' : 'NO GOOD'}.`, path, tags: ok ? ['XP'] : [], banner: ok ? null : 'XP MISSED', scoring: ok ? o : null };
      }
      this.kicker = o; this.phase = 'kickoff';
      if (this.qtr >= 5) this.otCheck();
      return ev;
    }

    // ---------- scrimmage
    maybeTimeout() {
      const o = this.poss, d = 1 - o, q = this.qtr, c = this.clock;
      const ldD = this.lead(d);
      if (this.to[d] > 0 && q >= 4 && ldD < 0 && ldD >= -16 && c <= 150 && c > 0) return this.timeout(d);
      if (this.to[o] > 0 && this.hurry(o) && c > 0 && ((q >= 4 && this.lead(o) <= 0 && c <= 100) || (q === 2 && c <= 40 && this.ball >= 40))) return this.timeout(o);
      return null;
    }
    timeout(t) {
      this.to[t]--; this.clockRunning = false;
      return { kind: 'timeout', text: `Timeout #${(this.qtr >= 5 ? 2 : 3) - this.to[t]} by ${this.teams[t].full} at ${fmtClock(this.clock)}.`, tags: ['TIMEOUT'] };
    }
    runoff() {
      const o = this.poss, rng = this.rng;
      let r;
      if (this.oobRestart) { r = rng.int(14, 22); this.oobRestart = false; }
      else if (this.hurry(o)) r = rng.int(6, 12);
      else if (this.milk(o)) r = rng.int(37, 40);
      else r = rng.int(32, 39);
      const b = this.clock;
      if ((this.qtr === 2 || this.qtr >= 4) && b > 120 && b - r <= 120 && !this.tmw[this.qtr]) {
        this.tick(b - 120, o); this.tmw[this.qtr] = true; this.clockRunning = false;
        return { kind: 'info', text: 'Two-Minute Warning.', banner: 'TWO-MINUTE WARNING', tmwDone: true };
      }
      if (this.hurry(o) && b > 1 && b - r < 1) r = b - 1;
      this.tick(r, o);
      if (this.clock <= 0) return { kind: 'info', text: `${this.abbr(o)} lets the clock run out.`, tmwDone: true };
      return null;
    }

    callPlay(wasRunning) {
      const o = this.poss, d = 1 - o, q = this.qtr, c = this.clock, ld = this.lead(o), rng = this.rng;
      const toD = this.to[d];
      // kneel to end game
      if (ld > 0 && q >= 4) {
        const n = 5 - this.down;
        const burn = n * 2 + Math.max(0, n - 1 - toD) * 40 + 1;
        if (c <= burn) return { type: 'kneel' };
      }
      if (q === 2 && c <= 30 && this.ball <= 40 && !(this.ball > 30 && this.to[o] >= 2)) return { type: 'kneel' };
      if (q === 2 && c <= 70 && this.ball <= 22 && ld >= 0) return { type: 'kneel' };
      const fgDist = 117 - this.ball;
      const canFG = fgDist <= this.maxFG(o);
      const hurry = this.hurry(o);
      // last-second field goal
      if (canFG && c <= 6 && (q === 2 || (q >= 4 && ld >= -3 && ld <= 0))) return { type: 'fg' };
      // spike
      if (wasRunning && hurry && this.to[o] === 0 && c <= 30 && c > 6 && this.down <= 3) return { type: 'spike' };
      // hail mary
      if (hurry && c <= 7 && this.ball >= 35 && !(canFG && (q === 2 || ld >= -3))) return { type: 'pass', depth: 'hail' };
      // 4th down
      if (this.down === 4) {
        const dec = this.fourthDown(canFG, fgDist);
        if (dec !== 'go') return { type: dec };
      }
      // run or pass
      const tg = this.togo, dn = this.down;
      let pp;
      if (dn === 1) pp = tg > 10 ? 0.62 : 0.52;
      else if (dn === 2) pp = tg >= 8 ? 0.64 : tg <= 3 ? 0.4 : 0.54;
      else if (dn === 3) pp = tg >= 5 ? 0.88 : tg <= 2 ? 0.42 : 0.72;
      else pp = tg <= 2 ? 0.5 : 0.85;
      if (this.ball >= 97) pp = Math.min(pp, 0.45);
      if (hurry) pp += 0.3;
      if (this.milk(o)) pp -= 0.25 + (c < 240 ? 0.15 : 0);
      if (q >= 4 && ld > 14) pp -= 0.1;
      pp += (this.R(o, 'qb') - this.R(o, 'rb')) / 120;
      pp = clamp(pp, 0.08, 0.96);
      if (rng.chance(pp)) {
        let w;
        if (tg >= 10 && dn >= 2) w = [0.42, 0.4, 0.18];
        else if (tg <= 3) w = [0.75, 0.17, 0.08];
        else w = [0.6, 0.27, 0.13];
        if (hurry && (q >= 4 ? ld <= -9 : false)) w = [0.35, 0.4, 0.25];
        if (this.ball >= 80) w = [0.7, 0.3, 0];
        return { type: 'pass', depth: rng.wpick(['short', 'med', 'deep'], w) };
      }
      return { type: 'run' };
    }
    fourthDown(canFG, fgDist) {
      const o = this.poss, d = 1 - o, q = this.qtr, c = this.clock, ld = this.lead(o), rng = this.rng, b = this.ball, tg = this.togo;
      const desperate = q >= 4 && ld < 0 && (c <= 150 || (ld < -8 && c <= 360) || (ld < -16 && c <= 600));
      if (q >= 5 && this.otPoss[d]) { // must answer in OT
        if (ld < -3) return 'go';
        if (ld < 0) return canFG ? 'fg' : 'go';
        if (ld === 0 && canFG) return 'fg';
      }
      if (desperate) {
        if (canFG && ld >= -3 && (c <= 40 || tg > 6)) return 'fg';
        return 'go';
      }
      if (q === 2 && c <= 12) return canFG ? 'fg' : (b >= 45 ? 'go' : 'punt');
      // protect late lead
      if (q >= 4 && ld > 0 && c <= 300) { if (canFG && this.fgProb(o, fgDist) > 0.6) return 'fg'; return b >= 70 && tg <= 1 ? 'go' : 'punt'; }
      let pGo = 0.02;
      if (tg <= 1) pGo = b >= 50 ? 0.7 : b >= 35 ? 0.35 : 0.06;
      else if (tg === 2) pGo = b >= 60 ? 0.45 : b >= 42 ? 0.22 : 0.03;
      else if (tg <= 4) pGo = (b >= 55 && b <= 68) ? 0.35 : b > 68 ? 0.15 : 0.03;
      else if (tg <= 7) pGo = (b >= 58 && !canFG) ? 0.3 : 0.02;
      if (b + tg >= 100 && tg <= 2) pGo = 0.55;
      if (q >= 4 && ld < 0) pGo += 0.15;
      if (rng.chance(pGo)) return 'go';
      if (canFG && this.fgProb(o, fgDist) >= 0.42) return 'fg';
      if (b >= 62) return 'go';
      return 'punt';
    }

    scrimmage() {
      const o = this.poss, d = 1 - o, rng = this.rng;
      if (!this.drive) this.startDrive();
      const wasRunning = this.clockRunning;
      if (this.clockRunning) {
        const t = this.maybeTimeout(); if (t) return t;
        const w = this.runoff(); if (w) return w;
      }
      this.snapClock = this.clock;
      const call = this.callPlay(wasRunning);
      // pre-snap penalty
      if (call.type !== 'kneel' && call.type !== 'spike' && rng.chance(0.034)) return this.preSnapPenalty(call);
      switch (call.type) {
        case 'kneel': return this.kneel();
        case 'spike': return this.spike();
        case 'punt': return this.punt();
        case 'fg': return this.fieldGoal();
        case 'run': return this.finishPlay(this.runPlay());
        case 'pass': return this.finishPlay(this.passPlay(call.depth));
      }
    }

    preSnapPenalty(call) {
      const o = this.poss, d = 1 - o, rng = this.rng;
      const key = rng.wpick(['FS', 'OFFS', 'NZI', 'ENC', 'DOG'], [0.48, 0.2, 0.1, 0.07, 0.15]);
      const pn = PEN[key];
      const t = pn.side === 'O' ? o : d;
      const plyr = rng.pick(this.on(t, rng.pick(pn.pos)));
      let yds, text;
      if (pn.side === 'O') {
        yds = Math.min(pn.yds, Math.floor(this.ball / 2));
        this.ball -= yds; this.togo += yds;
        text = `PENALTY on ${this.abbr(t)}-${plyr.short}, ${pn.name}, ${yds} yards, enforced at ${this.spot(this.ball + yds, o)}. No Play.`;
      } else {
        yds = Math.min(pn.yds, Math.floor((100 - this.ball) / 2));
        this.ball += yds; this.togo -= yds;
        text = `PENALTY on ${this.abbr(t)}-${plyr.short}, ${pn.name}, ${yds} yards, enforced at ${this.spot(this.ball - yds, o)}. No Play.`;
        if (this.togo <= 0) { this.down = 1; this.togo = Math.min(10, 100 - this.ball); this.ts[o].fd++; text += ' First down.'; }
      }
      if (this.ball + this.togo > 100) this.togo = 100 - this.ball;
      this.ts[t].pen++; this.ts[t].peny += yds;
      this.drive.plays++;
      if (key === 'DOG' || pn.side === 'O') this.clockRunning = this.clockRunning && !(this.qtr === 2 && this.clock <= 120 || this.qtr >= 4 && this.clock <= 300);
      else this.clockRunning = false;
      return { kind: 'penalty', text, tags: ['FLAG'], banner: 'FLAG', flag: { abs: this.abs(this.ball, o), y: this.ballY, team: t, name: pn.name }, path: [] };
    }

    kneel() {
      const o = this.poss, qb = this.P(o, 'QB');
      const y = this.ball > 1 ? 1 : 0;
      const a = this.abs(this.ball, o), dr = this.dir(o);
      this.ball -= y; this.down++;
      this.tick(2, o); this.clockRunning = true;
      this.drive.plays++; this.drive.yds -= y;
      this.st(qb, 'ra', 1); this.st(qb, 'ry', -y); this.ts[o].ry -= y; this.ts[o].yds -= y; this.ts[o].ra++; this.ts[o].plays++;
      const text = `${qb.short} kneels to ${this.spot(this.ball, o)} for -${y} yard${y === 1 ? '' : 's'}.`;
      if (this.down > 4) { this.changePoss(100 - this.ball, 'Downs'); }
      return { kind: 'kneel', text, path: [{ x: a, y: this.ballY }, { x: a - dr * y, y: this.ballY, m: 'carry' }], tags: ['KNEEL'] };
    }
    spike() {
      const o = this.poss, qb = this.P(o, 'QB');
      this.tick(1, o); this.clockRunning = false; this.down++;
      this.st(qb, 'pa', 1); this.ts[o].pa++; this.ts[o].plays++; this.drive.plays++;
      const a = this.abs(this.ball, o);
      return { kind: 'spike', text: `${qb.short} spiked the ball to stop the clock.`, path: [{ x: a, y: this.ballY }, { x: a - this.dir(o) * 1, y: this.ballY + 1, m: 'air', h: 0 }], tags: ['SPIKE'] };
    }

    runPlay() {
      const o = this.poss, d = 1 - o, rng = this.rng;
      const r0 = rng.f();
      let car = r0 < 0.72 ? this.P(o, 'RB', 0) : r0 < 0.92 ? this.P(o, 'RB', 1) : r0 < 0.98 ? this.P(o, 'QB') : this.P(o, 'WR', 1);
      const qbRun = car.pos === 'QB', jet = car.pos === 'WR';
      const edge = ((this.R(o, 'rb') * 0.4 + this.R(o, 'ol') * 0.6) - this.R(d, 'runD')) / 10 + (car.r - 75) / 30;
      const lanes = jet ? [['left end', -13], ['right end', 13]] : [['left end', -12], ['left tackle', -5], ['left guard', -2.5], ['up the middle', 0], ['right guard', 2.5], ['right tackle', 5], ['right end', 12]];
      const lane = rng.pick(lanes);
      let y; const x = rng.f();
      if (x < 0.085 - edge * 0.01) y = -rng.int(1, 4);
      else if (x < 0.15 - edge * 0.01) y = 0;
      else {
        y = Math.round(rng.gauss(4.1 + edge * 0.5, 2.9)); if (y < 1) y = rng.int(1, 2);
        if (rng.chance(0.06 + edge * 0.006)) y += Math.round(rng.exp(14)) + 5;
      }
      if (this.ball >= 95 && y > 0 && rng.chance(0.35)) y = Math.max(0, y - rng.int(1, 3));
      const res = { kind: 'run', gain: y, desc: `${car.short} ${qbRun ? (rng.chance(0.5) ? 'scrambles' : 'keeps it') + ' ' + lane[0] : lane[0]}`, carrier: car, lane, stats: [], dur: rng.int(4, 7) };
      res.stats.push([car, 'ra', 1], [car, 'ry', y], [car, 'rlng', y, 'max']);
      res.oob = Math.abs(lane[1]) >= 10 ? rng.chance(0.35) : rng.chance(0.06);
      if (rng.chance(0.012)) {
        res.fumble = { by: car, lost: rng.chance(0.52), forcer: this.tackler(d, 'run') };
      }
      res.tackler = this.tackler(d, y > 12 ? 'deep' : 'run');
      // path
      const a = this.abs(this.ball, o), dr = this.dir(o), side = this.attackRight(o) ? 1 : -1;
      const ly = clamp(this.ballY + lane[1] * side * 0.9 + rng.gauss(0, 3), 1, 52.3);
      res.path = [{ x: a - dr * 1, y: this.ballY }, { x: a - dr * 4.5, y: this.ballY, m: 'carry' }, { x: a + dr * Math.min(1, y), y: clamp(this.ballY + lane[1] * side * 0.4, 1, 52), m: 'carry' }];
      res.endY = res.oob ? (ly < MID ? 0 : 53.3) : ly;
      return res;
    }

    passPlay(depth) {
      const o = this.poss, d = 1 - o, rng = this.rng;
      const qb = this.P(o, 'QB');
      const a = this.abs(this.ball, o), dr = this.dir(o), side = this.attackRight(o) ? 1 : -1;
      const res = { kind: 'pass', stats: [], dur: rng.int(5, 9) };
      res.path = [{ x: a - dr * 1, y: this.ballY }, { x: a - dr * 7, y: this.ballY + rng.gauss(0, 1), m: 'carry' }];
      const dropX = a - dr * 7;
      // sack / scramble
      const sackP = clamp(0.064 + (this.R(d, 'rush') - this.R(o, 'ol')) / 250 - (qb.r - 75) / 600 + (depth === 'deep' || depth === 'hail' ? 0.02 : 0), 0.025, 0.12);
      const r0 = rng.f();
      if (r0 < sackP) {
        const loss = clamp(Math.round(rng.gauss(7, 2.5)), 1, 15);
        const sacker = rng.chance(0.72) ? rng.pick(this.on(d, 'DL')) : rng.pick(this.on(d, 'LB'));
        res.kind = 'sack'; res.gain = -loss; res.sack = true; res.tackler = sacker;
        res.desc = `${qb.short} sacked at`;
        res.stats.push([qb, 'sk', 1], [qb, 'sky', loss], [sacker, 'sacks', 1], [sacker, 'tk', 1]);
        res.teamStats = [['sk', 1], ['sky', loss]];
        if (rng.chance(0.09)) res.fumble = { by: qb, lost: rng.chance(0.5), forcer: sacker };
        res.path.push({ x: a - dr * loss, y: this.ballY + rng.gauss(0, 2), m: 'carry' });
        res.endY = res.path[res.path.length - 1].y;
        res.noTackler = true;
        return res;
      }
      if (r0 < sackP + 0.035 && depth !== 'hail') {
        const y = clamp(Math.round(rng.gauss(5, 4)), -1, 25) + (rng.chance(0.08) ? Math.round(rng.exp(10)) : 0);
        res.kind = 'run'; res.gain = y; res.carrier = qb; res.scramble = true;
        res.desc = `${qb.short} scrambles ${rng.pick(['left end', 'right end', 'up the middle'])}`;
        res.stats.push([qb, 'ra', 1], [qb, 'ry', y], [qb, 'rlng', y, 'max']);
        res.oob = rng.chance(0.4);
        res.tackler = this.tackler(d, 'run');
        res.endY = res.oob ? (rng.chance(0.5) ? 0 : 53.3) : clamp(this.ballY + rng.gauss(0, 10), 2, 51);
        res.ignorePathEnd = true;
        return res;
      }
      res.attempt = true;
      // throwaway
      if (rng.chance(depth === 'hail' ? 0 : 0.035)) {
        res.incomplete = true; res.gain = 0; res.desc = `${qb.short} pass incomplete, thrown away`;
        res.stats.push([qb, 'pa', 1]);
        res.path.push({ x: dropX + dr * rng.int(5, 15), y: rng.chance(0.5) ? -1 : 54.3, m: 'air', h: 4 });
        return res;
      }
      // target
      const tPool = [[this.P(o, 'WR', 0), 0.26], [this.P(o, 'WR', 1), 0.2], [this.P(o, 'WR', 2), 0.13], [this.P(o, 'WR', 3), 0.03], [this.P(o, 'TE', 0), 0.17], [this.P(o, 'TE', 1), 0.03], [this.P(o, 'RB', 0), 0.13], [this.P(o, 'RB', 1), 0.05]];
      if (depth === 'deep' || depth === 'hail') { tPool[4][1] = 0.08; tPool[6][1] = 0.01; tPool[7][1] = 0; tPool[0][1] = 0.35; }
      const tgt = rng.wpick(tPool.map(x => x[0]), tPool.map(x => x[1]));
      let air;
      const toGoal = 100 - this.ball;
      if (depth === 'hail') air = toGoal + rng.int(0, 5);
      else if (depth === 'short') air = tgt.pos === 'RB' ? rng.int(-4, 3) : rng.int(-1, 9);
      else if (depth === 'med') air = rng.int(10, 19);
      else air = rng.int(20, 40);
      air = Math.min(air, toGoal + 9);
      const dirName = rng.pick(['left', 'middle', 'right']);
      const lateral = dirName === 'left' ? -1 : dirName === 'right' ? 1 : 0;
      const ty = clamp(this.ballY + lateral * side * rng.int(6, 20) + rng.gauss(0, 3), 1.5, 51.8);
      const depthName = depth === 'short' ? 'short' : 'deep';
      const edge = ((this.R(o, 'qb') * 0.6 + tgt.r * 0.4) - this.R(d, 'cov')) / 10;
      let comp = depth === 'short' ? 0.765 : depth === 'med' ? 0.56 : depth === 'deep' ? 0.36 : 0.06;
      if (air > toGoal - 3 && depth !== 'hail') comp -= 0.14; // tight red-zone windows
      comp += edge * 0.03;
      let intP = depth === 'short' ? 0.016 : depth === 'med' ? 0.03 : depth === 'deep' ? 0.05 : 0.2;
      intP -= edge * 0.004;
      res.target = tgt;
      res.stats.push([qb, 'pa', 1], [tgt, 'tgt', 1]);
      const catchX = a + dr * Math.min(air, toGoal + 9);
      const x = rng.f();
      const peak = depth === 'short' ? 2.5 : depth === 'med' ? 5 : 10;
      if (x < intP) {
        const picker = rng.wpick([rng.pick(this.on(d, 'CB')), rng.pick(this.on(d, 'S')), rng.pick(this.on(d, 'LB'))], [0.55, 0.35, 0.1]);
        res.int = { by: picker, air };
        res.desc = `${qb.short} pass ${depthName} ${dirName} intended for ${tgt.short} INTERCEPTED by ${picker.short}`;
        res.path.push({ x: catchX, y: ty, m: 'air', h: peak });
        res.stats.push([qb, 'pint', 1], [picker, 'ints', 1]);
        return res;
      }
      if (x < intP + comp) {
        let yac;
        if (depth === 'short') yac = air <= 0 ? Math.round(rng.exp(4.6)) + rng.int(0, 2) : Math.round(rng.exp(3.1));
        else if (depth === 'med') yac = Math.round(rng.exp(2.6));
        else yac = Math.round(rng.exp(4));
        if (rng.chance(0.04)) yac += Math.round(rng.exp(15));
        let gain = air + yac;
        res.complete = true; res.gain = gain; res.air = air;
        res.desc = `${qb.short} pass ${depthName} ${dirName} to ${tgt.short}`;
        res.stats.push([qb, 'pc', 1], [qb, 'py', gain], [tgt, 'rec', 1], [tgt, 'recy', gain], [tgt, 'reclng', gain, 'max']);
        res.carrier = tgt;
        res.oob = rng.chance(this.hurry(o) ? 0.4 : 0.18);
        res.tackler = this.tackler(d, air >= 15 ? 'deep' : 'pass');
        if (rng.chance(0.007)) res.fumble = { by: tgt, lost: rng.chance(0.55), forcer: res.tackler };
        res.path.push({ x: catchX, y: ty, m: 'air', h: peak });
        res.endY = res.oob ? (ty < MID ? 0 : 53.3) : clamp(ty + rng.gauss(0, 5), 1, 52.3);
        return res;
      }
      // incomplete (maybe DPI)
      res.incomplete = true; res.gain = 0;
      const defender = rng.pick(this.on(d, rng.chance(0.7) ? 'CB' : 'S'));
      res.desc = `${qb.short} pass incomplete ${depthName} ${dirName} to ${tgt.short}${rng.chance(0.35) ? ' (' + defender.short + ')' : ''}`;
      if (rng.chance(0.09)) res.stats.push([defender, 'pd', 1]);
      res.path.push({ x: catchX + dr * rng.int(1, 4), y: clamp(ty + rng.gauss(0, 3), -1, 54), m: 'air', h: peak });
      if ((depth === 'deep' && rng.chance(0.07)) || (depth === 'med' && rng.chance(0.025)) || (depth === 'hail' && rng.chance(0.03))) {
        res.dpi = { by: defender, air };
      }
      return res;
    }

    // resolve a run/pass result, penalties, scores, possession
    finishPlay(res) { const o = this.poss; const ev = this._finishPlay(res); if (!this.over) this.injuryCheck(ev, res, o); return ev; }
    _finishPlay(res) {
      const o = this.poss, d = 1 - o, rng = this.rng;
      const startBall = this.ball, startDown = this.down, startTogo = this.togo;
      const los = this.abs(startBall, o), dr = this.dir(o);
      const ev = { kind: res.kind, tags: [], path: res.path || [] };
      const stats = res.stats;
      let gain = res.gain || 0;
      if (startBall + gain >= 100) { const g0 = gain; gain = 100 - startBall; for (const s of res.stats) if (s[2] === g0 && ['ry', 'py', 'recy', 'rlng', 'reclng'].includes(s[1])) s[2] = gain; }
      this.ts[o].plays++; this.drive.plays++;
      if (startDown === 3) this.ts[o].d3a++;
      if (startDown === 4) this.ts[o].d4a++;
      this.tick(res.dur, o);

      // ---- penalty during play?
      let pen = null;
      if (res.dpi) pen = { key: 'DPI', air: res.dpi.air, by: res.dpi.by };
      else if (rng.chance(res.kind === 'run' ? 0.042 : 0.058)) {
        const keys = res.kind === 'run' ? ['OH', 'IBB', 'FM', 'UR', 'UNS', 'DH'] : ['OH', 'DH', 'RTP', 'IUH', 'ICT', 'OPI', 'UR', 'FM', 'DPI'];
        const w = res.kind === 'run' ? [0.5, 0.14, 0.12, 0.12, 0.05, 0.07] : [0.32, 0.17, 0.08, 0.1, 0.06, 0.06, 0.04, 0.03, 0.14];
        let key = rng.wpick(keys, w);
        if (key === 'IG') key = 'OH';
        if ((key === 'OPI' || key === 'DPI' || key === 'ICT') && !res.attempt) key = 'OH';
        if (key === 'RTP' && res.sack) key = 'FM';
        pen = { key };
        if (key === 'DPI') pen.air = Math.max(1, res.air != null ? res.air : rng.int(8, 30));
      }

      // ---- touchdown / safety / turnover determination for the raw play
      const turnover = !!res.int || (res.fumble && res.fumble.lost);
      let accepted = false, penText = '', penInfo = null;
      if (pen) {
        const P = PEN[pen.key];
        const pt = P.side === 'O' ? o : d;
        const plyr = pen.by || rng.pick(this.on(pt, rng.pick(P.pos)));
        penInfo = { P, pt, plyr };
        // decide acceptance
        if (P.side === 'O') {
          accepted = true;
          if (turnover) accepted = false;
          else if (gain < 0 && -gain >= P.yds - 2) accepted = false;
          else if (res.incomplete && startDown === 3) accepted = false;
          else if (res.incomplete && startDown === 4) accepted = false;
        } else {
          accepted = true;
          if (!turnover && !P.add) {
            const raw = gain;
            let penYds = P.spot ? pen.air : P.yds;
            if (startBall + gain >= 100) accepted = false;
            else if (raw >= penYds && (raw >= startTogo || !P.auto)) accepted = false;
          }
        }
      }

      const baseText = (y, resultSpot) => {
        if (res.sack) return `${res.desc} ${this.spot(startBall + y, o)} for ${y} yards (${res.tackler.short}).`;
        if (res.incomplete) return `${res.desc}.`;
        if (res.int) return `${res.desc}`;
        const tk = (res.oob ? 'ran ob' : null);
        return `${res.desc} to ${this.spot(startBall + y, o)} for ${y === 0 ? 'no gain' : y + ' yard' + (Math.abs(y) === 1 ? '' : 's')}${tk ? ', ' + tk : ' (' + res.tackler.short + ')'}.`;
      };

      // apply stat lines helper
      const applyStats = () => {
        for (const s of stats) { if (s[3] === 'max') this.stMax(s[0], s[1], s[2]); else this.st(s[0], s[1], s[2]); }
        if (res.tackler && !res.incomplete && !res.int && !res.noTackler && !res.oob) this.st(res.tackler, 'tk', 1);
        if (res.kind === 'run' || res.scramble) { this.ts[o].ra++; this.ts[o].ry += gain; this.ts[o].yds += gain; }
        if (res.attempt) { this.ts[o].pa++; if (res.complete) { this.ts[o].pc++; this.ts[o].py += gain; this.ts[o].yds += gain; } }
        if (res.sack) { this.ts[o].sk++; this.ts[o].sky -= gain; this.ts[o].yds += gain; }
        this.drive.yds += gain;
      };

      // ---------- Penalty accepted that replaces play
      if (pen && accepted && (!PEN[pen.key].add || turnover)) {
        const { P, pt, plyr } = penInfo;
        let yds, newBall;
        if (P.side === 'O') {
          yds = Math.min(P.yds, Math.floor(startBall / 2));
          newBall = startBall - yds;
          this.ball = newBall; this.togo = startTogo + yds;
          if (pen.key === 'IG') { this.down++; }
        } else {
          if (P.spot) { newBall = Math.min(99, startBall + pen.air); yds = newBall - startBall; }
          else { yds = Math.min(P.yds, Math.floor((100 - startBall) / 2)); newBall = startBall + yds; }
          this.ball = newBall;
          if (P.auto || yds >= startTogo) { this.down = 1; this.togo = Math.min(10, 100 - newBall); this.ts[o].fd++; }
          else this.togo = startTogo - yds;
        }
        if (this.ball + this.togo > 100) this.togo = 100 - this.ball;
        this.ts[pt].pen++; this.ts[pt].peny += yds;
        if (res.attempt) { this.st(this.P(o, 'QB'), 'pa', 0); }
        penText = `PENALTY on ${this.abbr(pt)}-${plyr.short}, ${P.name}, ${yds} yards, enforced at ${this.spot(startBall, o)}.`;
        ev.text = `${res.desc}${res.kind === 'run' || res.complete ? ' for ' + gain + ' yards' : ''}. ${penText} NULLIFIED Play.`.replace('..', '.');
        if (P.side === 'D' && (P.auto || yds >= startTogo)) ev.text += ' Automatic first down.';
        ev.tags.push('FLAG'); ev.banner = 'FLAG';
        ev.flag = { abs: this.abs(P.side === 'O' ? startBall : startBall + (P.spot ? pen.air : 0), o), y: this.ballY, team: pt, name: P.name };
        this.clockRunning = false;
        this.ballY = clamp(this.ballY, HASH_L, HASH_R);
        if (res.kind === 'run') ev.path = ev.path.concat([{ x: los + dr * gain, y: res.endY != null ? res.endY : this.ballY, m: 'carry' }]);
        return ev;
      }

      // ---------- Play stands
      applyStats();
      let endBall = startBall + gain;
      let text = '';
      // turnovers
      if (res.int) {
        const iAt = startBall + res.int.air; // offense coords
        let defBall = 100 - Math.min(iAt, 100 + 5);
        text = baseText(gain) + ' at ' + (iAt >= 100 ? 'the ' + this.abbr(d) + ' end zone' : this.spot(iAt, o)) + '.';
        this.ts[o].to++;
        this.endDrive('Interception');
        let ret = rng.chance(0.35) ? 0 : Math.round(rng.exp(9));
        if (iAt >= 100 && rng.chance(0.55)) { ret = 0; defBall = 20; text += ' Touchback.'; }
        else if (rng.chance(0.03)) ret = 100 - defBall; // pick six
        let endD = defBall + ret;
        ev.path.push({ x: this.abs(100 - Math.min(endD, 105), o), y: clamp(this.ballY + rng.gauss(0, 10), 1, 52), m: 'carry' });
        this.st(res.int.by, 'intyds', ret);
        ev.tags.push('TO'); ev.banner = 'INTERCEPTED';
        if (endD >= 100) {
          text += ` ${res.int.by.short} returns it ${ret} yards for a TOUCHDOWN! PICK SIX!`;
          this.st(res.int.by, 'deftd', 1);
          this.poss = d; this.addScore(d, 6); this.phase = 'pat'; this.clockRunning = false; ev.tags.push('TD'); ev.banner = 'PICK SIX'; ev.scoring = d;
          this.ball = 85; if (this.qtr >= 5) { this.otPoss[d] = true; if (this.otPoss[o] && this.lead(d) > 0) this.finish(); }
        } else {
          if (ret > 0 && !(iAt >= 100 && defBall === 20)) text += ` ${res.int.by.short} returns to the ${this.spot(endD, d)} for ${ret} yard${ret === 1 ? '' : 's'}.`;
          this.poss = d; this.ball = clamp(endD, 1, 99); this.down = 1; this.togo = Math.min(10, 100 - this.ball); this.clockRunning = false; this.phase = 'play';
          if (!this.otCheck()) this.startDrive();
        }
        ev.text = text + this.addPenText(pen, accepted, penInfo, ev);
        return ev;
      }
      if (res.fumble) {
        const f = res.fumble;
        if (endBall >= 100) endBall = 99;
        if (endBall <= 0) endBall = 1;
        text = baseText(gain).replace(/\.$/, '') + `. ${f.by.short} FUMBLES (${f.forcer.short})`;
        this.st(f.by, 'fum', 1); this.st(f.forcer, 'ff', 1);
        ev.path.push({ x: this.abs(endBall, o), y: res.endY != null ? clamp(res.endY, 1, 52) : this.ballY, m: 'carry' });
        if (f.lost) {
          const rec = rng.pick(this.on(d, rng.pick(['DL', 'LB', 'CB', 'S'])));
          this.st(rec, 'fr', 1);
          this.ts[o].to++;
          ev.tags.push('TO'); ev.banner = 'FUMBLE';
          this.endDrive('Fumble');
          if (rng.chance(0.04)) {
            text += `, RECOVERED by ${this.abbr(d)}-${rec.short} and returned ${endBall} yards for a TOUCHDOWN!`;
            ev.path.push({ x: this.abs(-3, o), y: clamp(this.ballY + rng.gauss(0, 8), 2, 51), m: 'carry' });
            this.poss = d; this.addScore(d, 6); this.phase = 'pat'; this.clockRunning = false; ev.tags.push('TD'); ev.scoring = d; this.ball = 85;
            if (this.qtr >= 5) { this.otPoss[d] = true; if (this.otPoss[o] && this.lead(d) > 0) this.finish(); }
          } else {
            text += `, RECOVERED by ${this.abbr(d)}-${rec.short} at ${this.spot(endBall, o)}.`;
            this.poss = d; this.ball = 100 - endBall; this.down = 1; this.togo = Math.min(10, 100 - this.ball); this.clockRunning = false; this.phase = 'play';
            if (!this.otCheck()) this.startDrive();
          }
          ev.text = text + this.addPenText(pen, accepted, penInfo, ev);
          return ev;
        }
        text += `, recovered by ${this.abbr(o)}-${f.by.short}.`;
        gain = endBall - startBall;
      } else {
        text = baseText(gain);
      }
      if (res.kind !== 'pass' || res.complete || res.sack) {
        const ey = res.endY != null ? res.endY : this.ballY;
        ev.path.push({ x: this.abs(Math.min(endBall, 100) + (endBall >= 100 ? 3 : 0), o), y: clamp(ey, 0, 53.3), m: 'carry' });
      }
      // added personal-foul penalty enforced from end of play
      let addYds = 0;
      if (pen && accepted && PEN[pen.key].add && endBall < 100 && endBall > 0) {
        const { P, pt, plyr } = penInfo;
        addYds = Math.min(15, Math.floor((100 - endBall) / 2));
        this.ts[pt].pen++; this.ts[pt].peny += addYds;
        text += ` PENALTY on ${this.abbr(pt)}-${plyr.short}, ${P.name}, ${addYds} yards, enforced at ${this.spot(endBall, o)}.`;
        ev.tags.push('FLAG'); ev.banner = 'FLAG'; ev.flag = { abs: this.abs(endBall, o), y: this.ballY, team: pt, name: P.name };
      } else if (pen) {
        text += this.addPenText(pen, accepted, penInfo, ev);
      }
      // touchdown
      if (endBall >= 100) {
        const scorer = res.carrier || res.target;
        if (res.complete) { this.st(res.target, 'rectd', 1); this.st(this.P(o, 'QB'), 'ptd', 1); }
        else if (scorer) this.st(scorer, 'rtd', 1);
        text = text.replace(/ to [A-Z]{3} \d+ for /, ' for ').replace(/ \([^)]*\)\.$/, '.').replace(/, ran ob\.$/, '.') ;
        text = text.replace(/\.$/, '') + ', TOUCHDOWN!';
        if (res.complete && this.down === 1) {}
        this.ts[o].fd++;
        this.addScore(o, 6); this.endDrive('Touchdown'); this.phase = 'pat'; this.clockRunning = false;
        ev.tags.push('TD'); ev.banner = 'TOUCHDOWN'; ev.scoring = o;
        if (startDown === 3) this.ts[o].d3c++; if (startDown === 4) this.ts[o].d4c++;
        this.ball = 85;
        if (this.qtr >= 5 && this.otPoss[d] && this.lead(o) > 0) this.finish();
        ev.text = text;
        return ev;
      }
      // safety
      if (endBall <= 0) {
        text = text.replace(/ to [A-Z]{3} -?\d+ for/, ' in the end zone for').replace(/\.$/, '') + '. SAFETY.';
        this.addScore(d, 2); this.endDrive('Safety'); this.kicker = o; this.phase = 'freekick'; this.clockRunning = false;
        ev.tags.push('SAFETY'); ev.banner = 'SAFETY'; ev.scoring = d;
        if (this.qtr >= 5) this.finish();
        ev.text = text;
        return ev;
      }
      // normal advance
      endBall += addYds;
      this.ball = endBall;
      const madeFD = endBall - startBall >= startTogo || addYds > 0;
      if (madeFD) {
        this.down = 1; this.togo = Math.min(10, 100 - endBall); this.ts[o].fd++;
        if (startDown === 3) this.ts[o].d3c++; if (startDown === 4) this.ts[o].d4c++;
      } else {
        this.down = startDown + 1; this.togo = startTogo - (endBall - startBall);
      }
      // ball spot laterally
      const ey = res.endY != null ? res.endY : this.ballY;
      if (!res.incomplete) this.ballY = clamp(ey, HASH_L, HASH_R);
      // clock
      if (res.incomplete) this.clockRunning = false;
      else if (pen) this.clockRunning = false;
      else if (res.oob) { this.clockRunning = true; this.clockStops(true); }
      else this.clockRunning = true;
      if (this.down > 4) {
        text += ' Turnover on downs.';
        ev.tags.push('DOWNS'); ev.banner = 'TURNOVER ON DOWNS';
        this.changePoss(100 - this.ball, 'Downs');
      }
      ev.text = text;
      return ev;
    }
    addPenText(pen, accepted, info, ev) {
      if (!pen || !info) return '';
      const { P, pt, plyr } = info;
      ev.tags.push('FLAG'); ev.flag = ev.flag || { abs: this.abs(this.ball, this.poss), y: this.ballY, team: pt, name: P.name };
      return ` PENALTY on ${this.abbr(pt)}-${plyr.short}, ${P.name}, ${accepted ? 'enforced on the kickoff' : 'declined'}.`;
    }

    punt() {
      const o = this.poss, d = 1 - o, rng = this.rng;
      const p = this.P(o, 'P');
      const start = this.ball;
      const a = this.abs(start, o), dr = this.dir(o);
      const path = [{ x: a, y: this.ballY }, { x: a - dr * 14, y: this.ballY, m: 'air', h: 0.5 }];
      this.ts[o].plays++; this.drive.plays++;
      if (this.down === 4) this.ts[o].d4a += 0; // punts aren't attempts
      this.tick(rng.int(6, 10), o);
      this.st(p, 'pn', 1);
      if (rng.chance(0.004)) {
        const blk = rng.pick(this.on(d, 'LB'));
        const at = Math.max(1, start - 10);
        path.push({ x: this.abs(at, o), y: this.ballY + rng.gauss(0, 4), m: 'carry' });
        this.ts[o].to++;
        this.changePoss(100 - at, 'Blocked Punt');
        return { kind: 'punt', text: `${p.short} punt is BLOCKED by ${blk.short}, recovered by ${this.abbr(d)} at ${this.spot(at, o)}.`, path, tags: ['TO'], banner: 'BLOCKED PUNT' };
      }
      let gross = Math.round(clamp(rng.gauss(47 + (p.r - 75) / 4, 5.5), 28, 72));
      const toGoal = 100 - start;
      let pin = false;
      if (start >= 52) {
        if (rng.chance(0.75)) { const target = toGoal - rng.int(3, 15); gross = Math.max(20, Math.min(gross, target)); pin = true; }
      }
      const land = start + gross;
      path.push({ x: this.abs(Math.min(land, 105), o), y: clamp(this.ballY + rng.gauss(0, 8), 3, 50), m: 'kick', h: 20 });
      let text = `${p.short} punts ${gross} yards to ${land >= 100 ? 'the end zone' : this.spot(land, o)}`;
      this.st(p, 'pny', gross);
      if (land >= 100) {
        this.st(p, 'pny', 0);
        this.changePoss(20, 'Punt');
        return { kind: 'punt', text: text + ', Touchback.', path, tags: [] };
      }
      const rcvr = this.P(d, 'WR', rng.chance(0.6) ? 2 : 1) || this.P(d, 'CB');
      const r = rng.f();
      let endO = land; // offense coords
      let tags = [];
      if (pin || r < 0.42) {
        const how = pin ? rng.pick(['fair catch by ' + rcvr.short, 'downed by ' + this.abbr(o) + '-' + rng.pick(this.on(o, 'LB')).short, 'out of bounds']) : 'fair catch by ' + rcvr.short;
        text += `, ${how}.`;
        if (rng.chance(0.007)) {
          // muffed fair catch -> kicking team recovers
          text = text.replace(/\.$/, '') + `. MUFFED by ${rcvr.short}, RECOVERED by ${this.abbr(o)}!`;
          this.ts[d].to++;
          this.endDrive(null);
          this.ball = land; this.down = 1; this.togo = Math.min(10, 100 - land); this.clockRunning = false; this.startDrive();
          return { kind: 'punt', text, path, tags: ['TO'], banner: 'MUFFED PUNT' };
        }
      } else if (r < 0.48) {
        text += ', out of bounds.';
      } else {
        let ret = Math.round(rng.gauss(8.5, 6)); if (ret < 0) ret = rng.int(-2, 0);
        if (rng.chance(0.04)) ret += Math.round(rng.exp(20));
        const rcvBall = 100 - land; // receiving coords
        const tk = this.tackler(o, 'deep');
        this.st(rcvr, 'pr', 1);
        if (rcvBall + ret >= 100) {
          this.st(rcvr, 'pry', 100 - rcvBall); this.st(rcvr, 'prtd', 1);
          path.push({ x: this.abs(105, d), y: clamp(this.ballY + rng.gauss(0, 10), 2, 51), m: 'carry' });
          text += `. ${rcvr.short} returns it ${100 - rcvBall} yards for a TOUCHDOWN!`;
          this.endDrive('Punt');
          this.poss = d; this.addScore(d, 6); this.phase = 'pat'; this.clockRunning = false; this.ball = 85;
          if (this.qtr >= 5) { this.otPoss[d] = true; if (this.otPoss[o] && this.lead(d) > 0) this.finish(); }
          return { kind: 'punt', text, path, tags: ['TD'], banner: 'PUNT RETURN TD', scoring: d };
        }
        this.st(rcvr, 'pry', ret);
        endO = land - ret;
        text += `. ${rcvr.short} returns to the ${this.spot(endO, o)} for ${ret} yards (${tk.short}).`;
        this.st(tk, 'tk', 1);
        if (rng.chance(0.007)) {
          text += ` ${rcvr.short} FUMBLES, recovered by ${this.abbr(o)}!`;
          this.ts[d].to++;
          path.push({ x: this.abs(endO, o), y: clamp(this.ballY + rng.gauss(0, 6), 2, 51), m: 'carry' });
          this.endDrive(null);
          this.ball = clamp(endO, 1, 99); this.down = 1; this.togo = Math.min(10, 100 - this.ball); this.clockRunning = false; this.startDrive();
          return { kind: 'punt', text, path, tags: ['TO'], banner: 'FUMBLE' };
        }
        if (rng.chance(0.06)) {
          const yds = Math.min(10, Math.floor((100 - endO) / 2));
          const pl = rng.pick(this.on(d, rng.pick(['LB', 'S', 'CB'])));
          text += ` PENALTY on ${this.abbr(d)}-${pl.short}, ${rng.pick(['Offensive Holding', 'Illegal Block Above the Waist'])}, ${yds} yards.`;
          this.ts[d].pen++; this.ts[d].peny += yds; tags.push('FLAG');
          path.push({ x: this.abs(endO, o), y: clamp(this.ballY + rng.gauss(0, 6), 2, 51), m: 'carry' });
          endO += yds;
          const ev = { kind: 'punt', text, path, tags, banner: 'FLAG', flag: { abs: this.abs(endO - yds, o), y: this.ballY } };
          this.changePoss(100 - endO, 'Punt');
          return ev;
        }
        path.push({ x: this.abs(endO, o), y: clamp(this.ballY + rng.gauss(0, 6), 2, 51), m: 'carry' });
      }
      this.ballY = clamp(path[path.length - 1].y, HASH_L, HASH_R);
      this.changePoss(100 - endO, 'Punt');
      return { kind: 'punt', text, path, tags };
    }

    fieldGoal() {
      const o = this.poss, d = 1 - o, rng = this.rng;
      const k = this.P(o, 'K');
      const dist = 117 - this.ball;
      const a = this.abs(this.ball, o), dr = this.dir(o);
      this.ts[o].plays++; this.drive.plays++;
      this.tick(rng.int(4, 6), o);
      this.st(k, 'fga', 1);
      const path = [{ x: a, y: this.ballY }, { x: a - dr * 7, y: this.ballY, m: 'air', h: 0.3 }];
      if (rng.chance(0.012)) {
        path.push({ x: a - dr * 5, y: this.ballY + rng.gauss(0, 3), m: 'carry' });
        const at = this.ball - 7;
        this.changePoss(100 - at, 'Blocked FG');
        return { kind: 'fg', text: `${k.short} ${dist} yard field goal is BLOCKED.`, path, tags: ['TO'], banner: 'BLOCKED' };
      }
      const ok = rng.chance(this.fgProb(o, dist));
      const miss = ok ? 0 : (rng.chance(0.5) ? 1 : -1) * (rng.chance(0.15) ? 0 : rng.int(4, 9));
      const gy = MID + (ok ? rng.gauss(0, 1.2) : miss);
      path.push({ x: this.abs(110, o), y: gy, m: 'kick', h: 14 });
      if (ok) {
        this.st(k, 'fgm', 1); this.stMax(k, 'fglng', dist);
        this.addScore(o, 3); this.endDrive('Field Goal');
        this.kicker = o; this.phase = 'kickoff'; this.clockRunning = false;
        const ev = { kind: 'fg', text: `${k.short} ${dist} yard field goal is GOOD.`, path, tags: ['FG'], banner: 'FIELD GOAL', scoring: o };
        if (this.qtr >= 5) this.otCheck();
        return ev;
      }
      const how = miss === 0 ? 'short' : (miss > 0) === this.attackRight(o) ? 'wide right' : 'wide left';
      const newBall = Math.max(20, 100 - (this.ball - 7));
      this.changePoss(newBall, 'Missed FG');
      return { kind: 'fg', text: `${k.short} ${dist} yard field goal is NO GOOD, ${how}.`, path, tags: ['MISS'], banner: 'NO GOOD' };
    }

    // ---------- result summary (for seasons)
    summary() {
      const box = {};
      for (const t of [0, 1]) for (const p of this.teams[t].players) if (this.ps[p.id]) box[p.id] = this.ps[p.id];
      const injuries = this.injuries.map(x => Object.assign({}, x));
      return { home: this.teams[0].id, away: this.teams[1].id, seed: this.seed, score: this.score.slice(), qs: this.qs, ot: this.qtr >= 5, ts: this.ts, ps: box, playoff: this.playoff, injuries };
    }
  }

  function simulateGame(homeId, awayId, seed, opts) {
    const g = new Game(homeId, awayId, Object.assign({ seed }, opts || {}));
    g.simulate();
    return g;
  }

  // ---------------------------------------------------------------- Season
  // Current alignment (from Season 2): three divisions of four.
  const DIVISIONS = [{ id: 'West', name: 'IFL West' }, { id: 'Central', name: 'IFL Central' }, { id: 'East', name: 'IFL East' }];
  DIVISIONS.forEach(d => d.teams = LEAGUE.filter(t => t.div === d.id).map(t => t.id));
  // Season 1's alignment (the original eight teams), kept so that season always shows and seeds as it was played.
  const ORIGINAL8 = ['MIS', 'LAI', 'GHB', 'PAR', 'DEN', 'KYL', 'ASH', 'ARG'];
  const LEGACY_DIVISIONS = [{ id: 'West', name: 'IFL West', teams: ['MIS', 'LAI', 'ASH', 'ARG'] }, { id: 'East', name: 'IFL East', teams: ['GHB', 'PAR', 'DEN', 'KYL'] }];
  // The divisions for a season, worked out from which teams play in it.
  function divisionsFor(ids) {
    const set = new Set(ids);
    if (set.size === 8 && ORIGINAL8.every(id => set.has(id))) return LEGACY_DIVISIONS;
    return DIVISIONS.map(d => ({ id: d.id, name: d.name, teams: d.teams.filter(id => set.has(id)) })).filter(d => d.teams.length);
  }
  const divName = id => (DIVISIONS.find(d => d.id === id) || LEGACY_DIVISIONS.find(d => d.id === id) || {}).name || id;
  // Circle-method round robin; an odd number of teams gives one bye per round.
  function rrRounds(D) {
    const n0 = D.length, a = n0 % 2 ? D.concat([null]) : D.slice(), n = a.length, rounds = [];
    let list = a.slice();
    for (let r = 0; r < n - 1; r++) {
      const games = []; let bye = null;
      for (let i = 0; i < n / 2; i++) {
        const x = list[i], y = list[n - 1 - i];
        if (x == null) bye = y; else if (y == null) bye = x; else games.push((r + i) % 2 ? [y, x] : [x, y]);
      }
      rounds.push({ games, bye });
      list = [list[0]].concat([list[n - 1]], list.slice(1, n - 1));
    }
    return rounds;
  }
  function makeSchedule(ids, seed) {
    const divs = divisionsFor(ids), sizes = divs.map(d => d.teams.length).join(',');
    if (sizes === '4,4') return schedule44(divs[0].teams, divs[1].teams, seed);
    if (sizes === '5,5') return schedule55(divs[0].teams, divs[1].teams, seed);
    if (sizes === '4,4,4') return schedule444(divs.map(d => d.teams), seed);
    return scheduleRR(ids, seed);
  }
  // Split a regular graph into perfect matchings (one per week) by randomized search with restarts.
  function factorize(verts, edges, k, rng) {
    const adj = {}; verts.forEach(v => adj[v] = new Set());
    edges.forEach(([a, b]) => { adj[a].add(b); adj[b].add(a); });
    const weeks = [];
    for (let w = 0; w < k; w++) {
      const pairs = [];
      const solve = left => {
        if (!left.length) return true;
        let v = left[0], best = Infinity;
        for (const x of left) { const n = [...adj[x]].filter(y => left.includes(y)).length; if (n < best) { best = n; v = x; } }
        const opts = [...adj[v]].filter(y => left.includes(y));
        for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(rng.f() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
        for (const u of opts) { pairs.push([v, u]); if (solve(left.filter(x => x !== v && x !== u))) return true; pairs.pop(); }
        return false;
      };
      if (!solve(verts.slice())) return null;
      pairs.forEach(([a, b]) => { adj[a].delete(b); adj[b].delete(a); });
      weeks.push(pairs);
    }
    return weeks;
  }
  // 14-week schedule for three divisions of four: division rivals home and away (6 games) + the 8 teams in the
  // other two divisions once (8 games). Every team plays exactly once a week and gets 7 home games.
  function schedule444(D3, seed) {
    const rng = makeRng('sched:' + seed);
    const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng.f() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const Ds = D3.map(d => shuffle(d)), rr = Ds.map(d => rrRounds(d));
    const divWeeks = [];
    for (let half = 0; half < 2; half++) for (let r = 0; r < 3; r++) divWeeks.push(rr.flatMap(R => R[r].games.map(([h, a]) => half ? { home: a, away: h } : { home: h, away: a })));
    const all = Ds.flat(), divOf = {}; Ds.forEach((d, i) => d.forEach(t => divOf[t] = i));
    const cross = []; for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (divOf[all[i]] !== divOf[all[j]]) cross.push([all[i], all[j]]);
    let cw = null;
    for (let attempt = 0; attempt < 400 && !cw; attempt++) cw = factorize(all, cross, 8, rng);
    if (!cw) return scheduleRR(all, seed);
    // home/away for cross games: walk Euler circuits of the cross graph so every team is home exactly 4 times
    const adj = {}; all.forEach(v => adj[v] = []);
    cross.forEach(([a, b], e) => { adj[a].push([b, e]); adj[b].push([a, e]); });
    const used = new Array(cross.length).fill(false), homeOf = {}, ptr = {};
    for (const start of all) {
      const stack = [start];
      while (stack.length) {
        const v = stack[stack.length - 1];
        let moved = false;
        while ((ptr[v] || 0) < adj[v].length) {
          const [u, e] = adj[v][ptr[v] || 0]; ptr[v] = (ptr[v] || 0) + 1;
          if (!used[e]) { used[e] = true; homeOf[[cross[e][0], cross[e][1]].sort().join('|')] = v; stack.push(u); moved = true; break; }
        }
        if (!moved) stack.pop();
      }
    }
    const crossWeeks = cw.map(pairs => pairs.map(([a, b]) => { const h = homeOf[[a, b].sort().join('|')]; return { home: h, away: h === a ? b : a }; }));
    const D = divWeeks, C = crossWeeks;
    const order = [D[0], C[0], D[1], C[1], C[2], D[2], C[3], C[4], D[3], C[5], C[6], D[4], C[7], D[5]];
    return numberWeeks(order, seed, shuffle);
  }
  function numberWeeks(weeks, seed, shuffle) {
    return weeks.map((wk, i) => shuffle(wk).map((g, j) => Object.assign(g, { week: i + 1, gid: `W${i + 1}G${j + 1}`, seed: seed + '-W' + (i + 1) + '-' + (j + 1) })));
  }
  // 13-week schedule for two divisions of five: division rivals home and away (8 games) + every team in the
  // other division once (5 games). Every team plays exactly once per week.
  function schedule55(Wt, Et, seed) {
    const rng = makeRng('sched:' + seed);
    const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng.f() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const W = shuffle(Wt), E = shuffle(Et), RW = rrRounds(W), RE = rrRounds(E);
    const eRound = id => RE.find(x => x.bye === id);
    const g2 = (h, a) => ({ home: h, away: a });
    // division weeks: each division plays two games; the two teams with a bye play each other (cross-division)
    const first = RW.map(rw => { const i = W.indexOf(rw.bye), re = eRound(E[i]); return { div: rw.games.concat(re.games).map(([h, a]) => g2(h, a)), cross: [W[i], E[i]] }; });
    const second = RW.map(rw => { const i = W.indexOf(rw.bye), j = (i + 1) % 5, re = eRound(E[j]); return { div: rw.games.concat(re.games).map(([h, a]) => g2(a, h)), cross: [W[i], E[j]] }; });
    // the other 15 cross-division pairings form three full weeks
    const crossWeek = k => W.map((w, i) => ({ cross: [w, E[(i + k) % 5]] }));
    const order = [first[0], first[1], { all: crossWeek(2) }, first[2], first[3], { all: crossWeek(3) }, first[4], second[0], { all: crossWeek(4) }, second[1], second[2], second[3], second[4]];
    // home/away for cross games: a checkerboard over the two divisions, so every team gets 2 or 3 cross-division
    // home games (6 or 7 home games in all, since division games are always 4 home / 4 away)
    const weeks = order.map(w => {
      const games = (w.div || []).slice();
      const crosses = w.all ? w.all.map(x => x.cross) : [w.cross];
      for (const [a, b] of crosses) games.push((W.indexOf(a) + E.indexOf(b)) % 2 === 0 ? g2(a, b) : g2(b, a));
      return games;
    });
    return numberWeeks(weeks, seed, shuffle);
  }
  // fallback for any other league size: everyone plays everyone once
  function scheduleRR(ids, seed) {
    const rng = makeRng('sched:' + seed);
    const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng.f() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    return numberWeeks(rrRounds(shuffle(ids)).map(r => r.games.map(([h, a]) => ({ home: h, away: a }))), seed, shuffle);
  }
  // 10-week schedule: division rivals home and away (6 games) + every team in the other division once (4 games).
  function schedule44(Wt, Et, seed) {
    const rng = makeRng('sched:' + seed);
    const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng.f() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const W = shuffle(Wt), E = shuffle(Et);
    // round robin of 4: rounds (0v3,1v2) (0v2,3v1) (0v1,2v3)
    const rr = [[[0, 3], [1, 2]], [[2, 0], [3, 1]], [[0, 1], [2, 3]]];
    const divRound = (r, flip) => [W, E].flatMap(D => rr[r].map(([a, b]) => flip ? { home: D[b], away: D[a] } : { home: D[a], away: D[b] }));
    const crossRound = r => W.map((w, i) => { const e = E[(i + r) % 4]; return r % 2 === 0 ? { home: w, away: e } : { home: e, away: w }; });
    const flips = shuffle([0, 1, 2]);
    const weeks = [divRound(flips[0], false), divRound(flips[1], false), crossRound(0), divRound(flips[2], false), crossRound(1), crossRound(2),
      divRound(flips[0], true), crossRound(3), divRound(flips[1], true), divRound(flips[2], true)];
    return weeks.map((wk, i) => shuffle(wk).map((g, j) => Object.assign(g, { week: i + 1, gid: `W${i + 1}G${j + 1}`, seed: seed + '-W' + (i + 1) + '-' + (j + 1) })));
  }

  // ---------------------------------------------------------------- Offseason
  // Development curve by "effective age" (QB/K/P age slower, RBs faster). Returns expected rating change for the year.
  function effAge(pos, age) { return pos === 'QB' || pos === 'K' || pos === 'P' ? age - 3 : pos === 'RB' ? age + 2 : age; }
  function devDelta(pos, age) {
    const e = effAge(pos, age);
    if (e <= 22) return 3.8;
    if (e <= 23) return 3.3;
    if (e <= 25) return 2;
    if (e <= 27) return 0.5;
    if (e <= 29) return 0;
    if (e <= 30) return -1.2;
    if (e <= 31) return -2.2;
    if (e <= 32) return -3.2;
    return -4.5 - (e - 33) * 0.9;
  }
  function retireChance(p) {
    const e = effAge(p.pos, p.age);
    let c = e <= 29 ? 0.01 : e === 30 ? 0.05 : e === 31 ? 0.1 : e === 32 ? 0.18 : e === 33 ? 0.3 : e === 34 ? 0.45 : e === 35 ? 0.6 : 0.8;
    if (p.r < 56) c += 0.3; else if (p.r < 60) c += 0.12;
    return Math.min(0.97, c);
  }
  // prev: {TEAMID: [players]} from the season that just ended. order: team ids, first pick first.
  // Returns {rosters, report}. Deterministic for a given seed.
  function offseason(prev, order, seed, seasonNo) {
    const rng = makeRng('offseason:' + seed);
    const rosters = JSON.parse(JSON.stringify(prev));
    const report = { retired: [], drafted: [], improved: [], declined: [], order: order.slice() };
    const usedShort = new Set();
    for (const id of Object.keys(rosters)) for (const p of rosters[id]) usedShort.add(p.first[0] + p.last);
    // 1. development + aging
    const moves = [];
    for (const id of Object.keys(rosters)) {
      for (const p of rosters[id]) {
        p.prevR = p.r; p.age++; p.yrs = (p.yrs || 0) + 1;
        const d = devDelta(p.pos, p.age) + rng.gauss(0, 2.6) + (rng.chance(0.04) ? rng.pick([-1, 1]) * rng.int(5, 9) : 0);
        p.r = clamp(Math.round(p.r + d), 40, 99);
        delete p.rookie;
        moves.push({ id: p.id, team: id, name: p.name, pos: p.pos, age: p.age, from: p.prevR, to: p.r });
      }
    }
    // 2. retirements
    const needs = {};
    for (const id of Object.keys(rosters)) {
      const keep = [];
      for (const p of rosters[id]) {
        if (rng.chance(retireChance(p))) report.retired.push({ id: p.id, team: id, name: p.name, pos: p.pos, age: p.age, r: p.r, yrs: p.yrs });
        else keep.push(p);
      }
      rosters[id] = keep;
      needs[id] = [];
      for (const pos of POSITIONS) { const have = keep.filter(p => p.pos === pos).length; for (let i = have; i < TEMPLATE[pos]; i++) needs[id].push(pos); }
    }
    // 3. rookie class: one per opening plus extras so teams have a real choice
    const pool = [];
    const allNeeds = Object.values(needs).flat();
    const extra = Math.ceil(allNeeds.length * 0.35);
    const classPos = allNeeds.concat(Array.from({ length: extra }, () => rng.pick(allNeeds.length ? allNeeds : POSITIONS)));
    classPos.forEach((pos, i) => {
      const blue = rng.chance(0.07);
      const r = clamp(Math.round(blue ? rng.gauss(76, 4) : rng.gauss(62, 6.5)), 45, 86);
      const nm = makeName(rng, usedShort);
      pool.push(Object.assign({ id: 'R' + seasonNo + '-' + (i + 1), pos, r, age: rng.int(21, 23), yrs: 0, rookie: true }, nm));
    });
    // 4. draft: rounds in `order` until every opening is filled; best available at a needed position
    let overall = 0, round = 0;
    while (Object.values(needs).some(n => n.length) && round < 40) {
      round++;
      for (const id of order) {
        const nd = needs[id]; if (!nd || !nd.length) continue;
        let best = null;
        for (const c of pool) if (nd.includes(c.pos) && (!best || c.r > best.r)) best = c;
        if (!best) continue;
        pool.splice(pool.indexOf(best), 1);
        nd.splice(nd.indexOf(best.pos), 1);
        const def = TEAM_BY_ID[id];
        const nums = new Set(rosters[id].map(p => p.num));
        const p = Object.assign({}, best, { team: def.idx, num: pickNumber(rng, best.pos, nums), draft: { season: seasonNo, round, pick: ++overall } });
        rosters[id].push(p);
        report.drafted.push({ round, pick: overall, team: id, id: p.id, name: p.name, pos: p.pos, r: p.r, age: p.age });
      }
    }
    // 5. headline movers (still in the league)
    const active = new Set(Object.values(rosters).flat().map(p => p.id));
    const live = moves.filter(m => active.has(m.id));
    report.improved = live.slice().sort((a, b) => (b.to - b.from) - (a.to - a.from)).slice(0, 8);
    report.declined = live.slice().sort((a, b) => (a.to - a.from) - (b.to - b.from)).slice(0, 8);
    return { rosters, report };
  }
  function teamRatings(rosters) {
    const out = {};
    for (const d of TEAM_DEFS) { const t = buildTeam(d.id, rosters[d.id]); out[d.id] = { ovr: t.rt.ovr, off: t.rt.off, def: t.rt.def }; }
    return out;
  }

  // ---------------------------------------------------------------- Win probability
  // Home team's chance of winning from the game state. Expected margin (score + value of the current
  // possession + remaining team-strength edge) over the uncertainty left in the game, through a normal CDF.
  // Fitted on ~2,000 simulated games: predictions land within ~1.5 points of actual win rates in every 10% band.
  const WP = { k: 0.85, home: 4.25, sd: 19.5, floor: 2 };
  function normCdf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2); return x >= 0 ? (1 + y) / 2 : (1 - y) / 2; }
  function strengthEdge(teams, g) { // expected full-game margin for home from ratings (+ home field)
    const h = teams[0].rt, a = teams[1].rt;
    // the fitted home edge applies to a normal home game; at a venue it scales with the actual home/travel advantage
    const home = g && g.venue ? WP.home * (g.adj[0] - g.adj[1]) / 2.6 : WP.home;
    return ((h.off - a.def) - (a.off - h.def)) * WP.k + home;
  }
  function winProb(g) {
    const sc = g.score;
    if (g.over) return sc[0] > sc[1] ? 1 : sc[0] < sc[1] ? 0 : 0.5;
    const ot = g.qtr >= 5;
    const left = ot ? g.clock : (4 - g.qtr) * 900 + g.clock;
    let ep = 0, side = 0;
    if (g.phase === 'play') {
      side = g.poss === 0 ? 1 : -1;
      ep = -1.1 + 0.072 * g.ball - (g.down - 1) * 0.35 - Math.max(0, g.togo - 10) * 0.05;
    } else if (g.phase === 'pat') { side = g.poss === 0 ? 1 : -1; ep = 0.95; }
    else if (g.phase === 'kickoff' || g.phase === 'freekick') { side = g.kicker === 0 ? -1 : 1; ep = 0.6; }
    const frac = ot ? Math.min(1, left / 600) * 0.25 : left / 3600;
    const mean = sc[0] - sc[1] + side * ep + strengthEdge(g.teams, g) * frac;
    const sd = Math.max(WP.floor, WP.sd * Math.sqrt(frac) + (ot ? 2.5 : 0));
    // a tie at the end of regulation goes to overtime (roughly a coin flip)
    if (!ot && left <= 0 && Math.abs(sc[0] - sc[1]) < 0.5) return 0.5;
    return Math.min(0.995, Math.max(0.005, normCdf(mean / sd)));
  }
  function pregameWinProb(home, away, opts) {
    const g = new Game(home, away, Object.assign({ seed: 'wp' }, opts || {}));
    return winProb(g);
  }

  // ---------------------------------------------------------------- Broadcast pacing
  // Deterministic real-time timeline so every viewer (and the server) agrees on what is on screen.
  const PACE = 0.7; // global multiplier, tuned so an average game airs in ~7 minutes
  function pathDur(path) {
    let tot = 0;
    for (let i = 1; i < (path ? path.length : 0); i++) {
      const a = path[i - 1], b = path[i];
      const v = b.m === 'kick' ? 30 : b.m === 'air' ? 22 : 8.5;
      tot += Math.max(0.18, Math.hypot(b.x - a.x, b.y - a.y) / v) + (b.m === 'kick' ? 0.25 : 0);
    }
    return tot;
  }
  const BANNER_HOLD = { 'TOUCHDOWN': 4.2, 'PICK SIX': 4.5, 'KICK RETURN TD': 4.5, 'PUNT RETURN TD': 4.5, 'FIELD GOAL': 2.6, 'NO GOOD': 2.6, 'BLOCKED': 2.8,
    'INTERCEPTED': 3, 'FUMBLE': 3, 'TURNOVER ON DOWNS': 2.8, 'MUFFED PUNT': 3, 'BLOCKED PUNT': 3, 'ONSIDE RECOVERED': 3.2, 'SAFETY': 3.2,
    'FLAG': 2, 'INJURY': 2.6, 'XP MISSED': 2.2, '2-PT GOOD': 2.6, '2-PT FAILS': 2.2, 'TWO-MINUTE WARNING': 3, 'HALFTIME': 12, 'OVERTIME': 6, 'FINAL': 10, 'KICKOFF': 4 };
  // Broadcast stage: regular season ~7 min, semifinals ~9 min, IFL Bowl ~14 min (slower pacing, longer celebrations and halftime).
  const STAGE = { reg: { m: 1, big: 1, half: 1 }, semi: { m: 1.28, big: 1.15, half: 1.4 }, bowl: { m: 1.82, big: 1.4, half: 2.6 } };
  const stageOf = g => !g ? 'reg' : g.gid === 'P-F' ? 'bowl' : g.playoff ? 'semi' : 'reg';
  function eventTiming(ev, stage) {
    const S = STAGE[stage] || STAGE.reg;
    const hasPath = ev.path && ev.path.length > 1;
    const sameQ = ev.pre.qtr === ev.post.qtr;
    const runoff = sameQ ? Math.max(0, ev.pre.clock - ev.snapClock) : 0;
    let pre, act = 0, post = 0.75;
    if (hasPath) {
      act = Math.min(3.6, Math.max(0.55, pathDur(ev.path) * 0.62)) + 0.1;
      pre = ev.pre.phase === 'play' ? 0.45 + runoff * 0.014 : 0.6;
    } else {
      pre = ev.kind === 'penalty' ? 0.45 + runoff * 0.014 : 0.3 + Math.min(runoff, 40) * 0.014;
    }
    if (ev.kind === 'timeout') post = 1.8;
    if (ev.kind === 'info') post = 1.8;
    if (ev.kind === 'period') post = 3;
    if (ev.banner && BANNER_HOLD[ev.banner]) post = Math.max(post, BANNER_HOLD[ev.banner]) * (ev.banner === 'HALFTIME' ? S.half : ev.banner === 'FINAL' ? 1 : S.big);
    const k = 1000 * PACE * S.m;
    return { pre: pre * k, act: act * k, post: post * k };
  }
  function timeline(events, stage) {
    let t = 0;
    return events.map(ev => { const x = eventTiming(ev, stage); const r = { start: t, pre: x.pre, act: x.act, post: x.post, dur: x.pre + x.act + x.post }; t += r.dur; return r; });
  }
  function gameDuration(g, stage) { const tl = timeline(g.events, stage); return tl.length ? tl[tl.length - 1].start + tl[tl.length - 1].dur : 0; }

  // games: [{home, away, result:{score:[home, away]}}]
  // Tiebreakers (NFL style, simplified): win pct, head-to-head, division record, point differential, points scored.
  function standings(games) {
    const rec = {};
    const inGames = new Set(); for (const g of games) { inGames.add(g.home); inGames.add(g.away); }
    const teamsIn = inGames.size ? LEAGUE.filter(t => inGames.has(t.id)) : LEAGUE, dmap = {};
    divisionsFor(teamsIn.map(t => t.id)).forEach(d => d.teams.forEach(id => dmap[id] = d.id));
    teamsIn.forEach(t => rec[t.id] = { id: t.id, div: dmap[t.id] || t.div, w: 0, l: 0, t: 0, dw: 0, dl: 0, dt: 0, pf: 0, pa: 0, hw: 0, hl: 0, aw: 0, al: 0, res: [], h2h: {} });
    for (const g of games) {
      if (!g.result || g.playoff) continue;
      const [hs, as] = g.result.score, H = rec[g.home], A = rec[g.away];
      const inDiv = H.div === A.div;
      H.pf += hs; H.pa += as; A.pf += as; A.pa += hs;
      if (hs > as) { H.w++; A.l++; H.hw++; A.al++; H.res.push('W'); A.res.push('L'); H.h2h[g.away] = (H.h2h[g.away] || 0) + 1; A.h2h[g.home] = (A.h2h[g.home] || 0) - 1; if (inDiv) { H.dw++; A.dl++; } }
      else if (as > hs) { A.w++; H.l++; A.aw++; H.hl++; A.res.push('W'); H.res.push('L'); A.h2h[g.home] = (A.h2h[g.home] || 0) + 1; H.h2h[g.away] = (H.h2h[g.away] || 0) - 1; if (inDiv) { A.dw++; H.dl++; } }
      else { H.t++; A.t++; H.res.push('T'); A.res.push('T'); if (inDiv) { H.dt++; A.dt++; } }
    }
    const arr = Object.values(rec);
    arr.forEach(r => {
      const gp = r.w + r.l + r.t; r.pct = gp ? (r.w + r.t / 2) / gp : 0;
      const dg = r.dw + r.dl + r.dt; r.dpct = dg ? (r.dw + r.dt / 2) / dg : 0;
      const last = r.res[r.res.length - 1]; let n = 0;
      for (let i = r.res.length - 1; i >= 0 && r.res[i] === last; i--) n++;
      r.strk = last ? last + n : '—';
    });
    arr.sort(cmpTeams);
    return arr;
  }
  function cmpTeams(a, b) {
    return b.pct - a.pct || (b.h2h[a.id] || 0) - (a.h2h[b.id] || 0) || (a.div === b.div ? b.dpct - a.dpct : 0) || (b.pf - b.pa) - (a.pf - a.pa) || b.pf - a.pf || (a.id < b.id ? -1 : 1);
  }
  function divisionStandings(games) {
    const all = standings(games);
    return divisionsFor(all.map(r => r.id)).map(d => ({ id: d.id, name: d.name, rows: all.filter(r => r.div === d.id) }));
  }
  // Four playoff teams: every division winner (seeded by record), then the best remaining teams as wild cards.
  const PLAYOFF_TEAMS = 4;
  function playoffSeeds(games) {
    const divs = divisionStandings(games);
    const winners = divs.map(d => d.rows[0]).sort(cmpTeams);
    const wid = winners.map(r => r.id);
    const rest = standings(games).filter(r => !wid.includes(r.id)).slice(0, Math.max(0, PLAYOFF_TEAMS - winners.length));
    return winners.concat(rest).map((r, i) => ({ id: r.id, seed: i + 1, how: i < winners.length ? divName(r.div) + ' champion' : 'Wild card' }));
  }

  const API = { TEAMS: LEAGUE, stageOf, STAGE, winProb, pregameWinProb, WP, DEFAULT_ROSTERS, initialRosters, buildTeam, offseason, teamRatings, STARTERS, POSITIONS, DIVISIONS, divName, divisionStandings, playoffSeeds, timeline, standings, gameDuration, eventTiming, VERSION: 5, expansionRoster, ORIGINAL_TEAMS: ORIGINAL8, divisionsFor, LEGACY_DIVISIONS, PLAYOFF_TEAMS, getTeam, travelDist, Game, simulateGame, makeSchedule, makeRng, fmtClock, qName, ORD, PEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.IFL = API;
})(typeof window !== 'undefined' ? window : globalThis);
