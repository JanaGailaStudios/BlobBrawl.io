import {
  $, $$, fmt, fmtCompact, fmtTime, fmtPlaytime, timeAgo, escapeHtml,
  decorateBlob, toast, confirmModal, initModal, debounce, storage, clamp
} from './utils.js';
import { net, showRequestError } from './net.js';
import { audio } from './audio.js';
import { drawHeroBlob } from './renderer.js';

const CAT = window.BBCatalog;

const DEFAULT_SETTINGS = {
  sound: true,
  music: false,
  sfxVolume: 0.7,
  musicVolume: 0.4,
  quality: 'high',
  showGrid: true,
  showNames: true,
  reducedMotion: false,
  colorblind: false,
  largeUI: false,
  contrast: false,
  shake: true,
  controlMode: 'both',
  boostMode: 'hold'
};

const MISSION_ICONS = { orb: '◉', skull: '💀', timer: '⏱️', bolt: '⚡', medal: '🥉', crown: '👑', weight: '⚖️', coin: '🪙', play: '▶' };
const ACH_ICONS = { kills: '⚔️', orbs: '◉', games: '🎮', bestMass: '⚖️', top1: '👑', coinsEarned: '🪙', level: '⭐' };
const SCREENS = ['menuScreen', 'shopScreen', 'profileScreen', 'settingsScreen', 'boardScreen'];

const TIPS = [
  'Boost only when you can finish a kill — it costs 4.5% of your mass every second.',
  'You need to be 18% bigger than another blob to swallow it.',
  'Cut smaller blobs off against the arena wall; they run out of escape routes.',
  'Big blobs are slow. If something huge is chasing you, turn sharply and hug the border.',
  'Cleaning up after a big fight is the fastest way to grow.',
  'Orbs cluster in quiet corners — safe early growth beats risky kills.',
  'Watch the leaderboard: the top blob is the most dangerous and the most distracted.',
  'Respawning is instant. A risky push costs you a few seconds, not your progress.'
];

export class UI {
  constructor({ game, input }) {
    this.game = game;
    this.input = input;
    this.profile = null;
    this.missions = [];
    this.history = [];
    this.settings = Object.assign({}, DEFAULT_SETTINGS);
    this.shopTab = 'skin';
    this.boardKind = 'rating';
    this.liveBoard = [];
    this.boardCache = {};
    this.boardEntries = [];
    this.heroTime = 0;
    this.currentScreen = 'menuScreen';
    this.everPlayed = false;
    this.leaving = false;
    this.connectionLost = false;
    this.statsTimer = null;
    this.saveSettings = debounce(() => this.persistSettings(), 500);
    this.settingsInitialized = false;
  }

  init() {
    initModal();
    this.bindNavigation();
    this.bindMenu();
    this.bindShop();
    this.bindProfile();
    this.bindSettings();
    this.bindBoard();
    this.bindDeath();
    this.bindHud();
    this.bindNet();
    this.applyBodyClasses();
    this.startHeroAnimation();
    this.resetSettingsUi();
    this.loadStats();
    this.statsTimer = setInterval(() => this.loadStats(), 20000);
  }

  // ------------------------------------------------------------------ boot
  boot(status, progress = 10) {
    $('#bootStatus').textContent = status;
    $('#bootBarFill').style.width = `${clamp(progress, 4, 100)}%`;
  }

  bootFailed(message) {
    this.boot(message, 100);
    $('#bootRetry').classList.remove('hidden');
    $('#bootBarFill').style.background = 'linear-gradient(90deg,#ff6b7a,#ffc55c)';
  }

  hideBoot() {
    $('#bootScreen').classList.add('hidden');
    $('#bootRetry').classList.add('hidden');
  }

  // ---------------------------------------------------------------- screens
  showScreen(id) {
    for (const s of SCREENS) $('#' + s).classList.toggle('hidden', '#' + s !== '#' + id);
    this.currentScreen = id;
    if (id === 'shopScreen') this.renderShop();
    if (id === 'profileScreen') { this.renderProfile(); this.fetchProfile(); }
    if (id === 'boardScreen') this.fetchBoard();
    if (id === 'menuScreen') this.renderMenu();
    if (id === 'settingsScreen') this.syncSettingsUi();
  }

  openScreen(name) {
    const map = { menu: 'menuScreen', shop: 'shopScreen', profile: 'profileScreen', settings: 'settingsScreen', board: 'boardScreen' };
    if (this.game.state !== 'menu') return;
    this.showScreen(map[name] || 'menuScreen');
    audio.play('click');
  }

  closeScreen(name) {
    if (this.currentScreen === 'menuScreen') return;
    this.showScreen('menuScreen');
    audio.play('click');
    void name;
  }

  bindNavigation() {
    $$('[data-open]').forEach((btn) => btn.addEventListener('click', () => this.openScreen(btn.dataset.open)));
    $$('[data-close]').forEach((btn) => btn.addEventListener('click', () => this.closeScreen(btn.dataset.close)));

    $('#btnSoundToggle').addEventListener('click', () => {
      this.setSetting('sound', !this.settings.sound);
      this.syncSettingsUi();
      audio.play('click');
      toast(this.settings.sound ? 'Sound on' : 'Sound muted');
    });

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#modalLayer').classList.contains('hidden')) return;
      if (this.game.state === 'playing' || this.game.state === 'dead') {
        this.leaveMatch();
      } else if (this.currentScreen !== 'menuScreen') {
        this.showScreen('menuScreen');
      }
    });

    window.addEventListener('pointerdown', () => {
      audio.unlock();
      if (this.settings.music) audio.applySettings({ music: true });
    }, { once: true });
  }

  // ------------------------------------------------------------------- menu
  bindMenu() {
    $('#btnPlay').addEventListener('click', () => this.startMatch());
    $('#btnCustomize').addEventListener('click', () => this.openScreen('shop'));

    const nameInput = $('#playerNameInput');
    this.nameDirty = false;
    nameInput.addEventListener('input', () => { this.nameDirty = true; });
    const commitName = async () => {
      const raw = nameInput.value;
      const clean = raw.replace(/[^\p{L}\p{N} _\-.]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
      if (clean.length < 2) {
        nameInput.value = this.profile ? this.profile.name : '';
        if (raw.trim()) toast('Names need at least 2 characters.', 'bad');
        return;
      }
      if (/^\[?bot\]?/i.test(clean)) {
        toast('That name is reserved for bots.', 'bad');
        nameInput.value = this.profile ? this.profile.name : '';
        return;
      }
      nameInput.value = clean;
      this.nameDirty = false;
      storage.set('blobbrawl.name', clean);
      if (this.profile && clean !== this.profile.name) {
        try {
          const res = await net.request('name:set', { name: clean });
          if (res && res.ok && res.profile) {
            this.updateProfile(res.profile);
            toast('Name updated');
          } else if (res && res.error) {
            toast(res.error, 'bad');
          }
        } catch (err) { showRequestError(err); }
      }
    };
    nameInput.addEventListener('blur', commitName);
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); } });
    nameInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') this.startMatch(); });
  }

  loadStats() {
    fetch('/api/stats', { headers: { accept: 'application/json' } })
      .then((r) => r.json())
      .then((s) => {
        $('#menuOnline').textContent = `${fmt(s.online || 0)} blob${(s.online || 0) === 1 ? '' : 's'} online`;
        $('#menuRoomInfo').textContent = (s.rooms || 0) > 0
          ? `${s.rooms} arena${s.rooms === 1 ? '' : 's'} live · ${fmt(s.bots || 0)} bots`
          : 'Matchmaking ready';
      })
      .catch(() => {
        $('#menuOnline').textContent = 'Offline — reconnecting…';
      });
    fetch('/api/live', { headers: { accept: 'application/json' } })
      .then((r) => r.json())
      .then((live) => {
        if (this.game.state !== 'menu') return;
        const el = $('#menuLiveBoard');
        if (!live.top || !live.top.length) {
          el.innerHTML = '<li class="empty">The arena is quiet — be the first blob in.</li>';
          return;
        }
        el.innerHTML = live.top.slice(0, 5).map((e, i) => `
          <li class="live-row ${i === 0 ? 'top1' : ''}">
            <span class="pos">${i + 1}</span>
            <i class="dot-skin" style="background:${skinColor(e.skin)}"></i>
            <span class="who">${escapeHtml(e.name)}${e.isBot ? '<span class="bot-tag">BOT</span>' : ''}</span>
            <span class="mass">${fmtCompact(e.mass)}</span>
          </li>`).join('');
      })
      .catch(() => {});
    this.fetchGlobalBoard();
  }

  fetchGlobalBoard() {
    net.request('leaderboard:get', { kind: 'rating' }, 4000).then((res) => {
      if (!res || !res.ok) return;
      this.liveBoard = res.entries;
      const el = $('#menuGlobalBoard');
      if (!res.entries.length) {
        el.innerHTML = '<li class="empty">No ranked blobs yet — be the first.</li>';
        return;
      }
      el.innerHTML = res.entries.slice(0, 6).map((e, i) => {
        const tier = CAT.rankForRating(e.rating);
        return `<li class="global-row">
          <span class="pos">${i + 1}</span>
          <span class="who"><i class="dot-skin" style="background:${skinColor(e.skin)}"></i><span>${escapeHtml(e.name)}</span></span>
          <span class="tier-tag" style="color:${tier.color};background:${tier.color}1a">${tier.name}</span>
        </li>`;
      }).join('');
    }).catch(() => {});
  }

  renderMenu() {
    if (!this.profile) return;
    const p = this.profile;
    // Never overwrite a name the player is currently typing.
    const nameInput = $('#playerNameInput');
    if (nameInput && !this.nameDirty && document.activeElement !== nameInput) nameInput.value = p.name;
    $('#menuLevelBadge').textContent = p.level;
    $('#menuLevelTitle').textContent = `Level ${p.level} Blob`;
    $('#menuXpFill').style.width = `${clamp((p.xpInto / Math.max(1, p.xpNext)) * 100, 0, 100)}%`;
    $('#menuXpText').textContent = `${fmt(p.xpInto)} / ${fmt(p.xpNext)} XP`;
    $('#menuTier').textContent = p.tier ? `${p.tier.icon} ${p.tier.name}` : 'Rookie';
    $('#menuKills').textContent = fmt(p.kills);
    $('#menuWins').textContent = fmt(p.top1);
    $('#menuBest').textContent = fmtCompact(p.bestMass);
    $('#menuCoins').textContent = fmt(p.coins);
    $('#accountStatus').textContent = net.ready ? 'Connected' : 'Connecting…';
    $('#accountRank').textContent = p.tier ? `${p.tier.icon} ${p.tier.name}` : '—';
    $('#accountPlaytime').textContent = fmtPlaytime(p.playtime);
    this.applyLoadoutPreviews();
  }

  applyLoadoutPreviews() {
    if (!this.profile) return;
    const skin = CAT.ITEMS[this.profile.skin] || CAT.SKINS[0];
    const trail = CAT.ITEMS[this.profile.trail];
    const effect = CAT.ITEMS[this.profile.effect];
    const mini = $('#menuSkinMini .blob-preview');
    decorateBlob(mini, skin);
    decorateBlob($('#profileBlob'), skin);
    const chips = [
      { label: skin.name, color: CAT.RARITIES[skin.rarity].color },
      { label: trail && trail.id !== 'trail_none' ? trail.name : 'No trail', color: trail ? CAT.RARITIES[trail.rarity].color : '#9aa8bd' },
      { label: effect ? effect.name : 'Classic Pop', color: effect ? CAT.RARITIES[effect.rarity].color : '#9aa8bd' }
    ];
    $('#loadoutChips').innerHTML = chips.map((c) => `<span class="chip" style="border-color:${c.color}55;color:${c.color}">${escapeHtml(c.label)}</span>`).join('');
  }

  startHeroAnimation() {
    const canvas = $('#heroCanvas');
    if (!canvas) return;
    const start = performance.now();
    const loop = () => {
      requestAnimationFrame(loop);
      if ($('#menuScreen').classList.contains('hidden')) return;
      const t = (performance.now() - start) / 1000;
      const skinId = this.profile ? this.profile.skin : 'bubblegum';
      const trailId = this.profile ? this.profile.trail : 'trail_none';
      drawHeroBlob(canvas, skinId, t, trailId);
    };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ match
  async startMatch() {
    if (this.game.state === 'playing') return;
    const nameInput = $('#playerNameInput');
    const clean = (nameInput.value || '').replace(/[^\p{L}\p{N} _\-.]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
    if (clean.length >= 2 && this.profile && clean !== this.profile.name) {
      storage.set('blobbrawl.name', clean);
      this.nameDirty = false;
      try {
        const res = await net.request('name:set', { name: clean });
        if (res && res.ok && res.profile) this.updateProfile(res.profile);
      } catch { /* play can continue with the old name */ }
    }
    const btn = $('#btnPlay');
    btn.disabled = true;
    btn.innerHTML = '<span class="play-ico">◌</span> Joining arena…';
    audio.unlock();
    audio.play('start');
    const res = await this.game.play();
    btn.disabled = false;
    btn.innerHTML = '<span class="play-ico">▶</span> Play now';
    if (!res || !res.ok) {
      toast((res && res.error) || 'Could not join the arena. Try again.', 'bad');
      audio.play('error');
      this.showScreen('menuScreen');
    }
  }

  leaveMatch() {
    this.leaving = true;
    this.game.leaveToMenu();
    this.leaving = false;
    this.everPlayed = true;
    this.showScreen('menuScreen');
    $('#hud').classList.add('hidden');
    $('#deathScreen').classList.add('hidden');
    this.fetchProfile();
  }

  bindNet() {
    net.on('fatal', (p) => {
      this.bootFailed(p.message || 'Could not reach the server.');
    });
    net.on('connection', (status) => {
      this.setConnection(status.connected, status.reconnected);
    });
    net.on('ready', (res) => {
      this.hideBoot();
      this.setConnection(true);
      if (res) {
        this.updateProfile(res.profile, res.missions, res.history);
      }
      if (this.statsTimer) this.loadStats();
      if (this.game.state === 'playing') {
        // Auto-reconnect straight back into the arena.
        this.game.play();
      } else if (this.game.state === 'dead') {
        this.game.leaveToMenu(true);
        this.showScreen('menuScreen');
        $('#deathScreen').classList.add('hidden');
      }
    });
    net.on('profile', (profile) => {
      if (profile) this.updateProfile(profile);
    });
  }

  updateProfile(profile, missions, history) {
    if (!profile) return;
    this.profile = profile;
    net.setProfile(profile);
    if (missions) this.missions = missions;
    if (history) this.history = history;
    if (!this.missions.length) this.fetchProfile();
    this.applySettingsFromProfile();
    $('#menuOnline')?.classList.remove('hidden');
    this.renderMenu();
    this.renderMissions($('#missionList'));
    this.renderMissions($('#profileMissions'));
    this.renderProfile();
    this.updateWallets();
    if (this.currentScreen === 'shopScreen') this.renderShop();
    if (this.currentScreen === 'boardScreen') this.renderBoard();
  }

  updateWallets() {
    if (!this.profile) return;
    const coins = fmt(this.profile.coins);
    $('#shopCoins').textContent = coins;
    $('#profileCoins').textContent = coins;
    $('#menuCoins').textContent = coins;
  }

  fetchProfile() {
    if (!net.ready) return;
    net.request('profile:get', {}, 5000).then((res) => {
      if (!res || !res.ok) return;
      if (res.profile) this.updateProfile(res.profile, res.missions, res.history);
    }).catch(() => {});
  }

  // ------------------------------------------------------------------- HUD
  bindHud() {
    $('#btnMinimap').addEventListener('click', () => {
      $('#btnMinimap').classList.toggle('collapsed');
    });
    this.game.on('enter', (payload) => {
      this.everPlayed = true;
      this.leaving = false;
      for (const s of SCREENS) $('#' + s).classList.add('hidden');
      $('#deathScreen').classList.add('hidden');
      $('#hud').classList.remove('hidden');
      $('#killFeed').innerHTML = '';
      $('#hudHint').style.opacity = '1';
      $('#roomLabel').textContent = (payload && payload.roomId ? payload.roomId.replace('arena-', 'Arena ') : 'Arena');
      $('#connBadge').className = 'conn-badge good';
      $('#connBadge').querySelector('span').textContent = 'Live';
      $('#arenaPill').textContent = '1 blob';
      this.announce('Good luck — eat everything');
      setTimeout(() => { $('#hudHint').style.opacity = '0'; }, 9000);
      this.showMobileControls();
    });
    this.game.on('exit', () => {
      $('#hud').classList.add('hidden');
      $('#deathScreen').classList.add('hidden');
      this.showScreen('menuScreen');
    });
    this.game.on('hud', (data) => this.hud(data));
    this.game.on('board', (msg) => this.renderLiveBoard(msg));
    this.game.on('feed', (entry) => this.addFeed(entry));
    this.game.on('announce', (a) => this.announce(a.text));
    this.game.on('death', (payload) => this.showDeath(payload));
    this.game.on('deathPending', () => {
      $('#announce')?.classList.remove('show');
    });
    this.game.on('joinFailed', (info) => {
      if (this.game.state === 'menu') toast(info.error || 'Could not join', 'bad');
    });
    this.game.on('kicked', (info) => {
      toast((info && info.reason) || 'Session moved elsewhere', 'bad');
      this.leaveMatch();
    });
  }

  showMobileControls() {
    const touch = this.input.isTouch;
    document.body.classList.toggle('touch', touch);
    $('#mobileControls').setAttribute('aria-hidden', touch ? 'false' : 'true');
  }

  hud(data) {
    if (this.game.state === 'menu') return;
    $('#hudSize').textContent = fmt(data.size);
    $('#hudScore').textContent = fmt(data.score);
    $('#hudKills').textContent = fmt(data.kills);
    $('#hudTime').textContent = fmtTime(data.time);
    const ratio = clamp(data.boostRatio, 0, 1);
    $('#boostFill').style.width = `${ratio * 100}%`;
    const meter = $('#boostMeter');
    const cooling = data.cooldown > 0 || ratio <= 0.01;
    meter.classList.toggle('cooling', cooling);
    $('#boostLabel').textContent = data.boosting ? 'BOOSTING' : (cooling ? `COOLDOWN ${Math.ceil(data.cooldown)}s` : 'BOOST');
  }

  renderLiveBoard(msg) {
    const top = (msg && msg.top) || [];
    const list = $('#leaderboardList');
    const selfId = this.game.self ? this.game.self.id : null;
    if (!top.length) {
      list.innerHTML = '<li class="board-row"><span class="pos">–</span><span class="who">Arena warming up…</span><span class="mass"></span></li>';
    } else {
      list.innerHTML = top.slice(0, 10).map((e) => `
        <li class="board-row ${e.id === selfId ? 'me' : ''}">
          <span class="pos">${e.rank}</span>
          <span class="who">${escapeHtml(e.name)}${e.isBot ? '<span class="bot-tag">BOT</span>' : ''}</span>
          <span class="mass">${fmtCompact(e.mass)}</span>
        </li>`).join('');
    }
    const count = msg && msg.players ? msg.players : 1;
    $('#arenaPill').textContent = `${count} blob${count === 1 ? '' : 's'}`;
    $('#arenaCount').textContent = `${count} blob${count === 1 ? '' : 's'}`;

    // Mirror the live top 5 on the main menu.
    const menuBoard = $('#menuLiveBoard');
    if (top.length) {
      menuBoard.innerHTML = top.slice(0, 5).map((e) => `
        <li class="live-row ${e.rank === 1 ? 'top1' : ''}">
          <span class="pos">${e.rank}</span>
          <i class="dot-skin" style="background:${skinColor(e.skin)}"></i>
          <span class="who">${escapeHtml(e.name)}${e.isBot ? '<span class="bot-tag">BOT</span>' : ''}</span>
          <span class="mass">${fmtCompact(e.mass)}</span>
        </li>`).join('');
    }
  }

  addFeed(entry) {
    if (!entry || entry.type !== 'kill') return;
    const feed = $('#killFeed');
    const div = document.createElement('div');
    div.className = 'feed-item';
    const killer = entry.killer || {};
    const victim = entry.victim || {};
    div.innerHTML = `<span class="k">${escapeHtml(killer.name || '?')}</span> ate <span class="v">${escapeHtml(victim.name || '?')}</span> <span class="mass">+${fmtCompact(entry.mass || 0)}</span>`;
    feed.prepend(div);
    while (feed.children.length > 5) feed.lastChild.remove();
    setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 300); }, 6000);
  }

  announce(text) {
    const el = $('#announce');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ----------------------------------------------------------------- death
  bindDeath() {
    $('#btnRespawn').addEventListener('click', async () => {
      const btn = $('#btnRespawn');
      btn.disabled = true;
      btn.innerHTML = '<span class="play-ico">◌</span> Respawning…';
      $('#deathScreen').classList.add('hidden');
      audio.play('click');
      const res = await this.game.respawn();
      btn.disabled = false;
      btn.innerHTML = '<span class="play-ico">▶</span> Respawn now';
      if (!res || !res.ok) {
        toast((res && res.error) || 'Could not respawn — check your connection.', 'bad');
        this.showScreen('menuScreen');
        $('#hud').classList.add('hidden');
      }
    });
    $('#btnDeathMenu').addEventListener('click', () => {
      audio.play('click');
      this.game.leaveToMenu();
      $('#hud').classList.add('hidden');
      this.showScreen('menuScreen');
      this.fetchProfile();
    });
  }

  showDeath(payload) {
    const stats = payload.stats || {};
    const summary = payload.summary || null;
    const killer = payload.killer;
    $('#deathEyebrow').textContent = payload.reason === 'disconnect' ? 'Connection lost' : 'Eliminated';
    if (killer) {
      $('#deathTitle').textContent = `Eaten by ${killer.name}`;
      $('#deathSub').textContent = killer.isBot
        ? 'A bot got you. It will remember this. You should not.'
        : 'A bigger blob got the last bite. Revenge is one click away.';
    } else if (payload.reason === 'disconnect') {
      $('#deathTitle').textContent = 'You dropped out';
      $('#deathSub').textContent = 'The arena kept your rewards — jump back in.';
    } else {
      $('#deathTitle').textContent = 'Life over';
      $('#deathSub').textContent = 'Every blob respawns. Make the next one count.';
    }

    $('#deathStats').innerHTML = `
      <div><strong>#${fmt(stats.rank || 0)}</strong><span>Placement</span></div>
      <div><strong>${fmt(stats.kills || 0)}</strong><span>Kills</span></div>
      <div><strong>${fmt(stats.orbs || 0)}</strong><span>Orbs</span></div>
      <div><strong>${fmtTime(stats.seconds || 0)}</strong><span>Survived</span></div>
      <div><strong>${fmtCompact(stats.maxMass || 0)}</strong><span>Max size</span></div>
    `;

    const rewards = (summary && summary.rewards) || { coins: 0, xp: 0, ratingDelta: 0 };
    $('#deathCoins').textContent = fmt(rewards.coins);
    $('#deathXp').textContent = fmt(rewards.xp);
    const ratingEl = $('#deathRating');
    ratingEl.textContent = `${rewards.ratingDelta >= 0 ? '+' : ''}${fmt(rewards.ratingDelta)} rating`;
    ratingEl.classList.toggle('negative', rewards.ratingDelta < 0);

    const p = this.profile;
    if (p) {
      const pct = clamp((p.xpInto / Math.max(1, p.xpNext)) * 100, 0, 100);
      $('#deathXpFill').style.width = `${pct}%`;
      $('#deathLevelText').textContent = `Level ${p.level} · ${fmt(p.xpInto)} / ${fmt(p.xpNext)} XP`;
    } else {
      $('#deathXpFill').style.width = '0%';
      $('#deathLevelText').textContent = 'Level 1';
    }
    $('#deathLevelUp').classList.toggle('hidden', !(summary && summary.levelUp));

    const extras = [];
    if (summary && summary.levelUp) {
      extras.push(`<div class="extra-row"><span class="ico">⭐</span><span>Level up! You reached <b>level ${summary.levelAfter}</b>.</span></div>`);
    }
    if (summary && summary.achievements) {
      for (const a of summary.achievements) {
        extras.push(`<div class="extra-row"><span class="ico">🏆</span><span>Achievement unlocked: <b>${escapeHtml(a.name)}</b> · +${a.coins} coins</span></div>`);
      }
    }
    if (summary && summary.drop) {
      const d = summary.drop;
      const rar = CAT.RARITIES[d.rarity] || CAT.RARITIES.common;
      extras.push(`<div class="extra-row"><span class="ico">✦</span><span>Rare drop: <b>${escapeHtml(d.name)}</b></span><span class="rarity" style="color:${rar.color}">${rar.label}</span></div>`);
    }
    if (summary && summary.rewards && summary.rewards.coins === 0 && !extras.length) {
      extras.push('<div class="extra-row"><span class="ico">🫧</span><span>No rewards recorded for this life. Play a little longer next time.</span></div>');
    }
    $('#deathExtras').innerHTML = extras.join('');
    $('#deathTip').textContent = `Tip: ${TIPS[(Math.random() * TIPS.length) | 0]}`;
    $('#deathScreen').classList.remove('hidden');
    $('#announce').classList.remove('show');

    if (summary && summary.levelUp) audio.play('levelup');
    if (summary && summary.achievements && summary.achievements.length) audio.play('achievement');
    if (summary && summary.drop) audio.play('drop');
    this.fetchProfile();
  }

  // ------------------------------------------------------------------ shop
  bindShop() {
    $$('#shopTabs .tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.shopTab = tab.dataset.tab;
        $$('#shopTabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
        audio.play('click');
        this.renderShop();
      });
    });
    $('#shopGrid').addEventListener('click', (e) => {
      const buy = e.target.closest('[data-buy]');
      if (buy) { this.purchase(buy.dataset.buy); return; }
      const equip = e.target.closest('[data-equip]');
      if (equip) { this.equip(equip.dataset.equip); return; }
      const locked = e.target.closest('[data-locked]');
      if (locked) toast('Play more matches to unlock this item.', 'bad');
    });
  }

  renderShop() {
    if (!this.profile) return;
    const grid = $('#shopGrid');
    const owned = new Set(this.profile.unlocks || []);
    const items = this.shopTab === 'trail' ? CAT.TRAILS : this.shopTab === 'effect' ? CAT.EFFECTS : CAT.SKINS;
    const equippedId = this.shopTab === 'skin' ? this.profile.skin : this.shopTab === 'trail' ? this.profile.trail : this.profile.effect;
    const level = this.profile.level;

    grid.innerHTML = items.map((item) => {
      const rarity = CAT.RARITIES[item.rarity] || CAT.RARITIES.common;
      const isOwned = owned.has(item.id);
      const isEquipped = equippedId === item.id;
      const locked = item.unlockLevel && level < item.unlockLevel;
      let action;
      if (isEquipped) action = '<button class="btn soft" type="button" disabled>Equipped</button>';
      else if (isOwned) action = `<button class="btn soft" type="button" data-equip="${item.id}">Equip</button>`;
      else if (item.dropOnly) action = '<span class="drop-tag">✦ Match drop only</span>';
      else if (locked) action = `<button class="btn" type="button" data-locked="${item.id}" disabled>🔒 Level ${item.unlockLevel}</button>`;
      else action = `<button class="btn primary" type="button" data-buy="${item.id}">Unlock · ◉ ${fmt(item.price)}</button>`;

      const art = this.shopTab === 'skin'
        ? `<div class="blob-preview" style="--c1:${item.colors[0]};--c2:${item.colors[1]};--accent:${item.accent};--glow:${item.glow}" data-pattern="${item.pattern}" data-eyes="${item.eyes}"></div>`
        : this.shopTab === 'trail'
          ? `<div class="trail-demo" style="--t1:${item.colors[0]};--t2:${item.colors[1]}">${'<i></i>'.repeat(6)}</div>`
          : `<div class="fx-demo" style="--f1:${item.colors[0]};--f2:${item.colors[1]}"><i></i><i></i><i></i></div>`;

      return `<article class="shop-card ${isOwned ? 'owned' : ''} ${isEquipped ? 'equipped' : ''} ${locked ? 'locked' : ''}" style="--rarity-color:${rarity.color};--rarity-glow:${rarity.color}33">
        <span class="rarity-badge" style="--rarity-color:${rarity.color}">${rarity.label}</span>
        <div class="shop-art">${art}</div>
        <div class="shop-info">
          <h3>${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(item.desc)}</p>
        </div>
        ${item.type === 'trail' && item.id === 'trail_none' ? '' : ''}
        <div class="shop-buy">${action}</div>
      </article>`;
    }).join('');

    $$('#shopGrid .blob-preview').forEach((el, i) => {
      const source = items[i];
      if (source) decorateBlob(el, source);
    });
    this.updateWallets();
  }

  async purchase(itemId) {
    const item = CAT.ITEMS[itemId];
    if (!item || !this.profile) return;
    if (this.profile.coins < item.price) {
      audio.play('error');
      toast(`You need ${fmt(item.price - this.profile.coins)} more coins. Keep playing!`, 'bad');
      return;
    }
    const rarity = CAT.RARITIES[item.rarity] || CAT.RARITIES.common;
    const previewArt = item.type === 'skin'
      ? `<span class="blob-preview" style="--c1:${item.colors[0]};--c2:${item.colors[1]};--glow:${item.glow};width:46px;height:46px"></span>`
      : '';
    const ok = await confirmModal({
      title: `Unlock ${item.name}?`,
      text: `${rarity.label} ${item.type} · ${item.desc}`,
      preview: `${previewArt}<span>◉ ${fmt(item.price)}</span>`,
      confirm: 'Unlock now'
    });
    if (!ok) return;
    try {
      const res = await net.request('shop:buy', { id: itemId });
      if (res && res.ok) {
        if (res.profile) this.updateProfile(res.profile);
        audio.play('buy');
        toast(`${item.name} unlocked!`, 'gold');
        this.renderShop();
        this.renderMenu();
        await this.equip(itemId, true);
      } else {
        audio.play('error');
        toast((res && res.error) || 'Purchase failed', 'bad');
      }
    } catch (err) { showRequestError(err); }
  }

  async equip(itemId, silent = false) {
    try {
      const res = await net.request('item:equip', { id: itemId });
      if (res && res.ok) {
        if (res.profile) this.updateProfile(res.profile);
        if (!silent) { audio.play('click'); toast('Equipped'); }
        this.renderShop();
        this.renderMenu();
      } else {
        toast((res && res.error) || 'Could not equip', 'bad');
      }
    } catch (err) { showRequestError(err); }
  }

  // ----------------------------------------------------------------- ranks
  bindBoard() {
    $$('#boardTabs .tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.boardKind = tab.dataset.kind;
        $$('#boardTabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
        audio.play('click');
        this.fetchBoard(true);
      });
    });
    const strip = $('#tierStrip');
    if (strip) {
      strip.innerHTML = CAT.RANK_TIERS.map((t) => (
        `<span class="tier-chip" style="color:${t.color};border-color:${t.color}44">${t.icon} ${t.name} · ${fmt(t.min)}</span>`
      )).join('');
    }
  }

  fetchBoard(force = false) {
    const cached = this.boardCache[this.boardKind];
    if (!force && cached && Date.now() - cached.at < 20000) {
      this.boardEntries = cached.entries;
      this.renderBoard();
      return;
    }
    net.request('leaderboard:get', { kind: this.boardKind }, 6000).then((res) => {
      if (!res || !res.ok) return;
      this.boardCache[this.boardKind] = { at: Date.now(), entries: res.entries };
      this.boardEntries = res.entries;
      if (this.currentScreen === 'boardScreen') this.renderBoard();
      $('#boardUpdated').textContent = 'Updated just now';
    }).catch(() => {});
  }

  renderBoard() {
    const list = $('#boardList');
    if (!list) return;
    const entries = this.boardEntries || [];
    if (!entries.length) {
      list.innerHTML = '<p class="empty">No ranked blobs yet. Play a match to claim the first spot.</p>';
      return;
    }
    const kindLabel = this.boardKind === 'level' ? 'Level' : this.boardKind === 'kills' ? 'Eliminations' : 'Rating';
    list.innerHTML = `<div class="rank-row head">
        <span>Rank</span><span>#</span><span>Blob</span>
        <span style="text-align:right">${kindLabel}</span>
        <span class="num" style="text-align:right">Peak mass</span>
        <span class="num hide-sm" style="text-align:right">Kills</span>
      </div>` + entries.map((e) => {
      const tier = CAT.rankForRating(e.rating);
      const level = CAT.levelFromXp(e.xp).level;
      const value = this.boardKind === 'level' ? `Lv ${level}` : this.boardKind === 'kills' ? fmt(e.kills) : fmt(e.rating);
      const isMe = this.profile && e.name === this.profile.name;
      return `<div class="rank-row ${e.rank <= 3 ? 'top' : ''}" style="${isMe ? 'box-shadow:inset 0 0 0 1px rgba(157,107,255,.4);background:rgba(157,107,255,.1)' : ''}">
        <span class="rank">#${e.rank}</span>
        <i class="dot-skin" style="background:${skinColor(e.skin)}"></i>
        <span class="who"><b>${escapeHtml(e.name)}</b><span class="tier-tag" style="color:${tier.color};background:${tier.color}1a">${tier.name}</span>${isMe ? '<span class="bot-tag" style="color:#dcd2ff;background:rgba(157,107,255,.25)">YOU</span>' : ''}</span>
        <span class="num" style="text-align:right;font-weight:700">${value}</span>
        <span class="num" style="text-align:right">${fmtCompact(e.bestMass)}</span>
        <span class="num hide-sm" style="text-align:right">${fmt(e.kills)}</span>
      </div>`;
    }).join('');
  }

  // --------------------------------------------------------------- profile
  bindProfile() {
    $('#achievementGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.achievement');
      if (!card) return;
      toast(card.dataset.tip || '', card.classList.contains('unlocked') ? 'good' : '');
    });
    $('#profileMissions').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-claim]');
      if (btn) this.claimMission(btn.dataset.claim);
    });
    $('#missionList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-claim]');
      if (btn) this.claimMission(btn.dataset.claim);
    });
  }

  renderProfile() {
    const p = this.profile;
    if (!p) return;
    $('#profileName').textContent = p.name;
    $('#profileTier').textContent = p.tier ? `${p.tier.icon} ${p.tier.name}` : 'Rookie';
    $('#profileTier').style.color = p.tier ? p.tier.color : '#3ee0ff';
    $('#profileLevelBadge').textContent = p.level;
    $('#profileLevelTitle').textContent = `Level ${p.level}`;
    $('#profileXpFill').style.width = `${clamp((p.xpInto / Math.max(1, p.xpNext)) * 100, 0, 100)}%`;
    $('#profileXpText').textContent = `${fmt(p.xpInto)} / ${fmt(p.xpNext)} XP`;
    $('#profileRating').textContent = fmt(p.rating);
    $('#profileRank').textContent = `#${fmt(p.rank || 0)}`;
    $('#profileBestRating').textContent = fmt(p.bestRating);
    $('#statKills').textContent = fmt(p.kills);
    $('#statDeaths').textContent = fmt(p.deaths);
    $('#statGames').textContent = fmt(p.games);
    $('#statWins').textContent = fmt(p.top1);
    $('#statOrbs').textContent = fmt(p.orbs);
    $('#statBestMass').textContent = fmtCompact(p.bestMass);
    $('#statCoinsEarned').textContent = fmt(p.coinsEarned);
    $('#statPlaytime').textContent = fmtPlaytime(p.playtime);
    decorateBlob($('#profileBlob'), CAT.ITEMS[p.skin] || CAT.SKINS[0]);
    this.updateWallets();

    const unlocked = new Set(p.achievements || []);
    $('#achCount').textContent = `${unlocked.size} / ${CAT.ACHIEVEMENTS.length}`;
    $('#achievementGrid').innerHTML = CAT.ACHIEVEMENTS.map((a) => {
      const has = unlocked.has(a.id);
      const icon = ACH_ICONS[a.stat] || '🏆';
      return `<div class="achievement ${has ? 'unlocked' : ''}" data-tip="${escapeHtml(a.desc)}${has ? ' · Unlocked' : ''}">
        <span class="ach-ico">${has ? icon : '🔒'}</span>
        <div><b>${escapeHtml(a.name)}</b><span>${escapeHtml(a.desc)}</span></div>
      </div>`;
    }).join('');
    this.renderMissions($('#profileMissions'));
    this.renderHistory();
  }

  renderHistory() {
    const el = $('#matchHistory');
    if (!this.history || !this.history.length) {
      el.innerHTML = '<p class="empty">Play a match to start your history.</p>';
      return;
    }
    el.innerHTML = `<div class="history-row head"><span>When</span><span>Place</span><span>Kills</span><span>Mass</span><span>Orbs</span><span>Coins</span><span>Rating</span></div>` +
      this.history.map((m) => `<div class="history-row">
        <span>${timeAgo(m.ts)}</span>
        <span class="pos">${m.rank ? '#' + m.rank : '—'}</span>
        <span>${m.kills}</span>
        <span>${fmtCompact(m.mass)}</span>
        <span>${m.orbs}</span>
        <span class="coin">+${m.coins}</span>
        <span style="color:${m.ratingDelta >= 0 ? '#b6f36a' : '#ff6b7a'}">${m.ratingDelta >= 0 ? '+' : ''}${m.ratingDelta}</span>
      </div>`).join('');
  }

  renderMissions(container) {
    if (!container) return;
    if (!this.missions || !this.missions.length) {
      container.innerHTML = '<p class="empty">Missions load with your profile.</p>';
      return;
    }
    container.innerHTML = this.missions.map((m) => {
      const pct = clamp((m.progress / Math.max(1, m.target)) * 100, 0, 100);
      let action = '';
      if (m.claimed) action = '<span class="lock-note">Claimed ✓</span>';
      else if (m.progress >= m.target) action = `<button class="btn tiny primary" type="button" data-claim="${m.id}">Claim</button>`;
      else action = `<span class="lock-note">${fmt(Math.floor(m.progress))} / ${fmt(m.target)}</span>`;
      return `<div class="mission ${m.progress >= m.target ? 'done' : ''}">
        <div class="mission-icon">${MISSION_ICONS[m.icon] || '🎯'}</div>
        <div style="min-width:0">
          <div class="mission-name">${escapeHtml(m.name)}</div>
          <div class="mission-desc">${escapeHtml(m.desc || '')}</div>
          <div class="mission-track"><span style="width:${pct}%"></span></div>
        </div>
        <div class="mission-reward">◉ ${fmt(m.coins)}<span class="xp">${fmt(m.xp)} XP</span>${action}</div>
      </div>`;
    }).join('');
  }

  async claimMission(missionId) {
    try {
      const res = await net.request('mission:claim', { id: missionId });
      if (res && res.ok) {
        audio.play('buy');
        toast(`Mission reward claimed: +${fmt(res.coins)} coins, +${fmt(res.xp)} XP`, 'gold');
        if (res.profile) this.updateProfile(res.profile, res.missions);
        else this.fetchProfile();
      } else {
        audio.play('error');
        toast((res && res.error) || 'Could not claim', 'bad');
      }
    } catch (err) { showRequestError(err); }
  }

  // --------------------------------------------------------------- settings
  bindSettings() {
    const bindToggle = (id, key) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('change', () => this.setSetting(key, el.checked));
    };
    bindToggle('#setSound', 'sound');
    bindToggle('#setMusic', 'music');
    bindToggle('#setGrid', 'showGrid');
    bindToggle('#setNames', 'showNames');
    bindToggle('#setShake', 'shake');
    bindToggle('#setReduced', 'reducedMotion');
    bindToggle('#setColorblind', 'colorblind');
    bindToggle('#setLargeUI', 'largeUI');
    bindToggle('#setContrast', 'contrast');

    const sfx = $('#setSfxVolume');
    sfx.addEventListener('input', () => {
      $('#sfxVolLabel').textContent = `${sfx.value}%`;
      this.setSetting('sfxVolume', Number(sfx.value) / 100);
    });
    const music = $('#setMusicVolume');
    music.addEventListener('input', () => {
      $('#musicVolLabel').textContent = `${music.value}%`;
      this.setSetting('musicVolume', Number(music.value) / 100);
    });

    $$('#qualityGroup button').forEach((btn) => btn.addEventListener('click', () => {
      this.setSetting('quality', btn.dataset.q);
      this.syncSettingsUi();
      audio.play('click');
    }));
    $$('#controlGroup button').forEach((btn) => btn.addEventListener('click', () => {
      this.setSetting('controlMode', btn.dataset.c);
      this.syncSettingsUi();
      audio.play('click');
    }));
    $$('#boostGroup button').forEach((btn) => btn.addEventListener('click', () => {
      this.setSetting('boostMode', btn.dataset.b);
      this.syncSettingsUi();
      audio.play('click');
    }));

    $('#btnResetSettings').addEventListener('click', () => {
      this.settings = Object.assign({}, DEFAULT_SETTINGS);
      this.applySettings();
      this.syncSettingsUi();
      this.saveSettings();
      audio.play('click');
      toast('Settings reset to defaults');
    });
  }

  resetSettingsUi() {
    this.syncSettingsUi();
  }

  applySettingsFromProfile() {
    if (!this.profile || !this.profile.settings) return;
    if (this.settingsInitialized) return;
    this.settingsInitialized = true;
    const incoming = this.profile.settings;
    const merged = Object.assign({}, DEFAULT_SETTINGS, this.settings);
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (incoming[key] === undefined) continue;
      const def = DEFAULT_SETTINGS[key];
      let value = incoming[key];
      if (typeof def === 'boolean') value = value === true || value === 'true';
      else if (typeof def === 'number') value = clamp(Number(value) || 0, 0, 1);
      else if (key === 'quality') value = ['low', 'medium', 'high'].includes(value) ? value : 'high';
      else if (key === 'controlMode') value = ['mouse', 'keys', 'both'].includes(value) ? value : 'both';
      else if (key === 'boostMode') value = value === 'toggle' ? 'toggle' : 'hold';
      merged[key] = value;
    }
    this.settings = merged;
    this.applySettings();
    this.syncSettingsUi();
  }

  setSetting(key, value) {
    this.settings[key] = value;
    this.applySettings();
    this.saveSettings();
  }

  applySettings() {
    const s = this.settings;
    document.body.classList.toggle('reduced-motion', !!s.reducedMotion);
    document.body.classList.toggle('colorblind', !!s.colorblind);
    document.body.classList.toggle('large-ui', !!s.largeUI);
    document.body.classList.toggle('high-contrast', !!s.contrast);
    audio.applySettings(s);
    if (this.game.renderer) {
      this.game.renderer.setQuality(s.quality);
      this.game.renderer.setSettings({
        showGrid: s.showGrid,
        showNames: s.showNames,
        reducedMotion: s.reducedMotion,
        colorblind: s.colorblind,
        shake: s.shake
      });
    }
    this.input.setControlMode(s.controlMode);
    this.input.setBoostMode(s.boostMode);
    $('#btnSoundToggle').textContent = s.sound ? '🔊' : '🔇';
    if (this.profile) {
      this.profile.settings = Object.assign({}, this.settings);
    }
  }

  applyBodyClasses() {
    if (this.input.isTouch) document.body.classList.add('touch');
  }

  syncSettingsUi() {
    const s = this.settings;
    const set = (id, val) => { const el = $(id); if (el) el.checked = !!val; };
    set('#setSound', s.sound);
    set('#setMusic', s.music);
    set('#setGrid', s.showGrid);
    set('#setNames', s.showNames);
    set('#setShake', s.shake);
    set('#setReduced', s.reducedMotion);
    set('#setColorblind', s.colorblind);
    set('#setLargeUI', s.largeUI);
    set('#setContrast', s.contrast);
    zRange('#setSfxVolume', s.sfxVolume * 100);
    zRange('#setMusicVolume', s.musicVolume * 100);
    $('#sfxVolLabel').textContent = `${Math.round(s.sfxVolume * 100)}%`;
    $('#musicVolLabel').textContent = `${Math.round(s.musicVolume * 100)}%`;
    $$('#qualityGroup button').forEach((b) => b.classList.toggle('active', b.dataset.q === s.quality));
    $$('#controlGroup button').forEach((b) => b.classList.toggle('active', b.dataset.c === s.controlMode));
    $$('#boostGroup button').forEach((b) => b.classList.toggle('active', b.dataset.b === s.boostMode));
    $('#btnSoundToggle').textContent = s.sound ? '🔊' : '🔇';
  }

  persistSettings() {
    if (!net.ready) return;
    const payload = {};
    for (const key of ['sound', 'music', 'quality', 'showGrid', 'showNames', 'reducedMotion', 'colorblind', 'controlMode', 'sfxVolume', 'musicVolume', 'shake', 'boostMode', 'largeUI', 'contrast']) {
      payload[key] = this.settings[key];
    }
    net.request('settings:save', { settings: payload }, 5000).catch(() => {});
  }

  // ------------------------------------------------------------ connection
  setConnection(connected, reconnected = false) {
    const badge = $('#connBadge');
    const overlay = $('#connectionOverlay');
    if (connected) {
      badge.className = 'conn-badge good';
      badge.querySelector('span').textContent = 'Live';
      overlay.classList.add('hidden');
      this.connectionLost = false;
      if (reconnected) toast('Reconnected to the arena', 'good');
    } else {
      badge.className = 'conn-badge bad';
      badge.querySelector('span').textContent = 'Offline';
      this.connectionLost = true;
      if (this.everPlayed) {
        overlay.classList.remove('hidden');
        $('#connectionDetail').textContent = this.game.state === 'playing'
          ? 'Holding your blob on the field for a few seconds…'
          : 'Restoring your session…';
      }
    }
  }
}

function zRange(id, value) {
  const el = $(id);
  if (el) el.value = String(Math.round(value));
}

function skinColor(skinId) {
  const item = CAT.ITEMS[skinId];
  return item && item.colors ? item.colors[0] : '#ff6ad5';
}
