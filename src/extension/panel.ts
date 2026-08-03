import * as vscode from 'vscode';
import { isWebviewToHost, type HostToWebview, type WebviewToHost } from '../shared/protocol.js';

/**
 * Owns the webview panel and the typed message channel. M0 stands the panel up and echoes
 * status; M1 attaches the BrowserManager/SessionController to the same channel.
 */
export class BrowserPanel {
  public static readonly viewType = 'uxCompanion.browserView';
  private static current: BrowserPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly onMessage = new vscode.EventEmitter<WebviewToHost>();
  /** Later milestones subscribe here instead of reaching into the panel. */
  public readonly messages = this.onMessage.event;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly version: string,
  ) {
    this.panel.webview.html = this.render();

    this.panel.webview.onDidReceiveMessage((raw: unknown) => {
      if (!isWebviewToHost(raw)) return;
      if (raw.type === 'webview-ready') {
        this.post({ type: 'ready', extensionVersion: this.version });
        this.post({ type: 'status', text: 'Panel ready. Browser session lands in M1.', tone: 'info' });
      }
      this.onMessage.fire(raw);
    }, null, this.disposables);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public static show(extensionUri: vscode.Uri, version: string): BrowserPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (BrowserPanel.current) {
      BrowserPanel.current.panel.reveal(column);
      return BrowserPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      BrowserPanel.viewType,
      'UX Companion',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out')],
      },
    );
    BrowserPanel.current = new BrowserPanel(panel, extensionUri, version);
    return BrowserPanel.current;
  }

  /** Test seam: lets the extension-host suite assert the panel exists without poking VS Code internals. */
  public static get isOpen(): boolean {
    return BrowserPanel.current !== undefined;
  }

  public post(message: HostToWebview): void {
    void this.panel.webview.postMessage(message);
  }

  private render(): string {
    const { webview } = this.panel;
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'webview.js'));
    const nonce = Array.from({ length: 32 }, () =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)],
    ).join('');
    // img-src includes data: because screencast frames arrive as base64 JPEG data URIs (M1).
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>UX Companion</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  public dispose(): void {
    BrowserPanel.current = undefined;
    this.onMessage.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
    this.panel.dispose();
  }
}
