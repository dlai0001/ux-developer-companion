import { useEffect, useRef, useState } from 'react';
import {
  anchorPoint, isClickPlaced, isDegenerate, newId,
  type Annotation, type AnnotationKind, type Point,
} from '../../shared/annotations.js';
import { drawAnnotations } from '../../shared/compositor.js';
import { useStore } from '../state/store.js';
import { post } from '../post.js';

interface Props {
  /** Page CSS size, used to map canvas px <-> page px. */
  viewport: { width: number; height: number } | null;
}

/**
 * Overlay canvas above the frame canvas (PLAN §4.4). In annotate mode it captures the pointer;
 * in browse mode it is inert and events pass through to BrowserView.
 */
export function AnnotationLayer({ viewport }: Props): JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.tool);
  const color = useStore((s) => s.color);
  const annotations = useStore((s) => s.annotations);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [editing, setEditing] = useState<{ id: string; x: number; y: number } | null>(null);
  const seed = useRef(0);

  const toPage = (e: React.MouseEvent): Point => {
    const c = canvasRef.current;
    if (!c || !viewport) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * viewport.width),
      y: Math.round(((e.clientY - r.top) / r.height) * viewport.height),
    };
  };

  const draw = (): void => {
    const c = canvasRef.current;
    if (!c || !viewport) return;
    const rect = c.getBoundingClientRect();
    // A zero-sized box means the panel is collapsed or not laid out yet. Resizing the canvas
    // to it would WIPE the marks, and nothing in the model changes on the way back, so the
    // wipe would stick until the next tool click. Leave the bitmap alone and wait.
    if (rect.width < 1 || rect.height < 1) return;
    const scale = rect.width / viewport.width;
    if (c.width !== Math.round(rect.width) || c.height !== Math.round(rect.height)) {
      c.width = Math.round(rect.width);
      c.height = Math.round(rect.height);
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    drawAnnotations(ctx, draft ? [...annotations, draft] : annotations, { scale });
  };
  // Held in a ref so the ResizeObserver below always calls the CURRENT draw without having to
  // re-subscribe every time the model changes.
  const drawRef = useRef(draw);
  drawRef.current = draw;

  // Redraw whenever the model changes.
  useEffect(() => { drawRef.current(); }, [annotations, draft, viewport, mode, tool]);

  // …and whenever the canvas box changes. Dragging the panel, wrapping the toolbar or opening
  // Tools resizes us without touching the model, and a canvas keeps its old bitmap through a
  // CSS resize — so without this the marks would sit there stretched and mis-scaled until
  // something else happened to trigger a redraw.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => drawRef.current());
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  /**
   * Armed means "a click draws". The layer itself is ALWAYS mounted: marks have to stay on
   * screen while browsing and while parked, so unmounting it would take them with it. When it
   * is not armed it just stops taking the pointer.
   */
  const armed = mode === 'annotate' && tool !== null;

  const commit = (a: Annotation): void => {
    if (isDegenerate(a)) { setDraft(null); return; }
    useStore.getState().addAnnotation(a);
    setDraft(null);
    // Anchor-resolve on creation for ALL kinds (PLAN §4.4).
    const p = anchorPoint(a);
    post({ type: 'resolve-annotation', id: a.id, x: p.x, y: p.y });
    if (a.kind === 'text' || a.kind === 'callout') {
      const c = canvasRef.current;
      const r = c?.getBoundingClientRect();
      const scale = r && viewport ? r.width / viewport.width : 1;
      setEditing({ id: a.id, x: a.from.x * scale, y: a.from.y * scale });
      return;   // disarm only once the text is committed
    }
    disarm();
  };

  /**
   * A finished mark drops the tool and lands in `idle` rather than Browse: the next stray click
   * neither draws a second mark nor navigates the page. Browse is a deliberate click away.
   */
  const disarm = (): void => {
    const s = useStore.getState();
    s.setTool(null);
    s.setMode('idle');
    post({ type: 'set-tool', tool: null });
    post({ type: 'set-mode', mode: 'idle' });
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        data-testid="annotation-layer"
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          cursor: armed ? 'crosshair' : 'default', zIndex: 2,
          // Unarmed the layer is a pane of glass: the marks show through it, clicks do not
          // stop at it — browse-mode input still reaches the frame canvas underneath.
          pointerEvents: armed ? 'auto' : 'none',
        }}
        onMouseDown={(e) => {
          if (!armed || !tool) return;
          e.preventDefault();
          // Clicking away from an open label commits it and nothing else. preventDefault here
          // means the textarea would otherwise keep focus and the click would start a new mark.
          if (editing) { editorRef.current?.blur(); return; }
          const p = toPage(e);
          const kind: AnnotationKind = tool;
          const fresh: Annotation = {
            // A callout's press point is the TAIL TARGET; the drag then places the bubble.
            id: newId(++seed.current), kind, from: p, to: p, color,
            ...(kind === 'callout' ? { text: '', anchor: p } : {}),
            ...(kind === 'text' ? { text: '' } : {}),
          };
          // Text is placed by a single click, so commit now rather than waiting for a drag
          // that never comes.
          if (isClickPlaced(kind)) { commit(fresh); return; }
          setDraft(fresh);
        }}
        onMouseMove={(e) => {
          if (!draft) return;
          const p = toPage(e);
          // A callout drags its BODY away from the anchor it was started on.
          setDraft(draft.kind === 'callout' ? { ...draft, from: p } : { ...draft, to: p });
        }}
        onMouseUp={() => { if (draft) commit(draft); }}
      />
      {editing && (
        <textarea
          ref={editorRef}
          data-testid="callout-input"
          autoFocus
          style={{
            position: 'absolute', left: editing.x, top: editing.y, zIndex: 3,
            width: 240, minHeight: 46, font: '13px system-ui', padding: 6,
            border: `2px solid ${color}`, borderRadius: 6, resize: 'none',
          }}
          onBlur={(e) => {
            const text = e.target.value;
            const s = useStore.getState();
            // An empty label is just a stray click — drop it rather than leaving a dot behind.
            if (text.trim()) s.setAnnotationText(editing.id, text);
            else s.removeAnnotation(editing.id);
            setEditing(null);
            disarm();
          }}
          onInput={(e) => {
            // Keep the live bubble in step with what is being typed, so its box grows as the
            // user writes rather than jumping to its final size on blur.
            useStore.getState().setAnnotationText(editing.id, (e.target as HTMLTextAreaElement).value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
              (e.target as HTMLTextAreaElement).blur();
            }
            e.stopPropagation();   // never leak typing into the page
          }}
        />
      )}
    </>
  );
}
