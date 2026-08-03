# Manual QA checklist

Everything CI cannot cover. Each item says what is automated, what is not, and why.

Legend: ☐ untested · ✅ verified · ⚠️ verified with caveats

---

## 1. Live Copilot send ⚠️

**Automated:** the command opens chat, the options bag is accepted, both PNGs exist on disk and
are under the 30 MB cap, and the context text is asserted line by line. An extension-host test
also asserts `workbench.action.chat.open` still exists.

**Not automated:** that a model actually *receives* the pixels. CI has no Copilot entitlement.

**Verified once, manually (research spike S1):** a PNG containing the code word `MAGENTA-7734`
was attached via `attachFiles` in agent mode, and Copilot replied `MAGENTA-7734`.

☐ **Re-verify after any VS Code major upgrade.** Open the panel, annotate, Send to Prompt, and
confirm (a) an image thumbnail appears above the input — not just a filename chip, and (b) the
model can describe the screenshot.

## 2. Clipboard paste into chat ⚠️

☐ Run **Copy Annotated Screenshot to Clipboard**, then paste into Copilot Chat.

**Expected: nothing attaches** on a stock install. VS Code's chat paste handler returns early
unless an installed extension enables the `chatReferenceBinaryData` proposal. This is why the
clipboard is documented as a convenience for *other* apps, not the chat path. If a future VS Code
makes paste work unconditionally, update the README and the status message.

## 3. Windows ☐

- ☐ Registry-based browser discovery (`reg query … App Paths`). Auto-discovery is exercised on
  macOS only; the Windows branch has never run.
- ☐ Clipboard write via `powershell -STA`. Run it three times; all three should print `VERIFIED`.
  If AppLocker or Constrained Language Mode blocks the script, that is the finding — the
  clipboard command should degrade to files-only.
- ☐ `taskkill /T /F` reaps the browser tree on dispose (no orphaned `msedge.exe`/`chrome.exe`).

## 4. Linux ☐

- ☐ Discovery via `which microsoft-edge|google-chrome|chromium`.
- ☐ Clipboard via `wl-copy` (Wayland) or `xclip` (X11); with neither installed the command must
  report "unsupported" rather than throwing.

## 5. Microsoft Edge ☐

All automated runs used **Chrome**, because Edge is not installed on the development machine —
even though discovery prefers Edge. ☐ Confirm launch, screencast, and input forwarding on Edge.

## 6. Typing feel ⚠️

**Automated:** typed text reaches the page and the character sequence is correct.

**Not automated:** whether it *feels* responsive. Focus emulation is required to keep the
headless screencast alive, and it can make individual dispatches take a few hundred ms.

☐ Type a paragraph into a text-heavy page and judge the lag. ☐ Scroll with the wheel and check
for rubber-banding. ☐ Open a native `<select>`.

## 7. Visual correctness of emulation ☐

**Automated:** the CDP call sequences succeed and media queries flip.

**Not automated:** that the result *looks* right.

☐ Vision deficiencies (protanopia / deuteranopia / tritanopia / achromatopsia / blurred) visibly
change the render. ☐ `prefers-color-scheme: dark` restyles an app that supports it.

## 8. Annotation ergonomics ☐

☐ Draw each kind (rect / arrow / callout) and confirm the mark lands where the cursor was.
☐ Callout text wraps and commits on blur. ☐ Annotations stay anchored after scrolling and after
a device-preset change — geometry is stored in page CSS px specifically for this.
☐ After each mark lands, no tool is highlighted, Browse is off, the caption "Click Browse to
toggle browsing mode" is showing, and clicking the page does nothing — no new mark, no
navigation. ☐ Clicking Browse restores page interaction; clicking it again parks the panel.

## 9. Corporate environment 🏢 ☐

See `spikes/s7-corp-probe/RUNBOOK.md` for the full run-book. The decisive unknowns:

- ☐ Can a locally built `.vsix` be sideloaded, or does policy block it?
- ☐ Does endpoint security allow `--remote-debugging-port`?
- ☐ Is `update.code.visualstudio.com` reachable (decides whether `test:ext` can run at work)?
- ☐ **Does the org's Copilot policy expose a vision-capable model?** If not, the context text
  still works but image understanding does not. Note that Send to Prompt does not call
  `vscode.lm` at all, so attachment still functions regardless.

## 10. Long-run stability ☐

☐ Leave the panel open for an hour with an app that animates, then confirm the stream is still
live and no orphaned browser processes remain (`pgrep -f browser-profile`).

---

## Not built this session

The `@ux` chat participant was **cut**, not deferred by accident. Research spike S2 established
that a chat participant never receives user-attached images — verified both with and without the
`chatReferenceBinaryData` proposal enabled. A participant would have to re-read the PNGs from
disk and pay for a second model call to show a model what the native agent already had.
