import {ChangeDetectionStrategy, Component, computed, effect, inject, output, signal, untracked} from '@angular/core';
import {MatIcon} from '@angular/material/icon';
import {AvatarComponent} from '../avatar/avatar.component';
import {GameStore} from '../core/game.store';
import {EntryVisualComponent} from '../ui/entry-visual.component';

const STATUS_LABELS: Record<string, string> = {
    lobby: 'Lobby',
    lineup: 'Choix des coureurs',
    betting: 'Paris ouverts',
    watching: 'Course en cours',
    results: 'Résultats',
    awards: 'Prix',
    podium: 'Podium',
};

/** The admin's bar at the bottom of the big screen: the next step of the game, one button at a time */
@Component({
    selector: 'rg-controls',
    standalone: true,
    imports: [MatIcon, AvatarComponent, EntryVisualComponent],
    templateUrl: 'controls.component.html',
    styleUrl: 'controls.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ControlsComponent {
    store = inject(GameStore);
    openEditor = output();

    collapsed = signal(false);
    busy = signal(false);
    lineup = signal<number[]>([]);
    winnerId = signal<number | null>(null);
    /** The admin chose to override the winner set in the editor */
    picking = signal(false);

    readonly game = this.store.game;
    readonly race = this.store.race;
    readonly status = computed(() => this.game()?.status ?? 'lobby');
    readonly statusLabel = computed(() => STATUS_LABELS[this.status()] ?? this.status());
    readonly isLastRace = computed(() => (this.game()?.raceIndex ?? 0) + 1 >= (this.game()?.raceCount ?? 0));
    readonly lockedCount = computed(() => this.store.players().filter(p => p.locked).length);
    readonly hasPreset = computed(() => !!this.store.state()?.admin?.presetWinnerEntryId);

    constructor() {
        // Preselect the winner set in the editor when the race is revealed
        effect(() => {
            const preset = this.store.state()?.admin?.presetWinnerEntryId ?? null;
            const raceId = this.race()?.id;
            void raceId;
            untracked(() => {
                this.winnerId.set(preset);
                this.picking.set(false);
            });
        });
        // A new lineup step starts empty
        effect(() => {
            if (this.status() === 'lineup') untracked(() => this.lineup.set([]));
        });
    }

    toggleRunner(id: number) {
        this.lineup.update(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
    }

    async run(type: string, data?: unknown) {
        if (this.busy()) return;
        this.busy.set(true);
        await this.store.act(type, data);
        this.busy.set(false);
    }

    reset() {
        if (confirm('Recommencer la partie? Les joueurs, les mises et le chat seront effacés.')) this.run('game.reset');
    }

    logout() {
        this.store.logout();
    }
}
