import {randomBytes} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {fn, col, Op} from 'sequelize';
import {Award, Bet, cents, Game, Message, Player, Race, RaceEntry, Racer, Skin} from '../models';
import {sequelize} from '../sequelize';
import {
    CHAT_COOLDOWN_MS, CHAT_MAX, FINAL_RACE_MULTIPLIER, GameError, HOUSE_STAKE_PER_PLAYER, LOAN_MAX, LOAN_THRESHOLD,
    MIN_ENTRIES, minBet, morningLine, parseAmount, parseName, parseSkin, pickAwards, rankPlayers, settleRace, splitPool
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
    return amount;
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
    if (amount > player.balance) throw new GameError('Pas assez d\'argent');
    if (amount < minBet(player.balance)) throw new GameError(`Mise minimum ${minBet(player.balance)} $`);
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
            // A pick left under the minimum is raised to it, as long as the balance allows
            const wanted = entryId ? Math.max(bet?.amount ?? 0, minBet(player.balance)) : 0;
            let amount = Math.min(wanted, Math.floor(player.balance));
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

/**
 * Past wins and runs of each entry, as in a race program: racers across every game plus the history
 * entered in the editor, players in this game's player races
 */
export const recordsOf = async (game: Game, entries: RaceEntry[]) => {
    const done = await Race.findAll({where: {winnerEntryId: {[Op.ne]: null}}, attributes: ['id', 'gameId', 'winnerEntryId']});
    const doneIds = done.map(r => r.id);
    const past = doneIds.length ? await RaceEntry.findAll({where: {raceId: {[Op.in]: doneIds}}}) : [];
    const winners = new Set(done.map(r => r.winnerEntryId));
    const sameGame = new Set(done.filter(r => r.gameId === game.id).map(r => r.id));
    const racerIds = entries.map(e => e.racerId).filter((id): id is number => id !== null);
    const history = racerIds.length ? await Racer.findAll({where: {id: {[Op.in]: racerIds}}, attributes: ['id', 'pastWins', 'pastRuns']}) : [];
    return entries.map(entry => {
        const manual = history.find(h => h.id === entry.racerId);
        const runs = past.filter(p => entry.racerId !== null
            ? p.racerId === entry.racerId
            : p.playerId === entry.playerId && sameGame.has(p.raceId));
        return {
            runs: runs.length + (manual?.pastRuns ?? 0),
            wins: runs.filter(p => winners.has(p.id)).length + (manual?.pastWins ?? 0),
        };
    });
};

/**
 * Opens the bets with a morning line, as at a racetrack: the house stakes money on each entry
 * from a random draw shifted by its record, so every racer starts with odds. The pool left by
 * earlier races is spread over the entries the same way, as a stake on its racer.
 */
const openBetting = async (game: Game, race: Race) => {
    const entries = await getEntries(race.id);
    if (entries.length < MIN_ENTRIES) throw new GameError(`Il faut au moins ${MIN_ENTRIES} coureurs`);
    const playerCount = await Player.count({where: {gameId: game.id}});
    const shares = morningLine(await recordsOf(game, entries));
    const houseTotal = HOUSE_STAKE_PER_PLAYER * Math.max(playerCount, 1);
    const seeds = splitPool(game.pool, entries.length);
    await sequelize.transaction(async transaction => {
        for (const [i, entry] of entries.entries()) {
            await entry.update({seed: seeds[i], house: cents(houseTotal * shares[i])}, {transaction});
        }
        await game.update({
            status: 'betting', pool: 0, lockDeadline: null,
            houseMoney: cents(game.houseMoney + entries.reduce((sum, e) => sum + e.house, 0)),
        }, {transaction});
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
    const isFinal = game.raceIndex === (await getRaces(game.id)).length - 1;
    const {payouts, toPool, pot} = settleRace({
        bets,
        entries,
        winnerEntryId: winner.id,
        multiplier: isFinal ? FINAL_RACE_MULTIPLIER : 1,
    });
    // Whatever the settlement pays beyond the pot comes from the house
    const created = [...payouts.values()].reduce((a, b) => a + b, 0) + toPool - pot;

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
        await game.update({
            status: 'results',
            pool: cents(game.pool + toPool),
            houseMoney: cents(game.houseMoney + created),
        }, {transaction});
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

    const awards = pickAwards({
        players,
        bets,
        messageCounts: messageCounts.map(m => ({playerId: m.playerId, count: Number(m.count)})),
        runs: runs.map(r => r.playerId!),
    });

    await sequelize.transaction(async transaction => {
        for (const award of awards) {
            // The biggest borrower pays half a bonus instead of winning one
            award.bonus = award.key === 'debtor' ? -cents(game.awardBonus / 2) : game.awardBonus;
            for (const playerId of award.playerIds) {
                const player = players.find(p => p.id === playerId)!;
                player.bonus = cents(player.bonus + award.bonus);
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
            await RaceEntry.update({seed: 0, house: 0}, {where: {raceId: {[Op.in]: raceIds}}, transaction});
            await Race.update({winnerEntryId: null}, {where: {gameId: game.id}, transaction});
        }
        await game.update({
            status: 'lobby', raceIndex: -1, lockDeadline: null, pool: 0, awards: null, awardStep: 0, podiumStep: 0, houseMoney: 0
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
