// Annotation model (PLAN §4.4). Geometry is stored in PAGE CSS pixels, not canvas pixels, so
// annotations survive scrolling, resizing and device-metrics changes.
import type { ComponentInfo } from './agent-api.js';

export type AnnotationKind = 'rect' | 'ellipse' | 'arrow' | 'text' | 'callout';

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

/** Solid red by default; any other colour comes from the swatch's colour picker. */
export const DEFAULT_COLOR = '#ff0000';

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
  if (a.kind === 'text') return a.from;           // the label sits on the thing it names
  if (a.kind === 'arrow') return a.to;            // the head points AT the thing
  const r = normalizeRect(a.from, a.to);          // rect/ellipse: centre
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
}

/**
 * Kinds placed by a single click. A callout is NOT one of these: it is dragged — the initial
 * press sets the tail's target and the drag places the bubble away from it.
 */
export function isClickPlaced(kind: AnnotationKind): boolean {
  return kind === 'text';
}

/** Shapes offered behind the single Shape button. */
export const SHAPE_KINDS = ['rect', 'ellipse'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export function isDegenerate(a: Annotation): boolean {
  // A callout with no drag is still valid — it just sits on its anchor.
  if (isClickPlaced(a.kind) || a.kind === 'callout') return false;
  const r = normalizeRect(a.from, a.to);
  return r.width < 3 && r.height < 3;
}
