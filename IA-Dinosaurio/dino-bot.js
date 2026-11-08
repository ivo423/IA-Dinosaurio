// =====================================================
//  Bot para el dinosaurio v14 (lee la pantalla + presiona teclas)
//  1) Abre https://chromedino.com/embed/
//  2) Ctrl+Shift+J, pega todo esto, Enter
//  3) Haz clic en el juego y presiona Espacio
//  Comandos:  dinoBot.stop()   dinoBot.stats()   dinoBot.caja()  (último choque)
// =====================================================
(() => {
  if (window.dinoBot && window.dinoBot.stop) window.dinoBot.stop();
  const VERSION = 'v14';

  // ---------- 1. Encontrar el canvas del juego ----------
  function findGame() {
    const docs = [document];
    for (const f of document.querySelectorAll('iframe')) {
      try { if (f.contentDocument) docs.push(f.contentDocument); } catch (e) {}
    }
    for (const d of docs) {
      const cvs = [...d.querySelectorAll('canvas')].filter(c => c.width > 200)
        .sort((a, b) => (b.classList.contains('runner-canvas') - a.classList.contains('runner-canvas')) || (b.width - a.width));
      if (cvs.length) return { doc: d, win: d.defaultView, canvas: cvs[0] };
    }
    return null;
  }
  const game = findGame();
  if (!game) { console.error('[dinoBot] No encontré el juego. Abre https://chromedino.com/embed/ y pega el script ahí.'); return; }
  const { doc, win, canvas } = game;
  const S = canvas.width / 600;
  const off = doc.createElement('canvas');
  off.width = canvas.width; off.height = canvas.height;
  const octx = off.getContext('2d', { willReadFrequently: true });

  // ---------- 2. Ajustes (px y ms "lógicos": el juego mide 600x150) ----------
  const cfg = {
    // geometría
    backX: 50, frontX: 96,               // cola y frente del dino (igual que v11)
    scanFromX: 114,                       // mirar desde aquí (el dino agachado llega a ~110)
    scanLen: 486,
    lowBand: [116, 125],                  // cactus y pájaros bajos (sobre la línea del suelo y=127)
    midBand: [96, 110],                   // pájaros a media altura
    dinoZoneX: [60, 90], dinoZoneY: [116, 122],   // para saber si el dino toca el suelo
    maxObstacleW: 120,
    // salto
    jumpTime: 170,     // ms antes del choque en que salta (igual que v11)
    jumpHold: 100, longWidth: 40, longHold: 320, longEarly: 30,
    comboHold: 450, comboEarly: 50,
    // caída rápida
    clearPx: 12,       // px que el obstáculo debe alejarse de la cola antes de caer rápido (igual que v11)
    dropSafety: 40,    // ms extra antes de caer rápido (igual que v11)
    dropLand: 110,     // ms que tarda en aterrizar al caer rápido
    maxDrop: 450,
    retryAfter: 50,    // ms: si el dino no despegó, reintentar el salto
    duckZoneX: [98, 106], duckZoneY: [117, 125],   // solo el dino AGACHADO llega hasta aquí
    // dos obstáculos seguidos
    landMargin: 30,
    comboMaxAir: 420,  // ms máximos sobre los cactus en un solo salto
    // pájaros
    duckTime: 320, duckMargin: 70,
    // otros
    maxVel: 0.8,       // el juego no pasa de velocidad 13 (= 0,78 px/ms): nunca estimar más que esto
    velWindow: 120,    // ms de ventana para medir la velocidad (más largo = menos ruido)
    autoRestart: true, debug: true,
  };

  // ---------- 3. Teclas ----------
  const KEYS = {
    jump: { key: ' ', code: 'Space', keyCode: 32 },
    up:   { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  };
  function sendKey(type, k) {
    const ev = new win.KeyboardEvent(type, { key: k.key, code: k.code, keyCode: k.keyCode, which: k.keyCode, bubbles: true, cancelable: true });
    try { Object.defineProperty(ev, 'keyCode', { get: () => k.keyCode }); Object.defineProperty(ev, 'which', { get: () => k.keyCode }); } catch (e) {}
    doc.dispatchEvent(ev);
  }
  function press(k, ms) { sendKey('keydown', k); setTimeout(() => sendKey('keyup', k), ms); }
  let downHeld = false;
  function holdDown()    { if (!downHeld) { sendKey('keydown', KEYS.down); downHeld = true; } }
  function releaseDown() { if (downHeld) { sendKey('keyup', KEYS.down); downHeld = false; } }

  // ---------- 4. Visión ----------
  function snapshot() { octx.clearRect(0, 0, off.width, off.height); octx.drawImage(canvas, 0, 0); }
  const isDark = (d, i) => d[i + 3] > 40 && d[i] + d[i + 1] + d[i + 2] < 600;

  function scanGroups(band, max) {
    const x0 = Math.round(cfg.scanFromX * S);
    const w = Math.min(Math.round(cfg.scanLen * S), canvas.width - x0);
    const y0 = Math.round(band[0] * S), h = Math.max(1, Math.round((band[1] - band[0]) * S));
    const d = octx.getImageData(x0, y0, w, h).data;
    const gap = Math.round(14 * S), groups = [];
    let start = -1, end = -1, empty = 0;
    const push = () => {
      if ((end - start) / S <= cfg.maxObstacleW)
        groups.push({ start: start / S + cfg.scanFromX, end: end / S + cfg.scanFromX, cut: end >= w - 2 });
    };
    for (let x = 0; x < w; x++) {
      let hit = false;
      for (let y = 0; y < h && !hit; y++) if (isDark(d, (y * w + x) * 4)) hit = true;
      if (hit) { if (start < 0) start = x; end = x; empty = 0; }
      else if (start >= 0 && ++empty > gap) { push(); if (groups.length >= max) return groups; start = -1; empty = 0; }
    }
    if (start >= 0) push();
    return groups;
  }
  function dinoOnGround() {
    const x0 = Math.round(cfg.dinoZoneX[0] * S), w = Math.round((cfg.dinoZoneX[1] - cfg.dinoZoneX[0]) * S);
    const y0 = Math.round(cfg.dinoZoneY[0] * S), h = Math.round((cfg.dinoZoneY[1] - cfg.dinoZoneY[0]) * S);
    const d = octx.getImageData(x0, y0, w, h).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (isDark(d, i)) n++;
    return n >= 4;
  }

  // "huella" del suelo y lo que hay sobre él: cambia en cada cuadro mientras el juego corre
  function groundSignature() {
    const y0 = Math.round(118 * S), h = Math.max(1, Math.round(20 * S)), w = canvas.width;
    const d = octx.getImageData(0, y0, w, Math.min(h, canvas.height - y0)).data;
    let sig = 0;
    for (let i = 0; i < d.length; i += 4) if (isDark(d, i)) sig = (sig * 31 + i) | 0;
    return sig;
  }

  function landedDucking() {
    const x0 = Math.round(cfg.duckZoneX[0] * S), w = Math.round((cfg.duckZoneX[1] - cfg.duckZoneX[0]) * S);
    const y0 = Math.round(cfg.duckZoneY[0] * S), h = Math.round((cfg.duckZoneY[1] - cfg.duckZoneY[0]) * S);
    const d = octx.getImageData(x0, y0, w, h).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (isDark(d, i)) n++;
    return n >= 6;
  }

  // ---------- 5. Velocidad con ventana larga (menos ruido) ----------
  let vel = 0.36, track = null;      // track = {x0, t0, x, t}
  function trackVelocity(x, now) {
    if (x == null) { track = null; return; }
    if (!track || x > track.x + 2 || track.x - x > 60) { track = { x0: x, t0: now, x, t: now }; return; }
    if (x === track.x) return;                      // mismo cuadro del juego
    track.x = x; track.t = now;
    const dt = track.t - track.t0;
    if (dt >= cfg.velWindow) {
      const v = (track.x0 - track.x) / dt;
      if (v > 0.25 && v < 1.0) vel = Math.min(cfg.maxVel, vel * 0.6 + v * 0.4);
      track.x0 = track.x; track.t0 = track.t;
    }
  }

  // ---------- 6. Plan de salto ----------
  // (mismos tiempos que la v11)
  const isLongO   = o => (o.end - o.start) > cfg.longWidth;
  const takeoffIn = (o, combo) => (o.start - cfg.frontX) / vel - (cfg.jumpTime + (combo ? cfg.comboEarly : isLongO(o) ? cfg.longEarly : 0));
  const clearIn   = o => (o.end - cfg.backX + cfg.clearPx) / vel + cfg.dropSafety;
  const holdFor   = (o, combo) => combo ? cfg.comboHold : isLongO(o) ? cfg.longHold : cfg.jumpHold;

  // ---------- 7. Caja negra ----------
  const BOX_LEN = 120;
  let box = [], lastCrashBox = null, crashes = [];
  function rec(entry) { box.push(entry); if (box.length > BOX_LEN) box.shift(); }
  function formatBox(b) {
    if (!b || !b.length) return '(vacía)';
    const tEnd = b[b.length - 1].t;
    let lastLine = '';
    const lines = [];
    for (const e of b) {
      const line = `${e.st.padEnd(8)} vel ${(e.vel * 16.7).toFixed(1).padStart(4)}  ` +
        `cactus ${e.low == null ? '  —  ' : String(Math.round(e.low - cfg.frontX)).padStart(4) + 'px'}` +
        `${e.w ? ' ancho ' + e.w : ''}${e.nx != null ? ' | sig ' + Math.round(e.nx - cfg.frontX) + 'px' : ''}` +
        `${e.bird ? ' | PÁJARO ' + Math.round(e.mid - cfg.frontX) + 'px' : ''}  ${e.plan}`;
      if (e.act || line !== lastLine) lines.push(`${String(Math.round(e.t - tEnd)).padStart(6)}ms  ${line}${e.act ? '   >>> ' + e.act : ''}`);
      lastLine = line;
    }
    return lines.slice(-40).join('\n');
  }

  // ---------- 8. Lógica ----------
  let lastHold = 100;
  let state = 'suelo', jumpStart = 0, clearAt = 0, dropStart = 0, retried = false, jumpTarget = null;
  let ducking = false, duckUntil = 0;
  let prevNear = null, stillFrames = 0, gameStart = performance.now();
  let n = { jumps: 0, drops: 0, ducks: 0, combos: 0, retries: 0 };
  let plan = '—', debugEl = null, running = false, frameAct = '';
  let airSamples = [];

  function crash(now) {
    const dur = (now - gameStart) / 1000;
    if (dur < 1.5) {                       // juego detenido sin haber corrido: solo (re)iniciar
      releaseDown(); state = 'suelo'; ducking = false;
      if (cfg.autoRestart) press(KEYS.jump, 60);
      gameStart = now; return;
    }
    crashes.push(dur);
    lastCrashBox = box.slice();
    const last10 = crashes.slice(-10), avg = last10.reduce((a, b) => a + b, 0) / last10.length;
    console.log(`%c[dinoBot ${VERSION}] Choque #${crashes.length}: duró ${dur.toFixed(1)} s · promedio últimas ${last10.length}: ${avg.toFixed(1)} s · mejor: ${Math.max(...crashes).toFixed(1)} s`,
                'color:#e11;font-weight:bold');
    console.log('[dinoBot] CAJA NEGRA (último ~1,5 s antes del choque; copia esto si quieres que lo revise):\n' + formatBox(lastCrashBox));
    releaseDown(); ducking = false; state = 'suelo'; track = null; box = [];
    gameStart = now + 800;               // evita contar el mismo choque dos veces
    if (cfg.autoRestart) setTimeout(() => press(KEYS.jump, 60), 800);
  }

  function tick() {
    if (!running) return;
    win.requestAnimationFrame(tick);
    const now = performance.now();
    snapshot();
    frameAct = '';

    const lg = scanGroups(cfg.lowBand, 2);
    const lowO = lg[0] || null, nextO = lg[1] || null;
    const midO = scanGroups(cfg.midBand, 1)[0] || null;
    const low = lowO && lowO.start, mid = midO && midO.start;
    const near = low != null ? low : mid;

    // choque = el suelo (que siempre se desplaza) dejó de moverse
    const sig = groundSignature();
    if (sig === prevNear) stillFrames++; else stillFrames = 0;
    prevNear = sig;
    if (stillFrames > 30) { stillFrames = 0; crash(now); return; }

    trackVelocity(near, now);
    const grounded = dinoOnGround();
    const tLow = low != null ? (low - cfg.frontX) / vel : Infinity;
    const tMid = mid != null ? (mid - cfg.frontX) / vel : Infinity;

    // pájaro a media altura: está en la franja media pero no empieza junto con algo en la franja baja
    const birdMid = !!midO && (!lowO || midO.start < lowO.start - 8);
    if (birdMid && (ducking || tMid < cfg.duckTime))
      duckUntil = Math.max(duckUntil, now + (midO.end - cfg.backX) / vel + cfg.duckMargin);

    // --- estado del salto ---
    if (state === 'saltando') {
      // dónde está ahora lo que estamos saltando (ya no se ve: está bajo el dino)
      const projStart = jumpTarget.start - vel * (now - jumpStart);
      if (now >= clearAt) { holdDown(); state = 'cayendo'; dropStart = now; n.drops++; frameAct = 'CAER RÁPIDO'; }
      else if (grounded && !retried && projStart > cfg.frontX - 2 && now - jumpStart > cfg.retryAfter) {
        // el obstáculo aún no llega y el dino sigue en el suelo: el juego ignoró la tecla
        press(KEYS.up, lastHold); retried = true; n.retries++; frameAct = 'REINTENTO SALTO';
      }
      // OJO: no se usa "grounded" para declarar aterrizaje aquí: con un cactus bajo el dino daría falso
    } else if (state === 'cayendo') {
      // con la flecha abajo apretada, el dino se AGACHA justo al tocar el suelo: esa es la señal exacta
      if (landedDucking() || now - dropStart > cfg.maxDrop) { releaseDown(); state = 'suelo'; frameAct = frameAct || 'TOCÓ SUELO'; }
    }

    // --- plan con el obstáculo de al frente y el siguiente ---
    let target = lowO, combo = false;
    if (lowO && nextO) {
      // ¿alcanza a pasar o1, caer, aterrizar y despegar a tiempo para o2?
      const slack = takeoffIn(nextO, false) - (clearIn(lowO) + cfg.dropLand);
      const span = nextO.end - lowO.start;
      const fits = (span + (cfg.frontX - cfg.backX)) / vel <= cfg.comboMaxAir;
      if (slack < cfg.landMargin && fits) { target = { start: lowO.start, end: nextO.end }; combo = true; }
      plan = combo ? 'COMBO' : slack >= cfg.landMargin ? 'separado' : 'separado-justo';
    } else plan = lowO ? 'simple' : '—';

    // --- decidir ---
    if (state === 'suelo' && target && takeoffIn(target, combo) <= 0 && !(birdMid && tMid <= tLow) && now > duckUntil) {
      if (ducking) { releaseDown(); ducking = false; }
      lastHold = holdFor(target, combo);
      press(KEYS.up, lastHold);
      state = 'saltando'; jumpStart = now; jumpTarget = target; retried = false; n.jumps++; if (combo) n.combos++;
      clearAt = now + clearIn(target);
      frameAct = `SALTO${combo ? ' COMBO' : ''} (cactus a ${Math.round(target.start - cfg.frontX)}px, ancho ${Math.round(target.end - target.start)})`;
    } else if (state === 'suelo' && birdMid && tMid < cfg.duckTime) {
      if (!ducking) { holdDown(); ducking = true; n.ducks++; frameAct = 'AGACHARSE'; }
    } else if (ducking && now > duckUntil) {
      releaseDown(); ducking = false; frameAct = 'PARARSE';
    }

    rec({ t: now, st: ducking ? 'agachado' : state, vel, low, w: lowO ? Math.round(lowO.end - lowO.start) : 0,
          nx: nextO && nextO.start, bird: birdMid, mid, plan, act: frameAct });
    if (cfg.debug) drawDebug(low, mid, birdMid);
  }

  function drawDebug(low, mid, birdMid) {
    if (!debugEl) {
      debugEl = doc.createElement('div');
      debugEl.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;background:#111d;color:#6ee7b7;font:12px monospace;padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre';
      doc.body.appendChild(debugEl);
    }
    const f = v => v == null ? '—' : Math.round(v - cfg.frontX) + 'px';
    const avg = crashes.length ? (crashes.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, crashes.length)).toFixed(1) + 's' : '—';
    debugEl.textContent =
      `dinoBot ${VERSION}  vel ${(vel * 16.7).toFixed(1)}  estado: ${ducking ? 'agachado' : state}\n` +
      `cactus: ${f(low)}  pájaro medio: ${birdMid ? f(mid) : '—'}  plan: ${plan}\n` +
      `saltos ${n.jumps} combos ${n.combos} caídas ${n.drops} agachadas ${n.ducks} reintentos ${n.retries}\n` +
      `partidas ${crashes.length}  promedio(10) ${avg}`;
  }

  function start() { stop(); running = true; gameStart = performance.now(); win.requestAnimationFrame(tick);
    console.log(`[dinoBot] ${VERSION} encendido (canvas ${canvas.width}x${canvas.height}). Presiona Espacio en el juego.`); }
  function stop() { running = false; releaseDown(); ducking = false; if (debugEl) { debugEl.remove(); debugEl = null; } }
  function stats() {
    const avg = crashes.length ? crashes.reduce((a, b) => a + b, 0) / crashes.length : 0;
    return { version: VERSION, partidas: crashes.length, promedio_s: +avg.toFixed(1), mejor_s: crashes.length ? +Math.max(...crashes).toFixed(1) : 0,
             ultimas: crashes.slice(-10).map(x => +x.toFixed(1)), velocidad: +(vel * 16.7).toFixed(1), ...n,
             saltos_medidos_ms: airSamples.map(Math.round) };
  }
  function caja() { console.log(formatBox(lastCrashBox)); }

  win.dinoBot = window.dinoBot = { start, stop, stats, caja, cfg, version: VERSION };
  start();
})();
