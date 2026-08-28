/* Headless smoke test for the solo AI mode (?ai=1).
   Stubs just enough DOM to boot game.js, then pumps the real frame loop:
     node ai-smoke.js ai      — AI plays P2: assert it actually takes its turns
     node ai-smoke.js normal  — no param: assert the AI stays completely inert
   Run both: node ai-smoke.js */
const { execFileSync } = require('child_process');
const MODE = process.argv[2];
if (!MODE) {
  for (const m of ['ai', 'normal']) execFileSync(process.execPath, [__filename, m], { stdio: 'inherit' });
  console.log('\nai-smoke: ALL OK');
  return;
}

const Matter = require('matter-js');
const decomp = require('poly-decomp');
global.Matter = Matter;
global.decomp = decomp;
global.OUTLINES = require('./outlines.js').OUTLINES;

// ---- DOM stubs ----
const ctxStub = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : (...a) => ctxStub),
  set: (t, k, v) => { t[k] = v; return true; },
});
function makeEl() {
  const el = {
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    disabled: false, value: '', textContent: '', innerHTML: '', checked: true,
    addEventListener() {}, appendChild() {}, setPointerCapture() {},
    getContext: () => ctxStub,
  };
  el.parentElement = { classList: el.classList };
  return el;
}
const els = {};
global.document = {
  getElementById: id => (els[id] = els[id] || makeEl()),
  createElement: () => makeEl(),
  addEventListener() {},
  body: makeEl(),
};
global.window = { innerWidth: 400, innerHeight: 800, devicePixelRatio: 1, addEventListener() {} };
global.localStorage = { getItem: () => null, setItem() {} };
global.location = { search: MODE === 'ai' ? '?ai=1' : '' };
let rafQ = [];
global.requestAnimationFrame = cb => rafQ.push(cb);
function pump(now) { const q = rafQ; rafQ = []; for (const cb of q) cb(now); }

// ---- boot the real game ----
require('./game.js');
const g = global.window.__g;
if (!g) throw new Error('game did not boot');
const S = g.S;
g.start('Human', 'Rival');       // startGame with S.cur = 0 (human first)

const F = 1000 / 60, base = performance.now();
let f = 0;
const step = () => pump(base + ++f * F);

function assert(cond, msg) {
  if (!cond) { console.error(`ai-smoke [${MODE}] FAIL: ${msg}`); process.exit(1); }
}

if (MODE === 'normal') {
  // human drops once, turn passes to P2 - whose ghost must then hang forever
  while (f < 60 * 20 && !(S.screen === 'aiming' && S.cur === 1)) {
    if (S.screen === 'aiming' && S.cur === 0 && S.ghost && Math.abs(S.ghost.position.x) < 15) g.drop();
    step();
  }
  assert(S.screen === 'aiming' && S.cur === 1, 'turn never passed to P2');
  for (let i = 0; i < 60 * 10; i++) step();
  assert(S.screen === 'aiming' && S.cur === 1 && S.ghost, 'P2 acted without ?ai=1 - AI leaked into normal mode');
  console.log('ai-smoke [normal] OK: without ?ai=1 the second seat stays perfectly still');
} else {
  // full solo game: the human auto-drops dead centre, the AI must play its own turns
  let aiDrops = 0, humanDrops = 0, counted = false;
  while (f < 60 * 240 && S.screen !== 'over') {
    if (S.screen === 'aiming' && S.cur === 0 && S.ghost && !S.cheeseActive && Math.abs(S.ghost.position.x) < 15) {
      humanDrops++; g.drop();
    }
    if (S.screen === 'settling') {
      if (!counted && S.dropper === 1) { aiDrops++; counted = true; }
    } else counted = false;
    step();
  }
  assert(aiDrops >= 3, `AI only dropped ${aiDrops} pieces in ${Math.round(f / 60)}s`);
  assert(humanDrops >= 3, `human only got ${humanDrops} drops in - turns not alternating`);
  console.log(`ai-smoke [ai] OK: ${humanDrops} human drops, ${aiDrops} AI drops` +
    (S.screen === 'over' ? `, game over (loser: ${S.names[S.loser]})` : '') +
    ` in ${Math.round(f / 60)}s of sim`);
}
