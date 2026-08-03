import { useEffect, useState } from 'react';
import { useStore } from '../state/store.js';
import { post } from '../post.js';

export function NavBar(): JSX.Element {
  const url = useStore((s) => s.url);
  const [draft, setDraft] = useState(url);

  // Follow host-driven navigation unless the user is mid-edit.
  useEffect(() => { setDraft(url); }, [url]);

  const btn: React.CSSProperties = {
    background: 'var(--vscode-button-secondaryBackground, #3a3d41)',
    color: 'var(--vscode-button-secondaryForeground, #fff)',
    border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: 6 }}>
      <button style={btn} title="Back" onClick={() => post({ type: 'go-back' })}>←</button>
      <button style={btn} title="Forward" onClick={() => post({ type: 'go-forward' })}>→</button>
      <button style={btn} title="Reload" onClick={() => post({ type: 'reload' })}>⟳</button>
      <form
        style={{ flex: 1 }}
        onSubmit={(e) => { e.preventDefault(); post({ type: 'navigate', url: draft }); }}
      >
        <input
          data-testid="url-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="http://localhost:5173/"
          style={{
            width: '100%', padding: '4px 8px', borderRadius: 4,
            border: '1px solid var(--vscode-input-border, #3c3c3c)',
            background: 'var(--vscode-input-background, #1e1e1e)',
            color: 'var(--vscode-input-foreground, #ccc)', font: 'inherit',
          }}
        />
      </form>
      <button
        data-testid="capture"
        style={btn}
        title="Save clean + annotated screenshots to disk"
        onClick={() => post({ type: 'capture', annotations: useStore.getState().annotations })}
      >
        Capture
      </button>
    </div>
  );
}

