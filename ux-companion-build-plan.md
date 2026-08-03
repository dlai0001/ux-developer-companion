# UX Developer Companion — Unsupervised Build Plan

A VSCode extension for UI-focused web developers (React + Angular, Lit later). It embeds a
headless Chromium/Edge browser inside VSCode via CDP screencast. The developer browses their
running app, annotates screenshots, inspects and overrides live component state, simulates
visual/network/accessibility conditions, and sends rich, component-resolved context to GitHub
Copilot Chat with one hotkey.

This document is the single source of truth for a long unsupervised agentic build session.
Build milestones **in order**. Every milestone has acceptance criteria verified by automated
tests. If a milestone stalls past its contingency budget, apply its named fallback and move on —
a smaller working product beats a larger broken one.

> **Revision — amended from the research-spike round (`spikes/FINDINGS.md`).**
> All nine spikes ran. Everything below marked 🔬 is now backed by measurement on
> VSCode 1.128.1 / Copilot Chat 0.56.0 / Chrome 150.0.7871.187 / React 18.3.1 + 19.2.0.
> Load-bearing changes:
> 1. **Integration inverted** — attaching captures to the *native* chat is the primary and only
>    shipped path; the `@ux` participant is cut from this session (it cannot see attached images).
> 2. **React overrides are far simpler than designed** — no Bridge/Store/wall; call the renderer
>    interface directly. M6 shrinks.
> 3. **Screencast defaults corrected** — keep `everyNthFrame: 1`; frame-skipping wrecks typing latency.
> 4. **Source locator needs ranking** — plain text search is 55–73 % top-1, ranked is 87–95 %.
> 5. **Name changed** — "Copilot" removed from the product name (trademark risk).
> Unverified items are labelled ⚠️ rather than silently assumed.

---

## 1. Locked decisions

| Area | Decision |
|---|---|
| Name 🔬 | **`UX Developer Companion`** — "Copilot" removed from `name`/`displayName`; compatibility phrasing lives in the **description** ("works with GitHub Copilot Chat"). Fallback: `Pixel Pilot — UI Dev Companion`. Participant handle (if ever built): `@uxdev`. |
| Distribution | Marketplace **and** sideloadable `.vsix` (GitHub Releases); buildable from source. No runtime downloads, no hard backend dependency, no telemetry. Must work behind corporate firewalls. |
| Browser 🔬 | Locally installed **Edge or Chrome** (never download a browser). Driven via **`chrome-remote-interface`** (raw CDP). Hand-rolled discovery/launch. *Verified target: Chrome 150. Edge is absent from the primary dev machine — keep it first in discovery order, but no fixture or test may assume it.* |
| Rendering | **Headless + CDP screencast into a VSCode webview**, with full input forwarding (fully embedded browser). |
| Frameworks (this session) | **Angular + React** adapters. Lit deferred. |
| React overrides 🔬 | Inject the **`react-devtools-core` backend** at document-start, then call the **renderer interface directly** (`__REACT_DEVTOOLS_GLOBAL_HOOK__.rendererInterfaces`). **No Bridge, no Store, no custom wall.** Read *and* write verified on React 18 + 19. |
| Copilot handoff 🔬 | **Single path: attach to the native chat** via `workbench.action.chat.open({ query, attachFiles, mode: 'agent' })`. Verified end-to-end: a vision model read the attached PNG in agent mode. The `@ux` participant is **cut** (see §8). Clipboard image write ships as a convenience for pasting *elsewhere*, **not** as a chat channel. |
| Send flow | "Send to Prompt" button + keybinding attaches **clean screenshot + annotated screenshot + auto-context text**, then leaves the user in Copilot Chat to type their own prompt. No auto-generated instructions. |
| Auto-context text | URL + route, resolved components + **ranked** source file paths, props/state snapshot of annotated components, viewport/emulation state. |
| Annotations v1 | Rectangle, arrow, Sketch-style **callout box** (speech bubble with pointer + editable text). |
| Webview UI | **React**. |
| Build | **esbuild for everything** (host + webviews + page-agent). TypeScript throughout. |
| Repo | **Single package with folder conventions** (no workspaces). Fixture apps carry their own `package.json`. |
| `engines.vscode` 🔬 | **`^1.128.0`** — the version every chat/`lm` behaviour below was verified against. |
| Verification | In-repo fixture apps (mini React + mini Angular), **vitest** unit tests, CDP integration tests against fixtures, **`@vscode/test-electron`** extension-host tests *(personal-machine-only until S7 confirms `update.code.visualstudio.com` is reachable at work)*. |
| Priority after core | 1) Component inspector + overrides → 2) Visual/responsive tools → 3) Color & a11y tools → 4) State lab. |

Deferred (do NOT build this session): **`@ux` chat participant**, Lit adapter, licensing/payments,
reviewer web portal, ticket integrations, visual regression history, route crawler, animation
scrubber, pseudo-localization, before/after verification loop.

---

## 2. Architecture

Four runtime contexts, one shared typed protocol:

```
┌────────────────────────────  VSCode  ────────────────────────────┐
│  Extension Host (Node)                                           │
│   • BrowserManager: discover/launch/kill Edge|Chrome, CDP client │
│   • SessionController: screencast loop, input forwarding,        │
│     emulation state, request-interception rules, captures        │
│   • ContextComposer: builds the send-to-prompt payload           │
│   • CopilotBridge: native-chat attach + clipboard convenience    │
│   • SourceLocator: workspace search + RANKING → file             │
│           ▲  postMessage (typed protocol, src/shared)  ▼         │
│  Webview (React)                                                 │
│   • BrowserView: <canvas> frames + input capture                 │
│   • AnnotationLayer: rect / arrow / callout on overlay canvas    │
│   • ToolPanels: inspector, device bar, rulers, a11y, state lab   │
└──────────────────────────────────────────────────────────────────┘
            ▲  CDP over websocket (chrome-remote-interface)  ▼
┌──────────────────────  Headless Edge/Chrome  ────────────────────┐
│  User's running web app (localhost dev server)                   │
│  Page Agent (injected via Page.addScriptToEvaluateOnNewDocument) │
│   • FrameworkAdapter (angular | react): resolve/read/write state │
│   • react-devtools-core backend → renderer interface (direct)    │
│   • Overlay helpers: element bounds, guides snap targets         │
│   • Talks to host via Runtime.evaluate + bindings                │
│     (Runtime.addBinding → window.__uxCompanionEmit)              │
└──────────────────────────────────────────────────────────────────┘
```

**Communication rules**
- Webview ⇄ host: `postMessage` only, every message a discriminated union defined once in
  `src/shared/protocol.ts`. No stringly-typed messages.
- Host ⇄ page-agent: host calls agent via `Runtime.evaluate` on a namespaced global
  (`window.__uxCompanion.<fn>`), agent pushes events via `Runtime.addBinding`.
- Page-agent is a single esbuild IIFE bundle (`out/page-agent.js`) injected with
  `Page.addScriptToEvaluateOnNewDocument` (survives navigation) — zero setup in the user's app.

---

## 3. Repo layout (single package)

```
ux-companion/
├── package.json               # extension manifest + scripts
├── esbuild.mjs                # 3 entry points: host, webview, page-agent
├── tsconfig.json              # project refs or paths for the 3 contexts
├── src/
│   ├── extension/             # host: activation, commands, managers
│   │   ├── extension.ts
│   │   ├── browser/           # discovery, launch, cdp client, screencast
│   │   ├── session/           # emulation, interception, capture, profiles
│   │   ├── copilot/           # native-chat attach, clipboard, composer
│   │   └── source-locator.ts  # search + ranking (§4.3)
│   ├── webview/               # React app
│   │   ├── main.tsx
│   │   ├── browser-view/      # canvas, input capture, coordinate mapping
│   │   ├── annotations/       # models, canvas layer, compositor
│   │   ├── panels/            # inspector, devices, rulers, a11y, state-lab
│   │   └── state/             # zustand or useReducer store
│   ├── page-agent/            # injected bundle
│   │   ├── index.ts           # bootstrap, binding wiring
│   │   ├── adapters/          # adapter.ts (interface), angular.ts, react.ts
│   │   └── dom-utils.ts
│   └── shared/
│       ├── protocol.ts        # ALL webview⇄host message types
│       └── agent-api.ts       # host⇄agent call/result types
├── fixtures/
│   ├── react-app/             # Vite React app; own package.json
│   └── angular-app/           # minimal Angular app; own package.json
├── test/
│   ├── unit/                  # vitest
│   ├── integration/           # vitest + real CDP vs fixtures
│   └── extension/             # @vscode/test-electron
├── scripts/
│   ├── setup-fixtures.mjs     # npm i in both fixtures
│   └── serve-fixtures.mjs     # start both on known ports (5173, 4200)
└── .vscode/  README.md  CHANGELOG.md
```

`npm scripts`: `build`, `watch`, `test:unit`, `test:integration`, `test:ext`, `test` (all),
`fixtures:setup`, `fixtures:serve`, `package` (vsce → .vsix).

---

## 4. Key technical specifications

### 4.1 Browser discovery & launch (`src/extension/browser/discover.ts`) 🔬

Order: (1) `uxCompanion.browserPath` setting → (2) Edge → (3) Chrome → (4) Chromium. Fail with
an actionable error message pointing at the setting.

- **Windows**: check registry `HKLM/HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\
  {msedge.exe,chrome.exe}` via `reg query`, then default paths
  (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
  `C:\Program Files\Google\Chrome\Application\chrome.exe`, LOCALAPPDATA variants). ⚠️ `reg query`
  under corporate policy is unverified — pending S7.
- **macOS**: `/Applications/Microsoft Edge.app/.../MS Edge`, `/Applications/Google Chrome.app/...`.
- **Linux**: `which microsoft-edge google-chrome chromium chromium-browser`.

Launch: `child_process.spawn` with `--headless=new --remote-debugging-port=0
--user-data-dir=<extension globalStorage>/browser-profile-<id> --no-first-run
--no-default-browser-check --disable-background-networking`.

**Port discovery — three corrections, all learned the hard way:**

1. **Read `<user-data-dir>/DevToolsActivePort`** (line 1 = port, line 2 = browser ws path). This
   is the primary mechanism. Keep stderr parsing only as a *fallback*, and **accumulate stderr
   across chunks** — the `DevTools listening on ws://…` line is real but arrives interleaved with
   heavy macOS noise (`trust_store_mac`, `CVDisplayLink`, `Trying to load the allocator…`) and
   **can split across chunk boundaries**. A single-chunk regex silently misses it.
2. **Reap stale profile locks before launching.** A killed browser leaves `SingletonLock`,
   `SingletonSocket`, `SingletonCookie`; the next launch **aborts with exit code 21**
   (*"Failed to create a ProcessSingleton for your profile directory"*). Only reap when no live
   owner exists — removing the lock out from under a running instance makes things worse.
3. **`browser-profile-<id>` is load-bearing, not cosmetic**, and **the timeout path must kill the
   child**. An orphaned browser holding a shared profile makes every subsequent launch hang.

Own the process: kill on deactivate/panel dispose; auto-relaunch once on crash, then surface an
error. Ignore HTTPS errors via `Security.setIgnoreCertificateErrors` (dev servers).

> Reference implementation: `spikes/lib/launch.mjs`.

### 4.2 Screencast & input (`session/screencast.ts`, `webview/browser-view/`) 🔬

- `Page.startScreencast({ format: 'jpeg', quality: 60, maxWidth, maxHeight, everyNthFrame: 1 })`
  where max dims = webview CSS size × devicePixelRatio.
- **Keep `everyNthFrame: 1`.** Frame-skipping multiplies input latency, because an interactive
  page only repaints *in response to input* — skipping N frames means waiting N repaints to see
  your own keystroke. Measured keystroke-to-pixel p50: **21.6 ms @ nth 1 → 83.6 ms @ nth 2 →
  336 ms @ nth 4** (p95 2.7 s). Control bandwidth with **idle-pause** and **quality**, never with
  frame-skipping while the user is interacting.
- **Ack every frame** (`Page.screencastFrameAck`) or the stream stalls outright.
- **Latest-frame-wins**: never retain more than one undrawn frame. Verified against a real
  `requestAnimationFrame` draw loop — no queue growth.
- **Screencast emits frames ONLY on repaint.** A fully static page produces **zero** frames, so
  the canvas stays blank on load. **Force a repaint after every `startScreencast`** and after
  every restart (settings or metrics change), or the viewport looks broken. Corollary: idle
  detection is nearly free — no repaint means no frames automatically. Resume after
  stop/start measured at **12 ms**.
- Restart screencast on webview resize (debounced 150 ms) and after `setDeviceMetricsOverride`.
- Measured budget at the recommended settings: host→webview `postMessage` **p50 2 ms**,
  canvas `drawImage` **p50 <1 ms**, frame age at draw **15–19 ms**, extension-host CPU **0.7–2.4 %**.
- Input forwarding: webview captures events on the canvas and sends normalized payloads; host
  replays via `Input.dispatchMouseEvent` (incl. wheel with deltas) and `Input.dispatchKeyEvent`.
  **Keycode table required**: printable keys need `keyDown` + `char` + `keyUp`; non-printable use
  `rawKeyDown` + `keyUp` with `windowsVirtualKeyCode`/`nativeVirtualKeyCode`.
- Coordinate mapping: canvas px → page CSS px. Simplest reliable approach is a fixed
  `Emulation.setDeviceMetricsOverride`, which makes page CSS px exactly known; otherwise use the
  per-frame metadata (`pageScaleFactor`, offsets).
- Known accepted limitation: IME/international composition is imperfect over CDP. Note in README.
- Navigation bar: URL input, back/forward/reload via `Page.navigate`, `Page.getNavigationHistory`.
  Track current URL via `Page.frameNavigated` events; show it in the toolbar.

> Reference implementation + permanent perf-regression harness: `spikes/s4-webview-ext/`.

### 4.3 Page agent & adapter interface (`src/page-agent/`) 🔬

```ts
// shared/agent-api.ts
interface ComponentInfo {
  framework: 'angular' | 'react' | null;
  name: string;                 // e.g. 'UserCard' | 'app-user-card'
  selectorHint: string | null;  // angular selector / react displayName
  ancestry: string[];           // react: ownersList, e.g. ['App','UserCard'] — ranking signal
  props: JsonSnapshot;          // serialized, depth-limited (see below)
  state: JsonSnapshot | null;   // hooks state / non-input fields / signal values
  domPath: string;              // css path for re-identification
  bounds: DOMRect;
  degraded?: 'production-build'; // reads OK, names unreliable
}
interface FrameworkAdapter {
  detect(): boolean;
  resolveAt(x: number, y: number): ComponentInfo | null;   // from CSS-px point
  resolveNode(el: Element): ComponentInfo | null;
  componentTree(maxDepth: number): ComponentTreeNode[];     // for inspector panel
  readState(id: ComponentId): ComponentInfo;
  writeState(id: ComponentId, path: string[], value: Json): WriteResult;
  supportsWrite: boolean;       // DERIVED at runtime, never hardcoded
}
```

- **Serialization**: depth-limit 4, array cap 50, string cap 500 chars, cycle-safe, functions →
  `"[fn]"`, DOM nodes → tag string. One shared serializer used by both adapters.

- **Angular adapter** ⚠️ *(not covered by the spike round — now the riskier half of M6)*:
  `detect` = `!!window.ng?.getComponent`. Resolve via
  `ng.getComponent(el) ?? ng.getOwningComponent(el)` walking up from
  `document.elementFromPoint`. Inputs via component instance + `ng.getDirectiveMetadata` where
  available. Signals: detect callable-with-`set` shape; read by invoking, write via `.set()`.
  Non-signal writes: assign property then `ng.applyChanges(instance)`. Requires dev mode —
  if `window.ng` is absent, report `framework: null` with a "prod build?" hint.

- **React adapter** — inject the `react-devtools-core` backend at document-start via
  `Page.addScriptToEvaluateOnNewDocument` (**before React loads** — this is why injection uses
  that method), then call the renderer interface **directly** through `Runtime.evaluate`:

  ```js
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const rid  = Array.from(hook.rendererInterfaces.keys())[0];
  const ri   = hook.rendererInterfaces.get(rid);           // 37 methods
  const id   = ri.getElementIDForHostInstance(document.elementFromPoint(x, y));
  ri.inspectElement(null, id, null, false);                // props, hooks, editability
  ri.getDisplayNameForElementID(id);                       // 'UserCard'
  ri.findHostInstancesForElementID(id);                    // → bounds
  ri.getOwnersList(id);                                    // → ['App','UserCard'] ancestry
  ri.overrideValueAtPath('props', id, null, ['compact'], true);
  ri.overrideValueAtPath('hooks', id, /*hookID*/ 0, [], 42);
  ```

  **No Bridge, no Store, no custom wall, no binding message pump, no protocol decoding.**
  (`react-devtools-shared` — which holds `Bridge`/`Store` — is not published to npm at all;
  `react-devtools-core/standalone` is the whole Electron *UI*, not an embeddable client.
  `connectWithCustomMessagingProtocol` exists as a sanctioned custom-wall API if a full Store is
  ever wanted, but it is not needed for resolve/read/write.)

  > ⚠️ **`overrideValueAtPath` is POSITIONAL**: `(type, id, hookID, path, value)`. The
  > `{id, rendererID, type, path, value}` object form — which is what the *Bridge* sends and the
  > shape most naturally inferred from the devtools source — **fails silently** (a `console.warn`
  > at most, no throw, no DOM change). This looks exactly like "overrides don't work."

  - **`supportsWrite` ← `inspectElement().canEditFunctionProps` / `.canEditHooks`** (true in dev,
    false in production builds). Do **not** use the per-hook `isStateEditable` — it stays `true`
    even in prod and is misleading.
  - **Production builds**: props and hook values remain **readable**; only identity degrades
    (`getDisplayNameForElementID` returns the host tag, e.g. `"H2"`; `ownersList` likewise).
    Report `degraded: 'production-build'` — "read-only, names unavailable", not "give up".
  - Fallback read path if the backend ever fails to attach: walk `__reactFiber$*` on the DOM node
    → nearest function/class component fiber → `memoizedProps` / `memoizedState`;
    `supportsWrite = false`.

- **Source locator** (host side, not agent) 🔬 — **search alone is not sufficient.** Measured on
  real repos: naive text search returning the first match is **73 % top-1 (React) / 55 %
  (Angular)**, and only **20 % / 10 %** on *contested* names (those with multiple candidates —
  `combobox`, `cdk-table`, `mat-table`, up to 18 candidates). Ranking lifts this to **87 % / 95 %**
  top-1 and **95–100 % top-3**.

  Search: `vscode.workspace.findFiles` + text search — Angular → `selector: '<hint>'` in `*.ts`;
  React → `function <Name>` | `const <Name>` | `class <Name>` in `*.tsx?`. Then **rank**:

  | signal | weight |
  |---|---|
  | exported definition (`export (default )?(function\|const\|class) Name`) | +40 |
  | `@Component`/`@Directive` decorator present (Angular) | +40 |
  | filename === component name (exact or kebab) | +30 |
  | containing directory === component name (`Foo/index.tsx`) | +18 |
  | filename partially matches | +12 |
  | ancestry: directory matches an `ownersList` entry | +10 |
  | inside `src/` | +5 |
  | **file also imports the same name** (⇒ it is a *consumer*) | **−25** |
  | test / spec / story / demo / example / fixture path | −35 |
  | `.d.ts` | −40 |
  | path depth | −0.5 each |

  Return the ranked best match **plus up to 2 alternates**, as workspace-relative paths. Never
  present a single unranked path as authoritative — a wrong path sends Copilot to edit the wrong
  component. Note these accuracies were measured on *library* repos with disciplined naming;
  treat them as an upper bound.

  > Reference implementation: the `score()` function in `spikes/s8-source-locator.mjs`.

### 4.4 Annotations (`webview/annotations/`)

- Model: `{ id, kind: 'rect'|'arrow'|'callout', geometry (page CSS px), color, text?,
  componentRef?: ComponentInfo }`. Stored in page coordinates so they survive
  scroll/resize; rendered on an overlay canvas above the frame canvas.
- Modes: **Browse** (events forwarded to page) / **Annotate** (overlay captures pointer).
  Explicit toolbar toggle + keybinding.
- Callout: rounded rect with editable text (HTML overlay input while editing, drawn to canvas
  when committed) + tail anchored to a target point. On placement, call `agent.resolveAt(target)`
  and attach `componentRef` (all three kinds anchor-resolve on creation).
- Compositor: on send/export, draw base screenshot (`Page.captureScreenshot`, png, full
  current viewport) to an offscreen canvas, then annotations, → PNG blob. Produce both clean
  and annotated PNGs.

### 4.5 Send to Prompt (`extension/copilot/`) 🔬

Command `uxCompanion.sendToPrompt`, default keybinding `ctrl+alt+p` / `cmd+alt+p`, plus toolbar
button. Composer builds:

```md
UX Companion context — {ISO timestamp}
URL: http://localhost:4200/admin/reports   Route: /admin/reports
Viewport: 375×812 @2x (iPhone preset) | forced: :hover on <selector> | emulation: deuteranopia,
prefers-color-scheme: dark | network: Slow 3G | intercept rules: 1 active (GET /api/reports → 500)
Annotated components:
[1] rect → UserCard — src/app/reports/user-card.component.ts  (alt: …, …)
    inputs: { compact: true, user: { name: "…", … } }
[2] callout "date picker should be above this" → ReportFilter — src/features/ReportFilter.tsx
    props: { range: "Q3" }  state: { open: false }
Images: (1) clean screenshot, (2) annotated screenshot — attached above
```

**The one shipped integration — attach to the native chat.** Always write both PNGs + the context
text to `.ux-companion/captures/<ts>/` in the workspace *first* (required — `attachFiles` is
existence-checked), then:

```ts
await vscode.commands.executeCommand('workbench.action.chat.open', {
  query: contextText,
  attachFiles: [cleanPngUri, annotatedPngUri],
  mode: 'agent',
});
```

Verified properties (VSCode 1.128.1):
- `.png/.jpe?g/.gif/.bmp/.webp` URIs become **real image attachments** (`kind: "image"`), not
  filename references — VSCode's `addFile` branches on extension into `asImageVariableEntry`.
- **Not gated by any API proposal** — this is what makes it Marketplace-shippable.
- **Zero keystrokes.** Confirmed end-to-end: Copilot in agent mode read a code word rendered into
  the attached PNG and echoed it back.
- Size cap **30 MB** (modal `"Image is too large"` above it). Screenshots are far below.
- Other accepted options: `isPartialQuery`, `previousRequests`, `toolIds`, `attachScreenshot`.

**Clipboard image write** ships as a convenience only (`uxCompanion.copyCaptureToClipboard`), for
pasting into *other* apps. It is **not** a chat channel: VSCode's chat paste handler
(`provideDocumentPasteEdits`) returns early unless some installed extension enables the
`chatReferenceBinaryData` API proposal, so on a stock install pasting an image into Copilot Chat
silently does nothing. Per-OS strategy (macOS verified 3/3 with read-back; Windows/Linux ⚠️
pending S7): reference implementation in `spikes/lib/clipboard.mjs`.

**Do not tell the user to paste screenshots.** Any instruction line should point at the saved
capture directory instead.

### 4.6 Feature specs (build in priority order — see milestones)

- **Inspector panel**: component tree (adapter `componentTree`), click-to-select ⇄
  click-in-page pick mode (crosshair, `resolveAt`); selected component shows props (read-only
  styling) and state/inputs (editable where `supportsWrite`): checkbox / number / text inputs,
  JSON editor (textarea + validate) for objects. Edits call `writeState`; refresh after write.
- **Rulers & guides**: toggleable top/left rulers (page CSS px, sync with scroll via screencast
  metadata); drag from ruler to create guide lines; guides snap to element edges (agent
  returns bounds of element under cursor); distance readout between two guides.
- **Breakpoint slider**: agent collects media-query breakpoints from
  `document.styleSheets` (`try/catch` cross-origin), dedupe px values; render as tick marks on
  a width slider; clicking a tick sets `Emulation.setDeviceMetricsOverride` to that width.
- **Device presets**: JSON catalog (iPhone SE/15/15 Pro Max, Pixel 8, iPad, Galaxy S24,
  Desktop 1080p/1440p) → metrics + DPR + touch (`Emulation.setTouchEmulationEnabled`) + UA
  (`Emulation.setUserAgentOverride`). Rotate button swaps w/h.
- **Responsive matrix**: N additional CDP targets (`Target.createTarget`) of the current URL at
  chosen widths, screenshot each, tile in a grid view; annotate any tile (annotations carry
  width in context). Static refresh model (button), not live streams.
- **Eyedropper + token provenance** 🔬: sample pixel from latest frame (canvas `getImageData`);
  display hex/rgb/hsl. For provenance use `CSS.getMatchedStylesForNode` — **all seven cases
  verified**, so this can promise more than "best effort": report the token name, the defining
  selector, the full `var()`-of-`var()` chain, and whether the value was inherited. Two mechanics
  are mandatory:
  1. **Use the response's `inherited` array as the ancestor chain** (ordered nearest-first, each
     entry carrying that ancestor's own matched rules). Searching element-own *and* inherited
     rules together at each level makes every token look like it was defined at `:root` and
     **silently loses parent overrides**. Walking manually via `DOM.describeNode().parentId` does
     **not** work — `parentId` is not populated there.
  2. **Handle shorthand expansion**: `background: var(--x)` is exposed as an expanded
     `background-color` longhand whose text no longer contains `var(`. Fall back to the
     shorthand's own declaration (`background`, `border`, `font`).

  Works inside **shadow DOM** (`:host` custom properties resolve correctly) — relevant to the
  deferred Lit adapter. Reference implementation: `spikes/s5-token-provenance.mjs`.
- **Contrast checker**: click two points or auto (text element → its bg by walking ancestors
  for effective background); compute WCAG 2.1 ratio + AA/AAA pass at detected font size/weight.
- **Emulation toggles**: `Emulation.setEmulatedVisionDeficiency` (none/protanopia/deuteranopia/
  tritanopia/achromatopsia/blurredVision); `Emulation.setEmulatedMedia` features:
  `prefers-color-scheme`, `prefers-contrast`, `forced-colors`, `prefers-reduced-motion`.
  All toggles feed the emulation-state line of the context payload.
- **A11y tree + axe**: selected element → `Accessibility.getPartialAXTree` (name, role, states,
  ignored reasons) in a panel; "Scan page" injects bundled axe-core (`axe.min.js` shipped in
  extension, injected on demand — never fetched), runs `axe.run`, renders violations list;
  clicking a violation highlights nodes (overlay rects) and can auto-create a callout
  annotation pre-filled with the violation text.
- **State lab**: (a) pseudo-state forcing — element picker + checkboxes mapped to
  `CSS.forcePseudoState` (requires `DOM`/`CSS` domains enabled and nodeId via
  `DOM.getNodeForLocation`); (b) request interception — rules table (method + URL substring →
  action: fail(status) | delay(ms) | mock(JSON body) ) implemented with `Fetch.enable` +
  `Fetch.requestPaused` → `fulfillRequest`/`failRequest`/`continueRequest`; (c) throttle
  presets — `Network.emulateNetworkConditions` (Slow 3G / Fast 3G / Offline / None);
  (d) storage profiles — snapshot/restore `localStorage` + `sessionStorage` (via agent) +
  cookies (`Network.getCookies`/`setCookies`), named profiles persisted in `globalState`;
  (e) state matrix — for selected element, iterate pseudo-state sets
  [none, :hover, :focus, :active, disabled-if-applicable], screenshot each (element-cropped
  via bounds), compose labeled grid PNG, open in annotation view.

---

## 5. Fixture apps (build these FIRST — everything tests against them)

Both must expose, with `data-testid`s and **known stable component names**:
`/` home with a `UserCard` (React) / `app-user-card` (Angular) rendering props/inputs
(`user`, `compact: boolean`), a button with distinct `:hover`/`:focus` styles, a themed color
using a CSS custom property (`--color-primary`), one intentional axe violation
(low-contrast text) and one missing-label input; `/list` fetching `/api/items` from a tiny
built-in dev-server middleware supporting `?delay=` and `?fail=` (loading spinner, error
banner, empty state, list states all reachable); media queries at 600px and 900px that
visibly change layout. React fixture: Vite, function components + hooks (`useState` count on
UserCard). Angular fixture: standalone components, one signal input/state. Pin exact
dependency versions. Ports: React 5173, Angular 4200.

🔬 **Contested-name fixture (source locator).** The point is to exercise each ranker signal in
§4.3 with a *deterministic* expected answer — a vague "same name twice" fixture can be satisfied
by a decoy that ranks trivially, and the test would pass while proving nothing. Build exactly:

| path | content | signal exercised | may win? |
|---|---|---|---|
| `react-app/src/components/UserCard/UserCard.tsx` | `export function UserCard` | exported-def +40, filename-exact +30 | ✅ **the expected answer** |
| `react-app/src/legacy/UserCard.tsx` | `const UserCard = …` (**not exported**) | filename-exact +30 but local-def only +10 | ❌ loses on export |
| `react-app/src/pages/Dashboard.tsx` | `import { UserCard }` + `const UserCardRow = …` | imports-it **−25** | ❌ consumer, not definition |
| `react-app/src/components/UserCard/UserCard.test.tsx` | `const UserCard = …` | noise-path **−35** | ❌ |
| `react-app/src/components/UserCard/UserCard.stories.tsx` | `const UserCard = …` | noise-path **−35** | ❌ |

Angular equivalent: declare selector `app-user-card` in
`angular-app/src/app/user-card/user-card.component.ts` (`@Component`, decorator +40), and mention
the same selector string in `user-card.component.spec.ts` and in a `demo/` template so the noise
penalty is exercised.

*M2 asserts:* the locator returns the ✅ row as **ranked top-1** (baseline first-match would
return `legacy/` or `components/` depending on file order — that ambiguity is the point), and
returns ≥ 2 alternates.

🔬 **esbuild fixture gotcha**: `nodePaths` is only a *fallback* — normal resolution from the entry
file's directory still wins and will silently link **two copies of React**. Symptoms:
`"Objects are not valid as a React child"` (React 18) and a null dispatcher
`"Cannot read properties of null (reading 'useState')"` (React 19). Use explicit
`alias: { react, 'react-dom' }` pointing at each fixture's own `node_modules`.

🔬 **Production-build fixture variant.** The `degraded: 'production-build'` path in §4.3 is
otherwise untestable, and it is the branch most likely to rot silently. Build the *same* React
fixture source a second time with `NODE_ENV=production` + minify, serve it on **port 5174**
(`fixtures:serve` starts both), and have it render the identical `UserCard`.

*M5 asserts, against 5174:* `inspectElement` still returns readable props
(`{ user: { name: … }, compact: false }`), `canEditFunctionProps === false` and
`canEditHooks === false` ⇒ `supportsWrite === false`, `degraded === 'production-build'`, and an
attempted `writeState` is refused by the adapter rather than silently no-op'ing. Component
identity is expected to be **wrong** here (`getDisplayNameForElementID` returns the host tag) —
assert that the adapter reports the degradation rather than emitting a bogus name into the
context payload.

---

## 6. Milestones (build in order; each ends green)

**M0 — Skeleton & harness.** Repo layout, esbuild for 3 bundles, activation + empty webview
panel (command `uxCompanion.open`), shared protocol module, vitest + test-electron wiring,
fixture apps + `fixtures:serve`, CI-style `npm test` that runs unit + integration + ext suites.
*Accept*: `npm run build && npm test` green; panel opens in test-electron.

**M1 — Embedded browser.** Discovery, launch, CDP connect, screencast rendering, input
forwarding, nav bar, resize handling, crash restart, dispose cleanup. **Fold in all three §4.1
corrections from the start** (DevToolsActivePort, lock reaping, kill-on-timeout) and the §4.2
forced repaint after `startScreencast`.
*Accept (integration)*: launch against React fixture, frames received (>0 within 3 s) **on a
static page** (proves the forced repaint works), typed text appears in fixture input (verified via
`Runtime.evaluate`), navigation to `/list` updates tracked URL; process exits on dispose; a
killed browser followed by a relaunch succeeds (proves lock reaping).

**M2 — Page agent + adapters (read).** Injection at document start, binding channel, Angular
+ React `detect/resolveAt/readState/componentTree`, serializer, source locator **with ranking**.
*Accept*: integration: `resolveAt` on UserCard center returns correct name + props in BOTH
fixtures; **source locator returns the right file as ranked top-1 for the contested-name fixture
case**, not merely for a unique name; production-build fixture reports
`degraded: 'production-build'` with props still readable.

**M3 — Annotations + capture.** Overlay canvas, browse/annotate modes, rect/arrow/callout,
callout text editing, component anchoring, compositor producing clean + annotated PNGs.
*Accept*: unit: geometry/serialization; integration: composited PNG differs from clean PNG,
annotation store round-trips; anchored `componentRef` matches M2 resolution.

**M4 — Send to Prompt (the integration).** ContextComposer (full payload format §4.5),
capture-to-`.ux-companion/`, `workbench.action.chat.open({ attachFiles, mode: 'agent' })`,
command + keybinding + button. Clipboard write as a separate optional command.
*Accept*: ext test: command produces both PNGs on disk + context text containing URL, component
name, ranked file path, viewport line; `workbench.action.chat.open` invoked with `attachFiles`
pointing at existing files and `mode: 'agent'`. (That the model *sees* the image is verified
manually — already done once in the spike round; keep it on the MANUAL-QA list.)

**M5 — Inspector + overrides.** *(Formerly M6. The `@ux` participant that occupied M5 is cut —
see §8.)* Inspector panel (tree, pick mode, props/state display), Angular writes
(`applyChanges`/signals), React writes via the renderer interface (§4.3).
*Accept*: integration: set `compact=true` on Angular UserCard → DOM class changes; set hook
state on React UserCard → rendered count changes, on **both** React 18 and 19 fixtures;
`supportsWrite` is `false` against the production-build fixture.

**M6 — Visual/responsive.** Rulers+guides+snap, breakpoint slider (parses fixtures' 600/900),
device presets, responsive matrix.
*Accept*: integration: breakpoints parsed = {600, 900}; metrics override at 600 changes fixture
layout (probe a media-query-dependent style); matrix produces N tiles at N widths.

**M7 — Color & a11y.** Eyedropper + token provenance, contrast checker, vision-deficiency +
media emulation toggles, a11y tree panel, axe scan + overlay + violation→callout.
*Accept*: integration: eyedropper on themed element reports `--color-primary` **and its defining
selector**, including the parent-override case and a shorthand-declared case; contrast on the
intentional low-contrast text computes ratio < 4.5 and axe scan reports ≥ 2 known violations;
`setEmulatedVisionDeficiency` call sequence verified.

**M8 — State lab.** Pseudo-state forcing UI, interception rules engine + panel, throttle
presets, storage profiles, state matrix capture.
*Accept*: integration: `:hover` forced on fixture button changes computed style; rule
`GET /api/items → 500` makes fixture show error banner; offline preset fails fetch; storage
profile round-trip restores a written key; matrix PNG has expected grid dimensions.

**M9 — Package & polish.** README (features, corporate-install/sideload instructions,
browser requirements, limitations incl. IME + prod-build notes + "screenshots attach
automatically; no pasting required"), CHANGELOG, icon placeholder, `vsce package` producing
installable `.vsix`, final full test pass, `MANUAL-QA.md` listing what CI cannot cover (live
Copilot send, Windows registry discovery, Windows/Linux clipboard, corporate-policy behaviour).

---

## 7. Conventions for the agent

- TypeScript strict; no `any` in `src/shared`. ESLint + prettier defaults; don't bikeshed.
- Every CDP domain use lives behind a small typed wrapper in `extension/browser/cdp.ts` —
  never call `client.send` raw from feature code.
- Webview state: zustand (small) — one store, slices per panel.
- All user-facing strings and keybindings centralized; settings under `uxCompanion.*`
  (`browserPath`, `screencastQuality`, `captureDir`). *(`integrationMode` dropped — there is only
  one integration path now.)*
- Commit per milestone minimum; message format `M<N>: <what>`. Never commit with failing tests
  except an explicitly-marked contingency commit.
- If a public API's exact shape is uncertain, **write the feature-detection/adapter seam first**,
  then the happy path — uncertainty must never leak past one file.
- 🔬 **Time-box every `vscode.lm` call.** `selectChatModels()` **hangs forever** (never resolves,
  never rejects) if `GitHub.copilot-chat` has not activated — call
  `vscode.extensions.getExtension('GitHub.copilot-chat')?.activate()` first, and wrap every call
  in a timeout. The first `sendRequest` from an unconsented extension likewise blocks on a modal
  consent prompt and never settles.
- 🔬 **Do not trust `@types/vscode` for `vscode.lm` capabilities.** It is pinned at **1.125.0**
  against a **1.128.1** runtime. The consumer-side `LanguageModelChat` declares no `capabilities`
  member at all, yet has one at runtime spelled **`supportsImageToText`** — while the typings
  declare `imageInput`, and only on the *provider*-side interface. `model.capabilities.imageInput`
  compiles and is always `undefined`. Use a hand-written narrowing type.
- 🔬 **Capability flags are necessary but not sufficient**: a model advertising
  `supportsImageToText: true` still returned `400 model_not_supported`. Always catch and fall back.
- 🔬 Fixtures must **alias React explicitly** in esbuild (see §5).

---

## 8. Contingency budgets & fallbacks

| Risk | Budget | Fallback |
|---|---|---|
| ~~`react-devtools-core` bridge over CDP wall fails~~ **RETIRED** 🔬 | — | Verified working on React 18 + 19 via direct renderer-interface calls. Budget reallocated. |
| ~~Screencast/input fidelity unusable~~ **RETIRED** 🔬 | — | Measured keystroke-to-pixel p50 21.6 ms, ext-host CPU < 2.5 %. |
| **Shipping `everyNthFrame > 1` as a bandwidth default** 🔬 | — | Don't. It destroys typing responsiveness (336 ms p50 at nth 4). Use idle-pause + quality. |
| **Source locator returns the wrong file** 🔬 | — | Measured 27–45 % wrong *without* ranking. Ship the §4.3 ranker table, return ranked alternates, never present one unranked path as authoritative. |
| **Angular adapter** (`window.ng` shape, signals, `applyChanges`) ⚠️ | 4 attempts / ~90 min | Now the least-verified adapter — the spike round covered React only. Fallback: Angular **read-only** (`supportsWrite = false`), keep the seam. |
| Corporate Copilot policy exposes no vision-capable model ⚠️ | — | Pending S7. Attach-to-native-chat still works (it never calls `vscode.lm`); context text degrades to paths only. |
| Corporate policy blocks `.vsix` sideload or `--remote-debugging-port` ⚠️ | — | Pending S7. Would be a distribution/architecture blocker — escalate rather than work around. |
| Clipboard image write on Windows/Linux ⚠️ | 1 attempt | Files-on-disk only on that OS; message updated. (Not on the critical path — clipboard is a convenience, not the chat channel.) |
| Angular fixture `window.ng` absent | — | Ensure fixture served with dev config (`ng serve`); adapters must report actionable "dev mode required". |
| Headless screencast quirk (blank frames on some page) | 2 attempts | First check it isn't the no-repaint case (§4.2). Then add `--disable-gpu` + software rendering; if still failing on one fixture, log + continue. |
| Responsive matrix target management flaky | 2 attempts | Sequential reuse of one target (navigate, resize, shoot, repeat) instead of parallel targets. |

---

## 9. Definition of done (session)

1. `npm run fixtures:setup && npm run build && npm test` fully green.
2. `npm run package` emits an installable `.vsix`.
3. Manual-QA checklist exists and is honest about what wasn't machine-verified.
4. Every milestone either complete or its fallback applied and documented in CHANGELOG.
5. 🔬 No shipped copy instructs the user to paste screenshots into chat (§4.5).
6. 🔬 `displayName` contains no third-party trademark (§1).
