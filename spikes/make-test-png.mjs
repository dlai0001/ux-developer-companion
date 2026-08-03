// Renders a PNG containing a distinctive code word. If a model reads the word back,
// it demonstrably received image bytes rather than just a filename.
import { writeFileSync, mkdirSync } from 'node:fs';
import CDP from 'chrome-remote-interface';
import { launchBrowser } from './lib/launch.mjs';

const OUT = new URL('./_out/', import.meta.url).pathname;
const CODEWORD = process.argv[2] || 'MAGENTA-7734';
mkdirSync(OUT, { recursive: true });

// Unique profile dir per run — PLAN §4.1's `browser-profile-<id>` is load-bearing, not
// cosmetic: a stale profile owned by an orphaned process makes the next launch hang.
const b = await launchBrowser({ userDataDir: `${OUT}chrome-profile-${process.pid}` });
console.log(`launched via=${b.via} port=${b.port}`);

const client = await CDP({ port: b.port });
const { Page, Runtime } = client;
await Page.enable();

const html = `<body style="margin:0;display:grid;place-items:center;height:100vh;
  font:700 64px/1.2 system-ui;background:#101418;color:#e8eef5">
  <div style="text-align:center">
    <div style="color:#ff3ea5">${CODEWORD}</div>
    <div style="font-size:28px;font-weight:400;color:#8fa3b8">ux-companion spike S1 fixture</div>
    <div style="margin-top:24px;width:220px;height:80px;background:#2f81f7;border-radius:12px"></div>
  </div></body>`;

await Page.navigate({ url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
await Page.loadEventFired();
const { data } = await Page.captureScreenshot({ format: 'png' });
writeFileSync(OUT + 'codeword.png', Buffer.from(data, 'base64'));

const { result } = await Runtime.evaluate({ expression: '!!document.body' });
console.log('page reachable:', result.value);
console.log('wrote', OUT + 'codeword.png', Buffer.from(data, 'base64').length, 'bytes');

await client.close();
b.kill();
