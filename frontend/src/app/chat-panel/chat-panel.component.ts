import {
    AfterViewChecked,
    Component, ElementRef,
    EventEmitter,
    inject,
    Input,
    OnInit,
    Output,
    signal,
    ViewChild
} from '@angular/core';
import {MatIcon} from '@angular/material/icon';
import {NgClass} from '@angular/common';
import {Message, Player} from '../types';
import {WebSocketService} from '../services/websocket.service';
import {FormsModule} from '@angular/forms';

@Component({
    selector: 'chat-panel',
    standalone: true,
    imports: [
        MatIcon,
        NgClass,
        FormsModule
    ],
    templateUrl: 'chat-panel.component.html',
    styleUrl: 'chat-panel.component.scss'
})
export class ChatPanelComponent implements OnInit, AfterViewChecked {
    @Input() set chat(value: Message[]) {
        this._chat.set(value);
    }
    @Input() set player(value: Player) {
        this._player.set(value);
    }
    @Output() onFetchChat = new EventEmitter();
    @Output() onSendMessage = new EventEmitter<string>();
    @ViewChild('chatContainer') private chatContainer!: ElementRef;
    status = signal<boolean>(false);
    _chat = signal<Message[]>([])
    _player = signal<Player>({})

    message = '';

    ngOnInit() {
        const player = localStorage.getItem('user');

        if (player) {
            this._player.set(JSON.parse(player));
        }

        this.fetchChat();
    }

    ngAfterViewChecked() {
        this.scrollToBottom();
    }

    private scrollToBottom(): void {
        try {
            this.chatContainer.nativeElement.scrollTop =
                this.chatContainer.nativeElement.scrollHeight;
        } catch(err) { }
    }

    fetchChat() {
        this.onFetchChat.emit();
    }

    sendMessage() {
        if (this.message.length <= 0) return;

        this.onSendMessage.emit(this.message);

        this.message = '';
    }

    toggleChat() {
        this.status.update(old => !old);
    }
}
