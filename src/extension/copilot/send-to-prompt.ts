// The one shipped integration (PLAN §4.5, revised by spike S1).
//
// `workbench.action.chat.open({ attachFiles, mode: 'agent' })` puts REAL image attachments in
// the native chat — VS Code's addFile() branches on image extensions into an image variable
// entry, it is not gated by any API proposal, and it needs zero keystrokes. Verified
// end-to-end: an agent-mode model read a code word rendered into the attached PNG.
//
// Two constraints that are easy to get wrong:
//   * attachFiles entries are existence-checked, so the PNGs must be on disk FIRST.
//   * there is a 30 MB per-image cap; above it VS Code shows a modal error.
import * as vscode from 'vscode';
import { statSync } from 'node:fs';

export const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;

export interface SendResult {
  ok: boolean;
  attached: string[];
  skipped: Array<{ path: string; reason: string }>;
  detail?: string;
}

interface ChatOpenOptions {
  query: string;
  attachFiles?: vscode.Uri[];
  mode?: 'ask' | 'edit' | 'agent';
  isPartialQuery?: boolean;
}

export async function sendToPrompt(contextText: string, pngPaths: string[]): Promise<SendResult> {
  const attached: vscode.Uri[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  for (const p of pngPaths) {
    try {
      const { size } = statSync(p);
      if (size > MAX_ATTACHMENT_BYTES) {
        skipped.push({ path: p, reason: `exceeds the 30 MB chat attachment limit (${Math.round(size / 1e6)} MB)` });
        continue;
      }
      attached.push(vscode.Uri.file(p));
    } catch (e) {
      skipped.push({ path: p, reason: (e as Error).message });
    }
  }

  const options: ChatOpenOptions = {
    query: contextText,
    // Leave the user in chat to type their own request — no auto-generated instruction.
    isPartialQuery: true,
    mode: 'agent',
    ...(attached.length ? { attachFiles: attached } : {}),
  };

  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', options);
    return { ok: true, attached: attached.map((u) => u.fsPath), skipped };
  } catch (e) {
    // Older/newer builds may reject the options bag; retry with the query alone so the user
    // still lands in chat with the context text and the saved file paths.
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', { query: contextText });
      return {
        ok: true, attached: [], detail: 'Attachments unsupported by this VS Code build; files saved to disk.',
        skipped: [...skipped, ...attached.map((u) => ({ path: u.fsPath, reason: 'attachFiles rejected' }))],
      };
    } catch (e2) {
      return { ok: false, attached: [], skipped, detail: `${(e as Error).message} / ${(e2 as Error).message}` };
    }
  }
}
