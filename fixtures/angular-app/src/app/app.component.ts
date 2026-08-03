import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink],
  template: `
    <main>
      <h1>UX Companion Angular fixture</h1>
      <nav><a routerLink="/">home</a> <a routerLink="/list">list</a></nav>
      <router-outlet />
    </main>`,
})
export class AppComponent {}
