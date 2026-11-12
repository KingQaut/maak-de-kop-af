// Maak de kop af - kleine spelserver zonder afhankelijkheden.
// Start: node server.js   (poort via PORT, standaard 3000)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PLAYERS = 30;
const MAX_HEADLINES = 40;

const rooms = new Map();

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/docent': ['teacher.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/qrcode.js': ['qrcode.js', 'text/javascript; charset=utf-8'],
};

const EDGE = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u;
const norm = (s) => String(s).trim().toLowerCase().match(EDGE)[2];

function newCode() {
  const abc = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += abc[crypto.randomInt(abc.length)];
    if (!rooms.has(c)) return c;
  }
}

function buildHeadline(h) {
  if (!h || typeof h.text !== 'string') return null;
  const words = h.text.trim().slice(0, 200).split(/\s+/).filter(Boolean);
  const i = Number(h.hidden);
  if (!Number.isInteger(i) || i < 0 || i >= words.length) return null;
  const [, pre, core, post] = words[i].match(EDGE);
  if (!core) return null;
  const rest = words.slice(i + 1).join(' ');
  return {
    before: (i > 0 ? words.slice(0, i).join(' ') + ' ' : '') + pre,
    word: core,
    after: post + (rest ? ' ' + rest : ''),
  };
}

function groupsFor(room) {
  const h = room.headlines[room.idx];
  const right = norm(h.word);
  const map = new Map();
  for (const [pid, ans] of room.answers) {
    const p = room.players.get(pid);
    if (!p) continue;
    const key = norm(ans);
    if (!map.has(key)) {
      map.set(key, { key, text: key === right ? h.word : ans, names: [], correct: key === right, ok: room.approved.has(key) });
    }
    map.get(key).names.push(p.name);
  }
  return [...map.values()].sort((a, b) => b.correct - a.correct || b.names.length - a.names.length);
}

function view(room, pid) {
  const s = {
    code: room.code,
    phase: room.phase,
    players: [...room.players].map(([id, p]) => ({ name: p.name, answered: room.answers.has(id) })),
    idx: room.idx,
    total: room.headlines.length,
  };
  const h = room.headlines[room.idx];
  if (h && (room.phase === 'answer' || room.phase === 'reveal')) {
    s.headline = { before: h.before, after: h.after };
    if (room.phase === 'reveal') {
      s.headline.word = h.word;
      s.groups = groupsFor(room);
    }
  }
  if (pid) {
    const answer = room.answers.get(pid) || '';
    s.me = { name: room.players.get(pid).name, answer };
    if (room.phase === 'reveal') {
      const key = norm(answer);
      s.me.result = !answer ? 'none' : key === norm(h.word) ? 'correct' : room.approved.has(key) ? 'ok' : 'other';
    }
  }
  return s;
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => {
      buf += c;
      if (buf.length > 50000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(JSON.parse(buf || '{}') || {}); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function hostAction(room, b) {
  switch (b.action) {
    case 'start': {
      if (!Array.isArray(b.headlines)) return 'Geen koppen.';
      const list = b.headlines.slice(0, MAX_HEADLINES).map(buildHeadline).filter(Boolean);
      if (!list.length) return 'Geen geldige koppen.';
      room.headlines = list;
      room.idx = 0;
      room.answers = new Map();
      room.approved = new Set();
      room.phase = 'answer';
      return null;
    }
    case 'reveal':
      if (room.phase === 'answer') room.phase = 'reveal';
      return null;
    case 'mark': {
      if (room.phase !== 'reveal') return null;
      const key = norm(b.key || '');
      if (!key || key === norm(room.headlines[room.idx].word)) return null;
      if (room.approved.has(key)) room.approved.delete(key); else room.approved.add(key);
      return null;
    }
    case 'next':
      if (room.phase !== 'reveal') return null;
      room.answers = new Map();
      room.approved = new Set();
      if (room.idx + 1 < room.headlines.length) { room.idx++; room.phase = 'answer'; }
      else room.phase = 'end';
      return null;
    case 'lobby':
      room.phase = 'lobby';
      room.headlines = [];
      room.idx = 0;
      room.answers = new Map();
      room.approved = new Set();
      return null;
    case 'remove': {
      for (const [id, p] of room.players) {
        if (p.name === b.name) { room.players.delete(id); room.answers.delete(id); }
      }
      return null;
    }
    default:
      return 'Onbekende actie.';
  }
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // api, room, CODE, action
  if (parts[1] !== 'room') return send(res, 404, { error: 'Niet gevonden.' });

  if (parts.length === 2 && req.method === 'POST') {
    const room = {
      code: newCode(), hostKey: crypto.randomBytes(16).toString('hex'), touched: Date.now(),
      phase: 'lobby', players: new Map(), headlines: [], idx: 0, answers: new Map(), approved: new Set(),
    };
    rooms.set(room.code, room);
    return send(res, 200, { code: room.code, hostKey: room.hostKey });
  }

  const room = rooms.get(String(parts[2] || '').toUpperCase());
  if (!room) return send(res, 404, { error: 'Deze code bestaat niet.' });
  room.touched = Date.now();
  const action = parts[3];

  if (action === 'state' && req.method === 'GET') {
    const host = url.searchParams.get('host');
    const pid = url.searchParams.get('pid');
    if (host) {
      if (host !== room.hostKey) return send(res, 403, { error: 'Geen toegang.' });
      return send(res, 200, view(room, null));
    }
    if (!pid || !room.players.has(pid)) return send(res, 404, { error: 'Speler niet gevonden.' });
    return send(res, 200, view(room, pid));
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'Niet toegestaan.' });
  const b = await readBody(req);

  if (action === 'join') {
    const name = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 20);
    if (!name) return send(res, 400, { error: 'Typ je naam.' });
    if (room.players.size >= MAX_PLAYERS) return send(res, 400, { error: 'De klas is vol.' });
    for (const p of room.players.values()) {
      if (p.name.toLowerCase() === name.toLowerCase()) return send(res, 400, { error: 'Deze naam is al gekozen. Kies een andere naam.' });
    }
    const pid = crypto.randomBytes(12).toString('hex');
    room.players.set(pid, { name });
    return send(res, 200, { pid });
  }

  if (action === 'answer') {
    if (!room.players.has(b.pid)) return send(res, 404, { error: 'Speler niet gevonden.' });
    if (room.phase !== 'answer') return send(res, 400, { error: 'Je kunt nu niet antwoorden.' });
    const ans = String(b.answer || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    if (!norm(ans)) return send(res, 400, { error: 'Typ een woord.' });
    room.answers.set(b.pid, ans);
    return send(res, 200, { ok: true });
  }

  if (action === 'host') {
    if (b.hostKey !== room.hostKey) return send(res, 403, { error: 'Geen toegang.' });
    const err = hostAction(room, b);
    if (err) return send(res, 400, { error: err });
    return send(res, 200, view(room, null));
  }

  send(res, 404, { error: 'Niet gevonden.' });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    return api(req, res, url).catch(() => send(res, 500, { error: 'Er ging iets mis.' }));
  }
  const f = STATIC[url.pathname];
  if (!f) { res.writeHead(404); return res.end('Niet gevonden'); }
  fs.readFile(path.join(PUBLIC, f[0]), (err, data) => {
    if (err) { res.writeHead(500); return res.end('Fout'); }
    res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Maak de kop af draait op http://localhost:${PORT}  (docent: /docent)`));

setInterval(() => {
  const now = Date.now();
  for (const [c, r] of rooms) if (now - r.touched > ROOM_TTL_MS) rooms.delete(c);
}, 10 * 60 * 1000).unref();
