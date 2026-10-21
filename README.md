# BlobBrawl.io

A real, server-authoritative multiplayer `.io` arena game. Eat glowing orbs, grow your blob, swallow smaller players, and climb the ranked leaderboard — in the browser, on desktop or phone, against people on other devices.

**No fake multiplayer.** Every blob you see in the arena is either a real player connected over WebSockets or a clearly labelled bot (`BOT` tag, grey nameplate). Movement, collisions, eliminations, rewards, currency and progression are computed on the server.

```
 ██████╗ ██╗      ██████╗ ██████╗ ██████╗ ██████╗  █████╗ ██╗    ██╗██╗
 ██╔══██╗██║     ██╔═══██╗██╔══██╗██╔══██╗██╔══██╗██╔══██╗██║    ██║██║
 ██████╔╝██║     ██║   ██║██████╔╝██████╔╝██████╔╝███████║██║ █╗ ██║██║
 ██╔══██╗██║     ██║   ██║██╔══██╗██╔══██╗██╔══██╗██╔══██║██║███╗██║██║
 ██████╔╝███████╗╚██████╔╝██████╔╝██║  ██║██║  ██║██║  ██║╚███╔███╔╝███████╗
 ╚═════╝ ╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚══╝╚══╝ ╚══════╝
```

---

## Quick start

```bash
git clone https://github.com/JanaGailaStudios/BlobBrawl.io.git
cd BlobBrawl.io
npm install
npm start
```

Open **http://localhost:3000**. To test real multiplayer, open the same URL on a second device on your network (`http://<your-lan-ip>:3000`) or on your phone — both players land in the same arena.

**Requirements:** Node.js **22.13+** (uses the built-in `node:sqlite` module, so there are no native build steps). Node 24 LTS is recommended.

```bash
npm test              # 26 server/integration checks over real Socket.IO clients
npm run test:client   # 16 headless DOM checks of the actual UI + game loop
npm run test:e2e      # 10 full-stack checks: real client in jsdom vs. real server
npm run test:all      # all of the above
```

### Configuration

Copy `.env.example` to `.env` (or set the variables in your host) and adjust:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP + WebSocket port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | `production` enables asset caching + warnings |
| `SECRET` | dev value | HMAC key used to derive opaque account tokens. **Always set in production.** |
| `DB_PATH` | `./data/blobbrawl.db` | SQLite file (WAL mode). Created automatically. |
| `MAX_ROOMS` | `4` | Maximum live arenas |
| `ROOM_CAPACITY` | `40` | Humans per arena before matchmaking opens another |
| `MIN_BOTS` / `MAX_BOTS` | `5` / `12` | Bot population bounds per arena |
| `TRUST_PROXY` | `0` | Set `1` behind Render/Fly/nginx so rate limits see real IPs |
| `CORS_ORIGIN` | – | Comma separated allowed origins (only needed for split frontend/backend hosting) |
| `LOG_GAMEPLAY` | `0` | Log every finished life for auditing |

> There is no fixed `.env` loader dependency: export the variables, or use your platform's env manager. `SECRET` should be a long random string:
> `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

---

## How to play

| Action | Desktop | Mobile |
| --- | --- | --- |
| Move | Mouse (steer toward cursor) or **WASD** / arrow keys | Left virtual joystick, or drag anywhere |
| Boost | Hold **Space**, hold **left click**, or tap the boost button | Hold the **BOOST** button |
| Back to menu | **Esc** | Leave button on the death screen |

* Orbs grow you. Small orbs give `3.5` mass, big ones `13`.
* You can only eat another blob when you are **18% bigger** and your body overlaps most of theirs.
* Boosting is **1.9× speed** but drains **4.5% of your mass per second**, locks out after `3.4s` of continuous burn and goes on a `2s` cooldown after you release.
* Bigger = slower. Speed scales as `mass^-0.175`, so a small blob can out-turn a giant.
* Death is cheap: respawn instantly with the full death screen and keep every coin, XP and rating point you earned.
* Every spawn gets **3 seconds of shield** (dashed ring) — you cannot eat or be eaten until it fades, so you are never farmed the moment you appear.

### Scoring & progression

* **Coins / XP** are calculated server-side from orbs, eliminations, survival time, peak mass and final placement.
* **Arena rating** (competitive leaderboard) moves after every life based on kills, orbs, placement, peak mass — and a small baseline decay.
* **Levels** unlock shop items; **daily missions** (3 per UTC day, deterministic per player) pay bonus coins/XP; **achievements** unlock permanently.
* **Shop** sells skins, trails and elimination effects. Some legendary cosmetics are **match-drop only** and cannot be bought.
* Cosmetics are strictly visual — no item changes speed, mass, vision or hitboxes. The server validates ownership before spawning your blob, and players who send unowned item IDs get the default look instead.

---

## What's in the game

**Gameplay**
- Single shared 5200×5200 arena per room with 2,600 respawning orbs with grid-accelerated collision lookups.
- Server-authoritative 30 Hz simulation, 10 Hz network snapshots with **client-side prediction** (local blob) and **snapshot interpolation** (remote blobs).
- Camera smoothing, size-adaptive zoom, screen shake, boost speed lines.
- Wobbling blobs, animated eyes, per-skin patterns, procedural nebula background, glowing orbs, particle trails, and distinct elimination effects (shockwave, fireworks, confetti, supernova, singularity).
- Bots with a real brain: they graze orbs, hunt smaller blobs, flee larger ones and boost to finish kills. Clearly marked `BOT`.

**Multiplayer**
- Socket.IO with WebSocket transport (polling fallback), automatic reconnect and a **5 second grace window** where the server keeps your blob alive so a short network blip does not kill you.
- Automatic matchmaking: players pack into the busiest non-full arena; new arenas open on demand.
- Live leaderboard, player count, join/kill feed, arena minimap, connection badge.
- Rate limiting on auth, inputs, shop actions and HTTP APIs; malformed packets are dropped without crashing a room.

**Progression & menus**
- Main menu (name, selected skin preview, live arena top 5, global ranks, daily missions, level bar).
- In-game HUD (size, score, kills, survival timer, boost meter, leaderboard, kill feed, minimap).
- Death screen with placement, kills, orbs, survival time, peak mass, coins, XP, rating delta, level-ups, achievements and rare drops — plus one-click respawn.
- Shop with three tabs, rarity badges, ownership/level gating, confirm modal and instant equip.
- Profile with career stats, rating/tier/global rank, achievements grid and match history.
- Ranks screen with rating / level / eliminations leaderboards and tier thresholds.
- Settings: audio volumes, graphics quality, grid, names, screen shake, controls (mouse/WASD/both), boost hold/toggle, reduced motion, colorblind patterns, large UI, high contrast — synced to your account.

**Audio** is 100% synthesised with the Web Audio API (no asset downloads): orbs, boost, eliminations, death, level-up, purchase, achievement, rare drop, plus an optional ambient music bed.

---

## Architecture

```
BlobBrawl.io
├── server/
│   ├── index.js          Express + Socket.IO wiring, event handlers, HTTP API
│   ├── config.js         Environment configuration
│   ├── db.js             SQLite schema + prepared-statement data layer (node:sqlite)
│   ├── progression.js    Rewards, rating, levels, missions, achievements, shop, drops
│   ├── security.js       Token hashing, name/input sanitising, rate limiter
│   └── game/engine.js    Authoritative simulation: rooms, movement, orbs, combat, bots
├── shared/
│   ├── physics.js        Constants + speed/radius/eat math (used by both sides)
│   └── catalog.js        Items, rarities, missions, achievements, tiers, XP curve
├── public/
│   ├── index.html        All screens
│   ├── css/style.css     UI system incl. responsive + accessibility modes
│   └── js/               ES modules: net, game (prediction), renderer, input, audio, ui
├── test/                 Integration + headless client tests
├── data/                 SQLite database (git-ignored)
├── Dockerfile
└── render.yaml
```

### Authoritative loop

```
client                         server (30 Hz)                     database
──────                         ─────────────                     ────────
input {x,y,b}  ──────────────▶ validate + rate limit
(≤20/s)                        movement, boost drain
                               orb collision (spatial grid)
                               blob-vs-blob combat
◀────────────  snap (10 Hz)    snapshot of positions + orb deltas
◀────────────  board (2 Hz)    top 10 + player count
◀────────────  feed           kill notifications
◀────────────  death          { stats, summary }               applyLife + rewards
                                                               missions / achievements
                                                               match_log row
◀────────────  profile        updated coins, XP, level, rating
```

The client only ever sends a **direction vector** and a **boost flag**, clamped to `[-1.2, 1.2]` and rate-limited to ~110 packets/second. It cannot report mass, kills, orbs, coins or scores. On every snapshot the client receives the server's radius for its own blob; mass is derived from that authoritative radius and blended locally, so even a modified client cannot lie about its size.

### Security model

- **Accounts** — a random 32-byte token is issued on first visit and stored in `localStorage`; the database only ever sees an HMAC-SHA256 hash of it (`SECRET`). Clearing storage creates a new profile.
- **Validation** — every socket event checks auth, object shape and ranges. Unknown events and malformed payloads are ignored.
- **Rate limits** — sliding-window limiters for auth (40/min/IP), inputs (110/s/socket), profile/shop/mission actions (12 per 2s) and HTTP APIs (120/min/IP).
- **No trust in the client** — prices, currency, rewards, ratings, kills and cosmetics all come from server-side state. Shop purchases deduct the server price exactly once inside a transaction.
- **Match integrity** — an account can only own one live blob; rejoining refreshes cosmetics instead of stacking lives. Disconnect grace prevents "refresh to escape".
- **HTTP hardening** — CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, JSON body limit, 100 kB socket frame ceiling.
- **Names** — unicode letters/numbers/` _-.` only, 2–16 chars, `BOT` prefix reserved, HTML-escaped everywhere in the UI.

---

## Deploying for real multiplayer

The game is a single Node process — deploy it anywhere that supports WebSockets.

### Render (blueprint included)

1. Push this repository to GitHub.
2. Render → **New → Blueprint** → pick the repo. `render.yaml` provisions the service, generates `SECRET`, sets `TRUST_PROXY`, and mounts a 1 GB disk at `/var/data` for SQLite.
3. Open the generated `https://<service>.onrender.com` URL. Share it — players on any device join the same arena.

### Fly.io

```bash
fly launch --no-deploy          # choose the Dockerfile
fly volumes create blobdata --size 1
# in fly.toml: [mounts] source="blobdata" destination="/app/data"
fly secrets set SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
fly deploy
```

### Docker / VPS

```bash
docker build -t blobbrawl .
docker run -d --name blobbrawl -p 3000:3000 \
  -e NODE_ENV=production \
  -e SECRET="$(openssl rand -base64 48)" \
  -v blobbrawl-data:/app/data \
  blobbrawl
```

Put nginx/Caddy in front for TLS and keep WebSocket upgrades enabled:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_read_timeout 120s;
}
```

**Notes**
- SQLite lives on a single attached disk. Run **one instance** per database (horizontal scale would need Redis/Postgres for state). The game comfortably handles dozens of concurrent players per process.
- Use a persistent disk; without one, progression resets on redeploy.
- Set `TRUST_PROXY=1` and `NODE_ENV=production`.
- Health check: `GET /api/health`. Live arena data: `GET /api/live`.

### HTTP API

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Liveness probe, uptime, version |
| `GET /api/stats` | Online humans, bots, rooms, orbs |
| `GET /api/live` | Top blobs currently in every arena (used by the menu) |
| `GET /api/leaderboard?kind=rating\|level\|kills&limit=25` | Global ranked boards |
| `GET /api/catalog` | Skins, trails, effects, achievements, rarities |

### Socket events

| Direction | Event | Payload |
| --- | --- | --- |
| → server | `hello` | `{ token?, name? }` → ack `{ token, profile, missions, history }` |
| → server | `play` | `{ skin, trail, effect }` (cosmetics re-validated) |
| → server | `input` | `{ x, y, b }` (≤20 Hz recommended) |
| → server | `leave`, `profile:get`, `shop:buy`, `item:equip`, `mission:claim`, `name:set`, `settings:save`, `leaderboard:get` | |
| → client | `joined`, `snap`, `board`, `roster`, `feed`, `death`, `profile`, `welcome`, `kicked` | |

---

## Database

SQLite (WAL) with tables: `players`, `unlocks`, `missions`, `achievements`, `match_log`. The schema is created automatically on first boot — see `server/db.js`.

To wipe progression: stop the server and delete `data/blobbrawl.db*`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Cannot find module 'node:sqlite'` | Upgrade to Node 22.13+ (or pass `--experimental-sqlite` on 22.5–22.12) |
| Blobs don't move for others | A proxy is buffering WebSockets — enable `Upgrade`/`Connection` headers and raise `proxy_read_timeout` |
| Everyone disconnects every 30s | Reverse proxy timeout too low, or an intermediate proxy strips upgrades |
| Players all report each other as bots | Check you're on the same deployed URL, not two different hosts |
| Progression resets on redeploy | Attach a persistent disk and set `DB_PATH` to it |
| `Slow down` toast when joining | The `play` handler is rate limited to one join per 700 ms per socket |

## License

MIT. Have fun, and remember: it's never about the orbs, it's about the blob next to the orbs.
