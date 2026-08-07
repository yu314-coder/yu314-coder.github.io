#!/usr/bin/env node
// How well does the autopilot actually play, right now?
//
// The suite proves the rules hold; it says nothing about whether the bot is
// any good. Those come apart easily: every mechanic added to the board -- guns,
// seekers, mines, self-repair, a wall that shoots in pairs -- is a change the
// bot has to cope with, and a green suite is perfectly compatible with the bot
// quietly getting worse at the game.
//
// So this measures play and prints a table, and fails only against a floor
// rather than against the last number. Medians of a stochastic player wander a
// few percent between runs; a threshold tight enough to catch that would cry
// wolf every time and be ignored, which is worse than not checking.
//
//   node tests/bench-autopilot.js --runs 9 --floor 4
const { run, score } = require('./arcade-harness');

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};
const RUNS = arg('runs', 9);
const FRAMES = arg('frames', 9000);
const FLOOR = arg('floor', 4);          // median level that must still be reached
const TIERS = ['baby', 'easy', 'normal', 'hard'];

function one(tier, indestructible) {
  const h = run({});
  const A = h.win.__arcade;
  A.ConvPolicy.fetched = true;          // never reach for the network in CI
  A.Difficulty.setIndestructible(indestructible);
  A.Difficulty.set(tier);
  h.els['gameSelect'].value = 'breakout';
  h.win.startGame();
  h.btn('autoToggle').dispatch('click');
  let lvl = 1, start = A.Breakout.bricksLeft(), best = start, broke = 0;
  for (let i = 0; i < FRAMES; i++) {
    if (h.step(1, 16) === 0) break;
    if (A.Breakout.level > lvl) { broke += start; lvl = A.Breakout.level; start = A.Breakout.bricksLeft(); best = start; }
    const l = A.Breakout.bricksLeft();
    if (l < best) best = l;
  }
  return { level: A.Breakout.level, score: score(h), broke: broke + (start - best) };
}
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

let failed = 0;
const rows = [];
for (const ind of [false, true]) {
  for (const tier of TIERS) {
    const rs = Array.from({ length: RUNS }, () => one(tier, ind));
    const lvl = med(rs.map((r) => r.level));
    const sc = med(rs.map((r) => r.score));
    const br = med(rs.map((r) => r.broke));
    const cleared = rs.filter((r) => r.level > 1).length;
    // The buried board is a different game and a much harder one; finishing a
    // single board there is the bar, not reaching level four.
    const bar = ind ? 2 : FLOOR;
    const ok = ind ? cleared >= Math.ceil(RUNS / 2) : lvl >= bar;
    if (!ok) failed++;
    rows.push({ board: ind ? 'indestructible' : 'ordinary', tier, lvl, sc, br, cleared, ok });
  }
}

console.log('');
console.log('  board           tier    level   score   broke   cleared   ');
for (const r of rows) {
  console.log(`  ${r.board.padEnd(15)} ${r.tier.padEnd(6)} ${String(r.lvl).padStart(5)} ` +
    `${String(r.sc).padStart(7)} ${String(r.br).padStart(7)}   ${String(r.cleared).padStart(2)}/${RUNS}    ` +
    `${r.ok ? 'ok' : 'BELOW FLOOR'}`);
}
console.log('');
console.log(`  medians of ${RUNS} runs a row, ${FRAMES} frames each`);
if (failed) {
  console.log(`  ${failed} row(s) under the floor -- the autopilot has got worse at the game`);
}
process.exit(failed ? 1 : 0);
