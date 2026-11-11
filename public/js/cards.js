// Card + ticket DOM builders (Uno-ish chunky cards, MS Paint textures, sticker art).
import { el } from './util.js';
import { CARD_COLORS, LOCO, colorInfo } from '/shared/config.js';
import { makeRng } from '/shared/rng.js';

/** Art registry: filled by loadArt(). Override any entry by dropping a file in /assets/overrides/. */
export const ART = { cards: {}, pieces: {}, back: null, ticketThumb: null };

export async function loadArt(renderToys, playerColors) {
  const toys = renderToys(CARD_COLORS, playerColors);
  Object.assign(ART.cards, toys.cards);
  Object.assign(ART.pieces, toys.pieces);
  ART.cards[LOCO] = '/assets/rainbow.jpg';
  try {
    const list = await (await fetch('/api/overrides')).json();
    for (const f of list.files || []) {
      const m = /^(card|piece)-([a-z]+)\.(png|jpe?g|webp|gif)$/i.exec(f);
      if (m) (m[1] === 'card' ? ART.cards : ART.pieces)[m[2].toLowerCase()] = '/assets/overrides/' + f;
      if (/^cardback\.(png|jpe?g|webp)$/i.test(f)) ART.back = '/assets/overrides/' + f;
    }
  } catch { /* no overrides */ }
  document.documentElement.style.setProperty('--brush', `url(${brushTexture()})`);
}

function brushTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 160;
  const x = c.getContext('2d'); const rng = makeRng(5);
  x.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    x.strokeStyle = rng() < 0.5 ? `rgba(255,255,255,${0.06 + rng() * 0.12})` : `rgba(0,0,0,${0.05 + rng() * 0.1})`;
    x.lineWidth = 6 + rng() * 16;
    const px = rng() * 160, py = rng() * 160;
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + 30 + rng() * 60, py + (rng() - 0.5) * 50); x.stroke();
  }
  return c.toDataURL();
}

const SHAPES = {
  star: 'M50 8 L61 38 L93 38 L67 57 L77 89 L50 70 L23 89 L33 57 L7 38 L39 38 Z',
  circle: 'M50 10 A40 40 0 1 1 49.9 10 Z',
  triangle: 'M50 8 L92 86 L8 86 Z',
  square: 'M14 14 L86 14 L86 86 L14 86 Z',
  diamond: 'M50 5 L92 50 L50 95 L8 50 Z',
  heart: 'M50 88 C10 60 4 34 22 20 C36 9 48 18 50 30 C52 18 64 9 78 20 C96 34 90 60 50 88 Z',
  bolt: 'M58 4 L20 56 L46 56 L38 96 L80 40 L54 40 Z',
  moon: 'M64 8 A44 44 0 1 0 92 66 A34 34 0 1 1 64 8 Z',
  loco: 'M10 60 L10 34 L30 34 L30 18 L44 18 L44 34 L70 34 L70 22 L84 22 L84 34 L92 34 L92 60 Z M22 78 A10 10 0 1 0 22.1 78 Z M74 78 A10 10 0 1 0 74.1 78 Z',
};
export function shapeSvg(shape, cls = 'shape') {
  return el('svg', { class: cls, viewBox: '0 0 100 100' }, el('path', { d: SHAPES[shape] || SHAPES.circle }));
}

const splatCache = new Map();
function splatPath(seed) {
  if (splatCache.has(seed)) return splatCache.get(seed);
  const rng = makeRng(seed);
  const pts = [];
  const N = 16;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 0.86 + rng() * 0.22 + (i % 4 === 0 ? 0.08 : 0);
    pts.push([50 + Math.cos(a) * 46 * r, 50 + Math.sin(a) * 34 * r]);
  }
  let d = `M${(pts[0][0] + pts.at(-1)[0]) / 2} ${(pts[0][1] + pts.at(-1)[1]) / 2}`;
  for (let i = 0; i < N; i++) {
    const p = pts[i], q = pts[(i + 1) % N];
    d += ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${((p[0] + q[0]) / 2).toFixed(1)} ${((p[1] + q[1]) / 2).toFixed(1)}`;
  }
  splatCache.set(seed, d + 'Z');
  return d + 'Z';
}

/** A train card. color: card color id or 'loco'. */
export function cardEl(color, { size = 'md', count = null, cls = '' } = {}) {
  const info = colorInfo(color);
  const isLoco = color === LOCO;
  const seed = [...color].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  const art = ART.cards[color];
  const face = el('div', { class: 'face', style: isLoco ? {} : { '--c': info.hex, '--cd': info.dark } },
    el('svg', { class: 'splat', viewBox: '0 0 100 100', preserveAspectRatio: 'none' }, el('path', { d: splatPath(seed) })),
    art ? el('img', { class: 'art' + (isLoco ? ' photo' : ''), src: art, alt: '', draggable: 'false' }) : null,
    el('div', { class: 'corner tl' }, shapeSvg(info.shape)),
    el('div', { class: 'corner br' }, shapeSvg(info.shape)),
    el('div', { class: 'cname', text: isLoco ? 'LOCO!' : info.name.toUpperCase() }),
  );
  const card = el('div', { class: `card ${size} ${isLoco ? 'loco' : ''} ${color === 'white' ? 'whitecard' : ''} ${cls}`, dataset: { color } }, face);
  if (count != null) card.append(el('div', { class: 'badge', text: '×' + count }));
  return card;
}

export function cardBackEl({ size = 'md', cls = '' } = {}) {
  if (ART.back) return el('div', { class: `card back ${size} ${cls}` }, el('div', { class: 'face' }, el('img', { class: 'backimg', src: ART.back, alt: '' })));
  return el('div', { class: `card back ${size} ${cls}` },
    el('div', { class: 'face' },
      el('svg', { class: 'splat', viewBox: '0 0 100 100', preserveAspectRatio: 'none' }, el('path', { d: splatPath(999) })),
      el('div', { class: 'backtext' }, el('span', { text: 'TRAIN' }), el('span', { text: 'GAME!' }))));
}

/** Destination ticket. board: for city names/positions; geoThumb: background thumbnail data URL. */
export function ticketEl(t, board, { done = false, failed = false, onHover, cls = '' } = {}) {
  const a = board.cities.find((c) => c.id === t.a), b = board.cities.find((c) => c.id === t.b);
  const W = board.width, H = board.height;
  const map = el('svg', { class: 'tmap', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid slice' },
    ART.ticketThumb ? el('image', { href: ART.ticketThumb, x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none' }) : null,
    el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'tline' }),
    el('circle', { cx: a.x, cy: a.y, r: 95, class: 'tdot' }),
    el('circle', { cx: b.x, cy: b.y, r: 95, class: 'tdot' }));
  const node = el('div', { class: `ticket ${t.long ? 'long' : ''} ${done ? 'done' : ''} ${failed ? 'failed' : ''} ${cls}`, dataset: { id: t.id } },
    map,
    el('div', { class: 'tnames' }, el('span', { text: a.name }), el('span', { class: 'arrow', text: '→' }), el('span', { text: b.name })),
    el('div', { class: 'tvalue', text: String(t.value) }),
    done ? el('div', { class: 'stamp', text: 'DONE!' }) : failed ? el('div', { class: 'stamp bad', text: 'NOPE' }) : null);
  if (onHover) {
    node.addEventListener('mouseenter', () => onHover([t.a, t.b]));
    node.addEventListener('mouseleave', () => onHover([]));
  }
  return node;
}
