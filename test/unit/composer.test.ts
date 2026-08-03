import { describe, expect, it } from 'vitest';
import { composeContext, routeOf, type ComposeInput } from '../../src/extension/copilot/composer.js';
import type { Annotation } from '../../src/shared/annotations.js';
import type { ComponentInfo } from '../../src/shared/agent-api.js';

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

  it('carries the text written on callouts through as notes', () => {
    const a: Annotation = {
      id: 'a1', kind: 'callout', from: { x: 0, y: 0 }, to: { x: 0, y: 0 },
      color: '#fff', text: 'date picker should be above this', componentRef: component(),
    };
    const out = composeContext(base({ annotations: [a] }));
    expect(out).toContain('[1] date picker should be above this');
  });

  it('leaves component internals out of the prompt — the image says it better', () => {
    const a: Annotation = {
      id: 'a1', kind: 'rect', from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, color: '#fff',
      componentRef: component(),
    };
    const out = composeContext(base({ annotations: [a] }));
    expect(out).not.toContain('Annotated components');
    expect(out).not.toContain('UserCard');
    expect(out).not.toContain('Ada Lovelace');
    expect(out).not.toContain('props:');
  });

  it('says nothing at all about unlabelled marks', () => {
    const a: Annotation = {
      id: 'a1', kind: 'rect', from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, color: '#fff',
      componentRef: null,
    };
    const out = composeContext(base({ annotations: [a] }));
    expect(out).not.toContain('Notes on the annotated screenshot');
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
