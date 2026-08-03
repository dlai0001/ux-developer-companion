import { ANNOTATION_COLORS, type AnnotationKind } from '../../shared/annotations.js';
import { useStore } from '../state/store.js';
import { post } from '../post.js';

/**
 * Markup toolbar. Two deliberate choices after the first round of feedback:
 *  - the tools are ALWAYS visible, not hidden behind a mode toggle; picking one switches to
 *    annotate mode implicitly, so there is nothing to discover first;
 *  - icons carry the meaning, with the label underneath, matching the markup toolbars people
 *    already know from Preview/Sketch.
 */
interface Tool {
  kind: AnnotationKind;
  label: string;
  hint: string;
  icon: JSX.Element;
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const TOOLS: Tool[] = [
  {
    kind: 'rect', label: 'Box', hint: 'Draw a box (B)',
    icon: <svg width="22" height="22" viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="1.5" {...stroke} /></svg>,
  },
  {
    kind: 'ellipse', label: 'Circle', hint: 'Draw a circle (C)',
    icon: <svg width="22" height="22" viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="8.5" ry="6.5" {...stroke} /></svg>,
  },
  {
    kind: 'arrow', label: 'Arrow', hint: 'Draw an arrow (A)',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24">
        <path d="M19 5 L6 18" {...stroke} />
        <path d="M6 18 L6 11 M6 18 L13 18" {...stroke} />
      </svg>
    ),
  },
  {
    kind: 'text', label: 'Text', hint: 'Add a text label (T)',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24">
        <text x="12" y="18" textAnchor="middle" fontSize="18" fontFamily="Georgia, serif" fill="currentColor">a</text>
      </svg>
    ),
  },
  {
    kind: 'callout', label: 'Callout', hint: 'Add a callout bubble (O)',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24">
        <path d="M4 5.5h16v10H12l-5 4v-4H4z" {...stroke} />
      </svg>
    ),
  },
];

export function Toolbar(): JSX.Element {
  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.tool);
  const color = useStore((s) => s.color);
  const count = useStore((s) => s.annotations.length);

  const pick = (kind: AnnotationKind): void => {
    const s = useStore.getState();
    s.setTool(kind);
    // Picking a tool IS the intent to annotate — never make the user find a mode switch first.
    if (s.mode !== 'annotate') {
      s.setMode('annotate');
      post({ type: 'set-mode', mode: 'annotate' });
    }
    post({ type: 'set-tool', tool: kind });
  };

  const browse = (): void => {
    useStore.getState().setMode('browse');
    post({ type: 'set-mode', mode: 'browse' });
  };

  const btn = (active: boolean): React.CSSProperties => ({
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    minWidth: 52, padding: '4px 6px', borderRadius: 6, cursor: 'pointer', font: 'inherit',
    fontSize: 10, lineHeight: 1.2,
    border: active ? '1px solid var(--vscode-focusBorder, #0e639c)' : '1px solid transparent',
    background: active ? 'var(--vscode-toolbar-activeBackground, rgba(90,93,94,0.4))' : 'transparent',
    color: 'var(--vscode-foreground, #ccc)',
  });

  return (
    <div
      data-testid="markup-toolbar"
      style={{
        display: 'flex', alignItems: 'center', gap: 2, padding: '4px 8px', flexWrap: 'wrap',
        borderBottom: '1px solid var(--vscode-panel-border, #333)',
      }}
    >
      <button
        data-testid="tool-browse"
        title="Browse — interact with the page (Esc)"
        style={btn(mode === 'browse')}
        onClick={browse}
      >
        <svg width="22" height="22" viewBox="0 0 24 24">
          <path d="M6 3 L6 18 L10 14.5 L12.5 20 L15 19 L12.5 13.5 L18 13 Z" {...stroke} />
        </svg>
        Browse
      </button>

      <span style={{ width: 1, height: 28, background: 'var(--vscode-panel-border, #333)', margin: '0 6px' }} />

      {TOOLS.map((t) => (
        <button
          key={t.kind}
          data-testid={`tool-${t.kind}`}
          title={t.hint}
          style={btn(mode === 'annotate' && tool === t.kind)}
          onClick={() => pick(t.kind)}
        >
          {t.icon}
          {t.label}
        </button>
      ))}

      <span style={{ width: 1, height: 28, background: 'var(--vscode-panel-border, #333)', margin: '0 6px' }} />

      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} title="Annotation colour">
        {ANNOTATION_COLORS.map((c) => (
          <button
            key={c}
            data-testid={`color-${c.replace('#', '')}`}
            aria-label={`colour ${c}`}
            onClick={() => { useStore.getState().setColor(c); post({ type: 'set-color', color: c }); }}
            style={{
              width: 18, height: 18, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
              border: color === c ? '2px solid var(--vscode-foreground, #fff)' : '2px solid transparent',
              outline: color === c ? '1px solid rgba(0,0,0,0.4)' : 'none',
            }}
          />
        ))}
      </div>

      <button
        data-testid="undo"
        title="Undo last annotation (⌘Z)"
        disabled={count === 0}
        onClick={() => useStore.getState().undoAnnotation()}
        style={{ ...btn(false), opacity: count === 0 ? 0.4 : 1, minWidth: 44 }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24">
          <path d="M9 7H15a5 5 0 0 1 0 10H8" {...stroke} />
          <path d="M12 4 L9 7 L12 10" {...stroke} />
        </svg>
        Undo
      </button>

      <button
        data-testid="clear"
        title="Remove all annotations"
        disabled={count === 0}
        onClick={() => useStore.getState().clearAnnotations()}
        style={{ ...btn(false), opacity: count === 0 ? 0.4 : 1, minWidth: 44 }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24">
          <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" {...stroke} />
        </svg>
        Clear{count > 0 ? ` (${count})` : ''}
      </button>

      <span style={{ flex: 1 }} />

      <button
        data-testid="send-to-chat"
        title="Attach screenshots + context to Copilot Chat (⌘⌥P)"
        onClick={() => post({ type: 'send-to-prompt', annotations: useStore.getState().annotations })}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6,
          border: 0, cursor: 'pointer', font: 'inherit', fontWeight: 600,
          background: 'var(--vscode-button-background, #0e639c)',
          color: 'var(--vscode-button-foreground, #fff)',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24">
          <path d="M4 12 L20 4 L16 20 L12 13 Z" {...stroke} />
        </svg>
        Send to Chat
      </button>
    </div>
  );
}
