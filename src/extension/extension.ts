import * as vscode from 'vscode';
import { BrowserPanel } from './panel.js';

export function activate(context: vscode.ExtensionContext): void {
  const version = (context.extension.packageJSON as { version?: string }).version ?? '0.0.0';

  context.subscriptions.push(
    vscode.commands.registerCommand('uxCompanion.open', () => {
      BrowserPanel.show(context.extensionUri, version, context.globalStorageUri);
    }),
    vscode.commands.registerCommand('uxCompanion.sendToPrompt', async () => {
      const panel = BrowserPanel.active;
      if (!panel) {
        void vscode.window.showWarningMessage('Open the UX Companion panel first.');
        return;
      }
      await panel.sendToPromptFromWebview();
    }),
    vscode.commands.registerCommand('uxCompanion.copyCaptureToClipboard', async () => {
      const panel = BrowserPanel.active;
      if (!panel) {
        void vscode.window.showWarningMessage('Open the UX Companion panel first.');
        return;
      }
      await panel.copyToClipboardFromWebview();
    }),
  );
}

export function deactivate(): void {
  // Panels dispose themselves; BrowserManager cleanup arrives with M1.
}
