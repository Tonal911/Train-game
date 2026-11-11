# TRAIN GAME!

A goofy, MS-Paint-looking multiplayer route-building train game across the US and Canada. It runs in the browser, has 2–5 players per lobby, and supports several lobbies at once.

- **Server:** Node 20+, plain `http` + `ws`. The server is authoritative: every move is validated by the rules engine.
- **Client:** vanilla ES modules with no build step. The map is a painted canvas under an SVG overlay. The toy wagons are three.js models rendered to sticker PNGs.
- **Board:** generated from a list of cities by heuristics (`shared/mapgen.js`). You can add, move or delete cities in the built-in map editor.

## Play

1. Open the site and pick a name.
2. **CREATE LOBBY**, then **COPY INVITE** and send the link to friends (or they click **JOIN** in the lobby list).
3. Everyone clicks **I'M READY**, then the host clicks **START!**

Refreshing or briefly losing your connection keeps your seat: your identity is stored in the browser. If a player disappears for more than 20 s on their turn, anyone can **SKIP** them.

### Rules
- Setup: 4 train cards each, 5 face-up cards, 3 destination tickets each (keep at least 2), 45 trains each (adjustable per lobby).
- On your turn, do exactly one of:
  - **Draw 2 train cards**, blind or face-up. Taking a face-up Locomotive (wild) uses your whole turn, and you can't take one as your 2nd card. If 3 Locomotives are ever face-up, all 5 are discarded and redealt.
  - **Claim a route**: pay as many cards of its color as its length (gray means any single color). Locomotives substitute for anything. Score 1/2/4/7/10/15 for lengths 1–6, and 18/21/27 for the 7/8/9 express lines.
  - **Draw 3 destination tickets** and keep at least 1. Returned tickets go to the bottom of the pile.
- Double routes: one player can't take both tracks. With 2–3 players, only one track of each double can be used.
- When someone ends a turn with ≤ 2 trains, everyone (including them) gets one final turn.
- Final scoring: completed tickets add their value, unfinished tickets subtract it, and the longest continuous line gets +10 (ties all get it). Tie-breaks are most completed tickets, then longest line.
- The draw pile reshuffles from the discards when it runs out. If nothing at all is possible, you may pass.

### Controls
Scroll to zoom, drag to pan, double-click to zoom in (Shift+double-click to zoom out). Keys `+` `-` `0`. Hover a ticket to light up its cities. Hover a route for its details, and click it to claim. Other players' hands always show as fanned card backs with counts. Any colors they took face-up appear as chips under their hand.

## Run locally

```bash
npm install
npm start            # http://localhost:3000
npm test             # rules engine + board generator tests (incl. 40 random bot games)
npm run board        # print board stats/warnings, write board-preview.svg
node e2e/smoke.mjs http://localhost:3000      # 3-browser lobby + turns (needs Playwright)
node e2e/fullgame.mjs http://localhost:3000   # complete 2-player game in real browsers
```

## Deploy (Render, free)

GitHub Pages can't run this, because lobbies need a live server. Render runs it for free:

1. Sign in at render.com with GitHub.
2. **New → Blueprint**, pick this repo. `render.yaml` sets everything up (build `npm ci`, start `npm start`, health check `/healthz`).
3. Every push to the default branch redeploys.

Notes:
- The free plan sleeps after ~15 minutes idle, so the first visitor waits ~30–60 s.
- Lobbies live in memory, so a redeploy or restart ends running games.
- The server caps at 12 lobbies (`MAX_LOBBIES` in `shared/config.js`). 3 lobbies of 5 is nothing for it.

## Changing the map

### With the editor (`/editor`)
- **+ ADD CITY**: click on the map and name the city.
- **SELECT / MOVE**: drag cities, or edit name, size, label side and lat/lon.
- **Click a route** to force its color or length, toggle double track, or remove it.
- **+ FORCE ROUTE**: click two cities.
- **Pin express lines**, tweak the generator knobs, and reroll the seed.
- **DOWNLOAD JSON** when done. Then either:
  - **Use it in one lobby:** the host clicks **UPLOAD MAP JSON** in the lobby.
  - **Make it the default:** replace `data/map.config.json` with it and push.

### Constraints (enforced in the editor, on upload and at server start)
- 10–60 cities, unique names ≤ 22 chars, inside the map frame (southern Canada + continental US), and ≥ 170 km from any other city.
- Every city gets ≥ 2 connections and the network is connected. Routes never cross each other, don't pass through other cities, and don't cross open ocean (lakes are fine).

### Heuristics (`generator` block in `map.config.json`)

| Knob | Default | Meaning |
|---|---|---|
| `kmPerTrain` | 195 | Track length = great-circle km / kmPerTrain, clamped to `minLength`–`maxLength` (1–6). |
| `mountainFactor` | 0.35 | Routes through the `terrain.mountains` polygons (Rockies, Sierra/Cascades, Appalachians) get up to +35% length. |
| `blockAngle` | 95 | Which city pairs connect: A–B is skipped if another city sits "between" them (seen at > blockAngle°). Lower = sparser, higher = denser. |
| `maxKm` | 1350 | Longest normal connection. |
| `cityClearance` | 55 | Map units a route must keep from other cities. |
| `doubleShare` | 0.24 | Share of connections between bigger cities (size 2–3) that become double tracks. |
| `doubleMaxLength` | 5 | Longest route that can become a double. |
| `grayShare` | 0.3 | Share of track that's gray. |
| `express` | — | `count` extra-long lines of length 7–9 between cities 1350–2700 km apart, drawn as arcs that avoid every other route. |
| `tickets` | — | Ticket value = shortest path in trains. Tickets are drawn from value buckets, with each city used ≤ 3 times. |

Overrides (`overrides` in the JSON, which the editor writes for you):

```json
{
  "addRoutes":    [{ "a": "Omaha", "b": "Denver", "length": 4, "color": "red", "double": false }],
  "removeRoutes": [["Seattle", "Portland"]],
  "setRoutes":    [{ "a": "Chicago", "b": "St. Louis", "color": "red", "color2": "blue", "length": 2, "double": true }],
  "express":      [["Vancouver", "Winnipeg"]]
}
```

Colors on a board can shift when you add a city, because assignment is a balanced greedy pass. Pin any you care about with `setRoutes`.

## Extra wagons and cards
In each lobby, the host can set:
- **trains per player** (20–80)
- **extra Locomotives** (+0–20 on top of 14)
- **extra cards per color** (+0–12 on top of 12)

Card colors themselves are data (`CARD_COLORS` in `shared/config.js`). Add an entry there to add a color: the deck, the generator and the UI pick it up. Give it a `model` from `public/js/toys3d.js` or add a new toy.

## Art
- Map: `public/js/paintmap.js` paints a pale atlas (Natural Earth, public domain), then sloppy flat primaries over it: US red, Canada yellow, Mexico green. It adds a blue ocean with zigzag waves, dark-shade mountain zigzags and a few doodles.
- Cards: Uno-ish layout (white rim, color face, tilted splat, corner symbol per color for colorblind players). The art is 3D toy wagons rendered in three.js and turned into white-outlined, slightly squeezed stickers. The Locomotive uses `public/assets/rainbow.jpg`. Every visit opens on `public/assets/loco.jpg`: an unskippable 3 s fade from black, then the "LET ME IN!!" button.
- **Swap in your own art** without touching code by dropping files into `public/assets/overrides/` (see the README there): `card-red.png`, …, `card-loco.png`, `piece-blue.png`, …, `cardback.png`.
- `/cards.html` is a gallery of every card and piece.

## Layout
```
server/index.js     static files + WebSocket, map validation at boot
server/lobby.js     sessions, lobbies, reconnects, skip, chat, cleanup
shared/engine.js    rules engine (server-authoritative; client uses helpers)
shared/mapgen.js    board generator + config validation
shared/projection.js / geom.js / rng.js / config.js
data/map.config.json  cities, terrain, generator knobs, overrides
data/geo.json       projected coastlines/lakes/borders (scripts/build-geo.mjs)
public/             client (index.html, editor.html, cards.html, js/, css/, assets/)
test/               node:test suites;  e2e/  Playwright scripts
```
