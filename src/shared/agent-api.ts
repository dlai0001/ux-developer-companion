// Host <-> page-agent call/result types (PLAN §4.3). Shapes here are fixed by the spike round;
// M2 implements the adapters against them.

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type JsonSnapshot = Record<string, Json>;

export type Framework = 'angular' | 'react';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComponentInfo {
  /** Adapter-assigned handle used to address this component in readState/writeState. */
  id: number;
  framework: Framework | null;
  name: string;
  selectorHint: string | null;
  /** React `getOwnersList` ancestry, e.g. ['App','UserCard'] — a source-locator ranking signal. */
  ancestry: string[];
  props: JsonSnapshot;
  state: JsonSnapshot | null;
  domPath: string;
  bounds: Bounds;
  /**
   * Set when the page is a production build: props stay readable but component identity is
   * unreliable (React reports the host tag). Never emit a name into the context payload
   * without surfacing this. Verified in spike S3.
   */
  degraded?: 'production-build';
}

export interface ComponentTreeNode {
  id: number;
  name: string;
  children: ComponentTreeNode[];
}

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'not-found' | 'production-build'; detail?: string };

export interface FrameworkAdapter {
  detect(): boolean;
  resolveAt(x: number, y: number): ComponentInfo | null;
  resolveNode(el: Element): ComponentInfo | null;
  componentTree(maxDepth: number): ComponentTreeNode[];
  readState(id: number): ComponentInfo | null;
  writeState(id: number, path: Array<string | number>, value: Json): WriteResult;
  /** DERIVED at runtime (React: canEditFunctionProps/canEditHooks), never hardcoded. */
  readonly supportsWrite: boolean;
}

/** Namespaced global the host calls via Runtime.evaluate. */
export const AGENT_GLOBAL = '__uxCompanion';
/** Runtime.addBinding name the agent uses to push events to the host. */
export const AGENT_BINDING = '__uxCompanionEmit';
