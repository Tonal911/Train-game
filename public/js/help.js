// The "?" button (bottom-right on every screen): rules, with a toggle to the scoring rules.
import { el, clear } from './util.js';
import { RULES, ROUTE_POINTS } from '/shared/config.js';

function rulesBody() {
  return el('ol', { class: 'help-list' },
    el('li', { text: 'Each turn do exactly ONE thing: draw 2 train cards, claim a route, or draw destination tickets.' }),
    el('li', { text: 'Drawing: take cards from the 5 face-up ones or blind from the DRAW pile. A face-up Locomotive (the rainbow wild card) uses your whole draw, and you can\'t take one as your second card. Three face-up Locomotives? The market gets wiped and redealt.' }),
    el('li', { text: 'Claiming: pay as many cards as the route is long, all of the route\'s color. Gray routes take any ONE color. Locomotives count as any color.' }),
    el('li', { text: 'Double routes: you can\'t own both tracks. With 2-3 players, only one track of each double can be used at all.' }),
    el('li', { text: `Tickets: at the start you get ${RULES.initialTicketsDealt} and keep at least ${RULES.initialTicketsKeep}. Later you can draw ${RULES.ticketsDrawn} and keep at least ${RULES.ticketsKeep}. Connect both cities with your own routes to finish one.` }),
    el('li', { text: 'Striped yellow EXPRESS lines are huge (7-9 trains) and gray, so any single color works.' }),
    el('li', { text: `End: when someone finishes a turn with ${RULES.endTriggerTrains} or fewer trains left, everyone (them included) gets exactly one more turn.` }),
    el('li', { text: 'Secret scores mode (host option): all points are hidden, and other players\' trains and ticket counts too. Everything is revealed at the end.' }),
    el('li', { text: 'Controls: scroll to zoom, drag to pan, double-click to zoom in. Hover a route for details and click it to claim. Hover a ticket to light up its cities. Click "mic" to talk (it sounds terrible on purpose).' }));
}

function scoringBody() {
  const lens = Object.keys(ROUTE_POINTS).map(Number).filter((n) => n <= 9);
  return el('div', {},
    el('h3', { text: 'Claiming routes' }),
    el('table', { class: 'help-table' },
      el('tr', {}, el('th', { text: 'Route length' }), ...lens.map((n) => el('td', { text: n }))),
      el('tr', {}, el('th', { text: 'Points' }), ...lens.map((n) => el('td', { text: ROUTE_POINTS[n] })))),
    el('h3', { text: 'At the end of the game' }),
    el('ul', { class: 'help-list' },
      el('li', { text: 'Each completed destination ticket ADDS its value.' }),
      el('li', { text: 'Each unfinished ticket SUBTRACTS its value, so be careful drawing extra tickets late!' }),
      el('li', { text: `Longest continuous line: +${RULES.longestBonus}. It's the longest chain of your own routes you can trace without reusing a route (going through a city twice is fine). Ties all get the bonus.` }),
      el('li', { text: 'Tie-breakers for the win: most completed tickets, then the longest line.' }),
      el('li', { text: 'A ticket\'s value is the length of the shortest possible path between its two cities.' })));
}

export function installHelp() {
  const panel = el('div', { class: 'help-panel panel hidden' });
  let tab = 'rules';
  const render = () => {
    clear(panel);
    const tabBtn = (id, label) => el('button', { class: 'tab' + (tab === id ? ' on' : ''), onclick: () => { tab = id; render(); }, text: label });
    panel.append(
      el('div', { class: 'row between' },
        el('h2', { class: 'outline', text: tab === 'rules' ? 'HOW TO PLAY' : 'SCORING' }),
        el('button', { class: 'btn tiny', onclick: () => panel.classList.add('hidden'), text: 'close' })),
      el('div', { class: 'tabs help-tabs' }, tabBtn('rules', 'HOW TO PLAY'), tabBtn('scoring', 'SCORING')),
      el('div', { class: 'help-body' }, tab === 'rules' ? rulesBody() : scoringBody()));
  };
  render();
  const btn = el('button', { id: 'help-btn', class: 'btn', title: 'Rules', text: '?', onclick: () => { panel.classList.toggle('hidden'); render(); } });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.classList.add('hidden'); });
  document.body.append(panel, btn);
}
