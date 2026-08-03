// One serializer shared by both adapters (PLAN §4.3): depth 4, arrays capped at 50,
// strings at 500 chars, cycle-safe, functions -> "[fn]", DOM nodes -> tag string.
import type { Json, JsonSnapshot } from '../shared/agent-api.js';

const MAX_DEPTH = 4;
const MAX_ARRAY = 50;
const MAX_STRING = 500;

export function serializeValue(value: unknown, depth = 0, seen = new WeakSet<object>()): Json {
  if (value === null || value === undefined) return null;

  const t = typeof value;
  if (t === 'string') {
    const s = value as string;
    return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}… (${s.length} chars)` : s;
  }
  if (t === 'number') return Number.isFinite(value as number) ? (value as number) : String(value);
  if (t === 'boolean') return value as boolean;
  if (t === 'bigint') return `${String(value)}n`;
  if (t === 'symbol') return String(value);
  if (t === 'function') {
    const name = (value as { name?: string }).name;
    return name ? `[fn ${name}]` : '[fn]';
  }

  const obj = value as object;
  if (seen.has(obj)) return '[circular]';
  if (depth >= MAX_DEPTH) return Array.isArray(obj) ? `[Array(${(obj as unknown[]).length})]` : '[object]';
  seen.add(obj);

  try {
    // DOM nodes are noisy and unserializable — reduce to a tag string.
    if (typeof Element !== 'undefined' && obj instanceof Element) {
      const el = obj;
      return `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}>`;
    }
    if (typeof Node !== 'undefined' && obj instanceof Node) return `<#${(obj as Node).nodeName}>`;
    if (obj instanceof Date) return obj.toISOString();
    if (obj instanceof RegExp) return String(obj);
    if (obj instanceof Error) return `${obj.name}: ${obj.message}`;

    if (Array.isArray(obj)) {
      const arr = obj as unknown[];
      const out = arr.slice(0, MAX_ARRAY).map((v) => serializeValue(v, depth + 1, seen));
      if (arr.length > MAX_ARRAY) out.push(`… ${arr.length - MAX_ARRAY} more`);
      return out;
    }

    if (obj instanceof Map) {
      return { '[Map]': serializeValue(Array.from(obj.entries()).slice(0, MAX_ARRAY), depth + 1, seen) };
    }
    if (obj instanceof Set) {
      return { '[Set]': serializeValue(Array.from(obj.values()).slice(0, MAX_ARRAY), depth + 1, seen) };
    }

    // React elements would otherwise dump an entire subtree.
    const maybeEl = obj as { $$typeof?: symbol; type?: unknown };
    if (maybeEl.$$typeof && String(maybeEl.$$typeof).includes('react.element')) {
      const type = maybeEl.type;
      const name = typeof type === 'function' ? (type as { name?: string }).name : String(type);
      return `<${name ?? 'Element'} />`;
    }

    const out: Record<string, Json> = {};
    for (const key of Object.keys(obj).slice(0, MAX_ARRAY)) {
      try {
        out[key] = serializeValue((obj as Record<string, unknown>)[key], depth + 1, seen);
      } catch {
        out[key] = '[unreadable]';
      }
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

export function serializeProps(value: unknown): JsonSnapshot {
  const s = serializeValue(value);
  return s !== null && typeof s === 'object' && !Array.isArray(s) ? s : { value: s };
}
