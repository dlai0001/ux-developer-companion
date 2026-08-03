import { useEffect, useRef } from 'react';
import type { InputModifiers, MouseKind } from '../../shared/protocol.js';
import { useStore } from '../state/store.js';
import { post } from '../post.js';
import { AnnotationLayer } from '../annotations/AnnotationLayer.js';

const mods = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): InputModifiers => ({
  alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey,
});

/**
 * Draws screencast frames and forwards input. Two policies carried over from spike S4b:
 *  - latest-frame-wins: never queue more than one undrawn frame
 *  - draw inside requestAnimationFrame, never synchronously per message
 */
export function BrowserView(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pending = useRef<string | null>(null);
  const drawing = useRef(false);
  const viewport = useStore((s) => s.viewport);
  const mode = useStore((s) => s.mode);
  const pickMode = useStore((s) => s.pickMode);

  // Frame pump: the store holds only the newest frame, so a slow draw drops stale ones.
  const frame = useStore((s) => s.frame);
  useEffect(() => {
    if (!frame) return;
    pending.current = frame;
    if (drawing.current) return;

    const pump = (): void => {
      drawing.current = true;
      requestAnimationFrame(() => {
        const src = pending.current;
        pending.current = null;
        if (!src) { drawing.current = false; return; }
        const img = new Image();
        img.onload = () => {
          const c = canvasRef.current;
          if (c) {
            if (c.width !== img.width || c.height !== img.height) {
              c.width = img.width;
              c.height = img.height;
            }
            c.getContext('2d')?.drawImage(img, 0, 0);
          }
          drawing.current = false;
          if (pending.current) pump();
        };
        img.onerror = () => { drawing.current = false; };
        img.src = src;
      });
    };
    pump();
  }, [frame]);

  // Report our CSS size so the host can set an exact device-metrics override.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const report = (): void => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        post({ type: 'resize', width: Math.round(r.width), height: Math.round(r.height) });
      }
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Canvas px -> page CSS px. The host pins device metrics to the reported size, so this is
   *  a straight ratio against the displayed canvas rect. */
  const toPage = (e: React.MouseEvent | React.WheelEvent): { x: number; y: number } => {
    const c = canvasRef.current;
    if (!c || !viewport) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * viewport.width),
      y: Math.round(((e.clientY - r.top) / r.height) * viewport.height),
    };
  };

  const sendMouse = (kind: MouseKind, e: React.MouseEvent | React.WheelEvent,
                     delta?: { deltaX: number; deltaY: number }): void => {
    // A pick click is forwarded from any mode: the host consumes it to resolve a component
    // rather than passing it to the page, so it cannot navigate anything.
    if (mode !== 'browse' && !(pickMode && kind === 'down')) return;
    const { x, y } = toPage(e);
    post({ type: 'mouse', kind, x, y, modifiers: mods(e), ...(delta ?? {}) });
  };

  const lastMove = useRef(0);

  return (
    <div ref={wrapRef} style={{ width: '100%', flex: 1, minHeight: 0, position: 'relative' }}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        data-testid="browser-canvas"
        style={{
          width: '100%', height: '100%', objectFit: 'contain', background: '#000', outline: 'none',
          // idle looks inert on purpose: no crosshair to suggest drawing, no pointer to suggest
          // the page is live.
          cursor: mode === 'annotate' || pickMode ? 'crosshair' : 'default',
        }}
        onMouseDown={(e) => { e.preventDefault(); canvasRef.current?.focus(); sendMouse('down', e); }}
        onMouseUp={(e) => sendMouse('up', e)}
        onMouseMove={(e) => {
          const now = performance.now();
          if (now - lastMove.current < 16) return; // ~60 Hz cap
          lastMove.current = now;
          sendMouse('move', e);
        }}
        onWheel={(e) => sendMouse('wheel', e, { deltaX: e.deltaX, deltaY: e.deltaY })}
        onKeyDown={(e) => {
          if (mode !== 'browse') return;
          // Let VS Code keep its own chords (e.g. cmd+shift+p) rather than swallowing them.
          if ((e.metaKey || e.ctrlKey) && ['p', 'P', 'w', 'W'].includes(e.key)) return;
          e.preventDefault();
          post({ type: 'key', key: e.key, code: e.code, modifiers: mods(e) });
        }}
      />
      <AnnotationLayer viewport={viewport} />
    </div>
  );
}
