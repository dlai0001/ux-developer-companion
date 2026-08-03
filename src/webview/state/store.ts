import { create } from 'zustand';
import type { Mode } from '../../shared/protocol.js';
import type { ComponentInfo } from '../../shared/agent-api.js';

export interface AppState {
  ready: boolean;
  extensionVersion: string;
  url: string;
  mode: Mode;
  status: { text: string; tone: 'info' | 'warn' | 'error' } | null;
  /** Newest frame as a data URI. Only the latest is retained — stale frames are dropped. */
  frame: string | null;
  /** Page CSS size the host pinned via setDeviceMetricsOverride; drives coordinate mapping. */
  viewport: { width: number; height: number } | null;
  selected: ComponentInfo | null;
  setReady(version: string): void;
  setStatus(text: string, tone: 'info' | 'warn' | 'error'): void;
  setUrl(url: string): void;
  setMode(mode: Mode): void;
  setFrame(dataUri: string): void;
  setViewport(v: { width: number; height: number }): void;
  setSelected(c: ComponentInfo | null): void;
}

export const useStore = create<AppState>((set) => ({
  ready: false,
  extensionVersion: '',
  url: '',
  mode: 'browse',
  status: null,
  frame: null,
  viewport: null,
  selected: null,
  setReady: (extensionVersion) => set({ ready: true, extensionVersion }),
  setStatus: (text, tone) => set({ status: { text, tone } }),
  setUrl: (url) => set({ url }),
  setMode: (mode) => set({ mode }),
  setFrame: (frame) => set({ frame }),
  setViewport: (viewport) => set({ viewport }),
  setSelected: (selected) => set({ selected }),
}));
