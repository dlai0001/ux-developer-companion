// S4 — screencast budget. Measures, per settings combo: frames/sec delivered, end-to-end
// frame age (CDP metadata.timestamp -> receipt), and payload bytes. Also verifies the
// latest-frame-wins drop policy and idle pause/resume latency (PLAN §4.2).
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import CDP from 'chrome-remote-interface';
import { launchBrowser } from './lib/launch.mjs';

const S = new URL('./', import.meta.url).pathname;
const OUT = S + '_out/';
mkdirSync(OUT, { recursive: true });
const PORT = 5398;

const srv = createServer((_, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(readFileSync(S + 'fixtures/screencast.html'));
});
await new Promise((r) => srv.listen(PORT, r));

const b = await launchBrowser({ userDataDir: `${OUT}s4-profile` });
const client = await CDP({ port: b.port });
const { Page, Input, Runtime } = client;
await Page.enable();
await Runtime.enable();

const SAMPLE_MS = 5000;

async function measure({ quality, everyNthFrame, animated }) {
  await Page.navigate({ url: `http://127.0.0.1:${PORT}/${animated ? '?anim' : ''}` });
  await Page.loadEventFired();
  await new Promise((r) => setTimeout(r, 400));

  const frames = [];
  let undrawn = 0, maxUndrawn = 0, dropped = 0;

  const onFrame = async ({ data, metadata, sessionId }) => {
    const now = Date.now();
    // metadata.timestamp is seconds since epoch when the frame was captured.
    frames.push({ ageMs: metadata.timestamp ? now - metadata.timestamp * 1000 : null, bytes: data.length });

    // Latest-frame-wins: simulate a webview that can only draw one frame at a time.
    undrawn++;
    maxUndrawn = Math.max(maxUndrawn, undrawn);
    if (undrawn > 1) { dropped += undrawn - 1; undrawn = 1; } // discard stale, keep newest
    // ACK IMMEDIATELY — withholding the ack stalls the stream entirely (PLAN §4.2 is right).
    try { await Page.screencastFrameAck({ sessionId }); } catch {}
    setTimeout(() => { undrawn = Math.max(0, undrawn - 1); }, 8); // ~8ms draw
  };
  Page.screencastFrame(onFrame);

  const t0 = Date.now();
  await Page.startScreencast({ format: 'jpeg', quality, maxWidth: 1280, maxHeight: 800, everyNthFrame });
  // Drive continuous change so there is always something to send.
  const stop = setInterval(() => {
    Runtime.evaluate({ expression: `document.getElementById('ta').value += 'x'` }).catch(() => {});
  }, 50);
  await new Promise((r) => setTimeout(r, SAMPLE_MS));
  clearInterval(stop);
  await Page.stopScreencast();
  client.removeListener('Page.screencastFrame', onFrame);

  const elapsed = (Date.now() - t0) / 1000;
  const ages = frames.map((f) => f.ageMs).filter((n) => n != null).sort((a, b) => a - b);
  const pct = (p) => (ages.length ? ages[Math.floor(ages.length * p)] : null);
  const bytes = frames.map((f) => f.bytes);
  return {
    quality, everyNthFrame, page: animated ? 'animated' : 'static',
    fps: +(frames.length / elapsed).toFixed(1),
    frames: frames.length,
    medianAgeMs: pct(0.5), p95AgeMs: pct(0.95),
    avgKB: bytes.length ? +(bytes.reduce((a, c) => a + c, 0) / bytes.length / 1024).toFixed(1) : 0,
    maxUndrawn, droppedStale: dropped,
  };
}

const rows = [];
for (const animated of [false, true]) {
  for (const quality of [40, 60, 80]) {
    for (const everyNthFrame of [1, 2, 4]) {
      rows.push(await measure({ quality, everyNthFrame, animated }));
    }
  }
}

// Idle pause/resume: how fast can we come back after throttling down?
async function resumeLatency() {
  await Page.navigate({ url: `http://127.0.0.1:${PORT}/` });
  await Page.loadEventFired();
  await Page.startScreencast({ format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800 });
  await new Promise((r) => setTimeout(r, 500));
  await Page.stopScreencast();
  await new Promise((r) => setTimeout(r, 300));
  const t = Date.now();
  const first = new Promise((res) => {
    const h = ({ sessionId }) => { Page.screencastFrameAck({ sessionId }).catch(() => {}); res(Date.now() - t); client.removeListener('Page.screencastFrame', h); };
    Page.screencastFrame(h);
  });
  await Page.startScreencast({ format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800 });
  // Nudge the page so a frame is guaranteed to be produced.
  Runtime.evaluate({ expression: `document.body.style.outline='1px solid red'` }).catch(() => {});
  return Promise.race([first, new Promise((r) => setTimeout(() => r(-1), 5000))]);
}
const resumeMs = await resumeLatency();

console.table(rows);
console.log('resume latency after stop/start (ms):', resumeMs);
writeFileSync(OUT + 's4-results.json', JSON.stringify({ rows, resumeMs }, null, 2));
await client.close(); b.kill(); srv.close();
