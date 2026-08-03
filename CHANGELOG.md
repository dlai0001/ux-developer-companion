# Changelog

All notable changes to UX Developer Companion.

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
