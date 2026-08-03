// Annotation model (PLAN §4.4). Geometry is stored in PAGE CSS pixels, not canvas pixels, so
// annotations survive scrolling, resizing and device-metrics changes.
import type { ComponentInfo } from './agent-api.js';

export type AnnotationKind = 'rect' | 'arrow' | 'callout';

export interface Point { x: number; y: number }

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  /** Page CSS px. For rect: from/to are opposite corners. For arrow: tail -> head. */
  from: Point;
  to: Point;
  color: string;
  /** Callout body text. */
  text?: string;
  /** Point the callout tail anchors to (page CSS px). */
  anchor?: Point;
  /** Component resolved at creation time, if the page agent could identify one. */
  componentRef?: ComponentInfo | null;
}

export const ANNOTATION_COLORS = ['#ff3ea5', '#2f81f7', '#f5a524', '#17c964'] as const;

export function newId(seed: number): string {
  return `a${seed.toString(36)}`;
}

/** Normalised rectangle (top-left + size) from two arbitrary corners. */
export function normalizeRect(a: Point, b: Point): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Anchor point used to resolve a component for each annotation kind (PLAN §4.4). */
export function anchorPoint(a: Annotation): Point {
  if (a.kind === 'callout') return a.anchor ?? a.to;
  if (a.kind === 'arrow') return a.to;            // the head points AT the thing
  const r = normalizeRect(a.from, a.to);          // rect: centre
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
}

export function isDegenerate(a: Annotation): boolean {
  if (a.kind === 'callout') return false;
  const r = normalizeRect(a.from, a.to);
  return r.width < 3 && r.height < 3;
}
