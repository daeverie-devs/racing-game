import {CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model} from 'sequelize';
import {sequelize} from '../sequelize';

// Game flow: lobby -> (lineup ->) betting -> watching -> results -> next race ... -> awards -> podium
export type GameStatus = 'lobby' | 'lineup' | 'betting' | 'watching' | 'results' | 'awards' | 'podium';
export type RaceType = 'racers' | 'players';

export interface Skin {
    shape: number;
    modifier: number;
    eyes: number;
    main: number;
    secondary: number;
}

export class Racer extends Model<InferAttributes<Racer>, InferCreationAttributes<Racer>> {
    declare id: CreationOptional<number>;
    declare name: string;
    declare image: Buffer | null;
    declare imageType: string | null;
    // Bumped on every image change so browsers can cache /api/racers/:id/image forever
    declare imageVersion: CreationOptional<number>;
}

export class Game extends Model<InferAttributes<Game>, InferCreationAttributes<Game>> {
    declare id: CreationOptional<number>;
    declare name: string;
    declare active: CreationOptional<boolean>;
    declare status: CreationOptional<GameStatus>;
    // Index into the game's races ordered by position, -1 before the first race
    declare raceIndex: CreationOptional<number>;
    declare lockDeadline: number | null;
    // Money nobody won, spread over the next race's entries
    declare pool: CreationOptional<number>;
    declare awardStep: CreationOptional<number>;
    declare podiumStep: CreationOptional<number>;
    declare startingBalance: CreationOptional<number>;
    declare awardBonus: CreationOptional<number>;
    declare countdownSeconds: CreationOptional<number>;
    // Computed once when the last race ends, so the bonuses are paid exactly once
    declare awards: Award[] | null;
}

export interface Award {
    key: string;
    title: string;
    description: string;
    value: number;
    playerIds: number[];
}

export class Race extends Model<InferAttributes<Race>, InferCreationAttributes<Race>> {
    declare id: CreationOptional<number>;
    declare gameId: number;
    declare position: number;
    declare name: string;
    declare type: RaceType;
    declare link: string | null;
    // Racer races only: the winner set in the editor, preselected when the admin confirms
    declare presetWinnerRacerId: number | null;
    declare winnerEntryId: number | null;
}

// Something you can bet on in a race: a racer from the library, or a player from the lobby
export class RaceEntry extends Model<InferAttributes<RaceEntry>, InferCreationAttributes<RaceEntry>> {
    declare id: CreationOptional<number>;
    declare raceId: number;
    declare position: number;
    declare racerId: number | null;
    declare playerId: number | null;
    declare seed: CreationOptional<number>;
}

export class Player extends Model<InferAttributes<Player>, InferCreationAttributes<Player>> {
    declare id: CreationOptional<number>;
    declare gameId: number;
    // Secret kept by the phone to rejoin; never sent to other clients
    declare token: string;
    declare name: string;
    declare skin: Skin;
    declare balance: number;
    declare loans: CreationOptional<number>;
    declare bonus: CreationOptional<number>;
    // Rank before the last payout and the last race's net result, for the results screen
    declare prevRank: number | null;
    declare lastDelta: number | null;
}

// One per player per race. entryId null + locked = the player passed
export class Bet extends Model<InferAttributes<Bet>, InferCreationAttributes<Bet>> {
    declare id: CreationOptional<number>;
    declare raceId: number;
    declare playerId: number;
    declare entryId: number | null;
    declare amount: number;
    declare locked: CreationOptional<boolean>;
    declare payout: number | null;
}

export class Message extends Model<InferAttributes<Message>, InferCreationAttributes<Message>> {
    declare id: CreationOptional<number>;
    declare gameId: number;
    declare playerId: number;
    declare text: string;
    declare createdAt: CreationOptional<Date>;
}

// A new object each time: Sequelize writes the column name into the attribute object it is given
const money = (defaultValue = 0) => ({type: DataTypes.DOUBLE, allowNull: false, defaultValue});
const id = () => ({type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true});

Racer.init({
    id: id(),
    name: {type: DataTypes.STRING(80), allowNull: false},
    image: {type: DataTypes.BLOB('medium'), allowNull: true},
    imageType: {type: DataTypes.STRING(40), allowNull: true},
    imageVersion: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 1},
}, {sequelize, tableName: 'racer', timestamps: false});

Game.init({
    id: id(),
    name: {type: DataTypes.STRING(80), allowNull: false},
    active: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
    status: {type: DataTypes.STRING(20), allowNull: false, defaultValue: 'lobby'},
    raceIndex: {type: DataTypes.INTEGER, allowNull: false, defaultValue: -1},
    lockDeadline: {type: DataTypes.BIGINT, allowNull: true},
    pool: money(),
    awardStep: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0},
    podiumStep: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0},
    startingBalance: money(5000),
    awardBonus: money(500),
    countdownSeconds: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 15},
    awards: {type: DataTypes.JSON, allowNull: true},
}, {sequelize, tableName: 'game', timestamps: false});

Race.init({
    id: id(),
    gameId: {type: DataTypes.INTEGER, allowNull: false},
    position: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0},
    name: {type: DataTypes.STRING(80), allowNull: false, defaultValue: ''},
    type: {type: DataTypes.STRING(10), allowNull: false, defaultValue: 'racers'},
    link: {type: DataTypes.STRING(255), allowNull: true},
    presetWinnerRacerId: {type: DataTypes.INTEGER, allowNull: true},
    winnerEntryId: {type: DataTypes.INTEGER, allowNull: true},
}, {sequelize, tableName: 'race', timestamps: false});

RaceEntry.init({
    id: id(),
    raceId: {type: DataTypes.INTEGER, allowNull: false},
    position: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0},
    racerId: {type: DataTypes.INTEGER, allowNull: true},
    playerId: {type: DataTypes.INTEGER, allowNull: true},
    seed: money(),
}, {sequelize, tableName: 'race_entry', timestamps: false});

Player.init({
    id: id(),
    gameId: {type: DataTypes.INTEGER, allowNull: false},
    token: {type: DataTypes.STRING(64), allowNull: false, unique: true},
    name: {type: DataTypes.STRING(24), allowNull: false},
    skin: {type: DataTypes.JSON, allowNull: false},
    balance: money(),
    loans: money(),
    bonus: money(),
    prevRank: {type: DataTypes.INTEGER, allowNull: true},
    lastDelta: {type: DataTypes.DOUBLE, allowNull: true},
}, {sequelize, tableName: 'player', timestamps: false});

Bet.init({
    id: id(),
    raceId: {type: DataTypes.INTEGER, allowNull: false},
    playerId: {type: DataTypes.INTEGER, allowNull: false},
    entryId: {type: DataTypes.INTEGER, allowNull: true},
    amount: money(),
    locked: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
    payout: {type: DataTypes.DOUBLE, allowNull: true},
}, {
    sequelize, tableName: 'bet', timestamps: false,
    indexes: [{unique: true, fields: ['raceId', 'playerId']}]
});

Message.init({
    id: id(),
    gameId: {type: DataTypes.INTEGER, allowNull: false},
    playerId: {type: DataTypes.INTEGER, allowNull: false},
    text: {type: DataTypes.STRING(280), allowNull: false},
    createdAt: {type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW},
}, {sequelize, tableName: 'message', timestamps: false});

// Foreign keys with cascades, so deleting a game or a race cleans up after itself
Game.hasMany(Race, {foreignKey: 'gameId', onDelete: 'CASCADE'});
Race.belongsTo(Game, {foreignKey: 'gameId'});
Race.hasMany(RaceEntry, {foreignKey: 'raceId', onDelete: 'CASCADE'});
RaceEntry.belongsTo(Race, {foreignKey: 'raceId'});
Racer.hasMany(RaceEntry, {foreignKey: 'racerId', onDelete: 'CASCADE'});
Game.hasMany(Player, {foreignKey: 'gameId', onDelete: 'CASCADE'});
Player.hasMany(RaceEntry, {foreignKey: 'playerId', onDelete: 'CASCADE'});
Race.hasMany(Bet, {foreignKey: 'raceId', onDelete: 'CASCADE'});
Player.hasMany(Bet, {foreignKey: 'playerId', onDelete: 'CASCADE'});
Game.hasMany(Message, {foreignKey: 'gameId', onDelete: 'CASCADE'});
Player.hasMany(Message, {foreignKey: 'playerId', onDelete: 'CASCADE'});

/** Rounds money to cents, so floating point never leaves 4899.999997 in the database */
export const cents = (value: number) => Math.round(value * 100) / 100;
