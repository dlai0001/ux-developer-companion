// Component -> source file (PLAN §4.3). Ranking lives in locator-rank.ts (pure, unit-tested).
import * as vscode from 'vscode';
import type { ComponentInfo } from '../shared/agent-api.js';
import { escapeRe, scoreCandidate, type LocateResult, type LocatedFile } from './locator-rank.js';

export type { LocateResult, LocatedFile } from './locator-rank.js';
export { scoreCandidate } from './locator-rank.js';

export class SourceLocator {
  constructor(private readonly maxFiles = 4000) {}

  async locate(component: ComponentInfo): Promise<LocateResult> {
    const framework = component.framework;
    if (!framework || !component.name || component.degraded === 'production-build') {
      // On a production build the name is the host tag — searching for it is worse than useless.
      return { best: null, alternates: [] };
    }

    const glob = framework === 'react' ? '**/*.{tsx,jsx,ts,js}' : '**/*.ts';
    const uris = await vscode.workspace.findFiles(
      glob, '**/{node_modules,dist,out,build,.git}/**', this.maxFiles,
    );

    const needle = framework === 'react'
      ? new RegExp(`\\b(?:function|const|class)\\s+${escapeRe(component.name)}\\b`)
      : new RegExp(`selector:\\s*['"\`][^'"\`]*\\b${escapeRe(component.selectorHint ?? component.name)}\\b`);

    const hits: LocatedFile[] = [];
    for (const uri of uris) {
      let text: string;
      try {
        text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      } catch { continue; }
      if (!needle.test(text)) continue;
      const rel = vscode.workspace.asRelativePath(uri, false);
      const { score, reasons } = scoreCandidate(rel, text, component.name, framework, component.ancestry);
      hits.push({ path: rel, score, reasons });
    }

    hits.sort((a, b) => b.score - a.score);
    return { best: hits[0] ?? null, alternates: hits.slice(1, 3) };
  }
}
