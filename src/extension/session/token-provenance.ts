// CSS custom-property provenance for the eyedropper (PLAN §4.6). Ported from the verified
// spike S5 resolver — all seven cases pass there, including parent overrides, var-of-var,
// shorthand expansion and shadow DOM.
import type Protocol from 'devtools-protocol';
import type { CdpSession } from '../browser/cdp.js';

export interface TokenLink {
  token: string;
  /** Selector of the rule that defined it, e.g. ':root' or '.parent'. */
  definedBy: string;
  /** 'element' or 'ancestor+N' — how far up the cascade it was found. */
  at: string;
  value: string;
}

export interface Provenance {
  property: string;
  computed: string | null;
  /** Raw declaration text, e.g. 'var(--color-primary)'. */
  rawValue: string | null;
  fromSelector: string | null;
  inherited: boolean;
  /** Set when the value arrived through a shorthand such as `background`. */
  viaShorthand?: string;
  token: string | null;
  chain: TokenLink[];
  /** Terminal value of the var() chain. */
  final: string | null;
}

type MatchedRules = Protocol.CSS.RuleMatch[] | undefined;

/** Longhands that can also be set by a shorthand which hides the var(). */
const SHORTHAND_OF: Record<string, string> = {
  'background-color': 'background',
  'border-color': 'border',
  'font-size': 'font',
};

/**
 * Walk matched rules in CDP order (least -> most specific) and take the LAST declaration for
 * `prop` — that is the winner.
 */
function winningDecl(matched: MatchedRules, prop: string):
  { value: string; selector: string } | null {
  let win: { value: string; selector: string } | null = null;
  for (const { rule } of matched ?? []) {
    for (const d of rule.style?.cssProperties ?? []) {
      if (d.name !== prop || d.text == null) continue;
      win = {
        value: d.text.split(':').slice(1).join(':').trim().replace(/;$/, ''),
        selector: rule.selectorList?.text ?? '',
      };
    }
  }
  return win;
}

/**
 * Resolve a custom property to where it was DEFINED.
 *
 * Two mechanics that are easy to get wrong (both were bugs in the spike):
 *  1. Use the response's `inherited` array as the ancestor chain — it is ordered
 *     nearest-first and each entry carries that ancestor's OWN matched rules. Searching
 *     element-own and inherited rules together at each level makes every token look like it
 *     was defined at :root and silently loses parent overrides.
 *  2. `DOM.describeNode().parentId` is not populated, so walking the DOM manually does not work.
 */
function resolveCustomProp(
  styles: Protocol.CSS.GetMatchedStylesForNodeResponse, name: string, depth = 0,
): { chain: TokenLink[]; final: string | null } {
  const levels: Array<{ rules: MatchedRules; where: string }> = [
    { rules: styles.matchedCSSRules, where: 'element' },
    ...(styles.inherited ?? []).map((i, n) => ({ rules: i.matchedCSSRules, where: `ancestor+${n + 1}` })),
  ];

  for (const lvl of levels) {
    const d = winningDecl(lvl.rules, name);
    if (!d) continue;
    const link: TokenLink = { token: name, definedBy: d.selector, at: lvl.where, value: d.value };
    const nested = depth < 10 ? /var\(\s*(--[\w-]+)/.exec(d.value)?.[1] : undefined;
    if (nested) {
      const inner = resolveCustomProp(styles, nested, depth + 1);
      return { chain: [link, ...inner.chain], final: inner.final };
    }
    return { chain: [link], final: d.value };
  }
  return { chain: [], final: null };
}

export async function provenanceAt(
  cdp: CdpSession, x: number, y: number, property = 'background-color',
): Promise<Provenance | null> {
  const nodeId = await cdp.nodeAt(x, y);
  if (!nodeId) return null;

  const computed = await cdp.computedStyle(nodeId);
  const styles = await cdp.matchedStyles(nodeId);

  const own = winningDecl(styles.matchedCSSRules, property);
  const inheritedDecl = !own
    ? (styles.inherited ?? []).map((i) => winningDecl(i.matchedCSSRules, property)).filter(Boolean).pop() ?? null
    : null;
  const decl = own ?? inheritedDecl;

  const out: Provenance = {
    property,
    computed: computed.find((p) => p.name === property)?.value ?? null,
    rawValue: decl?.value ?? null,
    fromSelector: decl?.selector ?? null,
    inherited: !own && !!inheritedDecl,
    token: null,
    chain: [],
    final: null,
  };

  let varName = decl ? /var\(\s*(--[\w-]+)/.exec(decl.value)?.[1] ?? null : null;

  // Shorthand gap: `background: var(--x)` is exposed as an EXPANDED background-color longhand
  // whose text no longer contains var(). Fall back to the shorthand's own declaration.
  if (!varName) {
    const shorthand = SHORTHAND_OF[property];
    if (shorthand) {
      const sd = winningDecl(styles.matchedCSSRules, shorthand);
      const m = sd ? /var\(\s*(--[\w-]+)/.exec(sd.value) : null;
      if (m?.[1] && sd) {
        varName = m[1];
        out.viaShorthand = shorthand;
        out.rawValue = sd.value;
        out.fromSelector = sd.selector;
      }
    }
  }

  out.token = varName;
  if (varName) {
    const r = resolveCustomProp(styles, varName);
    out.chain = r.chain;
    out.final = r.final;
  }
  return out;
}
