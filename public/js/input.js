import { clamp } from './utils.js';

const UI_SELECTOR = 'button, input, .screen, .modal-layer, .panel, .card, .joystick, .mobile-boost, .toast-layer';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, seen: false };
    this.keys = new Set();
    this.pointerBoost = false;
    this.spaceBoost = false;
    this.boostButton = false;
    this.latch = false;
    this.touchDir = { x: 0, y: 0, active: false };
    this.controlMode = 'both';
    this.boostMode = 'hold';
    this.isTouch = ('ontouchstart' in window) || window.matchMedia('(pointer: coarse)').matches;
    this.enabled = false;
    this.joyActive = false;
    this.joyId = null;
    this._attach();
  }

  _attach() {
    const movePointer = (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.seen = true;
    };

    window.addEventListener('pointermove', movePointer, { passive: true });
    window.addEventListener('pointerdown', (e) => {
      movePointer(e);
      if (e.target.closest(UI_SELECTOR)) return;
      if (e.pointerType === 'touch') return; // mobile uses the boost button
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (this.boostMode === 'toggle') this.latch = !this.latch;
      else this.pointerBoost = true;
    });
    window.addEventListener('pointerup', () => { this.pointerBoost = false; });
    window.addEventListener('pointercancel', () => { this.pointerBoost = false; });
    window.addEventListener('blur', () => this.reset());

    window.addEventListener('keydown', (e) => {
      if (e.target && e.target.matches && e.target.matches('input, textarea')) return;
      const code = e.code;
      this.keys.add(code);
      if (code === 'Space') {
        e.preventDefault();
        if (!e.repeat) {
          if (this.boostMode === 'toggle') this.latch = !this.latch;
          this.spaceBoost = true;
        }
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space') this.spaceBoost = false;
    });

    const joystick = document.getElementById('joystick');
    const knob = document.getElementById('joystickKnob');
    if (joystick && knob) {
      const radius = 40;
      const setFromEvent = (e) => {
        const rect = joystick.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let dx = e.clientX - cx;
        let dy = e.clientY - cy;
        const len = Math.hypot(dx, dy);
        if (len > radius) { dx = (dx / len) * radius; dy = (dy / len) * radius; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        const norm = Math.hypot(dx, dy) / radius;
        if (norm < 0.15) {
          this.touchDir.x = 0; this.touchDir.y = 0; this.touchDir.active = false;
        } else {
          this.touchDir.x = dx / (len || 1);
          this.touchDir.y = dy / (len || 1);
          this.touchDir.active = true;
        }
      };
      joystick.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.joyActive = true;
        this.joyId = e.pointerId;
        joystick.setPointerCapture(e.pointerId);
        setFromEvent(e);
      });
      joystick.addEventListener('pointermove', (e) => {
        if (!this.joyActive || e.pointerId !== this.joyId) return;
        setFromEvent(e);
      });
      const end = (e) => {
        if (e.pointerId !== this.joyId) return;
        this.joyActive = false;
        this.joyId = null;
        this.touchDir.x = 0; this.touchDir.y = 0; this.touchDir.active = false;
        knob.style.transform = 'translate(0,0)';
      };
      joystick.addEventListener('pointerup', end);
      joystick.addEventListener('pointercancel', end);
    }

    const boostBtn = document.getElementById('mobileBoost');
    if (boostBtn) {
      boostBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (this.boostMode === 'toggle') this.latch = !this.latch;
        else this.boostButton = true;
      });
      const release = () => { this.boostButton = false; };
      boostBtn.addEventListener('pointerup', release);
      boostBtn.addEventListener('pointercancel', release);
      boostBtn.addEventListener('pointerleave', release);
    }

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  reset() {
    this.keys.clear();
    this.pointerBoost = false;
    this.spaceBoost = false;
    this.boostButton = false;
    this.latch = false;
    this.touchDir.active = false;
  }

  setControlMode(mode) {
    this.controlMode = ['mouse', 'keys', 'both'].includes(mode) ? mode : 'both';
  }

  setBoostMode(mode) {
    this.boostMode = mode === 'toggle' ? 'toggle' : 'hold';
    if (this.boostMode === 'hold') this.latch = false;
  }

  keyVector() {
    let x = 0;
    let y = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    const len = Math.hypot(x, y);
    if (len < 0.01) return null;
    return { x: x / len, y: y / len };
  }

  /**
   * Returns a unit movement vector. `selfScreen` is where the player's blob is
   * drawn on screen so mouse aiming stays accurate while the camera moves.
   */
  direction(selfScreen) {
    if (this.touchDir.active) return { x: this.touchDir.x, y: this.touchDir.y };

    const keys = this.keyVector();
    if ((this.controlMode === 'keys' || this.controlMode === 'both') && keys) return keys;
    if (this.controlMode === 'keys') return { x: 0, y: 0 };

    const dx = this.pointer.x - selfScreen.x;
    const dy = this.pointer.y - selfScreen.y;
    const len = Math.hypot(dx, dy);
    if (len < 10) return { x: 0, y: 0 };
    const strength = clamp((len - 10) / 70, 0, 1);
    return { x: (dx / len) * strength, y: (dy / len) * strength };
  }

  wantsBoost() {
    if (this.boostMode === 'toggle') return this.latch;
    return this.pointerBoost || this.spaceBoost || this.boostButton;
  }
}
