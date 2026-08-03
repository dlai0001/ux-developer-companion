import { useEffect } from 'react';
import { DEVICE_PRESETS } from '../../shared/devices.js';
import { useStore } from '../state/store.js';
import { post } from '../post.js';

/** Device presets + breakpoint slider (PLAN §4.6). */
export function DeviceBar(): JSX.Element {
  const breakpoints = useStore((s) => s.breakpoints);
  const viewport = useStore((s) => s.viewport);
  const device = useStore((s) => s.device);
  const rotated = useStore((s) => s.rotated);

  useEffect(() => { post({ type: 'request-breakpoints' }); }, []);

  const width = viewport?.width ?? 1280;
  const max = Math.max(1600, ...breakpoints.map((b) => b + 200));

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 8px', flexWrap: 'wrap' }}>
      <select
        data-testid="device-select"
        value={device ?? ''}
        onChange={(e) => {
          const id = e.target.value || null;
          useStore.getState().setDevice(id);
          post({ type: 'set-device', presetId: id, rotated });
        }}
        style={{ font: 'inherit' }}
      >
        <option value="">Responsive</option>
        {DEVICE_PRESETS.map((d) => (
          <option key={d.id} value={d.id}>{d.label} · {d.width}×{d.height}</option>
        ))}
      </select>

      <button
        data-testid="rotate"
        disabled={!device}
        onClick={() => {
          const next = !rotated;
          useStore.getState().setRotated(next);
          post({ type: 'set-device', presetId: device, rotated: next });
        }}
        style={{ border: 0, borderRadius: 4, padding: '4px 8px', cursor: device ? 'pointer' : 'default',
                 background: 'var(--vscode-button-secondaryBackground, #3a3d41)', color: '#fff', font: 'inherit' }}
      >
        ⟲ Rotate
      </button>

      {/* Breakpoint slider: ticks come from the page's own media queries. */}
      <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
        <input
          data-testid="width-slider"
          type="range"
          min={320}
          max={max}
          value={width}
          onChange={(e) => post({ type: 'set-width', width: Number(e.target.value) })}
          style={{ width: '100%' }}
        />
        <div style={{ position: 'relative', height: 12 }}>
          {breakpoints.map((b) => (
            <button
              key={b}
              data-testid={`breakpoint-${b}`}
              title={`${b}px`}
              onClick={() => post({ type: 'set-width', width: b })}
              style={{
                position: 'absolute', left: `${((b - 320) / (max - 320)) * 100}%`,
                transform: 'translateX(-50%)', border: 0, background: 'none',
                color: 'var(--vscode-descriptionForeground, #999)', cursor: 'pointer',
                font: '10px system-ui', padding: 0,
              }}
            >
              |{b}
            </button>
          ))}
        </div>
      </div>

      <span style={{ fontSize: 11, opacity: 0.7, minWidth: 80 }}>
        {viewport ? `${viewport.width}×${viewport.height}` : '—'}
      </span>

      <button
        data-testid="matrix"
        onClick={() => post({ type: 'request-matrix', widths: breakpoints.length ? [320, ...breakpoints, 1280] : [320, 768, 1280] })}
        style={{ border: 0, borderRadius: 4, padding: '4px 8px', cursor: 'pointer',
                 background: 'var(--vscode-button-secondaryBackground, #3a3d41)', color: '#fff', font: 'inherit' }}
      >
        Matrix
      </button>
    </div>
  );
}
