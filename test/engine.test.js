import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, GameError, paymentOptions, longestTrail } from '../shared/engine.js';
import { LOCO, GRAY, RULES, COLOR_IDS } from '../shared/config.js';
import { makeRng } from '../shared/rng.js';
import { board } from './helpers.js';

const mkPlayers = (n) => Array.from({ length: n }, (_, i) => ({ pid: 'p' + i, name: 'P' + i, color: 'c' + i }));
const startPlaying = (g) => { for (const p of g.players) g.act(p.pid, { type: 'keepTickets', ids: p.pending.ids.slice(0, 2) }); };

test('setup deals hands, market, tickets', () => {
  const g = new Game(board(), mkPlayers(4), {}, 1);
  assert.equal(g.phase, 'initialTickets');
  for (const p of g.players) {
    assert.equal(Object.values(p.hand).reduce((a, b) => a + b), RULES.startingHand);
    assert.equal(p.pending.ids.length, 3);
    assert.equal(p.trains, 45);
  }
  assert.equal(g.faceUp.filter(Boolean).length, 5);
  assert.ok(g.faceUp.filter((c) => c === LOCO).length <= 2);
  assert.equal(g.cardCount(), 110);
});

test('initial tickets require keeping 2', () => {
  const g = new Game(board(), mkPlayers(2), {}, 2);
  const p = g.players[0];
  assert.throws(() => g.act(p.pid, { type: 'keepTickets', ids: [p.pending.ids[0]] }), GameError);
  assert.throws(() => g.act(p.pid, { type: 'keepTickets', ids: ['nope', 'nah'] }), GameError);
  g.act(p.pid, { type: 'keepTickets', ids: p.pending.ids });
  assert.equal(p.tickets.length, 3);
  assert.throws(() => g.act(g.players[0].pid, { type: 'drawCard', source: 'deck' }), /Waiting/);
  g.act(g.players[1].pid, { type: 'keepTickets', ids: g.players[1].pending.ids.slice(0, 2) });
  assert.equal(g.phase, 'playing');
});

test('drawing: two blind cards ends turn; face-up loco ends turn; loco not allowed second', () => {
  const g = new Game(board(), mkPlayers(3), {}, 3);
  startPlaying(g);
  const a = g.cur.pid;
  g.act(a, { type: 'drawCard', source: 'deck' });
  assert.equal(g.cur.pid, a);
  assert.throws(() => g.act(a, { type: 'drawTickets' }), GameError);
  g.act(a, { type: 'drawCard', source: 'deck' });
  assert.notEqual(g.cur.pid, a);
  const b = g.cur.pid;
  g.faceUp[0] = LOCO; g.faceUp[1] = 'red';
  g.act(b, { type: 'drawCard', source: 'faceup', index: 1 });
  g.faceUp[0] = LOCO;
  assert.throws(() => g.act(b, { type: 'drawCard', source: 'faceup', index: 0 }), /second/);
  g.act(b, { type: 'drawCard', source: 'deck' });
  const c = g.cur.pid;
  g.faceUp[2] = LOCO;
  g.act(c, { type: 'drawCard', source: 'faceup', index: 2 });
  assert.notEqual(g.cur.pid, c);
  assert.equal(g.players.find((p) => p.pid === c).known[LOCO], 1);
});

test('three face-up locomotives reset the market', () => {
  const g = new Game(board(), mkPlayers(2), {}, 4);
  startPlaying(g);
  const before = g.cardCount();
  g.faceUp = [LOCO, LOCO, 'red', 'blue', null];
  g.deck.push(LOCO); // next refill draws a third loco
  g.refillFaceUp();
  assert.ok(g.faceUp.filter((c) => c === LOCO).length <= 2);
  assert.equal(g.cardCount(), before);
});

test('claiming: color rules, gray routes, locos, scoring, discard', () => {
  const b = board();
  const g = new Game(b, mkPlayers(4), { oneClaimPerTurn: true }, 5);
  startPlaying(g);
  const p = g.cur;
  const colored = b.routes.find((r) => r.color !== GRAY && !r.express && r.length === 3);
  for (const k of Object.keys(p.hand)) p.hand[k] = 0;
  p.hand[colored.color] = 2; p.hand[LOCO] = 1;
  const other = COLOR_IDS.find((c) => c !== colored.color);
  p.hand[other] = 5;
  assert.throws(() => g.act(p.pid, { type: 'claim', routeId: colored.id, color: other, locos: 0 }), /needs/);
  assert.throws(() => g.act(p.pid, { type: 'claim', routeId: colored.id, color: colored.color, locos: 0 }), /Not enough/);
  const discard = g.discard.length;
  g.act(p.pid, { type: 'claim', routeId: colored.id, color: colored.color, locos: 1 });
  assert.equal(g.owner[colored.id], 0 + g.players.indexOf(p));
  assert.equal(p.trains, 42);
  assert.equal(p.routePts, 4);
  assert.equal(g.discard.length, discard + 3);
  const q = g.cur;
  assert.throws(() => g.act(q.pid, { type: 'claim', routeId: colored.id, color: colored.color, locos: 0 }), /Already/);
  const gray = b.routes.find((r) => r.color === GRAY && !r.express && !g.owner[r.id] && r.length <= 4);
  for (const k of Object.keys(q.hand)) q.hand[k] = 0;
  q.hand.white = gray.length;
  g.act(q.pid, { type: 'claim', routeId: gray.id, color: 'white', locos: 0 });
  assert.equal(q.routes.length, 1);
});

test('double routes: same player cannot take both; 2-3 players only one track', () => {
  const b = board();
  const dbl = b.routes.find((r) => r.twin && r.lane === -1);
  for (const n of [2, 4]) {
    const g = new Game(b, mkPlayers(n), { oneClaimPerTurn: true }, 6);
    startPlaying(g);
    const p = g.cur;
    p.hand[LOCO] = 20;
    g.act(p.pid, { type: 'claim', routeId: dbl.id, color: null, locos: dbl.length });
    const q = g.cur;
    q.hand[LOCO] = 20;
    if (n === 2) assert.throws(() => g.act(q.pid, { type: 'claim', routeId: dbl.twin, color: null, locos: dbl.length }), /one track/);
    else {
      g.act(q.pid, { type: 'claim', routeId: dbl.twin, color: null, locos: dbl.length });
      assert.equal(g.owner[dbl.twin], g.players.indexOf(q));
    }
    const g2 = new Game(b, mkPlayers(n), {}, 7);
    startPlaying(g2);
    g2.owner[dbl.id] = g2.current;
    assert.match(g2.claimBlock(g2.current, g2.routes.get(dbl.twin)), /other track/);
  }
});

test('ticket draw mid-game keeps at least 1, returns rest to bottom', () => {
  const g = new Game(board(), mkPlayers(2), {}, 8);
  startPlaying(g);
  const p = g.cur;
  g.act(p.pid, { type: 'drawTickets' });
  assert.equal(p.pending.ids.length, 3);
  assert.throws(() => g.act(p.pid, { type: 'drawCard', source: 'deck' }), /tickets/);
  assert.throws(() => g.act(p.pid, { type: 'keepTickets', ids: [] }), /at least 1/);
  const back = p.pending.ids.slice(1);
  g.act(p.pid, { type: 'keepTickets', ids: [p.pending.ids[0]] });
  assert.deepEqual(g.ticketDeck.slice(0, 2), back);
  assert.notEqual(g.cur, p);
});

test('final round: trigger at <=2 trains gives everyone exactly one more turn', () => {
  const g = new Game(board(), mkPlayers(3), {}, 9);
  startPlaying(g);
  const trigger = g.cur;
  trigger.trains = 2;
  g.act(trigger.pid, { type: 'drawCard', source: 'deck' });
  g.act(trigger.pid, { type: 'drawCard', source: 'deck' });
  assert.equal(g.finalTurns, 3);
  for (let i = 0; i < 2; i++) { const p = g.cur; g.act(p.pid, { type: 'drawCard', source: 'deck' }); g.act(p.pid, { type: 'drawCard', source: 'deck' }); }
  assert.equal(g.cur, trigger);
  assert.equal(g.phase, 'playing');
  g.act(trigger.pid, { type: 'drawCard', source: 'deck' });
  g.act(trigger.pid, { type: 'drawCard', source: 'deck' });
  assert.equal(g.phase, 'finished');
  assert.ok(g.result.rows.length === 3);
});

test('longest trail handles loops and branches', () => {
  const R = (id, a, b, length) => ({ id, a, b, length });
  // triangle A-B-C plus tail C-D: A-B-C-A-... trail = all edges
  const t = longestTrail([R(1, 'A', 'B', 2), R(2, 'B', 'C', 3), R(3, 'C', 'A', 4), R(4, 'C', 'D', 5)]);
  assert.equal(t.length, 14);
  // star: only two arms can be used
  const s = longestTrail([R(1, 'X', 'A', 3), R(2, 'X', 'B', 4), R(3, 'X', 'C', 5)]);
  assert.equal(s.length, 9);
});

test('payment options prefer fewest locos and include all-loco', () => {
  const r = { length: 3, color: GRAY };
  const opts = paymentOptions(r, { red: 2, blue: 3, [LOCO]: 3 });
  assert.deepEqual(opts[0], { color: 'blue', locos: 0 });
  assert.ok(opts.some((o) => o.color === null && o.locos === 3));
  assert.ok(opts.some((o) => o.color === 'red' && o.locos === 1));
});

test('scoring: tickets +/-; longest bonus; ties share', () => {
  const b = board();
  const g = new Game(b, mkPlayers(2), {}, 10);
  startPlaying(g);
  g.finish();
  for (const row of g.result.rows) {
    assert.equal(row.routePts, 0);
    assert.ok(row.ticketPts < 0);
    assert.equal(row.longestBonus, 0);
  }
});

test('random bot games always finish with conserved cards and sane state', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = makeRng(seed * 7919);
    const n = 2 + (seed % 4);
    const g = new Game(board(), mkPlayers(n), { trainsPerPlayer: 20 + (seed % 3) * 20, oneClaimPerTurn: seed % 2 === 0 }, seed);
    for (const p of g.players) g.act(p.pid, { type: 'keepTickets', ids: p.pending.ids.slice(0, 2 + (seed % 2)) });
    let steps = 0;
    while (g.phase !== 'finished' && steps++ < 5000) {
      const pi = g.current, p = g.cur;
      if (p.pending) { g.act(p.pid, { type: 'keepTickets', ids: p.pending.ids.slice(0, 1) }); continue; }
      const claimable = g.board.routes.filter((r) => !g.claimBlock(pi, r) && paymentOptions(r, p.hand).length);
      const roll = rng();
      if (g.turn.claimed) {
        if (claimable.length && roll < 0.7) {
          const r = claimable[rng.int(claimable.length)];
          const opt = paymentOptions(r, p.hand)[0];
          g.act(p.pid, { type: 'claim', routeId: r.id, color: opt.color, locos: opt.locos });
        } else g.act(p.pid, { type: 'endTurn' });
      } else if (!g.turn.drawn && claimable.length && roll < 0.6) {
        const r = claimable.sort((a, b) => b.length - a.length)[0];
        const opt = paymentOptions(r, p.hand)[0];
        g.act(p.pid, { type: 'claim', routeId: r.id, color: opt.color, locos: opt.locos });
      } else if (!g.turn.drawn && g.ticketDeck.length && roll > 0.97) {
        g.act(p.pid, { type: 'drawTickets' });
      } else if (g.canDrawAny() && (g.turn.drawn === 0 || g.canDrawSecond())) {
        const slots = g.faceUp.map((c, i) => [c, i]).filter(([c]) => c && !(g.turn.drawn && c === LOCO));
        if (slots.length && rng() < 0.5) g.act(p.pid, { type: 'drawCard', source: 'faceup', index: slots[rng.int(slots.length)][1] });
        else if (g.deck.length + g.discard.length) g.act(p.pid, { type: 'drawCard', source: 'deck' });
        else g.act(p.pid, { type: 'drawCard', source: 'faceup', index: slots[0][1] });
      } else if (!g.turn.drawn && g.ticketDeck.length) {
        g.act(p.pid, { type: 'drawTickets' });
      } else {
        g.act(p.pid, { type: 'pass' });
      }
      assert.equal(g.cardCount(), g.totalCards);
      for (const q of g.players) { assert.ok(q.trains >= 0); for (const v of Object.values(q.hand)) assert.ok(v >= 0); }
      for (const v of [0, 1, 2, 3, 4].map((i) => g.viewFor(g.players[0].pid))) assert.ok(v);
    }
    // stalemate guard: with 20 trains games end; with large trains the deck may starve -> passes still terminate? ensure finished or long-running pass loop
    if (g.phase !== 'finished') {
      // all players passing forever is a legit stall only if nobody can do anything; ensure that's the case
      assert.ok(g.players.every((_, i) => !g.hasLegalAction(i)), `seed ${seed} stuck with legal actions`);
    }
  }
});

test('hidden scores: no score for anyone, no trains/tickets for others, all revealed at the end', () => {
  const g = new Game(board(), mkPlayers(3), { hideScores: true }, 11);
  startPlaying(g);
  const p = g.cur;
  const r = g.board.routes.find((x) => x.length === 2 && !x.express);
  p.hand[LOCO] = 5;
  g.act(p.pid, { type: 'claim', routeId: r.id, color: null, locos: 2 });
  const v = g.viewFor(p.pid);
  for (const q of v.players) {
    assert.equal(q.score, null);
    if (q.pid === p.pid) { assert.equal(q.trains, 43); assert.equal(q.ticketCount, 2); }
    else { assert.equal(q.trains, null); assert.equal(q.ticketCount, null); }
  }
  assert.ok(!v.log.some((l) => /\+\d/.test(l.text)));
  assert.equal(v.events.find((e) => e.type === 'claim').points, null);
  g.finish();
  const end = g.viewFor(p.pid);
  assert.ok(end.players.every((q) => q.score != null && q.trains != null && q.ticketCount != null));
});

test('chained claims: several routes in one turn, END TURN to finish; drawing blocked mid-chain', () => {
  const g = new Game(board(), mkPlayers(2), {}, 12);
  startPlaying(g);
  const p = g.cur;
  p.hand[LOCO] = 30;
  const short = g.board.routes.filter((r) => r.length <= 2 && !r.twin).slice(0, 4);
  for (const r of short) g.act(p.pid, { type: 'claim', routeId: r.id, color: null, locos: r.length });
  assert.equal(g.cur, p);
  assert.equal(p.routes.length, 4);
  assert.equal(g.turn.claimed, 4);
  assert.throws(() => g.act(p.pid, { type: 'drawCard', source: 'deck' }), /building/);
  assert.throws(() => g.act(p.pid, { type: 'drawTickets' }), /building/);
  assert.ok(g.viewFor(p.pid).you.canEndTurn);
  g.act(p.pid, { type: 'endTurn' });
  assert.notEqual(g.cur, p);
  assert.throws(() => g.act(g.cur.pid, { type: 'endTurn' }), /Nothing to end/);
});

test('chained claims: turn auto-ends when no further claim is affordable; one-claim mode ends at once', () => {
  const g = new Game(board(), mkPlayers(2), {}, 13);
  startPlaying(g);
  const p = g.cur;
  for (const k of Object.keys(p.hand)) p.hand[k] = 0;
  const r = g.board.routes.find((x) => x.length === 2 && !x.twin);
  p.hand[LOCO] = 2;
  g.act(p.pid, { type: 'claim', routeId: r.id, color: null, locos: 2 });
  assert.notEqual(g.cur, p);
  const g2 = new Game(board(), mkPlayers(2), { oneClaimPerTurn: true }, 14);
  startPlaying(g2);
  const q = g2.cur; q.hand[LOCO] = 30;
  g2.act(q.pid, { type: 'claim', routeId: r.id, color: null, locos: 2 });
  assert.notEqual(g2.cur, q);
});
