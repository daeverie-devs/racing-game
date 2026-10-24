import {ChangeDetectionStrategy, Component, computed, inject} from '@angular/core';
import {DomSanitizer} from '@angular/platform-browser';
import {MatIcon} from '@angular/material/icon';
import {QRCodeComponent} from 'angularx-qrcode';
import {environment} from '../../environments/environment';
import {AvatarComponent} from '../avatar/avatar.component';
import {skinColor} from '../avatar/skin';
import {GameStore} from '../core/game.store';
import {MoneyPipe, OddsPipe, RecordPipe, youtubeEmbed} from '../core/format';
import {Entry} from '../core/types';
import {AwardCardComponent} from '../ui/award-card.component';
import {ChatBubblesComponent} from '../ui/chat-bubbles.component';
import {CountdownComponent} from '../ui/countdown.component';
import {EntryVisualComponent} from '../ui/entry-visual.component';
import {LeaderboardComponent} from '../ui/leaderboard.component';
import {PodiumComponent} from '../ui/podium.component';
import {ShamePopupComponent} from '../ui/shame-popup.component';

/** The big screen: what the room watches. Controls live in the admin bar on top of it */
@Component({
    selector: 'rg-screen',
    standalone: true,
    imports: [
        MatIcon, QRCodeComponent, AvatarComponent, MoneyPipe, OddsPipe, RecordPipe, AwardCardComponent, ChatBubblesComponent,
        CountdownComponent, EntryVisualComponent, LeaderboardComponent, PodiumComponent, ShamePopupComponent,
    ],
    templateUrl: 'screen.component.html',
    styleUrl: 'screen.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScreenComponent {
    store = inject(GameStore);
    private sanitizer = inject(DomSanitizer);

    readonly joinUrl = environment.raceUrl;
    /** Phones can't reach "localhost": the big screen must be opened with the laptop's network address */
    readonly localOnly = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

    readonly game = this.store.game;
    readonly race = this.store.race;
    readonly players = this.store.players;
    readonly status = computed(() => this.game()?.status ?? 'lobby');
    readonly readyCount = computed(() => this.players().filter(p => p.locked).length);
    /**
     * Keyed on the link text: the race object is replaced on every server update (a chat message,
     * a player connecting), and a new URL object would reload the video each time
     */
    readonly videoLink = computed(() => this.race()?.link ?? null);
    readonly video = computed(() => {
        const url = youtubeEmbed(this.videoLink());
        return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
    });
    readonly winner = computed(() => this.race()?.entries.find(e => e.id === this.race()?.winnerEntryId) ?? null);
    readonly currentAward = computed(() => {
        const awards = this.game()?.awards ?? [];
        return awards[awards.length - 1] ?? null;
    });
    readonly debtors = computed(() => this.players().filter(p => p.loans > 0).sort((a, b) => b.loans - a.loans));
    /** Biggest entry total, so the bars share one scale */
    readonly maxTotal = computed(() => Math.max(1, ...(this.race()?.entries ?? []).map(e => e.total ?? 0)));

    bettorColor(playerId: number) {
        return skinColor(this.store.playersById().get(playerId)?.skin);
    }

    bettorName(playerId: number) {
        return this.store.playersById().get(playerId)?.name ?? '?';
    }

    winners(entry: Entry) {
        return entry.bettors.filter(b => (b.payout ?? 0) > 0).sort((a, b) => (b.payout ?? 0) - (a.payout ?? 0));
    }
}
