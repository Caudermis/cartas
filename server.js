'use strict';
// Servidor del juego de cartas. Sin dependencias: solo necesita Node 18 o superior.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { ACT, view } = require('./rules.js');
const PORT = process.env.PORT || 3000;
const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'rooms.json');
const PAGE = path.join(__dirname, 'public', 'index.html');

let rooms = {}; // código -> { S: estado de la partida, tok: {idJugador: token}, t: última actividad }
try { rooms = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* primera ejecución */ }
const conns = {}; // código -> { idJugador: Set(respuestas SSE) }

let timer = null;
const save = () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(rooms)); fs.renameSync(FILE + '.tmp', FILE); }
    catch (e) { console.error('No se pudo guardar:', e.message); }
  }, 250);
};
const rid = n => crypto.randomBytes(n).toString('hex');
const genCode = () => { let c; do { c = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[crypto.randomInt(32)]).join(''); } while (rooms[c]); return c; };
const online = code => { const o = {}; for (const p in conns[code] || {}) if (conns[code][p].size) o[p] = true; return o; };
function push(code) {
  const R = rooms[code]; if (!R) return;
  const on = online(code);
  for (const pid in conns[code] || {}) for (const res of conns[code][pid]) res.write('data: ' + JSON.stringify(view(R.S, pid, on)) + '\n\n');
}
const send = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
const cleanName = s => String(s || '').replace(/[<>&"']/g, '').trim().slice(0, 20);
const auth = b => { const R = rooms[String(b.code || '').toUpperCase()]; return R && b.pid && R.tok[b.pid] && R.tok[b.pid] === b.token && R.S.players.some(p => p.id === b.pid) ? R : null; };
const body = req => new Promise((ok, no) => {
  let s = ''; req.on('data', d => { s += d; if (s.length > 20000) { no(new Error('grande')); req.destroy(); } });
  req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { no(e); } });
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), u = url.pathname;
  try {
    if (req.method === 'GET' && (u === '/' || u === '/index.html')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(PAGE)); }
    if (req.method === 'GET' && u === '/healthz') return send(res, 200, { ok: 1 });
    if (req.method === 'GET' && u === '/api/events') { // tiempo real: cada jugador recibe SOLO su vista filtrada
      const code = String(url.searchParams.get('code') || '').toUpperCase(), pid = url.searchParams.get('pid');
      const R = auth({ code, pid, token: url.searchParams.get('token') });
      if (!R) return send(res, 401, { error: 'Sesión no válida' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      ((conns[code] = conns[code] || {})[pid] = conns[code][pid] || new Set()).add(res);
      res.write('retry: 2000\n\ndata: ' + JSON.stringify(view(R.S, pid, online(code))) + '\n\n');
      push(code);
      req.on('close', () => { conns[code][pid].delete(res); push(code); });
      return;
    }
    if (req.method !== 'POST') return send(res, 404, { error: 'No encontrado' });
    const b = await body(req);
    if (u === '/api/create') {
      const name = cleanName(b.name); if (!name) return send(res, 400, { error: 'Escribe un nombre' });
      const code = genCode(), pid = 'p' + rid(5), token = rid(12);
      rooms[code] = { t: Date.now(), tok: { [pid]: token }, S: { code, host: pid, phase: 'lobby', round: 0, seq: 0, rounds: [], log: [], chat: [], players: [{ id: pid, name }] } };
      save(); return send(res, 200, { code, pid, token });
    }
    if (u === '/api/join') {
      const code = String(b.code || '').toUpperCase(), R = rooms[code];
      if (!R) return send(res, 404, { error: 'Sala no encontrada' });
      if (b.pid && R.tok[b.pid] && R.tok[b.pid] === b.token && R.S.players.some(p => p.id === b.pid)) return send(res, 200, { code, pid: b.pid, token: b.token }); // reconexión
      const name = cleanName(b.name); if (!name) return send(res, 400, { error: 'Escribe un nombre' });
      const pid = 'p' + rid(5), e = ACT.join(R.S, pid, { name });
      if (e) return send(res, 400, { error: e });
      R.tok[pid] = rid(12); R.t = Date.now(); R.S.seq++; save(); push(code);
      return send(res, 200, { code, pid, token: R.tok[pid] });
    }
    const R = auth(b); if (!R) return send(res, 401, { error: 'Sesión no válida' });
    const code = String(b.code).toUpperCase();
    if (u === '/api/act') {
      const t = String(b.type || ''); if (!ACT[t] || t === 'join') return send(res, 400, { error: 'Acción desconocida' });
      const x = b.args || {}, a = {};
      if (Number.isInteger(x.i)) a.i = x.i; if (Number.isInteger(x.ri)) a.ri = x.ri; if (typeof x.rp === 'string') a.rp = x.rp.slice(0, 40);
      const copy = JSON.parse(JSON.stringify(R.S)), out = {}, e = ACT[t](copy, b.pid, a, out); // se valida sobre una copia
      if (e) return send(res, 400, { error: e });
      copy.seq++; R.S = copy; R.t = Date.now(); save(); push(code);
      return send(res, 200, { ok: 1, card: out.card, msg: out.msg }); // out.card = carta vista, solo para quien la mira
    }
    if (u === '/api/chat') {
      const x = String(b.text || '').trim().slice(0, 300); if (!x) return send(res, 400, { error: 'Vacío' });
      const S = R.S; S.chat = (S.chat || []).concat({ n: S.players.find(p => p.id === b.pid).name, x, t: Date.now() }).slice(-200);
      S.seq++; R.t = Date.now(); save(); push(code); return send(res, 200, { ok: 1 });
    }
    send(res, 404, { error: 'No encontrado' });
  } catch (e) { try { send(res, 400, { error: 'Petición no válida' }); } catch (_) { /* conexión cerrada */ } }
}).listen(PORT, () => console.log('Servidor en el puerto ' + PORT));

setInterval(() => { for (const c in conns) for (const p in conns[c]) for (const r of conns[c][p]) r.write(': ping\n\n'); }, 20000);
setInterval(() => { const lim = Date.now() - 7 * 864e5; for (const c in rooms) if (rooms[c].t < lim) delete rooms[c]; save(); }, 36e5);
