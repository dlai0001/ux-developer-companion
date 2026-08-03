import { create } from 'zustand';
import type { Mode } from '../../shared/protocol.js';
import type { ComponentInfo } from '../../shared/agent-api.js';
import type { ComponentTreeNode } from '../../shared/agent-api.js';
import type { Annotation, AnnotationKind } from '../../shared/annotations.js';

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
  annotations: Annotation[];
  tool: AnnotationKind;
  color: string;
  setReady(version: string): void;
  addAnnotation(a: Annotation): void;
  setAnnotationText(id: string, text: string): void;
  setAnnotationComponent(id: string, component: ComponentInfo | null): void;
  clearAnnotations(): void;
  undoAnnotation(): void;
  setTool(tool: AnnotationKind): void;
  setColor(color: string): void;
  setStatus(text: string, tone: 'info' | 'warn' | 'error'): void;
  setUrl(url: string): void;
  setMode(mode: Mode): void;
  setFrame(dataUri: string): void;
  setViewport(v: { width: number; height: number }): void;
  setSelected(c: ComponentInfo | null): void;
  tree: ComponentTreeNode[];
  pickMode: boolean;
  supportsWrite: boolean;
  writeNote: string | null;
  setTree(nodes: ComponentTreeNode[]): void;
  setPickMode(on: boolean): void;
  setSupportsWrite(v: boolean): void;
  setWriteNote(note: string | null): void;
  breakpoints: number[];
  device: string | null;
  rotated: boolean;
  matrix: Array<{ width: number; png: string }>;
  setBreakpoints(w: number[]): void;
  setDevice(id: string | null): void;
  setRotated(v: boolean): void;
  setMatrix(t: Array<{ width: number; png: string }>): void;
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
  annotations: [],
  tool: 'rect',
  color: '#ff3ea5',
  setReady: (extensionVersion) => set({ ready: true, extensionVersion }),
  addAnnotation: (a) => set((s) => ({ annotations: [...s.annotations, a] })),
  setAnnotationText: (id, text) => set((s) => ({
    annotations: s.annotations.map((a) => (a.id === id ? { ...a, text } : a)),
  })),
  setAnnotationComponent: (id, component) => set((s) => ({
    annotations: s.annotations.map((a) => (a.id === id ? { ...a, componentRef: component } : a)),
  })),
  clearAnnotations: () => set({ annotations: [] }),
  undoAnnotation: () => set((s) => ({ annotations: s.annotations.slice(0, -1) })),
  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
  setStatus: (text, tone) => set({ status: { text, tone } }),
  setUrl: (url) => set({ url }),
  setMode: (mode) => set({ mode }),
  setFrame: (frame) => set({ frame }),
  setViewport: (viewport) => set({ viewport }),
  setSelected: (selected) => set({ selected }),
  tree: [],
  pickMode: false,
  supportsWrite: false,
  writeNote: null,
  setTree: (tree) => set({ tree }),
  setPickMode: (pickMode) => set({ pickMode }),
  setSupportsWrite: (supportsWrite) => set({ supportsWrite }),
  setWriteNote: (writeNote) => set({ writeNote }),
  breakpoints: [],
  device: null,
  rotated: false,
  matrix: [],
  setBreakpoints: (breakpoints) => set({ breakpoints }),
  setDevice: (device) => set({ device }),
  setRotated: (rotated) => set({ rotated }),
  setMatrix: (matrix) => set({ matrix }),
}));
