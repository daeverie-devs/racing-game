import {Skin} from '../models';

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

/** Parimutuel payout: the whole pot (bets + pool seeds) is split among the winning bets */
export const computePayouts = (
    bets: {playerId: number, entryId: number | null, amount: number}[],
    seeds: number,
    winnerEntryId: number
) => {
    const pot = bets.reduce((sum, b) => sum + b.amount, 0) + seeds;
    const winningStake = bets.filter(b => b.entryId === winnerEntryId).reduce((sum, b) => sum + b.amount, 0);
    const payouts = new Map<number, number>();
    for (const bet of bets) {
        const won = winningStake > 0 && bet.entryId === winnerEntryId;
        payouts.set(bet.playerId, won ? Math.round(pot * bet.amount / winningStake * 100) / 100 : 0);
    }
    // Nobody backed the winner: the pot goes to the pool for the next race
    return {payouts, unclaimed: winningStake > 0 ? 0 : pot};
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
