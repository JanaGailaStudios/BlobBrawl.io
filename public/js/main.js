import { $, storage } from './utils.js';
import { net } from './net.js';
import { audio } from './audio.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { UI } from './ui.js';

const canvas = $('#gameCanvas');
const minimap = $('#minimap');
const renderer = new Renderer(canvas);
const input = new Input(canvas);
const game = new Game({ renderer, input, minimap });
const ui = new UI({ game, input });

ui.init();

function randomName() {
  const a = ['Wobbly', 'Chunky', 'Zippy', 'Sneaky', 'Hungry', 'Bouncy', 'Squishy', 'Cosmic', 'Turbo', 'Jelly'];
  const b = ['Blob', 'Bubble', 'Gloop', 'Mochi', 'Slime', 'Puff', 'Goo', 'Boba'];
  return `${a[(Math.random() * a.length) | 0]} ${b[(Math.random() * b.length) | 0]}`;
}

let savedName = storage.get('blobbrawl.name', '');
if (!savedName) {
  savedName = randomName();
  storage.set('blobbrawl.name', savedName);
}
$('#playerNameInput').value = savedName;

ui.boot('Connecting to the arena…', 14);
net.connect();

let boots = 0;
net.on('connection', (status) => {
  if (status.connected) {
    ui.boot('Loading your blob…', 52);
  } else if (!net.ready) {
    boots++;
    ui.boot(boots > 2 ? 'Server unreachable — retrying…' : 'Reconnecting…', 22);
  }
});

net.on('connectionError', () => {
  boots++;
  if (boots > 2) ui.boot('Waiting for the server…', 30);
});

net.on('ready', () => {
  ui.boot('Warming up the arena…', 88);
  setTimeout(() => {
    ui.hideBoot();
    ui.showScreen('menuScreen');
  }, 220);
});

net.on('fatal', (p) => {
  ui.bootFailed(p.message || 'Could not start the game.');
});

$('#bootRetry').addEventListener('click', () => {
  ui.boot('Retrying connection…', 20);
  if (net.socket) {
    net.socket.connect();
    if (net.socket.connected) net.hello();
  } else {
    net.connect();
  }
});

setTimeout(() => {
  if (!net.ready) ui.boot('Still connecting — make sure the server is reachable.', 38);
}, 9000);

// Stop driving the blob when the tab is hidden.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') {
    input.reset();
    net.send('input', { x: 0, y: 0, b: false });
  }
});

// Give every interactive element a little click feedback.
document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('button');
  if (btn && !btn.disabled) audio.play('click');
}, true);

window.addEventListener('error', (e) => {
  console.error('[client]', e.message);
});

// Debug handle — handy for QA and integration tests.
window.__blobBrawl = { game, net, ui, renderer, input };
