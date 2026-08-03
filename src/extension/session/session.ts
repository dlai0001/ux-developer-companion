// Owns one browser + one CDP connection + the screencast loop (PLAN §2 SessionController).
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, type LaunchedBrowser } from '../browser/launch.js';
import { CdpSession } from '../browser/cdp.js';
import { ScreencastController, DEFAULT_SCREENCAST, type ScreencastOptions } from './screencast.js';
import { forwardKey, forwardMouse } from './input.js';
import type { FrameMessage, InputModifiers, MouseKind } from '../../shared/protocol.js';

export interface SessionEvents {
  onFrame(f: FrameMessage): void;
  onUrlChanged(url: string): void;
  onStatus(text: string, tone: 'info' | 'warn' | 'error'): void;
  onViewportChanged(width: number, height: number): void;
}

export interface SessionConfig {
  browserPath?: string;
  userDataDir: string;
  screencast?: Partial<ScreencastOptions>;
}

export class BrowserSession {
  private browser: LaunchedBrowser | undefined;
  private cdp: CdpSession | undefined;
  private screencast: ScreencastController | undefined;
  private disposed = false;
  private relaunchedOnce = false;
  private currentUrl = '';
  private viewportSize = { width: DEFAULT_SCREENCAST.maxWidth, height: DEFAULT_SCREENCAST.maxHeight };

  constructor(private readonly cfg: SessionConfig, private readonly events: SessionEvents) {}

  get url(): string { return this.currentUrl; }
  get isRunning(): boolean { return this.cdp !== undefined && !this.disposed; }
  /** Exposed for later milestones (page agent, emulation, capture). */
  get connection(): CdpSession | undefined { return this.cdp; }
  /** Diagnostics for tests: raw frame count + screencast running state. */
  get diagnostics(): { framesReceived: number; running: boolean } {
    return { framesReceived: this.screencast?.framesReceived ?? -1, running: this.screencast?.isRunning ?? false };
  }

  async start(initialUrl?: string): Promise<void> {
    const opts: { browserPath?: string; userDataDir: string } = { userDataDir: this.cfg.userDataDir };
    if (this.cfg.browserPath) opts.browserPath = this.cfg.browserPath;
    this.browser = await launchBrowser(opts);
    this.cdp = await CdpSession.connect(this.browser.port);

    this.cdp.onFrameNavigated((url) => {
      this.currentUrl = url;
      this.events.onUrlChanged(url);
    });
    this.cdp.onCrashed(() => { void this.handleCrash(); });
    this.browser.proc.once('exit', (code) => {
      if (!this.disposed) void this.handleCrash(`browser exited (code ${code ?? 'null'})`);
    });

    this.screencast = new ScreencastController(this.cdp, (f) => this.events.onFrame(f), {
      ...DEFAULT_SCREENCAST, ...this.cfg.screencast,
    });

    // Pin device metrics so canvas->page coordinate mapping is exact from the first frame.
    await this.cdp.setViewport({ ...this.viewportSize, deviceScaleFactor: 1, mobile: false });
    this.events.onViewportChanged(this.viewportSize.width, this.viewportSize.height);

    if (initialUrl) await this.navigate(initialUrl);
    await this.screencast.start({ maxWidth: this.viewportSize.width, maxHeight: this.viewportSize.height });
    this.events.onStatus(`Browser ready (port ${this.browser.port}, via ${this.browser.via}).`, 'info');
  }

  async navigate(url: string): Promise<void> {
    if (!this.cdp) return;
    const normalized = /^https?:\/\//i.test(url) ? url : `http://${url}`;
    await this.cdp.navigate(normalized);
    this.currentUrl = normalized;
    this.events.onUrlChanged(normalized);
    // Must wait for the load event: restarting mid-navigation binds the screencast to a
    // doomed document and the stream never recovers.
    await this.cdp.waitForLoad();
    // Only restart an ALREADY-RUNNING stream. During start() the screencast has not begun
    // yet, and starting it twice in quick succession wedges Chrome's screencast for good.
    if (this.screencast?.isRunning) await this.screencast.restart();
  }

  async goBack(): Promise<void> { await this.cdp?.goBack(); }
  async goForward(): Promise<void> { await this.cdp?.goForward(); }
  async reload(): Promise<void> { await this.cdp?.reload(); }

  async resize(width: number, height: number): Promise<void> {
    if (!this.cdp || !this.screencast) return;
    const w = Math.max(200, Math.round(width));
    const h = Math.max(200, Math.round(height));
    // A fixed metrics override makes canvas->page coordinate mapping exact.
    await this.cdp.setViewport({ width: w, height: h, deviceScaleFactor: 1, mobile: false });
    this.viewportSize = { width: w, height: h };
    this.events.onViewportChanged(w, h);
    await this.screencast.restart({ maxWidth: w, maxHeight: h });
  }

  async sendKey(key: string, code: string, mods: InputModifiers): Promise<void> {
    if (!this.cdp) return;
    this.screencast?.noteActivity();
    await forwardKey(this.cdp, key, code, mods);
  }

  async sendMouse(
    kind: MouseKind, x: number, y: number, mods: InputModifiers,
    delta?: { deltaX: number; deltaY: number },
  ): Promise<void> {
    if (!this.cdp) return;
    this.screencast?.noteActivity();
    await forwardMouse(this.cdp, kind, x, y, mods, delta);
  }

  /** Auto-relaunch once, then surface an error (PLAN §4.1). */
  private async handleCrash(reason = 'browser crashed'): Promise<void> {
    if (this.disposed) return;
    if (this.relaunchedOnce) {
      this.events.onStatus(`Browser crashed again (${reason}); giving up. Reopen the panel to retry.`, 'error');
      await this.teardown();
      return;
    }
    this.relaunchedOnce = true;
    this.events.onStatus(`${reason} — relaunching…`, 'warn');
    const lastUrl = this.currentUrl;
    await this.teardown();
    try {
      await this.start(lastUrl || undefined);
    } catch (e) {
      this.events.onStatus(`Relaunch failed: ${(e as Error).message}`, 'error');
    }
  }

  private async teardown(): Promise<void> {
    this.screencast?.dispose();
    this.screencast = undefined;
    await this.cdp?.close();
    this.cdp = undefined;
    this.browser?.kill();
    this.browser = undefined;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.teardown();
    // Profile dirs are per-session; leaving them behind would accumulate and, worse, a stale
    // one can block a later launch.
    try { rmSync(this.cfg.userDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
    try { rmSync(join(this.cfg.userDataDir, '..', 'ignored'), { force: true }); } catch { /* noop */ }
  }
}
