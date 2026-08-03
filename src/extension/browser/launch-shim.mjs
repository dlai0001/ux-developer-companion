// Tiny ESM shim so build scripts can reuse the launcher without a TypeScript step.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const MAC = [
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export async function launchBrowser({ userDataDir }) {
  const bin = MAC.find(existsSync);
  if (!bin) throw new Error('no browser found');
  mkdirSync(userDataDir, { recursive: true });
  for (const f of ['DevToolsActivePort', 'SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    rmSync(join(userDataDir, f), { force: true });
  }
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`, '--no-first-run', '--no-default-browser-check'],
    { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const portFile = join(userDataDir, 'DevToolsActivePort');
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    if (existsSync(portFile)) {
      const [port, ws] = readFileSync(portFile, 'utf8').split('\n');
      if (port && ws) return { proc, port: Number(port), kill: () => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill(); } } };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('port discovery timed out');
}
