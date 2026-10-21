import { net } from './net.js';
import { audio } from './audio.js';
import { clamp, lerp, rand } from './utils.js';

const PHYS = window.BBPhysics;
const CAT = window.BBCatalog;
const SKIN_INDEX = new Map(CAT.SKINS.map((s, i) => [s.id, i]));
const SNAP_MS = 110;

export class Game {
  constructor({ renderer, input, minimap, settings }) {
    this.renderer = renderer;
    this.input = input;
    this.minimap = minimap;
    this.settings = settings;
    this.state = 'menu';
    this.self = null;
    this.remote = new Map();
    this.roster = new Map();
    this.orbs = [];
    this.orbMap = new Map();
    this.board = [];
    this.playerCount = 0;
    this.roomId = null;
    this.lastDeath = null;
    this.pendingDeath = null;
    this.deathAt = 0;
    this.handlers = new Map();
    this.lastTs = performance.now();
    this.uiAcc = 0;
    this.sendAcc = 0;
    this.minimapAcc = 0;
    this.rank = 0;
    this.announcedTop = false;
    this.spawnedAt = 0;
    this.kills = 0;
    this.directions = { x: 0, y: 0 };
    this.correction = { x: 0, y: 0 };
    this.lastSnapAt = 0;
    this.serverSelf = null;
    this.orbIdCursor = 0;
    this._bind();
    requestAnimationFrame((t) => this.tick(t));
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(fn);
    return () => this.handlers.get(event)?.delete(fn);
  }

  emit(event, data) {
    const set = this.handlers.get(event);
    if (set) for (const fn of set) {
      try { fn(data); } catch (err) { console.error('[game] handler', event, err); }
    }
  }

  _bind() {
    net.on('joined', (payload) => this.onJoined(payload));
    net.on('snap', (msg) => this.onSnap(msg));
    net.on('board', (msg) => this.onBoard(msg));
    net.on('roster', (msg) => this.onRoster(msg));
    net.on('feed', (entry) => {
      // Play the victim's elimination effect at their last known position.
      if (entry && entry.type === 'kill' && entry.victim && entry.victim.id) {
        const rp = this.remote.get(entry.victim.id);
        if (rp) {
          const skin = CAT.ITEMS[entry.victim.skin] || CAT.SKINS[rp.skinIdx] || CAT.SKINS[0];
          const effect = CAT.ITEMS[(this.roster.get(entry.victim.id) || {}).effect] || null;
          this.renderer.effects.eliminate(rp.x, rp.y, effect, [skin.colors[0], skin.colors[1], '#ffffff'], rp.r);
          if (this.self) {
            const d = Math.hypot(rp.x - this.self.x, rp.y - this.self.y);
            if (d < 450) this.renderer.shake(4);
          }
          this.remote.delete(entry.victim.id);
        }
      }
      if (entry && entry.type === 'kill' && this.self && entry.killer && entry.killer.id === this.self.id) {
        this.kills += 1;
        audio.play('kill');
        this.renderer.shake(6);
        const skin = CAT.SKINS[this.self.skinIdx] || CAT.SKINS[0];
        this.renderer.effects.ring(this.self.x, this.self.y, skin.glow, this.self.radius * 3, 0.55, 3);
        this.emit('announce', { text: `Eliminated ${entry.victim ? entry.victim.name : 'a blob'}!` });
      }
      this.emit('feed', entry);
    });
    net.on('death', (payload) => this.onDeath(payload));
    net.on('profile', () => { /* UI handles */ });
    net.on('kicked', (p) => this.emit('kicked', p));
  }

  // ------------------------------------------------------------- lifecycle
  async play() {
    const profile = net.profile;
    if (!profile) return { ok: false, error: 'Not connected yet' };
    this.emit('joining');
    try {
      const res = await net.request('play', {
        skin: profile.skin,
        trail: profile.trail,
        effect: profile.effect
      }, 9000);
      if (!res || !res.ok) {
        this.emit('joinFailed', { error: (res && res.error) || 'Could not join' });
        return res || { ok: false };
      }
      return res;
    } catch (err) {
      this.emit('joinFailed', { error: err.message === 'timeout' ? 'Server is busy — try again.' : 'Connection lost — retrying…' });
      return { ok: false };
    }
  }

  leaveToMenu(silent = false) {
    if (this.state !== 'menu') net.send('leave');
    this.state = 'menu';
    this.self = null;
    this.remote.clear();
    this.roster.clear();
    this.orbs = [];
    this.orbMap.clear();
    this.board = [];
    this.pendingDeath = null;
    this.roomId = null;
    this.input.reset();
    if (!silent) this.emit('exit');
  }

  onJoined(payload) {
    if (!payload || !payload.you) return;
    this.roomId = payload.roomId;
    this.orbs = [];
    this.orbMap.clear();
    for (const o of payload.orbs || []) {
      const orb = { id: o[0], x: o[1], y: o[2], r: o[3], c: o[4], big: o[5] === 1 };
      this.orbs.push(orb);
      this.orbMap.set(orb.id, orb);
    }
    this.remote.clear();
    this.roster.clear();
    for (const entry of payload.roster || []) this.roster.set(entry.id, entry);

    const you = payload.you;
    // The initial state includes our own blob; never treat it as a remote.
    for (const p of payload.players || []) {
      if (p[0] === you.id) continue;
      this.onSnapshotPlayer(p, performance.now());
    }
    this.correction.x = 0;
    this.correction.y = 0;

    this.self = {
      id: you.id,
      name: you.name,
      x: you.x,
      y: you.y,
      mass: you.mass,
      radius: you.radius,
      skin: you.skin,
      skinIdx: SKIN_INDEX.get(you.skin) || 0,
      trail: you.trail,
      effect: you.effect,
      alive: true,
      boosting: false,
      protected: true,
      boostTimer: 0,
      boostCooldown: 0,
      vx: 0,
      vy: 0,
      isSelf: true
    };
    this.spawnedAt = performance.now();
    this.kills = 0;
    this.announcedTop = false;
    this.rank = 0;
    this.state = 'playing';
    this.pendingDeath = null;
    this.renderer.effects.particles.length = 0;
    this.renderer.effects.rings.length = 0;
    this.renderer.updateCamera(0.016, { x: you.x, y: you.y }, you.radius, true);
    this.renderer.effects.ring(you.x, you.y, '#9d6bff', 160, 0.7, 3);
    audio.play('spawn');
    this.emit('enter', payload);
  }

  onSnap(msg) {
    const now = performance.now();
    this.lastSnapAt = now;
    if (msg.oa && msg.oa.length) {
      for (const o of msg.oa) {
        if (this.orbMap.has(o[0])) continue;
        const orb = { id: o[0], x: o[1], y: o[2], r: o[3], c: o[4], big: o[5] === 1, bornAt: now };
        this.orbs.push(orb);
        this.orbMap.set(orb.id, orb);
      }
    }
    if (msg.od && msg.od.length) {
      for (const id of msg.od) {
        const orb = this.orbMap.get(id);
        if (!orb) continue;
        this.orbMap.delete(id);
        const idx = this.orbs.indexOf(orb);
        if (idx >= 0) this.orbs.splice(idx, 1);
        if (this.self && this.self.alive) {
          const d = Math.hypot(orb.x - this.self.x, orb.y - this.self.y);
          if (d < this.self.radius + 26) {
            const skin = CAT.SKINS[this.self.skinIdx] || CAT.SKINS[0];
            this.renderer.effects.burst(orb.x, orb.y, [skin.colors[0], '#ffffff', skin.accent], 4, 90, { life: 0.3, size: 2.4 });
            audio.play('orb');
          }
        }
      }
    }
    if (!msg.p) return;
    const seen = new Set();
    for (const entry of msg.p) {
      seen.add(entry[0]);
      this.onSnapshotPlayer(entry, now);
      if (this.self && entry[0] === this.self.id) this.applySelfSnapshot(entry, now);
    }
    for (const [id, rp] of this.remote) {
      if (!seen.has(id)) {
        if (now - (rp.lastSeen || 0) > 900) this.remote.delete(id);
      }
    }
  }

  onSnapshotPlayer(entry, now) {
    const id = entry[0];
    const x = entry[1];
    const y = entry[2];
    const r = entry[3];
    const skinIdx = entry[4];
    const flags = entry[5] || 0;
    if (this.self && id === this.self.id) return;
    const meta = this.roster.get(id) || {};
    let rp = this.remote.get(id);
    if (!rp) {
      rp = {
        id,
        x, y, r,
        px: x, py: y, pr: r,
        t0: now, t1: now + SNAP_MS,
        skinIdx, boosting: !!(flags & 1), isBot: !!(flags & 2), protected: !!(flags & 4),
        name: meta.name || 'Blob',
        trail: meta.trail || 'trail_none',
        lastSeen: now,
        spawnAt: now,
        vx: 0, vy: 0
      };
      this.remote.set(id, rp);
      this.renderer.effects.ring(x, y, '#9d6bff', Math.max(40, r * 2), 0.5, 2);
    } else {
      const cur = sampleRemote(rp, now);
      rp.px = cur.x; rp.py = cur.y; rp.pr = cur.r;
      rp.vx = (x - cur.x) / (SNAP_MS / 1000);
      rp.vy = (y - cur.y) / (SNAP_MS / 1000);
      rp.x = x; rp.y = y; rp.r = r;
      rp.t0 = now; rp.t1 = now + SNAP_MS;
      rp.skinIdx = skinIdx;
      rp.boosting = !!(flags & 1);
      rp.isBot = !!(flags & 2);
      rp.protected = !!(flags & 4);
      rp.lastSeen = now;
      if (meta.name) rp.name = meta.name;
      rp.trail = meta.trail || 'trail_none';
    }
  }

  applySelfSnapshot(entry, now) {
    const serverRadius = entry[3];
    const serverMass = Math.pow(serverRadius / 1.55, 2);
    const self = this.self;
    this.serverSelf = { x: entry[1], y: entry[2], mass: serverMass, at: now };
    self.protected = !!(entry[5] & 4);
    const dx = entry[1] - self.x;
    const dy = entry[2] - self.y;
    const err = Math.hypot(dx, dy);
    if (err > 420) {
      self.x = entry[1];
      self.y = entry[2];
      self.mass = serverMass;
      this.correction.x = 0;
      this.correction.y = 0;
    } else {
      this.correction.x = dx;
      this.correction.y = dy;
    }
    // Mass is always authoritative: blend toward the server value so orb
    // pickups and boost drain look smooth instead of stepping.
    if (Math.abs(self.mass - serverMass) > 600) self.mass = serverMass;
    else self.mass = lerp(self.mass, serverMass, 0.38);
  }

  onBoard(msg) {
    this.board = msg.top || [];
    this.playerCount = msg.players || 0;
    if (this.self && this.self.alive) {
      const idx = this.board.findIndex((b) => b.id === this.self.id);
      const rank = idx >= 0 ? idx + 1 : 0;
      if (rank === 1 && !this.announcedTop) {
        this.announcedTop = true;
        audio.play('levelup');
        this.emit('announce', { text: 'You are #1 in the arena!' });
      }
      this.rank = rank;
    }
    this.emit('board', msg);
  }

  onRoster(msg) {
    if (!msg || !msg.players) return;
    this.roster.clear();
    for (const entry of msg.players) this.roster.set(entry.id, entry);
    for (const [id, rp] of this.remote) {
      const meta = this.roster.get(id);
      if (meta) { rp.name = meta.name; rp.trail = meta.trail; rp.isBot = meta.isBot; }
    }
    this.emit('roster', msg);
  }

  onDeath(payload) {
    if (!this.self) return;
    const self = this.self;
    const skin = CAT.SKINS[self.skinIdx] || CAT.SKINS[0];
    const effect = CAT.ITEMS[self.effect];
    self.alive = false;
    this.state = 'dead';
    this.lastDeath = { x: self.x, y: self.y };
    this.pendingDeath = payload;
    this.deathAt = performance.now();
    this.renderer.effects.eliminate(self.x, self.y, effect || CAT.ITEMS.fx_pop, [skin.colors[0], skin.colors[1], '#ffffff'], self.radius);
    this.renderer.shake(16);
    this.renderer.flash('#ff6b7a', 0.16);
    audio.play('death');
    this.input.reset();
    net.send('input', { x: 0, y: 0, b: false });
    this.emit('deathPending', payload);
  }

  respawn() {
    if (this.state === 'dead' || this.state === 'menu') {
      this.pendingDeath = null;
      return this.play();
    }
    if (this.state === 'playing') return Promise.resolve({ ok: true });
    return this.play();
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    if (this.state === 'playing' && this.self && this.self.alive) this.updateSelf(dt);
    else this.input.reset();
    const target = this.state === 'playing' && this.self
      ? this.self
      : this.lastDeath;
    if (target) this.renderer.updateCamera(dt, target, this.self && this.self.alive ? this.self.radius : 60);

    if (this.pendingDeath && performance.now() - this.deathAt > 850) {
      const payload = this.pendingDeath;
      this.pendingDeath = null;
      this.emit('death', payload);
    }
    this.emitHud(dt);
  }

  updateSelf(dt) {
    const self = this.self;
    const input = this.input;
    const screen = this.renderer.screenOf(self.x, self.y);
    const dir = input.direction(screen);
    this.directions = dir;

    // Local boost model mirrors the server rules so the meter feels honest.
    const wants = input.wantsBoost();
    let boosting = false;
    if (wants && self.mass > PHYS.BOOST.MIN_MASS + 1 && self.boostCooldown <= 0 && self.boostTimer < PHYS.BOOST.MAX_TIME) {
      boosting = true;
      self.boostTimer = Math.min(PHYS.BOOST.MAX_TIME, self.boostTimer + dt);
      self.mass = Math.max(PHYS.MIN_MASS, self.mass - Math.max(1.2, self.mass * PHYS.BOOST.DRAIN) * dt);
    } else {
      self.boostTimer = Math.max(0, self.boostTimer - dt * 1.6);
      if (wants && self.boostTimer >= PHYS.BOOST.MAX_TIME) {
        self.boostCooldown = PHYS.BOOST.COOLDOWN;
        self.boostTimer = 0;
      }
    }
    if (!boosting && self.boostCooldown > 0) self.boostCooldown = Math.max(0, self.boostCooldown - dt);
    if (self.boosting && !boosting && self.boostTimer > 0.12 && self.boostCooldown <= 0) {
      self.boostCooldown = PHYS.BOOST.COOLDOWN;
    }
    if (!self.boosting && boosting) audio.play('boost');
    self.boosting = boosting;

    if (boosting && !this.settings.reducedMotion) {
      const skin = CAT.SKINS[self.skinIdx] || CAT.SKINS[0];
      for (let i = 0; i < 2; i++) {
        this.renderer.effects.trail('flame', self.x - (self.vx || 0) * 0.03 + rand(-6, 6), self.y - (self.vy || 0) * 0.03 + rand(-6, 6), [skin.glow, '#ffffff'], 1, { x: self.vx, y: self.vy });
      }
    }

    const speed = PHYS.speedFromMass(self.mass) * (boosting ? PHYS.BOOST.MULT : 1);
    const len = Math.hypot(dir.x, dir.y);
    if (len > 0.001) {
      const nx = dir.x / Math.max(1, len);
      const ny = dir.y / Math.max(1, len);
      self.x += nx * speed * dt;
      self.y += ny * speed * dt;
      self.vx = nx * speed;
      self.vy = ny * speed;
    } else {
      self.vx = 0;
      self.vy = 0;
    }

    // Smooth reconciliation toward the authoritative position.
    const c = this.correction;
    if (c.x || c.y) {
      const k = clamp(1 - Math.exp(-dt * 12), 0, 1);
      self.x += c.x * k;
      self.y += c.y * k;
      c.x *= 1 - k;
      c.y *= 1 - k;
      if (Math.abs(c.x) < 0.4) c.x = 0;
      if (Math.abs(c.y) < 0.4) c.y = 0;
    }

    self.radius = PHYS.radiusFromMass(self.mass);
    self.x = clamp(self.x, self.radius, PHYS.WORLD_SIZE - self.radius);
    self.y = clamp(self.y, self.radius, PHYS.WORLD_SIZE - self.radius);
    self.spawnT = Math.min(1, (performance.now() - this.spawnedAt) / 450);

    this.sendAcc += dt;
    if (this.sendAcc > 0.05) {
      this.sendAcc = 0;
      net.send('input', {
        x: Math.round(dir.x * 100) / 100,
        y: Math.round(dir.y * 100) / 100,
        b: boosting ? 1 : 0
      });
    }
  }

  emitHud(dt) {
    this.uiAcc += dt;
    if (this.uiAcc < 0.1) return;
    this.uiAcc = 0;
    if (this.state === 'menu' && !this.self) return;
    if (this.self) {
      const elapsed = (performance.now() - this.spawnedAt) / 1000;
      this.emit('hud', {
        size: Math.round(this.self.mass),
        score: Math.round(this.self.mass * 10),
        kills: this.kills,
        time: elapsed,
        alive: this.self.alive,
        boostRatio: 1 - this.self.boostTimer / PHYS.BOOST.MAX_TIME,
        cooldown: this.self.boostCooldown,
        boosting: this.self.boosting,
        rank: this.rank,
        players: this.playerCount
      });
    }
  }

  // ---------------------------------------------------------------- render
  tick(ts) {
    const dt = Math.min(0.05, Math.max(0.0001, (ts - this.lastTs) / 1000));
    this.lastTs = ts;
    if (this.state !== 'menu') {
      this.update(dt);
      this.render(dt);
      this.minimapAcc += dt;
      if (this.minimapAcc > 0.15) {
        this.minimapAcc = 0;
        this.renderer.drawMinimap(this.minimap, this.renderState());
      }
    }
    requestAnimationFrame((t) => this.tick(t));
  }

  renderState() {
    const now = performance.now();
    const players = [];
    for (const [id, rp] of this.remote) {
      if (now - (rp.lastSeen || 0) > 1600) { this.remote.delete(id); continue; }
      const s = sampleRemote(rp, now);
      const spawnT = clamp((now - rp.spawnAt) / 450, 0, 1);
      players.push({
        id,
        x: s.x, y: s.y, r: s.r,
        skinIdx: rp.skinIdx,
        name: rp.name,
        trail: rp.trail,
        isBot: rp.isBot,
        boosting: rp.boosting,
        protected: rp.protected,
        vx: rp.vx, vy: rp.vy,
        spawnT
      });
    }
    const self = this.self;
    if (self && self.alive) {
      players.push({
        id: self.id,
        x: self.x, y: self.y, r: self.radius,
        skinIdx: self.skinIdx,
        name: self.name,
        trail: self.trail,
        isBot: false,
        boosting: self.boosting,
        protected: self.protected,
        vx: self.vx, vy: self.vy,
        spawnT: self.spawnT || 1,
        isSelf: true,
        selfId: self.id
      });
    }
    return {
      orbs: this.orbs,
      players,
      self: self ? { alive: self.alive, boosting: self.boosting } : { alive: false }
    };
  }

  render(dt) {
    this.renderer.render(this.renderState(), dt);
  }
}

function sampleRemote(rp, now) {
  const span = Math.max(1, rp.t1 - rp.t0);
  const t = clamp((now - rp.t0) / span, 0, 1);
  const ease = t * t * (3 - 2 * t);
  return {
    x: lerp(rp.px, rp.x, ease),
    y: lerp(rp.py, rp.y, ease),
    r: lerp(rp.pr, rp.r, ease)
  };
}

export function gameHudDefaults() {
  return {
    size: PHYS.START_MASS,
    score: Math.round(PHYS.START_MASS * 10),
    kills: 0,
    time: 0,
    alive: true,
    boostRatio: 1,
    cooldown: 0,
    boosting: false,
    rank: 0,
    players: 0
  };
}
