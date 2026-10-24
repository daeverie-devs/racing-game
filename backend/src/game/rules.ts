import {Award, Skin} from '../models';

// Must match frontend/src/app/avatar/skin.ts
export const SKIN_OPTIONS = {shape: 6, modifier: 6, eyes: 6, main: 12, secondary: 12} as const;

export const NAME_MAX = 24;
export const CHAT_MAX = 280;
export const CHAT_COOLDOWN_MS = 700;
export const LOAN_THRESHOLD = 100;
export const LOAN_MAX = 1000;
export const MIN_ENTRIES = 2;

/** A message shown to the player as is (French), unlike internal errors */
export class GameError extends Error {}

export const parseSkin = (raw: any): Skin => {
    const skin = {} as Skin;
    for (const [key, count] of Object.entries(SKIN_OPTIONS)) {
        const value = Number(raw?.[key]);
        if (!Number.isInteger(value) || value < 0 || value >= count) throw new GameError('Personnage invalide');
        skin[key as keyof Skin] = value;
    }
    return skin;
};

export const parseName = (raw: any): string => {
    const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (!name) throw new GameError('Choisis un nom');
    if (name.length > NAME_MAX) throw new GameError(`${NAME_MAX} caractères maximum`);
    return name;
};

export const parseAmount = (raw: any): number => {
    const amount = Math.floor(Number(raw));
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

/** Standard competition ranking (1, 2, 2, 4) on score = balance + bonus - loans */
export const score = (p: {balance: number, bonus: number, loans: number}) => p.balance + p.bonus - p.loans;

export const rankPlayers = <T extends {id: number, balance: number, bonus: number, loans: number}>(players: T[]) => {
    const sorted = [...players].sort((a, b) => score(b) - score(a) || a.id - b.id);
    const ranks = new Map<number, number>();
    sorted.forEach((p, i) => {
        const previous = sorted[i - 1];
        ranks.set(p.id, previous && score(previous) === score(p) ? ranks.get(previous.id)! : i + 1);
    });
    return ranks;
};

// ---------- Betting rules, modelled on racetrack pari-mutuel betting ----------

/** A bet is at least this share of the balance (rounded up, 1 $ minimum) */
export const MIN_BET_SHARE = 0.05;
/** A winning bet returns at most this many times its stake; the rest feeds the pool */
export const PAYOUT_CAP = 10;
/** Like a track's $2.10 on a $2 ticket: a winning bet always returns at least 105 % */
export const MIN_RETURN = 1.05;
/** The house's morning-line stake per player in the game, spread over the race's entries */
export const HOUSE_STAKE_PER_PLAYER = 150;
/** Morning-line limits, as on a track: no favourite under 8-5, no longshot over 30-1 (total return) */
export const MIN_START_ODDS = 2.6;
export const MAX_START_ODDS = 31;
/** Morning line: a random draw of ±40 % around each entry's record */
export const MORNING_LINE_NOISE = 0.4;
export const MORNING_LINE_RECORD_WEIGHT = 1;
/** The last race pays double */
export const FINAL_RACE_MULTIPLIER = 2;

export const minBet = (balance: number) => Math.max(1, Math.ceil(Math.floor(balance) * MIN_BET_SHARE));

/**
 * The morning line: each entry's chance of winning, from a random draw shifted by its record
 * (wins and runs in earlier races), kept inside the morning-line limits. Shares sum to 1.
 */
export const morningLine = (
    records: {wins: number, runs: number}[],
    random = Math.random,
    /** noise: how far the random draw moves an entry (±); recordWeight: how much the record counts */
    {noise = MORNING_LINE_NOISE, recordWeight = MORNING_LINE_RECORD_WEIGHT} = {},
) => {
    const n = records.length;
    const raw = records.map(r => (1 - noise + random() * 2 * noise) * Math.pow((r.wins + 1) / (r.runs + n), recordWeight));
    let shares = raw.map(v => v / raw.reduce((a, b) => a + b, 0));
    // Clamp to the limits, then share what's left over among the others (a few passes settle it)
    const low = 1 / MAX_START_ODDS, high = 1 / MIN_START_ODDS;
    for (let pass = 0; pass < 5; pass++) {
        const clamped = shares.map(s => Math.min(high, Math.max(low, s)));
        const fixed = clamped.map((s, i) => s !== shares[i]);
        const free = clamped.reduce((sum, s, i) => fixed[i] ? sum : sum + s, 0);
        const room = 1 - clamped.reduce((sum, s, i) => fixed[i] ? sum + s : sum, 0);
        shares = clamped.map((s, i) => fixed[i] || free === 0 ? s : s * room / free);
    }
    const total = shares.reduce((a, b) => a + b, 0);
    return shares.map(s => s / total);
};

export interface SettleInput {
    bets: {playerId: number, entryId: number | null, amount: number}[];
    /** House money (morning line) and pool money sitting on each entry: a stake like any bet */
    entries: {id: number, house: number, seed: number}[];
    winnerEntryId: number;
    multiplier?: number;
}

/**
 * Pari-mutuel settlement: the whole pot is shared among the stakes on the winner, players and
 * house alike. Each winning player gets at least MIN_RETURN and at most PAYOUT_CAP times their
 * stake (then the race multiplier); the house's share and anything over the cap go to the pool.
 * `houseTopUp` is money the house adds to honour the minimum return (a "minus pool").
 */
export const settleRace = ({bets, entries, winnerEntryId, multiplier = 1}: SettleInput) => {
    const playerPot = bets.reduce((sum, b) => sum + b.amount, 0);
    const housePot = entries.reduce((sum, e) => sum + e.house + e.seed, 0);
    const pot = playerPot + housePot;
    const winner = entries.find(e => e.id === winnerEntryId);
    const houseOnWinner = winner ? winner.house + winner.seed : 0;
    const winningStake = bets.filter(b => b.entryId === winnerEntryId).reduce((sum, b) => sum + b.amount, 0) + houseOnWinner;

    const payouts = new Map<number, number>();
    let paid = 0, houseTopUp = 0;
    for (const bet of bets) {
        if (bet.entryId !== winnerEntryId || bet.amount <= 0 || winningStake <= 0) {
            payouts.set(bet.playerId, 0);
            continue;
        }
        const share = pot * bet.amount / winningStake;
        const capped = Math.min(Math.max(share, bet.amount * MIN_RETURN), bet.amount * PAYOUT_CAP);
        if (share < capped) houseTopUp += capped - share;
        const payout = Math.floor(capped * multiplier * 100) / 100;
        payouts.set(bet.playerId, payout);
        paid += Math.min(share, capped);
    }
    // Everything not paid to players (house share, over the cap, nobody on the winner) feeds the pool
    const toPool = Math.round(Math.max(0, pot - paid) * 100) / 100;
    return {payouts, toPool, houseTopUp, pot};
};

/** Odds an entry would pay per 1 $ staked, from what sits on it (players + house + pool) */
export const oddsOf = (pot: number, stake: number) => stake > 0 ? pot / stake : null;

export const AWARD_DEFS: {key: string, title: string, description: string}[] = [
    {key: 'biggestBet', title: 'Le gros joueur', description: 'La plus grosse mise de la soirée'},
    {key: 'bestShot', title: 'Le coup de génie', description: 'Le plus gros gain sur une seule mise'},
    {key: 'chatterbox', title: 'Le moulin à paroles', description: 'Le plus de messages dans le chat'},
    {key: 'athlete', title: 'L\'athlète', description: 'Le plus de courses courues'},
    {key: 'debtor', title: 'Le banquier préféré', description: 'Le plus gros prêt (et il paie)'},
    {key: 'cheapskate', title: 'Le gratteux', description: 'La plus petite mise (pas zéro)'},
];

/**
 * Finds each award's winners from the game's history (ties all win). Pure, so the server and the
 * balance simulation (scripts/balance.ts) share it.
 */
export const pickAwards = (input: {
    players: {id: number, loans: number}[];
    /** Bets with an amount above 0 */
    bets: {playerId: number, amount: number, payout: number | null}[];
    messageCounts: {playerId: number, count: number}[];
    /** One player id per player-race run */
    runs: number[];
}): Award[] => {
    const {players, bets, messageCounts, runs} = input;
    const perPlayer = (pick: (playerId: number) => number | undefined) =>
        new Map(players.map(p => [p.id, pick(p.id)] as const));
    const betsOf = (playerId: number) => bets.filter(b => b.playerId === playerId);
    const maxOf = (values: number[]) => values.length ? Math.max(...values) : undefined;
    // One value per player (undefined = not eligible); the best is the highest unless noted
    const values: Record<string, {byPlayer: Map<number, number | undefined>, lowest?: boolean}> = {
        biggestBet: {byPlayer: perPlayer(id => maxOf(betsOf(id).map(b => b.amount)))},
        bestShot: {byPlayer: perPlayer(id => maxOf(betsOf(id).map(b => (b.payout ?? 0) - b.amount).filter(v => v > 0)))},
        chatterbox: {byPlayer: perPlayer(id => messageCounts.find(m => m.playerId === id)?.count || undefined)},
        athlete: {byPlayer: perPlayer(id => runs.filter(r => r === id).length || undefined)},
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
        awards.push({...def, value: Math.round(best * 100) / 100, playerIds: eligible.filter(e => e[1] === best).map(e => e[0])});
    }
    return awards;
};

/** Splits the pool at random over the entries, so the next race's odds get shaken up */
export const splitPool = (pool: number, count: number, random = Math.random) => {
    if (count <= 0 || pool <= 0) return Array(count).fill(0);
    const weights = Array.from({length: count}, () => random() + 0.05);
    const total = weights.reduce((a, b) => a + b, 0);
    const shares = weights.map(w => Math.floor(pool * w / total * 100) / 100);
    // Rounding leftovers go to the last entry so nothing is lost
    shares[count - 1] = Math.round((pool - shares.slice(0, -1).reduce((a, b) => a + b, 0)) * 100) / 100;
    return shares;
};
