export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function rand(min, max) { return min + Math.random() * (max - min); }
export function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
export function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }

export function fmt(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('en-US');
}

export function fmtCompact(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1e4) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return fmt(v);
}

export function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function fmtPlaytime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function timeAgo(ts) {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#ffffff');
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 255, g: 255, b: 255 };
}

export function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function debounce(fn, ms = 250) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

/** Safe localStorage wrapper (private mode can throw). */
export const storage = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
};

let toastTimer = 0;
export function toast(message, kind = '', ms = 3200) {
  const layer = $('#toastLayer');
  if (!layer) return;
  const div = document.createElement('div');
  div.className = `toast ${kind}`;
  div.textContent = message;
  layer.appendChild(div);
  const id = ++toastTimer;
  setTimeout(() => {
    div.style.transition = 'opacity .3s, transform .3s';
    div.style.opacity = '0';
    div.style.transform = 'translateX(14px)';
    setTimeout(() => { if (id) div.remove(); }, 320);
  }, ms);
}

let modalResolve = null;
export function confirmModal({ title = 'Confirm', text = '', confirm = 'Confirm', cancel = 'Cancel', preview = '' }) {
  const layer = $('#modalLayer');
  if (!layer) return Promise.resolve(false);
  $('#modalTitle').textContent = title;
  const textEl = $('#modalText');
  textEl.innerHTML = preview ? `${escapeHtml(text)}<div class="price-line">${preview}</div>` : escapeHtml(text);
  $('#modalConfirm').textContent = confirm;
  $('#modalCancel').textContent = cancel;
  layer.classList.remove('hidden');
  return new Promise((resolve) => {
    modalResolve = resolve;
  });
}

export function closeModal(result) {
  const layer = $('#modalLayer');
  if (layer) layer.classList.add('hidden');
  if (modalResolve) {
    modalResolve(result);
    modalResolve = null;
  }
}

export function initModal() {
  const layer = $('#modalLayer');
  if (!layer) return;
  $('#modalConfirm').addEventListener('click', () => closeModal(true));
  $('#modalCancel').addEventListener('click', () => closeModal(false));
  layer.addEventListener('click', (e) => { if (e.target === layer) closeModal(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !layer.classList.contains('hidden')) closeModal(false);
  });
}

/** Set CSS custom props for a blob preview element and ensure children exist. */
export function decorateBlob(el, item) {
  if (!el) return;
  if (item) {
    el.style.setProperty('--c1', item.colors ? item.colors[0] : '#ff8ad8');
    el.style.setProperty('--c2', item.colors ? item.colors[1] : '#c026d3');
    el.style.setProperty('--accent', item.accent || '#fff');
    el.style.setProperty('--glow', item.glow || item.colors?.[0] || '#ff6ad5');
    el.dataset.pattern = item.pattern || 'none';
    el.dataset.eyes = item.eyes || 'normal';
    el.dataset.skin = item.id || '';
  }
  if (!el.querySelector('.eye')) {
    el.insertAdjacentHTML('beforeend', '<i class="pattern"></i><i class="eye left"></i><i class="eye right"></i>');
  }
}
