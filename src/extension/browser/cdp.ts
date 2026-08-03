// Typed CDP facade. PLAN §7: feature code never touches the raw client — every domain use
// lands here first, so protocol quirks stay in one file.
import CDP, { type CDPClient } from 'chrome-remote-interface';
import type Protocol from 'devtools-protocol';

export interface ScreencastFrame {
  /** base64 JPEG. */
  data: string;
  metadata: Protocol.Page.ScreencastFrameMetadata;
  sessionId: number;
}

export type MouseEventType = 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';

export class CdpSession {
  /** Set before we close deliberately, so our own teardown is not reported as a crash. */
  private closing = false;
  /** DOM node ids are invalidated by a fresh getDocument, so request it once per document. */
  private docStale = true;

  private constructor(private readonly client: CDPClient) {}

  static async connect(port: number): Promise<CdpSession> {
    const client = await CDP({ port, host: '127.0.0.1' });
    const s = new CdpSession(client);
    await s.enableDomains();
    // Any document swap invalidates node ids, including ones we did not navigate to.
    client.on('DOM.documentUpdated', () => { s.docStale = true; });
    return s;
  }

  private async enableDomains(): Promise<void> {
    // devtools-protocol types several `enable` params as required though all fields are optional.
    await this.client.Page.enable({});
    await this.client.Runtime.enable();
    await this.client.DOM.enable({});
    await this.client.CSS.enable();
    await this.client.Network.enable({});
    // Dev servers routinely use self-signed certs (PLAN §4.1).
    await this.client.Security.setIgnoreCertificateErrors({ ignore: true });

    // CRITICAL for headless screencast: without these, the FIRST Input.dispatchKeyEvent
    // permanently stalls the stream — Chrome stops emitting screencastFrame entirely, and a
    // stop/start does NOT recover it. The page stays alive (captureScreenshot still works),
    // so it presents as a frozen viewport rather than an error. Verified in
    // spikes/probe-input-stall.mjs: 5 frames then dead vs 23 with these enabled.
    // Each is best-effort and time-boxed: setFocusEmulationEnabled can hang on some builds.
    const guarded = async (label: string, p: Promise<unknown>): Promise<void> => {
      await Promise.race([
        p.catch(() => undefined),
        new Promise((r) => setTimeout(r, 2000)),
      ]).catch(() => undefined);
      void label;
    };
    await guarded('focusEmulation', this.client.Emulation.setFocusEmulationEnabled({ enabled: true }));
    await guarded('lifecycle', this.client.Page.setWebLifecycleState({ state: 'active' }));
  }

  // ---------------------------------------------------------------- navigation
  async navigate(url: string): Promise<void> {
    await this.client.Page.navigate({ url });
  }

  /**
   * `Page.navigate` resolves when the navigation COMMITS, not when the document has loaded.
   * Restarting the screencast in that window binds it to a document that is about to be
   * swapped out and permanently kills the stream — no further frames, not even for a visible
   * repaint. Always await this before (re)starting a screencast after navigation.
   */
  async waitForLoad(timeoutMs = 10_000): Promise<void> {
    await Promise.race([
      this.client.Page.loadEventFired(),
      new Promise<void>((r) => setTimeout(r, timeoutMs)),
    ]);
  }

  async currentUrl(): Promise<string> {
    const { currentIndex, entries } = await this.client.Page.getNavigationHistory();
    return entries[currentIndex]?.url ?? '';
  }

  async goBack(): Promise<void> { await this.historyStep(-1); }
  async goForward(): Promise<void> { await this.historyStep(1); }

  private async historyStep(delta: number): Promise<void> {
    const { currentIndex, entries } = await this.client.Page.getNavigationHistory();
    const target = entries[currentIndex + delta];
    if (target) await this.client.Page.navigateToHistoryEntry({ entryId: target.id });
  }

  async reload(): Promise<void> { await this.client.Page.reload({}); }

  onFrameNavigated(cb: (url: string) => void): void {
    this.client.on('Page.frameNavigated', (p) => {
      // Only the top-level frame changes the address bar.
      if (!p.frame.parentId) { this.docStale = true; cb(p.frame.url); }
    });
  }

  onCrashed(cb: (reason: string) => void): void {
    this.client.on('Inspector.targetCrashed', () => cb('renderer crashed'));
    // The CDP socket can also drop without the process exiting (heavy load, a killed helper).
    // Without this the panel just freezes: frames stop and every call rejects.
    (this.client as unknown as { on(e: string, l: () => void): void })
      .on('disconnect', () => { if (!this.closing) cb('devtools connection lost'); });
  }

  // ---------------------------------------------------------------- screencast
  async startScreencast(opts: { quality: number; maxWidth: number; maxHeight: number; everyNthFrame: number }): Promise<void> {
    await this.client.Page.startScreencast({ format: 'jpeg', ...opts });
  }

  async stopScreencast(): Promise<void> {
    await this.client.Page.stopScreencast().catch(() => undefined);
  }

  onScreencastFrame(cb: (f: ScreencastFrame) => void): void {
    this.client.on('Page.screencastFrame', (p) => cb(p as ScreencastFrame));
  }

  async ackFrame(sessionId: number): Promise<void> {
    await this.client.Page.screencastFrameAck({ sessionId }).catch(() => undefined);
  }

  /**
   * Screencast only emits on repaint, so a static page yields ZERO frames and the canvas stays
   * blank on load. Every start/restart must force a paint (verified in spike S4b).
   */
  async forceRepaint(): Promise<void> {
    // Must actually paint. Setting an unused custom property or scrolling a non-scrollable
    // page changes nothing, so no frame is produced. Insert a real, briefly-visible layer,
    // flush layout, then remove it on a later frame.
    await this.evaluate<void>(`
      (() => {
        const el = document.createElement('div');
        el.setAttribute('data-ux-repaint', '');
        el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;' +
                           'background:rgba(0,0,0,0.004)';
        (document.body || document.documentElement).appendChild(el);
        void el.getBoundingClientRect().width;   // flush layout
        requestAnimationFrame(() => requestAnimationFrame(() => el.remove()));
      })()`).catch(() => undefined);
  }

  // ---------------------------------------------------------------- viewport
  async setViewport(v: { width: number; height: number; deviceScaleFactor: number; mobile: boolean }): Promise<void> {
    await this.client.Emulation.setDeviceMetricsOverride(v);
  }

  async clearViewport(): Promise<void> {
    await this.client.Emulation.clearDeviceMetricsOverride();
  }

  async setTouchEmulation(enabled: boolean, maxTouchPoints = 1): Promise<void> {
    await this.client.Emulation.setTouchEmulationEnabled({ enabled, maxTouchPoints });
  }

  async setUserAgent(userAgent: string): Promise<void> {
    await this.client.Emulation.setUserAgentOverride({ userAgent });
  }

  // ---------------------------------------------------------------- input
  async dispatchMouse(p: {
    type: MouseEventType; x: number; y: number; button?: Protocol.Input.MouseButton;
    clickCount?: number; deltaX?: number; deltaY?: number; modifiers?: number;
  }): Promise<void> {
    await this.client.Input.dispatchMouseEvent({
      type: p.type, x: p.x, y: p.y,
      button: p.button ?? 'left',
      clickCount: p.clickCount ?? 0,
      deltaX: p.deltaX, deltaY: p.deltaY,
      modifiers: p.modifiers ?? 0,
    });
  }

  async dispatchKey(p: Protocol.Input.DispatchKeyEventRequest): Promise<void> {
    await this.client.Input.dispatchKeyEvent(p);
  }

  // ---------------------------------------------------------------- CSS / a11y
  async nodeAt(x: number, y: number): Promise<number | null> {
    try {
      // getNodeForLocation resolves against DOM agent node ids, which only exist after the
      // document has been requested. Request it once per document, NOT per call: a fresh
      // getDocument invalidates every previously handed-out nodeId, which silently orphans
      // things keyed by id — forced pseudo-states could then never be released.
      if (this.docStale) {
        await this.client.DOM.getDocument({ depth: -1, pierce: true });
        this.docStale = false;
      }
      const { nodeId } = await this.client.DOM.getNodeForLocation({ x, y, includeUserAgentShadowDOM: false });
      return nodeId || null;
    } catch { return null; }
  }

  async computedStyle(nodeId: number): Promise<Protocol.CSS.CSSComputedStyleProperty[]> {
    const { computedStyle } = await this.client.CSS.getComputedStyleForNode({ nodeId });
    return computedStyle;
  }

  async matchedStyles(nodeId: number): Promise<Protocol.CSS.GetMatchedStylesForNodeResponse> {
    return this.client.CSS.getMatchedStylesForNode({ nodeId });
  }

  /** Force :hover/:focus/:active etc. on a node (PLAN §4.6 state lab). */
  async forcePseudoState(nodeId: number, states: string[]): Promise<void> {
    await this.client.CSS.forcePseudoState({ nodeId, forcedPseudoClasses: states });
  }

  async partialAXTree(nodeId: number): Promise<Protocol.Accessibility.AXNode[]> {
    await this.client.Accessibility.enable();
    const { nodes } = await this.client.Accessibility.getPartialAXTree({ nodeId, fetchRelatives: false });
    return nodes;
  }

  // ---------------------------------------------------------------- emulation
  async setVisionDeficiency(type: string): Promise<void> {
    await this.client.Emulation.setEmulatedVisionDeficiency({
      type: type as Protocol.Emulation.SetEmulatedVisionDeficiencyRequest['type'],
    });
  }

  async setEmulatedMedia(features: Array<{ name: string; value: string }>): Promise<void> {
    await this.client.Emulation.setEmulatedMedia({ features });
  }

  // ---------------------------------------------------------------- fetch interception
  async fetchEnable(): Promise<void> {
    await this.client.Fetch.enable({ patterns: [{ urlPattern: '*' }] });
  }

  async fetchDisable(): Promise<void> {
    await this.client.Fetch.disable().catch(() => undefined);
  }

  onRequestPaused(cb: (ev: Protocol.Fetch.RequestPausedEvent) => void): void {
    this.client.on('Fetch.requestPaused', cb);
  }

  async continueRequest(requestId: string): Promise<void> {
    await this.client.Fetch.continueRequest({ requestId }).catch(() => undefined);
  }

  async fulfillRequest(
    requestId: string, responseCode: number,
    responseHeaders: Protocol.Fetch.HeaderEntry[], body: string,
  ): Promise<void> {
    await this.client.Fetch.fulfillRequest({ requestId, responseCode, responseHeaders, body })
      .catch(() => undefined);
  }

  async failRequest(requestId: string, errorReason: Protocol.Network.ErrorReason): Promise<void> {
    await this.client.Fetch.failRequest({ requestId, errorReason }).catch(() => undefined);
  }

  // ---------------------------------------------------------------- cookies
  async getCookies(): Promise<Protocol.Network.Cookie[]> {
    const { cookies } = await this.client.Network.getCookies({});
    return cookies;
  }

  async setCookies(cookies: Protocol.Network.CookieParam[]): Promise<void> {
    await this.client.Network.setCookies({ cookies });
  }

  async clearCookies(): Promise<void> {
    await this.client.Network.clearBrowserCookies();
  }

  // ---------------------------------------------------------------- network
  async emulateNetwork(c: { offline: boolean; latency: number; downloadThroughput: number; uploadThroughput: number }): Promise<void> {
    await this.client.Network.emulateNetworkConditions(c);
  }

  // ---------------------------------------------------------------- misc
  async captureScreenshot(): Promise<string> {
    const { data } = await this.client.Page.captureScreenshot({ format: 'png' });
    return data;
  }

  /** JPEG variant, matching the screencast's own encoding so a frame can be seeded from it. */
  async captureJpeg(quality: number): Promise<string> {
    const { data } = await this.client.Page.captureScreenshot({ format: 'jpeg', quality });
    return data;
  }

  async evaluate<T>(expression: string): Promise<T> {
    const { result, exceptionDetails } = await this.client.Runtime.evaluate({
      expression, returnByValue: true, awaitPromise: true,
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.text + (exceptionDetails.exception?.description ?? ''));
    }
    return result.value as T;
  }

  async addInitScript(source: string): Promise<void> {
    await this.client.Page.addScriptToEvaluateOnNewDocument({ source });
  }

  async addBinding(name: string): Promise<void> {
    await this.client.Runtime.addBinding({ name });
  }

  onBindingCalled(cb: (name: string, payload: string) => void): void {
    this.client.on('Runtime.bindingCalled', (p) => cb(p.name, p.payload));
  }

  /** Escape hatch for domains not yet wrapped; keep call sites rare and reviewed. */
  get raw(): CDPClient { return this.client; }

  async close(): Promise<void> {
    this.closing = true;
    await this.client.close().catch(() => undefined);
  }
}
