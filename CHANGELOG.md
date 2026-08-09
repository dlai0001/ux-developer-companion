# Changelog

All notable changes to UX Developer Companion.

## [0.0.6] — 2026-08-09

### Fixed
- **Annotations no longer sit stretched and mis-scaled after the panel resizes.** The overlay
  redrew only when the annotation model changed, but the canvas sizes itself from its own box
  and a canvas keeps its old bitmap through a CSS resize — so dragging the panel, wrapping the
  toolbar or opening Tools left the marks scaled to the old size until something else happened
  to trigger a redraw. The overlay now watches its own box. A zero-sized box (a collapsed
  panel) is left alone rather than resizing the canvas to nothing, which would have wiped the
  marks with no model change to bring them back.

  If your marks disappear the moment you finish drawing one, you are on **0.0.3 or earlier** —
  that layer unmounted whenever no tool was armed. Fixed in 0.0.4; upgrade.

## [0.0.5] — 2026-08-09

Listing only — the extension itself is unchanged from 0.0.4.

### Changed
- **The Marketplace listing and README now open with a screenshot** of the panel mid-annotation:
  a callout drawn on a running app, and Copilot Chat holding both captures and the context
  block. The workflow was described in prose but never shown.
- **The badge row no longer reads "retired badge".** shields.io withdrew its entire
  `visual-studio-marketplace/*` family, so the version, installs and rating badges had all
  degraded to that placeholder. Version is now a static badge bumped with the release; installs
  and rating are dropped until the Marketplace actually reports statistics for the extension.
- **The repository is public.** Every image and documentation link in the listing pointed at
  `raw.githubusercontent.com`, which serves 404 for a private repository — so the icon, the
  user guide, troubleshooting, CONTRIBUTING and LICENSE links were all dead on the published
  page. They resolve now.

## [0.0.4] — 2026-08-09

### Changed
- **Finishing a mark now disarms the tool and switches Browse off**, leaving the panel in a
  neutral state where a click does nothing at all. Previously it snapped straight back to
  Browse, so a stray click could navigate the app you were annotating. A small caption —
  "Click Browse to toggle browsing mode" — says how to get moving again.
- **Browse is a toggle.** Click it to hand clicks back to the page, click it again to park.
  Picking any annotation tool switches Browse off. `Esc` now disarms rather than resuming
  Browse.
- **Send to Chat no longer includes the "Annotated components" section.** The per-annotation
  component, props, state and ranked source files were the bulk of the prompt and mostly
  restated what the annotated image already shows. Only text written on callouts and labels
  carries through, under "Notes on the annotated screenshot".
- **Send to Chat clears the annotations** once chat has accepted them — they are in the
  attached image at that point. A send that fails keeps them, so nothing is lost.

### Fixed
- **Annotations stayed on screen only while a tool was armed.** Parking the panel or switching
  to Browse made the marks vanish although Clear still counted them. They now persist in every
  mode until cleared or sent.
- **Black canvas on first load.** On a static page the forced repaint after `startScreencast`
  was the only chance at a frame, and if it landed before Chrome had armed the screencast no
  frame was ever produced — the canvas stayed black until the user navigated. The first frame
  is now seeded from a direct screenshot when no frame arrives, and stream start/stop pairs are
  serialized so a resize landing mid-start cannot wedge the stream.

## [0.0.3] — 2026-08-03

### Changed
- **One Shape button** instead of separate Box and Circle; pressing it again switches between
  box and circle, and the icon shows which is active.
- **Snap back to Browse after drawing**, so the next click interacts with the page instead of
  starting another mark.
- **Callout is now click-and-drag**: press on the thing you are commenting on to set the tail
  target, then drag out to place the bubble. The bubble starts about ten characters wide and
  grows as you type.
- **Callouts are filled** in the annotation colour with white text, so a comment reads as a
  comment rather than as part of the UI.
- **One colour swatch with a colour picker**, replacing the four-swatch palette. Defaults to
  solid red.
- **Responsive, inspector and testing panels are hidden** behind a Tools toggle.

## [0.0.2] — 2026-08-03

### Changed
- **Markup toolbar is now always visible** with icon buttons — Browse, Box, Circle, Arrow,
  Text, Callout — instead of text labels hidden behind an Annotate mode toggle. Picking a tool
  switches to annotate mode implicitly, so there is no mode to discover first.
- **"Send to Prompt" is now "Send to Chat"**, and is a primary-styled button in the toolbar.

### Added
- **Circle** and **Text** annotation kinds. Text draws a haloed label with no bubble.
- **Undo** (⌘Z) alongside Clear.
- Single-key tool shortcuts: `B` box, `C` circle, `A` arrow, `T` text, `O` callout, `Esc` browse.

## [0.0.1] — 2026-08-03

First working build. Every milestone below ends with its acceptance tests green.

### Added
- **Embedded browser** — headless Edge/Chrome discovered locally and streamed into a VS Code
  panel over CDP, with mouse/keyboard/wheel forwarding, a navigation bar, debounced resize,
  crash relaunch, and full process-tree cleanup on dispose.
- **Page agent** — injected at document start; React and Angular adapters resolving components
  from a point, reading props/state, and building a component tree.
- **Annotations** — rectangle, arrow, and callout, stored in page CSS pixels so they survive
  scroll, resize, and device changes; each anchors to the component beneath it on creation.
- **Send to Prompt** (`cmd/ctrl+alt+p`) — attaches clean + annotated screenshots and a
  component-resolved context block to Copilot Chat in agent mode.
- **Source locator** — ranked search mapping a component to its source file, returning
  runner-up candidates alongside the best match.
- **Inspector** — component tree, click-to-pick, and live prop/state overrides for React
  (renderer interface) and Angular (signals + `applyChanges`).
- **Responsive tools** — device presets with DPR/touch/UA, rotation, a breakpoint slider built
  from the page's own media queries, and a responsive matrix.
- **Colour & accessibility** — eyedropper reporting the CSS custom property *and its defining
  rule*, WCAG 2.1 contrast checking, vision-deficiency and media emulation, an accessibility
  subtree view, and a bundled axe-core scan.
- **State lab** — pseudo-state forcing, request interception (fail/delay/mock), network
  throttle presets, storage profiles, and a state matrix.

### Notes on scope
- The `@ux` chat participant was **cut**. A chat participant never receives user-attached
  images (verified with and without the `chatReferenceBinaryData` proposal), so it would have
  re-read the screenshots from disk and paid for a second model call. Attaching to the native
  chat is the single shipped integration.
- Clipboard image write ships as a separate convenience command. It is **not** how screenshots
  reach chat — VS Code ignores pasted images unless an installed extension enables
  `chatReferenceBinaryData`.
- React production builds are read-only and reported as degraded; overrides are refused rather
  than silently ignored.
