'use strict';
// Prueba de extremo a extremo: node test.js
const { spawn } = require('child_process'), path = require('path'), fs = require('fs'), os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cj-')), PORT = 4100 + Math.floor(Math.random() * 500), base = 'http://localhost:' + PORT;
let srv = null, fails = 0;
const ck = (c, m) => { if (!c) { fails++; console.log('FALLO:', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const boot = () => new Promise(ok => { srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, DATA_DIR: dir }, cwd: __dirname }); srv.stdout.on('data', d => { if (String(d).includes('puerto')) ok(); }); });
const api = async (p, b) => { const r = await fetch(base + '/api/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { st: r.status, j: await r.json() }; };
const num = c => (c >> 2) + 1;
function privacy(bot) {
  const v = bot.v, raw = bot.raw;
  if (!['reveal', 'over'].includes(v.phase)) ck(Object.values(v.hands).flat().every(x => x === null), 'cartas ocultas viajan como null (' + v.phase + ')');
  ck(!('deck' in v) && !/token|tok"/.test(raw), 'la vista no contiene mazo ni tokens');
  if (v.turn !== bot.pid || v.phase !== 'play') ck(v.held === undefined && v.p12 === undefined, 'held/p12 solo para quien juega');
  else if (v.p12) ck(v.turn === bot.pid, 'p12 solo para el actor');
}
async function connect(code, pid, token, bot) {
  const r = await fetch(`${base}/api/events?code=${code}&pid=${pid}&token=${token}`);
  if (r.status !== 200) return r.status;
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
  bot.close = () => rd.cancel().catch(() => {});
  (async () => { for (;;) { let x; try { x = await rd.read(); } catch (e) { return; } if (x.done) return; buf += dec.decode(x.value); let k;
    while ((k = buf.indexOf('\n\n')) >= 0) { const m = buf.slice(0, k); buf = buf.slice(k + 2); const l = m.split('\n').find(s => s.startsWith('data: ')); if (l) { bot.raw = l.slice(6); bot.v = JSON.parse(bot.raw); privacy(bot); } } } })();
  for (let i = 0; i < 100 && !bot.v; i++) await sleep(10);
  return 200;
}
async function game(n) {
  const c = await api('create', { name: 'J0' }); const code = c.j.code, bots = [{ pid: c.j.pid, token: c.j.token }];
  for (let i = 1; i < n; i++) { const j = await api('join', { code, name: 'J' + i }); ck(j.st === 200, 'unirse'); bots.push({ pid: j.j.pid, token: j.j.token }); }
  if (n == 4) { ck((await api('join', { code, name: 'X' })).st === 400, 'quinto jugador rechazado'); }
  ck((await api('join', { code, pid: bots[0].pid, token: 'mal' })).st === 400, 'token falso no reconecta');
  const rj = await api('join', { code, pid: bots[1].pid, token: bots[1].token }); ck(rj.st === 200 && rj.j.pid === bots[1].pid, 'reconexión con token');
  for (const b of bots) ck(await connect(code, b.pid, b.token, b) === 200, 'sse');
  const act = async (b, type, args) => { const s0 = Math.max(...bots.map(x => (x.v ? x.v.seq : 0))); const r = await api('act', { code, pid: b.pid, token: b.token, type, args: args || {} }); if (r.st === 200) { let i = 0; for (; i < 300 && !bots.every(x => x.v.seq > s0); i++) await sleep(3); if (i >= 300 && !global.d2) { global.d2 = 1; console.log('ESPERA AGOTADA', type, s0, bots.map(x => x.v.seq)); } } return r; };
  ck((await act(bots[1], 'start')).st === 400, 'solo el anfitrión inicia');
  if (n < 2) return;
  await act(bots[0], 'chat'); await api('chat', { code, pid: bots[1].pid, token: bots[1].token, text: 'hola' }); await sleep(20);
  ck(bots[0].v.chat.some(m => m.x === 'hola'), 'chat llega a todos');
  ck((await act(bots[0], 'start')).st === 200, 'iniciar');
  ck((await api('join', { code, name: 'Tarde' })).st === 400, 'no se entra con la partida empezada');
  const host = bots[0]; let steps = 0, lastRound = 0;
  while (host.v.phase !== 'over' && steps++ < 6000) {
    const v = host.v;
    if (v.phase === 'peek') {
      ck(v.cpp === v.round + 3, 'cartas por ronda'); lastRound = v.round;
      for (const b of bots) { const want = Math.floor(v.cpp / 2); ck(b.v.allow[b.pid] === want, `mirar ${want} con ${v.cpp} cartas`);
        for (let k = 0; k < want; k++) { const r = await act(b, 'peek', { i: k }); ck(r.st === 200 && Number.isInteger(r.j.card), 'peek devuelve la carta'); }
        ck((await act(b, 'peek', { i: 0 })).st === 400, 'no se puede mirar de más'); await act(b, 'ready'); }
      continue;
    }
    if (v.phase === 'reveal') { ck(Object.values(host.v.hands).flat().every(x => Number.isInteger(x)), 'se revelan todas'); const w = v.winner; await act(host, 'nextround'); if (host.v.phase === 'peek') ck(host.v.start === w, 'empieza el ganador'); continue; }
    if (v.phase !== 'play') break;
    const by = id => bots.find(b => b.pid === id);
    if (v.dec) { const b = by(v.dec); await act(b, Math.random() < .5 ? 'keep' : 'unplant'); continue; }
    if (!v.turn) { ck(false, 'bloqueada sin turno'); break; }
    const a = by(v.turn), others = bots.filter(b => b !== a);
    if (v.qd && !v.qd.done) for (const o of others) if (Math.random() < .5) { const hand = o.v.hands[o.pid]; const r = await act(o, 'quick', { i: Math.floor(Math.random() * hand.length) }); ck([200, 400].includes(r.st), 'quick'); }
    if (v.sub !== 'drawn') { ck((await act(others[0], 'draw')).st === 400, 'fuera de turno'); ck((await act(a, 'discard')).st === 400, 'descartar sin robar'); }
    if (a.v.sub === 'draw' && a.v.turn === a.pid) {
      if (Math.random() < .04 && !a.v.planted[a.pid]) { await act(a, 'plant'); continue; }
      if (Math.random() < .03 && a.v.planted[a.pid]) { await act(a, 'unplant'); continue; }
      const r = await act(a, 'draw'); if (r.st !== 200) { ck(false, 'robar: ' + r.j.error); break; }
      if (a.v.sub === 'drawn') ck((await act(a, 'draw')).st === 400, 'no robar dos veces');
    }
    if (a.v.sub === 'drawn' && a.v.turn === a.pid) {
      const h = a.v.held, nn = num(h), x = Math.random();
      if (nn !== 11) ck((await act(a, 'use11')).st === 400, '11 solo si es un 11');
      if (nn !== 12) ck((await act(a, 'use12')).st === 400, '12 solo si es un 12');
      if (nn === 11 && x < .6) { await act(a, 'use11'); const r = await act(a, 'look11', { i: 0 }); ck(Number.isInteger(r.j.card), 'look11'); }
      else if (nn === 12 && x < .6) { await act(a, 'use12'); const o = others[0], r = await act(a, 'pick12', { rp: o.pid, ri: 0 }); ck(Number.isInteger(r.j.card), 'pick12 revela solo al actor'); ck(a.v.p12 && Number.isInteger(a.v.p12.c), 'actor ve p12'); await act(a, 'swap12', { i: 0 }); }
      else if (x < .7) await act(a, 'replace', { i: Math.floor(Math.random() * a.v.hands[a.pid].length) });
      else await act(a, 'discard');
    }
    if (a.v.sub === 'a11') await act(a, 'look11', { i: 0 });
  }
  ck(host.v.phase === 'over', `la partida termina (${n} jug., pasos ${steps}, fase ${host.v.phase})`);
  ck(host.v.rounds.length === 7 && lastRound === 7, '7 rondas');
  bots.forEach(b => b.close && b.close());
}
(async () => {
  await boot();
  for (const n of [2, 3, 4]) await game(n);
  // persistencia: crear sala, reiniciar el servidor y recuperar
  const c = await api('create', { name: 'P' }); const j = await api('join', { code: c.j.code, name: 'Q' }); await sleep(400);
  srv.kill(); await sleep(300); await boot();
  const bot = {}; ck(await connect(c.j.code, c.j.pid, c.j.token, bot) === 200 && bot.v.players.length === 2, 'la sala sobrevive a un reinicio');
  ck(await connect(c.j.code, c.j.pid, 'falso', {}) === 401, 'token falso rechazado en el tiempo real');
  bot.close && bot.close(); srv.kill();
  console.log(fails ? 'FALLOS: ' + fails : 'TODO CORRECTO'); process.exit(fails ? 1 : 0);
})();
