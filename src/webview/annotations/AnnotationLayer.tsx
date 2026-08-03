import { useEffect, useRef, useState } from 'react';
import {
  anchorPoint, isDegenerate, newId, type Annotation, type AnnotationKind, type Point,
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

  // Redraw whenever the model or size changes.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !viewport) return;
    const rect = c.getBoundingClientRect();
    const scale = rect.width / viewport.width;
    if (c.width !== Math.round(rect.width) || c.height !== Math.round(rect.height)) {
      c.width = Math.round(rect.width);
      c.height = Math.round(rect.height);
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    drawAnnotations(ctx, draft ? [...annotations, draft] : annotations, { scale });
  }, [annotations, draft, viewport, mode]);

  if (mode !== 'annotate') return null;

  const commit = (a: Annotation): void => {
    if (isDegenerate(a)) { setDraft(null); return; }
    useStore.getState().addAnnotation(a);
    setDraft(null);
    // Anchor-resolve on creation for ALL kinds (PLAN §4.4).
    const p = anchorPoint(a);
    post({ type: 'resolve-annotation', id: a.id, x: p.x, y: p.y });
    if (a.kind === 'callout') {
      const c = canvasRef.current;
      const r = c?.getBoundingClientRect();
      const scale = r && viewport ? r.width / viewport.width : 1;
      setEditing({ id: a.id, x: a.from.x * scale, y: a.from.y * scale });
    }
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        data-testid="annotation-layer"
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          cursor: 'crosshair', zIndex: 2,
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          const p = toPage(e);
          const kind: AnnotationKind = tool;
          setDraft({
            id: newId(++seed.current), kind, from: p, to: p, color,
            ...(kind === 'callout' ? { text: '', anchor: p } : {}),
          });
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
          data-testid="callout-input"
          autoFocus
          style={{
            position: 'absolute', left: editing.x, top: editing.y, zIndex: 3,
            width: 240, height: 60, font: '13px system-ui', padding: 6,
            border: `2px solid ${color}`, borderRadius: 6, resize: 'none',
          }}
          onBlur={(e) => {
            useStore.getState().setAnnotationText(editing.id, e.target.value);
            setEditing(null);
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
