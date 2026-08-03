// Starts every fixture server on its known port and waits until each answers (PLAN §5):
//   5173  React dev            (window.ng / devtools-friendly dev build)
//   5174  React production      (degraded: 'production-build' test target — §4.3)
//   4200  Angular dev
// Exported as a module too, so the integration suite can start/stop servers itself.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const SERVERS = [
  { name: 'react-dev', cwd: 'fixtures/react-app', args: ['run', 'dev'], port: 5173 },
  { name: 'react-prod', cwd: 'fixtures/react-app', args: ['run', 'preview'], port: 5174 },
  { name: 'angular-dev', cwd: 'fixtures/angular-app', args: ['start'], port: 4200 },
];

export async function waitForPort(port, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

export function startFixtures({ only } = {}) {
  const procs = [];
  for (const s of SERVERS) {
    if (only && !only.includes(s.name)) continue;
    const cwd = join(root, s.cwd);
    if (!existsSync(join(cwd, 'package.json'))) {
      console.warn(`[fixtures] ${s.name}: no package.json, skipping`);
      continue;
    }
    // `preview` needs a prior build; do it lazily so `fixtures:serve` works from a clean tree.
    const p = spawn('npm', s.args, { cwd, stdio: 'inherit' });
    procs.push({ ...s, proc: p });
  }
  const stop = () => procs.forEach(({ proc }) => { try { proc.kill(); } catch { /* already gone */ } });
  process.on('exit', stop);
  process.on('SIGINT', () => { stop(); process.exit(0); });
  return { procs, stop };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { startApiServer, API_PORT } = await import('./api-server.mjs');
  await startApiServer();
  console.log(`[fixtures] items API on :${API_PORT}`);
  const { procs } = startFixtures();
  for (const s of procs) {
    const ok = await waitForPort(s.port);
    console.log(`[fixtures] ${s.name} on :${s.port} — ${ok ? 'ready' : 'TIMED OUT'}`);
  }
  console.log('[fixtures] serving; Ctrl-C to stop');
}
