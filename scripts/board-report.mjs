// Prints generator stats/warnings for data/map.config.json (or a given config) and writes an SVG preview.
// Usage: node scripts/board-report.mjs [config.json] [preview.svg]
import fs from 'node:fs';
import { generateBoard } from '../shared/mapgen.js';
import { colorInfo } from '../shared/config.js';

const cfgPath = process.argv[2] || new URL('../data/map.config.json', import.meta.url);
const outPath = process.argv[3] || 'board-preview.svg';
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const geo = JSON.parse(fs.readFileSync(new URL('../data/geo.json', import.meta.url), 'utf8'));
const t0 = Date.now();
const { board, errors, warnings } = generateBoard(cfg, geo);
console.log(`generated in ${Date.now() - t0} ms`);
if (errors.length) { console.error('ERRORS:\n  ' + errors.join('\n  ')); process.exit(1); }
if (warnings.length) console.warn('warnings:\n  ' + warnings.join('\n  '));
console.log(JSON.stringify(board.stats, null, 1));
const name = (id) => board.cities.find((c) => c.id === id).name;
console.log('express:', board.routes.filter((r) => r.express).map((r) => `${name(r.a)}-${name(r.b)} (${r.length})`).join(', '));
console.log('tickets:', board.tickets.map((t) => `${name(t.a)}-${name(t.b)} ${t.value}`).join(' | '));

const land = geo.land.flatMap((l) => l.polys).map((p) => `<path d="${p.map((r) => 'M' + r.join('L') + 'Z').join('')}" fill="#9be59b" stroke="#2a6"/>`).join('');
const routes = board.routes.map((r) => {
  const off = r.lane * 9;
  const [a, b] = [r.path[0], r.path.at(-1)];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / L * off, ny = (b[0] - a[0]) / L * off;
  const d = 'M' + r.path.map((p) => `${p[0] + nx},${p[1] + ny}`).join('L');
  return `<path d="${d}" fill="none" stroke="${colorInfo(r.color).hex}" stroke-width="${r.express ? 10 : 7}" stroke-dasharray="${r.express ? '30 6' : ''}"/>` +
    `<text x="${(a[0] + b[0]) / 2 + nx}" y="${(a[1] + b[1]) / 2 + ny}" font-size="22" font-weight="bold" fill="#000" stroke="#fff" stroke-width="5" paint-order="stroke">${r.length}</text>`;
}).join('');
const cities = board.cities.map((c) => `<circle cx="${c.x}" cy="${c.y}" r="${10 + c.size * 3}" fill="#fff" stroke="#c00" stroke-width="5"/><text x="${c.label.x}" y="${c.label.y}" text-anchor="middle" font-family="Helvetica,Arial" font-weight="bold" font-size="${27 + c.size * 3}" stroke="#fff" stroke-width="6" paint-order="stroke">${c.name}</text>`).join('');
fs.writeFileSync(outPath, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${board.width} ${board.height}" width="${board.width / 2}"><rect width="100%" height="100%" fill="#5af"/>${land}${routes}${cities}</svg>`);
console.log('preview ->', outPath);
