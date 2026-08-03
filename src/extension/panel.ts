import * as vscode from 'vscode';
import { join } from 'node:path';
import { isWebviewToHost, type HostToWebview, type WebviewToHost } from '../shared/protocol.js';
import { BrowserSession } from './session/session.js';
import { capture } from './session/capture.js';

/** Owns the webview panel, the typed message channel, and the browser session behind it. */
export class BrowserPanel {
  public static readonly viewType = 'uxCompanion.browserView';
  private static current: BrowserPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private session: BrowserSession | undefined;
  private resizeTimer: NodeJS.Timeout | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly version: string,
    private readonly storageUri: vscode.Uri,
  ) {
    this.panel.webview.html = this.render();
    this.panel.webview.onDidReceiveMessage((raw: unknown) => {
      if (isWebviewToHost(raw)) void this.handle(raw);
    }, null, this.disposables);
    this.panel.onDidDispose(() => void this.dispose(), null, this.disposables);
  }

  public static show(extensionUri: vscode.Uri, version: string, storageUri: vscode.Uri): BrowserPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (BrowserPanel.current) {
      BrowserPanel.current.panel.reveal(column);
      return BrowserPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(BrowserPanel.viewType, 'UX Companion', column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out')],
    });
    BrowserPanel.current = new BrowserPanel(panel, extensionUri, version, storageUri);
    return BrowserPanel.current;
  }

  public static get isOpen(): boolean { return BrowserPanel.current !== undefined; }

  public post(message: HostToWebview): void {
    void this.panel.webview.postMessage(message);
  }

  private config<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration('uxCompanion').get<T>(key) ?? fallback;
  }

  private async handle(msg: WebviewToHost): Promise<void> {
    switch (msg.type) {
      case 'webview-ready':
        this.post({ type: 'ready', extensionVersion: this.version });
        await this.startSession();
        break;
      case 'navigate':
        await this.session?.navigate(msg.url);
        break;
      case 'go-back': await this.session?.goBack(); break;
      case 'go-forward': await this.session?.goForward(); break;
      case 'reload': await this.session?.reload(); break;
      case 'key':
        await this.session?.sendKey(msg.key, msg.code, msg.modifiers);
        break;
      case 'mouse': {
        const delta = msg.deltaX !== undefined || msg.deltaY !== undefined
          ? { deltaX: msg.deltaX ?? 0, deltaY: msg.deltaY ?? 0 }
          : undefined;
        await this.session?.sendMouse(msg.kind, msg.x, msg.y, msg.modifiers, delta);
        break;
      }
      case 'resize':
        // Debounced 150 ms — a drag would otherwise restart the screencast every frame.
        if (this.resizeTimer) clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => { void this.session?.resize(msg.width, msg.height); }, 150);
        break;
      case 'set-mode':
        this.post({ type: 'mode-changed', mode: msg.mode });
        break;
      case 'resolve-at': {
        const component = (await this.session?.resolveAt(msg.x, msg.y)) ?? null;
        this.post({ type: 'component-resolved', component });
        break;
      }
      case 'resolve-annotation': {
        const component = (await this.session?.resolveAt(msg.x, msg.y)) ?? null;
        this.post({ type: 'annotation-resolved', id: msg.id, component });
        break;
      }
      case 'set-tool':
      case 'set-color':
        break;   // purely webview-side state
      case 'capture': {
        const cdp = this.session?.connection;
        if (!cdp) { this.post({ type: 'status', text: 'No browser session.', tone: 'error' }); break; }
        try {
          const res = await capture(cdp, msg.annotations, this.captureDir(), stamp());
          this.post({ type: 'capture-complete', dir: res.dir, cleanPath: res.cleanPath, annotatedPath: res.annotatedPath });
          this.post({ type: 'status', text: `Captured to ${res.dir}`, tone: 'info' });
        } catch (e) {
          this.post({ type: 'status', text: `Capture failed: ${(e as Error).message}`, tone: 'error' });
        }
        break;
      }
    }
  }

  /** Workspace-relative capture dir, falling back to global storage outside a workspace. */
  private captureDir(): string {
    const rel = this.config<string>('captureDir', '.ux-companion/captures');
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? join(folder.uri.fsPath, rel) : join(this.storageUri.fsPath, rel);
  }

  private async startSession(): Promise<void> {
    if (this.session) return;
    const profile = join(this.storageUri.fsPath, `browser-profile-${process.pid}-${Date.now()}`);
    const browserPath = this.config<string>('browserPath', '');
    this.session = new BrowserSession(
      {
        userDataDir: profile,
        pageAgentPath: vscode.Uri.joinPath(this.extensionUri, 'out', 'page-agent.js').fsPath,
        ...(browserPath ? { browserPath } : {}),
        screencast: { quality: this.config<number>('screencastQuality', 60) },
      },
      {
        onFrame: (f) => this.post(f),
        onUrlChanged: (url) => this.post({ type: 'url-changed', url }),
        onStatus: (text, tone) => this.post({ type: 'status', text, tone }),
        onViewportChanged: (width, height) => this.post({ type: 'viewport-changed', width, height }),
      },
    );
    try {
      await this.session.start('http://127.0.0.1:5173/');
    } catch (e) {
      this.post({ type: 'status', text: `Could not start browser: ${(e as Error).message}`, tone: 'error' });
    }
  }

  private render(): string {
    const { webview } = this.panel;
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'webview.js'));
    const nonce = Array.from({ length: 32 }, () =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)],
    ).join('');
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data: blob:`,
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
<body><div id="root"></div>
<script nonce="${nonce}" src="${script}"></script>
</body></html>`;
  }

  public async dispose(): Promise<void> {
    BrowserPanel.current = undefined;
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    await this.session?.dispose();
    this.session = undefined;
    while (this.disposables.length) this.disposables.pop()?.dispose();
    this.panel.dispose();
  }
}

/** Filesystem-safe ISO timestamp used as the capture folder name. */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
