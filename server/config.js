'use strict';
const path = require('path');

function intEnv(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
}

const config = {
  port: intEnv('PORT', 3000),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'blobbrawl.db'),
  // Used to derive opaque account tokens. Set SECRET in production.
  secret: process.env.SECRET || 'dev-only-insecure-secret-change-me',
  trustProxy: process.env.TRUST_PROXY === '1',
  maxRooms: intEnv('MAX_ROOMS', 4),
  roomCapacity: intEnv('ROOM_CAPACITY', 40),
  minBots: intEnv('MIN_BOTS', 5),
  maxBots: intEnv('MAX_BOTS', 12),
  logGameplay: process.env.LOG_GAMEPLAY === '1'
};

if (config.nodeEnv === 'production' && config.secret.startsWith('dev-only')) {
  console.warn('[config] WARNING: running in production with the default SECRET. Set SECRET in your environment.');
}

module.exports = config;
