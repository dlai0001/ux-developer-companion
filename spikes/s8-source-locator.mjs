// S8 — how accurate is PLAN §4.3's "find the component's source file by text search"?
//
// Ground truth is built by a DIFFERENT method than the locator under test:
//   truth   = parse files for an actual definition site (export function X / @Component selector)
//   locator = the naive cross-repo text search §4.3 specifies, then ranked
// Scoring only counts components whose truth is unambiguous (defined in exactly one file),
// otherwise "correct" is undefined.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, relative, sep } from 'node:path';

const ROOT = '/Users/dlai/projects/ui-code-vscode-ext';
const OUT = ROOT + '/spikes/_out/';
mkdirSync(OUT, { recursive: true });
const SAMPLE = 20;

const listFiles = (repo, exts) =>
  execFileSync('git', ['-C', repo, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n').filter((f) => exts.some((e) => f.endsWith(e)));

// Deterministic sample so reruns are comparable (no Math.random — also unavailable in workflows).
const pick = (arr, n) => {
  const step = Math.max(1, Math.floor(arr.length / n));
  return arr.filter((_, i) => i % step === 0).slice(0, n);
};

const isNoise = (p) => /(\.spec\.|\.test\.|__tests__|\/tests?\/|\.stories\.|\/e2e\/|\/demo\/|\/dev-app\/|\.mock|\/fixtures?\/|\/examples?\/)/.test(p);

// ---------------------------------------------------------------- React
function reactTruth(repo) {
  const files = listFiles(repo, ['.tsx']).filter((f) => !isNoise(f));
  const defs = new Map(); // name -> Set(files)
  for (const f of files) {
    let src;
    try { src = readFileSync(`${repo}/${f}`, 'utf8'); } catch { continue; }
    const pats = [
      /export\s+default\s+function\s+([A-Z]\w+)/g,
      /export\s+function\s+([A-Z]\w+)/g,
      /export\s+const\s+([A-Z]\w+)\s*[:=]/g,
      /export\s+class\s+([A-Z]\w+)\s+extends\s+(?:React\.)?(?:Pure)?Component/g,
    ];
    for (const p of pats) for (const m of src.matchAll(p)) {
      if (!defs.has(m[1])) defs.set(m[1], new Set());
      defs.get(m[1]).add(f);
    }
  }
  return defs;
}

// The locator exactly as PLAN §4.3 describes it for React.
function reactLocate(corpus, name) {
  const re = new RegExp(`\\b(?:function|const|class)\\s+${name}\\b`);
  const hits = [];
  for (const [f, src] of corpus) {
    if (!re.test(src)) continue;
    hits.push({ file: f, src });
  }
  return hits;
}

// ---------------------------------------------------------------- Angular
function angularTruth(repo) {
  const files = listFiles(repo, ['.ts']).filter((f) => !isNoise(f));
  const defs = new Map(); // selector -> Set(files)
  for (const f of files) {
    let src;
    try { src = readFileSync(`${repo}/${f}`, 'utf8'); } catch { continue; }
    // Only count selectors inside an actual @Component/@Directive decorator.
    for (const m of src.matchAll(/@(?:Component|Directive)\s*\(\s*\{[\s\S]{0,600}?selector:\s*['"`]([^'"`]+)['"`]/g)) {
      // Selectors are often compound lists, e.g. 'cdk-table, table[cdk-table]'. Skipping those
      // wholesale dropped the CANONICAL definition and left a spurious one behind, which made
      // the locator look wrong when it was right. Split and keep pure element selectors.
      for (const part of m[1].split(',')) {
        const sel = part.trim();
        if (!/^[a-z][\w-]*$/.test(sel)) continue;   // element selectors only
        if (!defs.has(sel)) defs.set(sel, new Set());
        defs.get(sel).add(f);
      }
    }
  }
  return defs;
}

function angularLocate(corpus, selector) {
  const re = new RegExp(`selector:\\s*['"\`][^'"\`]*\\b${selector.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`);
  const hits = [];
  for (const [f, src] of corpus) {
    if (!re.test(src)) continue;
    hits.push({ file: f, src });
  }
  return hits;
}

// ---------------------------------------------------------------- rankers
const pascalToKebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

function score(hit, name, framework) {
  const f = hit.file, base = basename(f).replace(/\.[jt]sx?$/, '');
  let s = 0;
  const detail = [];
  // R1 export-presence / definition-shaped
  if (framework === 'react') {
    if (new RegExp(`export\\s+(default\\s+)?(function|const|class)\\s+${name}\\b`).test(hit.src)) { s += 40; detail.push('exported-def'); }
    else if (new RegExp(`\\b(function|const|class)\\s+${name}\\b`).test(hit.src)) { s += 10; detail.push('local-def'); }
    // definition-vs-usage: an import of the same name means this is a CONSUMER
    if (new RegExp(`import[^;]*\\b${name}\\b[^;]*from`).test(hit.src)) { s -= 25; detail.push('imports-it'); }
  } else {
    if (/@(Component|Directive)\s*\(/.test(hit.src)) { s += 40; detail.push('has-decorator'); }
  }
  // R2 filename ≈ component name
  const want = framework === 'react' ? name.toLowerCase() : name.replace(/^[a-z]+-/, '');
  if (base.toLowerCase() === want) { s += 30; detail.push('filename-exact'); }
  else if (base.toLowerCase() === pascalToKebab(name)) { s += 30; detail.push('filename-kebab'); }
  else if (base.toLowerCase().includes(want) || want.includes(base.toLowerCase())) { s += 12; detail.push('filename-partial'); }
  else if (basename(dirname(f)).toLowerCase() === want) { s += 18; detail.push('dirname-match'); }
  // R3 penalise non-source paths
  if (isNoise(f)) { s -= 35; detail.push('noise-path'); }
  if (/\.d\.ts$/.test(f)) { s -= 40; detail.push('dts'); }
  // R4 mild preference for shallower, src-ish paths
  if (/(^|\/)src\//.test(f)) { s += 5; detail.push('src'); }
  s -= f.split('/').length * 0.5;
  return { score: s, detail };
}

// ---------------------------------------------------------------- run
function runCase(label, repo, framework) {
  const truth = framework === 'react' ? reactTruth(repo) : angularTruth(repo);
  const unique = [...truth.entries()].filter(([, set]) => set.size === 1)
    .map(([name, set]) => ({ name, file: [...set][0] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Load the search corpus ONCE (the naive locator would otherwise re-read every file per name).
  const exts = framework === 'react' ? ['.tsx', '.ts', '.jsx', '.js'] : ['.ts'];
  const corpus = [];
  for (const f of listFiles(repo, exts)) {
    try { corpus.push([f, readFileSync(`${repo}/${f}`, 'utf8')]); } catch {}
  }
  const locate = framework === 'react' ? reactLocate : angularLocate;

  // Count candidates for EVERY component first, then stratify. Sampling alphabetically made
  // the task trivially easy (median 1 candidate) — it excluded exactly the ambiguity the
  // ranker exists to resolve. Half the sample is now the hardest cases in the repo.
  const withCounts = unique.map((u) => ({ ...u, candidates: locate(corpus, u.name).length }));
  const contested = withCounts.filter((u) => u.candidates > 1).sort((a, b) => b.candidates - a.candidates);
  const easy = withCounts.filter((u) => u.candidates <= 1);
  const sample = [...contested.slice(0, SAMPLE / 2), ...pick(easy, SAMPLE / 2)];

  const rows = [];
  for (const { name, file } of sample) {
    const hits = locate(corpus, name);
    // Baseline = PLAN as written: first match in repo file order, no ranking.
    const baseline = hits[0]?.file ?? null;
    const ranked = hits.map((h) => ({ ...h, ...score(h, name, framework) }))
      .sort((a, b) => b.score - a.score);
    rows.push({
      name, truth: file, candidates: hits.length,
      baselineTop1: baseline === file,
      rankedTop1: ranked[0]?.file === file,
      rankedTop3: ranked.slice(0, 3).some((r) => r.file === file),
      got: ranked[0]?.file ?? null,
      gotWhy: ranked[0]?.detail?.join(',') ?? null,
    });
  }
  const n = rows.length;
  const hard = rows.filter((r) => r.candidates > 1);
  const pctIn = (set, k) => set.length ? Math.round(set.filter((r) => r[k]).length / set.length * 100) : null;
  const summary = {
    label, framework, repo: basename(repo), sampled: n,
    uniqueComponentsAvailable: unique.length,
    contestedInRepo: contested.length,
    contestedShareOfRepoPct: Math.round(contested.length / withCounts.length * 100),
    medianCandidates: n ? [...rows.map((r) => r.candidates)].sort((a, b) => a - b)[Math.floor(n / 2)] : 0,
    maxCandidates: n ? Math.max(...rows.map((r) => r.candidates)) : 0,
    overall: { baselineTop1Pct: pctIn(rows, 'baselineTop1'), rankedTop1Pct: pctIn(rows, 'rankedTop1'), rankedTop3Pct: pctIn(rows, 'rankedTop3') },
    contestedOnly: { n: hard.length, baselineTop1Pct: pctIn(hard, 'baselineTop1'), rankedTop1Pct: pctIn(hard, 'rankedTop1'), rankedTop3Pct: pctIn(hard, 'rankedTop3') },
  };
  return { summary, rows };
}

const results = [
  runCase('React monorepo (excalidraw)', `${ROOT}/_repos/excalidraw`, 'react'),
  runCase('Angular (angular/components)', `${ROOT}/_repos/ng-components`, 'angular'),
];

for (const r of results) {
  console.log('\n===', r.summary.label);
  console.log(JSON.stringify(r.summary, null, 1));
  console.log('misses (ranked top-1 wrong):');
  for (const row of r.rows.filter((x) => !x.rankedTop1)) {
    console.log(`  ${row.name}  cands=${row.candidates}\n     truth: ${row.truth}\n     got:   ${row.got}  [${row.gotWhy}]`);
  }
}
writeFileSync(OUT + 's8-results.json', JSON.stringify(results, null, 2));
console.log('\nwrote', OUT + 's8-results.json');
