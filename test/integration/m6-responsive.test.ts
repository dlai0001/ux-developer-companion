// M6 acceptance (PLAN §6): breakpoints parsed = {600, 900}; a metrics override at 600 changes
// the fixture layout (probed via a media-query-dependent computed style); the matrix produces
// N tiles at N widths.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserSession } from '../../src/extension/session/session.js';
import { DEVICE_PRESETS, findPreset, rotate } from '../../src/shared/devices.js';

const ROOT = resolve(__dirname, '../..');
const DIST = join(ROOT, 'fixtures/react-app/dist-dev');
const AGENT = join(ROOT, 'out/page-agent.js');
const PORT = 5385;
const HAVE = existsSync(join(DIST, 'index.html')) && existsSync(AGENT);

let server: Server;
let session: BrowserSession;
const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Columns in the fixture grid change at 600 and 900 (see fixtures styles.css). */
const gridColumns = (s: BrowserSession): Promise<string> =>
  s.connection!.evaluate<string>(
    `getComputedStyle(document.querySelector('[data-testid="grid"]')).gridTemplateColumns`,
  );

describe.skipIf(!HAVE)('M6 responsive tools', () => {
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
      { userDataDir: join(tmpdir(), `ux-m6-${process.pid}`), pageAgentPath: AGENT },
      { onFrame: () => undefined, onUrlChanged: () => undefined,
        onStatus: () => undefined, onViewportChanged: () => undefined },
    );
    await session.start(`http://127.0.0.1:${PORT}/`);
    await settle(1500);
  }, 120_000);

  afterAll(async () => {
    await session?.dispose();
    server?.closeAllConnections();
    await new Promise<void>((r) => server?.close(() => r()));
  });

  it('parses exactly the fixture breakpoints', async () => {
    expect(await session.breakpoints()).toEqual([600, 900]);
  });

  it('changes layout when the viewport crosses a breakpoint', async () => {
    await session.resize(500, 700);
    await settle(400);
    const narrow = await gridColumns(session);

    await session.resize(700, 700);   // past the 600 breakpoint
    await settle(400);
    const mid = await gridColumns(session);

    await session.resize(1000, 700);  // past the 900 breakpoint
    await settle(400);
    const wide = await gridColumns(session);

    // 1 -> 2 -> 3 columns; comparing counts avoids depending on exact px values.
    expect(narrow.split(' ').length).toBe(1);
    expect(mid.split(' ').length).toBe(2);
    expect(wide.split(' ').length).toBe(3);
  }, 60_000);

  it('applies a device preset including DPR and touch', async () => {
    const preset = findPreset('iphone-15')!;
    await session.applyDevice(preset);
    await settle(500);
    const cdp = session.connection!;
    expect(await cdp.evaluate<number>('window.innerWidth')).toBe(preset.width);
    expect(await cdp.evaluate<number>('window.devicePixelRatio')).toBe(preset.dpr);
    // Touch emulation must actually reach the page, not just the metrics.
    expect(await cdp.evaluate<boolean>(`'ontouchstart' in window || navigator.maxTouchPoints > 0`)).toBe(true);
  }, 60_000);

  it('rotates a preset by swapping width and height', async () => {
    const p = findPreset('ipad')!;
    const r = rotate(p);
    expect([r.width, r.height]).toEqual([p.height, p.width]);
    await session.applyDevice(r);
    await settle(500);
    expect(await session.connection!.evaluate<number>('window.innerWidth')).toBe(p.height);
  }, 60_000);

  it('produces one matrix tile per requested width', async () => {
    const widths = [420, 800, 1200];
    const tiles = await session.responsiveMatrix(widths);
    expect(tiles.map((t) => t.width)).toEqual(widths);
    for (const t of tiles) {
      expect(Buffer.from(t.png, 'base64').subarray(1, 4).toString()).toBe('PNG');
    }
    // Different widths must produce visibly different renders, not N copies.
    expect(tiles[0]!.png).not.toBe(tiles[2]!.png);
  }, 90_000);

  it('restores the live viewport after building the matrix', async () => {
    await session.resize(900, 640);
    await settle(300);
    await session.responsiveMatrix([400, 1000]);
    await settle(500);
    expect(await session.connection!.evaluate<number>('window.innerWidth')).toBe(900);
  }, 90_000);

  it('returns element bounds for guide snapping', async () => {
    await session.resize(1000, 700);
    await settle(300);
    const cdp = session.connection!;
    const pt = await cdp.evaluate<{ x: number; y: number }>(
      `(() => { const r = document.querySelector('[data-testid="usercard"]').getBoundingClientRect();
                return { x: Math.round(r.x + 5), y: Math.round(r.y + 5) }; })()`,
    );
    const b = await session.elementBounds(pt.x, pt.y);
    expect(b).not.toBeNull();
    expect(b!.width).toBeGreaterThan(10);
  }, 60_000);

  it('ships the presets the plan names', () => {
    const ids = DEVICE_PRESETS.map((d) => d.id);
    for (const want of ['iphone-se', 'iphone-15', 'iphone-15-pro-max', 'pixel-8', 'ipad', 'galaxy-s24', 'desktop-1080', 'desktop-1440']) {
      expect(ids).toContain(want);
    }
  });
});
