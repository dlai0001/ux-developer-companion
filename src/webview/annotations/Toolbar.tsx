import { SHAPE_KINDS, type AnnotationKind, type ShapeKind } from '../../shared/annotations.js';
import { useStore } from '../state/store.js';
import { post } from '../post.js';

/**
 * Markup toolbar. Kept deliberately sparse: one Shape button rather than one per shape, one
 * colour swatch rather than a palette, and the panel-level tools tucked behind a toggle.
 * Picking a tool switches to annotate mode implicitly — the mode is a consequence of the
 * choice, never something to find first — and switches Browse off with it. A finished mark
 * leaves nothing armed, so the toolbar's resting state is "no tool, no browsing".
 */
const stroke = {
  fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

const SHAPE_ICON: Record<ShapeKind, JSX.Element> = {
  rect: <svg width="22" height="22" viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="1.5" {...stroke} /></svg>,
  ellipse: <svg width="22" height="22" viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="8.5" ry="6.5" {...stroke} /></svg>,
};

const ICONS = {
  browse: (
    <svg width="22" height="22" viewBox="0 0 24 24">
      <path d="M6 3 L6 18 L10 14.5 L12.5 20 L15 19 L12.5 13.5 L18 13 Z" {...stroke} />
    </svg>
  ),
  arrow: (
    <svg width="22" height="22" viewBox="0 0 24 24">
      <path d="M19 5 L6 18" {...stroke} /><path d="M6 18 L6 11 M6 18 L13 18" {...stroke} />
    </svg>
  ),
  text: (
    <svg width="22" height="22" viewBox="0 0 24 24">
      <text x="12" y="18" textAnchor="middle" fontSize="18" fontFamily="Georgia, serif" fill="currentColor">a</text>
    </svg>
  ),
  callout: (
    <svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 5.5h16v10H12l-5 4v-4H4z" {...stroke} /></svg>
  ),
  undo: (
    <svg width="22" height="22" viewBox="0 0 24 24">
      <path d="M9 7H15a5 5 0 0 1 0 10H8" {...stroke} /><path d="M12 4 L9 7 L12 10" {...stroke} />
    </svg>
  ),
  clear: (
    <svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" {...stroke} /></svg>
  ),
  tools: (
    <svg width="22" height="22" viewBox="0 0 24 24">
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" {...stroke} />
      <circle cx="15" cy="7" r="2.2" {...stroke} /><circle cx="9" cy="17" r="2.2" {...stroke} />
    </svg>
  ),
  send: (
    <svg width="16" height="16" viewBox="0 0 24 24"><path d="M4 12 L20 4 L16 20 L12 13 Z" {...stroke} /></svg>
  ),
};

export function Toolbar(): JSX.Element {
  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.tool);
  const shape = useStore((s) => s.shape);
  const color = useStore((s) => s.color);
  const count = useStore((s) => s.annotations.length);
  const toolsOpen = useStore((s) => s.toolsOpen);

  const pick = (kind: AnnotationKind): void => {
    const s = useStore.getState();
    s.setTool(kind);
    if (s.mode !== 'annotate') {
      s.setMode('annotate');
      post({ type: 'set-mode', mode: 'annotate' });
    }
    post({ type: 'set-tool', tool: kind });
  };

  /** Shape shares one button: pressing it again cycles box -> circle -> box. */
  const pickShape = (): void => {
    const s = useStore.getState();
    const alreadyActive = s.mode === 'annotate' && s.tool === s.shape;
    const next = alreadyActive
      ? SHAPE_KINDS[(SHAPE_KINDS.indexOf(s.shape) + 1) % SHAPE_KINDS.length]!
      : s.shape;
    s.setShape(next);
    pick(next);
  };

  /**
   * Browse is a toggle, not a destination. Switching it off parks the panel in `idle`, where a
   * click does nothing at all — the guard against navigating the app by accident.
   */
  const toggleBrowse = (): void => {
    const s = useStore.getState();
    const next = s.mode === 'browse' ? 'idle' : 'browse';
    if (next === 'idle') { s.setTool(null); post({ type: 'set-tool', tool: null }); }
    s.setMode(next);
    post({ type: 'set-mode', mode: next });
  };

  const btn = (active: boolean, disabled = false): React.CSSProperties => ({
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    minWidth: 52, padding: '4px 6px', borderRadius: 6, font: 'inherit',
    fontSize: 10, lineHeight: 1.2, cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    border: active ? '1px solid var(--vscode-focusBorder, #0e639c)' : '1px solid transparent',
    background: active ? 'var(--vscode-toolbar-activeBackground, rgba(90,93,94,0.4))' : 'transparent',
    color: 'var(--vscode-foreground, #ccc)',
  });

  const divider = (
    <span style={{ width: 1, height: 28, background: 'var(--vscode-panel-border, #333)', margin: '0 6px' }} />
  );

  const shapeActive = mode === 'annotate' && (tool === 'rect' || tool === 'ellipse');

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
        title={mode === 'browse'
          ? 'Browsing — click to stop forwarding clicks to the page'
          : 'Browsing off — click to interact with the page again'}
        style={btn(mode === 'browse')}
        onClick={toggleBrowse}
      >
        {ICONS.browse}Browse
      </button>

      {divider}

      <button
        data-testid="tool-shape"
        title={`Shape: ${shape === 'rect' ? 'box' : 'circle'} — click again to switch (S)`}
        style={btn(shapeActive)}
        onClick={pickShape}
      >
        {SHAPE_ICON[shape]}Shape
      </button>
      <button data-testid="tool-arrow" title="Draw an arrow (A)"
              style={btn(mode === 'annotate' && tool === 'arrow')} onClick={() => pick('arrow')}>
        {ICONS.arrow}Arrow
      </button>
      <button data-testid="tool-text" title="Add a text label (T)"
              style={btn(mode === 'annotate' && tool === 'text')} onClick={() => pick('text')}>
        {ICONS.text}Text
      </button>
      <button data-testid="tool-callout" title="Callout — press on the target, drag out the bubble (O)"
              style={btn(mode === 'annotate' && tool === 'callout')} onClick={() => pick('callout')}>
        {ICONS.callout}Callout
      </button>

      {divider}

      {/* One swatch, not a palette. It IS the colour picker. */}
      <label
        data-testid="color-swatch"
        title={`Annotation colour (${color}) — click to change`}
        style={{ ...btn(false), position: 'relative', cursor: 'pointer' }}
      >
        <span style={{
          width: 22, height: 22, borderRadius: '50%', background: color,
          border: '2px solid var(--vscode-foreground, #ccc)', display: 'block',
        }} />
        Colour
        <input
          type="color"
          value={color}
          onChange={(e) => { useStore.getState().setColor(e.target.value); post({ type: 'set-color', color: e.target.value }); }}
          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
        />
      </label>

      <button data-testid="undo" title="Undo last annotation (⌘Z)" disabled={count === 0}
              style={btn(false, count === 0)} onClick={() => useStore.getState().undoAnnotation()}>
        {ICONS.undo}Undo
      </button>
      <button data-testid="clear" title="Remove all annotations" disabled={count === 0}
              style={btn(false, count === 0)} onClick={() => useStore.getState().clearAnnotations()}>
        {ICONS.clear}Clear{count > 0 ? ` (${count})` : ''}
      </button>

      {/* Says why clicks are doing nothing, in the one place the eye is already looking. */}
      <span style={{ flex: 1, padding: '0 10px', minWidth: 0 }}>
        {mode !== 'browse' && (
          <span
            data-testid="browse-off-hint"
            style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground, #999)' }}
          >
            Click Browse to toggle browsing mode
          </span>
        )}
      </span>

      <button
        data-testid="toggle-tools"
        title="Show inspector, responsive and testing tools"
        style={btn(toolsOpen)}
        onClick={() => useStore.getState().setToolsOpen(!toolsOpen)}
      >
        {ICONS.tools}Tools
      </button>

      <button
        data-testid="send-to-chat"
        title="Attach screenshots + context to Copilot Chat (⌘⌥P)"
        onClick={() => post({ type: 'send-to-prompt', annotations: useStore.getState().annotations })}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6,
          border: 0, cursor: 'pointer', font: 'inherit', fontWeight: 600, marginLeft: 4,
          background: 'var(--vscode-button-background, #0e639c)',
          color: 'var(--vscode-button-foreground, #fff)',
        }}
      >
        {ICONS.send}Send to Chat
      </button>
    </div>
  );
}
