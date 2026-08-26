/* SqueakStack — a two-player mouse-stacking physics game. */
(() => {
const { Engine, Body, Bodies, Composite, Events } = Matter;

// ---------- world constants ----------
const WORLD_W = 420;               // logical width, x in [-210, 210]
const PLAT_W = 250, PLAT_H = 24;   // platform top surface at y = 0
const KILL_Y = 330;                // below this = fell off
const SPAWN_GAP = 235;             // ghost hovers this far above stack top
const SWAY_AMP = 165, SWAY_PERIOD = 2.3; // seconds

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
engine.positionIterations = 10;
engine.velocityIterations = 8;
const world = engine.world;

const MOUSE_OPTS = { friction:0.9, frictionStatic:1.2, restitution:0.04, frictionAir:0.012, slop:0.02 };
const platform = Bodies.rectangle(0, PLAT_H/2, PLAT_W, PLAT_H, { isStatic:true, friction:1, restitution:0 });
Composite.add(world, platform);

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
  body.plugin.mouse = {
    pose: poseKey, player: playerIdx,
    off: { x: body.position.x - x, y: body.position.y - y }, // pose-origin -> COM
    landed: false,
  };
  return body;
}
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
  cur:0, dropper:0, ghost:null, target:0, disp:0, swayT:0, swayFrozen:null,
  settleFrames:0, settleClock:0, loser:-1, shake:0, forcedPose:null };
try {
  const sv = JSON.parse(localStorage.getItem('squeak') || '{}');
  if (sv.names) S.names = sv.names;
  if (sv.wins) S.wins = sv.wins;
} catch {}

const $ = id => document.getElementById(id);
function save() { localStorage.setItem('squeak', JSON.stringify({ names:S.names, wins:S.wins })); }
function stackTop() {
  let t = 0;
  for (const m of mice()) if (m !== S.ghost) t = Math.min(t, m.bounds.min.y);
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
  S.ghost = buildMouse(key, 0, stackTop() - SPAWN_GAP, S.cur);
  S.target = 0; S.disp = 0; S.swayT = Math.random() * SWAY_PERIOD; S.swayFrozen = null;
  updateHud();
}
function updateHud() {
  for (const i of [0, 1]) {
    const c = $('chip' + i);
    c.textContent = `${S.names[i]} · ${S.wins[i]}`;
    c.style.background = PLAYERS[i].color;
    c.classList.toggle('turn', S.screen === 'aiming' && S.cur === i);
  }
  const b = $('banner'), h = $('hint'), d = $('dropBtn');
  if (S.screen === 'aiming' && S.ghost) {
    b.textContent = `${S.names[S.cur]} — drop ${POSES[S.ghost.plugin.mouse.pose].label}!`;
    b.style.color = PLAYERS[S.cur].color;
    h.textContent = 'tap anywhere = spin 45° · green line = safe';
    d.disabled = false; d.textContent = 'DROP';
  } else if (S.screen === 'settling') {
    b.textContent = '…wobble wobble…'; b.style.color = '#4e6a8d';
    h.innerHTML = '&nbsp;'; d.disabled = true; d.textContent = 'settling…';
  } else if (S.screen === 'over') {
    b.textContent = '💥 SQUEAK!!'; b.style.color = '#ff4f5e';
    h.innerHTML = '&nbsp;'; d.disabled = true; d.textContent = '…';
  } else { d.disabled = true; d.textContent = '…'; }
}

// ---------- flow ----------
function startGame() {
  for (const m of mice()) Composite.remove(world, m);
  S.screen = 'aiming'; S.loser = -1; camY = 0;
  newGhost();
  $('startOv').classList.add('hidden'); $('overOv').classList.add('hidden');
  updateHud();
}
function doRotate() {
  if (S.screen !== 'aiming') return;
  S.target += Math.PI / 4;
  sfx('spin');
}
function doDrop() {
  if (S.screen !== 'aiming' || !S.ghost) return;
  const g = S.ghost;
  Body.setAngle(g, S.target);           // snap to the chosen 45-degree step
  Body.setVelocity(g, { x: 0, y: 0 }); Body.setAngularVelocity(g, 0);
  Composite.add(world, g);
  for (const m of mice()) if (m.isSleeping) Matter.Sleeping.set(m, false);
  S.ghost = null; S.dropper = S.cur;
  S.screen = 'settling'; S.settleFrames = 0; S.settleClock = 0;
  sfx('drop');
  updateHud();
}
function nextTurn() {
  S.cur = 1 - S.cur;
  S.screen = 'aiming';
  newGhost();
}
function gameOver() {
  if (S.screen === 'over') return;
  S.screen = 'over'; S.loser = S.dropper; S.shake = 14;
  const winner = 1 - S.loser;
  S.wins[winner]++; save();
  sfx('fall');
  setTimeout(() => sfx('win'), 700);
  setTimeout(() => {
    $('overMsg').innerHTML = `<b style="color:${PLAYERS[S.loser].color}">${esc(S.names[S.loser])}</b> knocked a mouse off the edge!<br>🏆 <b style="color:${PLAYERS[winner].color}">${esc(S.names[winner])}</b> wins!`;
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
  // ghost sway + spin animation
  if (S.screen === 'aiming' && S.ghost) {
    S.swayT += ms / 1000;
    const x = S.swayFrozen != null ? S.swayFrozen : Math.sin(S.swayT * Math.PI * 2 / SWAY_PERIOD) * SWAY_AMP;
    S.disp += (S.target - S.disp) * 0.22;
    Body.setPosition(S.ghost, { x, y: stackTop() - SPAWN_GAP });
    Body.setAngle(S.ghost, S.disp);
  }
  Engine.update(engine, ms);

  // fell off? (during aiming too - a teetering mouse can still tumble; last dropper is to blame)
  if (S.screen === 'settling' || S.screen === 'aiming') {
    for (const m of mice()) if (m !== S.ghost && m.position.y > KILL_Y) { gameOver(); return; }
  }
  if (S.screen === 'settling') {
    // settled?
    let calm = true;
    for (const m of mice()) if (!m.isSleeping && (m.speed > 0.18 || m.angularSpeed > 0.03)) calm = false;
    S.settleFrames = calm ? S.settleFrames + 1 : 0;
    S.settleClock += ms;
    if (S.settleFrames >= 45 || S.settleClock > 9000) nextTurn();
  }
}
Events.on(engine, 'collisionStart', ev => {
  for (const pair of ev.pairs) {
    for (const b of [pair.bodyA.parent, pair.bodyB.parent]) {
      if (b.plugin && b.plugin.mouse && !b.plugin.mouse.landed) { b.plugin.mouse.landed = true; sfx('land'); }
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
  for (const m of mice()) drawMouse(m, 1);
  if (S.ghost) { drawGuide(S.ghost); drawMouse(S.ghost, 0.88); }
  ctx.restore();
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
  else if (kind === 'drop') blip(500, 250, 0, 0.14, 0.15, 'triangle');
  else if (kind === 'land') { blip(120, 60, 0, 0.1, 0.22, 'sine'); blip(1400, 900, 0.02, 0.09, 0.07); }
  else if (kind === 'fall') { blip(1300, 250, 0, 0.55, 0.22); blip(1500, 300, 0.08, 0.5, 0.12); }
  else if (kind === 'win') [660, 880, 990, 1320].forEach((f, i) => blip(f, f, i * 0.13, 0.14, 0.16, 'triangle'));
}

// ---------- input ----------
canvas.addEventListener('pointerdown', e => { unlock(); doRotate(); e.preventDefault(); });
$('dropBtn').addEventListener('pointerdown', e => { unlock(); e.stopPropagation(); });
$('dropBtn').addEventListener('click', () => { unlock(); doDrop(); });
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
  S, mice, drop: doDrop, rotate: doRotate,
  start(a, b) { S.names = [a || 'A', b || 'B']; S.cur = 0; startGame(); },
  freezeX(x) { S.swayFrozen = x; },
  pose(k) { S.forcedPose = k; },
};
})();
