// Authoritative rules engine. Pure game logic, no networking. Runs on the server;
// the client imports the helpers (affordability, payment options) for UI hints only.

import { COLOR_IDS, LOCO, GRAY, RULES, routePoints, colorInfo } from './config.js';
import { makeRng } from './rng.js';

export class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

export class Game {
  /**
   * @param {object} board generated board
   * @param {{pid:string,name:string,color:string}[]} players seat order is shuffled
   * @param {{trainsPerPlayer?:number, extraLocomotives?:number, extraCardsPerColor?:number}} settings
   */
  constructor(board, players, settings = {}, seed = Date.now()) {
    if (players.length < RULES.minPlayers || players.length > RULES.maxPlayers) fail('Need 2-5 players.');
    this.board = board;
    this.routes = new Map(board.routes.map((r) => [r.id, r]));
    this.ticketsById = new Map(board.tickets.map((t) => [t.id, t]));
    this.cityName = new Map(board.cities.map((c) => [c.id, c.name]));
    this.rng = makeRng(seed);
    this.settings = {
      trainsPerPlayer: settings.trainsPerPlayer ?? 45,
      extraLocomotives: settings.extraLocomotives ?? 0,
      extraCardsPerColor: settings.extraCardsPerColor ?? 0,
      hideScores: !!settings.hideScores,
      oneClaimPerTurn: !!settings.oneClaimPerTurn, // default: claims can be chained in one turn
    };
    const order = this.rng.shuffle([...players]);
    this.players = order.map((p) => ({
      pid: p.pid, name: p.name, color: p.color,
      hand: Object.fromEntries([...COLOR_IDS, LOCO].map((c) => [c, 0])),
      known: Object.fromEntries([...COLOR_IDS, LOCO].map((c) => [c, 0])),
      tickets: [], pending: null,
      trains: this.settings.trainsPerPlayer, routePts: 0, routes: [],
    }));
    this.deck = [];
    for (const c of COLOR_IDS) for (let i = 0; i < RULES.cardsPerColor + this.settings.extraCardsPerColor; i++) this.deck.push(c);
    for (let i = 0; i < RULES.locomotives + this.settings.extraLocomotives; i++) this.deck.push(LOCO);
    this.totalCards = this.deck.length;
    this.rng.shuffle(this.deck);
    this.discard = [];
    this.faceUp = new Array(RULES.faceUpCount).fill(null);
    this.ticketDeck = this.rng.shuffle(board.tickets.map((t) => t.id));
    this.owner = {};
    this.phase = 'initialTickets';
    this.current = 0;
    this.turn = { drawn: 0, mode: null };
    this.turnNo = 1;
    this.finalTurns = null;
    this.seq = 0;
    this.events = [];
    this.log = [];
    this.result = null;

    for (const p of this.players) for (let i = 0; i < RULES.startingHand; i++) this.giveCard(p, this.drawFromDeck());
    this.refillFaceUp();
    for (const p of this.players) {
      p.pending = { ids: this.takeTickets(RULES.initialTicketsDealt), min: RULES.initialTicketsKeep };
    }
    this.addLog(null, `Game on! Everyone pick at least ${RULES.initialTicketsKeep} destination tickets.`);
  }

  // ---------- helpers ----------
  idx(pid) { return this.players.findIndex((p) => p.pid === pid); }
  get cur() { return this.players[this.current]; }
  get doublesBlocked() { return this.players.length < RULES.doubleRoutesMinPlayers; }

  addLog(pidx, text) {
    this.log.push({ seq: ++this.seq, pid: pidx == null ? null : this.players[pidx].pid, text });
    if (this.log.length > 80) this.log.shift();
  }
  addEvent(ev) {
    this.events.push({ seq: ++this.seq, ...ev });
    if (this.events.length > 30) this.events.shift();
  }
  giveCard(p, c) { if (c) p.hand[c]++; }
  drawFromDeck() {
    if (!this.deck.length && this.discard.length) {
      this.deck = this.rng.shuffle(this.discard);
      this.discard = [];
      this.addEvent({ type: 'reshuffle' });
    }
    return this.deck.pop() || null;
  }
  takeTickets(n) {
    const out = [];
    while (out.length < n && this.ticketDeck.length) out.push(this.ticketDeck.pop());
    return out;
  }
  refillFaceUp() {
    for (let i = 0; i < this.faceUp.length; i++) if (!this.faceUp[i]) this.faceUp[i] = this.drawFromDeck();
    for (let attempt = 0; attempt < 6; attempt++) {
      const locos = this.faceUp.filter((c) => c === LOCO).length;
      if (locos <= RULES.maxFaceUpLocos) return;
      // Stop if the remaining supply can't possibly produce a legal market.
      const pool = [...this.deck, ...this.discard];
      if (pool.filter((c) => c !== LOCO).length < this.faceUp.length - RULES.maxFaceUpLocos) return;
      for (let i = 0; i < this.faceUp.length; i++) if (this.faceUp[i]) { this.discard.push(this.faceUp[i]); this.faceUp[i] = null; }
      for (let i = 0; i < this.faceUp.length; i++) this.faceUp[i] = this.drawFromDeck();
      this.addEvent({ type: 'marketReset' });
      this.addLog(null, 'Three locomotives face-up: market wiped and redealt!');
    }
  }
  canDrawAny() { return this.deck.length + this.discard.length > 0 || this.faceUp.some(Boolean); }
  canDrawSecond() { return this.deck.length + this.discard.length > 0 || this.faceUp.some((c) => c && c !== LOCO); }
  routeName(r) { return `${this.cityName.get(r.a)} - ${this.cityName.get(r.b)}`; }

  /** Can player index pi claim route r at all (ignoring cards)? Returns reason string or null. */
  claimBlock(pi, r) {
    if (this.owner[r.id] != null) return 'Already claimed.';
    if (r.twin) {
      const t = this.owner[r.twin];
      if (t === pi) return 'You already own the other track of this double route.';
      if (t != null && this.doublesBlocked) return 'With 2-3 players only one track of a double route can be used.';
    }
    if (this.players[pi].trains < r.length) return `Not enough trains (need ${r.length}).`;
    return null;
  }

  hasLegalAction(pi) {
    if (this.canDrawAny() || this.ticketDeck.length) return true;
    const hand = this.players[pi].hand;
    for (const r of this.board.routes) if (!this.claimBlock(pi, r) && paymentOptions(r, hand).length) return true;
    return false;
  }

  // ---------- actions ----------
  act(pid, action) {
    const pi = this.idx(pid);
    if (pi < 0) fail('You are not in this game.');
    if (this.phase === 'finished') fail('Game is over.');
    if (!action || typeof action.type !== 'string') fail('Bad action.');
    const p = this.players[pi];

    if (action.type === 'keepTickets') return this.keepTickets(pi, action.ids);
    if (this.phase !== 'playing') fail('Waiting for everyone to choose tickets.');
    if (pi !== this.current) fail("It's not your turn.");
    if (this.turn.mode === 'tickets') fail('Choose which tickets to keep first.');

    switch (action.type) {
      case 'drawCard':
        if (this.turn.claimed) fail("You're building this turn: claim another route or END TURN.");
        return this.drawCard(pi, action);
      case 'endTurn': {
        if (!this.turn.claimed) fail('Nothing to end: draw cards, claim a route, or take tickets.');
        return this.endTurn();
      }
      case 'claim': return this.claim(pi, action);
      case 'drawTickets': {
        if (this.turn.drawn) fail('You already started drawing cards this turn.');
        if (this.turn.claimed) fail("You're building this turn: claim another route or END TURN.");
        if (!this.ticketDeck.length) fail('No destination tickets left.');
        p.pending = { ids: this.takeTickets(RULES.ticketsDrawn), min: RULES.ticketsKeep };
        this.turn.mode = 'tickets';
        this.addEvent({ type: 'drawTickets', pid, count: p.pending.ids.length });
        return;
      }
      case 'pass': {
        if (this.turn.drawn) fail('Finish drawing first.');
        if (this.hasLegalAction(pi)) fail('You still have a legal move.');
        this.addLog(pi, `${p.name} has nothing to do and passes.`);
        return this.endTurn();
      }
      default: fail('Unknown action.');
    }
  }

  keepTickets(pi, ids) {
    const p = this.players[pi];
    if (!p.pending) fail('No tickets to choose.');
    if (!Array.isArray(ids)) fail('Bad ticket selection.');
    const keep = [...new Set(ids)].filter((id) => p.pending.ids.includes(id));
    if (keep.length !== ids.length) fail('Bad ticket selection.');
    const min = Math.min(p.pending.min, p.pending.ids.length);
    if (keep.length < min) fail(`Keep at least ${min} ticket${min > 1 ? 's' : ''}.`);
    const back = p.pending.ids.filter((id) => !keep.includes(id));
    p.tickets.push(...keep);
    this.ticketDeck.unshift(...back); // returned to the bottom
    p.pending = null;
    this.addEvent({ type: 'keepTickets', pid: p.pid, kept: keep.length, returned: back.length });
    this.addLog(pi, this.settings.hideScores ? `${p.name} picked tickets.` : `${p.name} kept ${keep.length} ticket${keep.length > 1 ? 's' : ''}.`);
    if (this.phase === 'initialTickets') {
      if (this.players.every((x) => !x.pending)) {
        this.phase = 'playing';
        this.addLog(null, `${this.cur.name} goes first!`);
        this.addEvent({ type: 'turn', pid: this.cur.pid });
      }
      return;
    }
    if (pi === this.current && this.turn.mode === 'tickets') this.endTurn();
  }

  drawCard(pi, { source, index }) {
    const p = this.players[pi];
    let card;
    if (source === 'deck') {
      if (!this.deck.length && !this.discard.length) fail('The draw pile is empty.');
      card = this.drawFromDeck();
      this.giveCard(p, card);
      this.addEvent({ type: 'draw', pid: p.pid, source: 'deck', card }); // card is stripped for others in views
    } else if (source === 'faceup') {
      if (!Number.isInteger(index) || index < 0 || index >= this.faceUp.length) fail('Bad card.');
      card = this.faceUp[index];
      if (!card) fail('That slot is empty.');
      if (card === LOCO && this.turn.drawn) fail("A face-up locomotive can't be your second card.");
      this.faceUp[index] = null;
      this.giveCard(p, card);
      p.known[card]++;
      this.addEvent({ type: 'draw', pid: p.pid, source: 'faceup', index, card, public: true });
      this.refillFaceUp();
    } else fail('Bad card source.');

    if (source === 'faceup' && card === LOCO) {
      this.addLog(pi, `${p.name} grabbed a face-up Locomotive.`);
      return this.endTurn();
    }
    this.turn.drawn++;
    if (this.turn.drawn >= 2) {
      this.addLog(pi, `${p.name} drew 2 cards.`);
      return this.endTurn();
    }
    if (!this.canDrawSecond()) {
      this.addLog(pi, `${p.name} drew 1 card (no more available).`);
      return this.endTurn();
    }
  }

  claim(pi, { routeId, color, locos }) {
    const p = this.players[pi];
    if (this.turn.drawn) fail('You already started drawing cards this turn.');
    const r = this.routes.get(routeId);
    if (!r) fail('No such route.');
    const block = this.claimBlock(pi, r);
    if (block) fail(block);
    const L = r.length;
    if (!Number.isInteger(locos) || locos < 0 || locos > L) fail('Bad payment.');
    let payColor = null;
    if (locos < L) {
      if (r.color !== GRAY) { if (color !== r.color) fail(`This route needs ${colorInfo(r.color).name} cards.`); }
      else if (!COLOR_IDS.includes(color)) fail('Pick a single color to pay with.');
      payColor = color;
      if (p.hand[payColor] < L - locos) fail(`Not enough ${colorInfo(payColor).name} cards.`);
    }
    if (p.hand[LOCO] < locos) fail('Not enough Locomotives.');
    const spent = [];
    if (payColor) { p.hand[payColor] -= L - locos; p.known[payColor] = Math.max(0, p.known[payColor] - (L - locos)); for (let i = 0; i < L - locos; i++) spent.push(payColor); }
    p.hand[LOCO] -= locos; p.known[LOCO] = Math.max(0, p.known[LOCO] - locos);
    for (let i = 0; i < locos; i++) spent.push(LOCO);
    this.discard.push(...spent);
    this.owner[r.id] = pi;
    p.routes.push(r.id);
    p.trains -= L;
    const pts = routePoints(L);
    p.routePts += pts;
    const hide = this.settings.hideScores;
    this.addEvent({ type: 'claim', pid: p.pid, routeId: r.id, spent, points: hide ? null : pts });
    this.addLog(pi, `${p.name} claimed ${this.routeName(r)} (${L})${hide ? '' : ` for +${pts}`}.`);
    this.turn.claimed = (this.turn.claimed || 0) + 1;
    // chained building: keep the turn going while another claim is possible
    if (this.settings.oneClaimPerTurn || !this.canClaimAny(pi)) return this.endTurn();
  }

  canClaimAny(pi) {
    const hand = this.players[pi].hand;
    return this.board.routes.some((r) => !this.claimBlock(pi, r) && paymentOptions(r, hand).length);
  }

  /** Host override when the current player is gone: auto-resolve whatever they owe and move on. */
  forceSkip(pid) {
    if (this.turn.claimed && this.idx(pid) === this.current) { this.addLog(this.current, `${this.cur.name}'s turn was ended.`); return this.endTurn(); }
    const pi = this.idx(pid);
    if (pi < 0) return;
    const p = this.players[pi];
    if (p.pending) {
      const ids = p.pending.ids.slice(0, Math.min(p.pending.min, p.pending.ids.length));
      this.keepTickets(pi, ids);
      if (this.phase !== 'playing' || pi !== this.current) return;
    }
    if (this.phase === 'playing' && pi === this.current) {
      this.addLog(pi, `${p.name}'s turn was skipped.`);
      this.endTurn();
    }
  }

  endTurn() {
    const p = this.cur;
    if (this.finalTurns !== null) {
      this.finalTurns--;
      if (this.finalTurns <= 0) return this.finish();
    } else if (p.trains <= RULES.endTriggerTrains) {
      this.finalTurns = this.players.length;
      this.addLog(this.current, this.settings.hideScores ? `${p.name} is almost out of trains: FINAL ROUND! Everyone gets one last turn.` : `${p.name} is down to ${p.trains} trains: FINAL ROUND! Everyone gets one last turn.`);
      this.addEvent({ type: 'finalRound', pid: p.pid });
    }
    this.current = (this.current + 1) % this.players.length;
    this.turn = { drawn: 0, mode: null };
    this.turnNo++;
    this.addEvent({ type: 'turn', pid: this.cur.pid });
  }

  finish() {
    this.phase = 'finished';
    const rows = this.players.map((p) => {
      const conn = connectivity(p.routes.map((id) => this.routes.get(id)));
      const tickets = p.tickets.map((id) => {
        const t = this.ticketsById.get(id);
        return { id, a: t.a, b: t.b, value: t.value, done: conn.same(t.a, t.b) };
      });
      const ticketPts = tickets.reduce((s, t) => s + (t.done ? t.value : -t.value), 0);
      const lt = longestTrail(p.routes.map((id) => this.routes.get(id)));
      return { pid: p.pid, name: p.name, color: p.color, routePts: p.routePts, tickets, ticketPts, longest: lt.length, longestRoutes: lt.routes, completed: tickets.filter((t) => t.done).length };
    });
    const maxLong = Math.max(...rows.map((r) => r.longest));
    for (const r of rows) {
      r.longestBonus = maxLong > 0 && r.longest === maxLong ? RULES.longestBonus : 0;
      r.total = r.routePts + r.ticketPts + r.longestBonus;
    }
    rows.sort((a, b) => b.total - a.total || b.completed - a.completed || b.longest - a.longest);
    let rank = 0;
    rows.forEach((r, i) => {
      const prev = rows[i - 1];
      if (!prev || prev.total !== r.total || prev.completed !== r.completed || prev.longest !== r.longest) rank = i + 1;
      r.rank = rank;
    });
    this.result = { rows, longest: maxLong };
    this.addLog(null, `Game over! ${rows.filter((r) => r.rank === 1).map((r) => r.name).join(' & ')} win${rows.filter((r) => r.rank === 1).length > 1 ? '' : 's'} with ${rows[0].total} points!`);
    this.addEvent({ type: 'gameOver' });
  }

  // ---------- views ----------
  viewFor(pid) {
    const me = this.idx(pid);
    const finished = this.phase === 'finished';
    const view = {
      boardId: this.board.id,
      phase: this.phase,
      current: this.current,
      currentPid: this.cur.pid,
      turn: { ...this.turn },
      turnNo: this.turnNo,
      finalTurns: this.finalTurns,
      doublesBlocked: this.doublesBlocked,
      faceUp: [...this.faceUp],
      deckCount: this.deck.length,
      discardCount: this.discard.length,
      discardTop: this.discard.at(-1) || null,
      ticketDeckCount: this.ticketDeck.length,
      totalCards: this.totalCards,
      owner: { ...this.owner },
      settings: { ...this.settings },
      players: this.players.map((p, i) => ({
        pid: p.pid, name: p.name, color: p.color, seat: i,
        // hidden mode: everyone's score is hidden (yours too); other players' trains + ticket counts too
        trains: this.settings.hideScores && !finished && i !== me ? null : p.trains,
        score: this.settings.hideScores && !finished ? null : p.routePts,
        handCount: Object.values(p.hand).reduce((a, b) => a + b, 0),
        known: { ...p.known },
        ticketCount: this.settings.hideScores && !finished && i !== me ? null : p.tickets.length,
        choosingTickets: !!p.pending,
        routes: [...p.routes],
      })),
      log: this.log.slice(-40),
      events: this.events.map((e) => {
        if (e.type === 'draw' && !e.public && e.pid !== pid) { const { card, ...rest } = e; return rest; }
        if (e.type === 'keepTickets' && this.settings.hideScores && !finished && e.pid !== pid) { const { kept, returned, ...rest } = e; return rest; }
        return e;
      }),
      seq: this.seq,
      result: finished ? this.result : null,
    };
    if (me >= 0) {
      const p = this.players[me];
      const conn = connectivity(p.routes.map((id) => this.routes.get(id)));
      view.you = {
        seat: me,
        hand: { ...p.hand },
        tickets: p.tickets.map((id) => ({ ...this.ticketsById.get(id), done: conn.same(this.ticketsById.get(id).a, this.ticketsById.get(id).b) })),
        pending: p.pending ? { tickets: p.pending.ids.map((id) => this.ticketsById.get(id)), min: Math.min(p.pending.min, p.pending.ids.length) } : null,
        canPass: this.phase === 'playing' && me === this.current && !this.turn.drawn && !this.turn.claimed && this.turn.mode !== 'tickets' && !this.hasLegalAction(me),
        canEndTurn: this.phase === 'playing' && me === this.current && !!this.turn.claimed,
      };
    }
    return view;
  }

  /** Total cards in circulation must stay constant (used by tests). */
  cardCount() {
    return this.deck.length + this.discard.length + this.faceUp.filter(Boolean).length +
      this.players.reduce((s, p) => s + Object.values(p.hand).reduce((a, b) => a + b, 0), 0);
  }
}

// ---------- shared pure helpers (also used by the client) ----------

/** All ways to pay for route r from hand: [{color, locos}] sorted by fewest locomotives. */
export function paymentOptions(r, hand) {
  const L = r.length, out = [];
  const colors = r.color === GRAY ? COLOR_IDS : [r.color];
  for (const c of colors) {
    const have = hand[c] || 0;
    for (let k = Math.max(0, L - have); k <= Math.min(hand[LOCO] || 0, L - 1); k++) out.push({ color: c, locos: k });
  }
  if ((hand[LOCO] || 0) >= L) out.push({ color: null, locos: L });
  out.sort((a, b) => a.locos - b.locos || (hand[b.color] || 0) - (hand[a.color] || 0));
  return out;
}

export function connectivity(routes) {
  const parent = new Map();
  const find = (x) => { if (!parent.has(x)) parent.set(x, x); while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const r of routes) parent.set(find(r.a), find(r.b));
  return { same: (a, b) => parent.has(a) && parent.has(b) && find(a) === find(b) };
}

/** Longest continuous trail (each route used once, cities may repeat). */
export function longestTrail(routes) {
  const adj = new Map();
  routes.forEach((r, i) => {
    for (const [u, v] of [[r.a, r.b], [r.b, r.a]]) {
      if (!adj.has(u)) adj.set(u, []);
      adj.get(u).push({ v, i, len: r.length });
    }
  });
  const used = new Array(routes.length).fill(false);
  let best = 0, bestSet = [];
  const stack = [];
  const dfs = (u, total) => {
    if (total > best) { best = total; bestSet = [...stack]; }
    for (const e of adj.get(u) || []) {
      if (used[e.i]) continue;
      used[e.i] = true; stack.push(routes[e.i].id);
      dfs(e.v, total + e.len);
      stack.pop(); used[e.i] = false;
    }
  };
  for (const u of adj.keys()) dfs(u, 0);
  return { length: best, routes: bestSet };
}
