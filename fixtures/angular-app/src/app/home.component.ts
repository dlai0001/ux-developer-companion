import { Component } from '@angular/core';
import { UserCardComponent } from './user-card/user-card.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [UserCardComponent],
  template: `
    <app-user-card [user]="{ name: 'Ada Lovelace', role: 'Engineer' }" [compact]="false" />

    <!-- INTENTIONAL axe violation #1: low contrast -->
    <p class="low-contrast" data-testid="low-contrast">Low contrast text for the M7 checker.</p>

    <!-- INTENTIONAL axe violation #2: input with NO accessible name. A placeholder would
         satisfy axe's \`label\` rule, so it is deliberately omitted. -->
    <input data-testid="unlabelled" type="text" />

    <div class="grid" data-testid="grid"><div>one</div><div>two</div><div>three</div></div>`,
})
export class HomeComponent {}
