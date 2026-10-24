import {ChangeDetectionStrategy, Component, computed, input} from '@angular/core';
import {MatIcon} from '@angular/material/icon';
import {AvatarComponent} from '../avatar/avatar.component';
import {formatMoney} from '../core/format';
import {Award, PlayerInfo} from '../core/types';

const ICONS: Record<string, string> = {
    biggestBet: 'paid',
    bestShot: 'auto_awesome',
    chatterbox: 'forum',
    athlete: 'directions_run',
    debtor: 'account_balance',
    cheapskate: 'savings',
};

/** One end-of-game award, revealed on its own */
@Component({
    selector: 'rg-award-card',
    standalone: true,
    imports: [MatIcon, AvatarComponent],
    template: `
        <article class="award rg-card" [class.large]="large()">
            <div class="icon rg-enter-pop"><mat-icon>{{ icon() }}</mat-icon></div>
            <span class="rg-eyebrow">Prix {{ index() + 1 }} sur {{ count() }}</span>
            <h2 class="title">{{ award().title }}</h2>
            <p class="description rg-muted">{{ award().description }} : <strong>{{ value() }}</strong></p>
            <div class="winners rg-stagger">
                @for (player of winners(); track player.id; let i = $index) {
                    <div class="winner" [style.--i]="i + 4">
                        <rg-avatar [skin]="player.skin" [size]="large() ? '120px' : '72px'" />
                        <span class="name">{{ player.name }}</span>
                    </div>
                }
            </div>
            <span class="bonus rg-chip rg-chip--money">+{{ bonusText() }} {{ winners().length > 1 ? 'chacun' : '' }}</span>
        </article>
    `,
    styles: `
        .award {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.75rem;
            padding: 1.5rem;
            text-align: center;
            animation: rg-pop var(--rg-medium) var(--rg-ease-pop) both;
        }

        .icon {
            display: grid;
            place-items: center;
            width: 64px;
            height: 64px;
            border-radius: 50%;
            background: var(--rg-money-soft);
            color: var(--rg-money);

            mat-icon { width: 36px; height: 36px; font-size: 36px; }
        }

        .title {
            font-size: 1.6rem;
            font-weight: 900;
        }

        .winners {
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 1rem;
            margin: 0.5rem 0;
        }

        .winner {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.4rem;
        }

        .name {
            font-weight: 800;
        }

        .bonus {
            animation: rg-pop var(--rg-medium) var(--rg-ease-pop) both;
            animation-delay: 600ms;
        }

        .large {
            gap: 1.25rem;
            padding: 3rem 4rem;

            .icon { width: 96px; height: 96px; mat-icon { width: 56px; height: 56px; font-size: 56px; } }
            .title { font-size: 3.2rem; }
            .description { font-size: 1.5rem; }
            .name { font-size: 1.6rem; }
            .bonus { font-size: 1.3rem; padding: 0.5rem 1.2rem; }
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AwardCardComponent {
    award = input.required<Award>();
    players = input.required<Map<number, PlayerInfo>>();
    bonus = input(0);
    index = input(0);
    count = input(1);
    large = input(false);

    readonly icon = computed(() => ICONS[this.award().key] ?? 'emoji_events');
    readonly winners = computed(() =>
        this.award().playerIds.map(id => this.players().get(id)).filter((p): p is PlayerInfo => !!p));
    readonly value = computed(() => {
        const {key, value} = this.award();
        if (key === 'chatterbox') return `${value} messages`;
        if (key === 'athlete') return `${value} course${value > 1 ? 's' : ''}`;
        return formatMoney(value);
    });
    readonly bonusText = computed(() => formatMoney(this.bonus()));
}
