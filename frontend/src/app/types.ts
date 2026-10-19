export interface Player {
    id?: number;
    name?: string;
    balance?: number;
    gains?: number;
    color?: string;
    bidAmount?: number;
    bidRacer?: number;
}

export interface Game {
    id?: number;
    currentRace?: Race;
    gameStatus?: string;
    players?: Player[];
    races?: Race[];
}

export interface Racer {
    id?: number;
    name?: string;
    image?: string;
    bidAmount?: number;
    biders?: Player[]
}

export interface Race {
    id?: number;
    link?: string;
    racers?: Racer[];
}

export interface Message {
    id?: number;
    sender_fk?: Player;
    message?: string;
    time?: string;
}
