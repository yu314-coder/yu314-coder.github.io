// Regression tests for the hidden arcade (assets/js/main.js).
//
//   node tests/arcade.test.js
//
// These live in the repo rather than a scratch directory because they cover
// shipped behaviour, and several of them exist because the thing they check
// was broken once already: ducking silently not working, an effect-aware
// helper being shadowed by an older copy further down the same object, game
// keys scrolling the page out from under the board.
const { run, score } = require('./arcade-harness');

const results = [];
const check = (name, cond, detail) => results.push({ name, pass: !!cond, detail });

const boot = (game, auto, opts) => {
  const h = run(opts);
  h.els['gameSelect'].value = game;
  h.win.startGame();
  if (auto) h.btn('autoToggle').dispatch('click');
  return { h, A: h.win.__arcade, B: h.win.__arcade.Breakout };
};
const fakeGame = (h) => ({
  canvas: h.canvas, ctx: h.canvas.getContext('2d'), score: 0,
  updateScore(v) { this.score = v; }, shake() {}, showGameOver(m) { this.over = m; }
});
const levelOf = (B, name) => 1 + B.LAYOUTS.findIndex((L) => L.name === name);

// ---------------------------------------------------------------- board data
{
  const { B } = boot('breakout');
  const GLYPHS = '.123X*?K';
  const bad = [];
  for (const L of B.LAYOUTS) {
    const w = L.rows[0].length;
    L.rows.forEach((r, i) => { if (r.length !== w) bad.push(`${L.name} row${i}`); });
    for (const r of L.rows) for (const ch of r) if (!GLYPHS.includes(ch)) bad.push(`${L.name} '${ch}'`);
  }
  check(`all ${B.LAYOUTS.length} layouts are rectangular with known glyphs`, !bad.length, bad.join(' '));
  const dead = B.LAYOUTS.filter((L) => !L.rows.some((r) => /[123*?K]/.test(r)));
  check('every layout has something breakable', !dead.length, dead.map((L) => L.name).join(','));
}
{
  const { h, B } = boot('breakout');
  const n = B.LAYOUTS.length, seen = [];
  for (let l = 1; l <= n + 1; l++) { B.level = l; B.buildLevel(h.canvas); seen.push(B.layoutName); }
  check(`the first ${n} levels are ${n} distinct boards`, new Set(seen.slice(0, n)).size === n);
  check('then the set cycles', seen[n] === seen[0]);
}

// ------------------------------------------------------------- special bricks
{
  const { h, B } = boot('breakout');
  const g = fakeGame(h);
  B.level = levelOf(B, 'Fortress'); B.buildLevel(h.canvas);
  check('Fortress lays steel', B.bricks.some((b) => b.kind === 'steel'));
  const st = B.bricks.find((b) => b.kind === 'steel');
  B.damageBrick(st, g, st.x, true);
  check('steel survives a direct hit', st.hp > 0, `hp=${st.hp}`);
  B.bricks.forEach((b) => { if (b.kind !== 'steel') b.hp = 0; });
  check('steel never gates level completion', B.bricksLeft() === 0);
}
{
  const { h, B } = boot('breakout');
  B.level = levelOf(B, 'Vault'); B.buildLevel(h.canvas);
  const boom = B.bricks.find((b) => b.kind === 'boom');
  const before = B.bricks.filter((b) => b.hp > 0 && b.kind !== 'steel').length;
  B.damageBrick(boom, fakeGame(h), boom.x, true);
  const after = B.bricks.filter((b) => b.hp > 0 && b.kind !== 'steel').length;
  check('an explosive clears its neighbourhood', before - after > 3, `${before} -> ${after}`);
  check('the blast leaves steel standing',
        B.bricks.filter((b) => b.kind === 'steel' && b.hp > 0).length ===
        B.bricks.filter((b) => b.kind === 'steel').length);
}
{
  // Worst case for the chain: every breakable brick is explosive.
  const { h, B } = boot('breakout');
  B.level = levelOf(B, 'Vault'); B.buildLevel(h.canvas);
  B.bricks.forEach((b) => { if (b.kind !== 'steel') b.kind = 'boom'; });
  const t0 = Date.now();
  B.damageBrick(B.bricks.find((b) => b.kind === 'boom'), fakeGame(h), 0, true);
  check('an all-explosive board chains without hanging', Date.now() - t0 < 1000, `${Date.now() - t0}ms`);
}
{
  const { h, B } = boot('breakout');
  const g = fakeGame(h);
  B.level = levelOf(B, 'Checkers'); B.buildLevel(h.canvas);
  const key = B.bricks.find((b) => b.kind === 'key');
  const mates = B.bricks.filter((b) => b.row === key.row && b !== key && b.kind !== 'steel');
  const others = B.bricks.filter((b) => b.row !== key.row && b.kind !== 'steel' && b.hp > 0).length;
  B.damageBrick(key, g, key.x, true);
  check('a keystone takes two hits', key.hp === 1, `hp=${key.hp}`);
  B.damageBrick(key, g, key.x, true);
  check('breaking a keystone clears its row', mates.every((b) => b.hp <= 0));
  check('the collapse stays in that row',
        B.bricks.filter((b) => b.row !== key.row && b.kind !== 'steel' && b.hp > 0).length === others);
}
{
  const { h, B } = boot('breakout');
  let hazards = 0, jackpots = 0, threw = null;
  for (let i = 0; i < 600; i++) {
    B.powerups = []; B.balls = [B.newBall(300, 300, 2, 3)];
    const g = fakeGame(h);
    try {
      B.rollMystery({ x: 100, y: 60, w: 48, h: 18, kind: 'mystery', hp: 0, max: 1, col: 2, row: 1 }, g);
    } catch (e) { threw = e.message; break; }
    if (B.powerups.some((p) => B.isHazard(p.type))) hazards++;
    if (g.score >= 150) jackpots++;
  }
  check('a mystery brick always resolves to something', !threw, threw || 'clean');
  check('mystery spans jackpot to hazard', jackpots > 90 && hazards > 30, `${jackpots} jackpot, ${hazards} hazard`);
}

// -------------------------------------------------------------------- effects
{
  const { h, B } = boot('breakout');
  check('there is no permanent slow flag', !('slow' in B.effects), Object.keys(B.effects).join(','));
  B.applyPowerup({ x: 100, y: 100, w: 36, h: 17, type: 'S' }, fakeGame(h));
  const slowed = B.ballFactor(B.effects.slowUntil - 1);
  check('slow slows while it lasts', slowed < 0.85 && slowed > 0.3, `factor=${slowed}`);
  check('slow expires', B.ballFactor(B.effects.slowUntil + 1) === 1);
  B.effects.slowUntil = 1e12;
  B.buildLevel(h.canvas);
  check('a new level does not wipe the slow timer', B.effects.slowUntil === 1e12);
  check('wide is the level-scoped one', B.effects.wide === false);
}
{
  const { h, B } = boot('breakout');
  const g = fakeGame(h);
  B.effects.wide = true;
  B.applyPowerup({ x: 100, y: 100, w: 36, h: 17, type: 'X' }, g);
  h.step(120);
  check('shrink outranks an active wide', B.paddle.width < B.BASE_W,
        `width=${B.paddle.width.toFixed(1)} base=${B.BASE_W}`);
  B.applyPowerup({ x: 100, y: 100, w: 36, h: 17, type: 'R' }, g);
  check('rush speeds the ball up', B.ballFactor(h.nowMs()) > 1);
}
{
  const { h, B } = boot('breakout');
  const tally = {};
  B.combo = 6;
  for (let i = 0; i < 30000; i++) {
    B.powerups = []; B.maybeDropPowerup(0, 0);
    if (B.powerups[0]) tally[B.powerups[0].type] = (tally[B.powerups[0].type] || 0) + 1;
  }
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  const haz = ((tally.X || 0) + (tally.R || 0)) / total;
  const msw = ((tally.M || 0) + (tally.S || 0) + (tally.W || 0)) / total;
  check('hazards are a real but minority share', haz > 0.10 && haz < 0.25, `${(haz * 100).toFixed(0)}%`);
  check('wide/slow/multi still dominate', msw > 0.5, `${(msw * 100).toFixed(0)}%`);
  B.powerups = [];
}

// -------------------------------------------------------------- fast physics
{
  const { h, B } = boot('breakout');
  check('the ball starts and tops out fast', B.speed >= 6 && B.MAX_SPEED >= 18,
        `start ${B.speed} cap ${B.MAX_SPEED}`);
  check('a frame at top speed is taller than a brick',
        B.MAX_SPEED * 1.35 > B.config.brickHeight,
        `${(B.MAX_SPEED * 1.35).toFixed(1)}px vs ${B.config.brickHeight}px`);
  const g = fakeGame(h);
  B.level = levelOf(B, 'Wall'); B.buildLevel(h.canvas);
  const target = B.bricks.find((b) => b.kind === 'normal' && b.row === 4);
  B.balls = [B.newBall(target.x + target.w / 2, target.y + 60, 0, -24)];
  B.effects = { wide: false, slowUntil: 0, laserUntil: 0, pierceUntil: 0, shrinkUntil: 0, rushUntil: 0, net: 0 };
  const hp0 = target.hp;
  for (let i = 0; i < 6 && target.hp === hp0; i++) B.stepBalls(h.canvas, g, h.nowMs());
  check('sub-stepping catches a 24px/frame ball', target.hp < hp0, `hp ${hp0} -> ${target.hp}`);
}
{
  const { h, B } = boot('breakout');
  const g = fakeGame(h);
  B.level = levelOf(B, 'Wall'); B.buildLevel(h.canvas);
  const b1 = B.bricks.find((b) => b.kind === 'normal');
  const noPierce = B.newBall(b1.x + 4, b1.y + 4, 0, 4);
  B.hitBricks(noPierce, g, false);
  check('without pierce the ball bounces', noPierce.dy < 0);
  B.buildLevel(h.canvas);
  const b2 = B.bricks.find((b) => b.kind === 'normal');
  const piercing = B.newBall(b2.x + 4, b2.y + 4, 0, 4);
  B.hitBricks(piercing, g, true);
  check('with pierce it carries on', piercing.dy > 0);
  B.level = levelOf(B, 'Fortress'); B.buildLevel(h.canvas);
  const st = B.bricks.find((b) => b.kind === 'steel');
  const vsSteel = B.newBall(st.x + 4, st.y + 4, 0, 4);
  B.hitBricks(vsSteel, g, true);
  check('pierce does not get through steel', vsSteel.dy < 0);
}
{
  const { h, B } = boot('breakout');
  const g = fakeGame(h);
  B.level = levelOf(B, 'Wall'); B.buildLevel(h.canvas);
  B.combo = 0; B.fever = false;
  const plain = B.bricks.filter((b) => b.kind === 'normal');
  for (let i = 0; i < B.FEVER_AT - 1; i++) B.damageBrick(plain[i], g, plain[i].x, true);
  check('no fever below the threshold', !B.fever, `combo=${B.combo}`);
  const before = g.score;
  B.damageBrick(plain[B.FEVER_AT - 1], g, 0, true);
  check('fever lights at the threshold', B.fever);
  check('fever doubles the points', g.score - before === (10 + (B.combo - 1) * 5) * 2);
}

// ------------------------------------------------------------------ the wall
{
  const { h, B } = boot('breakout');
  const g = fakeGame(h);
  const y0 = B.bricks[0].y;
  B.descendAt = h.nowMs() - 1;
  B.stepDescent(g, h.canvas, h.nowMs());
  check('the wall steps down on its clock', B.bricks[0].y === y0 + B.DESCEND_STEP);
  check('the clock rearms', B.descendAt > h.nowMs());
}
{
  const { h, B } = boot('breakout');
  const g = fakeGame(h);
  B.bricks.forEach((b) => { b.y = B.dangerY(h.canvas) - 4; });
  B.descendAt = h.nowMs() - 1;
  B.stepDescent(g, h.canvas, h.nowMs());
  check('the wall reaching the paddle ends the run', g.over === 'Overrun!');
}
{
  const { h, B } = boot('breakout');
  const before = B.descendAt;
  B.onResume(5000);
  check('pausing does not advance the wall', B.descendAt === before + 5000);
}

// ----------------------------------------------------------------- mutators
{
  const { h, B } = boot('breakout');
  check('levels 1 and 2 are played straight', (() => {
    for (let t = 0; t < 40; t++) {
      B.level = 1; B.buildLevel(h.canvas); if (B.mutator) return false;
      B.level = 2; B.buildLevel(h.canvas); if (B.mutator) return false;
    }
    return true;
  })());
  const seen = new Set();
  for (let t = 0; t < 400; t++) { B.level = 5; B.buildLevel(h.canvas); if (B.mutator) seen.add(B.mutator.key); }
  check('every mutator can turn up', seen.size === B.MUTATORS.length,
        `${seen.size}/${B.MUTATORS.length}: ${[...seen].join(',')}`);
}
{
  const { h, B } = boot('breakout');
  // IRON toughens, BRITTLE flattens — check each against a plain build.
  B.level = 3;
  const grab = (key) => {
    for (let t = 0; t < 400; t++) { B.buildLevel(h.canvas); if (B.mutator && B.mutator.key === key) return true; }
    return false;
  };
  check('IRON raises hit points', grab('iron') &&
        B.bricks.filter((b) => b.kind === 'normal').every((b) => b.hp >= 2));
  check('BRITTLE makes everything one hit', grab('brittle') &&
        B.bricks.filter((b) => b.kind !== 'steel').every((b) => b.hp === 1));
}
{
  const { h, B } = boot('breakout');
  B.level = 3;
  for (let t = 0; t < 400; t++) { B.buildLevel(h.canvas); if (B.mutator && B.mutator.key === 'drift') break; }
  if (B.mutator && B.mutator.key === 'drift') {
    const x0 = B.bricks.map((b) => b.x);
    for (let i = 0; i < 120; i++) B.stepDrift();
    const moved = B.bricks.some((b, i) => Math.abs(b.x - x0[i]) > 1);
    const inside = B.bricks.every((b) => b.x > -1 && b.x + b.w < h.canvas.width + 1);
    check('DRIFT slides the wall', moved);
    check('DRIFT keeps the wall on the board', inside);
  } else {
    check('DRIFT slides the wall', false, 'never rolled');
  }
}
{
  const { h, B } = boot('breakout');
  B.level = 3;
  for (let t = 0; t < 400; t++) { B.buildLevel(h.canvas); if (B.mutator && B.mutator.key === 'frenzy') break; }
  const withF = B.dropChance();
  B.mutator = null;
  check('FRENZY raises the drop rate', withF > B.dropChance(), `${withF.toFixed(2)} vs ${B.dropChance().toFixed(2)}`);
}
{
  const { h, B } = boot('breakout');
  B.mutator = { key: 'gale' };
  check('GALE pushes the ball sideways', B.galeAccel() > 0);
  const g = fakeGame(h);
  B.bricks.forEach((b) => { b.hp = 0; });
  const ball = B.newBall(320, 300, 0, -6);
  B.balls = [ball];
  for (let i = 0; i < 30; i++) B.stepBalls(h.canvas, g, h.nowMs());
  check('GALE actually bends the trajectory', Math.abs(ball.dx) > 0.2, `dx=${ball.dx.toFixed(2)}`);
  B.mutator = null;
}

// ------------------------------------------------------------- the autopilot
{
  const { h, B } = boot('breakout', true);
  check('the effect-aware bestCapsule is the live one', B.bestCapsule.length === 6,
        `arity ${B.bestCapsule.length}`);
  const now = h.nowMs();
  B.lives = 1;
  const rivals = ['M', 'L', 'P', 'W', 'S', 'N'].map((t) => B.capsuleValue(t, now));
  check('a life outranks all else on the last one', B.capsuleValue('H', now) > Math.max(...rivals));
  B.lives = 5;
  check('...and is cheap when stocked up', B.capsuleValue('H', now) < B.capsuleValue('M', now));
  B.effects.wide = true;
  check('a wide capsule is discounted while wide', B.capsuleValue('W', now) < 6);
  B.effects.net = 3;
  check('a third net is not worth chasing', B.capsuleValue('N', now) < 6);
}
{
  // Clear-rate capsules should be worth less as the board empties.
  const { h, B } = boot('breakout', true);
  const now = h.nowMs();
  const full = B.capsuleValue('M', now);
  B.bricks.forEach((b, i) => { if (i > 2) b.hp = 0; });
  check('multi is worth less on a nearly-clear board', B.capsuleValue('M', now) < full * 0.5,
        `${full.toFixed(0)} -> ${B.capsuleValue('M', now).toFixed(0)}`);
}
{
  // An unreachable ball must not drag the paddle off a savable one.
  const { h, B } = boot('breakout', true);
  B.bricks.forEach((b) => { b.hp = 0; });
  B.powerups = [];
  B.paddle.width = B.BASE_W;
  B.paddle.x = (640 - B.BASE_W) / 2;
  const c0 = B.paddle.x + B.paddle.width / 2;
  B.balls = [B.newBall(40, 414, 0, 8), B.newBall(380, 214, 0, 4)];
  B.autoPlay({ canvas: h.canvas });
  check('it covers the savable ball, not the lost one', B.paddle.x + B.paddle.width / 2 > c0,
        `moved ${(B.paddle.x + B.paddle.width / 2 - c0).toFixed(1)}px`);
}
{
  const { h, B } = boot('breakout', true);
  B.bricks.forEach((b) => { b.hp = 0; });
  B.balls = [];
  B.paddle.x = (640 - B.BASE_W) / 2;
  const c0 = B.paddle.x + B.paddle.width / 2;
  B.powerups = [{ x: c0 - 18, y: 200, w: 36, h: 17, vy: 2.3, type: 'X' }];
  check('bestCapsule refuses hazards', B.bestCapsule(h.canvas, Infinity, null, c0, 15, h.nowMs()) === null);
  B.autoPlay({ canvas: h.canvas });
  check('it sidesteps a falling hazard', Math.abs(B.paddle.x + B.paddle.width / 2 - c0) > 0);
}
{
  const { h, B } = boot('breakout', true);
  B.bricks.forEach((b) => { b.hp = 0; });
  B.balls = [];
  B.paddle.x = (640 - B.BASE_W) / 2;
  const c0 = B.paddle.x + B.paddle.width / 2;
  B.powerups = [{ x: 480, y: 200, w: 36, h: 17, vy: 2.3, type: 'M' }];
  B.autoPlay({ canvas: h.canvas });
  check('it still collects a safe capsule', B.paddle.x + B.paddle.width / 2 > c0);
}
{
  // Value beats proximity.
  const { h, B } = boot('breakout', true);
  const now = h.nowMs();
  B.lives = 1; B.effects.wide = true;
  B.powerups = [
    { x: 300, y: 300, w: 36, h: 17, vy: 2.3, type: 'W' },
    { x: 380, y: 260, w: 36, h: 17, vy: 2.3, type: 'H' }
  ];
  check('it chases the valuable capsule, not the nearest',
        B.bestCapsule(h.canvas, Infinity, null, 320, 15, now) > 360);
}
{
  // A net buys risk tolerance.
  const { h, B } = boot('breakout', true);
  const now = h.nowMs();
  B.powerups = [{ x: 560, y: 300, w: 36, h: 17, vy: 2.3, type: 'M' }];
  B.effects.net = 0;
  const strict = B.bestCapsule(h.canvas, 40, 320, 320, 15, now);
  B.effects.net = 2;
  const loose = B.bestCapsule(h.canvas, 40, 320, 320, 15, now);
  check('a net makes it willing to gamble', strict === null && loose !== null);
}
{
  const { h, B } = boot('breakout', true);
  const now = h.nowMs();
  B.bricks.forEach((b) => { b.hp = 0; });
  B.bricks.filter((b) => b.x > 400).slice(0, 12).forEach((b) => { b.hp = 1; b.kind = 'normal'; });
  B.effects.pierceUntil = now + 5000;
  check('pierce aims at the densest stack',
        Math.abs(B.aimGoal(h.canvas, now, 320) - B.densestX(h.canvas)) < 1);
}
{
  const { h, B } = boot('breakout', true);
  const now = h.nowMs();
  B.balls = []; B.powerups = [];
  B.bricks.forEach((b) => { b.hp = 0; });
  B.bricks.filter((b) => b.x > 430).slice(0, 10).forEach((b) => { b.hp = 1; b.kind = 'normal'; });
  B.effects.laserUntil = now + 8000;
  B.paddle.x = 20;
  B.autoPlay({ canvas: h.canvas });
  check('with the laser up it parks under the wall', B.paddle.x > 20);
}
{
  // The tunnel: cheapest column, never steel, and off once the board thins.
  const { h, B } = boot('breakout', true);
  B.level = levelOf(B, 'Wall'); B.buildLevel(h.canvas);
  const victim = 3;
  let kept = false;
  B.bricks.forEach((b) => {
    if (b.col !== victim) return;
    if (kept) b.hp = 0; else { b.hp = 1; kept = true; }
  });
  const goal = B.tunnelGoal(h.canvas);
  const target = B.bricks.find((b) => b.col === victim && b.hp > 0);
  check('the tunnel picks the cheapest column',
        goal !== null && Math.abs(goal - (target.x + target.w / 2)) < B.config.brickWidth,
        `goal ${goal && goal.toFixed(0)}`);

  B.level = levelOf(B, 'Gauntlet'); B.buildLevel(h.canvas);
  const g2 = B.tunnelGoal(h.canvas);
  const steelCols = new Set(B.bricks.filter((b) => b.kind === 'steel').map((b) => b.col));
  const chosen = B.bricks.find((b) => Math.abs((b.x + b.w / 2) - g2) < 1);
  check('the tunnel never picks a steel column',
        g2 === null || !chosen || !steelCols.has(chosen.col));

  B.level = levelOf(B, 'Wall'); B.buildLevel(h.canvas);
  let n = 0;
  const keep = Math.floor(B.initialBricks * 0.3);
  B.bricks.forEach((b) => { if (b.kind !== 'steel' && n++ >= keep) b.hp = 0; });
  check('the tunnel disengages once the board thins',
        B.aimGoal(h.canvas, h.nowMs(), 320) !== B.tunnelGoal(h.canvas));
}
{
  // The shot planner: it should prefer standing where the shot breaks more.
  const { h, B } = boot('breakout', true);
  const now = h.nowMs();
  B.level = levelOf(B, 'Wall'); B.buildLevel(h.canvas);
  B.bricks.forEach((b) => { b.hp = 0; });
  // A single tall stack on the right; a shot sent right must score better.
  B.bricks.filter((b) => b.col >= 8).forEach((b) => { b.hp = 1; b.kind = 'normal'; });
  const arrival = { t: 60, x: 320, v: 8 };
  const left = B.scoreShot(h.canvas, arrival, 200, now);
  const right = B.scoreShot(h.canvas, arrival, 440, now);
  check('the planner scores shots by what they actually break', left !== right,
        `standing left ${left}, right ${right}`);
  B._planX = null;
  const chosen = B.plannedShot(h.canvas, arrival, 320, 20, now);
  check('the planner returns a reachable standing point',
        chosen !== null && Math.abs(chosen - 320) <= 20 * 60 + 1, `chose ${chosen && chosen.toFixed(0)}`);
}
{
  // Planning must not run every frame — it is a forward simulation.
  const { h, B } = boot('breakout', true);
  const now = h.nowMs();
  const arrival = { t: 60, x: 320, v: 8 };
  B._planX = null; B.tick = 0;
  let calls = 0;
  const real = B.scoreShot.bind(B);
  B.scoreShot = (...a) => { calls++; return real(...a); };
  B.plannedShot(h.canvas, arrival, 320, 20, now);
  const first = calls;
  B.plannedShot(h.canvas, arrival, 320, 20, now);
  check('planning is cached between replans', calls === first, `${first} sims, then ${calls - first} more`);
  B.tick += B.REPLAN_EVERY;
  B.plannedShot(h.canvas, arrival, 320, 20, now);
  check('planning refreshes on its cadence', calls > first);
}

// --------------------------------------------------- keyboard, pause, S key
{
  const { h, B } = boot('dino', true);
  h.document.key('keydown', 's');
  check('S turns the autopilot off', !h.btn('autoToggle').className.includes('is-on'));
  const D = h.win.__arcade.DinoGame;
  h.document.key('keydown', 's'); h.step(3);
  check('S still ducks once the autopilot is off', D.ducking && D.dino.height === D.DUCK_H);
}
{
  const { h } = boot('breakout', true);
  h.step(200);
  const a = score(h);
  h.document.key('keydown', 'p'); h.step(400);
  check('P freezes the game', a === score(h));
  h.document.key('keydown', 'p'); h.step(600);
  check('P resumes it', score(h) > a);
}
{
  // Game keys must not scroll the page out from under the board.
  const { h } = boot('dino');
  const pressed = (k, code, target) => h.document.key('keydown', k, code, target).defaultPrevented;
  check('space is swallowed while playing', pressed(' ', 'Space'));
  check('arrows are swallowed while playing', pressed('ArrowUp') && pressed('ArrowDown'));
  check('unrelated keys pass through', !pressed('q'));
  check('arrows still work in the game picker',
        !pressed('ArrowDown', 'ArrowDown', { tagName: 'SELECT' }));
  h.win.exitGame();
  check('nothing is swallowed once the arcade is closed',
        !pressed(' ', 'Space') && !pressed('ArrowUp'));
}

// ------------------------------------------------------------- entry + touch
{
  const h = run({ hash: '#arcade' });
  check('#arcade opens the arcade', h.els['hidden-game'].style.display === 'flex');
}
{
  const h = run();
  h.els['hidden-game'].style.display = 'none';
  const timers = [];
  h.win.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  h.brand.dispatch('touchstart');
  const lp = timers.find((t) => t.ms === 600);
  check('a long-press on the site name is armed', !!lp);
  if (lp) lp.fn();
  check('the long-press opens the arcade', h.els['hidden-game'].style.display === 'flex');
}
{
  const h = run();
  h.els['hidden-game'].style.display = 'none';
  h.win.setTimeout = (fn, ms) => 0;
  h.brand.dispatch('touchstart');
  h.brand.dispatch('touchmove');
  h.brand.dispatch('touchend');
  check('scrolling over the site name does not open it',
        h.els['hidden-game'].style.display === 'none');
}
{
  const h = run({ touch: false });
  check('the touch pad is hidden on a fine pointer', h.pad() && h.pad().hidden === true);
}
{
  const { h } = (() => {
    const hh = run({ touch: true });
    hh.els['gameSelect'].value = 'dino';
    hh.win.startGame();
    return { h: hh };
  })();
  const pad = h.pad();
  check('the touch pad shows on a coarse pointer', pad && pad.hidden === false);
  check('the dino pad is jump/duck/pause', pad.children.map((c) => c.textContent).join('') === '⬆⬇⏸');
  const D = h.win.__arcade.DinoGame;
  const duck = pad.children.find((c) => c.textContent === '⬇');
  duck.dispatch('touchstart'); h.step(3);
  check('touch DUCK actually ducks', D.ducking && D.dino.height === D.DUCK_H);
  duck.dispatch('touchend'); h.step(3);
  check('releasing DUCK stands back up', !D.ducking && D.dino.height === D.STAND_H);
}
{
  const h = run({ touch: true });
  h.els['gameSelect'].value = 'snake';
  h.win.startGame();
  check('the snake pad is a four-way plus pause',
        h.pad().children.map((c) => c.textContent).join('') === '⬅⬆⬇➡⏸');
  const S = h.win.__arcade.SnakeGame;
  h.pad().children.find((c) => c.textContent === '⬆').dispatch('touchstart');
  check('the touch pad turns the snake', S.nextDir.x === 0 && S.nextDir.y === -1);
}
{
  const h = run({ touch: true });
  h.els['gameSelect'].value = 'snake';
  h.win.startGame();
  h.btn('autoToggle').dispatch('click');
  const S = h.win.__arcade.SnakeGame;
  h.step(5, 130);
  const before = JSON.stringify(S.nextDir);
  h.pad().children.forEach((c) => { if (c.textContent !== '⏸') c.dispatch('touchstart'); });
  check('the pad is inert while the autopilot drives', JSON.stringify(S.nextDir) === before);
}
{
  const buzzes = [];
  const h = run({ touch: true, vibrate: (p) => buzzes.push(p) });
  h.els['gameSelect'].value = 'dino';
  h.win.startGame();
  h.pad().children[0].dispatch('touchstart');
  check('touch buttons buzz where vibrate exists', buzzes.length > 0);
  let threw = false;
  const h2 = run({ touch: true, vibrate: null });
  h2.els['gameSelect'].value = 'dino';
  h2.win.startGame();
  try { h2.pad().children[0].dispatch('touchstart'); h2.step(5); } catch (e) { threw = true; }
  check('no vibrate support is a silent no-op', !threw);
}

// ------------------------------------------------------ all three still play
{
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const { h, B } = boot('breakout', true);
    const ran = h.step(20000);
    runs.push({ alive: ran === 20000, level: B.level, score: score(h) });
  }
  const alive = runs.filter((r) => r.alive).length;
  const levels = runs.map((r) => r.level).sort((a, b) => a - b);
  check('the autopilot survives most long breakout runs', alive >= 4, `${alive}/5`);
  check('and gets deep into the layout set', levels[2] >= 8, `levels ${levels.join(',')}`);
}
{
  const { h } = boot('dino', true);
  check('the dino autopilot survives 20000 frames', h.step(20000) === 20000);
}
{
  const { h, A } = boot('snake', true);
  const ran = h.step(2000, 130);
  check('the snake autopilot survives 2000 steps', ran === 2000,
        `len ${A.SnakeGame.snake.length}`);
}

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? '  ok  ' : ' FAIL '} ${r.name}${r.detail ? '   [' + r.detail + ']' : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
