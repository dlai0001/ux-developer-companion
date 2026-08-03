# Contributing

Issues and pull requests are welcome. This document covers getting a working build and knowing
which tests must be green.

## Setup

```bash
npm install
npm run fixtures:setup   # installs the React + Angular fixture apps
npm run build            # host + webview + page-agent bundles
```

Press `F5` in VS Code to launch an Extension Development Host with the extension loaded.

You need **Microsoft Edge or Google Chrome installed locally** — the extension launches a browser
you already have and never downloads one.

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Builds the host, webview, and page-agent bundles. |
| `npm run watch` | Rebuilds on change. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run fixtures:setup` | Installs the fixture apps. |
| `npm run fixtures:serve` | Serves them on `:5173` (React dev), `:5174` (React prod), `:4200` (Angular). |
| `npm run test:unit` | Vitest, `test/unit`. |
| `npm run test:integration` | Vitest, `test/integration`. |
| `npm run test:ext` | Extension-host suite in a real VS Code. |
| `npm test` | All of the above. |
| `npm run package` | Produces `ux-developer-companion.vsix`. |

`npm run test:ext` downloads a VS Code build from `update.code.visualstudio.com`. If that host is
blocked on your network, run the unit and integration suites locally and let CI cover the rest.

## Layout

```
src/extension/       VS Code host: panel, browser launch, CDP session, Copilot send
  browser/           browser discovery, launch, CDP client
  session/           screencast, input, capture, a11y, intercept, token provenance
  copilot/           context composer, send-to-prompt, clipboard
src/page-agent/      injected at document start; React + Angular adapters
src/shared/          protocol, annotations, devices, contrast, compositor
src/webview/         React UI: browser view, nav bar, annotation layer, toolbar
test/                unit · integration · extension-host suites
fixtures/            React + Angular apps the tests drive
spikes/              research spikes; see spikes/FINDINGS.md
```

## Before opening a PR

1. `npm test` passes.
2. If you changed behaviour a user can see, add a `CHANGELOG.md` entry under `[Unreleased]` that
   says **what changed and why** — the existing entries set the tone.
3. If you touched anything on the [manual QA checklist](MANUAL-QA.md), say in the PR which items
   you re-ran. Several things CI genuinely cannot verify: live Copilot attachment, Windows and
   Linux clipboard paths, Edge, and whether emulation *looks* right.

## Design decisions worth reading first

`spikes/FINDINGS.md` records the research behind several non-obvious choices, including why the
`@ux` chat participant was cut (a participant never receives user-attached images) and why the
clipboard is not the path into chat (VS Code ignores pasted images without the
`chatReferenceBinaryData` proposal). Proposing either of those again will be a short conversation
unless the findings have changed.

## Support the project

If you would rather fund the work than write it: [**Sponsor on GitHub**](https://github.com/sponsors/dlai0001).
Stars and Marketplace reviews help too, and cost nothing.

## Licence

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
