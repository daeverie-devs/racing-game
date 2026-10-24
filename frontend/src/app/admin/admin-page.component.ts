import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatIcon} from '@angular/material/icon';
import {GameStore} from '../core/game.store';
import {ScreenComponent} from '../screen/screen.component';
import {ControlsComponent} from './controls.component';
import {EditorComponent} from './editor.component';

/** /admin: the big screen with the admin's controls, behind the passcode from backend/.env */
@Component({
    selector: 'rg-admin-page',
    standalone: true,
    imports: [FormsModule, MatIcon, ScreenComponent, ControlsComponent, EditorComponent],
    template: `
        @if (!store.ready()) {
            <div class="center rg-muted rg-pulse">Connexion…</div>
        } @else if (!store.isAdmin()) {
            <form class="login rg-card rg-enter" (ngSubmit)="login()">
                <mat-icon class="key">key</mat-icon>
                <h1 class="rg-title">Écran de l'admin</h1>
                <input class="rg-field" type="password" name="passcode" [(ngModel)]="passcode" placeholder="Code admin" autocomplete="current-password" />
                <button class="rg-btn rg-btn--block" type="submit" [disabled]="!passcode || busy()">Entrer</button>
            </form>
        } @else {
            <rg-screen />
            <rg-controls (openEditor)="editorOpen.set(true)" />
            @if (editorOpen()) {
                <rg-editor (close)="editorOpen.set(false)" />
            }
        }
    `,
    styles: `
        :host {
            display: block;
            height: 100%;
        }

        .center {
            display: grid;
            place-items: center;
            height: 100%;
        }

        .login {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.9rem;
            width: min(360px, calc(100vw - 2rem));
            margin: 18vh auto 0;
            padding: 2rem 1.5rem;
            text-align: center;
        }

        .key {
            width: 48px;
            height: 48px;
            font-size: 48px;
            color: var(--rg-accent);
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminPageComponent {
    store = inject(GameStore);
    passcode = '';
    busy = signal(false);
    editorOpen = signal(false);

    async login() {
        this.busy.set(true);
        try {
            await this.store.login(this.passcode);
        } catch (err) {
            this.store.showToast((err as Error).message);
        } finally {
            this.busy.set(false);
        }
    }
}
