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
  /** The profile we launched with; also how surviving children are identified. */
  userDataDir: string;
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
  try {
    return await attemptLaunch(opts);
  } catch (first) {
    // Reaping the lock is not always enough: after an unclean kill, surviving Chrome child
    // processes can still own the profile, and the new instance exits or never opens a port.
    // A throwaway profile always works, so the crash-restart path never dead-ends.
    const fallbackDir = `${opts.userDataDir}-retry-${Date.now()}`;
    try {
      return await attemptLaunch({ ...opts, userDataDir: fallbackDir });
    } catch {
      throw first; // report the original, more informative failure
    }
  }
}

async function attemptLaunch(opts: LaunchOptions): Promise<LaunchedBrowser> {
  // 45s, not 20s: a loaded machine (or one with on-access AV scanning) can take well over 20s
  // to get Chrome listening, and a premature timeout looks identical to a launch failure.
  const { userDataDir, headless = true, extraArgs = [], timeoutMs = 45000 } = opts;
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
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group so the WHOLE tree can be reaped. proc.kill() only signals the parent;
    // Chrome's renderer/GPU/network children survive and accumulate, and once enough of them
    // are running a fresh launch exceeds its timeout and looks like a launch failure.
    detached: process.platform !== 'win32',
  });

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
                   userDataDir, kill: () => killTree(proc, userDataDir) };
        }
      }
      const m = /DevTools listening on ws:\/\/([^/]+)(\/devtools\/browser\/\S+)/.exec(stderr);
      if (m?.[1] && m[2]) {
        return { proc, port: Number(m[1].split(':').pop()), wsPath: m[2], via: 'stderr',
                 userDataDir, kill: () => killTree(proc, userDataDir) };
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  } catch (e) {
    killTree(proc, userDataDir);
    throw e;
  }
  // MUST kill on the timeout path, or an orphan keeps the profile and poisons every retry.
  killTree(proc, userDataDir);
  throw new Error(`Browser port discovery timed out after ${timeoutMs}ms.\n${stderr.slice(-1500)}`);
}

/** Kill the browser and every process it spawned. */
export function killTree(proc: ChildProcess, userDataDir?: string): void {
  if (process.platform === 'win32') {
    if (proc.pid !== undefined && proc.exitCode === null) {
      try { spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
    }
    return;
  }

  // Only signal a process GROUP while the child is still alive. macOS recycles pids quickly
  // under churn, so kill(-pid) on a dead pid can land on an UNRELATED group — that showed up
  // as another session's CDP socket closing for no visible reason.
  if (proc.pid !== undefined && proc.exitCode === null && proc.signalCode === null) {
    try { process.kill(-proc.pid, 'SIGKILL'); } catch {
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
    }
  }

  // Sweep any survivors by profile directory. Chrome's helper processes carry the same
  // --user-data-dir, the directory is ours alone, and matching on it is immune to pid reuse —
  // so this reaps children whose parent already exited without risking anything else.
  if (userDataDir) {
    try { spawn('pkill', ['-f', `--user-data-dir=${userDataDir}`], { stdio: 'ignore' }).unref(); }
    catch { /* pkill unavailable; the group kill above is the fallback */ }
  }
}
