import { Routes } from '@angular/router';
import { HomeComponent } from './home.component';
import { ListComponent } from './list/list.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'list', component: ListComponent },
];
