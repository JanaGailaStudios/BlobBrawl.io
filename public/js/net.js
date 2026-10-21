import { storage, toast } from './utils.js';

const TOKEN_KEY = 'blobbrawl.token';

/**
 * Thin Socket.IO wrapper with auto-reconnect, token persistence and
 * promise-based request/ack helpers.
 */
class Net {
  constructor() {
    this.socket = null;
    this.token = storage.get(TOKEN_KEY, null);
    this.profile = null;
    this.handlers = new Map();
    this.connected = false;
    this.everConnected = false;
    this.ready = false;
    this.reconnecting = false;
    this.helloTimer = null;
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const set = this.handlers.get(event);
    if (set) set.delete(fn);
  }

  emitLocal(event, data) {
    const set = this.handlers.get(event);
    if (set) for (const fn of set) {
      try { fn(data); } catch (err) { console.error(`[net] handler ${event}`, err); }
    }
  }

  connect() {
    if (typeof window.io !== 'function') {
      this.emitLocal('fatal', { message: 'Game client failed to load. Please refresh.' });
      return;
    }
    if (this.socket) return;

    this.socket = window.io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 600,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      timeout: 12000
    });

    this.socket.on('connect', () => {
      this.connected = true;
      this.everConnected = true;
      const reconnected = this.reconnecting;
      this.reconnecting = false;
      this.emitLocal('connection', { connected: true, reconnected });
      this.hello();
    });

    this.socket.on('disconnect', (reason) => {
      this.connected = false;
      this.ready = false;
      this.reconnecting = true;
      this.emitLocal('connection', { connected: false, reason });
    });

    this.socket.on('connect_error', (err) => {
      this.emitLocal('connectionError', { message: err && err.message });
    });

    this.socket.onAny((event, payload) => {
      if (event === 'profile' && payload) this.profile = payload;
      this.emitLocal(event, payload);
    });
  }

  hello() {
    const name = storage.get('blobbrawl.name', '');
    this.request('hello', { token: this.token, name }, 12000).then((res) => {
      if (!res || !res.ok) {
        this.emitLocal('fatal', { message: (res && res.error) || 'Could not join the server.' });
        return;
      }
      if (res.token) {
        this.token = res.token;
        storage.set(TOKEN_KEY, res.token);
      }
      this.profile = res.profile;
      this.ready = true;
      this.emitLocal('ready', res);
    }).catch(() => {
      this.emitLocal('fatal', { message: 'Server did not respond. Is it running?' });
    });
  }

  /** Emit with ack and a timeout so the UI never hangs forever. */
  request(event, payload = {}, timeout = 6000) {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error('not-connected'));
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('timeout'));
      }, timeout);
      this.socket.emit(event, payload, (res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(res);
      });
    });
  }

  send(event, payload = {}) {
    if (this.socket && this.socket.connected) this.socket.emit(event, payload);
  }

  setToken(token) {
    this.token = token;
    if (token) storage.set(TOKEN_KEY, token);
    else storage.remove(TOKEN_KEY);
  }

  setProfile(profile) {
    if (!profile) return;
    this.profile = profile;
    this.emitLocal('profileLocal', profile);
  }
}

export const net = new Net();

export function showRequestError(err) {
  if (err && err.message === 'not-connected') toast('Connection lost — retrying…', 'bad');
  else if (err && err.message === 'timeout') toast('The server took too long to respond.', 'bad');
  else toast('Something went wrong. Please try again.', 'bad');
}
