// Integration: real headless browser + real CDP against the built React fixture.
// Serves fixtures/react-app/dist statically rather than booting Vite, so the suite is fast and
// deterministic. Requires `npm run fixtures:setup` + a fixture build (checked, not assumed).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import CDP from 'chrome-remote-interface';
import { launchBrowser, type LaunchedBrowser } from '../../src/extension/browser/launch.js';
// The fixture API is ESM (.mjs) while these suites compile as CJS, so it is imported
// dynamically rather than statically (TS1479).
type ItemsHandler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void;
let handleItems: ItemsHandler;

const DIST = resolve(__dirname, '../../fixtures/react-app/dist');
const PORT = 5399;
const HAVE_FIXTURE = existsSync(join(DIST, 'index.html'));

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
};

let server: Server;
let browser: LaunchedBrowser;
let client: Awaited<ReturnType<typeof CDP>>;

describe.skipIf(!HAVE_FIXTURE)('React fixture over CDP', () => {
  beforeAll(async () => {
    ({ handleItems } = await import('../../fixtures/shared/items-api.mjs'));

    server = createServer((req, res) => {
      const url = (req.url ?? '/').split('?')[0]!;
      if (url.startsWith('/api/items')) return handleItems(req, res);
      // SPA fallback so /list resolves to index.html.
      let file = join(DIST, url === '/' ? 'index.html' : url.slice(1));
      if (!existsSync(file) || !extname(file)) file = join(DIST, 'index.html');
      res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
      res.end(readFileSync(file));
    });
    await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));

    browser = await launchBrowser({
      userDataDir: join(tmpdir(), `ux-it-${process.pid}`),
    });
    client = await CDP({ port: browser.port });
    // devtools-protocol types Page.enable's params as required (all fields optional).
    await client.Page.enable({});
    await client.Runtime.enable();
  }, 90_000);

  afterAll(async () => {
    await client?.close().catch(() => undefined);
    browser?.kill();
    server?.closeAllConnections();
    await new Promise<void>((r) => server?.close(() => r()));
  });

  const evaluate = async <T>(expression: string): Promise<T> => {
    const { result } = await client.Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true });
    return result.value as T;
  };

  const goto = async (path: string): Promise<void> => {
    await client.Page.navigate({ url: `http://127.0.0.1:${PORT}${path}` });
    await client.Page.loadEventFired();
    await new Promise((r) => setTimeout(r, 400)); // let React mount
  };

  it('discovers and launches a browser, reporting how the port was found', () => {
    expect(browser.port).toBeGreaterThan(0);
    // DevToolsActivePort is the reliable mechanism; stderr is the documented fallback.
    expect(['DevToolsActivePort', 'stderr']).toContain(browser.via);
  });

  it('renders UserCard with its props on /', async () => {
    await goto('/');
    expect(await evaluate<boolean>(`!!document.querySelector('[data-testid="usercard"]')`)).toBe(true);
    expect(await evaluate<string>(`document.querySelector('[data-testid="uc-name"]').textContent`))
      .toBe('Ada Lovelace');
    expect(await evaluate<string>(`document.querySelector('[data-testid="uc-compact"]').textContent`))
      .toBe('compact=false');
  });

  it('forwards synthetic input through CDP (pre-flight for M1)', async () => {
    await goto('/');
    const box = await evaluate<{ x: number; y: number }>(
      `(() => { const r = document.querySelector('[data-testid="uc-btn"]').getBoundingClientRect();
                return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`,
    );
    for (const type of ['mousePressed', 'mouseReleased'] as const) {
      await client.Input.dispatchMouseEvent({ type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    await new Promise((r) => setTimeout(r, 200));
    expect(await evaluate<string>(`document.querySelector('[data-testid="uc-count"]').textContent`))
      .toBe('count=1');
  });

  it('exposes the intentional a11y violations the M7 suite needs', async () => {
    await goto('/');
    expect(await evaluate<boolean>(`!!document.querySelector('[data-testid="low-contrast"]')`)).toBe(true);
    // An input with no label and no aria-label is violation #2.
    expect(await evaluate<boolean>(
      `(() => { const i = document.querySelector('[data-testid="unlabelled"]');
                return !i.labels?.length && !i.getAttribute('aria-label'); })()`,
    )).toBe(true);
  });

  it('reaches every /list state via the shared fixture API', async () => {
    await goto('/list');
    expect(await evaluate<boolean>(`!!document.querySelector('[data-testid="items"]')`)).toBe(true);

    await goto('/list?empty=1');
    expect(await evaluate<boolean>(`!!document.querySelector('[data-testid="empty"]')`)).toBe(true);

    await goto('/list?fail=500');
    expect(await evaluate<boolean>(`!!document.querySelector('[data-testid="error-banner"]')`)).toBe(true);
  });

  it('declares the two breakpoints the M6 slider must discover', async () => {
    await goto('/');
    const widths = await evaluate<number[]>(`
      (() => {
        const out = new Set();
        for (const sheet of Array.from(document.styleSheets)) {
          let rules; try { rules = sheet.cssRules; } catch { continue; }
          for (const r of Array.from(rules ?? [])) {
            const m = /min-width:\\s*(\\d+)px/.exec(r.conditionText ?? '');
            if (m) out.add(Number(m[1]));
          }
        }
        return Array.from(out).sort((a, b) => a - b);
      })()`);
    expect(widths).toEqual([600, 900]);
  });
});
