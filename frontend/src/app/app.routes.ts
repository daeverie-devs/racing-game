import {Routes} from '@angular/router';

export const routes: Routes = [
    {path: '', loadComponent: () => import('./player/player-page.component').then(m => m.PlayerPageComponent)},
    {path: 'admin', loadComponent: () => import('./admin/admin-page.component').then(m => m.AdminPageComponent)},
    {path: '**', redirectTo: ''},
];
