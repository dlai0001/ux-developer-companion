# S7 — Corporate-machine run-book 🏢

Copy this whole `s7-corp-probe/` folder to the work laptop (USB / OneDrive / zip — it needs no
network to *arrive*). Nothing here installs anything permanently. Total time ≈ 15 minutes.

Paste each command's output into `FINDINGS.md` under **S7**. Where a step fails, the failure
**is** the finding — capture the exact error text, don't work around it.

---

## Step 1 — Record the environment (30 s)

```bash
code --version && node --version && npm --version
```

Windows PowerShell equivalent if `code` is not on PATH: `& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd" --version`

Also note: OS build, whether you are admin, and the exact GitHub Copilot plan on the work account.

---

## Step 2 — (a) Can a locally built `.vsix` be sideloaded?

```bash
code --install-extension probe.vsix
```

Then in VS Code: **Command Palette → "UX Probe: Hello"**. Record the notification text verbatim
(it reports the VS Code version, Node version, and whether `vscode.lm` / image parts exist).

- If the install is blocked, capture the error. Common corporate blocker: an
  `extensions.allowed` / "Allowed Extensions" policy that permits only signed Marketplace
  publishers. **That outcome decides whether sideloading is a viable distribution channel at all.**

Uninstall afterwards: `code --uninstall-extension uxprobe.ux-probe`

---

## Step 3 — (b) Headless browser + remote debugging port

```bash
node probe-browser.mjs
```

Reports registry discovery (Windows), which browser binaries exist, and whether a headless
launch + CDP handshake succeeds. Expected healthy output ends with
`[launch] {"ok":true,...,"browser":"Edge/...","protocol":"1.3"}`.

Likely corporate failure modes to capture verbatim:
- Endpoint-security software blocking `--remote-debugging-port` (browser exits immediately).
- `reg query` denied by policy.
- Enterprise browser policy forcing a managed profile / ignoring `--user-data-dir`.

---

## Step 4 — (c)+(d) Network: registry, proxy, and the VS Code download

```bash
node probe-net.mjs
```

Reports proxy env vars, `npm config`, per-endpoint HTTPS reachability, and a real
`npm install --dry-run` of the actual dependency set.

Pay special attention to **`update.code.visualstudio.com`** — that is what
`@vscode/test-electron` downloads. If it is unreachable, `npm run test:ext` cannot run on this
machine and the extension-host suite becomes personal-machine-only.

If TLS fails with `SELF_SIGNED_CERT_IN_CHAIN` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, that means a
TLS-inspecting proxy; capture it and note whether `NODE_EXTRA_CA_CERTS` is already set.

---

## Step 5 — (e) Does the org's Copilot policy allow `vscode.lm`?

The notification from Step 2 already reports whether `vscode.lm` and
`LanguageModelDataPart.image` exist. For the deeper check (which models the org actually
exposes to an extension), run the personal-machine probe here too if you can copy it over:

```bash
code --extensionDevelopmentPath=<path>/s1-chat-probe --new-window .
```

then read `_out/probe-results.json` → `phases.B_lm.models`. On the personal machine this
returned 4 models with exactly one vision-capable (`auto` / claude-haiku-4.5). **If the corporate
org returns 0 models or strips the vision-capable one, the `@ux` participant path is dead at work
and the clipboard/attachFiles path becomes the only integration.**

---

## Step 6 — Clipboard image write (Windows STA)

This is the one S6 case that could not be tested on macOS. With `probe.vsix` still installed is
not required; just run PowerShell directly on any PNG:

```powershell
powershell -NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Image]::FromFile('C:\path\to\any.png'); [System.Windows.Forms.Clipboard]::SetImage($i); if([System.Windows.Forms.Clipboard]::ContainsImage()){'VERIFIED'}else{'NOIMAGE'}"
```

Run it **3 times** and record how many print `VERIFIED`. If `-ExecutionPolicy Bypass` is blocked
by AppLocker/Constrained Language Mode, **that is itself the finding** → clipboard path is
unavailable on corporate Windows and the product must fall back to files-only messaging.

Then paste into a Copilot Chat input (Ctrl+V) and record whether an image attaches.
