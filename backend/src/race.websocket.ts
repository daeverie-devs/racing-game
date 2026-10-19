import WebSocketService from './websocket.service';
import * as raceService from './race-game.service';
import Player from "./models/player.model";

export const connectToLobby = async (clientId: string, message: any) => {
    const player: Player = message.data;

    if (player.id) {
        const playerData = await raceService.fetchPlayer(player.id)
        if (!playerData) return;

        if (playerData.name !== player.name || playerData.color !== player.color) {
            playerData.name = player.name;
            playerData.color = player.color;
            await raceService.updatePlayer(playerData);
        }

        WebSocketService.sendToClient(clientId, {
            type: 'player-connected',
            data: playerData
        })
    }
    else {
        const playerData = await raceService.createPlayer(player.name, player.color);

        WebSocketService.sendToClient(clientId, {
            type: 'player-connected',
            data: playerData
        })
    }
}

export const playerReady = async (clientId: string, message: any) => {
    WebSocketService.sendToClient(clientId, {
        type: 'connected-to-lobby',
        data: {}
    })

    await raceService.playerJoined(message.data);
    const updatedGame = await raceService.fetchGame();

    if (updatedGame)
        WebSocketService.broadcast({
            type: 'game-updated',
            data: updatedGame
        })
}

export const fetchGame = async (clientId: string, message: any) => {
    const gameInfo = await raceService.fetchGame();

    WebSocketService.sendToClient(clientId, {
        type: 'game-updated',
        data: gameInfo
    })
}

export const startGame = async (clientId: string, message: any) => {
    const gameInfo = await raceService.startGame();

    WebSocketService.broadcast({
        type: 'game-updated',
        data: gameInfo
    })
}

export const requestChat = async (clientId: string, message: any) => {
    const chat = await raceService.fetchChat();

    WebSocketService.sendToClient(clientId, {
        type: 'chat-updated',
        data: chat
    })
}

export const sendMessage = async (clientId: string, message: any) => {
    await raceService.sendMessage(message.data.player, message.data.message);

    WebSocketService.broadcast({
        type: 'chat-updated',
        data: await raceService.fetchChat()
    })
}

export const playerBid = async (clientId: string, message: any) => {
    const { player, amount } = message.data;

    if (!player.id || amount <= 0) return;

    player.bidAmount += amount;
    player.balance -= amount;
    await raceService.updatePlayer(player);
    await raceService.racerBid(player.bidRacer, amount);

    const updatedGame = await raceService.fetchGame();
    if (updatedGame)
        WebSocketService.broadcast({
            type: 'game-updated',
            data: updatedGame
        })
    WebSocketService.sendToClient(clientId, {
        type: 'player-updated',
        data: player
    })
}

export const nextStatus = async (clientId: string, message: any) => {
    const gameInfo = await raceService.fetchGame();
    if (!gameInfo) return;

    if (gameInfo.gameStatus === 'watching') {
        const newPlayers = await raceService.calculateGains();
        await raceService.swapToIntermission();

        WebSocketService.broadcast({
            type: 'bets-tabulated',
            data: newPlayers
        })
    }
    else if (gameInfo.gameStatus === 'intermission') {
        await raceService.nextRace();
    }

    const updatedGame = await raceService.fetchGame();
    if (updatedGame) {
        WebSocketService.broadcast({
            type: 'game-updated',
            data: updatedGame
        })
    }
}

export const closeBets = async (clientId: string, message: any) => {
    const gameInfo = await raceService.fetchGame();
    if (!gameInfo) return;

    await raceService.closeBets();

    const updatedGame = await raceService.fetchGame();
    if (updatedGame) {
        WebSocketService.broadcast({
            type: 'game-updated',
            data: updatedGame
        })
    }
}

export const RaceWebsocket = {
    actions: [
        {
            name: 'connected-to-lobby',
            middleware: connectToLobby
        },
        {
            name: 'ready',
            middleware: playerReady
        },
        {
            name: 'request-game',
            middleware: fetchGame
        },
        {
            name: 'start-game',
            middleware: startGame
        },
        {
            name: 'request-chat',
            middleware: requestChat
        },
        {
            name: 'send-message',
            middleware: sendMessage
        },
        {
            name: 'player-bid',
            middleware: playerBid
        },
        {
            name: 'next-status',
            middleware: nextStatus
        },
        {
            name: 'close-bets',
            middleware: closeBets
        }
    ]
}