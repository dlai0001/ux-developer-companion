import { useState } from 'react';
import type { ComponentTreeNode, Json } from '../../shared/agent-api.js';
import { useStore } from '../state/store.js';
import { post } from '../post.js';

/** Inspector panel (PLAN §4.6): tree, pick mode, and editable props/state. */
export function Inspector(): JSX.Element {
  const selected = useStore((s) => s.selected);
  const tree = useStore((s) => s.tree);
  const pickMode = useStore((s) => s.pickMode);
  const supportsWrite = useStore((s) => s.supportsWrite);
  const writeNote = useStore((s) => s.writeNote);

  return (
    <aside style={{
      width: 320, flexShrink: 0, borderLeft: '1px solid var(--vscode-panel-border, #333)',
      display: 'flex', flexDirection: 'column', overflow: 'auto', padding: 8, gap: 8,
    }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          data-testid="pick-mode"
          onClick={() => {
            const next = !pickMode;
            useStore.getState().setPickMode(next);
            post({ type: 'set-pick-mode', enabled: next });
          }}
          style={{
            border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer', font: 'inherit',
            background: pickMode ? 'var(--vscode-button-background, #0e639c)' : 'var(--vscode-button-secondaryBackground, #3a3d41)',
            color: '#fff',
          }}
        >
          {pickMode ? 'Picking…' : 'Pick element'}
        </button>
        <button
          data-testid="refresh-tree"
          onClick={() => post({ type: 'request-tree', maxDepth: 8 })}
          style={{
            border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer', font: 'inherit',
            background: 'var(--vscode-button-secondaryBackground, #3a3d41)', color: '#fff',
          }}
        >
          Refresh tree
        </button>
      </div>

      {tree.length > 0 && (
        <div data-testid="component-tree" style={{ maxHeight: 180, overflow: 'auto', fontSize: 12 }}>
          <TreeNodes nodes={tree} depth={0} />
        </div>
      )}

      {selected ? (
        <div data-testid="inspector-detail">
          <h3 style={{ margin: '4px 0', fontSize: 13 }}>
            {selected.name}
            <span style={{ opacity: 0.6, fontWeight: 400 }}> · {selected.framework}</span>
          </h3>
          {selected.degraded === 'production-build' && (
            <p data-testid="degraded-note" style={{ color: 'var(--vscode-editorWarning-foreground, #cca700)', fontSize: 12 }}>
              Production build: values are readable but the component name is unreliable and
              overrides are unavailable.
            </p>
          )}
          {selected.ancestry.length > 0 && (
            <p style={{ fontSize: 11, opacity: 0.7, margin: '2px 0' }}>{selected.ancestry.join(' › ')}</p>
          )}

          <Section title={selected.framework === 'angular' ? 'Inputs' : 'Props'}
                   data={selected.props} editable={supportsWrite} prefix={[]} />
          {selected.state && (
            <Section title="State" data={selected.state} editable={supportsWrite} prefix={[]} state />
          )}
          {!supportsWrite && (
            <p style={{ fontSize: 11, opacity: 0.7 }}>Read-only (no write support on this page).</p>
          )}
          {writeNote && <p data-testid="write-note" style={{ fontSize: 11, color: 'var(--vscode-errorForeground, #f48771)' }}>{writeNote}</p>}
        </div>
      ) : (
        <p style={{ fontSize: 12, opacity: 0.7 }}>Pick an element, or click one in the tree.</p>
      )}
    </aside>
  );
}

function TreeNodes({ nodes, depth }: { nodes: ComponentTreeNode[]; depth: number }): JSX.Element {
  return (
    <>
      {nodes.map((n) => (
        <div key={n.id}>
          <button
            onClick={() => post({ type: 'select-component', id: n.id })}
            style={{
              background: 'none', border: 0, color: 'inherit', font: 'inherit',
              cursor: 'pointer', padding: '1px 0', paddingLeft: depth * 12,
            }}
          >
            {n.name}
          </button>
          {n.children.length > 0 && <TreeNodes nodes={n.children} depth={depth + 1} />}
        </div>
      ))}
    </>
  );
}

interface SectionProps {
  title: string;
  data: Record<string, unknown>;
  editable: boolean;
  prefix: Array<string | number>;
  state?: boolean;
}

function Section({ title, data, editable, state }: SectionProps): JSX.Element {
  return (
    <div style={{ marginTop: 6 }}>
      <h4 style={{ margin: '4px 0', fontSize: 12, opacity: 0.8 }}>{title}</h4>
      {Object.entries(data).map(([key, value]) => (
        <Field key={key} name={key} value={value} editable={editable} state={!!state} />
      ))}
    </div>
  );
}

function Field({ name, value, editable, state }: {
  name: string; value: unknown; editable: boolean; state: boolean;
}): JSX.Element {
  const componentId = useStore((s) => s.selected)?.id ?? -1;
  const [draft, setDraft] = useState<string>(() => JSON.stringify(value));

  // Hook state is addressed as `hook:<id>` so the React adapter routes it through
  // overrideValueAtPath('hooks', …) rather than the props path.
  const pathFor = (): Array<string | number> => {
    if (!state) return [name];
    const m = /\[(\d+)\]$/.exec(name);
    return m ? [`hook:${m[1]}`] : [name];
  };

  const send = (v: Json): void => post({ type: 'write-state', id: componentId, path: pathFor(), value: v });
  const row: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, padding: '1px 0' };

  if (typeof value === 'boolean') {
    return (
      <label style={row}>
        <input type="checkbox" data-testid={`field-${name}`} checked={value} disabled={!editable}
               onChange={(e) => send(e.target.checked)} />
        <span>{name}</span>
      </label>
    );
  }
  if (typeof value === 'number') {
    return (
      <label style={row}>
        <span style={{ minWidth: 90 }}>{name}</span>
        <input type="number" data-testid={`field-${name}`} defaultValue={value} disabled={!editable}
               onBlur={(e) => send(Number(e.target.value))}
               style={{ width: 90, font: 'inherit' }} />
      </label>
    );
  }
  if (typeof value === 'string') {
    return (
      <label style={row}>
        <span style={{ minWidth: 90 }}>{name}</span>
        <input type="text" data-testid={`field-${name}`} defaultValue={value} disabled={!editable}
               onBlur={(e) => send(e.target.value)} style={{ flex: 1, font: 'inherit' }} />
      </label>
    );
  }
  // Objects/arrays get a JSON editor that only commits when the text parses.
  return (
    <div style={{ padding: '2px 0' }}>
      <div style={{ fontSize: 12 }}>{name}</div>
      <textarea
        data-testid={`field-${name}`}
        value={draft}
        disabled={!editable}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          try { send(JSON.parse(draft) as Json); }
          catch { useStore.getState().setWriteNote(`${name}: invalid JSON, not applied`); }
        }}
        style={{ width: '100%', height: 48, font: '11px ui-monospace, monospace' }}
      />
    </div>
  );
}
