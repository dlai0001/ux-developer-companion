import { useEffect, useState } from 'react';
import { useStore } from '../state/store.js';
import { post } from '../post.js';
import { ANNOTATION_COLORS, type AnnotationKind } from '../../shared/annotations.js';

export function NavBar(): JSX.Element {
  const url = useStore((s) => s.url);
  const mode = useStore((s) => s.mode);
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
        data-testid="mode-toggle"
        style={{ ...btn, background: mode === 'annotate' ? 'var(--vscode-button-background, #0e639c)' : btn.background }}
        title="Toggle browse/annotate"
        onClick={() => post({ type: 'set-mode', mode: mode === 'browse' ? 'annotate' : 'browse' })}
      >
        {mode === 'browse' ? 'Browse' : 'Annotate'}
      </button>
      {mode === 'annotate' && <AnnotateTools />}
      <button
        data-testid="capture"
        style={btn}
        title="Capture clean + annotated screenshots"
        onClick={() => post({ type: 'capture', annotations: useStore.getState().annotations })}
      >
        Capture
      </button>
    </div>
  );
}

function AnnotateTools(): JSX.Element {
  const tool = useStore((s) => s.tool);
  const color = useStore((s) => s.color);
  const count = useStore((s) => s.annotations.length);
  const tools: AnnotationKind[] = ['rect', 'arrow', 'callout'];

  return (
    <>
      {tools.map((t) => (
        <button
          key={t}
          data-testid={`tool-${t}`}
          onClick={() => { useStore.getState().setTool(t); post({ type: 'set-tool', tool: t }); }}
          style={{
            border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer', font: 'inherit',
            background: tool === t ? 'var(--vscode-button-background, #0e639c)' : 'var(--vscode-button-secondaryBackground, #3a3d41)',
            color: 'var(--vscode-button-foreground, #fff)',
          }}
        >
          {t}
        </button>
      ))}
      {ANNOTATION_COLORS.map((c) => (
        <button
          key={c}
          aria-label={`colour ${c}`}
          onClick={() => { useStore.getState().setColor(c); post({ type: 'set-color', color: c }); }}
          style={{
            width: 18, height: 18, borderRadius: '50%', background: c, cursor: 'pointer',
            border: color === c ? '2px solid #fff' : '2px solid transparent',
          }}
        />
      ))}
      <button
        style={{ border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer', font: 'inherit',
                 background: 'var(--vscode-button-secondaryBackground, #3a3d41)', color: 'var(--vscode-button-secondaryForeground, #fff)' }}
        onClick={() => useStore.getState().clearAnnotations()}
      >
        clear ({count})
      </button>
    </>
  );
}
