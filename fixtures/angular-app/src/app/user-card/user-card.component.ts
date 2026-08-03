// ✅ THE EXPECTED ANSWER for the Angular contested-selector case (PLAN §5).
// Signal: @Component decorator present (+40) plus filename match (+30).
// The same selector string appears in user-card.component.spec.ts and demo/ — both noise (−35).
import { Component, input, signal } from '@angular/core';

export interface User { name: string; role: string }

@Component({
  selector: 'app-user-card',
  standalone: true,
  template: `
    <div id="usercard" data-testid="usercard" [class]="compact() ? 'card compact' : 'card'">
      <h2 data-testid="uc-name">{{ user().name }}</h2>
      <p data-testid="uc-role">{{ user().role }}</p>
      <p data-testid="uc-compact">compact={{ compact() }}</p>
      <p data-testid="uc-count">count={{ count() }}</p>
      <button data-testid="uc-btn" class="primary-btn" (click)="inc()">increment</button>
    </div>`,
})
export class UserCardComponent {
  // Signal inputs — the write path M5 exercises via .set().
  readonly user = input.required<User>();
  readonly compact = input(false);
  readonly count = signal(0);
  inc(): void { this.count.update((c) => c + 1); }
}
