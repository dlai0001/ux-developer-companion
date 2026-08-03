// Screencast loop (PLAN §4.2). Defaults and policies here are measured, not guessed —
// see spikes/FINDINGS.md S4/S4b before changing any of them.
import type { CdpSession } from '../browser/cdp.js';
import type { FrameMessage } from '../../shared/protocol.js';

export interface ScreencastOptions {
  quality: number;
  /**
   * KEEP AT 1. Frame-skipping multiplies input latency because an interactive page only
   * repaints in response to input: measured keystroke-to-pixel p50 was 21.6 ms at 1,
   * 83.6 ms at 2, and 336 ms at 4. Control bandwidth with idle-pause instead.
   */
  everyNthFrame: number;
  maxWidth: number;
  maxHeight: number;
  /** Pause the stream after this long with no frames and no input; resume costs ~12 ms. */
  idleAfterMs: number;
}

export const DEFAULT_SCREENCAST: ScreencastOptions = {
  quality: 60,
  everyNthFrame: 1,
  maxWidth: 1280,
  maxHeight: 800,
  idleAfterMs: 10_000,
};

export class ScreencastController {
  private running = false;
  private paused = false;
  private idleTimer: NodeJS.Timeout | undefined;
  private lastActivity = Date.now();
  /** Diagnostics: raw CDP frames seen, independent of what reached the webview. */
  public framesReceived = 0;

  constructor(
    private readonly cdp: CdpSession,
    private readonly send: (f: FrameMessage) => void,
    private opts: ScreencastOptions = DEFAULT_SCREENCAST,
  ) {
    this.cdp.onScreencastFrame(({ data, metadata, sessionId }) => {
      this.framesReceived++;
      // Ack IMMEDIATELY — withholding the ack stalls the stream outright.
      void this.cdp.ackFrame(sessionId);
      this.lastActivity = Date.now();
      this.send({
        type: 'frame',
        data,
        sentAt: Date.now(),
        capturedAt: metadata.timestamp ? metadata.timestamp * 1000 : null,
      });
    });
  }

  get options(): ScreencastOptions { return this.opts; }
  get isRunning(): boolean { return this.running && !this.paused; }

  async start(overrides: Partial<ScreencastOptions> = {}): Promise<void> {
    this.opts = { ...this.opts, ...overrides };
    // Always stop first. Two startScreencast calls with no stop between them wedge the stream:
    // Chrome keeps delivering to the superseded session, so no further frames ever arrive —
    // not even for a visible repaint or a full navigation. Stopping is a no-op when idle.
    await this.cdp.stopScreencast();
    await this.cdp.startScreencast({
      quality: this.opts.quality,
      everyNthFrame: this.opts.everyNthFrame,
      maxWidth: this.opts.maxWidth,
      maxHeight: this.opts.maxHeight,
    });
    this.running = true;
    this.paused = false;
    // Reset the idle clock. Without this, a restart after an idle pause re-pauses on the very
    // next timer tick — before a single frame arrives — because lastActivity is still stale.
    this.lastActivity = Date.now();
    // Without this the canvas stays blank on a static page — no repaint means no frames.
    await this.cdp.forceRepaint();
    this.armIdleTimer();
  }

  /** Restart after a resize or metrics change (debounced by the caller). */
  async restart(overrides: Partial<ScreencastOptions> = {}): Promise<void> {
    await this.start(overrides);   // start() stops first
  }

  async stop(): Promise<void> {
    this.clearIdleTimer();
    this.running = false;
    await this.cdp.stopScreencast();
  }

  /** Called on any user input so an interactive session never idles out mid-use. */
  noteActivity(): void {
    this.lastActivity = Date.now();
    if (this.running && this.paused) void this.resume();
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    if (!Number.isFinite(this.opts.idleAfterMs) || this.opts.idleAfterMs <= 0) return;
    this.idleTimer = setInterval(() => {
      if (!this.running || this.paused) return;
      if (Date.now() - this.lastActivity >= this.opts.idleAfterMs) void this.pause();
    }, Math.max(1000, Math.floor(this.opts.idleAfterMs / 4)));
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) { clearInterval(this.idleTimer); this.idleTimer = undefined; }
  }

  private async pause(): Promise<void> {
    if (this.paused) return;
    this.paused = true;
    await this.cdp.stopScreencast();
  }

  private async resume(): Promise<void> {
    if (!this.paused) return;
    this.paused = false;
    await this.cdp.startScreencast({
      quality: this.opts.quality,
      everyNthFrame: this.opts.everyNthFrame,
      maxWidth: this.opts.maxWidth,
      maxHeight: this.opts.maxHeight,
    });
    await this.cdp.forceRepaint();
  }

  dispose(): void {
    this.clearIdleTimer();
    this.running = false;
  }
}
