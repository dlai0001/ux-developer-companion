import { Component, signal } from '@angular/core';

interface Item { id: number; label: string }

// Loading / error / empty / list all reachable via query string (?delay=, ?fail=, ?empty=1).
@Component({
  selector: 'app-list',
  standalone: true,
  template: `
    @if (state() === 'loading') { <p data-testid="spinner">Loading…</p> }
    @else if (state() === 'error') { <p data-testid="error-banner" class="banner-error">Failed to load: {{ error() }}</p> }
    @else if (items().length === 0) { <p data-testid="empty">No items.</p> }
    @else {
      <ul data-testid="items" class="grid">
        @for (i of items(); track i.id) { <li>{{ i.label }}</li> }
      </ul>
    }`,
})
export class ListComponent {
  readonly state = signal<'loading' | 'error' | 'ready'>('loading');
  readonly items = signal<Item[]>([]);
  readonly error = signal('');

  constructor() {
    fetch(`/api/items${window.location.search}`)
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()) as Item[]; })
      .then((i) => { this.items.set(i); this.state.set('ready'); })
      .catch((e: Error) => { this.error.set(e.message); this.state.set('error'); });
  }
}
