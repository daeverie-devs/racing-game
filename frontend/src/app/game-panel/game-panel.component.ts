import {Component, EventEmitter, inject, Input, OnInit, Output, signal} from '@angular/core';
import {Game, Player, Race, Racer} from '../types';
import {WebSocketService} from '../services/websocket.service';
import {environment} from '../../environments/environment';
import {DecimalPipe, NgClass} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {MatIcon} from '@angular/material/icon';

@Component({
    selector: 'game-panel',
    standalone: true,
    imports: [
        DecimalPipe,
        FormsModule,
        MatIcon,
        NgClass
    ],
    templateUrl: 'game-panel.component.html',
    styleUrl: 'game-panel.component.scss'
})
export class GamePanelComponent implements OnInit{
    @Input() set currentGame(value: Game) {
        this._currentGame.set(value);
    }
    @Input() set currentRace(value: Race) {
        this._currentRace.set(value);
        if (!this._player().bidRacer || !this._currentRace()?.racers) return;

        const racer = this._currentRace()?.racers?.find(racer => racer.id === this._player().bidRacer);
        if (racer) {
            this._selectedRacer.set(racer);
        }
    }
    @Input() set totalBid(value: number) {
        this._totalBid.set(value);
    }
    @Input() set player(value: Player) {
        this._player.set(value);
    }
    @Output() onBet = new EventEmitter<{ player: Player, amount: number }>();
    @Output() onFetchGame = new EventEmitter();
    websocketService = inject(WebSocketService);

    _currentGame = signal<Game>({});
    _currentRace = signal<Race>({});
    _player = signal<Player>({});
    _totalBid = signal<number>(1);
    _selectedRacer = signal<Racer>({});

    currentBid = 0;

    ngOnInit() {
        this.websocketService.connectionStatus$.subscribe(isConnected => {
            if (isConnected) {
                this.fetchGame();
            }
        });
    }

    fetchGame() {
        this.onFetchGame.emit();
    }

    calculateRatio(amount: number) {
        return Math.max(this._totalBid(), 1) / Math.max(amount, 1);
    }

    selectRacer(id: number) {
        this._player.update(old => ({...old, bidRacer: id}));
        this._selectedRacer.set(this._currentRace()?.racers?.find(racer => racer.id === id) ?? {});
    }

    betAmount(amount: number) {
        if ((this._player()?.balance ?? 0) - amount < 0) return;

        console.log(this._player())
        this.onBet.emit({player: this._player(), amount});
    }

    deselectRacer() {
        this._player.update(old => ({...old, bidRacer: 0}));
    }
}
