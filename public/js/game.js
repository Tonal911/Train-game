import { el, add, clear, toast, $ } from './util.js';
import { MapView } from './mapview.js';
import { ART, cardEl, cardBackEl, ticketEl } from './cards.js';
import { Chat } from './lobby.js';
import { CARD_COLORS, LOCO, GRAY, PLAYER_COLORS, RULES, colorInfo, routePoints } from '/shared/config.js';
import { paymentOptions } from '/shared/engine.js';
import { pointAt, polylineLength } from '/shared/geom.js';
import { flyClaim } from './fly3d.js';
import { runFinale } from './finale.js';
import * as voice from './voice.js';
import * as sfx from './sfx.js';

const HAND_ORDER = [...CARD_COLORS.map((c) => c.id), LOCO];
const PHEX = Object.fromEntries(PLAYER_COLORS.map((c) => [c.id, c.hex]));

export class GameScreen {
  constructor(app, state, net, board) {
    this.state = state; this.net = net; this.board = board;
    this.cityName = new Map(board.cities.map((c) => [c.id, c.name]));
    this.lastSeq = null;
    this.root = el('div', { class: 'screen game' });
    app.append(this.root);
    this.map = new MapView(this.root, state.geo, board, {
      onRouteClick: (r) => this.clickRoute(r),
      onRouteHover: (r, e) => this.showTip(r, e),
      onRouteMove: (r, e) => this.moveTip(e),
      onRouteLeave: () => this.hideTip(),
    });
    ART.ticketThumb = this.map.thumbnail(500);

    this.turnbar = el('div', { class: 'hud turnbar' });
    this.market = el('div', { class: 'hud market' });
    this.players = el('div', { class: 'hud players' });
    this.hand = el('div', { class: 'hud hand' });
    this.tickets = el('div', { class: 'hud mytickets' });
    this.chat = new Chat(net, state);
    this.chat.sync(state.lobby.chat);
    this.logBox = el('div', { class: 'gamelog' });
    this.side = el('div', { class: 'hud side closed' },
      el('div', { class: 'tabs' },
        el('button', { class: 'tab on', onclick: (e) => this.tab(e, 'log'), text: 'LOG' }),
        el('button', { class: 'tab', onclick: (e) => this.tab(e, 'chat'), text: 'CHAT' })),
      el('div', { class: 'tabbody log' }, this.logBox),
      el('div', { class: 'tabbody chat hidden' }, this.chat.node));
    this.tools = el('div', { class: 'hud tools' },
      el('button', { class: 'btn icon', title: 'Zoom in (+)', onclick: () => this.map.zoomBy(1.35), text: '+' }),
      el('button', { class: 'btn icon', title: 'Zoom out (-)', onclick: () => this.map.zoomBy(1 / 1.35), text: '−' }),
      el('button', { class: 'btn icon', title: 'Fit map (0)', onclick: () => this.map.fit(), text: '⤢' }),
      el('button', { class: 'btn icon', title: 'Log / chat', onclick: () => this.side.classList.toggle('closed'), text: '☰' }),
      micButton(),
      el('button', { class: 'btn icon', title: 'Leave game (your seat is kept)', onclick: () => { if (confirm('Leave the game? Your seat is kept and you can rejoin from the lobby list.')) this.net.send({ t: 'leave' }); }, text: '✕' }));
    this.tip = el('div', { class: 'tip hidden' });
    this.fx = el('div', { class: 'fx' });
    this.modal = el('div', { class: 'modal hidden' });
    this.root.append(this.turnbar, this.market, this.players, this.hand, this.tickets, this.side, this.tools, this.tip, this.fx, this.modal);

    this.keys = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === '+' || e.key === '=') this.map.zoomBy(1.35);
      else if (e.key === '-') this.map.zoomBy(1 / 1.35);
      else if (e.key === '0') this.map.fit();
      else if (e.key === 'Escape' && this.modalKind === 'claim') this.closeModal();
    };
    addEventListener('keydown', this.keys);
    this.spkTimer = setInterval(() => {
      for (const [pid, node] of this.playerEls || []) node.classList.toggle('speaking', voice.speaking(pid));
    }, 120);
    this.ro = new ResizeObserver(() => this.layout());
    for (const n of [this.players, this.hand, this.turnbar, this.market, this.tickets]) this.ro.observe(n);
  }

  destroy() { removeEventListener('keydown', this.keys); this.ro.disconnect(); clearInterval(this.spkTimer); this.finale?.cancel(); this.map.destroy(); }

  tab(e, which) {
    for (const b of this.side.querySelectorAll('.tab')) b.classList.toggle('on', b === e.target);
    this.side.querySelector('.tabbody.log').classList.toggle('hidden', which !== 'log');
    this.side.querySelector('.tabbody.chat').classList.toggle('hidden', which !== 'chat');
  }
  onChat(m) { this.chat.add(m); if (this.side.querySelector('.tabbody.chat').classList.contains('hidden')) this.side.querySelector('.tab:nth-child(2)').classList.add('ping'); }

  layout() {
    const r = this.root.getBoundingClientRect();
    // the player list always sits just under the (variable-height) turn banner
    const top = Math.round(this.turnbar.getBoundingClientRect().bottom - r.top + 10);
    if (this.players.style.top !== top + 'px') { this.players.style.top = top + 'px'; this.players.style.maxHeight = `calc(100vh - ${top + 14}px)`; }
    const pr = this.players.getBoundingClientRect(), hr = this.hand.getBoundingClientRect(), tr = this.turnbar.getBoundingClientRect(), mr = this.market.getBoundingClientRect();
    const kr = this.tickets.getBoundingClientRect();
    // the hand may overlap the empty Gulf/Mexico strip a little
    this.map.setInsets({ left: pr.right - r.left + 4, top: Math.max(tr.bottom, mr.bottom) - r.top + 2, right: kr.width ? r.right - kr.left + 4 : 10, bottom: Math.max(0, r.bottom - hr.top - 40) });
    if (!this.laidOut) { this.laidOut = true; this.map.fit(); } else this.map.fit(true);
  }

  get view() { return this.state.view; }
  get me() { return this.view.you; }
  get myTurn() { return this.view.phase === 'playing' && this.view.currentPid === this.state.me.pid; }
  pname(pid) { return this.view.players.find((p) => p.pid === pid)?.name || '?'; }

  // ---------------- update ----------------
  update(state) {
    const v = state.view;
    if (!v) return;
    const first = this.lastSeq == null;
    if (first) this.resultOnLoad = !!v.result;
    const newEvents = first ? [] : v.events.filter((e) => e.seq > this.lastSeq);
    const sources = this.captureSources(newEvents);
    this.lastSeq = v.seq;

    this.renderTurnbar(v);
    this.renderMarket(v);
    this.renderPlayers(v);
    this.renderHand(v);
    this.renderTickets(v);
    this.renderLog(v);
    const claimedNow = newEvents.filter((e) => e.type === 'claim').map((e) => e.routeId);
    for (const rid of claimedNow) { this.map.hold(rid); setTimeout(() => this.map.revealAll(rid), 6000); }
    this.map.update({ owner: v.owner, players: v.players, doublesBlocked: v.doublesBlocked, pieceArt: ART.pieces, playerHex: PHEX }, claimedNow);
    this.renderModals(v);
    this.animate(newEvents, sources);
    if (first && this.myTurn) this.stamp('YOUR TURN!');
  }

  renderTurnbar(v) {
    clear(this.turnbar);
    const cur = v.players[v.current];
    let main, sub = '';
    if (v.phase === 'initialTickets') {
      const waiting = v.players.filter((p) => p.choosingTickets).map((p) => p.name);
      main = this.me?.pending ? 'PICK YOUR TICKETS!' : 'WAITING FOR TICKETS…';
      sub = waiting.length ? 'Still choosing: ' + waiting.join(', ') : '';
    } else if (v.phase === 'finished') {
      main = 'GAME OVER!';
    } else if (this.myTurn) {
      main = 'YOUR TURN!';
      sub = v.turn.claimed ? `Keep building! ${v.turn.claimed} route${v.turn.claimed > 1 ? 's' : ''} so far. Claim another, or END TURN.` : v.turn.mode === 'tickets' ? 'Choose which tickets to keep.' : v.turn.drawn ? 'Draw 1 more card (not a face-up Locomotive).' : 'Draw 2 cards · claim a route · or grab tickets.';
    } else {
      main = `${cur.name.toUpperCase()}'S TURN`;
      sub = v.turn.claimed ? `${cur.name} is on a building spree (${v.turn.claimed})…` : v.turn.mode === 'tickets' ? `${cur.name} is choosing tickets…` : v.turn.drawn ? `${cur.name} drew a card…` : `${cur.name} is thinking…`;
    }
    this.turnbar.style.setProperty('--pc', PHEX[cur.color]);
    add(this.turnbar, el('div', { class: 'tb-main outline', text: main }));
    if (sub) add(this.turnbar, el('div', { class: 'tb-sub', text: sub }));
    if (v.settings?.hideScores && v.phase !== 'finished') this.turnbar.append(el('div', { class: 'tb-secret', text: 'SECRET SCORES MODE' }));
    if (v.finalTurns != null && v.phase === 'playing') add(this.turnbar, el('div', { class: 'tb-final', text: `FINAL ROUND · ${v.finalTurns} turn${v.finalTurns === 1 ? '' : 's'} left` }));
    const row = el('div', { class: 'row' });
    if (this.me?.canEndTurn) row.append(el('button', { class: 'btn red big endturn', onclick: () => this.act({ type: 'endTurn' }), text: 'END TURN' }));
    if (this.me?.canPass) row.append(el('button', { class: 'btn yellow', onclick: () => this.act({ type: 'pass' }), text: 'PASS (nothing to do)' }));
    if (v.canSkip) {
      const who = v.phase === 'initialTickets' ? 'away players' : cur.name;
      row.append(el('button', { class: 'btn', onclick: () => this.net.send({ t: 'skip' }), text: `SKIP ${who} (disconnected)` }));
    }
    if (row.children.length) add(this.turnbar, row);
  }

  renderMarket(v) {
    clear(this.market);
    const can = this.myTurn && v.turn.mode !== 'tickets' && !v.turn.claimed;
    const deckEmpty = v.deckCount + v.discardCount === 0;
    const deck = el('div', { class: 'pile deck' + (can && !deckEmpty ? ' live' : ''), title: 'Draw a blind card' },
      v.deckCount > 2 ? cardBackEl({ size: 'sm', cls: 'under2' }) : null,
      v.deckCount > 1 ? cardBackEl({ size: 'sm', cls: 'under1' }) : null,
      v.deckCount ? cardBackEl({ size: 'sm' }) : el('div', { class: 'card sm empty', text: v.discardCount ? 'reshuffle' : 'empty' }),
      el('div', { class: 'pilecount outline', text: String(v.deckCount) }),
      el('div', { class: 'pilelabel outline', text: 'DRAW!' }));
    if (can && !deckEmpty) deck.addEventListener('click', () => this.act({ type: 'drawCard', source: 'deck' }));
    this.deckEl = deck;
    const slots = el('div', { class: 'faceup' });
    this.slotEls = [];
    v.faceUp.forEach((c, i) => {
      const allowed = can && c && !(v.turn.drawn && c === LOCO);
      const slot = el('div', { class: 'slot' + (allowed ? ' live' : '') + (c === LOCO && v.turn.drawn ? ' nope' : '') },
        c ? cardEl(c, { size: 'sm' }) : el('div', { class: 'card sm empty' }));
      if (allowed) slot.addEventListener('click', () => this.act({ type: 'drawCard', source: 'faceup', index: i }));
      slots.append(slot);
      this.slotEls.push(slot);
    });
    const discard = el('div', { class: 'pile discard', title: 'Discard pile' },
      v.discardTop ? cardEl(v.discardTop, { size: 'sm', cls: 'tilted' }) : el('div', { class: 'card sm empty', text: 'discard' }),
      el('div', { class: 'pilecount outline', text: String(v.discardCount) }));
    this.discardEl = discard;
    const canT = this.myTurn && !v.turn.drawn && !v.turn.claimed && v.turn.mode !== 'tickets' && v.ticketDeckCount > 0;
    const tdeck = el('div', { class: 'pile tickets' + (canT ? ' live' : ''), title: 'Draw 3 destination tickets, keep at least 1' },
      el('div', { class: 'ticketback' }, el('span', { text: 'TICKETS' })),
      el('div', { class: 'pilecount outline', text: String(v.ticketDeckCount) }));
    if (canT) tdeck.addEventListener('click', () => this.act({ type: 'drawTickets' }));
    this.ticketDeckEl = tdeck;
    add(this.market, deck, slots, discard, tdeck);
  }

  renderPlayers(v) {
    clear(this.players);
    this.playerEls = new Map();
    v.players.forEach((p, i) => {
      const isMe = p.pid === this.state.me.pid;
      const fan = el('div', { class: 'minifan' });
      const n = Math.min(p.handCount, 12);
      for (let k = 0; k < n; k++) {
        const b = el('div', { class: 'minicard' });
        b.style.transform = `translateX(${k * 6}px) rotate(${(k - (n - 1) / 2) * 5}deg)`;
        fan.append(b);
      }
      const known = el('div', { class: 'known' }, ...HAND_ORDER.filter((c) => p.known[c] > 0).map((c) =>
        el('span', { class: 'chip' + (c === LOCO ? ' loco' : ''), style: { background: colorInfo(c).hex }, title: `Known ${colorInfo(c).name} (taken face-up)`, text: p.known[c] })));
      const node = el('div', { class: 'pp' + (i === v.current && v.phase === 'playing' ? ' active' : '') + (isMe ? ' me' : '') + (p.connected ? '' : ' away') + (p.mic ? ' mic' : ''), style: { '--pc': PHEX[p.color] } },
        el('div', { class: 'pp-head' },
          el('span', { class: 'dot', title: p.connected ? 'online' : 'disconnected' }),
          el('b', { class: 'pp-name', text: p.name + (isMe ? ' (you)' : '') }),
          el('span', { class: 'spk', title: p.mic ? 'mic on' : 'mic off' }, el('i'), el('i'), el('i')),
          p.score == null ? el('span', { class: 'pp-score blackout', title: 'Scores are secret until the end!', text: '??' }) : el('span', { class: 'pp-score outline', text: String(p.score) })),
        el('div', { class: 'pp-stats' },
          el('span', { class: 'stat', title: 'Trains left' }, ART.pieces[p.color] ? el('img', { src: ART.pieces[p.color], alt: '' }) : null, p.trains == null ? el('b', { class: 'blackout', title: 'Secret!', text: '??' }) : el('b', { text: p.trains })),
          el('span', { class: 'stat', title: 'Destination tickets' }, el('span', { class: 'tk' }), p.ticketCount == null ? el('b', { class: 'blackout', title: 'Secret!', text: '?' }) : el('b', { text: p.ticketCount })),
          el('span', { class: 'pp-hand', title: `${p.handCount} cards in hand` }, fan, el('span', { class: 'hc outline', text: p.handCount }))),
        p.choosingTickets ? el('span', { class: 'tag', text: 'choosing tickets…' }) : null,
        known.children.length ? known : null);
      this.players.append(node);
      this.playerEls.set(p.pid, node);
    });
  }

  renderHand(v) {
    clear(this.hand);
    if (!this.me) return;
    const hand = this.me.hand;
    const groups = HAND_ORDER.filter((c) => hand[c] > 0);
    const fan = el('div', { class: 'fan' });
    this.handGroups = new Map();
    const total = groups.length;
    groups.forEach((c, i) => {
      const n = hand[c];
      const stack = el('div', { class: 'stack', dataset: { color: c } });
      const vis = Math.min(n, 4);
      for (let k = vis - 1; k >= 0; k--) {
        const card = cardEl(c, { size: 'md', count: k === 0 ? n : null });
        card.style.transform = `translate(${k * 5}px, ${-k * 5}px)`;
        card.style.zIndex = String(10 - k);
        stack.append(card);
      }
      const rot = (i - (total - 1) / 2) * 4;
      const lift = Math.abs(i - (total - 1) / 2) ** 2 * 2.2;
      stack.style.transform = `translateY(${lift}px) rotate(${rot}deg)`;
      fan.append(stack);
      this.handGroups.set(c, stack);
    });
    const count = Object.values(hand).reduce((a, b) => a + b, 0);
    add(this.hand, el('div', { class: 'handlabel outline', text: `YOUR HAND · ${count}` }), total ? fan : el('div', { class: 'emptyhand outline', text: 'No cards yet. Draw some!' }));
  }

  renderTickets(v) {
    clear(this.tickets);
    if (!this.me) return;
    const list = el('div', { class: 'tlist' });
    const tks = [...this.me.tickets].sort((a, b) => a.done - b.done || b.value - a.value);
    this.tickets.classList.toggle('none', !tks.length);
    for (const t of tks) list.append(ticketEl(t, this.board, { done: t.done, onHover: (ids) => this.map.highlightCities(ids), cls: 'mini' }));
    const done = tks.filter((t) => t.done).length;
    const head = el('div', { class: 'thead', onclick: () => this.tickets.classList.toggle('collapsed') },
      el('b', { class: 'outline', text: `TICKETS ${done}/${tks.length}` }), el('span', { text: '▾' }));
    add(this.tickets, head, list);
  }

  renderLog(v) {
    clear(this.logBox);
    for (const l of v.log) {
      const p = v.players.find((x) => x.pid === l.pid);
      this.logBox.append(el('div', { class: 'logline', style: p ? { borderLeftColor: PHEX[p.color] } : {} }, l.text));
    }
    this.logBox.scrollTop = this.logBox.scrollHeight;
  }

  // ---------------- actions ----------------
  act(action) { this.net.send({ t: 'act', action }); }

  claimReason(r) {
    const v = this.view;
    if (v.phase === 'finished') return 'Game over.';
    if (v.phase !== 'playing') return 'Pick your tickets first.';
    if (v.owner[r.id] != null) return `Owned by ${v.players[v.owner[r.id]].name}.`;
    const mySeat = this.me?.seat;
    if (r.twin) {
      const t = v.owner[r.twin];
      if (t === mySeat) return 'You already own the other track.';
      if (t != null && v.doublesBlocked) return 'Only one track of a double route is used with 2-3 players.';
    }
    if (v.players[mySeat].trains < r.length) return `You need ${r.length} trains (have ${v.players[mySeat].trains}).`;
    return null;
  }

  clickRoute(r) {
    const v = this.view;
    const reason = this.claimReason(r);
    if (reason) return toast(reason, 'error');
    if (!this.myTurn) return toast("It's not your turn.", 'error');
    if (v.turn.drawn || v.turn.mode) return toast('You already started drawing this turn.', 'error');
    const opts = paymentOptions(r, this.me.hand);
    if (!opts.length) return toast(`Need ${r.length} ${r.color === GRAY ? 'cards of one color' : colorInfo(r.color).name + ' cards'} (Locomotives count as anything).`, 'error');
    this.openClaim(r, opts);
  }

  openClaim(r, opts) {
    this.modalKind = 'claim';
    clear(this.modal);
    let sel = 0;
    const list = el('div', { class: 'payopts' });
    const draw = () => {
      clear(list);
      opts.forEach((o, i) => {
        const cards = el('div', { class: 'paycards' });
        for (let k = 0; k < r.length - o.locos; k++) cards.append(cardEl(o.color, { size: 'xs' }));
        for (let k = 0; k < o.locos; k++) cards.append(cardEl(LOCO, { size: 'xs' }));
        list.append(el('button', { class: 'payopt' + (i === sel ? ' on' : ''), onclick: () => { sel = i; draw(); } }, cards,
          el('span', { class: 'small', text: o.color ? `${r.length - o.locos} ${colorInfo(o.color).name}${o.locos ? ` + ${o.locos} Loco` : ''}` : `${o.locos} Locomotives` })));
      });
      this.map.highlightRoutes([r.id], '#fff');
    };
    draw();
    const name = `${this.cityName.get(r.a)} → ${this.cityName.get(r.b)}`;
    add(this.modal, el('div', { class: 'dialog panel claim' },
      el('h2', { class: 'outline', text: 'CLAIM ROUTE?' }),
      el('p', { class: 'big' }, el('b', { text: name })),
      el('p', { text: `${r.length} trains · ${r.express ? 'EXPRESS · ' : ''}${r.color === GRAY ? 'any one color' : colorInfo(r.color).name} · +${routePoints(r.length)} points` }),
      list,
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => this.closeModal(), text: 'NAH' }),
        el('button', { class: 'btn red big', onclick: () => { const o = opts[sel]; this.act({ type: 'claim', routeId: r.id, color: o.color, locos: o.locos }); this.closeModal(); }, text: `CLAIM! +${routePoints(r.length)}` }))));
    this.modal.classList.remove('hidden');
  }

  closeModal() {
    this.modal.classList.add('hidden');
    clear(this.modal);
    this.modalKind = null;
    this.modalKey = null;
    this.map.highlightRoutes([]);
  }

  renderModals(v) {
    if (v.result) {
      if (this.modalKind !== 'result' && !this.finale) {
        if (this.resultOnLoad || this.finaleDone) this.openResult(v);
        else {
          this.closeModal();
          this.hideTip();
          this.finale = runFinale({ parent: this.root, rows: v.result.rows, onDone: () => { this.finaleDone = true; this.finale = null; this.openResult(this.view); } });
        }
      }
      return;
    }
    if (this.modalKind === 'result') this.closeModal();
    const pend = this.me?.pending;
    if (pend) {
      const key = pend.tickets.map((t) => t.id).join(',');
      if (this.modalKind === 'tickets' && this.modalKey === key) return;
      this.openTickets(pend, key);
    } else if (this.modalKind === 'tickets') this.closeModal();
    if (this.modalKind === 'claim' && !this.myTurn) this.closeModal();
  }

  openTickets(pend, key) {
    this.modalKind = 'tickets';
    this.modalKey = key;
    clear(this.modal);
    const chosen = new Set();
    const btn = el('button', { class: 'btn red big' });
    const refresh = () => {
      btn.textContent = `KEEP ${chosen.size}/${pend.tickets.length}`;
      btn.disabled = chosen.size < pend.min;
      for (const n of row.children) n.classList.toggle('picked', chosen.has(n.dataset.id));
    };
    const row = el('div', { class: 'trow' });
    for (const t of pend.tickets) {
      const n = ticketEl(t, this.board, { onHover: (ids) => this.map.highlightCities(ids) });
      n.addEventListener('click', () => { chosen.has(t.id) ? chosen.delete(t.id) : chosen.add(t.id); refresh(); });
      row.append(n);
    }
    btn.addEventListener('click', () => { this.act({ type: 'keepTickets', ids: [...chosen] }); btn.disabled = true; });
    add(this.modal, el('div', { class: 'dialog panel tickets-dlg' },
      el('h2', { class: 'outline', text: 'DESTINATION TICKETS' }),
      el('p', { text: `Click the tickets you want to keep (at least ${pend.min}). Finished = +points, unfinished = −points. Hover to see them on the map.` }),
      row, el('div', { class: 'row' }, btn)));
    refresh();
    this.modal.classList.remove('hidden');
  }

  openResult(v) {
    this.modalKind = 'result';
    clear(this.modal);
    const isHost = this.state.lobby.hostPid === this.state.me.pid;
    const rows = v.result.rows;
    const table = el('table', { class: 'scores' },
      el('tr', {}, ...['#', 'Player', 'Routes', 'Tickets', 'Longest', 'Bonus', 'TOTAL'].map((h) => el('th', { text: h }))));
    for (const r of rows) {
      const tr = el('tr', { class: r.rank === 1 ? 'win' : '', style: { '--pc': PHEX[r.color] } },
        el('td', { text: r.rank === 1 ? '★' : r.rank }),
        el('td', {}, el('span', { class: 'swatch', style: { background: PHEX[r.color] } }), r.name),
        el('td', { text: r.routePts }),
        el('td', { text: `${r.ticketPts >= 0 ? '+' : ''}${r.ticketPts} (${r.completed}/${r.tickets.length})` }),
        el('td', { text: r.longest }),
        el('td', { text: r.longestBonus ? '+' + r.longestBonus : '' }),
        el('td', { class: 'total', text: r.total }));
      tr.addEventListener('mouseenter', () => this.map.highlightRoutes(r.longestRoutes, PHEX[r.color]));
      table.append(tr);
    }
    const ticketsBox = el('div', { class: 'endtickets' });
    for (const r of rows) {
      ticketsBox.append(el('div', { class: 'endrow' }, el('b', { text: r.name }),
        el('div', { class: 'trow small' }, ...r.tickets.map((t) => ticketEl({ ...t, long: t.value >= 20 }, this.board, { done: t.done, failed: !t.done, cls: 'mini', onHover: (ids) => this.map.highlightCities(ids) })))));
    }
    const winners = rows.filter((r) => r.rank === 1).map((r) => r.name).join(' & ');
    add(this.modal, el('div', { class: 'dialog panel result' },
      el('div', { class: 'title-blob small' }, el('h1', { class: 'title', text: `${winners.toUpperCase()} WIN${rows.filter((r) => r.rank === 1).length > 1 ? '' : 'S'}!` })),
      table,
      el('p', { class: 'small', text: 'Hover a row to light up that player\'s longest line.' }),
      ticketsBox,
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => this.modal.classList.add('peek'), text: 'PEEK AT MAP' }),
        isHost ? el('button', { class: 'btn red big', onclick: () => this.net.send({ t: 'backToLobby' }), text: 'BACK TO LOBBY' }) : el('span', { class: 'small', text: 'Host can take everyone back to the lobby.' }),
        el('button', { class: 'btn', onclick: () => this.net.send({ t: 'leave' }), text: 'LEAVE' }))));
    add(this.modal, el('button', { class: 'btn yellow big peekback', onclick: () => this.modal.classList.remove('peek'), text: 'BACK TO SCORES' }));
    this.modal.classList.remove('hidden');
    this.stamp('GAME OVER!');
  }

  // ---------------- tooltip ----------------
  showTip(r, e) {
    const v = this.view;
    clear(this.tip);
    const owner = v.owner[r.id] != null ? v.players[v.owner[r.id]] : null;
    const reason = owner ? null : this.claimReason(r);
    const opts = !owner && !reason && this.me ? paymentOptions(r, this.me.hand) : [];
    this.tip.append(
      el('b', { text: `${this.cityName.get(r.a)} — ${this.cityName.get(r.b)}` }),
      el('div', { text: `${r.length} train${r.length > 1 ? 's' : ''} · ${r.color === GRAY ? 'any color' : colorInfo(r.color).name}${r.express ? ' · EXPRESS' : ''}${r.twin ? ' · double' : ''} · +${routePoints(r.length)} pts` }),
      el('div', { class: 'small', text: `${r.km} km${r.mountain > 0.2 ? ' · mountains' : ''}` }),
      owner ? el('div', { class: 'own', style: { color: PHEX[owner.color] }, text: `Owned by ${owner.name}` })
        : reason ? el('div', { class: 'small', text: reason })
          : opts.length ? el('div', { class: 'ok', text: this.myTurn && !v.turn.drawn ? 'Click to claim!' : 'You could claim this on your turn.' })
            : el('div', { class: 'small', text: 'Not enough cards yet.' }));
    this.tip.classList.remove('hidden');
    this.moveTip(e);
  }
  moveTip(e) { this.tip.style.left = e.clientX + 16 + 'px'; this.tip.style.top = e.clientY + 16 + 'px'; }
  hideTip() { this.tip.classList.add('hidden'); }

  // ---------------- animations ----------------
  captureSources(events) {
    const src = new Map();
    for (const e of events) {
      if (e.type === 'draw' && e.source === 'faceup' && this.slotEls?.[e.index]) src.set(e.seq, this.slotEls[e.index].getBoundingClientRect());
      if (e.type === 'draw' && e.source === 'deck' && this.deckEl) src.set(e.seq, this.deckEl.getBoundingClientRect());
      if (e.type === 'drawTickets' && this.ticketDeckEl) src.set(e.seq, this.ticketDeckEl.getBoundingClientRect());
      if (e.type === 'claim') { const pe = this.playerEls?.get(e.pid); if (pe) src.set(e.seq, pe.getBoundingClientRect()); }
    }
    return src;
  }

  animate(events, sources) {
    let delay = 0;
    for (const e of events) {
      const from = sources.get(e.seq);
      const mine = e.pid === this.state.me.pid;
      if (e.type === 'draw') setTimeout(() => sfx.cardDraw(mine ? 1 : 0.5), delay);
      if (e.type === 'draw' && from) {
        const to = mine ? (this.handGroups?.get(e.card) || this.hand).getBoundingClientRect() : this.playerEls.get(e.pid)?.getBoundingClientRect();
        if (to) this.fly(e.card && (mine || e.public) ? cardEl(e.card, { size: 'sm' }) : cardBackEl({ size: 'sm' }), from, to, delay, mine && e.source === 'deck');
        delay += 160;
      } else if (e.type === 'drawTickets' && from) {
        const to = mine ? this.modal.getBoundingClientRect() : this.playerEls.get(e.pid)?.getBoundingClientRect();
        if (to) for (let i = 0; i < e.count; i++) this.fly(el('div', { class: 'ticketback flying' }, el('span', { text: 'TICKETS' })), from, to, delay + i * 120);
      } else if (e.type === 'claim') {
        const r = this.board.routes.find((x) => x.id === e.routeId);
        const mid = pointAt(r.path, polylineLength(r.path) / 2);
        const s = this.map.toScreen(mid.x, mid.y);
        const owner = this.view.players.find((p) => p.pid === e.pid);
        const card = this.playerEls.get(e.pid)?.getBoundingClientRect() || from;
        const segs = this.map.screenSegs(e.routeId);
        const ok = card && owner && flyClaim({ from: card, segs, hex: PHEX[owner.color], fx: this.fx, onLand: (i) => this.map.reveal(e.routeId, i), onAllLanded: () => this.map.shine(e.routeId) });
        if (!ok) { this.map.revealAll(e.routeId); sfx.thud(); this.map.shine(e.routeId); }
        if (e.points != null) {
          const pop = el('div', { class: 'scorepop outline', text: `+${e.points}`, style: { left: s.x + 'px', top: s.y + 'px', animationDelay: delay + 1200 + segs.length * 110 + 'ms' } });
          this.fx.append(pop);
          setTimeout(() => pop.remove(), 3200 + delay + segs.length * 110);
        }
        if (from && this.discardEl) {
          const to = this.discardEl.getBoundingClientRect();
          e.spent.slice(0, 6).forEach((c, i) => this.fly(cardEl(c, { size: 'sm' }), from, to, delay + i * 70));
        }
        delay += 200;
      } else if (e.type === 'marketReset') {
        this.market.classList.remove('shake'); void this.market.offsetWidth; this.market.classList.add('shake');
        this.stamp('LOCO OVERLOAD! RESHUFFLE!');
      } else if (e.type === 'finalRound') {
        this.stamp('FINAL ROUND!');
      } else if (e.type === 'turn' && e.pid === this.state.me.pid && e === events.filter((x) => x.type === 'turn').at(-1)) {
        setTimeout(() => this.stamp('YOUR TURN!'), delay + 200);
      }
    }
  }

  fly(node, from, to, delay = 0, flip = false) {
    const w = from.width, h = from.height;
    const wrap = el('div', { class: 'flyer', style: { left: from.left + 'px', top: from.top + 'px', width: w + 'px' } }, node);
    this.fx.append(wrap);
    const dx = to.left + to.width / 2 - (from.left + w / 2), dy = to.top + to.height / 2 - (from.top + h / 2);
    const rot = (Math.random() - 0.5) * 40;
    wrap.animate([
      { transform: 'translate(0,0) rotate(0) scale(1)' },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) rotate(${rot}deg) scale(${flip ? 1.25 : 1.15}) ${flip ? 'rotateY(90deg)' : ''}`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) rotate(${rot / 3}deg) scale(0.9)` },
    ], { duration: 650, delay, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'both' }).finished.then(() => wrap.remove());
  }

  stamp(text) {
    const s = el('div', { class: 'stamp-big outline', text });
    this.fx.append(s);
    setTimeout(() => s.remove(), 1500);
  }
}

/** Mic toggle button (shared by lobby + game). */
export function micButton() {
  const b = el('button', { class: 'btn icon mic', title: 'Voice chat: toggle your microphone' });
  const paint = (on) => { b.classList.toggle('on', on); b.textContent = on ? 'MIC' : 'mic'; b.title = on ? 'Mic is ON (click to mute)' : 'Mic is off (click to talk)'; };
  paint(voice.isOn());
  voice.onChange(paint);
  b.addEventListener('click', async () => {
    try { await voice.toggle(); } catch (e) { toast(e.message || 'Could not open the mic.', 'error'); }
  });
  return b;
}
