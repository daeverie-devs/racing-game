// Mirrors what backend/src/game/state.ts sends

export type GameStatus = 'lobby' | 'lineup' | 'betting' | 'watching' | 'results' | 'awards' | 'podium';
export type RaceType = 'racers' | 'players';

export interface Skin {
    shape: number;
    modifier: number;
    eyes: number;
    main: number;
    secondary: number;
}

export interface Award {
    key: string;
    title: string;
    description: string;
    value: number;
    playerIds: number[];
}

export interface GameInfo {
    id: number;
    name: string;
    status: GameStatus;
    raceIndex: number;
    raceCount: number;
    lockDeadline: number | null;
    pool: number;
    countdownSeconds: number;
    awardBonus: number;
    awardStep: number;
    podiumStep: number;
    /** Revealed so far; awardCount is the total */
    awards: Award[];
    awardCount: number;
    loanThreshold: number;
    loanMax: number;
}

export interface PlayerInfo {
    id: number;
    name: string;
    skin: Skin;
    balance: number;
    loans: number;
    bonus: number;
    score: number;
    rank: number;
    prevRank: number | null;
    lastDelta: number | null;
    locked: boolean;
    passed: boolean;
    connected: boolean;
}

export interface Bettor {
    playerId: number;
    amount: number;
    payout: number | null;
}

export interface Entry {
    id: number;
    name: string;
    imageUrl: string | null;
    playerId: number | null;
    skin: Skin | null;
    seed: number;
    total: number | null;
    odds: number | null;
    bettors: Bettor[];
}

export interface RaceInfo {
    id: number;
    name: string;
    type: RaceType;
    link: string | null;
    pot: number | null;
    winnerEntryId: number | null;
    entries: Entry[];
}

export interface MyBet {
    entryId: number | null;
    amount: number;
    locked: boolean;
    payout: number | null;
}

export interface GameState {
    serverNow: number;
    game: GameInfo;
    players: PlayerInfo[];
    race: RaceInfo | null;
    me: {playerId: number, bet: MyBet | null} | null;
    admin: {presetWinnerEntryId: number | null, gameId: number} | null;
}

export interface ChatMessage {
    id: number;
    playerId: number;
    name: string;
    skin: Skin | null;
    text: string;
    time: string;
}

// ---------- Editor ----------

export interface EditorRacer {
    id: number;
    name: string;
    imageUrl: string | null;
}

export interface EditorRace {
    id: number;
    name: string;
    type: RaceType;
    link: string | null;
    presetWinnerRacerId: number | null;
    racerIds: number[];
}

export interface EditorGame {
    id: number;
    name: string;
    active: boolean;
    status: GameStatus;
    startingBalance: number;
    awardBonus: number;
    countdownSeconds: number;
    races: EditorRace[];
}

export interface EditorData {
    racers: EditorRacer[];
    games: EditorGame[];
}
