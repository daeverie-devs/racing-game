import {Injectable, NgZone, inject, signal} from '@angular/core';
import {Subject} from 'rxjs';
import {environment} from '../../environments/environment';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

interface Pending {
    resolve: (data: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 10_000;
// A phone waking up often holds a dead socket that still says "open": a ping that gets no answer
// this fast means reconnect now instead of waiting for the browser to notice
const PING_TIMEOUT_MS = 2500;
const CONNECT_TIMEOUT_MS = 5000;
const MAX_RETRY_MS = 2000;

/**
 * One websocket that never gives up: it reconnects with a short backoff, and right away when the
 * phone wakes up or gets its network back. Requests get the server's reply as a promise.
 */
@Injectable({providedIn: 'root'})
export class SocketService {
    private zone = inject(NgZone);
    private ws: WebSocket | null = null;
    private reqId = 0;
    private pending = new Map<number, Pending>();
    private retryDelay = 500;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;

    readonly status = signal<ConnectionStatus>('connecting');
    /** False until the first connection, so the first load doesn't claim the connection was lost */
    readonly everConnected = signal(false);
    /** Server pushes other than replies: state, chat */
    readonly events$ = new Subject<{type: string, data: any}>();
    /** Fires on every (re)connection, so the store can say hello again */
    readonly opened$ = new Subject<void>();

    constructor() {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') this.checkAlive();
        });
        window.addEventListener('online', () => this.checkAlive());
        window.addEventListener('pageshow', () => this.checkAlive());
        window.addEventListener('focus', () => this.checkAlive());
        setInterval(() => {
            if (document.visibilityState === 'visible') this.checkAlive();
        }, 20_000);
    }

    /** Reconnects at once if the socket is closed, or open but not answering */
    private async checkAlive() {
        if (!this.ws || this.ws.readyState > WebSocket.OPEN) {
            this.reconnectNow();
            return;
        }
        if (this.ws.readyState !== WebSocket.OPEN) return;
        const ws = this.ws;
        const alive = await Promise.race([
            this.request('ping').then(() => true, () => false),
            new Promise<boolean>(resolve => setTimeout(() => resolve(false), PING_TIMEOUT_MS)),
        ]);
        if (!alive && this.ws === ws) this.drop(ws);
    }

    /** Forgets a dead socket and opens a new one right away */
    private drop(ws: WebSocket) {
        ws.onclose = null;
        ws.onmessage = null;
        ws.close();
        this.ws = null;
        this.status.set('closed');
        this.failPending('Connexion perdue');
        this.reconnectNow();
    }

    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
        this.status.set('connecting');
        const ws = new WebSocket(environment.wsUrl);
        this.ws = ws;
        // A connection attempt that hangs (phone still waking up its Wi-Fi) is retried
        const connectTimer = setTimeout(() => {
            if (this.ws === ws && ws.readyState === WebSocket.CONNECTING) this.zone.run(() => this.drop(ws));
        }, CONNECT_TIMEOUT_MS);

        ws.onopen = () => this.zone.run(() => {
            clearTimeout(connectTimer);
            this.retryDelay = 500;
            this.status.set('open');
            this.everConnected.set(true);
            this.opened$.next();
        });
        ws.onmessage = event => this.zone.run(() => this.handle(event.data));
        ws.onclose = () => this.zone.run(() => {
            if (this.ws !== ws) return;
            this.ws = null;
            this.status.set('closed');
            this.failPending('Connexion perdue');
            this.scheduleRetry();
        });
        ws.onerror = () => ws.close();
    }

    request<T = any>(type: string, data?: unknown): Promise<T> {
        return new Promise((resolve, reject) => {
            if (this.ws?.readyState !== WebSocket.OPEN) {
                reject(new Error('Pas de connexion, réessaie dans un instant'));
                return;
            }
            const reqId = ++this.reqId;
            const timer = setTimeout(() => {
                this.pending.delete(reqId);
                reject(new Error('Le serveur ne répond pas'));
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(reqId, {resolve, reject, timer});
            this.ws.send(JSON.stringify({type, data, reqId}));
        });
    }

    /** Fire and forget, for messages that need no answer (bet drafts) */
    send(type: string, data?: unknown) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({type, data}));
    }

    private handle(raw: string) {
        let message: {type: string, data: any};
        try {
            message = JSON.parse(raw);
        } catch {
            return;
        }
        if (message.type === 'reply') {
            const pending = this.pending.get(message.data.reqId);
            if (!pending) return;
            this.pending.delete(message.data.reqId);
            clearTimeout(pending.timer);
            if (message.data.ok) pending.resolve(message.data.data);
            else pending.reject(new Error(message.data.error ?? 'Erreur'));
            return;
        }
        this.events$.next(message);
    }

    private reconnectNow() {
        if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.connect();
    }

    private scheduleRetry() {
        if (this.retryTimer) return;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.connect();
        }, this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_MS);
    }

    private failPending(message: string) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error(message));
        }
        this.pending.clear();
    }
}
