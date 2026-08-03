# UX Companion — Research Spike Findings

Deliverable of the research-spike plan. Feeds amendments into `ux-companion-build-plan.md`
(referred to below as PLAN). **PLAN was not edited** — see §"PLAN amendments" at the end.

## Baseline environment (personal machine)

| Component | Version |
|---|---|
| OS | macOS 15.7.7 (build 24G720), Darwin 24.6.0, x64 |
| VS Code | **1.128.1** (commit `5264f2156cbcd7aea5fd004d29eaa10209155d66`) |
| GitHub Copilot Chat | **0.56.0** — *bundled inside the VS Code app* (`Resources/app/extensions/copilot`), publisher `GitHub`, extension id `GitHub.copilot-chat`. Not separately installed. |
| Node (spike scripts) | v24.9.0 |
| Node (VS Code extension host) | v24.17.0 |
| Browser | Google Chrome **150.0.7871.187**. **Microsoft Edge is NOT installed on this machine.** |
| `chrome-remote-interface` | 0.34.0 |
| `esbuild` | 0.28.1 |
| `react-devtools-core` | 6.1.5 |
| `@types/vscode` | 1.125.0 — **latest published; runtime is 1.128.1, a 3-minor gap** |
| React fixtures | 18.3.1 and 19.2.0 (pinned) |

> Copilot auth: personal GitHub Copilot subscription, signed in. All model results below are
> from that entitlement and **will differ under corporate policy** (see S7).

---

## S1 — Can we get an image into Copilot's real chat (agent mode)?

**Verdict: GO (route (a) programmatic attach)** · Confidence: **high** — confirmed end-to-end.
Environment: as above [personal]

### What was tried

1. Enumerated the runtime command surface from a throwaway extension
   (`spikes/s1-chat-probe`): `vscode.commands.getCommands(true)` → **3545 commands, 352**
   matching `/chat|copilot|attach/i`. Confirmed present: `workbench.action.chat.open`,
   `workbench.action.chat.attachFile`, `workbench.action.chat.attachContext`.
2. Static analysis of the shipped `workbench.desktop.main.js` to recover the **exact accepted
   options** of `workbench.action.chat.open` (rather than guessing by probing).
3. Ran `workbench.action.chat.open({ query, attachFiles: [pngUri], mode: 'agent' })` against a
   generated PNG containing the code word `MAGENTA-7734`.

### What worked

`workbench.action.chat.open` accepts an options bag including
`query`, `mode`, `isPartialQuery`, `previousRequests`, `toolIds`, `attachFiles`,
`attachScreenshot`, `attachHistoryItemChanges`.

The decisive code path, recovered verbatim from the 1.128.1 bundle:

```js
async addFile(e, t) {
  if (/\.(png|jpe?g|gif|bmp|webp)$/i.test(e.path)) {
    let i = await this.asImageVariableEntry(e);   //  -> kind: "image" attachment
    i && this.addContext(i);
    return;
  }
  ...
  else this.addContext(this.asFileVariableEntry(e, t));   // plain file reference
}
```

So `attachFiles` with a `.png` URI produces a **real image attachment** (`kind: "image"`), not a
filename reference. Key properties:

- **Zero keystrokes** — no clipboard, no paste, no user action.
- **Not gated by any API proposal.** `asImageVariableEntry` → `resolveImageEditorAttachContext`
  is called directly, with no `chatReferenceBinaryData` check on this path (contrast the paste
  path below). This is what makes it Marketplace-shippable.
- Size cap **30 MB**, else a modal error `"Image is too large"`. Screenshots are ~2 orders of
  magnitude under this.
- `attachFiles` entries are **existence-checked** (`await p.exists(C)`) — the PNG must already be
  on disk. PLAN §4.5 already writes captures to `.ux-companion/captures/<ts>/`, so this composes.
- `workbench.action.chat.open({ ..., mode: 'agent' })` returned **without throwing**, i.e. agent
  mode accepts the same options bag.

### What failed / important negatives

- **Clipboard paste into the chat input is API-proposal-gated.** From the bundle:

  ```js
  async provideDocumentPasteEdits(o,e,t,i,n){
    if(!this.extensionService.extensions.some(w=>tc(w,"chatReferenceBinaryData"))) return;
    let r=["image/png","image/jpeg","image/jpg","image/bmp","image/gif","image/tiff"]; ...
  ```

  Pasting an image into Copilot Chat **does nothing unless some installed extension enables the
  `chatReferenceBinaryData` proposal** (e.g. `ms-vscode.vscode-copilot-vision`, which the bundle
  lists as enabling exactly that). A Marketplace extension cannot enable proposals for itself,
  and it certainly cannot enable them on the user's behalf. **This substantially devalues PLAN
  §4.5's clipboard-bridge-as-primary framing** — the clipboard is not a reliable image channel
  into chat; it is only reliable as a "paste wherever you like" convenience.

- Attaching an *editor* as image context is gated the same way (`resolveEditorAttachContext`
  returns the image entry only `if (…some(n=>tc(n,"chatReferenceBinaryData")))`).

### End-to-end confirmation ✅

Chat opened in **agent mode** with the PNG attached via `attachFiles` and the prompt
*"What is the large pink code word in the attached image?"*. Copilot replied **`MAGENTA-7734`** —
the exact code word rendered into the PNG.

That is the full loop closed: a file written by the extension → `attachFiles` → a real image
attachment → **a vision model in agent mode actually read the pixels**, with zero keystrokes and
no API proposal. This is the product's core send-to-prompt mechanism, verified.

### Decision impact on PLAN

- **Reverses the integration priority.** PLAN §1 and M4/M5 treat the clipboard bridge as the
  shipped fallback and the `@ux` participant as primary. The evidence says the primary should be
  **`workbench.action.chat.open({ attachFiles, mode: 'agent' })`** — it is zero-keystroke,
  ungated, works in agent mode, and needs no `vscode.lm` call at all.
- PLAN §4.5's instruction line *"Screenshots: paste from clipboard (Cmd/Ctrl+V)"* is misleading
  on a stock install and should be rewritten.

**Keeper artifacts:** `spikes/s1-chat-probe/` (command enumeration + attach driver),
`spikes/_out/slice.mjs` (bundle-slicing helper — indispensable for auditing minified VS Code
internals; `grep -o '.\{N\}needle.\{N\}'` backtracks for minutes on a 40 MB single line).

---

## S2 — `vscode.lm` image parts + participant capabilities

**Verdict: GO for `vscode.lm` image parts · ADAPT (demote) for the chat participant**
Confidence: **high**
Environment: as above [personal]

### (a) Image parts — GO, on the **stable** API

`vscode.lm`, `vscode.lm.selectChatModels`, `vscode.LanguageModelDataPart.image`,
`vscode.chat.createChatParticipant`, `vscode.lm.invokeTool`, `vscode.lm.registerTool` are all
**present and functional with no `enabledApiProposals`**. `@types/vscode@1.125.0` declares
`LanguageModelDataPart.image(data, mime)` and accepts it in
`LanguageModelChatMessage.User(content: string | Array<…|LanguageModelDataPart>)`.

Models returned by `selectChatModels({ vendor: 'copilot' })` — **4 models**:

| id | family | maxInputTokens | `supportsImageToText` | `supportsToolCalling` |
|---|---|---|---|---|
| `gpt-4o-mini` | gpt-4o-mini | 12 078 | false | true |
| **`auto`** | **claude-haiku-4.5** | 127 790 | **true** | true |
| `copilot-utility-small` | copilot-utility-small | 12 078 | false | true |
| `copilot-utility` | copilot-utility | 127 790 | true | true |

**Proof the model actually receives pixels:** sent `LanguageModelDataPart.image(pngBytes,
'image/png')` with the prompt *"Reply with ONLY the large pink code word shown in this image"*.

- `auto` (claude-haiku-4.5) → replied **`MAGENTA-7734`** ✅ (exact match to the rendered PNG)
- Control (text-only, same model tier) → replied `PONG` in **939 ms**, confirming the image
  results are not an auth/consent artifact.

### Verbatim failures (these matter for feature detection)

```
gpt-4o-mini            400 {"error":{"message":"validating image item: image media type not supported","code":"invalid_request_body"}}
copilot-utility-small  400 {"error":{"message":"validating image item: image media type not supported","code":"invalid_request_body"}}
copilot-utility        400 {"error":{"message":"The requested model is not supported.","code":"model_not_supported","param":"model","type":"invalid_request_error"}}
```

**`copilot-utility` advertises `supportsImageToText: true` and still 400s.** The capability flag
is **necessary but not sufficient** — the send path must catch the 400 and fall back.

### Two API-shape traps

1. **Capability flag name differs between the typings and the runtime.**
   `@types/vscode@1.125.0` declares `LanguageModelChatCapabilities.imageInput` — and only on the
   *provider-side* `LanguageModelChatInformation`. The consumer-side `LanguageModelChat` returned
   by `selectChatModels` declares **no `capabilities` member at all** in the typings, yet at
   runtime it has one, spelled **`supportsImageToText`** (plus `supportsToolCalling`). Any code
   reading `model.capabilities.imageInput` compiles and is always `undefined`.
2. **`selectChatModels()` can hang forever.** If `GitHub.copilot-chat` has not activated, the
   promise **neither resolves nor rejects**. Fix: `await
   vscode.extensions.getExtension('GitHub.copilot-chat')?.activate()` first, and time-box every
   call. Observed directly — the probe sat indefinitely until activation was forced.
   Similarly the **first `sendRequest` from an unconsented extension blocks on a modal consent
   prompt** and also never settles until answered (4× 45 s timeouts recorded).

### (b) Participant capabilities — ADAPT (demote)

A participant registers on the **stable** API (`chatParticipants` contribution, no proposal) and
receives a rich request object:

```
requestKeys: prompt, command, sessionResource, references, toolReferences,
             toolInvocationToken, model, modelConfiguration, modeInstructions,
             modeInstructions2, permissionLevel, isSystemInitiated
model: "auto"   modelCapabilities: { supportsImageToText: true, supportsToolCalling: true }
vscode.lm.tools: 118 tools visible (copilot_applyPatch, copilot_replaceString,
                 copilot_createFile, copilot_insertEdit, copilot_runVscodeCommand, …)
```

**But the attached image did not arrive.** With a PNG attached via `attachFiles` and the request
routed to the participant, `references.length === 1` and the sole reference was
`vscode.customizations.index` (a `String`) — no image, no binary data.

Re-ran **with `enabledApiProposals: ["chatReferenceBinaryData"]` + `--enable-proposed-api`**:
**identical result** — still no image reference. So enabling that proposal is *not* sufficient to
make user-attached images reach a participant on 1.128.1.

**This is now unambiguous.** Initially two explanations were open — either `attachFiles` never
produced an attachment, or the attachment was produced but withheld from participants. S1's
end-to-end confirmation settles it: **the identical `attachFiles` call in the identical dev host
produced an image that the agent-mode model read back correctly** (`MAGENTA-7734`). The
attachment therefore exists; it is simply **not delivered to chat participants**. The participant
path is blind to it by design, not by misconfiguration.

Consequence: a participant cannot see what the user attached. It would have to re-read the PNGs
from disk itself (which it can, since we write them) and re-send them as
`LanguageModelDataPart.image` — meaning the participant adds a **second** model call and a second
bill, to show the model something the native agent already had.

The 118 visible tools mean a participant is *not* inherently text-only — it can invoke edit
tools. But it is a parallel, worse-funded agent loop competing with the real one.

### Decision impact on PLAN

- **M5 demoted from "primary" to optional/experimental**, or cut from this session.
  PLAN §1 "Copilot handoff: **Both** paths" should become: attach-to-native-chat is *the* path.
- `engines.vscode` pin: **`^1.128.0`**, because `attachFiles`-image behaviour and the runtime
  capability shape were verified there. Note `@types/vscode` lags at 1.125.0 — the capability
  field must be accessed through a hand-written narrowing type, not the shipped typings.
- PLAN §7's "write the feature-detection/adapter seam first" is strongly vindicated.

**Keeper artifacts:** `spikes/s1-chat-probe/extension.js` — the model/capability dump, the
forced-activation + timeout wrapper, and the text-only control are all directly portable into
`src/extension/copilot/`.

---

## S3 — `react-devtools-core` over a CDP binding (props/state overrides)

**Verdict: GO — and via a materially simpler architecture than PLAN §4.3 describes**
Confidence: **high** (empirically verified on both React versions)
Environment: Chrome 150.0.7871.187, `react-devtools-core` 6.1.5, React 18.3.1 + 19.2.0 [personal]

### Results

| Fixture | hook installs | renderer registers | element resolves | **prop override** | **hook-state override** |
|---|---|---|---|---|---|
| React 18.3.1 dev | ✅ | ✅ (v18.3.1) | ✅ id=3 | ✅ `compact=false→true`, class `card`→`card compact` | ✅ `count=0→42` |
| React 19.2.0 dev | ✅ | ✅ (v19.2.0) | ✅ id=3 | ✅ | ✅ |
| React 19.2.0 **prod** | ✅ | ✅ | ✅ id=3 | ❌ silent no-op | ❌ silent no-op |

### The architecture finding

PLAN §4.3 says to *"instantiate the devtools `Bridge` + `Store` from the frontend package"* over a
custom wall. **That is not possible as written:** `react-devtools-core` publishes only
`backend.js` and `standalone.js`. `Bridge`/`Store` live in `react-devtools-shared`, which is
**not published to npm**; `standalone` is the whole Electron DevTools *UI* (it renders into a DOM
node and starts a WebSocket server) — not an embeddable host-side protocol client.

**None of that is needed.** The backend installs the global hook and attaches a *renderer
interface* per React root, and we can call it **directly** via `Runtime.evaluate`:

```js
const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
const rid  = Array.from(hook.rendererInterfaces.keys())[0];
const ri   = hook.rendererInterfaces.get(rid);          // 37 methods
const id   = ri.getElementIDForHostInstance(document.elementFromPoint(x, y));
ri.inspectElement(null, id, null, false);               // props + hooks + editability
ri.overrideValueAtPath('props', id, null, ['compact'], true);
ri.overrideValueAtPath('hooks', id, /*hookID*/ 0, [], 42);
```

So: **no Bridge, no Store, no custom wall, no `Runtime.addBinding` message pump, no
protocol/`operations` decoding, no WebSocket.** Injection still must happen at document-start via
`Page.addScriptToEvaluateOnNewDocument` (PLAN is right about that — the hook must exist before
React registers).

`connectWithCustomMessagingProtocol({onSubscribe,onUnsubscribe,onMessage,onSettingsUpdated})`
*does* exist as a sanctioned custom-wall API if a full Store is ever wanted — but it is not
needed for resolve/read/write.

### The trap that cost the most time

`overrideValueAtPath` on the renderer interface is **positional**:

```js
overrideValueAtPath(type, id, hookID, path, value)
```

The `{id, rendererID, type, path, value}` **object** form — which is what the *Bridge* sends over
the wall, and the shape most naturally inferred from the devtools source — **fails silently**
(a `console.warn` at most, no throw, no DOM change). First attempt looked exactly like "overrides
don't work." Anyone re-deriving this will hit it.

### What the renderer interface gives us for free

Everything `ComponentInfo` (PLAN §4.3) needs, from one `elementFromPoint`:

```
displayName: "UserCard"            (getDisplayNameForElementID)
hostInstances: ["DIV#usercard"]    (findHostInstancesForElementID → bounds)
ownersList: ["App", "UserCard"]    (getOwnersList → ancestry / tree)
props: { user: {name:"Ada Lovelace"}, compact:false }
hooks: [{ id:0, name:"State", value:0, isStateEditable:true }]
canEditFunctionProps: true   canEditHooks: true
```

### Production builds — better and worse than assumed

- **Better:** props and hook values are still **readable** on a production React 19 build
  (`{user:{name:"Ada Lovelace"}, compact:false}`). PLAN implies prod is a dead end; read-only
  inspection actually survives.
- **Worse:** component identity is lost — `getDisplayNameForElementID` returns `"H2"` (the host
  element), and `ownersList` is `["H2"]`. Names are unusable for the source locator in prod.
- **Detection signal:** `inspectElement().canEditFunctionProps` / `.canEditHooks` are `true` in
  dev and **`false` in prod**. That is exactly the right source of truth for
  `FrameworkAdapter.supportsWrite` — derive it, don't hardcode it.
  Do **not** use the per-hook `isStateEditable`: it stayed `true` even in prod, and is misleading.

### Decision impact on PLAN

- Rewrite §4.3's React paragraph: drop Bridge/Store/wall; specify hook injection at
  document-start + direct renderer-interface calls; document the positional signature.
- The §8 contingency *"react-devtools-core bridge over CDP wall fails → ship read-only"* is very
  unlikely to trigger. M6's React half is much cheaper than budgeted.
- `supportsWrite` becomes a runtime-derived value, and read-only still works on prod builds
  (with degraded naming) — a better story than "prod build? give up".

**Keeper artifacts:** `spikes/s3-react-devtools.mjs`, `spikes/fixtures/app.jsx`,
`spikes/build-fixtures.mjs`, `spikes/lib/launch.mjs`.

> Fixture gotcha worth carrying into PLAN §5: esbuild's `nodePaths` is only a *fallback*;
> normal resolution from the entry file's directory still won. That silently linked **two copies
> of React** — symptoms were `"Objects are not valid as a React child"` (18) and a null
> dispatcher `"Cannot read properties of null (reading 'useState')"` (19). Use explicit
> `alias: { react, 'react-dom' }` per fixture.

---

## S4 — Screencast performance & input fidelity budget

**Verdict: GO (CDP transport side) · input-fidelity half NOT verified**
Confidence: **high** for the measured axis, **none** for subjective feel
Environment: Chrome 150.0.7871.187, 1280×800 cap, 5 s samples [personal]

### Measured matrix (JPEG; static page vs page with a running CSS animation)

| quality | everyNth | page | fps | median age | p95 age | avg KB/frame |
|---|---|---|---|---|---|---|
| 40 | 1 | static | 15.6 | 4.7 ms | 10.6 ms | 28.8 |
| 60 | 1 | static | 19.8 | 4.3 ms | 5.6 ms | 34.8 |
| 80 | 1 | static | 19.8 | 4.8 ms | 5.8 ms | 43.2 |
| 60 | 2 | static | 9.8 | 4.5 ms | 5.7 ms | 34.4 |
| 60 | 4 | static | 4.8 | 4.9 ms | 5.4 ms | 35.1 |
| 40 | 1 | **animated** | **59.8** | 4.4 ms | 5.4 ms | 28.7 |
| 60 | 1 | **animated** | **60.0** | 4.6 ms | 5.6 ms | 34.5 |
| 80 | 1 | **animated** | **59.8** | 4.5 ms | 5.6 ms | 43.4 |
| 60 | 2 | animated | 29.8 | 4.7 ms | 6.0 ms | 34.9 |
| 60 | 4 | animated | 14.8 | 4.5 ms | 5.9 ms | 34.3 |

- **Frame age is a non-issue on the CDP side**: median 4.3–4.9 ms, p95 ≤ 10.6 ms in *every*
  combo — far inside the 200 ms budget. Latency is not where this architecture will hurt.
- **Throughput is the real cost.** An animated page at `everyNthFrame: 1` streams a sustained
  **60 fps × ~34.5 KB ≈ 2.1 MB/s** of base64 through `postMessage` into the webview. PLAN §4.2's
  default (`quality: 70, everyNthFrame: 1`) will do exactly this whenever the user's app has any
  looping animation.
- Quality is cheap: q40→q80 is only **+50 %** bytes (28.8→43.2 KB). Quality is the wrong knob to
  economise on; **frame rate is the right one**.
- Static-page fps (≈20) is bounded by my 50 ms mutation driver, not by CDP — do not read it as a cap.
- **Drop policy verified**: latest-frame-wins with an ~8 ms simulated draw never queued more than
  2 undrawn frames (`maxUndrawn` ≤ 2, `droppedStale` ≤ 3).
- **Ack-every-frame confirmed as mandatory** (PLAN §4.2 correct): withholding
  `Page.screencastFrameAck` stalls the stream outright.
- **Resume latency after `stopScreencast` → `startScreencast`: 12 ms** — the idle-pause/resume
  design is essentially free (target was < 300 ms).

### Scope of this half

This measured the **CDP delivery path in Node only** — not the webview transport, draw cost, or
input forwarding. Those are covered in **S4b** below, which **overturns the default recommended
here**. Read S4b before acting on this table.

**Keeper artifacts:** `spikes/s4-screencast.mjs`, `spikes/fixtures/screencast.html`.

---

## S4b — Input fidelity, webview draw cost, keystroke-to-pixel

**Verdict: GO** · Confidence: **high** (automated) / manual feel test appended below
Environment: VS Code 1.128.1 webview, Chrome 150, 1024×768 metrics override [personal]

Real VS Code webview + CDP screencast + full input forwarding
(`Input.dispatchKeyEvent` with keycode table, `dispatchMouseEvent` incl. wheel).

**Method — subjective question turned into a number.** A script injected at document-start adds a
48 px high-contrast patch that flips on every `keydown`/`mousedown`/`wheel`. After each canvas
draw the webview samples that pixel. **keystroke-to-pixel = flip becomes visible − key pressed**,
covering the entire round trip: webview → host → CDP → page → repaint → screencast → draw.
Keystrokes are synthesised on the canvas (same code path as a human keypress), so the metric is
collected without a human in the loop.

### Automated sweep (18 s per setting)

| setting | **keystroke-to-pixel p50** | p95 | n | frame age at draw p50 | transport p50 | draw p50 | frames | ext-host CPU |
|---|---|---|---|---|---|---|---|---|
| q60 · **everyNth 1** | **21.6 ms** | 212 ms | 46 | 15 ms | 2 ms | 0 ms | 60 | 0.7 % |
| q60 · everyNth 2 | 83.6 ms | 356 ms | 4 | 17 ms | 2 ms | 0 ms | 15 | 1.8 % |
| q60 · everyNth 4 | **336 ms** | **2686 ms** | 5 | 19 ms | 2 ms | 0 ms | 7 | 2.4 % |
| q80 · everyNth 2 | 28.6 ms | 1837 ms | 6 | 18 ms | 2 ms | 0 ms | 15 | 0.9 % |

### ⚠️ This reverses the S4 recommendation

**`everyNthFrame` multiplies input latency, and PLAN §4.2's original `everyNthFrame: 1` was
right.** My S4 amendment recommending `everyNthFrame: 2` was derived from a *continuously
animating* page, where frames are abundant and skipping them costs nothing perceptible. Real UI
work is the opposite: a mostly-static page **only repaints in response to your input**, so
skipping every Nth frame means waiting N repaints to see your own keystroke. At `everyNthFrame: 4`
that is a **336 ms median and a 2.7 s p95** — unusable for typing.

Bandwidth must therefore be controlled by **pausing when idle** (12 ms resume, measured in S4) and
by **quality**, never by frame-skipping while the user is interacting.

> Sample sizes for the skipped-frame rows are small (n = 4–6) precisely *because* those settings
> produce so few frames — the probe waits for each flip before measuring the next. The effect
> size is large and the mechanism is clear, but treat those p95s as indicative, not precise.

### Webview transport and draw are cheap in steady state

- `postMessage` host→webview of a base64 JPEG: **p50 2 ms**
- `drawImage` onto the canvas: **p50 ~0 ms** (sub-millisecond)
- End-to-end frame age at draw: **15–19 ms** (vs 4.6 ms at the CDP boundary — the webview path
  adds only ~10–15 ms)
- Extension-host CPU: **0.7–2.4 %**

An earlier reading of *transport p95 203 ms / frame age 130 ms* came from an 8-frame startup
sample dominated by first-image decode warmup; it did not survive a real sample and should be
disregarded.

### Two mechanics worth carrying into the build

1. **Screencast emits frames ONLY on repaint.** A fully static page produces **zero** frames, so
   the canvas stays blank on load until the user does something. Every `startScreencast` (and
   every restart after a settings/metrics change) must be followed by a **forced repaint** or the
   viewport looks broken. Corollary: idle detection is nearly free — no repaint means no frames,
   automatically.
2. **Latest-frame-wins held up** under a real `requestAnimationFrame` draw loop: never more than
   one undrawn frame retained, no queue growth.

### Decision impact on PLAN

- §4.2 defaults ← **`quality: 60, everyNthFrame: 1`**. Do **not** ship frame-skipping as the
  bandwidth lever; use idle-pause plus quality.
- Add: force a repaint after every screencast (re)start.
- Add a keycode table (implemented here) — printable keys need `keyDown` + `char` + `keyUp`;
  non-printable use `rawKeyDown`.

**Keeper artifacts:** `spikes/s4-webview-ext/` — the whole probe is a working prototype of
`session/screencast.ts` + `webview/browser-view/`, including coordinate mapping via a fixed
`setDeviceMetricsOverride`, the keycode table, latest-frame-wins, and the latency instrumentation
(worth keeping as a permanent perf regression harness). Raw: `_out/s4-sweep-results.json`.

---

## S5 — CSS custom-property provenance (eyedropper token resolution)

**Verdict: GO — exceeds the bar** (plan asked for a–c solid, d/e best-effort; **all 7 cases pass,
including shadow DOM**) · Confidence: **high**
Environment: Chrome 150.0.7871.187 via `CSS.getMatchedStylesForNode` [personal]

| case | computed | token | resolved provenance |
|---|---|---|---|
| (a) direct hex | `rgb(23,162,184)` | — | correctly reports *no* var |
| (b) `var()` from `:root` | `rgb(47,129,247)` | `--color-primary` | `:root` → `#2f81f7` |
| (c) **overridden on a parent** | `rgb(224,49,49)` | `--color-primary` | **`.parent` → `#e03131`** ✅ |
| (d) var-of-var | `rgb(47,129,247)` | `--brand` | `--brand` → `var(--color-primary)` → `#2f81f7` |
| (e) inherited `color` | `rgb(47,129,247)` | `--color-primary` | `:root` → `#2f81f7`, flagged inherited |
| (f) `background:` **shorthand** | `rgb(47,129,247)` | `--color-primary` | resolved via shorthand fallback |
| (g) **shadow DOM** | `rgb(156,54,181)` | `--sd` | `:host` → `#9c36b5` |

Every resolved chain's terminal value matches the independently-computed style.

### Two non-obvious mechanics (both were bugs first)

1. **Use `getMatchedStylesForNode(...).inherited` as the ancestor chain** — it is ordered
   nearest-ancestor-first and each entry carries *that ancestor's own* matched rules. Two wrong
   turns: (i) searching element-own **and** inherited rules together at each level makes every
   token look like it was defined at `:root` and **silently loses parent overrides** (case c
   reported blue `#2f81f7` while the element actually rendered red); (ii) walking manually via
   `DOM.describeNode().parentId` does **not** work — `parentId` is not populated there.
2. **Shorthands lose the `var()`.** `background: var(--x)` is exposed as an *expanded*
   `background-color` longhand whose text no longer contains `var(`. Detecting tokens requires
   falling back to the shorthand's own declaration (`background`, `border`, `font`).

### Decision impact on PLAN

§4.6's eyedropper spec is achievable **as written**, and can promise more than it currently does:
name the token, the defining selector, the full `var`-of-`var` chain, and whether the value was
inherited — including inside shadow DOM (relevant to the deferred Lit adapter). The M8
acceptance criterion *"eyedropper on themed element reports `--color-primary`"* is safe.

**Keeper artifact:** `spikes/s5-token-provenance.mjs` (the resolver is directly portable),
`spikes/fixtures/tokens.html`.

---

## S6 — Clipboard image write (cross-OS)

**Verdict: GO on macOS · Windows & Linux UNVERIFIED (deferred to S7 run-book)**
Confidence: **high** (macOS), **none** (Windows/Linux)

- **macOS: 3/3 consecutive successes with verified read-back.**
  `osascript -e 'set the clipboard to (read (POSIX file "…") as «class PNGf»)'`, verified via
  `clipboard info` matching `PNGf|TIFF`. Baseline check confirmed the clipboard was empty first,
  so the passes are not false positives from prior state.
- **Windows / Linux:** written but **not executed** — no such machine here. The Windows strategy
  (`powershell -NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -File …` writing via
  `System.Windows.Forms.Clipboard::SetImage`, then verifying with `ContainsImage()`) is in the
  keeper utility and in the S7 run-book as a 3-run test.

### Important interaction with S1

Even where the clipboard write succeeds, **pasting into Copilot Chat is gated on the
`chatReferenceBinaryData` proposal** (S1). So a green clipboard result does **not** imply the
image reaches chat. On a stock install the clipboard is useful for pasting into *other* apps —
not as the chat image channel. PLAN §4.5's fallback copy must stop promising otherwise.

**Keeper artifact:** `spikes/lib/clipboard.mjs` — `writeImageToClipboard(path) →
'ok' | 'unsupported' | throws`, per-OS strategy with read-back verification. Promote to
`src/extension/copilot/clipboard.ts`.

---

## S7 — Corporate-environment viability 🏢

**Verdict: PREPARED — awaiting execution on the work laptop** · Confidence: n/a

Self-contained folder built and **self-tested on the personal machine**:

| Artifact | Purpose | Local self-test |
|---|---|---|
| `s7-corp-probe/probe.vsix` (1.85 KB) | sideload test; reports VS Code/Node versions and whether `vscode.lm` + image parts exist | packaged OK via `@vscode/vsce` |
| `s7-corp-probe/probe-browser.mjs` | registry (`reg query`) + path discovery, headless launch, CDP handshake — **zero npm deps** | `{"ok":true,"via":"DevToolsActivePort","port":60095,"browser":"Chrome/150.0.7871.187","protocol":"1.3"}` |
| `s7-corp-probe/probe-net.mjs` | proxy env, `npm config`, per-endpoint HTTPS reachability, real `npm install --dry-run` of the dependency set | runs |
| `s7-corp-probe/RUNBOOK.md` | 6-step copy-paste run-book, states what to capture when a step *fails* | — |

Both probes use only Node builtins, so they run before any `npm install` succeeds — deliberate,
since "can we even install?" is one of the questions.

**Highest-value unknowns it will settle:** whether sideloading is blocked by an allowed-extensions
policy; whether endpoint security blocks `--remote-debugging-port`; whether
`update.code.visualstudio.com` is reachable (decides if `test:ext` can run at work at all);
and **whether the corporate Copilot entitlement exposes a vision-capable model to an extension** —
if it does not, the S2 findings do not transfer and attach-to-native-chat becomes the only option.

---

## S8 — Source-locator accuracy

**Verdict: ADAPT — the plan's locator as written misses ~1 in 3; with rankers it clears the bar**
Confidence: **medium-high** (real repos, independent ground truth; small contested sub-samples)
Environment: `excalidraw/excalidraw` @ depth-1 (300 `.tsx`), `angular/components` @ depth-1
(2 338 `.ts`) [personal]

### Method

Ground truth is derived by a **different** method than the locator under test, so the two can
disagree: truth = parse actual definition sites (`export function X` / `export const X =` /
`export class X extends Component`; `@Component({selector})`); locator = the naive cross-repo text
search §4.3 specifies (`function|const|class <Name>`, `selector: '<hint>'`). Only components whose
truth is unambiguous are scored. Sampling is **stratified**: half the sample is the most
*contested* names in the repo (those the locator returns multiple candidates for), because that is
where ranking actually matters.

### Results

| repo | components | contested | sample | **baseline top-1** (PLAN as written) | **ranked top-1** | ranked top-3 |
|---|---|---|---|---|---|---|
| excalidraw (React) | 287 | 5 (2 %) | 15 | **73 %** | **87 %** | 100 % |
| angular/components | 676 | 44 (7 %) | 20 | **55 %** | **95 %** | 95 % |

Restricted to **contested** components only (median 3 candidates, max 18):

| repo | baseline top-1 | ranked top-1 | n |
|---|---|---|---|
| excalidraw | 20 % | **60 %** | 5 |
| angular/components | 10 % | **90 %** | 10 |

### What this means

- **PLAN §4.3 as written is not good enough.** "Return best match + up to 2 alternates" with no
  ranking means *first match in file order* — **55–73 % top-1**, and only **10–20 %** on exactly
  the ambiguous cases where the user most needs the right file. A wrong file path in the context
  payload is worse than no path: it sends Copilot to edit the wrong component.
- **Cheap rankers fix it.** Adding them lifts top-1 to **87 % (React) / 95 % (Angular)**, clearing
  the spike's 80 % bar. The ranker set that did it:

  | signal | weight | rationale |
  |---|---|---|
  | exported definition (`export (default )?(function\|const\|class) Name`) | +40 | definition, not usage |
  | `@Component`/`@Directive` decorator present (Angular) | +40 | real declaration site |
  | filename === component name (exact / kebab) | +30 | dominant convention |
  | containing directory === component name | +18 | `Foo/index.tsx` layout |
  | filename partially matches | +12 | weak signal |
  | inside `src/` | +5 | prefer source trees |
  | **file also imports the same name** | **−25** | it is a **consumer**, not the definition |
  | test/spec/story/demo/example/fixture path | −35 | usage sites, not definitions |
  | `.d.ts` | −40 | declarations, not implementations |
  | path depth | −0.5 each | prefer shallower |

- **Angular is easier than React**, opposite to what I'd have guessed: `selector:` +
  `@Component` is a near-unique fingerprint, whereas React's `const Foo =` matches styled
  components, local helpers, re-exports and stories.
- **Contested names are a minority** (2 % React / 7 % Angular) but they are the *popular* ones
  (`combobox`, `cdk-table`, `mat-table` — up to 18 candidates), i.e. disproportionately what a
  user clicks on.

### Honest limits

- Contested sub-samples are small (n = 5 and 10). The direction is unambiguous (baseline 10–20 %
  → ranked 60–90 %) but the exact percentages are soft.
- **Two of my first-round "misses" were ground-truth bugs, not locator failures.** I initially
  skipped compound Angular selectors (`'cdk-table, table[cdk-table]'`), which dropped the
  canonical definition and left a spurious one — making the locator look wrong for `cdk-table`
  and `mat-table` when it was right. Fixing that moved Angular from 85 % → **95 %**. The one
  residual React-style miss (`combobox`) is the same class of artifact.
- Both repos are **libraries**, where naming conventions are unusually disciplined. A product
  monorepo with `Button` defined in four packages would be harder; treat these as an
  **upper bound**.
- Not tested: route-segment path proximity (needs a running app's route, which the locator has at
  runtime but the harness did not). That is an *additional* signal likely to help most on exactly
  the contested cases.

### Decision impact on PLAN

- §4.3's locator paragraph must specify **ranking**, not just search. Ship the table above.
- Return **ranked alternates** and surface them in the payload — top-3 is 95–100 %, so when
  top-1 is wrong the right answer is almost always listed.
- **Feed the locator S3's `ownersList` ancestry** (`["App","UserCard"]`) as an extra ranking
  signal: prefer candidate files whose directory matches an ancestor component name.
- Add the "file imports this name ⇒ it is a consumer" rule explicitly — it was the single most
  useful negative signal.
- M2's acceptance criterion should assert **ranked** top-1 on a contested fixture name, not just
  "finds the right file" for a unique one, or it will pass while the real behaviour is 55 %.

**Keeper artifacts:** `spikes/s8-source-locator.mjs` (scorer + ranker; the `score()` function is
directly portable to `src/extension/source-locator.ts`), `_out/s8-results.json`,
`_out/s8-console.txt`. Repos cloned to `_repos/` (git-ignored, ~133 MB, deletable).

---

## S9 — Naming & marketplace policy

**Verdict: ADAPT — rename before publish** · Confidence: **medium** (no rule explicitly
adjudicates "X for Copilot"; the risk is inferred from general trademark policy)

- VS Code's own manifest reference constrains only **uniqueness**: *"The name of the extension -
  should be all lowercase with no spaces. The name must be unique to the Marketplace."* and the
  same for `displayName`. **No trademark guidance there.**
- **GitHub Copilot Extension Developer Policy** grants only *"a limited, revocable, worldwide,
  non-exclusive, non-transferable license to use our trademarks … in accordance with our
  trademark policy"*, and requires: *"you promise not to state or imply that we have developed,
  endorsed, reviewed or otherwise approved of any of your Extensions."*
- **GitHub trademark/logo policy**: you should not name projects, domains, or products with
  anything that implies GitHub's endorsement, and GitHub marks must not be used in a way
  suggesting your offering is by GitHub or endorsed by it.

**Assessment.** PLAN §1's locked name **`UX Developer Companion for Copilot`** puts a GitHub mark
in the product name itself. That is the pattern the policies most directly caution against, and
Marketplace takedowns for third-party extensions carrying vendor marks are routine. I could not
find any rule *expressly permitting* "for Copilot" compatibility phrasing in a `displayName`, so
this is a real, if unquantified, publication risk rather than a settled prohibition.

**Recommendation:** keep the mark out of `name`/`displayName`; use compatibility phrasing in the
**description**, where nominative use is far more defensible:

| | Proposal |
|---|---|
| Display name (1st choice) | **UX Developer Companion** |
| Display name (2nd choice) | **Pixel Pilot — UI Dev Companion** |
| Description | "Embedded browser, component inspector, and annotated screenshots — **works with GitHub Copilot Chat.**" |
| Participant handle (1st) | `@uxdev` |
| Participant handle (2nd) | `@uxlab` |

**On the `@ux` handle:** I could not verify collisions — the Marketplace exposes no queryable
index of contributed chat-participant names, so this cannot be settled by research alone. `ux` is
short and generic enough to be a plausible collision, which is the main argument for `@uxdev`.
Given S2's recommendation to demote the participant entirely, this may become moot.

Sources: [Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest) ·
[GitHub Copilot Extension Developer Policy](https://docs.github.com/en/site-policy/github-terms/github-copilot-extension-developer-policy) ·
[GitHub Trademark Policy](https://docs.github.com/en/site-policy/content-removal-policies/github-trademark-policy) ·
[GitHub Logo Policy](https://docs.github.com/en/site-policy/other-site-policies/github-logo-policy) ·
[VS Marketplace Publisher Agreement](https://cdn.vsassets.io/v/M146_20190123.39/_content/Visual-Studio-Marketplace-Publisher-Agreement.pdf)

---

# PLAN amendments

Diff-style. **PLAN was not edited** — review these first.

### §1 Locked decisions

- **`Name`** — ~~`UX Developer Companion for Copilot`~~ → **`UX Developer Companion`**; move
  "works with GitHub Copilot Chat" into the description. Handle ~~`@ux`~~ → `@uxdev` *(S9)*.
- **`Copilot handoff`** — ~~"**Both** paths: `@ux` chat participant (primary) and clipboard-bridge
  fallback"~~ → **"Primary and only shipped path: attach captures to the native chat via
  `workbench.action.chat.open({ attachFiles, mode: 'agent' })`. Clipboard write is a
  convenience for pasting elsewhere, **not** an image channel into chat. `@ux` participant
  deferred."** *(S1, S2, S6)*
- **`Browser`** — add: Edge is **not** present on the primary dev machine; Chrome 150 is the
  verified target. Keep Edge first in discovery order, but fixtures/tests must not assume it.

### §4.1 Browser discovery & launch — three corrections

- ~~"Parse the actual port/ws URL from stderr"~~ → **read `<user-data-dir>/DevToolsActivePort`
  (line 1 = port, line 2 = ws path); keep stderr parsing only as a fallback, and accumulate
  stderr across chunks.** The DevTools line is real but arrives interleaved with heavy macOS
  noise (`trust_store_mac`, `CVDisplayLink`) and **can split across chunk boundaries** — a
  single-chunk regex misses it.
- **Add stale-lock reaping.** A killed browser leaves `SingletonLock`/`SingletonSocket`/
  `SingletonCookie`; the next launch **aborts with exit code 21**
  (*"Failed to create a ProcessSingleton for your profile directory"*). Reap them before launch.
- **`browser-profile-<id>` is load-bearing, not cosmetic** — an orphaned process holding a shared
  profile makes the next launch hang. Also: the timeout path **must** kill the child, or it
  orphans a live Chrome that poisons every subsequent run (hit this directly).

### §4.2 Screencast defaults

- ~~`quality: 70, everyNthFrame: 1`~~ → **`quality: 60, everyNthFrame: 1`**. **Keep
  `everyNthFrame: 1`** — PLAN was right. Frame-skipping multiplies keystroke-to-pixel latency
  (21.6 ms → 83.6 ms → **336 ms** at nth 1/2/4), because an interactive page only repaints in
  response to input. *(S4b)*
- Control bandwidth with **idle-pause** (12 ms resume, measured) and **quality**, never with
  frame-skipping while the user is interacting. The 2.1 MB/s animated-page figure from S4 is
  real but is an *idle-throttling* problem, not a frame-skipping one.
- Keep ack-every-frame and latest-frame-wins — both verified against a real webview draw loop.
- **Add:** force a repaint after every `startScreencast` / restart. Screencast emits frames only
  on repaint, so a static page yields **zero** frames and the canvas stays blank on load.
- **Add:** keycode table — printable keys need `keyDown` + `char` + `keyUp`; non-printable use
  `rawKeyDown`. Working implementation in `spikes/s4-webview-ext/`.

### §4.3 Page agent & adapters — rewrite the React paragraph

- ~~"Wire its wall/bridge to the CDP binding channel … `installHook` → `initBackend` with a
  custom `wall` … Use the bridge's element inspection"~~ →
  **"Inject the `react-devtools-core` backend at document-start via
  `Page.addScriptToEvaluateOnNewDocument` and call the renderer interface directly through
  `Runtime.evaluate`: `__REACT_DEVTOOLS_GLOBAL_HOOK__.rendererInterfaces.get(rid)` exposes
  `getElementIDForHostInstance`, `inspectElement`, `getDisplayNameForElementID`,
  `findHostInstancesForElementID`, `getOwnersList`, `overrideValueAtPath` (37 methods). No
  Bridge, no Store, no custom wall, no binding message pump."**
- **Add a warning:** `overrideValueAtPath` is **positional** — `(type, id, hookID, path, value)`.
  The object form fails **silently**.
- **`supportsWrite`** ← derive from `inspectElement().canEditFunctionProps` / `.canEditHooks`
  (true in dev, false in prod). Do **not** use per-hook `isStateEditable` (true even in prod).
- **Prod builds:** props/hooks remain **readable**; only names degrade (`"H2"`). Change the
  "prod build?" hint from *"give up"* to *"read-only, names unavailable"*.
- **Source locator: add ranking (S8).** Search alone is **55–73 %** top-1 and only **10–20 %** on
  contested names; the ranker table in S8 lifts it to **87–95 %**. Return ranked alternates
  (top-3 = 95–100 %). Feed it `displayName` + `ownersList` ancestry. Expect ~0 accuracy against
  production bundles, where S3 showed the name degrades to the host tag.

### §4.5 Send to Prompt — rewrite the integration section

- **Primary** ← `workbench.action.chat.open({ query, attachFiles: [cleanPng, annotatedPng],
  mode: 'agent' })`. Ungated, zero-keystroke, real image attachments, 30 MB cap, files must exist
  on disk first.
- ~~"Screenshots: paste from clipboard (Cmd/Ctrl+V)"~~ → drop. Pasting images into chat requires
  the `chatReferenceBinaryData` proposal to be enabled by *some installed extension*; on a stock
  install it silently does nothing.
- Keep writing both PNGs + context to `.ux-companion/captures/<ts>/` — now doubly required,
  since `attachFiles` is existence-checked.

### §4.6 Eyedropper — can promise more

Resolve via `CSS.getMatchedStylesForNode`, using its **`inherited`** array as the ancestor chain.
Report token name, defining selector, full `var`-of-`var` chain, inherited flag; works in shadow
DOM. Must handle the **shorthand→longhand** expansion that drops `var()`.

### §7 Conventions — add

- **Time-box every `vscode.lm` call.** `selectChatModels()` hangs forever if
  `GitHub.copilot-chat` has not activated; activate it explicitly first. The first `sendRequest`
  from an unconsented extension blocks on a modal and never settles.
- **Do not trust `@types/vscode` for `vscode.lm` capabilities** — it is pinned at 1.125.0 against
  a 1.128.1 runtime, and the consumer-side capability shape (`supportsImageToText`) is
  undeclared and differently named from the provider-side (`imageInput`).
- **Fixtures must alias React explicitly** in esbuild; `nodePaths` alone yields two React copies.

### §8 Contingency budgets

- **react-devtools bridge risk → effectively retired** (S3).
- **Screencast/input-fidelity risk → retired** (S4b): keystroke-to-pixel p50 **21.6 ms** at the
  recommended settings, ext-host CPU < 2.5 %.
- **Add a row:** *source locator returns the wrong file* → **measured at 27–45 % wrong** without
  ranking (S8). Mitigation: ship the ranker table, return ranked alternates, and never present a
  single unranked path as authoritative — a wrong path sends Copilot to edit the wrong component.
- **New risk to add:** *shipping `everyNthFrame > 1` as a bandwidth default* → destroys typing
  responsiveness (336 ms p50 at nth 4). Mitigation: idle-pause instead; never frame-skip during
  interaction.
- **`vscode.lm` image parts** → confirmed working (`auto`/claude-haiku-4.5). New residual risk:
  the flag lies (`copilot-utility` claims `supportsImageToText: true`, then 400s) — always catch
  and fall back.
- **Add a row:** *Corporate Copilot policy exposes no vision-capable model* → participant path
  dead at work; attach-to-native-chat is the only integration. Pending S7.

### Milestones

- **M4 / M5 swap and rescope.** M4 becomes "Send to Prompt via native chat attach" (the primary),
  and its acceptance should assert an image-kind attachment, not a clipboard write. **M5 (`@ux`
  participant) → demote to optional or cut**: a participant cannot see user-attached images
  (verified with and without the proposal), so it would re-read PNGs from disk and pay for a
  second model call.
- **M6** — React half is cheaper than budgeted; Angular writes are now the riskier half.
- **M0/M1** — fold the §4.1 corrections (port file, lock reaping, kill-on-timeout) into the
  browser manager from the start.
- **`engines.vscode`: `^1.128.0`** (the version everything above was verified against).
- **Test harness split:** keep `test:ext` (`@vscode/test-electron`) personal-machine-only until
  S7 shows `update.code.visualstudio.com` is reachable at work.

---

# Manual steps for the user

### A. ~~Finish S1~~ — ✅ **DONE.** Copilot replied `MAGENTA-7734` in agent mode.

### A2. S4b subjective feel test (5 minutes, personal machine) — optional

The automated half is done (keystroke-to-pixel p50 **21.6 ms**). The **"S4 Input Probe"** panel is
open at quality 60 / everyNthFrame 1 with auto-drive off, for the subjective check the plan asks
for. Click the canvas, then:

1. **Type** into the textarea — any perceptible lag?
2. **Scroll** the cell grid with the wheel — rubber-banding or jumpiness?
3. **Drag-select** text — does selection track the cursor?
4. Switch **everyNthFrame → 4** and type again — expected to feel obviously bad; confirms the
   measured 336 ms is what it sounds like.

The HUD reports live p50/p95. Report the worst offender and I will note it under S4b.

*(Everything else on this machine is closed — all nine spikes executed.)*

### B. Work-laptop session 🏢 (~15–20 minutes) — **the main remaining work**

Copy `spikes/s7-corp-probe/` to the work laptop and follow `RUNBOOK.md` (6 steps, copy-paste
commands, each step says what to capture on failure). It covers the 🏢 CORP re-runs the spike
plan flagged for S1, S2, S6 and S7:

1. `code --install-extension probe.vsix` → run **UX Probe: Hello** *(sideload allowed? `vscode.lm` present?)*
2. `node probe-browser.mjs` *(registry discovery, headless launch, CDP handshake)*
3. `node probe-net.mjs` *(proxy, registry reachability, `update.code.visualstudio.com`, dependency dry-run)*
4. The `-STA` PowerShell clipboard test, **3 runs**, then Ctrl+V into Copilot Chat *(S6 Windows + S1 route (b))*
5. If you can copy `spikes/s1-chat-probe/` over too: run it and report
   `_out/probe-results.json` → `phases.B_lm.models` *(does the org expose a vision model?)*

Paste raw output back and I will fold it into S7 and revise the amendments.
