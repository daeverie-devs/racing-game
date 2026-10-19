import Game from "./models/game.model";
import Player from "./models/player.model";
import {Op} from "sequelize";
import Race from "./models/race.model";
import Message from "./models/message.model";
import Racer from "./models/racer.model";

export const fetchGame = async () => {
    const gameInfo = await Game.findOne({
        order: [['id', 'DESC']],
        raw: true
    })
    if (!gameInfo) return;
    const players = await Player.findAll({
        where: {
            id: {
                [Op.in]: gameInfo.players
            }
        },
        raw: true
    })
    const races = await Race.findAll({
        where: {
            id: {
                [Op.in]: gameInfo.races
            }
        },
        raw: true
    })
    const currentRace = races[(gameInfo.currentRace ?? 1)-1];
    let raceData = undefined;
    if (currentRace) {
        const racers = await Racer.findAll({
            where: {
                id: {
                    [Op.in]: currentRace.racers
                }
            },
            raw: true
        })

        raceData = {
            ...currentRace,
            racers: racers
        }
    }

    return {
        ...gameInfo,
        currentRace: raceData,
        players: players,
        races: races
    }
}

export const playerJoined = async (player: Player) => {
    const gameInfo = await Game.findOne({
        order: [['id', 'DESC']],
        raw: true
    })
    if (!gameInfo) return;

    if (!gameInfo.players.some(id => id === player.id)) {
        gameInfo.players.push(player.id);
        await Game.update(gameInfo, {where: {id: gameInfo.id}});
    }
}

export const fetchPlayer = async (id: number) => {
    return await Player.findOne({
        where: {id: id},
        raw: true
    })
}

export const updatePlayer = async (player: Player) => {
    return await Player.update(player, {where: {id: player.id}});
}

export const createPlayer = async (name: string, color: string) => {
    return await Player.create({
        name: name,
        balance: 5000,
        color: color,
        bidAmount: 0,
        bidRacer: 0
    }, { raw: true })
}

export const startGame = async () => {
    const gameInfo = await Game.findOne({
        order: [['id', 'DESC']],
        raw: true
    })
    if (!gameInfo) return;

    gameInfo.gameStatus = 'betting';
    gameInfo.currentRace = 1;

    await Game.update(gameInfo, {where: {id: gameInfo.id}})

    return await fetchGame();
}

export const fetchChat = async () => {
    return await Message.findAll({
        include: [{
            model: Player,
            as: 'sender_fk'
        }]
    });
}

export const sendMessage = async (player: Player, message: string) => {
    const now = new Date();
    return await Message.create({
        sender: player.id,
        message: message,
        time: now.getHours() + ':' + now.getMinutes().toString().padStart(2,'0')
    })
}

export const racerBid = async (racerId: number, amount: number) => {
    const racer = await Racer.findOne({ where: { id: racerId }, raw: true });
    if (!racer) return;

    racer.bidAmount += amount;

    await Racer.update(racer, { where: { id: racerId }});
}

export const calculateGains = async () => {
    const gameInfo = await fetchGame();

    if (!gameInfo) return;
    const totalBid = gameInfo.currentRace?.racers?.reduce((acc, cur) => (cur.bidAmount ?? 0) + acc, 0) ?? 0;

    for (const player of gameInfo.players) {
        const racer = await Racer.findOne({where: {id: player.bidRacer}, raw: true});
        if (!racer) continue;

        let betMultiplier = 0;
        if (gameInfo.currentRace?.winner === player.bidRacer) {
            betMultiplier = Math.max(totalBid, 1) / Math.max(racer?.bidAmount ?? 0, 1);
        }
        else {
            betMultiplier = 0;
        }

        player.gains = player.bidAmount * betMultiplier;
        player.balance += player.gains;
        if (player.gains === 0 && player.bidAmount > 0)
            player.gains = -player.bidAmount;
        player.bidAmount = 0;
        player.bidRacer = 0;
        await Player.update(player, {where: {id: player.id}});
    }

    return gameInfo.players;
}

export const swapToIntermission = async () => {
    const gameInfo = await Game.findOne({
        order: [['id', 'DESC']],
        raw: true
    })
    if (!gameInfo) return;

    gameInfo.gameStatus = 'intermission';

    await Game.update(gameInfo, {where: {id: gameInfo.id}})
}

export const nextRace = async () => {
    const gameInfo = await Game.findOne({
        order: [['id', 'DESC']],
        raw: true
    })
    if (!gameInfo) return;

    gameInfo.gameStatus = 'betting';
    gameInfo.currentRace += 1;

    await Game.update(gameInfo, {where: {id: gameInfo.id}})
}

export const closeBets = async () => {
    const gameInfo = await Game.findOne({
        order: [['id', 'DESC']],
        raw: true
    })
    if (!gameInfo) return;

    gameInfo.gameStatus = 'watching';

    await Game.update(gameInfo, {where: {id: gameInfo.id}})
}