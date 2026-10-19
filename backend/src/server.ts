import 'dotenv/config';
import * as http from 'node:http';
import { sequelize } from './sequelize';
import WebsocketService from './websocket.service';
// Registers the models before sync()
import './models/game.model';
import './models/player.model';
import './models/message.model';
import './models/race.model';
import './models/racer.model';

const PORT = Number(process.env.PORT) || 8084;

// The game talks only through the websocket; plain HTTP answers a health check
const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, clients: WebsocketService.getClientCount() }));
        return;
    }
    res.writeHead(404);
    res.end();
});

const startServer = async () => {
    try {
        await sequelize.authenticate();
        await sequelize.sync();
        WebsocketService.initialize(server);

        server.listen({ port: PORT, host: '0.0.0.0' }, () => {
            console.log(`Racing game server running on port ${PORT}`);
        });
    } catch (err) {
        console.error('DB connection failed:', err);
        process.exit(1);
    }
};

startServer();
