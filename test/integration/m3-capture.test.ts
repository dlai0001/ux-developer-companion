// M3 acceptance (PLAN §6): the composited PNG differs from the clean one, the annotation store
// round-trips, and anchored componentRefs match what M2 resolves.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserSession } from '../../src/extension/session/session.js';
import { capture } from '../../src/extension/session/capture.js';
import { anchorPoint, type Annotation } from '../../src/shared/annotations.js';

const ROOT = resolve(__dirname, '../..');
const DIST = join(ROOT, 'fixtures/react-app/dist-dev');
const AGENT = join(ROOT, 'out/page-agent.js');
const PORT = 5389;
const OUT = join(tmpdir(), `ux-m3-out-${process.pid}`);
const HAVE = existsSync(join(DIST, 'index.html')) && existsSync(AGENT);

let server: Server;
let session: BrowserSession;
const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!HAVE)('M3 annotations + capture', () => {
  beforeAll(async () => {
    server = createServer((req, res) => {
      const u = (req.url ?? '/').split('?')[0]!;
      let f = join(DIST, u === '/' ? 'index.html' : u.slice(1));
      if (!existsSync(f) || !extname(f)) f = join(DIST, 'index.html');
      res.setHeader('content-type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'text/plain');
      res.end(readFileSync(f));
    });
    await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));
    session = new BrowserSession(
      { userDataDir: join(tmpdir(), `ux-m3-${process.pid}`), pageAgentPath: AGENT },
      { onFrame: () => undefined, onUrlChanged: () => undefined,
        onStatus: () => undefined, onViewportChanged: () => undefined },
    );
    await session.start(`http://127.0.0.1:${PORT}/`);
    await settle(1500);
  }, 120_000);

  afterAll(async () => {
    await session?.dispose();
    await new Promise<void>((r) => server?.close(() => r()));
    rmSync(OUT, { recursive: true, force: true });
  });

  it('writes a clean PNG and an annotated PNG that actually differ', async () => {
    const annotations: Annotation[] = [
      { id: 'a1', kind: 'rect', from: { x: 20, y: 20 }, to: { x: 300, y: 200 }, color: '#ff3ea5' },
      { id: 'a2', kind: 'arrow', from: { x: 320, y: 40 }, to: { x: 420, y: 160 }, color: '#2f81f7' },
      { id: 'a3', kind: 'callout', from: { x: 60, y: 260 }, to: { x: 60, y: 260 },
        color: '#f5a524', text: 'date picker should be above this', anchor: { x: 200, y: 220 } },
    ];
    const res = await capture(session.connection!, annotations, OUT, 'stamp-1');

    expect(existsSync(res.cleanPath)).toBe(true);
    expect(existsSync(res.annotatedPath)).toBe(true);
    expect(res.cleanBytes).toBeGreaterThan(1000);
    // Both are valid PNGs.
    for (const p of [res.cleanPath, res.annotatedPath]) {
      expect(readFileSync(p).subarray(1, 4).toString()).toBe('PNG');
    }
    // The composite must differ — this is what proves the annotations were drawn.
    expect(readFileSync(res.annotatedPath).equals(readFileSync(res.cleanPath))).toBe(false);
  }, 60_000);

  it('produces an identical annotated image when there is nothing to draw', async () => {
    const res = await capture(session.connection!, [], OUT, 'stamp-2');
    expect(readFileSync(res.annotatedPath).equals(readFileSync(res.cleanPath))).toBe(true);
  }, 60_000);

  it('anchor-resolves each annotation kind to the same component M2 reports', async () => {
    const cdp = session.connection!;
    const box = await cdp.evaluate<{ x: number; y: number; w: number; h: number }>(
      `(() => { const r = document.querySelector('[data-testid="usercard"]').getBoundingClientRect();
                return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })()`,
    );
    const centre = { x: box.x + Math.round(box.w / 2), y: box.y + Math.round(box.h / 2) };
    const direct = await session.resolveAt(centre.x, centre.y);
    expect(direct?.name).toBe('UserCard');

    // Each kind must anchor to the same component through anchorPoint().
    const kinds: Annotation[] = [
      { id: 'r', kind: 'rect', from: { x: box.x, y: box.y }, to: { x: box.x + box.w, y: box.y + box.h }, color: '#fff' },
      { id: 'w', kind: 'arrow', from: { x: 5, y: 5 }, to: centre, color: '#fff' },
      { id: 'c', kind: 'callout', from: { x: 5, y: 5 }, to: { x: 5, y: 5 }, color: '#fff', anchor: centre },
    ];
    for (const a of kinds) {
      const p = anchorPoint(a);
      const info = await session.resolveAt(p.x, p.y);
      expect(info?.name, `kind ${a.kind}`).toBe('UserCard');
    }
  }, 60_000);
});
