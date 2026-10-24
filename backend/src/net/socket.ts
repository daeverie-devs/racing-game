import {randomBytes, timingSafeEqual} from 'node:crypto';
import {Server} from 'node:http';
import WebSocket, {WebSocketServer} from 'ws';
import {Player} from '../models';
import * as engine from '../game/engine';
import * as editor from '../game/editor';
import {runExclusive} from '../game/queue';
import {GameError} from '../game/rules';
import {buildAdminState, buildPrivateState, buildPublicState, messageDto} from '../game/state';

interface Connection {
    id: string;
    ws: WebSocket;
    playerId: number | null;
    admin: boolean;
    alive: boolean;
}

interface Incoming {
    type: string;
    data?: any;
    reqId?: number;
}

type Access = 'anyone' | 'player' | 'admin';

interface Handler {
    access: Access;
    /** false when the action changes nothing others need to see */
    broadcast?: boolean;
    run: (conn: Connection, data: any, player: Player | null) => Promise<unknown>;
}

const connections = new Map<string, Connection>();
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || 'chalet';

const isPasscode = (value: unknown) => {
    const given = Buffer.from(String(value ?? ''));
    const expected = Buffer.from(ADMIN_PASSCODE);
    return given.length === expected.length && timingSafeEqual(given, expected);
};

const editorReply = async () => editor.loadEditor();

const handlers: Record<string, Handler> = {
    // A phone or the big screen (re)connecting: resume the saved player and/or admin session
    'hello': {access: 'anyone', run: async (conn, data) => {
        const player = await engine.resumePlayer(data?.token);
        conn.playerId = player?.id ?? null;
        conn.admin = isPasscode(data?.passcode);
        const game = await engine.getActiveGame();
        const history = await engine.getChatHistory(game.id);
        const authors = await Player.findAll({where: {gameId: game.id}});
        return {
            player: player ? {id: player.id, name: player.name, skin: player.skin} : null,
            admin: conn.admin,
            chat: history.map(m => messageDto(m, authors.find(a => a.id === m.playerId))),
        };
    }},
    'player.join': {access: 'anyone', run: async (conn, data) => {
        const player = await engine.joinPlayer({token: data?.token, name: data?.name, skin: data?.skin});
        conn.playerId = player.id;
        return {token: player.token, player: {id: player.id, name: player.name, skin: player.skin}};
    }},
    // The passcode is checked in dispatch(), before any handler runs
    'admin.login': {access: 'anyone', broadcast: false, run: async conn => ({admin: conn.admin})},

    'bet.draft': {access: 'player', broadcast: false, run: (_c, data, p) => engine.draftBet(p!, data ?? {})},
    'bet.lock': {access: 'player', run: (_c, data, p) => engine.lockBet(p!, data ?? {})},
    'bet.unlock': {access: 'player', run: (_c, _d, p) => engine.unlockBet(p!)},
    'bet.pass': {access: 'player', run: (_c, _d, p) => engine.passBet(p!)},
    'loan.take': {access: 'player', run: async (_c, data, p) => {
        const amount = await engine.takeLoan(p!, data?.amount);
        // The big screen puts the borrower to shame
        send('loan', {playerId: p!.id, name: p!.name, skin: p!.skin, amount, total: p!.loans});
    }},
    'chat.send': {access: 'player', broadcast: false, run: async (_c, data, p) => {
        const message = await engine.sendMessage(p!, data?.text);
        if (message) send('chat', messageDto(message, p!));
    }},

    'game.next': {access: 'admin', run: () => engine.nextRace()},
    'race.lineup': {access: 'admin', run: (_c, data) => engine.setLineupAndOpen(data?.playerIds)},
    'race.countdown': {access: 'admin', run: (_c, data) => engine.startCountdown(data?.seconds)},
    'race.reveal': {access: 'admin', run: () => engine.forceReveal()},
    'race.winner': {access: 'admin', run: (_c, data) => engine.declareWinner(data?.entryId)},
    'awards.next': {access: 'admin', run: () => engine.nextAward()},
    'podium.next': {access: 'admin', run: () => engine.nextPodiumStep()},
    'game.reset': {access: 'admin', run: async (_c, data) => {
        await engine.resetGame(data?.gameId);
        return editorReply();
    }},
    'player.kick': {access: 'admin', run: (_c, data) => engine.kickPlayer(data?.playerId)},

    'editor.load': {access: 'admin', broadcast: false, run: editorReply},
    'racer.save': {access: 'admin', run: async (_c, data) => ({id: await editor.saveRacer(data ?? {}), editor: await editorReply()})},
    'racer.delete': {access: 'admin', run: async (_c, data) => { await editor.deleteRacer(data?.id); return {editor: await editorReply()}; }},
    'game.save': {access: 'admin', run: async (_c, data) => ({id: await editor.saveGame(data ?? {}), editor: await editorReply()})},
    'game.delete': {access: 'admin', run: async (_c, data) => { await editor.deleteGame(data?.id); return {editor: await editorReply()}; }},
    'game.activate': {access: 'admin', run: async (_c, data) => {
        await editor.activateGame(data?.id);
        await engine.restoreDeadline();
        return {editor: await editorReply()};
    }},
    'race.save': {access: 'admin', run: async (_c, data) => ({id: await editor.saveRace(data ?? {}), editor: await editorReply()})},
    'race.delete': {access: 'admin', run: async (_c, data) => { await editor.deleteRace(data?.id); return {editor: await editorReply()}; }},
    'race.reorder': {access: 'admin', run: async (_c, data) => { await editor.reorderRaces(data ?? {}); return {editor: await editorReply()}; }},
};

// ---------- Sending ----------

const sendTo = (conn: Connection, type: string, data?: unknown) => {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify({type, data}));
};

const send = (type: string, data?: unknown) => connections.forEach(conn => sendTo(conn, type, data));

let broadcastPending = false;

/** Coalesces the broadcasts of a burst of actions into one, sent after the queue drains */
export const scheduleBroadcast = () => {
    if (broadcastPending) return;
    broadcastPending = true;
    setTimeout(() => {
        broadcastPending = false;
        runExclusive(broadcastState).catch(err => console.error('Broadcast failed:', err));
    }, 30);
};

const connectedPlayerIds = () =>
    new Set([...connections.values()].map(c => c.playerId).filter((id): id is number => id !== null));

const broadcastState = async () => {
    const state = await buildPublicState(connectedPlayerIds());
    const game = await engine.getActiveGame();
    const raceId = state.race?.id ?? null;
    const admin = await buildAdminState(game, raceId);

    for (const conn of connections.values()) {
        await sendStateTo(conn, state, raceId, admin);
    }
};

const sendStateTo = async (conn: Connection, state: unknown, raceId: number | null, admin: unknown) => {
    let me = null;
    if (conn.playerId !== null) {
        const player = await Player.findByPk(conn.playerId);
        // Gone after a reset, a kick or a game switch: the phone goes back to the join screen
        if (!player || player.gameId !== (state as any).game.id) conn.playerId = null;
        else me = await buildPrivateState(player, raceId);
    }
    sendTo(conn, 'state', {...(state as object), me, admin: conn.admin ? admin : null});
};

const sendStateToOne = async (conn: Connection) => {
    const state = await buildPublicState(connectedPlayerIds());
    const game = await engine.getActiveGame();
    const raceId = state.race?.id ?? null;
    await sendStateTo(conn, state, raceId, await buildAdminState(game, raceId));
};

// ---------- Receiving ----------

const reply = (conn: Connection, reqId: number | undefined, payload: {ok: boolean, data?: unknown, error?: string}) => {
    if (reqId !== undefined) sendTo(conn, 'reply', {reqId, ...payload});
};

const dispatch = async (conn: Connection, raw: WebSocket.RawData) => {
    let message: Incoming;
    try {
        message = JSON.parse(raw.toString());
    } catch {
        return;
    }
    // Answered right away, outside the queue: a waking phone uses it to check its socket is alive
    if (message?.type === 'ping') return reply(conn, message.reqId, {ok: true});
    const handler = handlers[message?.type];
    if (!handler) return reply(conn, message?.reqId, {ok: false, error: 'Action inconnue'});

    try {
        const result = await runExclusive(async () => {
            if (message.type === 'admin.login') {
                if (!isPasscode(message.data?.passcode)) throw new GameError('Mauvais code');
                conn.admin = true;
            }
            if (handler.access === 'admin' && !conn.admin) throw new GameError('Réservé à l\'admin');
            let player: Player | null = null;
            if (handler.access === 'player') {
                player = conn.playerId !== null ? await Player.findByPk(conn.playerId) : null;
                if (!player) throw new GameError('Rejoins la partie d\'abord');
            }
            const data = await handler.run(conn, message.data, player);
            if (message.type === 'hello' || message.type === 'player.join' || message.type === 'admin.login') {
                await sendStateToOne(conn);
            }
            return data;
        });
        reply(conn, message.reqId, {ok: true, data: result});
        if (handler.broadcast !== false) scheduleBroadcast();
    } catch (err) {
        if (err instanceof GameError) return reply(conn, message.reqId, {ok: false, error: err.message});
        console.error(`Action ${message.type} failed:`, err);
        reply(conn, message.reqId, {ok: false, error: 'Erreur du serveur, réessaie'});
    }
};

export const initSocket = (server: Server) => {
    if (!process.env.ADMIN_PASSCODE) console.warn('ADMIN_PASSCODE is not set in .env, using the default "chalet"');
    const wss = new WebSocketServer({server, maxPayload: 5 * 1024 * 1024});

    wss.on('connection', ws => {
        const conn: Connection = {id: randomBytes(6).toString('hex'), ws, playerId: null, admin: false, alive: true};
        connections.set(conn.id, conn);

        ws.on('pong', () => { conn.alive = true; });
        ws.on('message', raw => { dispatch(conn, raw).catch(err => console.error('Dispatch failed:', err)); });
        ws.on('close', () => {
            connections.delete(conn.id);
            // Others see the player go grey
            if (conn.playerId !== null) scheduleBroadcast();
        });
        ws.on('error', err => console.error('Socket error:', err.message));
    });

    // Phones that vanished without closing (locked, out of Wi-Fi) are dropped after ~30 s
    const heartbeat = setInterval(() => {
        for (const conn of connections.values()) {
            if (!conn.alive) {
                conn.ws.terminate();
                continue;
            }
            conn.alive = false;
            conn.ws.ping();
        }
    }, 15_000);
    wss.on('close', () => clearInterval(heartbeat));

    engine.engineEvents.on('changed', scheduleBroadcast);
};

export const getConnectionCount = () => connections.size;
