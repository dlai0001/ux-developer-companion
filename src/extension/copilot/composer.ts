// Builds the context text sent alongside the screenshots (PLAN §4.5).
import type { ComponentInfo } from '../../shared/agent-api.js';
import type { Annotation } from '../../shared/annotations.js';
import type { LocateResult } from '../locator-rank.js';

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
  /** Resolved source files, keyed by annotation id. */
  sources: Map<string, LocateResult>;
  captureDir: string;
}

const truncate = (s: string, n = 240): string => (s.length > n ? `${s.slice(0, n)}…` : s);

function describeComponent(c: ComponentInfo | null | undefined): string {
  if (!c) return 'no component resolved';
  const bits = [c.name];
  if (c.degraded === 'production-build') bits.push('(production build — name unreliable)');
  return bits.join(' ');
}

function snapshotLine(label: string, snap: Record<string, unknown> | null): string | null {
  if (!snap || Object.keys(snap).length === 0) return null;
  return `    ${label}: ${truncate(JSON.stringify(snap))}`;
}

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

  if (input.annotations.length) {
    lines.push('Annotated components:');
    input.annotations.forEach((a, i) => {
      const c = a.componentRef ?? null;
      const loc = input.sources.get(a.id);
      const label = a.kind === 'callout' && a.text ? `${a.kind} "${truncate(a.text, 80)}"` : a.kind;
      const file = loc?.best ? ` — ${loc.best.path}` : '';
      lines.push(`[${i + 1}] ${label} → ${describeComponent(c)}${file}`);
      // Alternates matter: ranked top-1 is ~87-95% accurate, so surfacing the runners-up
      // costs one line and covers most of the remaining error (FINDINGS S8).
      if (loc?.alternates.length) {
        lines.push(`    alternates: ${loc.alternates.map((x) => x.path).join(', ')}`);
      }
      const props = snapshotLine(c?.framework === 'angular' ? 'inputs' : 'props', c?.props ?? null);
      if (props) lines.push(props);
      const st = snapshotLine('state', c?.state ?? null);
      if (st) lines.push(st);
    });
  } else {
    lines.push('Annotated components: (none — full-viewport capture)');
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
