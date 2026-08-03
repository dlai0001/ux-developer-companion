import { describe, expect, it } from 'vitest';
import { composeContext, routeOf, type ComposeInput } from '../../src/extension/copilot/composer.js';
import type { Annotation } from '../../src/shared/annotations.js';
import type { ComponentInfo } from '../../src/shared/agent-api.js';
import type { LocateResult } from '../../src/extension/locator-rank.js';

const component = (over: Partial<ComponentInfo> = {}): ComponentInfo => ({
  id: 1, framework: 'react', name: 'UserCard', selectorHint: 'UserCard', ancestry: ['App', 'UserCard'],
  props: { compact: true, user: { name: 'Ada Lovelace' } }, state: { 'State[0]': 3 },
  domPath: '#usercard', bounds: { x: 0, y: 0, width: 100, height: 50 }, ...over,
});

const base = (over: Partial<ComposeInput> = {}): ComposeInput => ({
  url: 'http://localhost:4200/admin/reports',
  route: '/admin/reports',
  timestamp: '2026-08-03T00:00:00.000Z',
  emulation: { viewport: { width: 375, height: 812, dpr: 2 }, devicePreset: 'iPhone' },
  annotations: [],
  sources: new Map<string, LocateResult>(),
  captureDir: '/w/.ux-companion/captures/x',
  ...over,
});

describe('context composer', () => {
  it('includes URL, route and viewport state', () => {
    const out = composeContext(base());
    expect(out).toContain('URL: http://localhost:4200/admin/reports');
    expect(out).toContain('Route: /admin/reports');
    expect(out).toContain('375×812 @2x');
    expect(out).toContain('(iPhone)');
  });

  it('lists annotated components with their resolved file and alternates', () => {
    const a: Annotation = {
      id: 'a1', kind: 'callout', from: { x: 0, y: 0 }, to: { x: 0, y: 0 },
      color: '#fff', text: 'date picker should be above this', componentRef: component(),
    };
    const sources = new Map<string, LocateResult>([['a1', {
      best: { path: 'src/features/ReportFilter.tsx', score: 70, reasons: ['exported-def'] },
      alternates: [{ path: 'src/legacy/ReportFilter.tsx', score: 20, reasons: [] }],
    }]]);
    const out = composeContext(base({ annotations: [a], sources }));
    expect(out).toContain('[1] callout "date picker should be above this" → UserCard');
    expect(out).toContain('src/features/ReportFilter.tsx');
    expect(out).toContain('alternates: src/legacy/ReportFilter.tsx');
    expect(out).toContain('props:');
    expect(out).toContain('Ada Lovelace');
  });

  it('says so when a production build made the component name unreliable', () => {
    const a: Annotation = {
      id: 'a1', kind: 'rect', from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, color: '#fff',
      componentRef: component({ name: 'H2', degraded: 'production-build' }),
    };
    const out = composeContext(base({ annotations: [a] }));
    expect(out).toContain('production build — name unreliable');
  });

  it('does not invent a component when none resolved', () => {
    const a: Annotation = {
      id: 'a1', kind: 'rect', from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, color: '#fff',
      componentRef: null,
    };
    const out = composeContext(base({ annotations: [a] }));
    expect(out).toContain('no component resolved');
  });

  it('never tells the user to paste from the clipboard', () => {
    // Pasting images into chat is proposal-gated and silently does nothing (spike S1).
    const out = composeContext(base());
    expect(out.toLowerCase()).not.toContain('paste');
    expect(out).toContain('attached above');
  });

  it('extracts routes, including query strings', () => {
    expect(routeOf('http://localhost:5173/list?fail=500')).toBe('/list?fail=500');
    expect(routeOf('not a url')).toBe('not a url');
  });
});
