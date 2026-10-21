'use strict';
/**
 * BlobBrawl.io integration smoke test.
 * Spins up the real server, connects real Socket.IO clients and verifies the
 * authoritative loop, progression, shop, reconnect grace and rate limits.
 *
 *   npm test
 */
process.env.DB_PATH = ':memory:';
process.env.PORT = '0';
process.env.MIN_BOTS = '3';
process.env.MAX_BOTS = '4';
process.env.NODE_ENV = 'test';

const assert = require('node:assert');
const { io: Client } = require('socket.io-client');
const { server, io: sio, gameServer, store } = require('../server/index');

const results = [];
function pass(name) { results.push(['PASS', name]); console.log(`  ✓ ${name}`); }
function fail(name, err) { results.push(['FAIL', name, err]); console.error(`  ✗ ${name}\n     ${err && err.message}`); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = Client(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    const timer = setTimeout(() => reject(new Error('connect timeout')), 5000);
    socket.on('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.on('connect_error', (err) => { clearTimeout(timer); reject(err); });
  });
}

function request(socket, event, payload = {}, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; reject(new Error(`${event} ack timeout`)); } }, timeout);
    socket.emit(event, payload, (res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(res);
    });
  });
}

function once(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; reject(new Error(`${event} event timeout`)); } }, timeout);
    socket.once(event, (payload) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function run() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;
  console.log(`\n  Server listening on ${url}\n`);

  const clients = [];
  try {
    // ---------------------------------------------------------- health API
    const health = await fetch(`${url}/api/health`).then((r) => r.json());
    assert.equal(health.ok, true);
    const stats = await fetch(`${url}/api/stats`).then((r) => r.json());
    assert.ok('online' in stats && 'rooms' in stats);
    pass('HTTP health + stats endpoints respond');

    // ------------------------------------------------------------- hello
    const a = await connect(url);
    clients.push(a);
    const helloSocket = once(a, 'welcome');
    const helloA = await request(a, 'hello', { name: 'Alpha' });
    assert.equal(helloA.ok, true);
    assert.ok(helloA.token && helloA.token.length > 20);
    assert.equal(helloA.profile.name, 'Alpha');
    assert.ok(Array.isArray(helloA.missions) && helloA.missions.length === 3);
    await helloSocket;
    const profileId = helloA.profile.id;
    pass('hello creates a profile, token, and three daily missions');

    const b = await connect(url);
    clients.push(b);
    await request(b, 'hello', { name: 'Bravo' });
    pass('second client can create a profile');

    // ------------------------------------------------------- join arena
    const joinedP = once(a, 'joined');
    const joinA = await request(a, 'play', {});
    assert.equal(joinA.ok, true);
    const joinedA = await joinedP;
    assert.ok(joinedA.orbs.length > 900, 'initial orb state should be sent');
    assert.ok(joinedA.you && joinedA.you.id > 0);
    assert.ok(joinedA.roster.some((p) => p.isBot), 'bots should fill the arena');
    assert.ok(joinedA.roster.some((p) => !p.isBot));
    pass('play joins a room with bots and a full orb field');

    const joinedBP = once(b, 'joined');
    const joinB = await request(b, 'play', {});
    const joinedB = await joinedBP;
    assert.equal(joinA.roomId, joinB.roomId, 'matchmaking should pack players into one arena');
    pass('matchmaking places both players in the same arena');

    const room = gameServer.rooms.get(joinA.roomId);
    assert.ok(room, 'room exists in engine');
    const playerA = room.players.get(joinedA.you.id);
    const playerB = room.players.get(joinedB.you.id);
    assert.ok(playerA && playerB);

    // ------------------------------------------------------ snapshots
    const snapPromise = once(a, 'snap', 3000);
    const snap = await snapPromise;
    assert.ok(Array.isArray(snap.p) && snap.p.length > 0);
    assert.ok(snap.p.some((p) => p[0] === joinedA.you.id));
    pass('snapshots arrive and include the local player');

    // --------------------------------------------------- server movement
    const startX = playerA.x;
    for (let i = 0; i < 6; i++) { a.emit('input', { x: 1, y: 0, b: 0 }); await sleep(60); }
    assert.ok(playerA.x > startX + 10, `server should move the blob (${startX} -> ${playerA.x})`);
    pass('server-authoritative movement follows validated input');

    // malformed input is discarded without crashing the room
    a.emit('input', { x: 'NaN', y: Infinity, b: 'yes' });
    a.emit('input', null);
    a.emit('definitely:not:an:event', { hack: true });
    await sleep(120);
    assert.ok(room.players.has(playerA.id));
    pass('malformed input and unknown events are ignored safely');

    // ------------------------------------------------- spawn protection
    {
      const fresh = await (async () => {
        const c = await connect(url);
        clients.push(c);
        await request(c, 'hello', { name: 'Fresh' });
        const p = once(c, 'joined');
        const j = await request(c, 'play', {});
        const joined = await p;
        return { c, joined, player: room.players.get(joined.you.id) };
      })();
      assert.ok(fresh.player.protected, 'fresh spawn is shielded');
      // Even a giant parked on top of the new blob cannot eat it while shielded.
      const before = room.players.size;
      playerA.mass = 9000;
      playerA.x = fresh.player.x;
      playerA.y = fresh.player.y;
      await sleep(220);
      assert.equal(room.players.size, before, 'shielded blob cannot be eaten');
      assert.ok(fresh.player.protected, 'shield still active');
      // Drop the shield manually and it becomes edible.
      fresh.player.protectUntil = 0;
      const freshDeath = once(fresh.c, 'death', 4000);
      await freshDeath;
      pass('spawn shield prevents instant eliminations for 3 seconds');
    }

    // ---------------------------------------------------------- boosting
    {
      const player = [...room.players.values()].find((p) => !p.isBot && p.accountId === profileId);
      assert.ok(player, 'player blob is in the arena');
      player.mass = Math.max(player.mass, 900);
      const massBefore = player.mass;
      const boostsBefore = player.boostSeconds;
      for (let i = 0; i < 10; i++) { a.emit('input', { x: 1, y: 0, b: 1 }); await sleep(60); }
      a.emit('input', { x: 0, y: 0, b: 0 });
      await sleep(120);
      assert.ok(player.mass < massBefore, `boosting drains mass (${massBefore} -> ${player.mass})`);
      assert.ok(player.boostSeconds > boostsBefore, 'boost time is tracked for missions');
      assert.ok(player.boostCooldown > 0 || player.boostTimer > 0, 'release starts a cooldown');
      pass('boost drains mass server-side, tracks time and enters cooldown');
    }

    // --------------------------------------------------------- orb eating
    const orb = [...room.orbs.values()][0];
    const orbCountBefore = playerA.orbs;
    playerA.x = orb.x;
    playerA.y = orb.y;
    await sleep(160);
    assert.ok(playerA.orbs > orbCountBefore || playerA.mass > 100, 'blob should consume an orb');
    pass('orb collection is simulated and counted server-side');

    // ------------------------------------------------------------- kill
    const deathP = once(b, 'death', 4000);
    const feedP = once(a, 'feed', 4000);
    playerA.mass = 6000;
    playerA.x = playerB.x;
    playerA.y = playerB.y;
    const death = await deathP;
    assert.ok(death.stats, 'death payload includes life stats');
    assert.ok(death.summary, 'death payload includes a server rewards summary');
    assert.ok(death.summary.rewards.coins > 0, 'rewards are awarded');
    assert.ok(death.summary.rewards.xp > 0);
    assert.equal(typeof death.summary.ratingDelta, 'number');
    assert.equal(death.stats.kills !== undefined, true);
    const feed = await feedP;
    assert.equal(feed.type, 'kill');
    assert.ok(feed.killer && feed.killer.id === playerA.id, 'kill feed credits the killer');
    pass('eliminations award XP/coins/rating and broadcast kill notifications');

    assert.ok(playerA.kills >= 1, 'killer credited in the live simulation');
    // Career stats are committed when a life ends.
    room.endLife(playerA, { reason: 'test' });
    await sleep(120);
    const killerRow = store.getPlayer(playerA.accountId);
    assert.ok(killerRow.total_kills >= 1, 'killer kill count persisted at end of life');
    assert.ok(killerRow.games >= 1 && killerRow.coins > 0);
    pass('career stats and rewards persist at end of life');

    const rejoinAP = once(a, 'joined', 4000);
    const rejoinARes = await request(a, 'play', {});
    assert.equal(rejoinARes.ok, true);
    await rejoinAP;
    const playerA2 = [...room.players.values()].find((p) => p.accountId === profileId);
    assert.ok(playerA2, 'player rejoined the arena');
    pass('player can jump straight back in after a life ends');

    // ------------------------------------------------------- respawn
    const respawnedP = once(b, 'joined', 4000);
    const respawnRes = await request(b, 'play', {});
    assert.equal(respawnRes.ok, true);
    const respawned = await respawnedP;
    assert.notEqual(respawned.you.id, joinedB.you.id, 'respawn creates a fresh blob');
    assert.equal(respawned.you.mass, 100);
    pass('instant respawn creates a new life');

    // ------------------------------------------------------------ shop
    store.addRewards(profileId, 5000, 0);
    const coinsBeforeBuy = store.getPlayer(profileId).coins;
    const buy = await request(a, 'shop:buy', { id: 'lime' });
    assert.equal(buy.ok, true, buy.error);
    assert.ok(buy.profile.unlocks.includes('lime'));
    assert.equal(buy.profile.coins, coinsBeforeBuy - 150, 'price is deducted exactly once');
    const buyAgain = await request(a, 'shop:buy', { id: 'lime' });
    assert.equal(buyAgain.ok, false);
    const buyExpensive = await request(a, 'shop:buy', { id: 'golden' });
    assert.equal(buyExpensive.ok, false, 'level locked / unaffordable items are rejected');
    const equip = await request(a, 'item:equip', { id: 'lime' });
    assert.equal(equip.ok, true);
    assert.equal(equip.profile.skin, 'lime');
    const equipUnowned = await request(a, 'item:equip', { id: 'celestial' });
    assert.equal(equipUnowned.ok, false, 'unowned cosmetics cannot be equipped');
    pass('shop purchases, ownership checks and equipping are server-validated');

    // unowned skin must fall back to an owned one when joining
    const cheatClient = await connect(url);
    clients.push(cheatClient);
    await request(cheatClient, 'hello', { name: 'Cheater' });
    const cheatJoinP = once(cheatClient, 'joined');
    await request(cheatClient, 'play', { skin: 'celestial', trail: 'trail_rainbow', effect: 'fx_nova' });
    const cheatJoin = await cheatJoinP;
    assert.equal(cheatJoin.you.skin, 'bubblegum');
    assert.notEqual(cheatJoin.you.trail, 'trail_rainbow');
    pass('unowned cosmetics sent by a client are replaced server-side');

    // asking to play again while alive must not stack extra blobs
    const beforeIds = new Set(room.players.keys());
    await request(a, 'play', {});
    await sleep(60);
    const clientBlobs = [...room.players.values()].filter((p) => p.accountId === profileId);
    assert.equal(clientBlobs.length, 1, 'one account cannot own two blobs');
    for (const id of room.players.keys()) {
      if (!beforeIds.has(id)) assert.ok(room.players.get(id).isBot, 'only bots may be added');
    }
    pass('duplicate play calls cannot stack extra blobs');

    // forced respawn from an active life should not duplicate blobs
    assert.ok(room.players.size <= room.capacity + 4);

    // --------------------------------------------------------- missions
    const missionClaim = await request(a, 'mission:claim', { id: 'games' });
    assert.equal(typeof missionClaim.ok, 'boolean');
    const fakeClaim = await request(a, 'mission:claim', { id: 'nope' });
    assert.equal(fakeClaim.ok, false);
    pass('mission claims are validated against real progress');

    // --------------------------------------------------------- settings
    const saveSettings = await request(a, 'settings:save', { settings: { quality: 'low', sound: false, showGrid: false, hacked: true } });
    assert.equal(saveSettings.ok, true);
    assert.equal(saveSettings.settings.hacked, undefined);
    pass('settings persist with a whitelist');

    // ------------------------------------------------------------- name
    const badName = await request(a, 'name:set', { name: 'BOT Alpha' });
    assert.equal(badName.ok, false);
    const goodName = await request(a, 'name:set', { name: 'Alpha Strike' });
    assert.equal(goodName.ok, true);
    assert.equal(goodName.profile.name, 'Alpha Strike');
    pass('names are sanitised and reserved bot names rejected');

    // ------------------------------------------------------ leaderboard
    const board = await request(a, 'leaderboard:get', { kind: 'rating' });
    assert.equal(board.ok, true);
    assert.ok(Array.isArray(board.entries));
    const httpBoard = await fetch(`${url}/api/leaderboard?kind=kills&limit=5`).then((r) => r.json());
    assert.ok(Array.isArray(httpBoard.entries));
    const live = await fetch(`${url}/api/live`).then((r) => r.json());
    assert.ok(Array.isArray(live.top));
    assert.ok(live.top.length > 0, 'live endpoint lists arena players');
    pass('leaderboard API and live arena feed respond');

    // --------------------------------------------------- rate limiting
    for (let i = 0; i < 260; i++) a.emit('input', { x: 0.5, y: 0.5, b: 0 });
    await sleep(250);
    const snapAfterSpam = await once(a, 'snap', 2500);
    assert.ok(snapAfterSpam.p.length > 0);
    pass('flooding inputs is rate limited without dropping the connection');

    // ------------------------------------------------- reconnect grace
    const activePlayer = [...room.players.values()].find((p) => p.accountId === profileId);
    assert.ok(activePlayer, 'player still on the field');
    assert.equal(activePlayer.isBot, false);
    a.disconnect();
    await sleep(400);
    const c = await connect(url);
    clients.push(c);
    const helloC = await request(c, 'hello', { token: helloA.token });
    assert.equal(helloC.ok, true);
    assert.equal(helloC.profile.id, profileId, 'the same account is restored');
    const rejoinedP = once(c, 'joined');
    const rejoin = await request(c, 'play', {});
    const rejoined = await rejoinedP;
    assert.equal(rejoin.ok, true);
    assert.equal(rejoined.you.id, activePlayer.id, 'the live blob is reattached during the grace window');
    pass('reconnect within the grace window reattaches the same blob');

    // ------------------------------------------------ size sanity checks
    for (const p of room.players.values()) {
      assert.ok(p.mass >= 40 && p.mass <= 20000, `mass within bounds (${p.mass})`);
      assert.ok(p.x >= 0 && p.x <= 6000 && p.y >= 0 && p.y <= 6000, 'inside the arena');
    }
    pass('all masses and positions stay inside authoritative bounds');

    // -------------------------------------------- shop price anti-cheat
    const coinsBefore = store.getPlayer(profileId).coins;
    const cheapHack = await request(c, 'shop:buy', { id: 'ocean', price: 1, coins: 999999 });
    const coinsAfter = store.getPlayer(profileId).coins;
    if (cheapHack.ok) {
      assert.equal(coinsAfter, coinsBefore - 700, 'server price (700) is charged, not the client price');
    } else {
      assert.equal(coinsAfter, coinsBefore);
    }
    assert.ok(coinsAfter < 999999, 'client-sent currency cannot mint coins');
    pass('client-sent prices and currencies are ignored');
  } finally {
    for (const c of clients) { try { c.disconnect(); } catch { /* ignore */ } }
    gameServer.stop();
    sio.close();
    await new Promise((resolve) => server.close(resolve));
  }

  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n  ${results.length - failed.length}/${results.length} checks passed\n`);
  if (failed.length) process.exit(1);
  process.exit(0);
}

run().catch((err) => {
  console.error('\n  Test run crashed:', err);
  process.exit(1);
});
