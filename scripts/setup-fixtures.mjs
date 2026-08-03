// Installs dependencies for every fixture app. Fixtures carry their own package.json
// (PLAN §3 — single package, but fixtures are independent).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = ['react-app', 'angular-app'];

for (const f of fixtures) {
  const dir = join(root, 'fixtures', f);
  if (!existsSync(join(dir, 'package.json'))) {
    console.log(`[fixtures] skip ${f} (no package.json)`);
    continue;
  }
  console.log(`[fixtures] installing ${f}…`);
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' });
}
console.log('[fixtures] done');
