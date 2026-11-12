// Zoomable/pannable board: painted canvas background + crisp SVG overlay (routes, cities, pieces).
import { el, clear } from './util.js';
import { paintBackground } from './paintmap.js';
import { colorInfo } from '/shared/config.js';
import { pointAt, polylineLength } from '/shared/geom.js';
import { cityRadius, labelFont } from '/shared/mapgen.js';
import { makeRng } from '/shared/rng.js';

export const SEG_W = 26;
const LANE = 15;
const GAP = 7;

/** Segment rectangles (center, angle, length) for a track. */
export function trackSegments(route, board) {
  const A = board.cities.find((c) => c.id === route.a), B = board.cities.find((c) => c.id === route.b);
  let path = route.path;
  // path runs from a to b in generator order; make sure trimming uses the right ends
  const L = polylineLength(path);
  const t0 = cityRadius(dist2(path[0], A) < dist2(path[0], B) ? A : B) + 9;
  const t1 = cityRadius(dist2(path[0], A) < dist2(path[0], B) ? B : A) + 9;
  const U = L - t0 - t1;
  const n = route.length;
  const len = Math.max(8, (U - GAP * (n - 1)) / n);
  const segs = [];
  for (let i = 0; i < n; i++) {
    const s = t0 + len / 2 + i * (len + GAP);
    const p = pointAt(path, s);
    const nx = -Math.sin(p.ang), ny = Math.cos(p.ang);
    segs.push({ x: p.x + nx * route.lane * LANE, y: p.y + ny * route.lane * LANE, ang: (p.ang * 180) / Math.PI, len });
  }
  return segs;
}
const dist2 = (p, c) => (p[0] - c.x) ** 2 + (p[1] - c.y) ** 2;

function wobblyCircle(cx, cy, r, seed) {
  const rng = makeRng(seed);
  let d = '';
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * Math.PI * 2, rr = r * (0.92 + rng() * 0.16);
    d += (i ? 'L' : 'M') + (cx + Math.cos(a) * rr).toFixed(1) + ' ' + (cy + Math.sin(a) * rr).toFixed(1);
  }
  return d + 'Z';
}

export class MapView {
  constructor(container, geo, board, opts = {}) {
    this.geo = geo;
    this.board = board;
    this.opts = opts;
    this.insets = { left: 0, top: 0, right: 0, bottom: 0 };
    this.scale = 0.3; this.tx = 0; this.ty = 0;
    this.root = el('div', { class: 'mapview' });
    this.stage = el('div', { class: 'stage', style: { width: board.width + 'px', height: board.height + 'px' } });
    this.canvas = el('canvas', { class: 'bg' });
    this.svg = el('svg', { class: 'overlay', viewBox: `0 0 ${board.width} ${board.height}`, width: board.width, height: board.height });
    this.stage.append(this.canvas, this.svg);
    this.root.append(this.stage);
    container.append(this.root);
    this.cityById = new Map(board.cities.map((c) => [c.id, c]));
    this.routeById = new Map(board.routes.map((r) => [r.id, r]));
    this.segs = new Map(board.routes.map((r) => [r.id, trackSegments(r, board)]));
    paintBackground(this.canvas, geo, board, opts.bgScale || 0.75);
    this.buildSvg();
    this.bindInput();
    this.owner = {};
    requestAnimationFrame(() => this.fit());
    this.onResize = () => this.fit(true);
    addEventListener('resize', this.onResize);
  }

  destroy() { removeEventListener('resize', this.onResize); this.root.remove(); }

  /** Swap in a regenerated board (same geo/terrain) without repainting the background. */
  setBoard(board) {
    this.board = board;
    this.cityById = new Map(board.cities.map((c) => [c.id, c]));
    this.routeById = new Map(board.routes.map((r) => [r.id, r]));
    this.segs = new Map(board.routes.map((r) => [r.id, trackSegments(r, board)]));
    clear(this.svg);
    this.buildSvg();
    this.update({ owner: {} });
    this.apply();
  }

  thumbnail(w = 400) {
    const c = document.createElement('canvas');
    c.width = w; c.height = Math.round((w * this.board.height) / this.board.width);
    c.getContext('2d').drawImage(this.canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  }

  buildSvg() {
    const svg = this.svg;
    const defs = el('defs', {},
      el('pattern', { id: 'expressStripes', patternUnits: 'userSpaceOnUse', width: 18, height: 18, patternTransform: 'rotate(45)' },
        el('rect', { width: 18, height: 18, fill: '#d6d6d6' }), el('rect', { width: 7, height: 18, fill: '#ffd400' })));
    this.gRoutes = el('g', { class: 'routes' });
    this.gPieces = el('g', { class: 'pieces' });
    this.gHi = el('g', { class: 'hi' });
    this.gCities = el('g', { class: 'cities' });
    this.gLabels = el('g', { class: 'labels' });
    this.gShine = el('g', { class: 'shines' });
    svg.append(defs, this.gRoutes, this.gPieces, this.gShine, this.gHi, this.gCities, this.gLabels);
    this.routeEls = new Map();
    const rng = makeRng(31);
    for (const r of this.board.routes) {
      const g = el('g', { class: 'route' + (r.express ? ' express' : ''), dataset: { id: r.id } });
      const pts = r.path.map((p) => p.join(',')).join(' ');
      g.append(el('polyline', { class: 'hit', points: pts, transform: r.lane ? this.laneShift(r) : null }));
      const fill = r.express ? 'url(#expressStripes)' : colorInfo(r.color).hex;
      for (const s of this.segs.get(r.id)) {
        const jr = (rng() - 0.5) * 3, jw = (rng() - 0.5) * 2;
        g.append(el('rect', { class: 'shadow', x: -s.len / 2 - 4, y: -SEG_W / 2 - 4, width: s.len + 8, height: SEG_W + 8, rx: 8, transform: `translate(${s.x.toFixed(1)} ${s.y.toFixed(1)}) rotate(${(s.ang + jr).toFixed(1)})` }));
        g.append(el('rect', { class: 'seg', x: -s.len / 2, y: -SEG_W / 2 + jw / 2, width: s.len, height: SEG_W - jw, rx: 5, fill, transform: `translate(${s.x.toFixed(1)} ${s.y.toFixed(1)}) rotate(${(s.ang + jr).toFixed(1)})` }));
      }
      if (r.express) {
        const mid = pointAt(r.path, polylineLength(r.path) / 2);
        this.gLabels.append(el('g', { class: 'xbadge', transform: `translate(${mid.x.toFixed(1)} ${mid.y.toFixed(1)})` },
          el('circle', { r: 30 }), el('text', { class: 'label xnum', y: 0, 'text-anchor': 'middle', 'dominant-baseline': 'central', style: { fontSize: '36px' }, text: String(r.length) })));
      }
      g.addEventListener('click', (e) => { if (!this.dragged) this.opts.onRouteClick?.(r, e); });
      g.addEventListener('pointerenter', (e) => { g.classList.add('hover'); this.opts.onRouteHover?.(r, e); });
      g.addEventListener('pointermove', (e) => this.opts.onRouteMove?.(r, e));
      g.addEventListener('pointerleave', () => { g.classList.remove('hover'); this.opts.onRouteLeave?.(r); });
      this.gRoutes.append(g);
      this.routeEls.set(r.id, g);
    }
    this.cityEls = new Map();
    for (const c of this.board.cities) {
      const r = cityRadius(c) - 4;
      const g = el('g', { class: 'city', dataset: { id: c.id } },
        el('path', { class: 'ring', d: wobblyCircle(c.x, c.y, r + 4, c.x * 7 + c.y) }),
        el('circle', { class: 'dot', cx: c.x, cy: c.y, r: r * 0.62 }));
      if (this.opts.onCityDown) g.addEventListener('pointerdown', (e) => this.opts.onCityDown(c, e));
      this.gCities.append(g);
      this.cityEls.set(c.id, g);
      const rr = cityRadius(c) + 3, d = c.label.dir || 's';
      const ax = d.includes('e') ? 1 : d.includes('w') ? -1 : 0, ay = d.includes('s') ? 1 : d.includes('n') ? -1 : 0;
      const k = ax && ay ? 0.75 : 1;
      this.gLabels.append(el('text', {
        class: 'label', x: (c.x + ax * rr * k).toFixed(1), y: (c.y + ay * rr * k).toFixed(1),
        'text-anchor': ax > 0 ? 'start' : ax < 0 ? 'end' : 'middle',
        'dominant-baseline': ay > 0 ? 'hanging' : ay < 0 ? 'alphabetic' : 'central',
        style: { fontSize: `calc(${labelFont(c)}px * var(--ls, 1))` }, text: c.name,
      }));
    }
  }

  laneShift(r) {
    const a = r.path[0], b = r.path.at(-1);
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    return `translate(${(-Math.sin(ang) * r.lane * LANE).toFixed(1)} ${(Math.cos(ang) * r.lane * LANE).toFixed(1)})`;
  }

  /** owner: routeId -> seat; players: [{color}] ; blockedTwins: bool */
  update({ owner = {}, players = [], doublesBlocked = false, pieceArt = {}, playerHex = {} } = {}, animateIds = []) {
    this.owner = owner;
    clear(this.gPieces);
    this.held ||= new Map();
    // halos go in their own layer underneath, so chunky outlines never cover a neighbour's wagons
    const halos = el('g', { class: 'halos' }), bodies = el('g', { class: 'bodies' });
    this.gPieces.append(halos, bodies);
    for (const [rid, seat] of Object.entries(owner)) {
      const p = players[seat];
      if (!p) continue;
      const anim = animateIds.includes(rid) && !this.held.has(rid);
      const held = this.held.get(rid);
      this.segs.get(rid)?.forEach((s, i) => {
        const tr = `translate(${s.x.toFixed(1)} ${s.y.toFixed(1)}) rotate(${s.ang.toFixed(1)})`;
        const cls = 'pc' + (held?.has(i) ? ' held' : '') + (anim ? ' pop' : '');
        const d = { rid, i: String(i) };
        halos.append(el('g', { transform: tr }, el('g', { class: cls, dataset: d, style: { animationDelay: anim ? i * 90 + 'ms' : '0ms' } },
          el('rect', { class: 'phalo', x: -s.len / 2 - 11, y: -SEG_W / 2 - 13, width: s.len + 22, height: SEG_W + 26, rx: 13 }))));
        bodies.append(el('g', { transform: tr }, el('g', { class: cls, dataset: d, style: { animationDelay: anim ? i * 90 + 'ms' : '0ms' } },
          el('rect', { class: 'pbase', x: -s.len / 2 - 3, y: -SEG_W / 2 - 5, width: s.len + 6, height: SEG_W + 10, rx: 7, fill: playerHex[p.color] || '#fff' }),
          pieceArt[p.color] ? el('image', { href: pieceArt[p.color], x: -s.len / 2 - 2, y: -SEG_W / 2 - 9, width: s.len + 4, height: SEG_W + 18, preserveAspectRatio: 'none' }) : null)));
      });
    }
    for (const [rid, g] of this.routeEls) {
      const r = this.routeById.get(rid);
      g.classList.toggle('owned', owner[rid] != null);
      g.classList.toggle('blocked', !!(doublesBlocked && r.twin && owner[r.twin] != null && owner[rid] == null));
    }
  }

  /** Keep a route's pieces invisible until reveal() (used while 3D wagons are flying in). */
  hold(rid) { (this.held ||= new Map()).set(rid, new Set((this.segs.get(rid) || []).map((_, i) => i))); }
  reveal(rid, i) {
    const h = this.held?.get(rid);
    if (h) { h.delete(i); if (!h.size) this.held.delete(rid); }
    for (const n of this.gPieces.querySelectorAll(`.pc[data-rid="${CSS.escape(rid)}"][data-i="${i}"]`)) { n.classList.remove('held'); n.classList.add('landed'); }
  }
  /** Shine sweep up a freshly built line: bottom end of the route to the top end. */
  shine(rid) {
    const segs = [...(this.segs.get(rid) || [])].sort((a, b) => b.y - a.y);
    segs.forEach((s, k) => {
      const r = el('rect', { class: 'shine', x: -s.len / 2 - 12, y: -SEG_W / 2 - 14, width: s.len + 24, height: SEG_W + 28, rx: 14,
        transform: `translate(${s.x.toFixed(1)} ${s.y.toFixed(1)}) rotate(${s.ang.toFixed(1)})`, style: { animationDelay: k * 70 + 'ms' } });
      this.gShine.append(r);
      setTimeout(() => r.remove(), 900 + k * 70);
    });
  }
  revealAll(rid) { for (const i of [...(this.held?.get(rid) || [])]) this.reveal(rid, i); }
  /** screen-space segments for a route (for the 3D fly-in) */
  screenSegs(rid) {
    return (this.segs.get(rid) || []).map((s) => {
      const p = this.toScreen(s.x, s.y);
      return { x: p.x, y: p.y, ang: s.ang, len: s.len * this.scale };
    });
  }

  highlightCities(ids = []) {
    for (const [id, g] of this.cityEls) g.classList.toggle('hl', ids.includes(id));
  }

  highlightRoutes(ids = [], hex = '#fff') {
    clear(this.gHi);
    for (const id of ids) for (const s of this.segs.get(id) || []) {
      this.gHi.append(el('rect', { class: 'hlseg', x: -s.len / 2 - 6, y: -SEG_W / 2 - 6, width: s.len + 12, height: SEG_W + 12, rx: 8, stroke: hex, transform: `translate(${s.x} ${s.y}) rotate(${s.ang})` }));
    }
  }

  // ---------- pan / zoom ----------
  setInsets(i) { this.insets = { ...this.insets, ...i }; }
  fitScale() {
    const { left, top, right, bottom } = this.insets;
    const w = Math.max(200, this.root.clientWidth - left - right), h = Math.max(150, this.root.clientHeight - top - bottom);
    return Math.min(w / this.board.width, h / this.board.height);
  }
  fit(keepIfZoomed = false) {
    const fs = this.fitScale();
    if (keepIfZoomed && this.scale > fs * 1.05) { this.apply(); return; }
    const { left, top, right, bottom } = this.insets;
    const w = this.root.clientWidth - left - right, h = this.root.clientHeight - top - bottom;
    this.scale = fs;
    this.tx = left + (w - this.board.width * fs) / 2;
    this.ty = top + (h - this.board.height * fs) / 2;
    this.apply();
  }
  zoomAt(factor, cx, cy) {
    const fs = this.fitScale();
    const ns = Math.max(fs * 0.85, Math.min(1.15, this.scale * factor));
    const k = ns / this.scale;
    this.tx = cx - (cx - this.tx) * k;
    this.ty = cy - (cy - this.ty) * k;
    this.scale = ns;
    this.apply();
  }
  zoomBy(f) { const r = this.root.getBoundingClientRect(); this.zoomAt(f, r.width / 2, r.height / 2); }
  apply() {
    const W = this.board.width * this.scale, H = this.board.height * this.scale;
    const vw = this.root.clientWidth, vh = this.root.clientHeight;
    const m = 120;
    this.tx = Math.min(vw - m, Math.max(m - W, this.tx));
    this.ty = Math.min(vh - m, Math.max(m - H, this.ty));
    this.stage.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    this.root.classList.toggle('zoomed', this.scale > this.fitScale() * 1.6);
    // keep city names legible when zoomed out, natural size when zoomed in
    this.svg.style.setProperty('--ls', Math.max(1, 10.5 / (30 * this.scale)).toFixed(3));
  }
  bindInput() {
    const root = this.root;
    root.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = root.getBoundingClientRect();
      const d = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      this.zoomAt(Math.pow(1.0018, -d), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    let start = null;
    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      start = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, id: e.pointerId };
      this.dragged = false;
    });
    addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!this.dragged && Math.hypot(dx, dy) > 5) { this.dragged = true; root.classList.add('dragging'); }
      if (this.dragged) { this.tx = start.tx + dx; this.ty = start.ty + dy; this.apply(); }
    });
    addEventListener('pointerup', () => {
      if (!start) return;
      start = null;
      root.classList.remove('dragging');
      setTimeout(() => (this.dragged = false), 0);
    });
    root.addEventListener('click', (e) => {
      if (this.dragged || !this.opts.onMapClick) return;
      if (e.target.closest('.route, .city')) return;
      const p = this.toBoard(e.clientX, e.clientY);
      this.opts.onMapClick(p, e);
    });
    root.addEventListener('dblclick', (e) => {
      if (this.opts.noDblZoom) return;
      const r = root.getBoundingClientRect();
      this.zoomAt(e.shiftKey ? 0.6 : 1.6, e.clientX - r.left, e.clientY - r.top);
    });
  }
  /** board coords -> client coords */
  toScreen(x, y) {
    const r = this.root.getBoundingClientRect();
    return { x: r.left + this.tx + x * this.scale, y: r.top + this.ty + y * this.scale };
  }
  /** client coords -> board coords */
  toBoard(cx, cy) {
    const r = this.root.getBoundingClientRect();
    return { x: (cx - r.left - this.tx) / this.scale, y: (cy - r.top - this.ty) / this.scale };
  }
}
