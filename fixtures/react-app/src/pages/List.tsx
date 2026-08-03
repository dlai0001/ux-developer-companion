import { useEffect, useState } from 'react';

interface Item { id: number; label: string }
type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: Item[] };

/**
 * All four states (loading / error / empty / list) are reachable by query string, which the
 * M8 interception tests drive: ?delay=, ?fail=, ?empty=1.
 */
export function List(): JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const qs = window.location.search;
    fetch(`/api/items${qs}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as Item[];
      })
      .then((items) => setState({ status: 'ready', items }))
      .catch((e: unknown) => setState({ status: 'error', message: String((e as Error).message) }));
  }, []);

  if (state.status === 'loading') return <p data-testid="spinner">Loading…</p>;
  if (state.status === 'error') {
    return <p data-testid="error-banner" className="banner-error">Failed to load: {state.message}</p>;
  }
  if (state.items.length === 0) return <p data-testid="empty">No items.</p>;
  return (
    <ul data-testid="items" className="grid">
      {state.items.map((i) => <li key={i.id}>{i.label}</li>)}
    </ul>
  );
}
