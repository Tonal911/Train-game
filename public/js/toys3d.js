// Little plastic toy wagons built in three.js, rendered once to transparent PNGs and turned into
// "squeezed cutout" stickers (white jagged outline + hard shadow). Used for card art and map pieces.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeRng } from '/shared/rng.js';

const mat = (hex, o = {}) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.36, metalness: 0.04, ...o });
const shade = (hex, f) => {
  const c = new THREE.Color(hex);
  const hsl = {}; c.getHSL(hsl);
  return c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * f)));
};
const box = (w, h, d, m, r = 0) => new THREE.Mesh(r ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d), m);
const cyl = (rt, rb, h, m, seg = 20) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
function at(mesh, x, y, z) { mesh.position.set(x, y, z); return mesh; }

function chassis(g, len = 3) {
  const dark = mat('#2b2b2b');
  g.add(at(box(len, 0.22, 1.0, dark, 0.05), 0, 0.5, 0));
  const tire = mat('#141414', { roughness: 0.7 });
  const hub = mat('#ffcc00');
  for (const x of [-len / 2 + 0.55, len / 2 - 0.55]) for (const z of [-0.52, 0.52]) {
    const w = cyl(0.3, 0.3, 0.16, tire); w.rotation.x = Math.PI / 2; g.add(at(w, x, 0.32, z));
    const h = cyl(0.13, 0.13, 0.2, hub, 12); h.rotation.x = Math.PI / 2; g.add(at(h, x, 0.32, z));
  }
  for (const s of [-1, 1]) g.add(at(box(0.22, 0.14, 0.26, dark), s * (len / 2 + 0.08), 0.48, 0));
}

const MODELS = {
  boxcar(g, col) {
    chassis(g);
    const body = mat(col);
    g.add(at(box(3, 1.35, 1.15, body, 0.08), 0, 1.28, 0));
    g.add(at(box(3.12, 0.12, 1.26, mat(shade(col, 0.6)), 0.04), 0, 2.0, 0));
    g.add(at(box(0.95, 1.05, 0.04, mat(shade(col, 0.72))), 0, 1.25, 0.58));
    g.add(at(box(0.08, 1.0, 0.06, mat('#ffffff')), 0.2, 1.25, 0.6));
    for (const x of [-1.15, -0.75, 0.75, 1.15]) g.add(at(box(0.05, 1.2, 0.03, mat(shade(col, 0.8))), x, 1.28, 0.58));
  },
  tanker(g, col) {
    chassis(g);
    const body = mat(col, { roughness: 0.25, metalness: 0.15 });
    const t = cyl(0.62, 0.62, 2.7, body, 28); t.rotation.z = Math.PI / 2; g.add(at(t, 0, 1.2, 0));
    for (const s of [-1, 1]) { const cap = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 16), body); cap.scale.set(0.35, 1, 1); g.add(at(cap, s * 1.35, 1.2, 0)); }
    g.add(at(cyl(0.26, 0.3, 0.32, mat(shade(col, 0.65))), 0, 1.92, 0));
    for (const x of [-0.8, 0.8]) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.63, 0.04, 8, 32), mat('#222')); band.rotation.y = Math.PI / 2; g.add(at(band, x, 1.2, 0)); }
  },
  caboose(g, col) {
    chassis(g, 2.8);
    const body = mat(col);
    g.add(at(box(2.5, 1.2, 1.12, body, 0.08), 0, 1.22, 0));
    g.add(at(box(2.7, 0.1, 1.25, mat('#b5121b')), 0, 1.86, 0));
    g.add(at(box(1.0, 0.55, 0.95, body, 0.05), 0, 2.18, 0));
    g.add(at(box(1.12, 0.09, 1.06, mat('#b5121b')), 0, 2.5, 0));
    const win = mat('#fff6b0', { emissive: '#ffcc44', emissiveIntensity: 0.25 });
    for (const x of [-0.75, 0.75]) g.add(at(box(0.42, 0.38, 0.04, win), x, 1.35, 0.57));
    g.add(at(box(0.5, 0.26, 0.04, win), 0, 2.2, 0.48));
    g.add(at(cyl(0.07, 0.07, 0.5, mat('#222'), 10), 0.9, 2.1, 0));
  },
  logs(g, col) {
    chassis(g);
    g.add(at(box(3.05, 0.26, 1.18, mat(col), 0.05), 0, 0.72, 0));
    for (const x of [-1.3, 1.3]) for (const z of [-0.56, 0.56]) g.add(at(box(0.1, 0.9, 0.1, mat(shade(col, 0.7))), x, 1.25, z));
    const bark = mat('#8a5427', { roughness: 0.8 }), grain = mat('#f0c27a', { roughness: 0.8 });
    const log = (y, z) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.9, 14), [bark, grain, grain]); m.rotation.z = Math.PI / 2; g.add(at(m, 0, y, z)); };
    log(1.07, -0.34); log(1.07, 0.1); log(1.07, 0.52 - 0.0);
    log(1.46, -0.12); log(1.46, 0.31);
  },
  passenger(g, col) {
    chassis(g, 3.2);
    const body = mat(col);
    g.add(at(box(3.2, 1.2, 1.1, body, 0.14), 0, 1.22, 0));
    const rg = new THREE.Group(); const r2 = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 3.2, 20, 1, false, -Math.PI / 2, Math.PI), mat('#e9e9e9'));
    r2.rotation.z = Math.PI / 2; rg.add(r2); rg.scale.set(1, 0.45, 1); g.add(at(rg, 0, 1.8, 0));
    const win = mat('#c9f0ff', { emissive: '#7fd4ff', emissiveIntensity: 0.25, roughness: 0.1 });
    for (let i = 0; i < 5; i++) g.add(at(box(0.36, 0.38, 0.04, win, 0.03), -1.1 + i * 0.55, 1.4, 0.56));
    g.add(at(box(3.18, 0.1, 0.04, mat('#ffd400')), 0, 0.95, 0.56));
  },
  circus(g, col) {
    chassis(g);
    const body = mat(col);
    g.add(at(box(3, 0.24, 1.15, body, 0.05), 0, 0.72, 0));
    for (let i = 0; i < 6; i++) g.add(at(box(0.5, 0.14, 1.24, mat(i % 2 ? '#ffffff' : '#ff2323')), -1.25 + i * 0.5, 2.0, 0));
    for (const x of [-1.45, 1.45]) g.add(at(box(0.1, 1.2, 1.15, body), x, 1.4, 0));
    const bar = mat('#ffd400', { metalness: 0.3, roughness: 0.3 });
    for (let i = 0; i < 9; i++) for (const z of [-0.54, 0.54]) g.add(at(cyl(0.035, 0.035, 1.15, bar, 8), -1.2 + i * 0.3, 1.4, z));
    const lion = new THREE.Group();
    lion.add(new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 14), mat('#ff9a1f')));
    const mane = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.13, 10, 20), mat('#8a3b00')); mane.rotation.y = 0; lion.add(mane);
    for (const s of [-1, 1]) lion.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), mat('#000')), s * 0.11, 0.08, 0.29));
    lion.rotation.y = 0.3;
    g.add(at(lion, 0.2, 1.3, 0.1));
  },
  hopper(g, col) {
    chassis(g);
    const body = mat(col, { roughness: 0.45, metalness: 0.2 });
    const geo = new THREE.CylinderGeometry(0.85, 0.5, 1.15, 4, 1); geo.rotateY(Math.PI / 4);
    const h = new THREE.Mesh(geo, body); h.scale.set(2.35, 1, 1.05); g.add(at(h, 0, 1.25, 0));
    const coal = mat('#0d0d0d', { roughness: 0.9 });
    const rng = makeRng(9);
    for (let i = 0; i < 26; i++) {
      const r = 0.14 + rng() * 0.14;
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r), coal);
      m.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      const x = (rng() - 0.5) * 2.5, z = (rng() - 0.5) * 0.8;
      g.add(at(m, x, 1.82 + (0.25 - Math.abs(x) * 0.12 - Math.abs(z) * 0.2) + rng() * 0.08, z));
    }
  },
  reefer(g, col) {
    chassis(g);
    g.add(at(box(3, 1.35, 1.15, mat(col), 0.1), 0, 1.28, 0));
    g.add(at(box(3.02, 0.22, 1.17, mat('#2366ff')), 0, 1.5, 0));
    g.add(at(box(3.12, 0.1, 1.24, mat('#9a9a9a'), 0.03), 0, 1.99, 0));
    g.add(at(box(0.5, 0.3, 0.5, mat('#bff3ff', { emissive: '#5fd8ff', emissiveIntensity: 0.3, roughness: 0.1 }), 0.06), 0.8, 2.2, 0));
    g.add(at(box(0.8, 0.95, 0.04, mat('#d0d0d0')), -0.5, 1.2, 0.58));
  },
};

function makeScene() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#8a8a8a', 1.6));
  const key = new THREE.DirectionalLight('#ffffff', 2.4); key.position.set(4, 7, 6); scene.add(key);
  const rim = new THREE.DirectionalLight('#cfe6ff', 1.0); rim.position.set(-5, 3, -4); scene.add(rim);
  return scene;
}

function fitPerspective(camera, group, dir) {
  const bb = new THREE.Box3().setFromObject(group);
  const c = bb.getCenter(new THREE.Vector3()), sphere = bb.getBoundingSphere(new THREE.Sphere());
  const d = sphere.radius / Math.sin((camera.fov * Math.PI) / 360) * 0.98;
  camera.position.copy(c).add(dir.clone().normalize().multiplyScalar(d));
  camera.lookAt(c);
}

/** crop a canvas to its non-transparent pixels */
function trim(src, pad = 2) {
  const ctx = src.getContext('2d', { willReadFrequently: true }) || null;
  let data;
  if (ctx) data = ctx.getImageData(0, 0, src.width, src.height).data;
  else {
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const x = c.getContext('2d'); x.drawImage(src, 0, 0); data = x.getImageData(0, 0, c.width, c.height).data;
  }
  let x0 = src.width, y0 = src.height, x1 = -1, y1 = -1;
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    if (data[(y * src.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return src;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(src.width - 1, x1 + pad); y1 = Math.min(src.height - 1, y1 + pad);
  const out = document.createElement('canvas'); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** sticker-ize a transparent canvas: jagged white outline + hard drop shadow */
function sticker(src, outline, seed) {
  const pad = outline * 2 + 10;
  const out = document.createElement('canvas');
  out.width = src.width + pad * 2; out.height = src.height + pad * 2;
  const ctx = out.getContext('2d');
  const sil = document.createElement('canvas'); sil.width = src.width; sil.height = src.height;
  const sctx = sil.getContext('2d');
  sctx.drawImage(src, 0, 0); sctx.globalCompositeOperation = 'source-in'; sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, sil.width, sil.height);
  const rng = makeRng(seed);
  const shadow = document.createElement('canvas'); shadow.width = out.width; shadow.height = out.height;
  const sh = shadow.getContext('2d');
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2, r = outline * (0.7 + rng() * 0.6);
    sh.drawImage(sil, pad + Math.cos(a) * r, pad + Math.sin(a) * r);
  }
  ctx.globalAlpha = 0.35;
  ctx.filter = 'brightness(0)';
  ctx.drawImage(shadow, outline * 0.6, outline * 0.9);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.drawImage(shadow, 0, 0);
  ctx.drawImage(src, pad, pad);
  return out;
}

function copy2d(src) {
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  c.getContext('2d', { willReadFrequently: true }).drawImage(src, 0, 0);
  return c;
}

function fallback2D(color, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = color; x.strokeStyle = '#000'; x.lineWidth = 6;
  x.beginPath(); x.roundRect(w * 0.08, h * 0.18, w * 0.84, h * 0.5, 14); x.fill(); x.stroke();
  x.fillStyle = '#111';
  for (const cx of [0.25, 0.4, 0.6, 0.75]) { x.beginPath(); x.arc(w * cx, h * 0.75, h * 0.1, 0, 7); x.fill(); }
  return c;
}

/**
 * @param {{id:string,hex:string,model:string}[]} cardColors
 * @param {{id:string,hex:string}[]} playerColors
 * @returns {{cards:Record<string,string>, pieces:Record<string,string>}} data URLs
 */
export function renderToys(cardColors, playerColors) {
  const cards = {}, pieces = {};
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    for (const c of cardColors) cards[c.id] = sticker(fallback2D(c.hex, 480, 330), 8, 1).toDataURL();
    for (const p of playerColors) pieces[p.id] = fallback2D(p.hex, 300, 110).toDataURL();
    return { cards, pieces };
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  // card art: 3/4 view
  renderer.setSize(480, 330, false);
  const cam = new THREE.PerspectiveCamera(26, 480 / 330, 0.1, 100);
  cardColors.forEach((c, i) => {
    const scene = makeScene();
    const g = new THREE.Group();
    (MODELS[c.model] || MODELS.boxcar)(g, c.hex);
    g.rotation.y = -0.18;
    scene.add(g);
    fitPerspective(cam, g, new THREE.Vector3(1.25, 0.8, 2.2));
    renderer.render(scene, cam);
    cards[c.id] = sticker(trim(copy2d(renderer.domElement)), 7, 100 + i).toDataURL('image/png');
  });

  // map pieces: steep top-down so they read when rotated along a route
  renderer.setSize(330, 180, false);
  const ortho = new THREE.OrthographicCamera(-1.75, 1.75, 0.95, -0.95, 0.1, 100);
  playerColors.forEach((p) => {
    const scene = makeScene();
    const g = new THREE.Group();
    MODELS.boxcar(g, p.hex);
    scene.add(g);
    ortho.position.set(0, 6, 4.6); ortho.lookAt(0, 0.9, 0);
    renderer.render(scene, ortho);
    pieces[p.id] = trim(copy2d(renderer.domElement)).toDataURL('image/png');
  });
  renderer.dispose();
  renderer.forceContextLoss?.();
  return { cards, pieces };
}
