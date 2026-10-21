'use strict';
/**
 * Headless client test.
 *
 * Loads the real index.html in jsdom, stubs the canvas + socket, bundles the
 * ES modules with esbuild and drives the UI (menu -> arena -> shop -> death)
 * to catch runtime errors without needing a browser binary.
 *
 *   npm run test:client
 */
const fs = require('fs');
const path = require('path');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function pass(name) { results.push(true); console.log(`  ✓ ${name}`); }
function fail(name, err) { results.push(false); console.error(`  ✗ ${name}\n     ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n     ') : err}`); }

const errors = [];

// ------------------------------------------------------------------ fake ctx
class FakeGradient { addColorStop() {} }
class FakeContext {
  constructor() { this.canvas = null; this.globalAlpha = 1; this.globalCompositeOperation = 'source-over'; }
  save() {} restore() {} translate() {} scale() {} rotate() {} setTransform() {}
  beginPath() {} closePath() {} moveTo() {} lineTo() {} arc() {} arcTo() {} ellipse() {}
  rect() {} quadraticCurveTo() {} bezierCurveTo() {} clip() {}
  fill() {} stroke() {} fillRect() {} clearRect() {} strokeRect() {} drawImage() {}
  fillText() {} strokeText() {} setLineDash() {}
  measureText(text) { return { width: String(text).length * 7 }; }
  createLinearGradient() { return new FakeGradient(); }
  createRadialGradient() { return new FakeGradient(); }
  createPattern() { return null; }
}

const fakeProfile = (over = {}) => Object.assign({
  id: 7,
  name: 'Test Blob',
  coins: 1200,
  xp: 640,
  level: 4,
  xpInto: 120,
  xpNext: 645,
  rating: 1080,
  bestRating: 1120,
  rank: 12,
  tier: { name: 'Bronze', color: '#c97a4a', icon: '🥉' },
  kills: 12,
  deaths: 9,
  orbs: 420,
  games: 11,
  top1: 2,
  bestMass: 2450,
  coinsEarned: 3100,
  playtime: 5400,
  skin: 'lime',
  trail: 'trail_sparks',
  effect: 'fx_pop',
  unlocks: ['bubblegum', 'lime', 'trail_none', 'trail_sparks', 'fx_pop'],
  achievements: ['first_blood', 'snack', 'rookie'],
  settings: {},
  memberSince: Date.now() - 86400000
}, over);

const missions = [
  { id: 'orbs', name: 'Orb Collector', desc: 'Eat 120 orbs today.', icon: 'orb', progress: 60, target: 120, claimed: false, complete: false, coins: 220, xp: 140 },
  { id: 'kills', name: 'Blob Hunter', desc: 'Eliminate 4 blobs today.', icon: 'skull', progress: 4, target: 4, claimed: false, complete: true, coins: 320, xp: 220 },
  { id: 'games', name: 'Warm Up', desc: 'Play 4 matches.', icon: 'play', progress: 4, target: 4, claimed: true, complete: true, coins: 140, xp: 90 }
];

const history = [{ ts: Date.now() - 60000, mass: 2450, kills: 3, orbs: 140, seconds: 180, coins: 420, xp: 510, ratingDelta: 22 }];

// -------------------------------------------------------------- fake socket
class FakeSocket {
  constructor() {
    this.handlers = new Map();
    this.anyHandlers = [];
    this.connected = false;
    this.id = 'fake-1';
    this.state = { profile: fakeProfile(), entered: false };
    setTimeout(() => {
      this.connected = true;
      this.trigger('connect');
    }, 0);
  }
  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
    return this;
  }
  once(event, fn) {
    const wrap = (p) => { this.off(event, wrap); fn(p); };
    return this.on(event, wrap);
  }
  off(event, fn) {
    const list = this.handlers.get(event);
    if (list) this.handlers.set(event, list.filter((f) => f !== fn));
    return this;
  }
  onAny(fn) { this.anyHandlers.push(fn); return this; }
  trigger(event, payload) {
    for (const fn of this.handlers.get(event) || []) fn(payload);
    for (const fn of this.anyHandlers) fn(event, payload);
  }
  emit(event, payload, ack) {
    const respond = (res) => ack && setTimeout(() => ack(res), 0);
    switch (event) {
      case 'hello':
        respond({ ok: true, token: 'x'.repeat(43), profile: this.state.profile, missions, history, now: Date.now() });
        break;
      case 'play': {
        this.state.entered = true;
        setTimeout(() => this.trigger('joined', buildJoined()), 5);
        respond({ ok: true, roomId: 'arena-1', playerId: 99 });
        break;
      }
      case 'leave':
        this.state.entered = false;
        respond({ ok: true });
        break;
      case 'profile:get':
        respond({ ok: true, profile: this.state.profile, missions, history });
        break;
      case 'name:set':
        this.state.profile = Object.assign({}, this.state.profile, { name: payload.name });
        respond({ ok: true, profile: this.state.profile });
        break;
      case 'shop:buy': {
        const item = require('../shared/catalog').ITEMS[payload.id];
        const p = Object.assign({}, this.state.profile, {
          coins: this.state.profile.coins - item.price,
          unlocks: this.state.profile.unlocks.concat(item.id)
        });
        this.state.profile = p;
        respond({ ok: true, profile: p });
        break;
      }
      case 'item:equip': {
        const item = require('../shared/catalog').ITEMS[payload.id];
        const p = Object.assign({}, this.state.profile, { [item.type]: item.id });
        this.state.profile = p;
        respond({ ok: true, profile: p });
        break;
      }
      case 'mission:claim':
        respond({ ok: true, coins: 320, xp: 220, profile: this.state.profile, missions });
        break;
      case 'settings:save':
        respond({ ok: true, settings: payload.settings });
        break;
      case 'leaderboard:get':
        respond({ ok: true, kind: 'rating', entries: [
          { name: 'Orb King', rating: 1980, xp: 44000, kills: 320, skin: 'golden' },
          { name: 'Test Blob', rating: 1080, xp: 640, kills: 12, skin: 'lime' }
        ] });
        break;
      default:
        break;
    }
  }
  connect() { this.connected = true; this.trigger('connect'); }
  disconnect() { this.connected = false; this.trigger('disconnect', 'io client disconnect'); }
  close() { this.disconnect(); }
}

function buildJoined() {
  const orbs = [];
  for (let i = 0; i < 60; i++) orbs.push([i + 1, 1000 + i * 20, 1000 + (i % 7) * 30, 7, i % 14, i % 9 === 0 ? 1 : 0]);
  return {
    roomId: 'arena-1',
    world: 6000,
    tick: 1,
    serverTime: Date.now(),
    you: { id: 99, x: 2000, y: 2000, mass: 100, radius: 15.5, name: 'Test Blob', skin: 'lime', trail: 'trail_sparks', effect: 'fx_pop' },
    players: [[99, 2000, 2000, 15.5, 1, 0], [54, 2200, 2100, 26, 6, 2]],
    roster: [
      { id: 99, name: 'Test Blob', skin: 'lime', trail: 'trail_sparks', effect: 'fx_pop', isBot: false },
      { id: 54, name: 'BOT Wobble', skin: 'ocean', trail: 'trail_none', effect: 'fx_pop', isBot: true }
    ],
    orbs
  };
}

function snapshot() {
  return {
    t: 2,
    s: Date.now(),
    p: [[99, 2001, 2001, 18.4, 1, 0], [54, 2210, 2110, 26, 6, 2]],
    oa: [[500, 1500, 1400, 13, 4, 1]],
    od: [1, 2]
  };
}

// ------------------------------------------------------------------ harness
async function main() {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const { document } = window;

  window.addEventListener('error', (e) => errors.push(e.error || e.message));
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  window.HTMLCanvasElement.prototype.getContext = function () { return new FakeContext(); };
  window.HTMLCanvasElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: 300, height: 300, right: 300, bottom: 300, x: 0, y: 0 };
  };
  window.requestAnimationFrame = (fn) => window.setTimeout(() => fn(window.performance.now()), 8);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  window.fetch = async (url) => {
    if (String(url).includes('/api/stats')) return { json: async () => ({ online: 12, bots: 5, rooms: 2, players: 17 }) };
    if (String(url).includes('/api/live')) return { json: async () => ({ top: [{ name: 'Orb King', mass: 5200, skin: 'golden', isBot: false }, { name: 'BOT Nibbles', mass: 2100, skin: 'ocean', isBot: true }], online: 12, bots: 5 }) };
    return { json: async () => ({}) };
  };

  const sockets = [];
  window.io = () => { const s = new FakeSocket(); sockets.push(s); return s; };

  // Shared game data must exist before the bundle initialises.
  window.eval(fs.readFileSync(path.join(root, 'shared/catalog.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'shared/physics.js'), 'utf8'));
  assert.ok(window.BBCatalog && window.BBPhysics, 'shared scripts load');

  const bundle = esbuild.buildSync({
    entryPoints: [path.join(root, 'public/js/main.js')],
    bundle: true,
    write: false,
    format: 'iife',
    target: ['es2020'],
    logLevel: 'silent'
  });
  window.eval(bundle.outputFiles[0].text);
  pass('client bundle boots inside the DOM');

  await sleep(420);
  const $ = (sel) => document.querySelector(sel);
  const socket = sockets[0];
  assert.ok(socket, 'socket created');
  assert.ok($('#bootScreen').classList.contains('hidden'), 'boot screen hides after hello');
  assert.ok(!$('#menuScreen').classList.contains('hidden'), 'menu is visible');
  pass('connects, loads the profile and shows the main menu');

  assert.equal($('#playerNameInput').value, 'Test Blob');
  assert.equal($('#menuLevelBadge').textContent, '4');
  assert.equal($('#missionList').children.length, 3);
  assert.ok($('#menuGlobalBoard').children.length >= 1);
  assert.equal($('#menuLiveBoard').children.length, 2, 'live arena board renders from /api/live');
  pass('menu shows name, level, missions, live arena and global ranks');

  // ------------------------------------------------------------- settings
  $('#setSound').checked = false;
  $('#setSound').dispatchEvent(new window.Event('change'));
  await sleep(650);
  assert.equal(window.__blobBrawl.ui.settings.sound, false);
  pass('settings toggles apply and sync to the server');

  // ---------------------------------------------------------------- shop
  document.querySelector('[data-open="shop"]').click();
  await sleep(30);
  assert.ok(!$('#shopScreen').classList.contains('hidden'), 'shop opens');
  assert.ok($('#shopGrid').children.length > 10, 'shop lists items');
  const coinText = $('#shopCoins').textContent;
  assert.equal(coinText, '1,200');

  const buyBtn = $('#shopGrid [data-buy]');
  assert.ok(buyBtn, 'there is at least one purchasable item');
  const itemId = buyBtn.dataset.buy;
  buyBtn.click();
  await sleep(20);
  assert.ok(!$('#modalLayer').classList.contains('hidden'), 'purchase confirmation modal opens');
  $('#modalConfirm').click();
  await sleep(200);
  assert.equal(window.__blobBrawl.net.profile.unlocks.includes(itemId), true, 'purchase unlocks the item');
  assert.ok($('#shopGrid').querySelector('.shop-card.equipped'), 'purchased item is auto-equipped');
  pass('shop purchase flow works and updates ownership');

  document.querySelector('#shopScreen [data-close]').click();
  await sleep(30);
  assert.ok(!$('#menuScreen').classList.contains('hidden'));
  pass('back navigation returns to the menu');

  // -------------------------------------------------------------- profile
  document.querySelector('[data-open="profile"]').click();
  await sleep(60);
  assert.equal($('#achievementGrid').children.length, window.BBCatalog.ACHIEVEMENTS.length);
  assert.equal($('#profileMissions').children.length, 3);
  assert.ok($('#matchHistory').children.length >= 2, 'match history renders');
  document.querySelector('#profileScreen [data-close]').click();
  pass('profile renders career stats, achievements, missions and history');

  // --------------------------------------------------------------- ranks
  document.querySelector('[data-open="board"]').click();
  await sleep(80);
  assert.ok($('#boardList').children.length >= 2, 'rank table renders entries');
  document.querySelector('#boardScreen [data-close]').click();
  pass('competitive rank screen loads leaderboard data');

  // --------------------------------------------------------------- match
  document.querySelector('[data-open="settings"]').click();
  await sleep(30);
  document.querySelector('#settingsScreen [data-close]').click();
  await sleep(20);

  $('#btnPlay').click();
  await sleep(140);
  assert.ok(!$('#hud').classList.contains('hidden'), 'HUD appears when the match starts');
  assert.ok($('#menuScreen').classList.contains('hidden'), 'menu hides during play');
  assert.equal($('#hudSize').textContent, '100');
  pass('pressing Play enters the arena and shows the HUD');

  socket.trigger('snap', snapshot());
  socket.trigger('board', {
    top: [
      { id: 99, name: 'Test Blob', mass: 120, isBot: false, rank: 1, skin: 'lime' },
      { id: 54, name: 'BOT Wobble', mass: 90, isBot: true, rank: 2, skin: 'ocean' }
    ],
    players: 2
  });
  await sleep(120);
  assert.equal($('#leaderboardList').children.length, 2);
  assert.ok($('#leaderboardList').querySelector('.me'), 'local player is highlighted on the leaderboard');
  assert.notEqual($('#hudSize').textContent, '100', 'server mass feeds the HUD');
  pass('snapshots update HUD stats and the live leaderboard');

  socket.trigger('feed', { type: 'kill', killer: { id: 99, name: 'Test Blob' }, victim: { id: 54, name: 'BOT Wobble', isBot: true }, mass: 90 });
  await sleep(220);
  assert.equal($('#killFeed').children.length, 1);
  assert.equal($('#hudKills').textContent, '1');
  pass('kill notifications and kill counters update');

  // input / prediction runs for several frames without errors
  window.__blobBrawl.input.keys.add('KeyD');
  await sleep(200);
  window.__blobBrawl.input.keys.clear();
  assert.ok(window.__blobBrawl.game.self, 'local blob exists');
  pass('local prediction loop runs without exceptions');

  // --------------------------------------------------------------- death
  socket.trigger('death', {
    stats: { rank: 3, kills: 2, orbs: 88, seconds: 95, maxMass: 640, boostSeconds: 4 },
    summary: {
      rewards: { coins: 210, xp: 260, ratingDelta: 18 },
      stats: { rank: 3, kills: 2, orbs: 88, seconds: 95, maxMass: 640 },
      levelBefore: 4, levelAfter: 4, levelUp: false,
      achievements: [],
      drop: null,
      rating: 1098,
      tier: { name: 'Bronze', color: '#c97a4a' },
      missions
    },
    killer: { name: 'BOT Wobble', isBot: true },
    reason: 'eaten',
    board: []
  });
  await sleep(1000);
  assert.ok(!$('#deathScreen').classList.contains('hidden'), 'death screen shows');
  assert.equal($('#deathTitle').textContent, 'Eaten by BOT Wobble');
  assert.equal($('#deathCoins').textContent, '210');
  assert.equal($('#deathStats').children.length, 5);
  pass('death screen renders stats, rewards and the killer');

  $('#btnRespawn').click();
  await sleep(140);
  assert.ok($('#deathScreen').classList.contains('hidden'), 'death screen closes on respawn');
  assert.ok(!$('#hud').classList.contains('hidden'));
  assert.equal(window.__blobBrawl.game.state, 'playing');
  pass('instant respawn returns to the arena');

  // ----------------------------------------------------------- disconnect
  window.__blobBrawl.ui.everPlayed = true;
  socket.disconnect();
  await sleep(60);
  assert.ok(!$('#connectionOverlay').classList.contains('hidden'), 'connection overlay shows');
  socket.connect();
  await sleep(200);
  assert.ok($('#connectionOverlay').classList.contains('hidden'), 'connection overlay clears on reconnect');
  pass('disconnect + auto-reconnect UI behaves correctly');

  // ------------------------------------------------------------- leaving
  window.__blobBrawl.game.leaveToMenu();
  await sleep(60);
  assert.ok(!$('#menuScreen').classList.contains('hidden'));
  assert.ok($('#hud').classList.contains('hidden'));
  pass('returning to the menu cleans up the HUD');

  if (errors.length) {
    console.error('\n  Browser errors:', errors);
    throw new Error(`client raised ${errors.length} runtime error(s)`);
  }

  const failed = results.filter((r) => !r).length;
  console.log(`\n  ${results.length - failed}/${results.length} client checks passed\n`);
  dom.window.close();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\n  Client test crashed:', err);
  process.exit(1);
});
