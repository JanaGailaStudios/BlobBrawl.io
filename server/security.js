'use strict';
const crypto = require('crypto');
const config = require('./config');

/** Derive a stable, opaque lookup hash for a client-held account token. */
function hashToken(token) {
  if (typeof token !== 'string' || token.length < 16 || token.length > 200) return null;
  return crypto.createHmac('sha256', config.secret).update(token).digest('hex');
}

const NAME_RE = /[^\p{L}\p{N} _\-\.]/gu;

function sanitizeName(raw, fallback) {
  let name = String(raw == null ? '' : raw)
    .replace(NAME_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  if (name.length < 2) name = fallback || 'Blob' + Math.floor(Math.random() * 900 + 100);
  return name;
}

function isBotNameReserved(name) {
  return /^\[?bot\]?/i.test(String(name || ''));
}

/** Coerce a value to a finite number within [min, max]. */
function num(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function wsUrlSafe(url) {
  try { return new URL(url).origin; } catch { return null; }
}

/** Simple sliding-window limiter keyed by a string (ip, socket id, ...). */
class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.buckets = new Map();
    this.sweepAt = Date.now() + windowMs * 4;
  }
  hit(key, cost = 1) {
    const now = Date.now();
    if (now > this.sweepAt) this.sweep();
    let b = this.buckets.get(key);
    if (!b || now - b.start >= this.windowMs) {
      b = { start: now, count: 0 };
      this.buckets.set(key, b);
    }
    b.count += cost;
    return b.count <= this.limit;
  }
  sweep() {
    const now = Date.now();
    for (const [k, b] of this.buckets) if (now - b.start > this.windowMs * 2) this.buckets.delete(k);
    this.sweepAt = now + this.windowMs * 4;
  }
}

module.exports = { hashToken, sanitizeName, isBotNameReserved, num, wsUrlSafe, RateLimiter };
