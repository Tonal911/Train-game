// Claim animation: real 3D toy wagons fly out of the player's card, swoop up close to the camera,
// then slam down onto each route segment with a dust puff and a thud.
import * as THREE from 'three';
import { MODELS, makeScene } from './toys3d.js';
import { thud } from './sfx.js';

let renderer = null, scene, camera, canvas, failed = false;
let W = innerWidth, H = innerHeight;
const flights = [];
const templates = new Map();
let raf = 0;

function ensure() {
  if (renderer) return true;
  if (failed) return false;
  try {
    canvas = document.createElement('canvas');
    canvas.className = 'fly3d';
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch { failed = true; return false; }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  scene = makeScene();
  camera = new THREE.OrthographicCamera(0, 1, 0, -1, -4000, 4000);
  camera.position.z = 2000;
  document.body.append(canvas);
  resize();
  addEventListener('resize', resize);
  return true;
}
function resize() {
  W = innerWidth; H = innerHeight;
  renderer.setSize(W, H);
  camera.left = 0; camera.right = W; camera.top = 0; camera.bottom = -H;
  camera.updateProjectionMatrix();
}

function wagon(hex) {
  if (!templates.has(hex)) {
    const g = new THREE.Group();
    MODELS.boxcar(g, hex);
    const bb = new THREE.Box3().setFromObject(g);
    const c = bb.getCenter(new THREE.Vector3());
    g.position.sub(c);
    const pivot = new THREE.Group();
    pivot.add(g);
    templates.set(hex, pivot);
  }
  return templates.get(hex).clone(true);
}

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t * t;
const lerp = (a, b, t) => a + (b - a) * t;
const MODEL_LEN = 3.05;

/**
 * @param {{from: DOMRect, segs: {x:number,y:number,ang:number,len:number}[], hex: string, fx: HTMLElement, onLand: (i:number)=>void}} o
 *   segs in screen pixels (ang in degrees, screen-space); returns false when WebGL is unavailable.
 */
export function flyClaim({ from, segs, hex, fx, onLand, onAllLanded }) {
  if (!ensure()) return false;
  const now = performance.now();
  const n = segs.length;
  const sx = from.left + from.width / 2, sy = from.top + from.height / 2;
  const spread = Math.min(150, (W * 0.7) / Math.max(1, n));
  let landed = 0;
  const land = (i) => { onLand?.(i); if (++landed === n) onAllLanded?.(); };
  segs.forEach((seg, i) => {
    const mesh = wagon(hex);
    const qX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const qZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (-seg.ang * Math.PI) / 180);
    const qEnd = qZ.clone().multiply(qX);
    const qMid = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.45, -0.7 + (i % 2 ? 0.25 : -0.25), 0.08));
    scene.add(mesh);
    flights.push({
      mesh, t0: now + i * 110, i, onLand: land, fx, landed: false,
      a: { x: sx, y: sy, s: 26 / MODEL_LEN },
      m: { x: W / 2 + (i - (n - 1) / 2) * spread, y: H * 0.42 + Math.sin(i * 1.7) * 30, s: Math.min(230, spread * 1.5) / MODEL_LEN },
      e: { x: seg.x, y: seg.y, s: Math.max(10, seg.len) / MODEL_LEN },
      qStart: qMid.clone(), qMid, qEnd, spin: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.6),
    });
  });
  if (!raf) raf = requestAnimationFrame(loop);
  return true;
}

function loop(t) {
  for (let k = flights.length - 1; k >= 0; k--) {
    const f = flights[k];
    const dt = t - f.t0;
    const m = f.mesh;
    if (dt < 0) { m.visible = false; continue; }
    m.visible = true;
    let x, y, s;
    const q = new THREE.Quaternion();
    if (dt < 560) { // out of the card, up to the camera
      const p = easeOut(dt / 560);
      x = lerp(f.a.x, f.m.x, p); y = lerp(f.a.y, f.m.y, p) - Math.sin(p * Math.PI) * 120; s = lerp(f.a.s, f.m.s, p);
      q.copy(f.qMid).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (1 - p) * f.spin * 4));
    } else if (dt < 820) { // hover, wobbling, close and huge
      const p = (dt - 560) / 260;
      x = f.m.x; y = f.m.y + Math.sin(p * Math.PI * 2) * 8; s = f.m.s * (1 + Math.sin(p * Math.PI) * 0.06);
      q.copy(f.qMid).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(p * Math.PI * 2) * 0.08));
    } else if (dt < 1180) { // slam down onto the track
      const p = easeIn((dt - 820) / 360);
      x = lerp(f.m.x, f.e.x, p); y = lerp(f.m.y, f.e.y, p); s = lerp(f.m.s, f.e.s, p);
      q.slerpQuaternions(f.qMid, f.qEnd, Math.min(1, p * 1.4));
    } else {
      if (!f.landed) {
        f.landed = true;
        thud(0.8);
        dust(f.fx, f.e.x, f.e.y, f.e.s * MODEL_LEN);
        f.onLand?.(f.i);
      }
      scene.remove(m);
      flights.splice(k, 1);
      continue;
    }
    m.position.set(x, -y, 100 + f.i * 5);
    m.scale.setScalar(s);
    m.quaternion.copy(q);
  }
  renderer.render(scene, camera);
  if (flights.length) raf = requestAnimationFrame(loop);
  else { raf = 0; renderer.clear(); }
}

function dust(fx, x, y, size) {
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const r = Math.max(14, size * 0.35) * (0.4 + Math.random() * 0.4);
    const p = document.createElement('div');
    p.className = 'dust';
    const d = 10 + Math.random() * 14 + size * 0.08;
    Object.assign(p.style, { left: x - d / 2 + 'px', top: y - d / 2 + 'px', width: d + 'px', height: d + 'px', background: Math.random() < 0.5 ? '#d9c7a0' : '#b8b0a4' });
    fx.append(p);
    const dx = Math.cos(a) * (r + size * 0.6), dy = Math.sin(a) * (r + size * 0.25) - 10;
    p.animate([
      { transform: 'translate(0,0) scale(0.4)', opacity: 0.95 },
      { transform: `translate(${dx}px, ${dy}px) scale(1.6)`, opacity: 0 },
    ], { duration: 650 + Math.random() * 250, easing: 'cubic-bezier(.2,.8,.4,1)', fill: 'forwards' }).finished.then(() => p.remove());
  }
}
