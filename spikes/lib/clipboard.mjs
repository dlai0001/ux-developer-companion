// KEEPER ARTIFACT — candidate for src/extension/copilot/clipboard.ts (PLAN §4.5).
// Per-OS image-to-clipboard with verification read-back where the OS allows it.
// Returns 'ok' | 'unsupported' | throws Error.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, writeFileSync } from 'node:fs';
const exec = promisify(execFile);

export async function writeImageToClipboard(pngPath) {
  if (!existsSync(pngPath)) throw new Error(`no such file: ${pngPath}`);
  switch (process.platform) {
    case 'darwin': return darwin(pngPath);
    case 'win32': return win32(pngPath);
    case 'linux': return linux(pngPath);
    default: return 'unsupported';
  }
}

async function darwin(p) {
  // NOTE: `set the clipboard to (read … as «class PNGf»)` puts PNG on the pasteboard.
  // Quoting matters: the path goes inside an AppleScript string literal.
  const script = `set the clipboard to (read (POSIX file "${p.replace(/"/g, '\\"')}") as «class PNGf»)`;
  await exec('osascript', ['-e', script]);
  return 'ok';
}

// Verification read-back (macOS): does the pasteboard actually hold an image flavour?
export async function darwinClipboardHasImage() {
  const { stdout } = await exec('osascript', ['-e', 'clipboard info']);
  return /PNGf|TIFF|class PNGf/i.test(stdout);
}

async function win32(p) {
  // Windows clipboard APIs require an STA thread. powershell.exe -STA is the documented
  // way to get one when spawned from a non-console process (the extension host).
  // Written to a temp .ps1 to dodge arg-length and quoting hazards.
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile("${p.replace(/"/g, '`"')}")
[System.Windows.Forms.Clipboard]::SetImage($img)
$img.Dispose()
if ([System.Windows.Forms.Clipboard]::ContainsImage()) { Write-Output "VERIFIED" } else { Write-Output "NOIMAGE" }
`.trim();
  const tmp = `${process.env.TEMP || '.'}\\ux-clip-${process.pid}.ps1`;
  writeFileSync(tmp, ps, 'utf8');
  const { stdout } = await exec('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', tmp]);
  if (/VERIFIED/.test(stdout)) return 'ok';
  throw new Error(`clipboard set but not verified: ${stdout.trim()}`);
}

async function linux(p) {
  const has = async (bin) => { try { await exec('which', [bin]); return true; } catch { return false; } };
  if (await has('wl-copy')) {
    await exec('sh', ['-c', `wl-copy --type image/png < "${p}"`]);
    return 'ok';
  }
  if (await has('xclip')) {
    await exec('sh', ['-c', `xclip -selection clipboard -t image/png -i "${p}"`]);
    return 'ok';
  }
  return 'unsupported'; // -> files-only messaging (PLAN §4.5 / §8)
}
