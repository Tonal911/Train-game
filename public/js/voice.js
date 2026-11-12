// Rudimentary, intentionally awful voice chat.
// Mic -> decimate to VOICE_RATE with no anti-alias filter -> crush to VOICE_BITS -> 8-bit bytes over the
// game WebSocket -> server relays to the lobby -> receivers play it back with nearest-neighbour upsampling.
import { ctx, unlock } from './sfx.js';
import { VOICE_RATE, VOICE_BITS } from '/shared/config.js';

const CHUNK = Math.round(VOICE_RATE / 10); // 100 ms per packet

const levels = new Map(); // pid -> {until}
export const speaking = (pid) => (levels.get(pid)?.until || 0) > performance.now();

let net = null, myPid = null;
let stream = null, proc = null, src = null, sink = null;
let on = false;
const peers = new Map(); // pid -> {next, gain}
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn(on));
export const isOn = () => on;

export function init(netRef, pid) { net = netRef; myPid = pid; }

export async function toggle() { return on ? stop() : start(); }

export async function start() {
  if (on || !ctx) return false;
  unlock();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (e) {
    throw new Error(location.protocol !== 'https:' && location.hostname !== 'localhost' ? 'Mic needs https.' : 'Mic permission denied.');
  }
  src = ctx.createMediaStreamSource(stream);
  proc = ctx.createScriptProcessor(2048, 1, 1);
  sink = ctx.createGain(); sink.gain.value = 0;
  const step = ctx.sampleRate / VOICE_RATE;
  const levels2 = 1 << (VOICE_BITS - 1);
  let acc = 0, buf = new Uint8Array(CHUNK), n = 0, hang = 0;
  proc.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    for (; acc < input.length; acc += step) {
      const v = Math.max(-1, Math.min(1, input[Math.floor(acc)] * 1.6));
      const crushed = Math.round(v * levels2) / levels2;
      buf[n++] = Math.max(0, Math.min(255, Math.round(crushed * 127 + 128)));
      if (n === CHUNK) {
        let sum = 0;
        for (let i = 0; i < CHUNK; i++) { const x = (buf[i] - 128) / 128; sum += x * x; }
        const rms = Math.sqrt(sum / CHUNK);
        if (rms > 0.025) hang = 4;
        if (hang > 0) {
          hang--;
          net.sendBinary(buf.slice().buffer);
          levels.set(myPid, { until: performance.now() + 250 });
        }
        n = 0;
      }
    }
    acc -= input.length;
  };
  src.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
  on = true;
  net.send({ t: 'voice', on: true });
  emit();
  return true;
}

export function stop() {
  if (!on) return false;
  try { proc.disconnect(); src.disconnect(); sink.disconnect(); } catch {}
  stream?.getTracks().forEach((t) => t.stop());
  stream = proc = src = sink = null;
  on = false;
  net?.send({ t: 'voice', on: false });
  emit();
  return false;
}

/** Incoming relayed frame: 12 bytes sender pid (ascii) + 8-bit samples at VOICE_RATE. */
export function receive(arrayBuffer) {
  if (!ctx || ctx.state !== 'running') return;
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length < 13) return;
  const pid = String.fromCharCode(...bytes.subarray(0, 12)).trim();
  const data = bytes.subarray(12);
  // nearest-neighbour upsample straight to the device rate: valid in every browser, keeps the crunch
  const up = ctx.sampleRate / VOICE_RATE;
  const out = ctx.createBuffer(1, Math.ceil(data.length * up), ctx.sampleRate);
  const ch = out.getChannelData(0);
  let sum = 0;
  for (let i = 0; i < ch.length; i++) { const x = (data[Math.floor(i / up)] - 128) / 128; ch[i] = x; sum += x * x; }
  if (Math.sqrt(sum / ch.length) > 0.02) levels.set(pid, { until: performance.now() + 250 });
  let p = peers.get(pid);
  if (!p) { p = { next: 0, gain: ctx.createGain() }; p.gain.gain.value = 1.4; p.gain.connect(ctx.destination); peers.set(pid, p); }
  const now = ctx.currentTime;
  if (p.next < now + 0.05) p.next = now + 0.12; // (re)start with a little jitter buffer
  if (p.next > now + 0.8) return; // too far behind: drop
  const s = ctx.createBufferSource(); s.buffer = out; s.connect(p.gain); s.start(p.next);
  p.next += out.duration;
}
