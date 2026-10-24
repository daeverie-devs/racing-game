import {ChangeDetectionStrategy, Component, HostListener, computed, inject, output, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatIcon} from '@angular/material/icon';
import {GameStore} from '../core/game.store';
import {MoneyPipe, RecordPipe} from '../core/format';
import {EditorData, EditorGame, EditorRace, RaceType} from '../core/types';
import {imageFromTransfer, resizeImage} from './image';

type Tab = 'games' | 'races' | 'racers';

interface RacerForm {
    id: number | null;
    name: string;
    image: string | null;
    preview: string | null;
    /** Races run before the app, shown in the racer's record */
    pastWins: number;
    pastRuns: number;
}

interface RaceForm {
    id: number | null;
    name: string;
    type: RaceType;
    link: string;
    racerIds: number[];
    presetWinnerRacerId: number | null;
}

interface GameForm {
    id: number | null;
    name: string;
    startingBalance: number;
    awardBonus: number;
    countdownSeconds: number;
}

/** Admin editor: games (and which one is active), their races in order, and the racer library */
@Component({
    selector: 'rg-editor',
    standalone: true,
    imports: [FormsModule, MatIcon, MoneyPipe, RecordPipe],
    templateUrl: 'editor.component.html',
    styleUrl: 'editor.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditorComponent {
    private store = inject(GameStore);
    close = output();

    tab = signal<Tab>('races');
    data = signal<EditorData>({racers: [], games: []});
    selectedGameId = signal<number | null>(null);
    busy = signal(false);
    dragging = signal(false);

    racerForm = signal<RacerForm | null>(null);
    raceForm = signal<RaceForm | null>(null);
    gameForm = signal<GameForm | null>(null);
    racerSearch = signal('');

    readonly selectedGame = computed(() => {
        const games = this.data().games;
        return games.find(g => g.id === this.selectedGameId()) ?? games.find(g => g.active) ?? games[0] ?? null;
    });
    readonly racersById = computed(() => new Map(this.data().racers.map(r => [r.id, r])));
    readonly filteredRacers = computed(() => {
        const query = this.racerSearch().trim().toLowerCase();
        return this.data().racers.filter(r => !query || r.name.toLowerCase().includes(query));
    });
    /** Races of the active game that already started are locked */
    readonly lockedRaceIds = computed(() => {
        const game = this.selectedGame();
        const live = this.store.game();
        if (!game?.active || !live || live.status === 'lobby') return new Set<number>();
        return new Set(game.races.slice(0, live.raceIndex + 1).map(r => r.id));
    });

    constructor() {
        this.load();
    }

    private async load() {
        const data = await this.store.act<EditorData>('editor.load');
        if (data) this.data.set(data);
    }

    /** Runs an editor action; the server answers with the fresh editor data (and the saved id) */
    private async save(type: string, payload: unknown): Promise<{id?: number} | null> {
        this.busy.set(true);
        const reply = await this.store.act<{editor: EditorData, id?: number} | EditorData>(type, payload);
        this.busy.set(false);
        if (!reply) return null;
        if ('editor' in reply) {
            this.data.set(reply.editor);
            return {id: reply.id};
        }
        this.data.set(reply);
        return {};
    }

    // ---------- Games ----------

    newGame() {
        this.gameForm.set({id: null, name: '', startingBalance: 5000, awardBonus: 500, countdownSeconds: 15});
    }

    editGame(game: EditorGame) {
        const {id, name, startingBalance, awardBonus, countdownSeconds} = game;
        this.gameForm.set({id, name, startingBalance, awardBonus, countdownSeconds});
    }

    async saveGame() {
        if (await this.save('game.save', this.gameForm())) this.gameForm.set(null);
    }

    activate(game: EditorGame) {
        if (confirm(`Jouer « ${game.name} »? Les téléphones de la partie en cours retourneront à l'accueil.`)) {
            this.save('game.activate', {id: game.id});
        }
    }

    resetGame(game: EditorGame) {
        if (confirm(`Recommencer « ${game.name} »? Joueurs, mises et chat effacés, les courses restent.`)) {
            this.save('game.reset', {gameId: game.id});
        }
    }

    deleteGame(game: EditorGame) {
        if (confirm(`Supprimer « ${game.name} » et ses ${game.races.length} courses?`)) this.save('game.delete', {id: game.id});
    }

    openRaces(game: EditorGame) {
        this.selectedGameId.set(game.id);
        this.tab.set('races');
    }

    // ---------- Races ----------

    newRace() {
        this.raceForm.set({id: null, name: '', type: 'racers', link: '', racerIds: [], presetWinnerRacerId: null});
    }

    editRace(race: EditorRace) {
        this.raceForm.set({...race, link: race.link ?? ''});
    }

    toggleRaceRacer(id: number) {
        this.raceForm.update(form => {
            if (!form) return form;
            const racerIds = form.racerIds.includes(id) ? form.racerIds.filter(r => r !== id) : [...form.racerIds, id];
            const presetWinnerRacerId = racerIds.includes(form.presetWinnerRacerId ?? -1) ? form.presetWinnerRacerId : null;
            return {...form, racerIds, presetWinnerRacerId};
        });
    }

    patchRace(patch: Partial<RaceForm>) {
        this.raceForm.update(form => form ? {...form, ...patch} : form);
    }

    async saveRace() {
        const form = this.raceForm();
        const game = this.selectedGame();
        if (!form || !game) return;
        if (await this.save('race.save', {...form, gameId: game.id})) this.raceForm.set(null);
    }

    deleteRace(race: EditorRace) {
        if (confirm(`Supprimer « ${race.name || 'cette course'} »?`)) this.save('race.delete', {id: race.id});
    }

    move(race: EditorRace, delta: number) {
        const game = this.selectedGame();
        if (!game) return;
        const ids = game.races.map(r => r.id);
        const from = ids.indexOf(race.id);
        const to = from + delta;
        if (to < 0 || to >= ids.length) return;
        [ids[from], ids[to]] = [ids[to], ids[from]];
        this.save('race.reorder', {gameId: game.id, raceIds: ids});
    }

    raceTitle(race: EditorRace, index: number) {
        return race.name || `Course ${index + 1}`;
    }

    // ---------- Racers ----------

    newRacer() {
        this.racerForm.set({id: null, name: '', image: null, preview: null, pastWins: 0, pastRuns: 0});
    }

    editRacer(id: number) {
        const racer = this.racersById().get(id);
        if (racer) {
            const {id, name, imageUrl, pastWins, pastRuns} = racer;
            this.racerForm.set({id, name, image: null, preview: imageUrl, pastWins, pastRuns});
        }
    }

    async useImage(file: Blob | null | undefined) {
        if (!file || !this.racerForm()) return;
        try {
            const image = await resizeImage(file);
            this.racerForm.update(form => form ? {...form, image, preview: image} : form);
        } catch (err) {
            this.store.showToast((err as Error).message);
        }
    }

    pickFile(event: Event) {
        const input = event.target as HTMLInputElement;
        this.useImage(input.files?.[0]);
        input.value = '';
    }

    onDrop(event: DragEvent) {
        event.preventDefault();
        this.dragging.set(false);
        this.useImage(imageFromTransfer(event.dataTransfer));
    }

    onDragOver(event: DragEvent) {
        event.preventDefault();
        this.dragging.set(true);
    }

    /** A screenshot pasted anywhere while the racer form is open becomes its picture */
    @HostListener('window:paste', ['$event'])
    onPaste(event: ClipboardEvent) {
        if (!this.racerForm()) return;
        const file = imageFromTransfer(event.clipboardData);
        if (!file) return;
        event.preventDefault();
        this.useImage(file);
    }

    patchRacer(patch: Partial<RacerForm>) {
        this.racerForm.update(form => form ? {...form, ...patch} : form);
    }

    async saveRacer(addAnother = false) {
        const form = this.racerForm();
        if (!form) return;
        const {id, name, image, pastWins, pastRuns} = form;
        const saved = await this.save('racer.save', {id, name, image, pastWins, pastRuns});
        if (!saved) return;
        // Created from the race form: the new racer joins that race
        const race = this.raceForm();
        if (!form.id && saved.id && race && !race.racerIds.includes(saved.id)) this.toggleRaceRacer(saved.id);
        this.racerForm.set(addAnother ? {id: null, name: '', image: null, preview: null, pastWins: 0, pastRuns: 0} : null);
    }

    deleteRacer(id: number) {
        const racer = this.racersById().get(id);
        if (racer && confirm(`Supprimer ${racer.name}?`)) this.save('racer.delete', {id});
    }

    @HostListener('window:keydown.escape')
    onEscape() {
        if (this.racerForm()) this.racerForm.set(null);
        else if (this.raceForm()) this.raceForm.set(null);
        else if (this.gameForm()) this.gameForm.set(null);
        else this.close.emit();
    }
}
