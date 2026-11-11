import { el, clear } from './util.js';
import { RULES } from '/shared/config.js';

export class HomeScreen {
  constructor(app, state, net) {
    this.net = net;
    const nameInput = el('input', { class: 'input', maxlength: 16, value: state.me.name, placeholder: 'Your name' });
    const saveName = () => net.send({ t: 'setName', name: nameInput.value });
    nameInput.addEventListener('change', saveName);
    nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && nameInput.blur());
    this.nameInput = nameInput;

    const lobbyName = el('input', { class: 'input', maxlength: 24, placeholder: 'Lobby name (optional)' });
    const maxSel = el('select', { class: 'input' }, ...[2, 3, 4, 5].map((n) => el('option', { value: n, selected: n === 4 ? 'selected' : null, text: `${n} players` })));
    const create = () => { saveName(); net.send({ t: 'create', name: lobbyName.value, maxPlayers: +maxSel.value }); };

    this.list = el('div', { class: 'lobbylist' });
    this.count = el('span', { class: 'muted' });

    app.append(el('div', { class: 'screen home' },
      el('div', { class: 'hero' },
        el('img', { class: 'hero-img sticker', src: '/assets/loco.jpg', alt: 'Train Game!' }),
        el('div', {},
          el('div', { class: 'title-blob' }, el('h1', { class: 'title', text: 'TRAIN GAME!' })),
          el('p', { class: 'outline tagline', text: 'Grab cards. Build rails. Ruin your friends across the US & Canada.' }))),
      el('div', { class: 'cols' },
        el('div', { class: 'panel tilt-l' },
          el('h2', { class: 'outline', text: 'Who are you?' }),
          el('label', { class: 'lbl', text: 'Name' }), nameInput,
          el('h2', { class: 'outline', text: 'Start a lobby' }),
          lobbyName, maxSel,
          el('button', { class: 'btn red big', onclick: create, text: 'CREATE LOBBY' }),
          el('p', { class: 'small' }, el('a', { href: '/editor', target: '_blank', text: 'Map editor →' }), ' add cities, tweak routes, export a map for your lobby.')),
        el('div', { class: 'panel tilt-r grow' },
          el('div', { class: 'row between' }, el('h2', { class: 'outline', text: 'Open lobbies' }), this.count),
          this.list),
        el('div', { class: 'panel tilt-l rules' },
          el('h2', { class: 'outline', text: 'How to play' }),
          el('ol', {},
            el('li', { text: 'Each turn do ONE thing: draw 2 train cards, claim a route, or draw destination tickets.' }),
            el('li', { text: 'Face-up Locomotive (wild) = your whole draw. You can\'t take one as your 2nd card.' }),
            el('li', { text: 'Claim a route by paying cards of its color (gray = any single color). Locomotives fill in for anything.' }),
            el('li', { text: 'Connect your tickets\' cities for points. Unfinished tickets subtract!' }),
            el('li', { text: `Longest continuous line gets +${RULES.longestBonus}. When someone has ${RULES.endTriggerTrains} or fewer trains, everyone gets one last turn.` }),
            el('li', { text: 'Striped yellow routes are EXPRESS lines: huge, gray, worth a ton.' }),
            el('li', { text: 'With 2-3 players only one track of each double route can be used.' }))))));
  }

  update(state) {
    if (document.activeElement !== this.nameInput) this.nameInput.value = state.me.name;
    const { list, max } = state.lobbies;
    this.count.textContent = `${list.length}/${max} lobbies`;
    clear(this.list);
    if (!list.length) this.list.append(el('p', { class: 'empty', text: 'No lobbies yet. Make one and send your friends the link!' }));
    for (const l of list) {
      const full = l.players.length >= l.max;
      this.list.append(el('div', { class: 'lobbyrow' },
        el('div', { class: 'lname' }, el('b', { text: l.name }), el('span', { class: 'code', text: l.id })),
        el('div', { class: 'lmeta', text: `${l.players.length}/${l.max} · ${l.map} · host ${l.host}` }),
        el('div', { class: 'lplayers', text: l.players.join(', ') }),
        el('span', { class: 'status ' + l.status, text: l.status === 'waiting' ? (full ? 'FULL' : 'OPEN') : l.status === 'playing' ? 'PLAYING' : 'DONE' }),
        el('button', { class: 'btn blue', disabled: l.status === 'waiting' && full ? 'disabled' : null, onclick: () => { this.net.send({ t: 'setName', name: this.nameInput.value }); this.net.send({ t: 'join', id: l.id }); }, text: l.status === 'waiting' ? 'JOIN' : 'REJOIN' })));
    }
    // auto-join from ?join=CODE
    const code = new URLSearchParams(location.search).get('join');
    if (code && !this.autoJoined) {
      this.autoJoined = true;
      history.replaceState(null, '', '/');
      this.net.send({ t: 'join', id: code });
    }
  }
}
