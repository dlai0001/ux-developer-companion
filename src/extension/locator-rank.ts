// Pure ranking logic for the source locator — deliberately free of any `vscode` import so it
// can be unit-tested directly. Search ALONE is not good enough: measured on real repos,
// first-match-wins was 73% top-1 (React) / 55% (Angular), and only 10-20% on contested names.
// This ranking lifted that to 87% / 95%. See spikes/FINDINGS.md S8.
import { basename, dirname } from 'node:path';

export interface LocatedFile {
  /** Workspace-relative path. */
  path: string;
  score: number;
  reasons: string[];
}

export interface LocateResult {
  best: LocatedFile | null;
  alternates: LocatedFile[];
}

export function escapeRe(s: string): string {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

const NOISE = /(\.spec\.|\.test\.|__tests__|\/tests?\/|\.stories\.|\/e2e\/|\/demo\/|\/dev-app\/|\.mock|\/fixtures?\/|\/examples?\/)/i;

const pascalToKebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Exported for unit tests — pure, no vscode dependency. */
export function scoreCandidate(
  relPath: string, text: string, name: string, framework: 'react' | 'angular', ancestry: string[] = [],
): { score: number; reasons: string[] } {
  const base = basename(relPath).replace(/\.[jt]sx?$/, '');
  const reasons: string[] = [];
  let score = 0;

  if (framework === 'react') {
    if (new RegExp(`export\\s+(default\\s+)?(function|const|class)\\s+${name}\\b`).test(text)) {
      score += 40; reasons.push('exported-def');
    } else if (new RegExp(`\\b(function|const|class)\\s+${name}\\b`).test(text)) {
      score += 10; reasons.push('local-def');
    }
    // A file that imports the same name is a CONSUMER, not the definition.
    if (new RegExp(`import[^;]*\\b${name}\\b[^;]*from`).test(text)) {
      score -= 25; reasons.push('imports-it');
    }
  } else if (/@(Component|Directive)\s*\(/.test(text)) {
    score += 40; reasons.push('has-decorator');
  }

  const want = framework === 'react' ? name.toLowerCase() : name.replace(/^[a-z]+-/, '');
  const baseLower = base.toLowerCase();
  if (baseLower === want) { score += 30; reasons.push('filename-exact'); }
  else if (baseLower === pascalToKebab(name)) { score += 30; reasons.push('filename-kebab'); }
  else if (baseLower.replace(/\.component$/, '') === want) { score += 30; reasons.push('filename-exact'); }
  else if (basename(dirname(relPath)).toLowerCase() === want) { score += 18; reasons.push('dirname-match'); }
  else if (baseLower.includes(want) || want.includes(baseLower)) { score += 12; reasons.push('filename-partial'); }

  // Ancestry: prefer files whose directory matches an owning component (React ownersList).
  const dirLower = dirname(relPath).toLowerCase();
  if (ancestry.some((a) => a && a !== name && dirLower.includes(a.toLowerCase()))) {
    score += 10; reasons.push('ancestry');
  }

  if (NOISE.test(relPath)) { score -= 35; reasons.push('noise-path'); }
  if (relPath.endsWith('.d.ts')) { score -= 40; reasons.push('dts'); }
  if (/(^|\/)src\//.test(relPath)) { score += 5; reasons.push('src'); }
  score -= relPath.split('/').length * 0.5;

  return { score, reasons };
}

