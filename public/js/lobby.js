import { el, add, clear, toast } from './util.js';
import { PLAYER_COLORS, SETTINGS_LIMITS, colorInfo } from '/shared/config.js';
import { paintBackground } from './paintmap.js';
import { micButton } from './game.js';
import * as voice from './voice.js';

export class Chat {
  constructor(net, state) {
    this.net = net; this.state = state;
    this.box = el('div', { class: 'chatlog' });
    this.input = el('input', { class: 'input', maxlength: 200, placeholder: 'Say something…' });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.input.value.trim()) { net.send({ t: 'chat', text: this.input.value }); this.input.value = ''; }
      e.stopPropagation();
    });
    this.node = el('div', { class: 'chat' }, this.box, this.input);
    this.rendered = 0;
  }
  sync(messages = []) {
    clear(this.box);
    for (const m of messages) this.add(m, false);
    this.box.scrollTop = this.box.scrollHeight;
  }
  add(m, scroll = true) {
    this.box.append(m.pid ? el('div', { class: 'msg' }, el('b', { text: m.name + ': ' }), m.text) : el('div', { class: 'msg sys', text: m.text }));
    while (this.box.children.length > 80) this.box.firstChild.remove();
    if (scroll) this.box.scrollTop = this.box.scrollHeight;
  }
}

export class LobbyScreen {
  constructor(app, state, net, board) {
    this.net = net; this.state = state; this.board = board;
    this.members = el('div', { class: 'members' });
    this.settings = el('div', { class: 'settings' });
    this.mapBox = el('div', { class: 'mapbox' });
    this.startBtn = el('button', { class: 'btn red big', onclick: () => net.send({ t: 'start' }), text: 'START!' });
    this.readyBtn = el('button', { class: 'btn green big', onclick: () => net.send({ t: 'ready', ready: !this.meMember()?.ready }) });
    this.title = el('h2', { class: 'outline lobbytitle' });
    this.code = el('span', { class: 'code big' });
    this.chat = new Chat(net, state);
    this.chat.sync(state.lobby.chat);
    const invite = () => {
      const url = `${location.origin}/?join=${state.lobby.id}`;
      navigator.clipboard?.writeText(url).then(() => toast('Invite link copied!'), () => toast(url));
    };
    app.append(el('div', { class: 'screen lobby' },
      el('div', { class: 'row between top' },
        el('div', { class: 'row' }, el('div', { class: 'title-blob small' }, el('h1', { class: 'title', text: 'TRAIN GAME!' })), this.title),
        el('div', { class: 'row' }, el('span', { class: 'outline', text: 'Code' }), this.code,
          micButton(),
          el('button', { class: 'btn yellow', onclick: invite, text: 'COPY INVITE' }),
          el('button', { class: 'btn', onclick: () => net.send({ t: 'leave' }), text: 'LEAVE' }))),
      el('div', { class: 'cols' },
        el('div', { class: 'panel tilt-l' }, el('h2', { class: 'outline', text: 'Players' }), this.members, el('div', { class: 'row' }, this.readyBtn, this.startBtn)),
        el('div', { class: 'panel tilt-r' }, el('h2', { class: 'outline', text: 'Settings' }), this.settings),
        el('div', { class: 'panel tilt-l grow' }, el('h2', { class: 'outline', text: 'Map' }), this.mapBox),
        el('div', { class: 'panel tilt-r chatpanel' }, el('h2', { class: 'outline', text: 'Chat' }), this.chat.node))));
    this.renderMap();
    this.spkTimer = setInterval(() => {
      for (const n of this.members.querySelectorAll('.member[data-pid]')) n.classList.toggle('speaking', voice.speaking(n.dataset.pid));
    }, 120);
  }

  destroy() { clearInterval(this.spkTimer); }

  meMember() { return this.state.lobby.members.find((m) => m.pid === this.state.me.pid); }
  onChat(m) { this.chat.add(m); }

  renderMap() {
    const b = this.board;
    const c = el('canvas', { class: 'preview' });
    clear(this.mapBox);
    this.mapBox.append(c, el('p', { class: 'small', text: `${b.name}: ${b.stats.cities} cities · ${b.stats.tracks} tracks (${b.stats.doubles} doubles, ${b.stats.express} express) · ${b.stats.tickets} tickets` }));
    this.mapControls = el('div', { class: 'row wrap' });
    this.mapBox.append(this.mapControls);
    setTimeout(() => {
      paintBackground(c, this.state.geo, b, 0.2);
      const x = c.getContext('2d');
      x.setTransform(0.2, 0, 0, 0.2, 0, 0);
      x.lineCap = 'round';
      for (const r of b.routes) {
        x.strokeStyle = '#000'; x.lineWidth = 30;
        x.beginPath(); r.path.forEach((p, i) => (i ? x.lineTo(...p) : x.moveTo(...p))); x.stroke();
        x.strokeStyle = r.express ? '#ffd400' : colorInfo(r.color).hex; x.lineWidth = 18;
        x.stroke();
      }
      for (const ct of b.cities) { x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 12; x.beginPath(); x.arc(ct.x, ct.y, 22, 0, 7); x.fill(); x.stroke(); }
    }, 30);
  }

  update(state) {
    const l = state.lobby;
    const isHost = l.hostPid === state.me.pid;
    this.title.textContent = l.name;
    this.code.textContent = l.id;
    const me = this.meMember();
    clear(this.members);
    for (const m of l.members) {
      const pc = PLAYER_COLORS.find((c) => c.id === m.color);
      add(this.members, el('div', { class: 'member' + (m.connected ? '' : ' away') + (m.mic ? ' mic' : ''), dataset: { pid: m.pid } },
        el('span', { class: 'swatch', style: { background: pc?.hex } }),
        el('span', { class: 'spk', dataset: { pid: m.pid }, title: m.mic ? 'mic on' : 'mic off' }, el('i'), el('i'), el('i')),
        el('b', { text: m.name }),
        m.pid === l.hostPid ? el('span', { class: 'tag', text: 'HOST' }) : null,
        m.pid === state.me.pid ? el('span', { class: 'tag you', text: 'YOU' }) : null,
        el('span', { class: 'ready ' + (m.ready || m.pid === l.hostPid ? 'yes' : 'no'), text: m.pid === l.hostPid ? '' : m.ready ? 'READY' : 'not ready' }),
        isHost && m.pid !== state.me.pid ? el('button', { class: 'btn tiny', onclick: () => this.net.send({ t: 'kick', pid: m.pid }), text: 'kick' }) : null));
    }
    for (let i = l.members.length; i < l.maxPlayers; i++) add(this.members, el('div', { class: 'member empty', text: 'waiting for a player…' }));
    const taken = new Set(l.members.filter((m) => m.pid !== state.me.pid).map((m) => m.color));
    add(this.members, el('div', { class: 'colorpick' }, el('span', { class: 'small', text: 'Your color: ' }),
      ...PLAYER_COLORS.map((c) => el('button', {
        class: 'swatchbtn' + (me?.color === c.id ? ' on' : ''), style: { background: c.hex }, title: c.name,
        disabled: taken.has(c.id) ? 'disabled' : null, onclick: () => this.net.send({ t: 'color', color: c.id }),
      }))));

    this.readyBtn.style.display = isHost ? 'none' : '';
    this.readyBtn.textContent = me?.ready ? 'NOT READY' : "I'M READY";
    this.startBtn.style.display = isHost ? '' : 'none';
    const allReady = l.members.every((m) => m.ready || m.pid === l.hostPid);
    this.startBtn.disabled = !(l.members.length >= 2 && allReady);
    this.startBtn.title = l.members.length < 2 ? 'Need 2+ players' : allReady ? '' : 'Waiting for everyone to be ready';

    // settings
    clear(this.settings);
    const S = SETTINGS_LIMITS;
    const num = (label, key, lim, value, hint) => {
      const inp = el('input', { class: 'input num', type: 'number', min: lim.min, max: lim.max, value, disabled: isHost ? null : 'disabled' });
      inp.addEventListener('change', () => this.net.send(key === 'maxPlayers' ? { t: 'settings', maxPlayers: +inp.value } : { t: 'settings', settings: { [key]: +inp.value } }));
      return el('label', { class: 'setting' }, el('span', { text: label }), inp, hint ? el('small', { text: hint }) : null);
    };
    add(this.settings, 
      num('Max players', 'maxPlayers', S.maxPlayers, l.maxPlayers),
      num('Trains per player', 'trainsPerPlayer', S.trainsPerPlayer, l.settings.trainsPerPlayer, 'classic = 45; more = longer game'),
      num('Extra locomotives', 'extraLocomotives', S.extraLocomotives, l.settings.extraLocomotives, '+ wild cards in the deck (base 14)'),
      num('Extra cards per color', 'extraCardsPerColor', S.extraCardsPerColor, l.settings.extraCardsPerColor, 'base 12 of each color'),
      (() => {
        const cb = el('input', { type: 'checkbox', checked: l.settings.hideScores ? 'checked' : null, disabled: isHost ? null : 'disabled' });
        cb.addEventListener('change', () => this.net.send({ t: 'settings', settings: { hideScores: cb.checked } }));
        return el('label', { class: 'setting check' }, el('span', { text: 'Secret scores' }), cb,
          el('small', { text: "Everyone's points are blacked out (yours too), and you can't see other players' trains or ticket counts. Full tally at the end." }));
      })(),
      isHost ? null : el('p', { class: 'small', text: 'Only the host can change settings.' }));

    // map controls
    if (this.mapControls) {
      clear(this.mapControls);
      if (isHost) {
        const file = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
        file.addEventListener('change', async () => {
          const f = file.files[0];
          if (!f) return;
          try { this.net.send({ t: 'customMap', config: JSON.parse(await f.text()) }); } catch { toast('That file is not valid JSON.', 'error'); }
          file.value = '';
        });
        add(this.mapControls, file,
          el('button', { class: 'btn blue', onclick: () => file.click(), text: 'UPLOAD MAP JSON' }),
          l.customMap ? el('button', { class: 'btn', onclick: () => this.net.send({ t: 'customMap', config: null }), text: 'USE DEFAULT MAP' }) : null);
      }
      add(this.mapControls, el('a', { class: 'btn', href: '/editor', target: '_blank', text: 'MAP EDITOR' }));
    }
  }
}
