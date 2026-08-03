// Builds the context text sent alongside the screenshots (PLAN §4.5). Deliberately short: the
// images carry the detail, and every extra line here competes with the user's own request.
import type { Annotation } from '../../shared/annotations.js';

export interface EmulationState {
  viewport: { width: number; height: number; dpr: number };
  devicePreset?: string;
  forcedPseudo?: string;
  visionDeficiency?: string;
  colorScheme?: string;
  network?: string;
  interceptRules?: number;
}

export interface ComposeInput {
  url: string;
  route: string;
  timestamp: string;
  emulation: EmulationState;
  annotations: Annotation[];
  captureDir: string;
}

const truncate = (s: string, n = 240): string => (s.length > n ? `${s.slice(0, n)}…` : s);

export function composeContext(input: ComposeInput): string {
  const { emulation: e } = input;
  const lines: string[] = [];

  lines.push(`UX Companion context — ${input.timestamp}`);
  lines.push(`URL: ${input.url}   Route: ${input.route}`);

  const viewportBits = [`${e.viewport.width}×${e.viewport.height} @${e.viewport.dpr}x`];
  if (e.devicePreset) viewportBits.push(`(${e.devicePreset})`);
  const state: string[] = [`Viewport: ${viewportBits.join(' ')}`];
  if (e.forcedPseudo) state.push(`forced: ${e.forcedPseudo}`);
  const emu = [e.visionDeficiency, e.colorScheme].filter(Boolean).join(', ');
  if (emu) state.push(`emulation: ${emu}`);
  if (e.network) state.push(`network: ${e.network}`);
  if (e.interceptRules) state.push(`intercept rules: ${e.interceptRules} active`);
  lines.push(state.join(' | '));

  // The per-annotation component/props/source dump used to live here. It was the bulk of the
  // prompt and mostly restated what the annotated image already shows, so the marks now speak for
  // themselves and only the notes written on them carry through as text.
  const notes = input.annotations
    .map((a) => a.text?.trim())
    .filter((t): t is string => Boolean(t));
  if (notes.length) {
    lines.push('Notes on the annotated screenshot:');
    notes.forEach((t, i) => lines.push(`[${i + 1}] ${truncate(t, 200)}`));
  }

  lines.push('Images: (1) clean screenshot, (2) annotated screenshot — attached above');
  lines.push(`Saved to: ${input.captureDir}`);
  return lines.join('\n');
}

/** Route portion of a URL, for the Route: line. */
export function routeOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
