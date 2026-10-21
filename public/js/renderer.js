import { clamp, lerp, rand, rgba, hexToRgb } from './utils.js';

const CAT = window.BBCatalog;
const PHYS = window.BBPhysics;
const SKINS = CAT.SKINS;

const QUALITY = {
  low: { maxParticles: 140, glow: false, shadows: false, grid: 200, nebula: false, eyeDetail: false },
  medium: { maxParticles: 340, glow: true, shadows: false, grid: 140, nebula: true, eyeDetail: true },
  high: { maxParticles: 620, glow: true, shadows: true, grid: 100, nebula: true, eyeDetail: true }
};

class Effects {
  constructor() {
    this.particles = [];
    this.rings = [];
    this.texts = [];
    this.flash = 0;
    this.flashColor = '#ffffff';
    this.quality = 'high';
  }

  get cap() { return QUALITY[this.quality].maxParticles; }

  add(p) {
    this.particles.push(p);
    if (this.particles.length > this.cap) this.particles.splice(0, this.particles.length - this.cap);
  }

  burst(x, y, colors, count, speed = 240, opts = {}) {
    const q = QUALITY[this.quality];
    const n = Math.round(count * (q.glow ? (this.quality === 'high' ? 1 : 0.6) : 0.3));
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = speed * (0.35 + Math.random() * 0.9);
      this.add({
        x, y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 0,
        max: 0.5 + Math.random() * (opts.life || 0.6),
        size: (opts.size || 4) * (0.5 + Math.random()),
        color: colors[(Math.random() * colors.length) | 0],
        shape: opts.shape || 'circle',
        drag: opts.drag ?? 1.8,
        gravity: opts.gravity || 0,
        rot: Math.random() * Math.PI,
        spin: rand(-6, 6)
      });
    }
  }

  ring(x, y, color, radius = 40, life = 0.6, width = 3) {
    this.rings.push({ x, y, color, radius: 4, target: radius, life: 0, max: life, width });
  }

  text(x, y, str, color = '#fff', size = 14) {
    this.texts.push({ x, y, str, color, size, life: 0, max: 1.1 });
  }

  eliminate(x, y, effect, colors, radius) {
    const type = effect ? effect.type : 'pop';
    const fxColors = effect && effect.colors ? effect.colors : colors;
    const scale = clamp(radius / 30, 0.6, 2.6);
    if (type === 'singularity') {
      this.ring(x, y, '#c084fc', 120 * scale, 0.9, 5);
      this.ring(x, y, '#0b1020', 70 * scale, 1.1, 10);
      this.burst(x, y, ['#c084fc', '#7c3aed', '#e9d5ff'], 60, 320, { life: 0.9 });
      this.flash = 0.25; this.flashColor = '#7c3aed';
    } else if (type === 'nova') {
      this.ring(x, y, '#fef08a', 220 * scale, 1.0, 6);
      this.ring(x, y, '#ffffff', 120 * scale, 0.7, 3);
      this.burst(x, y, ['#fef08a', '#f43f5e', '#ffffff'], 80, 460, { life: 0.9 });
      this.flash = 0.4; this.flashColor = '#fff1b8';
    } else if (type === 'fireworks') {
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          this.burst(x + rand(-40, 40), y + rand(-40, 40), fxColors, 26, 320, { life: 0.8 });
          this.ring(x, y, fxColors[i % fxColors.length], 90, 0.5, 2);
        }, i * 90);
      }
    } else if (type === 'confetti') {
      this.burst(x, y, ['#f472b6', '#facc15', '#38bdf8', '#4ade80', '#f0abfc'], 60, 240, { shape: 'rect', gravity: 420, life: 1.4, size: 5, drag: 0.4 });
      this.ring(x, y, '#f0abfc', 90 * scale, 0.55, 3);
    } else if (type === 'embers') {
      this.burst(x, y, ['#fdba74', '#f97316', '#b91c1c'], 52, 260, { gravity: -140, life: 1.2, size: 3.5 });
      this.ring(x, y, '#f97316', 80 * scale, 0.6, 3);
    } else if (type === 'shock') {
      this.ring(x, y, '#bae6fd', 150 * scale, 0.55, 5);
      this.ring(x, y, '#0ea5e9', 90 * scale, 0.75, 3);
      this.burst(x, y, ['#bae6fd', '#0ea5e9', '#ffffff'], 34, 300);
    } else {
      this.burst(x, y, ['#ffffff', '#f0abfc', '#a855f7'], 42, 280);
      this.ring(x, y, '#f0abfc', 90 * scale, 0.5, 3);
    }
    this.burst(x, y, colors, 26, 220);
  }

  trail(type, x, y, color, dt, velocity) {
    if (!type || type === 'none') return;
    const q = QUALITY[this.quality];
    const rate = q.glow ? (type === 'rainbow' ? 34 : 24) : 8;
    if (Math.random() > rate * dt) return;
    const colors = type === 'rainbow'
      ? [`hsl(${(performance.now() / 8) % 360} 95% 65%)`, '#fff']
      : (color || ['#fff']);
    const c = colors[(Math.random() * colors.length) | 0];
    if (type === 'bubbles') {
      this.add({ x: x + rand(-6, 6), y: y + rand(-6, 6), vx: rand(-20, 20), vy: rand(-40, -10), life: 0, max: 0.9, size: rand(3, 7), color: c, shape: 'ring', drag: 0.4, gravity: -30, rot: 0, spin: 0 });
    } else if (type === 'hearts') {
      this.add({ x, y, vx: rand(-16, 16), vy: rand(-36, -12), life: 0, max: 1, size: rand(4, 8), color: '#fb7185', shape: 'heart', drag: 0.6, gravity: -20, rot: 0, spin: 0 });
    } else if (type === 'stars') {
      this.add({ x, y, vx: rand(-24, 24), vy: rand(-30, 10), life: 0, max: 0.8, size: rand(3, 6), color: c, shape: 'star', drag: 0.8, gravity: 0, rot: Math.random() * 6, spin: rand(-4, 4) });
    } else if (type === 'lightning') {
      this.add({ x, y, vx: velocity.x * -0.2 + rand(-30, 30), vy: velocity.y * -0.2 + rand(-30, 30), life: 0, max: 0.5, size: rand(2, 4), color: c, shape: 'spark', drag: 1, gravity: 0, rot: 0, spin: 0 });
    } else if (type === 'void') {
      this.add({ x, y, vx: rand(-16, 16), vy: rand(-16, 16), life: 0, max: 0.9, size: rand(5, 11), color: c, shape: 'ring', drag: 1.2, gravity: 0, rot: 0, spin: 0 });
    } else if (type === 'leaves') {
      this.add({ x, y, vx: rand(-30, 30), vy: rand(-20, 20), life: 0, max: 0.9, size: rand(4, 7), color: c, shape: 'rect', drag: 1, gravity: 40, rot: Math.random() * 6, spin: rand(-6, 6) });
    } else if (type === 'flame') {
      this.add({ x, y, vx: rand(-20, 20), vy: rand(-40, -10), life: 0, max: 0.7, size: rand(4, 9), color: c, shape: 'circle', drag: 1.1, gravity: -60, rot: 0, spin: 0 });
    } else {
      this.add({ x, y, vx: rand(-30, 30), vy: rand(-30, 30), life: 0, max: 0.5, size: rand(2, 5), color: c, shape: 'circle', drag: 2, gravity: 0, rot: 0, spin: 0 });
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) { this.particles.splice(i, 1); continue; }
      p.vx -= p.vx * p.drag * dt;
      p.vy -= p.vy * p.drag * dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life += dt;
      if (r.life >= r.max) { this.rings.splice(i, 1); continue; }
      const t = r.life / r.max;
      r.drawRadius = lerp(4, r.target, 1 - Math.pow(1 - t, 2.2));
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const tx = this.texts[i];
      tx.life += dt;
      tx.y -= 32 * dt;
      if (tx.life >= tx.max) this.texts.splice(i, 1);
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.2);
  }

  draw(ctx, quality) {
    const q = QUALITY[quality];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const r of this.rings) {
      if (r.drawRadius == null) continue;
      const t = r.life / r.max;
      ctx.globalAlpha = (1 - t) * 0.5;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - t * 0.6);
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.drawRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const p of this.particles) {
      const t = p.life / p.max;
      const alpha = 1 - t * t;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      const s = p.size * (1 - t * 0.4);
      if (p.shape === 'rect') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-s, -s * 0.6, s * 2, s * 1.2);
        ctx.restore();
      } else if (p.shape === 'star') {
        drawStar(ctx, p.x, p.y, s, 4, p.rot);
      } else if (p.shape === 'heart') {
        drawHeart(ctx, p.x, p.y, s);
      } else if (p.shape === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, s * 0.5);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
        ctx.stroke();
      } else if (p.shape === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, s * 0.35);
        ctx.beginPath();
        ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    if (this.texts.length) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '800 14px "Segoe UI", system-ui, sans-serif';
      for (const tx of this.texts) {
        ctx.globalAlpha = clamp(1 - tx.life / tx.max, 0, 1);
        ctx.fillStyle = tx.color;
        ctx.strokeStyle = 'rgba(4,8,16,.65)';
        ctx.lineWidth = 3;
        ctx.strokeText(tx.str, tx.x, tx.y);
        ctx.fillText(tx.str, tx.x, tx.y);
      }
      ctx.restore();
    }
  }
}

function drawStar(ctx, x, y, r, points, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = (i / (points * 2)) * Math.PI * 2;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawHeart(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 8, s / 8);
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.bezierCurveTo(-8, -2, -4, -9, 0, -4);
  ctx.bezierCurveTo(4, -9, 8, -2, 0, 4);
  ctx.fill();
  ctx.restore();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.quality = 'high';
    this.settings = { showGrid: true, showNames: true, reducedMotion: false, colorblind: false, shake: true };
    this.effects = new Effects();
    this.time = 0;
    this.camera = { x: PHYS.WORLD_SIZE / 2, y: PHYS.WORLD_SIZE / 2, zoom: 1, shake: 0 };
    this.orbSprites = new Map();
    this.nebulas = [];
    this.ambient = [];
    this.resize();
    this.makeSprites();
    this.makeNebulas();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
  }

  setQuality(q) {
    this.quality = QUALITY[q] ? q : 'high';
    this.effects.quality = this.quality;
  }

  setSettings(settings) {
    this.settings = Object.assign(this.settings, settings || {});
  }

  makeSprites() {
    const size = 96;
    for (let i = 0; i < PHYS.PALETTE.length; i++) {
      const color = PHYS.PALETTE[i];
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.18, rgba(color, 0.98));
      grad.addColorStop(0.38, rgba(color, 0.55));
      grad.addColorStop(0.7, rgba(color, 0.12));
      grad.addColorStop(1, rgba(color, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      this.orbSprites.set(color, c);
    }
  }

  makeNebulas() {
    const colors = ['#5b21b6', '#0e7490', '#be185d', '#1d4ed8', '#7c2d12', '#4c1d95', '#0f766e', '#9d174d'];
    for (let i = 0; i < 8; i++) {
      const size = 900;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, rgba(colors[i], 0.22));
      grad.addColorStop(0.5, rgba(colors[i], 0.08));
      grad.addColorStop(1, rgba(colors[i], 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      this.nebulas.push({
        sprite: c,
        x: (i * 673 + 400) % PHYS.WORLD_SIZE,
        y: (i * 1117 + 700) % PHYS.WORLD_SIZE,
        scale: 0.55 + (i % 3) * 0.3
      });
    }
    for (let i = 0; i < 22; i++) {
      this.ambient.push({
        x: (i * 587 + 300) % PHYS.WORLD_SIZE,
        y: (i * 879 + 500) % PHYS.WORLD_SIZE,
        r: rand(80, 240),
        color: PHYS.PALETTE[i % PHYS.PALETTE.length],
        phase: Math.random() * Math.PI * 2,
        speed: rand(0.05, 0.15)
      });
    }
  }

  shake(amount) {
    if (!this.settings.shake) return;
    this.camera.shake = Math.min(24, this.camera.shake + amount);
  }

  flash(color, amount = 0.3) {
    this.effects.flash = amount;
    this.effects.flashColor = color;
  }

  /** Smooth camera follow with a size-aware zoom. */
  updateCamera(dt, target, radius, snap = false) {
    const cam = this.camera;
    if (!target) return;
    const mobile = this.width < 760;
    const base = mobile ? 1.32 : 1.7;
    const targetZoom = clamp(base * Math.pow(PHYS.START_RADIUS / Math.max(12, radius), 0.34), 0.36, 1.85);
    if (snap) {
      cam.x = target.x; cam.y = target.y; cam.zoom = targetZoom;
    } else {
      const k = 1 - Math.exp(-dt * 7.5);
      cam.x = lerp(cam.x, target.x, k);
      cam.y = lerp(cam.y, target.y, k);
      cam.zoom = lerp(cam.zoom, targetZoom, 1 - Math.exp(-dt * 3.2));
    }
    const viewW = this.width / cam.zoom;
    const viewH = this.height / cam.zoom;
    if (viewW < PHYS.WORLD_SIZE) cam.x = clamp(cam.x, viewW / 2, PHYS.WORLD_SIZE - viewW / 2);
    else cam.x = PHYS.WORLD_SIZE / 2;
    if (viewH < PHYS.WORLD_SIZE) cam.y = clamp(cam.y, viewH / 2, PHYS.WORLD_SIZE - viewH / 2);
    else cam.y = PHYS.WORLD_SIZE / 2;
    cam.shake *= Math.pow(0.001, dt);
    if (cam.shake < 0.2) cam.shake = 0;
  }

  screenOf(x, y) {
    const cam = this.camera;
    return {
      x: (x - cam.x) * cam.zoom + this.width / 2,
      y: (y - cam.y) * cam.zoom + this.height / 2
    };
  }

  viewBounds() {
    const cam = this.camera;
    const w = this.width / cam.zoom;
    const h = this.height / cam.zoom;
    return { left: cam.x - w / 2, right: cam.x + w / 2, top: cam.y - h / 2, bottom: cam.y + h / 2, w, h };
  }

  render(state, dt) {
    const ctx = this.ctx;
    const cam = this.camera;
    this.time += dt;
    const q = QUALITY[this.quality];

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#060a13';
    ctx.fillRect(0, 0, this.width, this.height);

    // Base gradient reacts subtly to world position.
    const bg = ctx.createLinearGradient(0, 0, 0, this.height);
    const hue = (cam.x / PHYS.WORLD_SIZE);
    bg.addColorStop(0, `rgb(${18 + hue * 20}, ${22 + hue * 12}, ${42 + hue * 30})`);
    bg.addColorStop(1, '#070b14');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.width, this.height);

    const shakeX = cam.shake ? rand(-cam.shake, cam.shake) * 0.5 : 0;
    const shakeY = cam.shake ? rand(-cam.shake, cam.shake) * 0.5 : 0;

    ctx.save();
    ctx.translate(this.width / 2 + shakeX, this.height / 2 + shakeY);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    const view = this.viewBounds();

    // Nebula clouds
    if (q.nebula && this.quality !== 'low') {
      ctx.globalCompositeOperation = 'lighter';
      for (const n of this.nebulas) {
        const s = 900 * n.scale;
        ctx.globalAlpha = 0.9;
        ctx.drawImage(n.sprite, n.x - s / 2, n.y - s / 2, s, s);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    // Ambient drifting blobs (decor only)
    if (this.quality !== 'low') {
      for (const a of this.ambient) {
        const pulse = 1 + Math.sin(this.time * a.speed + a.phase) * 0.08;
        ctx.globalAlpha = 0.05;
        ctx.fillStyle = a.color;
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r * pulse, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (this.settings.showGrid && this.quality !== 'low') {
      this.drawGrid(ctx, view);
    }
    this.drawBorder(ctx);

    if (state.orbs) this.drawOrbs(ctx, state.orbs, view);

    // Trails + particles behind blobs
    this.effects.draw(ctx, this.quality);

    if (state.players) {
      const sorted = state.players.slice().sort((a, b) => a.r - b.r);
      for (const p of sorted) {
        if (p.x + p.r < view.left || p.x - p.r > view.right || p.y + p.r < view.top || p.y - p.r > view.bottom) continue;
        this.drawBlob(ctx, p, dt);
      }
    }

    ctx.restore();

    if (state.players && this.settings.showNames) this.drawNames(ctx, state.players);

    // Soft edge vignette
    const vg = ctx.createRadialGradient(this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.35, this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.78);
    vg.addColorStop(0, 'rgba(3,6,14,0)');
    vg.addColorStop(1, 'rgba(3,6,14,.42)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, this.width, this.height);

    if (state.self && state.self.alive && state.self.boosting) {
      const speedLines = this.quality === 'low' ? 6 : 14;
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < speedLines; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = 80 + Math.random() * Math.max(this.width, this.height) * 0.4;
        ctx.beginPath();
        ctx.moveTo(this.width / 2 + Math.cos(a) * rr, this.height / 2 + Math.sin(a) * rr);
        ctx.lineTo(this.width / 2 + Math.cos(a) * (rr + 40), this.height / 2 + Math.sin(a) * (rr + 40));
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawGrid(ctx, view) {
    const size = QUALITY[this.quality].grid;
    const startX = Math.floor(view.left / size) * size;
    const startY = Math.floor(view.top / size) * size;
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 160, 220, 0.075)';
    ctx.lineWidth = 1 / this.camera.zoom;
    ctx.beginPath();
    for (let x = startX; x < view.right + size; x += size) {
      ctx.moveTo(x, view.top - size);
      ctx.lineTo(x, view.bottom + size);
    }
    for (let y = startY; y < view.bottom + size; y += size) {
      ctx.moveTo(view.left - size, y);
      ctx.lineTo(view.right + size, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120, 160, 220, 0.14)';
    ctx.beginPath();
    const major = size * 5;
    for (let x = Math.floor(view.left / major) * major; x < view.right + major; x += major) {
      ctx.moveTo(x, view.top - major); ctx.lineTo(x, view.bottom + major);
    }
    for (let y = Math.floor(view.top / major) * major; y < view.bottom + major; y += major) {
      ctx.moveTo(view.left - major, y); ctx.lineTo(view.right + major, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawBorder(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(157, 107, 255, 0.55)';
    ctx.lineWidth = 8;
    ctx.shadowColor = 'rgba(157, 107, 255, .65)';
    ctx.shadowBlur = this.quality === 'high' ? 40 : 0;
    ctx.strokeRect(0, 0, PHYS.WORLD_SIZE, PHYS.WORLD_SIZE);
    ctx.strokeStyle = 'rgba(255, 95, 200, 0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(6, 6, PHYS.WORLD_SIZE - 12, PHYS.WORLD_SIZE - 12);
    ctx.restore();
  }

  drawOrbs(ctx, orbs, view) {
    const time = this.time;
    const colorblind = this.settings.colorblind;
    for (const orb of orbs) {
      if (orb.x + 30 < view.left || orb.x - 30 > view.right || orb.y + 30 < view.top || orb.y - 30 > view.bottom) continue;
      const sprite = this.orbSprites.get(PHYS.PALETTE[orb.c] || PHYS.PALETTE[0]);
      if (!sprite) continue;
      const pulse = 1 + Math.sin(time * 3 + orb.id * 0.7) * 0.12;
      const size = orb.r * (orb.big ? 5.0 : 4.6) * pulse;
      ctx.globalAlpha = 0.92;
      ctx.drawImage(sprite, orb.x - size / 2, orb.y - size / 2, size, size);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(orb.x - orb.r * 0.08, orb.y - orb.r * 0.08, orb.r * (orb.big ? 0.36 : 0.29) * pulse, 0, Math.PI * 2);
      ctx.fill();
      if (colorblind) {
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = 'rgba(255,255,255,.7)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        if (orb.big) ctx.rect(orb.x - orb.r * 0.7, orb.y - orb.r * 0.7, orb.r * 1.4, orb.r * 1.4);
        else ctx.arc(orb.x, orb.y, orb.r * 0.55, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawBlob(ctx, p, dt) {
    const skin = SKINS[p.skinIdx] || SKINS[0];
    const q = QUALITY[this.quality];
    const r = p.r;
    const seed = (p.id % 17) * 1.7;
    const wobble = this.settings.reducedMotion ? 0 : 0.022;
    const t = this.time;

    // Motion trail particles for the trail cosmetic.
    if (p.trail && p.trail !== 'trail_none' && Math.random() < 0.9) {
      const trailDef = CAT.ITEMS[p.trail];
      const type = (trailDef && trailDef.type) || 'sparks';
      const color = trailDef ? trailDef.colors : [skin.glow];
      const behindX = p.x - (p.vx || 0) * 0.03;
      const behindY = p.y - (p.vy || 0) * 0.03;
      this.effects.trail(type, behindX + rand(-r * 0.4, r * 0.4), behindY + rand(-r * 0.4, r * 0.4), color, dt, { x: p.vx || 0, y: p.vy || 0 });
    }

    ctx.save();
    ctx.translate(p.x, p.y);

    if (p.boosting) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const aura = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.9);
      aura.addColorStop(0, rgba(skin.glow, 0.28));
      aura.addColorStop(1, rgba(skin.glow, 0));
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Body path
    const points = this.quality === 'low' ? 18 : 30;
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const a = (i / points) * Math.PI * 2;
      const wob = 1 + Math.sin(a * 3 + t * 2.1 + seed) * wobble + Math.sin(a * 5 - t * 1.5 + seed * 2) * wobble * 0.6;
      const rr = r * wob;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();

    if (q.shadows) {
      ctx.shadowColor = rgba(skin.glow, 0.55);
      ctx.shadowBlur = Math.min(48, r * 0.55);
    }
    const grad = ctx.createRadialGradient(-r * 0.34, -r * 0.42, r * 0.05, 0, 0, r * 1.06);
    grad.addColorStop(0, skin.colors[0]);
    grad.addColorStop(0.55, skin.colors[1]);
    grad.addColorStop(1, shade(skin.colors[1], -0.3));
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Inner volume: darken the rim and catch a soft specular highlight.
    ctx.save();
    ctx.clip();
    const rim = ctx.createRadialGradient(r * 0.08, r * 0.12, r * 0.3, 0, 0, r * 1.08);
    rim.addColorStop(0, 'rgba(0,0,0,0)');
    rim.addColorStop(0.6, 'rgba(0,0,0,0.08)');
    rim.addColorStop(1, 'rgba(0,0,0,0.46)');
    ctx.fillStyle = rim;
    ctx.fillRect(-r * 1.2, -r * 1.2, r * 2.4, r * 2.4);
    const light = ctx.createRadialGradient(-r * 0.4, -r * 0.46, 0, -r * 0.34, -r * 0.4, r * 0.95);
    light.addColorStop(0, 'rgba(255,255,255,0.34)');
    light.addColorStop(0.45, 'rgba(255,255,255,0.08)');
    light.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = light;
    ctx.fillRect(-r * 1.2, -r * 1.2, r * 2.4, r * 2.4);
    ctx.restore();

    ctx.lineWidth = Math.max(1.4, r * 0.045);
    ctx.strokeStyle = rgba(skin.accent, 0.55);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, r * 0.02);
    ctx.strokeStyle = 'rgba(6,10,20,0.35)';
    ctx.stroke();

    // Pattern overlay
    if (skin.pattern && skin.pattern !== 'none' && q.eyeDetail) {
      ctx.save();
      ctx.clip();
      ctx.globalAlpha = 0.32;
      drawPattern(ctx, skin.pattern, r, t);
      ctx.restore();
    }

    // Eyes
    if (this.quality !== 'low') this.drawEyes(ctx, r, skin, t, seed);

    // Spawn shield
    if (p.protected) {
      const pulse = 0.75 + Math.sin(t * 6) * 0.25;
      ctx.save();
      ctx.globalAlpha = 0.55 * pulse;
      ctx.strokeStyle = '#9dd8ff';
      ctx.lineWidth = Math.max(2, r * 0.06);
      ctx.setLineDash([Math.max(6, r * 0.35), Math.max(5, r * 0.22)]);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.22, t * 1.4, t * 1.4 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.16 * pulse;
      ctx.fillStyle = '#7dd3fc';
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Spawn / boost ring
    if (p.spawnT != null && p.spawnT < 1) {
      ctx.globalAlpha = 1 - p.spawnT;
      ctx.strokeStyle = skin.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r * (1 + p.spawnT * 1.4), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  drawEyes(ctx, r, skin, t, seed) {
    const style = skin.eyes || 'normal';
    const eyeR = r * 0.195;
    const dx = r * 0.3;
    const dy = -r * 0.06;
    const look = clamp(Math.sin(t * 0.55 + seed) * 0.3, -0.32, 0.32);
    const blink = Math.sin(t * 0.85 + seed) > 0.988 ? 0.12 : 1;

    ctx.save();
    ctx.translate(0, dy);
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * dx, 0);
      ctx.scale(1, blink);

      // eye white
      ctx.fillStyle = style === 'void' ? '#f3f6ff' : '#fbfdff';
      if (style === 'void') { ctx.shadowColor = skin.glow; ctx.shadowBlur = Math.max(8, r * 0.28); }
      ctx.beginPath();
      ctx.ellipse(0, 0, eyeR * 0.94, eyeR * 1.06, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // pupil / iris
      const pupilR = eyeR * (style === 'void' ? 0.42 : 0.56);
      ctx.fillStyle = style === 'void' ? '#080d18' : '#131a2b';
      ctx.beginPath();
      ctx.arc(eyeR * look, eyeR * 0.14, pupilR, 0, Math.PI * 2);
      ctx.fill();

      // catchlight
      if (style !== 'void') {
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.arc(-pupilR * 0.36, -pupilR * 0.42, pupilR * 0.34, 0, Math.PI * 2);
        ctx.fill();
      }

      // eye outline
      ctx.strokeStyle = 'rgba(8,13,24,0.28)';
      ctx.lineWidth = Math.max(0.8, r * 0.016);
      ctx.beginPath();
      ctx.ellipse(0, 0, eyeR * 0.94, eyeR * 1.06, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (style === 'angry') {
      ctx.strokeStyle = 'rgba(14,10,24,0.85)';
      ctx.lineWidth = Math.max(1.6, r * 0.038);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-dx - eyeR * 1.0, -eyeR * 1.45);
      ctx.lineTo(-dx + eyeR * 0.55, -eyeR * 0.85);
      ctx.moveTo(dx + eyeR * 1.0, -eyeR * 1.45);
      ctx.lineTo(dx - eyeR * 0.55, -eyeR * 0.85);
      ctx.stroke();
    } else if (style === 'cute') {
      ctx.strokeStyle = 'rgba(14,10,24,0.5)';
      ctx.lineWidth = Math.max(1.2, r * 0.024);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, eyeR * 1.15, eyeR * 0.65, 0.25 * Math.PI, 0.75 * Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawNames(ctx, players) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of players) {
      const screen = this.screenOf(p.x, p.y);
      if (p.r * this.camera.zoom < 9) continue;
      if (screen.x < -140 || screen.x > this.width + 140 || screen.y < -90 || screen.y > this.height + 120) continue;
      const y = screen.y - (p.r * this.camera.zoom) - 16;
      const name = p.name || 'Blob';
      const self = !!p.isSelf;

      const nameSize = self ? 13.5 : 12;
      ctx.font = `700 ${nameSize}px "Segoe UI", system-ui, sans-serif`;
      const nameW = ctx.measureText(name).width;
      const btnSize = 14;

      // You / bot chips sit beside the name plate.
      let leftChip = null;
      let rightChip = null;
      if (self) leftChip = { text: 'YOU', w: 30, color: 'rgba(157,107,255,.92)' };
      else if (p.isBot) rightChip = { text: 'BOT', w: 27, color: 'rgba(148,163,184,.26)' };

      const padX = 7;
      const plateW = nameW + padX * 2;
      const chipGap = 4;
      const total = plateW + (leftChip ? leftChip.w + chipGap : 0) + (rightChip ? rightChip.w + chipGap : 0);
      let x = screen.x - total / 2;
      const plateY = y - btnSize / 2;

      ctx.globalAlpha = self ? 1 : 0.94;
      if (leftChip) {
        ctx.fillStyle = leftChip.color;
        roundRect(ctx, x, plateY, leftChip.w, btnSize, 7);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '800 8px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(leftChip.text, x + leftChip.w / 2, y + 0.5);
        x += leftChip.w + chipGap;
      }

      ctx.fillStyle = self ? 'rgba(24,17,44,.82)' : 'rgba(7,11,20,.62)';
      roundRect(ctx, x, plateY, plateW, btnSize, 7);
      ctx.fill();
      if (self) {
        ctx.strokeStyle = 'rgba(196,164,255,.8)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fillStyle = self ? '#ffffff' : '#dbe6f7';
      ctx.font = `700 ${nameSize}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillText(name, x + plateW / 2, y + 0.5);
      x += plateW + chipGap;

      if (rightChip) {
        ctx.fillStyle = rightChip.color;
        roundRect(ctx, x, plateY, rightChip.w, btnSize, 7);
        ctx.fill();
        ctx.fillStyle = '#c3d0e2';
        ctx.font = '800 8px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(rightChip.text, x + rightChip.w / 2, y + 0.5);
      }
    }
    ctx.restore();
  }

  drawMinimap(canvas, state) {
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const scale = size / PHYS.WORLD_SIZE;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(6, 10, 19, .88)';
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = 'rgba(148, 163, 184, .35)';
    const step = Math.max(1, Math.floor((state.orbs ? state.orbs.length : 0) / 420));
    if (state.orbs && step <= 4) {
      for (let i = 0; i < state.orbs.length; i += step) {
        const o = state.orbs[i];
        ctx.fillRect(o.x * scale, o.y * scale, 1, 1);
      }
    }

    // viewport
    const view = this.viewBounds();
    ctx.strokeStyle = 'rgba(220, 230, 250, .22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(view.left * scale, view.top * scale, view.w * scale, view.h * scale);

    for (const p of state.players || []) {
      const skin = SKINS[p.skinIdx] || SKINS[0];
      ctx.beginPath();
      ctx.fillStyle = p.isBot ? 'rgba(160,175,196,.75)' : skin.colors[0];
      const rr = p.isSelf ? 3.6 : 2.6;
      ctx.arc(p.x * scale, p.y * scale, rr, 0, Math.PI * 2);
      ctx.fill();
      if (p.isSelf) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }

    ctx.strokeStyle = 'rgba(157, 107, 255, .45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v) => clamp(Math.round(v + 255 * amount), 0, 255);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function drawPattern(ctx, pattern, r, t) {
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  if (pattern === 'rings') {
    ctx.lineWidth = Math.max(1.5, r * 0.05);
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, (r / 4) * i, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (pattern === 'stripes') {
    ctx.lineWidth = Math.max(2, r * 0.09);
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-r, i * r * 0.3);
      ctx.lineTo(r, i * r * 0.3 + r * 0.5);
      ctx.stroke();
    }
  } else if (pattern === 'spots') {
    for (let i = 0; i < 7; i++) {
      const a = i * 2.3 + t * 0.05;
      const rr = r * 0.62 * (0.35 + ((i * 37) % 70) / 100);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, r * (0.08 + (i % 3) * 0.03), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (pattern === 'swirl') {
    ctx.lineWidth = Math.max(2, r * 0.06);
    ctx.beginPath();
    for (let i = 0; i < 60; i++) {
      const a = i * 0.22;
      const rr = (i / 60) * r;
      const x = Math.cos(a + t * 0.15) * rr;
      const y = Math.sin(a + t * 0.15) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else if (pattern === 'hex') {
    ctx.lineWidth = 1.6;
    const cell = Math.max(8, r * 0.28);
    for (let row = -2; row <= 2; row++) {
      for (let col = -2; col <= 2; col++) {
        const x = col * cell * 0.9;
        const y = row * cell * 0.8 + (col % 2 ? cell * 0.4 : 0);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          const px = x + Math.cos(a) * cell * 0.4;
          const py = y + Math.sin(a) * cell * 0.4;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  } else if (pattern === 'stars') {
    for (let i = 0; i < 12; i++) {
      const a = i * 2.399;
      const rr = r * 0.8 * Math.sqrt((i + 1) / 12);
      const s = r * 0.045 * (1 + (i % 3) * 0.4);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Animated blob used on the menu / hero art. */
export function drawHeroBlob(canvas, skinId, time, trailId) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = canvas.clientWidth || 360;
  if (canvas.width !== Math.floor(size * dpr)) {
    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const skin = CAT.ITEMS[skinId] || SKINS[0];
  const trail = CAT.ITEMS[trailId];
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.29;

  // orbit ring + orbs
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(time * 0.18);
  ctx.strokeStyle = 'rgba(157,107,255,.18)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.55, r * 1.15, 0, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const ox = Math.cos(a) * r * 1.55;
    const oy = Math.sin(a) * r * 1.15;
    const color = PHYS.PALETTE[(i * 3 + 2) % PHYS.PALETTE.length];
    const glow = ctx.createRadialGradient(ox, oy, 0, ox, oy, 16);
    glow.addColorStop(0, 'rgba(255,255,255,.95)');
    glow.addColorStop(0.35, rgba(color, 0.9));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(ox, oy, 16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // trail puff
  if (trail && trail.type !== 'none') {
    const color = trail.colors ? trail.colors[0] : skin.glow;
    for (let i = 0; i < 14; i++) {
      const p = (time * 0.4 + i / 14) % 1;
      const a = time * 1.2 + i;
      ctx.globalAlpha = (1 - p) * 0.28;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r * (0.7 + p * 0.9), cy + Math.sin(a) * r * (0.7 + p * 0.9) + p * 20, 4 * (1 - p) + 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // blob body
  const wobble = 0.03;
  ctx.save();
  ctx.translate(cx, cy + Math.sin(time * 1.2) * 4);
  ctx.shadowColor = rgba(skin.glow, 0.7);
  ctx.shadowBlur = 42;
  ctx.beginPath();
  for (let i = 0; i <= 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const rr = r * (1 + Math.sin(a * 3 + time * 1.7) * wobble + Math.sin(a * 5 - time * 1.1) * wobble * 0.5);
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const grad = ctx.createRadialGradient(-r * 0.34, -r * 0.42, r * 0.05, 0, 0, r * 1.08);
  grad.addColorStop(0, skin.colors[0]);
  grad.addColorStop(0.55, skin.colors[1]);
  grad.addColorStop(1, shade(skin.colors[1], -0.3));
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.save();
  ctx.clip();
  const hrim = ctx.createRadialGradient(r * 0.08, r * 0.12, r * 0.3, 0, 0, r * 1.1);
  hrim.addColorStop(0, 'rgba(0,0,0,0)');
  hrim.addColorStop(0.65, 'rgba(0,0,0,0.08)');
  hrim.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = hrim;
  ctx.fillRect(-r * 1.3, -r * 1.3, r * 2.6, r * 2.6);
  const hlight = ctx.createRadialGradient(-r * 0.4, -r * 0.46, 0, -r * 0.34, -r * 0.4, r * 0.95);
  hlight.addColorStop(0, 'rgba(255,255,255,0.36)');
  hlight.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  hlight.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hlight;
  ctx.fillRect(-r * 1.3, -r * 1.3, r * 2.6, r * 2.6);
  ctx.restore();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = rgba(skin.accent, 0.55);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(6,10,20,0.3)';
  ctx.stroke();

  if (skin.pattern && skin.pattern !== 'none') {
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.3;
    drawPattern(ctx, skin.pattern, r, time);
    ctx.restore();
  }

  // eyes
  const eyeR = r * 0.2;
  for (const side of [-1, 1]) {
    const ex = side * r * 0.3;
    const ey = -r * 0.06;
    ctx.fillStyle = skin.eyes === 'void' ? '#f3f6ff' : '#fbfdff';
    ctx.beginPath();
    ctx.ellipse(ex, ey, eyeR * 0.94, eyeR * 1.06, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = skin.eyes === 'void' ? '#080d18' : '#131a2b';
    ctx.beginPath();
    ctx.arc(ex + Math.sin(time * 0.8) * eyeR * 0.22, ey + eyeR * 0.14, eyeR * 0.56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.beginPath();
    ctx.arc(ex - eyeR * 0.24, ey - eyeR * 0.3, eyeR * 0.19, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(8,13,24,0.28)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(ex, ey, eyeR * 0.94, eyeR * 1.06, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (skin.eyes === 'cute') {
    ctx.strokeStyle = 'rgba(14,10,24,0.5)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, eyeR * 1.3, eyeR * 0.7, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
  }
  if (skin.eyes === 'angry') {
    ctx.strokeStyle = 'rgba(20,16,30,.85)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.27 - eyeR, -r * 0.3);
    ctx.lineTo(-r * 0.27 + eyeR * 0.8, -r * 0.16);
    ctx.moveTo(r * 0.27 + eyeR, -r * 0.3);
    ctx.lineTo(r * 0.27 - eyeR * 0.8, -r * 0.16);
    ctx.stroke();
  }
  ctx.restore();
}
