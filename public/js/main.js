import { $, toast, clear } from './util.js';
import { Net } from './net.js';
import { paintSky } from './paintmap.js';
import { loadArt } from './cards.js';
import { PLAYER_COLORS } from '/shared/config.js';
import { HomeScreen } from './home.js';
import { LobbyScreen } from './lobby.js';
import { GameScreen } from './game.js';

const state = { me: null, lobbies: { list: [], max: 12 }, lobby: null, boards: new Map(), view: null, geo: null, online: false };
let screen = null;

function show(kind, factory) {
  if (screen && screen.kind === kind && screen.boardId === (state.lobby?.boardId ?? null)) return screen;
  screen?.destroy?.();
  clear($('#app'));
  screen = factory();
  screen.kind = kind;
  screen.boardId = state.lobby?.boardId ?? null;
  document.body.dataset.screen = kind;
  return screen;
}

function render() {
  if (!state.me || !state.geo) return;
  const board = state.lobby ? state.boards.get(state.lobby.boardId) : null;
  if (!state.lobby) {
    show('home', () => new HomeScreen($('#app'), state, net)).update(state);
  } else if (state.view && board && state.lobby.status !== 'waiting') {
    show('game', () => new GameScreen($('#app'), state, net, board)).update(state);
  } else if (board) {
    show('lobby', () => new LobbyScreen($('#app'), state, net, board)).update(state);
  }
}

function onMessage(msg) {
  switch (msg.t) {
    case 'welcome': state.me = { pid: msg.pid, name: msg.name }; break;
    case 'lobbies': state.lobbies = msg; break;
    case 'lobby':
      state.lobby = msg.lobby;
      if (!msg.lobby) state.view = null;
      break;
    case 'board': state.boards.set(msg.board.id, msg.board); break;
    case 'game': state.view = msg.view; break;
    case 'chat':
      if (state.lobby) { state.lobby.chat = [...(state.lobby.chat || []), msg.msg].slice(-60); screen?.onChat?.(msg.msg); }
      return;
    case 'error': toast(msg.msg, 'error'); screen?.onError?.(msg.msg); return;
    case 'pong': return;
  }
  render();
}

function onStatus(s) {
  state.online = s === 'online';
  $('#conn').classList.toggle('hidden', s === 'online');
}

const net = new Net(onMessage, onStatus);
window.__tg = { state, net }; // handy for debugging + e2e tests

(async function boot() {
  const sky = $('#sky');
  paintSky(sky);
  addEventListener('resize', () => paintSky(sky));
  try {
    const [geo] = await Promise.all([fetch('/data/geo.json').then((r) => r.json())]);
    const { renderToys } = await import('./toys3d.js');
    await loadArt(renderToys, PLAYER_COLORS);
    state.geo = geo;
  } catch (e) {
    console.error(e);
    $('#bootmsg').textContent = 'Could not load the game. Refresh?';
    return;
  }
  render();
})();
