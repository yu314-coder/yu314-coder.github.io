// ===================================
// Main JavaScript for Portfolio Site
// ===================================

(function() {
  'use strict';

  // ===================================
  // Navbar Scroll Effect
  // ===================================
  window.addEventListener('scroll', function() {
    const navbar = document.querySelector('.navbar');
    if (navbar) {
      if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    }
  });

  // ===================================
  // Admin Panel: Visitor Tracking
  // ===================================
  const AdminPanel = {
    init: function() {
      this.recordVisit();
      this.setupAdminSequence();
    },

    recordVisit: function() {
      fetch('https://www.cloudflare.com/cdn-cgi/trace')
        .then(response => response.text())
        .then(data => {
          const ipMatch = data.match(/ip=([^\n]+)/);
          const ip = ipMatch ? ipMatch[1] : 'Unavailable';
          const now = new Date().toLocaleString();
          this.saveVisitLog(ip, now);
        })
        .catch(() => {
          const now = new Date().toLocaleString();
          this.saveVisitLog('Privacy Protected', now);
        });
    },

    saveVisitLog: function(ip, time) {
      try {
        let logs = JSON.parse(localStorage.getItem('visitLogs') || '[]');
        logs.push({ ip: ip, time: time });
        if (logs.length > 100) {
          logs = logs.slice(-100);
        }
        localStorage.setItem('visitLogs', JSON.stringify(logs));
        this.updateAdminPanel();
      } catch (e) {
        console.error('Error saving visit log:', e);
      }
    },

    updateAdminPanel: function() {
      const visitorCountEl = document.getElementById('visitorCount');
      const visitLogsEl = document.getElementById('visitLogs');

      if (!visitorCountEl || !visitLogsEl) return;

      try {
        const logs = JSON.parse(localStorage.getItem('visitLogs') || '[]');
        visitorCountEl.textContent = logs.length;

        visitLogsEl.innerHTML = '';
        logs.slice().reverse().forEach(log => {
          const li = document.createElement('li');
          li.textContent = `IP: ${log.ip} - Time: ${log.time}`;
          visitLogsEl.appendChild(li);
        });
      } catch (e) {
        console.error('Error updating admin panel:', e);
      }
    },

    setupAdminSequence: function() {
      let adminSequence = [];
      const secretAdminSequence = ['a', 'd', 'm', 'i', 'n'];

      document.addEventListener('keydown', (event) => {
        adminSequence.push(event.key.toLowerCase());
        if (adminSequence.length > secretAdminSequence.length) {
          adminSequence.shift();
        }
        if (secretAdminSequence.every((l, i) => l === adminSequence[i])) {
          document.getElementById('hidden-admin').style.display = 'block';
          this.updateAdminPanel();
        }
      });
    }
  };

  window.clearLogs = function() {
    if (confirm('Are you sure you want to clear all visit logs?')) {
      localStorage.removeItem('visitLogs');
      AdminPanel.updateAdminPanel();
    }
  };

  window.exitAdmin = function() {
    document.getElementById('hidden-admin').style.display = 'none';
  };

  // ===================================
  // Arcade: High Score Persistence
  // ===================================
  const HighScores = {
    KEY: 'arcadeHighScores',

    all: function() {
      try {
        return JSON.parse(localStorage.getItem(this.KEY) || '{}');
      } catch (e) {
        return {};
      }
    },

    get: function(game) {
      return this.all()[game] || 0;
    },

    submit: function(game, score) {
      const scores = this.all();
      if (score > (scores[game] || 0)) {
        scores[game] = score;
        try { localStorage.setItem(this.KEY, JSON.stringify(scores)); } catch (e) {}
        return true;
      }
      return false;
    }
  };

  // ===================================
  // Arcade: Synthesized Sound Effects (WebAudio, no assets)
  // ===================================
  const SFX = {
    ctx: null,
    muted: (function() { try { return localStorage.getItem('arcadeMuted') === '1'; } catch (e) { return false; } })(),

    ensure: function() {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    beep: function(freq, dur, type, vol, slideTo) {
      if (this.muted) return;
      this.ensure();
      if (!this.ctx) return;
      dur = dur || 0.08; type = type || 'square'; vol = vol || 0.12;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    },

    seq: function(notes, type, vol, step) {
      step = step || 0.09;
      notes.forEach((f, i) => setTimeout(() => this.beep(f, step * 0.9, type || 'square', vol || 0.1), i * step * 1000));
    },

    toggle: function() {
      this.muted = !this.muted;
      try { localStorage.setItem('arcadeMuted', this.muted ? '1' : '0'); } catch (e) {}
      return this.muted;
    },

    // Named events
    brick: function(combo) { this.beep(300 + Math.min(combo, 10) * 45, 0.06, 'square', 0.1); },
    paddle: function() { this.beep(180, 0.05, 'sine', 0.1); },
    powerup: function() { this.seq([523, 659, 784], 'triangle', 0.12, 0.07); },
    lifeLost: function() { this.beep(220, 0.3, 'sawtooth', 0.1, 70); },
    levelUp: function() { this.seq([392, 523, 659, 784], 'square', 0.1, 0.08); },
    jump: function() { this.beep(380, 0.12, 'square', 0.08, 640); },
    duck: function() { this.beep(200, 0.05, 'sine', 0.06); },
    milestone: function() { this.seq([660, 880], 'triangle', 0.1, 0.07); },
    eat: function(len) { this.beep(380 + Math.min(len, 30) * 10, 0.06, 'triangle', 0.12); },
    bonus: function() { this.seq([700, 900, 1150], 'triangle', 0.13, 0.06); },
    gameOver: function() { this.seq([330, 262, 196], 'sawtooth', 0.09, 0.12); },
    highScore: function() { this.seq([523, 659, 784, 1046], 'triangle', 0.12, 0.1); }
  };

  // ===================================
  // Arcade: Haptics
  // Phones have no speaker cue worth relying on and iOS Safari ignores
  // navigator.vibrate entirely, so every call here is best-effort and silent
  // when unsupported.
  // ===================================
  const Haptics = {
    on: (function() { try { return localStorage.getItem('arcadeHaptics') !== '0'; } catch (e) { return true; } })(),
    fire: function(pattern) {
      if (!this.on || !navigator.vibrate) return;
      try { navigator.vibrate(pattern); } catch (e) {}
    },
    tap:   function() { this.fire(10); },
    power: function() { this.fire([12, 26, 12]); },
    over:  function() { this.fire([40, 55, 90]); }
  };

  // ===================================
  // Arcade: Particles + Floating Score Text
  // ===================================
  const Fx = {
    parts: [],
    texts: [],

    reset: function() { this.parts = []; this.texts = []; },

    burst: function(x, y, color, n, spread) {
      n = n || 10; spread = spread || 2.6;
      for (let i = 0; i < n; i++) {
        this.parts.push({
          x: x, y: y,
          dx: (Math.random() - 0.5) * spread * 2,
          dy: (Math.random() - 0.5) * spread * 2 - 0.8,
          life: 1,
          decay: 0.03 + Math.random() * 0.025,
          color: color,
          size: 2 + Math.random() * 2.5
        });
      }
      if (this.parts.length > 240) this.parts.splice(0, this.parts.length - 240);
    },

    text: function(x, y, str, color) {
      this.texts.push({ x: x, y: y, str: str, color: color || '#fff', life: 1 });
      if (this.texts.length > 14) this.texts.shift();
    },

    updateDraw: function(ctx) {
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const p = this.parts[i];
        p.x += p.dx; p.y += p.dy; p.dy += 0.06;
        p.life -= p.decay;
        if (p.life <= 0) { this.parts.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      for (let i = this.texts.length - 1; i >= 0; i--) {
        const t = this.texts[i];
        t.y -= 0.8; t.life -= 0.022;
        if (t.life <= 0) { this.texts.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, t.life);
        ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = t.color;
        ctx.fillText(t.str, t.x, t.y);
      }
      ctx.globalAlpha = 1;
    }
  };

  // ===================================
  // Easter Egg Game System
  //
  // Three games behind the "easter" sequence. Two cross-cutting features live
  // here rather than in each game: P pauses, and the autopilot hands the
  // controls to a per-game algorithm (each game exposes autoPlay()). S gives
  // control back — it's captured before the games see it, so Dino's duck and
  // Snake's WASD-down keep working whenever the autopilot is off.
  // ===================================
  const GameSystem = {
    canvas: null,
    ctx: null,
    gameActive: false,
    paused: false,
    auto: false,
    currentGame: 'breakout',
    score: 0,
    games: {},
    restartHandlersBound: false,
    loopId: 0,
    shakeFrames: 0,
    shakeTotal: 1,
    shakeMag: 0,
    pausedAt: 0,
    pausePainted: false,
    autoRestartTimer: null,

    HINTS: {
      breakout: 'Arrows / mouse / drag — 10 boards · ? = mystery, KEY clears a row · dodge the red capsules · the wall creeps down',
      dino: 'Space/⬆️ jump (twice for a double-jump) · ⬇️ duck — grab 🪙 and 🛡️',
      snake: 'Arrows / WASD / swipe — edges wrap around · gold +50 · ✂️ trims your tail'
    },

    // Same games, described in the gestures a phone actually has.
    TOUCH_HINTS: {
      breakout: 'Drag or hold ⬅ ➡ — 10 boards · ? = mystery, KEY clears a row · dodge the red capsules · the wall creeps down',
      dino: 'Tap to jump, tap again to double-jump · hold ⬇ to duck — grab 🪙 and 🛡️',
      snake: 'Swipe or use the pad — edges wrap around · gold +50 · ✂️ trims your tail'
    },

    touchPad: null,
    bestsEl: null,

    // Keys the three games consume. Held here rather than in each game so the
    // page-scroll suppression can't drift out of sync with the bindings.
    PLAY_KEYS: new Set([' ', 'spacebar', 'arrowup', 'arrowdown', 'arrowleft',
                        'arrowright', 'w', 'a', 's', 'd']),

    // Coarse pointer => show the on-screen pad. Checked live rather than cached
    // so a hybrid laptop that gets touched mid-session still gets it.
    isTouch: function() {
      return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
             ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    },

    init: function() {
      this.canvas = document.getElementById('gameCanvas');
      if (!this.canvas) return;

      this.ctx = this.canvas.getContext('2d');
      this.games = { breakout: Breakout, dino: DinoGame, snake: SnakeGame };
      this.setupGameSequence();
      this.setupControls();
      this.setupPointer();
      this.injectMuteButton();
      this.injectAutoButton();
      this.injectTouchPad();
      this.injectBests();
      this.setupSystemKeys();
      this.setupMobileEntry();
      this.refreshMeta();
    },

    setupGameSequence: function() {
      let keySequence = [];
      const secretGameSequence = ['e', 'a', 's', 't', 'e', 'r'];

      document.addEventListener('keydown', (event) => {
        keySequence.push(event.key.toLowerCase());
        if (keySequence.length > secretGameSequence.length) {
          keySequence.shift();
        }
        if (secretGameSequence.every((l, i) => l === keySequence[i])) {
          this.openArcade();
        }
        if (event.key === 'Escape') {
          const g = document.getElementById('hidden-game');
          const a = document.getElementById('hidden-admin');
          if (g && g.style.display !== 'none' && g.style.display !== '') window.exitGame();
          if (a && a.style.display !== 'none' && a.style.display !== '') window.exitAdmin();
        }
      });
    },

    // Capture phase, so S reaches the autopilot before the games' own keydown
    // listeners (Dino ducks on S, Snake turns down on S). Only swallowed while
    // the autopilot is actually running.
    setupSystemKeys: function() {
      document.addEventListener('keydown', (e) => {
        if (!this.overlayVisible()) return;
        const k = (e.key || '').toLowerCase();

        if (k === 's' && this.auto) {
          e.stopPropagation();
          e.preventDefault();
          this.setAuto(false);
          return;
        }
        if (k === 'p' && this.gameActive) {
          e.stopPropagation();
          e.preventDefault();
          this.togglePause();
          return;
        }

        // While the arcade is open its keys belong to the game, not the page.
        // Space and the arrows were still scrolling the overlay underneath —
        // jumping in Dino scrolled the board out from under you.
        if (!this.PLAY_KEYS.has(k) && e.code !== 'Space') return;
        const tag = e.target && e.target.tagName;
        // ...except in the controls, where arrows pick a game and space clicks.
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
        e.preventDefault();
      }, true);
    },

    overlayVisible: function() {
      const o = document.getElementById('hidden-game');
      return !!o && o.style.display !== 'none' && o.style.display !== '';
    },

    openArcade: function() {
      const g = document.getElementById('hidden-game');
      if (!g) return false;
      g.style.display = 'flex';
      this.refreshMeta();
      this.refreshBests();
      return true;
    },

    // Typing "easter" needs a keyboard, which is exactly what a phone hasn't
    // got — so the arcade was desktop-only in practice. Two keyboard-free ways
    // in: the #arcade hash (shareable, works anywhere) and a long-press on the
    // site name in the navbar.
    setupMobileEntry: function() {
      const fromHash = () => {
        if ((location.hash || '').toLowerCase() === '#arcade') this.openArcade();
      };
      window.addEventListener('hashchange', fromHash);
      fromHash();

      const brand = document.querySelector('.navbar-brand');
      if (!brand) return;
      let timer = null, fired = false;
      const start = () => {
        fired = false;
        clearTimeout(timer);
        timer = setTimeout(() => {
          fired = true;
          Haptics.power();
          this.openArcade();
        }, 600);
      };
      const cancel = () => clearTimeout(timer);
      brand.addEventListener('touchstart', start, { passive: true });
      brand.addEventListener('touchmove', cancel, { passive: true });
      brand.addEventListener('touchcancel', cancel, { passive: true });
      brand.addEventListener('touchend', (e) => {
        cancel();
        if (fired && e.cancelable) e.preventDefault();   // don't also follow the link
      }, { passive: false });
      brand.addEventListener('mousedown', start);
      brand.addEventListener('mouseup', cancel);
      brand.addEventListener('mouseleave', cancel);
      brand.addEventListener('click', (e) => {
        if (fired) { e.preventDefault(); fired = false; }
      });
    },

    // --- On-screen controls ---------------------------------------------
    // Touch had no duck (so Dino's head-height pterodactyls were undodgeable
    // on a phone) and no pause. The pad supplies both, per game.
    injectTouchPad: function() {
      if (document.getElementById('gameTouch')) return;
      const pad = document.createElement('div');
      pad.id = 'gameTouch';
      pad.setAttribute('role', 'group');
      pad.setAttribute('aria-label', 'Touch controls');
      this.canvas.parentNode.insertBefore(pad, this.canvas.nextSibling);
      this.touchPad = pad;
      this.buildTouchPad();
    },

    padButton: function(label, aria, onDown, onUp, always) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tp-btn';
      b.textContent = label;
      b.setAttribute('aria-label', aria);
      const down = (e) => {
        if (e.cancelable) e.preventDefault();       // no scroll, no double-tap zoom
        if (!always && (!this.gameActive || this.paused || this.auto)) return;
        b.classList.add('is-down');
        Haptics.tap();
        onDown();
      };
      const up = (e) => {
        if (e && e.cancelable) e.preventDefault();
        b.classList.remove('is-down');
        if (onUp) onUp();
      };
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
      b.addEventListener('mousedown', down);
      b.addEventListener('mouseup', up);
      b.addEventListener('mouseleave', up);
      return b;
    },

    buildTouchPad: function() {
      const pad = this.touchPad;
      if (!pad) return;
      pad.innerHTML = '';
      pad.hidden = !this.isTouch();

      if (this.currentGame === 'dino') {
        pad.appendChild(this.padButton('⬆', 'Jump', () => DinoGame.doJump()));
        pad.appendChild(this.padButton('⬇', 'Duck and fast-fall',
          () => { DinoGame.downPressed = true; },
          () => { DinoGame.downPressed = false; }));
      } else if (this.currentGame === 'snake') {
        pad.appendChild(this.padButton('⬅', 'Turn left',  () => SnakeGame.turn(-1, 0)));
        pad.appendChild(this.padButton('⬆', 'Turn up',    () => SnakeGame.turn(0, -1)));
        pad.appendChild(this.padButton('⬇', 'Turn down',  () => SnakeGame.turn(0, 1)));
        pad.appendChild(this.padButton('➡', 'Turn right', () => SnakeGame.turn(1, 0)));
      } else {
        pad.appendChild(this.padButton('⬅', 'Move paddle left',
          () => { Breakout.leftPressed = true; }, () => { Breakout.leftPressed = false; }));
        pad.appendChild(this.padButton('➡', 'Move paddle right',
          () => { Breakout.rightPressed = true; }, () => { Breakout.rightPressed = false; }));
      }

      // Pause stays live while paused (it's the only way back) and while the
      // autopilot is driving, so it skips the usual input guard.
      const pause = this.padButton('⏸', 'Pause or resume',
        () => { if (this.gameActive) this.togglePause(); }, null, true);
      pause.classList.add('tp-btn--wide');
      pad.appendChild(pause);
    },

    injectBests: function() {
      if (document.getElementById('gameBests')) return;
      const hint = document.getElementById('gameHint');
      if (!hint || !hint.parentNode) return;
      const el = document.createElement('p');
      el.id = 'gameBests';
      hint.parentNode.insertBefore(el, hint);
      this.bestsEl = el;
      this.refreshBests();
    },

    refreshBests: function() {
      const el = this.bestsEl || document.getElementById('gameBests');
      if (!el) return;
      const names = { breakout: 'Breakout', dino: 'Dino', snake: 'Snake' };
      el.textContent = '🏆 ' + Object.keys(names)
        .map((k) => names[k] + ' ' + HighScores.get(k)).join('   ·   ');
    },

    setupControls: function() {
      const gameSelect = document.getElementById('gameSelect');
      if (gameSelect) {
        gameSelect.addEventListener('change', (e) => {
          this.currentGame = e.target.value;
          this.buildTouchPad();
          this.refreshMeta();
        });
      }
    },

    injectMuteButton: function() {
      const controls = document.getElementById('gameControls');
      if (!controls || document.getElementById('sfxToggle')) return;
      const b = document.createElement('button');
      b.id = 'sfxToggle';
      b.type = 'button';
      b.title = 'Toggle sound effects';
      b.textContent = SFX.muted ? '🔇' : '🔊';
      b.addEventListener('click', () => {
        b.textContent = SFX.toggle() ? '🔇' : '🔊';
        if (!SFX.muted) SFX.beep(523, 0.07, 'triangle', 0.1);
      });
      controls.appendChild(b);
    },

    injectAutoButton: function() {
      const controls = document.getElementById('gameControls');
      if (!controls || document.getElementById('autoToggle')) return;
      const b = document.createElement('button');
      b.id = 'autoToggle';
      b.type = 'button';
      b.title = 'Let the algorithm play — press S to take back control';
      b.textContent = '🤖 Autopilot';
      b.addEventListener('click', () => {
        this.setAuto(!this.auto);
        b.blur(); // otherwise Space would re-trigger the button, not restart
      });
      controls.appendChild(b);
    },

    setAuto: function(on) {
      this.auto = !!on;
      const b = document.getElementById('autoToggle');
      if (b) {
        b.textContent = this.auto ? '🤖 Autopilot ON — S stops' : '🤖 Autopilot';
        b.classList.toggle('is-on', this.auto);
      }
      if (!this.auto) {
        clearTimeout(this.autoRestartTimer);
        // Drop any control state the algorithm was holding down.
        const g = this.games[this.currentGame];
        if (g && g.releaseControls) g.releaseControls();
      }
      if (this.gameActive) {
        SFX.beep(this.auto ? 660 : 330, 0.09, 'triangle', 0.1);
        Fx.text(this.canvas.width / 2, 70,
          this.auto ? '🤖 ALGORITHM TAKING OVER' : '🎮 YOU HAVE CONTROL',
          this.auto ? '#fbbf24' : '#22d3ee');
      }
      this.refreshMeta();
    },

    togglePause: function() {
      this.paused = !this.paused;
      if (this.paused) {
        this.pausedAt = performance.now();
      } else {
        const elapsed = performance.now() - this.pausedAt;
        const g = this.games[this.currentGame];
        if (g && g.onResume) g.onResume(elapsed);
        this.pausePainted = false;
      }
      SFX.beep(this.paused ? 300 : 500, 0.07, 'sine', 0.09);
    },

    refreshMeta: function() {
      const hintEl = document.getElementById('gameHint');
      if (hintEl) {
        const touch = this.isTouch();
        const base = (touch ? this.TOUCH_HINTS : this.HINTS)[this.currentGame] || '';
        hintEl.textContent = base + (touch
          ? ' · ⏸ pauses · 🤖 autopilot plays for you, tap it again to take over'
          : ' · P pauses · 🤖 autopilot plays for you, S takes over');
      }
      this.refreshBests();
      this.updateScore(this.score);
    },

    shake: function(mag, frames) {
      this.shakeMag = mag || 6;
      this.shakeFrames = frames || 12;
      this.shakeTotal = this.shakeFrames;
    },

    startGame: function() {
      const select = document.getElementById('gameSelect');
      this.currentGame = select ? select.value : 'breakout';
      clearTimeout(this.autoRestartTimer);
      this.gameActive = true;
      this.paused = false;
      this.pausePainted = false;
      this.score = 0;
      this.shakeFrames = 0;
      Fx.reset();

      const game = this.games[this.currentGame];
      if (game) game.init(this);

      this.buildTouchPad();
      this.refreshMeta();
      this.loopId++;
      this.gameLoop(this.loopId);
    },

    gameLoop: function(id, ts) {
      if (!this.gameActive || id !== this.loopId) return;

      if (this.paused) {
        if (!this.pausePainted) { this.drawPaused(); this.pausePainted = true; }
        requestAnimationFrame((t) => this.gameLoop(id, t));
        return;
      }

      const game = this.games[this.currentGame];
      if (game) {
        const now = ts || performance.now();
        if (this.auto && game.autoPlay) game.autoPlay(this, now);
        if (game.update) game.update(this, now);
        // update() may have ended the game — don't erase the game-over screen
        if (!this.gameActive) return;

        const ctx = this.ctx, canvas = this.canvas;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        if (this.shakeFrames > 0) {
          this.shakeFrames--;
          const m = this.shakeMag * (this.shakeFrames / this.shakeTotal);
          ctx.translate((Math.random() - 0.5) * 2 * m, (Math.random() - 0.5) * 2 * m);
        }
        game.draw(this);
        Fx.updateDraw(ctx);
        ctx.restore();

        // A game may also end inside draw() (Breakout) — overlay already painted
        if (!this.gameActive) return;
        this.drawAutoDot();
      }

      requestAnimationFrame((t) => this.gameLoop(id, t));
    },

    // Deliberately tiny and hard-cornered: every game already uses the top
    // strip for its own HUD, so the on-canvas cue stays out of the way and the
    // button carries the wording.
    drawAutoDot: function() {
      if (!this.auto) return;
      const ctx = this.ctx;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(performance.now() / 260);
      ctx.beginPath();
      ctx.arc(this.canvas.width - 9, 9, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fbbf24';
      ctx.fill();
      ctx.restore();
    },

    drawPaused: function() {
      const ctx = this.ctx, canvas = this.canvas;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgba(5, 8, 22, 0.72)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = 'center';
      ctx.font = 'bold 32px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText('⏸ Paused', canvas.width / 2, canvas.height / 2 - 6);
      ctx.font = '17px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('Press P to resume', canvas.width / 2, canvas.height / 2 + 28);
      ctx.restore();
    },

    showGameOver: function(message) {
      this.gameActive = false;
      const ctx = this.ctx;
      const canvas = this.canvas;
      const isRecord = HighScores.submit(this.currentGame, this.score);
      this.updateScore(this.score);

      if (isRecord && this.score > 0) SFX.highScore(); else SFX.gameOver();
      Haptics.over();
      this.refreshBests();

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0); // ignore any active shake transform
      ctx.fillStyle = 'rgba(5, 8, 22, 0.82)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.textAlign = 'center';
      ctx.font = 'bold 34px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(message, canvas.width / 2, canvas.height / 2 - 40);

      ctx.font = '22px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#22d3ee';
      ctx.fillText(`Score: ${this.score}`, canvas.width / 2, canvas.height / 2);

      if (isRecord && this.score > 0) {
        ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText('🏆 NEW HIGH SCORE!', canvas.width / 2, canvas.height / 2 + 34);
      } else {
        ctx.font = '17px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#a5b4fc';
        ctx.fillText(`Best: ${HighScores.get(this.currentGame)}`, canvas.width / 2, canvas.height / 2 + 32);
      }

      ctx.font = '17px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(this.auto ? '🤖 Autopilot restarting…  ·  S to take over'
                             : 'Space · Click · Tap to restart',
                   canvas.width / 2, canvas.height / 2 + 70);
      ctx.restore();

      // The autopilot is meant to be watched, so it picks itself back up.
      if (this.auto) {
        clearTimeout(this.autoRestartTimer);
        this.autoRestartTimer = setTimeout(() => {
          if (this.auto && this.overlayVisible() && !this.gameActive) this.startGame();
        }, 1800);
      }

      if (!this.restartHandlersBound) {
        this.restartHandlersBound = true;
        const tryRestart = () => {
          if (this.overlayVisible() && !this.gameActive) this.startGame();
        };
        this.canvas.addEventListener('click', tryRestart);
        this.canvas.addEventListener('touchstart', tryRestart, { passive: true });
        document.addEventListener('keydown', (e) => {
          if (e.code === 'Space') tryRestart();
        });
      }
    },

    setupPointer: function() {
      const canvas = this.canvas;
      const pos = (clientX) => {
        const rect = canvas.getBoundingClientRect();
        return (clientX - rect.left) * (canvas.width / rect.width);
      };

      canvas.addEventListener('mousemove', (e) => {
        if (!this.gameActive || this.auto || this.paused) return;
        const game = this.games[this.currentGame];
        if (game.onPointerMove) game.onPointerMove(pos(e.clientX), this);
      });

      canvas.addEventListener('touchmove', (e) => {
        if (!this.gameActive || this.auto || this.paused) return;
        const game = this.games[this.currentGame];
        if (game.onPointerMove) {
          e.preventDefault();
          game.onPointerMove(pos(e.touches[0].clientX), this);
        }
      }, { passive: false });

      const tap = () => {
        if (!this.gameActive || this.auto || this.paused) return;
        const game = this.games[this.currentGame];
        if (game.onTap) game.onTap(this);
      };
      canvas.addEventListener('mousedown', tap);
      canvas.addEventListener('touchstart', (e) => {
        if (!this.gameActive || this.auto || this.paused) return;
        const game = this.games[this.currentGame];
        if (game.onSwipeStart) game.onSwipeStart(e.touches[0].clientX, e.touches[0].clientY);
        tap();
      }, { passive: true });
      canvas.addEventListener('touchend', (e) => {
        if (!this.gameActive || this.auto || this.paused) return;
        const game = this.games[this.currentGame];
        if (game.onSwipeEnd && e.changedTouches.length) {
          game.onSwipeEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
        }
      }, { passive: true });
    },

    updateScore: function(newScore) {
      this.score = newScore;
      const scoreEl = document.getElementById('scoreDisplay');
      if (scoreEl) {
        scoreEl.textContent = `Score: ${this.score} · Best: ${HighScores.get(this.currentGame)}`;
      }
    }
  };

  // ===================================
  // Breakout — power-ups, multi-ball, lasers, safety net, combos, levels
  // ===================================
  const Breakout = {
    balls: [],
    bolts: [],
    paddle: null,
    bricks: [],
    powerups: [],
    rightPressed: false,
    leftPressed: false,
    lives: 3,
    level: 1,
    layoutName: '',
    cols: 11,
    initialBricks: 0,
    // Tunnel only while at least this fraction of the board is still up;
    // digging a channel through a nearly-cleared board is wasted effort.
    TUNNEL_UNTIL: 0.55,
    speed: 6.5,
    fever: false,
    combo: 0,
    levelFlash: 0,
    tick: 0,
    netFlash: 0,
    effects: { wide: false, slowUntil: 0, laserUntil: 0, pierceUntil: 0, shrinkUntil: 0, rushUntil: 0, net: 0 },
    BASE_W: 104,
    WIDE_W: 184,
    SHRINK_W: 68,
    MAX_SPEED: 18,
    // A frame at top speed covers more than a brick's height, so movement is
    // sub-stepped at this granularity — otherwise a fast ball tunnels straight
    // through bricks it should have broken.
    SUBSTEP: 6,
    // How far off-centre the autopilot will stand to steer the bounce, as a
    // fraction of paddle width. The paddle edge gives the sharpest angle, so
    // higher means more aggressive aiming and a faster clear -- at the cost of
    // less margin on the catch. Swept empirically; see the commit message.
    AIM_AUTHORITY: 0.55,
    // Eight bricks without touching the paddle and the board catches fire.
    FEVER_AT: 8,
    // The wall creeps down, so a level is a race rather than an open-ended
    // rally. Generous first grace period, then steady pressure.
    DESCEND_FIRST: 26000,
    DESCEND_EVERY: 15000,
    DESCEND_STEP: 22,
    descendAt: 0,
    descendFlash: 0,
    HAZARD: { X: true, R: true },
    keyDownHandler: null,
    keyUpHandler: null,
    config: {
      brickWidth: 48,
      brickHeight: 18,
      brickPadding: 6,
      brickOffsetTop: 44
    },

    // Hand-drawn levels, cycled in order. Every level used to be the same 5x7
    // wall with more hardened rows, which is the least interesting knob there
    // is. One character per brick:
    //   .  empty        1/2/3  hit points
    //   X  steel — never breaks, never blocks completion
    //   *  explosive — takes its neighbours with it, and chains
    //   ?  mystery — unknown payoff, mostly good, occasionally not
    //   K  keystone — collapses the whole row it sits in
    LAYOUTS: [
      { name: 'Wall', rows: [
        '11111111111',
        '1111?1?1111',
        '22222222222',
        '11111111111',
        '11111111111'
      ] },
      { name: 'Pyramid', rows: [
        '.....3.....',
        '....3?3....',
        '...32223...',
        '..3222223..',
        '.311111113.'
      ] },
      { name: 'Checkers', rows: [
        '1.2.1.2.1.2',
        '.2.1.2.1.2.',
        '2.1.K.1.2.1',
        '.1.2.1.2.1.',
        '1.2.1.2.1.2'
      ] },
      { name: 'Fortress', rows: [
        'X111111111X',
        'X1*22?22*1X',
        'X111111111X',
        '.XX11111XX.',
        '...1K1K1...'
      ] },
      { name: 'Arch', rows: [
        '..1111111..',
        '.113333311.',
        '11332*23311',
        '11...?...11',
        '11.......11'
      ] },
      { name: 'Rain', rows: [
        '2.2.2.2.2.2',
        '1.1.1.1.1.1',
        '.....?.....',
        '3.3.3.3.3.3',
        '1.1.1.1.1.1'
      ] },
      { name: 'Diamond', rows: [
        '.....2.....',
        '...22?22...',
        '.1122*2211.',
        '...22K22...',
        '.....2.....'
      ] },
      { name: 'Gauntlet', rows: [
        'X1X1X1X1X1X',
        '1?1213121?1',
        'X1X1K1X1X1X',
        '12221*22221',
        '.111111111.'
      ] },
      { name: 'Hive', rows: [
        '.2.2.2.2.2.',
        '2?2323232?2',
        '.2.2*K*2.2.',
        '23212?21232',
        '.1.1.1.1.1.'
      ] },
      { name: 'Vault', rows: [
        'X.X.X.X.X.X',
        '33333333333',
        '2*2*?*2*2*2',
        '33333333333',
        '.1.K.1.K.1.'
      ] }
    ],

    init: function(game) {
      this.lives = 3;
      this.level = 1;
      this.speed = 6.5;
      this.fever = false;
      this.combo = 0;
      this.tick = 0;
      this.netFlash = 0;
      this.powerups = [];
      this.bolts = [];
      this.effects = { wide: false, slowUntil: 0, laserUntil: 0, pierceUntil: 0, shrinkUntil: 0, rushUntil: 0, net: 0 };
      game.updateScore(0);
      this.paddle = {
        width: this.BASE_W,
        height: 12,
        x: (game.canvas.width - this.BASE_W) / 2,
        color: '#22d3ee',
        speed: 11
      };
      this.buildLevel(game.canvas);
      this.resetBalls(game.canvas);

      this.rightPressed = false;
      this.leftPressed = false;

      if (this.keyDownHandler) document.removeEventListener('keydown', this.keyDownHandler);
      if (this.keyUpHandler) document.removeEventListener('keyup', this.keyUpHandler);
      this.keyDownHandler = (e) => this.keyDown(e);
      this.keyUpHandler = (e) => this.keyUp(e);
      document.addEventListener('keydown', this.keyDownHandler);
      document.addEventListener('keyup', this.keyUpHandler);
    },

    releaseControls: function() {
      this.rightPressed = false;
      this.leftPressed = false;
    },

    onResume: function(ms) {
      // Everything time-based has to slide, including the descent clock —
      // otherwise pausing would hand you free progress on the wall.
      ['slowUntil', 'laserUntil', 'pierceUntil', 'shrinkUntil', 'rushUntil'].forEach((k) => {
        if (this.effects[k]) this.effects[k] += ms;
      });
      if (this.descendAt) this.descendAt += ms;
    },

    // Positions are baked in here rather than during draw, so collision no
    // longer depends on drawBricks() having run first this frame.
    buildLevel: function(canvas) {
      const spec = this.LAYOUTS[(this.level - 1) % this.LAYOUTS.length];
      // Once the set has been round-tripped, everything breakable gets tougher.
      const bonus = Math.min(Math.floor((this.level - 1) / this.LAYOUTS.length), 3);
      const cfg = this.config;
      const cols = spec.rows[0].length;
      const gridW = cols * cfg.brickWidth + (cols - 1) * cfg.brickPadding;
      const left = Math.round((canvas.width - gridW) / 2);

      this.layoutName = spec.name;
      this.cols = cols;
      this.bricks = [];
      spec.rows.forEach((line, row) => {
        for (let col = 0; col < line.length; col++) {
          const ch = line[col];
          if (ch === '.') continue;
          const kind = { 'X': 'steel', '*': 'boom', '?': 'mystery', 'K': 'key' }[ch] || 'normal';
          let hp = kind === 'key' ? 2 : 1;
          if (kind === 'normal') hp = Math.min(parseInt(ch, 10) + bonus, 4);
          this.bricks.push({
            col: col, row: row, kind: kind, hp: hp, max: hp,
            x: left + col * (cfg.brickWidth + cfg.brickPadding),
            y: cfg.brickOffsetTop + row * (cfg.brickHeight + cfg.brickPadding),
            w: cfg.brickWidth, h: cfg.brickHeight
          });
        }
      });

      // Only Wide runs to the end of the level (the paddle never shrinks back
      // mid-board); everything else is a countdown.
      this.effects.wide = false;
      this.descendAt = performance.now() + this.DESCEND_FIRST;
      this.descendFlash = 0;
      this.initialBricks = this.bricksLeft();
      this.levelFlash = 90;
    },

    newBall: function(x, y, dx, dy) {
      return { x: x, y: y, dx: dx, dy: dy, radius: 10, color: '#ec4899', trail: [] };
    },

    resetBalls: function(canvas) {
      this.bolts = [];
      this.balls = [ this.newBall(
        canvas.width / 2,
        canvas.height - 60,
        this.speed * (Math.random() < 0.5 ? 1 : -1) * 0.7,
        -this.speed
      ) ];
    },

    keyDown: function(e) {
      if (e.key === 'Right' || e.key === 'ArrowRight') this.rightPressed = true;
      if (e.key === 'Left' || e.key === 'ArrowLeft') this.leftPressed = true;
    },

    keyUp: function(e) {
      if (e.key === 'Right' || e.key === 'ArrowRight') this.rightPressed = false;
      if (e.key === 'Left' || e.key === 'ArrowLeft') this.leftPressed = false;
    },

    onPointerMove: function(x, game) {
      this.paddle.x = Math.max(0, Math.min(game.canvas.width - this.paddle.width, x - this.paddle.width / 2));
    },

    // Steel is scenery, not an objective — it must never gate the level.
    bricksLeft: function() {
      let n = 0;
      for (const b of this.bricks) if (b.kind !== 'steel' && b.hp > 0) n++;
      return n;
    },

    // Capsules are earned by the rally, not by luck alone: the chance climbs
    // with the combo — the run of bricks broken before the ball next touches
    // the paddle — so keeping the ball up top is what showers you with them.
    DROP_BASE: 0.30,
    DROP_PER_COMBO: 0.11,
    DROP_MAX: 0.85,

    dropChance: function() {
      return Math.min(this.DROP_MAX,
        this.DROP_BASE + Math.max(0, this.combo - 1) * this.DROP_PER_COMBO);
    },

    maybeDropPowerup: function(x, y) {
      if (Math.random() > this.dropChance()) return;
      const roll = Math.random();
      let type;
      if (roll < 0.21) type = 'W';        // wide paddle
      else if (roll < 0.40) type = 'S';   // slow ball
      else if (roll < 0.59) type = 'M';   // multi-ball
      else if (roll < 0.67) type = 'P';   // pierce
      else if (roll < 0.74) type = 'L';   // laser paddle
      else if (roll < 0.80) type = 'N';   // safety net
      else if (roll < 0.84) type = 'H';   // extra life
      else if (roll < 0.93) type = 'X';   // HAZARD: shrink the paddle
      else type = 'R';                    // HAZARD: rush the ball
      this.powerups.push({ x: x, y: y, w: 36, h: 17, vy: 2.3, type: type });
    },

    applyPowerup: function(p, game) {
      const now = performance.now();
      SFX.powerup();
      Haptics.power();
      Fx.burst(p.x + p.w / 2, p.y, '#fbbf24', 14, 3);
      if (p.type === 'W') {
        this.effects.wide = true;
        Fx.text(p.x + p.w / 2, p.y - 6, 'WIDE!', '#22d3ee');
      } else if (p.type === 'S') {
        this.effects.slowUntil = now + 9000;
        Fx.text(p.x + p.w / 2, p.y - 6, 'SLOW', '#fbbf24');
      } else if (p.type === 'M') {
        const src = this.balls[0] || this.newBall(p.x, p.y - 40, 2, -this.speed);
        const v = Math.hypot(src.dx, src.dy) || this.speed;
        this.balls.push(this.newBall(src.x, src.y, v * 0.6, -Math.abs(v * 0.8)));
        this.balls.push(this.newBall(src.x, src.y, -v * 0.6, -Math.abs(v * 0.8)));
        if (this.balls.length > 7) this.balls.length = 7;
        Fx.text(p.x + p.w / 2, p.y - 6, 'MULTI!', '#a855f7');
      } else if (p.type === 'P') {
        this.effects.pierceUntil = now + 7000;
        Fx.text(p.x + p.w / 2, p.y - 6, 'PIERCE!', '#f472b6');
      } else if (p.type === 'L') {
        this.effects.laserUntil = now + 11000;
        Fx.text(p.x + p.w / 2, p.y - 6, 'LASER!', '#f97316');
      } else if (p.type === 'N') {
        this.effects.net = Math.min(this.effects.net + 1, 3);
        Fx.text(p.x + p.w / 2, p.y - 6, 'NET', '#4ade80');
      } else if (p.type === 'H') {
        if (this.lives < 6) this.lives++;
        Fx.text(p.x + p.w / 2, p.y - 6, '+1 ❤️', '#ec4899');
      } else if (p.type === 'X') {
        this.effects.shrinkUntil = now + 9000;
        Fx.text(p.x + p.w / 2, p.y - 6, 'SHRUNK!', '#ef4444');
      } else if (p.type === 'R') {
        this.effects.rushUntil = now + 8000;
        Fx.text(p.x + p.w / 2, p.y - 6, 'RUSH!', '#ef4444');
      }
    },

    // Hazards get their own cue — they should feel like a mistake, not a win.
    isHazard: function(type) { return !!this.HAZARD[type]; },

    // One source of truth for ball speed, so the autopilot's predictions and
    // the simulation can't drift apart.
    ballFactor: function(now) {
      let f = 1;
      if (this.effects.slowUntil > now) f *= 0.66;
      if (this.effects.rushUntil > now) f *= 1.35;
      return f;
    },

    draw: function(game) {
      const ctx = game.ctx;
      const canvas = game.canvas;
      const now = performance.now();
      this.tick++;

      // Animate paddle width toward its target
      const targetW = this.effects.shrinkUntil > now ? this.SHRINK_W
                    : (this.effects.wide ? this.WIDE_W : this.BASE_W);
      if (Math.abs(this.paddle.width - targetW) > 1) {
        const cx = this.paddle.x + this.paddle.width / 2;
        this.paddle.width += (targetW - this.paddle.width) * 0.2;
        this.paddle.x = Math.max(0, Math.min(canvas.width - this.paddle.width, cx - this.paddle.width / 2));
      }

      this.drawNet(ctx, canvas);
      this.drawDangerLine(ctx, canvas);
      this.drawBricks(ctx, now);
      this.drawBalls(ctx, now);
      this.drawPaddle(ctx, canvas, now);
      this.fireLasers(canvas, now);
      this.drawBolts(ctx, game);
      this.drawPowerups(ctx, canvas, game);
      this.drawHud(ctx, canvas, now);
      this.stepBalls(canvas, game, now);
      this.movePaddle(canvas);
      this.stepDescent(game, canvas, now);
    },

    dangerY: function(canvas) {
      return canvas.height - this.paddle.height - 4 - 26;
    },

    // The wall steps down on a clock, so a level is a race rather than an
    // open-ended rally. Called at the very end of draw() because it can end
    // the run, and the game-over overlay has to be the last thing painted.
    stepDescent: function(game, canvas, now) {
      if (this.descendFlash > 0) this.descendFlash--;
      if (!this.descendAt || now < this.descendAt) return;
      this.descendAt = now + this.DESCEND_EVERY;
      for (const b of this.bricks) b.y += this.DESCEND_STEP;
      this.descendFlash = 26;
      SFX.beep(120, 0.22, 'sawtooth', 0.11, 70);
      game.shake(5, 10);

      const limit = this.dangerY(canvas);
      for (const b of this.bricks) {
        if (b.hp > 0 && b.kind !== 'steel' && b.y + b.h > limit) {
          game.showGameOver('Overrun!');
          return;
        }
      }
    },

    // Only drawn once the wall is genuinely close, so it means something.
    drawDangerLine: function(ctx, canvas) {
      let lowest = 0;
      for (const b of this.bricks) {
        if (b.hp > 0 && b.kind !== 'steel' && b.y + b.h > lowest) lowest = b.y + b.h;
      }
      const limit = this.dangerY(canvas);
      if (lowest < limit - this.DESCEND_STEP * 3) return;
      ctx.save();
      ctx.globalAlpha = this.descendFlash > 0 ? 0.95 : 0.4 + 0.25 * Math.sin(this.tick / 9);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(0, limit);
      ctx.lineTo(canvas.width, limit);
      ctx.stroke();
      ctx.restore();
    },

    netY: function(canvas) { return canvas.height - 3; },

    drawNet: function(ctx, canvas) {
      if (this.netFlash > 0) this.netFlash--;
      if (this.effects.net <= 0 && this.netFlash <= 0) return;
      const y = this.netY(canvas);
      ctx.save();
      ctx.globalAlpha = this.netFlash > 0 ? 1 : 0.42 + 0.12 * Math.sin(this.tick / 12);
      ctx.strokeStyle = this.netFlash > 0 ? '#fff' : '#4ade80';
      ctx.lineWidth = 3;
      ctx.setLineDash([9, 7]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
      ctx.restore();
    },

    fireLasers: function(canvas, now) {
      if (this.effects.laserUntil <= now) return;
      if (this.tick % 15 !== 0) return;
      const y = canvas.height - this.paddle.height - 8;
      this.bolts.push({ x: this.paddle.x + 8, y: y });
      this.bolts.push({ x: this.paddle.x + this.paddle.width - 8, y: y });
      SFX.beep(880, 0.04, 'square', 0.05, 1400);
    },

    drawBolts: function(ctx, game) {
      for (let i = this.bolts.length - 1; i >= 0; i--) {
        const b = this.bolts[i];
        b.y -= 9;
        if (b.y < -10) { this.bolts.splice(i, 1); continue; }
        const hit = this.boltHitsBrick(b, game);
        // A bolt can take the last brick, and the level reset empties this.bolts
        // out from under us — stop rather than index into the new array.
        if (hit === 'cleared') return;
        if (hit) { this.bolts.splice(i, 1); continue; }
        ctx.fillStyle = '#f97316';
        ctx.fillRect(b.x - 1.5, b.y, 3, 11);
      }
    },

    boltHitsBrick: function(bolt, game) {
      for (const brick of this.bricks) {
        if (brick.hp <= 0) continue;
        if (bolt.x > brick.x && bolt.x < brick.x + brick.w &&
            bolt.y > brick.y && bolt.y < brick.y + brick.h) {
          if (brick.kind === 'steel') return true;   // absorbed, undamaged
          return this.damageBrick(brick, game, bolt.x, false) ? 'cleared' : true;
        }
      }
      return false;
    },

    brickColor: function(b) {
      if (b.kind === 'steel') return '#64748b';
      if (b.kind === 'boom') return '#f97316';
      if (b.kind === 'mystery') return '#fbbf24';
      if (b.kind === 'key') return '#10b981';
      return ['#22d3ee', '#a855f7', '#ec4899', '#f43f5e'][Math.min(b.hp, 4) - 1];
    },

    // Shared by ball hits and laser bolts. Returns true when the level cleared.
    damageBrick: function(b, game, hitX, fromBall) {
      if (b.kind === 'steel') return false;
      b.hp--;

      if (b.hp > 0) {
        SFX.beep(240, 0.05, 'square', 0.09);
        Fx.burst(hitX, b.y + b.h, 'rgba(255,255,255,0.7)', 5, 1.6);
        return false;
      }

      if (fromBall) {
        this.combo++;
        if (this.combo >= this.FEVER_AT && !this.fever) {
          this.fever = true;
          SFX.seq([784, 988, 1319], 'triangle', 0.13, 0.07);
          Fx.text(b.x + b.w / 2, b.y - 10, '🔥 FEVER — DOUBLE POINTS', '#f59e0b');
          game.shake(5, 12);
        }
      }
      const pts = (fromBall ? 10 + (this.combo - 1) * 5 : 10) * (this.fever ? 2 : 1);
      game.updateScore(game.score + pts);
      SFX.brick(fromBall ? this.combo : 1);
      Fx.burst(hitX, b.y + b.h / 2, this.brickColor(b), 12);
      if (fromBall && this.combo >= 2) {
        Fx.text(b.x + b.w / 2, b.y, '+' + pts, '#fbbf24');
      }
      this.maybeDropPowerup(b.x + b.w / 2 - 18, b.y);

      if (b.kind === 'boom') this.explode(b, game);
      else if (b.kind === 'key') this.collapseRow(b, game);
      else if (b.kind === 'mystery') this.rollMystery(b, game);

      return this.checkLevelClear(game);
    },

    // Explosive bricks take their eight neighbours with them and chain through
    // other explosives. Steel shrugs it off, which is what makes the Fortress
    // and Vault layouts hold their shape.
    explode: function(origin, game) {
      game.shake(6, 12);
      const queue = [origin];
      while (queue.length) {
        const src = queue.shift();
        SFX.beep(140, 0.16, 'sawtooth', 0.12, 60);
        Fx.burst(src.x + src.w / 2, src.y + src.h / 2, '#f97316', 18, 3.4);
        for (const n of this.bricks) {
          if (n === src || n.hp <= 0 || n.kind === 'steel') continue;
          if (Math.abs(n.col - src.col) > 1 || Math.abs(n.row - src.row) > 1) continue;
          n.hp = 0;
          game.updateScore(game.score + 15);
          Fx.burst(n.x + n.w / 2, n.y + n.h / 2, this.brickColor(n), 8, 2.4);
          this.maybeDropPowerup(n.x + n.w / 2 - 18, n.y);
          if (n.kind === 'boom') queue.push(n);
        }
      }
    },

    // Keystone: taking it out collapses everything left in its row. It gives
    // the board a target order beyond "whatever the ball happens to reach".
    collapseRow: function(origin, game) {
      game.shake(7, 14);
      SFX.levelUp();
      Fx.text(origin.x + origin.w / 2, origin.y - 6, 'ROW CLEARED', '#10b981');
      for (const n of this.bricks) {
        if (n === origin || n.hp <= 0 || n.kind === 'steel' || n.row !== origin.row) continue;
        n.hp = 0;
        game.updateScore(game.score + 20);
        Fx.burst(n.x + n.w / 2, n.y + n.h / 2, this.brickColor(n), 10, 2.6);
        if (n.kind === 'boom') this.explode(n, game);
      }
    },

    // Mystery: unknown until it breaks. Mostly generous, occasionally not —
    // which is exactly what makes an otherwise ordinary brick worth aiming at.
    rollMystery: function(b, game) {
      const cx = b.x + b.w / 2, cy = b.y;
      const roll = Math.random();
      if (roll < 0.26) {
        game.updateScore(game.score + 150);
        Fx.text(cx, cy - 6, 'JACKPOT +150', '#fbbf24');
        SFX.bonus();
      } else if (roll < 0.50) {
        const src = this.balls[0];
        if (src && this.balls.length < 7) {
          const v = Math.hypot(src.dx, src.dy) || this.speed;
          this.balls.push(this.newBall(src.x, src.y, -src.dx, -Math.abs(v * 0.9)));
        }
        Fx.text(cx, cy - 6, 'EXTRA BALL', '#a855f7');
        SFX.powerup();
      } else if (roll < 0.74) {
        this.powerups.push({ x: cx - 18, y: cy, w: 36, h: 17, vy: 2.3, type: 'M' });
        Fx.text(cx, cy - 6, 'CAPSULE', '#22d3ee');
      } else if (roll < 0.88) {
        this.effects.pierceUntil = performance.now() + 7000;
        Fx.text(cx, cy - 6, 'PIERCE!', '#f472b6');
        SFX.powerup();
      } else {
        // The reason you hesitate before aiming at one.
        this.powerups.push({ x: cx - 18, y: cy, w: 36, h: 17, vy: 2.6,
                             type: Math.random() < 0.5 ? 'X' : 'R' });
        Fx.text(cx, cy - 6, 'UH OH…', '#ef4444');
        SFX.beep(180, 0.18, 'sawtooth', 0.1, 90);
      }
    },

    checkLevelClear: function(game) {
      if (this.bricksLeft() > 0) return false;
      this.level++;
      this.speed = Math.min(this.speed * 1.18, this.MAX_SPEED);
      SFX.levelUp();
      this.buildLevel(game.canvas);
      this.resetBalls(game.canvas);
      this.powerups = [];
      return true;
    },

    drawHud: function(ctx, canvas, now) {
      ctx.font = '16px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#a5b4fc';
      let hud = 'Level ' + this.level + ' · ' + this.layoutName + ' · ' + this.bricksLeft() + ' left';
      ctx.fillText(hud, 12, 24);

      let fx = '';
      if (this.effects.wide) fx += ' 📏';
      if (this.effects.slowUntil > now) fx += ' 🐢';
      if (this.effects.shrinkUntil > now) fx += ' 🤏';
      if (this.effects.rushUntil > now) fx += ' 💨';
      if (this.effects.pierceUntil > now) fx += ' ⚡';
      if (this.effects.laserUntil > now) fx += ' 🔫';
      if (this.effects.net > 0) fx += ' 🕸️×' + this.effects.net;
      ctx.textAlign = 'right';
      ctx.fillText('❤️'.repeat(Math.max(0, this.lives)), canvas.width - 12, 24);

      // Effects live along the bottom. On the top row they collided with the
      // combo readout once a few were stacked up.
      if (fx) {
        ctx.textAlign = 'left';
        ctx.fillText(fx.trim(), 12, canvas.height - 22);
      }

      if (this.combo >= 2) {
        ctx.textAlign = 'center';
        ctx.font = 'bold 17px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = this.fever ? '#f59e0b' : '#fbbf24';
        ctx.fillText(this.fever
          ? '🔥 FEVER ×' + this.combo + ' · 2× pts'
          : 'COMBO ×' + this.combo + ' · ' + Math.round(this.dropChance() * 100) + '% drops',
          canvas.width / 2, 24);
      }

      if (this.levelFlash > 0) {
        this.levelFlash--;
        ctx.globalAlpha = Math.min(1, this.levelFlash / 30);
        ctx.textAlign = 'center';
        ctx.font = 'bold 40px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#a855f7';
        ctx.fillText('LEVEL ' + this.level, canvas.width / 2, canvas.height / 2 - 18);
        ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#22d3ee';
        ctx.fillText(this.layoutName, canvas.width / 2, canvas.height / 2 + 12);
        ctx.globalAlpha = 1;
      }
    },

    drawBricks: function(ctx, now) {
      for (const b of this.bricks) {
        if (b.hp <= 0) continue;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(b.x, b.y, b.w, b.h, 4) : ctx.rect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = this.brickColor(b);
        ctx.fill();

        if (b.kind === 'steel') {
          // Riveted plate — reads as scenery rather than a target.
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          ctx.fillRect(b.x + 3, b.y + 3, b.w - 6, 2);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(b.x + 3, b.y + b.h - 5, b.w - 6, 2);
        } else if (b.kind === 'boom') {
          const pulse = 0.5 + 0.5 * Math.sin(now / 160 + b.col);
          ctx.globalAlpha = 0.45 + 0.55 * pulse;
          ctx.fillStyle = '#fde047';
          ctx.beginPath();
          ctx.arc(b.x + b.w / 2, b.y + b.h / 2, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        } else if (b.kind === 'mystery') {
          ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 220 + b.col * 0.7);
          ctx.fillStyle = '#422006';
          ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('?', b.x + b.w / 2, b.y + b.h - 4);
          ctx.globalAlpha = 1;
        } else if (b.kind === 'key') {
          ctx.fillStyle = '#022c22';
          ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('KEY', b.x + b.w / 2, b.y + b.h - 5);
          if (b.hp < b.max) {
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(b.x + 3, b.y + 3, b.w - 6, 2);
          }
        } else if (b.hp < b.max) {
          // Chipped: a crack that deepens with each hit.
          ctx.strokeStyle = 'rgba(0,0,0,0.4)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(b.x + b.w * 0.3, b.y + 2);
          ctx.lineTo(b.x + b.w * 0.45, b.y + b.h - 3);
          ctx.stroke();
        }
        ctx.closePath();
      }
    },

    drawBalls: function(ctx, now) {
      const slow = this.effects.slowUntil > now;
      const pierce = this.effects.pierceUntil > now;
      const hot = this.fever;
      this.balls.forEach(ball => {
        // Comet trail — the cheapest possible sense of speed.
        for (let i = 0; i < ball.trail.length; i++) {
          const t = (i + 1) / (ball.trail.length + 1);
          ctx.globalAlpha = t * 0.32;
          ctx.beginPath();
          ctx.arc(ball.trail[i].x, ball.trail[i].y, ball.radius * (0.35 + t * 0.5), 0, Math.PI * 2);
          ctx.fillStyle = hot ? '#f59e0b' : (pierce ? '#f472b6' : (slow ? '#fbbf24' : ball.color));
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
        const gradient = ctx.createRadialGradient(ball.x - 2, ball.y - 2, 2, ball.x, ball.y, ball.radius);
        gradient.addColorStop(0, '#fff');
        gradient.addColorStop(1, hot ? '#f59e0b' : (pierce ? '#f472b6' : (slow ? '#fbbf24' : ball.color)));
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.closePath();
      });
    },

    drawPaddle: function(ctx, canvas, now) {
      ctx.beginPath();
      const pX = this.paddle.x;
      const pY = canvas.height - this.paddle.height - 4;
      ctx.roundRect ? ctx.roundRect(pX, pY, this.paddle.width, this.paddle.height, 6) : ctx.rect(pX, pY, this.paddle.width, this.paddle.height);
      ctx.fillStyle = this.effects.shrinkUntil > now ? '#ef4444'
                    : (this.effects.wide ? '#67e8f9' : this.paddle.color);
      ctx.fill();
      ctx.closePath();
      if (this.effects.laserUntil > now) {
        ctx.fillStyle = '#f97316';
        ctx.fillRect(pX + 5, pY - 5, 6, 5);
        ctx.fillRect(pX + this.paddle.width - 11, pY - 5, 6, 5);
      }
    },

    drawPowerups: function(ctx, canvas, game) {
      const labels = { W: 'W', S: 'S', M: 'M', P: 'P', L: 'L', N: 'N', H: '♥', X: '✕', R: '»' };
      const colors = { W: '#22d3ee', S: '#fbbf24', M: '#a855f7', P: '#f472b6', L: '#f97316', N: '#4ade80', H: '#ec4899', X: '#ef4444', R: '#ef4444' };
      const paddleTop = canvas.height - this.paddle.height - 4;

      for (let i = this.powerups.length - 1; i >= 0; i--) {
        const p = this.powerups[i];
        p.y += p.vy;

        // Caught?
        if (p.y + p.h >= paddleTop && p.y < canvas.height &&
            p.x + p.w > this.paddle.x && p.x < this.paddle.x + this.paddle.width) {
          this.applyPowerup(p, game);
          this.powerups.splice(i, 1);
          continue;
        }
        if (p.y > canvas.height + 20) { this.powerups.splice(i, 1); continue; }

        // Hazards are square-cornered and red so they read as "dodge me" at a
        // glance — catching one has to be a decision, not a surprise.
        const hazard = this.isHazard(p.type);
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(p.x, p.y, p.w, p.h, hazard ? 2 : 8) : ctx.rect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = colors[p.type];
        ctx.fill();
        ctx.closePath();
        if (hazard) {
          ctx.strokeStyle = '#fecaca';
          ctx.lineWidth = 2;
          ctx.strokeRect(p.x + 2, p.y + 2, p.w - 4, p.h - 4);
        }
        ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#0a0820';
        ctx.fillText(labels[p.type], p.x + p.w / 2, p.y + p.h - 4.5);
      }
    },

    // One brick per sub-step, so a fast ball still registers every hit.
    hitBricks: function(ball, game, pierce) {
      for (const b of this.bricks) {
        if (b.hp <= 0) continue;
        if (ball.x > b.x && ball.x < b.x + b.w && ball.y > b.y && ball.y < b.y + b.h) {
          // Pierce carries straight through breakable bricks; steel always
          // bounces, so it stays a wall even at full power.
          if (!pierce || b.kind === 'steel') ball.dy = -ball.dy;
          if (b.kind === 'steel') {
            SFX.beep(160, 0.05, 'square', 0.08);
            Fx.burst(ball.x, b.y + b.h / 2, '#94a3b8', 4, 1.5);
            return false;
          }
          return this.damageBrick(b, game, ball.x, true);
        }
      }
      return false;
    },

    stepBalls: function(canvas, game, now) {
      const factor = this.ballFactor(now);
      const pierce = this.effects.pierceUntil > now;
      const paddleTop = canvas.height - this.paddle.height - 4;

      for (let i = this.balls.length - 1; i >= 0; i--) {
        const ball = this.balls[i];
        ball.trail.push({ x: ball.x, y: ball.y });
        if (ball.trail.length > 8) ball.trail.shift();

        const per = Math.hypot(ball.dx, ball.dy) * factor;
        const steps = Math.max(1, Math.ceil(per / this.SUBSTEP));
        let lost = false;

        for (let n = 0; n < steps; n++) {
          const sx = ball.dx * factor / steps;
          const sy = ball.dy * factor / steps;

          if (ball.x + sx > canvas.width - ball.radius || ball.x + sx < ball.radius) {
            ball.dx = -ball.dx;
          }

          if (ball.y + sy < ball.radius) {
            ball.dy = -ball.dy;
          } else if (ball.dy > 0 &&
                     ball.y + sy > paddleTop - ball.radius &&
                     ball.y < paddleTop) {
            if (ball.x > this.paddle.x - ball.radius &&
                ball.x < this.paddle.x + this.paddle.width + ball.radius) {
              const hit = (ball.x - (this.paddle.x + this.paddle.width / 2)) / (this.paddle.width / 2);
              const angle = hit * (Math.PI / 3);
              const v = Math.hypot(ball.dx, ball.dy);
              ball.dx = v * Math.sin(angle);
              ball.dy = -Math.abs(v * Math.cos(angle));
              this.combo = 0;
              this.fever = false;
              SFX.paddle();
              Fx.burst(ball.x, paddleTop, '#22d3ee', 4, 1.4);
            }
          } else if (ball.y + sy > canvas.height - ball.radius) {
            // Safety net: one free bounce, then it's spent.
            if (this.effects.net > 0) {
              this.effects.net--;
              this.netFlash = 10;
              ball.dy = -Math.abs(ball.dy);
              SFX.beep(520, 0.09, 'triangle', 0.11, 760);
              Fx.burst(ball.x, this.netY(canvas), '#4ade80', 12, 2.4);
              Fx.text(ball.x, this.netY(canvas) - 18, 'SAVED', '#4ade80');
            } else {
              this.balls.splice(i, 1);
              lost = true;
              break;
            }
          }

          ball.x += ball.dx * factor / steps;
          ball.y += ball.dy * factor / steps;

          // Clearing the level rebuilds the board and replaces this.balls, so
          // there is nothing left to iterate.
          if (this.hitBricks(ball, game, pierce)) return;
        }

        if (lost) continue;

        // Keep the ball from settling into a near-horizontal groove, which used
        // to leave it ricocheting along the walls for ages with nothing to hit.
        const v = Math.hypot(ball.dx, ball.dy) || this.speed;
        if (Math.abs(ball.dy) < v * 0.30) {
          ball.dy = Math.sign(ball.dy || -1) * v * 0.30;
          ball.dx = Math.sign(ball.dx || 1) * Math.sqrt(Math.max(0, v * v - ball.dy * ball.dy));
        }
      }

      if (this.balls.length === 0) {
        this.lives--;
        this.combo = 0;
        this.fever = false;
        SFX.lifeLost();
        game.shake(7, 14);
        if (this.lives <= 0) {
          game.showGameOver('Game Over');
          return;
        }
        this.resetBalls(canvas);
      }
    },

    movePaddle: function(canvas) {
      if (this.rightPressed && this.paddle.x < canvas.width - this.paddle.width) {
        this.paddle.x += this.paddle.speed;
      } else if (this.leftPressed && this.paddle.x > 0) {
        this.paddle.x -= this.paddle.speed;
      }
    },

    // --- Autopilot -------------------------------------------------------
    // Three jobs, in priority order: don't lose a ball, don't catch a hazard,
    // and hit something worth hitting.
    //
    // The old version tracked whichever ball arrived soonest and moved at it
    // flat out. That loses balls it didn't need to: with multi-ball running,
    // an unreachable ball would drag the paddle away from one still in reach,
    // and it would happily collect a capsule that turned out to be a trap.
    autoPlay: function(game) {
      const canvas = game.canvas;
      const now = performance.now();
      const paddleTop = canvas.height - this.paddle.height - 4;
      const half = this.paddle.width / 2;
      const centre = this.paddle.x + half;
      const step = this.paddle.speed * 2.2;
      const factor = this.ballFactor(now);

      // Every descending ball, with when it lands and where. The landing x is
      // independent of the speed factor (it cancels), but the deadline is not.
      const arrivals = [];
      for (const b of this.balls) {
        if (b.dy <= 0) continue;
        const t = (paddleTop - b.radius - b.y) / (b.dy * factor);
        if (t < 0) continue;
        arrivals.push({ t: t, x: this.predictX(b, t, canvas, factor) });
      }
      arrivals.sort((a, b) => a.t - b.t);
      for (const a of arrivals) a.reachable = Math.abs(a.x - centre) <= step * a.t + half * 0.8;

      // Prefer the soonest ball we can actually get to. A ball that is already
      // beyond saving must not pull the paddle off one that isn't.
      const pick = arrivals.find((a) => a.reachable) || arrivals[0] || null;

      // Multi-ball: rather than commit to one ball and write the rest off,
      // find the standing point that covers the most of them at once, and take
      // the centre of that group. With four balls down it is often possible to
      // catch two or three on one paddle.
      let stand = pick ? pick.x : null;
      if (pick && arrivals.length > 1) {
        let best = 0, bestT = Infinity;
        for (const a of arrivals) {
          if (!a.reachable) continue;
          const group = arrivals.filter((o) => o.reachable &&
                                               Math.abs(o.x - a.x) < half * 0.9 &&
                                               Math.abs(o.t - a.t) < 14);
          if (group.length > best || (group.length === best && a.t < bestT)) {
            best = group.length;
            bestT = a.t;
            stand = group.reduce((sum, o) => sum + o.x, 0) / group.length;
          }
        }
      }

      let target;
      if (pick) {
        const detour = this.bestCapsule(canvas, pick.t, stand, centre, step, now);
        const dense = this.effects.laserUntil > now ? this.densestX(canvas) : null;
        if (detour !== null) {
          target = detour;
        } else if (dense !== null && this.canReturn(dense, stand, centre, step, pick.t)) {
          // The cannon is firing and the ball is still a long way off: spend
          // the wait standing where the bolts will actually land.
          target = dense;
        } else if (dense !== null) {
          // Not enough time to park properly, but the cannon is still firing —
          // drift toward the wall with half the spare movement, so the bolts
          // are aimed at something without risking the catch.
          const spare = Math.max(0, (pick.t - 8) * step - Math.abs(stand - centre)) * 0.5;
          const drift = Math.max(-spare, Math.min(spare, dense - stand));
          target = stand + drift - this.aimBias(stand, pick.t, canvas, now);
        } else {
          target = stand - this.aimBias(stand, pick.t, canvas, now);
        }
      } else {
        const detour = this.bestCapsule(canvas, Infinity, null, centre, step, now);
        if (detour !== null) target = detour;
        else if (this.effects.laserUntil > now) {
          // Nothing to catch and the cannon is firing: park under the thickest
          // part of the wall so the bolts aren't wasted on empty space.
          const dense = this.densestX(canvas);
          target = dense === null ? this.dodge(canvas, centre) : dense;
        } else {
          target = this.dodge(canvas, centre);
        }
      }

      const move = Math.max(-step, Math.min(step, target - centre));
      this.paddle.x = Math.max(0, Math.min(canvas.width - this.paddle.width, this.paddle.x + move));
    },

    // Enough time to go somewhere and still get back under the ball?
    canReturn: function(x, ballX, centre, step, ballT) {
      if (x === null || ballX === null) return false;
      return Math.abs(x - centre) / step + Math.abs(ballX - x) / step < ballT - 8;
    },

    // What a capsule is worth *right now*. An extra life is close to priceless
    // on the last one and nearly worthless on the sixth; a net you already have
    // three of is not worth crossing the board for.
    capsuleValue: function(type, now) {
      // Multi, Laser and Pierce are clear-rate multipliers: worth a lot with a
      // full board in front of you and almost nothing with four bricks left,
      // where an extra life or a net is the only thing that still matters.
      const board = Math.min(1, this.bricksLeft() / 24);
      switch (type) {
        case 'H': return this.lives <= 1 ? 100 : (this.lives >= 5 ? 8 : 40);
        case 'N': return this.effects.net >= 3 ? 4 : 30;
        // A seventh ball is chaos, not throughput.
        case 'M': return this.balls.length >= 4 ? 6 : 8 + 30 * board;
        case 'L': return this.effects.laserUntil > now ? 5 : 5 + 26 * board;
        case 'P': return this.effects.pierceUntil > now ? 5 : 6 + 24 * board;
        case 'W': return this.effects.wide ? 3 : 22;
        case 'S': return this.effects.slowUntil > now ? 4 : 16;
        default:  return 0;
      }
    },

    // A capsule is only worth a detour if we can reach it AND still get back
    // under the ball. How much lateness is acceptable depends on what is in
    // hand: a safety net makes a gamble cheap, a rushed ball makes it dear.
    // Hazards are never a target — they are the thing being avoided.
    bestCapsule: function(canvas, ballT, ballX, centre, step, now) {
      const paddleTop = canvas.height - this.paddle.height - 4;
      const slack = (this.effects.net > 0 ? 55 : 4)
                  + (this.effects.slowUntil > now ? 10 : 0)
                  - (this.effects.rushUntil > now ? 8 : 0);
      let best = null, bestScore = 0;
      for (const p of this.powerups) {
        if (this.isHazard(p.type)) continue;
        const value = this.capsuleValue(p.type, now);
        if (value <= 6) continue;                                   // not worth moving for
        const t = (paddleTop - (p.y + p.h)) / p.vy;
        if (t < 0) continue;
        const x = p.x + p.w / 2;
        if (Math.abs(x - centre) > step * t) continue;               // can't get there in time
        if (ballX !== null && t + Math.abs(ballX - x) / step > ballT - 4 + slack) continue;
        const score = value / (1 + t / 60);                          // valuable, and soon
        if (score > bestScore) { bestScore = score; best = x; }
      }
      return best;
    },

    // Nothing to catch: stand clear of anything red on its way down.
    dodge: function(canvas, centre) {
      const paddleTop = canvas.height - this.paddle.height - 4;
      for (const p of this.powerups) {
        if (!this.isHazard(p.type)) continue;
        if (p.y + p.h > paddleTop) continue;
        const x = p.x + p.w / 2;
        if (Math.abs(x - centre) < this.paddle.width) {
          return x < canvas.width / 2 ? canvas.width * 0.8 : canvas.width * 0.2;
        }
      }
      return canvas.width / 2;
    },

    // Where the wall is thickest, weighted by what each brick is worth taking
    // out. This is both the best place to send a piercing ball and the best
    // place to stand while the laser is firing.
    densestX: function(canvas) {
      const bins = 16, w = canvas.width / bins;
      const tally = new Array(bins).fill(0);
      for (const b of this.bricks) {
        if (b.hp <= 0 || b.kind === 'steel') continue;
        const i = Math.min(bins - 1, Math.max(0, Math.floor((b.x + b.w / 2) / w)));
        tally[i] += b.kind === 'boom' ? 4 : (b.kind === 'key' ? 3 : 1);
      }
      let bi = -1, bv = 0;
      for (let i = 0; i < bins; i++) if (tally[i] > bv) { bv = tally[i]; bi = i; }
      return bi < 0 ? null : (bi + 0.5) * w;
    },

    // Unfold the wall bounces: the path is a triangle wave over the playable
    // span, so one modulo gets the landing point without a stepped simulation.
    predictX: function(ball, frames, canvas, factor) {
      const lo = ball.radius, hi = canvas.width - ball.radius;
      const span = hi - lo;
      if (span <= 0) return canvas.width / 2;
      const period = span * 2;
      let p = (ball.x + ball.dx * (factor === undefined ? 1 : factor) * frames) - lo;
      p = ((p % period) + period) % period;
      return lo + (p <= span ? p : period - p);
    },

    // Push the bounce toward the bricks worth hitting. Explosives and
    // keystones each take a chunk of the board with them, so they pull harder
    // than a plain brick; steel pulls not at all. Once the wall is close, the
    // lowest bricks are all that matter.
    aimBias: function(ballX, frames, canvas, now) {
      if (frames > 70) return 0;   // no time to be fancy — just catch it
      const goal = this.aimGoal(canvas, now, ballX);
      if (goal === null) return 0;
      const bias = (goal - ballX) / 240;
      return Math.max(-1, Math.min(1, bias)) * (this.paddle.width * this.AIM_AUTHORITY);
    },

    // Where to send the ball next.
    //
    // A weighted centre of what is left, not a single chosen brick: aiming at
    // one specific brick was tried and measured worse (median level 5 against
    // 12), because the pick jumps frame to frame as bricks break and the
    // paddle chases it instead of settling into a stable angle.
    //
    // Piercing changes the answer completely: drive at the thickest stack,
    // because the ball will pass through all of it rather than bounce off the
    // first brick.
    aimGoal: function(canvas, now, ballX) {
      if (now !== undefined && this.effects.pierceUntil > now) {
        const dense = this.densestX(canvas);
        if (dense !== null) return dense;
      }
      if (this.initialBricks && this.bricksLeft() >= this.initialBricks * this.TUNNEL_UNTIL) {
        const tunnel = this.tunnelGoal(canvas);
        if (tunnel !== null) return tunnel;
      }
      let lowest = 0;
      for (const b of this.bricks) {
        if (b.hp <= 0 || b.kind === 'steel') continue;
        if (b.y > lowest) lowest = b.y;
      }
      const urgent = canvas ? lowest > this.dangerY(canvas) - this.DESCEND_STEP * 4 : false;

      let sx = 0, w = 0;
      for (const b of this.bricks) {
        if (b.hp <= 0 || b.kind === 'steel') continue;
        if (urgent && b.y < lowest - this.DESCEND_STEP * 1.5) continue;
        // Explosives and keystones take a chunk of the board with them, and a
        // brick that dies in one hit is worth more than one that needs three.
        const wt = (b.kind === 'boom' ? 5 : b.kind === 'key' ? 4 : b.kind === 'mystery' ? 3 : 1) / b.hp;
        sx += (b.x + b.w / 2) * wt;
        w += wt;
      }
      return w ? sx / w : null;
    },

    // The strategy a good human plays and the bot did not: punch a channel
    // through one column, and the ball ends up *above* the wall, rattling
    // between the ceiling and the brick tops. From up there it clears several
    // bricks a trip instead of one or two, and never risks the paddle.
    //
    // Pick the cheapest column to break through, preferring the edges — a ball
    // that enters at the side stays above the wall longer. Steel columns can
    // never be dug, so they are ruled out.
    tunnelGoal: function(canvas) {
      const cost = {};
      for (const b of this.bricks) {
        if (b.hp <= 0) continue;
        if (b.kind === 'steel') { cost[b.col] = Infinity; continue; }
        if (cost[b.col] === Infinity) continue;
        cost[b.col] = (cost[b.col] || 0) + b.hp;
      }
      // Nothing left worth tunnelling for; go back to the weighted centre.
      const live = Object.keys(cost).filter((c) => cost[c] !== Infinity);
      if (live.length < 3) return null;

      let bestCol = null, bestCost = Infinity;
      for (const c of live) {
        const col = Number(c);
        const edge = Math.min(col, this.cols - 1 - col);
        const score = cost[c] * 2 + edge;       // shallow first, then edge-most
        if (score < bestCost) { bestCost = score; bestCol = col; }
      }
      if (bestCol === null) return null;

      const cfg = this.config;
      const anchorBrick = this.bricks.find((b) => b.col === bestCol);
      if (anchorBrick) return anchorBrick.x + anchorBrick.w / 2;
      // Column already cleared — keep feeding the ball up the channel.
      const gridW = this.cols * cfg.brickWidth + (this.cols - 1) * cfg.brickPadding;
      const left = Math.round((canvas.width - gridW) / 2);
      return left + bestCol * (cfg.brickWidth + cfg.brickPadding) + cfg.brickWidth / 2;
    },

    nearestPowerup: function(canvas) {
      let best = null, bestY = -Infinity;
      for (const p of this.powerups) {
        if (this.isHazard(p.type)) continue;
        if (p.y > bestY) { bestY = p.y; best = p; }
      }
      return best ? best.x + best.w / 2 : null;
    }
  };

  // ===================================
  // Dino — double jump, coyote time, shields, coins, day/night
  // ===================================
  const DinoGame = {
    dino: null,
    obstacles: [],
    coins: [],
    clouds: [],
    stars: [],
    distance: 0,
    speed: 4.6,
    spawnGap: 0,
    coinGap: 0,
    night: 0,
    lastMilestone: 0,
    ducking: false,
    downPressed: false,
    wasOnGround: true,
    jumpsLeft: 2,
    coyote: 0,
    jumpBuffer: 0,
    shield: 0,
    shieldFlash: 0,
    keyDownH: null,
    keyUpH: null,
    STAND_H: 44,
    DUCK_H: 24,
    COYOTE_FRAMES: 7,   // still jumpable just after walking off a ledge/landing
    BUFFER_FRAMES: 9,   // a jump pressed just before landing still fires

    init: function(game) {
      const canvas = game.canvas;
      this.dino = {
        x: 60,
        y: canvas.height - 70,
        width: 40,
        height: this.STAND_H,
        color: '#22d3ee',
        dy: 0,
        gravity: 0.85,
        jumpForce: -16,
        onGround: true
      };
      this.obstacles = [];
      this.coins = [];
      this.clouds = [
        { x: 120, y: 70, s: 0.4 },
        { x: 380, y: 110, s: 0.55 },
        { x: 560, y: 50, s: 0.3 }
      ];
      // Fixed star field for night sky
      this.stars = [];
      for (let i = 0; i < 26; i++) {
        this.stars.push({ x: (i * 97 + 31) % canvas.width, y: 20 + ((i * 53) % 150), tw: i % 3 });
      }
      this.distance = 0;
      this.speed = 4.6;
      this.spawnGap = 110;
      this.coinGap = 150;
      this.night = 0;
      this.lastMilestone = 0;
      this.ducking = false;
      this.downPressed = false;
      this.wasOnGround = true;
      this.jumpsLeft = 2;
      this.coyote = this.COYOTE_FRAMES;
      this.jumpBuffer = 0;
      this.shield = 0;
      this.shieldFlash = 0;
      game.updateScore(0);

      if (this.keyDownH) document.removeEventListener('keydown', this.keyDownH);
      if (this.keyUpH) document.removeEventListener('keyup', this.keyUpH);
      this.keyDownH = (e) => {
        if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') this.doJump();
        if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') this.downPressed = true;
      };
      this.keyUpH = (e) => {
        if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') this.downPressed = false;
      };
      document.addEventListener('keydown', this.keyDownH);
      document.addEventListener('keyup', this.keyUpH);
    },

    releaseControls: function() { this.downPressed = false; },

    doJump: function() {
      if (this.ducking) return;
      const grounded = this.dino.onGround || this.coyote > 0;
      if (grounded) {
        this.dino.dy = this.dino.jumpForce;
        this.dino.onGround = false;
        this.coyote = 0;
        this.jumpsLeft = 1;          // one mid-air jump still in hand
        SFX.jump();
      } else if (this.jumpsLeft > 0) {
        this.dino.dy = this.dino.jumpForce * 0.86;
        this.jumpsLeft--;
        SFX.beep(520, 0.11, 'triangle', 0.08, 820);
        Fx.burst(this.dino.x + this.dino.width / 2, this.dino.y + this.dino.height, '#a855f7', 8, 2);
      } else {
        this.jumpBuffer = this.BUFFER_FRAMES; // fire it the instant we land
      }
    },

    onTap: function() { this.doJump(); },

    spawnObstacle: function(canvas) {
      const groundY = canvas.height - 20;
      const allowPtero = this.distance > 200;
      const roll = Math.random();

      if (allowPtero && roll < 0.28) {
        // Pterodactyl: low (jump it) or head-height (duck it)
        const high = Math.random() < 0.55;
        this.obstacles.push({
          ptero: true,
          x: canvas.width + 10,
          y: high ? groundY - this.STAND_H - 12 : groundY - 38,
          width: 40,
          height: 22,
          color: '#a855f7',
          flap: 0
        });
      } else {
        const type = Math.random();
        let w, h;
        if (type < 0.5)       { w = 20; h = 45; }
        else if (type < 0.82) { w = 42; h = 45; }
        else                  { w = 22; h = 62; }
        this.obstacles.push({
          x: canvas.width + 10,
          y: groundY - h,
          width: w,
          height: h,
          color: '#ec4899'
        });
      }
      const minGap = Math.max(62, 115 - this.speed * 4);
      this.spawnGap = minGap + Math.random() * 80;
    },

    // Coins arc through the air so they're worth jumping for; every so often
    // the arc carries a shield instead.
    spawnCoins: function(canvas) {
      const groundY = canvas.height - 20;
      const n = 3 + Math.floor(Math.random() * 3);
      const peak = 70 + Math.random() * 45;
      const shieldAt = Math.random() < 0.22 ? Math.floor(n / 2) : -1;
      for (let i = 0; i < n; i++) {
        const f = n === 1 ? 0.5 : i / (n - 1);
        const lift = Math.sin(f * Math.PI) * peak;
        this.coins.push({
          x: canvas.width + 20 + i * 34,
          y: groundY - 46 - lift,
          r: 9,
          spin: i * 0.7,
          shield: i === shieldAt
        });
      }
      this.coinGap = 190 + Math.random() * 220;
    },

    update: function(game) {
      const canvas = game.canvas;
      const groundLine = canvas.height - 20;

      // Duck state (only meaningful on the ground)
      const wantDuck = this.downPressed && this.dino.onGround;
      if (wantDuck && !this.ducking) { this.ducking = true; SFX.duck(); }
      if (!wantDuck && this.ducking) this.ducking = false;
      const prevH = this.dino.height;
      this.dino.height = this.ducking ? this.DUCK_H : this.STAND_H;
      // The dino is anchored by its feet, not its top edge. Without this the
      // crouch shrank it from the bottom, leaving its top above the new ground
      // line — so it counted as airborne, dropped onGround, and un-ducked on
      // the very next frame. Ducking under a pterodactyl never actually held.
      if (this.dino.onGround) this.dino.y += prevH - this.dino.height;

      // Physics (+ fast-fall when holding down mid-air)
      if (!this.dino.onGround && this.downPressed) this.dino.dy += 1.3;
      this.dino.y += this.dino.dy;
      const groundY = groundLine - this.dino.height;
      if (this.dino.y < groundY) {
        this.dino.dy += this.dino.gravity;
        if (this.dino.onGround) this.coyote = this.COYOTE_FRAMES;
        this.dino.onGround = false;
        if (this.coyote > 0) this.coyote--;
      } else {
        this.dino.y = groundY;
        this.dino.dy = 0;
        if (!this.wasOnGround) {
          Fx.burst(this.dino.x + this.dino.width / 2, groundLine - 2, 'rgba(180,180,200,0.8)', 6, 1.8);
        }
        this.dino.onGround = true;
        this.coyote = this.COYOTE_FRAMES;
        this.jumpsLeft = 2;
        if (this.jumpBuffer > 0) { this.jumpBuffer = 0; this.doJump(); }
      }
      if (this.jumpBuffer > 0) this.jumpBuffer--;
      this.wasOnGround = this.dino.onGround;
      if (this.shieldFlash > 0) this.shieldFlash--;

      // Distance score + speed ramp (gentler than it used to be)
      this.distance += this.speed / 10;
      const score = Math.floor(this.distance);
      if (score !== game.score) game.updateScore(score);
      this.speed = Math.min(4.6 + this.distance / 230, 11.5);

      // Milestone every 100
      if (Math.floor(score / 100) > this.lastMilestone) {
        this.lastMilestone = Math.floor(score / 100);
        SFX.milestone();
        Fx.text(canvas.width / 2, 60, `${this.lastMilestone * 100}!`, '#fbbf24');
      }

      // Day / night cycle every 300 points
      const targetNight = (Math.floor(score / 300) % 2 === 1) ? 1 : 0;
      this.night += (targetNight - this.night) * 0.02;

      // Clouds drift
      this.clouds.forEach(c => {
        c.x -= this.speed * c.s * 0.4;
        if (c.x < -60) { c.x = canvas.width + 40; c.y = 40 + Math.random() * 90; }
      });

      // Coins
      this.coinGap -= this.speed / 4;
      if (this.coinGap <= 0) this.spawnCoins(canvas);
      for (let i = this.coins.length - 1; i >= 0; i--) {
        const c = this.coins[i];
        c.x -= this.speed;
        c.spin += 0.16;
        if (c.x < -20) { this.coins.splice(i, 1); continue; }
        if (Math.abs(c.x - (this.dino.x + this.dino.width / 2)) < 24 &&
            Math.abs(c.y - (this.dino.y + this.dino.height / 2)) < 26) {
          this.coins.splice(i, 1);
          if (c.shield) {
            this.shield = Math.min(this.shield + 1, 2);
            SFX.bonus();
            Fx.text(c.x, c.y - 10, '🛡️ SHIELD', '#4ade80');
            Fx.burst(c.x, c.y, '#4ade80', 16, 3);
          } else {
            game.updateScore(game.score + 25);
            SFX.beep(1050, 0.06, 'triangle', 0.1);
            Fx.text(c.x, c.y - 8, '+25', '#fbbf24');
            Fx.burst(c.x, c.y, '#fbbf24', 8, 2);
          }
        }
      }

      // Obstacles
      this.spawnGap -= this.speed / 4;
      if (this.spawnGap <= 0) this.spawnObstacle(canvas);

      for (let i = this.obstacles.length - 1; i >= 0; i--) {
        const o = this.obstacles[i];
        o.x -= this.speed * (o.ptero ? 1.15 : 1);
        if (o.ptero) o.flap++;
        if (o.x + o.width < 0) { this.obstacles.splice(i, 1); continue; }

        // Slightly kinder hitbox than the drawn sprite.
        if (this.dino.x + 9 < o.x + o.width &&
            this.dino.x + this.dino.width - 9 > o.x &&
            this.dino.y + 9 < o.y + o.height &&
            this.dino.y + this.dino.height - 6 > o.y) {
          if (this.shield > 0) {
            this.shield--;
            this.shieldFlash = 18;
            this.obstacles.splice(i, 1);
            SFX.beep(300, 0.18, 'sawtooth', 0.1, 900);
            Fx.burst(o.x + o.width / 2, o.y + o.height / 2, '#4ade80', 20, 3.4);
            Fx.text(this.dino.x + 20, this.dino.y - 12, 'BLOCKED!', '#4ade80');
            game.shake(5, 10);
            continue;
          }
          game.shake(8, 16);
          game.showGameOver('Game Over');
          return;
        }
      }
    },

    draw: function(game) {
      const ctx = game.ctx;
      const canvas = game.canvas;

      // Night tint + stars + moon
      if (this.night > 0.02) {
        ctx.fillStyle = `rgba(6, 4, 32, ${0.38 * this.night})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const t = performance.now() / 600;
        this.stars.forEach((s, i) => {
          const tw = 0.5 + 0.5 * Math.sin(t + i);
          ctx.globalAlpha = this.night * (0.4 + 0.6 * tw);
          ctx.fillStyle = '#fff';
          ctx.fillRect(s.x, s.y, 2, 2);
        });
        ctx.globalAlpha = this.night;
        ctx.beginPath();
        ctx.arc(canvas.width - 90, 70, 22, 0, Math.PI * 2);
        ctx.fillStyle = '#e9e6d8';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(canvas.width - 98, 64, 19, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(6, 4, 32, ${0.85})`;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Clouds (fade at night)
      ctx.fillStyle = `rgba(255,255,255,${0.18 * (1 - this.night * 0.6)})`;
      this.clouds.forEach(c => {
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, 28, 12, 0, 0, Math.PI * 2);
        ctx.ellipse(c.x + 18, c.y - 6, 18, 10, 0, 0, Math.PI * 2);
        ctx.fill();
      });

      // Ground
      ctx.beginPath();
      ctx.moveTo(0, canvas.height - 20);
      ctx.lineTo(canvas.width, canvas.height - 20);
      ctx.strokeStyle = this.night > 0.5 ? '#aab' : '#888';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Coins / shields (squashed circle so they read as spinning)
      this.coins.forEach(c => {
        const w = Math.abs(Math.cos(c.spin)) * c.r + 2;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, w, c.r, 0, 0, Math.PI * 2);
        ctx.fillStyle = c.shield ? '#4ade80' : '#fbbf24';
        ctx.fill();
        ctx.fillStyle = c.shield ? '#052e16' : '#7c5a06';
        ctx.font = 'bold 10px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        if (w > 5) ctx.fillText(c.shield ? 'S' : '$', c.x, c.y + 3.5);
      });

      // Dino (squat when ducking, legs animate on ground)
      ctx.fillStyle = this.dino.color;
      ctx.fillRect(this.dino.x, this.dino.y, this.dino.width, this.dino.height);
      ctx.fillStyle = '#222';
      ctx.fillRect(this.dino.x + this.dino.width - 12, this.dino.y + 5, 6, 6);
      if (this.dino.onGround) {
        const step = Math.floor(this.distance * 2) % 2 === 0;
        ctx.fillStyle = this.dino.color;
        ctx.fillRect(this.dino.x + (step ? 4 : 22), this.dino.y + this.dino.height, 8, 6);
      }

      // Shield bubble
      if (this.shield > 0 || this.shieldFlash > 0) {
        ctx.save();
        ctx.globalAlpha = this.shieldFlash > 0 ? 1 : 0.45 + 0.2 * Math.sin(performance.now() / 180);
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = this.shieldFlash > 0 ? 4 : 2;
        ctx.beginPath();
        ctx.ellipse(this.dino.x + this.dino.width / 2, this.dino.y + this.dino.height / 2,
                    this.dino.width * 0.85, this.dino.height * 0.8, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Obstacles
      this.obstacles.forEach(o => {
        ctx.fillStyle = o.color;
        if (o.ptero) {
          // Body
          ctx.fillRect(o.x + 8, o.y + 8, o.width - 16, 8);
          // Beak
          ctx.fillRect(o.x + o.width - 8, o.y + 9, 8, 4);
          // Flapping wings
          const up = Math.floor(o.flap / 12) % 2 === 0;
          ctx.beginPath();
          if (up) {
            ctx.moveTo(o.x + 12, o.y + 10);
            ctx.lineTo(o.x + 22, o.y - 8);
            ctx.lineTo(o.x + 28, o.y + 10);
          } else {
            ctx.moveTo(o.x + 12, o.y + 12);
            ctx.lineTo(o.x + 22, o.y + 26);
            ctx.lineTo(o.x + 28, o.y + 12);
          }
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillRect(o.x, o.y, o.width, o.height);
          ctx.fillRect(o.x - 6, o.y + 15, 6, 10);
          ctx.fillRect(o.x + o.width, o.y + 10, 6, 10);
        }
      });

      // HUD
      ctx.font = '16px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#a5b4fc';
      let hud = `${this.speed.toFixed(1)}× speed`;
      if (this.shield > 0) hud += ` · 🛡️×${this.shield}`;
      ctx.fillText(hud, 12, 24);
    },

    // --- Autopilot -------------------------------------------------------
    // Duck under head-height pterodactyls; for everything else, roll the real
    // physics forward and jump only when doing nothing would hit and jumping
    // now wouldn't. Timing this by eye ("jump when the gap is under N") kept
    // stranding the dino: it would come down from one jump already inside the
    // next cactus, and the mid-air rescue only noticed once it was too low to
    // help. Simulating answers both questions exactly and early.
    autoPlay: function(game) {
      const canvas = game.canvas;
      const groundLine = canvas.height - 20;
      const d = this.dino;

      let next = null;
      for (const o of this.obstacles) {
        if (o.x + o.width <= d.x) continue;              // already behind us
        if (!next || o.x < next.x) next = o;
      }

      this.downPressed = false;
      if (!next) { this.autoCoin(game, groundLine); return; }

      // Head-height pterodactyl: ducking clears it, jumping flies into it.
      // Holding down works airborne too — it fast-falls, which is the only way
      // out when one shows up while we're still coming down from a jump.
      if (next.ptero && next.y + next.height < groundLine - this.DUCK_H) {
        const gap = next.x - (d.x + d.width);
        if (gap < this.speed * 1.15 * 18) this.downPressed = true;
        return;
      }

      if (!this.willHit(next, groundLine, d.y, d.dy)) return;   // already safe

      const fromGround = d.onGround || this.coyote > 0;
      if (!fromGround && this.jumpsLeft <= 0) return;           // nothing left to spend
      const lift = fromGround ? d.jumpForce : d.jumpForce * 0.86;
      // If jumping this frame still runs us into it, hold — a slightly later
      // jump may clear it, and re-checking every frame finds that moment.
      if (this.willHit(next, groundLine, d.y, lift)) return;
      this.doJump();
    },

    // Forward-simulate the dino's arc and the obstacle's approach with the same
    // numbers update() uses, and report whether they intersect.
    willHit: function(o, groundLine, y0, dy0) {
      const d = this.dino;
      const h = this.STAND_H;
      const gy = groundLine - h;
      const closing = this.speed * (o.ptero ? 1.15 : 1);
      let y = y0, dy = dy0, ox = o.x;

      for (let t = 0; t < 70; t++) {
        y += dy;
        if (y < gy) dy += d.gravity; else { y = gy; dy = 0; }
        ox -= closing;
        if (ox + o.width < d.x) return false;            // it went by
        if (d.x + 9 < ox + o.width && d.x + d.width - 9 > ox &&
            y + 9 < o.y + o.height && y + h - 6 > o.y) return true;
      }
      return false;
    },

    autoCoin: function(game, groundLine) {
      const d = this.dino;
      let target = null;
      for (const c of this.coins) {
        if (c.x < d.x) continue;
        if (!target || c.x < target.x) target = c;
      }
      if (!target) return;
      const gap = target.x - (d.x + d.width / 2);
      // Rise takes ~19 frames; start early enough to be at height on arrival.
      if (d.onGround && gap > 0 && gap < this.speed * 19 && target.y < groundLine - 60) {
        this.doJump();
      }
    }
  };

  // ===================================
  // Snake — wrap-around edges, golden bonus, tail trims, streak scoring
  // ===================================
  const SnakeGame = {
    CELL: 20,
    DIRS: [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }],
    cols: 0,
    rows: 0,
    snake: [],
    dir: { x: 1, y: 0 },
    nextDir: { x: 1, y: 0 },
    food: null,
    bonus: null,
    foodsEaten: 0,
    streak: 0,
    lastEatAt: 0,
    tickMs: 125,
    lastTick: 0,
    wrapFlash: 0,
    keyHandler: null,
    swipeStart: null,
    autoKey: '',

    init: function(game) {
      const canvas = game.canvas;
      this.cols = Math.floor(canvas.width / this.CELL);
      this.rows = Math.floor(canvas.height / this.CELL);
      const cx = Math.floor(this.cols / 2);
      const cy = Math.floor(this.rows / 2);
      this.snake = [ { x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy } ];
      this.dir = { x: 1, y: 0 };
      this.nextDir = { x: 1, y: 0 };
      this.tickMs = 125;
      this.lastTick = 0;
      this.bonus = null;
      this.foodsEaten = 0;
      this.streak = 0;
      this.lastEatAt = 0;
      this.wrapFlash = 0;
      this.autoKey = '';
      this.placeFood();
      game.updateScore(0);

      if (this.keyHandler) document.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = (e) => {
        const k = e.key.toLowerCase();
        if (k === 'arrowup' || k === 'w') this.turn(0, -1);
        else if (k === 'arrowdown' || k === 's') this.turn(0, 1);
        else if (k === 'arrowleft' || k === 'a') this.turn(-1, 0);
        else if (k === 'arrowright' || k === 'd') this.turn(1, 0);
      };
      document.addEventListener('keydown', this.keyHandler);
    },

    onResume: function(ms) {
      if (this.bonus) this.bonus.expiresAt += ms;
      this.lastTick += ms;
      this.lastEatAt += ms;
    },

    turn: function(x, y) {
      if (x === -this.dir.x && y === -this.dir.y) return;
      this.nextDir = { x: x, y: y };
    },

    onSwipeStart: function(x, y) { this.swipeStart = { x: x, y: y }; },

    onSwipeEnd: function(x, y) {
      if (!this.swipeStart) return;
      const dx = x - this.swipeStart.x;
      const dy = y - this.swipeStart.y;
      this.swipeStart = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) this.turn(dx > 0 ? 1 : -1, 0);
      else this.turn(0, dy > 0 ? 1 : -1);
    },

    // Edges wrap, so only the snake itself can kill it.
    step: function(cell, d) {
      return {
        x: (cell.x + d.x + this.cols) % this.cols,
        y: (cell.y + d.y + this.rows) % this.rows
      };
    },

    freeCell: function() {
      let spot;
      do {
        spot = { x: Math.floor(Math.random() * this.cols), y: Math.floor(Math.random() * this.rows) };
      } while (
        this.snake.some(s => s.x === spot.x && s.y === spot.y) ||
        (this.food && this.food.x === spot.x && this.food.y === spot.y) ||
        (this.bonus && this.bonus.x === spot.x && this.bonus.y === spot.y)
      );
      return spot;
    },

    placeFood: function() { this.food = this.freeCell(); },

    update: function(game, ts) {
      // Bonus expiry
      if (this.bonus && ts > this.bonus.expiresAt) this.bonus = null;
      if (this.wrapFlash > 0) this.wrapFlash--;

      if (ts - this.lastTick < this.tickMs) return;
      this.lastTick = ts;

      this.dir = this.nextDir;
      const head = this.step(this.snake[0], this.dir);
      if (head.x !== this.snake[0].x + this.dir.x || head.y !== this.snake[0].y + this.dir.y) {
        this.wrapFlash = 8;
      }

      // The tail cell vacates on this same tick, so running into it is fine.
      const body = this.snake.slice(0, this.snake.length - 1);
      if (body.some(s => s.x === head.x && s.y === head.y)) {
        game.shake(7, 14);
        game.showGameOver('Game Over');
        return;
      }

      this.snake.unshift(head);

      const C = this.CELL;
      if (head.x === this.food.x && head.y === this.food.y) {
        // Eating again quickly keeps a streak alive and pays a bonus.
        this.streak = (ts - this.lastEatAt < 3500) ? this.streak + 1 : 1;
        this.lastEatAt = ts;
        const pts = 10 + Math.min(this.streak - 1, 5) * 4;
        game.updateScore(game.score + pts);
        this.foodsEaten++;
        SFX.eat(this.snake.length);
        Fx.burst(head.x * C + C / 2, head.y * C + C / 2, '#ec4899', 9, 2.2);
        Fx.text(head.x * C + C / 2, head.y * C - 4, `+${pts}`, this.streak > 1 ? '#fbbf24' : '#ec4899');
        this.tickMs = Math.max(70, this.tickMs - 1.6);
        this.placeFood();

        // Every 5 foods → a timed bonus. Once the snake is long the bonus
        // becomes a tail trim, which is what actually makes it survivable.
        if (this.foodsEaten % 5 === 0 && !this.bonus) {
          const spot = this.freeCell();
          const trim = this.snake.length > 14;
          this.bonus = { x: spot.x, y: spot.y, expiresAt: ts + 6200, born: ts, trim: trim };
        }
      } else if (this.bonus && head.x === this.bonus.x && head.y === this.bonus.y) {
        if (this.bonus.trim) {
          const cut = Math.min(5, this.snake.length - 4);
          if (cut > 0) this.snake.length -= cut;
          game.updateScore(game.score + 20);
          Fx.text(head.x * C + C / 2, head.y * C - 4, '✂️ +20', '#4ade80');
          Fx.burst(head.x * C + C / 2, head.y * C + C / 2, '#4ade80', 16, 3);
        } else {
          game.updateScore(game.score + 50);
          Fx.text(head.x * C + C / 2, head.y * C - 4, '+50', '#fbbf24');
          Fx.burst(head.x * C + C / 2, head.y * C + C / 2, '#fbbf24', 16, 3);
        }
        SFX.bonus();
        this.bonus = null;
        // bonus also grows the snake (keep tail)
      } else {
        this.snake.pop();
      }
    },

    draw: function(game) {
      const ctx = game.ctx;
      const C = this.CELL;
      const now = performance.now();

      // Subtle checkerboard
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      for (let r = 0; r < this.rows; r++) {
        for (let c = (r % 2); c < this.cols; c += 2) {
          ctx.fillRect(c * C, r * C, C, C);
        }
      }

      // Wrap-around edges, drawn so it's obvious they're portals not walls
      const gw = this.cols * C, gh = this.rows * C;
      ctx.save();
      ctx.globalAlpha = this.wrapFlash > 0 ? 0.9 : 0.3;
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 8]);
      ctx.strokeRect(1.5, 1.5, gw - 3, gh - 3);
      ctx.restore();

      // Food
      ctx.beginPath();
      ctx.arc(this.food.x * C + C / 2, this.food.y * C + C / 2, C / 2 - 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ec4899';
      ctx.fill();

      // Timed bonus: blink + countdown ring (green when it's a tail trim)
      if (this.bonus) {
        const bx = this.bonus.x * C + C / 2;
        const by = this.bonus.y * C + C / 2;
        const frac = Math.max(0, (this.bonus.expiresAt - now) / 6200);
        const blink = 0.55 + 0.45 * Math.sin(now / 110);
        const tint = this.bonus.trim ? '#4ade80' : '#fbbf24';
        ctx.globalAlpha = blink;
        ctx.beginPath();
        ctx.arc(bx, by, C / 2 - 2, 0, Math.PI * 2);
        ctx.fillStyle = tint;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(bx, by, C / 2 + 2.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        ctx.strokeStyle = tint;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Snake — head with eyes, body fades down the tail
      this.snake.forEach((s, i) => {
        const t = i / Math.max(1, this.snake.length - 1);
        ctx.fillStyle = i === 0 ? '#22d3ee' : `rgba(124, 58, 237, ${1 - t * 0.55})`;
        const pad = i === 0 ? 1 : 2;
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(s.x * C + pad, s.y * C + pad, C - pad * 2, C - pad * 2, 5);
          ctx.fill();
        } else {
          ctx.fillRect(s.x * C + pad, s.y * C + pad, C - pad * 2, C - pad * 2);
        }
        if (i === 0) {
          // Eyes face the travel direction
          const ex = s.x * C + C / 2 + this.dir.x * 4;
          const ey = s.y * C + C / 2 + this.dir.y * 4;
          const ox = this.dir.y !== 0 ? 4.5 : 0;
          const oy = this.dir.x !== 0 ? 4.5 : 0;
          ctx.fillStyle = '#0a0820';
          ctx.beginPath();
          ctx.arc(ex - ox, ey - oy, 2.2, 0, Math.PI * 2);
          ctx.arc(ex + ox, ey + oy, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // HUD
      if (this.streak > 1) {
        ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(`STREAK ×${this.streak}`, 10, 20);
      }
    },

    // --- Autopilot -------------------------------------------------------
    // Greedy-but-checked: breadth-first to the food, then reject the move if
    // it would leave the head unable to reach its own tail (the classic way a
    // pure-greedy snake seals itself in). When there's no safe route to food
    // it takes whichever legal move leaves the most open space.
    autoPlay: function() {
      // BFS once per grid step, not once per animation frame.
      const h = this.snake[0];
      const key = h.x + ',' + h.y;
      if (key === this.autoKey) return;
      this.autoKey = key;

      const goal = this.bonus || this.food;
      const back = { x: -this.dir.x, y: -this.dir.y };
      let choice = null;

      const d = this.pathDir(h, goal, this.snake);
      if (d && !(d.x === back.x && d.y === back.y)) {
        const after = this.advance(this.snake, d);
        if (this.snake.length <= 4 || this.pathDir(after[0], after[after.length - 1], after)) {
          choice = d;
        }
      }

      if (!choice) {
        let best = -1;
        for (const cand of this.DIRS) {
          if (cand.x === back.x && cand.y === back.y) continue;
          const room = this.openSpace(this.snake, cand);
          if (room > best) { best = room; choice = cand; }
        }
      }

      if (choice) this.turn(choice.x, choice.y);
    },

    // First step of a shortest path from `start` to `goal`, or null.
    // The tail cell is walkable — it moves out of the way on the same tick.
    pathDir: function(start, goal, body) {
      const W = this.cols, H = this.rows, N = W * H;
      const blocked = new Uint8Array(N);
      for (let i = 0; i < body.length - 1; i++) blocked[body[i].y * W + body[i].x] = 1;

      const from = new Int32Array(N).fill(-1);
      const seen = new Uint8Array(N);
      const si = start.y * W + start.x, gi = goal.y * W + goal.x;
      if (si === gi) return null;
      seen[si] = 1;
      const q = [si];

      for (let qi = 0; qi < q.length; qi++) {
        const ci = q[qi];
        if (ci === gi) break;
        const cx = ci % W, cy = (ci - cx) / W;
        for (const d of this.DIRS) {
          const nx = (cx + d.x + W) % W, ny = (cy + d.y + H) % H;
          const ni = ny * W + nx;
          if (seen[ni] || blocked[ni]) continue;
          seen[ni] = 1; from[ni] = ci; q.push(ni);
        }
      }
      if (!seen[gi]) return null;

      let cur = gi;
      while (from[cur] !== si) {
        if (from[cur] === -1) return null;
        cur = from[cur];
      }
      const cx = cur % W, cy = (cur - cx) / W;
      let dx = cx - start.x, dy = cy - start.y;
      if (dx > 1) dx = -1; else if (dx < -1) dx = 1;
      if (dy > 1) dy = -1; else if (dy < -1) dy = 1;
      return { x: dx, y: dy };
    },

    advance: function(body, d) {
      const next = [this.step(body[0], d)].concat(body);
      next.pop();
      return next;
    },

    // Flood-fill reachable cells after taking `d` — the tie-breaker that keeps
    // the snake out of pockets it can't get back out of. -1 means instant death.
    openSpace: function(body, d) {
      const W = this.cols, H = this.rows, N = W * H;
      const next = this.advance(body, d);
      const head = next[0];
      for (let i = 1; i < next.length; i++) {
        if (next[i].x === head.x && next[i].y === head.y) return -1;
      }
      const blocked = new Uint8Array(N);
      for (let i = 0; i < next.length - 1; i++) blocked[next[i].y * W + next[i].x] = 1;

      const seen = new Uint8Array(N);
      const si = head.y * W + head.x;
      seen[si] = 1;
      const q = [si];
      for (let qi = 0; qi < q.length; qi++) {
        const ci = q[qi];
        const cx = ci % W, cy = (ci - cx) / W;
        for (const dd of this.DIRS) {
          const nx = (cx + dd.x + W) % W, ny = (cy + dd.y + H) % H;
          const ni = ny * W + nx;
          if (seen[ni] || blocked[ni]) continue;
          seen[ni] = 1; q.push(ni);
        }
      }
      return q.length;
    }
  };

  // ===================================
  // Global Functions
  // ===================================
  window.startGame = function() {
    GameSystem.startGame();
  };

  window.exitGame = function() {
    GameSystem.gameActive = false;
    document.getElementById('hidden-game').style.display = 'none';
    if ((location.hash || '').toLowerCase() === '#arcade') {
      history.replaceState(null, '', location.pathname + location.search);
    }
  };

  // ===================================
  // Device-Aware Theming
  // ===================================
  const DeviceDetect = {
    detect: function() {
      const ua = (navigator.userAgent || '').toLowerCase();
      const w = Math.min(window.innerWidth, window.screen.width || window.innerWidth);
      const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

      const isIPad = /ipad/.test(ua) || (ua.includes('macintosh') && hasTouch);
      const isPhone = /iphone|ipod|android.*mobile|windows phone|blackberry|bb10/.test(ua);
      const isAndroidTablet = /android/.test(ua) && !/mobile/.test(ua);

      if (isPhone || (hasTouch && w < 600)) return 'phone';
      if (isIPad || isAndroidTablet || (hasTouch && w >= 600 && w < 1180)) return 'tablet';
      return 'desktop';
    },

    apply: function() {
      const kind = this.detect();
      document.body.setAttribute('data-device', kind);
      if (!document.querySelector('.device-chip')) {
        const chip = document.createElement('div');
        chip.className = 'device-chip';
        chip.title = 'Detected hardware — site theme adapts';
        const glyph = document.createElement('span');
        glyph.className = 'glyph';
        glyph.textContent = kind === 'desktop' ? '🖥️' : (kind === 'tablet' ? '🖼️' : '📱');
        chip.appendChild(glyph);
        document.body.appendChild(chip);
        }
      let t;
      window.addEventListener('resize', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const next = this.detect();
          if (next !== document.body.getAttribute('data-device')) {
            document.body.setAttribute('data-device', next);
            const g = document.querySelector('.device-chip .glyph');
            if (g) g.textContent = next === 'desktop' ? '🖥️' : (next === 'tablet' ? '🖼️' : '📱');
          }
        }, 200);
      });
    }
  };

  // ===================================
  // Console Easter Egg Hint
  // ===================================
  function consoleHint() {
    try {
      console.log(
        '%c🎮 Secret Arcade %c\n\nThere are hidden pages on this site…\n  · type %ceaster%c anywhere for the arcade (Breakout · Dino · Snake)\n  · no keyboard? open %c#arcade%c or long-press the site name\n  · type %cadmin%c for the visitor panel\n  · in a game: %cP%c pauses, %c🤖 Autopilot%c hands over to the algorithm, %cS%c takes control back\n  · Esc closes them\n',
        'font-size:18px; font-weight:bold; background:linear-gradient(90deg,#22d3ee,#a855f7,#ec4899); -webkit-background-clip:text; color:transparent;',
        'color:#94a3b8; font-size:12px;',
        'color:#22d3ee; font-weight:bold; font-size:12px;',
        'color:#94a3b8; font-size:12px;',
        'color:#4ade80; font-weight:bold; font-size:12px;',
        'color:#94a3b8; font-size:12px;',
        'color:#22d3ee; font-weight:bold; font-size:12px;',
        'color:#94a3b8; font-size:12px;',
        'color:#fbbf24; font-weight:bold; font-size:12px;',
        'color:#94a3b8; font-size:12px;',
        'color:#fbbf24; font-weight:bold; font-size:12px;',
        'color:#94a3b8; font-size:12px;',
        'color:#fbbf24; font-weight:bold; font-size:12px;',
        'color:#94a3b8; font-size:12px;'
      );
    } catch (e) { /* console styling unsupported — fine */ }
  }

  // ===================================
  // Initialize on DOM Load
  // ===================================
  document.addEventListener('DOMContentLoaded', function() {
    DeviceDetect.apply();
    AdminPanel.init();
    GameSystem.init();
    consoleHint();
  });

})();

  /* Hero canvas affordance. */
  (function () {
    function init() {
      var el = document.querySelector('.hero-flow') || document.querySelector('.hero-art');
      if (!el) return;
      el.style.touchAction = 'manipulation';
      el.style.webkitUserSelect = 'none';
      el.style.userSelect = 'none';
      el.style.webkitTouchCallout = 'none';
      // Deliberate sequence: five hits inside 3 s, each within 80 px of the last.
      // A double-tap was too easy to hit by accident while poking the particles.
      var N = 5, WIN = 3000, n = 0, t0 = 0, px = 0, py = 0;
      function bump(x, y, e) {
        var now = Date.now();
        if (now - t0 > WIN || Math.abs(x - px) > 80 || Math.abs(y - py) > 80) n = 0;
        if (n === 0) t0 = now;
        n++; px = x; py = y;
        if (n >= N && now - t0 <= WIN) {
          n = 0;
          if (e && e.cancelable) e.preventDefault();
          if (typeof window.__q === 'function') window.__q();
        }
      }
      el.addEventListener('click', function (e) { bump(e.clientX, e.clientY, e); });
      el.addEventListener('touchend', function (e) {
        var t = (e.changedTouches && e.changedTouches[0]) || {};
        bump(t.clientX || 0, t.clientY || 0, e);
      }, { passive: false });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  })();
