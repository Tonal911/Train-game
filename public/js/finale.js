// Party-style results show: the loco presents every score on slot-machine reels, worst first,
// then the final two at once. He's lovely to everyone except second place.
import { el } from './util.js';
import * as sfx from './sfx.js';
import { PLAYER_COLORS } from '/shared/config.js';

const PHEX = Object.fromEntries(PLAYER_COLORS.map((c) => [c.id, c.hex]));
const PLACE = ['1st', '2nd', '3rd', '4th', '5th'];
const NICE = [
  'Wonderful work, {n}! My boiler is bursting with pride!',
  '{n}, you are a first-class passenger in my heart!',
  'Look at that, {n}! Full steam ahead, superstar!',
  '{n}! You make every mile of track worth it!',
  'Bravo, {n}! I would blow my whistle for you any day!',
];
const WINNER = '{n}!!! You magnificent legend! CHOO CHOO!!';
const LOSER = '{n}... you are a complete and utter loser.';
const fill = (s, n) => s.replace('{n}', n);

export function runFinale({ parent, rows, onDone }) {
  let cancelled = false;
  const timers = new Set();
  const wait = (ms) => new Promise((res) => { const t = setTimeout(() => { timers.delete(t); res(); }, ms); timers.add(t); });
  let ticking = null;

  const bubble = el('div', { class: 'fin-bubble' });
  const loco = el('div', { class: 'fin-loco' }, el('img', { src: '/assets/lococutout.png', alt: '' }), bubble);
  const history = el('div', { class: 'fin-history' });
  const stage = el('div', { class: 'fin-stage' });
  const skip = el('button', { class: 'btn fin-skip', text: 'SKIP ▸', onclick: () => finish() });
  const root = el('div', { class: 'finale' }, el('div', { class: 'fin-rays' }), history, stage, loco, skip);
  parent.append(root);

  function say(text, cls = '') {
    bubble.className = 'fin-bubble show ' + cls;
    bubble.textContent = '';
    let i = 0;
    const step = () => { if (cancelled) return; bubble.textContent = text.slice(0, ++i); if (i < text.length) { const t = setTimeout(step, 22); timers.add(t); } };
    step();
    loco.classList.remove('talk'); void loco.offsetWidth; loco.classList.add('talk');
    sfx.hornSpeech();
  }

  function card(r, big = true) {
    const digits = String(Math.abs(r.total)).split('');
    const reels = digits.map((d) => {
      const strip = el('div', { class: 'strip' }, ...Array.from({ length: 30 }, (_, k) => el('span', { text: String(k % 10) })));
      const reel = el('div', { class: 'reel rolling' }, strip);
      reel.style.setProperty('--spd', (0.09 + Math.random() * 0.06).toFixed(3) + 's');
      return { reel, strip, d: +d };
    });
    const sign = el('div', { class: 'sign', text: r.total < 0 ? '−' : '' });
    const node = el('div', { class: 'fin-card' + (big ? ' big' : ''), style: { '--pc': PHEX[r.color] } },
      el('div', { class: 'fin-name outline', text: r.name }),
      el('div', { class: 'slot' }, sign, ...reels.map((x) => x.reel)),
      el('div', { class: 'fin-place outline' }));
    return { node, reels, sign, r };
  }

  function lockReel(x) {
    x.reel.classList.remove('rolling');
    x.strip.style.transform = `translateY(${-(10 + x.d)}em)`;
    x.reel.classList.add('locked');
    sfx.lock();
  }
  const startTicks = () => { stopTicks(); ticking = setInterval(sfx.tick, 70); };
  const stopTicks = () => { clearInterval(ticking); ticking = null; };

  async function rollAndLock(cards) {
    startTicks();
    await wait(1100);
    const maxLen = Math.max(...cards.map((c) => c.reels.length));
    for (let k = 0; k < maxLen; k++) {
      if (cancelled) return;
      // align right so the ones digit locks last on every card
      for (const c of cards) {
        const idx = c.reels.length - maxLen + k;
        if (idx === 0 && c.r.total < 0) c.sign.classList.add('show');
        if (idx >= 0) lockReel(c.reels[idx]);
      }
      await wait(k === maxLen - 1 ? 0 : 520);
    }
    stopTicks();
  }

  async function show() {
    await wait(300);
    root.classList.add('in');
    sfx.fanfare();
    say("Choo choo! Gather 'round, it's time to count the points!");
    await wait(2300);
    const rest = rows.slice(2).reverse();
    for (const r of rest) {
      if (cancelled) return;
      say(`Let's see how ${r.name} did...`);
      const c = card(r);
      stage.append(c.node);
      await wait(900);
      await rollAndLock([c]);
      if (cancelled) return;
      c.node.querySelector('.fin-place').textContent = `${PLACE[r.rank - 1]} place!`;
      c.node.classList.add('done');
      if (r.rank === 2) { say(fill(LOSER, r.name), 'mean'); sfx.sadTrombone(); }
      else say(fill(NICE[(r.rank + r.name.length) % NICE.length], r.name));
      await wait(2600);
      c.node.classList.remove('big');
      history.append(c.node);
    }
    if (cancelled) return;
    const [a, b] = rows;
    say(rows.length > 2 ? 'And now... THE FINAL TWO!' : 'Just the two of you... THE FINAL TWO!');
    sfx.drumroll(2.4);
    await wait(2400);
    const ca = card(a), cb = b ? card(b) : null;
    const duo = el('div', { class: 'fin-duo' }, ca.node, cb ? cb.node : null);
    stage.append(duo);
    await wait(500);
    await rollAndLock(cb ? [ca, cb] : [ca]);
    if (cancelled) return;
    await wait(500);
    for (const c of [ca, cb].filter(Boolean)) {
      c.node.querySelector('.fin-place').textContent = `${PLACE[c.r.rank - 1]} place!`;
      c.node.classList.add('done', c.r.rank === 1 ? 'winner' : 'second');
    }
    const winners = [a, b].filter((r) => r && r.rank === 1);
    confetti(root);
    sfx.fanfare();
    if (winners.length > 1) say(`A TIE?! ${winners.map((w) => w.name).join(' and ')}, you are BOTH my favorite!`);
    else say(fill(WINNER, a.name));
    await wait(3000);
    if (cancelled) return;
    if (b && b.rank === 2) { say(fill(LOSER, b.name), 'mean'); sfx.sadTrombone(); await wait(3400); }
    else { say('What a game, everybody! I love you all!'); await wait(2200); }
    if (cancelled) return;
    say('Want to see all the numbers?');
    stage.append(el('button', { class: 'btn red big fin-done', text: 'SEE ALL THE NUMBERS', onclick: () => finish() }));
  }

  function finish() {
    if (cancelled) return;
    cancelled = true;
    stopTicks();
    timers.forEach(clearTimeout);
    root.classList.add('out');
    setTimeout(() => root.remove(), 350);
    onDone?.();
  }

  show();
  return { cancel: finish };
}

function confetti(root) {
  const colors = ['#ff1c1c', '#ffd400', '#2366ff', '#1fc62e', '#ff5fc8', '#fff'];
  for (let i = 0; i < 90; i++) {
    const c = el('div', { class: 'confetti', style: { left: Math.random() * 100 + 'vw', background: colors[i % colors.length], animationDelay: Math.random() * 0.8 + 's', animationDuration: 2 + Math.random() * 1.6 + 's' } });
    root.append(c);
    setTimeout(() => c.remove(), 4800);
  }
}
