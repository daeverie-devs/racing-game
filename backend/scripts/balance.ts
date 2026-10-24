// Balance simulation: thousands of games of 8 to 12 players with the real payout, pool and award
// rules (src/game/rules.ts), to see what decides who wins. No server needed.
// Usage: npx ts-node --transpile-only scripts/balance.ts [games per lobby size] > results.json
import {computePayouts, LOAN_MAX, LOAN_THRESHOLD, pickAwards, splitPool} from '../src/game/rules';

type Style = 'prudent' | 'moyen' | 'flambeur' | 'gratteux' | 'passif' | 'suiveur';
const STYLES: Style[] = ['prudent', 'moyen', 'flambeur', 'gratteux', 'passif', 'suiveur'];

interface Variant {
    key: string;
    label: string;
    /** Max share of the balance in one bet (1 = all-in allowed) */
    betCap: number;
    awardBonus: number;
    /** Cheapskate award only counts bets of at least this share of the balance */
    cheapskateMinShare: number;
    /** Racers have hidden strengths, and their win record is shown */
    form: boolean;
    /** House money per race and player, staked like a bet: favourites start with low odds */
    houseSeedPerPlayer: number;
    /** Seeds from the pool count as stake on their racer (house bet) instead of a free bonus */
    seedAsStake: boolean;
    /** Minimum bet as a share of the balance (0 = 1 $ minimum) */
    minBetShare: number;
    /** A winning bet pays at most this many times its stake; the rest goes to the pool (0 = no cap) */
    payoutCap: number;
    /** Fixed odds set before betting from the visible form, paid by the house (not pari-mutuel) */
    bookmaker: boolean;
    /** House money split at random instead of by form: random starting odds */
    randomHouse: boolean;
}

const BASE = {
    betCap: 1, awardBonus: 500, cheapskateMinShare: 0, form: false, houseSeedPerPlayer: 0, seedAsStake: false,
    minBetShare: 0, payoutCap: 0, bookmaker: false, randomHouse: false,
};
// The house keeps 10 % on fixed odds, so blind betting slowly loses money and reading the form pays
const BOOK_MARGIN = 0.9;
const VARIANTS: Variant[] = [
    {...BASE, key: 'actuel', label: 'Règles actuelles'},
    {...BASE, key: 'cap50', label: 'Mise max 50 %', betCap: 0.5},
    {...BASE, key: 'prix', label: 'Prix 250 $, gratteux ≥ 5 %', awardBonus: 250, cheapskateMinShare: 0.05},
    {...BASE, key: 'misemin', label: 'Mise min 5 % du solde', minBetShare: 0.05},
    {...BASE, key: 'plafond', label: 'Gain max 10× la mise', payoutCap: 10},
    {...BASE, key: 'aleatoire', label: 'Cotes de départ au hasard', houseSeedPerPlayer: 150, seedAsStake: true, randomHouse: true},
    {...BASE, key: 'cotes', label: 'Cotes de départ (forme + maison)', form: true, houseSeedPerPlayer: 150, seedAsStake: true},
    {...BASE, key: 'reco', label: 'Pari-mutuel corrigé', awardBonus: 250, cheapskateMinShare: 0.05, form: true, houseSeedPerPlayer: 150, seedAsStake: true, minBetShare: 0.05, payoutCap: 10},
    {...BASE, key: 'book', label: 'Cotes fixes (bookmaker)', awardBonus: 250, cheapskateMinShare: 0.05, form: true, minBetShare: 0.05, bookmaker: true},
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

/** How much a player bets this race (0 = pass), from their style */
const betSize = (p: SimPlayer, v: Variant) => {
    const b = Math.floor(p.balance);
    if (b < 1) return 0;
    let share = 0;
    switch (p.style) {
        case 'prudent': share = between(0.05, 0.1); break;
        case 'moyen': share = between(0.15, 0.3); break;
        case 'flambeur': share = random() < 0.35 ? 1 : between(0.4, 0.8); break;
        // The 1 $ bet: share 0 rounds down to the minimum
        case 'gratteux': share = random() < 0.3 ? 0 : 0.05; break;
        case 'passif': if (random() < 0.4) return 0; share = 0.1; break;
        case 'suiveur': share = 0.2; break;
    }
    return Math.min(b, Math.max(1, Math.ceil(b * v.minBetShare), Math.floor(b * Math.min(share, v.betCap))));
};

const playGame = (n: number, v: Variant) => {
    const players: SimPlayer[] = shuffle(Array.from({length: n}, (_, i) => STYLES[i % STYLES.length]))
        .map((style, id) => ({id, style, balance: START, loans: 0, bonus: 0, messages: Math.floor(random() * random() * 25), rankHistory: []}));
    // Hidden racer strength (marbles aren't equal); only matters for odds when the form is shown
    const strength = Array.from({length: LIBRARY}, () => Math.exp((random() - 0.5) * 1.6));
    const record = Array.from({length: LIBRARY}, () => ({runs: 0, wins: 0}));
    let pool = 0;
    const allBets: {playerId: number, amount: number, payout: number | null, share: number}[] = [];
    const runs: number[] = [];
    let leadChanges = 0;
    let leader = -1;

    for (let r = 0; r < RACES; r++) {
        const playerRace = r === 3 || r === 7;
        // Entries: racer ids from the library, or player ids (strength equal)
        const entries = playerRace ? shuffle(players.map(p => p.id)).slice(0, 4) : shuffle([...Array(LIBRARY).keys()]).slice(0, 4);
        if (playerRace) runs.push(...entries);
        const weight = (e: number) => playerRace ? 1 : strength[e];
        const total = entries.reduce((s, e) => s + weight(e), 0);
        // Visible form: smoothed win rate from past races (what a "Forme" line on the card would show)
        const form = (e: number) => playerRace || !v.form ? 1 / entries.length : (record[e].wins + 1) / (record[e].runs + entries.length);
        const formTotal = entries.reduce((s, e) => s + form(e), 0);

        // Stakes on each entry before the players: house money split by form, plus the pool
        const houseTotal = v.houseSeedPerPlayer * n;
        const poolSeeds = splitPool(pool, entries.length, random);
        pool = 0;
        const houseSplit = v.randomHouse ? splitPool(houseTotal, entries.length, random) : entries.map(e => houseTotal * form(e) / formTotal);
        const stakes = entries.map((e, i) => houseSplit[i] + (v.seedAsStake ? poolSeeds[i] : 0));
        const freeSeeds = v.seedAsStake ? 0 : poolSeeds.reduce((a, b) => a + b, 0);

        // Broke players borrow
        for (const p of players) {
            if (p.balance >= LOAN_THRESHOLD) continue;
            const wants = p.style === 'flambeur' || p.style === 'gratteux' || random() < 0.5;
            if (!wants) continue;
            const amount = p.style === 'flambeur' ? LOAN_MAX : 500;
            p.balance += amount;
            p.loans += amount;
        }

        // Bets: blind picks, except followers who back the visible favourite when there is one
        const bets: {playerId: number, entryId: number | null, amount: number}[] = [];
        for (const p of players) {
            const amount = betSize(p, v);
            if (!amount) {
                bets.push({playerId: p.id, entryId: null, amount: 0});
                continue;
            }
            let entry = pick(entries);
            if (p.style === 'suiveur' && (v.form || v.houseSeedPerPlayer > 0)) {
                // Best value: the visible win chance times the payout the starting odds promise
                const value = (e: number, i: number) => form(e) / formTotal * (houseTotal + 1) / (stakes[i] + 1);
                entry = entries.reduce((best, e, i) => value(e, i) > value(best, entries.indexOf(best)) ? e : best, entries[0]);
                if (!v.houseSeedPerPlayer) entry = entries.reduce((best, e) => form(e) > form(best) ? e : best, entries[0]);
            }
            p.balance -= amount;
            bets.push({playerId: p.id, entryId: entry, amount});
        }

        // Winner by strength
        let roll = random() * total;
        const winner = entries.find(e => (roll -= weight(e)) <= 0) ?? entries[entries.length - 1];
        if (!playerRace) for (const e of entries) {
            record[e].runs++;
            if (e === winner) record[e].wins++;
        }

        if (v.bookmaker) {
            // Fixed odds from the form, decided before anyone bets: payout = stake × odds
            for (const bet of bets) {
                if (bet.amount <= 0) continue;
                const odds = bet.entryId === winner ? BOOK_MARGIN * formTotal / form(winner) : 0;
                const payout = Math.round(bet.amount * odds * 100) / 100;
                const player = players[bet.playerId];
                player.balance += payout;
                allBets.push({playerId: bet.playerId, amount: bet.amount, payout, share: bet.amount / (player.balance - payout + bet.amount)});
            }
            const leadNow = [...ranks(players).entries()].find(e => e[1] === 1)![0];
            if (r > 0 && leadNow !== leader) leadChanges++;
            leader = leadNow;
            const nowRanks = ranks(players);
            for (const p of players) p.rankHistory.push(nowRanks.get(p.id)!);
            continue;
        }

        // Payout: house stakes act as a phantom bettor whose winnings go back to the pool
        const house = {playerId: -1, entryId: winner as number | null, amount: stakes[entries.indexOf(winner)]};
        const houseLosing = stakes.reduce((a, b) => a + b, 0) - house.amount;
        const withHouse = house.amount > 0 ? [...bets, house] : bets;
        const {payouts, unclaimed} = computePayouts(withHouse, freeSeeds + houseLosing, winner);
        pool += unclaimed + (payouts.get(-1) ?? 0);
        for (const bet of bets) {
            let payout = payouts.get(bet.playerId) ?? 0;
            if (v.payoutCap && payout > bet.amount * v.payoutCap) {
                pool += payout - bet.amount * v.payoutCap;
                payout = bet.amount * v.payoutCap;
            }
            const player = players[bet.playerId];
            player.balance += payout;
            if (bet.amount > 0) allBets.push({playerId: bet.playerId, amount: bet.amount, payout, share: bet.amount / (player.balance - payout + bet.amount)});
        }
        const lead = [...ranks(players).entries()].find(e => e[1] === 1)![0];
        if (r > 0 && lead !== leader) leadChanges++;
        leader = lead;
        const now = ranks(players);
        for (const p of players) p.rankHistory.push(now.get(p.id)!);
    }

    const before = ranks(players, false);
    const awards = pickAwards({
        players,
        bets: allBets,
        messageCounts: players.map(p => ({playerId: p.id, count: p.messages})),
        runs,
    });
    // With a minimum share, the cheapskate award ignores tiny bets
    if (v.cheapskateMinShare > 0) {
        const cheap = awards.find(a => a.key === 'cheapskate');
        const eligible = allBets.filter(b => b.share >= v.cheapskateMinShare);
        if (cheap && eligible.length) {
            const min = Math.min(...eligible.map(b => b.amount));
            cheap.value = min;
            cheap.playerIds = [...new Set(eligible.filter(b => b.amount === min).map(b => b.playerId))];
        }
    }
    for (const award of awards) for (const id of award.playerIds) players[id].bonus += v.awardBonus;
    const after = ranks(players);
    const winner = players.find(p => after.get(p.id) === 1)!;
    const winnerBefore = players.find(p => before.get(p.id) === 1)!;
    const mid = winner.rankHistory[Math.floor(RACES / 2) - 1];

    return {players, after, awards, winner, winnerBefore, leadChanges, comeback: mid > n / 2, pool};
};

const run = (games: number) => {
    const results: any[] = [];
    for (const v of VARIANTS) {
        for (const n of [8, 10, 12]) {
            seed = 1000 + n;
            const byStyle = Object.fromEntries(STYLES.map(s => [s, {players: 0, wins: 0, top3: 0, rankSum: 0, bonus: 0, score: 0, loans: 0, last: 0}]));
            let awardsFlipped = 0, leadChanges = 0, comebacks = 0, loanTakers = 0, loanTop3 = 0, winnerScore = 0, medianScore = 0;
            let winnerHadAward = 0, cheapByGratteux = 0, cheapAwards = 0, broke = 0;
            for (let g = 0; g < games; g++) {
                const game = playGame(n, v);
                if (game.winner.id !== game.winnerBefore.id) awardsFlipped++;
                if (game.winner.bonus > 0) winnerHadAward++;
                leadChanges += game.leadChanges;
                if (game.comeback) comebacks++;
                const scores = game.players.map(scoreOf).sort((a, b) => a - b);
                winnerScore += scores[scores.length - 1];
                medianScore += scores[Math.floor(scores.length / 2)];
                const cheap = game.awards.find(a => a.key === 'cheapskate');
                if (cheap) {
                    cheapAwards++;
                    if (cheap.playerIds.some(id => game.players[id].style === 'gratteux')) cheapByGratteux++;
                }
                for (const p of game.players) {
                    const s = byStyle[p.style];
                    const rank = game.after.get(p.id)!;
                    s.players++;
                    s.rankSum += (rank - 1) / (n - 1);
                    s.bonus += p.bonus;
                    s.score += scoreOf(p);
                    if (rank === 1) s.wins++;
                    if (rank <= 3) s.top3++;
                    if (rank === n) s.last++;
                    if (p.loans > 0) {
                        s.loans++;
                        loanTakers++;
                        if (rank <= 3) loanTop3++;
                    }
                    if (scoreOf(p) < START * 0.2) broke++;
                }
            }
            results.push({
                variant: v.key, label: v.label, players: n, games,
                awardsFlippedWinner: awardsFlipped / games,
                winnerHadAward: winnerHadAward / games,
                leadChangesPerGame: leadChanges / games,
                comebackWins: comebacks / games,
                winnerScoreAvg: winnerScore / games,
                medianScoreAvg: medianScore / games,
                loanTakerShare: loanTakers / (games * n),
                loanTakersInTop3: loanTakers ? loanTop3 / loanTakers : 0,
                brokeShare: broke / (games * n),
                cheapskateToGratteux: cheapAwards ? cheapByGratteux / cheapAwards : 0,
                styles: Object.fromEntries(Object.entries(byStyle).map(([k, s]) => [k, {
                    // Win rate against a fair share (1 = wins as often as chance would say)
                    winVsFair: s.players ? (s.wins / s.players) * n : 0,
                    top3: s.players ? s.top3 / s.players : 0,
                    last: s.players ? s.last / s.players : 0,
                    avgRankPct: s.players ? s.rankSum / s.players : 0,
                    avgBonus: s.players ? s.bonus / s.players : 0,
                    avgScore: s.players ? s.score / s.players : 0,
                    loanShare: s.players ? s.loans / s.players : 0,
                }])),
            });
        }
    }
    return results;
};

const games = Number(process.argv[2] || 2000);
console.log(JSON.stringify(run(games), null, 2));
