import {Component, Input, signal} from '@angular/core';
import {Player} from '../types';
import {DecimalPipe} from '@angular/common';

@Component({
    selector: 'player-panel',
    standalone: true,
    imports: [
        DecimalPipe
    ],
    templateUrl: 'player-panel.component.html',
    styleUrl: 'player-panel.component.scss'
})
export class PlayerPanelComponent {
    @Input() set player(player: Player) {
        this._player.set(player);
    }

    _player = signal<Player>({});
}
