// "MS Paint over a real atlas" background renderer.
// Layers: pale atlas underneath -> sloppy flat primary country fills (jittered edges leave atlas slivers)
// -> blue ocean painted back over with soft edges -> light-blue zigzag waves -> dark-shade mountain zigzags
// -> doodles. All randomness is seeded, so every client sees the same painting.
import { makeRng } from '/shared/rng.js';
import { landMaskFor } from '/shared/mapgen.js';
import { pointInRing } from '/shared/geom.js';

export const PAINT = {
  ocean: '#1f1fff', wave: '#45b4ff', atlasLand: '#d5ebb8', atlasSand: '#efe6c4', atlasWater: '#8fd0ff',
  countries: {
    us: { fill: '#ff1c1c', dark: '#a50000', light: '#ff6b4a' },
    ca: { fill: '#ffd400', dark: '#b08a00', light: '#fff176' },
    mx: { fill: '#20b520', dark: '#0b6a0b', light: '#7be07b' },
    other: { fill: '#20b520', dark: '#0b6a0b', light: '#7be07b' },
  },
};

function noiseFn(rng) {
  const f = [0.011, 0.027, 0.061, 0.13].map((k) => k * (0.8 + rng() * 0.4));
  const ph = f.map(() => rng() * Math.PI * 2);
  const amp = [1, 0.55, 0.3, 0.15];
  return (t) => f.reduce((s, k, i) => s + Math.sin(t * k + ph[i]) * amp[i], 0) / 2;
}

/** Resample a ring at ~step spacing and push points along the normal by smooth noise. */
function jitterRing(ring, amp, rng, step = 10) {
  const n = noiseFn(rng);
  const pts = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(L / step));
    for (let j = 0; j < k; j++) pts.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (pts.length < 3) return ring;
  let arc = 0;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[(i - 1 + pts.length) % pts.length], q = pts[(i + 1) % pts.length];
    const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1;
    if (i) arc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const o = n(arc) * amp;
    out.push([pts[i][0] - (dy / L) * o, pts[i][1] + (dx / L) * o]);
  }
  return out;
}

function ringPath(ctx, ring) {
  ctx.moveTo(ring[0][0], ring[0][1]);
  for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i][0], ring[i][1]);
  ctx.closePath();
}

function zigzag(ctx, x, y, w, h, peaks, rng, up = true) {
  ctx.beginPath();
  const step = w / (peaks * 2);
  ctx.moveTo(x, y);
  for (let i = 1; i <= peaks * 2; i++) {
    const yy = i % 2 ? y - (up ? h : -h) * (0.75 + rng() * 0.5) : y + (rng() - 0.5) * h * 0.2;
    ctx.lineTo(x + step * i + (rng() - 0.5) * step * 0.4, yy);
  }
  ctx.stroke();
}

export function paintBackground(canvas, geo, board, scale = 1) {
  const W = geo.width, H = geo.height;
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const rng = makeRng(4242);
  const mask = landMaskFor(geo);

  // 1. atlas underlay (what peeks through the sloppy paint)
  ctx.fillStyle = PAINT.atlasWater;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = PAINT.atlasLand;
  for (const c of geo.land) for (const poly of c.polys) { ctx.beginPath(); poly.forEach((r) => ringPath(ctx, r)); ctx.fill('evenodd'); }
  ctx.fillStyle = PAINT.atlasSand;
  for (const r of board?.terrain?.deserts || []) { ctx.beginPath(); ringPath(ctx, r); ctx.fill(); }
  ctx.strokeStyle = 'rgba(160,110,170,0.55)';
  ctx.lineWidth = 1.6;
  for (const b of geo.borders) { ctx.beginPath(); ctx.moveTo(...b[0]); b.slice(1).forEach((p) => ctx.lineTo(...p)); ctx.stroke(); }

  // 2. country paint: jittered fill + fat round brush along the edge
  const jittered = [];
  for (const c of geo.land) {
    const col = PAINT.countries[c.id] || PAINT.countries.other;
    for (const poly of c.polys) {
      const outer = poly[0];
      const big = outer.length > 30;
      const jr = jitterRing(outer, big ? 11 : 4, rng);
      jittered.push(jr);
      ctx.fillStyle = col.fill;
      ctx.strokeStyle = col.fill;
      ctx.beginPath(); ringPath(ctx, jr); ctx.fill();
      ctx.lineWidth = big ? 12 : 6;
      // skip random stretches of the brush so slivers survive
      for (let i = 0; i < jr.length - 1; ) {
        const run = 8 + rng.int(40);
        if (rng() < 0.75) {
          ctx.beginPath(); ctx.moveTo(...jr[i]);
          for (let k = 1; k <= run && i + k < jr.length; k++) ctx.lineTo(...jr[i + k]);
          ctx.stroke();
        }
        i += run;
      }
    }
  }

  // 3. ocean repainted over everything that isn't land, with soft edges
  const sea = document.createElement('canvas');
  sea.width = canvas.width; sea.height = canvas.height;
  const sctx = sea.getContext('2d');
  sctx.setTransform(scale, 0, 0, scale, 0, 0);
  sctx.fillStyle = PAINT.ocean;
  sctx.fillRect(0, 0, W, H);
  sctx.globalCompositeOperation = 'destination-out';
  sctx.lineJoin = 'round';
  for (const c of geo.land) for (const poly of c.polys) {
    const jr = jitterRing(poly[0], poly[0].length > 30 ? 9 : 3, rng);
    sctx.beginPath(); ringPath(sctx, jr); sctx.fill();
    sctx.lineWidth = 5; sctx.stroke();
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = `blur(${Math.max(0.6, 2.2 * scale)}px)`;
  ctx.drawImage(sea, 0, 0);
  ctx.filter = 'none';
  ctx.drawImage(sea, 0, 0); // second pass keeps the blue solid, blur leaves the feathered rim
  ctx.restore();

  // 4. lakes
  for (const lake of geo.lakes) for (const poly of lake.polys) {
    const jr = jitterRing(poly[0], poly[0].length > 25 ? 5 : 2, rng, 8);
    ctx.fillStyle = PAINT.ocean; ctx.strokeStyle = PAINT.ocean; ctx.lineWidth = 4;
    ctx.beginPath(); ringPath(ctx, jr); ctx.fill(); ctx.stroke();
  }

  // 5. waves: light-blue zigzags in open water
  ctx.strokeStyle = PAINT.wave;
  ctx.lineWidth = 11;
  const oceanAt = (x, y) => x > 0 && y > 0 && x < W && y < H && !mask.at(x, y);
  for (let i = 0; i < 900; i++) {
    const x = rng() * W, y = rng() * H;
    const w = 90 + rng() * 80, h = 34 + rng() * 26;
    const ok = [[0, 0], [w, 0], [w / 2, -h], [0, -h], [w, -h], [w / 2, 20], [-20, 0], [w + 20, 0]].every(([dx, dy]) => oceanAt(x + dx, y + dy));
    if (!ok) continue;
    ctx.save(); ctx.translate(x + w / 2, y - h / 2); ctx.rotate(-0.9 + rng() * 0.5); ctx.translate(-w / 2, h / 2);
    zigzag(ctx, 0, 0, w, h, 1 + rng.int(2), rng);
    ctx.restore();
    if (i > 900) break;
  }
  // big lakes get a wave or two
  for (const lake of geo.lakes) for (const poly of lake.polys) {
    if (poly[0].length < 60) continue;
    const xs = poly[0].map((p) => p[0]), ys = poly[0].map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    if (!pointInRing([cx, cy], poly[0])) continue;
    ctx.lineWidth = 7;
    zigzag(ctx, cx - 30, cy + 8, 60, 18, 1, rng);
  }

  // 6. country of a point (for mountain shading)
  const countryAt = (x, y) => {
    for (const c of geo.land) for (const poly of c.polys) if (pointInRing([x, y], poly[0])) return c.id;
    return null;
  };

  // deserts: lighter scribbles
  for (const r of board?.terrain?.deserts || []) {
    const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
    for (let i = 0; i < 70; i++) {
      const x = Math.min(...xs) + rng() * (Math.max(...xs) - Math.min(...xs)), y = Math.min(...ys) + rng() * (Math.max(...ys) - Math.min(...ys));
      if (!pointInRing([x, y], r) || !mask.at(x, y)) continue;
      const col = PAINT.countries[countryAt(x, y)] || PAINT.countries.us;
      ctx.strokeStyle = col.light; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 20, y - 14 + rng() * 28, x + 44 + rng() * 20, y + rng() * 8); ctx.stroke();
    }
  }

  // 7. mountains: rows of dark zigzag peaks like a kid drew the Rockies
  for (const r of board?.terrain?.mountains || []) {
    const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    for (let y = y0 + 50; y < y1; y += 62) {
      for (let x = x0 + ((y / 62) % 2) * 40; x < x1; x += 96) {
        const px = x + (rng() - 0.5) * 30, py = y + (rng() - 0.5) * 20;
        if (!pointInRing([px + 40, py - 20], r) || !mask.at(px + 40, py)) continue;
        const col = PAINT.countries[countryAt(px + 40, py)] || PAINT.countries.us;
        ctx.strokeStyle = col.dark; ctx.lineWidth = 8;
        zigzag(ctx, px, py, 80 + rng() * 26, 40 + rng() * 22, 2, rng);
      }
    }
  }

  // 8. doodles
  drawDoodles(ctx, W, H, rng, oceanAt);
}

function drawDoodles(ctx, W, H, rng, oceanAt) {
  // sun, top-right Atlantic
  ctx.save();
  ctx.translate(W - 170, 150);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 7; ctx.fillStyle = '#ffe600';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * 82, Math.sin(a) * 82); ctx.lineTo(Math.cos(a) * (118 + rng() * 22), Math.sin(a) * (118 + rng() * 22));
    ctx.strokeStyle = '#ffe600'; ctx.lineWidth = 14; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(0, 0, 72, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 6; ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(-24, -14, 8, 0, 7); ctx.arc(24, -14, 8, 0, 7); ctx.fill();
  ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 6, 34, 0.2, Math.PI - 0.2); ctx.stroke();
  ctx.restore();

  // fish in the Gulf / Atlantic
  const fish = (x, y, s, flip) => {
    if (!oceanAt(x, y)) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(flip ? -s : s, s);
    ctx.fillStyle = '#ff8c00'; ctx.strokeStyle = '#000'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(0, 0, 46, 24, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(40, 0); ctx.lineTo(74, -24); ctx.lineTo(74, 24); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-22, -6, 9, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(-24, -6, 3.5, 0, 7); ctx.fill();
    ctx.restore();
  };
  fish(2350, 2560, 1, false);
  fish(3600, 1900, 0.9, true);
  fish(300, 2300, 1.1, true);

  // compass "N" arrow, Pacific
  ctx.save(); ctx.translate(170, 1650);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(0, -90); ctx.lineTo(34, 30); ctx.lineTo(0, 8); ctx.lineTo(-34, 30); ctx.closePath(); ctx.fill(); ctx.stroke();
  outlineText(ctx, 'N', 0, 92, 64, '#fff', '#000');
  ctx.restore();

  // title cartouche, bottom-left Pacific
  ctx.save(); ctx.translate(430, 2560); ctx.rotate(-0.06);
  ctx.fillStyle = '#fff36b';
  ctx.filter = 'blur(6px)';
  for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.ellipse((rng() - 0.5) * 360, (rng() - 0.5) * 70, 120 + rng() * 60, 60 + rng() * 20, 0, 0, 7); ctx.fill(); }
  ctx.filter = 'none';
  outlineText(ctx, 'TRAIN GAME!', 0, 34, 104, '#ff1c1c', '#fff', 16);
  ctx.restore();
}

export function outlineText(ctx, text, x, y, size, fill, stroke, width = size * 0.16) {
  ctx.font = `bold ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/** Paint-style sky + grass backdrop (home/lobby screens), echoing the title art. */
export function paintSky(canvas) {
  const w = (canvas.width = innerWidth), h = (canvas.height = innerHeight);
  const ctx = canvas.getContext('2d');
  const rng = makeRng(77);
  ctx.fillStyle = '#2b8cff'; ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'round';
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.15 + rng() * 0.35})`; ctx.lineWidth = 6 + rng() * 18;
    const x = rng() * w, y = rng() * h * 0.8;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 30 + rng() * 60, y - 20 - rng() * 40); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.filter = 'blur(4px)';
  for (let c = 0; c < 4; c++) {
    const cx = rng() * w, cy = 40 + rng() * h * 0.35;
    for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.arc(cx + (rng() - 0.5) * 220, cy + (rng() - 0.5) * 50, 40 + rng() * 40, 0, 7); ctx.fill(); }
  }
  ctx.filter = 'none';
  ctx.fillStyle = '#17c217';
  ctx.beginPath(); ctx.moveTo(0, h * 0.82);
  for (let x = 0; x <= w + 40; x += 40) ctx.lineTo(x, h * 0.8 + Math.sin(x / 90) * 10 + rng() * 8);
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#555'; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.moveTo(0, h * 0.9); ctx.lineTo(w, h * 0.88); ctx.stroke();
  ctx.strokeStyle = '#b5121b'; ctx.lineWidth = 9;
  for (let x = 10; x < w; x += 46) { ctx.beginPath(); ctx.moveTo(x, h * 0.9 - 12); ctx.lineTo(x + 18, h * 0.9 + 16); ctx.stroke(); }
}
