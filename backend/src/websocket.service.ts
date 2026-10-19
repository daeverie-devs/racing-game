import WebSocket, { WebSocketServer } from 'ws';
import { Server } from 'http';
import {RaceWebsocket} from "./race.websocket";

interface ClientData {
    ws: WebSocket;
    metadata: Record<string, any>;
}

interface WebSocketMessage {
    type: string;
    data?: any;
    token?: string;
}

class WebSocketService {
    private wss: WebSocketServer | null = null;
    private clients: Map<string, ClientData> = new Map();

    initialize(server: Server): void {
        this.wss = new WebSocketServer({ server });

        this.wss.on('connection', (ws: WebSocket, req) => {
            const clientId = this.generateClientId();

            // Store client with metadata
            this.clients.set(clientId, {
                ws,
                metadata: {}
            });

            ws.on('message', (message: Buffer) => {
                this.handleMessage(clientId, message);
            });

            ws.on('close', () => {
                this.clients.delete(clientId);
                console.log(`Client ${clientId} disconnected`);
            });

            ws.on('error', (error: Error) => {
                console.error(`WebSocket error for ${clientId}:`, error);
            });

            // Send welcome message
            this.sendToClient(clientId, {
                type: 'connected',
                data: { clientId }
            });
        });
    }

    private handleMessage(clientId: string, message: Buffer): void {
        try {
            const data: WebSocketMessage = JSON.parse(message.toString());
            let handled = false;
            console.log(`Message from ${clientId}:`, data);

            RaceWebsocket.actions.map(action => this.addServiceName(action, 'race')).map(action => {
                if (data.type === action.name) {
                    action.middleware(clientId, data).then();
                    handled = true;
                }
            })

            if (!handled)
                console.log(`Unknown message type: ${data.type}`);
        } catch (error) {
            console.error('Error handling message:', error);
        }
    }

    private addServiceName(action: any, name: string) {
        return {...action, name: name + '.' + action.name};
    }

    sendToClient(clientId: string, data: WebSocketMessage): boolean {
        const client = this.clients.get(clientId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify(data));
            return true;
        }
        return false;
    }

    broadcast(data: WebSocketMessage): number {
        let sentCount = 0;
        this.clients.forEach((client) => {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify(data));
                sentCount++;
            }
        });
        return sentCount;
    }

    getClientCount(): number {
        return this.clients.size;
    }

    private generateClientId(): string {
        return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

export default new WebSocketService();