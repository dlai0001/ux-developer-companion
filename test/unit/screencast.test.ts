import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreencastController } from '../../src/extension/session/screencast.js';
import type { CdpSession } from '../../src/extension/browser/cdp.js';
import type { FrameMessage } from '../../src/shared/protocol.js';

/** Lets unserialized code interleave: without gaps every fake would look atomic. */
const yieldTicks = async (n = 3): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

interface Fake {
  cdp: CdpSession;
  ops: string[];
  emitFrame(): void;
  /** Make forceRepaint behave like a page that actually repaints into a live stream. */
  repaintProducesFrame: boolean;
}

function fakeCdp(): Fake {
  const ops: string[] = [];
  let onFrame: ((f: { data: string; metadata: { timestamp?: number }; sessionId: number }) => void) | undefined;
  const state = { repaintProducesFrame: false };
  const emitFrame = (): void => {
    onFrame?.({ data: 'LIVE', metadata: { timestamp: 1 }, sessionId: 1 });
  };
  const cdp = {
    onScreencastFrame: (cb: typeof onFrame) => { onFrame = cb; },
    ackFrame: async () => { await yieldTicks(1); },
    startScreencast: async () => { await yieldTicks(); ops.push('start'); },
    stopScreencast: async () => { await yieldTicks(); ops.push('stop'); },
    forceRepaint: async () => {
      await yieldTicks(1);
      ops.push('repaint');
      if (state.repaintProducesFrame) emitFrame();
    },
    captureJpeg: async () => { ops.push('captureJpeg'); return 'SEEDED'; },
  };
  return {
    cdp: cdp as unknown as CdpSession,
    ops,
    emitFrame,
    get repaintProducesFrame() { return state.repaintProducesFrame; },
    set repaintProducesFrame(v: boolean) { state.repaintProducesFrame = v; },
  };
}

describe('screencast controller', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('seeds a frame when a static page produces none — the black-canvas case', async () => {
    // A page that never repaints into the stream: forceRepaint fires but Chrome emits nothing,
    // which is what leaves the canvas black on first load.
    const fake = fakeCdp();
    const sent: FrameMessage[] = [];
    const sc = new ScreencastController(fake.cdp, (f) => sent.push(f));

    await sc.start();
    expect(sent).toHaveLength(0);          // nothing yet — the seed is deliberately deferred

    await vi.advanceTimersByTimeAsync(1000);

    expect(fake.ops).toContain('captureJpeg');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.data).toBe('SEEDED');
  });

  it('does not seed when the stream is already delivering', async () => {
    const fake = fakeCdp();
    fake.repaintProducesFrame = true;
    const sent: FrameMessage[] = [];
    const sc = new ScreencastController(fake.cdp, (f) => sent.push(f));

    await sc.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(fake.ops).not.toContain('captureJpeg');
    expect(sent.map((f) => f.data)).toEqual(['LIVE']);
  });

  it('never overlaps two stream operations', async () => {
    // Two startScreencast calls with no stop between them wedge Chrome's screencast for good,
    // and a debounced resize landing mid-start is exactly how that happens.
    const fake = fakeCdp();
    const sc = new ScreencastController(fake.cdp, () => undefined);

    await Promise.all([sc.start(), sc.restart(), sc.restart()]);
    await vi.advanceTimersByTimeAsync(1000);

    const stream = fake.ops.filter((o) => o === 'start' || o === 'stop');
    expect(stream).toEqual(['stop', 'start', 'stop', 'start', 'stop', 'start']);
  });

  it('drops a superseded seed rather than painting a stale frame', async () => {
    const fake = fakeCdp();
    const sent: FrameMessage[] = [];
    const sc = new ScreencastController(fake.cdp, (f) => sent.push(f));

    await sc.start();
    await vi.advanceTimersByTimeAsync(100);   // first seed still waiting
    await sc.restart();
    await vi.advanceTimersByTimeAsync(1000);

    // Exactly one seed reaches the webview: the superseded start's seed stays quiet.
    expect(sent).toHaveLength(1);
  });

  it('cancels a pending seed on stop', async () => {
    const fake = fakeCdp();
    const sent: FrameMessage[] = [];
    const sc = new ScreencastController(fake.cdp, (f) => sent.push(f));

    await sc.start();
    await vi.advanceTimersByTimeAsync(100);
    await sc.stop();
    await vi.advanceTimersByTimeAsync(1000);

    expect(sent).toHaveLength(0);
  });
});
