import {ChangeDetectionStrategy, Component, effect, inject, signal, untracked} from '@angular/core';
import {AvatarComponent} from '../avatar/avatar.component';
import {GameStore, LoanEvent} from '../core/game.store';
import {MoneyPipe} from '../core/format';

const JEERS = [
    'La banque de papa ouvre ses portes',
    'Un parieur de haut niveau',
    'Maman serait tellement fière',
    'Ça, c\'est de la gestion financière',
    'Le Ponzi du chalet',
    'Tout va bien, tout est sous contrôle',
];

const SHOW_MS = 7000;

/** Big screen: when a player borrows, the whole room finds out */
@Component({
    selector: 'rg-shame-popup',
    standalone: true,
    imports: [AvatarComponent, MoneyPipe],
    template: `
        @if (current(); as loan) {
            @for (l of [loan]; track l.at) {
                <div class="shame" role="status">
                    <span class="stamp">HONTE</span>
                    <rg-avatar class="who" [skin]="l.skin" size="120px" />
                    <h2>{{ l.name }} vient d'emprunter <span class="amount">{{ l.amount | money }}</span></h2>
                    <p class="jeer">{{ jeer() }}</p>
                    @if (l.total > l.amount) {
                        <p class="total">Dette totale : {{ l.total | money }}</p>
                    }
                </div>
            }
        }
    `,
    styles: `
        :host {
            position: fixed;
            inset: 0;
            z-index: 45;
            display: grid;
            place-items: center;
            pointer-events: none;
        }

        .shame {
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.6rem;
            padding: 2.5rem 3.5rem 2rem;
            border: 3px solid var(--rg-loss);
            border-radius: var(--rg-radius);
            background: var(--rg-surface-strong);
            box-shadow: 0 0 60px rgba(251, 113, 133, 0.35), var(--rg-shadow-raised);
            text-align: center;
            animation: arrive 500ms var(--rg-ease-pop) both, leave 400ms ease-in ${SHOW_MS - 400}ms forwards;
        }

        .stamp {
            position: absolute;
            top: -1.4rem;
            padding: 0.2rem 1.2rem;
            border: 3px solid var(--rg-loss);
            border-radius: 8px;
            background: var(--rg-bg);
            color: var(--rg-loss);
            font-size: 1.8rem;
            font-weight: 900;
            letter-spacing: 0.2em;
            transform: rotate(-4deg);
        }

        .who {
            animation: shake 600ms ease-in-out 500ms 2;
            filter: grayscale(0.4);
        }

        h2 {
            font-size: 2.2rem;
            font-weight: 900;
        }

        .amount {
            color: var(--rg-loss);
        }

        .jeer {
            font-size: 1.3rem;
            font-style: italic;
            color: var(--rg-text-muted);
        }

        .total {
            font-weight: 700;
            color: var(--rg-loss);
        }

        @keyframes arrive {
            from { opacity: 0; transform: scale(0.7) rotate(-3deg); }
            to { opacity: 1; transform: none; }
        }

        @keyframes leave {
            to { opacity: 0; transform: scale(0.95); }
        }

        @keyframes shake {
            0%, 100% { transform: rotate(0); }
            25% { transform: rotate(-8deg); }
            75% { transform: rotate(8deg); }
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShamePopupComponent {
    private store = inject(GameStore);
    current = signal<LoanEvent | null>(null);
    jeer = signal(JEERS[0]);

    constructor() {
        const seen = this.store.lastLoan();
        effect(() => {
            const loan = this.store.lastLoan();
            if (!loan || loan === seen) return;
            untracked(() => {
                this.jeer.set(JEERS[Math.floor(Math.random() * JEERS.length)]);
                this.current.set(loan);
            });
            setTimeout(() => {
                if (this.current() === loan) this.current.set(null);
            }, SHOW_MS);
        });
    }
}
