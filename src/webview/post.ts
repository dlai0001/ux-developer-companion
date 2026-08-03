import type { WebviewToHost } from '../shared/protocol.js';

interface VsCodeApi { postMessage(msg: unknown): void }
declare function acquireVsCodeApi(): VsCodeApi;

// acquireVsCodeApi() may only be called once per webview document.
const api = acquireVsCodeApi();

export const post = (msg: WebviewToHost): void => api.postMessage(msg);
