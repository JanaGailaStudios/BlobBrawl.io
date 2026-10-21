/*
 * BlobBrawl.io — shared catalog & progression math.
 * Loaded by the browser as a classic script (window.BBCatalog) and by
 * the Node server through require(). Keep it dependency free.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BBCatalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RARITIES = {
    common: { label: 'Common', color: '#9aa8bd', weight: 60 },
    rare: { label: 'Rare', color: '#38bdf8', weight: 26 },
    epic: { label: 'Epic', color: '#c084fc', weight: 11 },
    legendary: { label: 'Legendary', color: '#fbbf24', weight: 3 }
  };

  const SKINS = [
    // ---- Common -------------------------------------------------------
    { id: 'bubblegum', name: 'Bubblegum', rarity: 'common', price: 0, desc: 'The classic pink starter blob.', colors: ['#ff8ad8', '#c026d3'], accent: '#ffe4fb', glow: '#ff6ad5', pattern: 'none', eyes: 'cute' },
    { id: 'lime', name: 'Lime Pop', rarity: 'common', price: 150, desc: 'Sour, sweet, and hard to miss.', colors: ['#bef264', '#65a30d'], accent: '#f7fee7', glow: '#a3e635', pattern: 'none', eyes: 'normal' },
    { id: 'ember', name: 'Ember', rarity: 'common', price: 200, desc: 'A warm little coal that never cools.', colors: ['#fca5a5', '#dc2626'], accent: '#fff1f2', glow: '#f87171', pattern: 'none', eyes: 'angry' },
    { id: 'mint', name: 'Mint Chip', rarity: 'common', price: 200, desc: 'Fresh, frosty and deceptively quick.', colors: ['#a7f3d0', '#0d9488'], accent: '#f0fdfa', glow: '#2dd4bf', pattern: 'spots', eyes: 'normal' },
    { id: 'sunset', name: 'Sunset', rarity: 'common', price: 300, desc: 'Golden hour in blob form.', colors: ['#fdba74', '#db2777'], accent: '#fff7ed', glow: '#fb923c', pattern: 'none', eyes: 'cute' },
    { id: 'slate', name: 'Slate', rarity: 'common', price: 250, desc: 'For players who let the score talk.', colors: ['#cbd5e1', '#475569'], accent: '#f8fafc', glow: '#94a3b8', pattern: 'none', eyes: 'normal' },

    // ---- Rare ---------------------------------------------------------
    { id: 'ocean', name: 'Deep Ocean', rarity: 'rare', price: 700, desc: 'Calm on the surface. Hungry underneath.', colors: ['#7dd3fc', '#1d4ed8'], accent: '#e0f2fe', glow: '#38bdf8', pattern: 'rings', eyes: 'normal' },
    { id: 'neon', name: 'Neon Grid', rarity: 'rare', price: 800, desc: 'Straight out of the arcade.', colors: ['#f0abfc', '#7c3aed'], accent: '#fdf4ff', glow: '#e879f9', pattern: 'hex', eyes: 'angry' },
    { id: 'toxic', name: 'Toxic', rarity: 'rare', price: 900, desc: 'Handle with gloves. Or don\'t.', colors: ['#d9f99d', '#4d7c0f'], accent: '#ecfccb', glow: '#84cc16', pattern: 'spots', eyes: 'angry' },
    { id: 'frost', name: 'Frostbite', rarity: 'rare', price: 900, desc: 'Cold-blooded and crystalline.', colors: ['#e0f2fe', '#0ea5e9'], accent: '#ffffff', glow: '#7dd3fc', pattern: 'stars', eyes: 'normal' },
    { id: 'aurora', name: 'Aurora', rarity: 'rare', price: 1200, unlockLevel: 4, desc: 'Northern lights, southern aggression.', colors: ['#5eead4', '#6d28d9'], accent: '#ecfeff', glow: '#2dd4bf', pattern: 'swirl', eyes: 'cute' },
    { id: 'magma', name: 'Magma Core', rarity: 'rare', price: 1100, desc: 'Cracked crust, molten heart.', colors: ['#fbbf24', '#7c2d12'], accent: '#fef3c7', glow: '#f97316', pattern: 'stripes', eyes: 'angry' },

    // ---- Epic ---------------------------------------------------------
    { id: 'galaxy', name: 'Galaxy', rarity: 'epic', price: 2600, unlockLevel: 6, desc: 'A personal solar system with a grudge.', colors: ['#818cf8', '#1e1b4b'], accent: '#e0e7ff', glow: '#a78bfa', pattern: 'stars', eyes: 'normal' },
    { id: 'void', name: 'Void Walker', rarity: 'epic', price: 3000, unlockLevel: 8, desc: 'Nothing escapes. Not even you.', colors: ['#6b21a8', '#0f0a1e'], accent: '#e9d5ff', glow: '#9333ea', pattern: 'swirl', eyes: 'void' },
    { id: 'candy', name: 'Candy Swirl', rarity: 'epic', price: 2200, desc: 'Sweet enough to rot your rivals.', colors: ['#fda4af', '#fef08a'], accent: '#fff1f2', glow: '#fb7185', pattern: 'swirl', eyes: 'cute' },
    { id: 'circuit', name: 'Circuit', rarity: 'epic', price: 2800, unlockLevel: 10, desc: 'Runs at 144 Hz. Crashes your party.', colors: ['#67e8f9', '#0f766e'], accent: '#ccfbf1', glow: '#22d3ee', pattern: 'hex', eyes: 'normal' },
    { id: 'phantom', name: 'Phantom', rarity: 'epic', price: 2400, unlockLevel: 9, desc: 'You only see it when it is too late.', colors: ['#c7d2fe', '#312e81'], accent: '#eef2ff', glow: '#818cf8', pattern: 'rings', eyes: 'void' },
    { id: 'prism', name: 'Prism', rarity: 'epic', price: 3400, unlockLevel: 12, desc: 'Refracts light, deflecting blame.', colors: ['#fecdd3', '#a5f3fc'], accent: '#ffffff', glow: '#f0abfc', pattern: 'stripes', eyes: 'cute' },
    { id: 'glitch', name: 'Glitch', rarity: 'epic', price: 0, dropOnly: true, desc: 'A rare rendering accident that learned to win.', colors: ['#22d3ee', '#be123c'], accent: '#f0fdff', glow: '#f43f5e', pattern: 'hex', eyes: 'angry' },

    // ---- Legendary ----------------------------------------------------
    { id: 'golden', name: '24K Blob', rarity: 'legendary', price: 7000, unlockLevel: 15, desc: 'Flex on the entire arena.', colors: ['#fef08a', '#b45309'], accent: '#fffbeb', glow: '#fbbf24', pattern: 'rings', eyes: 'normal' },
    { id: 'dragon', name: 'Dragon Scale', rarity: 'legendary', price: 8500, unlockLevel: 18, desc: 'Shed by something enormous.', colors: ['#fca5a5', '#7f1d1d'], accent: '#fef2f2', glow: '#ef4444', pattern: 'spots', eyes: 'angry' },
    { id: 'royal', name: 'Royal Jelly', rarity: 'legendary', price: 6000, unlockLevel: 20, desc: 'Born to the top of the leaderboard.', colors: ['#ddd6fe', '#4c1d95'], accent: '#f5f3ff', glow: '#8b5cf6', pattern: 'stripes', eyes: 'cute' },
    { id: 'celestial', name: 'Celestial', rarity: 'legendary', price: 0, dropOnly: true, desc: 'Dropped once in a thousand eliminations.', colors: ['#fef3c7', '#0ea5e9'], accent: '#ffffff', glow: '#fde68a', pattern: 'stars', eyes: 'void' }
  ];

  const TRAILS = [
    { id: 'trail_none', name: 'No Trail', rarity: 'common', price: 0, desc: 'Stay stealthy.', type: 'none', colors: ['#94a3b8', '#64748b'] },
    { id: 'trail_sparks', name: 'Sparks', rarity: 'common', price: 250, desc: 'Little embers flick off your body.', type: 'sparks', colors: ['#fde68a', '#f97316'] },
    { id: 'trail_bubbles', name: 'Bubbles', rarity: 'common', price: 450, desc: 'Effervescent escape.', type: 'bubbles', colors: ['#bae6fd', '#38bdf8'] },
    { id: 'trail_leaves', name: 'Leaf Storm', rarity: 'rare', price: 700, desc: 'A trail of springtime chaos.', type: 'leaves', colors: ['#a3e635', '#15803d'] },
    { id: 'trail_hearts', name: 'Heartbeat', rarity: 'rare', price: 900, desc: 'Love is a battlefield.', type: 'hearts', colors: ['#fda4af', '#e11d48'] },
    { id: 'trail_flame', name: 'Backdraft', rarity: 'rare', price: 1100, desc: 'Leave nothing but smoke.', type: 'flame', colors: ['#fdba74', '#dc2626'] },
    { id: 'trail_stars', name: 'Starfall', rarity: 'epic', price: 1500, desc: 'Twinkle while you destroy.', type: 'stars', colors: ['#fef9c3', '#a855f7'] },
    { id: 'trail_lightning', name: 'Storm Chaser', rarity: 'epic', price: 2200, unlockLevel: 7, desc: 'Static follows you around.', type: 'lightning', colors: ['#a5f3fc', '#2563eb'] },
    { id: 'trail_rainbow', name: 'Spectrum', rarity: 'legendary', price: 3000, unlockLevel: 10, desc: 'Six colours of pure confidence.', type: 'rainbow', colors: ['#f472b6', '#22d3ee'] },
    { id: 'trail_void', name: 'Event Horizon', rarity: 'legendary', price: 0, dropOnly: true, desc: 'Space-time ripples in your wake.', type: 'void', colors: ['#a855f7', '#0f172a'] }
  ];

  const EFFECTS = [
    { id: 'fx_pop', name: 'Classic Pop', rarity: 'common', price: 0, desc: 'A clean, satisfying burst.', type: 'pop', colors: ['#ffffff', '#a855f7'] },
    { id: 'fx_shock', name: 'Shockwave', rarity: 'rare', price: 800, desc: 'Ring blast on every elimination.', type: 'shock', colors: ['#bae6fd', '#0ea5e9'] },
    { id: 'fx_embers', name: 'Emberstorm', rarity: 'rare', price: 1200, desc: 'Scatter burning ash when you strike.', type: 'embers', colors: ['#fdba74', '#b91c1c'] },
    { id: 'fx_confetti', name: 'Confetti Party', rarity: 'epic', price: 1400, desc: 'Celebrate every takedown.', type: 'confetti', colors: ['#f472b6', '#facc15'] },
    { id: 'fx_fireworks', name: 'Fireworks', rarity: 'epic', price: 2000, desc: 'Launch a full pyrotechnic show.', type: 'fireworks', colors: ['#f0abfc', '#22d3ee'] },
    { id: 'fx_nova', name: 'Supernova', rarity: 'legendary', price: 2800, unlockLevel: 11, desc: 'Collapse into a blinding flash.', type: 'nova', colors: ['#fef08a', '#f43f5e'] },
    { id: 'fx_singularity', name: 'Singularity', rarity: 'legendary', price: 0, dropOnly: true, desc: 'Bend light around your victories.', type: 'singularity', colors: ['#c084fc', '#0b1020'] }
  ];

  const ITEM_TYPES = { skin: 'Skins', trail: 'Trails', effect: 'Effects' };

  const ALL_ITEMS = [];
  SKINS.forEach((s) => ALL_ITEMS.push(Object.assign({ type: 'skin' }, s)));
  TRAILS.forEach((t) => ALL_ITEMS.push(Object.assign({ type: 'trail' }, t)));
  EFFECTS.forEach((e) => ALL_ITEMS.push(Object.assign({ type: 'effect' }, e)));

  const ITEMS = Object.create(null);
  ALL_ITEMS.forEach((i) => { ITEMS[i.id] = i; });

  // Free / starter items everybody owns.
  const DEFAULT_ITEMS = ['bubblegum', 'trail_none', 'fx_pop'];

  const MISSION_POOL = [
    { id: 'orbs', name: 'Orb Collector', stat: 'orbs', targets: [120, 200, 300], coins: 220, xp: 140, icon: 'orb' },
    { id: 'kills', name: 'Blob Hunter', stat: 'kills', targets: [4, 7, 10], coins: 320, xp: 220, icon: 'skull' },
    { id: 'survival', name: 'Survivor', stat: 'survival', targets: [240, 420, 600], coins: 180, xp: 120, icon: 'timer' },
    { id: 'boost', name: 'Speed Demon', stat: 'boost', targets: [45, 90, 150], coins: 160, xp: 100, icon: 'bolt' },
    { id: 'top3', name: 'Podium Finish', stat: 'top3', targets: [2, 3, 4], coins: 260, xp: 180, icon: 'medal' },
    { id: 'top1', name: 'Arena King', stat: 'top1', targets: [1, 2, 3], coins: 400, xp: 280, icon: 'crown' },
    { id: 'mass', name: 'Heavyweight', stat: 'maxMass', targets: [1500, 2500, 4000], coins: 280, xp: 200, icon: 'weight' },
    { id: 'coins', name: 'Coin Rush', stat: 'coins', targets: [600, 900, 1400], coins: 200, xp: 150, icon: 'coin' },
    { id: 'games', name: 'Warm Up', stat: 'games', targets: [4, 6, 8], coins: 140, xp: 90, icon: 'play' }
  ];
  const MISSION_BY_ID = Object.create(null);
  MISSION_POOL.forEach((m) => { MISSION_BY_ID[m.id] = m; });

  const ACHIEVEMENTS = [
    { id: 'first_blood', name: 'First Blood', desc: 'Eliminate your first blob.', stat: 'kills', value: 1, coins: 100 },
    { id: 'hunter', name: 'Hunter', desc: 'Eliminate 25 blobs.', stat: 'kills', value: 25, coins: 250 },
    { id: 'apex', name: 'Apex Predator', desc: 'Eliminate 150 blobs.', stat: 'kills', value: 150, coins: 800 },
    { id: 'snack', name: 'Snack Time', desc: 'Eat 100 orbs.', stat: 'orbs', value: 100, coins: 100 },
    { id: 'vacuum', name: 'Orb Vacuum', desc: 'Eat 1,500 orbs.', stat: 'orbs', value: 1500, coins: 600 },
    { id: 'rookie', name: 'Rookie', desc: 'Play 5 matches.', stat: 'games', value: 5, coins: 100 },
    { id: 'veteran', name: 'Veteran', desc: 'Play 50 matches.', stat: 'games', value: 50, coins: 500 },
    { id: 'giant', name: 'Absolute Unit', desc: 'Reach a mass of 5,000 in one life.', stat: 'bestMass', value: 5000, coins: 700 },
    { id: 'colossus', name: 'Colossus', desc: 'Reach a mass of 12,000 in one life.', stat: 'bestMass', value: 12000, coins: 1200 },
    { id: 'champion', name: 'Champion', desc: 'Reach #1 on the arena leaderboard.', stat: 'top1', value: 1, coins: 400 },
    { id: 'dynasty', name: 'Dynasty', desc: 'Reach #1 ten times.', stat: 'top1', value: 10, coins: 1500 },
    { id: 'level10', name: 'Seasoned', desc: 'Reach level 10.', stat: 'level', value: 10, coins: 500 },
    { id: 'level25', name: 'Icon', desc: 'Reach level 25.', stat: 'level', value: 25, coins: 1500 },
    { id: 'rich', name: 'Coin Vault', desc: 'Bank 10,000 coins over your career.', stat: 'coinsEarned', value: 10000, coins: 750 }
  ];

  const RANK_TIERS = [
    { name: 'Rookie', min: 0, color: '#94a3b8', icon: '🥚' },
    { name: 'Bronze', min: 1050, color: '#c97a4a', icon: '🥉' },
    { name: 'Silver', min: 1200, color: '#cbd5e1', icon: '🥈' },
    { name: 'Gold', min: 1350, color: '#fbbf24', icon: '🥇' },
    { name: 'Platinum', min: 1550, color: '#5eead4', icon: '💎' },
    { name: 'Diamond', min: 1750, color: '#7dd3fc', icon: '💠' },
    { name: 'Master', min: 1950, color: '#c084fc', icon: '🔮' },
    { name: 'Grandmaster', min: 2150, color: '#f472b6', icon: '👑' }
  ];

  // Cumulative-ish curve: xp needed to go from `level` to `level + 1`.
  function xpForNext(level) {
    return Math.floor(70 * Math.pow(level, 1.45) + 30 * level);
  }

  function levelFromXp(totalXp) {
    let level = 1;
    let remaining = Math.max(0, totalXp | 0);
    let need = xpForNext(level);
    while (remaining >= need && level < 100) {
      remaining -= need;
      level += 1;
      need = xpForNext(level);
    }
    return { level, xpIntoLevel: remaining, xpForNext: need, totalXp: Math.max(0, totalXp | 0) };
  }

  function rankForRating(rating) {
    let tier = RANK_TIERS[0];
    for (const t of RANK_TIERS) if (rating >= t.min) tier = t;
    return tier;
  }

  function rarityWeight(rarity) {
    return (RARITIES[rarity] || RARITIES.common).weight;
  }

  function isOwnedByDefault(id) {
    return DEFAULT_ITEMS.indexOf(id) !== -1;
  }

  return {
    RARITIES,
    SKINS,
    TRAILS,
    EFFECTS,
    ITEM_TYPES,
    ITEMS,
    ALL_ITEMS,
    DEFAULT_ITEMS,
    MISSION_POOL,
    MISSION_BY_ID,
    ACHIEVEMENTS,
    RANK_TIERS,
    xpForNext,
    levelFromXp,
    rankForRating,
    rarityWeight,
    isOwnedByDefault
  };
});
