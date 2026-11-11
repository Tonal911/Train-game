// Builds data/geo.json (projected, clipped, simplified background geometry) from Natural Earth (public domain).
// Usage: node scripts/build-geo.mjs <dir containing ne_50m_admin_0_countries.geojson, ne_50m_lakes.geojson,
//        ne_50m_admin_1_states_provinces_lines.geojson>
import fs from 'node:fs';
import path from 'node:path';
import { project, BOARD_W, BOARD_H } from '../shared/projection.js';
import { clipRing, clipLine, simplify, ringArea } from '../shared/geom.js';

const dir = process.argv[2];
if (!dir) { console.error('usage: build-geo.mjs <natural-earth-dir>'); process.exit(1); }
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

const M = 60; // clip margin outside board
const X0 = -M, Y0 = -M, X1 = BOARD_W + M, Y1 = BOARD_H + M;
const TOL = 1.6;
const r1 = (p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];

function projRing(ring) {
  // densify long edges a bit so clipping/projection stays smooth
  const out = [];
  for (let i = 0; i < ring.length; i++) out.push(project(ring[i][0], ring[i][1]));
  return out;
}
function polys(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}
function lines(geom) {
  if (!geom) return [];
  if (geom.type === 'LineString') return [geom.coordinates];
  if (geom.type === 'MultiLineString') return geom.coordinates;
  return [];
}
function processPolys(geom, minArea) {
  const out = [];
  for (const poly of polys(geom)) {
    const rings = [];
    for (let k = 0; k < poly.length; k++) {
      let r = clipRing(projRing(poly[k]), X0, Y0, X1, Y1);
      if (r.length < 3) { if (k === 0) break; continue; }
      r = simplify([...r, r[0]], TOL).slice(0, -1);
      if (r.length < 3 || ringArea(r) < minArea) { if (k === 0) break; continue; }
      rings.push(r.map(r1));
    }
    if (rings.length) out.push(rings);
  }
  return out;
}

const KEEP = { USA: 'us', CAN: 'ca', MEX: 'mx' };
const countries = read('ne_50m_admin_0_countries.geojson');
const land = [];
for (const f of countries.features) {
  const a3 = f.properties.ADM0_A3;
  const ps = processPolys(f.geometry, 40);
  if (!ps.length) continue;
  land.push({ id: KEEP[a3] || 'other', name: f.properties.NAME, polys: ps });
}

const lakesSrc = read('ne_50m_lakes.geojson');
const lakes = [];
for (const f of lakesSrc.features) {
  const ps = processPolys(f.geometry, 120);
  if (ps.length) lakes.push({ name: f.properties.name, polys: ps });
}

const adm1 = read('ne_50m_admin_1_states_provinces_lines.geojson');
const borders = [];
for (const f of adm1.features) {
  if (!['USA', 'CAN'].includes(f.properties.ADM0_A3)) continue;
  for (const ln of lines(f.geometry)) {
    for (const part of clipLine(ln.map((p) => project(p[0], p[1])), X0, Y0, X1, Y1)) {
      const s = simplify(part, TOL * 1.5);
      if (s.length > 1) borders.push(s.map(r1));
    }
  }
}

const out = { width: BOARD_W, height: BOARD_H, source: 'Natural Earth 1:50m (public domain)', land, lakes, borders };
fs.writeFileSync(new URL('../data/geo.json', import.meta.url), JSON.stringify(out));
const size = fs.statSync(new URL('../data/geo.json', import.meta.url)).size;
console.log(`geo.json: ${land.length} countries, ${lakes.length} lakes, ${borders.length} border lines, ${(size / 1024).toFixed(0)} KB, board ${BOARD_W}x${BOARD_H}`);
