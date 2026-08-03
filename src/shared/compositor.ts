// Draws annotations over a base screenshot (PLAN §4.4). Pure Canvas2D so the same code runs in
// the webview (live overlay) and in an OffscreenCanvas when producing the annotated PNG.
import { normalizeRect, type Annotation } from './annotations.js';

export interface DrawScale {
  /** Multiply page CSS px by this to reach canvas px. */
  scale: number;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const ARROW_HEAD = 12;
const CALLOUT_PAD = 8;
const CALLOUT_MAX_W = 260;
/** Empty callouts start about ten characters wide and grow as the user types. */
const CALLOUT_MIN_CHARS = 10;

/**
 * NOTE: this module is also serialized function-by-function and evaluated INSIDE the page by
 * src/extension/session/capture.ts, so the extension host does not need a native canvas.
 * That means every helper must be exported and included there — a private helper compiles
 * fine here but throws "X is not defined" in the page.
 */
export function drawAnnotations(ctx: Ctx, annotations: Annotation[], { scale }: DrawScale): void {
  for (const a of annotations) drawOne(ctx, a, scale);
}

export function drawOne(ctx: Ctx, a: Annotation, s: number): void {
  ctx.save();
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = Math.max(2, 2 * s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (a.kind === 'rect') {
    const r = normalizeRect(a.from, a.to);
    ctx.strokeRect(r.x * s, r.y * s, r.width * s, r.height * s);
  } else if (a.kind === 'ellipse') {
    const r = normalizeRect(a.from, a.to);
    ctx.beginPath();
    ctx.ellipse(
      (r.x + r.width / 2) * s, (r.y + r.height / 2) * s,
      Math.max(1, (r.width / 2) * s), Math.max(1, (r.height / 2) * s), 0, 0, Math.PI * 2,
    );
    ctx.stroke();
  } else if (a.kind === 'text') {
    drawLabel(ctx, a, s);
  } else if (a.kind === 'arrow') {
    drawArrow(ctx, a.from.x * s, a.from.y * s, a.to.x * s, a.to.y * s, ARROW_HEAD * s);
  } else {
    drawCallout(ctx, a, s);
  }
  ctx.restore();
}

export function drawArrow(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, head: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

/** Sketch-style speech bubble: rounded body + tail pointing at the anchor. */
export function drawCallout(ctx: Ctx, a: Annotation, s: number): void {
  const font = `${Math.round(13 * s)}px system-ui, sans-serif`;
  ctx.font = font;
  const lines = wrapText(ctx, a.text ?? '', CALLOUT_MAX_W * s);
  const lineHeight = Math.round(17 * s);
  const pad = CALLOUT_PAD * s;
  const minWidth = ctx.measureText('0'.repeat(CALLOUT_MIN_CHARS)).width + pad * 2;
  const width = Math.max(
    minWidth,
    Math.min(CALLOUT_MAX_W * s, Math.max(...lines.map((l) => ctx.measureText(l).width), 0)) + pad * 2,
  );
  const height = lines.length * lineHeight + pad * 2;
  const x = a.from.x * s;
  const y = a.from.y * s;

  // Solid fill in the annotation colour with white text: a filled bubble reads as a comment
  // rather than as part of the UI being annotated.
  roundRect(ctx, x, y, width, height, 6 * s);
  ctx.fillStyle = a.color;
  ctx.fill();
  ctx.strokeStyle = a.color;
  ctx.stroke();

  if (a.anchor) {
    // Tail from the nearest bubble edge to the anchored point.
    const ax = a.anchor.x * s;
    const ay = a.anchor.y * s;
    const cx = Math.max(x + 8 * s, Math.min(ax, x + width - 8 * s));
    const cy = ay > y + height ? y + height : y;
    ctx.beginPath();
    ctx.moveTo(cx - 6 * s, cy);
    ctx.lineTo(cx + 6 * s, cy);
    ctx.lineTo(ax, ay);
    ctx.closePath();
    ctx.fillStyle = a.color;
    ctx.fill();
    ctx.strokeStyle = a.color;
    ctx.stroke();
  }

  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => ctx.fillText(line, x + pad, y + pad + i * lineHeight));
}

/** Plain text label — no bubble, no tail. Drawn with a subtle halo so it stays legible
 *  over busy screenshots without hiding what is underneath. */
export function drawLabel(ctx: Ctx, a: Annotation, s: number): void {
  ctx.font = `600 ${Math.round(15 * s)}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  const lines = wrapText(ctx, a.text ?? '', 320 * s);
  const lineHeight = Math.round(19 * s);
  lines.forEach((line, i) => {
    const x = a.from.x * s;
    const y = a.from.y * s + i * lineHeight;
    ctx.lineWidth = Math.max(3, 3 * s);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeText(line, x, y);
    ctx.fillStyle = a.color;
    ctx.fillText(line, x, y);
  });
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function wrapText(ctx: Ctx, text: string, maxWidth: number): string[] {
  if (!text) return [''];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}
