import { Injectable } from '@angular/core';
import { Observable, Subject, Observer } from 'rxjs';
import {environment} from '../../environments/environment';

export interface WebSocketMessage {
    type: string;
    data?: any;
    token?: string;
}

@Injectable({
    providedIn: 'root'
})
export class WebSocketService {
    private ws: WebSocket | null = null;
    private messagesSubject = new Subject<WebSocketMessage>();
    private connectionStatusSubject = new Subject<boolean>();
    private reconnectInterval = 5000;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private url: string = environment.wsUrl;

    // Observable streams
    public messages$ = this.messagesSubject.asObservable();
    public connectionStatus$ = this.connectionStatusSubject.asObservable();

    constructor() {}

    connect(token?: string): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            console.log('WebSocket already connected');
            return;
        }

        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.connectionStatusSubject.next(true);
            this.reconnectAttempts = 0;
        };

        this.ws.onmessage = (event: MessageEvent) => {
            try {
                const message: WebSocketMessage = JSON.parse(event.data);
                this.messagesSubject.next(message);
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        };

        this.ws.onerror = (error: Event) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.connectionStatusSubject.next(false);
            this.handleReconnect(token);
        };
    }

    private handleReconnect(token?: string): void {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Reconnecting... Attempt ${this.reconnectAttempts}`);
            setTimeout(() => this.connect(token), this.reconnectInterval);
        } else {
            console.error('Max reconnection attempts reached');
        }
    }

    send(message: WebSocketMessage): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            console.error('WebSocket is not connected');
        }
    }

    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }
}
