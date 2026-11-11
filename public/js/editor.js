// Map editor: add/move/delete cities, override routes, tune the generator, export map JSON.
import { el, add, clear, toast, storage } from './util.js';
import { MapView } from './mapview.js';
import { generateBoard, slug } from '/shared/mapgen.js';
import { unproject } from '/shared/projection.js';
import { COLOR_IDS, GRAY, colorInfo } from '/shared/config.js';

const DRAFT_KEY = 'tg_editor_draft';
const root = document.getElementById('editor');
const [geo, defaultCfg] = await Promise.all([fetch('/data/geo.json').then((r) => r.json()), fetch('/data/map.config.json').then((r) => r.json())]);

let cfg;
try { cfg = JSON.parse(storage(DRAFT_KEY)) || structuredClone(defaultCfg); } catch { cfg = structuredClone(defaultCfg); }
cfg.overrides = { addRoutes: [], removeRoutes: [], setRoutes: [], express: [], ...(cfg.overrides || {}) };

let board = null, errors = [], warnings = [];
let mode = 'select'; // select | add | link
let selected = null; // {kind:'city'|'route', id}
let linkFrom = null;

const mapHost = el('div', { class: 'ed-map' });
const side = el('div', { class: 'ed-side' });
root.append(mapHost, side);

function regenerate(first = false) {
  const res = generateBoard(cfg, geo);
  errors = res.errors; warnings = res.warnings;
  if (res.board) {
    board = res.board;
    if (first) createMap(); else view.setBoard(board);
    decorate();
  }
  storage(DRAFT_KEY, JSON.stringify(cfg));
  renderSide();
}

let view;
function createMap() {
  view = new MapView(mapHost, geo, board, {
    noDblZoom: false,
    onRouteClick: (r) => { if (mode === 'select') { selected = { kind: 'route', id: r.id }; decorate(); renderSide(); } },
    onCityDown: (c, e) => cityDown(c, e),
    onMapClick: (p) => mapClick(p),
  });
  mapHost.append(el('div', { class: 'ed-top' },
    el('a', { class: 'btn', href: '/', text: '← GAME' }),
    el('div', { class: 'title-blob small' }, el('h1', { class: 'title', text: 'MAP EDITOR' }))));
}

function decorate() {
  for (const [id, g] of view.cityEls) {
    g.classList.toggle('sel', selected?.kind === 'city' && selected.id === id);
    g.classList.toggle('pickA', linkFrom === id);
  }
  view.highlightRoutes(selected?.kind === 'route' ? [selected.id] : [], '#fff');
  view.root.classList.toggle('adding', mode === 'add');
}

function cityByName(id) { return cfg.cities.find((c) => slug(c.name) === id); }

function cityDown(c, e) {
  if (mode === 'link') {
    e.stopPropagation();
    if (!linkFrom) { linkFrom = c.id; decorate(); toast('Now click the second city.'); return; }
    if (linkFrom === c.id) { linkFrom = null; decorate(); return; }
    const a = board.cities.find((x) => x.id === linkFrom).name, b = c.name;
    cfg.overrides.removeRoutes = cfg.overrides.removeRoutes.filter(([x, y]) => !same(x, y, a, b));
    if (!cfg.overrides.addRoutes.some((r) => same(r.a, r.b, a, b))) cfg.overrides.addRoutes.push({ a, b });
    linkFrom = null;
    toast(`Forced route ${a} – ${b}`);
    regenerate();
    return;
  }
  if (mode !== 'select') return;
  e.stopPropagation();
  selected = { kind: 'city', id: c.id };
  const entry = cityByName(c.id);
  const start = { x: e.clientX, y: e.clientY };
  let moved = false;
  const move = (ev) => {
    if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4 && !moved) return;
    moved = true;
    const p = view.toBoard(ev.clientX, ev.clientY);
    const g = view.cityEls.get(c.id);
    g.setAttribute('transform', `translate(${(p.x - c.x).toFixed(1)} ${(p.y - c.y).toFixed(1)})`);
  };
  const up = (ev) => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    if (moved) {
      const p = view.toBoard(ev.clientX, ev.clientY);
      const [lon, lat] = unproject(p.x, p.y);
      entry.lat = +lat.toFixed(3); entry.lon = +lon.toFixed(3);
      regenerate();
    } else { decorate(); renderSide(); }
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
}

function mapClick(p) {
  if (mode !== 'add') { selected = null; decorate(); renderSide(); return; }
  const name = prompt('City name?');
  if (!name || !name.trim()) return;
  const [lon, lat] = unproject(p.x, p.y);
  cfg.cities.push({ name: name.trim(), lat: +lat.toFixed(3), lon: +lon.toFixed(3), size: 1 });
  selected = { kind: 'city', id: slug(name) };
  mode = 'select';
  regenerate();
}

const same = (a, b, c, d) => (slug(a) === slug(c) && slug(b) === slug(d)) || (slug(a) === slug(d) && slug(b) === slug(c));

function field(label, input) { return el('label', { class: 'f' }, el('span', { text: label }), input); }
function numInput(value, onchange, attrs = {}) {
  const i = el('input', { class: 'input', type: 'number', value, ...attrs });
  i.addEventListener('change', () => onchange(+i.value));
  return i;
}

function renderSide() {
  clear(side);
  const modeBtn = (m, label) => el('button', { class: 'btn' + (mode === m ? ' on' : ''), onclick: () => { mode = m; linkFrom = null; decorate(); renderSide(); }, text: label });
  add(side, 
    el('h2', { class: 'outline', text: 'Tools' }),
    el('div', { class: 'row' }, modeBtn('select', 'SELECT / MOVE'), modeBtn('add', '+ ADD CITY'), modeBtn('link', '+ FORCE ROUTE')),
    el('ul', { class: 'ed-help' },
      el('li', { text: mode === 'add' ? 'Click anywhere on land to drop a new city.' : mode === 'link' ? 'Click two cities to force a route between them.' : 'Click a city or route to edit it. Drag cities to move them.' }),
      el('li', { text: 'Scroll to zoom, drag the map to pan. Your draft auto-saves in this browser.' })));

  // selection panel
  if (selected?.kind === 'city') {
    const c = cityByName(selected.id);
    if (c) {
      const name = el('input', { class: 'input', value: c.name, maxlength: 22 });
      name.addEventListener('change', () => {
        const old = c.name; c.name = name.value.trim() || old;
        renameInOverrides(old, c.name);
        selected.id = slug(c.name); regenerate();
      });
      const size = el('select', { class: 'input' }, ...[1, 2, 3].map((s) => el('option', { value: s, selected: (c.size || 1) === s ? 'selected' : null, text: ['small', 'medium', 'big (more double tracks)'][s - 1] })));
      size.addEventListener('change', () => { c.size = +size.value; regenerate(); });
      const label = el('select', { class: 'input' }, el('option', { value: '', text: 'auto' }), ...['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((d) => el('option', { value: d, selected: c.label === d ? 'selected' : null, text: d.toUpperCase() })));
      label.addEventListener('change', () => { if (label.value) c.label = label.value; else delete c.label; regenerate(); });
      const routes = board.routes.filter((r) => r.a === selected.id || r.b === selected.id).length;
      add(side, el('h2', { class: 'outline', text: 'City' }), el('div', { class: 'ed-sel' },
        field('Name', name), field('Size', size), field('Label side', label),
        field('Latitude', numInput(c.lat, (v) => { c.lat = v; regenerate(); }, { step: 0.01 })),
        field('Longitude', numInput(c.lon, (v) => { c.lon = v; regenerate(); }, { step: 0.01 })),
        el('div', { class: 'small', text: `${routes} track(s) connect here.` }),
        el('div', { class: 'row' }, el('button', { class: 'btn red', onclick: () => { cfg.cities = cfg.cities.filter((x) => x !== c); purgeCity(c.name); selected = null; regenerate(); }, text: 'DELETE CITY' }))));
    }
  } else if (selected?.kind === 'route') {
    const r = board.routes.find((x) => x.id === selected.id);
    if (r) {
      const A = board.cities.find((c) => c.id === r.a).name, B = board.cities.find((c) => c.id === r.b).name;
      const setFor = () => {
        let s = cfg.overrides.setRoutes.find((x) => same(x.a, x.b, A, B));
        if (!s) { s = { a: A, b: B }; cfg.overrides.setRoutes.push(s); }
        return s;
      };
      const colorKey = r.lane === 1 ? 'color2' : 'color';
      const color = el('select', { class: 'input' }, ...[GRAY, ...COLOR_IDS].map((c) => el('option', { value: c, selected: r.color === c ? 'selected' : null, text: colorInfo(c).name })));
      color.addEventListener('change', () => { setFor()[colorKey] = color.value; regenerate(); });
      const dbl = el('input', { type: 'checkbox', checked: r.twin ? 'checked' : null });
      dbl.addEventListener('change', () => { setFor().double = dbl.checked; regenerate(); });
      const isExpress = r.express;
      add(side, el('h2', { class: 'outline', text: 'Route' }), el('div', { class: 'ed-sel' },
        el('b', { text: `${A} – ${B}` }),
        el('div', { class: 'small', text: `${r.km} km · mountains ${Math.round(r.mountain * 100)}% · generator says ${r.length}${isExpress ? ' (express)' : ''}` }),
        field('Length (trains)', numInput(r.length, (v) => { setFor().length = Math.max(1, Math.min(12, Math.round(v))); regenerate(); }, { min: 1, max: 12 })),
        field(r.twin ? `Color (track ${r.lane === -1 ? 1 : 2})` : 'Color', color),
        field('Double track', dbl),
        el('div', { class: 'row' },
          el('button', { class: 'btn red', onclick: () => {
            cfg.overrides.addRoutes = cfg.overrides.addRoutes.filter((x) => !same(x.a, x.b, A, B));
            cfg.overrides.express = cfg.overrides.express.filter(([x, y]) => !same(x, y, A, B));
            cfg.overrides.setRoutes = cfg.overrides.setRoutes.filter((x) => !same(x.a, x.b, A, B));
            if (!cfg.overrides.removeRoutes.some(([x, y]) => same(x, y, A, B))) cfg.overrides.removeRoutes.push([A, B]);
            selected = null; regenerate();
          }, text: 'REMOVE ROUTE' }),
          el('button', { class: 'btn', onclick: () => { cfg.overrides.setRoutes = cfg.overrides.setRoutes.filter((x) => !same(x.a, x.b, A, B)); regenerate(); }, text: 'RESET TO AUTO' }))));
    }
  }

  // express pinning
  add(side, el('h2', { class: 'outline', text: 'Express lines' }),
    el('div', { class: 'small', text: 'Long 7-9 lines are picked automatically. Pin your own (they are drawn as arcs that avoid other routes when possible):' }));
  const ea = el('select', { class: 'input' }, ...board.cities.map((c) => el('option', { value: c.name, text: c.name })));
  const eb = el('select', { class: 'input' }, ...board.cities.map((c, i) => el('option', { value: c.name, selected: i === 1 ? 'selected' : null, text: c.name })));
  add(side, field('From', ea), field('To', eb), el('div', { class: 'row' },
    el('button', { class: 'btn blue', onclick: () => {
      if (ea.value === eb.value) return toast('Pick two different cities.', 'error');
      if (!cfg.overrides.express.some(([x, y]) => same(x, y, ea.value, eb.value))) cfg.overrides.express.push([ea.value, eb.value]);
      regenerate();
    }, text: 'PIN EXPRESS' })),
    cfg.overrides.express.length ? el('div', { class: 'small' }, 'Pinned: ', ...cfg.overrides.express.map(([a, b], i) =>
      el('button', { class: 'btn tiny', title: 'unpin', onclick: () => { cfg.overrides.express.splice(i, 1); regenerate(); }, text: `${a}–${b} (x)` }))) : null);

  // generator settings
  const G = cfg.generator = cfg.generator || {};
  G.express = G.express || {};
  const gnum = (label, obj, key, def, attrs) => field(label, numInput(obj[key] ?? def, (v) => { obj[key] = v; regenerate(); }, attrs));
  add(side, el('h2', { class: 'outline', text: 'Generator' }),
    field('Seed', el('div', { class: 'row' }, numInput(cfg.seed, (v) => { cfg.seed = v; regenerate(); }), el('button', { class: 'btn', onclick: () => { cfg.seed = Math.floor(Math.random() * 99999); regenerate(); }, text: 'RANDOM' }))),
    gnum('km per train', G, 'kmPerTrain', 195, { step: 5 }),
    gnum('Max route length', G, 'maxLength', 6, { min: 2, max: 9 }),
    gnum('Max km (normal)', G, 'maxKm', 1350, { step: 50 }),
    gnum('Mountain factor', G, 'mountainFactor', 0.35, { step: 0.05 }),
    gnum('Gray share', G, 'grayShare', 0.3, { step: 0.05, min: 0, max: 1 }),
    gnum('Double share', G, 'doubleShare', 0.24, { step: 0.02, min: 0, max: 1 }),
    gnum('Connectivity angle', G, 'blockAngle', 95, { step: 1, min: 70, max: 130 }),
    gnum('Express lines', G.express, 'count', 5, { min: 0, max: 12 }));

  // messages + stats
  const msgs = el('div', { class: 'ed-msgs' }, ...errors.map((e) => el('div', { class: 'err', text: 'ERROR: ' + e })), ...warnings.map((w) => el('div', { class: 'warn', text: 'Note: ' + w })));
  const st = board.stats;
  add(side, el('h2', { class: 'outline', text: 'Board' }),
    errors.length ? el('div', { class: 'small err', text: 'Errors: the map below is the last valid version.' }) : null,
    msgs,
    el('div', { class: 'ed-stats' },
      el('div', { text: `${st.cities} cities · ${st.connections} connections · ${st.tracks} tracks · ${st.doubles} doubles · ${st.express} express` }),
      el('div', { text: `${st.totalTrains} trains of track · ${st.tickets} tickets` }),
      el('div', { text: 'By length: ' + Object.entries(st.routesByLength).map(([k, v]) => `${k}:${v}`).join('  ') }),
      el('div', { text: 'By color: ' + Object.entries(st.trainsByColor).map(([k, v]) => `${k} ${v}`).join(', ') })),
    el('h2', { class: 'outline', text: 'Rules for cities' }),
    el('ul', { class: 'ed-help' },
      el('li', { text: `${cfg.constraints?.minCities ?? 10}-${cfg.constraints?.maxCities ?? 60} cities, unique names up to ${cfg.constraints?.maxNameLength ?? 22} characters.` }),
      el('li', { text: `Cities at least ${cfg.constraints?.minCityDistanceKm ?? 170} km apart and inside the map frame.` }),
      el('li', { text: 'Every city gets at least 2 connections; routes never cross; routes avoid passing through other cities; no routes across open ocean.' }),
      el('li', { text: 'Length = distance / km-per-train, +35% through mountains (Rockies, Sierra/Cascades, Appalachians).' })));

  // import/export
  const file = el('input', { type: 'file', accept: '.json', style: { display: 'none' } });
  file.addEventListener('change', async () => {
    try { cfg = JSON.parse(await file.files[0].text()); cfg.overrides = { addRoutes: [], removeRoutes: [], setRoutes: [], express: [], ...(cfg.overrides || {}) }; selected = null; regenerate(); toast('Map loaded.'); }
    catch { toast('Not a valid map JSON.', 'error'); }
  });
  add(side, el('h2', { class: 'outline', text: 'Save' }),
    field('Map name', (() => { const i = el('input', { class: 'input', value: cfg.name || '', maxlength: 40 }); i.addEventListener('change', () => { cfg.name = i.value; regenerate(); }); return i; })()),
    el('div', { class: 'row' },
      el('button', { class: 'btn red', disabled: errors.length ? 'disabled' : null, onclick: download, text: 'DOWNLOAD JSON' }),
      el('button', { class: 'btn', onclick: () => navigator.clipboard.writeText(JSON.stringify(cfg, null, 2)).then(() => toast('Copied!')), text: 'COPY' }),
      el('button', { class: 'btn', onclick: () => file.click(), text: 'LOAD JSON' }),
      el('button', { class: 'btn', onclick: () => { if (confirm('Throw away your draft and reload the default map?')) { cfg = structuredClone(defaultCfg); selected = null; regenerate(); } }, text: 'RESET' }), file),
    el('ul', { class: 'ed-help' },
      el('li', { text: 'Use it now: in a lobby, the host clicks UPLOAD MAP JSON.' }),
      el('li', { text: 'Make it the default: replace data/map.config.json in the repo with this file and push.' })));
}

function download() {
  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: (slug(cfg.name || 'map') || 'map') + '.json' });
  document.body.append(a); a.click(); a.remove();
}

function renameInOverrides(oldName, newName) {
  const fix = (n) => (slug(n) === slug(oldName) ? newName : n);
  const o = cfg.overrides;
  o.addRoutes.forEach((r) => { r.a = fix(r.a); r.b = fix(r.b); });
  o.setRoutes.forEach((r) => { r.a = fix(r.a); r.b = fix(r.b); });
  o.removeRoutes = o.removeRoutes.map(([a, b]) => [fix(a), fix(b)]);
  o.express = o.express.map(([a, b]) => [fix(a), fix(b)]);
}
function purgeCity(name) {
  const o = cfg.overrides, s = slug(name);
  o.addRoutes = o.addRoutes.filter((r) => slug(r.a) !== s && slug(r.b) !== s);
  o.setRoutes = o.setRoutes.filter((r) => slug(r.a) !== s && slug(r.b) !== s);
  o.removeRoutes = o.removeRoutes.filter(([a, b]) => slug(a) !== s && slug(b) !== s);
  o.express = o.express.filter(([a, b]) => slug(a) !== s && slug(b) !== s);
}

regenerate(true);
if (!board) {
  // stored draft is broken: fall back to default
  cfg = structuredClone(defaultCfg);
  regenerate(true);
}
