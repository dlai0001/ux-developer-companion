// M8 acceptance (PLAN §6): :hover forced on the fixture button changes computed style;
// GET /api/items -> 500 makes the fixture show its error banner; the offline preset fails
// fetch; a storage profile round-trips; the state matrix yields the expected tiles.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserSession } from '../../src/extension/session/session.js';
import { matches, type InterceptRule } from '../../src/extension/session/intercept.js';

const ROOT = resolve(__dirname, '../..');
const DIST = join(ROOT, 'fixtures/react-app/dist-dev');
const AGENT = join(ROOT, 'out/page-agent.js');
const PORT = 5382;
const HAVE = existsSync(join(DIST, 'index.html')) && existsSync(AGENT);

let server: Server;
let session: BrowserSession;
const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const pointOn = (s: BrowserSession, sel: string): Promise<{ x: number; y: number }> =>
  s.connection!.evaluate(
    `(() => { const r = document.querySelector('${sel}').getBoundingClientRect();
              return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`,
  );

describe.skipIf(!HAVE)('M8 state lab', () => {
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
      { userDataDir: join(tmpdir(), `ux-m8-${process.pid}`), pageAgentPath: AGENT },
      { onFrame: () => undefined, onUrlChanged: () => undefined,
        onStatus: () => undefined, onViewportChanged: () => undefined },
    );
    await session.start(`http://127.0.0.1:${PORT}/`);
    await settle(1500);
  }, 120_000);

  afterAll(async () => {
    await session?.setInterceptRules([]);
    await session?.dispose();
    server?.closeAllConnections();
    await new Promise<void>((r) => server?.close(() => r()));
  });

  it('matches rules by method and URL substring', () => {
    const rule: InterceptRule = {
      id: 'r1', method: 'GET', urlContains: '/api/items',
      action: { kind: 'fail', status: 500 }, enabled: true,
    };
    expect(matches(rule, 'GET', 'http://x/api/items?a=1')).toBe(true);
    expect(matches(rule, 'POST', 'http://x/api/items')).toBe(false);
    expect(matches(rule, 'GET', 'http://x/api/other')).toBe(false);
    expect(matches({ ...rule, enabled: false }, 'GET', 'http://x/api/items')).toBe(false);
  });

  it('forces :hover and the computed style changes', async () => {
    const cdp = session.connection!;
    const before = await cdp.evaluate<string>(
      `getComputedStyle(document.querySelector('.primary-btn')).backgroundColor`);

    const p = await pointOn(session, '.primary-btn');
    expect(await session.forcePseudoAt(p.x, p.y, ['hover'])).toBe(true);
    await settle(250);

    const hovered = await cdp.evaluate<string>(
      `getComputedStyle(document.querySelector('.primary-btn')).backgroundColor`);
    expect(hovered).not.toBe(before);

    await session.forcePseudoAt(p.x, p.y, []);   // release
    await settle(200);
    expect(await cdp.evaluate<string>(
      `getComputedStyle(document.querySelector('.primary-btn')).backgroundColor`)).toBe(before);
  }, 60_000);

  it('a GET /api/items -> 500 rule makes the fixture show its error banner', async () => {
    await session.setInterceptRules([{
      id: 'fail-items', method: 'GET', urlContains: '/api/items',
      action: { kind: 'fail', status: 500 }, enabled: true,
    }]);
    expect(session.activeRuleCount).toBe(1);

    await session.navigate(`http://127.0.0.1:${PORT}/list`);
    await settle(1200);
    const cdp = session.connection!;
    expect(await cdp.evaluate<boolean>(`!!document.querySelector('[data-testid="error-banner"]')`)).toBe(true);

    // Turning the rule off restores the normal list.
    await session.setInterceptRules([]);
    await session.navigate(`http://127.0.0.1:${PORT}/list`);
    await settle(1200);
    expect(await cdp.evaluate<boolean>(`!!document.querySelector('[data-testid="items"]')`)).toBe(true);
  }, 90_000);

  it('serves a mocked body', async () => {
    await session.setInterceptRules([{
      id: 'mock-items', urlContains: '/api/items', enabled: true,
      action: { kind: 'mock', body: JSON.stringify([{ id: 99, label: 'Mocked' }]) },
    }]);
    await session.navigate(`http://127.0.0.1:${PORT}/list`);
    await settle(1200);
    expect(await session.connection!.evaluate<string>(
      `document.querySelector('[data-testid="items"]').textContent`)).toContain('Mocked');
    await session.setInterceptRules([]);
  }, 90_000);

  it('the offline preset makes fetch fail', async () => {
    await session.setThrottle('offline');
    const failed = await session.connection!.evaluate<boolean>(
      `fetch('/api/items').then(() => false).catch(() => true)`);
    expect(failed).toBe(true);
    await session.setThrottle('none');
  }, 60_000);

  it('round-trips a storage profile', async () => {
    const cdp = session.connection!;
    await cdp.evaluate(`localStorage.setItem('ux-key', 'saved'); sessionStorage.setItem('ux-s', 'sess');`);
    const profile = await session.snapshotStorage();
    expect(profile.local['ux-key']).toBe('saved');

    await cdp.evaluate(`localStorage.clear(); sessionStorage.clear();`);
    expect(await cdp.evaluate<string | null>(`localStorage.getItem('ux-key')`)).toBeNull();

    await session.restoreStorage(profile);
    expect(await cdp.evaluate<string | null>(`localStorage.getItem('ux-key')`)).toBe('saved');
    expect(await cdp.evaluate<string | null>(`sessionStorage.getItem('ux-s')`)).toBe('sess');
  }, 60_000);

  it('captures one matrix tile per pseudo-state set and releases the forcing', async () => {
    await session.navigate(`http://127.0.0.1:${PORT}/`);
    await settle(800);
    const p = await pointOn(session, '.primary-btn');
    const sets = [[], ['hover'], ['focus'], ['active']];
    const tiles = await session.stateMatrix(p.x, p.y, sets);

    expect(tiles).toHaveLength(sets.length);
    for (const t of tiles) expect(Buffer.from(t.png, 'base64').subarray(1, 4).toString()).toBe('PNG');
    // :hover restyles the button, so that tile must differ from the base one.
    expect(tiles[1]!.png).not.toBe(tiles[0]!.png);

    // Forcing must be released afterwards or the page stays stuck in the last state.
    const after = await session.connection!.evaluate<string>(
      `getComputedStyle(document.querySelector('.primary-btn')).backgroundColor`);
    expect(after).toBe('rgb(47, 129, 247)');
  }, 90_000);
});
