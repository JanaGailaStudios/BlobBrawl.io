'use strict';
const crypto = require('crypto');
const catalog = require('../shared/catalog');

/** UTC day key, e.g. 2026-10-21. Missions reset at UTC midnight. */
function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function seedInt(str) {
  const h = crypto.createHash('sha256').update(str).digest();
  return h.readUInt32BE(0);
}

/** Deterministic daily mission set for a player (stable for a given player/day). */
function missionDefsFor(playerId, day, level) {
  const pool = catalog.MISSION_POOL.slice();
  const rng = mulberry(seedInt(`missions:${playerId}:${day}`));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const tier = level >= 15 ? 2 : level >= 6 ? 1 : 0;
  return pool.slice(0, 3).map((m) => ({
    id: m.id,
    target: m.targets[tier],
    coins: Math.round(m.coins * (0.85 + 0.25 * tier)),
    xp: Math.round(m.xp * (0.85 + 0.25 * tier))
  }));
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function settingsOf(player) {
  try {
    const parsed = JSON.parse(player.settings || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function serializePlayer(store, playerId) {
  const p = store.getPlayer(playerId);
  if (!p) return null;
  const prog = catalog.levelFromXp(p.xp);
  const tier = catalog.rankForRating(p.rating);
  return {
    id: p.id,
    name: p.name,
    coins: p.coins,
    xp: p.xp,
    level: prog.level,
    xpInto: prog.xpIntoLevel,
    xpNext: prog.xpForNext,
    rating: p.rating,
    bestRating: p.best_rating,
    rank: store.rankOf(p.rating),
    tier: { name: tier.name, color: tier.color, icon: tier.icon },
    kills: p.total_kills,
    deaths: p.total_deaths,
    orbs: p.total_orbs,
    games: p.games,
    top1: p.top1,
    bestMass: p.best_mass,
    coinsEarned: p.coins_earned,
    playtime: p.playtime,
    skin: p.skin,
    trail: p.trail,
    effect: p.effect,
    unlocks: store.getUnlocks(playerId).map((u) => u.id),
    achievements: store.getAchievements(playerId),
    settings: settingsOf(p),
    memberSince: p.created_at
  };
}

function getMissionBoard(store, playerId, player) {
  const day = dayKey();
  const level = catalog.levelFromXp(player.xp).level;
  const defs = missionDefsFor(playerId, day, level);
  const rows = store.ensureMissions(playerId, day, defs);
  return rows.map((r) => {
    const def = catalog.MISSION_BY_ID[r.mission_id];
    if (!def) return null;
    const d = defs.find((x) => x.id === r.mission_id) || { coins: def.coins, xp: def.xp };
    return {
      id: r.mission_id,
      name: def.name,
      desc: missionDesc(def, r.target),
      icon: def.icon,
      progress: Math.min(r.target, r.progress),
      target: r.target,
      claimed: !!r.claimed,
      complete: r.progress >= r.target,
      coins: d.coins,
      xp: d.xp
    };
  }).filter(Boolean);
}

function missionDesc(def, target) {
  switch (def.stat) {
    case 'survival': return `Survive for ${Math.round(target / 60)} minutes today.`;
    case 'boost': return `Spend ${target}s boosting today.`;
    case 'maxMass': return `Reach a mass of ${target.toLocaleString('en-US')} in one life.`;
    case 'top3': return `Finish in the top 3 of your arena ${target} times.`;
    case 'top1': return `Take the #1 spot ${target} time${target > 1 ? 's' : ''}.`;
    case 'coins': return `Earn ${target.toLocaleString('en-US')} coins from matches.`;
    case 'games': return `Play ${target} matches.`;
    case 'kills': return `Eliminate ${target} blobs today.`;
    default: return `Eat ${target} orbs today.`;
  }
}

/** Server-side reward calculation. Never trusts client input. */
function rewardsFor(s) {
  const orbs = Math.max(0, s.orbs | 0);
  const kills = Math.max(0, s.kills | 0);
  const seconds = Math.max(0, Math.min(3600, s.seconds | 0));
  const maxMass = Math.max(0, Math.min(25000, s.maxMass | 0));
  const top1 = !!s.top1;
  const top3 = !!s.top3;
  const coins = Math.round(20 + orbs * 0.9 + kills * 55 + seconds * 0.4 + maxMass * 0.02 + (top1 ? 150 : top3 ? 60 : 0));
  const xp = Math.round(15 + orbs * 1.3 + kills * 50 + seconds * 0.9 + maxMass * 0.05 + (top1 ? 120 : top3 ? 50 : 0));
  return { coins, xp };
}

function ratingDeltaFor(s) {
  const kills = Math.max(0, s.kills | 0);
  const orbs = Math.max(0, s.orbs | 0);
  const maxMass = Math.max(0, s.maxMass | 0);
  const seconds = Math.max(0, Math.min(3600, s.seconds | 0));
  // Weighted for a healthy ladder: eliminations and placement matter most,
  // farming orbs/mass keeps you climbing slowly, and a short bad life barely
  // costs anything so nobody gets stuck at zero.
  const raw =
    kills * 11 +
    (s.top1 ? 38 : s.top3 ? 16 : 0) +
    Math.min(28, orbs * 0.09) +
    Math.min(22, maxMass * 0.008) +
    Math.min(10, seconds * 0.02) -
    8;
  return Math.max(-18, Math.min(65, Math.round(raw)));
}

function rollDrop(store, playerId, s) {
  const unowned = catalog.ALL_ITEMS.filter((i) => i.dropOnly && !store.hasUnlock(playerId, i.id));
  if (!unowned.length) return null;
  const chance = Math.min(0.32, 0.045 + (s.top1 ? 0.1 : 0) + Math.min(0.08, (s.kills | 0) * 0.012) + Math.min(0.04, (s.maxMass | 0) / 200000));
  if (Math.random() > chance) return null;
  const total = unowned.reduce((acc, i) => acc + catalog.rarityWeight(i.rarity), 0);
  let roll = Math.random() * total;
  for (const item of unowned) {
    roll -= catalog.rarityWeight(item.rarity);
    if (roll <= 0) {
      if (store.grantItem(playerId, item.id, 'drop')) return item;
      return null;
    }
  }
  const fallback = unowned[unowned.length - 1];
  return store.grantItem(playerId, fallback.id, 'drop') ? fallback : null;
}

function checkAchievements(store, playerId, player) {
  const level = catalog.levelFromXp(player.xp).level;
  const values = {
    kills: player.total_kills,
    orbs: player.total_orbs,
    games: player.games,
    bestMass: player.best_mass,
    top1: player.top1,
    coinsEarned: player.coins_earned,
    level
  };
  const unlocked = [];
  for (const a of catalog.ACHIEVEMENTS) {
    if (store.hasAchievement(playerId, a.id)) continue;
    if ((values[a.stat] || 0) >= a.value) {
      if (store.grantAchievement(playerId, a.id)) {
        unlocked.push(a);
      }
    }
  }
  return unlocked;
}

/**
 * Apply one finished life atomically.
 * `stats` must originate from the authoritative simulation.
 */
function applyLifeResult(store, playerId, stats) {
  const before = store.getPlayer(playerId);
  if (!before) return null;
  const beforeLevel = catalog.levelFromXp(before.xp).level;
  const rewards = rewardsFor(stats);
  const ratingDelta = ratingDeltaFor(stats);

  const result = store.tx(() => {
    store.applyLife(playerId, stats);
    store.addRewards(playerId, rewards.coins, rewards.xp);
    store.addRating(playerId, ratingDelta);

    // Daily mission progress
    const day = dayKey();
    const defs = missionDefsFor(playerId, day, beforeLevel);
    store.ensureMissions(playerId, day, defs);
    const mapping = {
      orbs: stats.orbs || 0,
      kills: stats.kills || 0,
      survival: stats.seconds || 0,
      boost: stats.boostSeconds || 0,
      top3: stats.top3 ? 1 : 0,
      top1: stats.top1 ? 1 : 0,
      coins: rewards.coins,
      games: 1
    };
    for (const id of Object.keys(mapping)) store.bumpMission(playerId, day, id, mapping[id]);
    store.setMissionMax(playerId, day, 'mass', Math.round(stats.maxMass || 0));

    const fresh = store.getPlayer(playerId);
    const achieved = checkAchievements(store, playerId, fresh);
    for (const a of achieved) store.addRewards(playerId, a.coins, 0);

    const drop = rollDrop(store, playerId, stats);
    store.logMatch(playerId, Object.assign({}, stats, rewards, { ratingDelta }));

    return { achieved, drop };
  });

  const after = store.getPlayer(playerId);
  const afterProg = catalog.levelFromXp(after.xp);
  const tier = catalog.rankForRating(after.rating);

  const summary = {
    rewards: {
      coins: rewards.coins + result.achieved.reduce((a, b) => a + b.coins, 0),
      xp: rewards.xp,
      ratingDelta
    },
    stats: {
      kills: stats.kills | 0,
      orbs: stats.orbs | 0,
      seconds: Math.round(stats.seconds || 0),
      maxMass: Math.round(stats.maxMass || 0),
      rank: stats.rank || 0,
      boostedSeconds: Math.round(stats.boostSeconds || 0)
    },
    levelBefore: beforeLevel,
    levelAfter: afterProg.level,
    levelUp: afterProg.level > beforeLevel,
    achievements: result.achieved.map((a) => ({ id: a.id, name: a.name, desc: a.desc, coins: a.coins })),
    drop: result.drop ? { id: result.drop.id, name: result.drop.name, type: result.drop.type, rarity: result.drop.rarity } : null,
    rating: after.rating,
    ratingDelta,
    tier: { name: tier.name, color: tier.color, icon: tier.icon },
    missions: getMissionBoard(store, playerId, after)
  };
  return summary;
}

function claimMissionReward(store, playerId, missionId) {
  const day = dayKey();
  const player = store.getPlayer(playerId);
  if (!player) return { ok: false, error: 'No profile' };
  const defs = missionDefsFor(playerId, day, catalog.levelFromXp(player.xp).level);
  store.ensureMissions(playerId, day, defs);
  const row = store.getMissions(playerId, day).find((m) => m.mission_id === missionId);
  if (!row) return { ok: false, error: 'Unknown mission' };
  if (row.claimed) return { ok: false, error: 'Already claimed' };
  if (row.progress < row.target) return { ok: false, error: 'Mission not complete yet' };
  const def = catalog.MISSION_BY_ID[missionId];
  const d = defs.find((x) => x.id === missionId) || { coins: def.coins, xp: def.xp };
  if (!store.claimMission(playerId, day, missionId)) return { ok: false, error: 'Already claimed' };
  store.addRewards(playerId, d.coins, d.xp);
  return { ok: true, coins: d.coins, xp: d.xp };
}

function buyItem(store, playerId, itemId) {
  const item = catalog.ITEMS[itemId];
  const player = store.getPlayer(playerId);
  if (!item || !player) return { ok: false, error: 'Unknown item' };
  if (item.dropOnly) return { ok: false, error: 'This item only drops from matches' };
  if (store.hasUnlock(playerId, itemId)) return { ok: false, error: 'Already owned' };
  const level = catalog.levelFromXp(player.xp).level;
  if (item.unlockLevel && level < item.unlockLevel) return { ok: false, error: `Reach level ${item.unlockLevel} first` };
  if (player.coins < item.price) return { ok: false, error: 'Not enough coins' };
  const ok = store.tx(() => {
    if (!store.spendCoins(playerId, item.price)) return false;
    return store.grantItem(playerId, itemId, 'shop');
  });
  if (!ok) return { ok: false, error: 'Purchase failed' };
  return { ok: true };
}

function equipItem(store, playerId, itemId) {
  const item = catalog.ITEMS[itemId];
  if (!item) return { ok: false, error: 'Unknown item' };
  if (!store.hasUnlock(playerId, itemId)) return { ok: false, error: 'Item not owned' };
  const loadout = { skin: null, trail: null, effect: null };
  loadout[item.type] = itemId;
  store.setLoadout(playerId, loadout.skin, loadout.trail, loadout.effect);
  return { ok: true, item };
}

module.exports = {
  dayKey,
  missionDefsFor,
  serializePlayer,
  getMissionBoard,
  applyLifeResult,
  claimMissionReward,
  buyItem,
  equipItem,
  rewardsFor,
  ratingDeltaFor
};
