import {Component, EventEmitter, Input, OnInit, Output, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatIcon} from '@angular/material/icon';
import {Player} from '../types';

@Component({
    selector: 'login-screen',
    standalone: true,
    imports: [
        FormsModule,
        MatIcon
    ],
    templateUrl: 'login-screen.component.html',
    styleUrl: 'login-screen.component.scss'
})
export class LoginScreenComponent implements OnInit{
    @Input() set status(value: string) {
        this._status.set(value);
    }
    @Output() onConnect = new EventEmitter();
    @Output() onUpdatePlayer = new EventEmitter<Player>();
    player = signal<Player>({});
    _status = signal<string>('');

    ngOnInit() {
        const user = localStorage.getItem('user');

        if (user) {
            this.player.set(JSON.parse(user));
            this.onUpdatePlayer.emit(this.player())
        }
        else {
            this.player.update(old => ({...old, name: '', color: '#000'}));
            this.onUpdatePlayer.emit(this.player())
        }
    }

    connect() {
        if ((this.player().name?.trim().length ?? 0) <= 0) return;
        this.onConnect.emit();
    }

    updateUsername(event: any) {
        const newName = event.target?.value;
        this.player.update(old => ({...old, name: newName}))
        this.onUpdatePlayer.emit(this.player())
    }

    colorChange() {
        this.onUpdatePlayer.emit(this.player());
    }
}
