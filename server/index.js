// HTTP static server + WebSocket game server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { generateBoard } from '../shared/mapgen.js';
import { LobbyManager } from './lobby.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;

const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/geo.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/map.config.json'), 'utf8'));
const { board, errors, warnings } = generateBoard(config, geo);
if (errors.length) { console.error('data/map.config.json is invalid:\n  ' + errors.join('\n  ')); process.exit(1); }
if (warnings.length) console.warn('map warnings:\n  ' + warnings.join('\n  '));
console.log(`board "${board.name}": ${board.stats.cities} cities, ${board.stats.tracks} tracks, ${board.stats.tickets} tickets`);

const MOUNTS = [
  ['/vendor/three/', path.join(ROOT, 'node_modules/three/')],
  ['/shared/', path.join(ROOT, 'shared/')],
  ['/data/', path.join(ROOT, 'data/')],
  ['/', path.join(ROOT, 'public/')],
];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res) {
  let url;
  try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (url === '/') url = '/index.html';
  if (url === '/editor') url = '/editor.html';
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    const file = path.normalize(path.join(dir, url.slice(prefix.length)));
    if (!file.startsWith(dir)) break;
    if (prefix === '/vendor/three/' && !/\/(build|examples\/jsm)\//.test(file)) break;
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return notFound(res);
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': TYPES[ext] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': prefix === '/vendor/three/' ? 'public, max-age=86400' : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
    return;
  }
  notFound(res);
}
const notFound = (res) => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); };

const manager = new LobbyManager({ defaultBoard: board, geo });

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ ok: true, ...manager.stats() }));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  if (req.url === '/api/overrides') {
    let files = [];
    try { files = fs.readdirSync(path.join(ROOT, 'public/assets/overrides')).filter((f) => /\.(png|jpe?g|webp|gif|mp3|ogg|wav)$/i.test(f)); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({ files }));
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 200 * 1024 });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  manager.attach(ws);
  ws.on('message', (data, isBinary) => (isBinary ? manager.handleBinary(ws, data) : manager.handle(ws, data.toString())));
  ws.on('close', () => manager.detach(ws));
  ws.on('error', () => {});
});
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 25_000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => console.log(`Train Game listening on http://localhost:${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); process.exit(0); });
