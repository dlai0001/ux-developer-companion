// KEEPER ARTIFACT — candidate for src/extension/browser/discover.ts + launch.ts
//
// Port discovery uses BOTH mechanisms, whichever wins:
//   (a) accumulated stderr buffer  — PLAN §4.1's stated mechanism. Works, BUT the line is
//       interleaved with heavy noise (cert-parse + CVDisplayLink errors on macOS) and can
//       split across chunk boundaries. Never regex a single chunk.
//   (b) <user-data-dir>/DevToolsActivePort — line 1 = port, line 2 = browser ws path.
//       Written once the listener is up; survives chunking entirely. More robust.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const CANDIDATES = {
  darwin: [
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  // win32/linux candidates live in the product impl; spike only needs darwin.
};

export function discoverBrowser() {
  for (const p of CANDIDATES[process.platform] || []) if (existsSync(p)) return p;
  throw new Error('No Edge/Chrome/Chromium found; set uxCompanion.browserPath');
}

export async function launchBrowser({
  browserPath = discoverBrowser(),
  userDataDir,
  headless = true,
  extraArgs = [],
  timeoutMs = 20000,
} = {}) {
  if (!userDataDir) throw new Error('userDataDir required');
  mkdirSync(userDataDir, { recursive: true });
  rmSync(join(userDataDir, 'DevToolsActivePort'), { force: true });
  // A killed browser leaves these behind; the next launch then aborts with exit code 21
  // ("Failed to create a ProcessSingleton for your profile directory"). Since the profile
  // dir is ours alone (extension globalStorage), reaping stale locks is safe and required
  // for the crash-restart path in PLAN §4.1.
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    rmSync(join(userDataDir, f), { force: true });
  }

  const args = [
    ...(headless ? ['--headless=new'] : []),
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-features=Translate',
    ...extraArgs,
  ];
  const proc = spawn(browserPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderrBuf = '';
  proc.stderr.on('data', (b) => { stderrBuf += b.toString(); });

  const started = Date.now();
  const portFile = join(userDataDir, 'DevToolsActivePort');
  while (Date.now() - started < timeoutMs) {
    if (proc.exitCode !== null) {
      throw new Error(`browser exited early (code ${proc.exitCode})\n${stderrBuf.slice(-2000)}`);
    }
    // (b) port file — preferred
    if (existsSync(portFile)) {
      const [port, wsPath] = readFileSync(portFile, 'utf8').split('\n');
      if (port && wsPath) {
        return { proc, port: +port, wsPath: wsPath.trim(), via: 'DevToolsActivePort',
                 kill: () => { try { proc.kill(); } catch {} } };
      }
    }
    // (a) accumulated stderr — fallback
    const m = /DevTools listening on ws:\/\/([^/]+)(\/devtools\/browser\/\S+)/.exec(stderrBuf);
    if (m) {
      return { proc, port: +m[1].split(':').pop(), wsPath: m[2], via: 'stderr',
               kill: () => { try { proc.kill(); } catch {} } };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`port discovery timed out after ${timeoutMs}ms\nstderr tail:\n${stderrBuf.slice(-2000)}`);
}
