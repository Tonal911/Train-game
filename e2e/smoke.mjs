// End-to-end smoke test: N browsers create/join a lobby, start, pick tickets, play some turns.
// Usage: node e2e/smoke.mjs [baseUrl] [outDir]   (expects the server running; needs Playwright installed)
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
const mk = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  await page.goto(BASE);
  await page.waitForSelector('.screen.home', { timeout: 20000 });
  await page.fill('.home input.input', name);
  await page.locator('.home input.input').first().blur();
  return page;
};
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });

const host = await mk('Robin');
await host.click('text=CREATE LOBBY');
await host.waitForSelector('.screen.lobby');
const code = (await host.textContent('.code.big')).trim();
const others = [];
for (const n of ['Sam', 'Alex']) {
  const p = await mk(n);
  await p.click(`.lobbyrow:has-text("${code}") button`);
  await p.waitForSelector('.screen.lobby');
  await p.click("text=I'M READY");
  others.push(p);
}
await host.waitForTimeout(800);
await shot(host, '01-lobby');
await host.click('text=START!');
const all = [host, ...others];
for (const p of all) await p.waitForSelector('.tickets-dlg', { timeout: 15000 });
await host.waitForTimeout(600);
await shot(host, '02-tickets');
for (const p of all) await p.click('.tickets-dlg .btn.red');
await host.waitForTimeout(1200);
await shot(host, '03-game');

// play a few turns: whoever's turn it is draws two blind cards (or claims if possible)
for (let turn = 0; turn < 9; turn++) {
  for (const p of all) {
    const mine = await p.evaluate(() => document.querySelector('.tb-main')?.textContent === 'YOUR TURN!');
    if (!mine) continue;
    await p.click('.pile.deck');
    await p.waitForTimeout(250);
    await p.click('.pile.deck');
    await p.waitForTimeout(500);
    break;
  }
}
await host.waitForTimeout(800);
await shot(host, '04-after-draws');
// zoom in and screenshot
await host.mouse.move(800, 420);
for (let i = 0; i < 4; i++) { await host.mouse.wheel(0, -300); await host.waitForTimeout(80); }
await host.waitForTimeout(400);
await shot(host, '05-zoomed');
// try to claim a route via the UI on whoever's turn it is (open claim dialog if affordable)
const state = await host.evaluate(() => document.querySelector('.tb-main')?.textContent);
console.log('turn banner:', state);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
