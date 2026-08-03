import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { isHostToWebview } from '../shared/protocol.js';
import { useStore } from './state/store.js';
import { post } from './post.js';
import { BrowserView } from './browser-view/BrowserView.js';
import { NavBar } from './browser-view/NavBar.js';

function App(): JSX.Element {
  const status = useStore((s) => s.status);

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
        case 'viewport-changed': s.setViewport({ width: m.width, height: m.height }); break;
        case 'component-resolved': s.setSelected(m.component); break;
        case 'annotation-resolved': s.setAnnotationComponent(m.id, m.component); break;
        case 'capture-complete': break;   // status message already reports the path
      }
    };
    window.addEventListener('message', onMessage);
    post({ type: 'webview-ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div style={{
      font: '13px var(--vscode-font-family, system-ui)', height: '100vh',
      display: 'flex', flexDirection: 'column', color: 'var(--vscode-foreground, #ccc)',
    }}>
      <NavBar />
      {status && (
        <div
          data-testid="status"
          style={{
            padding: '2px 8px', fontSize: 12,
            color: status.tone === 'error' ? 'var(--vscode-errorForeground, #f48771)'
              : status.tone === 'warn' ? 'var(--vscode-editorWarning-foreground, #cca700)'
              : 'var(--vscode-descriptionForeground, #999)',
          }}
        >
          {status.text}
        </div>
      )}
      <BrowserView />
    </div>
  );
}

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
