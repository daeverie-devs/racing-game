import 'dotenv/config';
import * as http from 'node:http';
import {sequelize} from './sequelize';
import {Racer} from './models';
import {restoreDeadline} from './game/engine';
import {getConnectionCount, initSocket} from './net/socket';

const PORT = Number(process.env.PORT) || 8084;
const IMAGE_ROUTE = /^\/api\/racers\/(\d+)\/image(?:\?.*)?$/;

// The game talks through the websocket; plain HTTP serves a health check and the racer images
const server = http.createServer(async (req, res) => {
    try {
        if (req.url === '/health') {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({ok: true, clients: getConnectionCount()}));
            return;
        }
        const match = req.url ? IMAGE_ROUTE.exec(req.url) : null;
        if (match && req.method === 'GET') {
            const racer = await Racer.findByPk(Number(match[1]), {attributes: ['image', 'imageType']});
            if (!racer?.image || !racer.imageType) {
                res.writeHead(404);
                res.end();
                return;
            }
            // The URL carries the image version, so it never changes: phones download it once
            res.writeHead(200, {'Content-Type': racer.imageType, 'Cache-Control': 'public, max-age=31536000, immutable'});
            res.end(racer.image);
            return;
        }
        res.writeHead(404);
        res.end();
    } catch (err) {
        console.error('HTTP request failed:', err);
        res.writeHead(500);
        res.end();
    }
});

const startServer = async () => {
    try {
        await sequelize.authenticate();
        await sequelize.sync();
        initSocket(server);
        await restoreDeadline();

        server.listen({port: PORT, host: '0.0.0.0'}, () => {
            console.log(`Racing game server running on port ${PORT}`);
        });
    } catch (err) {
        console.error('DB connection failed:', err);
        process.exit(1);
    }
};

// Last line of defense: log and keep the game running instead of exiting
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

startServer();
