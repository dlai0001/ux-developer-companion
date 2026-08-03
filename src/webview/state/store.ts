import { create } from 'zustand';
import type { Mode } from '../../shared/protocol.js';

export interface AppState {
  ready: boolean;
  extensionVersion: string;
  url: string;
  mode: Mode;
  status: { text: string; tone: 'info' | 'warn' | 'error' } | null;
  /** Latest frame as a data URI, or null before the first frame (M1). */
  frame: string | null;
  setReady(version: string): void;
  setStatus(text: string, tone: 'info' | 'warn' | 'error'): void;
  setUrl(url: string): void;
  setMode(mode: Mode): void;
  setFrame(dataUri: string): void;
}

export const useStore = create<AppState>((set) => ({
  ready: false,
  extensionVersion: '',
  url: '',
  mode: 'browse',
  status: null,
  frame: null,
  setReady: (extensionVersion) => set({ ready: true, extensionVersion }),
  setStatus: (text, tone) => set({ status: { text, tone } }),
  setUrl: (url) => set({ url }),
  setMode: (mode) => set({ mode }),
  setFrame: (frame) => set({ frame }),
}));
