// ❌ DECOY: references selector 'app-user-card' from a demo/ path → −35.
import { Component } from '@angular/core';

@Component({
  selector: 'app-demo',
  standalone: true,
  template: `<!-- app-user-card is showcased here, but not defined here -->`,
})
export class DemoComponent {}
