// React adapter. Uses the react-devtools renderer interface DIRECTLY (spike S3): no Bridge,
// no Store, no custom wall. The backend is installed at document-start by index.ts so the
// global hook exists before React registers its renderer.
import type {
  ComponentInfo, ComponentTreeNode, FrameworkAdapter, Json, WriteResult,
} from '../../shared/agent-api.js';
import { serializeProps, serializeValue } from '../serialize.js';
import { boundsOf, cssPath, elementAt } from '../dom-utils.js';

interface InspectedData {
  props?: { data?: unknown };
  hooks?: { data?: Array<{ id: number; name: string; value: unknown; subHooks?: unknown[] }> };
  canEditFunctionProps?: boolean;
  canEditHooks?: boolean;
}

interface RendererInterface {
  getElementIDForHostInstance?(node: Node): number | null;
  getDisplayNameForElementID?(id: number): string | null;
  findHostInstancesForElementID?(id: number): Element[] | null;
  getOwnersList?(id: number): Array<{ displayName?: string }> | null;
  inspectElement?(
    requestID: unknown, id: number, path: unknown, forceFullData: boolean,
  ): { type?: string; value?: InspectedData } | undefined;
  // POSITIONAL — (type, id, hookID, path, value). The object form fails SILENTLY.
  overrideValueAtPath?(
    type: 'props' | 'hooks' | 'state' | 'context',
    id: number, hookID: number | null, path: Array<string | number>, value: unknown,
  ): void;
}

interface Hook {
  renderers?: Map<number, { version?: string }>;
  rendererInterfaces?: Map<number, RendererInterface>;
}

const hook = (): Hook | undefined =>
  (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook }).__REACT_DEVTOOLS_GLOBAL_HOOK__;

function rendererInterface(): { rid: number; ri: RendererInterface } | null {
  const h = hook();
  if (!h?.rendererInterfaces || h.rendererInterfaces.size === 0) return null;
  const rid = Array.from(h.rendererInterfaces.keys())[0]!;
  const ri = h.rendererInterfaces.get(rid);
  return ri ? { rid, ri } : null;
}

export class ReactAdapter implements FrameworkAdapter {
  private lastEditable = false;

  detect(): boolean {
    const h = hook();
    return !!h?.renderers && h.renderers.size > 0 && rendererInterface() !== null;
  }

  get supportsWrite(): boolean {
    // Derived, never hardcoded: false on production builds (spike S3).
    return this.lastEditable;
  }

  resolveAt(x: number, y: number): ComponentInfo | null {
    const el = elementAt(x, y);
    return el ? this.resolveNode(el) : null;
  }

  resolveNode(el: Element): ComponentInfo | null {
    const r = rendererInterface();
    if (!r?.ri.getElementIDForHostInstance) return null;
    const id = r.ri.getElementIDForHostInstance(el);
    if (id == null) return null;
    return this.infoFor(id, el);
  }

  readState(id: number): ComponentInfo | null {
    return this.infoFor(id, null);
  }

  private infoFor(id: number, el: Element | null): ComponentInfo | null {
    const r = rendererInterface();
    if (!r) return null;
    const { ri } = r;

    const inspected = ri.inspectElement?.(null, id, null, false);
    const data = inspected?.value;
    const canEdit = !!(data?.canEditFunctionProps || data?.canEditHooks);
    this.lastEditable = canEdit;

    const displayName = ri.getDisplayNameForElementID?.(id) ?? null;
    const hosts = ri.findHostInstancesForElementID?.(id) ?? null;
    const host = hosts && hosts.length > 0 ? hosts[0]! : el;

    // Production-build signal (spike S3): canEditFunctionProps/canEditHooks are true in dev and
    // false in a production build. Do NOT try to infer it from the name shape — minified names
    // like "Vf" are indistinguishable from real ones. Per-hook `isStateEditable` is also
    // useless here: it stays true even in prod.
    const degraded = !canEdit;

    const hooksData = data?.hooks?.data;
    const state = hooksData?.length
      ? Object.fromEntries(hooksData.map((h, i) => [
          `${h.name ?? 'hook'}[${h.id ?? i}]`, serializeValue(h.value),
        ]))
      : null;

    return {
      framework: 'react',
      name: displayName ?? 'Unknown',
      selectorHint: displayName,
      ancestry: (ri.getOwnersList?.(id) ?? []).map((o) => o.displayName ?? '?').filter(Boolean),
      props: serializeProps(data?.props?.data ?? {}),
      state,
      domPath: host ? cssPath(host) : '',
      bounds: host ? boundsOf(host) : { x: 0, y: 0, width: 0, height: 0 },
      ...(degraded ? { degraded: 'production-build' as const } : {}),
    };
  }

  componentTree(maxDepth: number): ComponentTreeNode[] {
    // The full tree lives in the devtools Store, which is not available (S3). Derive a usable
    // tree by walking rendered host elements and grouping by their owning component instead.
    const r = rendererInterface();
    if (!r?.ri.getElementIDForHostInstance) return [];
    const seen = new Map<number, ComponentTreeNode>();
    const roots: ComponentTreeNode[] = [];

    const all = Array.from(document.querySelectorAll('*')).slice(0, 2000);
    for (const el of all) {
      const id = r.ri.getElementIDForHostInstance(el);
      if (id == null || seen.has(id)) continue;
      const name = r.ri.getDisplayNameForElementID?.(id) ?? 'Unknown';
      const node: ComponentTreeNode = { id, name, children: [] };
      seen.set(id, node);

      const owners = (r.ri.getOwnersList?.(id) ?? []).map((o) => o.displayName ?? '?');
      if (owners.length <= 1 || maxDepth <= 1) { roots.push(node); continue; }
      const parentName = owners[owners.length - 2];
      const parent = Array.from(seen.values()).find((n) => n.name === parentName);
      if (parent && parent !== node) parent.children.push(node); else roots.push(node);
    }
    return roots;
  }

  writeState(id: number, path: Array<string | number>, value: Json): WriteResult {
    const r = rendererInterface();
    if (!r?.ri.overrideValueAtPath) return { ok: false, reason: 'unsupported' };
    if (!this.supportsWrite) {
      // Re-check: supportsWrite reflects the last inspect.
      this.infoFor(id, null);
      if (!this.supportsWrite) return { ok: false, reason: 'production-build' };
    }
    try {
      const [head, ...rest] = path;
      if (typeof head === 'string' && head.startsWith('hook:')) {
        const hookID = Number(head.slice(5));
        r.ri.overrideValueAtPath('hooks', id, hookID, rest, value);
      } else {
        r.ri.overrideValueAtPath('props', id, null, path, value);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'not-found', detail: String((e as Error).message) };
    }
  }
}
