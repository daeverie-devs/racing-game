import {ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked} from '@angular/core';
import {MatIcon} from '@angular/material/icon';
import {AvatarComponent} from '../avatar/avatar.component';
import {GameStore} from '../core/game.store';
import {MoneyPipe, OddsPipe, RecordPipe} from '../core/format';
import {CountdownComponent} from '../ui/countdown.component';
import {EntryVisualComponent} from '../ui/entry-visual.component';

const STEPS = [1, 10, 100, 1000];

/**
 * Betting on the phone: the bet is built here and only sent when locked. The current pick is
 * also saved quietly (a "draft"), so the admin's countdown can lock it in if time runs out.
 */
@Component({
    selector: 'rg-betting',
    standalone: true,
    imports: [MatIcon, AvatarComponent, MoneyPipe, OddsPipe, RecordPipe, CountdownComponent, EntryVisualComponent],
    templateUrl: 'betting.component.html',
    styleUrl: 'betting.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BettingComponent {
    store = inject(GameStore);
    readonly steps = STEPS;

    selectedId = signal<number | null>(null);
    amount = signal(0);
    busy = signal(false);

    readonly race = this.store.race;
    readonly me = this.store.me;
    readonly bet = this.store.myBet;
    readonly locked = computed(() => !!this.bet()?.locked);
    readonly selected = computed(() => this.race()?.entries.find(e => e.id === this.selectedId()) ?? null);
    readonly lockedEntry = computed(() => this.race()?.entries.find(e => e.id === this.bet()?.entryId) ?? null);
    readonly balance = computed(() => Math.floor(this.me()?.balance ?? 0));
    readonly minBet = computed(() => this.store.state()?.me?.minBet ?? 1);
    readonly game = this.store.game;
    /**
     * What the bet would return at the starting odds, within the cap and doubled on the last race.
     * An estimate: the real odds depend on everyone's bets, revealed when all are locked
     */
    readonly estimate = computed(() => {
        const game = this.game();
        const odds = this.selected()?.startOdds;
        if (!game || !odds || this.amount() < 1) return null;
        const ratio = Math.min(Math.max(odds, game.minReturn), game.payoutCap);
        return this.amount() * ratio * (game.isFinalRace ? game.finalMultiplier : 1);
    });
    readonly readyCount = computed(() => this.store.players().filter(p => p.locked).length);

    private draftTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        // A new race starts empty; after a reload, the saved pick comes back
        effect(() => {
            const raceId = this.race()?.id;
            untracked(() => {
                const bet = this.bet();
                this.selectedId.set(bet?.entryId ?? null);
                this.amount.set(bet?.amount ?? 0);
            });
            void raceId;
        });
    }

    select(id: number | null) {
        this.selectedId.set(id);
        // Picking a racer starts at the minimum bet
        if (id !== null && this.amount() < this.minBet()) this.amount.set(Math.min(this.minBet(), this.balance()));
        this.saveDraft();
    }

    add(step: number) {
        this.amount.update(a => Math.min(a + step, this.balance()));
        this.saveDraft();
    }

    allIn() {
        this.amount.set(this.balance());
        this.saveDraft();
    }

    /** Back to the minimum bet */
    clear() {
        this.amount.set(Math.min(this.minBet(), this.balance()));
        this.saveDraft();
    }

    async lock() {
        if (this.busy() || !this.selectedId() || this.amount() < this.minBet()) return;
        this.busy.set(true);
        await this.store.act('bet.lock', {entryId: this.selectedId(), amount: this.amount()});
        this.busy.set(false);
    }

    async pass() {
        this.busy.set(true);
        await this.store.act('bet.pass');
        this.busy.set(false);
    }

    async unlock() {
        this.busy.set(true);
        await this.store.act('bet.unlock');
        this.busy.set(false);
    }

    private saveDraft() {
        if (this.draftTimer) clearTimeout(this.draftTimer);
        this.draftTimer = setTimeout(() => this.store.draft(this.selectedId(), this.amount()), 300);
    }
}
