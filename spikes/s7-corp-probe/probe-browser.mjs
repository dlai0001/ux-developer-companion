// S7 probe (b): can we discover and launch Edge/Chrome headless with a debugging port,
// and complete a CDP handshake, on the locked-down corporate machine?
// Self-contained: no npm install required (uses only node builtins + raw WebSocket-less HTTP).
import { spawn, execFile } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
const exec = promisify(execFile);

const report = { platform: process.platform, node: process.version, steps: {} };
const log = (k, v) => { report.steps[k] = v; console.log(`[${k}]`, typeof v === 'string' ? v : JSON.stringify(v)); };

const WIN_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
];
const MAC_CANDIDATES = [
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const LINUX_BINS = ['microsoft-edge', 'google-chrome', 'chromium', 'chromium-browser'];

// --- 1. registry discovery (Windows only) — PLAN §4.1 claims this path; verify it works
//        under corporate policy (reg query is sometimes restricted).
async function registryDiscovery() {
  if (process.platform !== 'win32') return 'n/a (not Windows)';
  const out = {};
  for (const exe of ['msedge.exe', 'chrome.exe']) {
    for (const hive of ['HKLM', 'HKCU']) {
      const key = `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`;
      try {
        const { stdout } = await exec('reg', ['query', key, '/ve']);
        const m = /REG_SZ\s+(.+)/.exec(stdout);
        out[`${hive}/${exe}`] = m ? m[1].trim() : stdout.trim().slice(0, 200);
      } catch (e) { out[`${hive}/${exe}`] = `ERROR: ${String(e.message).slice(0, 160)}`; }
    }
  }
  return out;
}

async function pathDiscovery() {
  if (process.platform === 'win32') return WIN_CANDIDATES.filter(existsSync);
  if (process.platform === 'darwin') return MAC_CANDIDATES.filter(existsSync);
  const found = [];
  for (const b of LINUX_BINS) {
    try { const { stdout } = await exec('which', [b]); found.push(stdout.trim()); } catch {}
  }
  return found;
}

async function launchAndHandshake(browserPath) {
  const userDataDir = join(tmpdir(), `ux-probe-${process.pid}`);
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });
  const proc = spawn(browserPath, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  proc.stderr.on('data', (b) => { stderr += b.toString(); });

  const portFile = join(userDataDir, 'DevToolsActivePort');
  const t0 = Date.now();
  let port = null, via = null;
  while (Date.now() - t0 < 25000 && port === null) {
    if (proc.exitCode !== null) {
      proc.kill();
      return { ok: false, reason: `browser exited early code=${proc.exitCode}`, stderrTail: stderr.slice(-1200) };
    }
    if (existsSync(portFile)) {
      const [p, ws] = readFileSync(portFile, 'utf8').split('\n');
      if (p && ws) { port = +p; via = 'DevToolsActivePort'; break; }
    }
    const m = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(stderr);
    if (m) { port = +m[1]; via = 'stderr'; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (port === null) { proc.kill(); return { ok: false, reason: 'port discovery timed out', stderrTail: stderr.slice(-1200) }; }

  // CDP handshake over plain HTTP (no deps).
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    const info = await res.json();
    proc.kill();
    return { ok: true, via, port, browser: info.Browser, protocol: info['Protocol-Version'] };
  } catch (e) {
    proc.kill();
    return { ok: false, reason: `handshake failed: ${e.message}`, port, via };
  }
}

log('registry', await registryDiscovery());
const found = await pathDiscovery();
log('pathsFound', found);
if (!found.length) {
  log('launch', 'SKIPPED — no browser found. Set uxCompanion.browserPath manually.');
} else {
  log('launch', await launchAndHandshake(found[0]));
}
console.log('\n===== COPY EVERYTHING ABOVE INTO FINDINGS.md =====');
