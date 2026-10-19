# Racing game ("Chalet 2025")

A party betting game: players join from their phone (QR code on the admin screen), bet on marble
races shown on the big screen, chat, and the admin moves the game from betting to watching to
results. Extracted from master-trackers, where it lived at `/race`.

```
backend/    Node + TypeScript: websocket server (ws), Sequelize + MySQL (database racing_game)
frontend/   Angular 20: the player screen and the admin screen (?isAdmin=true)
```

## Setup

1. MySQL: create the database and load the data (races, racers with their images, the game row):
   ```bash
   mysql -u <user> -p -e "CREATE DATABASE IF NOT EXISTS racing_game CHARACTER SET utf8mb4"
   mysql -u <user> -p racing_game < backend/db/seed.sql
   ```
   The backend creates missing tables on startup (`sequelize.sync()`), but it needs at least one
   `game` row and the `race` / `racer` rows to have something to play.
2. Backend: copy `backend/.env.example` to `backend/.env` and fill in the database user.
   ```bash
   cd backend && npm install && npm start
   ```
   Listens on port 8084 (websocket on any path, `GET /health` for a check).
3. Frontend:
   ```bash
   cd frontend && npm install && npm start
   ```
   Opens on port 4200 and proxies `/ws` to the backend (`proxy.conf.json`).

## Playing

- Big screen (admin): `http://<host>:4200/?isAdmin=true`. It shows the QR code, the race video,
  the bets, and the buttons to start the game, close the bets and go to the next race.
- Players: scan the QR code (or open `http://<host>:4200/`), pick a name and a color, bet.

## Websocket messages

Client -> server (`race.<name>`): `connected-to-lobby`, `ready`, `request-game`, `start-game`,
`request-chat`, `send-message`, `player-bid`, `next-status`, `close-bets`.
Server -> client: `connected`, `player-connected`, `connected-to-lobby`, `game-updated`,
`player-updated`, `chat-updated`, `bets-tabulated`.

Game status flow: `waiting` -> `betting` -> `watching` -> `intermission` -> `betting` (next race).

## Production

Serve `frontend/dist/racing-game/browser` and proxy `/ws` to the backend on the same host
(`environment.ts` connects to `wss://<host>/ws`).
