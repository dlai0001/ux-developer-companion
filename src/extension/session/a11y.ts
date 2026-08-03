// axe scan + contrast probing (PLAN §4.6).
//
// axe-core is BUNDLED and injected on demand — never fetched at runtime, which is a hard
// requirement for corporate installs (PLAN §1: no runtime downloads).
import { readFileSync } from 'node:fs';
import type { CdpSession } from '../browser/cdp.js';
import {
  contrastRatio, flatten, isLargeText, judge, parseColor, type ContrastVerdict,
} from '../../shared/contrast.js';

export interface Violation {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: string[]; html: string }>;
}

let axeSource: string | null = null;

function loadAxe(axePath: string): string {
  axeSource ??= readFileSync(axePath, 'utf8');
  return axeSource;
}

export async function runAxe(cdp: CdpSession, axePath: string): Promise<Violation[]> {
  // Idempotent: re-injecting axe into the same document is harmless but wasteful.
  const present = await cdp.evaluate<boolean>('typeof window.axe !== "undefined"').catch(() => false);
  if (!present) await cdp.evaluate<void>(loadAxe(axePath));

  return cdp.evaluate<Violation[]>(`
    window.axe.run(document, { resultTypes: ['violations'] }).then((r) =>
      r.violations.map((v) => ({
        id: v.id,
        impact: v.impact ?? null,
        help: v.help,
        nodes: v.nodes.slice(0, 10).map((n) => ({ target: n.target, html: n.html.slice(0, 200) })),
      })))`);
}

export interface ContrastResult extends ContrastVerdict {
  foreground: string;
  background: string;
  fontSizePx: number;
  fontWeight: number;
}

/**
 * Contrast for the text element at a point. The effective background is found by walking
 * ancestors until an opaque colour is found — a transparent background means "whatever is
 * behind me", so stopping at the element itself would report white on white.
 */
export async function contrastAt(cdp: CdpSession, x: number, y: number): Promise<ContrastResult | null> {
  const probe = await cdp.evaluate<{
    color: string; bg: string; fontSize: string; fontWeight: string;
  } | null>(`
    (() => {
      const el = document.elementFromPoint(${x}, ${y});
      if (!el) return null;
      const cs = getComputedStyle(el);
      let bg = 'rgba(0, 0, 0, 0)';
      for (let n = el; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        const m = /rgba?\\(([^)]+)\\)/.exec(c);
        const alpha = m ? Number(m[1].split(/[ ,/]+/).filter(Boolean)[3] ?? '1') : 1;
        if (c && c !== 'transparent' && alpha > 0) { bg = c; break; }
      }
      return { color: cs.color, bg, fontSize: cs.fontSize, fontWeight: cs.fontWeight };
    })()`);

  if (!probe) return null;
  const fg = parseColor(probe.color);
  const bgRaw = parseColor(probe.bg);
  if (!fg || !bgRaw) return null;

  // Assume white behind an unresolved backdrop rather than failing outright.
  const bg = bgRaw.a < 1 ? flatten(bgRaw, { r: 255, g: 255, b: 255, a: 1 }) : bgRaw;
  const fgFlat = fg.a < 1 ? flatten(fg, bg) : fg;

  const fontSizePx = parseFloat(probe.fontSize) || 16;
  const fontWeight = Number(probe.fontWeight) || 400;
  const verdict = judge(contrastRatio(fgFlat, bg), isLargeText(fontSizePx, fontWeight));

  return { ...verdict, foreground: probe.color, background: probe.bg, fontSizePx, fontWeight };
}
