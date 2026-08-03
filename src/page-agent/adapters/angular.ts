// Angular adapter (PLAN §4.3). Relies on window.ng, which only exists in a DEV build —
// production reports framework: null with an actionable hint rather than guessing.
import type {
  ComponentInfo, ComponentTreeNode, FrameworkAdapter, Json, WriteResult,
} from '../../shared/agent-api.js';
import { serializeProps, serializeValue } from '../serialize.js';
import { boundsOf, cssPath, elementAt } from '../dom-utils.js';

interface NgApi {
  getComponent?(el: Element): object | null;
  getOwningComponent?(el: Element): object | null;
  getDirectiveMetadata?(inst: object): { inputs?: Record<string, string>; selector?: string } | null;
  applyChanges?(inst: object): void;
  getHostElement?(inst: object): Element | null;
}

const ng = (): NgApi | undefined => (window as unknown as { ng?: NgApi }).ng;

type WritableSignal = (() => unknown) & { set(x: unknown): void };

/**
 * Signals are callable. Crucially, `input()` signals are READ-ONLY — they have no `.set`, so
 * testing for `.set` alone misses every component input and they get dropped as plain
 * functions. Detect the signal brand symbol as well.
 */
function isSignalLike(v: unknown): v is () => unknown {
  if (typeof v !== 'function') return false;
  const f = v as { set?: unknown; update?: unknown; asReadonly?: unknown };
  if (typeof f.set === 'function' || typeof f.update === 'function' || typeof f.asReadonly === 'function') return true;
  return Object.getOwnPropertySymbols(v).some((sym) => String(sym).toUpperCase().includes('SIGNAL'));
}

/** Only writable signals can be written back through .set() (PLAN §4.3). */
function isWritableSignal(v: unknown): v is WritableSignal {
  return typeof v === 'function' && typeof (v as { set?: unknown }).set === 'function';
}

function readField(v: unknown): unknown {
  if (isSignalLike(v)) {
    try { return (v as () => unknown)(); } catch { return '[signal]'; }
  }
  return v;
}

const INTERNAL = /^(__|ɵ|constructor$)/;

export class AngularAdapter implements FrameworkAdapter {
  private lastInstance: object | null = null;
  private instances = new Map<number, object>();
  private nextId = 1;

  detect(): boolean {
    return typeof ng()?.getComponent === 'function';
  }

  get supportsWrite(): boolean {
    // Dev mode implies applyChanges is available; that is the write path.
    return typeof ng()?.applyChanges === 'function';
  }

  resolveAt(x: number, y: number): ComponentInfo | null {
    const el = elementAt(x, y);
    return el ? this.resolveNode(el) : null;
  }

  resolveNode(el: Element): ComponentInfo | null {
    const api = ng();
    if (!api) return null;
    // Walk up until a component owns the node.
    let node: Element | null = el;
    let inst: object | null = null;
    while (node && !inst) {
      inst = api.getComponent?.(node) ?? api.getOwningComponent?.(node) ?? null;
      if (!inst) node = node.parentElement;
    }
    if (!inst || !node) return null;
    // getOwningComponent() answers for a DESCENDANT node (e.g. the <h2> inside the card), so
    // the node we hit is not the component's host. Resolve the real host element, otherwise
    // the selector degrades to whatever tag happened to be under the cursor.
    const host = api.getHostElement?.(inst) ?? node;
    return this.infoFor(inst, host);
  }

  private infoFor(inst: object, el: Element): ComponentInfo {
    const api = ng();
    const meta = api?.getDirectiveMetadata?.(inst) ?? null;
    const inputNames = new Set(Object.keys(meta?.inputs ?? {}));

    const props: Record<string, unknown> = {};
    const state: Record<string, unknown> = {};
    for (const key of Object.keys(inst)) {
      if (INTERNAL.test(key)) continue;
      const raw = (inst as Record<string, unknown>)[key];
      if (typeof raw === 'function' && !isSignalLike(raw)) continue;   // methods are not state
      const value = readField(raw);
      // With decorator metadata, trust it. Without it, read-only signals are inputs and
      // writable ones are internal state — which matches how input()/signal() differ.
      const isInput = inputNames.size > 0 ? inputNames.has(key) : (isSignalLike(raw) && !isWritableSignal(raw));
      if (isInput) props[key] = value; else state[key] = value;
    }

    const id = this.nextId++;
    this.instances.set(id, inst);
    this.lastInstance = inst;

    // Prefer the declared selector; fall back to the host tag (which IS the selector for a
    // component host) before the class name, which Angular prefixes with '_' after compilation.
    const tag = el.tagName.toLowerCase();
    const selector = meta?.selector ?? (tag.includes('-') ? tag : null);
    const className = (inst.constructor?.name ?? 'Unknown').replace(/^_+/, '');
    return {
      id,
      framework: 'angular',
      name: selector ?? className,
      selectorHint: selector,
      ancestry: [],
      props: serializeProps(props),
      state: Object.keys(state).length ? serializeProps(state) : null,
      domPath: cssPath(el),
      bounds: boundsOf(el),
    };
  }

  readState(id: number): ComponentInfo | null {
    const inst = this.instances.get(id);
    if (!inst) return null;
    const el = ng()?.getHostElement?.(inst) ?? null;
    return el ? this.infoFor(inst, el) : null;
  }

  componentTree(maxDepth: number): ComponentTreeNode[] {
    const api = ng();
    if (!api) return [];
    const roots: ComponentTreeNode[] = [];
    const seen = new Set<object>();
    const walk = (el: Element, depth: number, into: ComponentTreeNode[]): void => {
      if (depth > maxDepth) return;
      for (const child of Array.from(el.children)) {
        const inst = api.getComponent?.(child) ?? null;
        if (inst && !seen.has(inst)) {
          seen.add(inst);
          const meta = api.getDirectiveMetadata?.(inst) ?? null;
          const node: ComponentTreeNode = {
            id: this.nextId++,
            name: meta?.selector
              ?? (child.tagName.includes('-') ? child.tagName.toLowerCase() : null)
              ?? (inst.constructor?.name ?? 'Unknown').replace(/^_+/, ''),
            children: [],
          };
          this.instances.set(node.id, inst);
          into.push(node);
          walk(child, depth + 1, node.children);
        } else {
          walk(child, depth, into);
        }
      }
    };
    walk(document.body, 0, roots);
    return roots;
  }

  writeState(id: number, path: Array<string | number>, value: Json): WriteResult {
    const api = ng();
    const inst = this.instances.get(id) ?? this.lastInstance;
    if (!api || !inst) return { ok: false, reason: 'not-found' };
    if (!this.supportsWrite) return { ok: false, reason: 'production-build' };

    const [head, ...rest] = path;
    if (typeof head !== 'string') return { ok: false, reason: 'not-found' };
    const target = (inst as Record<string, unknown>)[head];

    try {
      if (isWritableSignal(target)) {
        // Signal inputs/state are written through .set(), not by assignment.
        if (rest.length === 0) target.set(value);
        else {
          const current = target() as Record<string, unknown>;
          setDeep(current, rest, value);
          target.set(current);
        }
      } else if (rest.length === 0) {
        (inst as Record<string, unknown>)[head] = value;
      } else {
        setDeep(target as Record<string, unknown>, rest, value);
      }
      api.applyChanges?.(inst);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'not-found', detail: String((e as Error).message) };
    }
  }
}

function setDeep(obj: Record<string, unknown>, path: Array<string | number>, value: unknown): void {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]!] as Record<string, unknown>;
  cur[path[path.length - 1]!] = value;
}

export { readField as __readField, serializeValue as __serializeValue };
