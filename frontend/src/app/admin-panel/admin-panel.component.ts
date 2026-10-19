import {Component, computed, EventEmitter, inject, Input, OnDestroy, OnInit, Output, signal} from '@angular/core';
import {Game, Message, Player, Race, Racer} from '../types';
import {environment} from '../../environments/environment';
import {QRCodeComponent} from 'angularx-qrcode';
import {MatIcon} from '@angular/material/icon';
import {DecimalPipe, NgClass} from '@angular/common';
import {WebSocketService} from '../services/websocket.service';
import {DomSanitizer, SafeResourceUrl} from '@angular/platform-browser';
import {min} from 'rxjs';
import MessageBubbleComponent from './message-bubble/message-bubble.component';

@Component({
    selector: 'admin-panel',
    standalone: true,
    imports: [
        QRCodeComponent,
        MatIcon,
        DecimalPipe,
        MessageBubbleComponent,
        NgClass
    ],
    templateUrl: 'admin-panel.component.html',
    styleUrl: 'admin-panel.component.scss'
})
export class AdminPanelComponent implements OnInit, OnDestroy {
    @Input() set currentGame(value: Game) {
        this._currentGame.set(value);
    }
    @Input() set currentRace(value: Race) {
        if (this._currentRace().id !== value.id) this.videoUrl = undefined;
        this._currentRace.set(value);
    }
    @Input() set totalBid(value: number) {
        this._totalBid.set(value);
    }
    @Input() set messages(value: Message[]) {
        if (value.length <= 0) return;

        // Schedule removal for each new message
        value.forEach(msg => {
            this.scheduleRemoval(msg);
        });
    }
    @Output() onFetchGame = new EventEmitter();
    @Output() onStartGame = new EventEmitter();
    @Output() onNextStatus = new EventEmitter();
    @Output() onCloseBets = new EventEmitter();
    websocketService = inject(WebSocketService);
    raceUrl = environment.raceUrl;
    videoUrl: SafeResourceUrl | undefined = undefined;

    _currentGame = signal<Game>({});
    _currentRace = signal<Race>({});
    _totalBid = signal<number>(1);

    _currentRacers = computed<Racer[]>(() => this._currentRace()?.racers?.map(racer => {
        for (let player of this._currentGame()?.players ?? []) {
            if (!racer.biders) racer.biders = [];
            racer.biders.push(player);
        }

        (racer.biders ?? []).sort((a, b) => (b.bidAmount ?? 0) - (a.bidAmount ?? 0))
        return racer;
    }) ?? [])

    barsHidden: boolean = false;
    amountsHidden: boolean = false;
    messageTimeouts = new Map<number, { message: Message, timeoutId: any }>();

    constructor(private sanitizer: DomSanitizer) {}

    ngOnInit() {
        this.websocketService.connectionStatus$.subscribe(isConnected => {
            if (isConnected) {
                this.fetchGame();
            }
        });
    }

    ngOnDestroy() {
        this.messageTimeouts.forEach(timeout => clearTimeout(timeout.timeoutId));
        this.messageTimeouts.clear();
    }

    fetchGame() {
        this.onFetchGame.emit();
    }

    startGame() {
        this.onStartGame.emit();
    }

    getSafeUrl(url: string) {
        if (this.videoUrl) return this.videoUrl;
        let videoId: string | undefined;
        let timestamp: string | null = null;

        // Check if it's a youtu.be short link
        if (url.includes('youtu.be/')) {
            videoId = url.split('youtu.be/')[1]?.split('?')[0];
            const timeMatch = url.match(/[?&]t=(\d+)/);
            timestamp = timeMatch ? timeMatch[1] : null;
        } else {
            // Regular youtube.com link
            videoId = url.split('v=')[1]?.split('&')[0];
            const timeMatch = url.match(/[?&]t=(\d+)/);
            timestamp = timeMatch ? timeMatch[1] : null;
        }

        // Build embed URL with timestamp if it exists
        let embedUrl = `https://www.youtube.com/embed/${videoId}`;
        if (timestamp) {
            embedUrl += `?start=${timestamp}`;
        }

        this.videoUrl = this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl);
        return this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl);
    }

    calculateRatio(amount: number) {
        return Math.max(this._totalBid(), 1) / Math.max(amount, 1);
    }

    nextStatus() {
        this.onNextStatus.emit();
    }

    closeBets() {
        this.onCloseBets.emit();
    }

    private scheduleRemoval(message: Message) {
        if (this.messageTimeouts.has(message.id ?? -1)) {
            clearTimeout(this.messageTimeouts.get(message.id ?? -1)!.timeoutId);
        }

        const timeoutId = setTimeout(() => {
            this.messageTimeouts.delete(message.id ?? -1);
        }, 5000);

        this.messageTimeouts.set(message.id ?? -1, { message, timeoutId });
    }

    getBetPercentage(playerBid: number, totalBid: number) {
        return Number((playerBid / totalBid) * 100).toFixed(2);
    }

    filteredBiders(players: Player[], racer: number) {
        return players.filter(player => player.bidRacer === racer);
    }

    toggleHideBars() {
        this.barsHidden = !this.barsHidden;
    }

    toggleHideAmounts() {
        this.amountsHidden = !this.amountsHidden;
    }
}
