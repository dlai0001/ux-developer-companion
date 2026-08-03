// Downloads/reuses a VS Code build and runs the extension-host suite inside it.
// NOTE: this needs update.code.visualstudio.com — spike S7 flags it as possibly unreachable on
// the corporate network, in which case `test:ext` is personal-machine-only.
import { runTests } from '@vscode/test-electron';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = resolve(here, '../..');
const extensionTestsPath = resolve(here, './suite/index.cjs');

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    // Empty workspace + no other extensions: keeps the run hermetic and fast.
    launchArgs: ['--disable-extensions', '--disable-gpu'],
  });
  console.log('[test:ext] passed');
} catch (err) {
  console.error('[test:ext] FAILED', err);
  process.exit(1);
}
