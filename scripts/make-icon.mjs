// Generates media/icon.png from HTML via the same headless browser the extension drives.
// Keeps the icon reproducible and reviewable as source rather than opaque binary.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import CDP from 'chrome-remote-interface';
import { launchBrowser } from '../src/extension/browser/launch-shim.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'media'), { recursive: true });

const html = `<body style="margin:0;width:128px;height:128px;display:grid;place-items:center;
  background:linear-gradient(135deg,#2f81f7,#ff3ea5);font:700 64px system-ui;color:#fff">
  <div style="line-height:1">UX</div></body>`;

const b = await launchBrowser({ userDataDir: '/tmp/ux-icon-gen' });
const client = await CDP({ port: b.port, host: '127.0.0.1' });
await client.Page.enable({});
await client.Emulation.setDeviceMetricsOverride({ width: 128, height: 128, deviceScaleFactor: 1, mobile: false });
await client.Page.navigate({ url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
await client.Page.loadEventFired();
await new Promise((r) => setTimeout(r, 300));
const { data } = await client.Page.captureScreenshot({ format: 'png' });
writeFileSync(join(root, 'media', 'icon.png'), Buffer.from(data, 'base64'));
console.log('wrote media/icon.png');
await client.close();
b.kill();
