// Owns one browser + one CDP connection + the screencast loop (PLAN §2 SessionController).
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, type LaunchedBrowser } from '../browser/launch.js';
import { CdpSession } from '../browser/cdp.js';
import { ScreencastController, DEFAULT_SCREENCAST, type ScreencastOptions } from './screencast.js';
import { forwardKey, forwardMouse } from './input.js';
import { InterceptController, THROTTLE_PRESETS, type InterceptRule, type ThrottlePreset } from './intercept.js';
import { readFileSync } from 'node:fs';
import { AGENT_BINDING, AGENT_GLOBAL, type ComponentInfo, type ComponentTreeNode,
         type Json, type WriteResult } from '../../shared/agent-api.js';
import type { DevicePreset } from '../../shared/devices.js';
import type { FrameMessage, InputModifiers, MouseKind } from '../../shared/protocol.js';

export interface SessionEvents {
  onFrame(f: FrameMessage): void;
  onUrlChanged(url: string): void;
  onStatus(text: string, tone: 'info' | 'warn' | 'error'): void;
  onViewportChanged(width: number, height: number): void;
  onAgentEvent?(event: Record<string, unknown>): void;
}

export interface SessionConfig {
  browserPath?: string;
  userDataDir: string;
  screencast?: Partial<ScreencastOptions>;
  /** Absolute path to the built page-agent IIFE bundle (out/page-agent.js). */
  pageAgentPath?: string;
}

export class BrowserSession {
  private browser: LaunchedBrowser | undefined;
  private cdp: CdpSession | undefined;
  private screencast: ScreencastController | undefined;
  private disposed = false;
  private relaunchedOnce = false;
  private currentUrl = '';
  private viewportSize = { width: DEFAULT_SCREENCAST.maxWidth, height: DEFAULT_SCREENCAST.maxHeight };
  private agentInstalled = false;
  private intercept: InterceptController | undefined;
  private tearingDown = false;

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
    this.cdp.onCrashed((reason) => { void this.handleCrash(reason); });
    this.browser.proc.once('exit', (code) => {
      if (!this.disposed) void this.handleCrash(`browser exited (code ${code ?? 'null'})`);
    });

    this.screencast = new ScreencastController(this.cdp, (f) => this.events.onFrame(f), {
      ...DEFAULT_SCREENCAST, ...this.cfg.screencast,
    });

    this.intercept = new InterceptController(this.cdp);

    // Page agent must be installed BEFORE app scripts run so the React devtools hook exists
    // when React registers its renderer (PLAN §4.3).
    await this.installPageAgent();

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

  private async installPageAgent(): Promise<void> {
    if (!this.cdp || !this.cfg.pageAgentPath) return;
    try {
      const source = readFileSync(this.cfg.pageAgentPath, 'utf8');
      await this.cdp.addBinding(AGENT_BINDING);
      this.cdp.onBindingCalled((name, payload) => {
        if (name !== AGENT_BINDING) return;
        try { this.events.onAgentEvent?.(JSON.parse(payload) as Record<string, unknown>); }
        catch { /* malformed payload from the page — ignore */ }
      });
      await this.cdp.addInitScript(source);
      this.agentInstalled = true;
    } catch (e) {
      this.events.onStatus(`Page agent not installed: ${(e as Error).message}`, 'warn');
    }
  }

  /** Call into the injected agent. Returns null when the agent is absent or errors. */
  private async agent<T>(expression: string): Promise<T | null> {
    if (!this.cdp || !this.agentInstalled) return null;
    try {
      return await this.cdp.evaluate<T>(`(() => { const a = window['${AGENT_GLOBAL}'];
        return a ? ${expression} : null; })()`);
    } catch {
      return null;
    }
  }

  resolveAt(x: number, y: number): Promise<ComponentInfo | null> {
    return this.agent<ComponentInfo | null>(`a.resolveAt(${x}, ${y})`).then((v) => v ?? null);
  }

  componentTree(maxDepth = 8): Promise<ComponentTreeNode[]> {
    return this.agent<ComponentTreeNode[]>(`a.componentTree(${maxDepth})`).then((v) => v ?? []);
  }

  readComponent(id: number): Promise<ComponentInfo | null> {
    return this.agent<ComponentInfo | null>(`a.readState(${id})`).then((v) => v ?? null);
  }

  writeComponent(id: number, path: Array<string | number>, value: Json): Promise<WriteResult> {
    return this.agent<WriteResult>(
      `a.writeState(${id}, ${JSON.stringify(path)}, ${JSON.stringify(value)})`,
    ).then((v) => v ?? { ok: false as const, reason: 'unsupported' as const });
  }

  supportsWrite(): Promise<boolean> {
    return this.agent<boolean>('a.supportsWrite()').then((v) => v ?? false);
  }

  detectFramework(): Promise<string | null> {
    return this.agent<string | null>('a.detectFramework()');
  }

  breakpoints(): Promise<number[]> {
    return this.agent<number[]>('a.breakpoints()').then((v) => v ?? []);
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

  /** Apply a device preset: metrics + DPR + touch + UA (PLAN §4.6). */
  async applyDevice(preset: DevicePreset | null): Promise<void> {
    if (!this.cdp || !this.screencast) return;
    if (!preset) {
      await this.cdp.clearViewport();
      await this.cdp.setTouchEmulation(false);
      await this.resize(this.viewportSize.width, this.viewportSize.height);
      return;
    }
    await this.cdp.setViewport({
      width: preset.width, height: preset.height,
      deviceScaleFactor: preset.dpr, mobile: preset.touch,
    });
    await this.cdp.setTouchEmulation(preset.touch);
    if (preset.userAgent) await this.cdp.setUserAgent(preset.userAgent);
    this.viewportSize = { width: preset.width, height: preset.height };
    this.events.onViewportChanged(preset.width, preset.height);
    await this.screencast.restart({ maxWidth: preset.width, maxHeight: preset.height });
  }

  /**
   * Responsive matrix (PLAN §4.6). Uses ONE target sequentially — resize, settle, shoot —
   * rather than N parallel targets, which §8 lists as the fallback and which avoids N browser
   * tabs competing for the same screencast machinery.
   */
  async responsiveMatrix(widths: number[], height = 800): Promise<Array<{ width: number; png: string }>> {
    if (!this.cdp || !this.screencast) return [];
    const original = { ...this.viewportSize };
    const out: Array<{ width: number; png: string }> = [];
    // The live stream would fight the resizes; stop it and restore afterwards.
    await this.screencast.stop();
    try {
      for (const width of widths) {
        await this.cdp.setViewport({ width, height, deviceScaleFactor: 1, mobile: false });
        await new Promise((r) => setTimeout(r, 250));   // let layout settle
        out.push({ width, png: await this.cdp.captureScreenshot() });
      }
    } finally {
      await this.cdp.setViewport({ ...original, deviceScaleFactor: 1, mobile: false });
      this.viewportSize = original;
      await this.screencast.start({ maxWidth: original.width, maxHeight: original.height });
    }
    return out;
  }

  /** Bounds of the element under a point — the snap targets for guides. */
  async elementBounds(x: number, y: number): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return this.agent<{ x: number; y: number; width: number; height: number } | null>(
      `a.elementBounds(${x}, ${y})`,
    );
  }

  // ---------------------------------------------------------------- state lab (§4.6)
  get activeRuleCount(): number { return this.intercept?.ruleCount ?? 0; }

  async setInterceptRules(rules: InterceptRule[]): Promise<void> {
    await this.intercept?.setRules(rules);
  }

  async setThrottle(preset: ThrottlePreset): Promise<void> {
    await this.cdp?.emulateNetwork({ ...THROTTLE_PRESETS[preset] });
  }

  /** Force :hover/:focus/:active on the element at a point. */
  async forcePseudoAt(x: number, y: number, states: string[]): Promise<boolean> {
    if (!this.cdp) return false;
    const nodeId = await this.cdp.nodeAt(x, y);
    if (!nodeId) return false;
    await this.cdp.forcePseudoState(nodeId, states);
    return true;
  }

  /** Snapshot localStorage + sessionStorage + cookies as a named profile. */
  async snapshotStorage(): Promise<{ local: Record<string, string>; session: Record<string, string>; cookies: unknown[] }> {
    const stores = await this.cdp?.evaluate<{ local: Record<string, string>; session: Record<string, string> }>(`
      (() => {
        const dump = (s) => Object.fromEntries(Object.keys(s).map((k) => [k, s.getItem(k)]));
        return { local: dump(localStorage), session: dump(sessionStorage) };
      })()`) ?? { local: {}, session: {} };
    return { ...stores, cookies: (await this.cdp?.getCookies()) ?? [] };
  }

  async restoreStorage(profile: { local: Record<string, string>; session: Record<string, string>; cookies?: unknown[] }): Promise<void> {
    await this.cdp?.evaluate<void>(`
      (() => {
        localStorage.clear(); sessionStorage.clear();
        const l = ${JSON.stringify(profile.local)};
        const s = ${JSON.stringify(profile.session)};
        for (const k of Object.keys(l)) localStorage.setItem(k, l[k]);
        for (const k of Object.keys(s)) sessionStorage.setItem(k, s[k]);
      })()`);
    if (profile.cookies?.length) {
      await this.cdp?.setCookies(profile.cookies as never);
    }
  }

  /** State matrix: force each pseudo-state set in turn and screenshot (PLAN §4.6). */
  async stateMatrix(x: number, y: number, sets: string[][]): Promise<Array<{ states: string[]; png: string }>> {
    if (!this.cdp) return [];
    const nodeId = await this.cdp.nodeAt(x, y);
    if (!nodeId) return [];
    const out: Array<{ states: string[]; png: string }> = [];
    try {
      for (const states of sets) {
        await this.cdp.forcePseudoState(nodeId, states);
        await new Promise((r) => setTimeout(r, 150));
        out.push({ states, png: await this.cdp.captureScreenshot() });
      }
    } finally {
      await this.cdp.forcePseudoState(nodeId, []).catch(() => undefined);
    }
    return out;
  }

  async sendKey(key: string, code: string, mods: InputModifiers): Promise<void> {
    if (!this.cdp) return;
    this.screencast?.noteActivity();
    // A dropped devtools socket must not throw into the webview message handler; the crash
    // handler relaunches and the user simply retypes.
    try { await forwardKey(this.cdp, key, code, mods); } catch { /* relaunch in flight */ }
  }

  async sendMouse(
    kind: MouseKind, x: number, y: number, mods: InputModifiers,
    delta?: { deltaX: number; deltaY: number },
  ): Promise<void> {
    if (!this.cdp) return;
    this.screencast?.noteActivity();
    try { await forwardMouse(this.cdp, kind, x, y, mods, delta); } catch { /* relaunch in flight */ }
  }

  /** Auto-relaunch once, then surface an error (PLAN §4.1). */
  private async handleCrash(reason = 'browser crashed'): Promise<void> {
    // Ignore events caused by our own teardown, or the relaunch tears itself down again.
    if (this.disposed || this.tearingDown) return;
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
    this.tearingDown = true;
    this.screencast?.dispose();
    this.screencast = undefined;
    await this.cdp?.close();
    this.cdp = undefined;
    this.browser?.kill();
    this.browser = undefined;
    this.tearingDown = false;
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
