import {Component, inject} from '@angular/core';
import {Router, RouterOutlet} from '@angular/router';
import {MatIcon} from '@angular/material/icon';
import {GameStore} from './core/game.store';

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [RouterOutlet, MatIcon],
    template: `
        @if (store.connectionLost()) {
            <div class="connection-banner" role="status">
                <mat-icon class="rg-pulse">wifi_off</mat-icon>
                <span>Connexion perdue, on se reconnecte…</span>
            </div>
        }
        <router-outlet />
        @if (store.toast(); as toast) {
            <div class="rg-toast" role="alert">{{ toast.text }}</div>
        }
    `,
    styles: `
        :host {
            display: block;
            height: 100dvh;
        }

        .connection-banner {
            position: fixed;
            top: calc(0.5rem + env(safe-area-inset-top));
            left: 50%;
            z-index: 90;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 1rem;
            border-radius: 999px;
            background: var(--rg-loss-soft);
            border: 1px solid var(--rg-loss);
            color: var(--rg-loss);
            font-size: 0.85rem;
            font-weight: 600;
            backdrop-filter: var(--rg-backdrop);
            --rg-tx: -50%;
            transform: translateX(-50%);
            animation: rg-rise var(--rg-medium) var(--rg-ease);

            mat-icon {
                width: 18px;
                height: 18px;
                font-size: 18px;
            }
        }
    `,
})
export class AppComponent {
    store = inject(GameStore);

    constructor() {
        // Old big-screen link from the previous version
        const router = inject(Router);
        if (new URLSearchParams(location.search).get('isAdmin') === 'true') router.navigateByUrl('/admin');
    }
}
