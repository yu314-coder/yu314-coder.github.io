// Headless harness for the hidden arcade in assets/js/main.js.
//
// The games can't be exercised in a browser tab that isn't focused —
// requestAnimationFrame is parked and timers are clamped — so this stubs just
// enough DOM and canvas to run the real game loop deterministically, one frame
// at a time. It loads the shipped file unmodified apart from one injected line
// that hoists the closure's objects out for inspection.
//
//   node tests/arcade.test.js
//
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = process.env.MAIN_JS ||
  path.join(__dirname, '..', 'assets', 'js', 'main.js');

function makeCtx() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  return new Proxy({
    canvas: null,
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: [] }),
    save: noop, restore: noop, setTransform: noop
  }, {
    get(t, k) { return k in t ? t[k] : noop; },
    set(t, k, v) { t[k] = v; return true; }
  });
}

function makeEl(id, tag) {
  const listeners = [];
  const el = {
    id, tagName: (tag || 'div').toUpperCase(),
    style: {}, dataset: {}, value: '', textContent: '', className: '',
    hidden: false, children: [], parentNode: null,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); el.className = [...this._s].join(' '); },
      remove(c) { this._s.delete(c); el.className = [...this._s].join(' '); },
      toggle(c, on) { on ? this.add(c) : this.remove(c); },
      contains(c) { return this._s.has(c); }
    },
    _listeners: listeners,
    addEventListener(type, fn, opts) {
      listeners.push({ type, fn, capture: !!(opts === true || (opts && opts.capture)) });
    },
    removeEventListener(type, fn) {
      const i = listeners.findIndex(l => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatch(type, ev) {
      const e = Object.assign({ type, cancelable: true, preventDefault() {}, stopPropagation() {} }, ev || {});
      listeners.filter(l => l.type === type).forEach(l => l.fn(e));
      return e;
    },
    appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
    insertBefore(c) { el.children.push(c); c.parentNode = el; return c; },
    setAttribute() {}, getAttribute() { return null; },
    blur() {}, focus() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }),
    getContext: () => el._ctx || (el._ctx = makeCtx())
  };
  // Real DOM drops the subtree on innerHTML = ''; the touch pad rebuild relies
  // on that, so the stub has to honour it.
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return html; },
    set(v) { html = String(v); if (!html) el.children.length = 0; }
  });
  return el;
}

function install(opts) {
  opts = opts || {};
  const els = {};
  const mk = (id, tag) => (els[id] = makeEl(id, tag));

  const canvas = mk('gameCanvas', 'canvas');
  canvas.width = 640; canvas.height = 480;
  mk('gameControls'); mk('gameSelect', 'select'); mk('scoreDisplay'); mk('gameHint');
  mk('hidden-game'); mk('hidden-admin'); mk('visitorCount'); mk('visitLogs');
  els['gameSelect'].value = 'breakout';
  els['hidden-game'].style.display = 'flex';

  const stage = makeEl('gameStage');
  [canvas, els['scoreDisplay'], els['gameHint']].forEach(e => { e.parentNode = stage; });

  const brand = makeEl('', 'a');
  brand.className = 'navbar-brand';

  const docListeners = [];
  const document = {
    readyState: 'complete',
    body: makeEl('body'),
    getElementById: (id) => els[id] || null,
    querySelector: (sel) => (sel === '.navbar-brand' ? brand : null),
    querySelectorAll: () => [],
    createElement: (tag) => makeEl('', tag),
    addEventListener(type, fn, o) {
      docListeners.push({ type, fn, capture: !!(o === true || (o && o.capture)) });
    },
    removeEventListener(type, fn) {
      const i = docListeners.findIndex(l => l.type === type && l.fn === fn);
      if (i >= 0) docListeners.splice(i, 1);
    },
    // Capture listeners run first and stopPropagation halts the rest — the
    // mechanism the S key and the scroll suppression both depend on.
    key(type, key, code, target) {
      let stopped = false;
      const ev = {
        key, code: code || '', type, cancelable: true, target: target || null,
        defaultPrevented: false,
        stopPropagation() { stopped = true; },
        stopImmediatePropagation() { stopped = true; },
        preventDefault() { ev.defaultPrevented = true; }
      };
      for (const l of docListeners.filter(l => l.type === type && l.capture)) {
        l.fn(ev); if (stopped) return ev;
      }
      for (const l of docListeners.filter(l => l.type === type && !l.capture)) {
        l.fn(ev); if (stopped) return ev;
      }
      return ev;
    },
    fire(type) { docListeners.filter(l => l.type === type).forEach(l => l.fn({ type })); }
  };

  const queue = [];
  let now = 0;
  const win = {
    document,
    innerWidth: 1280,
    screen: { width: 1280 },
    addEventListener() {},
    requestAnimationFrame(cb) { queue.push(cb); return queue.length; },
    performance: { now: () => now },
    localStorage: (() => {
      const m = {};
      return {
        getItem: (k) => (k in m ? m[k] : null),
        setItem: (k, v) => { m[k] = String(v); },
        removeItem: (k) => { delete m[k]; }
      };
    })(),
    navigator: { userAgent: 'node', maxTouchPoints: opts.touch ? 5 : 0, vibrate: opts.vibrate || null },
    location: { hash: opts.hash || '', pathname: '/', search: '' },
    history: { replaceState() {} },
    matchMedia: (q) => ({ matches: !!opts.touch && /coarse/.test(q), media: q, addListener() {}, removeListener() {} }),
    fetch: () => Promise.reject(new Error('offline')),
    console,
    setTimeout: () => 0,          // the autopilot restart timer never auto-fires
    clearTimeout: () => {}
  };

  return {
    win, document, els, canvas, brand, stage,
    step(n, dtMs) {
      dtMs = dtMs === undefined ? 16 : dtMs;
      for (let i = 0; i < n; i++) {
        now += dtMs;
        const batch = queue.splice(0, queue.length);
        if (!batch.length) return i;      // the loop stopped: game over
        batch.forEach(cb => cb(now));
      }
      return n;
    },
    frames() { return queue.length; },
    nowMs() { return now; },
    pad() { return this.stage.children.find(c => c.id === 'gameTouch'); },
    bests() { return this.stage.children.find(c => c.id === 'gameBests'); },
    btn(id) { return this.els['gameControls'].children.find(c => c.id === id); }
  };
}

function run(opts) {
  const h = install(opts);
  // Test-only: hoist the closure's objects out. Injected here, never shipped.
  const code = fs.readFileSync(SRC, 'utf8').replace(
    "  document.addEventListener('DOMContentLoaded', function() {",
    "  window.__arcade = { GameSystem, Breakout, DinoGame, SnakeGame, Haptics, HighScores, Difficulty };\n" +
    "  document.addEventListener('DOMContentLoaded', function() {"
  );
  const sandbox = h.win;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'main.js' });
  h.document.fire('DOMContentLoaded');
  h.els['gameControls'].children.forEach((c) => { if (c.id) h.els[c.id] = c; });
  return h;
}

const score = (h) => {
  const m = /Score: (\d+)/.exec(h.els['scoreDisplay'].textContent || '');
  return m ? Number(m[1]) : 0;
};

module.exports = { run, score };
