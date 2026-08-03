// Injected via Page.addScriptToEvaluateOnNewDocument, BEFORE app scripts run — the React
// devtools hook must exist before React registers its renderer (PLAN §4.3).
import * as backend from 'react-devtools-core/backend';
import { AGENT_BINDING, AGENT_GLOBAL, type ComponentInfo, type ComponentTreeNode,
         type Framework, type FrameworkAdapter, type Json, type WriteResult } from '../shared/agent-api.js';
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
