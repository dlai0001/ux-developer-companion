// S5 — can CDP tell us the effective color came from var(--token), and where that token
// is defined? Answers PLAN §4.6's eyedropper "token resolution" claim.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import CDP from 'chrome-remote-interface';
import { launchBrowser } from './lib/launch.mjs';

const S = new URL('./', import.meta.url).pathname;
const OUT = S + '_out/';
mkdirSync(OUT, { recursive: true });
const PORT = 5399;

const srv = createServer((_, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(readFileSync(S + 'fixtures/tokens.html'));
});
await new Promise((r) => srv.listen(PORT, r));

const b = await launchBrowser({ userDataDir: `${OUT}s5-profile` });
const client = await CDP({ port: b.port });
const { Page, DOM, CSS, Runtime } = client;
await Promise.all([Page.enable(), DOM.enable(), CSS.enable(), Runtime.enable()]);
await Page.navigate({ url: `http://127.0.0.1:${PORT}/` });
await Page.loadEventFired();
await new Promise((r) => setTimeout(r, 300));

const doc = await DOM.getDocument({ depth: -1, pierce: true });

// Walk matched rules in CDP order (least->most specific) and find the winning declaration
// for `prop`, capturing whether its raw text uses var().
function winningDecl(matched, prop) {
  let win = null;
  for (const { rule } of matched) {
    for (const d of rule.style?.cssProperties || []) {
      if (d.name !== prop || d.text == null) continue;
      win = { value: d.text.split(':').slice(1).join(':').trim(), selector: rule.selectorList?.text,
              origin: rule.origin, styleSheetId: rule.styleSheetId };
    }
  }
  return win;
}

const nodeLabel = (node) => {
  const i = node.attributes?.indexOf('id') ?? -1;
  const cls = node.attributes?.indexOf('class') ?? -1;
  return node.localName
    + (i >= 0 ? '#' + node.attributes[i + 1] : '')
    + (i < 0 && cls >= 0 ? '.' + node.attributes[cls + 1].split(' ')[0] : '');
};

// Resolve --token by walking element -> ancestors, taking the NEAREST definition.
// Custom properties inherit, so each level must be searched using only that node's OWN
// matched rules; including `inherited` rules here makes every element look like it was
// defined at :root and silently loses parent overrides (case c).
// `ms.inherited` is the ancestor chain, NEAREST FIRST, each with that ancestor's own
// matched rules — so one getMatchedStylesForNode call gives the whole cascade. (Walking
// via DOM.describeNode().parentId does not work: parentId is not populated there.)
async function resolveCustomProp(ms, name, depth = 0) {
  const levels = [
    { rules: ms.matchedCSSRules || [], where: 'element' },
    ...(ms.inherited || []).map((i, n) => ({ rules: i.matchedCSSRules || [], where: `ancestor+${n + 1}` })),
  ];
  for (const lvl of levels) {
    const d = winningDecl(lvl.rules, name);
    if (!d) continue;
    const value = d.value.replace(/;$/, '');
    const link = { token: name, definedBy: d.selector, at: lvl.where, value };
    const nested = depth < 10 && /var\(\s*(--[\w-]+)/.exec(value)?.[1];
    if (nested) {
      const inner = await resolveCustomProp(ms, nested, depth + 1);
      return { chain: [link, ...inner.chain], final: inner.final };
    }
    return { chain: [link], final: value };
  }
  return { chain: [], final: null };
}

async function probe(selector, prop, { pierce = false } = {}) {
  const rec = { selector, prop };
  try {
    let nodeId;
    if (pierce) {
      const { result } = await Runtime.evaluate({
        expression: `document.getElementById('host').shadowRoot.getElementById('s')`,
      });
      ({ nodeId } = await DOM.requestNode({ objectId: result.objectId }));
    } else {
      ({ nodeId } = await DOM.querySelector({ nodeId: doc.root.nodeId, selector }));
    }
    if (!nodeId) return { ...rec, error: 'node not found' };

    const computed = await CSS.getComputedStyleForNode({ nodeId });
    rec.computed = computed.computedStyle.find((p) => p.name === prop)?.value;

    const ms = await CSS.getMatchedStylesForNode({ nodeId });
    const own = winningDecl(ms.matchedCSSRules || [], prop);
    // Inheritance: if no own declaration, look at inherited chains (case e).
    const inheritedDecl = !own
      ? (ms.inherited || []).map((i) => winningDecl(i.matchedCSSRules || [], prop)).filter(Boolean).pop()
      : null;
    const decl = own || inheritedDecl;
    rec.rawValue = decl?.value ?? null;
    rec.fromSelector = decl?.selector ?? null;
    rec.inherited = !own && !!inheritedDecl;

    // Shorthand gap: `background: var(--x)` yields an EXPANDED `background-color` longhand
    // whose text has already lost the var(). Fall back to the shorthand's own declaration.
    let varName = decl ? /var\(\s*(--[\w-]+)/.exec(decl.value)?.[1] : null;
    if (!varName) {
      const shorthand = { 'background-color': 'background', 'border-color': 'border',
                          'font-size': 'font', 'color': 'color' }[prop];
      if (shorthand && shorthand !== prop) {
        const sd = winningDecl(ms.matchedCSSRules || [], shorthand);
        const m = sd && /var\(\s*(--[\w-]+)/.exec(sd.value);
        if (m) { varName = m[1]; rec.viaShorthand = shorthand; rec.rawValue = sd.value; }
      }
    }
    rec.usesVar = !!varName;
    rec.token = varName || null;
    if (varName) {
      const r = await resolveCustomProp(ms, varName);
      rec.tokenChain = r.chain;
      rec.tokenFinal = r.final;
    }
  } catch (e) { rec.error = String(e.message || e); }
  return rec;
}

const cases = [
  await probe('#a', 'background-color'),
  await probe('#b', 'background-color'),
  await probe('#c', 'background-color'),
  await probe('#d', 'background-color'),
  await probe('#e', 'color'),                       // inherited
  await probe('#f', 'background-color'),            // set via `background` shorthand
  await probe('#s', 'background-color', { pierce: true }), // shadow DOM
];

for (const c of cases) {
  console.log(`${c.selector.padEnd(6)} computed=${String(c.computed).padEnd(20)} usesVar=${String(c.usesVar).padEnd(5)} token=${String(c.token).padEnd(16)} chain=${JSON.stringify(c.tokenChain || null)}${c.inherited ? ' [inherited]' : ''}${c.error ? ' ERR=' + c.error : ''}`);
}
writeFileSync(OUT + 's5-results.json', JSON.stringify(cases, null, 2));
await client.close(); b.kill(); srv.close();
