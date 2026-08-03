// M1 acceptance (PLAN §6): frames on a STATIC page, typed text reaching the page, tracked URL
// on navigation, process exit on dispose, and relaunch after a kill (stale-lock reaping).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserSession } from '../../src/extension/session/session.js';
import type { FrameMessage } from '../../src/shared/protocol.js';

const DIST = resolve(__dirname, '../../fixtures/react-app/dist');
const PORT = 5397;
const HAVE_FIXTURE = existsSync(join(DIST, 'index.html'));
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
};

let server: Server;
const frames: FrameMessage[] = [];
const urls: string[] = [];
const statuses: string[] = [];
let session: BrowserSession;

const events = {
  onFrame: (f: FrameMessage) => { frames.push(f); },
  onUrlChanged: (u: string) => { urls.push(u); },
  onStatus: (t: string) => { statuses.push(t); },
  onViewportChanged: () => undefined,
};

const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!HAVE_FIXTURE)('M1 browser session', () => {
  beforeAll(async () => {
    const { handleItems } = await import('../../fixtures/shared/items-api.mjs');
    server = createServer((req, res) => {
      const url = (req.url ?? '/').split('?')[0]!;
      // /list renders the error banner unless the API is served here too.
      if (url.startsWith('/api/items')) return handleItems(req, res);
      let file = join(DIST, url === '/' ? 'index.html' : url.slice(1));
      if (!existsSync(file) || !extname(file)) file = join(DIST, 'index.html');
      res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
      res.end(readFileSync(file));
    });
    await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));

    session = new BrowserSession(
      { userDataDir: join(tmpdir(), `ux-m1-${process.pid}`) },
      events,
    );
    await session.start(`http://127.0.0.1:${PORT}/`);
    await settle(2500);
  }, 120_000);

  afterAll(async () => {
    await session?.dispose();
    await new Promise<void>((r) => server?.close(() => r()));
  });

  it('receives frames within 3s on a STATIC page (forced repaint works)', () => {
    // The fixture has no animation: without an explicit repaint after startScreencast,
    // CDP emits zero frames and the canvas would stay black.
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]!.data.length).toBeGreaterThan(500);
  });

  it('tracks the current URL', () => {
    expect(session.url).toContain(`127.0.0.1:${PORT}`);
    expect(urls.length).toBeGreaterThan(0);
  });

  it('forwards typed text into the page', async () => {
    const cdp = session.connection!;
    await cdp.evaluate(`document.querySelector('[data-testid="unlabelled"]').focus()`);
    for (const ch of 'hey') {
      await session.sendKey(ch, `Key${ch.toUpperCase()}`, { alt: false, ctrl: false, meta: false, shift: false });
    }
    await settle(300);
    const value = await cdp.evaluate<string>(`document.querySelector('[data-testid="unlabelled"]').value`);
    expect(value).toBe('hey');
  }, 30_000);

  it('forwards mouse clicks into the page', async () => {
    const cdp = session.connection!;
    const box = await cdp.evaluate<{ x: number; y: number }>(
      `(() => { const r = document.querySelector('[data-testid="uc-btn"]').getBoundingClientRect();
                return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`,
    );
    const mods = { alt: false, ctrl: false, meta: false, shift: false };
    await session.sendMouse('down', box.x, box.y, mods);
    await session.sendMouse('up', box.x, box.y, mods);
    await settle(300);
    expect(await cdp.evaluate<string>(`document.querySelector('[data-testid="uc-count"]').textContent`))
      .toBe('count=1');
  }, 30_000);

  it('updates the tracked URL when navigating to /list', async () => {
    await session.navigate(`http://127.0.0.1:${PORT}/list`);
    await settle(1200);
    expect(session.url).toContain('/list');
    const cdp = session.connection!;
    expect(await cdp.evaluate<boolean>(`!!document.querySelector('[data-testid="items"]')`)).toBe(true);
  }, 30_000);

  it('produces new frames after a resize', async () => {
    const before = frames.length;
    await session.resize(900, 640);
    await settle(2500);
    expect(frames.length).toBeGreaterThan(before);
  }, 30_000);

  it('kills the browser process on dispose', async () => {
    const local = new BrowserSession({ userDataDir: join(tmpdir(), `ux-m1-dispose-${process.pid}`) }, events);
    await local.start(`http://127.0.0.1:${PORT}/`);
    await settle(800);
    expect(local.isRunning).toBe(true);
    await local.dispose();
    await settle(700);
    expect(local.isRunning).toBe(false);
  }, 60_000);

  it('relaunches into a reused profile dir after an unclean kill (stale-lock reaping)', async () => {
    // A killed browser leaves SingletonLock behind; without reaping, the next launch aborts
    // with exit code 21. Same dir twice, deliberately.
    const dir = join(tmpdir(), `ux-m1-relaunch-${process.pid}`);
    const first = new BrowserSession({ userDataDir: dir }, events);
    await first.start(`http://127.0.0.1:${PORT}/`);
    await settle(600);
    first.connection && (await first.connection.close());
    // Hard kill without cleanup, simulating a crash.
    (first as unknown as { browser?: { proc: { kill(sig: string): void } } }).browser?.proc.kill('SIGKILL');
    await settle(800);

    const second = new BrowserSession({ userDataDir: dir }, events);
    await expect(second.start(`http://127.0.0.1:${PORT}/`)).resolves.toBeUndefined();
    expect(second.isRunning).toBe(true);
    await second.dispose();
  }, 90_000);
});
