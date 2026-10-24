import {ChangeDetectionStrategy, Component, computed, input} from '@angular/core';
import {AvatarComponent} from '../avatar/avatar.component';
import {MoneyPipe} from '../core/format';
import {PlayerInfo} from '../core/types';
import {LeaderboardComponent} from './leaderboard.component';

/**
 * The final reveal, one step at a time: 4th place and below first, then 3rd, 2nd and 1st.
 * step 0 = 4th and below, 1 = + 3rd, 2 = + 2nd, 3 = + 1st
 */
@Component({
    selector: 'rg-podium',
    standalone: true,
    imports: [AvatarComponent, MoneyPipe, LeaderboardComponent],
    templateUrl: 'podium.component.html',
    styleUrl: 'podium.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {'[class.large]': 'large()'},
})
export class PodiumComponent {
    players = input.required<PlayerInfo[]>();
    step = input(0);
    large = input(false);
    highlightId = input<number | null>(null);

    readonly rest = computed(() => this.players().filter(p => p.rank >= 4));
    /** On the big screen, up to 3 columns of about 6 rows so everyone fits under the podium */
    readonly restColumns = computed(() => this.large() ? Math.min(3, Math.ceil(this.rest().length / 6)) : 1);
    /** Podium places in display order: 2nd, 1st, 3rd */
    readonly places = computed(() => [2, 1, 3].map(rank => ({
        rank,
        players: this.players().filter(p => p.rank === rank),
        // 3rd shows at step 1, 2nd at step 2, 1st at step 3
        revealed: this.step() >= 4 - rank,
    })));
}
