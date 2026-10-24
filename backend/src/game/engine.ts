import {randomBytes} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {fn, col, Op} from 'sequelize';
import {Award, Bet, cents, Game, Message, Player, Race, RaceEntry, Skin} from '../models';
import {sequelize} from '../sequelize';
import {
    CHAT_COOLDOWN_MS, CHAT_MAX, computePayouts, GameError, LOAN_MAX, LOAN_THRESHOLD, MIN_ENTRIES,
    parseAmount, parseName, parseSkin, rankPlayers, splitPool
} from './rules';
import {runExclusive} from './queue';

/** Emits 'changed' when the state changed outside a client action (the countdown running out) */
export const engineEvents = new EventEmitter();

// ---------- Lookups ----------

export const getActiveGame = async () => {
    const game = await Game.findOne({where: {active: true}});
    if (game) return game;
    // Always have a game to join, even on an empty database
    const first = await Game.findOne({order: [['id', 'ASC']]});
    if (first) return first.update({active: true});
    return Game.create({name: 'Partie', active: true, lockDeadline: null, awards: null});
};

export const getRaces = (gameId: number) => Race.findAll({where: {gameId}, order: [['position', 'ASC'], ['id', 'ASC']]});

export const getCurrentRace = async (game: Game) => {
    if (game.raceIndex < 0) return null;
    return (await getRaces(game.id))[game.raceIndex] ?? null;
};

const getEntries = (raceId: number) => RaceEntry.findAll({where: {raceId}, order: [['position', 'ASC'], ['id', 'ASC']]});

const requireStatus = (game: Game, ...statuses: Game['status'][]) => {
    if (!statuses.includes(game.status)) throw new GameError('Pas possible pour le moment');
};

const requireRace = async (game: Game) => {
    const race = await getCurrentRace(game);
    if (!race) throw new GameError('Aucune course en cours');
    return race;
};

// ---------- Players ----------

export const joinPlayer = async (data: {token?: string, name: unknown, skin: unknown}) => {
    const name = parseName(data.name);
    const skin = parseSkin(data.skin);
    const game = await getActiveGame();

    if (data.token) {
        const existing = await Player.findOne({where: {token: String(data.token), gameId: game.id}});
        if (existing) return existing.update({name, skin});
    }
    return Player.create({
        gameId: game.id,
        token: randomBytes(24).toString('hex'),
        name,
        skin,
        balance: game.startingBalance,
        prevRank: null,
        lastDelta: null,
    });
};

/** The player saved on the phone, if they still belong to the active game (null after a reset) */
export const resumePlayer = async (token: unknown) => {
    if (!token) return null;
    const game = await getActiveGame();
    return Player.findOne({where: {token: String(token), gameId: game.id}});
};

export const takeLoan = async (player: Player, rawAmount: unknown) => {
    const game = await getActiveGame();
    requireStatus(game, 'lobby', 'lineup', 'betting', 'results');
    const amount = parseAmount(rawAmount);
    if (player.balance >= LOAN_THRESHOLD) throw new GameError(`Prêt possible sous ${LOAN_THRESHOLD}$ seulement`);
    if (amount < 1 || amount > LOAN_MAX) throw new GameError(`Entre 1$ et ${LOAN_MAX}$`);
    await player.update({balance: cents(player.balance + amount), loans: cents(player.loans + amount)});
};

// ---------- Chat ----------

const lastMessageAt = new Map<number, number>();

export const sendMessage = async (player: Player, rawText: unknown) => {
    const text = String(rawText ?? '').trim().slice(0, CHAT_MAX);
    if (!text) return null;
    const now = Date.now();
    if (now - (lastMessageAt.get(player.id) ?? 0) < CHAT_COOLDOWN_MS) throw new GameError('Doucement sur le clavier');
    lastMessageAt.set(player.id, now);
    return Message.create({gameId: player.gameId, playerId: player.id, text});
};

export const getChatHistory = async (gameId: number) =>
    (await Message.findAll({where: {gameId}, order: [['id', 'DESC']], limit: 100})).reverse();

// ---------- Betting ----------

const findBet = (raceId: number, playerId: number) => Bet.findOne({where: {raceId, playerId}});

const upsertBet = async (raceId: number, playerId: number, values: Partial<Pick<Bet, 'entryId' | 'amount' | 'locked'>>) => {
    const bet = await findBet(raceId, playerId);
    if (bet) return bet.update(values);
    return Bet.create({raceId, playerId, entryId: null, amount: 0, payout: null, ...values});
};

const validEntryId = async (raceId: number, raw: unknown) => {
    const entryId = Number(raw);
    if (!Number.isInteger(entryId)) return null;
    const entry = await RaceEntry.findOne({where: {id: entryId, raceId}});
    return entry?.id ?? null;
};

/** The phone's current pick, saved without a broadcast, so the countdown can lock it in */
export const draftBet = async (player: Player, data: {entryId?: unknown, amount?: unknown}) => {
    const game = await getActiveGame();
    if (game.status !== 'betting') return;
    const race = await requireRace(game);
    const bet = await findBet(race.id, player.id);
    if (bet?.locked) return;
    const entryId = await validEntryId(race.id, data.entryId);
    await upsertBet(race.id, player.id, {entryId, amount: Math.min(parseAmount(data.amount), player.balance)});
};

export const lockBet = async (player: Player, data: {entryId?: unknown, amount?: unknown}) => {
    const game = await getActiveGame();
    requireStatus(game, 'betting');
    const race = await requireRace(game);
    const entryId = await validEntryId(race.id, data.entryId);
    if (!entryId) throw new GameError('Choisis un coureur');
    const amount = parseAmount(data.amount);
    if (amount < 1) throw new GameError('Mise au moins 1$');
    if (amount > player.balance) throw new GameError('Pas assez d\'argent');
    await upsertBet(race.id, player.id, {entryId, amount, locked: true});
    await revealIfAllLocked(game, race);
};

export const passBet = async (player: Player) => {
    const game = await getActiveGame();
    requireStatus(game, 'betting');
    const race = await requireRace(game);
    await upsertBet(race.id, player.id, {entryId: null, amount: 0, locked: true});
    await revealIfAllLocked(game, race);
};

export const unlockBet = async (player: Player) => {
    const game = await getActiveGame();
    requireStatus(game, 'betting');
    const race = await requireRace(game);
    const bet = await findBet(race.id, player.id);
    if (bet) await bet.update({locked: false});
};

const revealIfAllLocked = async (game: Game, race: Race) => {
    const players = await Player.count({where: {gameId: game.id}});
    const locked = await Bet.count({where: {raceId: race.id, locked: true}});
    if (players > 0 && locked >= players) await reveal(game, race);
};

/** Locks every pick (no pick = pass), takes the bets from the balances and shows them */
const reveal = async (game: Game, race: Race) => {
    const players = await Player.findAll({where: {gameId: game.id}});
    const entryIds = new Set((await getEntries(race.id)).map(e => e.id));

    await sequelize.transaction(async transaction => {
        for (const player of players) {
            const bet = await findBet(race.id, player.id);
            let entryId = bet?.entryId ?? null;
            let amount = Math.min(bet?.amount ?? 0, Math.floor(player.balance));
            if (!entryId || !entryIds.has(entryId) || amount < 1) {
                entryId = null;
                amount = 0;
            }
            if (bet) await bet.update({entryId, amount, locked: true}, {transaction});
            else await Bet.create({raceId: race.id, playerId: player.id, entryId, amount, locked: true, payout: null}, {transaction});
            if (amount > 0) await player.update({balance: cents(player.balance - amount)}, {transaction});
        }
        await game.update({status: 'watching', lockDeadline: null}, {transaction});
    });
    clearDeadline();
};

// ---------- Countdown ----------

let deadlineTimer: NodeJS.Timeout | null = null;

const clearDeadline = () => {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    deadlineTimer = null;
};

const armDeadline = (game: Game) => {
    clearDeadline();
    if (!game.lockDeadline) return;
    const raceIndex = game.raceIndex;
    deadlineTimer = setTimeout(() => {
        runExclusive(async () => {
            const current = await getActiveGame();
            // Only if nothing moved on in the meantime
            if (current.status !== 'betting' || current.raceIndex !== raceIndex || !current.lockDeadline) return;
            await reveal(current, await requireRace(current));
            engineEvents.emit('changed');
        }).catch(err => console.error('Countdown failed:', err));
    }, Math.max(0, Number(game.lockDeadline) - Date.now()));
};

/** Called on startup, so a restart in the middle of a countdown still ends it */
export const restoreDeadline = async () => armDeadline(await getActiveGame());

export const startCountdown = async (rawSeconds?: unknown) => {
    const game = await getActiveGame();
    requireStatus(game, 'betting');
    const seconds = Math.min(Math.max(Math.floor(Number(rawSeconds) || game.countdownSeconds), 3), 300);
    await game.update({lockDeadline: Date.now() + seconds * 1000});
    armDeadline(game);
};

export const forceReveal = async () => {
    const game = await getActiveGame();
    requireStatus(game, 'betting');
    await reveal(game, await requireRace(game));
};

// ---------- Race flow ----------

const openBetting = async (game: Game, race: Race) => {
    const entries = await getEntries(race.id);
    if (entries.length < MIN_ENTRIES) throw new GameError(`Il faut au moins ${MIN_ENTRIES} coureurs`);
    const seeds = splitPool(game.pool, entries.length);
    await sequelize.transaction(async transaction => {
        for (const [i, entry] of entries.entries()) await entry.update({seed: seeds[i]}, {transaction});
        await game.update({status: 'betting', pool: 0, lockDeadline: null}, {transaction});
    });
};

/** Starts the game from the lobby, or moves from a race's results to the next race (or the awards) */
export const nextRace = async () => {
    const game = await getActiveGame();
    requireStatus(game, 'lobby', 'results');
    const races = await getRaces(game.id);
    if (game.status === 'lobby' && races.length === 0) throw new GameError('Cette partie n\'a aucune course');

    const index = game.raceIndex + 1;
    const race = races[index];
    if (!race) {
        const awards = await computeAwards(game);
        await game.update({status: awards.length ? 'awards' : 'podium', awards, awardStep: 0, podiumStep: 0});
        return;
    }
    await game.update({raceIndex: index});
    if (race.type === 'players') await game.update({status: 'lineup'});
    else await openBetting(game, race);
};

/** Player races: the admin picks who runs from the lobby, then opens the bets */
export const setLineupAndOpen = async (rawPlayerIds: unknown) => {
    const game = await getActiveGame();
    requireStatus(game, 'lineup');
    const race = await requireRace(game);
    const ids = Array.isArray(rawPlayerIds) ? [...new Set(rawPlayerIds.map(Number))] : [];
    const players = await Player.findAll({where: {gameId: game.id, id: {[Op.in]: ids}}});
    if (players.length < MIN_ENTRIES) throw new GameError(`Choisis au moins ${MIN_ENTRIES} joueurs`);

    await RaceEntry.destroy({where: {raceId: race.id}});
    const ordered = ids.filter(id => players.some(p => p.id === id));
    await RaceEntry.bulkCreate(ordered.map((playerId, position) => ({raceId: race.id, playerId, racerId: null, position})));
    await openBetting(game, race);
};

export const declareWinner = async (rawEntryId: unknown) => {
    const game = await getActiveGame();
    requireStatus(game, 'watching');
    const race = await requireRace(game);
    const entries = await getEntries(race.id);
    const winner = entries.find(e => e.id === Number(rawEntryId));
    if (!winner) throw new GameError('Choisis le gagnant');

    const players = await Player.findAll({where: {gameId: game.id}});
    const bets = await Bet.findAll({where: {raceId: race.id}});
    const ranksBefore = rankPlayers(players);
    const seeds = entries.reduce((sum, e) => sum + e.seed, 0);
    const {payouts, unclaimed} = computePayouts(bets, seeds, winner.id);

    await sequelize.transaction(async transaction => {
        for (const player of players) {
            const bet = bets.find(b => b.playerId === player.id);
            const payout = payouts.get(player.id) ?? 0;
            if (bet) await bet.update({payout}, {transaction});
            await player.update({
                balance: cents(player.balance + payout),
                prevRank: ranksBefore.get(player.id) ?? null,
                lastDelta: cents(payout - (bet?.amount ?? 0)),
            }, {transaction});
        }
        await race.update({winnerEntryId: winner.id}, {transaction});
        await game.update({status: 'results', pool: cents(game.pool + unclaimed)}, {transaction});
    });
};

export const nextAward = async () => {
    const game = await getActiveGame();
    requireStatus(game, 'awards');
    const count = game.awards?.length ?? 0;
    if (game.awardStep + 1 < count) await game.update({awardStep: game.awardStep + 1});
    else await game.update({status: 'podium', podiumStep: 0});
};

export const nextPodiumStep = async () => {
    const game = await getActiveGame();
    requireStatus(game, 'podium');
    if (game.podiumStep < 3) await game.update({podiumStep: game.podiumStep + 1});
};

// ---------- Awards ----------

const AWARD_DEFS: {key: string, title: string, description: string}[] = [
    {key: 'biggestBet', title: 'Le gros joueur', description: 'La plus grosse mise de la soirée'},
    {key: 'bestShot', title: 'Le coup de génie', description: 'Le plus gros gain sur une seule mise'},
    {key: 'chatterbox', title: 'Le moulin à paroles', description: 'Le plus de messages dans le chat'},
    {key: 'athlete', title: 'L\'athlète', description: 'Le plus de courses courues'},
    {key: 'debtor', title: 'Le banquier préféré', description: 'Le plus gros prêt'},
    {key: 'cheapskate', title: 'Le gratteux', description: 'La plus petite mise (pas zéro)'},
];

/** Finds each award's winners (ties all win) and pays their bonus, once */
const computeAwards = async (game: Game): Promise<Award[]> => {
    const raceIds = (await getRaces(game.id)).map(r => r.id);
    const players = await Player.findAll({where: {gameId: game.id}});
    const bets = raceIds.length ? await Bet.findAll({where: {raceId: {[Op.in]: raceIds}, amount: {[Op.gt]: 0}}}) : [];
    const messageCounts = await Message.findAll({
        where: {gameId: game.id},
        attributes: ['playerId', [fn('COUNT', col('id')), 'count']],
        group: ['playerId'],
        raw: true,
    }) as unknown as {playerId: number, count: number}[];
    const runs = raceIds.length ? await RaceEntry.findAll({where: {raceId: {[Op.in]: raceIds}, playerId: {[Op.ne]: null}}}) : [];

    // Each award: one value per player (undefined = not eligible), best = highest unless noted
    const perPlayer = (pick: (playerId: number) => number | undefined) =>
        new Map(players.map(p => [p.id, pick(p.id)] as const));
    const betsOf = (playerId: number) => bets.filter(b => b.playerId === playerId);
    const maxOf = (values: number[]) => values.length ? Math.max(...values) : undefined;
    const values: Record<string, {byPlayer: Map<number, number | undefined>, lowest?: boolean}> = {
        biggestBet: {byPlayer: perPlayer(id => maxOf(betsOf(id).map(b => b.amount)))},
        bestShot: {byPlayer: perPlayer(id => maxOf(betsOf(id).map(b => (b.payout ?? 0) - b.amount).filter(v => v > 0)))},
        chatterbox: {byPlayer: perPlayer(id => Number(messageCounts.find(m => m.playerId === id)?.count) || undefined)},
        athlete: {byPlayer: perPlayer(id => runs.filter(r => r.playerId === id).length || undefined)},
        debtor: {byPlayer: perPlayer(id => players.find(p => p.id === id)!.loans || undefined)},
        cheapskate: {byPlayer: perPlayer(id => {
            const amounts = betsOf(id).map(b => b.amount);
            return amounts.length ? Math.min(...amounts) : undefined;
        }), lowest: true},
    };

    const awards: Award[] = [];
    for (const def of AWARD_DEFS) {
        const {byPlayer, lowest} = values[def.key];
        const eligible = [...byPlayer.entries()].filter((e): e is [number, number] => e[1] !== undefined);
        if (!eligible.length) continue;
        const best = lowest ? Math.min(...eligible.map(e => e[1])) : Math.max(...eligible.map(e => e[1]));
        awards.push({...def, value: cents(best), playerIds: eligible.filter(e => e[1] === best).map(e => e[0])});
    }

    await sequelize.transaction(async transaction => {
        for (const award of awards) {
            for (const playerId of award.playerIds) {
                const player = players.find(p => p.id === playerId)!;
                player.bonus = cents(player.bonus + game.awardBonus);
            }
        }
        for (const player of players) if (player.changed('bonus')) await player.save({transaction});
    });
    return awards;
};

// ---------- Admin ----------

/** Back to the lobby: players, bets, chat and results of the active game are wiped, races kept */
export const resetGame = async (gameId?: number) => {
    const game = gameId ? await Game.findByPk(gameId) : await getActiveGame();
    if (!game) throw new GameError('Partie introuvable');
    const races = await getRaces(game.id);
    const raceIds = races.map(r => r.id);

    await sequelize.transaction(async transaction => {
        await Player.destroy({where: {gameId: game.id}, transaction});
        await Message.destroy({where: {gameId: game.id}, transaction});
        if (raceIds.length) {
            await Bet.destroy({where: {raceId: {[Op.in]: raceIds}}, transaction});
            const playerRaceIds = races.filter(r => r.type === 'players').map(r => r.id);
            if (playerRaceIds.length) await RaceEntry.destroy({where: {raceId: {[Op.in]: playerRaceIds}}, transaction});
            await RaceEntry.update({seed: 0}, {where: {raceId: {[Op.in]: raceIds}}, transaction});
            await Race.update({winnerEntryId: null}, {where: {gameId: game.id}, transaction});
        }
        await game.update({
            status: 'lobby', raceIndex: -1, lockDeadline: null, pool: 0, awards: null, awardStep: 0, podiumStep: 0
        }, {transaction});
    });
    if (game.active) clearDeadline();
};

export const kickPlayer = async (rawPlayerId: unknown) => {
    const game = await getActiveGame();
    const player = await Player.findOne({where: {id: Number(rawPlayerId), gameId: game.id}});
    if (!player) return;
    await player.destroy();
    // A kicked player may have been the last one everyone was waiting for
    if (game.status === 'betting') await revealIfAllLocked(game, await requireRace(game));
};

export type {Skin};
