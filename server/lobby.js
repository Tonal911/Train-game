// Lobby + session manager. Server-authoritative: every action goes through the engine.
import crypto from 'node:crypto';
import { Game, GameError } from '../shared/engine.js';
import { generateBoard } from '../shared/mapgen.js';
import { PLAYER_COLORS, RULES, SETTINGS_LIMITS, MAX_LOBBIES } from '../shared/config.js';

const SKIP_AFTER_MS = 20_000;
const WAITING_DROP_MS = 90_000;
const ABANDON_MS = 20 * 60_000;

const cleanName = (s, fallback) => {
  const v = String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return v || fallback;
};
const clampInt = (v, { min, max, default: d }) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d;
};

export class LobbyManager {
  constructor({ defaultBoard, geo, log = console.log }) {
    this.defaultBoard = defaultBoard;
    this.geo = geo;
    this.log = log;
    this.sessions = new Map(); // token -> session
    this.byPid = new Map(); // pid -> session
    this.lobbies = new Map();
    this.boardJson = new Map(); // board.id -> serialized board message
    this.cacheBoard(defaultBoard);
    this.timer = setInterval(() => this.sweep(), 15_000);
    this.timer.unref?.();
  }

  cacheBoard(board) {
    if (!this.boardJson.has(board.id)) this.boardJson.set(board.id, JSON.stringify({ t: 'board', board }));
  }

  // ---------- connection lifecycle ----------
  attach(ws) {
    ws.session = null;
    ws.bucket = { tokens: 40, at: Date.now() };
  }

  detach(ws) {
    const s = ws.session;
    if (!s) return;
    s.sockets.delete(ws);
    if (!s.sockets.size) {
      s.lastSeen = Date.now();
      const lobby = this.lobbies.get(s.lobbyId);
      if (lobby) { this.sendLobby(lobby); if (lobby.game) this.sendGame(lobby); }
    }
  }

  send(ws, msg) {
    if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  sendTo(session, msg) {
    const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
    for (const ws of session.sockets) this.send(ws, data);
  }
  error(ws, msg) { this.send(ws, { t: 'error', msg }); }
  connected(pid) { const s = this.byPid.get(pid); return !!s && s.sockets.size > 0; }

  rateOk(ws) {
    const b = ws.bucket, now = Date.now();
    b.tokens = Math.min(40, b.tokens + ((now - b.at) / 1000) * 20);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens--;
    return true;
  }

  handle(ws, raw) {
    if (!this.rateOk(ws)) return this.error(ws, 'Slow down!');
    let msg;
    try { msg = JSON.parse(raw); } catch { return this.error(ws, 'Bad message.'); }
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.t === 'hello') return this.hello(ws, msg);
    if (msg.t === 'ping') return this.send(ws, { t: 'pong' });
    const s = ws.session;
    if (!s) return this.error(ws, 'Say hello first.');
    try {
      const fn = this['on_' + msg.t];
      if (typeof fn !== 'function') return this.error(ws, 'Unknown command.');
      fn.call(this, ws, s, msg);
    } catch (e) {
      if (e instanceof GameError) return this.error(ws, e.message);
      this.log('handler error', msg.t, e);
      this.error(ws, 'Something broke on the server. Try again.');
    }
  }

  hello(ws, { token, name }) {
    let s = typeof token === 'string' ? this.sessions.get(token) : null;
    if (!s) {
      const tok = crypto.randomBytes(18).toString('base64url');
      s = { token: tok, pid: crypto.randomBytes(6).toString('hex'), name: cleanName(name, 'Player' + Math.floor(100 + Math.random() * 900)), sockets: new Set(), lobbyId: null, lastSeen: Date.now() };
      this.sessions.set(tok, s);
      this.byPid.set(s.pid, s);
    } else if (name) {
      s.name = cleanName(name, s.name);
    }
    ws.session = s;
    s.mic = false; // client mic state resets on (re)connect
    s.sockets.add(ws);
    s.lastSeen = Date.now();
    this.send(ws, { t: 'welcome', pid: s.pid, token: s.token, name: s.name });
    const lobby = this.lobbies.get(s.lobbyId);
    if (lobby && lobby.members.some((m) => m.pid === s.pid)) {
      this.send(ws, this.boardJson.get(lobby.board.id));
      this.sendLobby(lobby);
      if (lobby.game) this.sendGame(lobby);
    } else {
      s.lobbyId = null;
      this.send(ws, { t: 'lobby', lobby: null });
      this.send(ws, this.listMsg());
    }
  }

  // ---------- lobby list ----------
  listMsg() {
    return {
      t: 'lobbies',
      max: MAX_LOBBIES,
      list: [...this.lobbies.values()].map((l) => ({
        id: l.id, name: l.name, status: l.status, max: l.maxPlayers,
        players: l.members.map((m) => m.name), host: this.byPid.get(l.hostPid)?.name || '?', map: l.board.name,
      })),
    };
  }
  broadcastList() {
    const data = JSON.stringify(this.listMsg());
    for (const s of this.sessions.values()) if (!s.lobbyId) this.sendTo(s, data);
  }

  lobbyMsg(l) {
    return {
      t: 'lobby',
      lobby: {
        id: l.id, name: l.name, hostPid: l.hostPid, status: l.status, maxPlayers: l.maxPlayers,
        settings: { ...l.settings }, boardId: l.board.id, mapName: l.board.name, customMap: l.board !== this.defaultBoard,
        members: l.members.map((m) => ({ pid: m.pid, name: this.byPid.get(m.pid)?.name || m.name, color: m.color, ready: m.ready, connected: this.connected(m.pid), mic: !!this.byPid.get(m.pid)?.mic && this.connected(m.pid) })),
        chat: l.chat.slice(-60),
      },
    };
  }
  sendLobby(l) {
    const data = JSON.stringify(this.lobbyMsg(l));
    for (const m of l.members) { const s = this.byPid.get(m.pid); if (s && s.lobbyId === l.id) this.sendTo(s, data); }
  }
  sendGame(l) {
    if (!l.game) return;
    const now = Date.now();
    for (const m of l.members) {
      const s = this.byPid.get(m.pid);
      if (!s || s.lobbyId !== l.id || !s.sockets.size) continue;
      const view = l.game.viewFor(m.pid);
      for (const p of view.players) {
        const ps = this.byPid.get(p.pid);
        p.connected = this.connected(p.pid);
        p.mic = p.connected && !!ps?.mic;
        p.awayMs = p.connected ? 0 : now - (ps?.lastSeen || now);
      }
      view.canSkip = this.skipTargets(l).length > 0;
      this.sendTo(s, { t: 'game', view });
    }
  }

  skipTargets(l) {
    const g = l.game;
    if (!g || g.phase === 'finished') return [];
    const now = Date.now();
    const away = (pid) => !this.connected(pid) && now - (this.byPid.get(pid)?.lastSeen || 0) > SKIP_AFTER_MS;
    if (g.phase === 'initialTickets') return g.players.filter((p) => p.pending && away(p.pid)).map((p) => p.pid);
    return away(g.cur.pid) ? [g.cur.pid] : [];
  }

  // ---------- commands ----------
  on_setName(ws, s, { name }) {
    s.name = cleanName(name, s.name);
    this.sendTo(s, { t: 'welcome', pid: s.pid, token: s.token, name: s.name });
    const l = this.lobbies.get(s.lobbyId);
    if (l) { const m = l.members.find((x) => x.pid === s.pid); if (m) m.name = s.name; this.sendLobby(l); }
    else this.broadcastList();
  }

  on_list(ws) { this.send(ws, this.listMsg()); }

  on_create(ws, s, { name, maxPlayers }) {
    if (s.lobbyId) this.leave(s);
    if (this.lobbies.size >= MAX_LOBBIES) {
      // reclaim the stalest lobby nobody is connected to
      const idle = [...this.lobbies.values()].filter((l) => !l.members.some((m) => this.connected(m.pid)));
      const lastSeen = (l) => Math.max(0, ...l.members.map((m) => this.byPid.get(m.pid)?.lastSeen || 0));
      idle.sort((a, b) => lastSeen(a) - lastSeen(b));
      if (!idle.length) return this.error(ws, `Server is full (${MAX_LOBBIES} lobbies). Try again soon.`);
      for (const m of idle[0].members) { const ms = this.byPid.get(m.pid); if (ms && ms.lobbyId === idle[0].id) ms.lobbyId = null; }
      this.lobbies.delete(idle[0].id);
      this.log(`lobby ${idle[0].id} reclaimed (idle)`);
    }
    let id;
    do { id = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[crypto.randomInt(24)]).join(''); } while (this.lobbies.has(id));
    const l = {
      id, name: cleanName(name, `${s.name}'s game`).slice(0, 24), hostPid: s.pid,
      maxPlayers: clampInt(maxPlayers, SETTINGS_LIMITS.maxPlayers),
      settings: { trainsPerPlayer: SETTINGS_LIMITS.trainsPerPlayer.default, extraLocomotives: 0, extraCardsPerColor: 0, hideScores: false, oneClaimPerTurn: false },
      members: [], status: 'waiting', game: null, board: this.defaultBoard, chat: [], createdAt: Date.now(),
    };
    this.lobbies.set(id, l);
    this.log(`lobby ${id} created by ${s.name}`);
    this.join(ws, s, l);
  }

  on_join(ws, s, { id }) {
    const l = this.lobbies.get(String(id || '').toUpperCase());
    if (!l) return this.error(ws, 'That lobby is gone.');
    if (l.members.some((m) => m.pid === s.pid)) { s.lobbyId = l.id; this.send(ws, this.boardJson.get(l.board.id)); this.sendLobby(l); if (l.game) this.sendGame(l); return; }
    if (l.status !== 'waiting') return this.error(ws, 'That game already started.');
    if (l.members.length >= l.maxPlayers) return this.error(ws, 'Lobby is full.');
    if (s.lobbyId) this.leave(s);
    this.join(ws, s, l);
  }

  join(ws, s, l) {
    const used = new Set(l.members.map((m) => m.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c.id)).id;
    l.members.push({ pid: s.pid, name: s.name, color, ready: false });
    s.lobbyId = l.id;
    this.sendTo(s, this.boardJson.get(l.board.id));
    this.systemChat(l, `${s.name} joined.`);
    this.sendLobby(l);
    this.broadcastList();
  }

  on_leave(ws, s) { this.leave(s); this.sendTo(s, { t: 'lobby', lobby: null }); this.sendTo(s, this.listMsg()); }

  leave(s) {
    const l = this.lobbies.get(s.lobbyId);
    s.lobbyId = null;
    if (!l) return;
    if (l.status === 'waiting') {
      l.members = l.members.filter((m) => m.pid !== s.pid);
      this.systemChat(l, `${s.name} left.`);
    }
    // in a running game the seat is kept so they can come back via the lobby list
    if (l.hostPid === s.pid) {
      const next = l.members.find((m) => m.pid !== s.pid && this.connected(m.pid)) || l.members.find((m) => m.pid !== s.pid);
      if (next) l.hostPid = next.pid;
    }
    if (!l.members.length) this.lobbies.delete(l.id);
    else { this.sendLobby(l); if (l.game) this.sendGame(l); }
    this.broadcastList();
  }

  lobbyOf(ws, s, { host = false, waiting = false } = {}) {
    const l = this.lobbies.get(s.lobbyId);
    if (!l) { this.error(ws, 'You are not in a lobby.'); return null; }
    if (host && l.hostPid !== s.pid) { this.error(ws, 'Only the host can do that.'); return null; }
    if (waiting && l.status !== 'waiting') { this.error(ws, 'Game already running.'); return null; }
    return l;
  }

  on_settings(ws, s, { settings, maxPlayers, name }) {
    const l = this.lobbyOf(ws, s, { host: true, waiting: true });
    if (!l) return;
    if (settings) {
      for (const k of ['trainsPerPlayer', 'extraLocomotives', 'extraCardsPerColor']) if (settings[k] != null) l.settings[k] = clampInt(settings[k], SETTINGS_LIMITS[k]);
      if (settings.hideScores != null) l.settings.hideScores = !!settings.hideScores;
      if (settings.oneClaimPerTurn != null) l.settings.oneClaimPerTurn = !!settings.oneClaimPerTurn;
    }
    if (maxPlayers != null) l.maxPlayers = Math.max(l.members.length, clampInt(maxPlayers, SETTINGS_LIMITS.maxPlayers));
    if (name != null) l.name = cleanName(name, l.name).slice(0, 24);
    for (const m of l.members) m.ready = false;
    this.sendLobby(l);
    this.broadcastList();
  }

  on_color(ws, s, { color }) {
    const l = this.lobbyOf(ws, s, { waiting: true });
    if (!l) return;
    if (!PLAYER_COLORS.some((c) => c.id === color)) return this.error(ws, 'Bad color.');
    if (l.members.some((m) => m.color === color && m.pid !== s.pid)) return this.error(ws, 'Color taken.');
    l.members.find((m) => m.pid === s.pid).color = color;
    this.sendLobby(l);
  }

  on_ready(ws, s, { ready }) {
    const l = this.lobbyOf(ws, s, { waiting: true });
    if (!l) return;
    l.members.find((m) => m.pid === s.pid).ready = !!ready;
    this.sendLobby(l);
  }

  on_kick(ws, s, { pid }) {
    const l = this.lobbyOf(ws, s, { host: true, waiting: true });
    if (!l || pid === s.pid) return;
    const target = this.byPid.get(pid);
    l.members = l.members.filter((m) => m.pid !== pid);
    if (target && target.lobbyId === l.id) {
      target.lobbyId = null;
      this.sendTo(target, { t: 'lobby', lobby: null });
      this.sendTo(target, { t: 'error', msg: 'The host removed you from the lobby.' });
      this.sendTo(target, this.listMsg());
    }
    this.sendLobby(l);
    this.broadcastList();
  }

  on_customMap(ws, s, { config }) {
    const l = this.lobbyOf(ws, s, { host: true, waiting: true });
    if (!l) return;
    if (config == null) { l.board = this.defaultBoard; }
    else {
      if (typeof config !== 'object' || JSON.stringify(config).length > 150_000) return this.error(ws, 'Map file too big or invalid.');
      const { board, errors } = generateBoard(config, this.geo);
      if (errors.length) return this.error(ws, 'Map rejected: ' + errors.slice(0, 4).join(' '));
      l.board = board;
      this.cacheBoard(board);
    }
    for (const m of l.members) m.ready = false;
    const data = this.boardJson.get(l.board.id);
    for (const m of l.members) { const ms = this.byPid.get(m.pid); if (ms) this.sendTo(ms, data); }
    this.systemChat(l, `Map set to "${l.board.name}" (${l.board.cities.length} cities).`);
    this.sendLobby(l);
    this.broadcastList();
  }

  on_start(ws, s) {
    const l = this.lobbyOf(ws, s, { host: true, waiting: true });
    if (!l) return;
    if (l.members.length < RULES.minPlayers) return this.error(ws, 'Need at least 2 players.');
    const notReady = l.members.filter((m) => m.pid !== l.hostPid && !m.ready);
    if (notReady.length) return this.error(ws, `Waiting on: ${notReady.map((m) => m.name).join(', ')}`);
    l.game = new Game(l.board, l.members.map((m) => ({ pid: m.pid, name: this.byPid.get(m.pid)?.name || m.name, color: m.color })), l.settings, crypto.randomInt(2 ** 31));
    l.status = 'playing';
    this.log(`lobby ${l.id} started with ${l.members.length} players`);
    this.sendLobby(l);
    this.sendGame(l);
    this.broadcastList();
  }

  on_act(ws, s, { action }) {
    const l = this.lobbyOf(ws, s);
    if (!l) return;
    if (!l.game) return this.error(ws, 'No game running.');
    l.game.act(s.pid, action);
    if (l.game.phase === 'finished' && l.status !== 'finished') { l.status = 'finished'; this.sendLobby(l); this.broadcastList(); }
    this.sendGame(l);
  }

  on_skip(ws, s) {
    const l = this.lobbyOf(ws, s);
    if (!l || !l.game) return;
    const targets = this.skipTargets(l);
    if (!targets.length) return this.error(ws, 'Nobody to skip (players get 20 s to reconnect).');
    for (const pid of targets) l.game.forceSkip(pid);
    if (l.game.phase === 'finished') { l.status = 'finished'; this.sendLobby(l); }
    this.sendGame(l);
  }

  on_backToLobby(ws, s) {
    const l = this.lobbyOf(ws, s, { host: true });
    if (!l || l.status === 'waiting') return;
    if (l.status === 'playing') return this.error(ws, 'Finish the game first.');
    l.status = 'waiting';
    l.game = null;
    // drop seats of people who never came back
    l.members = l.members.filter((m) => this.byPid.get(m.pid)?.lobbyId === l.id);
    for (const m of l.members) m.ready = false;
    this.sendLobby(l);
    for (const m of l.members) { const ms = this.byPid.get(m.pid); if (ms) this.sendTo(ms, { t: 'game', view: null }); }
    this.broadcastList();
  }

  on_voice(ws, s, { on }) {
    s.mic = !!on;
    const l = this.lobbies.get(s.lobbyId);
    if (l) { this.sendLobby(l); if (l.game) this.sendGame(l); }
  }

  /** Binary frames are voice chunks: relay to everyone else in the lobby, tagged with the sender pid. */
  handleBinary(ws, data) {
    const s = ws.session;
    if (!s || !s.mic || !s.lobbyId || data.length > 1600 || data.length < 8) return;
    const now = Date.now();
    const vb = ws.voiceBucket ||= { tokens: 30, at: now };
    vb.tokens = Math.min(30, vb.tokens + ((now - vb.at) / 1000) * 15);
    vb.at = now;
    if (vb.tokens < 1) return;
    vb.tokens--;
    const l = this.lobbies.get(s.lobbyId);
    if (!l) return;
    const frame = Buffer.concat([Buffer.from(s.pid.padEnd(12, ' ').slice(0, 12), 'ascii'), data]);
    for (const m of l.members) {
      if (m.pid === s.pid) continue;
      const ms = this.byPid.get(m.pid);
      if (!ms || ms.lobbyId !== l.id) continue;
      for (const sock of ms.sockets) if (sock.readyState === 1 && sock.bufferedAmount < 256 * 1024) sock.send(frame, { binary: true });
    }
  }

  on_chat(ws, s, { text }) {
    const l = this.lobbyOf(ws, s);
    if (!l) return;
    const t = String(text || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
    if (!t) return;
    const msg = { pid: s.pid, name: s.name, text: t, ts: Date.now() };
    l.chat.push(msg);
    if (l.chat.length > 100) l.chat.shift();
    for (const m of l.members) { const ms = this.byPid.get(m.pid); if (ms && ms.lobbyId === l.id) this.sendTo(ms, { t: 'chat', msg }); }
  }

  systemChat(l, text) {
    const msg = { pid: null, name: '', text, ts: Date.now() };
    l.chat.push(msg);
    if (l.chat.length > 100) l.chat.shift();
    for (const m of l.members) { const ms = this.byPid.get(m.pid); if (ms && ms.lobbyId === l.id) this.sendTo(ms, { t: 'chat', msg }); }
  }

  // ---------- housekeeping ----------
  sweep() {
    const now = Date.now();
    let changed = false;
    for (const l of [...this.lobbies.values()]) {
      if (l.status === 'waiting') {
        const before = l.members.length;
        l.members = l.members.filter((m) => {
          const s = this.byPid.get(m.pid);
          const keep = s && s.lobbyId === l.id && (s.sockets.size || now - s.lastSeen < WAITING_DROP_MS);
          if (!keep && s && s.lobbyId === l.id) s.lobbyId = null;
          return keep;
        });
        if (l.members.length !== before) {
          changed = true;
          if (!l.members.some((m) => m.pid === l.hostPid) && l.members.length) l.hostPid = l.members[0].pid;
          this.sendLobby(l);
        }
        if (!l.members.length) { this.lobbies.delete(l.id); changed = true; }
      } else {
        const anyone = l.members.some((m) => this.connected(m.pid) || now - (this.byPid.get(m.pid)?.lastSeen || 0) < ABANDON_MS);
        if (!anyone) { this.lobbies.delete(l.id); changed = true; this.log(`lobby ${l.id} abandoned`); continue; }
        // let clients know a skip just became available
        if (l.game && this.skipTargets(l).length) this.sendGame(l);
      }
    }
    // forget idle sessions (no sockets for 6h, not in a lobby)
    for (const [tok, s] of this.sessions) {
      if (!s.sockets.size && !s.lobbyId && now - s.lastSeen > 6 * 3600_000) { this.sessions.delete(tok); this.byPid.delete(s.pid); }
    }
    if (changed) this.broadcastList();
  }

  stats() {
    return { lobbies: this.lobbies.size, sessions: this.sessions.size, online: [...this.sessions.values()].filter((s) => s.sockets.size).length };
  }
}
