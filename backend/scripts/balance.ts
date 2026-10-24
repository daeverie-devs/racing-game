// Balance simulation: thousands of games of 8 to 12 players with the game's real betting rules
// (settleRace, morningLine, pickAwards from src/game/rules.ts), to see what decides who wins.
// No server needed. Usage: npm run balance -- [games per lobby size] > results.json
import {
    FINAL_RACE_MULTIPLIER, HOUSE_STAKE_PER_PLAYER, LOAN_MAX, LOAN_THRESHOLD, MIN_BET_SHARE, MIN_RETURN,
    MORNING_LINE_NOISE, MORNING_LINE_RECORD_WEIGHT, morningLine, PAYOUT_CAP, pickAwards, settleRace, splitPool
} from '../src/game/rules';

type Style = 'prudent' | 'moyen' | 'flambeur' | 'passif' | 'suiveur' | 'favori';
const STYLES: Style[] = ['prudent', 'moyen', 'flambeur', 'passif', 'suiveur', 'favori'];

interface Variant {
    key: string;
    label: string;
    houseStake: number;
    payoutCap: number;
    minReturn: number;
    finalMultiplier: number;
    /** Racetrack takeout: a share of each pot kept back, here carried into the next race's pool */
    takeout: number;
    awardBonus: number;
    /** Morning-line knobs (see morningLine in rules.ts) */
    lineNoise: number;
    lineRecordWeight: number;
    /** Everyone reads the program instead of the usual mix of styles */
    allReaders: boolean;
}

const RULES: Variant = {
    key: 'regles', label: 'Nouvelles règles', houseStake: HOUSE_STAKE_PER_PLAYER, payoutCap: PAYOUT_CAP,
    minReturn: MIN_RETURN, finalMultiplier: FINAL_RACE_MULTIPLIER, takeout: 0, awardBonus: 500,
    lineNoise: MORNING_LINE_NOISE, lineRecordWeight: MORNING_LINE_RECORD_WEIGHT, allReaders: false,
};
const VARIANTS: Variant[] = [
    RULES,
    {...RULES, key: 'maison75', label: 'Mise de la maison 75 $', houseStake: 75},
    {...RULES, key: 'maison300', label: 'Mise de la maison 300 $', houseStake: 300},
    {...RULES, key: 'plafond6', label: 'Gain max 6×', payoutCap: 6},
    {...RULES, key: 'plafond15', label: 'Gain max 15×', payoutCap: 15},
    {...RULES, key: 'sansfinale', label: 'Sans finale doublée', finalMultiplier: 1},
    {...RULES, key: 'finale3', label: 'Finale triplée', finalMultiplier: 3},
    {...RULES, key: 'sansmin', label: 'Sans retour minimum 105 %', minReturn: 0},
    {...RULES, key: 'prise10', label: 'Prise de 10 % reportée', takeout: 0.1},
    {...RULES, key: 'tous', label: 'Tout le monde lit le programme', allReaders: true},
    {...RULES, key: 'ligne2', label: 'Ligne du matin plus juste (record ×2, hasard ±20 %)', lineNoise: 0.2, lineRecordWeight: 2},
    {...RULES, key: 'ligne3', label: 'Ligne du matin juste (record ×3, hasard ±10 %)', lineNoise: 0.1, lineRecordWeight: 3},
];

const START = 5000;
const RACES = 10;              // 8 racer races of 4, 2 player races of 4
const LIBRARY = 16;            // racers reused across races, like the real marbles

let seed = 42;
const random = () => {
    // Deterministic, so results are reproducible
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
};
const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
const shuffle = <T>(list: T[]) => list.map(v => [random(), v] as const).sort((a, b) => a[0] - b[0]).map(e => e[1]);
const between = (a: number, b: number) => a + random() * (b - a);

interface SimPlayer {
    id: number;
    style: Style;
    balance: number;
    loans: number;
    bonus: number;
    messages: number;
    rankHistory: number[];
}

const scoreOf = (p: SimPlayer) => p.balance + p.bonus - p.loans;
const ranks = (players: SimPlayer[], useBonus = true) => {
    const s = (p: SimPlayer) => p.balance - p.loans + (useBonus ? p.bonus : 0);
    const sorted = [...players].sort((a, b) => s(b) - s(a) || a.id - b.id);
    return new Map(sorted.map((p, i) => [p.id, i + 1]));
};

/** Share of the balance a player bets this race (0 = pass), from their style */
const betShare = (p: SimPlayer) => {
    switch (p.style) {
        case 'prudent': return between(0.05, 0.1);
        case 'moyen': return between(0.15, 0.3);
        case 'flambeur': return random() < 0.35 ? 1 : between(0.4, 0.8);
        case 'passif': return random() < 0.4 ? 0 : 0.1;
        case 'suiveur': return 0.2;
        case 'favori': return 0.2;
    }
};

const playGame = (n: number, v: Variant) => {
    const players: SimPlayer[] = shuffle(Array.from({length: n}, (_, i) => STYLES[i % STYLES.length]))
        .map((style, id) => ({id, style, balance: START, loans: 0, bonus: 0, messages: Math.floor(random() * random() * 25), rankHistory: []}));
    // Hidden racer strength: marbles aren't equal, and their record shows it over time
    const strength = Array.from({length: LIBRARY}, () => Math.exp((random() - 0.5) * 1.6));
    const racerRecord = Array.from({length: LIBRARY}, () => ({runs: 0, wins: 0}));
    const playerRecord = players.map(() => ({runs: 0, wins: 0}));
    let pool = 0, houseMoney = 0, leadChanges = 0, leader = -1;
    const allBets: {playerId: number, amount: number, payout: number | null}[] = [];
    const runs: number[] = [];
    let rankBeforeFinal = new Map<number, number>();

    for (let r = 0; r < RACES; r++) {
        const playerRace = r === 3 || r === 7;
        const isFinal = r === RACES - 1;
        const runners = playerRace ? shuffle(players.map(p => p.id)).slice(0, 4) : shuffle([...Array(LIBRARY).keys()]).slice(0, 4);
        if (playerRace) runs.push(...runners);
        const records = runners.map(id => playerRace ? playerRecord[id] : racerRecord[id]);

        // Morning line: house money split by a random draw shifted by the record, plus the pool
        const shares = morningLine(records, random, {noise: v.lineNoise, recordWeight: v.lineRecordWeight});
        const houseTotal = v.houseStake * n;
        houseMoney += houseTotal;
        const seeds = splitPool(pool, runners.length, random);
        pool = 0;
        const entries = runners.map((_, i) => ({id: i, house: houseTotal * shares[i], seed: seeds[i]}));
        const backing = entries.map(e => e.house + e.seed);
        const backingTotal = backing.reduce((a, b) => a + b, 0);
        const startOdds = backing.map(b => backingTotal / b);
        // What a reader of the program sees: the record, smoothed
        const form = records.map(rec => (rec.wins + 1) / (rec.runs + runners.length));

        for (const p of players) {
            if (p.balance >= LOAN_THRESHOLD) continue;
            if (p.style !== 'flambeur' && random() >= 0.5) continue;
            const amount = p.style === 'flambeur' ? LOAN_MAX : 500;
            p.balance += amount;
            p.loans += amount;
        }

        const bets: {playerId: number, entryId: number | null, amount: number}[] = [];
        for (const p of players) {
            const balance = Math.floor(p.balance);
            const share = betShare(p);
            if (!share || balance < 1) {
                bets.push({playerId: p.id, entryId: null, amount: 0});
                continue;
            }
            const min = Math.max(1, Math.ceil(balance * MIN_BET_SHARE));
            const amount = Math.min(balance, Math.max(min, Math.floor(balance * share)));
            let entryId = pick(entries).id;
            // The follower reads the program: best record for the odds on offer
            if (p.style === 'suiveur' || v.allReaders) entryId = entries.reduce((best, e) => form[e.id] * startOdds[e.id] > form[best.id] * startOdds[best.id] ? e : best).id;
            // The favourite backer, like much of a real crowd: shortest starting odds
            if (p.style === 'favori' && !v.allReaders) entryId = entries.reduce((best, e) => startOdds[e.id] < startOdds[best.id] ? e : best).id;
            p.balance -= amount;
            bets.push({playerId: p.id, entryId, amount});
        }

        // Winner by hidden strength
        const weight = (i: number) => playerRace ? 1 : strength[runners[i]];
        const total = runners.reduce((s, _, i) => s + weight(i), 0);
        let roll = random() * total;
        const winner = entries.find(e => (roll -= weight(e.id)) <= 0)?.id ?? entries.length - 1;
        records.forEach((rec, i) => {
            rec.runs++;
            if (i === winner) rec.wins++;
        });

        if (isFinal) rankBeforeFinal = ranks(players);
        // Takeout: kept back from the pot before sharing, carried into the next race
        const takeoutAmount = v.takeout * (bets.reduce((s, b) => s + b.amount, 0) + backingTotal);
        const settled = settleWith(v, bets, entries, winner, isFinal, takeoutAmount);
        houseMoney += settled.created;
        pool += settled.toPool;
        for (const bet of bets) {
            const payout = settled.payouts.get(bet.playerId) ?? 0;
            players[bet.playerId].balance += payout;
            if (bet.amount > 0) allBets.push({playerId: bet.playerId, amount: bet.amount, payout});
        }

        const now = ranks(players);
        const lead = [...now.entries()].find(e => e[1] === 1)![0];
        if (r > 0 && lead !== leader) leadChanges++;
        leader = lead;
        for (const p of players) p.rankHistory.push(now.get(p.id)!);
    }

    const before = ranks(players, false);
    const awards = pickAwards({
        players,
        bets: allBets,
        messageCounts: players.map(p => ({playerId: p.id, count: p.messages})),
        runs,
    });
    for (const award of awards) {
        const bonus = award.key === 'debtor' ? -v.awardBonus / 2 : v.awardBonus;
        for (const id of award.playerIds) players[id].bonus += bonus;
    }
    const after = ranks(players);
    const winner = players.find(p => after.get(p.id) === 1)!;
    const winnerBefore = players.find(p => before.get(p.id) === 1)!;
    const mid = winner.rankHistory[Math.floor(RACES / 2) - 1];

    return {
        players, after, winner, leadChanges, houseMoney, pool,
        awardsFlipped: winner.id !== winnerBefore.id,
        comeback: mid > n / 2,
        // The last race decided it: the winner wasn't 1st before it
        finalDecided: rankBeforeFinal.get(winner.id) !== 1,
    };
};

/** settleRace with the variant's cap, minimum and takeout (the game's own rules when they match) */
const settleWith = (
    v: Variant,
    bets: {playerId: number, entryId: number | null, amount: number}[],
    entries: {id: number, house: number, seed: number}[],
    winner: number,
    isFinal: boolean,
    takeout: number,
) => {
    const multiplier = isFinal ? v.finalMultiplier : 1;
    const own = v.payoutCap === PAYOUT_CAP && v.minReturn === MIN_RETURN && !takeout;
    if (own) {
        const s = settleRace({bets, entries, winnerEntryId: winner, multiplier});
        const paid = [...s.payouts.values()].reduce((a, b) => a + b, 0);
        return {payouts: s.payouts, toPool: s.toPool, created: paid + s.toPool - s.pot};
    }
    // Same formula as settleRace, with the variant's limits
    const pot = bets.reduce((s, b) => s + b.amount, 0) + entries.reduce((s, e) => s + e.house + e.seed, 0);
    const shared = pot - takeout;
    const onWinner = entries[winner].house + entries[winner].seed + bets.filter(b => b.entryId === winner).reduce((s, b) => s + b.amount, 0);
    const payouts = new Map<number, number>();
    let paidFromPot = 0, paid = 0;
    for (const bet of bets) {
        if (bet.entryId !== winner || bet.amount <= 0) {
            payouts.set(bet.playerId, 0);
            continue;
        }
        const share = shared * bet.amount / onWinner;
        const capped = Math.min(Math.max(share, bet.amount * v.minReturn), bet.amount * v.payoutCap);
        paidFromPot += Math.min(share, capped);
        const payout = capped * multiplier;
        paid += payout;
        payouts.set(bet.playerId, payout);
    }
    const toPool = pot - paidFromPot;
    return {payouts, toPool, created: paid + toPool - pot};
};

const run = (games: number) => {
    const results: any[] = [];
    for (const v of VARIANTS) {
        for (const n of [8, 10, 12]) {
            seed = 1000 + n;
            const byStyle = Object.fromEntries(STYLES.map(s => [s, {players: 0, wins: 0, top3: 0, last: 0, score: 0, loans: 0}]));
            let flipped = 0, leadChanges = 0, comebacks = 0, finalDecided = 0, houseMoney = 0, winnerScore = 0, medianScore = 0;
            let loanTakers = 0, loanTop3 = 0, poolLeft = 0;
            for (let g = 0; g < games; g++) {
                const game = playGame(n, v);
                if (game.awardsFlipped) flipped++;
                if (game.comeback) comebacks++;
                if (game.finalDecided) finalDecided++;
                leadChanges += game.leadChanges;
                houseMoney += game.houseMoney;
                poolLeft += game.pool;
                const scores = game.players.map(scoreOf).sort((a, b) => a - b);
                winnerScore += scores[scores.length - 1];
                medianScore += scores[Math.floor(scores.length / 2)];
                for (const p of game.players) {
                    const s = byStyle[p.style];
                    const rank = game.after.get(p.id)!;
                    s.players++;
                    s.score += scoreOf(p);
                    if (rank === 1) s.wins++;
                    if (rank <= 3) s.top3++;
                    if (rank === n) s.last++;
                    if (p.loans > 0) {
                        s.loans++;
                        loanTakers++;
                        if (rank <= 3) loanTop3++;
                    }
                }
            }
            const styles = Object.fromEntries(Object.entries(byStyle).map(([k, s]) => [k, {
                // Win rate against a fair share (1 = wins as often as chance would say)
                winVsFair: s.players ? (s.wins / s.players) * n : 0,
                top3: s.players ? s.top3 / s.players : 0,
                last: s.players ? s.last / s.players : 0,
                avgScore: s.players ? s.score / s.players : 0,
                loanShare: s.players ? s.loans / s.players : 0,
            }]));
            const wins = Object.values(styles).map(s => s.winVsFair);
            results.push({
                variant: v.key, label: v.label, players: n, games,
                spread: Math.max(...wins) / Math.max(0.01, Math.min(...wins)),
                awardsFlippedWinner: flipped / games,
                leadChangesPerGame: leadChanges / games,
                comebackWins: comebacks / games,
                finalDecided: finalDecided / games,
                houseMoneyPerPlayer: houseMoney / games / n,
                winnerScoreAvg: winnerScore / games,
                medianScoreAvg: medianScore / games,
                poolLeftAvg: poolLeft / games,
                loanTakerShare: loanTakers / (games * n),
                loanTakersInTop3: loanTakers ? loanTop3 / loanTakers : 0,
                styles,
            });
        }
    }
    return results;
};

const games = Number(process.argv[2] || 2000);
console.log(JSON.stringify(run(games), null, 2));
