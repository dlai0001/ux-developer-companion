// M2 acceptance, Angular half (PLAN §6): resolveAt on app-user-card returns the selector and
// its inputs. Angular exposes window.ng only in a DEV build, which is what we serve here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserSession } from '../../src/extension/session/session.js';
import type { ComponentInfo } from '../../src/shared/agent-api.js';

const ROOT = resolve(__dirname, '../..');
const DIST = join(ROOT, 'fixtures/angular-app/dist/angular-app/browser');
const AGENT = join(ROOT, 'out/page-agent.js');
const PORT = 5390;
const HAVE = existsSync(join(DIST, 'index.html')) && existsSync(AGENT);

let server: Server;
let session: BrowserSession;
const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!HAVE)('M2 page agent — Angular', () => {
  beforeAll(async () => {
    const { handleItems } = await import('../../fixtures/shared/items-api.mjs');
    server = createServer((req, res) => {
      const u = (req.url ?? '/').split('?')[0]!;
      if (u.startsWith('/api/items')) return handleItems(req, res);
      let f = join(DIST, u === '/' ? 'index.html' : u.slice(1));
      if (!existsSync(f) || !extname(f)) f = join(DIST, 'index.html');
      res.setHeader('content-type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon' }[extname(f)] ?? 'text/plain');
      res.end(readFileSync(f));
    });
    await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));

    session = new BrowserSession(
      { userDataDir: join(tmpdir(), `ux-m2ng-${process.pid}`), pageAgentPath: AGENT },
      { onFrame: () => undefined, onUrlChanged: () => undefined,
        onStatus: () => undefined, onViewportChanged: () => undefined },
    );
    await session.start(`http://127.0.0.1:${PORT}/`);
    await settle(2000);
  }, 120_000);

  afterAll(async () => {
    await session?.dispose();
    await new Promise<void>((r) => server?.close(() => r()));
  });

  it('detects Angular via window.ng', async () => {
    expect(await session.detectFramework()).toBe('angular');
  });

  it('resolveAt on app-user-card returns the selector and its inputs', async () => {
    const cdp = session.connection!;
    const pt = await cdp.evaluate<{ x: number; y: number }>(
      `(() => { const r = document.querySelector('[data-testid="uc-name"]').getBoundingClientRect();
                return { x: Math.round(r.x + 4), y: Math.round(r.y + 4) }; })()`,
    );
    const info = await session.resolveAt(pt.x, pt.y);
    expect(info).not.toBeNull();
    const c = info as ComponentInfo;
    expect(c.framework).toBe('angular');
    expect(c.selectorHint).toBe('app-user-card');
    // Signal inputs are read by invoking them — `user` must come back as data, not "[fn]".
    const all = JSON.stringify({ props: c.props, state: c.state });
    expect(all).toContain('Ada Lovelace');
    expect(c.bounds.width).toBeGreaterThan(0);
  });

  it('builds a component tree containing the card', async () => {
    const tree = await session.componentTree(8);
    expect(JSON.stringify(tree)).toContain('user-card');
  });

  it('reports the same breakpoints as the React fixture', async () => {
    expect(await session.breakpoints()).toEqual([600, 900]);
  });
});
