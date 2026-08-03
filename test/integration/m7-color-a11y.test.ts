// M7 acceptance (PLAN §6): eyedropper on the themed element reports --color-primary AND its
// defining selector; the intentional low-contrast text computes < 4.5; axe reports >= 2 known
// violations; the vision-deficiency call sequence is verified.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserSession } from '../../src/extension/session/session.js';
import { provenanceAt } from '../../src/extension/session/token-provenance.js';
import { contrastAt, runAxe } from '../../src/extension/session/a11y.js';

const ROOT = resolve(__dirname, '../..');
const DIST = join(ROOT, 'fixtures/react-app/dist-dev');
const AGENT = join(ROOT, 'out/page-agent.js');
const AXE = join(ROOT, 'node_modules/axe-core/axe.min.js');
const PORT = 5384;
const HAVE = existsSync(join(DIST, 'index.html')) && existsSync(AGENT) && existsSync(AXE);

let server: Server;
let session: BrowserSession;
const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const pointOn = (s: BrowserSession, sel: string): Promise<{ x: number; y: number }> =>
  s.connection!.evaluate(
    `(() => { const r = document.querySelector('${sel}').getBoundingClientRect();
              return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`,
  );

describe.skipIf(!HAVE)('M7 colour + a11y', () => {
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
      { userDataDir: join(tmpdir(), `ux-m7-${process.pid}`), pageAgentPath: AGENT },
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

  it('reports --color-primary AND the rule that defines it', async () => {
    const p = await pointOn(session, '.primary-btn');
    const prov = await provenanceAt(session.connection!, p.x, p.y, 'background-color');
    expect(prov).not.toBeNull();
    expect(prov!.token).toBe('--color-primary');
    // Naming the token is not enough — the eyedropper promises where it came from.
    expect(prov!.chain[0]?.definedBy).toContain(':root');
    expect(prov!.final).toBe('#2f81f7');
    expect(prov!.computed).toBe('rgb(47, 129, 247)');
  }, 60_000);

  it('sees through a shorthand declaration', async () => {
    // .primary-btn uses `background: var(--color-primary)`, so the expanded background-color
    // longhand no longer contains var() — the resolver must fall back to the shorthand.
    const p = await pointOn(session, '.primary-btn');
    const prov = await provenanceAt(session.connection!, p.x, p.y, 'background-color');
    expect(prov!.viaShorthand).toBe('background');
  }, 60_000);

  it('reports a direct colour as having no token', async () => {
    const p = await pointOn(session, '[data-testid="low-contrast"]');
    const prov = await provenanceAt(session.connection!, p.x, p.y, 'background-color');
    expect(prov!.token).toBeNull();
  }, 60_000);

  it('computes a failing contrast ratio for the intentional low-contrast text', async () => {
    const p = await pointOn(session, '[data-testid="low-contrast"]');
    const c = await contrastAt(session.connection!, p.x, p.y);
    expect(c).not.toBeNull();
    expect(c!.ratio).toBeLessThan(4.5);
    expect(c!.aa).toBe(false);
  }, 60_000);

  it('finds the two intentional axe violations', async () => {
    const violations = await runAxe(session.connection!, AXE);
    expect(violations.length).toBeGreaterThanOrEqual(2);
    const ids = violations.map((v) => v.id);
    expect(ids).toContain('color-contrast');
    // The unlabelled input trips one of these depending on axe's rule set.
    expect(ids.some((i) => ['label', 'form-field-multiple-labels', 'aria-input-field-name'].includes(i))).toBe(true);
  }, 90_000);

  it('applies vision-deficiency and media emulation', async () => {
    const cdp = session.connection!;
    // The call sequence is what CI can verify; the visual effect is a manual-QA item.
    for (const type of ['deuteranopia', 'protanopia', 'tritanopia', 'achromatopsia', 'blurredVision', 'none']) {
      await expect(cdp.setVisionDeficiency(type)).resolves.toBeUndefined();
    }
    await cdp.setEmulatedMedia([{ name: 'prefers-color-scheme', value: 'dark' }]);
    expect(await cdp.evaluate<boolean>(`matchMedia('(prefers-color-scheme: dark)').matches`)).toBe(true);

    await cdp.setEmulatedMedia([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    expect(await cdp.evaluate<boolean>(`matchMedia('(prefers-reduced-motion: reduce)').matches`)).toBe(true);

    await cdp.setEmulatedMedia([]);   // restore
  }, 60_000);

  it('returns an accessibility subtree for an element', async () => {
    const cdp = session.connection!;
    const p = await pointOn(session, '.primary-btn');
    const nodeId = await cdp.nodeAt(p.x, p.y);
    expect(nodeId).not.toBeNull();
    const nodes = await cdp.partialAXTree(nodeId!);
    expect(nodes.length).toBeGreaterThan(0);
    const roles = nodes.map((n) => n.role?.value).filter(Boolean);
    expect(roles).toContain('button');
  }, 60_000);
});
