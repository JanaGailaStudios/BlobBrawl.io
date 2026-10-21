'use strict';
/**
 * BlobBrawl.io authoritative arena simulation.
 *
 * Everything that matters (movement, mass, eating, eliminations, ranking) is
 * computed here on the server. Clients only ever send a unit direction vector
 * and a boost flag, which is validated and rate limited before it is applied.
 */
const P = require('../../shared/physics');
const catalog = require('../../shared/catalog');

const GRID_CELL = 250;
const GRID_COLS = Math.ceil(P.WORLD_SIZE / GRID_CELL);
const RECONNECT_GRACE = 5000;
const SKIN_INDEX = new Map(catalog.SKINS.map((s, i) => [s.id, i]));

const BOT_NAMES = [
  'Nibbles', 'Blobzilla', 'GooGoo', 'Squishy', 'Orb Goblin', 'Wobble', 'Jellybean',
  'Pudding', 'Chomper', 'Bubbles', 'Slimey', 'Munch', 'Gulp', 'Splat', 'Gloop',
  'Wiggles', 'Bloop', 'Taffy', 'Mochi', 'Gummy', 'Sprinkles', 'Dumpling', 'Marmalade',
  'Zoop', 'Fizz', 'Noodle', 'Biscuit', 'Peanut', 'Waffles', 'Chonk', 'Jiggle', 'Boba'
];

const BOT_SKINS = catalog.SKINS.filter((s) => s.price <= 1200).map((s) => s.id);

let nextEntityId = 1;

function rand(min, max) { return min + Math.random() * (max - min); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

class Orb {
  constructor(id, x, y, big) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.big = big;
    this.mass = big ? P.ORB.BIG_MASS : P.ORB.SMALL_MASS;
    this.r = big ? P.ORB.RADIUS_BIG : P.ORB.RADIUS_SMALL;
    this.color = (Math.random() * P.PALETTE.length) | 0;
  }
  toWire() { return [this.id, Math.round(this.x), Math.round(this.y), Math.round(this.r), this.color, this.big ? 1 : 0]; }
}

class Player {
  constructor(room, opts) {
    this.id = nextEntityId++;
    this.room = room;
    this.accountId = opts.accountId || null;
    this.socketId = opts.socketId || null;
    this.name = opts.name || 'Blob';
    this.isBot = !!opts.isBot;
    this.skin = opts.skin || 'bubblegum';
    this.trail = opts.trail || 'trail_none';
    this.effect = opts.effect || 'fx_pop';

    this.mass = opts.mass || P.START_MASS;
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.dirX = 0;
    this.dirY = 0;
    this.boosting = false;
    this.boostTimer = 0;
    this.boostCooldown = 0;
    this.boostSeconds = 0;
    this.boostingThisTick = false;

    this.kills = 0;
    this.orbs = 0;
    this.maxMass = this.mass;
    this.spawnedAt = Date.now();
    this.peakMass = this.mass;
    this.disconnectedAt = 0;
    this.dead = false;
    this.beingEaten = false;
    this.ended = false;
    this.protectUntil = Date.now() + (opts.protected === false ? 0 : P.SPAWN_PROTECT * 1000);

    // bot brain
    this.think = 0;
    this.targetOrb = null;
    this.wander = Math.random() * Math.PI * 2;
  }

  get radius() { return P.radiusFromMass(this.mass); }
  get skinIndex() { return SKIN_INDEX.get(this.skin) || 0; }

  setInput(dx, dy, boost) {
    this.dirX = dx;
    this.dirY = dy;
    const next = !!boost;
    if (this.boosting && !next && this.boostTimer > 0.12) {
      this.boostCooldown = P.BOOST.COOLDOWN;
    }
    this.boosting = next;
  }

  get protected() { return Date.now() < this.protectUntil; }

  toWire() {
    return [
      this.id,
      Math.round(this.x * 10) / 10,
      Math.round(this.y * 10) / 10,
      Math.round(this.radius * 10) / 10,
      this.skinIndex,
      (this.boostingThisTick ? 1 : 0) | (this.isBot ? 2 : 0) | (this.protected ? 4 : 0)
    ];
  }

  toPublic() {
    return {
      id: this.id,
      name: this.name,
      mass: Math.round(this.mass),
      isBot: this.isBot,
      skin: this.skin,
      trail: this.trail,
      effect: this.effect
    };
  }
}

class Room {
  constructor(id, options) {
    this.id = id;
    this.io = options.io;
    this.hooks = options.hooks || {};
    this.capacity = options.capacity || 40;
    this.minBots = options.minBots || 5;
    this.maxBots = options.maxBots || 12;
    this.players = new Map();
    this.roster = new Map();
    this.orbs = new Map();
    this.nextOrbId = 1;
    this.tickCount = 0;
    this.pendingOrbAdd = [];
    this.pendingOrbRemove = [];
    this.botTimer = 0;
    this.lastBotSweep = 0;
    this.active = false;

    for (let i = 0; i < P.ORB_COUNT; i++) this.spawnOrb();
  }

  // ---------------------------------------------------------------- helpers
  get humans() {
    let n = 0;
    for (const p of this.players.values()) if (!p.isBot) n++;
    return n;
  }

  get socketCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.isBot && p.socketId) n++;
    return n;
  }

  randomPoint(margin = 120) {
    return {
      x: rand(margin, P.WORLD_SIZE - margin),
      y: rand(margin, P.WORLD_SIZE - margin)
    };
  }

  spawnOrb() {
    const pos = this.randomPoint(60);
    const big = Math.random() < P.ORB.BIG_CHANCE;
    const orb = new Orb(this.nextOrbId++, pos.x, pos.y, big);
    this.orbs.set(orb.id, orb);
    this.pendingOrbAdd.push(orb.toWire());
    return orb;
  }

  removeOrb(orb) {
    this.orbs.delete(orb.id);
    this.pendingOrbRemove.push(orb.id);
  }

  buildGrid() {
    this.grid = new Map();
    for (const orb of this.orbs.values()) {
      const cx = Math.floor(orb.x / GRID_CELL);
      const cy = Math.floor(orb.y / GRID_CELL);
      const key = cy * GRID_COLS + cx;
      let bucket = this.grid.get(key);
      if (!bucket) { bucket = []; this.grid.set(key, bucket); }
      bucket.push(orb);
    }
  }

  nearbyOrbs(x, y, radius) {
    const out = [];
    const minCx = Math.floor((x - radius) / GRID_CELL);
    const maxCx = Math.floor((x + radius) / GRID_CELL);
    const minCy = Math.floor((y - radius) / GRID_CELL);
    const maxCy = Math.floor((y + radius) / GRID_CELL);
    for (let cy = minCy; cy <= maxCy; cy++) {
      if (cy < 0 || cy >= GRID_COLS) continue;
      for (let cx = minCx; cx <= maxCx; cx++) {
        if (cx < 0 || cx >= GRID_COLS) continue;
        const bucket = this.grid.get(cy * GRID_COLS + cx);
        if (bucket) for (const orb of bucket) out.push(orb);
      }
    }
    return out;
  }

  /**
   * Pick a spawn far away from anything that could eat a fresh blob.
   * Candidates are scored by their distance to the closest threat.
   */
  findSpawn() {
    const threatMass = P.START_MASS * 1.18;
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < 40; i++) {
      const pos = this.randomPoint(300);
      let nearest = Infinity;
      for (const p of this.players.values()) {
        const d = Math.hypot(p.x - pos.x, p.y - pos.y);
        // Dangerous blobs matter most; everything else just adds breathing room.
        const effective = p.mass >= threatMass ? d : d + 600;
        if (effective < nearest) nearest = effective;
      }
      if (nearest > bestScore) { bestScore = nearest; best = pos; }
      if (nearest > 1500) break;
    }
    return best;
  }

  // ------------------------------------------------------------- lifecycle
  addPlayer(opts) {
    const spawn = this.findSpawn();
    const p = new Player(this, Object.assign({ x: spawn.x, y: spawn.y }, opts));
    const wasEmpty = this.humans === 0;
    this.players.set(p.id, p);
    this.roster.set(p.id, {
      name: p.name,
      skin: p.skin,
      trail: p.trail,
      effect: p.effect,
      isBot: p.isBot
    });
    this.broadcastRoster();
    if (!p.isBot) {
      // A brand new arena has no spectators yet, so the full initial state can
      // replace whatever was queued while the room was warming up.
      if (wasEmpty) {
        this.pendingOrbAdd.length = 0;
        this.pendingOrbRemove.length = 0;
      }
      this.broadcastFeed({ type: 'join', name: p.name });
      this.ensureBots();
    }
    return p;
  }

  findReconnect(accountId) {
    const now = Date.now();
    for (const p of this.players.values()) {
      if (!p.isBot && p.accountId === accountId && p.disconnectedAt && now - p.disconnectedAt < RECONNECT_GRACE) {
        return p;
      }
    }
    return null;
  }

  handleSocketLoss(player) {
    if (!player || player.isBot) return;
    player.disconnectedAt = Date.now();
    player.setInput(0, 0, false);
    player.socketId = null;
  }

  reattach(player, socketId) {
    player.socketId = socketId;
    player.disconnectedAt = 0;
  }

  removePlayer(player) {
    if (!player) return;
    this.players.delete(player.id);
    this.roster.delete(player.id);
    this.broadcastRoster();
    this.ensureBots();
  }

  // ---------------------------------------------------------------- update
  update(dt, now) {
    const humans = this.humans;
    if (humans === 0) {
      if (this.players.size) {
        this.players.clear();
        this.roster.clear();
        this.broadcastRoster();
      }
      this.active = false;
      return;
    }
    this.active = true;
    this.tickCount++;

    for (const p of Array.from(this.players.values())) {
      if (p.isBot) continue;
      if (p.disconnectedAt && now - p.disconnectedAt > RECONNECT_GRACE) {
        this.endLife(p, { reason: 'disconnect' });
        continue;
      }
      this.updateMovement(p, dt);
    }

    this.buildGrid();
    this.updateBots(dt, now);
    this.eatOrbs();
    this.resolveCombat();
    this.fillEmptyOrbs();

    if (this.tickCount % P.SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
    if (this.tickCount % 15 === 0) this.broadcastBoard();
    if (now - this.lastBotSweep > 2500) {
      this.lastBotSweep = now;
      this.ensureBots();
    }
  }

  updateMovement(p, dt) {
    // Boost gating happens on the server; the client only requests it.
    if (p.boosting && (p.mass <= P.BOOST.MIN_MASS + 1 || p.boostTimer >= P.BOOST.MAX_TIME)) {
      p.boosting = false;
      p.boostCooldown = P.BOOST.COOLDOWN;
    }
    p.boostingThisTick = false;
    if (p.boosting && p.boostCooldown <= 0) {
      const drain = Math.max(1.2, p.mass * P.BOOST.DRAIN) * dt;
      p.mass = Math.max(P.MIN_MASS, p.mass - drain);
      p.boostTimer = Math.min(P.BOOST.MAX_TIME, p.boostTimer + dt);
      p.boostSeconds += dt;
      p.boostingThisTick = true;
    } else {
      p.boostingThisTick = false;
      p.boostTimer = Math.max(0, p.boostTimer - dt * 1.6);
      if (p.boostCooldown > 0) p.boostCooldown = Math.max(0, p.boostCooldown - dt);
    }

    const len = Math.hypot(p.dirX, p.dirY);
    if (len > 0.001) {
      const nx = p.dirX / Math.max(1, len);
      const ny = p.dirY / Math.max(1, len);
      const speed = P.speedFromMass(p.mass) * (p.boostingThisTick ? P.BOOST.MULT : 1);
      p.x += nx * speed * dt;
      p.y += ny * speed * dt;
    }

    const r = p.radius;
    p.x = P.clamp(p.x, r, P.WORLD_SIZE - r);
    p.y = P.clamp(p.y, r, P.WORLD_SIZE - r);
    p.maxMass = Math.max(p.maxMass, p.mass);
  }

  eatOrbs() {
    for (const p of this.players.values()) {
      if (p.disconnectedAt) continue;
      const reach = p.radius + 14;
      const orbs = this.nearbyOrbs(p.x, p.y, reach);
      for (const orb of orbs) {
        if (!this.orbs.has(orb.id)) continue;
        const d = Math.hypot(orb.x - p.x, orb.y - p.y);
        if (d < p.radius + orb.r * 0.35) {
          p.mass = Math.min(P.MAX_MASS, p.mass + orb.mass);
          p.orbs++;
          p.maxMass = Math.max(p.maxMass, p.mass);
          this.removeOrb(orb);
        }
      }
    }
  }

  fillEmptyOrbs() {
    let guard = 0;
    while (this.orbs.size < P.ORB_COUNT && guard++ < 40) this.spawnOrb();
  }

  resolveCombat() {
    const list = Array.from(this.players.values()).filter((p) => !p.dead);
    const victims = new Map();

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead || a.beingEaten) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead || b.beingEaten || a.dead || a.beingEaten) continue;
        if (a.protected || b.protected) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const ar = a.radius;
        const br = b.radius;

        if (P.canEat(a.mass, ar, b.mass, br, dist)) {
          victims.set(b.id, { victim: b, killer: a });
          b.beingEaten = true;
        } else if (P.canEat(b.mass, br, a.mass, ar, dist)) {
          victims.set(a.id, { victim: a, killer: b });
          a.beingEaten = true;
        } else if (dist < ar + br) {
          // Gentle separation so blobs never sit inside each other.
          const overlap = ar + br - dist;
          const nx = dx / dist;
          const ny = dy / dist;
          const total = a.mass + b.mass;
          const aPush = (b.mass / total) * overlap * 0.5;
          const bPush = (a.mass / total) * overlap * 0.5;
          a.x -= nx * aPush;
          a.y -= ny * aPush;
          b.x += nx * bPush;
          b.y += ny * bPush;
        }
      }
    }

    for (const { victim, killer } of victims.values()) {
      this.absorb(victim, killer);
    }
  }

  absorb(victim, killer) {
    killer.mass = Math.min(P.MAX_MASS, killer.mass + victim.mass * 0.85);
    killer.maxMass = Math.max(killer.maxMass, killer.mass);
    killer.kills += 1;

    if (victim.isBot) {
      victim.dead = true;
      victim.ended = true;
      this.broadcastFeed({
        type: 'kill',
        killer: { id: killer.id, name: killer.name, isBot: killer.isBot, skin: killer.skin },
        victim: { id: victim.id, name: victim.name, isBot: victim.isBot, skin: victim.skin },
        mass: Math.round(victim.mass)
      });
      this.players.delete(victim.id);
      this.roster.delete(victim.id);
      this.broadcastRoster();
      this.ensureBots(true);
      return;
    }

    this.endLife(victim, { reason: 'eaten', killer });
  }

  /** Ends a human life, computes its server-authoritative stats and reports it. */
  endLife(player, info = {}) {
    if (!player || player.ended) return null;
    player.dead = true;
    player.ended = true;

    // Compare against the whole arena, not just the broadcast top 10.
    const board = this.getBoard(1000);
    const rank = board.findIndex((b) => b.id === player.id) + 1;
    const stats = {
      kills: player.kills,
      orbs: player.orbs,
      seconds: Math.max(0, Math.round((Date.now() - player.spawnedAt) / 1000)),
      maxMass: Math.round(player.maxMass),
      boostSeconds: player.boostSeconds,
      rank: rank || board.length + 1,
      top1: rank === 1,
      top3: rank > 0 && rank <= 3
    };

    this.players.delete(player.id);
    this.roster.delete(player.id);
    this.broadcastRoster();

    let summary = null;
    if (!player.isBot && player.accountId && this.hooks.onLifeEnd) {
      try {
        summary = this.hooks.onLifeEnd(player, stats, info.reason);
      } catch (err) {
        console.error('[room] failed to persist life', err);
      }
    }

    if (info.reason === 'eaten' && info.killer) {
      this.broadcastFeed({
        type: 'kill',
        killer: { id: info.killer.id, name: info.killer.name, isBot: info.killer.isBot, skin: info.killer.skin },
        victim: { id: player.id, name: player.name, isBot: player.isBot, skin: player.skin },
        mass: Math.round(player.mass)
      });
    }

    if (player.socketId && this.io) {
      this.io.to(player.socketId).emit('death', {
        stats,
        summary,
        killer: info.killer ? info.killer.toPublic() : null,
        reason: info.reason || 'eaten',
        board: this.getBoard()
      });
    }

    if (!player.isBot) this.ensureBots();
    return stats;
  }

  // ------------------------------------------------------------------ bots
  ensureBots(force = false) {
    const humans = this.humans;
    if (humans === 0) {
      if (this.players.size) {
        for (const p of Array.from(this.players.values())) {
          if (p.isBot) { this.players.delete(p.id); this.roster.delete(p.id); }
        }
        this.broadcastRoster();
      }
      return;
    }
    const desired = Math.max(2, Math.min(this.maxBots, Math.round(this.minBots + humans * 0.6)));
    let bots = 0;
    for (const p of this.players.values()) if (p.isBot) bots++;
    if (bots > desired) {
      for (const p of Array.from(this.players.values())) {
        if (bots <= desired) break;
        if (p.isBot) { this.players.delete(p.id); this.roster.delete(p.id); bots--; this.broadcastRoster(); }
      }
      return;
    }
    if (bots < desired || force) {
      const toAdd = Math.min(desired - bots, 3);
      for (let i = 0; i < toAdd; i++) {
        const name = 'BOT ' + pick(BOT_NAMES);
        this.addPlayer({
          isBot: true,
          name,
          skin: pick(BOT_SKINS),
          trail: Math.random() < 0.15 ? 'trail_sparks' : 'trail_none',
          effect: 'fx_pop',
          mass: rand(80, 155)
        });
      }
    }
  }

  updateBots(dt, now) {
    for (const bot of this.players.values()) {
      if (!bot.isBot) continue;
      bot.think -= dt;
      if (bot.think <= 0) {
        bot.think = rand(0.22, 0.45);
        this.botDecide(bot);
      }
      this.updateMovement(bot, dt);
    }
  }

  botDecide(bot) {
    let threat = null;
    let threatDist = Infinity;
    let prey = null;
    let preyDist = Infinity;

    for (const other of this.players.values()) {
      if (other === bot) continue;
      const d = Math.hypot(other.x - bot.x, other.y - bot.y);
      if (d > 1100 || other.protected) continue;
      if (other.mass > bot.mass * 1.3 && d < 700 && d < threatDist) {
        threat = other; threatDist = d;
      } else if (bot.mass > other.mass * 1.3 && d < 850 && d < preyDist) {
        prey = other; preyDist = d;
      }
    }

    let tx;
    let ty;
    let boost = false;

    if (threat) {
      tx = bot.x - (threat.x - bot.x) * 2;
      ty = bot.y - (threat.y - bot.y) * 2;
      boost = threatDist < 360 && bot.mass > P.BOOST.MIN_MASS + 120 && bot.boostCooldown <= 0;
      bot.targetOrb = null;
    } else if (prey) {
      tx = prey.x;
      ty = prey.y;
      boost = preyDist < 420 && bot.mass > P.BOOST.MIN_MASS + 120 && bot.boostCooldown <= 0 && Math.random() < 0.6;
    } else {
      // Wander / graze.
      if (!bot.targetOrb || !this.orbs.has(bot.targetOrb.id)) {
        const near = this.nearbyOrbs(bot.x, bot.y, 800);
        bot.targetOrb = near.length ? near[(Math.random() * near.length) | 0] : null;
      }
      if (bot.targetOrb) {
        tx = bot.targetOrb.x;
        ty = bot.targetOrb.y;
      } else {
        tx = bot.x + Math.cos(bot.wander) * 600;
        ty = bot.y + Math.sin(bot.wander) * 600;
        if (Math.random() < 0.1) bot.wander += rand(-1.2, 1.2);
      }
      boost = false;
    }

    // Keep bots inside the arena.
    if (tx < 200) tx = bot.x + 500;
    if (ty < 200) ty = bot.y + 500;
    if (tx > P.WORLD_SIZE - 200) tx = bot.x - 500;
    if (ty > P.WORLD_SIZE - 200) ty = bot.y - 500;

    const dx = tx - bot.x;
    const dy = ty - bot.y;
    const len = Math.hypot(dx, dy) || 1;
    bot.setInput(dx / len, dy / len, boost);
  }

  // ---------------------------------------------------------------- network
  getBoard(limit = 10) {
    const arr = [];
    for (const p of this.players.values()) {
      if (p.dead) continue;
      arr.push({ id: p.id, name: p.name, mass: Math.round(p.mass), isBot: p.isBot, skin: p.skin });
    }
    arr.sort((a, b) => b.mass - a.mass);
    return arr.slice(0, limit).map((e, i) => Object.assign(e, { rank: i + 1 }));
  }

  broadcastSnapshot() {
    const players = [];
    for (const p of this.players.values()) {
      if (!p.dead) players.push(p.toWire());
    }
    const msg = {
      t: this.tickCount,
      s: Date.now(),
      p: players,
      oa: this.pendingOrbAdd,
      od: this.pendingOrbRemove
    };
    this.pendingOrbAdd = [];
    this.pendingOrbRemove = [];
    this.io.to(this.id).emit('snap', msg);
  }

  broadcastBoard() {
    if (!this.humans) return;
    this.io.to(this.id).emit('board', { top: this.getBoard(10), players: this.players.size });
  }

  broadcastRoster() {
    const list = [];
    for (const [id, info] of this.roster) list.push(Object.assign({ id }, info));
    this.io.to(this.id).emit('roster', { players: list });
  }

  broadcastFeed(entry) {
    this.io.to(this.id).emit('feed', entry);
  }

  initialState(player) {
    const players = [];
    for (const p of this.players.values()) if (!p.dead) players.push(p.toWire());
    const orbs = [];
    for (const o of this.orbs.values()) orbs.push(o.toWire());
    const roster = [];
    for (const [id, info] of this.roster) roster.push(Object.assign({ id }, info));
    return {
      roomId: this.id,
      world: P.WORLD_SIZE,
      tick: this.tickCount,
      serverTime: Date.now(),
      you: {
        id: player.id,
        x: player.x,
        y: player.y,
        mass: player.mass,
        radius: player.radius,
        name: player.name,
        skin: player.skin,
        trail: player.trail,
        effect: player.effect
      },
      players,
      roster,
      orbs
    };
  }
}

class GameServer {
  constructor(io, options = {}) {
    this.io = io;
    this.options = options;
    this.rooms = new Map();
    this.roomSeq = 0;
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.loop(), 1000 / P.TICK_RATE);
    this.loopCount = 0;
  }

  createRoom() {
    const id = 'arena-' + (++this.roomSeq);
    const room = new Room(id, {
      io: this.io,
      hooks: this.options.hooks,
      capacity: this.options.roomCapacity,
      minBots: this.options.minBots,
      maxBots: this.options.maxBots
    });
    this.rooms.set(id, room);
    return room;
  }

  /** Automatic matchmaking: pack players together, open a new arena when full. */
  matchmake() {
    let best = null;
    for (const room of this.rooms.values()) {
      if (room.humans >= room.capacity) continue;
      if (!best || room.humans > best.humans) best = room;
    }
    if (best) return best;
    if (this.rooms.size < (this.options.maxRooms || 4)) return this.createRoom();
    // Every arena is at capacity: overflow into the emptiest one rather than
    // dropping the player.
    let emptiest = null;
    for (const room of this.rooms.values()) {
      if (!emptiest || room.humans < emptiest.humans) emptiest = room;
    }
    return emptiest || this.createRoom();
  }

  getRoomForSocket(socket) {
    const id = socket.data.roomId;
    return id ? this.rooms.get(id) : null;
  }

  loop() {
    const now = Date.now();
    let dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    dt = Math.min(0.12, Math.max(0.001, dt));
    for (const room of this.rooms.values()) {
      try {
        room.update(dt, now);
      } catch (err) {
        console.error('[engine] room update failed', room.id, err);
      }
    }
    this.loopCount++;
    if (this.loopCount % 900 === 0) this.pruneRooms();
  }

  pruneRooms() {
    for (const [id, room] of this.rooms) {
      if (room.humans === 0 && this.rooms.size > 1) {
        this.rooms.delete(id);
      }
    }
  }

  stats() {
    let players = 0;
    let humans = 0;
    let bots = 0;
    let orbs = 0;
    for (const room of this.rooms.values()) {
      players += room.players.size;
      humans += room.humans;
      bots += room.players.size - room.humans;
      orbs += room.orbs.size;
    }
    return { rooms: this.rooms.size, players, humans, bots, orbs };
  }

  stop() { clearInterval(this.timer); }
}

module.exports = { GameServer, Room, Player, P };
