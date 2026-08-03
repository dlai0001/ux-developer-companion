# Troubleshooting

- [No browser found on launch](#no-browser-found-on-launch)
- [The canvas is black](#the-canvas-is-black)
- [Typing feels laggy](#typing-feels-laggy)
- [Send to Chat attaches a filename but no image](#send-to-chat-attaches-a-filename-but-no-image)
- [Pasting a screenshot into chat does nothing](#pasting-a-screenshot-into-chat-does-nothing)
- [The inspector cannot find components](#the-inspector-cannot-find-components)
- [Source file is wrong](#source-file-is-wrong)
- [Breakpoint slider is empty](#breakpoint-slider-is-empty)
- [Corporate and offline environments](#corporate-and-offline-environments)
- [Filing a good bug report](#filing-a-good-bug-report)

---

## No browser found on launch

The extension never downloads a browser. It looks for one you already have, preferring Edge, then
Chrome, then Chromium:

- **macOS** — the standard `/Applications` bundle paths.
- **Windows** — the registry, under `App Paths`.
- **Linux** — `which microsoft-edge`, `google-chrome`, `chromium`.

If none is found, set the path explicitly:

```json
{
  "uxCompanion.browserPath": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
}
```

On Windows the value looks like
`C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe`.

If the browser is found but never appears, check whether endpoint-security software is blocking
`--remote-debugging-port`. That is a common corporate lockdown and produces a launch that starts and
immediately dies.

## The canvas is black

Fixed in the current build. On a static page the forced repaint after `startScreencast` was the only
chance at a frame; if it landed before Chrome had armed the screencast, no frame was ever produced
and the canvas stayed black until you navigated. The first frame is now seeded from a direct
screenshot when no frame arrives, and stream start/stop pairs are serialized so a resize landing
mid-start cannot wedge the stream.

If you still see a black canvas: reload the URL. If it persists, that is a bug worth reporting with
your OS, browser channel, and the page you pointed at.

## Typing feels laggy

Known and structural. Keeping the headless screencast alive requires focus emulation, and under load
an individual key dispatch can take a few hundred milliseconds.

Mitigations that help:

- Lower `uxCompanion.screencastQuality` — fewer bytes per frame leaves more headroom.
- Shrink the panel. The screencast is sized to the panel.
- For long text entry, type in a real browser window and use the panel for the visual work.

## Send to Chat attaches a filename but no image

You want a **thumbnail** above the chat input, not just a filename chip. A chip alone means the file
was referenced but the pixels were not attached — usually a VS Code version change to the chat
command's options bag.

Check that you are on VS Code 1.128 or newer. If you are, report it with your exact VS Code version;
this specific breakage is on the manual-QA list to re-verify after every VS Code major upgrade.

A separate possibility in managed environments: your org's Copilot policy may not expose a
vision-capable model. The attachment still happens — the model simply cannot see it. The context
text still works.

## Pasting a screenshot into chat does nothing

**This is expected.** VS Code's chat paste handler returns early unless some installed extension
enables the `chatReferenceBinaryData` API proposal. On a stock install, pasting an image into
Copilot Chat silently attaches nothing.

The **Copy Annotated Screenshot to Clipboard** command is for pasting into other applications —
tickets, chat, docs. Use **Send to Chat** for Copilot.

On Linux the clipboard command needs `wl-copy` (Wayland) or `xclip` (X11). With neither installed it
reports "unsupported" rather than failing silently.

## The inspector cannot find components

Almost always a build-mode issue.

- **Angular** — `window.ng` only exists in a development build. Against a production build the
  adapter says so instead of guessing. Point the panel at your dev server.
- **React** — a production build stays readable but is reported as **degraded**: component names are
  minified, source-file resolution is skipped, and prop/state overrides are **refused** rather than
  silently ignored. This is deliberate; a silently-dropped override is worse than a refusal.

If you are on a dev build and it still fails, the page agent may not have been injected — it runs at
document start, so a page that was already open before the panel connected can miss it. Reload.

## Source file is wrong

Expected some of the time. Resolution is a **ranked search**, not a lookup: roughly 87% top-1 for
React and 95% for Angular against real repositories. That is why runner-up candidates are included
alongside the best match. Treat the path as a strong hint.

Accuracy drops on minified builds (where it is skipped entirely), on components defined in barrel
files, and on generically named components (`Button`, `Item`, `Row`) that appear many times.

## Breakpoint slider is empty

The slider is built from media queries read out of your app's stylesheets. A page can only read
stylesheets it is allowed to read, so:

- **Cross-origin stylesheets without CORS headers are invisible.** A CDN-hosted CSS file typically
  falls in this category.
- **CSS-in-JS** that injects rules at runtime is readable only after those rules exist — interact
  with the page first, then re-read.

Token provenance in the eyedropper has the same limitation for the same reason.

## Corporate and offline environments

The extension makes **no runtime downloads** and has **no backend**. axe-core is bundled in the
`.vsix`.

**Sideloading a `.vsix`:**

```bash
code --install-extension ux-developer-companion.vsix
```

If your organisation restricts extension installation, the install is refused by policy — that is an
org setting, not an extension failure. Ask for `dlaisoft.ux-developer-companion` to be allowlisted.

**Building from source behind a proxy:**

```bash
npm install && npm run fixtures:setup && npm run build && npm run package
```

`npm install` needs the usual `HTTPS_PROXY` / `NODE_EXTRA_CA_CERTS` environment. Note that
`npm run test:ext` downloads a VS Code build from `update.code.visualstudio.com`; if that host is
blocked, run the extension-host suite on an unrestricted machine — `test:unit` and
`test:integration` do not need it.

**The decisive unknowns in a locked-down environment**, in the order they tend to bite:

1. Can a locally built `.vsix` be sideloaded at all?
2. Does endpoint security allow `--remote-debugging-port`?
3. Does the org's Copilot policy expose a vision-capable model?

## Filing a good bug report

[Open an issue](https://github.com/dlai0001/ux-developer-companion/issues) with:

- OS and version, VS Code version, extension version.
- Which browser was launched (Edge/Chrome/Chromium) and its version.
- Framework and build mode — React or Angular, dev or production.
- What you did, what you expected, what happened.
- Anything in **Output → UX Companion** and in the **Developer: Toggle Developer Tools** console.

A screenshot helps. You have a good tool for making one.
