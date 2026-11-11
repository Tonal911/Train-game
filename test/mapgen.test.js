import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBoard, validateConfig } from '../shared/mapgen.js';
import { polylinesCross } from '../shared/geom.js';
import { geo, config } from './helpers.js';

test('default board is valid, connected, non-crossing', () => {
  const { board, errors } = generateBoard(config, geo);
  assert.deepEqual(errors, []);
  assert.equal(board.cities.length, config.cities.length);
  const conn = [...new Map(board.routes.map((r) => [r.id.split('#')[0], r])).values()];
  for (let i = 0; i < conn.length; i++) for (let j = i + 1; j < conn.length; j++)
    assert.ok(!polylinesCross(conn[i].path, conn[j].path), `${conn[i].id} crosses ${conn[j].id}`);
  const deg = new Map();
  for (const r of conn) { deg.set(r.a, (deg.get(r.a) || 0) + 1); deg.set(r.b, (deg.get(r.b) || 0) + 1); }
  for (const c of board.cities) assert.ok((deg.get(c.id) || 0) >= 2, `${c.name} degree`);
  for (const r of board.routes) {
    if (r.twin) assert.notEqual(r.color === 'gray' ? null : r.color, board.routes.find((x) => x.id === r.twin).color === 'gray' ? undefined : board.routes.find((x) => x.id === r.twin).color);
    assert.ok(r.length >= 1 && r.length <= 9);
  }
  assert.ok(board.routes.some((r) => r.express && r.length >= 7));
  assert.ok(board.tickets.length >= 30);
});

test('deterministic', () => {
  assert.equal(generateBoard(config, geo).board.id, generateBoard(config, geo).board.id);
});

test('adding a city regenerates with routes to it', () => {
  const cfg = structuredClone(config);
  cfg.cities.push({ name: 'Omaha', lat: 41.26, lon: -95.94, size: 1 });
  const { board, errors } = generateBoard(cfg, geo);
  assert.deepEqual(errors, []);
  assert.ok(board.routes.filter((r) => r.a === 'omaha' || r.b === 'omaha').length >= 2);
});

test('constraints reject bad cities', () => {
  const cfg = structuredClone(config);
  cfg.cities.push({ name: 'Too Close', lat: 41.9, lon: -87.7 });
  cfg.cities.push({ name: 'Paris', lat: 48.85, lon: 2.35 });
  cfg.cities.push({ name: 'Chicago', lat: 30, lon: -100 });
  const { errors } = validateConfig(cfg);
  assert.ok(errors.some((e) => /apart/.test(e)));
  assert.ok(errors.some((e) => /outside/.test(e)));
  assert.ok(errors.some((e) => /duplicate/.test(e)));
});

test('overrides: remove, add, set', () => {
  const cfg = structuredClone(config);
  cfg.overrides.removeRoutes = [['Seattle', 'Portland']];
  cfg.overrides.setRoutes = [{ a: 'Chicago', b: 'St. Louis', color: 'red', length: 3, double: false }];
  const { board, errors } = generateBoard(cfg, geo);
  assert.deepEqual(errors, []);
  assert.ok(!board.routes.some((r) => r.id.startsWith('portland~seattle')));
  const r = board.routes.filter((r) => r.id.startsWith('chicago~st-louis'));
  assert.equal(r.length, 1); assert.equal(r[0].color, 'red'); assert.equal(r[0].length, 3);
});
