// Does Input.dispatchKeyEvent stall the screencast stream?
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import CDP from 'chrome-remote-interface';
import { launchBrowser } from './lib/launch.mjs';

const DIST = '/Users/dlai/projects/ui-code-vscode-ext/fixtures/react-app/dist';
const PORT = 5393;
const srv = createServer((req, res) => {
  const u = (req.url ?? '/').split('?')[0];
  let f = join(DIST, u === '/' ? 'index.html' : u.slice(1));
  if (!existsSync(f) || !extname(f)) f = join(DIST, 'index.html');
  res.setHeader('content-type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'text/plain');
  res.end(readFileSync(f));
});
await new Promise((r) => srv.listen(PORT, '127.0.0.1', r));

const FLAGS = process.env.FLAGS === '1' ? [
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-ipc-flooding-protection',
] : [];
const b = await launchBrowser({ userDataDir: '/tmp/ux-input-stall', extraArgs: FLAGS });
const client = await CDP({ port: b.port, host: '127.0.0.1' });
const { Page, Runtime, Input, Emulation } = client;
await Page.enable({}); await Runtime.enable();
const FIX = process.env.FIX ?? 'none';   // none | focus | lifecycle | both | front | frontlife
if (FIX === 'focus' || FIX === 'both') {
  await Emulation.setFocusEmulationEnabled({ enabled: true });
  console.log('[fix] focus emulation ON');
}
if (FIX === 'lifecycle' || FIX === 'both' || FIX === 'frontlife') {
  await Page.setWebLifecycleState({ state: 'active' });
  console.log('[fix] web lifecycle active');
}
if (FIX === 'front' || FIX === 'frontlife') {
  await Page.bringToFront();
  console.log('[fix] bringToFront');
}
await Emulation.setDeviceMetricsOverride({ width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
const PAGE = process.env.PAGE ?? 'react';
const plain = 'data:text/html,' + encodeURIComponent('<body style="font:20px system-ui"><input id=i><div id=t>x</div></body>');
await Page.navigate({ url: PAGE === 'plain' ? plain : `http://127.0.0.1:${PORT}/` });
await Page.loadEventFired();
await new Promise((r) => setTimeout(r, 500));

let count = 0;
const ACK = process.env.ACK_MODE ?? 'await';   // 'await' | 'void' | 'none'
client.on('Page.screencastFrame', async ({ sessionId }) => {
  count++;
  const t = Date.now();
  try {
    await Page.screencastFrameAck({ sessionId });
    console.log(`  frame#${count} sid=${sessionId} ackOK (+${Date.now() - t}ms)`);
  } catch (e) {
    console.log(`  frame#${count} sid=${sessionId} ackFAIL ${String(e).slice(0, 100)}`);
  }
});

await Page.startScreencast({ format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
await new Promise((r) => setTimeout(r, 500));

const paint = async (label) => {
  const before = count;
  for (let i = 0; i < 4; i++) {
    await Runtime.evaluate({ expression: `document.body.style.background='hsl(${'${'}i*80},80%,60%)'`.replace('${i*80}', String(i * 80)) });
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`${label.padEnd(28)} frames=${count - before}`);
};

await paint('1. before any input');

const KEYMODE = process.env.KEYMODE ?? 'full';   // full | nochar | rawonly | skip
if (KEYMODE !== 'skip') {
  for (const ch of 'hey') {
    const vk = ch.toUpperCase().charCodeAt(0);
    const base = { windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, key: ch, code: `Key${ch.toUpperCase()}`, modifiers: 0 };
    const _t0 = Date.now();
    if (KEYMODE === 'rawonly') {
      await Input.dispatchKeyEvent({ ...base, type: 'rawKeyDown' });
      await Input.dispatchKeyEvent({ ...base, type: 'keyUp' });
    } else if (KEYMODE === 'nochar') {
      await Input.dispatchKeyEvent({ ...base, type: 'keyDown' });
      await Input.dispatchKeyEvent({ ...base, type: 'keyUp' });
    } else {
      await Input.dispatchKeyEvent({ ...base, type: 'keyDown' });
      await Input.dispatchKeyEvent({ ...base, type: 'char', text: ch, unmodifiedText: ch });
      await Input.dispatchKeyEvent({ ...base, type: 'keyUp' });
    }
    console.log(`  key '${ch}' dispatch ${Date.now() - _t0}ms`);
  }
}
await new Promise((r) => setTimeout(r, 600));

await paint('2. after key dispatch');

await Input.dispatchMouseEvent({ type: 'mousePressed', x: 100, y: 100, button: 'left', clickCount: 1 });
await Input.dispatchMouseEvent({ type: 'mouseReleased', x: 100, y: 100, button: 'left', clickCount: 1 });
await new Promise((r) => setTimeout(r, 400));

await paint('3. after mouse dispatch');

// Does restarting the screencast recover a stalled stream?
await Page.stopScreencast().catch(() => {});
await Page.startScreencast({ format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
await paint('4. after screencast restart');

// And does it stall again on the next key?
const vk2 = 65;
await Input.dispatchKeyEvent({ windowsVirtualKeyCode: vk2, nativeVirtualKeyCode: vk2, key: 'a', code: 'KeyA', modifiers: 0, type: 'keyDown' });
await Input.dispatchKeyEvent({ windowsVirtualKeyCode: vk2, nativeVirtualKeyCode: vk2, key: 'a', code: 'KeyA', modifiers: 0, type: 'keyUp' });
await new Promise((r) => setTimeout(r, 400));
await paint('5. after one more key');

console.log(`ackMode=${ACK} totalFrames=${count}`);
await client.close(); b.kill(); srv.close();
