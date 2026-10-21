'use strict';
/**
 * End-to-end test: the real browser client (bundled ES modules running inside
 * jsdom) connected to the real server over real WebSockets.
 *
 * This exercises the full stack: hello -> play -> snapshot interpolation ->
 * client prediction -> server-authoritative collision -> death -> respawn.
 *
 *   npm run test:e2e
 */
process.env.DB_PATH = ':memory:';
process.env.MIN_BOTS = '3';
process.env.MAX_BOTS = '4';
process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const esbuild = require('esbuild');
const { io: Client } = require('socket.io-client');
const { server, io: sio, gameServer } = require('../server/index');

const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function pass(name) { results.push(true); console.log(`  ✓ ${name}`); }
function fail(name, err) { results.push(false); console.error(`  ✗ ${name}\n     ${err && err.stack ? err.stack.split('\n').slice(0, 5).join('\n     ') : err}`); }
async function step(name, fn) {
  try { await fn(); pass(name); } catch (err) { fail(name, err); }
}

class FakeGradient { addColorStop() {} }
class FakeContext {
  constructor() { this.globalAlpha = 1; }
  save() {} restore() {} translate() {} scale() {} rotate() {} setTransform() {}
  beginPath() {} closePath() {} moveTo() {} lineTo() {} arc() {} arcTo() {} ellipse() {}
  rect() {} bezierCurveTo() {} quadraticCurveTo() {} clip() {}
  fill() {} stroke() {} fillRect() {} clearRect() {} strokeRect() {} drawImage() {}
  fillText() {} strokeText() {} setLineDash() {}
  measureText(t) { return { width: String(t).length * 7 }; }
  createLinearGradient() { return new FakeGradient(); }
  createRadialGradient() { return new FakeGradient(); }
}

function waitFor(predicate, { timeout = 6000, interval = 25, label = 'condition' } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      let value;
      try { value = predicate(); } catch { value = null; }
      if (value) return resolve(value);
      if (Date.now() - started > timeout) return reject(new Error(`timed out waiting for ${label}`));
      setTimeout(tick, interval);
    };
    tick();
  });
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  console.log(`\n  Server listening on ${origin}\n`);

  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const dom = new JSDOM(html, { url: origin, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const doc = window.document;
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => errors.push(e.reason));

  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.HTMLCanvasElement.prototype.getContext = () => new FakeContext();
  window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320, x: 0, y: 0 });
  window.requestAnimationFrame = (fn) => window.setTimeout(() => fn(window.performance.now()), 8);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  window.fetch = (url, opts) => fetch(new URL(url, origin).toString(), opts);
  window.io = (opts) => Client(origin, opts);
  window.eval(fs.readFileSync(path.join(root, 'shared/catalog.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'shared/physics.js'), 'utf8'));

  const bundle = esbuild.buildSync({
    entryPoints: [path.join(root, 'public/js/main.js')],
    bundle: true, write: false, format: 'iife', target: ['es2020'], logLevel: 'silent'
  });
  window.eval(bundle.outputFiles[0].text);

  const api = () => window.__blobBrawl;
  const $ = (sel) => doc.querySelector(sel);

  await step('client boots against the live server and shows the menu', async () => {
    await waitFor(() => !$('#menuScreen').classList.contains('hidden'), { timeout: 8000, label: 'main menu' });
    assert.ok($('#bootScreen').classList.contains('hidden'));
    assert.ok(api().net.token, 'account token stored');
    assert.match($('#menuOnline').textContent, /online/);
  });

  await step('playing for real joins an arena with bots and a minimap feed', async () => {
    $('#btnPlay').click();
    await waitFor(() => !$('#hud').classList.contains('hidden'), { label: 'HUD' });
    await waitFor(() => api().game.self && api().game.remote.size >= 1, { label: 'remote players' });
    const game = api().game;
    assert.ok(game.roomId && game.roomId.startsWith('arena-'), 'joined a real room');
    assert.ok(game.orbs.length > 1000, 'initial orb state received');
    assert.equal($('#hudSize').textContent, '100');
    const bots = [...game.remote.values()].filter((r) => r.isBot);
    const humans = [...game.remote.values()].filter((r) => !r.isBot && r.id !== game.self.id);
    assert.ok(bots.length >= 1, 'bots present');
    assert.equal(humans.length, 0, 'no other humans expected');
    assert.equal(game.self.protected, true, 'fresh spawn is shielded');
  });

  await step('mouse movement is predicted locally and confirmed by the server', async () => {
    const game = api().game;
    const start = { x: game.self.x, y: game.self.y };
    const move = new window.MouseEvent('pointermove', { clientX: 900, clientY: 160, bubbles: true });
    window.dispatchEvent(move);
    await sleep(700);
    window.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 900, clientY: 160, bubbles: true }));
    await sleep(400);
    const moved = Math.hypot(game.self.x - start.x, game.self.y - start.y);
    assert.ok(moved > 40, `client prediction moved the blob (${moved.toFixed(1)}px)`);
    const room = gameServer.rooms.get(game.roomId);
    const authoritative = [...room.players.values()].find((p) => p.accountId === api().net.profile.id);
    assert.ok(authoritative, 'blob exists in the authoritative room');
    const serverMoved = Math.hypot(authoritative.x - start.x, authoritative.y - start.y);
    assert.ok(serverMoved > 20, `server simulated the same movement (${serverMoved.toFixed(1)}px)`);
    assert.ok(Math.hypot(authoritative.x - game.self.x, authoritative.y - game.self.y) < 260, 'client stays reconciled with the server');
  });

  await step('the live leaderboard and HUD track server state', async () => {
    await sleep(400);
    assert.ok($('#leaderboardList').children.length >= 2, 'leaderboard rows render');
    assert.ok($('#leaderboardList').querySelector('.me'), 'local player highlighted');
    assert.match($('#hudTime').textContent, /^\d+:\d{2}$/);
    assert.match($('#arenaPill').textContent, /blob/);
  });

  await step('eating orbs grows the blob on both sides', async () => {
    const game = api().game;
    const room = gameServer.rooms.get(game.roomId);
    const player = [...room.players.values()].find((p) => p.accountId === api().net.profile.id);
    const orbsBefore = player.orbs;
    // Park the authoritative blob on top of a fat orb cluster.
    const big = [...room.orbs.values()].filter((o) => o.big)[0];
    player.x = big.x;
    player.y = big.y;
    await sleep(1500);
    assert.ok(player.orbs > orbsBefore, 'server counted orb pickups');
    await waitFor(() => Number($('#hudSize').textContent.replace(/,/g, '')) > 100, { timeout: 3000, label: 'HUD size to grow' });
    assert.ok(game.self.mass > 100, 'client received the new mass');
  });

  await step('being eaten shows the death screen with server-computed rewards', async () => {
    const game = api().game;
    const room = gameServer.rooms.get(game.roomId);
    const player = [...room.players.values()].find((p) => p.accountId === api().net.profile.id);
    const bot = [...room.players.values()].find((p) => p.isBot);
    assert.ok(bot, 'a bot exists to do the deed');
    bot.mass = Math.max(bot.mass, 800);
    bot.x = player.x;
    bot.y = player.y;
    await waitFor(() => !$('#deathScreen').classList.contains('hidden'), { timeout: 6000, label: 'death screen' });
    assert.match($('#deathTitle').textContent, /Eaten by/);
    assert.ok(Number($('#deathXp').textContent.replace(/[^\d]/g, '')) > 0, 'XP awarded');
    assert.ok(Number($('#deathCoins').textContent.replace(/[^\d]/g, '')) > 0, 'coins awarded');
    assert.equal($('#deathStats').children.length, 5);
  });

  await step('respawn puts a fresh blob back in the arena', async () => {
    const game = api().game;
    $('#btnRespawn').click();
    await waitFor(() => game.state === 'playing' && game.self && game.self.alive, { timeout: 6000, label: 'respawn' });
    await sleep(300);
    assert.ok($('#deathScreen').classList.contains('hidden'));
    assert.ok(game.self.mass >= 100 && game.self.mass < 400, 'fresh spawn mass');
  });

  await step('progression persisted (coins) and missions advanced', async () => {
    const net = api().net;
    await waitFor(() => net.profile && net.profile.coins > 0, { timeout: 4000, label: 'profile coins' });
    assert.ok(net.profile.games >= 1, 'match counted');
    const board = await net.request('profile:get', {});
    assert.ok(board.missions.some((m) => m.progress > 0), 'mission progress recorded');
    assert.ok(board.history.length >= 1, 'match history recorded');
  });

  await step('leaving the arena returns to a clean menu', async () => {
    const game = api().game;
    game.leaveToMenu();
    await waitFor(() => !$('#menuScreen').classList.contains('hidden'), { timeout: 3000, label: 'menu' });
    assert.ok($('#hud').classList.contains('hidden'));
    assert.ok(game.remote.size === 0);
  });

  await step('two browser clients see each other in the same arena', async () => {
    await sleep(800);
    const second = new JSDOM(html, { url: origin, runScripts: 'outside-only', pretendToBeVisual: true });
    const w2 = second.window;
    w2.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w2.HTMLCanvasElement.prototype.getContext = () => new FakeContext();
    w2.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320, x: 0, y: 0 });
    w2.requestAnimationFrame = (fn) => w2.setTimeout(() => fn(w2.performance.now()), 8);
    w2.fetch = (url, opts) => fetch(new URL(url, origin).toString(), opts);
    w2.io = (opts) => Client(origin, opts);
    w2.eval(fs.readFileSync(path.join(root, 'shared/catalog.js'), 'utf8'));
    w2.eval(fs.readFileSync(path.join(root, 'shared/physics.js'), 'utf8'));
    w2.eval(bundle.outputFiles[0].text);
    const api2 = w2.__blobBrawl;
    await waitFor(() => w2.document.querySelector('#bootScreen').classList.contains('hidden'), { timeout: 8000, label: 'second client boot' });

    const typeName = (win, value) => {
      const input = win.document.querySelector('#playerNameInput');
      input.value = value;
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
    };
    typeName(w2, 'Second Blob');
    typeName(window, 'First Blob');
    await sleep(900);
    w2.document.querySelector('#btnPlay').click();
    await sleep(900);
    $('#btnPlay').click();
    await waitFor(() => api2.game.state === 'playing' && api().game.state === 'playing', { timeout: 8000, label: 'both playing' });
    await waitFor(
      () => [...api().game.remote.values()].some((r) => !r.isBot) && [...api2.game.remote.values()].some((r) => !r.isBot),
      { timeout: 6000, label: 'mutual visibility' }
    );
    assert.equal(api().game.roomId, api2.game.roomId, 'matched into the same arena');
    const seen = [...api().game.remote.values()].find((r) => !r.isBot);
    assert.equal(seen.name, 'Second Blob');
    assert.equal(api2.net.profile.name, 'Second Blob', 'typed name was committed before joining');
    assert.ok(![...api().game.remote.values()].some((r) => r.id === api().game.self.id), 'own blob is never listed as a remote');
    second.window.close();
  });

  if (errors.length) {
    console.error('\n  Client errors:', errors.slice(0, 5));
    throw new Error(`client raised ${errors.length} error(s)`);
  }

  if (api() && api().net.socket) api().net.socket.disconnect();
  const failed = results.filter((r) => !r).length;
  console.log(`\n  ${results.length - failed}/${results.length} end-to-end checks passed\n`);
  gameServer.stop();
  sio.close();
  await new Promise((r) => server.close(r));
  try { dom.window.close(); } catch { /* already closed */ }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\n  E2E run crashed:', err);
  process.exit(1);
});
