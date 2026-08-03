import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { isHostToWebview } from '../shared/protocol.js';
import { useStore } from './state/store.js';
import { post } from './post.js';
import { BrowserView } from './browser-view/BrowserView.js';
import { NavBar } from './browser-view/NavBar.js';
import { Inspector } from './panels/Inspector.js';
import { DeviceBar } from './panels/DeviceBar.js';
import { Toolbar } from './annotations/Toolbar.js';
import { MatrixView } from './panels/MatrixView.js';

function App(): JSX.Element {
  const status = useStore((s) => s.status);
  const toolsOpen = useStore((s) => s.toolsOpen);

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
        case 'request-send-to-prompt':
          post({ type: 'send-to-prompt', annotations: useStore.getState().annotations });
          break;
        case 'request-copy-to-clipboard':
          post({ type: 'copy-to-clipboard', annotations: useStore.getState().annotations });
          break;
        case 'component-tree': s.setTree(m.nodes); break;
        case 'supports-write': s.setSupportsWrite(m.supported); break;
        case 'breakpoints': s.setBreakpoints(m.widths); break;
        case 'matrix': s.setMatrix(m.tiles); break;
        case 'snap-bounds': break;   // consumed by the rulers overlay
        case 'write-result':
          s.setWriteNote(m.ok ? null : `Write failed: ${m.reason ?? 'unknown'}${m.detail ? ` (${m.detail})` : ''}`);
          break;
      }
    };
    // Single-key tool shortcuts, matching the toolbar tooltips. Ignored while typing so a
    // callout's text field never swallows them.
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === 'z') { useStore.getState().undoAnnotation(); e.preventDefault(); }
        return;
      }
      const s = useStore.getState();
      // Escape disarms rather than resuming Browse — bailing out of a tool should never hand the
      // next click back to the page.
      if (e.key === 'Escape') {
        s.setTool(null);
        s.setMode('idle');
        post({ type: 'set-tool', tool: null });
        post({ type: 'set-mode', mode: 'idle' });
        return;
      }
      // `s` cycles the shape button, matching its click behaviour.
      const map: Record<string, 'rect' | 'ellipse' | 'arrow' | 'text' | 'callout'> = {
        s: s.mode === 'annotate' && s.tool === s.shape
          ? (s.shape === 'rect' ? 'ellipse' : 'rect')
          : s.shape,
        a: 'arrow', t: 'text', o: 'callout',
      };
      const kind = map[e.key.toLowerCase()];
      if (!kind) return;
      if (kind === 'rect' || kind === 'ellipse') s.setShape(kind);
      s.setTool(kind);
      if (s.mode !== 'annotate') { s.setMode('annotate'); post({ type: 'set-mode', mode: 'annotate' }); }
      post({ type: 'set-tool', tool: kind });
    };

    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKey);
    post({ type: 'webview-ready' });
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div style={{
      font: '13px var(--vscode-font-family, system-ui)', height: '100vh',
      display: 'flex', flexDirection: 'column', color: 'var(--vscode-foreground, #ccc)',
    }}>
      <NavBar />
      <Toolbar />
      {toolsOpen && <DeviceBar />}
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
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <BrowserView />
        <MatrixView />
        {toolsOpen && <Inspector />}
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
