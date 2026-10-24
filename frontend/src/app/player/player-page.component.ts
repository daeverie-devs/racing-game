import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {MatIcon} from '@angular/material/icon';
import {AvatarComponent} from '../avatar/avatar.component';
import {GameStore} from '../core/game.store';
import {MoneyPipe, OddsPipe, OrdinalPipe} from '../core/format';
import {AwardCardComponent} from '../ui/award-card.component';
import {ChatDrawerComponent} from '../ui/chat-drawer.component';
import {EntryVisualComponent} from '../ui/entry-visual.component';
import {LeaderboardComponent} from '../ui/leaderboard.component';
import {PodiumComponent} from '../ui/podium.component';
import {BettingComponent} from './betting.component';
import {JoinComponent} from './join.component';

/** The phone: join screen until joined, then one view per game status */
@Component({
    selector: 'rg-player-page',
    standalone: true,
    imports: [
        MatIcon, AvatarComponent, MoneyPipe, OddsPipe, OrdinalPipe, AwardCardComponent, ChatDrawerComponent,
        EntryVisualComponent, LeaderboardComponent, PodiumComponent, BettingComponent, JoinComponent,
    ],
    templateUrl: 'player-page.component.html',
    styleUrl: 'player-page.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayerPageComponent {
    store = inject(GameStore);
    loanOpen = signal(false);

    readonly game = this.store.game;
    readonly race = this.store.race;
    readonly me = this.store.me;
    readonly bet = this.store.myBet;
    readonly status = computed(() => this.game()?.status ?? 'lobby');

    readonly myEntry = computed(() => this.race()?.entries.find(e => e.id === this.bet()?.entryId) ?? null);
    readonly winner = computed(() => this.race()?.entries.find(e => e.id === this.race()?.winnerEntryId) ?? null);
    readonly currentAward = computed(() => {
        const awards = this.game()?.awards ?? [];
        return awards[awards.length - 1] ?? null;
    });
    readonly canBorrow = computed(() => {
        const game = this.game();
        const me = this.me();
        return !!game && !!me && me.balance < game.loanThreshold
            && ['lobby', 'lineup', 'betting', 'results'].includes(game.status);
    });
    readonly loanAmounts = computed(() => {
        const max = this.game()?.loanMax ?? 1000;
        return [100, 500, max].filter((v, i, list) => v <= max && list.indexOf(v) === i);
    });
    /** Am I running in this player race? */
    readonly running = computed(() => !!this.race()?.entries.some(e => e.playerId === this.me()?.id));

    async borrow(amount: number) {
        const done = await this.store.act('loan.take', {amount});
        if (done !== undefined) {
            this.loanOpen.set(false);
            this.store.showToast(`+${amount} $ empruntés. Ça sera déduit à la fin!`);
        }
    }
}
