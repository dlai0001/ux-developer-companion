# UX Developer Companion

An embedded browser inside VS Code for UI-focused web development. Browse your running app,
annotate what's wrong, inspect and override live component state, simulate visual/network/
accessibility conditions — then send screenshots and component-resolved context to **GitHub
Copilot Chat** with one keystroke.

> Works with GitHub Copilot Chat. Not affiliated with, endorsed by, or sponsored by GitHub or
> Microsoft.

---

## What it does

| | |
|---|---|
| **Embedded browser** | Headless Edge/Chrome streamed into a panel via CDP, with full mouse/keyboard/wheel forwarding and a navigation bar. |
| **Annotations** | Rectangle, arrow, and Sketch-style callouts. Each mark resolves the component underneath it at creation time. |
| **Send to Prompt** | `cmd/ctrl+alt+p` attaches a clean screenshot, an annotated screenshot, and a context block (URL, route, viewport, emulation state, components, source paths) to Copilot Chat in agent mode. |
| **Inspector** | Component tree, click-to-pick, and live prop/state editing for React and Angular. |
| **Responsive** | Device presets with DPR/touch/UA, a breakpoint slider built from your app's own media queries, and a responsive matrix. |
| **Colour & a11y** | Eyedropper that names the CSS custom property *and where it is defined*, WCAG contrast checking, vision-deficiency and media emulation, and an axe-core scan. |
| **State lab** | Force `:hover`/`:focus`/`:active`, intercept requests (fail/delay/mock), throttle the network, and snapshot/restore storage profiles. |

## Requirements

- **VS Code 1.128 or newer.**
- **Microsoft Edge or Google Chrome installed locally.** The extension never downloads a
  browser. If auto-discovery fails, set `uxCompanion.browserPath`.
- A running dev server to point it at.

## Getting started

1. Run **UX Companion: Open Browser Panel** from the Command Palette.
2. Enter your dev server URL in the address bar.
3. Switch to **Annotate**, mark something up, then press **Send to Prompt**.

## Settings

| Setting | Default | Description |
|---|---|---|
| `uxCompanion.browserPath` | *(empty)* | Absolute path to Edge/Chrome/Chromium. Empty = auto-discover (Edge → Chrome → Chromium). |
| `uxCompanion.screencastQuality` | `60` | JPEG quality for the stream. Frame rate is never reduced to save bandwidth — see below. |
| `uxCompanion.captureDir` | `.ux-companion/captures` | Workspace-relative directory for saved screenshots and context. |

## How screenshots reach Copilot

Screenshots are **attached directly** to the chat input — no pasting, no manual steps. The
extension writes both PNGs to `captureDir` and passes them to VS Code's chat command as image
attachments.

**Copying to the clipboard is a separate, optional command.** It is deliberately *not* how
images reach chat: VS Code's chat paste handler ignores images unless some installed extension
enables the `chatReferenceBinaryData` API proposal, so pasting a screenshot into Copilot Chat
silently does nothing on a stock install. Use **Send to Prompt** instead.

## Corporate / offline installation

The extension makes **no runtime downloads** and has **no backend**. axe-core is bundled.

**Sideloading a `.vsix`:**

```bash
code --install-extension ux-developer-companion.vsix
```

If your organisation restricts extension installation, the install will be refused by policy —
that is an org setting, not an extension failure.

**Building from source:**

```bash
npm install && npm run fixtures:setup && npm run build && npm run package
```

Behind a proxy, `npm install` needs the usual `HTTPS_PROXY` / `NODE_EXTRA_CA_CERTS`
environment. Note that `npm run test:ext` downloads a VS Code build from
`update.code.visualstudio.com`; if that host is blocked, run the extension-host suite on an
unrestricted machine — `test:unit` and `test:integration` do not need it.

## Known limitations

- **IME and international composition** are imperfect over CDP. Complex input methods may not
  compose correctly in the embedded browser.
- **Angular requires a dev build.** `window.ng` only exists in development mode; against a
  production build the Angular adapter reports that it cannot resolve components.
- **React production builds are read-only.** Props and state remain readable, but component
  names are minified, so the inspector reports the build as degraded, source-file resolution is
  skipped, and overrides are refused rather than silently ignored.
- **Source-file resolution is ranked, not certain.** Measured on real repositories, ranked
  top-1 accuracy is roughly 87% (React) and 95% (Angular); the payload therefore includes
  runner-up candidates. Treat the path as a strong hint.
- **Typing latency.** Keeping the headless screencast alive requires focus emulation, which can
  make an individual key dispatch take a few hundred milliseconds under load.
- **Cross-origin stylesheets** cannot be read, so breakpoints and token provenance only cover
  stylesheets the page can access.

## Development

```bash
npm run build          # host + webview + page-agent bundles
npm run watch          # rebuild on change
npm run fixtures:setup # install the React + Angular fixture apps
npm run fixtures:serve # serve them on :5173 (dev), :5174 (prod), :4200 (Angular)
npm test               # typecheck + unit + integration + extension-host
```

See `MANUAL-QA.md` for the checks CI cannot perform, and `spikes/FINDINGS.md` for the
research that shaped several non-obvious design decisions.

## Licence

MIT
