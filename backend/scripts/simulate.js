// Plays a whole game against a running backend with 20 fake phones and the admin, and checks the
// rules along the way: lock-in, reveal, payouts, the pool, loans, chat, awards and the podium.
// Usage: npm run simulate (backend running, ADMIN_PASSCODE in .env). It resets the active game.
require('dotenv/config');
const WebSocket = require('ws');

const URL = process.env.SIM_URL || `ws://localhost:${process.env.PORT || 8084}`;
const PASSCODE = process.env.ADMIN_PASSCODE || 'chalet';
const PLAYERS = 20;
// 1x1 PNG
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let failures = 0;
const check = (ok, label) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failures++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Client {
    constructor(name) {
        this.name = name;
        this.reqId = 0;
        this.pending = new Map();
        this.state = null;
        this.chat = [];
    }
    open() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(URL);
            this.ws.on('open', resolve);
            this.ws.on('error', reject);
            this.ws.on('message', raw => {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'reply') {
                    const p = this.pending.get(msg.data.reqId);
                    this.pending.delete(msg.data.reqId);
                    p?.(msg.data);
                } else if (msg.type === 'state') this.state = msg.data;
                else if (msg.type === 'chat') this.chat.push(msg.data);
            });
        });
    }
    req(type, data) {
        const reqId = ++this.reqId;
        return new Promise(resolve => {
            this.pending.set(reqId, resolve);
            this.ws.send(JSON.stringify({type, data, reqId}));
        });
    }
    async ok(type, data) {
        const r = await this.req(type, data);
        if (!r.ok) throw new Error(`${this.name} ${type}: ${r.error}`);
        return r.data;
    }
    close() { this.ws.close(); }
}

const randomSkin = () => ({
    shape: Math.floor(Math.random() * 6), modifier: Math.floor(Math.random() * 6), eyes: Math.floor(Math.random() * 6),
    main: Math.floor(Math.random() * 12), secondary: Math.floor(Math.random() * 12),
});

/** Waits until the admin's state matches */
const waitFor = async (admin, predicate, label, timeout = 8000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (admin.state && predicate(admin.state)) return admin.state;
        await sleep(50);
    }
    check(false, `timed out waiting for: ${label}`);
    return admin.state;
};

/** Money is never lost: balances + pool + bets in play = start money + loans + what the house put in */
const checkMoney = (state, inPlay, label) => {
    const balances = state.players.reduce((s, p) => s + p.balance, 0);
    const loans = state.players.reduce((s, p) => s + p.loans, 0);
    const expected = PLAYERS * 5000 + loans + state.game.houseMoney;
    const actual = balances + state.game.pool + inPlay;
    check(Math.abs(actual - expected) < 0.05, `${label}: money conserved (${actual.toFixed(2)} vs ${expected.toFixed(2)})`);
};

const main = async () => {
    const admin = new Client('admin');
    await admin.open();
    await admin.ok('hello', {passcode: PASSCODE});

    // ---------- Editor: a fresh game with 4 races ----------
    const previous = (await admin.ok('editor.load')).games.find(g => g.active);
    const saved = await admin.ok('game.save', {name: 'Simulation', startingBalance: 5000, awardBonus: 500, countdownSeconds: 3});
    let editor = saved.editor;
    const game = editor.games.find(g => g.id === saved.id);
    await admin.ok('game.activate', {id: game.id});
    await admin.ok('game.reset', {});
    const racerIds = [];
    // Bolt comes with a history entered by hand: 3 wins in 5 races before the app
    for (const name of ['Bolt', 'Flash', 'Turbo', 'Escargot']) {
        const history = name === 'Bolt' ? {pastWins: 3, pastRuns: 5} : {};
        racerIds.push((await admin.ok('racer.save', {name, image: PIXEL, ...history})).id);
    }
    await admin.ok('race.save', {gameId: game.id, name: 'Course 1', type: 'racers', link: 'https://youtu.be/abc?t=30', racerIds, presetWinnerRacerId: racerIds[1]});
    await admin.ok('race.save', {gameId: game.id, name: 'Course des joueurs', type: 'players'});
    await admin.ok('race.save', {gameId: game.id, name: 'Course 3', type: 'racers', racerIds: racerIds.slice(0, 3), presetWinnerRacerId: racerIds[2]});
    editor = (await admin.ok('race.save', {gameId: game.id, name: 'Course 4', type: 'racers', racerIds})).editor;
    check(editor.games.find(g => g.id === game.id).races.length === 4, 'editor: 4 races created');

    // Forged admin action from a phone is refused
    const intruder = new Client('intruder');
    await intruder.open();
    await intruder.ok('hello', {});
    const forged = await intruder.req('game.next');
    check(!forged.ok, `phone cannot run admin actions (${forged.error})`);
    intruder.close();

    // ---------- 20 phones join at once ----------
    const phones = Array.from({length: PLAYERS}, (_, i) => new Client(`P${i + 1}`));
    await Promise.all(phones.map(p => p.open()));
    await Promise.all(phones.map(p => p.ok('hello', {})));
    const joins = await Promise.all(phones.map(p => p.ok('player.join', {name: p.name, skin: randomSkin()})));
    phones.forEach((p, i) => { p.token = joins[i].token; p.id = joins[i].player.id; });
    let state = await waitFor(admin, s => s.players.length === PLAYERS, '20 players in the lobby');
    check(state.players.length === PLAYERS, 'simultaneous joins: nobody dropped');
    const badJoin = await phones[0].req('player.join', {name: 'x'.repeat(60), skin: randomSkin()});
    check(!badJoin.ok, `name too long refused (${badJoin.error})`);
    const badSkin = await phones[0].req('player.join', {name: 'Hack', skin: {shape: 99}});
    check(!badSkin.ok, `invalid skin refused (${badSkin.error})`);

    // ---------- Race 1: spam drafts, lock in, auto reveal ----------
    await admin.ok('game.next');
    state = await waitFor(admin, s => s.game.status === 'betting', 'race 1 betting');
    const entries1 = state.race.entries;
    check(entries1.length === 4 && entries1.every(e => e.total === null), 'race 1: amounts hidden while betting');
    check(state.race.winnerEntryId === null && !JSON.stringify(phones[0].state.race).includes('presetWinner'), 'race 1: winner not sent to phones');

    const early = await phones[0].req('race.winner', {entryId: entries1[0].id});
    check(!early.ok, 'phone cannot declare a winner');
    const tooMuch = await phones[0].req('bet.lock', {entryId: entries1[0].id, amount: 999999});
    check(!tooMuch.ok, `bet over balance refused (${tooMuch.error})`);
    const tooLittle = await phones[0].req('bet.lock', {entryId: entries1[0].id, amount: 10});
    check(!tooLittle.ok && phones[0].state.me.minBet === 250, `bet under 5 % refused (${tooLittle.error})`);
    // Morning line: every racer shows starting odds within the track limits before anyone bets
    const bolt = entries1.find(e => e.name === 'Bolt');
    check(bolt?.record.wins === 3 && bolt.record.runs === 5 && entries1.filter(e => e !== bolt).every(e => e.record.runs === 0),
        `race 1: records shown, hand-entered history included (${JSON.stringify(entries1.map(e => e.record))})`);
    check(entries1.every(e => e.startOdds >= 2.6 - 0.01 && e.startOdds <= 31 + 0.01),
        `race 1: starting odds shown, within 2.6× to 31× (${entries1.map(e => e.startOdds.toFixed(1)).join(', ')})`);

    // Spam: 30 drafts per phone in parallel, then everyone locks (P20 passes)
    await Promise.all(phones.map(p => Promise.all(Array.from({length: 30}, (_, k) =>
        p.req('bet.draft', {entryId: entries1[k % 4].id, amount: k * 10}))))
    );
    const bets1 = new Map();
    await Promise.all(phones.map((p, i) => {
        if (i === PLAYERS - 1) return p.ok('bet.pass');
        const bet = {entryId: entries1[i % 4].id, amount: 250 + 100 * i};
        bets1.set(p.id, bet);
        return p.ok('bet.lock', bet);
    }));
    state = await waitFor(admin, s => s.game.status === 'watching', 'race 1 auto reveal when all locked');
    const inPlay1 = [...bets1.values()].reduce((s, b) => s + b.amount, 0);
    // The house stakes 150 per player on the morning line
    check(Math.abs(state.race.pot - inPlay1 - PLAYERS * 150) < 0.05, `race 1: pot = locked bets + house stake (${state.race.pot})`);
    check(state.players.find(p => p.id === phones[PLAYERS - 1].id).passed, 'race 1: P20 shown as passed');
    // The house's morning-line stake is on the table too
    checkMoney(state, inPlay1 + PLAYERS * 150, 'race 1 revealed');
    const lateBet = await phones[0].req('bet.lock', {entryId: entries1[0].id, amount: 10});
    check(!lateBet.ok, 'bet after reveal refused');
    check(admin.state.admin?.presetWinnerEntryId === entries1[1].id, 'admin sees the preset winner');

    // Double tap on the winner: the second one is refused, paid once
    const [w1, w2] = await Promise.all([
        admin.req('race.winner', {entryId: entries1[1].id}),
        admin.req('race.winner', {entryId: entries1[1].id}),
    ]);
    check(w1.ok !== w2.ok, 'double winner tap: paid out once');
    state = await waitFor(admin, s => s.game.status === 'results', 'race 1 results');
    checkMoney(state, 0, 'race 1 paid');
    check(state.players.every(p => p.prevRank !== null), 'race 1: rank before payout recorded');
    const paid1 = state.race.entries.find(e => e.id === entries1[1].id).bettors;
    check(paid1.length > 0 && paid1.every(b => b.payout >= b.amount * 1.05 - 0.01 && b.payout <= b.amount * 10 + 0.01),
        `race 1: winners get between 1.05× and 10× (${paid1.map(b => (b.payout / b.amount).toFixed(2)).join(', ')})`);

    // ---------- Race 2: player race, lineup + countdown ----------
    await admin.ok('game.next');
    state = await waitFor(admin, s => s.game.status === 'lineup', 'race 2 lineup');
    const runners = phones.slice(0, 4).map(p => p.id);
    await admin.ok('race.lineup', {playerIds: runners});
    state = await waitFor(admin, s => s.game.status === 'betting', 'race 2 betting');
    check(state.race.entries.every(e => e.skin && e.playerId), 'race 2: entries are players with skins');
    const entries2 = state.race.entries;
    // Half lock, the others only draft (some under the minimum); the countdown locks the drafts
    await Promise.all(phones.map((p, i) => i < 10
        ? p.ok('bet.lock', {entryId: entries2[i % 4].id, amount: p.state.me.minBet})
        : p.ok('bet.draft', {entryId: entries2[i % 4].id, amount: 25})));
    const p16Min = phones[15].state.me.minBet;
    await phones[0].ok('bet.unlock');
    await phones[0].ok('bet.lock', {entryId: entries2[3].id, amount: phones[0].state.me.minBet + 100});
    await admin.ok('race.countdown', {seconds: 3});
    state = await waitFor(admin, s => s.game.lockDeadline !== null, 'countdown visible');
    state = await waitFor(admin, s => s.game.status === 'watching', 'countdown locks everyone in', 6000);
    // Each phone gets the new state a moment after the admin
    await waitFor(phones[15], s => s.game.status === 'watching', 'P16 sees the reveal');
    check(phones[15].state.me.bet?.locked && phones[15].state.me.bet.amount === p16Min, `race 2: draft under the minimum raised to it and locked by the countdown (${JSON.stringify(phones[15].state.me.bet)})`);
    check(phones[0].state.me.bet.entryId === entries2[3].id, 'race 2: unlock + relock changed the pick');
    await admin.ok('race.winner', {entryId: entries2[0].id});
    state = await waitFor(admin, s => s.game.status === 'results', 'race 2 results');
    checkMoney(state, 0, 'race 2 paid');

    // ---------- Race 3: nobody backs the winner -> pool ----------
    await admin.ok('game.next');
    state = await waitFor(admin, s => s.game.status === 'betting' && s.game.raceIndex === 2, 'race 3 betting');
    const entries3 = state.race.entries;
    // Flash won race 1, Bolt ran it: both records count it
    const flash3 = entries3.find(e => e.name === 'Flash'), bolt3 = entries3.find(e => e.name === 'Bolt');
    check(flash3?.record.wins === 1 && flash3.record.runs === 1 && bolt3?.record.runs === 6 && bolt3.record.wins === 3,
        `race 3: records grow with each race (Flash ${JSON.stringify(flash3?.record)}, Bolt ${JSON.stringify(bolt3?.record)})`);
    await Promise.all(phones.map(p => p.ok('bet.lock', {entryId: entries3[0].id, amount: p.state.me.minBet})));
    state = await waitFor(admin, s => s.game.status === 'watching', 'race 3 reveal');
    await admin.ok('race.winner', {entryId: entries3[2].id});
    state = await waitFor(admin, s => s.game.status === 'results', 'race 3 results');
    // Only the house was on the winner: the whole pot feeds the pool
    check(Math.abs(state.game.pool - state.race.pot) < 0.05, `race 3: unclaimed pot went to the pool (${state.game.pool})`);
    const pool3 = state.game.pool;
    checkMoney(state, 0, 'race 3 pooled');

    // ---------- Loans and chat ----------
    // P1 bets everything on race 4 and loses, then borrows
    await admin.ok('game.next');
    state = await waitFor(admin, s => s.game.status === 'betting' && s.game.raceIndex === 3, 'race 4 betting');
    const seeds = state.race.entries.reduce((s, e) => s + e.seed, 0);
    check(Math.abs(seeds - pool3) < 0.05 && state.game.pool === 0, `race 4: pool spread over the racers (${state.race.entries.map(e => e.seed).join(', ')})`);
    const entries4 = state.race.entries;
    const p1 = phones[0];
    const loanTooRich = await p1.req('loan.take', {amount: 500});
    check(!loanTooRich.ok, `loan refused above the threshold (${loanTooRich.error})`);
    const p1Balance = state.players.find(p => p.id === p1.id).balance;
    await Promise.all(phones.map((p, i) => p.ok('bet.lock', i === 0
        ? {entryId: entries4[0].id, amount: Math.floor(p1Balance)}
        : {entryId: entries4[1 + (i % 3)].id, amount: p.state.me.minBet + (i === 5 ? 0 : 50)})));
    state = await waitFor(admin, s => s.game.status === 'watching', 'race 4 reveal');
    await admin.ok('race.winner', {entryId: entries4[1].id});
    state = await waitFor(admin, s => s.game.status === 'results', 'race 4 results');
    checkMoney(state, 0, 'race 4 paid (pool included)');
    const paid4 = state.race.entries.find(e => e.id === entries4[1].id).bettors;
    check(paid4.length > 0 && paid4.every(b => b.payout >= b.amount * 2.1 - 0.02),
        `race 4 (last): payouts doubled, at least 2.1× (${paid4.map(b => (b.payout / b.amount).toFixed(2)).join(', ')})`);
    const loan = await p1.req('loan.take', {amount: 800});
    check(loan.ok, `broke player can borrow (${loan.error ?? 'ok'})`);
    const loan2 = await p1.req('loan.take', {amount: 2000});
    check(!loan2.ok, 'loan over the max refused');
    state = await waitFor(admin, s => s.players.find(p => p.id === p1.id).loans === 800, 'loan recorded');
    checkMoney(state, 0, 'after loan');

    await phones[3].ok('chat.send', {text: 'Allez Flash!'});
    await sleep(800);
    await phones[3].ok('chat.send', {text: 'x'.repeat(1000)});
    const spam = await phones[3].req('chat.send', {text: 'trop vite'});
    check(!spam.ok, 'chat cooldown');
    await sleep(300);
    check(phones[10].chat.length === 2 && phones[10].chat[1].text.length === 280, 'chat: long message cut at 280, server still up');

    // ---------- Reconnect: a phone resumes with its token ----------
    phones[7].close();
    const back = new Client('P8 again');
    await back.open();
    const hello = await back.ok('hello', {token: phones[7].token});
    check(hello.player?.id === phones[7].id, 'reconnect: phone resumes its player with the token');
    phones[7] = back;

    // ---------- Awards and podium ----------
    await admin.ok('game.next');
    state = await waitFor(admin, s => s.game.status === 'awards', 'awards after the last race');
    check(state.game.awards.length === 1, 'awards revealed one at a time');
    while (admin.state.game.status === 'awards') {
        const step = admin.state.game.awardStep;
        await admin.ok('awards.next');
        await waitFor(admin, s => s.game.status !== 'awards' || s.game.awardStep !== step, 'next award shown');
    }
    state = await waitFor(admin, s => s.game.status === 'podium', 'podium');
    const keys = state.game.awards.map(a => a.key).join(', ');
    check(['biggestBet', 'bestShot', 'chatterbox', 'athlete', 'debtor', 'cheapskate'].every(k => keys.includes(k)), `all 6 awards given (${keys})`);
    const cheapskate = state.game.awards.find(a => a.key === 'cheapskate');
    check(!!cheapskate && cheapskate.value >= 1, `smallest bet award given (${cheapskate?.value})`);
    const debtor = state.game.awards.find(a => a.key === 'debtor');
    check(debtor?.bonus === -250, `loan award is a 250 penalty (${debtor?.bonus})`);
    const bonuses = state.players.reduce((s, p) => s + p.bonus, 0);
    const expectedBonus = state.game.awards.reduce((s, a) => s + a.playerIds.length * a.bonus, 0);
    check(Math.abs(bonuses - expectedBonus) < 0.01, `award bonuses paid once (${bonuses})`);
    for (let i = 0; i < 4; i++) await admin.ok('podium.next');
    state = await waitFor(admin, s => s.game.podiumStep === 3, 'podium fully revealed');
    const first = state.players.find(p => p.rank === 1);
    check(state.players.every(p => p.score <= first.score), `podium: rank 1 has the best score (${first.name}, ${first.score.toFixed(2)})`);
    check(Math.abs(first.score - (first.balance + first.bonus - first.loans)) < 0.01, 'score = balance + bonus - loans');
    console.log(`${state.game.awards.length} awards, winner ${first.name}`);

    // ---------- Clean up: back to the game that was active, simulation data removed ----------
    phones.forEach(p => p.close());
    if (previous) await admin.ok('game.activate', {id: previous.id});
    else await admin.ok('game.save', {name: 'Partie'}).then(r => admin.ok('game.activate', {id: r.id}));
    await admin.ok('game.delete', {id: game.id});
    for (const id of racerIds) await admin.ok('racer.delete', {id});
    const after = await admin.ok('editor.load');
    check(!after.games.some(g => g.id === game.id) && !after.racers.some(r => racerIds.includes(r.id)), 'simulation data cleaned up');
    admin.close();
    console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(err => {
    console.error(err);
    process.exit(1);
});
