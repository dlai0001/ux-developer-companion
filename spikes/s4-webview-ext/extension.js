// S4b — input fidelity probe. Real VS Code webview + CDP screencast + input forwarding.
//
// Key idea: turn "does typing feel laggy?" into a NUMBER. The page flips a high-contrast
// patch in its top-left corner on every input event; the webview samples that pixel after
// each canvas draw. keystroke-to-pixel = (time patch flip becomes visible) - (time key pressed).
// That is the whole round trip: webview -> host -> CDP -> page -> screencast -> draw.
const vscode = require('vscode');
const CDP = require('chrome-remote-interface');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const OUT = join(__dirname, '..', '_out');
const PORT = 5397;
const VIEW_W = 1024, VIEW_H = 768; // fixed metrics override => unambiguous coordinate mapping

let panel, client, browserProc, httpSrv;
const stats = { samples: [], frames: [], startedAt: new Date().toISOString(), settings: {} };

function launchChrome() {
  const dir = join(tmpdir(), `s4-probe-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const bin = ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
               '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  proc.stderr.on('data', (b) => { err += b.toString(); });
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = setInterval(() => {
      const pf = join(dir, 'DevToolsActivePort');
      if (existsSync(pf)) {
        const [p, ws] = readFileSync(pf, 'utf8').split('\n');
        if (p && ws) { clearInterval(tick); res({ proc, port: +p }); }
      }
      if (Date.now() - t0 > 20000) { clearInterval(tick); rej(new Error('port timeout: ' + err.slice(-500))); }
    }, 100);
  });
}

// Injected before page scripts: the latency marker + an input-event hook.
const MARKER = `
(function(){
  function install(){
    var p = document.createElement('div');
    p.id = '__uxmarker';
    p.style.cssText = 'position:fixed;left:0;top:0;width:48px;height:48px;z-index:2147483647;background:#000';
    document.documentElement.appendChild(p);
    var on = false;
    function flip(){ on = !on; p.style.background = on ? '#fff' : '#000'; }
    // Any real input the browser processes flips the patch.
    for (var ev of ['keydown','mousedown','wheel']) {
      window.addEventListener(ev, flip, true);
    }
  }
  if (document.documentElement) install();
  else document.addEventListener('DOMContentLoaded', install);
})();`;

// Minimal keycode table — PLAN §4.2 calls for one; this is the shape it needs.
const KEYMAP = {
  Enter: { code: 'Enter', key: 'Enter', vk: 13, text: '\r' },
  Backspace: { code: 'Backspace', key: 'Backspace', vk: 8 },
  Tab: { code: 'Tab', key: 'Tab', vk: 9 },
  ArrowLeft: { code: 'ArrowLeft', key: 'ArrowLeft', vk: 37 },
  ArrowUp: { code: 'ArrowUp', key: 'ArrowUp', vk: 38 },
  ArrowRight: { code: 'ArrowRight', key: 'ArrowRight', vk: 39 },
  ArrowDown: { code: 'ArrowDown', key: 'ArrowDown', vk: 40 },
  Escape: { code: 'Escape', key: 'Escape', vk: 27 },
};

async function dispatchKey(msg) {
  const { Input } = client;
  const known = KEYMAP[msg.key];
  const printable = !known && msg.key.length === 1;
  const mods = (msg.alt ? 1 : 0) | (msg.ctrl ? 2 : 0) | (msg.meta ? 4 : 0) | (msg.shift ? 8 : 0);
  const base = { modifiers: mods, windowsVirtualKeyCode: known ? known.vk : msg.key.toUpperCase().charCodeAt(0),
                 nativeVirtualKeyCode: known ? known.vk : msg.key.toUpperCase().charCodeAt(0),
                 key: known ? known.key : msg.key, code: known ? known.code : msg.code };
  await Input.dispatchKeyEvent({ ...base, type: printable ? 'keyDown' : 'rawKeyDown',
                                 text: printable ? msg.key : (known?.text || '') });
  if (printable) await Input.dispatchKeyEvent({ ...base, type: 'char', text: msg.key });
  await Input.dispatchKeyEvent({ ...base, type: 'keyUp', text: '' });
}

async function dispatchMouse(msg) {
  const { Input } = client;
  const mods = (msg.alt ? 1 : 0) | (msg.ctrl ? 2 : 0) | (msg.meta ? 4 : 0) | (msg.shift ? 8 : 0);
  if (msg.kind === 'wheel') {
    await Input.dispatchMouseEvent({ type: 'mouseWheel', x: msg.x, y: msg.y,
      deltaX: msg.deltaX, deltaY: msg.deltaY, modifiers: mods });
    return;
  }
  const type = msg.kind === 'down' ? 'mousePressed' : msg.kind === 'up' ? 'mouseReleased' : 'mouseMoved';
  await Input.dispatchMouseEvent({ type, x: msg.x, y: msg.y, button: msg.button ?? 'left',
    clickCount: msg.kind === 'move' ? 0 : 1, modifiers: mods });
}

// Force repaints so at least one frame is produced after a (re)start.
function nudge(Runtime, times = 6) {
  let i = 0;
  const t = setInterval(() => {
    Runtime.evaluate({ expression:
      `document.documentElement.style.setProperty('--_n','${Math.random()}');
       window.scrollBy(0,1); window.scrollBy(0,-1);` }).catch(() => {});
    if (++i >= times) clearInterval(t);
  }, 150);
}

async function start() {
  mkdirSync(OUT, { recursive: true });
  httpSrv = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(readFileSync(join(__dirname, '..', 'fixtures', 'screencast.html')));
  });
  await new Promise((r) => httpSrv.listen(PORT, r));

  const { proc, port } = await launchChrome();
  browserProc = proc;
  client = await CDP({ port });
  const { Page, Emulation, Runtime } = client;
  await Page.enable();
  await Runtime.enable();
  await Emulation.setDeviceMetricsOverride({ width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
  await Page.addScriptToEvaluateOnNewDocument({ source: MARKER });
  await Page.navigate({ url: `http://127.0.0.1:${PORT}/` });
  await Page.loadEventFired();

  panel = vscode.window.createWebviewPanel('s4probe', 'S4 Input Probe', vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true });
  panel.webview.html = HTML(VIEW_W, VIEW_H);

  let cpuPrev = process.cpuUsage(), cpuT = Date.now();

  stats.cdpFrames = 0; stats.postedFrames = 0;
  Page.screencastFrame(async ({ data, metadata, sessionId }) => {
    stats.cdpFrames++;
    const sentAt = Date.now();
    try { await Page.screencastFrameAck({ sessionId }); } catch {}
    if (panel) { panel.webview.postMessage({ t: 'frame', data, sentAt,
      capturedAt: metadata.timestamp ? metadata.timestamp * 1000 : null }); stats.postedFrames++; }
  });

  panel.webview.onDidReceiveMessage(async (m) => {
    try {
      if (m.t === 'key') await dispatchKey(m);
      else if (m.t === 'mouse') await dispatchMouse(m);
      else if (m.t === 'stat') {
        stats.samples.push(m.sample);
        if (stats.samples.length % 25 === 0) dump();
      } else if (m.t === 'frameStat') {
        stats.frames.push(m.sample);
        if (stats.frames.length > 4000) stats.frames.splice(0, 2000);
      } else if (m.t === 'settings') {
        stats.settings = m.settings;
        await Page.stopScreencast().catch(() => {});
        await Page.startScreencast({ format: 'jpeg', quality: m.settings.quality,
          maxWidth: VIEW_W, maxHeight: VIEW_H, everyNthFrame: m.settings.everyNthFrame });
        nudge(Runtime);
      }
    } catch (e) { console.error('s4 msg error', e); }
  });

  // Extension-host CPU sampling (coarse, per PLAN's suggestion) + periodic dump so the
  // frame pipeline is verifiable without any user interaction.
  let tick = 0;
  setInterval(() => {
    const u = process.cpuUsage(cpuPrev); const dt = Date.now() - cpuT;
    cpuPrev = process.cpuUsage(); cpuT = Date.now();
    const pct = ((u.user + u.system) / 1000 / dt) * 100;
    panel?.webview.postMessage({ t: 'cpu', pct: +pct.toFixed(1) });
    stats.lastCpuPct = +pct.toFixed(1);
    if (++tick % 3 === 0) { try { dump(); } catch {} }
  }, 1000);

  await Page.startScreencast({ format: 'jpeg', quality: 60, maxWidth: VIEW_W, maxHeight: VIEW_H, everyNthFrame: 1 });
  stats.settings = { quality: 60, everyNthFrame: 1 };

  // Sweep everyNthFrame automatically (18 s each) and snapshot a summary per setting, so the
  // recommendation is data-driven rather than a guess. Manual feel test runs afterwards.
  stats.sweep = [];
  const SWEEP = false;   // measurement sweep already completed; manual feel test now
  const COMBOS = [{ quality: 60, everyNthFrame: 1 }, { quality: 60, everyNthFrame: 2 },
                  { quality: 60, everyNthFrame: 4 }, { quality: 80, everyNthFrame: 2 }];
  let ci = 0;
  const sweep = SWEEP && setInterval(async () => {
    const snap = dump();
    stats.sweep.push({ ...stats.settings, ...snap.keystrokeToPixel && {
      keystrokeToPixel: snap.keystrokeToPixel, frameAgeAtDrawMs: snap.frameAgeAtDrawMs,
      hostToWebviewTransportMs: snap.hostToWebviewTransportMs, webviewDrawMs: snap.webviewDrawMs,
      framesDrawn: snap.framesDrawn, cpu: snap.extHostCpuPct } });
    stats.samples.length = 0; stats.frames.length = 0;   // reset window for next combo
    ci++;
    if (ci >= COMBOS.length) { clearInterval(sweep); stats.sweepDone = true; dump(); return; }
    const s = COMBOS[ci];
    stats.settings = s;
    await Page.stopScreencast().catch(() => {});
    await Page.startScreencast({ format: 'jpeg', quality: s.quality, maxWidth: VIEW_W, maxHeight: VIEW_H, everyNthFrame: s.everyNthFrame });
    nudge(Runtime);
  }, 18000);
  // FINDING: screencast emits frames ONLY on repaint. A fully static page yields ZERO frames,
  // so the canvas stays blank until the user interacts. Force an initial paint after every
  // start/restart, or the viewport looks broken on load.
  nudge(Runtime);

  panel.onDidDispose(() => cleanup());
}

function pct(arr, p) { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return +s[Math.floor(s.length * p)].toFixed(1); }

function dump() {
  const lat = stats.samples.map((s) => s.latencyMs).filter((n) => n != null);
  const draw = stats.frames.map((f) => f.drawMs).filter((n) => n != null);
  const trans = stats.frames.map((f) => f.transportMs).filter((n) => n != null);
  const age = stats.frames.map((f) => f.ageAtDrawMs).filter((n) => n != null);
  const summary = {
    settings: stats.settings,
    keystrokeToPixel: { n: lat.length, p50: pct(lat, 0.5), p95: pct(lat, 0.95), max: lat.length ? Math.max(...lat) : null },
    webviewDrawMs: { n: draw.length, p50: pct(draw, 0.5), p95: pct(draw, 0.95) },
    hostToWebviewTransportMs: { p50: pct(trans, 0.5), p95: pct(trans, 0.95) },
    frameAgeAtDrawMs: { p50: pct(age, 0.5), p95: pct(age, 0.95) },
    extHostCpuPct: stats.lastCpuPct,
    framesDrawn: stats.frames.length,
    cdpFramesReceived: stats.cdpFrames,
    framesPostedToWebview: stats.postedFrames,
  };
  writeFileSync(join(OUT, 's4-input-results.json'), JSON.stringify({ summary, raw: stats }, null, 2));
  return summary;
}

function cleanup() {
  try { dump(); } catch {}
  try { client?.close(); } catch {}
  try { browserProc?.kill(); } catch {}
  try { httpSrv?.close(); } catch {}
  panel = undefined;
}

function HTML(w, h) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;font:12px system-ui;background:#1e1e1e;color:#ddd}
  #wrap{position:relative;width:${w}px;max-width:100%}
  canvas{width:100%;display:block;background:#000;cursor:text}
  #hud{padding:6px 8px;background:#111;font-family:ui-monospace,monospace;white-space:pre-wrap;line-height:1.5}
  .k{color:#6cf}.w{color:#fc6}
  #ctl{padding:6px 8px;background:#181818}
  select{margin-right:12px}
  </style></head><body>
  <div id="ctl">
    quality <select id="q"><option>40</option><option selected>60</option><option>80</option></select>
    everyNthFrame <select id="n"><option>1</option><option selected>2</option><option>4</option></select>
    <label><input type="checkbox" id="auto"> auto-drive</label>
    <span class="w">click the canvas, then type / scroll / drag</span>
  </div>
  <div id="wrap"><canvas id="c" width="${w}" height="${h}" tabindex="0"></canvas></div>
  <div id="hud">starting…</div>
  <script>
  const vs = acquireVsCodeApi();
  const c = document.getElementById('c'), ctx = c.getContext('2d', { willReadFrequently: true });
  const hud = document.getElementById('hud');
  const PW = ${w}, PH = ${h};

  let pending = null;            // newest undrawn frame (latest-frame-wins)
  let drawing = false;
  let lastPatch = null;          // last sampled marker luminance
  let awaiting = null;           // { t0, kind } waiting for the patch to flip
  const lat = [], draws = [];
  let cpu = 0, drawn = 0, lastSec = Date.now(), fps = 0, fpsCount = 0;

  function px(e) {
    const r = c.getBoundingClientRect();
    return { x: Math.round((e.clientX - r.left) / r.width * PW),
             y: Math.round((e.clientY - r.top) / r.height * PH) };
  }
  const mods = e => ({ alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey });

  c.addEventListener('keydown', e => {
    if (e.key === 'F12') return;
    e.preventDefault();
    awaiting = { t0: performance.now(), kind: 'key' };
    vs.postMessage({ t: 'key', key: e.key, code: e.code, ...mods(e) });
  });
  c.addEventListener('mousedown', e => { e.preventDefault(); c.focus();
    awaiting = { t0: performance.now(), kind: 'click' };
    vs.postMessage({ t: 'mouse', kind: 'down', ...px(e), ...mods(e) }); });
  c.addEventListener('mouseup', e => vs.postMessage({ t: 'mouse', kind: 'up', ...px(e), ...mods(e) }));
  let lastMove = 0;
  c.addEventListener('mousemove', e => {
    const now = performance.now(); if (now - lastMove < 16) return; lastMove = now;   // ~60Hz cap
    vs.postMessage({ t: 'mouse', kind: 'move', ...px(e), ...mods(e) });
  });
  c.addEventListener('wheel', e => { e.preventDefault();
    awaiting = awaiting || { t0: performance.now(), kind: 'wheel' };
    vs.postMessage({ t: 'mouse', kind: 'wheel', ...px(e), deltaX: e.deltaX, deltaY: e.deltaY, ...mods(e) });
  }, { passive: false });

  for (const id of ['q','n']) document.getElementById(id).addEventListener('change', () => {
    vs.postMessage({ t: 'settings', settings: {
      quality: +document.getElementById('q').value,
      everyNthFrame: +document.getElementById('n').value } });
    lat.length = 0; draws.length = 0;
  });

  window.addEventListener('message', ev => {
    const m = ev.data;
    if (m.t === 'cpu') { cpu = m.pct; return; }
    if (m.t !== 'frame') return;
    m.recvAt = Date.now();
    pending = m;                                  // latest-frame-wins: overwrite, never queue
    if (!drawing) schedule();
  });

  function schedule() {
    drawing = true;
    requestAnimationFrame(() => {
      const m = pending; pending = null;
      if (!m) { drawing = false; return; }
      const img = new Image();
      img.onload = () => {
        const t0 = performance.now();
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const drawMs = performance.now() - t0;
        drawn++; fpsCount++;

        // Sample the marker patch (page-space 0..48 -> canvas top-left).
        const d = ctx.getImageData(6, 6, 4, 4).data;
        const lum = (d[0] + d[1] + d[2]) / 3;
        if (lastPatch !== null && Math.abs(lum - lastPatch) > 60 && awaiting) {
          const ms = performance.now() - awaiting.t0;
          lat.push(ms);
          vs.postMessage({ t: 'stat', sample: { latencyMs: +ms.toFixed(1), kind: awaiting.kind } });
          awaiting = null;
        }
        lastPatch = lum;

        draws.push(drawMs);
        vs.postMessage({ t: 'frameStat', sample: {
          drawMs: +drawMs.toFixed(2),
          transportMs: m.recvAt - m.sentAt,
          ageAtDrawMs: m.capturedAt ? Math.round(Date.now() - m.capturedAt) : null } });

        if (Date.now() - lastSec >= 1000) { fps = fpsCount; fpsCount = 0; lastSec = Date.now(); }
        render();
        drawing = false;
        if (pending) schedule();
      };
      img.onerror = () => { drawing = false; };
      img.src = 'data:image/jpeg;base64,' + m.data;
    });
  }

  const p = (a, q) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length * q)].toFixed(1) : '–';
  function render() {
    hud.innerHTML =
      '<span class="k">keystroke-to-pixel</span>  n=' + lat.length +
      '  p50=' + p(lat, .5) + 'ms  p95=' + p(lat, .95) + 'ms  max=' + (lat.length ? Math.max(...lat).toFixed(0) : '–') + 'ms\\n' +
      '<span class="k">webview draw</span>        p50=' + p(draws, .5) + 'ms  p95=' + p(draws, .95) + 'ms\\n' +
      '<span class="k">drawn fps</span> ' + fps + '   <span class="k">frames</span> ' + drawn +
      '   <span class="k">ext-host CPU</span> ' + cpu + '%';
  }
  // Auto-drive: synthesise keydowns on the canvas so keystroke-to-pixel is measurable without
  // a human. Goes through the exact same path a real keypress does (listener -> postMessage ->
  // host -> CDP -> page -> repaint -> screencast -> draw -> pixel sample).
  setInterval(() => {
    if (!document.getElementById('auto').checked) return;
    if (awaiting) return;                       // don't overlap measurements
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
  }, 350);

  // Give up on a flip that never arrives, so one lost frame doesn't wedge the probe.
  setInterval(() => {
    if (awaiting && performance.now() - awaiting.t0 > 3000) {
      vs.postMessage({ t: 'stat', sample: { latencyMs: null, kind: awaiting.kind, timedOut: true } });
      awaiting = null;
    }
  }, 500);

  c.focus();
  </script></body></html>`;
}

function activate(ctx) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('s4.open', () => start().catch((e) => vscode.window.showErrorMessage('S4: ' + e.message))),
    vscode.commands.registerCommand('s4.dump', () => vscode.window.showInformationMessage('S4 ' + JSON.stringify(dump()))),
  );
  start().catch((e) => vscode.window.showErrorMessage('S4 start failed: ' + e.message));
}
function deactivate() { cleanup(); }
module.exports = { activate, deactivate };
