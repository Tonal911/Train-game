// WebSocket client with auto-reconnect. Identity token lives in localStorage so a refresh keeps your seat.
import { storage } from './util.js';

export class Net {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.queue = [];
    this.backoff = 600;
    this.connect();
    setInterval(() => this.send({ t: 'ping' }, false), 20000);
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.onStatus('connecting');
    ws.onopen = () => {
      this.backoff = 600;
      ws.send(JSON.stringify({ t: 'hello', token: storage('tg_token'), name: storage('tg_name') }));
      this.onStatus('online');
      for (const m of this.queue.splice(0)) ws.send(m);
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'welcome') { storage('tg_token', msg.token); storage('tg_name', msg.name); }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      this.onStatus('offline');
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 1.7, 6000);
    };
    ws.onerror = () => {};
  }

  send(obj, queueIfOffline = true) {
    const data = JSON.stringify(obj);
    if (this.ws && this.ws.readyState === 1) this.ws.send(data);
    else if (queueIfOffline && obj.t !== 'act') this.queue.push(data);
  }
}
