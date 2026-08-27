/* Offline physics validation: build every outline, then drop-test each pose
   onto a flat platform and report the final resting angle, drift, and settle
   time. Run: node sim-test.js */
const Matter = require('matter-js');
const decomp = require('poly-decomp');
const { OUTLINES, polyCentroid } = require('./outlines.js');
Matter.Common.setDecomp(decomp);
const { Engine, Bodies, Body, Composite, Events, Sleeping } = Matter;

const MOUSE_OPTS = { friction: 0.9, frictionStatic: 1.2, restitution: 0, frictionAir: 0.012, slop: 0.08 };
if (Matter.Resolver) { Matter.Resolver._positionDampen = 0.6; Matter.Resolver._positionWarming = 0.4; }

function buildMouse(poseKey, x, y) {
  const verts = OUTLINES[poseKey].map(([px, py]) => ({ x: px, y: py }));
  const body = Bodies.fromVertices(x, y, [verts], { ...MOUSE_OPTS }, true);
  if (!body) throw new Error('decomp failed for ' + poseKey);
  body.sleepThreshold = 30;
  body.plugin.mouse = { pose: poseKey, landed: false, launch: 0 };
  return body;
}

// --- geometry sanity ---
console.log('=== geometry ===');
for (const key of Object.keys(OUTLINES)) {
  const c = polyCentroid(OUTLINES[key]);
  const b = buildMouse(key, 0, -100);
  const bottomRel = b.bounds.max.y - b.position.y;         // measured
  const bottomExpect = 0 - c.y;                            // outline bottom minus centroid
  const parts = b.parts.length - 1;
  const flat = OUTLINES[key].filter(p => p[1] === 0).length;
  console.log(
    key.padEnd(8),
    'parts=' + String(parts).padEnd(3),
    'area=' + String(Math.round(c.area)).padEnd(6),
    'centroid=(' + c.x.toFixed(1) + ',' + c.y.toFixed(1) + ')',
    'bottomRel meas/exp=' + bottomRel.toFixed(1) + '/' + bottomExpect.toFixed(1),
    Math.abs(bottomRel - bottomExpect) < 2 ? 'ALIGN-OK' : '*** MISALIGNED',
    'flatPts=' + flat
  );
}

// --- drop test: each pose, 4 drops on flat platform ---
console.log('\n=== drop tests (flat platform, from spawn height) ===');
const results = {};
for (const key of Object.keys(OUTLINES)) {
  results[key] = [];
  for (let trial = 0; trial < 4; trial++) {
    const engine = Engine.create({ enableSleeping: true });
    engine.positionIterations = 12; engine.velocityIterations = 10;
    const plat = Bodies.rectangle(0, 12, 350, 24, { isStatic: true, friction: 1, restitution: 0, slop: 0.08 });
    Composite.add(engine.world, plat);
    const m = buildMouse(key, trial * 10 - 15, -235 - polyCentroid(OUTLINES[key]).y * -1);
    Composite.add(engine.world, m);
    // same runtime hygiene as the game
    Events.on(engine, 'collisionStart', ev => {
      for (const pair of ev.pairs) {
        for (const b of [pair.bodyA.parent, pair.bodyB.parent]) {
          if (!b.plugin || !b.plugin.mouse) continue;
          const mp = b.plugin.mouse;
          if (!mp.landed) {
            Body.setVelocity(b, { x: b.velocity.x * 0.35, y: Math.max(0, b.velocity.y) * 0.25 });
            Body.setAngularVelocity(b, b.angularVelocity * 0.4);
            mp.landed = true; mp.grace = 25;
          }
        }
      }
    });
    let touchedAt = -1, xAtTouch = 0, sleptAt = -1;
    for (let f = 0; f < 600; f++) {
      Engine.update(engine, 1000 / 60);
      // post-solve hygiene (mirror of game.js)
      if (!m.isSleeping) {
        let vx = m.velocity.x, vy = m.velocity.y, fix = false;
        if (vy > 10) { vy = 10; fix = true; }
        if (vy < -0.9) { vy = -0.9; fix = true; }
        if (m.plugin.mouse.landed && Math.abs(vx) < 0.7 && Math.abs(vy) < 0.9) { vx *= 0.45; vy *= 0.6; fix = true; }
        if (m.plugin.mouse.grace > 0) { m.plugin.mouse.grace--; vx *= 0.55; fix = true; Body.setAngularVelocity(m, m.angularVelocity * 0.55); }
        if (fix) Body.setVelocity(m, { x: vx, y: vy });
        if (m.speed < 0.25 && m.angularSpeed < 0.02) Body.setAngularVelocity(m, m.angularVelocity * 0.85);
      }
      if (touchedAt < 0 && m.plugin.mouse.landed) { touchedAt = f; xAtTouch = m.position.x; }
      if (m.isSleeping) { sleptAt = f; break; }
    }
    results[key].push({
      deg: Math.round(m.angle * 180 / Math.PI),
      drift: Math.round((m.position.x - xAtTouch) * 10) / 10,
      settle: sleptAt >= 0 ? sleptAt - touchedAt : 'NEVER',
    });
  }
  const r = results[key];
  console.log(key.padEnd(8), r.map(x => `deg=${String(x.deg).padStart(4)} drift=${String(x.drift).padStart(6)} settle=${x.settle}`).join('  |  '));
}
