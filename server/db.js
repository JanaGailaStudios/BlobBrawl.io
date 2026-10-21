'use strict';
const fs = require('fs');
const path = require('path');
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  console.error(
    '\n  BlobBrawl.io needs the built-in node:sqlite module.\n' +
    '  Use Node.js 22.13+ (or run node with --experimental-sqlite on 22.5–22.12).\n' +
    '  Your version: ' + process.version + '\n'
  );
  throw err;
}
const config = require('./config');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  coins INTEGER NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  total_kills INTEGER NOT NULL DEFAULT 0,
  total_deaths INTEGER NOT NULL DEFAULT 0,
  total_orbs INTEGER NOT NULL DEFAULT 0,
  games INTEGER NOT NULL DEFAULT 0,
  top1 INTEGER NOT NULL DEFAULT 0,
  best_mass INTEGER NOT NULL DEFAULT 0,
  coins_earned INTEGER NOT NULL DEFAULT 0,
  playtime INTEGER NOT NULL DEFAULT 0,
  rating INTEGER NOT NULL DEFAULT 1000,
  best_rating INTEGER NOT NULL DEFAULT 1000,
  skin TEXT NOT NULL DEFAULT 'bubblegum',
  trail TEXT NOT NULL DEFAULT 'trail_none',
  effect TEXT NOT NULL DEFAULT 'fx_pop',
  settings TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS unlocks (
  player_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'shop',
  acquired_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, item_id)
);

CREATE TABLE IF NOT EXISTS missions (
  player_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  target INTEGER NOT NULL,
  claimed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, day, mission_id)
);

CREATE TABLE IF NOT EXISTS achievements (
  player_id INTEGER NOT NULL,
  ach_id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, ach_id)
);

CREATE TABLE IF NOT EXISTS match_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  mass INTEGER NOT NULL,
  kills INTEGER NOT NULL,
  orbs INTEGER NOT NULL,
  seconds INTEGER NOT NULL,
  coins INTEGER NOT NULL,
  xp INTEGER NOT NULL,
  rating_delta INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_players_rating ON players(rating DESC);
CREATE INDEX IF NOT EXISTS idx_players_xp ON players(xp DESC);
CREATE INDEX IF NOT EXISTS idx_match_log_player ON match_log(player_id, ts DESC);
`;

class Store {
  constructor(file) {
    this.file = file;
    this.dir = path.dirname(file);
    if (file !== ':memory:' && !fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);

    this.q = {
      byToken: this.db.prepare('SELECT * FROM players WHERE token_hash = ?'),
      byId: this.db.prepare('SELECT * FROM players WHERE id = ?'),
      insertPlayer: this.db.prepare('INSERT INTO players (token_hash, name, created_at, last_seen) VALUES (?, ?, ?, ?)'),
      touch: this.db.prepare('UPDATE players SET last_seen = ? WHERE id = ?'),
      setName: this.db.prepare('UPDATE players SET name = ? WHERE id = ?'),
      unlocks: this.db.prepare('SELECT item_id, source, acquired_at FROM unlocks WHERE player_id = ?'),
      hasUnlock: this.db.prepare('SELECT 1 AS ok FROM unlocks WHERE player_id = ? AND item_id = ?'),
      grant: this.db.prepare('INSERT OR IGNORE INTO unlocks (player_id, item_id, source, acquired_at) VALUES (?, ?, ?, ?)'),
      loadout: this.db.prepare('UPDATE players SET skin = COALESCE(?, skin), trail = COALESCE(?, trail), effect = COALESCE(?, effect) WHERE id = ?'),
      settings: this.db.prepare('UPDATE players SET settings = ? WHERE id = ?'),
      missions: this.db.prepare('SELECT * FROM missions WHERE player_id = ? AND day = ?'),
      insertMission: this.db.prepare('INSERT OR IGNORE INTO missions (player_id, day, mission_id, progress, target) VALUES (?, ?, ?, 0, ?)'),
      bumpMission: this.db.prepare('UPDATE missions SET progress = MIN(target, progress + ?) WHERE player_id = ? AND day = ? AND mission_id = ?'),
      setMissionMax: this.db.prepare('UPDATE missions SET progress = MAX(progress, ?) WHERE player_id = ? AND day = ? AND mission_id = ?'),
      claimMission: this.db.prepare('UPDATE missions SET claimed = 1 WHERE player_id = ? AND day = ? AND mission_id = ? AND claimed = 0'),
      achievements: this.db.prepare('SELECT ach_id, unlocked_at FROM achievements WHERE player_id = ?'),
      hasAchievement: this.db.prepare('SELECT 1 AS ok FROM achievements WHERE player_id = ? AND ach_id = ?'),
      grantAchievement: this.db.prepare('INSERT OR IGNORE INTO achievements (player_id, ach_id, unlocked_at) VALUES (?, ?, ?)'),
      addRewards: this.db.prepare('UPDATE players SET coins = coins + ?, xp = xp + ?, coins_earned = coins_earned + ? WHERE id = ?'),
      addRating: this.db.prepare('UPDATE players SET rating = MAX(0, rating + ?), best_rating = MAX(best_rating, rating + ?) WHERE id = ?'),
      applyLife: this.db.prepare(`
        UPDATE players SET
          total_kills = total_kills + ?,
          total_deaths = total_deaths + ?,
          total_orbs = total_orbs + ?,
          games = games + ?,
          top1 = top1 + ?,
          best_mass = MAX(best_mass, ?),
          playtime = playtime + ?
        WHERE id = ?`),
      spend: this.db.prepare('UPDATE players SET coins = coins - ? WHERE id = ? AND coins >= ?'),
      matchLog: this.db.prepare('INSERT INTO match_log (player_id, ts, mass, kills, orbs, seconds, coins, xp, rating_delta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      topRating: this.db.prepare('SELECT name, xp, rating, total_kills, best_mass, skin FROM players WHERE games > 0 ORDER BY rating DESC, xp DESC LIMIT ?'),
      topLevel: this.db.prepare('SELECT name, xp, rating, total_kills, best_mass, skin FROM players WHERE games > 0 ORDER BY xp DESC, rating DESC LIMIT ?'),
      topKills: this.db.prepare('SELECT name, xp, rating, total_kills, best_mass, skin FROM players WHERE games > 0 ORDER BY total_kills DESC, xp DESC LIMIT ?'),
      rank: this.db.prepare('SELECT COUNT(*) AS better FROM players WHERE games > 0 AND rating > ?'),
      playerCount: this.db.prepare('SELECT COUNT(*) AS total FROM players')
    };
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    }
  }

  getOrCreatePlayer(tokenHash, name) {
    let row = this.q.byToken.get(tokenHash);
    if (row) {
      this.q.touch.run(Date.now(), row.id);
      if (name && row.name !== name) {
        this.q.setName.run(name, row.id);
        row.name = name;
      }
      return row;
    }
    const now = Date.now();
    this.q.insertPlayer.run(tokenHash, name, now, now);
    row = this.q.byToken.get(tokenHash);
    for (const item of require('../shared/catalog').DEFAULT_ITEMS) {
      this.q.grant.run(row.id, item, 'default', now);
    }
    return row;
  }

  getPlayer(id) { return this.q.byId.get(id); }

  getPlayerByTokenHash(hash) { return this.q.byToken.get(hash); }

  recentMatches(id, limit = 8) {
    return this.db.prepare('SELECT ts, mass, kills, orbs, seconds, coins, xp, rating_delta FROM match_log WHERE player_id = ? ORDER BY ts DESC LIMIT ?')
      .all(id, Math.min(30, Math.max(1, limit | 0)))
      .map((r) => ({
        ts: r.ts, mass: r.mass, kills: r.kills, orbs: r.orbs,
        seconds: r.seconds, coins: r.coins, xp: r.xp, ratingDelta: r.rating_delta
      }));
  }

  setName(id, name) { this.q.setName.run(name, id); }

  getUnlocks(id) {
    return this.q.unlocks.all(id).map((r) => ({ id: r.item_id, source: r.source, at: r.acquired_at }));
  }

  hasUnlock(id, itemId) { return !!this.q.hasUnlock.get(id, itemId); }

  grantItem(id, itemId, source = 'shop') {
    const res = this.q.grant.run(id, itemId, source, Date.now());
    return res.changes > 0;
  }

  setLoadout(id, skin, trail, effect) {
    const player = this.getPlayer(id);
    const s = skin || null;
    const t = trail || null;
    const e = effect || null;
    const next = {
      skin: s || player.skin,
      trail: t || player.trail,
      effect: e || player.effect
    };
    this.q.loadout.run(s, t, e, id);
    return next;
  }

  saveSettings(id, json) { this.q.settings.run(json, id); }

  getMissions(id, day) { return this.q.missions.all(id, day); }

  ensureMissions(id, day, defs) {
    const existing = this.q.missions.all(id, day);
    if (existing.length >= defs.length) return existing;
    for (const d of defs) this.q.insertMission.run(id, day, d.id, d.target);
    return this.q.missions.all(id, day);
  }

  bumpMission(id, day, missionId, amount) { this.q.bumpMission.run(amount, id, day, missionId); }
  setMissionMax(id, day, missionId, value) { this.q.setMissionMax.run(value, id, day, missionId); }
  claimMission(id, day, missionId) { return this.q.claimMission.run(id, day, missionId).changes > 0; }

  getAchievements(id) { return this.q.achievements.all(id).map((r) => r.ach_id); }
  hasAchievement(id, achId) { return !!this.q.hasAchievement.get(id, achId); }
  grantAchievement(id, achId) { return this.q.grantAchievement.run(id, achId, Date.now()).changes > 0; }

  addRewards(id, coins, xp) { this.q.addRewards.run(coins, xp, coins, id); }

  addRating(id, delta) {
    if (!delta) return;
    this.q.addRating.run(delta, delta, id);
  }

  applyLife(id, s) {
    this.q.applyLife.run(
      s.kills || 0, 1, s.orbs || 0, 1, s.top1 ? 1 : 0,
      Math.round(s.maxMass || 0), Math.round(s.seconds || 0), id
    );
  }

  spendCoins(id, amount) { return this.q.spend.run(amount, id, amount).changes > 0; }

  logMatch(id, s) {
    this.q.matchLog.run(id, Date.now(), Math.round(s.maxMass || 0), s.kills || 0, s.orbs || 0,
      Math.round(s.seconds || 0), s.coins || 0, s.xp || 0, s.ratingDelta || 0);
  }

  leaderboard(kind = 'rating', limit = 25) {
    const stmt = kind === 'level' ? this.q.topLevel : kind === 'kills' ? this.q.topKills : this.q.topRating;
    return stmt.all(Math.min(100, Math.max(1, limit | 0))).map((r) => ({
      name: r.name,
      xp: r.xp,
      rating: r.rating,
      kills: r.total_kills,
      bestMass: r.best_mass,
      skin: r.skin
    }));
  }

  rankOf(rating) { return (this.q.rank.get(rating).better | 0) + 1; }

  stats() {
    return { players: this.q.playerCount.get().total };
  }
}

let store = null;
function getStore() {
  if (!store) store = new Store(config.dbPath);
  return store;
}

module.exports = { Store, getStore };
