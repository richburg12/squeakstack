# SqueakStack 🐭

Two-player pass-and-play mouse-stacking physics game.

**Live:** https://squeakstack-richards-projects-82456208.vercel.app

## How to play
- Take turns. Your mouse sways back and forth above the tower.
- **Tap anywhere** to spin it 45° clockwise. **DROP** releases it.
- The dotted guide line shows where it will fall (green = over the platform).
- Everything is real rigid-body physics — mice tumble, balance, lean, and can
  even hang by a hooked tail. If **any** mouse falls off the edge on your
  turn, you lose the round. Wins are tallied on the name chips.

## The mice
8 hand-built poses, each a Matter.js compound body with uniform density
(mass follows the silhouette): Pip (tidy sit), Tippy (on hind legs), Bobble
(curled ball — it rolls!), Loafie (bread loaf), Longboy (stretched flat),
Hooky (stiff hooked tail that can catch a ledge), Chonk (big), Bridget (arch
you can bridge over things).

## Tech
Static site — no server, no build. Matter.js rigid bodies
(friction 0.9, restitution 0.04), fixed-timestep sim, canvas renderer where
the physics parts ARE the drawn silhouette, camera follows the tower,
WebAudio squeaks. Tuning lives at the top of `game.js` (`POSES`, `MOUSE_OPTS`,
`PLAT_W`, `SWAY_*`).

## Deploy
`vercel --prod` from this folder (project: squeakstack).
