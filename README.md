# Racing game ("Hippodrome")

A party betting game: players join from their phone (QR code on the big screen), build a character,
bet on races shown on the big screen, chat, and the admin runs the game from betting to results.
At the end, awards give bonuses and the podium is revealed one place at a time.

```
backend/    Node + TypeScript: websocket server (ws), Sequelize + MySQL
frontend/   Angular 20: the phone screen (/) and the big screen with the admin controls (/admin)
```

## Setup

1. MySQL: create an empty database. The backend creates its tables on startup.
   ```bash
   mysql -u <user> -p -e "CREATE DATABASE IF NOT EXISTS racing_game_v2 CHARACTER SET utf8mb4"
   ```
2. Backend: copy `backend/.env.example` to `backend/.env`, fill in the database user and pick an
   `ADMIN_PASSCODE` (the code that unlocks `/admin`).
   ```bash
   cd backend && npm install && npm start
   ```
   Listens on port 8084: the websocket on any path, `GET /health`, and the racer pictures on
   `GET /api/racers/:id/image`.
3. Frontend:
   ```bash
   cd frontend && npm install && npm start
   ```
   Opens on port 4200 and proxies `/ws` and `/api` to the backend (`proxy.conf.json`).

## Playing

- Big screen: open `http://<laptop IP>:4200/admin` (not `localhost`, or the QR code points phones to
  themselves) and enter the admin code.
- Editor (pencil icon in the admin bar): add racers (paste a screenshot with Ctrl+V, or drop a
  PNG/JPEG), create races (a YouTube link with `?t=` for the start time, the racers, and the winner
  as a star), or player races where the runners are picked from the lobby when the race comes up.
  Group races into games and choose which game is active.
- Players scan the QR code, build their character and join. A locked or reloaded phone goes straight
  back into the game.
- Each race opens with a morning line, as at a racetrack: the house stakes 150 $ per player, split
  by a random draw around each racer's record, so every racer shows starting odds (2.6× to 31×).
- Players pick a racer and an amount on their phone (at least 5 % of their balance) and lock in.
  Bets are revealed when everyone is locked, or when the admin's countdown runs out (unlocked picks
  are locked as they are, raised to the minimum; no pick = pass).
- The admin confirms the winner. Pari-mutuel payout: the whole pot is shared among the stakes on the
  winner, house included; a winning bet returns between 1.05× and 10× its stake. The house's share
  and anything over the cap go to the pool, which sits on the next race's racers. The last race
  pays double.
- Under 100 $, a player can borrow up to 1000 $ at a time; loans come off the final score, and the
  biggest borrower's award costs half an award bonus.

## Game flow

`lobby` → (`lineup` for player races) → `betting` → `watching` → `results` → next race … →
`awards` (one at a time, +bonus each) → `podium` (4th and below, then 3rd, 2nd, 1st).

The rules live in `backend/src/game/` (`engine.ts` for the flow and payouts, `rules.ts` for limits
and the math, `state.ts` for what each screen receives). Every action runs one at a time through
`queue.ts`, so simultaneous taps can't overwrite each other.

## Scripts (backend)

- `npm run simulate`: plays a whole game against the running backend with 20 fake phones and checks
  the rules (money conserved, lock-in, pool, loans, awards, podium), then removes its test data.
- `npm run balance -- 3000`: simulates thousands of games of 8 to 12 players with the real payout
  and award rules and prints, per rule variant, how often each betting style wins (no server needed).
- `npm run reset-db`: puts the active game back in the lobby (players, bets and chat removed, races
  kept). Same as the restart button in the admin bar.
- `npm run db:rebuild`: drops every table and recreates them empty.

## Production

Serve `frontend/dist/racing-game/browser` and proxy `/ws` and `/api` to the backend on the same host.
