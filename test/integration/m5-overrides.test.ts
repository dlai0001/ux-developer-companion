// M5 acceptance (PLAN §6): set compact=true on the Angular UserCard -> DOM class changes;
// set hook state on the React UserCard -> rendered count changes; supportsWrite is false on
// the production build and writeState is REFUSED rather than silently no-op'ing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserSession } from '../../src/extension/session/session.js';

const ROOT = resolve(__dirname, '../..');
const AGENT = join(ROOT, 'out/page-agent.js');
const REACT_DEV = join(ROOT, 'fixtures/react-app/dist-dev');
const REACT_PROD = join(ROOT, 'fixtures/react-app/dist');
const NG_DIST = join(ROOT, 'fixtures/angular-app/dist/angular-app/browser');
const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon',
};

function serve(dist: string, port: number): Promise<Server> {
  const srv = createServer((req, res) => {
    const u = (req.url ?? '/').split('?')[0]!;
    let f = join(dist, u === '/' ? 'index.html' : u.slice(1));
    if (!existsSync(f) || !extname(f)) f = join(dist, 'index.html');
    res.setHeader('content-type', MIME[extname(f)] ?? 'text/plain');
    res.end(readFileSync(f));
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}

async function open(dist: string, port: number, tag: string): Promise<{ srv: Server; session: BrowserSession }> {
  const srv = await serve(dist, port);
  const session = new BrowserSession(
    { userDataDir: join(tmpdir(), `ux-m5-${tag}-${process.pid}`), pageAgentPath: AGENT },
    { onFrame: () => undefined, onUrlChanged: () => undefined,
      onStatus: () => undefined, onViewportChanged: () => undefined },
  );
  await session.start(`http://127.0.0.1:${port}/`);
  await settle(1500);
  return { srv, session };
}

const pointOn = async (session: BrowserSession, testid: string): Promise<{ x: number; y: number }> =>
  session.connection!.evaluate(
    `(() => { const r = document.querySelector('[data-testid="${testid}"]').getBoundingClientRect();
              return { x: Math.round(r.x + 4), y: Math.round(r.y + 4) }; })()`,
  );

describe.skipIf(!existsSync(join(REACT_DEV, 'index.html')) || !existsSync(AGENT))('M5 React overrides', () => {
  let srv: Server; let session: BrowserSession;
  beforeAll(async () => { ({ srv, session } = await open(REACT_DEV, 5388, 'react')); }, 120_000);
  afterAll(async () => { await session?.dispose(); srv?.closeAllConnections(); await new Promise<void>((r) => srv?.close(() => r())); });

  it('reports write support on a dev build', async () => {
    expect(await session.supportsWrite()).toBe(true);
  });

  it('overrides a PROP and the DOM reflects it', async () => {
    const cdp = session.connection!;
    const p = await pointOn(session, 'uc-name');
    const info = await session.resolveAt(p.x, p.y);
    expect(info?.name).toBe('UserCard');

    expect(await cdp.evaluate<string>(`document.querySelector('[data-testid="uc-compact"]').textContent`))
      .toBe('compact=false');

    const res = await session.writeComponent(info!.id, ['compact'], true);
    expect(res.ok).toBe(true);
    await settle(400);

    expect(await cdp.evaluate<string>(`document.querySelector('[data-testid="uc-compact"]').textContent`))
      .toBe('compact=true');
    // The className is driven by the same prop — proves a real re-render, not a text poke.
    expect(await cdp.evaluate<string>(`document.querySelector('[data-testid="usercard"]').className`))
      .toContain('compact');
  }, 60_000);

  it('overrides HOOK state and the rendered count changes', async () => {
    const cdp = session.connection!;
    const p = await pointOn(session, 'uc-name');
    const info = await session.resolveAt(p.x, p.y);
    expect(await cdp.evaluate<string>(`document.querySelector('[data-testid="uc-count"]').textContent`))
      .toBe('count=0');

    // hook:0 addresses useState(0) — the adapter routes this through
    // overrideValueAtPath('hooks', id, 0, [], 42) with POSITIONAL args.
    const res = await session.writeComponent(info!.id, ['hook:0'], 42);
    expect(res.ok).toBe(true);
    await settle(400);

    expect(await cdp.evaluate<string>(`document.querySelector('[data-testid="uc-count"]').textContent`))
      .toBe('count=42');
  }, 60_000);
});

describe.skipIf(!existsSync(join(REACT_PROD, 'index.html')) || !existsSync(AGENT))('M5 production build refuses writes', () => {
  let srv: Server; let session: BrowserSession;
  beforeAll(async () => { ({ srv, session } = await open(REACT_PROD, 5387, 'prod')); }, 120_000);
  afterAll(async () => { await session?.dispose(); srv?.closeAllConnections(); await new Promise<void>((r) => srv?.close(() => r())); });

  it('reports no write support and REFUSES the write instead of silently doing nothing', async () => {
    const cdp = session.connection!;
    const p = await pointOn(session, 'uc-name');
    const info = await session.resolveAt(p.x, p.y);
    expect(info?.degraded).toBe('production-build');
    expect(await session.supportsWrite()).toBe(false);

    const before = await cdp.evaluate<string>(`document.querySelector('[data-testid="uc-compact"]').textContent`);
    const res = await session.writeComponent(info!.id, ['compact'], true);
    // An explicit refusal is the point: a silent no-op would look like a working override.
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('production-build');
    await settle(300);
    expect(await cdp.evaluate<string>(`document.querySelector('[data-testid="uc-compact"]').textContent`)).toBe(before);
  }, 60_000);
});

describe.skipIf(!existsSync(join(NG_DIST, 'index.html')) || !existsSync(AGENT))('M5 Angular overrides', () => {
  let srv: Server; let session: BrowserSession;
  beforeAll(async () => { ({ srv, session } = await open(NG_DIST, 5386, 'ng')); }, 120_000);
  afterAll(async () => { await session?.dispose(); srv?.closeAllConnections(); await new Promise<void>((r) => srv?.close(() => r())); });

  it('sets a signal-backed state value and the DOM reflects it', async () => {
    const cdp = session.connection!;
    const p = await pointOn(session, 'uc-name');
    const info = await session.resolveAt(p.x, p.y);
    expect(info?.selectorHint).toBe('app-user-card');

    expect(await cdp.evaluate<string>(`document.querySelector('[data-testid="uc-count"]').textContent`))
      .toContain('0');

    // `count` is a writable signal -> written via .set(), then applyChanges().
    const res = await session.writeComponent(info!.id, ['count'], 7);
    expect(res.ok).toBe(true);
    await settle(400);
    expect(await cdp.evaluate<string>(`document.querySelector('[data-testid="uc-count"]').textContent`))
      .toContain('7');
  }, 60_000);
});
