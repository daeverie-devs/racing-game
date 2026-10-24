import {ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal} from '@angular/core';
import {GameStore} from '../core/game.store';

/** Seconds left before the bets lock, on the server's clock, with a shrinking bar */
@Component({
    selector: 'rg-countdown',
    standalone: true,
    template: `
        @if (left() !== null) {
            <div class="countdown" [class.urgent]="left()! <= 5">
                <span class="seconds">{{ left() }}</span>
                <div class="bar"><div class="fill" [style.transform]="'scaleX(' + progress() + ')'"></div></div>
            </div>
        }
    `,
    styles: `
        .countdown {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            animation: rg-rise var(--rg-medium) var(--rg-ease);
        }

        .seconds {
            min-width: 2ch;
            font-size: var(--countdown-size, 1.75rem);
            font-weight: 900;
            font-variant-numeric: tabular-nums;
            text-align: right;
        }

        .bar {
            flex: 1;
            height: 10px;
            border-radius: 999px;
            background: var(--rg-surface-inset);
            overflow: hidden;
        }

        .fill {
            height: 100%;
            background: var(--rg-accent);
            transform-origin: left;
            transition: transform 250ms linear;
        }

        .urgent {
            .seconds { color: var(--rg-loss); }
            .fill { background: var(--rg-loss); }
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CountdownComponent {
    private store = inject(GameStore);
    deadline = input<number | null>(null);
    total = input(15);

    private now = signal(this.store.now());
    readonly left = computed(() => {
        const deadline = this.deadline();
        return deadline ? Math.max(0, Math.ceil((deadline - this.now()) / 1000)) : null;
    });
    readonly progress = computed(() => {
        const deadline = this.deadline();
        if (!deadline) return 0;
        return Math.min(1, Math.max(0, (deadline - this.now()) / (this.total() * 1000)));
    });

    constructor() {
        const timer = setInterval(() => this.now.set(this.store.now()), 250);
        inject(DestroyRef).onDestroy(() => clearInterval(timer));
    }
}
