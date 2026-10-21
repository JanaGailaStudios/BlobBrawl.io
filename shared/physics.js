/*
 * Shared simulation constants. The server is authoritative; the browser uses
 * the exact same math for instant local prediction, so nothing feels laggy.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BBPhysics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WORLD_SIZE = 5200;
  const START_MASS = 100;
  const MIN_MASS = 45;
  const MAX_MASS = 20000;
  const ORB_COUNT = 2600;
  const TICK_RATE = 30;
  const TICK_MS = 1000 / TICK_RATE;
  const SNAPSHOT_EVERY = 3; // 10 Hz network snapshots
  const START_RADIUS = Math.sqrt(START_MASS) * 1.55;

  // Seconds of invulnerability after spawning so a fresh blob is never
  // instantly swallowed by something that happened to be nearby.
  const SPAWN_PROTECT = 3.0;

  const BOOST = {
    MULT: 1.9,
    DRAIN: 0.045,      // fraction of mass per second
    MAX_TIME: 3.4,     // seconds of continuous boost before lockout
    COOLDOWN: 2.0,     // seconds after releasing
    MIN_MASS: 70
  };

  const ORB = {
    SMALL_MASS: 3.5,
    BIG_MASS: 13,
    BIG_CHANCE: 0.07,
    RADIUS_SMALL: 8,
    RADIUS_BIG: 14
  };

  const PALETTE = [
    '#ff6ad5', '#a78bfa', '#38bdf8', '#34d399', '#facc15',
    '#fb923c', '#f472b6', '#60a5fa', '#4ade80', '#f87171',
    '#e879f9', '#22d3ee', '#fde047', '#c084fc'
  ];

  function radiusFromMass(mass) {
    return Math.sqrt(Math.max(MIN_MASS, mass)) * 1.55;
  }

  function speedFromMass(mass) {
    const r = radiusFromMass(mass);
    return 360 * Math.pow(r / START_RADIUS, -0.35);
  }

  function scoreFromMass(mass) {
    return Math.round(mass * 10);
  }

  /** Can `a` swallow `b`? */
  function canEat(aMass, aRadius, bMass, bRadius, dist) {
    if (!(aMass > bMass * 1.18) || aMass < MIN_MASS) return false;
    return dist < aRadius - bRadius * 0.45;
  }

  function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

  return {
    WORLD_SIZE, START_MASS, MIN_MASS, MAX_MASS, ORB_COUNT, TICK_RATE, TICK_MS,
    SNAPSHOT_EVERY, START_RADIUS, SPAWN_PROTECT, BOOST, ORB, PALETTE,
    radiusFromMass, speedFromMass, scoreFromMass, canEat, clamp
  };
});
