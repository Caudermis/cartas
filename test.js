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
  while (host.v.phase !== 'over' && steps++ < 40000) {
    const v = host.v;
    if (v.phase === 'peek') {
      lastRound = v.round; const prev = host.prevSize;
      for (const b of bots) { const n = v.size[b.pid]; ck(n >= 4 && n <= 10, 'tamaño de mano entre 4 y 10 (' + n + ')'); ck(v.hands[b.pid].length === n, 'la mano tiene su tamaño');
        if (v.round === 1) ck(n === 4, 'todos empiezan con 4'); else if (prev) ck(n === prev[b.pid] + (b.pid === host.prevWinner ? 1 : 0), 'solo el ganador suma una carta'); }
      host.prevSize = Object.assign({}, v.size);
      for (const b of bots) { const want = Math.floor(v.size[b.pid] / 2); ck(b.v.allow[b.pid] === want, `mirar ${want} con ${v.size[b.pid]} cartas`);
        for (let k = 0; k < want; k++) { const r = await act(b, 'peek', { i: k }); ck(r.st === 200 && Number.isInteger(r.j.card), 'peek devuelve la carta'); }
        ck((await act(b, 'peek', { i: 0 })).st === 400, 'no se puede mirar de más'); await act(b, 'ready'); }
      continue;
    }
    if (v.phase === 'reveal') { ck(Object.values(host.v.hands).flat().every(x => Number.isInteger(x)), 'se revelan todas'); const w = v.winner; host.prevWinner = w; await act(host, 'nextround'); if (host.v.phase === 'peek') ck(host.v.start === w, 'empieza el ganador'); continue; }
    if (v.phase !== 'play') break;
    const by = id => bots.find(b => b.pid === id);
    if (v.dec) { const b = by(v.dec); await act(b, Math.random() < .5 ? 'keep' : 'unplant'); continue; }
    if (!v.turn) { ck(false, 'bloqueada sin turno'); break; }
    const a = by(v.turn), others = bots.filter(b => b !== a);
    if (v.qd && !v.qd.done) for (const o of others) if (Math.random() < .5) { const hand = o.v.hands[o.pid]; const r = await act(o, 'quick', { i: Math.floor(Math.random() * hand.length) }); ck([200, 400].includes(r.st), 'quick'); }
    if (v.sub !== 'a12b') ck((await act(a, 'skip12')).st === 400, 'skip12 solo tras mirar con el 12');
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
      else if (nn === 12 && x < .6) { await act(a, 'use12'); const o = others[0], r = await act(a, 'pick12', { rp: o.pid, ri: 0 }); ck(Number.isInteger(r.j.card), 'pick12 revela solo al actor'); ck(a.v.p12 && Number.isInteger(a.v.p12.c), 'actor ve p12'); if (Math.random() < .4) { const before = JSON.stringify(a.v.hands[o.pid].length); const r2 = await act(a, 'skip12'); ck(r2.st === 200, 'skip12 termina el turno sin intercambiar');
          const M = o.v.mark; ck(M && M.kind === 'look' && M.rp === o.pid && M.ri === 0 && !('c' in M) && !/"c":/.test(JSON.stringify(M)), 'el rival ve la marca de que miraron su carta, sin valor'); ck(a.v.mark && a.v.mark.kind === 'look', 'todos ven la marca'); ck(String(a.v.hands[o.pid].length) === before, 'skip12 no cambia manos'); }
        else { await act(a, 'swap12', { i: 0 }); const M = o.v.mark; ck(M && M.kind === 'swap' && M.rp === o.pid && !/"c":/.test(JSON.stringify(M)), 'marca de intercambio sin valor'); } }
      else if (x < .7) await act(a, 'replace', { i: Math.floor(Math.random() * a.v.hands[a.pid].length) });
      else await act(a, 'discard');
    }
    if (a.v.sub === 'a11') await act(a, 'look11', { i: 0 });
  }
  ck(host.v.phase === 'over', `la partida termina (${n} jug., pasos ${steps}, fase ${host.v.phase})`);
  ck(host.v.rounds.length === lastRound && Math.max(...Object.values(host.v.size)) >= 10, 'la partida acaba en la ronda donde alguien tiene 10 cartas');
  bots.forEach(b => b.close && b.close());
}
function unit() {
  const R = require('./rules.js'), { ACT, view, CFG } = R;
  const mkS = () => { const S = { code: 'T', host: 'a', phase: 'lobby', round: 0, seq: 0, rounds: [], log: [], players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] };
    ACT.start(S, 'a'); S.phase = 'play'; S.turn = 'a'; S.ti = 0; S.sub = 'drawn'; S.held = 44; S.hands = { a: [0, 1, 2, 3], b: [4, 5, 6, 7] }; S.deck = [8, 9, 10]; S.disc = []; S.planted = {}; S.last = null; S.dec = null; return S; };
  let S = mkS(), out = {};
  ck(ACT.use12(S, 'a', {}, out) === undefined && S.sub === 'a12a', 'unit: usar 12');
  ck(typeof ACT.skip12(S, 'a', {}, {}) === 'string', 'unit: skip12 no vale antes de mirar');
  ACT.pick12(S, 'a', { rp: 'b', ri: 1 }, out); ck(out.card === 5 && S.sub === 'a12b', 'unit: pick12 revela la carta al actor');
  ck(typeof ACT.skip12(S, 'b', {}, {}) === 'string', 'unit: skip12 solo el actor');
  ck(ACT.skip12(S, 'a', {}, {}) === undefined, 'unit: skip12 válido');
  ck(JSON.stringify(S.hands) === JSON.stringify({ a: [0, 1, 2, 3], b: [4, 5, 6, 7] }), 'unit: skip12 deja las manos igual');
  ck(S.mark && S.mark.kind === 'look' && S.mark.rp === 'b' && S.mark.ri === 1 && S.mark.until > Date.now() && S.mark.until <= Date.now() + CFG.MARK_MS, 'unit: marca de mirada con caducidad');
  ck(S.turn === 'b' && S.sub === 'draw' && S.p12 === null && S.held === null, 'unit: pasa el turno al siguiente');
  const vb = view(S, 'b'); ck(vb.mark && vb.mark.rp === 'b' && !('c' in vb.mark) && vb.p12 === undefined, 'unit: la vista lleva la marca sin valores');
  S = mkS(); ACT.use12(S, 'a', {}, {}); ACT.pick12(S, 'a', { rp: 'b', ri: 1 }, {}); ACT.swap12(S, 'a', { i: 0 }, {});
  ck(S.hands.a[0] === 5 && S.hands.b[1] === 0 && S.mark.kind === 'swap' && S.mark.ri === 1, 'unit: swap12 intercambia y marca');
  S = mkS(); S.planted = { b: true }; ACT.use12(S, 'a', {}, {}); ACT.pick12(S, 'a', { rp: 'b', ri: 1 }, {}); ACT.skip12(S, 'a', {}, {});
  ck(!S.dec, 'unit: mirar sin cambiar no obliga a decidir a un plantado');
  const S2 = mkS(); ACT.use12(S2, 'a', {}, {}); ACT.pick12(S2, 'a', { rp: 'b', ri: 1 }, {}); ACT.skip12(S2, 'a', {}, {}); R.deal(S2, 'a'); ck(S2.mark === null, 'unit: la marca se borra al repartir');
}
// Prueba del cliente: ejecuta el script de public/index.html con un navegador simulado y lo alimenta con vistas reales del servidor.
function clientSmoke() {
  const vm = require('vm'), { ACT, view } = require('./rules.js');
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'), code = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const cache = {}, made = [];
  class El { constructor() { this.innerHTML = ''; this.style = {}; this.hidden = false; this.className = ''; this.value = ''; this.classList = { add() {}, remove() {} }; }
    get firstElementChild() { return new El(); } getBoundingClientRect() { return { left: 10, top: 10, width: 40, height: 58 }; } closest() { return this; } animate() { return {}; } remove() {} appendChild(e) { made.push(e); } select() {} }
  const document = { hidden: false, title: '', querySelector: s => cache[s] || (cache[s] = new El()), createElement: () => new El(), addEventListener() {}, body: new El() };
  const ctx = vm.createContext({ document, window: { addEventListener() {} }, location: { hash: '', href: 'http://x/' }, navigator: { vibrate() {} }, localStorage: { getItem: () => null, setItem() {} },
    fetch: async () => ({ ok: true, json: async () => ({}) }), EventSource: function () { this.close = () => {}; }, setTimeout: () => 0, clearTimeout() {}, console, Date, Math, JSON, Object, Array, Number, String, Promise, URL, matchMedia: () => ({ matches: false }) });
  vm.runInContext(code, ctx);
  const mkS = () => { const S = { code: 'T', host: 'a', phase: 'lobby', round: 0, seq: 0, rounds: [], log: [], chat: [], players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Beto' }, { id: 'c', name: 'Cris' }] };
    ACT.start(S, 'a'); S.start = 'a'; S.ti = 0; S.phase = 'play'; S.turn = 'a'; S.sub = 'draw'; S.hands = { a: [0, 1, 2, 3], b: [4, 5, 6, 7], c: [8, 9, 10, 11] }; S.deck = [12, 13, 14, 15, 16]; S.disc = [20]; S.planted = {}; return S; };
  const on = { a: true, b: true };
  const show = (S, pid, label, expect) => { ctx.__v = JSON.stringify(view(S, pid, on));
    try { vm.runInContext("S=JSON.parse(__v);me='" + pid + "';code='T';render();onState();$('#m').innerHTML", ctx); } catch (e) { ck(false, 'cliente: ' + label + ' (' + pid + ') lanza ' + e.message); return ''; }
    const h = cache['#m'].innerHTML; ck(h.length > 50, 'cliente: ' + label + ' dibuja algo'); if (expect) ck(h.includes(expect), 'cliente: ' + label + ' contiene «' + expect + '»'); return h; };
  const all = (S, label, expect) => ['a', 'b', 'c'].forEach(pid => show(S, pid, label, pid === 'a' ? expect : ''));
  let S = mkS(); S.phase = 'lobby'; all(S, 'lobby');
  S = mkS(); S.phase = 'peek'; S.peeks = {}; S.ready = {}; S.allow = { a: 2, b: 2, c: 2 }; all(S, 'peek');
  S = mkS(); all(S, 'play: robar', 'ROBAR CARTA');
  ACT.draw(S, 'a', {}, {}); all(S, 'play: carta robada', 'Descartar');
  S.held = 44; ACT.use12(S, 'a', {}, {}); all(S, '12: elegir', '12:');
  ACT.pick12(S, 'a', { rp: 'b', ri: 1 }, {}); const h12 = show(S, 'a', '12: decidir', 'No cambiar'); ck(h12.includes('data-a="skip12"'), 'cliente: el botón No cambiar existe en el paso del 12'); show(S, 'b', '12: víctima ve la mano');
  ACT.skip12(S, 'a', {}, {}); const hv = show(S, 'b', 'víctima tras mirar', 'ha mirado tu carta de la posición 2'); ck(hv.includes('mk lk'), 'cliente: carta resaltada en la víctima'); show(S, 'c', 'tercero tras mirar', 'miró una carta de Beto');
  S = mkS(); ACT.draw(S, 'a', {}, {}); S.held = 44; ACT.use12(S, 'a', {}, {}); ACT.pick12(S, 'a', { rp: 'b', ri: 1 }, {}); ACT.swap12(S, 'a', { i: 0 }, {}); show(S, 'b', 'víctima tras cambio', 'te ha cambiado tu carta de la posición 2');
  S = mkS(); ACT.plant(S, 'a', {}, {}); all(S, 'plantado: cinta', 'Última vuelta');
  S = mkS(); ACT.plant(S, 'b', {}, {}); ACT.plant(S, 'c', {}, {}); ACT.plant(S, 'a', {}, {}); all(S, 'ronda terminada (reveal)', 'Ronda');
  S = mkS(); S.phase = 'over'; S.rounds = [{ r: 1, n: {}, sc: { a: 1, b: 2, c: 3 }, w: 'a' }]; all(S, 'final', 'Resultados');
  // eventos visuales: cada tipo debe poder animarse sin errores y sin valores
  for (const f of [{ k: 'draw', by: 'b' }, { k: 'draw', by: 'a' }, { k: 'replace', by: 'b', i: 1 }, { k: 'replace', by: 'a', i: 0 }, { k: 'discard', by: 'a' }, { k: 'ab', by: 'b', n: 11 }, { k: 'look', by: 'b', i: 0 }, { k: 'swap', by: 'b', i: 0, rp: 'a', ri: 1 },
    { k: 'quick', by: 'c', i: 0 }, { k: 'pen', by: 'c' }, { k: 'plant', by: 'b', first: true, left: ['a', 'c'], end: false }, { k: 'plant', by: 'c', first: false, left: ['a'], end: false }, { k: 'plant', by: 'a', first: false, left: [], end: true }, { k: 'unplant', by: 'b' }]) {
    S = mkS(); S.fx = [{ id: 1, k: 'look', by: 'c', i: 0 }]; ctx.__v = JSON.stringify(view(S, 'a', on)); vm.runInContext("S=JSON.parse(__v);me='a';code='T';FXL=null;render();onState()", ctx);
    S.fx.push(Object.assign({ id: 2 }, f)); ctx.__v = JSON.stringify(view(S, 'a', on)); try { vm.runInContext("S=JSON.parse(__v);render();onState()", ctx); } catch (e) { ck(false, 'cliente: animación ' + f.k + ' lanza ' + e.message); } }
  ck(made.length > 0, 'cliente: se crean cartas voladoras');
  S = mkS(); S.phase = 'peek'; S.round = 1; ctx.__v = JSON.stringify(view(S, 'a', on)); vm.runInContext("S=JSON.parse(__v);me='a';LASTK='T:0';render();onState()", ctx);
  // privacidad de los eventos visuales
  const full = mkS(); ACT.draw(full, 'a', {}, {}); ACT.replace(full, 'a', { i: 0 }, {}); const raw = JSON.stringify(view(full, 'b', on).fx);
  ck(JSON.parse(raw).every(e => Object.keys(e).every(k => ['id', 'k', 'by', 'i', 'rp', 'ri', 'n', 'first', 'left', 'end'].includes(k))), 'los eventos visuales solo llevan quién y qué hueco, nunca valores');
}
(async () => {
  unit();
  clientSmoke();
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
