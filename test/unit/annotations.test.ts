import { describe, expect, it } from 'vitest';
import {
  anchorPoint, isClickPlaced, isDegenerate, newId, normalizeRect, type Annotation,
} from '../../src/shared/annotations.js';

const mk = (over: Partial<Annotation>): Annotation => ({
  id: 'a1', kind: 'rect', from: { x: 0, y: 0 }, to: { x: 10, y: 10 }, color: '#ff3ea5', ...over,
});

describe('annotation geometry', () => {
  it('normalises a rectangle dragged in any direction', () => {
    const expected = { x: 5, y: 5, width: 15, height: 25 };
    expect(normalizeRect({ x: 5, y: 5 }, { x: 20, y: 30 })).toEqual(expected);
    expect(normalizeRect({ x: 20, y: 30 }, { x: 5, y: 5 })).toEqual(expected);
    expect(normalizeRect({ x: 20, y: 5 }, { x: 5, y: 30 })).toEqual(expected);
  });

  it('anchors each kind at the point the user meant', () => {
    // rect -> centre
    expect(anchorPoint(mk({ kind: 'rect', from: { x: 0, y: 0 }, to: { x: 20, y: 40 } })))
      .toEqual({ x: 10, y: 20 });
    // arrow -> head, because the head is what points at the thing
    expect(anchorPoint(mk({ kind: 'arrow', from: { x: 0, y: 0 }, to: { x: 7, y: 9 } })))
      .toEqual({ x: 7, y: 9 });
    // callout -> its explicit anchor, not the bubble position
    expect(anchorPoint(mk({ kind: 'callout', from: { x: 100, y: 100 }, to: { x: 120, y: 120 }, anchor: { x: 3, y: 4 } })))
      .toEqual({ x: 3, y: 4 });
  });

  it('treats a click without a drag as degenerate (but never a callout)', () => {
    expect(isDegenerate(mk({ from: { x: 5, y: 5 }, to: { x: 6, y: 6 } }))).toBe(true);
    expect(isDegenerate(mk({ from: { x: 5, y: 5 }, to: { x: 60, y: 60 } }))).toBe(false);
    // A callout is placed by a click and gets its size from its text.
    expect(isDegenerate(mk({ kind: 'callout', from: { x: 5, y: 5 }, to: { x: 5, y: 5 } }))).toBe(false);
  });

  it('anchors a circle at its centre and a text label at its origin', () => {
    expect(anchorPoint(mk({ kind: 'ellipse', from: { x: 0, y: 0 }, to: { x: 20, y: 40 } })))
      .toEqual({ x: 10, y: 20 });
    expect(anchorPoint(mk({ kind: 'text', from: { x: 9, y: 11 }, to: { x: 9, y: 11 } })))
      .toEqual({ x: 9, y: 11 });
  });

  it('knows which kinds are placed by a click rather than dragged', () => {
    // Text and callout size themselves from their content, so a zero-drag placement is valid;
    // treating them as degenerate would silently discard every one the user creates.
    expect(isClickPlaced('text')).toBe(true);
    expect(isClickPlaced('callout')).toBe(true);
    for (const k of ['rect', 'ellipse', 'arrow'] as const) expect(isClickPlaced(k)).toBe(false);
    expect(isDegenerate(mk({ kind: 'text', from: { x: 5, y: 5 }, to: { x: 5, y: 5 } }))).toBe(false);
    expect(isDegenerate(mk({ kind: 'ellipse', from: { x: 5, y: 5 }, to: { x: 6, y: 6 } }))).toBe(true);
  });

  it('generates distinct ids', () => {
    expect(new Set([newId(1), newId(2), newId(3)]).size).toBe(3);
  });
});
