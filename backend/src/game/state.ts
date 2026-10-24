import {Op} from 'sequelize';
import {Bet, Game, Message, Player, Race, RaceEntry, Racer} from '../models';
import {racerImageUrl} from './editor';
import {getActiveGame, getRaces, recordsOf} from './engine';
import {
    FINAL_RACE_MULTIPLIER, LOAN_MAX, LOAN_THRESHOLD, MIN_BET_SHARE, MIN_RETURN, minBet, oddsOf, PAYOUT_CAP, rankPlayers, score
} from './rules';

/** What every screen receives. Bet amounts stay hidden until everyone is locked in */
export const buildPublicState = async (connectedPlayerIds: Set<number>) => {
    const game = await getActiveGame();
    const races = await getRaces(game.id);
    const race = game.raceIndex >= 0 ? races[game.raceIndex] ?? null : null;
    const players = await Player.findAll({where: {gameId: game.id}, order: [['id', 'ASC']]});
    const ranks = rankPlayers(players);
    const bets = race ? await Bet.findAll({where: {raceId: race.id}}) : [];
    const revealed = ['watching', 'results'].includes(game.status);

    return {
        serverNow: Date.now(),
        game: {
            id: game.id,
            name: game.name,
            status: game.status,
            raceIndex: game.raceIndex,
            raceCount: races.length,
            lockDeadline: game.lockDeadline ? Number(game.lockDeadline) : null,
            pool: game.pool,
            // Money the house put in so far, so totals can be audited
            houseMoney: game.houseMoney,
            countdownSeconds: game.countdownSeconds,
            awardBonus: game.awardBonus,
            awardStep: game.awardStep,
            podiumStep: game.podiumStep,
            // Awards are revealed one at a time
            awards: game.status === 'podium' ? game.awards ?? [] : (game.awards ?? []).slice(0, game.awardStep + 1),
            awardCount: game.awards?.length ?? 0,
            loanThreshold: LOAN_THRESHOLD,
            loanMax: LOAN_MAX,
            minBetShare: MIN_BET_SHARE,
            payoutCap: PAYOUT_CAP,
            minReturn: MIN_RETURN,
            // The last race pays double
            isFinalRace: race !== null && game.raceIndex === races.length - 1,
            finalMultiplier: FINAL_RACE_MULTIPLIER,
        },
        players: players.map(p => {
            const bet = bets.find(b => b.playerId === p.id);
            return {
                id: p.id,
                name: p.name,
                skin: p.skin,
                balance: p.balance,
                loans: p.loans,
                bonus: p.bonus,
                score: score(p),
                rank: ranks.get(p.id)!,
                prevRank: p.prevRank,
                lastDelta: p.lastDelta,
                locked: !!bet?.locked,
                passed: revealed && !!bet && !bet.entryId,
                connected: connectedPlayerIds.has(p.id),
            };
        }),
        race: race ? await buildRace(game, race, bets, players, revealed, game.status === 'results') : null,
    };
};

/** Each entry with its record (a finished race counts in it once its winner is declared) */
const withRecords = async (game: Game, entries: RaceEntry[]) => {
    const records = await recordsOf(game, entries);
    return entries.map((entry, i) => ({entry, record: records[i]}));
};

const buildRace = async (game: Game, race: Race, bets: Bet[], players: Player[], revealed: boolean, finished: boolean) => {
    const entries = await RaceEntry.findAll({where: {raceId: race.id}, order: [['position', 'ASC'], ['id', 'ASC']]});
    const racerIds = entries.map(e => e.racerId).filter((id): id is number => id !== null);
    const racers = racerIds.length
        ? await Racer.findAll({where: {id: {[Op.in]: racerIds}}, attributes: ['id', 'name', 'imageType', 'imageVersion']})
        : [];
    // As on a tote board: odds = the whole pot over what sits on the entry (players, house, pool)
    const house = entries.reduce((sum, e) => sum + e.house + e.seed, 0);
    const pot = bets.reduce((sum, b) => sum + b.amount, 0) + house;

    return {
        id: race.id,
        name: race.name,
        type: race.type,
        link: race.link,
        pot: revealed ? pot : null,
        winnerEntryId: finished ? race.winnerEntryId : null,
        entries: (await withRecords(game, entries)).map(({entry: e, record}) => {
            const racer = racers.find(r => r.id === e.racerId);
            const player = players.find(p => p.id === e.playerId);
            const entryBets = bets.filter(b => b.entryId === e.id && b.amount > 0);
            const total = entryBets.reduce((sum, b) => sum + b.amount, 0);
            return {
                id: e.id,
                name: racer?.name ?? player?.name ?? '?',
                imageUrl: racer ? racerImageUrl(racer) : null,
                playerId: e.playerId,
                skin: player?.skin ?? null,
                seed: e.seed,
                // The morning line, shown from the start: the house's and the pool's money only
                startOdds: oddsOf(house, e.house + e.seed),
                // The race program's past performances: wins and races so far
                record,
                total: revealed ? total : null,
                odds: revealed ? oddsOf(pot, total + e.house + e.seed) : null,
                bettors: revealed
                    ? entryBets.map(b => ({playerId: b.playerId, amount: b.amount, payout: finished ? b.payout : null}))
                    : [],
            };
        }),
    };
};

/** The player's own part: their bet (even before the reveal) */
export const buildPrivateState = async (player: Player, raceId: number | null) => {
    const bet = raceId ? await Bet.findOne({where: {raceId, playerId: player.id}}) : null;
    return {
        playerId: player.id,
        minBet: minBet(player.balance),
        bet: bet ? {entryId: bet.entryId, amount: bet.amount, locked: bet.locked, payout: bet.payout} : null,
    };
};

/** Admin extras: the preset winner of a racer race */
export const buildAdminState = async (game: Game, raceId: number | null) => {
    const race = raceId ? await Race.findByPk(raceId) : null;
    let presetWinnerEntryId: number | null = null;
    if (race?.presetWinnerRacerId) {
        const entry = await RaceEntry.findOne({where: {raceId: race.id, racerId: race.presetWinnerRacerId}});
        presetWinnerEntryId = entry?.id ?? null;
    }
    return {presetWinnerEntryId, gameId: game.id};
};

export const messageDto = (message: Message, player: Pick<Player, 'id' | 'name' | 'skin'> | undefined) => ({
    id: message.id,
    playerId: message.playerId,
    name: player?.name ?? '?',
    skin: player?.skin ?? null,
    text: message.text,
    time: message.createdAt.toISOString(),
});
