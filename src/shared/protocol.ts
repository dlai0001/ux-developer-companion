// ALL webview <-> host messages. Discriminated unions only — no stringly-typed messages (PLAN §2).
// M0 defines the envelope and the handful of messages the skeleton needs; later milestones extend
// the unions rather than inventing parallel channels.

import type { ComponentInfo } from './agent-api.js';

/** Screencast frame pushed host -> webview. */
export interface FrameMessage {
  type: 'frame';
  /** base64 JPEG, no data: prefix. */
  data: string;
  /** Date.now() when the host forwarded it — used to measure transport cost. */
  sentAt: number;
  /** Date.now()-equivalent of the CDP capture timestamp, or null when unavailable. */
  capturedAt: number | null;
}

export type Mode = 'browse' | 'annotate';

export type HostToWebview =
  | FrameMessage
  | { type: 'ready'; extensionVersion: string }
  | { type: 'status'; text: string; tone: 'info' | 'warn' | 'error' }
  | { type: 'url-changed'; url: string }
  | { type: 'mode-changed'; mode: Mode }
  /** Page CSS size pinned via setDeviceMetricsOverride — the webview needs it to map coordinates. */
  | { type: 'viewport-changed'; width: number; height: number }
  | { type: 'component-resolved'; component: ComponentInfo | null };

export type MouseKind = 'down' | 'up' | 'move' | 'wheel';

export interface InputModifiers {
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

export type WebviewToHost =
  | { type: 'webview-ready' }
  | { type: 'navigate'; url: string }
  | { type: 'go-back' }
  | { type: 'go-forward' }
  | { type: 'reload' }
  | { type: 'set-mode'; mode: Mode }
  | { type: 'key'; key: string; code: string; modifiers: InputModifiers }
  | ({ type: 'mouse'; kind: MouseKind; x: number; y: number; deltaX?: number; deltaY?: number;
       modifiers: InputModifiers })
  | { type: 'resize'; width: number; height: number }
  | { type: 'resolve-at'; x: number; y: number };

/** Narrowing helper shared by both sides so neither hand-rolls `as` casts. */
export function isHostToWebview(m: unknown): m is HostToWebview {
  return typeof m === 'object' && m !== null && typeof (m as { type?: unknown }).type === 'string';
}

export function isWebviewToHost(m: unknown): m is WebviewToHost {
  return typeof m === 'object' && m !== null && typeof (m as { type?: unknown }).type === 'string';
}
