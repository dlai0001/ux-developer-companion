// Injected into the user's page via Page.addScriptToEvaluateOnNewDocument, BEFORE app scripts
// run (PLAN §4.3 — the React devtools hook must exist before React registers its renderer).
// M0 establishes the namespace + binding handshake only; adapters arrive in M2.
import { AGENT_BINDING, AGENT_GLOBAL, type Framework } from '../shared/agent-api.js';

interface AgentApi {
  readonly version: string;
  ping(): { ok: true; url: string; framework: Framework | null };
  detectFramework(): Framework | null;
}

declare global {
  interface Window {
    [AGENT_GLOBAL]?: AgentApi;
    [AGENT_BINDING]?: (payload: string) => void;
    ng?: { getComponent?: unknown };
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: { renderers?: Map<number, unknown> };
  }
}

function detectFramework(): Framework | null {
  // Angular exposes window.ng only in dev mode (PLAN §4.3).
  if (typeof window.ng?.getComponent === 'function') return 'angular';
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (hook?.renderers && hook.renderers.size > 0) return 'react';
  return null;
}

/** Push an event to the host over the CDP binding, when one has been installed. */
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
};

// Idempotent: addScriptToEvaluateOnNewDocument fires on every navigation.
if (!window[AGENT_GLOBAL]) {
  window[AGENT_GLOBAL] = api;
  emit({ type: 'agent-ready', url: location.href });
}
