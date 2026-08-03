import { describe, expect, it } from 'vitest';
import {
  isHostToWebview,
  isWebviewToHost,
  type HostToWebview,
  type WebviewToHost,
} from '../../src/shared/protocol.js';

describe('protocol guards', () => {
  it('accepts well-formed host->webview messages', () => {
    const msgs: HostToWebview[] = [
      { type: 'ready', extensionVersion: '0.0.1' },
      { type: 'status', text: 'hi', tone: 'info' },
      { type: 'frame', data: 'AAAA', sentAt: 1, capturedAt: null },
      { type: 'url-changed', url: 'http://127.0.0.1:5173/' },
      { type: 'mode-changed', mode: 'annotate' },
    ];
    for (const m of msgs) expect(isHostToWebview(m)).toBe(true);
  });

  it('accepts well-formed webview->host messages', () => {
    const msgs: WebviewToHost[] = [
      { type: 'webview-ready' },
      { type: 'navigate', url: 'http://127.0.0.1:5173/list' },
      { type: 'key', key: 'a', code: 'KeyA', modifiers: { alt: false, ctrl: false, meta: false, shift: false } },
      { type: 'mouse', kind: 'wheel', x: 1, y: 2, deltaX: 0, deltaY: 40,
        modifiers: { alt: false, ctrl: false, meta: false, shift: false } },
      { type: 'resize', width: 800, height: 600 },
    ];
    for (const m of msgs) expect(isWebviewToHost(m)).toBe(true);
  });

  it('rejects non-messages', () => {
    for (const bad of [null, undefined, 42, 'frame', {}, { type: 1 }, []]) {
      expect(isHostToWebview(bad)).toBe(false);
      expect(isWebviewToHost(bad)).toBe(false);
    }
  });
});
