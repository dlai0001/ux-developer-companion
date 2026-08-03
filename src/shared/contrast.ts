// WCAG 2.1 contrast (PLAN §4.6). Pure maths, unit-tested without a browser.

export interface Rgb { r: number; g: number; b: number; a: number }

/** Parses rgb()/rgba()/#hex. Returns null for anything else (gradients, keywords we can't map). */
export function parseColor(input: string): Rgb | null {
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex?.[1]) {
    const h = hex[1];
    const exp = (c: string): number => parseInt(c.length === 1 ? c + c : c, 16);
    if (h.length === 3 || h.length === 4) {
      return { r: exp(h[0]!), g: exp(h[1]!), b: exp(h[2]!), a: h.length === 4 ? exp(h[3]!) / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: exp(h.slice(0, 2)), g: exp(h.slice(2, 4)), b: exp(h.slice(4, 6)),
        a: h.length === 8 ? exp(h.slice(6, 8)) / 255 : 1,
      };
    }
    return null;
  }

  const m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (!m?.[1]) return null;
  const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 };
}

/** Composite a possibly-translucent foreground over an opaque backdrop. */
export function flatten(fg: Rgb, bg: Rgb): Rgb {
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  const chan = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface ContrastVerdict {
  ratio: number;
  large: boolean;
  aa: boolean;
  aaa: boolean;
}

/** Large text = >=24px, or >=18.66px when bold (WCAG 2.1). */
export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= 24 || (fontWeight >= 700 && fontSizePx >= 18.66);
}

export function judge(ratio: number, large: boolean): ContrastVerdict {
  return {
    ratio: Math.round(ratio * 100) / 100,
    large,
    aa: ratio >= (large ? 3 : 4.5),
    aaa: ratio >= (large ? 4.5 : 7),
  };
}
