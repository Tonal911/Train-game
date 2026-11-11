// Board generator: cities (lat/lon) -> routes, lengths, colors, double tracks, express lines, tickets.
// Deterministic for a given config + geo. Used by the server at startup, by custom lobby maps,
// and live in the map editor.
//
// Heuristics (all tunable in map.config.json -> generator):
//  * Connections: a beta-skeleton (Gabriel-like) graph over projected city positions. City pair A-B
//    is a candidate unless some other city C "sees" A and B at an angle > blockAngle (C sits between
//    them). Gives a planar, locally-connected network like a real rail map.
//  * Rejected: over maxKm, mostly over ocean (< minLandFraction of samples on land), or passing
//    within cityClearance of another city.
//  * Length (trains) = round(km * (1 + mountainFactor * share of route in mountains) / kmPerTrain),
//    clamped to [minLength, maxLength].
//  * Double tracks on short-ish links between big cities (sizes 2-3).
//  * Express: a few extra-long lines (7-9) between far-apart cities, drawn as arcs that never cross
//    another route.
//  * Colors: ~grayShare gray, the rest balanced by total track length per color, avoiding the same
//    color twice at a city and on both tracks of a double.
//  * Tickets: value = shortest path in trains, drawn from length buckets, each city used a few times.

import { project, inBoard, haversineKm, BOARD_W, BOARD_H } from './projection.js';
import { dist, pointSegDist, polylinesCross, polylineLength, pointAt, pointInRing, quadCurve } from './geom.js';
import { makeRng, hashString } from './rng.js';
import { COLOR_IDS, GRAY } from './config.js';

export const DEFAULT_GENERATOR = {
  kmPerTrain: 195, minLength: 1, maxLength: 6, maxKm: 1350, blockAngle: 95,
  mountainFactor: 0.35, cityClearance: 34, minLandFraction: 0.8,
  grayShare: 0.3, doubleShare: 0.24, doubleMaxLength: 5, maxDegree: 8,
  express: { count: 5, minKm: 1350, maxKm: 2700, kmPerTrain: 230, minLength: 7, maxLength: 9 },
  tickets: {
    minValue: 5, maxPerCity: 3,
    buckets: [{ min: 5, max: 9, count: 12 }, { min: 10, max: 14, count: 12 }, { min: 15, max: 19, count: 7 }, { min: 20, max: 30, count: 4 }],
  },
};
export const DEFAULT_CONSTRAINTS = { minCities: 10, maxCities: 60, minCityDistanceKm: 170, boardMargin: 40, maxNameLength: 22 };

export const slug = (name) => String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------- land mask (scanline rasterization, fast lookups) ----------
const CELL = 8;
function buildMask(polys) {
  const W = Math.ceil(BOARD_W / CELL), H = Math.ceil(BOARD_H / CELL);
  const mask = new Uint8Array(W * H);
  for (const poly of polys) {
    for (let row = 0; row < H; row++) {
      const y = (row + 0.5) * CELL;
      const xs = [];
      for (const ring of poly) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [x1, y1] = ring[i], [x2, y2] = ring[j];
          if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil(xs[k] / CELL - 0.5)), c1 = Math.min(W - 1, Math.floor(xs[k + 1] / CELL - 0.5));
        for (let c = c0; c <= c1; c++) mask[row * W + c] = 1;
      }
    }
  }
  return { W, H, mask, at(x, y) { const c = Math.floor(x / CELL), r = Math.floor(y / CELL); return c >= 0 && r >= 0 && c < W && r < H ? mask[r * W + c] : 0; } };
}
const maskCache = new WeakMap();
function landMask(geo) {
  if (!geo) return null;
  if (!maskCache.has(geo)) maskCache.set(geo, buildMask(geo.land.flatMap((l) => l.polys)));
  return maskCache.get(geo);
}

function samples(path, step = 12) {
  const L = polylineLength(path), n = Math.max(2, Math.ceil(L / step));
  const out = [];
  for (let i = 0; i <= n; i++) { const p = pointAt(path, (L * i) / n); out.push([p.x, p.y]); }
  return out;
}

// ---------- validation ----------
export function normalizeConfig(cfg) {
  const g = { ...DEFAULT_GENERATOR, ...(cfg.generator || {}) };
  g.express = { ...DEFAULT_GENERATOR.express, ...((cfg.generator || {}).express || {}) };
  g.tickets = { ...DEFAULT_GENERATOR.tickets, ...((cfg.generator || {}).tickets || {}) };
  return {
    name: String(cfg.name || 'Custom map').slice(0, 40),
    seed: cfg.seed ?? 1,
    generator: g,
    constraints: { ...DEFAULT_CONSTRAINTS, ...(cfg.constraints || {}) },
    cities: Array.isArray(cfg.cities) ? cfg.cities : [],
    terrain: { mountains: [], deserts: [], ...(cfg.terrain || {}) },
    overrides: { addRoutes: [], removeRoutes: [], setRoutes: [], express: [], ...(cfg.overrides || {}) },
  };
}

export function validateConfig(rawCfg) {
  const cfg = normalizeConfig(rawCfg);
  const errors = [], warnings = [];
  const C = cfg.constraints;
  if (cfg.cities.length < C.minCities) errors.push(`Need at least ${C.minCities} cities (have ${cfg.cities.length}).`);
  if (cfg.cities.length > C.maxCities) errors.push(`At most ${C.maxCities} cities allowed (have ${cfg.cities.length}).`);
  const seen = new Map();
  cfg.cities.forEach((c, i) => {
    const label = c && c.name ? `"${c.name}"` : `#${i + 1}`;
    if (!c || typeof c.name !== 'string' || !c.name.trim()) { errors.push(`City ${label}: missing name.`); return; }
    if (c.name.length > C.maxNameLength) errors.push(`City ${label}: name longer than ${C.maxNameLength} characters.`);
    const id = slug(c.name);
    if (!id) errors.push(`City ${label}: name needs letters or digits.`);
    if (seen.has(id)) errors.push(`City ${label}: duplicate name.`);
    seen.set(id, c);
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) { errors.push(`City ${label}: lat/lon must be numbers.`); return; }
    const [x, y] = project(c.lon, c.lat);
    if (!inBoard(x, y, C.boardMargin)) errors.push(`City ${label}: outside the playable map area.`);
    if (c.size != null && ![1, 2, 3].includes(c.size)) errors.push(`City ${label}: size must be 1, 2 or 3.`);
  });
  for (let i = 0; i < cfg.cities.length; i++) {
    for (let j = i + 1; j < cfg.cities.length; j++) {
      const a = cfg.cities[i], b = cfg.cities[j];
      if (!Number.isFinite(a?.lat) || !Number.isFinite(b?.lat)) continue;
      const km = haversineKm(a.lat, a.lon, b.lat, b.lon);
      if (km < C.minCityDistanceKm) errors.push(`"${a.name}" and "${b.name}" are ${Math.round(km)} km apart (minimum ${C.minCityDistanceKm} km).`);
    }
  }
  const ids = new Set([...seen.keys()]);
  const checkPair = (kind, a, b) => {
    if (!ids.has(slug(a)) || !ids.has(slug(b))) errors.push(`Override ${kind}: unknown city in "${a}" - "${b}".`);
  };
  for (const r of cfg.overrides.addRoutes) checkPair('addRoutes', r.a, r.b);
  for (const r of cfg.overrides.setRoutes) checkPair('setRoutes', r.a, r.b);
  for (const r of cfg.overrides.removeRoutes) checkPair('removeRoutes', r[0], r[1]);
  for (const r of cfg.overrides.express) checkPair('express', r[0], r[1]);
  for (const r of [...cfg.overrides.addRoutes, ...cfg.overrides.setRoutes]) {
    if (r.color != null && r.color !== GRAY && !COLOR_IDS.includes(r.color)) errors.push(`Override ${r.a}-${r.b}: unknown color "${r.color}".`);
    if (r.length != null && !(Number.isInteger(r.length) && r.length >= 1 && r.length <= 12)) errors.push(`Override ${r.a}-${r.b}: length must be 1-12.`);
  }
  return { cfg, errors, warnings };
}

// ---------- generation ----------
export function generateBoard(rawCfg, geo) {
  const { cfg, errors, warnings } = validateConfig(rawCfg);
  if (errors.length) return { board: null, errors, warnings };
  const G = cfg.generator;
  const rng = makeRng(hashString(String(cfg.seed)));
  const mask = landMask(geo);
  const landFrac = (path) => {
    if (!mask) return 1;
    const s = samples(path);
    return s.filter((p) => mask.at(p[0], p[1])).length / s.length;
  };
  const mountains = (cfg.terrain.mountains || []).map((r) => r.map(([lon, lat]) => project(lon, lat)));
  const mountainFrac = (path) => {
    if (!mountains.length) return 0;
    const s = samples(path, 20);
    return s.filter((p) => mountains.some((r) => pointInRing(p, r))).length / s.length;
  };

  const cities = cfg.cities.map((c) => {
    const [x, y] = project(c.lon, c.lat);
    return { id: slug(c.name), name: c.name.trim(), lat: c.lat, lon: c.lon, x: r1(x), y: r1(y), size: c.size || 1, labelPos: c.label || null };
  });
  const idx = new Map(cities.map((c, i) => [c.id, i]));
  const P = (i) => [cities[i].x, cities[i].y];
  const kmOf = (i, j) => haversineKm(cities[i].lat, cities[i].lon, cities[j].lat, cities[j].lon);
  const clearOf = (path, i, j) => {
    const s = path.length === 2 ? null : samples(path, 10);
    for (let k = 0; k < cities.length; k++) {
      if (k === i || k === j) continue;
      const p = P(k);
      if (s) { if (s.some((q) => dist(q, p) < G.cityClearance)) return false; }
      else if (pointSegDist(p, path[0], path[1]) < G.cityClearance) return false;
    }
    return true;
  };

  const removed = new Set(cfg.overrides.removeRoutes.map(([a, b]) => pairKey(slug(a), slug(b))));
  const conns = new Map(); // key -> {i,j,path,km}
  const addConn = (i, j, path, extra = {}) => {
    const key = pairKey(cities[i].id, cities[j].id);
    if (conns.has(key)) return conns.get(key);
    const c = { i, j, key, path, km: kmOf(i, j), ...extra };
    conns.set(key, c);
    return c;
  };
  const crossesAny = (path, skipKey) => {
    for (const c of conns.values()) if (c.key !== skipKey && polylinesCross(path, c.path)) return true;
    return false;
  };

  // 1. beta-skeleton candidates
  const cosBlock = Math.cos((G.blockAngle * Math.PI) / 180);
  for (let i = 0; i < cities.length; i++) {
    for (let j = i + 1; j < cities.length; j++) {
      const a = P(i), b = P(j);
      let blocked = false;
      for (let k = 0; k < cities.length && !blocked; k++) {
        if (k === i || k === j) continue;
        const p = P(k);
        const v1 = [a[0] - p[0], a[1] - p[1]], v2 = [b[0] - p[0], b[1] - p[1]];
        const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2));
        if (cos < cosBlock) blocked = true;
      }
      if (blocked) continue;
      const key = pairKey(cities[i].id, cities[j].id);
      if (removed.has(key)) continue;
      const path = [a, b];
      if (kmOf(i, j) > G.maxKm) continue;
      if (landFrac(path) < G.minLandFraction) continue;
      if (!clearOf(path, i, j)) continue;
      addConn(i, j, path);
    }
  }
  // blockAngle > 90 can (rarely) allow crossings: drop the longer of any crossing pair.
  const list = [...conns.values()].sort((x, y) => dist(...x.path) - dist(...y.path));
  for (let a = 0; a < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) {
      if (conns.has(list[a].key) && conns.has(list[b].key) && polylinesCross(list[a].path, list[b].path)) conns.delete(list[b].key);
    }
  }
  // 2. degree cap (drop longest)
  const degree = () => {
    const d = new Array(cities.length).fill(0);
    for (const c of conns.values()) { d[c.i]++; d[c.j]++; }
    return d;
  };
  {
    const d = degree();
    const sorted = [...conns.values()].sort((x, y) => y.km - x.km);
    for (const c of sorted) {
      if ((d[c.i] > G.maxDegree || d[c.j] > G.maxDegree) && d[c.i] > 2 && d[c.j] > 2) { conns.delete(c.key); d[c.i]--; d[c.j]--; }
    }
  }
  // 3. forced routes
  for (const r of cfg.overrides.addRoutes) {
    const i = idx.get(slug(r.a)), j = idx.get(slug(r.b));
    if (i == null || j == null || i === j) continue;
    const path = [P(i), P(j)];
    if (crossesAny(path)) warnings.push(`Forced route ${r.a} - ${r.b} crosses another route.`);
    addConn(i, j, path, { forced: true });
  }
  // 4. connectivity + minimum degree 2
  const tryLink = (i, relax) => {
    const opts = [];
    for (let j = 0; j < cities.length; j++) {
      if (j === i || conns.has(pairKey(cities[i].id, cities[j].id)) || removed.has(pairKey(cities[i].id, cities[j].id))) continue;
      const path = [P(i), P(j)];
      const km = kmOf(i, j);
      if (!relax && km > G.maxKm * 1.15) continue;
      if (crossesAny(path) || !clearOf(path, i, j)) continue;
      if (!relax && landFrac(path) < G.minLandFraction * 0.7) continue;
      opts.push({ j, km, path });
    }
    opts.sort((a, b) => a.km - b.km);
    if (opts.length) { addConn(i, opts[0].j, opts[0].path); return true; }
    return false;
  };
  {
    const d = degree();
    for (let i = 0; i < cities.length; i++) {
      while (d[i] < 2) {
        if (!tryLink(i, false) && !tryLink(i, true)) { warnings.push(`${cities[i].name} could only get ${d[i]} connection(s).`); break; }
        const nd = degree(); for (let k = 0; k < d.length; k++) d[k] = nd[k];
      }
    }
    for (let guard = 0; guard < cities.length; guard++) {
      const comp = components(cities.length, [...conns.values()]);
      if (comp.count <= 1) break;
      // link closest pair across the first component boundary
      let best = null;
      for (let i = 0; i < cities.length; i++) for (let j = 0; j < cities.length; j++) {
        if (comp.id[i] !== 0 || comp.id[j] === 0) continue;
        const path = [P(i), P(j)];
        const km = kmOf(i, j);
        if ((!best || km < best.km) && !crossesAny(path)) best = { i, j, km, path };
      }
      if (!best) { errors.push('Map is disconnected and no non-crossing link could be found.'); break; }
      addConn(best.i, best.j, best.path);
    }
  }
  // 5. lengths
  for (const c of conns.values()) {
    const mf = mountainFrac(c.path);
    c.mountain = mf;
    c.length = clamp(Math.round((c.km * (1 + G.mountainFactor * mf)) / G.kmPerTrain), G.minLength, G.maxLength);
  }
  // 6. express lines
  const E = G.express;
  const expressPaths = (i, j) => {
    const a = P(i), b = P(j);
    const L = dist(a, b), nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const out = [[a, b]];
    for (const f of [0.1, 0.16, 0.22, 0.3, 0.38]) for (const s of [1, -1]) out.push(quadCurve(a, [mid[0] + nx * L * f * s * 2, mid[1] + ny * L * f * s * 2], b, 28));
    return out;
  };
  const validExpress = (path, i, j) =>
    path.every((p) => inBoard(p[0], p[1], 30)) && !crossesAny(path) && clearOf(path, i, j) && landFrac(path) >= 0.72;
  const expressUsed = new Set();
  const addExpress = (i, j, pinned) => {
    for (const path of expressPaths(i, j)) {
      if (validExpress(path, i, j) || (pinned && path === expressPaths(i, j).at(-1))) {
        const c = addConn(i, j, path, { express: true });
        c.length = clamp(Math.round(c.km / E.kmPerTrain), E.minLength, E.maxLength);
        expressUsed.add(i); expressUsed.add(j);
        return true;
      }
    }
    return false;
  };
  for (const [a, b] of cfg.overrides.express) {
    const i = idx.get(slug(a)), j = idx.get(slug(b));
    if (i == null || j == null) continue;
    if (!addExpress(i, j, false)) {
      const c = addConn(i, j, [P(i), P(j)], { express: true });
      c.length = clamp(Math.round(c.km / E.kmPerTrain), E.minLength, E.maxLength);
      warnings.push(`Express ${a} - ${b} has no clean path; drawn straight and may cross routes.`);
    }
  }
  {
    const cands = [];
    for (let i = 0; i < cities.length; i++) for (let j = i + 1; j < cities.length; j++) {
      const km = kmOf(i, j);
      if (km < E.minKm || km > E.maxKm || conns.has(pairKey(cities[i].id, cities[j].id))) continue;
      cands.push({ i, j, km, score: km / E.maxKm + rng() * 0.6 });
    }
    cands.sort((a, b) => b.score - a.score);
    let made = [...conns.values()].filter((c) => c.express).length;
    for (const c of cands) {
      if (made >= E.count) break;
      if (expressUsed.has(c.i) || expressUsed.has(c.j)) continue;
      if (addExpress(c.i, c.j)) made++;
    }
    if (made < E.count) warnings.push(`Only found room for ${made}/${E.count} express lines.`);
  }
  // 7. double tracks
  const regular = [...conns.values()].filter((c) => !c.express);
  {
    const target = Math.round(regular.length * G.doubleShare);
    const cands = regular
      .filter((c) => c.length <= G.doubleMaxLength && cities[c.i].size + cities[c.j].size >= 4)
      .map((c) => ({ c, s: cities[c.i].size + cities[c.j].size + rng() * 1.5 - c.length * 0.15 }))
      .sort((a, b) => b.s - a.s);
    for (const { c } of cands.slice(0, target)) c.double = true;
  }
  // 8. overrides: set route props
  for (const r of cfg.overrides.setRoutes) {
    const c = conns.get(pairKey(slug(r.a), slug(r.b)));
    if (!c) { warnings.push(`setRoutes: no route ${r.a} - ${r.b}.`); continue; }
    if (r.length != null) c.length = r.length;
    if (r.double != null) c.double = !!r.double;
    if (r.color != null) c.forcedColor = r.color;
    if (r.color2 != null) c.forcedColor2 = r.color2;
  }

  // 9. tracks + colors
  const tracks = [];
  for (const c of conns.values()) {
    const base = { a: cities[c.i].id, b: cities[c.j].id, length: c.length, km: Math.round(c.km), express: !!c.express, mountain: +(c.mountain ?? mountainFrac(c.path)).toFixed(2), path: c.path.map((p) => [r1(p[0]), r1(p[1])]) };
    const id = c.key;
    if (c.double) {
      tracks.push({ ...base, id: id + '#1', twin: id + '#2', lane: -1, conn: c });
      tracks.push({ ...base, id: id + '#2', twin: id + '#1', lane: 1, conn: c });
    } else tracks.push({ ...base, id, twin: null, lane: 0, conn: c });
  }
  for (const t of tracks) {
    const forced = t.lane === 1 ? t.conn.forcedColor2 : t.conn.forcedColor;
    if (forced) t.color = forced;
    delete t.conn;
  }
  assignColors(tracks, cities, G, rng);

  // 10. tickets
  const { tickets, warnings: tw } = makeTickets(cities, tracks, G.tickets, rng);
  warnings.push(...tw);

  // 11. labels
  placeLabels(cities, tracks);

  const board = {
    name: cfg.name, width: BOARD_W, height: BOARD_H,
    cities, routes: tracks, tickets,
    terrain: {
      mountains: mountains.map((r) => r.map((p) => [r1(p[0]), r1(p[1])])),
      deserts: (cfg.terrain.deserts || []).map((r) => r.map(([lon, lat]) => project(lon, lat).map(r1))),
    },
  };
  board.id = hashString(JSON.stringify([board.cities, board.routes.map((r) => [r.id, r.length, r.color]), board.tickets])).toString(36);
  board.stats = boardStats(board);
  return { board, errors, warnings };
}

function assignColors(tracks, cities, G, rng) {
  const units = new Map();
  for (const t of tracks) {
    const k = t.twin ? t.id.split('#')[0] : t.id;
    if (!units.has(k)) units.set(k, []);
    units.get(k).push(t);
  }
  const unitList = [...units.values()];
  const nonExpress = unitList.filter((u) => !u[0].express && !u.some((t) => t.color));
  for (const u of unitList) if (u[0].express) u.forEach((t) => (t.color ||= GRAY));
  const totalTracks = nonExpress.reduce((s, u) => s + u.length, 0);
  const grayTarget = Math.round(totalTracks * G.grayShare);
  const scored = nonExpress.map((u) => ({ u, s: rng() + (u[0].length <= 2 ? 0.45 : 0) + (u[0].length >= 6 ? 0.15 : 0) - (u.length > 1 ? 0.25 : 0) }))
    .sort((a, b) => b.s - a.s);
  let gray = 0;
  for (const { u } of scored) {
    if (gray >= grayTarget) break;
    u.forEach((t) => (t.color = GRAY));
    gray += u.length;
  }
  const usage = Object.fromEntries(COLOR_IDS.map((c) => [c, 0]));
  const atCity = new Map(cities.map((c) => [c.id, new Map()]));
  const todo = tracks.filter((t) => !t.color).sort((a, b) => b.length - a.length || (rng() - 0.5));
  for (const t of todo) {
    const twin = t.twin ? tracks.find((x) => x.id === t.twin) : null;
    let best = null, bestCost = Infinity;
    for (const c of rng.shuffle([...COLOR_IDS])) {
      if (twin && twin.color === c) continue;
      const near = (atCity.get(t.a).get(c) || 0) + (atCity.get(t.b).get(c) || 0);
      const cost = usage[c] + near * 9 + rng() * 0.5;
      if (cost < bestCost) { bestCost = cost; best = c; }
    }
    t.color = best;
    usage[best] += t.length;
    for (const city of [t.a, t.b]) atCity.get(city).set(best, (atCity.get(city).get(best) || 0) + 1);
  }
}

function makeTickets(cities, tracks, T, rng) {
  const n = cities.length, INF = 1e9;
  const idx = new Map(cities.map((c, i) => [c.id, i]));
  const d = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : INF)));
  const direct = new Set();
  for (const t of tracks) {
    const i = idx.get(t.a), j = idx.get(t.b);
    direct.add(Math.min(i, j) + ',' + Math.max(i, j));
    if (t.length < d[i][j]) d[i][j] = d[j][i] = t.length;
  }
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (d[i][k] + d[k][j] < d[i][j]) d[i][j] = d[i][k] + d[k][j];
  const used = new Array(n).fill(0);
  const picked = new Set();
  const tickets = [], warnings = [];
  const buckets = [...T.buckets].sort((a, b) => b.min - a.min); // biggest first so long tickets get cities
  for (const bk of buckets) {
    const cands = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const v = d[i][j];
      if (v >= INF || v < Math.max(T.minValue, bk.min) || v > bk.max) continue;
      cands.push([i, j, v]);
    }
    rng.shuffle(cands);
    let got = 0;
    for (const [i, j, v] of cands) {
      if (got >= bk.count) break;
      if (used[i] >= T.maxPerCity || used[j] >= T.maxPerCity || picked.has(i + ',' + j) || direct.has(i + ',' + j)) continue;
      picked.add(i + ',' + j); used[i]++; used[j]++; got++;
      const [a, b] = cities[i].x <= cities[j].x ? [i, j] : [j, i];
      tickets.push({ id: 't' + tickets.length, a: cities[a].id, b: cities[b].id, value: v, long: bk.min >= 20 });
    }
    if (got < bk.count) warnings.push(`Ticket bucket ${bk.min}-${bk.max}: only ${got}/${bk.count} tickets.`);
  }
  tickets.sort((x, y) => x.value - y.value);
  tickets.forEach((t, i) => (t.id = 't' + i));
  return { tickets, warnings };
}

const LABEL_DIRS = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0], se: [0.8, 0.8], sw: [-0.8, 0.8], ne: [0.8, -0.8], nw: [-0.8, -0.8] };
export function cityRadius(c) { return 13 + c.size * 3; }
export function labelFont(c) { return 27 + c.size * 3; }
function placeLabels(cities, tracks) {
  const segPts = tracks.flatMap((t) => samples(t.path, 14));
  const boxes = [];
  const order = [...cities].sort((a, b) => b.size - a.size);
  for (const c of order) {
    const fs = labelFont(c), w = c.name.length * fs * 0.58, h = fs * 1.05, r = cityRadius(c) + 6;
    let best = null;
    for (const [k, [dx, dy]] of Object.entries(LABEL_DIRS)) {
      const cx = c.x + dx * (r + (dx ? w / 2 : 0) + 2), cy = c.y + dy * (r + h / 2);
      const box = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
      let cost = k === 's' ? 0 : k === 'n' ? 1 : 3;
      if (c.labelPos && c.labelPos === k) cost -= 1000;
      for (const p of segPts) if (p[0] > box[0] && p[0] < box[2] && p[1] > box[1] && p[1] < box[3]) cost += 4;
      for (const o of cities) if (o !== c && o.x > box[0] - 20 && o.x < box[2] + 20 && o.y > box[1] - 20 && o.y < box[3] + 20) cost += 40;
      for (const b of boxes) if (!(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3])) cost += 60;
      if (box[0] < 5 || box[1] < 5 || box[2] > BOARD_W - 5 || box[3] > BOARD_H - 5) cost += 200;
      if (!best || cost < best.cost) best = { cost, k, cx, cy, box };
    }
    boxes.push(best.box);
    c.label = { x: r1(best.cx), y: r1(best.cy + h * 0.36), dir: best.k };
    delete c.labelPos;
  }
}

function boardStats(board) {
  const byColor = {};
  for (const r of board.routes) byColor[r.color] = (byColor[r.color] || 0) + r.length;
  const lens = {};
  for (const r of board.routes) lens[r.length] = (lens[r.length] || 0) + 1;
  return {
    cities: board.cities.length,
    tracks: board.routes.length,
    connections: new Set(board.routes.map((r) => r.id.split('#')[0])).size,
    doubles: board.routes.filter((r) => r.lane === 1).length,
    express: board.routes.filter((r) => r.express).length,
    totalTrains: board.routes.reduce((s, r) => s + r.length, 0),
    trainsByColor: byColor,
    routesByLength: lens,
    tickets: board.tickets.length,
  };
}

function components(n, edges) {
  const id = new Array(n).fill(-1);
  const adj = Array.from({ length: n }, () => []);
  for (const e of edges) { adj[e.i].push(e.j); adj[e.j].push(e.i); }
  let count = 0;
  for (let s = 0; s < n; s++) {
    if (id[s] !== -1) continue;
    const st = [s]; id[s] = count;
    while (st.length) { const v = st.pop(); for (const w of adj[v]) if (id[w] === -1) { id[w] = count; st.push(w); } }
    count++;
  }
  return { id, count };
}

export function pairKey(a, b) { return a < b ? `${a}~${b}` : `${b}~${a}`; }
const r1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Land lookup grid for a geo dataset: { at(x, y) -> 0|1 } in board units. */
export function landMaskFor(geo) { return landMask(geo); }
