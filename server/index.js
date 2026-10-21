'use strict';
/**
 * BlobBrawl.io server
 * -------------------
 * Express serves the static client and a small read-only API.
 * Socket.IO carries the realtime game loop. Every gameplay value is produced
 * by the authoritative simulation in server/game/engine.js.
 */
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const config = require('./config');
const { getStore } = require('./db');
const security = require('./security');
const progression = require('./progression');
const catalog = require('../shared/catalog');
const { GameServer } = require('./game/engine');

const store = getStore();
const app = express();
const server = http.createServer(app);

const corsOrigin = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : false;
const io = new Server(server, {
  cors: corsOrigin ? { origin: corsOrigin, methods: ['GET', 'POST'] } : undefined,
  pingInterval: 10000,
  pingTimeout: 12000,
  maxHttpBufferSize: 1e5,
  transports: ['websocket', 'polling']
});

app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; base-uri 'self'"
  );
  next();
});

// ---------------------------------------------------------------- game hooks
const gameServer = new GameServer(io, {
  hooks: {
    onLifeEnd(player, stats, reason) {
      const summary = progression.applyLifeResult(store, player.accountId, stats);
      if (summary && player.socketId) {
        io.to(player.socketId).emit('profile', progression.serializePlayer(store, player.accountId));
      }
      if (config.logGameplay) {
        console.log(`[life] ${player.name}(${player.accountId}) ${reason} kills=${stats.kills} orbs=${stats.orbs} mass=${stats.maxMass} rank=${stats.rank}`);
      }
      return summary;
    }
  },
  maxRooms: config.maxRooms,
  roomCapacity: config.roomCapacity,
  minBots: config.minBots,
  maxBots: config.maxBots
});

// ------------------------------------------------------------------- helpers
function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function profilePayload(playerId) {
  const player = store.getPlayer(playerId);
  if (!player) return null;
  return {
    profile: progression.serializePlayer(store, playerId),
    missions: progression.getMissionBoard(store, playerId, player),
    history: store.recentMatches(playerId, 8)
  };
}

function emitProfile(socket) {
  if (!socket.data.profileId) return null;
  const payload = profilePayload(socket.data.profileId);
  if (payload) socket.emit('profile', payload.profile);
  return payload;
}

function roomOf(socket) {
  return gameServer.getRoomForSocket(socket);
}

function playerOf(socket) {
  const room = roomOf(socket);
  if (!room) return null;
  const p = room.players.get(socket.data.playerId);
  if (!p || p.socketId !== socket.id) return null;
  return p;
}

const authLimiter = new security.RateLimiter(40, 60_000);
const apiLimiter = new security.RateLimiter(120, 60_000);

// --------------------------------------------------------------------- API
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()), version: '1.0.0', now: Date.now() });
});

app.get('/api/stats', (req, res) => {
  if (!apiLimiter.hit(req.ip)) return res.status(429).json({ error: 'Too many requests' });
  const engine = gameServer.stats();
  res.json(Object.assign({ online: engine.humans, registered: store.stats().players, uptime: Math.round(process.uptime()) }, engine));
});

app.get('/api/live', (req, res) => {
  if (!apiLimiter.hit(req.ip)) return res.status(429).json({ error: 'Too many requests' });
  const entries = [];
  for (const room of gameServer.rooms.values()) {
    for (const e of room.getBoard(10)) entries.push(Object.assign({ room: room.id }, e));
  }
  entries.sort((a, b) => b.mass - a.mass);
  const engine = gameServer.stats();
  res.json({ top: entries.slice(0, 8), online: engine.humans, bots: engine.bots, rooms: engine.rooms });
});

let boardCache = { at: 0, data: {} };
app.get('/api/leaderboard', (req, res) => {
  if (!apiLimiter.hit(req.ip)) return res.status(429).json({ error: 'Too many requests' });
  const kind = ['rating', 'level', 'kills'].includes(req.query.kind) ? req.query.kind : 'rating';
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 25));
  if (Date.now() - boardCache.at > 5000) {
    boardCache = {
      at: Date.now(),
      data: {
        rating: store.leaderboard('rating', 50),
        level: store.leaderboard('level', 50),
        kills: store.leaderboard('kills', 50)
      }
    };
  }
  res.json({ kind, entries: boardCache.data[kind].slice(0, limit).map((e, i) => Object.assign(e, { rank: i + 1 })) });
});

app.get('/api/catalog', (req, res) => {
  res.json({
    skins: catalog.SKINS,
    trails: catalog.TRAILS,
    effects: catalog.EFFECTS,
    achievements: catalog.ACHIEVEMENTS,
    missions: catalog.MISSION_POOL.map((m) => ({ id: m.id, name: m.name, icon: m.icon })),
    rarities: catalog.RARITIES
  });
});

// Static client. `index: false` lets us set no-cache on the HTML entrypoint.
const publicDir = path.join(__dirname, '..', 'public');
app.use('/shared', express.static(path.join(__dirname, '..', 'shared'), { maxAge: '5m' }));
app.use(express.static(publicDir, { index: false, maxAge: config.nodeEnv === 'production' ? '10m' : 0 }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ----------------------------------------------------------------- Socket.IO
io.on('connection', (socket) => {
  socket.data.profileId = null;
  socket.data.roomId = null;
  socket.data.playerId = null;
  socket.data.lastPlay = 0;
  const inputLimiter = new security.RateLimiter(110, 1000);
  const actionLimiter = new security.RateLimiter(12, 2000);

  socket.on('hello', (payload, ack) => {
    try {
      if (!authLimiter.hit(socket.handshake.address || socket.id)) {
        return ack && ack({ ok: false, error: 'Too many connection attempts. Try again shortly.' });
      }
      const data = payload && typeof payload === 'object' ? payload : {};
      let requestedName = security.sanitizeName(data.name, '');
      if (requestedName.length < 2 || security.isBotNameReserved(requestedName)) requestedName = '';
      const tokenHash = security.hashToken(data.token);
      let token = typeof data.token === 'string' ? data.token : null;
      let row = tokenHash ? store.getPlayerByTokenHash(tokenHash) : null;

      if (!row) {
        token = newToken();
        const hash = security.hashToken(token);
        row = store.getOrCreatePlayer(hash, requestedName || 'Blob');
      } else {
        store.getOrCreatePlayer(tokenHash, requestedName || row.name);
        row = store.getPlayerByTokenHash(tokenHash);
      }

      socket.data.profileId = row.id;
      const payloadOut = profilePayload(row.id);
      if (ack) ack({ ok: true, token, profile: payloadOut.profile, missions: payloadOut.missions, history: payloadOut.history, now: Date.now() });
      socket.emit('welcome', {
        token,
        profile: payloadOut.profile,
        missions: payloadOut.missions,
        history: payloadOut.history,
        now: Date.now(),
        server: { maxRooms: config.maxRooms, arenaCapacity: config.roomCapacity, tickRate: 30 }
      });
    } catch (err) {
      console.error('[socket] hello failed', err);
      if (ack) ack({ ok: false, error: 'Could not create a profile. Please retry.' });
    }
  });

  socket.on('play', (payload, ack) => {
    const done = (res) => ack && ack(res);
    try {
      if (!socket.data.profileId) return done({ ok: false, error: 'Not signed in yet' });
      const now = Date.now();
      if (now - socket.data.lastPlay < 700) return done({ ok: false, error: 'Slow down' });
      socket.data.lastPlay = now;

      const data = payload && typeof payload === 'object' ? payload : {};
      const profile = store.getPlayer(socket.data.profileId);
      if (!profile) return done({ ok: false, error: 'Profile missing' });

      // Cosmetics are validated server-side; unowned items fall back to defaults.
      const owned = new Set(store.getUnlocks(profile.id).map((u) => u.id));
      const skin = owned.has(data.skin) ? data.skin : profile.skin;
      const trail = owned.has(data.trail) ? data.trail : profile.trail;
      const effect = owned.has(data.effect) ? data.effect : profile.effect;
      if (skin !== profile.skin || trail !== profile.trail || effect !== profile.effect) {
        store.setLoadout(profile.id, skin, trail, effect);
      }

      let room = roomOf(socket);
      let player = null;

      // Already alive on this socket? Refresh cosmetics instead of spawning a
      // duplicate blob (clients used to be able to stack lives this way).
      if (room) {
        const own = room.players.get(socket.data.playerId);
        if (own && own.socketId === socket.id && !own.dead) {
          own.skin = skin;
          own.trail = trail;
          own.effect = effect;
          if (room.roster.has(own.id)) {
            Object.assign(room.roster.get(own.id), { skin, trail, effect });
            room.broadcastRoster();
          }
          socket.emit('joined', room.initialState(own));
          socket.emit('board', { top: room.getBoard(10), players: room.players.size });
          return done({ ok: true, roomId: room.id, playerId: own.id, refreshed: true });
        }
      }

      // Look for a blob we can reattach to before matchmaking a fresh arena.
      for (const candidate of gameServer.rooms.values()) {
        const found = candidate.findReconnect(profile.id);
        if (found) { room = candidate; player = found; break; }
      }
      if (!room) room = gameServer.matchmake();

      if (player) {
        // Seamless reconnect: reuse the blob that is still on the field.
        if (player.socketId && player.socketId !== socket.id) {
          io.to(player.socketId).emit('kicked', { reason: 'Session opened elsewhere' });
        }
        room.reattach(player, socket.id);
        player.skin = skin;
        player.trail = trail;
        player.effect = effect;
        if (room.roster.has(player.id)) {
          Object.assign(room.roster.get(player.id), { skin, trail, effect });
          room.broadcastRoster();
        }
      } else {
        player = room.addPlayer({
          accountId: profile.id,
          socketId: socket.id,
          name: profile.name,
          skin,
          trail,
          effect,
          mass: 100
        });
      }

      if (socket.data.roomId && socket.data.roomId !== room.id) socket.leave(socket.data.roomId);
      socket.join(room.id);
      socket.data.roomId = room.id;
      socket.data.playerId = player.id;
      player.socketId = socket.id;
      socket.data.name = profile.name;

      socket.emit('joined', room.initialState(player));
      socket.emit('board', { top: room.getBoard(10), players: room.players.size });
      done({ ok: true, roomId: room.id, playerId: player.id });
    } catch (err) {
      console.error('[socket] play failed', err);
      done({ ok: false, error: 'Could not join an arena' });
    }
  });

  socket.on('input', (msg) => {
    try {
      if (!inputLimiter.hit(socket.id)) return;
      if (!msg || typeof msg !== 'object') return;
      const player = playerOf(socket);
      if (!player) return;
      const dx = security.num(msg.x, -1.2, 1.2, 0);
      const dy = security.num(msg.y, -1.2, 1.2, 0);
      if (Math.abs(dx) < 0.02 && Math.abs(dy) < 0.02) {
        player.setInput(0, 0, !!msg.b);
      } else {
        player.setInput(dx, dy, !!msg.b);
      }
    } catch { /* malformed input is dropped */ }
  });

  socket.on('leave', (payload, ack) => {
    const room = roomOf(socket);
    if (room) {
      const player = room.players.get(socket.data.playerId);
      if (player) room.endLife(player, { reason: 'leave' });
      socket.leave(room.id);
    }
    socket.data.roomId = null;
    socket.data.playerId = null;
    if (ack) ack({ ok: true });
  });

  socket.on('profile:get', (payload, ack) => {
    if (!actionLimiter.hit(socket.id)) return ack && ack({ ok: false, error: 'Too many requests' });
    const payloadOut = socket.data.profileId ? profilePayload(socket.data.profileId) : null;
    if (!payloadOut) return ack && ack({ ok: false, error: 'Not signed in' });
    ack && ack({ ok: true, profile: payloadOut.profile, missions: payloadOut.missions, history: payloadOut.history });
  });

  socket.on('mission:claim', (payload, ack) => {
    if (!socket.data.profileId) return ack && ack({ ok: false, error: 'Not signed in' });
    if (!actionLimiter.hit(socket.id)) return ack && ack({ ok: false, error: 'Too many requests' });
    const missionId = payload && typeof payload.id === 'string' ? payload.id.slice(0, 32) : '';
    const result = progression.claimMissionReward(store, socket.data.profileId, missionId);
    const payloadOut = profilePayload(socket.data.profileId);
    ack && ack(Object.assign({}, result, { profile: payloadOut.profile, missions: payloadOut.missions }));
    if (result.ok && payloadOut) socket.emit('profile', payloadOut.profile);
  });

  socket.on('shop:buy', (payload, ack) => {
    if (!socket.data.profileId) return ack && ack({ ok: false, error: 'Not signed in' });
    if (!actionLimiter.hit(socket.id)) return ack && ack({ ok: false, error: 'Too many requests' });
    const itemId = payload && typeof payload.id === 'string' ? payload.id.slice(0, 48) : '';
    const result = progression.buyItem(store, socket.data.profileId, itemId);
    const payloadOut = profilePayload(socket.data.profileId);
    ack && ack(Object.assign({}, result, { profile: payloadOut.profile }));
    if (result.ok && payloadOut) socket.emit('profile', payloadOut.profile);
  });

  socket.on('item:equip', (payload, ack) => {
    if (!socket.data.profileId) return ack && ack({ ok: false, error: 'Not signed in' });
    if (!actionLimiter.hit(socket.id)) return ack && ack({ ok: false, error: 'Too many requests' });
    const itemId = payload && typeof payload.id === 'string' ? payload.id.slice(0, 48) : '';
    const result = progression.equipItem(store, socket.data.profileId, itemId);
    const payloadOut = profilePayload(socket.data.profileId);
    ack && ack(Object.assign({}, result, { profile: payloadOut.profile }));
    if (result.ok && payloadOut) socket.emit('profile', payloadOut.profile);
  });

  socket.on('name:set', (payload, ack) => {
    if (!socket.data.profileId) return ack && ack({ ok: false, error: 'Not signed in' });
    if (!actionLimiter.hit(socket.id)) return ack && ack({ ok: false, error: 'Too many requests' });
    const name = security.sanitizeName(payload && payload.name, null);
    if (!name) return ack && ack({ ok: false, error: 'Pick a name with 2-16 characters' });
    if (security.isBotNameReserved(name)) return ack && ack({ ok: false, error: 'That name is reserved' });
    store.setName(socket.data.profileId, name);
    const room = roomOf(socket);
    if (room && room.roster.has(socket.data.playerId)) {
      room.roster.get(socket.data.playerId).name = name;
      room.broadcastRoster();
      const p = room.players.get(socket.data.playerId);
      if (p) p.name = name;
    }
    const payloadOut = profilePayload(socket.data.profileId);
    ack && ack({ ok: true, profile: payloadOut.profile });
    if (payloadOut) socket.emit('profile', payloadOut.profile);
  });

  socket.on('settings:save', (payload, ack) => {
    if (!socket.data.profileId) return ack && ack({ ok: false, error: 'Not signed in' });
    if (!actionLimiter.hit(socket.id)) return ack && ack({ ok: false, error: 'Too many requests' });
    const input = payload && typeof payload.settings === 'object' && payload.settings ? payload.settings : {};
    const clean = {};
    const allow = ['sound', 'music', 'quality', 'showGrid', 'showNames', 'reducedMotion', 'colorblind', 'controlMode', 'sfxVolume', 'musicVolume'];
    for (const key of allow) {
      if (typeof input[key] === 'boolean' || typeof input[key] === 'string') clean[key] = String(input[key]).slice(0, 24);
      else if (typeof input[key] === 'number' && Number.isFinite(input[key])) clean[key] = input[key];
    }
    store.saveSettings(socket.data.profileId, JSON.stringify(clean));
    ack && ack({ ok: true, settings: clean });
  });

  socket.on('leaderboard:get', (payload, ack) => {
    if (!actionLimiter.hit(socket.id)) return ack && ack({ ok: false, error: 'Too many requests' });
    const kind = payload && ['rating', 'level', 'kills'].includes(payload.kind) ? payload.kind : 'rating';
    ack && ack({ ok: true, kind, entries: store.leaderboard(kind, 25) });
  });

  socket.on('ping:time', (payload, ack) => { if (ack) ack({ now: Date.now() }); });

  socket.on('disconnect', () => {
    try {
      const room = roomOf(socket);
      if (room) {
        const player = room.players.get(socket.data.playerId);
        if (player && player.socketId === socket.id) room.handleSocketLoss(player);
      }
    } catch (err) {
      console.error('[socket] disconnect handling failed', err);
    }
  });

  socket.on('error', (err) => console.warn('[socket] error', socket.id, err && err.message));
});

// ------------------------------------------------------------------ startup
if (require.main === module) {
  server.listen(config.port, config.host, () => {
    console.log(`\n  🔵 BlobBrawl.io running`);
    console.log(`     local:   http://localhost:${config.port}`);
    console.log(`     network: http://${config.host}:${config.port}`);
    console.log(`     env:     ${config.nodeEnv}`);
    console.log(`     db:      ${config.dbPath}\n`);
  });
}

function shutdown(signal) {
  console.log(`\n[server] ${signal} received, shutting down...`);
  gameServer.stop();
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, server, io, gameServer, store };
