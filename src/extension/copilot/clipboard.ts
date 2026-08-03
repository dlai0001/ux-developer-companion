// Per-OS image-to-clipboard (PLAN §4.5). Promoted from spikes/lib/clipboard.mjs.
//
// IMPORTANT: this is a convenience for pasting into OTHER apps. It is NOT the way screenshots
// reach Copilot Chat. VS Code's chat paste handler returns early unless some installed
// extension enables the `chatReferenceBinaryData` API proposal, so on a stock install pasting
// an image into chat silently does nothing (spike S1). Screenshots reach chat via attachFiles.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const exec = promisify(execFile);

export type ClipboardResult = 'ok' | 'unsupported';

export async function writeImageToClipboard(pngPath: string): Promise<ClipboardResult> {
  if (!existsSync(pngPath)) throw new Error(`no such file: ${pngPath}`);
  switch (process.platform) {
    case 'darwin': return darwin(pngPath);
    case 'win32': return win32(pngPath);
    case 'linux': return linux(pngPath);
    default: return 'unsupported';
  }
}

async function darwin(p: string): Promise<ClipboardResult> {
  const script = `set the clipboard to (read (POSIX file "${p.replace(/"/g, '\\"')}") as «class PNGf»)`;
  await exec('osascript', ['-e', script]);
  return 'ok';
}

/** macOS-only verification read-back, used by tests. */
export async function darwinClipboardHasImage(): Promise<boolean> {
  const { stdout } = await exec('osascript', ['-e', 'clipboard info']);
  return /PNGf|TIFF/i.test(stdout);
}

async function win32(p: string): Promise<ClipboardResult> {
  // Windows clipboard APIs require an STA thread; powershell -STA provides one when spawned
  // from a non-console process. Written to a temp .ps1 to dodge arg-length/quoting hazards.
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile("${p.replace(/"/g, '`"')}")
[System.Windows.Forms.Clipboard]::SetImage($img)
$img.Dispose()
if ([System.Windows.Forms.Clipboard]::ContainsImage()) { Write-Output "VERIFIED" } else { Write-Output "NOIMAGE" }
`.trim();
  const tmp = join(process.env['TEMP'] ?? tmpdir(), `ux-clip-${process.pid}.ps1`);
  writeFileSync(tmp, ps, 'utf8');
  const { stdout } = await exec('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', tmp]);
  if (/VERIFIED/.test(stdout)) return 'ok';
  throw new Error(`clipboard set but not verified: ${stdout.trim()}`);
}

async function linux(p: string): Promise<ClipboardResult> {
  const has = async (bin: string): Promise<boolean> => {
    try { await exec('which', [bin]); return true; } catch { return false; }
  };
  if (await has('wl-copy')) {
    await exec('sh', ['-c', `wl-copy --type image/png < "${p}"`]);
    return 'ok';
  }
  if (await has('xclip')) {
    await exec('sh', ['-c', `xclip -selection clipboard -t image/png -i "${p}"`]);
    return 'ok';
  }
  return 'unsupported';   // -> files-only messaging (PLAN §8)
}
