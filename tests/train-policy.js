#!/usr/bin/env node
// Reinforcement learning for the tiny conv policy that chooses WHERE to send
// the ball. Cross-Entropy Method: sample a population of policies from a
// Gaussian, keep the best few, refit the Gaussian to them, repeat.
//
// CEM rather than a policy gradient because of what the reward actually is.
// The return is "how far did the whole run get" -- an episodic score over
// thousands of stochastic collisions and level transitions. There is no
// differentiable path from a weight to that number, and inventing a
// differentiable surrogate would mean optimising something other than the
// thing we care about. CEM optimises the real return directly, and with 176
// weights the population it needs is small.
//
// The hard part here is not the algorithm, it is the noise. Two seeds of the
// SAME policy score 7195 and 21035 -- a 3x spread -- so a naive search happily
// "improves" by finding a lucky seed. Three things keep it honest:
//
//   common random numbers  every candidate in a generation is scored on the
//                          SAME seeds, so a generation compares policies
//                          rather than luck
//   many seeds             the mean over N seeds x 4 tiers is the fitness, not
//                          any single run
//   a held-out gate        the winner is re-scored on seeds never used in
//                          training, against the hand-written heuristic, and
//                          is only shipped if it wins there by a clear margin
//
// The heuristic is a strong incumbent. A first attempt at this beat it by 27%
// on a 2-seed "held-out" set and then lost on every tier when measured
// properly, which is exactly the failure this gate exists to catch.
//
//   node tests/train-policy.js --gens 12 --pop 16 --seeds 10
const fs = require('fs');
const path = require('path');
const { run, score } = require('./arcade-harness');

const OUT = path.join(__dirname, '..', 'assets', 'js', 'arcade-policy.json');
const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};
const GENS = arg('gens', 8);
const POP = arg('pop', 12);
const ELITE = Math.max(2, Math.round(POP * 0.25));
const SEEDS = arg('seeds', 8);
const FRAMES = arg('frames', 6000);
const MARGIN = arg('margin', 1.05);          // must beat the incumbent by 5%
const TIERS = ['baby', 'easy', 'normal', 'hard'];

// Shapes come from the policy itself, so widening what it observes does not
// silently train the wrong number of weights.
let NK = 0, NO = 0, NS = 0, DIM = 0;
(function () {
  const h = run({});
  const n = h.win.__arcade.ConvPolicy.sizes();
  NK = n.nk; NO = n.no; NS = n.ns; DIM = NK + NO + NS;
})();

function mulberry(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rnd = mulberry(20260807);
// Box-Muller, so the population is actually Gaussian rather than uniform.
function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const toWeights = (vec) => ({ k: Array.from(vec.slice(0, NK)),
                              o: Array.from(vec.slice(NK, NK + NO)),
                              s: Array.from(vec.slice(NK + NO)) });

function episode(weights, tier, seed) {
  const h = run({});
  const A = h.win.__arcade;
  h.win.Math = Object.create(Math);
  h.win.Math.random = mulberry(seed);        // verified reproducible
  A.ConvPolicy.fetched = true;               // never touch the network
  if (weights) A.ConvPolicy.load(weights); else A.ConvPolicy.weights = null;
  A.Difficulty.setIndestructible(false);
  A.Difficulty.set(tier);
  h.els['gameSelect'].value = 'breakout';
  h.win.startGame();
  h.btn('autoToggle').dispatch('click');
  for (let i = 0; i < FRAMES; i++) if (h.step(1, 16) === 0) break;
  return A.Breakout.level * 1000 + score(h);
}
const fitness = (weights, seeds) => {
  let t = 0;
  for (const s of seeds) for (const tier of TIERS) t += episode(weights, tier, s);
  return t / (seeds.length * TIERS.length);
};

function main() {
  const trainSeeds = Array.from({ length: SEEDS }, (_, i) => 1000 + i * 7);
  const heldSeeds = Array.from({ length: SEEDS }, (_, i) => 90000 + i * 13);

  let incumbent = null;
  if (fs.existsSync(OUT)) {
    try { incumbent = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {}
  }
  const label = incumbent ? 'shipped policy' : 'hand-written heuristic';
  const baseHeld = fitness(incumbent, heldSeeds);
  console.log(`  incumbent (${label}): ${baseHeld.toFixed(0)} held-out`);
  console.log(`  CEM: ${GENS} generations x ${POP} policies, ${SEEDS} seeds x ${TIERS.length} tiers each`);

  let mu = new Float64Array(DIM);            // start at zero = no preference
  let sigma = new Float64Array(DIM).fill(0.6);
  let best = null, bestFit = -Infinity;

  for (let gen = 1; gen <= GENS; gen++) {
    const pop = [];
    for (let i = 0; i < POP; i++) {
      const v = new Float64Array(DIM);
      for (let d = 0; d < DIM; d++) v[d] = mu[d] + sigma[d] * gauss();
      pop.push(v);
    }
    // Common random numbers: one seed set for the whole generation, so the
    // ranking reflects the policies and not which of them drew an easy board.
    const seeds = trainSeeds.map((s) => s + gen * 101);
    const scored = pop.map((v) => ({ v, f: fitness(toWeights(v), seeds) }));
    scored.sort((a, b) => b.f - a.f);
    const elites = scored.slice(0, ELITE);

    for (let d = 0; d < DIM; d++) {
      let m = 0;
      for (const e of elites) m += e.v[d];
      m /= ELITE;
      let s2 = 0;
      for (const e of elites) s2 += (e.v[d] - m) ** 2;
      mu[d] = m;
      sigma[d] = Math.max(0.05, Math.sqrt(s2 / ELITE));   // never fully collapse
    }
    if (elites[0].f > bestFit) { bestFit = elites[0].f; best = toWeights(elites[0].v); }
    console.log(`  gen ${String(gen).padStart(2)}: best ${elites[0].f.toFixed(0)}  elite mean ` +
      `${(elites.reduce((a, e) => a + e.f, 0) / ELITE).toFixed(0)}  sigma ` +
      `${(sigma.reduce((a, b) => a + b, 0) / DIM).toFixed(3)}`);
  }

  if (!best) { console.log('  no candidate produced'); return 0; }

  const held = fitness(best, heldSeeds);
  console.log(`  held-out: candidate ${held.toFixed(0)}  vs incumbent ${baseHeld.toFixed(0)}  ` +
    `(needs ${(baseHeld * MARGIN).toFixed(0)})`);
  if (held < baseHeld * MARGIN) {
    console.log('  the incumbent is still better on seeds it was not trained on; not shipping');
    return 0;
  }
  fs.writeFileSync(OUT, JSON.stringify({
    note: 'Tiny conv policy for breakout target selection, trained by CEM in tests/train-policy.js.',
    generations: GENS, population: POP, seeds: SEEDS, frames: FRAMES,
    train_fitness: Math.round(bestFit), held_fitness: Math.round(held),
    held_incumbent: Math.round(baseHeld),
    k: best.k.map((v) => Number(v.toFixed(5))),
    o: best.o.map((v) => Number(v.toFixed(5))),
    s: best.s.map((v) => Number(v.toFixed(5)))
  }) + '\n');
  console.log(`  shipped: ${held.toFixed(0)} beats ${baseHeld.toFixed(0)} on held-out seeds`);
  return 0;
}
process.exit(main());
