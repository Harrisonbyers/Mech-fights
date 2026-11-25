/* Ironclad Arena multiplayer relay. Dependency free (Node 18+).
 * - Speaks a minimal WebSocket protocol by hand, so there is no npm install step.
 * - Rooms of up to 6 players, two teams of up to 3.
 * - The server only relays messages and keeps the team score. Each client simulates its own mech.
 * - If an index.html sits next to this file (render.yaml copies it there), it is served at "/".
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PLAYERS = 6, TEAM_CAP = 3, GOAL = 15, MAX_FRAME = 64 * 1024;
const rooms = new Map();
let nextId = 1;

const server = http.createServer((req, res) => {
  const file = path.join(__dirname, 'index.html');
  if ((req.url === '/' || req.url.startsWith('/?')) && fs.existsSync(file)) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
  } else {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('Ironclad Arena server is running. Rooms: ' + rooms.size + '\n');
  }
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  new Client(socket);
});

function frame(op, payload) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}

class Client {
  constructor(socket) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.frag = null;
    this.id = 0; this.room = null; this.team = 0; this.info = null;
    this.tokens = 80; this.lastRefill = Date.now(); this.alive = true; this.lastKill = 0;
    socket.on('data', d => this.onData(d));
    socket.on('close', () => this.onClose());
    socket.on('error', () => socket.destroy());
  }
  send(obj) { this.raw(frame(1, Buffer.from(JSON.stringify(obj)))); }
  raw(b) { if (!this.socket.destroyed) this.socket.write(b); }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (this.buf.length > MAX_FRAME * 4) { this.socket.destroy(); return; }
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const big = b.readBigUInt64BE(2); if (big > BigInt(MAX_FRAME)) { this.socket.destroy(); return; } len = Number(big); off = 10; }
      if (len > MAX_FRAME) { this.socket.destroy(); return; }
      if (!masked) { this.socket.destroy(); return; }
      if (b.length < off + 4 + len) return;
      const mask = b.slice(off, off + 4);
      const payload = Buffer.from(b.slice(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = b.slice(off + 4 + len);
      if (op === 8) { this.raw(frame(8, Buffer.alloc(0))); this.socket.end(); return; }
      if (op === 9) { this.raw(frame(10, payload)); continue; }
      if (op === 10) { this.alive = true; continue; }
      if (op === 1 || op === 2) { this.frag = fin ? null : [payload]; if (fin) this.onMessage(payload.toString('utf8')); }
      else if (op === 0 && this.frag) {
        this.frag.push(payload);
        if (fin) { const all = Buffer.concat(this.frag); this.frag = null; this.onMessage(all.toString('utf8')); }
      }
    }
  }
  onMessage(text) {
    const now = Date.now();
    this.tokens = Math.min(120, this.tokens + (now - this.lastRefill) * 0.08); this.lastRefill = now;
    if (this.tokens < 1) return;
    this.tokens -= 1;
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'join') return this.join(m);
    if (!this.room) return;
    const room = this.room;
    if (m.t === 's' || m.t === 'shot') {
      m.id = this.id;
      room.broadcast(m, this);
    } else if (m.t === 'hit') {
      const target = room.players.get(m.to | 0);
      if (!target || target === this) return;
      target.send({ t: 'hit', to: target.id, by: this.id, amt: Math.max(0, Math.min(150, +m.amt || 0)),
        dx: +m.dx || 0, dz: +m.dz || 0, knock: Math.max(0, Math.min(40, +m.knock || 0)), heavy: m.heavy ? 1 : 0 });
    } else if (m.t === 'kill') {
      if (now - this.lastKill < 1500 || room.over) return;
      this.lastKill = now;
      const killer = room.players.get(m.by | 0);
      const team = killer && killer.team !== this.team ? killer.team : 1 - this.team;
      room.score[team]++;
      room.broadcast({ t: 'kill', victim: this.id, by: killer ? killer.id : 0, score: room.score.slice() });
      if (room.score[team] >= GOAL) {
        room.over = true;
        room.broadcast({ t: 'win', team, score: room.score.slice() });
        setTimeout(() => { room.score = [0, 0]; room.over = false; room.broadcast({ t: 'reset' }); }, 8000);
      }
    }
  }
  join(m) {
    if (this.room) return;
    const code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!code) { this.send({ t: 'error', msg: 'Bad room code' }); return; }
    let room = rooms.get(code);
    if (!room) { room = new Room(code); rooms.set(code, room); }
    if (room.players.size >= MAX_PLAYERS) { this.send({ t: 'full' }); this.socket.end(); return; }
    const count = [0, 0];
    room.players.forEach(p => count[p.team]++);
    this.team = count[0] <= count[1] ? 0 : 1;
    if (count[this.team] >= TEAM_CAP) this.team = 1 - this.team;
    const clean = (s, n) => String(s || '').replace(/[^\w .\-]/g, '').slice(0, n);
    const lv = {};
    if (m.lv && typeof m.lv === 'object') Object.keys(m.lv).slice(0, 40).forEach(k => { lv[clean(k, 16)] = Math.max(0, Math.min(5, m.lv[k] | 0)); });
    this.id = nextId++; this.room = room;
    this.info = { id: this.id, name: clean(m.name, 14) || ('Pilot' + this.id), team: this.team, ch: clean(m.ch, 20), mw: clean(m.mw, 20), rw: clean(m.rw, 20), lv };
    const others = [];
    room.players.forEach(p => others.push(p.info));
    room.players.set(this.id, this);
    this.send({ t: 'welcome', id: this.id, team: this.team, room: code, players: others, score: room.score.slice(), goal: GOAL });
    room.broadcast({ t: 'join', p: this.info }, this);
  }
  onClose() {
    if (!this.room) return;
    const room = this.room;
    room.players.delete(this.id);
    room.broadcast({ t: 'leave', id: this.id });
    if (!room.players.size) rooms.delete(room.code);
    this.room = null;
  }
}

class Room {
  constructor(code) { this.code = code; this.players = new Map(); this.score = [0, 0]; this.over = false; }
  broadcast(obj, except) {
    const data = frame(1, Buffer.from(JSON.stringify(obj)));
    this.players.forEach(p => { if (p !== except) p.raw(data); });
  }
}

setInterval(() => {
  rooms.forEach(room => room.players.forEach(p => {
    if (!p.alive) { p.socket.destroy(); return; }
    p.alive = false; p.raw(frame(9, Buffer.alloc(0)));
  }));
}, 25000);

server.listen(PORT, () => console.log('Ironclad Arena server listening on ' + PORT));
