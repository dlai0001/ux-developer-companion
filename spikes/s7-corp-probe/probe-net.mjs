// S7 probe (c)+(d): can the corporate network reach the registries/CDNs the build needs,
// through whatever proxy is configured? No npm install performed — reachability only,
// plus an optional real `npm install --dry-run` of the actual dependency set.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const exec = promisify(execFile);

const ENDPOINTS = [
  ['npm registry', 'https://registry.npmjs.org/-/ping'],
  ['npm tarball CDN', 'https://registry.npmjs.org/esbuild'],
  ['VSCode download (test-electron)', 'https://update.code.visualstudio.com/api/releases/stable'],
  ['VSCode Marketplace', 'https://marketplace.visualstudio.com/_apis/public/gallery'],
  ['GitHub releases', 'https://api.github.com/repos/microsoft/vscode/releases/latest'],
];

console.log('--- proxy env ---');
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS']) {
  if (process.env[k]) console.log(`${k}=${process.env[k]}`);
}
try {
  const { stdout } = await exec('npm', ['config', 'get', 'proxy', 'https-proxy', 'registry', 'strict-ssl', 'cafile']);
  console.log('npm config:', stdout.trim());
} catch (e) { console.log('npm config ERROR:', e.message); }

console.log('\n--- direct HTTPS reachability ---');
for (const [label, url] of ENDPOINTS) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    console.log(`OK   ${label.padEnd(34)} ${res.status} (${Date.now() - t0}ms)`);
  } catch (e) {
    console.log(`FAIL ${label.padEnd(34)} ${String(e.cause?.code || e.name || e.message).slice(0, 80)} (${Date.now() - t0}ms)`);
  }
}

// The real dependency set the build plan implies.
const DEPS = {
  dependencies: { 'chrome-remote-interface': '^0.34.0', 'react-devtools-core': '^6.1.5',
                  react: '^18.3.1', 'react-dom': '^18.3.1', zustand: '^5.0.0', 'axe-core': '^4.10.0' },
  devDependencies: { esbuild: '^0.28.0', typescript: '^5.6.0', vitest: '^2.1.0',
                     '@vscode/test-electron': '^2.4.1', '@vscode/vsce': '^3.2.0', '@types/vscode': '^1.125.0' },
};

console.log('\n--- npm install --dry-run of the real dependency set ---');
const dir = mkdtempSync(join(tmpdir(), 'ux-net-'));
writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'probe', version: '1.0.0', private: true, ...DEPS }, null, 2));
try {
  const { stdout, stderr } = await exec('npm', ['install', '--dry-run', '--no-audit', '--no-fund'],
    { cwd: dir, maxBuffer: 8 * 1024 * 1024 });
  console.log((stdout || stderr).trim().split('\n').slice(-15).join('\n'));
  console.log('RESULT: dry-run SUCCEEDED');
} catch (e) {
  console.log('RESULT: dry-run FAILED');
  console.log(String(e.stderr || e.message).split('\n').slice(0, 25).join('\n'));
}
console.log('\n===== COPY EVERYTHING ABOVE INTO FINDINGS.md =====');
