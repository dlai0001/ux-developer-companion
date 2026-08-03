import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { isHostToWebview, type WebviewToHost } from '../shared/protocol.js';
import { useStore } from './state/store.js';

interface VsCodeApi {
  postMessage(msg: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscodeApi = acquireVsCodeApi();
export const post = (msg: WebviewToHost): void => vscodeApi.postMessage(msg);

function App(): JSX.Element {
  const { ready, extensionVersion, status, frame, mode } = useStore();

  useEffect(() => {
    const onMessage = (ev: MessageEvent<unknown>): void => {
      const m = ev.data;
      if (!isHostToWebview(m)) return;
      const s = useStore.getState();
      switch (m.type) {
        case 'ready': s.setReady(m.extensionVersion); break;
        case 'status': s.setStatus(m.text, m.tone); break;
        case 'url-changed': s.setUrl(m.url); break;
        case 'mode-changed': s.setMode(m.mode); break;
        case 'frame': s.setFrame(`data:image/jpeg;base64,${m.data}`); break;
        case 'component-resolved': break; // inspector panel arrives in M5
      }
    };
    window.addEventListener('message', onMessage);
    post({ type: 'webview-ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div style={{ font: '13px var(--vscode-font-family, system-ui)', padding: 12 }}>
      <h2 style={{ margin: '0 0 8px' }}>UX Developer Companion</h2>
      <p style={{ margin: '0 0 12px', opacity: 0.8 }}>
        {ready ? `Connected to extension v${extensionVersion}` : 'Connecting…'}
        {' · '}mode: {mode}
      </p>
      {status && (
        <p
          data-testid="status"
          style={{
            margin: '0 0 12px',
            color:
              status.tone === 'error' ? 'var(--vscode-errorForeground)'
              : status.tone === 'warn' ? 'var(--vscode-editorWarning-foreground)'
              : 'inherit',
          }}
        >
          {status.text}
        </p>
      )}
      {/* The browser viewport lands in M1; the canvas is deliberately absent until then. */}
      {frame && <img src={frame} alt="" style={{ maxWidth: '100%', display: 'block' }} />}
    </div>
  );
}

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
