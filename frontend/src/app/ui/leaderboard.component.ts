import {ChangeDetectionStrategy, Component, computed, input} from '@angular/core';
import {AvatarComponent} from '../avatar/avatar.component';
import {MoneyPipe, OrdinalPipe} from '../core/format';
import {PlayerInfo} from '../core/types';

interface Row {
    player: PlayerInfo;
    /** Where this row slides from, in rows and columns: its place before the last race minus its place now */
    fromRow: number;
    fromCol: number;
    moved: number;
    hidden: boolean;
}

/**
 * Players ranked by score. With [animate], rows start where they stood before the last race and
 * slide to their new place, with an arrow for the places gained or lost.
 */
@Component({
    selector: 'rg-leaderboard',
    standalone: true,
    imports: [AvatarComponent, MoneyPipe, OrdinalPipe],
    templateUrl: 'leaderboard.component.html',
    styleUrl: 'leaderboard.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '[class.large]': 'large()',
        '[class.columns]': 'columns()',
        '[style.--rows]': 'rowsPerColumn()',
    },
})
export class LeaderboardComponent {
    players = input.required<PlayerInfo[]>();
    animate = input(false);
    showDelta = input(false);
    large = input(false);
    highlightId = input<number | null>(null);
    /** Podium reveal: ranks at or above this stay hidden (0 = show all) */
    hideRanksUpTo = input(0);
    /** Big screen: split a long list into this many columns, read top to bottom */
    columnCount = input(1);

    readonly columns = computed(() => this.columnCount() > 1);
    readonly rowsPerColumn = computed(() => Math.ceil(this.players().length / Math.max(1, this.columnCount())));

    readonly rows = computed<Row[]>(() => {
        const sorted = [...this.players()].sort((a, b) => a.rank - b.rank || a.id - b.id);
        const before = [...this.players()]
            .sort((a, b) => (a.prevRank ?? a.rank) - (b.prevRank ?? b.rank) || a.id - b.id)
            .map(p => p.id);
        const perColumn = this.columns() ? this.rowsPerColumn() : Number.MAX_SAFE_INTEGER;
        const cell = (i: number) => ({row: i % perColumn, col: Math.floor(i / perColumn)});
        return sorted.map((player, index) => {
            const from = cell(before.indexOf(player.id));
            const to = cell(index);
            return {
                player,
                fromRow: this.animate() ? from.row - to.row : 0,
                fromCol: this.animate() ? from.col - to.col : 0,
                moved: player.prevRank !== null ? player.prevRank - player.rank : 0,
                hidden: player.rank <= this.hideRanksUpTo(),
            };
        });
    });
}
