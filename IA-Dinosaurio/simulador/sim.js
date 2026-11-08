// Simulador del T-Rex Runner (física aproximada de Chromium) para probar el bot sin navegador.
// Uso: node sim.js <bot.js> <partidas> <semilla> [maxSegundos]
const botPath = process.argv[2], GAMES = +process.argv[3] || 10, SEED = +process.argv[4] || 1, MAXS = +process.argv[5] || 120;
const W = 600, H = 150, FRAME = 1000 / 60;

// ---- RNG reproducible ----
let seed = SEED;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const JITTER = !process.env.SIN_RUIDO;
let seed2 = SEED * 7919 + 1;
const rnd2 = () => { seed2 = (seed2 * 1103515245 + 12345) >>> 0; return seed2 / 4294967296; };
const rint = (a, b) => Math.floor(rnd() * (b - a + 1)) + a;

// ---- reloj y temporizadores falsos ----
let clock = 0, timers = [], rafQ = [];
global.performance = { now: () => clock };
global.setTimeout = (f, ms) => { timers.push({ t: clock + (ms || 0), f }); return timers.length; };
global.clearTimeout = () => {};

// ---- juego ----
const G = { groundY: 93, dinoW: 44, dinoH: 47, duckW: 59, duckH: 25 };
let g;
function newGame() {
  g = { playing: true, crashed: false, speed: 6, t: 0, dist: 0, obs: [],
        rex: { y: G.groundY, vy: 0, jumping: false, ducking: false, speedDrop: false, reachedMin: false },
        upHeld: false, downHeld: false, frame: 0 };
}
const TYPES = [
  { name: 'small', w: 17, h: 35, y: 105, minGap: 120, multi: 3, minSpeed: 0 },
  { name: 'large', w: 25, h: 50, y: 90, minGap: 120, multi: 3, minSpeed: 0 },
  { name: 'ptero', w: 46, h: 40, ys: [100, 75, 50], minGap: 150, multi: 1, minSpeed: 8.5, off: 0.8 },
];
function spawn(lastObs) {
  const types = TYPES.filter(t => g.speed > t.minSpeed);
  const t = types[rint(0, types.length - 1)];
  const size = t.multi > 1 && g.speed > 7 ? rint(1, t.multi) : 1;  // grupos más grandes con velocidad
  const w = t.w * size;
  const y = t.ys ? t.ys[rint(0, 2)] : t.y;
  const gap = Math.round(w * g.speed + t.minGap * 0.6);
  const maxGap = Math.round(gap * 1.5);
  return { type: t.name, x: W, y, w, h: t.h, gap: rint(gap, maxGap), off: t.off || 0 };
}
function startJump() {
  const r = g.rex; if (r.jumping || r.ducking) return;
  r.jumping = true; r.vy = -10 - g.speed / 10; r.reachedMin = false; r.speedDrop = false;
}
function endJump() { const r = g.rex; if (r.reachedMin && r.vy < -5) r.vy = -5; }
function keydown(k) {
  if (!g.playing) { if (k === 32 || k === 38) { newGame(); } return; }
  const r = g.rex;
  if (k === 32 || k === 38) { g.upHeld = true; startJump(); }
  if (k === 40) { g.downHeld = true; if (r.jumping) { r.speedDrop = true; r.vy = 1; } else if (!r.ducking) r.ducking = true; }
}
function keyup(k) {
  const r = g.rex;
  if (k === 32 || k === 38) { g.upHeld = false; if (r.jumping) endJump(); }
  if (k === 40) { g.downHeld = false; r.speedDrop = false; r.ducking = false; }
}
function step(dt) {
  if (!g.playing) return;
  const f = dt / FRAME, r = g.rex;
  g.t += dt; g.frame++;
  if (r.jumping) {
    r.y += Math.round(r.vy * (r.speedDrop ? 3 : 1) * f);
    r.vy += 0.6 * f;
    if (r.y < G.groundY - 30 || r.speedDrop) r.reachedMin = true;
    if (r.y < 30 || r.speedDrop) endJump();
    if (r.y > G.groundY) { r.y = G.groundY; r.jumping = false; r.vy = 0; r.speedDrop = false;
      if (g.downHeld) r.ducking = true; }
  }
  for (const o of g.obs) o.x -= (g.speed + (o.type === 'ptero' ? o.off : 0)) * f;
  g.obs = g.obs.filter(o => o.x + o.w > 0);
  const last = g.obs[g.obs.length - 1];
  if (g.t > 1500 && (!last || last.x + last.w + last.gap < W)) g.obs.push(spawn(last));
  g.speed = Math.min(13, g.speed + 0.001 * f);
  // colisión (cajas reducidas, como los hitbox de Chromium)
  const dx0 = 50 + 6, dx1 = 50 + (r.ducking ? G.duckW : G.dinoW) - 6;
  const dy0 = (r.ducking ? 115 : r.y) + 4, dy1 = (r.ducking ? 140 : r.y + G.dinoH) - 4;
  for (const o of g.obs) {
    const ox0 = o.x + 3, ox1 = o.x + o.w - 3;
    const oy0 = o.y + (o.type === 'ptero' ? 10 : 3), oy1 = o.y + o.h - (o.type === 'ptero' ? 8 : 0);
    if (ox0 < dx1 && ox1 > dx0 && oy0 < dy1 && oy1 > dy0) { g.playing = false; g.crashed = true; g.crashType = o.type + '@' + o.y + ' w' + o.w; }
  }
}

// ---- dibujo en un buffer RGBA (lo que el bot "ve") ----
const buf = new Uint8ClampedArray(W * H * 4);
function rect(x, y, w, h) {
  for (let yy = Math.max(0, Math.round(y)); yy < Math.min(H, Math.round(y + h)); yy++)
    for (let xx = Math.max(0, Math.round(x)); xx < Math.min(W, Math.round(x + w)); xx++) {
      const i = (yy * W + xx) * 4; buf[i] = buf[i + 1] = buf[i + 2] = 83; buf[i + 3] = 255;
    }
}
function draw() {
  buf.fill(0);
  rect(0, 127, W, 1);                                    // línea del suelo
  for (let x = (-g.dist) % 37; x < W; x += 37) rect(x + 37, 131 + (Math.abs(Math.round(x)) % 5), 2, 1); // piedritas que se mueven
  const r = g.rex;
  if (r.ducking) rect(50, 115, G.duckW, G.duckH); else rect(50, r.y, G.dinoW, G.dinoH);
  for (const o of g.obs) {
    if (o.type === 'ptero') {
      const wingDown = Math.floor(g.t / 160) % 2;
      rect(o.x, o.y + 12, o.w, 14);                      // cuerpo
      if (wingDown) rect(o.x + 14, o.y + 26, 16, 14); else rect(o.x + 14, o.y, 16, 12);
    } else {
      const pieces = Math.round(o.w / (o.type === 'small' ? 17 : 25)), pw = o.w / pieces;
      for (let p = 0; p < pieces; p++) rect(o.x + p * pw + 2, o.y, pw - 4, o.h);
    }
  }
}

// ---- DOM falso para el bot ----
const ctx = {
  getImageData: (x, y, w, h) => {
    const d = new Uint8ClampedArray(Math.max(1, w * h) * 4);
    for (let yy = 0; yy < h; yy++) { const sy = y + yy; if (sy < 0 || sy >= H) continue;
      d.set(buf.subarray((sy * W + x) * 4, (sy * W + x + w) * 4), yy * w * 4); }
    return { data: d };
  }, clearRect() {}, drawImage() {},
};
const mkCanvas = () => ({ width: W, height: H, classList: { contains: () => true }, getContext: () => ctx, focus() {}, style: {}, remove() {} });
const win = {
  KeyboardEvent: class { constructor(type, o) { Object.assign(this, o); this.type = type; } },
  requestAnimationFrame: f => rafQ.push(f),
};
global.document = {
  querySelectorAll: s => s === 'canvas' ? [mkCanvas()] : [], createElement: () => mkCanvas(),
  body: { appendChild() {} }, defaultView: win,
  dispatchEvent(e) { (e.type === 'keydown' ? keydown : keyup)(e.keyCode); },
};
win.document = global.document;
global.window = {};
const realLog = console.log; console.log = process.env.LOG ? (...a) => realLog(...a) : () => {};
newGame(); g.playing = false;   // el bot lo inicia
require(require('path').resolve(botPath));

// ---- bucle principal ----
const results = [];
let gameT0 = null, idle = 0;
while (results.length < GAMES && clock < GAMES * (MAXS + 5) * 1000) {
  const dt = JITTER ? (rnd2() < 0.05 ? 2 * FRAME : FRAME * (0.85 + rnd2() * 0.3)) : FRAME;
  clock += dt;
  for (const t of timers.filter(t => t.t <= clock)) t.f();
  timers = timers.filter(t => t.t > clock);
  if (!g.playing) { idle = (idle || 0) + FRAME; if (idle > 1500) { newGame(); idle = 0; } } else idle = 0;  // como si la persona apretara Espacio
  const wasPlaying = g.playing;
  const stale = JITTER && rnd2() < 0.3;
  if (stale) { const q = rafQ; rafQ = []; for (const f of q) f(); }
  step(dt); if (g.playing) g.dist += g.speed * dt / FRAME;
  if (g.playing && gameT0 === null) gameT0 = clock;
  if (wasPlaying && !g.playing) { results.push({ s: (clock - gameT0) / 1000, why: g.crashType, speed: g.speed.toFixed(1) }); gameT0 = null; }
  if (g.playing && gameT0 !== null && clock - gameT0 > MAXS * 1000) { results.push({ s: MAXS, why: 'tiempo máximo', speed: g.speed.toFixed(1) }); g.playing = false; gameT0 = null; }
  draw();
  if (!stale) { const q = rafQ; rafQ = []; for (const f of q) f(); }
}
console.log = realLog;
const avg = results.reduce((a, r) => a + r.s, 0) / results.length;
const why = {}; for (const r of results) { const k = r.why.split(' ')[0]; why[k] = (why[k] || 0) + 1; }
console.log(`${require('path').basename(botPath)}  semilla ${SEED}: ${results.length} partidas, promedio ${avg.toFixed(1)} s, mejor ${Math.max(...results.map(r => r.s)).toFixed(1)} s, choques por tipo: ${JSON.stringify(why)}`);
if (process.env.DETALLE) for (const r of results) console.log('  ', r.s.toFixed(1) + 's', r.why, 'vel', r.speed);
