// Plays a complete 2-player game through real browsers (one claim via the UI, the rest via the socket),
// then screenshots the final scoreboard. Usage: node e2e/fullgame.mjs [baseUrl] [outDir]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright'); }
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || 'e2e/out';
fs.mkdirSync(OUT, { recursive: true });
const browser = await playwright.chromium.launch();
const errors = [];
async function mk(name) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(BASE);
  await page.waitForSelector('.screen.home', { timeout: 20000 });
  await page.click('#intro-btn', { timeout: 20000 });
  await page.waitForSelector('#intro', { state: 'detached' });
  await page.evaluate((n) => window.__tg.net.send({ t: 'setName', name: n }), name);
  return page;
}
const a = await mk('Ann'), b = await mk('Bo');
await a.click('text=CREATE LOBBY');
await a.waitForSelector('.screen.lobby');
const code = (await a.textContent('.code.big')).trim();
await b.goto(`${BASE}/?join=${code}`);
await b.click('#intro-btn', { timeout: 20000 });
await b.waitForSelector('.screen.lobby');
await b.click("text=I'M READY");
await a.fill('.setting:has-text("Trains per player") input', '20');
await a.press('.setting:has-text("Trains per player") input', 'Enter');
await a.locator('.setting:has-text("Trains per player") input').blur();
await a.waitForTimeout(400);
await b.click("text=I'M READY"); // settings change un-readies everyone
await a.waitForTimeout(400);
await a.click('text=START!');
for (const p of [a, b]) { await p.waitForSelector('.tickets-dlg'); await p.click('.tickets-dlg .btn.red'); }

const pick = `(() => {
  const s = window.__tg.state, v = s.view; if (!v || v.phase !== 'playing' || v.currentPid !== s.me.pid) return null;
  const me = v.you; if (me.pending) return { type: 'keepTickets', ids: [me.pending.tickets[0].id] };
  const board = s.boards.get(v.boardId), hand = me.hand, seat = me.seat, trains = v.players[seat].trains;
  if (!v.turn.drawn) {
    const opts = [];
    for (const r of board.routes) {
      if (v.owner[r.id] != null || r.length > trains) continue;
      if (r.twin && (v.owner[r.twin] === seat || (v.doublesBlocked && v.owner[r.twin] != null))) continue;
      const colors = r.color === 'gray' ? Object.keys(hand).filter((c) => c !== 'loco') : [r.color];
      for (const c of colors) if ((hand[c] || 0) + hand.loco >= r.length) opts.push({ r, c, locos: Math.max(0, r.length - (hand[c] || 0)) });
    }
    opts.sort((x, y) => y.r.length - x.r.length);
    if (opts.length) return { type: 'claim', routeId: opts[0].r.id, color: opts[0].locos === opts[0].r.length ? null : opts[0].c, locos: opts[0].locos };
  }
  if (v.deckCount + v.discardCount) return { type: 'drawCard', source: 'deck' };
  const i = v.faceUp.findIndex((c) => c && !(v.turn.drawn && c === 'loco'));
  if (i >= 0) return { type: 'drawCard', source: 'faceup', index: i };
  if (me.canPass) return { type: 'pass' };
  return { type: 'drawTickets' };
})()`;

let uiClaimDone = false, steps = 0;
while (steps++ < 1500) {
  const over = await a.evaluate(() => window.__tg.state.view?.phase === 'finished');
  if (over) break;
  let acted = false;
  for (const p of [a, b]) {
    const act = await p.evaluate(pick);
    if (!act) continue;
    if (act.type === 'claim' && !uiClaimDone) {
      uiClaimDone = true;
      await p.locator(`.route[data-id="${act.routeId}"] .seg`).first().click({ force: true });
      await p.waitForSelector('.dialog.claim');
      await p.screenshot({ path: `${OUT}/10-claim-dialog.png` });
      await p.click('.dialog.claim .btn.red');
      await p.waitForTimeout(700);
      await p.screenshot({ path: `${OUT}/11-after-claim.png` });
    } else {
      await p.evaluate((x) => window.__tg.net.send({ t: 'act', action: x }), act);
    }
    acted = true;
    await p.waitForTimeout(60);
    break;
  }
  if (!acted) await a.waitForTimeout(100);
}
await a.waitForSelector('.dialog.result', { timeout: 10000 });
await a.waitForTimeout(1600);
await a.screenshot({ path: `${OUT}/12-result.png` });
await a.click('text=PEEK AT MAP');
await a.waitForTimeout(500);
await a.screenshot({ path: `${OUT}/13-peek.png` });
await a.click('text=BACK TO SCORES');
await a.click('text=BACK TO LOBBY');
await a.waitForSelector('.screen.lobby', { timeout: 5000 });
console.log('steps', steps, 'ui claim', uiClaimDone);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
