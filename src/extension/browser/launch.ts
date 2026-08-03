// Browser discovery + launch (PLAN §4.1). Every correction here was learned in spike S1/S3/S4;
// see spikes/FINDINGS.md before "simplifying" any of it.
import { spawn, type ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const exec = promisify(execFile);

export interface LaunchedBrowser {
  proc: ChildProcess;
  port: number;
  wsPath: string;
  /** Which discovery mechanism won — useful in bug reports. */
  via: 'DevToolsActivePort' | 'stderr';
  kill(): void;
}

const MAC = [
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];
const WIN = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const LINUX_BINS = ['microsoft-edge', 'google-chrome', 'chromium', 'chromium-browser'];

/** Windows registry lookup, ahead of hardcoded paths (PLAN §4.1). */
async function registryPaths(): Promise<string[]> {
  const found: string[] = [];
  for (const exe of ['msedge.exe', 'chrome.exe']) {
    for (const hive of ['HKLM', 'HKCU']) {
      try {
        const { stdout } = await exec('reg', [
          'query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`, '/ve',
        ]);
        const m = /REG_SZ\s+(.+)/.exec(stdout);
        if (m?.[1]) found.push(m[1].trim());
      } catch { /* key absent or blocked by policy — fall through to path probing */ }
    }
  }
  return found;
}

export async function discoverBrowser(configured?: string): Promise<string> {
  if (configured && existsSync(configured)) return configured;
  if (process.platform === 'win32') {
    for (const p of [...(await registryPaths()), ...WIN]) if (existsSync(p)) return p;
  } else if (process.platform === 'darwin') {
    for (const p of MAC) if (existsSync(p)) return p;
  } else {
    for (const b of LINUX_BINS) {
      try { const { stdout } = await exec('which', [b]); if (stdout.trim()) return stdout.trim(); } catch { /* not installed */ }
    }
  }
  throw new Error(
    'No Edge, Chrome or Chromium found. Set "uxCompanion.browserPath" to the browser executable.',
  );
}

export interface LaunchOptions {
  browserPath?: string;
  /** Must be unique per session — a stale profile owned by an orphan makes launch hang. */
  userDataDir: string;
  headless?: boolean;
  extraArgs?: string[];
  timeoutMs?: number;
}

export async function launchBrowser(opts: LaunchOptions): Promise<LaunchedBrowser> {
  const { userDataDir, headless = true, extraArgs = [], timeoutMs = 20000 } = opts;
  const browserPath = await discoverBrowser(opts.browserPath);

  mkdirSync(userDataDir, { recursive: true });
  rmSync(join(userDataDir, 'DevToolsActivePort'), { force: true });
  // A killed browser leaves these; the next launch aborts with exit code 21
  // ("Failed to create a ProcessSingleton"). Safe because the profile dir is ours alone.
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    rmSync(join(userDataDir, f), { force: true });
  }

  const proc = spawn(browserPath, [
    ...(headless ? ['--headless=new'] : []),
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-features=Translate',
    ...extraArgs,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  // Accumulate stderr: the "DevTools listening on ws://" line is interleaved with heavy noise
  // and can split across chunk boundaries, so a per-chunk regex silently misses it.
  let stderr = '';
  proc.stderr?.on('data', (b: Buffer) => { stderr += b.toString(); });

  const portFile = join(userDataDir, 'DevToolsActivePort');
  const started = Date.now();
  try {
    while (Date.now() - started < timeoutMs) {
      if (proc.exitCode !== null) {
        throw new Error(`Browser exited early (code ${proc.exitCode}).\n${stderr.slice(-1500)}`);
      }
      if (existsSync(portFile)) {
        const [p, ws] = readFileSync(portFile, 'utf8').split('\n');
        if (p && ws) {
          return { proc, port: Number(p), wsPath: ws.trim(), via: 'DevToolsActivePort',
                   kill: () => { try { proc.kill(); } catch { /* already gone */ } } };
        }
      }
      const m = /DevTools listening on ws:\/\/([^/]+)(\/devtools\/browser\/\S+)/.exec(stderr);
      if (m?.[1] && m[2]) {
        return { proc, port: Number(m[1].split(':').pop()), wsPath: m[2], via: 'stderr',
                 kill: () => { try { proc.kill(); } catch { /* already gone */ } } };
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  } catch (e) {
    proc.kill();
    throw e;
  }
  // MUST kill on the timeout path, or an orphan keeps the profile and poisons every retry.
  proc.kill();
  throw new Error(`Browser port discovery timed out after ${timeoutMs}ms.\n${stderr.slice(-1500)}`);
}
