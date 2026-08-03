// M2 acceptance (PLAN §6): resolveAt on UserCard returns the right name + props in BOTH
// fixtures, and the production-build variant degrades honestly.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserSession } from '../../src/extension/session/session.js';
import type { ComponentInfo } from '../../src/shared/agent-api.js';

const ROOT = resolve(__dirname, '../..');
// Dev build: unminified + React development runtime, so component names survive.
// `dist` (production) is used by the degraded-path test below.
const DIST = join(ROOT, 'fixtures/react-app/dist-dev');
const PROD_DIST = join(ROOT, 'fixtures/react-app/dist');
const AGENT = join(ROOT, 'out/page-agent.js');
const PORT = 5392;
const HAVE = existsSync(join(DIST, 'index.html')) && existsSync(AGENT);

let server: Server;
let session: BrowserSession;
const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const agentEvents: Array<Record<string, unknown>> = [];

describe.skipIf(!HAVE)('M2 page agent — React', () => {
  beforeAll(async () => {
    const { handleItems } = await import('../../fixtures/shared/items-api.mjs');
    server = createServer((req, res) => {
      const u = (req.url ?? '/').split('?')[0]!;
      if (u.startsWith('/api/items')) return handleItems(req, res);
      let f = join(DIST, u === '/' ? 'index.html' : u.slice(1));
      if (!existsSync(f) || !extname(f)) f = join(DIST, 'index.html');
      res.setHeader('content-type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'text/plain');
      res.end(readFileSync(f));
    });
    await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));

    session = new BrowserSession(
      { userDataDir: join(tmpdir(), `ux-m2-${process.pid}`), pageAgentPath: AGENT },
      {
        onFrame: () => undefined, onUrlChanged: () => undefined,
        onStatus: () => undefined, onViewportChanged: () => undefined,
        onAgentEvent: (e) => { agentEvents.push(e); },
      },
    );
    await session.start(`http://127.0.0.1:${PORT}/`);
    await settle(1500);
  }, 120_000);

  afterAll(async () => {
    await session?.dispose();
    await new Promise<void>((r) => server?.close(() => r()));
  });

  it('installs at document start and announces itself over the CDP binding', () => {
    expect(agentEvents.some((e) => e['type'] === 'agent-ready')).toBe(true);
  });

  it('detects React', async () => {
    expect(await session.detectFramework()).toBe('react');
  });

  it('resolveAt on UserCard returns the component name and its props', async () => {
    const cdp = session.connection!;
    const pt = await cdp.evaluate<{ x: number; y: number }>(
      `(() => { const r = document.querySelector('[data-testid="uc-name"]').getBoundingClientRect();
                return { x: Math.round(r.x + 4), y: Math.round(r.y + 4) }; })()`,
    );
    const info = await session.resolveAt(pt.x, pt.y);
    expect(info).not.toBeNull();
    const c = info as ComponentInfo;
    expect(c.framework).toBe('react');
    expect(c.name).toBe('UserCard');
    expect(c.props['compact']).toBe(false);
    expect((c.props['user'] as Record<string, unknown>)['name']).toBe('Ada Lovelace');
    // Hook state is exposed for the inspector.
    expect(JSON.stringify(c.state)).toContain('0');
    // ownersList ancestry feeds source-locator ranking.
    expect(c.ancestry).toContain('UserCard');
    expect(c.bounds.width).toBeGreaterThan(0);
    expect(c.domPath.length).toBeGreaterThan(0);
    expect(c.degraded).toBeUndefined();
  });

  it('serializes deeply/cyclically without throwing', async () => {
    const cdp = session.connection!;
    // Cycles and functions must not break the read path.
    await cdp.evaluate(`window.__cyc = {}; window.__cyc.self = window.__cyc; window.__cyc.fn = () => {};`);
    const ok = await cdp.evaluate<boolean>(`!!window['__uxCompanion']`);
    expect(ok).toBe(true);
  });

  it('builds a component tree', async () => {
    const tree = await session.componentTree(8);
    expect(tree.length).toBeGreaterThan(0);
    const names = JSON.stringify(tree);
    expect(names).toContain('UserCard');
  });

  it('reports the media-query breakpoints', async () => {
    expect(await session.breakpoints()).toEqual([600, 900]);
  });
});

// The production-build path is the one most likely to rot silently: props stay readable but
// component identity is lost, and the adapter must SAY so rather than emit a bogus name.
describe.skipIf(!existsSync(join(PROD_DIST, 'index.html')))('M2 page agent — production build', () => {
  const PROD_PORT = 5391;
  let prodServer: Server;
  let prod: BrowserSession;

  beforeAll(async () => {
    prodServer = createServer((req, res) => {
      const u = (req.url ?? '/').split('?')[0]!;
      let f = join(PROD_DIST, u === '/' ? 'index.html' : u.slice(1));
      if (!existsSync(f) || !extname(f)) f = join(PROD_DIST, 'index.html');
      res.setHeader('content-type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'text/plain');
      res.end(readFileSync(f));
    });
    await new Promise<void>((r) => prodServer.listen(PROD_PORT, '127.0.0.1', r));
    prod = new BrowserSession(
      { userDataDir: join(tmpdir(), `ux-m2p-${process.pid}`), pageAgentPath: AGENT },
      { onFrame: () => undefined, onUrlChanged: () => undefined,
        onStatus: () => undefined, onViewportChanged: () => undefined },
    );
    await prod.start(`http://127.0.0.1:${PROD_PORT}/`);
    await settle(1500);
  }, 120_000);

  afterAll(async () => {
    await prod?.dispose();
    await new Promise<void>((r) => prodServer?.close(() => r()));
  });

  it('still reads props but flags the build as degraded', async () => {
    const cdp = prod.connection!;
    const pt = await cdp.evaluate<{ x: number; y: number }>(
      `(() => { const r = document.querySelector('[data-testid="uc-name"]').getBoundingClientRect();
                return { x: Math.round(r.x + 4), y: Math.round(r.y + 4) }; })()`,
    );
    const info = await prod.resolveAt(pt.x, pt.y);
    expect(info).not.toBeNull();
    const c = info as ComponentInfo;
    // Props survive minification...
    expect(c.props['compact']).toBe(false);
    // ...but the name does not, so it must be reported as degraded.
    expect(c.degraded).toBe('production-build');
  });
});
