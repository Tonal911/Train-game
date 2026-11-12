// All sounds are synthesized with WebAudio (no audio files needed).
// Drop files into /assets/overrides/ to replace any of them:
//   sfx-intro.mp3  sfx-fart.mp3  sfx-thud.mp3  sfx-fanfare.mp3  sfx-loser.mp3
const AC = window.AudioContext || window.webkitAudioContext;
export const ctx = AC ? new AC() : null;
const master = ctx ? ctx.createGain() : null;
if (master) { master.gain.value = 0.9; master.connect(ctx.destination); }

const overrides = {};
/** Strip leading silence so overrides (e.g. a meme mp3) fire instantly. */
function trimLead(buf, thr = 0.02) {
  const d = buf.getChannelData(0);
  let i = 0;
  while (i < d.length && Math.abs(d[i]) < thr) i++;
  i = Math.max(0, i - Math.floor(buf.sampleRate * 0.005));
  if (i < buf.sampleRate * 0.01) return buf;
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length - i, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) out.getChannelData(c).set(buf.getChannelData(c).subarray(i));
  return out;
}
/** Resolves once override sounds are decoded (or after 6 s, whichever first). */
export const ready = Promise.race([
  fetch('/api/overrides').then((r) => r.json()).then(async ({ files = [] }) => {
    await Promise.all(files.map(async (f) => {
      const m = /^sfx-([a-z]+)\.(mp3|ogg|wav)$/i.exec(f);
      if (!m || !ctx) return;
      try {
        const data = await (await fetch('/assets/overrides/' + f)).arrayBuffer();
        const buf = await new Promise((res, rej) => { const p = ctx.decodeAudioData(data, res, rej); if (p && p.then) p.then(res, rej); });
        overrides[m[1].toLowerCase()] = trimLead(buf);
      } catch { /* ignore broken file */ }
    }));
  }).catch(() => {}),
  new Promise((res) => setTimeout(res, 6000)),
]);

function playBuffer(buf, gain = 1) {
  const src = ctx.createBufferSource(); src.buffer = buf;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(g).connect(master); src.start();
  return { stop: () => { try { src.stop(); } catch {} } };
}

export function unlocked() { return !!ctx && ctx.state === 'running'; }
export function unlock() { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); }

function noiseBuffer(sec) {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * sec), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function reverb(sec = 2.6, decay = 2.2) {
  const conv = ctx.createConvolver();
  const len = Math.ceil(ctx.sampleRate * sec);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  conv.buffer = b;
  return conv;
}

// ---------- intro swell: dozens of detuned saws wandering, then converging on a huge D chord ----------
let swell = null;
export function introSwell() {
  if (!ctx || swell) return;
  if (overrides.intro) { swell = playBuffer(overrides.intro, 1); return; }
  const t0 = ctx.currentTime + 0.05;
  const out = ctx.createGain(); out.gain.setValueAtTime(0.0001, t0);
  out.gain.exponentialRampToValueAtTime(0.35, t0 + 5);
  out.gain.linearRampToValueAtTime(0.55, t0 + 11);
  out.gain.setValueAtTime(0.55, t0 + 15.5);
  out.gain.exponentialRampToValueAtTime(0.0001, t0 + 20);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(500, t0); lp.frequency.exponentialRampToValueAtTime(9000, t0 + 11);
  out.connect(lp).connect(master);
  const targets = [36.71, 73.42, 110, 146.83, 220, 293.66, 440, 587.33, 880, 1174.66, 1760];
  const oscs = [];
  for (let i = 0; i < 30; i++) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const start = 200 + Math.random() * 200;
    o.frequency.setValueAtTime(start, t0);
    // random wander for the first ~5 s
    let f = start;
    for (let k = 1; k <= 10; k++) { f = Math.max(150, Math.min(450, f + (Math.random() - 0.5) * 60)); o.frequency.linearRampToValueAtTime(f, t0 + k * 0.5); }
    const target = targets[i % targets.length] * (1 + (Math.random() - 0.5) * 0.004);
    o.frequency.exponentialRampToValueAtTime(target, t0 + 11);
    const g = ctx.createGain(); g.gain.value = 0.035;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.random() * 2 - 1; o.connect(g).connect(pan).connect(out); } else o.connect(g).connect(out);
    o.start(t0); o.stop(t0 + 20.2);
    oscs.push(o);
  }
  swell = { stop: () => { out.gain.cancelScheduledValues(ctx.currentTime); out.gain.setValueAtTime(0, ctx.currentTime); oscs.forEach((o) => { try { o.stop(); } catch {} }); } };
}
export function stopSwell() { swell?.stop(); swell = 'done'; }
export function swellStarted() { return !!swell; }

// ---------- reverb-drenched meme fart ----------
export function fart() {
  if (!ctx) return;
  unlock();
  if (overrides.fart) return playBuffer(overrides.fart, 1);
  const t = ctx.currentTime, dur = 1.1;
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(110, t);
  o.frequency.linearRampToValueAtTime(70, t + dur * 0.6);
  o.frequency.linearRampToValueAtTime(95, t + dur * 0.8);
  o.frequency.linearRampToValueAtTime(55, t + dur);
  const flutter = ctx.createOscillator(); flutter.frequency.setValueAtTime(28, t); flutter.frequency.linearRampToValueAtTime(14, t + dur);
  const fg = ctx.createGain(); fg.gain.value = 40; flutter.connect(fg).connect(o.frequency);
  const am = ctx.createGain(); am.gain.value = 0.5;
  const amOsc = ctx.createOscillator(); amOsc.type = 'square'; amOsc.frequency.setValueAtTime(32, t); amOsc.frequency.linearRampToValueAtTime(18, t + dur);
  const amDepth = ctx.createGain(); amDepth.gain.value = 0.5; amOsc.connect(amDepth).connect(am.gain);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 6;
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(dur);
  const nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 180; nb.Q.value = 1.4;
  const ng = ctx.createGain(); ng.gain.value = 0.5;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(1, t + 0.006); env.gain.setValueAtTime(1, t + dur * 0.75); env.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(am).connect(lp).connect(env);
  n.connect(nb).connect(ng).connect(env);
  const dry = ctx.createGain(); dry.gain.value = 0.8;
  const wet = ctx.createGain(); wet.gain.value = 0.9;
  const rv = reverb(3.2, 1.8);
  const delay = ctx.createDelay(1); delay.delayTime.value = 0.32;
  const fb = ctx.createGain(); fb.gain.value = 0.5;
  env.connect(dry).connect(master);
  env.connect(rv).connect(wet).connect(master);
  env.connect(delay); delay.connect(fb).connect(delay); delay.connect(wet);
  for (const x of [o, flutter, amOsc, n]) { x.start(t); x.stop(t + dur + 0.05); }
}

// ---------- game sounds ----------
export function thud(gain = 1) {
  if (!ctx || ctx.state !== 'running') return;
  if (overrides.thud) return playBuffer(overrides.thud, gain);
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.22);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.9 * gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  o.connect(g).connect(master); o.start(t); o.stop(t + 0.32);
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(0.2);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
  const ng = ctx.createGain(); ng.gain.setValueAtTime(0.6 * gain, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  n.connect(lp).connect(ng).connect(master); n.start(t);
}

function blip(freq, dur, type = 'square', gain = 0.12, when = 0) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
export const tick = () => blip(1500 + Math.random() * 300, 0.025, 'square', 0.05);
export function lock() { blip(880, 0.08, 'triangle', 0.3); blip(1320, 0.06, 'square', 0.08, 0.01); }

export function drumroll(sec = 2) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(sec);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
  const g = ctx.createGain(); g.gain.value = 0;
  const trem = ctx.createOscillator(); trem.type = 'square'; trem.frequency.value = 22;
  const td = ctx.createGain(); td.gain.value = 0.15; trem.connect(td).connect(g.gain);
  const env = ctx.createGain(); env.gain.setValueAtTime(0.4, t); env.gain.linearRampToValueAtTime(1.2, t + sec);
  n.connect(bp).connect(g).connect(env).connect(master);
  n.start(t); trem.start(t); trem.stop(t + sec); n.stop(t + sec);
}

export function fanfare() {
  if (!ctx || ctx.state !== 'running') return;
  if (overrides.fanfare) return playBuffer(overrides.fanfare);
  const notes = [[523, 0, 0.14], [659, 0.15, 0.14], [784, 0.3, 0.14], [1047, 0.45, 0.6], [784, 0.75, 0.12], [1047, 0.9, 0.9]];
  for (const [f, w, d] of notes) { blip(f, d, 'square', 0.12, w); blip(f / 2, d, 'triangle', 0.18, w); }
}

export function sadTrombone() {
  if (!ctx || ctx.state !== 'running') return;
  if (overrides.loser) return playBuffer(overrides.loser);
  const t = ctx.currentTime;
  const seq = [[311, 0, 0.45], [294, 0.5, 0.45], [277, 1.0, 0.45], [262, 1.5, 1.4]];
  for (const [f, w, d] of seq) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    if (d > 1) { const v = ctx.createOscillator(); v.frequency.value = 6; const vg = ctx.createGain(); vg.gain.value = 8; v.connect(vg).connect(o.frequency); v.start(t + w); v.stop(t + w + d); }
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + w); g.gain.linearRampToValueAtTime(0.25, t + w + 0.05); g.gain.setValueAtTime(0.25, t + w + d - 0.1); g.gain.linearRampToValueAtTime(0.0001, t + w + d);
    o.connect(lp).connect(g).connect(master); o.start(t + w); o.stop(t + w + d + 0.05);
  }
}

// ---------- loco "speech": 3-5 random toots of a 3-note locomotive horn chord ----------
export function hornSpeech() {
  if (!ctx || ctx.state !== 'running') return;
  if (overrides.horn) {
    const n = 3 + Math.floor(Math.random() * 3);
    let w = 0;
    for (let i = 0; i < n; i++) {
      const src = ctx.createBufferSource(); src.buffer = overrides.horn;
      src.playbackRate.value = 0.8 + Math.random() * 0.5;
      const g = ctx.createGain(); g.gain.value = 0.6;
      src.connect(g).connect(master);
      const dur = Math.min(overrides.horn.duration, 0.15 + Math.random() * 0.25);
      src.start(ctx.currentTime + w, 0, dur);
      w += dur + 0.05 + Math.random() * 0.08;
    }
    return;
  }
  const chord = [311.1, 370, 466.2]; // classic 3-chime horn: Eb4 F#4 Bb4
  const n = 3 + Math.floor(Math.random() * 3);
  let w = ctx.currentTime + 0.02;
  for (let i = 0; i < n; i++) {
    const dur = 0.11 + Math.random() * 0.26;
    const pitch = 0.82 + Math.random() * 0.42;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, w);
    out.gain.exponentialRampToValueAtTime(0.16, w + 0.025);
    out.gain.setValueAtTime(0.16, w + dur - 0.04);
    out.gain.exponentialRampToValueAtTime(0.0001, w + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 2;
    out.connect(lp).connect(master);
    for (const f of chord) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * pitch, w);
      o.frequency.linearRampToValueAtTime(f * pitch * (Math.random() < 0.5 ? 0.94 : 1.05), w + dur); // speech-like inflection
      o.connect(out); o.start(w); o.stop(w + dur + 0.02);
    }
    w += dur + 0.04 + Math.random() * 0.09;
  }
}

// ---------- card draw: a quick papery "fwip" ----------
export function cardDraw(gain = 1) {
  if (!ctx || ctx.state !== 'running') return;
  if (overrides.card) return playBuffer(overrides.card, gain);
  const t = ctx.currentTime;
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(0.12);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(1200, t); bp.frequency.exponentialRampToValueAtTime(5200, t + 0.09);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * gain, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  n.connect(bp).connect(g).connect(master); n.start(t); n.stop(t + 0.12);
  blip(2400, 0.02, 'triangle', 0.05 * gain, 0.06);
}
