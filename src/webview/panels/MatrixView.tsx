import { useStore } from '../state/store.js';

/** Responsive matrix tiles (PLAN §4.6). Static refresh — not N live streams. */
export function MatrixView(): JSX.Element | null {
  const matrix = useStore((s) => s.matrix);
  if (matrix.length === 0) return null;

  return (
    <div
      data-testid="matrix-view"
      style={{
        flex: 1, minWidth: 0, overflow: 'auto', padding: 8,
        display: 'grid', gridTemplateColumns: `repeat(${Math.min(matrix.length, 3)}, 1fr)`, gap: 8,
        background: 'var(--vscode-editor-background, #1e1e1e)',
      }}
    >
      {matrix.map((t) => (
        <figure key={t.width} style={{ margin: 0 }}>
          <figcaption style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>{t.width}px</figcaption>
          <img
            src={`data:image/png;base64,${t.png}`}
            alt={`viewport ${t.width}px`}
            style={{ width: '100%', border: '1px solid var(--vscode-panel-border, #333)' }}
          />
        </figure>
      ))}
      <button
        onClick={() => useStore.getState().setMatrix([])}
        style={{ gridColumn: '1 / -1', border: 0, borderRadius: 4, padding: '4px 8px',
                 cursor: 'pointer', background: 'var(--vscode-button-secondaryBackground, #3a3d41)', color: '#fff' }}
      >
        Close matrix
      </button>
    </div>
  );
}
