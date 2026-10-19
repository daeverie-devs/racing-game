import {Component, inject, Inject, OnDestroy, OnInit, signal} from '@angular/core';
import {LoginScreenComponent} from './login-screen/login-screen.component';
import {PlayerPanelComponent} from './player-panel/player-panel.component';
import {GamePanelComponent} from './game-panel/game-panel.component';
import {ChatPanelComponent} from './chat-panel/chat-panel.component';
import {Game, Message, Player, Race} from './types';
import {WebSocketMessage, WebSocketService} from "./services/websocket.service";
import {Subscription} from 'rxjs';
import {ActivatedRoute} from '@angular/router';
import {AdminPanelComponent} from './admin-panel/admin-panel.component';

@Component({
    selector: 'race',
    standalone: true,
    imports: [
        LoginScreenComponent,
        PlayerPanelComponent,
        GamePanelComponent,
        ChatPanelComponent,
        AdminPanelComponent
    ],
    templateUrl: 'race.component.html',
    styleUrl: 'race.component.scss'
})
export class RaceComponent implements OnInit, OnDestroy {
    websocket = inject(WebSocketService);
    isAdmin = signal<boolean>(false);
    status = signal<string>('');
    player = signal<Player>({})
    currentGame = signal<Game>({});
    currentRace = signal<Race>({});
    totalBid = signal<number>(1);
    chat = signal<Message[]>([]);
    newMessages = signal<Message[]>([]);

    private messageSubscription?: Subscription;

    constructor(private route: ActivatedRoute) {}

    ngOnInit() {
        this.websocket.connect();

        this.messageSubscription = this.websocket.messages$.subscribe(
            (message: WebSocketMessage) => this.handleWebSocketMessage(message)
        );

        this.route.queryParams.subscribe(params => {
            this.isAdmin.set(params['isAdmin'] === 'true')
        });
    }

    ngOnDestroy() {
        this.messageSubscription?.unsubscribe();
        this.websocket.disconnect();
    }

    private handleWebSocketMessage(message: WebSocketMessage) {
        console.log('Handling message:', message);

        switch (message.type) {
            case 'player-connected':
                this.changeStatus('connected');
                this.player.set(message.data);
                localStorage.setItem('user', JSON.stringify(this.player()))
                this.websocket.send({
                    type: 'race.ready',
                    data: this.player()
                })
                break;

            case 'connected-to-lobby':
                this.changeStatus('started');
                break;

            case 'game-updated':
                this.currentGame.set(message.data);
                this.currentRace.set(this.currentGame().currentRace ?? {});
                this.totalBid.set(this.currentRace().racers?.reduce((acc, cur) => (cur.bidAmount ?? 0) + acc, 0) ?? 0)
                break;

            case 'player-updated':
                this.player.set(message.data);
                localStorage.setItem('user', JSON.stringify(this.player()))
                break;

            case 'chat-updated':
                this.chat.set(message.data);
                const newMessage = this.chat()[this.chat().length - 1]
                this.newMessages.update(old => [...old, newMessage]);
                this.removeMessage(newMessage.id ?? 0).then();
                break;

            case 'bets-tabulated':
                const players = message.data;
                const newPlayer = players.find((player: any) => player.id === this.player().id);

                if (newPlayer) {
                    this.player.set(newPlayer);
                    localStorage.setItem('user', JSON.stringify(this.player()))
                }
                break;

            case 'error':
                console.error('WebSocket error:', message.data);
                break;

            default:
                console.log('Unhandled message type:', message.type);
        }
    }

    async connect() {
        this.changeStatus('loading');

        this.websocket.send({
            type: 'race.connected-to-lobby',
            data: this.player()
        })
    }

    changeStatus(newStatus: string) {
        this.status.set(newStatus);
    }

    onUpdatePlayer(newPlayer: Player) {
        this.player.set(newPlayer);
    }

    onFetchGame() {
        this.websocket.send({
            type: 'race.request-game'
        })
    }

    onFetchChat() {
        this.websocket.send({
            type: 'race.request-chat'
        })
    }

    onSendMessage(message: string) {
        this.websocket.send({
            type: 'race.send-message',
            data: {
                player: this.player(),
                message: message
            }
        })
    }

    onStartGame() {
        this.websocket.send({
            type: 'race.start-game'
        })
    }

    onNextStatus() {
        this.websocket.send({
            type: 'race.next-status'
        })
    }

    onCloseBets() {
        this.websocket.send({
            type: 'race.close-bets'
        })
    }

    onBet(event: { player: Player, amount: number }) {
        this.websocket.send({
            type: 'race.player-bid',
            data: {
                player: event.player,
                amount: event.amount
            }
        })
    }

    async removeMessage(id: number) {
        await new Promise(resolve => setTimeout(resolve, 100));
        this.newMessages.update(old => [...old.filter(mes => mes.id !== id)]);
    }
}
