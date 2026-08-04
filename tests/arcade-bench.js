// Paired A/B for the Breakout autopilot.
//
//   node tests/arcade-bench.js <runs> <fileA> <fileB>
//
// Runs both builds alternately inside one process, swapping which goes first
// each iteration, so drift and ordering hit them equally. Two non-interleaved
// 40-run batches once produced flatly contradictory results, which is why this
// exists: single-batch comparisons of this game are not trustworthy.
const path = require('path');
const { run, score } = require('./arcade-harness');

const N = Number(process.argv[2] || 60);
const FRAMES = 12000;
const A = process.argv[3] || path.join(__dirname, 'baseline-main.js');
const B = process.argv[4] || path.join(__dirname, '..', 'assets', 'js', 'main.js');

function once(src) {
  process.env.MAIN_JS = src;
  const h = run();
  h.els['gameSelect'].value = 'breakout';
  h.win.startGame();
  const Bk = h.win.__arcade.Breakout;
  h.btn('autoToggle').dispatch('click');
  const ran = h.step(FRAMES);
  return { lvl: Bk.level, sc: score(h), alive: ran === FRAMES };
}

const out = { a: [], b: [] };
for (let i = 0; i < N; i++) {
  if (i % 2 === 0) { out.a.push(once(A)); out.b.push(once(B)); }
  else { out.b.push(once(B)); out.a.push(once(A)); }
}

function stat(rs, label) {
  const n = rs.length;
  const mean = (f) => rs.reduce((s, r) => s + f(r), 0) / n;
  const sd = (f) => {
    const m = mean(f);
    return Math.sqrt(rs.reduce((s, r) => s + (f(r) - m) ** 2, 0) / (n - 1));
  };
  const o = { l: mean((r) => r.lvl), s: mean((r) => r.sc),
              ls: sd((r) => r.lvl) / Math.sqrt(n), ss: sd((r) => r.sc) / Math.sqrt(n) };
  console.log(`${label}  n=${n} alive ${rs.filter((r) => r.alive).length}  ` +
    `level ${o.l.toFixed(2)}±${o.ls.toFixed(2)}  score ${Math.round(o.s)}±${Math.round(o.ss)}`);
  return o;
}

const a = stat(out.a, 'A');
const b = stat(out.b, 'B');
const dl = b.l - a.l, dls = Math.sqrt(a.ls ** 2 + b.ls ** 2);
const ds = b.s - a.s, dss = Math.sqrt(a.ss ** 2 + b.ss ** 2);
console.log(`delta  level ${dl >= 0 ? '+' : ''}${dl.toFixed(2)} (${(dl / dls).toFixed(1)}σ)   ` +
            `score ${ds >= 0 ? '+' : ''}${Math.round(ds)} (${(ds / dss).toFixed(1)}σ)`);
