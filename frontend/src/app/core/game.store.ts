import {Injectable, computed, inject, signal} from '@angular/core';
import {SocketService} from './socket.service';
import {ChatMessage, GameState, PlayerInfo, Skin} from './types';

const TOKEN_KEY = 'rg.token';
const PROFILE_KEY = 'rg.profile';
const PASSCODE_KEY = 'rg.admin';

export interface Profile {
    name: string;
    skin: Skin;
}

const read = (key: string) => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

const write = (key: string, value: string | null) => {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        // Private mode: the session just won't survive a reload
    }
};

/**
 * Everything the screens show comes from here: the last state the server pushed, the chat, and the
 * phone's session (player token, name and skin, admin passcode) kept in localStorage so a reload
 * or a locked phone lands straight back in the game.
 */
@Injectable({providedIn: 'root'})
export class GameStore {
    private socket = inject(SocketService);

    readonly state = signal<GameState | null>(null);
    readonly chat = signal<ChatMessage[]>([]);
    readonly newMessage = signal<ChatMessage | null>(null);
    /** True once the server answered hello on this connection */
    readonly ready = signal(false);
    readonly isAdmin = signal(false);
    readonly toast = signal<{text: string, id: number} | null>(null);
    readonly connection = this.socket.status;
    readonly connectionLost = computed(() => this.socket.everConnected() && this.socket.status() !== 'open');
    /** Server clock minus ours, so every phone's countdown ends at the same moment */
    private clockOffset = 0;

    readonly game = computed(() => this.state()?.game ?? null);
    readonly race = computed(() => this.state()?.race ?? null);
    readonly players = computed(() => this.state()?.players ?? []);
    readonly me = computed<PlayerInfo | null>(() => {
        const id = this.state()?.me?.playerId;
        return id ? this.players().find(p => p.id === id) ?? null : null;
    });
    readonly myBet = computed(() => this.state()?.me?.bet ?? null);
    readonly playersById = computed(() => new Map(this.players().map(p => [p.id, p])));

    constructor() {
        this.socket.opened$.subscribe(() => this.hello());
        this.socket.events$.subscribe(({type, data}) => {
            if (type === 'state') {
                this.clockOffset = data.serverNow - Date.now();
                this.state.set(data);
            } else if (type === 'chat') {
                this.chat.update(list => [...list.slice(-99), data]);
                this.newMessage.set(data);
            }
        });
        this.socket.connect();
    }

    get profile(): Profile | null {
        try {
            return JSON.parse(read(PROFILE_KEY) ?? 'null');
        } catch {
            return null;
        }
    }

    now() {
        return Date.now() + this.clockOffset;
    }

    private async hello() {
        this.ready.set(false);
        try {
            const reply = await this.socket.request('hello', {token: read(TOKEN_KEY), passcode: read(PASSCODE_KEY)});
            this.isAdmin.set(reply.admin);
            if (!reply.admin && read(PASSCODE_KEY)) write(PASSCODE_KEY, null);
            this.chat.set(reply.chat);
            this.ready.set(true);
        } catch {
            // The socket reconnects and says hello again
        }
    }

    async join(profile: Profile) {
        const reply = await this.socket.request('player.join', {token: read(TOKEN_KEY), ...profile});
        write(TOKEN_KEY, reply.token);
        write(PROFILE_KEY, JSON.stringify(profile));
    }

    async login(passcode: string) {
        await this.socket.request('admin.login', {passcode});
        write(PASSCODE_KEY, passcode);
        this.isAdmin.set(true);
    }

    logout() {
        write(PASSCODE_KEY, null);
        this.isAdmin.set(false);
    }

    /** Runs a request and shows its error as a toast instead of throwing */
    async act<T = unknown>(type: string, data?: unknown): Promise<T | undefined> {
        try {
            return await this.socket.request<T>(type, data);
        } catch (err) {
            this.showToast((err as Error).message);
            return undefined;
        }
    }

    draft(entryId: number | null, amount: number) {
        this.socket.send('bet.draft', {entryId, amount});
    }

    showToast(text: string) {
        const id = Date.now();
        this.toast.set({text, id});
        setTimeout(() => {
            if (this.toast()?.id === id) this.toast.set(null);
        }, 3500);
    }
}
