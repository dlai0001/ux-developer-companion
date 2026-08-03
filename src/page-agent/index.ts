// Injected via Page.addScriptToEvaluateOnNewDocument, BEFORE app scripts run — the React
// devtools hook must exist before React registers its renderer (PLAN §4.3).
import * as backend from 'react-devtools-core/backend';
import { AGENT_BINDING, AGENT_GLOBAL, type ComponentInfo, type ComponentTreeNode,
         type Framework, type FrameworkAdapter, type Json, type WriteResult } from '../shared/agent-api.js';
import { drawAnnotations } from '../shared/compositor.js';
import type { Annotation } from '../shared/annotations.js';
import { ReactAdapter } from './adapters/react.js';
import { AngularAdapter } from './adapters/angular.js';

interface AgentApi {
  readonly version: string;
  ping(): { ok: true; url: string; framework: Framework | null };
  detectFramework(): Framework | null;
  resolveAt(x: number, y: number): ComponentInfo | null;
  readState(id: number): ComponentInfo | null;
  componentTree(maxDepth: number): ComponentTreeNode[];
  writeState(id: number, path: Array<string | number>, value: Json): WriteResult;
  supportsWrite(): boolean;
  /** Media-query breakpoints for the M6 slider. */
  breakpoints(): number[];
  /**
   * Draw annotations over a base screenshot and return PNG base64 (PLAN §4.4).
   * Compositing lives here, in the page, because the extension host has no canvas — and
   * because serializing the drawing functions across module boundaries breaks under any
   * transform that rewrites imports.
   */
  composite(baseB64: string, annotations: Annotation[]): Promise<string>;
  /** Bounds of the element under a point, for guide snapping (PLAN §4.6). */
  elementBounds(x: number, y: number): { x: number; y: number; width: number; height: number } | null;
}

declare global {
  interface Window {
    [AGENT_GLOBAL]?: AgentApi;
    [AGENT_BINDING]?: (payload: string) => void;
  }
}

const react = new ReactAdapter();
const angular = new AngularAdapter();

function activeAdapter(): FrameworkAdapter | null {
  if (angular.detect()) return angular;
  if (react.detect()) return react;
  return null;
}

function detectFramework(): Framework | null {
  if (angular.detect()) return 'angular';
  if (react.detect()) return 'react';
  return null;
}

export function emit(event: Record<string, unknown>): void {
  const binding = window[AGENT_BINDING];
  if (typeof binding === 'function') {
    try { binding(JSON.stringify(event)); } catch { /* binding not ready; drop */ }
  }
}

const api: AgentApi = {
  version: '0.0.1',
  ping: () => ({ ok: true, url: location.href, framework: detectFramework() }),
  detectFramework,
  resolveAt: (x, y) => activeAdapter()?.resolveAt(x, y) ?? null,
  readState: (id) => activeAdapter()?.readState(id) ?? null,
  componentTree: (maxDepth) => activeAdapter()?.componentTree(maxDepth) ?? [],
  writeState: (id, path, value) =>
    activeAdapter()?.writeState(id, path, value) ?? { ok: false, reason: 'unsupported' },
  supportsWrite: () => activeAdapter()?.supportsWrite ?? false,
  elementBounds: (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  },
  composite: async (baseB64, annotations) => {
    const img = new Image();
    img.src = `data:image/png;base64,${baseB64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return baseB64;
    ctx.drawImage(img, 0, 0);
    // The screenshot is in device pixels; annotation geometry is in page CSS px.
    const scale = img.naturalWidth / Math.max(1, window.innerWidth);
    drawAnnotations(ctx, annotations, { scale });
    return canvas.toDataURL('image/png').split(',')[1] ?? baseB64;
  },
  breakpoints: () => {
    const out = new Set<number>();
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList | undefined;
      try { rules = sheet.cssRules; } catch { continue; }   // cross-origin sheets throw
      for (const rule of Array.from(rules ?? [])) {
        const cond = (rule as CSSMediaRule).conditionText ?? '';
        for (const m of cond.matchAll(/(?:min|max)-width:\s*(\d+)px/g)) out.add(Number(m[1]));
      }
    }
    return Array.from(out).sort((a, b) => a - b);
  },
};

// Install the devtools backend first so React registers against it.
try {
  (backend as { initialize?: () => void }).initialize?.();
} catch { /* a page without React simply has no renderer to attach */ }

// Idempotent: addScriptToEvaluateOnNewDocument fires on every navigation.
if (!window[AGENT_GLOBAL]) {
  window[AGENT_GLOBAL] = api;
  emit({ type: 'agent-ready', url: location.href });
}
