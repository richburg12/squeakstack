/* SqueakStack — a two-player mouse-stacking physics game. */
(() => {
const { Engine, Body, Bodies, Composite, Events, Sleeping } = Matter;

// ---------- world constants ----------
const WORLD_W = 420;               // logical width, x in [-210, 210]
const PLAT_W = 350, PLAT_H = 24;   // platform top surface at y = 0 (world is 420 wide - small air gap each side)
const KILL_Y = 330;                // below this = fell off
const SPAWN_GAP = 235;             // ghost hovers this far above stack top
const SWAY_AMP = 192, SWAY_PERIOD = 2.9; // sway reaches past the platform edges
const START_LIVES = 3;
const HEART_ABOVE = 105;           // heart floats this far above the stack top (tallest mouse on the peak just reaches)
const TRAP_LAUNCH = 12.5;          // snap launch speed (apex lands near the top of the screen)

const PLAYERS = [
  { color:'#ff6a3d', body:'#ffa184', dark:'#c9522c', belly:'#ffdccf' },
  { color:'#2f7bff', body:'#8db8ff', dark:'#3a67c9', belly:'#dce9ff' },
];
const INNER_EAR = '#ffb0cc';

// ---------- mouse poses ----------
// parts: ['c',x,y,r,flag?] circle | ['e',x,y,rx,ry,rot] ellipse | ['r',x,y,w,h,rot] rect
// local coords: pose origin at footprint centre, ground at y=0, up = -y
const POSES = {
  tidy: { label:'Pip', w:3,
    parts:[ ['e',0,-19,24,19,0], ['c',15,-33,12], ['c',9,-46,5.5,'ear'], ['c',20,-44,5,'ear'], ['r',2,-5,40,10,0] ],
    face:[15,-33,12,-0.15], belly:[2,-13,13,8],
    tail:{pts:[[-18,-5],[4,4],[27,-7]], w:5} },
  stand: { label:'Tippy', w:2,
    parts:[ ['e',0,-36,15,26,0], ['c',3,-70,12], ['c',-3,-83,6,'ear'], ['c',9,-81,5.5,'ear'], ['r',0,-6,26,12,0], ['r',-12,-10,24,7,0.5] ],
    face:[3,-70,12,-0.35], belly:[1,-30,9,16], feet:[[-7,-3],[7,-3]],
    tail:{pts:[[-2,-8],[-24,-2],[-30,-14]], w:5} },
  ball: { label:'Bobble', w:1.5,
    parts:[ ['c',0,-24,24], ['c',-8,-44,5.5,'ear'] ],
    face:[6,-26,10,0.55,'sleep'],
    tail:{pts:[[20,-12],[34,-30],[12,-46]], w:5} },
  loaf: { label:'Loafie', w:3,
    parts:[ ['e',0,-17,30,15,0], ['e',22,-24,13,11,0], ['c',16,-37,5.5,'ear'], ['c',27,-35,5,'ear'], ['r',0,-5,54,10,0] ],
    face:[22,-24,12,-0.05], belly:[-2,-11,18,7],
    tail:{pts:[[-28,-10],[-42,-20],[-34,-34]], w:5} },
  stretch: { label:'Longboy', w:2,
    parts:[ ['e',2,-12,40,11,0], ['c',38,-16,10], ['c',33,-27,4.5,'ear'], ['c',43,-25,4.5,'ear'], ['r',-46,-9,26,6,-0.15] ],
    face:[38,-16,10,-0.1],
    tail:{pts:[[-38,-10],[-52,-13],[-61,-6]], w:5} },
  hook: { label:'Hooky', w:1.5,
    parts:[ ['e',6,-24,17,22,0], ['c',16,-49,11], ['c',10,-60,5,'ear'], ['c',22,-58,5,'ear'], ['r',6,-4,30,8,0],
            ['r',-10,-34,7,34,0], ['r',-18,-53,18,7,0], ['r',-25,-45,7,17,0] ],
    face:[16,-49,11,-0.3], belly:[7,-18,10,13], feet:[[-1,-2],[13,-2]],
    tail:{pts:[[-10,-20],[-11,-53],[-25,-44]], w:6} },
  chonk: { label:'Chonk', w:2,
    parts:[ ['e',-2,-30,33,23,0], ['c',28,-42,15], ['c',22,-59,7,'ear'], ['c',35,-56,6.5,'ear'],
            ['r',-18,-6,12,12,0], ['r',14,-6,12,12,0], ['r',-38,-38,20,7,-0.45] ],
    face:[28,-42,15,-0.15], belly:[-4,-22,20,12], feet:[[-18,-4],[14,-4]],
    tail:{pts:[[-33,-32],[-48,-40],[-46,-51]], w:6} },
  arch: { label:'Bridget', w:1.5,
    parts:[ ['r',-26,-13,12,26,0], ['r',26,-13,12,26,0], ['e',0,-32,32,13,0], ['c',33,-24,10],
            ['c',30,-33,4.5,'ear'], ['c',38,-31,4.5,'ear'] ],
    face:[33,-24,10,0.9], feet:[[-26,-2],[26,-2]],
    tail:{pts:[[-28,-24],[-40,-32],[-36,-42]], w:5} },
};
const POSE_KEYS = Object.keys(POSES);

// ---------- engine ----------
const engine = Engine.create({ enableSleeping:true });
engine.positionIterations = 12;
engine.velocityIterations = 10;
const world = engine.world;

// restitution 0 + generous slop: mice thud and stay put (no solver jitter-hop)
const MOUSE_OPTS = { friction:0.9, frictionStatic:1.2, restitution:0, frictionAir:0.012, slop:0.08 };
const platform = Bodies.rectangle(0, PLAT_H/2, PLAT_W, PLAT_H, { isStatic:true, friction:1, restitution:0, slop:0.08 });
Composite.add(world, platform);

// Soften penetration push-out: Matter corrects overlap by shoving positions,
// and Verlet integration turns each shove into real upward velocity - a deep
// fast landing then "resonates" (hop, land, shove, hop). Push out gentler and
// carry less of the correction into the next frame.
if (Matter.Resolver) {
  Matter.Resolver._positionDampen = 0.6;
  Matter.Resolver._positionWarming = 0.4;
}

function buildMouse(poseKey, x, y, playerIdx) {
  const pose = POSES[poseKey];
  const parts = pose.parts.map(p => {
    if (p[0] === 'c') return Bodies.circle(x + p[1], y + p[2], p[3], { ...MOUSE_OPTS });
    if (p[0] === 'r') return Bodies.rectangle(x + p[1], y + p[2], p[3], p[4], { ...MOUSE_OPTS, angle: p[5] || 0 });
    // ellipse: scaled circle
    const r = Math.max(p[3], p[4]);
    const b = Bodies.circle(x + p[1], y + p[2], r, { ...MOUSE_OPTS });
    Body.scale(b, p[3] / r, p[4] / r);
    if (p[5]) Body.rotate(b, p[5]);
    return b;
  });
  const body = Body.create({ parts, ...MOUSE_OPTS });
  body.sleepThreshold = 30; // doze off quickly once still
  body.plugin.mouse = {
    pose: poseKey, player: playerIdx,
    off: { x: body.position.x - x, y: body.position.y - y }, // pose-origin -> COM
    landed: false, launch: 0,
  };
  return body;
}
function buildTrap(x, y, playerIdx) {
  const base = Bodies.rectangle(x, y - 7, 72, 14, { ...MOUSE_OPTS, friction: 1 });
  const body = Body.create({ parts: [base], ...MOUSE_OPTS, friction: 1 });
  body.sleepThreshold = 30;
  body.plugin.trap = {
    by: playerIdx, armed: false, spent: false,
    off: { x: body.position.x - x, y: body.position.y - y },
  };
  return body;
}
const pieces = () => Composite.allBodies(world).filter(b => b.plugin && (b.plugin.mouse || b.plugin.trap));
const mice = () => Composite.allBodies(world).filter(b => b.plugin && b.plugin.mouse);

// ---------- canvas / camera ----------
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, dpr = 1, scale = 1, baseY = 0, camY = 0;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  scale = Math.min(W / WORLD_W, 1.7);
  baseY = H * 0.76;
}
window.addEventListener('resize', resize); resize();

// ---------- game state ----------
const S = { screen:'start', names:['Player 1','Player 2'], wins:[0,0],
  lives:[START_LIVES, START_LIVES], cheese:[1,1], traps:[1,1], cheeseActive:false, ghostTrap:false,
  cheeseX:0, cheeseY:0, cheeseTgt:0, cheeseT:0, chaseX:0, chaseY:0, chaseVX:0, chaseVY:0,
  heart:null, anims:[],
  cur:0, dropper:-99, ghost:null, target:0, disp:0, swayT:0, swayFrozen:null,
  settleFrames:0, settleClock:0, loser:-1, shake:0, forcedPose:null, toastTo:0 };
try {
  const sv = JSON.parse(localStorage.getItem('squeak') || '{}');
  if (sv.names) S.names = sv.names;
  if (sv.wins) S.wins = sv.wins;
} catch {}

const $ = id => document.getElementById(id);
function save() { localStorage.setItem('squeak', JSON.stringify({ names:S.names, wins:S.wins })); }
function stackTop() {
  let t = 0;
  for (const p of pieces()) if (p !== S.ghost) t = Math.min(t, p.bounds.min.y);
  return t;
}
function pickPose() {
  const tot = POSE_KEYS.reduce((a, k) => a + POSES[k].w, 0);
  let r = Math.random() * tot;
  for (const k of POSE_KEYS) { r -= POSES[k].w; if (r <= 0) return k; }
  return 'tidy';
}
function newGhost() {
  const key = S.forcedPose || pickPose();
  const spawnY = stackTop() - SPAWN_GAP;
  S.ghost = buildMouse(key, 0, spawnY, S.cur);
  S.ghostTrap = false;
  S.target = 0; S.disp = 0; S.swayT = Math.random() * SWAY_PERIOD; S.swayFrozen = null;
  // reset the cheese chase for this turn
  S.cheeseX = 0; S.cheeseTgt = 0; S.cheeseT = 0;
  S.chaseX = 0; S.chaseY = spawnY; S.chaseVX = 0; S.chaseVY = 0;
  updateHud();
}
function updateHud() {
  clearTimeout(S.toastTo);
  for (const i of [0, 1]) {
    const c = $('chip' + i);
    const cheeseIcons = S.cheese[i] > 0 ? ' ' + '🧀'.repeat(Math.min(S.cheese[i], 2)) : '';
    c.textContent = `${S.names[i]} ${'♥'.repeat(Math.max(0, S.lives[i]))}${cheeseIcons}${S.traps[i] > 0 ? ' 🪤' : ''}`;
    c.style.background = PLAYERS[i].color;
    c.classList.toggle('turn', S.screen === 'aiming' && S.cur === i);
  }
  const b = $('banner'), h = $('hint'), d = $('dropBtn'), cb = $('cheeseBtn'), tb = $('trapBtn');
  cb.disabled = !(S.screen === 'aiming' && S.cheese[S.cur] > 0 && !S.ghostTrap);
  cb.textContent = S.cheese[S.cur] > 1 ? '🧀+' : '🧀';
  tb.disabled = !(S.screen === 'aiming' && S.traps[S.cur] > 0 && !S.ghostTrap);
  if (S.screen === 'aiming' && S.ghost) {
    if (S.ghostTrap) {
      b.textContent = `🪤 ${S.names[S.cur]} — place your TRAP!`;
      b.style.color = '#8a5a26';
      h.textContent = 'no spinning traps — just time the DROP';
    } else if (S.cheeseActive) {
      b.textContent = `🧀 CHEESE CHAOS — ${S.names[S.cur]}, drop ${POSES[S.ghost.plugin.mouse.pose].label}!`;
      b.style.color = '#c98a2b';
      h.textContent = 'your mouse is chasing the cheese!! tap = spin 45°';
    } else {
      b.textContent = `${S.names[S.cur]} — drop ${POSES[S.ghost.plugin.mouse.pose].label}!`;
      b.style.color = PLAYERS[S.cur].color;
      h.textContent = 'tap anywhere = spin 45° · green line = safe';
    }
    d.disabled = false; d.textContent = 'DROP';
  } else if (S.screen === 'settling') {
    b.textContent = '…wobble wobble…'; b.style.color = '#4e6a8d';
    h.innerHTML = '&nbsp;'; d.disabled = true; d.textContent = 'settling…';
  } else if (S.screen === 'over') {
    b.textContent = '💥 SQUEAK!!'; b.style.color = '#ff4f5e';
    h.innerHTML = '&nbsp;'; d.disabled = true; d.textContent = '…';
  } else { d.disabled = true; d.textContent = '…'; }
}
function toast(msg, color) {
  const b = $('banner');
  b.textContent = msg; b.style.color = color || '#ff4f5e';
  clearTimeout(S.toastTo);
  S.toastTo = setTimeout(updateHud, 1600);
}

// ---------- flow ----------
function startGame() {
  for (const p of pieces()) Composite.remove(world, p);
  S.screen = 'aiming'; S.loser = -1; camY = 0;
  S.lives = [START_LIVES, START_LIVES]; S.cheese = [1, 1]; S.traps = [1, 1];
  S.cheeseActive = false; S.heart = null; S.anims = [];
  S.dropper = -99;
  newGhost();
  $('startOv').classList.add('hidden'); $('overOv').classList.add('hidden');
  updateHud();
}
function doRotate() {
  if (S.screen !== 'aiming') return;
  if (S.ghostTrap) { sfx('nope'); return; }  // traps don't spin
  S.target += Math.PI / 4;
  sfx('spin');
}
function doDrop() {
  if (S.screen !== 'aiming' || !S.ghost) return;
  const g = S.ghost;
  Body.setAngle(g, S.ghostTrap ? 0 : S.target); // snap to the chosen 45-degree step
  const vx = S.cheeseActive ? Math.max(-8, Math.min(8, S.chaseVX)) : 0;
  const vy = S.cheeseActive ? Math.max(0, S.chaseVY) : 0;
  Body.setVelocity(g, { x: vx, y: vy }); // a cheese-frenzied mouse drops with its fling
  Body.setAngularVelocity(g, 0);
  Composite.add(world, g);
  for (const p of pieces()) if (p.isSleeping) Sleeping.set(p, false);
  S.ghost = null; S.ghostTrap = false; S.dropper = S.cur; S.cheeseActive = false;
  S.screen = 'settling'; S.settleFrames = 0; S.settleClock = 0;
  sfx('drop');
  updateHud();
}
function playCheese() {
  if (S.screen !== 'aiming' || S.cheese[S.cur] <= 0 || S.ghostTrap) return;
  const player = S.cur;
  S.cheese[player]--;
  S.cheeseActive = true;
  S.ghost = null;
  sfx('cheese');
  nextTurn();
  toast(`🧀 ${S.names[player]} unleashed the CHEESE!`, '#c98a2b');
}
function playTrap() {
  if (S.screen !== 'aiming' || S.traps[S.cur] <= 0 || S.ghostTrap) return;
  S.traps[S.cur]--;
  S.ghostTrap = true;
  S.ghost = buildTrap(0, stackTop() - SPAWN_GAP, S.cur);
  S.target = 0; S.disp = 0;
  sfx('trapset');
  updateHud();
}
function nextTurn() {
  for (const p of pieces()) Sleeping.set(p, true); // freeze the settled pile - no idle rabble
  for (const p of pieces()) if (p.plugin.trap && !p.plugin.trap.spent) p.plugin.trap.armed = true; // traps go live once placed and settled
  maybeSpawnHeart();
  S.cur = 1 - S.cur;
  S.screen = 'aiming';
  newGhost();
}
function maybeSpawnHeart() {
  if (S.heart || (S.lives[0] >= START_LIVES && S.lives[1] >= START_LIVES)) return;
  if (Math.random() > 0.35) return;
  S.heart = { x: (Math.random() * 2 - 1) * (PLAT_W / 2 - 45), y: stackTop() - HEART_ABOVE, t: 0 };
}
function collectHeart(pIdx) {
  const h = S.heart; S.heart = null;
  if (S.lives[pIdx] < START_LIVES) {
    S.lives[pIdx]++;
    S.anims.push({ kind: 'heart', x: h.x, y: h.y, t: 0, side: pIdx });
    toast(`❤️ ${S.names[pIdx]} got a life back!`, PLAYERS[pIdx].color);
    sfx('heart');
  } else {
    S.cheese[pIdx]++;
    S.anims.push({ kind: 'toCheese', x: h.x, y: h.y, t: 0, side: pIdx });
    toast(`❤️→🧀 ${S.names[pIdx]} banked a bonus cheese!`, '#c98a2b');
    sfx('heart'); setTimeout(() => sfx('cheese'), 350);
  }
  updateHud();
}
function snapTrap(trap, m) {
  const tp = trap.plugin.trap;
  tp.spent = true; tp.armed = false;
  const ang = (Math.random() * 2 - 1) * (15 * Math.PI / 180); // up to 15 degrees off vertical
  Sleeping.set(m, false);
  Body.setVelocity(m, { x: Math.sin(ang) * TRAP_LAUNCH + m.velocity.x * 0.2, y: -Math.cos(ang) * TRAP_LAUNCH });
  Body.setAngularVelocity(m, (Math.random() * 2 - 1) * 0.25);
  m.plugin.mouse.launch = 110; // frames of anti-pop exemption while airborne
  S.shake = Math.max(S.shake, 11);
  if (S.screen === 'settling') S.settleFrames = 0;
  sfx('snap');
  toast('🪤 SNAP!!', '#c0392b');
}
function loseLife() {
  S.lives[S.dropper]--;
  S.shake = Math.max(S.shake, 9);
  sfx('fall');
  updateHud();
  if (S.lives[S.dropper] <= 0) { gameOver(); return; }
  toast(`💔 ${S.names[S.dropper]} lost a mouse! ${S.lives[S.dropper]} ${S.lives[S.dropper] === 1 ? 'life' : 'lives'} left`);
}
function gameOver() {
  if (S.screen === 'over') return;
  S.screen = 'over'; S.loser = S.dropper; S.ghost = null; S.cheeseActive = false; S.heart = null; S.shake = 14;
  const winner = 1 - S.loser;
  S.wins[winner]++; save();
  sfx('fall');
  setTimeout(() => sfx('win'), 700);
  setTimeout(() => {
    $('overMsg').innerHTML = `<b style="color:${PLAYERS[S.loser].color}">${esc(S.names[S.loser])}</b> dropped ${START_LIVES} mice off the edge!<br>🏆 <b style="color:${PLAYERS[winner].color}">${esc(S.names[winner])}</b> wins!`;
    $('overScore').textContent = `${S.names[0]} ${S.wins[0]} — ${S.wins[1]} ${S.names[1]}`;
    $('overOv').classList.remove('hidden');
  }, 1100);
  updateHud();
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ---------- simulation ----------
let last = performance.now(), acc = 0;
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(now - last, 100); last = now;
  acc += dt;
  let steps = 0;
  while (acc >= 1000 / 60 && steps < 3) { step(1000 / 60); acc -= 1000 / 60; steps++; }
  if (steps === 3) acc = 0;
  render();
}
function step(ms) {
  // ghost movement
  if (S.screen === 'aiming' && S.ghost) {
    S.swayT += ms / 1000;
    const spawnY = stackTop() - SPAWN_GAP;
    let gx, gy = spawnY;
    if (S.swayFrozen != null) {
      gx = S.swayFrozen;
    } else if (S.cheeseActive) {
      // the cheese darts to random spots; the mouse spring-chases it, overshooting wildly
      S.cheeseT -= ms / 1000;
      if (S.cheeseT <= 0) { S.cheeseTgt = (Math.random() * 2 - 1) * SWAY_AMP; S.cheeseT = 0.28 + Math.random() * 0.45; }
      S.cheeseX += (S.cheeseTgt - S.cheeseX) * 0.16;
      S.cheeseY = spawnY - 55 + Math.sin(S.swayT * 6.3) * 30;
      S.chaseVX += (S.cheeseX - S.chaseX) * 0.03; S.chaseVX *= 0.9;
      S.chaseVY += (S.cheeseY + 55 - S.chaseY) * 0.03; S.chaseVY *= 0.9;
      S.chaseX += S.chaseVX; S.chaseY += S.chaseVY;
      gx = Math.max(-205, Math.min(205, S.chaseX));
      gy = Math.max(spawnY - 45, Math.min(spawnY + 45, S.chaseY));
    } else {
      gx = Math.sin(S.swayT * Math.PI * 2 / SWAY_PERIOD) * SWAY_AMP;
    }
    S.disp += (S.target - S.disp) * 0.22;
    Body.setPosition(S.ghost, { x: gx, y: gy });
    Body.setAngle(S.ghost, S.ghostTrap ? 0 : S.disp);
  }
  Engine.update(engine, ms);

  // post-solve velocity hygiene
  for (const p of pieces()) {
    if (p === S.ghost || p.isSleeping) continue;
    const mp = p.plugin.mouse;
    const launched = mp && mp.launch > 0;
    if (launched) mp.launch--;
    let vx = p.velocity.x, vy = p.velocity.y, fix = false;
    // terminal fall speed: shallower penetration on landing = smaller correction pop
    if (vy > 13) { vy = 13; fix = true; }
    // anti-pop: pieces never gain real upward velocity (restitution is 0), so any
    // solver-invented hop gets clamped flat during play; trap launches and
    // game-over flings stay free
    if (S.screen !== 'over' && !launched && vy < -0.9) { vy = -0.9; fix = true; }
    if (fix) Body.setVelocity(p, { x: vx, y: vy });
    // micro-motion damper: bleed off tiny residual velocities so the pile can't buzz
    if (p.speed < 0.25 && p.angularSpeed < 0.035) {
      Body.setVelocity(p, { x: p.velocity.x * 0.7, y: p.velocity.y * 0.7 });
      Body.setAngularVelocity(p, p.angularVelocity * 0.7);
    }
  }

  // heart pickup: only a slow (settled or apex-drifting) mouse can grab it -
  // things falling past at speed zoom right through, so you have to build to it
  if (S.heart && S.screen !== 'over') {
    S.heart.t += ms / 1000;
    for (const m of mice()) {
      if (m === S.ghost || m.speed > 2.5) continue;
      const bx = Math.max(m.bounds.min.x, Math.min(S.heart.x, m.bounds.max.x));
      const by = Math.max(m.bounds.min.y, Math.min(S.heart.y, m.bounds.max.y));
      const dx = bx - S.heart.x, dy = by - S.heart.y;
      if (dx * dx + dy * dy < 24 * 24) { collectHeart(m.plugin.mouse.player); break; }
    }
  }
  for (const a of S.anims) a.t += ms / 1000;
  S.anims = S.anims.filter(a => a.t < 1.25);

  // fell off? (during aiming too - a teetering piece can still tumble; last dropper is to blame)
  if (S.screen === 'settling' || S.screen === 'aiming') {
    for (const p of pieces()) {
      if (p !== S.ghost && p.position.y > KILL_Y) {
        Composite.remove(world, p);
        if (p.plugin.mouse) {
          loseLife();
          if (S.screen === 'over') return;
        } else {
          toast(`🪤 the trap fell into the void!`, '#8a5a26');
        }
      }
    }
  }
  if (S.screen === 'settling') {
    let calm = true;
    for (const p of pieces()) if (!p.isSleeping && (p.speed > 0.18 || p.angularSpeed > 0.03)) calm = false;
    S.settleFrames = calm ? S.settleFrames + 1 : 0;
    S.settleClock += ms;
    if (S.settleFrames >= 45 || S.settleClock > 9000) nextTurn();
  }
}
Events.on(engine, 'collisionStart', ev => {
  for (const pair of ev.pairs) {
    const A = pair.bodyA.parent, B = pair.bodyB.parent;
    for (const b of [A, B]) {
      if (!b.plugin || !b.plugin.mouse) continue;
      const mp = b.plugin.mouse;
      // impact absorption: on its first touch (or on re-landing after a trap
      // launch) a mouse dumps most of its momentum - beanbag thud, not a
      // bouncing block. An upright landing stays upright instead of twisting over.
      if (!mp.landed || (mp.launch > 0 && mp.launch < 100)) {
        Body.setVelocity(b, { x: b.velocity.x * 0.35, y: Math.max(0, b.velocity.y) * 0.25 });
        Body.setAngularVelocity(b, b.angularVelocity * 0.4);
        if (!mp.landed) { mp.landed = true; }
        mp.launch = 0;
        sfx('land');
      }
    }
    // armed trap + mouse = SNAP
    const trap = (A.plugin && A.plugin.trap && A.plugin.trap.armed && !A.plugin.trap.spent) ? A
               : (B.plugin && B.plugin.trap && B.plugin.trap.armed && !B.plugin.trap.spent) ? B : null;
    if (trap) {
      const other = trap === A ? B : A;
      if (other.plugin && other.plugin.mouse) snapTrap(trap, other);
    }
  }
});

// ---------- rendering ----------
function w2sX(x) { return W / 2 + x * scale; }
function w2sY(y) { return baseY + (y - camY) * scale; }
function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // sky
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#8ecdff'); g.addColorStop(0.55, '#bfe3ff'); g.addColorStop(1, '#eaf7ff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // camera follows the ghost / stack
  let want = 0;
  if (S.ghost) want = Math.min(0, (stackTop() - SPAWN_GAP) - (110 - baseY) / scale);
  else want = Math.min(0, stackTop() + 60 - (170 - baseY) / scale);
  camY += (want - camY) * 0.08;

  let shx = 0, shy = 0;
  if (S.shake > 0) { S.shake *= 0.9; shx = (Math.random() - 0.5) * S.shake; shy = (Math.random() - 0.5) * S.shake; if (S.shake < 0.4) S.shake = 0; }
  ctx.save();
  ctx.translate(shx, shy);

  // clouds (world-anchored)
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (const [cx, cy, r] of [[-150,-160,26],[130,-320,34],[-90,-520,30],[160,-720,26],[-160,-940,34],[60,-1180,28]]) {
    const sx = w2sX(cx), sy = w2sY(cy);
    if (sy < -80 || sy > H + 80) continue;
    ctx.beginPath();
    ctx.arc(sx, sy, r * scale, 0, 7);
    ctx.arc(sx + 24 * scale, sy + 6 * scale, r * 0.72 * scale, 0, 7);
    ctx.arc(sx - 24 * scale, sy + 7 * scale, r * 0.66 * scale, 0, 7);
    ctx.fill();
  }

  drawPlatform();
  for (const p of pieces()) p.plugin.mouse ? drawMouse(p, 1) : drawTrap(p, 1);
  if (S.heart) drawHeart();
  if (S.ghost) {
    drawGuide(S.ghost);
    S.ghostTrap ? drawTrap(S.ghost, 0.88) : drawMouse(S.ghost, 0.88);
    if (S.cheeseActive && S.swayFrozen == null) drawCheese(S.cheeseX, S.cheeseY, S.swayT);
  }
  ctx.restore();
  drawAnims(); // screen-space, unshaken
}

function drawPlatform() {
  const x0 = w2sX(-PLAT_W / 2), x1 = w2sX(PLAT_W / 2), y0 = w2sY(0), y1 = w2sY(PLAT_H);
  // pedestal
  const pw = PLAT_W * 0.34 * scale, pc = w2sX(0);
  if (y1 < H) {
    ctx.fillStyle = '#c98a2b';
    ctx.fillRect(pc - pw / 2, y1 - 2, pw, H - y1 + 4);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(pc + pw / 2 - 8 * scale, y1 - 2, 8 * scale, H - y1 + 4);
  }
  // cheese slab
  ctx.fillStyle = '#f7b733';
  rrect(x0, y0, x1 - x0, y1 - y0, 8 * scale); ctx.fill();
  ctx.strokeStyle = '#d99a1e'; ctx.lineWidth = 3 * scale;
  rrect(x0, y0, x1 - x0, y1 - y0, 8 * scale); ctx.stroke();
  ctx.fillStyle = '#e39d1e';
  for (const [hx, hr] of [[-0.35, 5], [-0.1, 3.6], [0.18, 5.5], [0.4, 3.4]]) {
    ctx.beginPath(); ctx.arc(w2sX(hx * PLAT_W), (y0 + y1) / 2, hr * scale, 0, 7); ctx.fill();
  }
  // edge flags
  for (const s of [-1, 1]) {
    const fx = w2sX(s * PLAT_W / 2);
    ctx.strokeStyle = '#9a6a12'; ctx.lineWidth = 2.5 * scale;
    ctx.beginPath(); ctx.moveTo(fx, y0); ctx.lineTo(fx, y0 - 20 * scale); ctx.stroke();
    ctx.fillStyle = '#ff4f5e';
    ctx.beginPath(); ctx.moveTo(fx, y0 - 20 * scale); ctx.lineTo(fx + s * 13 * scale, y0 - 16 * scale); ctx.lineTo(fx, y0 - 12 * scale); ctx.closePath(); ctx.fill();
  }
}

function drawGuide(g) {
  const overlaps = g.bounds.min.x < PLAT_W / 2 && g.bounds.max.x > -PLAT_W / 2;
  const x = w2sX(g.position.x);
  ctx.strokeStyle = overlaps ? 'rgba(18,185,129,0.8)' : 'rgba(255,79,94,0.85)';
  ctx.lineWidth = 3 * scale; ctx.setLineDash([4 * scale, 8 * scale]);
  ctx.beginPath(); ctx.moveTo(x, w2sY(g.bounds.max.y) + 6);
  ctx.lineTo(x, overlaps ? w2sY(0) : H); ctx.stroke();
  ctx.setLineDash([]);
}

function drawCheese(x, y, t) {
  ctx.save();
  ctx.translate(w2sX(x), w2sY(y));
  ctx.scale(scale, scale);
  ctx.rotate(Math.sin(t * 9) * 0.3);
  cheeseWedge(1);
  ctx.restore();
}
function cheeseWedge(s) {
  ctx.save(); ctx.scale(s, s);
  ctx.strokeStyle = '#cfa616'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  ctx.fillStyle = '#ffd84d';
  ctx.beginPath(); ctx.moveTo(-24, 14); ctx.lineTo(24, 14); ctx.lineTo(10, -18); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#e8b923';
  for (const [hx, hy, hr] of [[0, 6, 4], [12, 9, 3], [-10, 9, 2.5]]) {
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, 7); ctx.fill();
  }
  ctx.restore();
}
function heartShape(s) {
  ctx.beginPath();
  ctx.moveTo(0, s);
  ctx.bezierCurveTo(-s * 1.25, s * 0.05, -s * 0.72, -s * 0.95, 0, -s * 0.38);
  ctx.bezierCurveTo(s * 0.72, -s * 0.95, s * 1.25, s * 0.05, 0, s);
  ctx.closePath();
}
function drawHeart() {
  const h = S.heart;
  const pulse = 1 + 0.12 * Math.sin(h.t * 4.2);
  ctx.save();
  ctx.translate(w2sX(h.x), w2sY(h.y + Math.sin(h.t * 1.8) * 4));
  ctx.scale(scale * pulse, scale * pulse);
  // sparkle ring
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 2; ctx.setLineDash([3, 7]);
  ctx.beginPath(); ctx.arc(0, 0, 26, h.t * 0.9, h.t * 0.9 + 7); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ff4f7e'; ctx.strokeStyle = '#d12b5c'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  heartShape(16); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath(); ctx.arc(-6, -8, 3.4, 0, 7); ctx.fill();
  ctx.restore();
}
function drawTrap(m, alpha) {
  const tp = m.plugin.trap;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(w2sX(m.position.x), w2sY(m.position.y));
  ctx.scale(scale, scale);
  ctx.rotate(m.angle);
  ctx.translate(-tp.off.x, -tp.off.y);
  // wooden base
  ctx.fillStyle = '#c78a4b'; ctx.strokeStyle = '#8a5a26'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  rrect(-36, -14, 72, 14, 4); ctx.fill(); rrect(-36, -14, 72, 14, 4); ctx.stroke();
  ctx.strokeStyle = 'rgba(138,90,38,0.45)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-30, -7); ctx.lineTo(30, -7); ctx.stroke();
  // cheese bait
  ctx.fillStyle = '#ffd84d'; ctx.strokeStyle = '#cfa616'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(4, -14); ctx.lineTo(18, -14); ctx.lineTo(12, -26); ctx.closePath(); ctx.fill(); ctx.stroke();
  // metal bar
  ctx.strokeStyle = '#8b95a1'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  if (!tp.spent) {
    ctx.beginPath(); ctx.arc(-12, -14, 22, Math.PI, Math.PI * 1.5); ctx.stroke(); // bar standing upright
  } else {
    ctx.beginPath(); ctx.moveTo(-8, -17); ctx.lineTo(34, -17); ctx.stroke();      // snapped flat
  }
  // hinge
  ctx.fillStyle = tp.armed ? '#ff4f5e' : '#a05c2c';
  ctx.beginPath(); ctx.arc(-31, -11, 3.6, 0, 7); ctx.fill();
  ctx.restore();
}
function drawAnims() {
  for (const a of S.anims) {
    const t = a.t;
    const sx0 = w2sX(a.x), sy0 = w2sY(a.y);
    const tx = a.side === 0 ? W * 0.27 : W * 0.73, ty = 46;
    let x = sx0, y = sy0, sc = 1;
    if (t < 0.45) { sc = 1 + t * 2.2; }
    else {
      const k = Math.min(1, (t - 0.45) / 0.65), e = k * k * (3 - 2 * k);
      x = sx0 + (tx - sx0) * e; y = sy0 + (ty - sy0) * e; sc = 2 - 1.2 * e;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale * sc * 0.85, scale * sc * 0.85);
    const showCheese = a.kind === 'toCheese' && t > 0.45;
    if (a.kind === 'toCheese' && t > 0.3 && t < 0.7) {
      // conversion flash ring
      ctx.strokeStyle = `rgba(255,216,77,${1 - Math.abs(t - 0.5) * 4})`;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, 22 + (t - 0.3) * 60, 0, 7); ctx.stroke();
    }
    if (showCheese) cheeseWedge(0.75);
    else {
      ctx.fillStyle = '#ff4f7e'; ctx.strokeStyle = '#d12b5c'; ctx.lineWidth = 3;
      heartShape(15); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
}
function partPath(p) {
  if (p[0] === 'c') { ctx.beginPath(); ctx.arc(p[1], p[2], p[3], 0, 7); }
  else if (p[0] === 'e') { ctx.beginPath(); ctx.ellipse(p[1], p[2], p[3], p[4], p[5] || 0, 0, 7); }
  else {
    ctx.save(); ctx.translate(p[1], p[2]); ctx.rotate(p[5] || 0);
    ctx.beginPath(); ctx.rect(-p[3] / 2, -p[4] / 2, p[3], p[4]);
    ctx.restore();
  }
}
function drawMouse(m, alpha) {
  const mp = m.plugin.mouse, pose = POSES[mp.pose], pl = PLAYERS[mp.player];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(w2sX(m.position.x), w2sY(m.position.y));
  ctx.scale(scale, scale);
  ctx.rotate(m.angle);
  ctx.translate(-mp.off.x, -mp.off.y);

  // outline pass then fill pass (expanded-stroke union trick)
  ctx.strokeStyle = pl.dark; ctx.lineWidth = 5; ctx.lineJoin = 'round';
  for (const p of pose.parts) { partPath(p); ctx.stroke(); }
  ctx.fillStyle = pl.body;
  for (const p of pose.parts) { partPath(p); ctx.fill(); }

  // belly
  if (pose.belly) {
    ctx.fillStyle = pl.belly;
    ctx.beginPath(); ctx.ellipse(pose.belly[0], pose.belly[1], pose.belly[2], pose.belly[3], 0, 0, 7); ctx.fill();
  }
  // inner ears
  ctx.fillStyle = INNER_EAR;
  for (const p of pose.parts) if (p[4] === 'ear') { ctx.beginPath(); ctx.arc(p[1], p[2], p[3] * 0.55, 0, 7); ctx.fill(); }
  // feet pads
  if (pose.feet) {
    ctx.fillStyle = pl.dark;
    for (const [fx, fy] of pose.feet) { ctx.beginPath(); ctx.ellipse(fx, fy, 6, 3.4, 0, 0, 7); ctx.fill(); }
  }
  // tail
  if (pose.tail) {
    const t = pose.tail.pts;
    ctx.strokeStyle = pl.dark; ctx.lineWidth = pose.tail.w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(t[0][0], t[0][1]); ctx.quadraticCurveTo(t[1][0], t[1][1], t[2][0], t[2][1]); ctx.stroke();
  }
  // face
  if (pose.face) {
    const [hx, hy, hr, fa, kind] = pose.face;
    const dx = Math.cos(fa), dy = Math.sin(fa), ux = dy, uy = -dx;
    // nose
    ctx.fillStyle = '#ff7fa8';
    ctx.beginPath(); ctx.arc(hx + dx * hr * 0.95, hy + dy * hr * 0.95, hr * 0.17, 0, 7); ctx.fill();
    // whiskers
    ctx.strokeStyle = 'rgba(60,40,40,0.55)'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
    for (const wa of [-0.35, 0, 0.35]) {
      const bx = hx + dx * hr * 0.72, by = hy + dy * hr * 0.72;
      ctx.beginPath(); ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(fa + wa) * hr * 0.85, by + Math.sin(fa + wa) * hr * 0.85); ctx.stroke();
    }
    // eye
    const ex = hx + dx * hr * 0.32 + ux * hr * 0.30, ey = hy + dy * hr * 0.32 + uy * hr * 0.30;
    if (kind === 'sleep') {
      ctx.strokeStyle = '#3a2b28'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(ex, ey, hr * 0.22, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    } else {
      ctx.fillStyle = '#3a2b28';
      ctx.beginPath(); ctx.arc(ex, ey, hr * 0.16, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ex - hr * 0.05, ey - hr * 0.05, hr * 0.055, 0, 7); ctx.fill();
    }
    // blush
    ctx.fillStyle = 'rgba(255,120,150,0.28)';
    ctx.beginPath(); ctx.arc(hx + dx * hr * 0.30 - ux * hr * 0.34, hy + dy * hr * 0.30 - uy * hr * 0.34, hr * 0.2, 0, 7); ctx.fill();
  }
  ctx.restore();
}
function rrect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---------- audio ----------
let actx = null, muted = false;
function unlock() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch {}
}
function blip(f0, f1, t0, dur, vol, type) {
  if (!actx || muted) return;
  const o = actx.createOscillator(), gn = actx.createGain();
  o.type = type || 'sine';
  const t = actx.currentTime + t0;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(gn).connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function sfx(kind) {
  if (kind === 'spin') blip(700, 1050, 0, 0.08, 0.12, 'triangle');
  else if (kind === 'nope') blip(240, 170, 0, 0.1, 0.12, 'triangle');
  else if (kind === 'drop') blip(500, 250, 0, 0.14, 0.15, 'triangle');
  else if (kind === 'land') { blip(120, 60, 0, 0.1, 0.22, 'sine'); blip(1400, 900, 0.02, 0.09, 0.07); }
  else if (kind === 'fall') { blip(1300, 250, 0, 0.55, 0.22); blip(1500, 300, 0.08, 0.5, 0.12); }
  else if (kind === 'cheese') { blip(300, 900, 0, 0.18, 0.16, 'sawtooth'); blip(900, 500, 0.16, 0.16, 0.14, 'sawtooth'); blip(500, 1200, 0.3, 0.2, 0.14, 'sawtooth'); }
  else if (kind === 'trapset') { blip(700, 300, 0, 0.07, 0.16, 'square'); blip(300, 500, 0.07, 0.06, 0.1, 'square'); }
  else if (kind === 'snap') { blip(180, 70, 0, 0.07, 0.3, 'square'); blip(2200, 400, 0.01, 0.14, 0.2); blip(900, 1800, 0.05, 0.2, 0.12, 'triangle'); }
  else if (kind === 'heart') { blip(660, 990, 0, 0.12, 0.15, 'triangle'); blip(990, 1320, 0.11, 0.16, 0.15, 'triangle'); }
  else if (kind === 'win') [660, 880, 990, 1320].forEach((f, i) => blip(f, f, i * 0.13, 0.14, 0.16, 'triangle'));
}

// ---------- input ----------
canvas.addEventListener('pointerdown', e => { unlock(); doRotate(); e.preventDefault(); });
$('dropBtn').addEventListener('pointerdown', e => { unlock(); e.stopPropagation(); });
$('dropBtn').addEventListener('click', () => { unlock(); doDrop(); });
$('cheeseBtn').addEventListener('pointerdown', e => { unlock(); e.stopPropagation(); });
$('cheeseBtn').addEventListener('click', () => { unlock(); playCheese(); });
$('trapBtn').addEventListener('pointerdown', e => { unlock(); e.stopPropagation(); });
$('trapBtn').addEventListener('click', () => { unlock(); playTrap(); });
$('mute').addEventListener('click', e => { muted = !muted; e.target.textContent = muted ? '🔇' : '🔊'; });
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('gesturestart', e => e.preventDefault());

// start / restart
$('n0').value = S.names[0] === 'Player 1' ? '' : S.names[0];
$('n1').value = S.names[1] === 'Player 2' ? '' : S.names[1];
$('startBtn').addEventListener('click', () => {
  unlock();
  S.names[0] = $('n0').value.trim() || 'Player 1';
  S.names[1] = $('n1').value.trim() || 'Player 2';
  save();
  S.cur = Math.random() < 0.5 ? 0 : 1;
  startGame();
});
$('againBtn').addEventListener('click', () => { S.cur = S.loser >= 0 ? S.loser : 0; startGame(); });

// decorative mice behind the start screen
Composite.add(world, [buildMouse('loaf', -55, -70, 0), buildMouse('tidy', 45, -90, 1)]);

updateHud();
requestAnimationFrame(tick);

// test hooks
window.__g = {
  S, mice, pieces, drop: doDrop, rotate: doRotate, playCheese, playTrap,
  start(a, b) { S.names = [a || 'A', b || 'B']; S.cur = 0; startGame(); },
  freezeX(x) { S.swayFrozen = x; },
  pose(k) { S.forcedPose = k; },
  heart(x, y) { S.heart = { x, y, t: 0 }; },
};
})();
