import { describe, expect, it } from 'vitest';
import {
  contrastRatio, flatten, isLargeText, judge, parseColor, relativeLuminance,
} from '../../src/shared/contrast.js';

const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };

describe('colour parsing', () => {
  it('parses hex in 3/4/6/8 digit forms', () => {
    expect(parseColor('#fff')).toEqual(WHITE);
    expect(parseColor('#ffffff')).toEqual(WHITE);
    expect(parseColor('#2f81f7')).toEqual({ r: 47, g: 129, b: 247, a: 1 });
    expect(parseColor('#00000080')?.a).toBeCloseTo(0.502, 2);
  });

  it('parses rgb/rgba in comma and space syntax', () => {
    expect(parseColor('rgb(47, 129, 247)')).toEqual({ r: 47, g: 129, b: 247, a: 1 });
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor('rgb(47 129 247 / 0.5)')).toEqual({ r: 47, g: 129, b: 247, a: 0.5 });
  });

  it('treats transparent as fully transparent black and rejects what it cannot map', () => {
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor('linear-gradient(red, blue)')).toBeNull();
  });
});

describe('WCAG contrast', () => {
  it('gives the known 21:1 for black on white', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 1);
  });

  it('gives 1:1 for identical colours', () => {
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
  });

  it('matches the reference luminance values', () => {
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5);
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 5);
  });

  it('flattens translucent foregrounds over their backdrop', () => {
    expect(flatten({ r: 0, g: 0, b: 0, a: 0.5 }, WHITE)).toEqual({ r: 128, g: 128, b: 128, a: 1 });
  });

  it('applies the large-text thresholds', () => {
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(19, 700)).toBe(true);   // bold >= 18.66px
    expect(isLargeText(19, 400)).toBe(false);
    expect(isLargeText(16, 700)).toBe(false);
  });

  it('judges AA/AAA against the right thresholds', () => {
    expect(judge(4.6, false)).toMatchObject({ aa: true, aaa: false });
    expect(judge(7.1, false)).toMatchObject({ aa: true, aaa: true });
    expect(judge(3.2, true)).toMatchObject({ aa: true, aaa: false });   // large text: 3:1
    expect(judge(3.2, false)).toMatchObject({ aa: false, aaa: false });
  });

  it('fails the fixture low-contrast pair', () => {
    // #b9c6d4 on #ffffff — the intentional violation in fixtures/styles.css.
    const ratio = contrastRatio(parseColor('#b9c6d4')!, WHITE);
    expect(ratio).toBeLessThan(4.5);
  });
});
