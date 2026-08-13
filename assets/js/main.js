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

    // Bests are per difficulty: an Easy run must not set a bar a Hard run can
    // never clear, and a Hard best should not look poor beside one.
    slot: function(game) { return game + '@' + Difficulty.current; },

    get: function(game) {
      const scores = this.all();
      const slot = this.slot(game);
      if (slot in scores) return scores[slot];
      // Anything recorded before difficulty existed was played on Normal.
      if (Difficulty.current === 'normal' && game in scores) return scores[game];
      return 0;
    },

    submit: function(game, score) {
      const scores = this.all();
      const slot = this.slot(game);
      if (score > this.get(game)) {
        scores[slot] = score;
        try { localStorage.setItem(this.KEY, JSON.stringify(scores)); } catch (e) {}
        return true;
      }
      return false;
    }
  };

  // ===================================
  // Arcade: Difficulty
  // One setting for all three games, remembered between visits. Normal is
  // exactly what the arcade shipped as, so the middle option is not a new
  // balance nobody has played.
  // ===================================
  const Difficulty = {
    KEY: 'arcadeDifficulty',
    ORDER: ['baby', 'easy', 'normal', 'hard'],
    LABEL: { baby: 'Baby', easy: 'Easy', normal: 'Normal', hard: 'Hard' },

    current: (function() {
      try {
        const v = localStorage.getItem('arcadeDifficulty');
        return (v === 'baby' || v === 'easy' || v === 'hard') ? v : 'normal';
      } catch (e) { return 'normal'; }
    })(),

    set: function(v) {
      if (this.ORDER.indexOf(v) < 0) return;
      this.current = v;
      try { localStorage.setItem(this.KEY, v); } catch (e) {}
    },

    // Indestructible is orthogonal to the three tiers: it changes what the
    // board is made of, not how fast the ball moves, so you still pick easy,
    // normal or hard underneath it.
    IND_KEY: 'arcadeIndestructible',
    indestructible: (function() {
      try { return localStorage.getItem('arcadeIndestructible') === '1'; } catch (e) { return false; }
    })(),

    setIndestructible: function(on) {
      this.indestructible = !!on;
      try { localStorage.setItem(this.IND_KEY, this.indestructible ? '1' : '0'); } catch (e) {}
    },

    // pick({easy: a, normal: b, hard: c})
    pick: function(table) {
      return table[this.current] !== undefined ? table[this.current] : table.normal;
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
  // Arcade: Paint
  // Shared shading so the three games stop looking like flat swatches. Every
  // solid shape goes through bevel(), which lights the top edge and shadows
  // the bottom, so a brick reads as an object with a thickness to it.
  // ===================================
  const Paint = {
    _cache: {},

    // Scale a #rrggbb toward white (t > 0) or black (t < 0).
    shade: function(hex, t) {
      const key = hex + '|' + t;
      if (this._cache[key]) return this._cache[key];
      let r = 128, g = 128, b = 128;
      if (/^#[0-9a-f]{6}$/i.test(hex)) {
        r = parseInt(hex.slice(1, 3), 16);
        g = parseInt(hex.slice(3, 5), 16);
        b = parseInt(hex.slice(5, 7), 16);
      }
      const mix = (c) => Math.max(0, Math.min(255, Math.round(t > 0 ? c + (255 - c) * t : c * (1 + t))));
      const out = 'rgb(' + mix(r) + ',' + mix(g) + ',' + mix(b) + ')';
      this._cache[key] = out;
      return out;
    },

    path: function(ctx, x, y, w, h, r) {
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    },

    bevel: function(ctx, x, y, w, h, r, color, lift) {
      const up = lift === undefined ? 0.34 : lift;
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, this.shade(color, up));
      g.addColorStop(0.45, color);
      g.addColorStop(1, this.shade(color, -0.34));
      this.path(ctx, x, y, w, h, r);
      ctx.fillStyle = g;
      ctx.fill();
      // A thin gloss along the top edge sells the curve.
      ctx.save();
      ctx.globalAlpha = 0.35;
      this.path(ctx, x + 1.5, y + 1.5, Math.max(0, w - 3), Math.max(0, h * 0.34), Math.max(1, r - 1));
      ctx.fillStyle = this.shade(color, 0.65);
      ctx.fill();
      ctx.restore();
    },

    // A soft ball with a highlight offset toward the light.
    orb: function(ctx, x, y, radius, color) {
      const g = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.15,
                                         x, y, radius);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.45, this.shade(color, 0.25));
      g.addColorStop(1, this.shade(color, -0.25));
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }
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
      breakout: 'Arrows / mouse / drag — 10 boards, each rolling a modifier · ? = mystery, KEY clears a row · dodge the red capsules · the wall creeps down',
      dino: 'Space/⬆️ jump · a 2nd is free; a 3rd to 5th only at the top of the arc · ⬇️ duck',
      snake: 'Arrows / WASD / swipe — edges wrap around · gold +50 · ✂️ trims your tail',
      lawn: '1–5 pick a seed · arrows move, space plants · plant ONTO a plant to FUSE it — shooter+bomb is a Cherryshooter, repeater+shooter a Gatling, bomb+three a Phoenix · 8 seeds, 14 recipes · click a sun to bank it · each lane has one mower, and that is your last life'
    },

    // Same games, described in the gestures a phone actually has.
    TOUCH_HINTS: {
      breakout: 'Drag or hold ⬅ ➡ — 10 boards, each rolling a modifier · ? = mystery, KEY clears a row · dodge the red capsules · the wall creeps down',
      dino: 'Tap to jump · a 2nd is free; a 3rd to 5th only at the top of the arc · hold ⬇ to duck',
      snake: 'Swipe or use the pad — edges wrap around · gold +50 · ✂️ trims your tail',
      lawn: 'Tap a seed, then a tile to plant · tap a tile you already own to FUSE — shooter+bomb is a Cherryshooter, repeater+shooter a Gatling, bomb+three a Phoenix · 8 seeds, 14 recipes · tap falling suns to bank them · each lane has one mower, and that is your last life'
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
      this.games = { breakout: Breakout, dino: DinoGame, snake: SnakeGame, lawn: LawnGame };
      this.setupGameSequence();
      this.setupControls();
      this.setupPointer();
      this.injectDifficulty();
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
    // got — so the keyboard-free way in is a long-press on the site name.
    //
    // There used to be a #arcade hash as well. It has been removed on purpose:
    // a URL anyone can paste, that search engines can index and that turns up
    // in a shared link, is not a hidden thing. Both remaining ways in are
    // something you have to do rather than something you can be handed.
    setupMobileEntry: function() {
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
      const names = { breakout: 'Breakout', dino: 'Dino', snake: 'Snake', lawn: 'Lawn Siege' };
      el.textContent = '🏆 ' + Difficulty.LABEL[Difficulty.current] + ':  ' + Object.keys(names)
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

    injectDifficulty: function() {
      const controls = document.getElementById('gameControls');
      if (!controls || document.getElementById('difficultySelect')) return;
      const label = document.createElement('label');
      label.setAttribute('for', 'difficultySelect');
      label.textContent = 'Difficulty:';
      const sel = document.createElement('select');
      sel.id = 'difficultySelect';
      Difficulty.ORDER.forEach((k) => {
        const o = document.createElement('option');
        o.value = k;
        o.textContent = Difficulty.LABEL[k];
        if (k === Difficulty.current) o.selected = true;
        sel.appendChild(o);
      });
      sel.value = Difficulty.current;
      sel.addEventListener('change', (e) => {
        Difficulty.set(e.target.value);
        // Difficulty is baked in at init(), so a game already running would
        // keep the old dials. Restart it rather than pretend the change took.
        if (this.gameActive) this.startGame();
        this.refreshMeta();
      });
      controls.appendChild(label);
      controls.appendChild(sel);

      // Orthogonal to the tier, so it is a switch rather than a fourth option.
      const wrap = document.createElement('label');
      wrap.id = 'indestructibleWrap';
      wrap.className = 'ind-toggle';
      wrap.title = 'Bury the board in indestructible tiles. The only ways through are '
                 + 'quirks of the engine: thread a 6px seam, walk a blast diagonally, '
                 + 'or clear a row through the steel with a keystone.';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.id = 'indestructibleToggle';
      box.checked = Difficulty.indestructible;
      box.addEventListener('change', (e) => {
        Difficulty.setIndestructible(e.target.checked);
        if (this.gameActive) this.startGame();
        this.refreshMeta();
      });
      const cap = document.createElement('span');
      cap.textContent = 'Indestructible';
      wrap.appendChild(box);
      wrap.appendChild(cap);
      controls.appendChild(wrap);
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
        // Everything in `ind` describes the BREAKOUT wall -- the steel vault, the
        // lit columns, the seekers. It was being appended whatever was selected,
        // so Dino and Snake had both been telling the reader to dodge a column
        // that is not in their game. Only Breakout gets it.
        const isBreakout = this.currentGame === 'breakout';
        const ind = !isBreakout ? '' : Difficulty.indestructible
          ? ' · INDESTRUCTIBLE: a pyramid, a disc, a ring — steel that never breaks,'
            + ' several courses thick, with everything worth hitting sealed inside it.'
            + ' Thread a 6px seam through the shell or clip a corner on a true diagonal;'
            + ' once you are in, the shell that kept you out keeps the ball in.'
            + ' A blast rings the steel around it open for a moment, and a KEY clears'
            + ' the row the vault is sitting in'
            + (Difficulty.current === 'easy' ? ''
               : '. It shoots back — a lit column means move, and a seeker can be shot down')
          : (Difficulty.current === 'easy' ? ''
             : ' · the wall shoots back — dodge a lit column, shoot the seekers down');
        hintEl.textContent = Difficulty.LABEL[Difficulty.current] + ind + ' · ' + base + (touch
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
  // A very small convolutional policy for choosing WHERE to send the ball.
  //
  // A CNN is the right shape for this and a language model is not: the brick
  // field is literally a 2D grid, and "is this column worth hitting" depends on
  // a local neighbourhood -- what is stacked above it, what is beside it,
  // whether a charge sits nearby. That is exactly what a 3x3 kernel encodes,
  // and it is what the hand-written weighted-centroid below approximates with a
  // single global average.
  //
  // What it deliberately does NOT do is predict the ball. The planner already
  // unfolds wall bounces and simulates the real collision exactly; asking a
  // network to learn an approximation of physics the program can compute
  // exactly would be strictly worse. So the split is:
  //
  //     exact physics  ->  where the ball will go
  //     learned        ->  where it is worth sending it
  //
  // 4 kernels of 3x3, one hidden channel each, mean-pooled down columns and
  // mixed to a per-column score: 36 + 4 + 128 + 8 = 176 weights. Small enough
  // to ship as JSON and to evaluate every frame without being felt.
  //
  // With no weights it returns null and every caller falls back to the
  // hand-written heuristic, so the game is never broken by a missing or bad
  // policy file -- and a trained policy has to beat that heuristic on held-out
  // seeds before the workflow will commit it.
  const ConvPolicy = {
    // Three things about each cell of the board, not one.
    //
    //   worth      what is there to gain -- a charge or a keystone is worth
    //              more than a plain brick, and a brick that dies in one hit is
    //              worth more than one that needs three
    //   toughness  how much work it is, which the value channel deliberately
    //              hides: those are different questions and squashing them into
    //              one number was throwing away the difference
    //   threat     what is being shot at you from there, and what is already in
    //              the air -- a lit column, a seeker on its way down, a mine
    //              sitting on the floor
    //
    // Plus six scalars the grid cannot express at all: where the ball is and
    // where it is going, where the bat is, how fast the ball has become, and
    // how far through the board you are. The first version saw only the value
    // grid, which meant it could not tell a board it was winning from one that
    // was shooting at it.
    //
    // 4 kernels x 3x3 x 3 channels = 108, the column mix 128, the scalar mix
    // 48: 284 weights. Still small enough to ship as JSON and to run every
    // frame without being felt.
    COLS: 8, ROWS: 4, K: 4, CH: 3, S: 6,
    weights: null,
    fetched: false,
    ensure: function() {
      if (this.fetched || typeof fetch !== 'function') return;
      this.fetched = true;
      fetch(this.URL || 'assets/js/arcade-policy.json')
        .then((r) => (r.ok ? r.json() : null))
        .then((w) => { if (w) this.load(w); })
        .catch(() => {});
    },
    sizes: function() {
      return { nk: this.K * 9 * this.CH,
               no: this.K * this.ROWS * this.COLS,
               ns: this.S * this.COLS };
    },
    load: function(w) {
      const n = this.sizes();
      if (!w || !Array.isArray(w.k) || w.k.length !== n.nk) return false;
      if (!Array.isArray(w.o) || w.o.length !== n.no) return false;
      if (!Array.isArray(w.s) || w.s.length !== n.ns) return false;
      this.weights = w;
      return true;
    },

    observe: function(B, canvasW, canvasH) {
      const R = this.ROWS, C = this.COLS;
      const g = new Float32Array(this.CH * R * C);
      let top = Infinity, bot = 0;
      for (const b of B.bricks) {
        if (b.hp <= 0 || b.kind === 'steel') continue;
        if (b.y < top) top = b.y;
        if (b.y + b.h > bot) bot = b.y + b.h;
      }
      if (!isFinite(top) || bot <= top) return null;
      const cell = (x, y) => {
        const c = Math.min(C - 1, Math.max(0, Math.floor(x / canvasW * C)));
        const r = Math.min(R - 1, Math.max(0, Math.floor((y - top) / (bot - top) * R)));
        return r * C + c;
      };
      for (const b of B.bricks) {
        if (b.hp <= 0 || b.kind === 'steel') continue;
        const i = cell(b.x + b.w / 2, b.y);
        g[i] += (b.kind === 'boom' ? 5 : b.kind === 'key' ? 4
               : b.kind === 'mystery' ? 3 : 1) / b.hp;
        g[R * C + i] += b.hp;
      }
      const T = 2 * R * C;
      for (const beam of (B.beams || [])) {
        if (beam.fired) continue;
        const c = Math.min(C - 1, Math.max(0, Math.floor(beam.x / canvasW * C)));
        for (let r = 0; r < R; r++) g[T + r * C + c] += 1;
      }
      for (const sk of (B.seekers || [])) g[T + cell(sk.x, Math.max(top, Math.min(bot, sk.y)))] += 1.5;
      for (const m of (B.mines || [])) g[T + (R - 1) * C +
        Math.min(C - 1, Math.max(0, Math.floor(m.x / canvasW * C)))] += 2;

      for (let ch = 0; ch < this.CH; ch++) {
        let m = 0;
        for (let i = 0; i < R * C; i++) m = Math.max(m, g[ch * R * C + i]);
        if (m > 0) for (let i = 0; i < R * C; i++) g[ch * R * C + i] /= m;
      }

      const ball = (B.balls && B.balls[0]) || null;
      const sc = new Float32Array(this.S);
      if (ball) {
        sc[0] = ball.x / canvasW - 0.5;
        sc[1] = ball.y / canvasH - 0.5;
        const v = Math.hypot(ball.dx, ball.dy) || 1;
        sc[2] = ball.dx / v;
        sc[3] = ball.dy / v;
        sc[4] = Math.min(2, v / (B.tier ? B.tier.speed : 6)) - 1;
      }
      sc[5] = B.initialBricks ? (B.bricksLeft() / B.initialBricks) - 0.5 : 0;
      return { g, sc };
    },

    columnScores: function(B, canvasW, canvasH) {
      if (!this.weights) return null;
      const obs = this.observe(B, canvasW, canvasH);
      if (!obs) return null;
      const { k, o, s: sw } = this.weights;
      const R = this.ROWS, C = this.COLS, K = this.K, CH = this.CH;
      const feat = new Float32Array(K * R * C);
      for (let f = 0; f < K; f++) {
        for (let r = 0; r < R; r++) {
          for (let c = 0; c < C; c++) {
            let acc = 0;
            for (let ch = 0; ch < CH; ch++) {
              for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                  const rr = r + dr, cc = c + dc;
                  if (rr < 0 || rr >= R || cc < 0 || cc >= C) continue;
                  acc += obs.g[ch * R * C + rr * C + cc] *
                         k[(f * CH + ch) * 9 + (dr + 1) * 3 + (dc + 1)];
                }
              }
            }
            feat[f * R * C + r * C + c] = acc > 0 ? acc : 0;
          }
        }
      }
      const out = new Float32Array(C);
      for (let c = 0; c < C; c++) {
        let acc = 0;
        for (let f = 0; f < K; f++) {
          for (let r = 0; r < R; r++) acc += feat[f * R * C + r * C + c] * o[(f * R + r) * C + c];
        }
        for (let i = 0; i < this.S; i++) acc += obs.sc[i] * sw[i * C + c];
        out[c] = acc;
      }
      return out;
    },

    goalX: function(B, canvasW, canvasH) {
      const sc = this.columnScores(B, canvasW, canvasH);
      if (!sc) return null;
      let best = -Infinity, at = -1;
      for (let c = 0; c < sc.length; c++) if (sc[c] > best) { best = sc[c]; at = c; }
      if (at < 0 || !(best > 0)) return null;
      return (at + 0.5) / this.COLS * canvasW;
    }
  };

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
    beams: [],
    seekers: [],
    mines: [],
    nextBeamAt: 0,
    nextSeekAt: 0,
    beamFlash: 0,
    stunUntil: 0,
    cols: 11,
    initialBricks: 0,
    mutator: null,
    driftPhase: 0,
    GALE: 0.045,

    // Every level from the third rolls a modifier, announced with the board
    // name. Ten layouts times six modifiers is enough that you stop being able
    // to predict what you are walking into.
    MUTATORS: [
      { key: 'iron',     name: 'IRON',     blurb: 'every brick is tougher' },
      { key: 'frenzy',   name: 'FRENZY',   blurb: 'capsules everywhere' },
      { key: 'drift',    name: 'DRIFT',    blurb: 'the wall slides' },
      { key: 'gale',     name: 'GALE',     blurb: 'a crosswind pushes the ball' },
      { key: 'blackout', name: 'BLACKOUT', blurb: 'only the ball lights the wall' },
      { key: 'brittle',  name: 'BRITTLE',  blurb: 'one hit kills anything' }
    ],
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

    // Normal is the balance the arcade already had; easy softens every dial
    // that makes it stressful, hard tightens the same ones.
    TIERS: {
      // Baby is easy in every respect but one: the wide paddle reaches 90% of
      // the board rather than half of it, so it really does stop being a thing
      // you aim and becomes a floor. That is the whole point of the tier.
      // Everything else is easy's, written out rather than aliased so a later
      // change to easy cannot silently change what baby means.
      //
      // wide is 4.6 rather than easy's 2.54 because the multiplier has to be
      // large enough for the 90% ceiling to be what actually binds: at 2.54 a
      // 126px bat reaches 320px, which is the same half-board easy already got.
      baby:   { speed: 4.6, max: 12, ramp: 1.12, lives: 5, paddle: 126,
                first: 48000, every: 30000, drop: 0.44, hazard: 0,
                mutFrom: 6, mutChance: 0.35, hpCap: 0,
                wide: 4.6, slow: 0.5, effect: 1.8, netCap: 5, multi: 3, spare: 4,
                beamEvery: 0, beamWarn: 0, wideCap: 0.90 },
      // hazard 0 on easy means the two red capsules are never generated at
      // all, and the rest of the dials make each good capsule do more.
      easy:   { speed: 4.6, max: 12, ramp: 1.12, lives: 5, paddle: 126,
                first: 48000, every: 30000, drop: 0.44, hazard: 0,
                mutFrom: 6, mutChance: 0.35, hpCap: 0,
                wide: 2.54, slow: 0.5, effect: 1.8, netCap: 5, multi: 3, spare: 4,
                beamEvery: 0, beamWarn: 0 },          // easy is never shot at
      normal: { speed: 6.5, max: 18, ramp: 1.18, lives: 3, paddle: 104,
                first: 26000, every: 15000, drop: 0.30, hazard: 1,
                mutFrom: 3, mutChance: 0.72, hpCap: 3,
                wide: 1.77, slow: 0.66, effect: 1, netCap: 3, multi: 2, spare: 3,
                beamEvery: 6000, beamWarn: 1000, repair: true, beamLead: 7 },
      hard:   { speed: 8.2, max: 23, ramp: 1.22, lives: 2, paddle: 86,
                first: 17000, every: 10000, drop: 0.26, hazard: 1.6,
                mutFrom: 2, mutChance: 0.9,  hpCap: 4,
                wide: 1.6, slow: 0.75, effect: 0.8, netCap: 2, multi: 2, spare: 2,
                beamEvery: 5200, beamWarn: 850, repair: true, beamLead: 13,
                beamTwin: true, beamRamp: 0.93 }
    },
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
      const tier = Difficulty.pick(this.TIERS);
      this.tier = tier;
      this.lives = tier.lives;
      // The ceiling, not just the count. 'H' refills up to it; 'E' lifts it.
      this.maxLives = tier.lives + tier.spare;
      this.level = 1;
      this.speed = tier.speed;
      this.MAX_SPEED = tier.max;
      ConvPolicy.ensure();
      this.BASE_W = tier.paddle;
      // Half the board is the ceiling everywhere except baby, which is allowed
      // 90% on purpose.
      this.WIDE_W = Math.min(Math.round(tier.paddle * tier.wide),
                             Math.round(game.canvas.width * (tier.wideCap || 0.5)));
      this.SHRINK_W = Math.round(tier.paddle * 0.65);
      this.DROP_BASE = tier.drop;
      this.DESCEND_FIRST = tier.first;
      this.DESCEND_EVERY = tier.every;
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
      const bonus = Math.min(Math.floor((this.level - 1) / this.LAYOUTS.length), this.tier.hpCap);
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
      // Levels 1 and 2 are played straight, so the first thing you meet is the
      // game rather than a gimmick.
      this.mutator = null;
      this.driftPhase = 0;
      if (this.level >= this.tier.mutFrom && Math.random() < this.tier.mutChance) {
        this.mutator = this.MUTATORS[Math.floor(Math.random() * this.MUTATORS.length)];
        if (this.mutator.key === 'iron') {
          for (const b of this.bricks) {
            if (b.kind === 'normal') b.hp = b.max = Math.min(b.hp + 1, 5);
          }
        } else if (this.mutator.key === 'brittle') {
          for (const b of this.bricks) {
            if (b.kind !== 'steel') b.hp = b.max = 1;
          }
        }
      }
      if (Difficulty.indestructible) {
        this.buryBoard(canvas);
        this.mutator = null;         // the wall is the modifier
        // Getting in at all takes a while, so the first march is slower. After
        // that the clock is real: the sealed pocket sits lowest, so it reaches
        // the danger line first and the blast has to have gone off by then.
        // The steel underneath it crosses the line first and harmlessly, which
        // is the one time in this game that watching the wall cross is fine.
        this.descendAt = performance.now() + this.DESCEND_FIRST * 1.6;
      }
      this.initialBricks = this.bricksLeft();
      this.beamsReset(performance.now());
      this._planX = null;
      this._digCol = null;
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
      const frenzy = this.mutator && this.mutator.key === 'frenzy' ? 0.28 : 0;
      return Math.min(this.DROP_MAX + frenzy,
        this.DROP_BASE + frenzy + Math.max(0, this.combo - 1) * this.DROP_PER_COMBO);
    },

    // Weighted rather than a ladder of thresholds, so difficulty can scale the
    // hazard share without every other boundary having to be recomputed.
    CAPSULE_WEIGHTS: [['W', 21], ['S', 19], ['M', 19], ['P', 8],
                      ['L', 7], ['N', 6], ['H', 4], ['E', 3], ['X', 9], ['R', 7]],

    maybeDropPowerup: function(x, y) {
      if (Math.random() > this.dropChance()) return;
      const scale = this.tier ? this.tier.hazard : 1;
      let total = 0;
      for (const [t, w] of this.CAPSULE_WEIGHTS) total += this.isHazard(t) ? w * scale : w;
      let roll = Math.random() * total;
      let type = 'W';
      for (const [t, w] of this.CAPSULE_WEIGHTS) {
        const weight = this.isHazard(t) ? w * scale : w;
        if (weight <= 0) continue;            // easy generates no hazards at all
        roll -= weight;
        if (roll <= 0) { type = t; break; }
      }
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
        this.effects.slowUntil = now + 9000 * this.tier.effect;
        Fx.text(p.x + p.w / 2, p.y - 6, 'SLOW', '#fbbf24');
      } else if (p.type === 'M') {
        const src = this.balls[0] || this.newBall(p.x, p.y - 40, 2, -this.speed);
        const v = Math.hypot(src.dx, src.dy) || this.speed;
        for (let i = 0; i < this.tier.multi; i++) {
          const spread = (i % 2 ? -1 : 1) * (0.45 + i * 0.15);
          this.balls.push(this.newBall(src.x, src.y, v * spread, -Math.abs(v * 0.8)));
        }
        if (this.balls.length > 8) this.balls.length = 8;
        Fx.text(p.x + p.w / 2, p.y - 6, 'MULTI!', '#a855f7');
      } else if (p.type === 'P') {
        this.effects.pierceUntil = now + 7000 * this.tier.effect;
        Fx.text(p.x + p.w / 2, p.y - 6, 'PIERCE!', '#f472b6');
      } else if (p.type === 'L') {
        this.effects.laserUntil = now + 11000 * this.tier.effect;
        Fx.text(p.x + p.w / 2, p.y - 6, 'LASER!', '#f97316');
      } else if (p.type === 'N') {
        this.effects.net = Math.min(this.effects.net + 1, this.tier.netCap);
        Fx.text(p.x + p.w / 2, p.y - 6, 'NET', '#4ade80');
      } else if (p.type === 'H') {
        if (this.lives < this.maxLives) this.lives++;
        Fx.text(p.x + p.w / 2, p.y - 6, '+1 ❤️', '#ec4899');
      } else if (p.type === 'E') {
        // Raises the ceiling and fills the new slot, so unlike a plain heart it
        // is never wasted for being already full.
        this.maxLives++;
        this.lives++;
        Fx.text(p.x + p.w / 2, p.y - 6, 'MAX ❤️ +1', '#f43f5e');
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
      if (this.effects.slowUntil > now) f *= this.tier.slow;
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

      this.stepDrift();
      this.drawNet(ctx, canvas);
      this.drawDangerLine(ctx, canvas);
      this.drawBricks(ctx, now);
      this.drawBalls(ctx, now);
      this.drawPaddle(ctx, canvas, now);
      this.fireLasers(canvas, now);
      this.drawBolts(ctx, game);
      this.drawPowerups(ctx, canvas, game);
      this.drawHud(ctx, canvas, now);
      this.drawBeams(ctx, canvas, now);
      this.drawSeekers(ctx, now);
      this.drawMines(ctx, now);
      this.stepBalls(canvas, game, now);
      this.bounceBalls();
      this.movePaddle(canvas);
      this.stepBeams(canvas, game, now);
      this.stepSeekers(canvas, game, now);
      this.stepMines(canvas, game, now);
      this.stepRepairs(now);
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

    // DRIFT: the whole wall slides side to side. Amplitude stays inside the
    // 26px margin the grid is centred in, so nothing leaves the board.
    stepDrift: function() {
      if (!this.mutator || this.mutator.key !== 'drift') return;
      const next = this.driftPhase + 0.012;
      const delta = 19 * (Math.sin(next) - Math.sin(this.driftPhase));
      this.driftPhase = next;
      for (const b of this.bricks) b.x += delta;
    },

    galeAccel: function() {
      return this.mutator && this.mutator.key === 'gale' ? this.GALE : 0;
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
      const now = performance.now();
      for (const brick of this.bricks) {
        if (brick.hp <= 0) continue;
        if (this.isRung(brick, now)) continue;      // the hole is open to bolts as well
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
      b.hurtAt = performance.now();          // the repair clock starts here

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
      const now = performance.now();
      while (queue.length) {
        const src = queue.shift();
        this.ringSteel(src, now);
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
      } else if (this.tier.hazard > 0) {
        // The reason you hesitate before aiming at one.
        this.powerups.push({ x: cx - 18, y: cy, w: 36, h: 17, vy: 2.6,
                             type: Math.random() < 0.5 ? 'X' : 'R' });
        Fx.text(cx, cy - 6, 'UH OH…', '#ef4444');
        SFX.beep(180, 0.18, 'sawtooth', 0.1, 90);
      } else {
        // Easy has no bad outcomes anywhere, mystery bricks included.
        this.effects.net = Math.min(this.effects.net + 1, this.tier.netCap);
        Fx.text(cx, cy - 6, 'NET', '#4ade80');
        SFX.powerup();
      }
    },

    checkLevelClear: function(game) {
      if (this.bricksLeft() > 0) return false;
      this.level++;
      this.speed = Math.min(this.speed * this.tier.ramp, this.MAX_SPEED);
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
      let hud = 'Level ' + this.level + ' · ' + this.layoutName +
                (this.mutator ? ' · ' + this.mutator.name : '') +
                ' · ' + this.bricksLeft() + ' left';
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
      const full = Math.max(0, this.lives);
      const empty = Math.max(0, (this.maxLives || full) - full);
      ctx.fillText('❤️'.repeat(full) + '🖤'.repeat(Math.min(empty, 6)), canvas.width - 12, 24);

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
        ctx.fillText('LEVEL ' + this.level, canvas.width / 2, canvas.height / 2 - 26);
        ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#22d3ee';
        ctx.fillText(this.layoutName, canvas.width / 2, canvas.height / 2 + 4);
        if (this.mutator) {
          ctx.font = 'bold 17px "Segoe UI", Arial, sans-serif';
          ctx.fillStyle = '#f59e0b';
          ctx.fillText(this.mutator.name + ' — ' + this.mutator.blurb,
                       canvas.width / 2, canvas.height / 2 + 32);
        }
        ctx.globalAlpha = 1;
      }
    },

    drawBricks: function(ctx, now) {
      const dark = this.mutator && this.mutator.key === 'blackout';
      for (const b of this.bricks) {
        if (b.hp <= 0) continue;
        if (dark) {
          // Lit by proximity to the nearest ball, floored so the board is
          // readable rather than a guessing game.
          let d = Infinity;
          for (const ball of this.balls) {
            d = Math.min(d, Math.hypot(ball.x - (b.x + b.w / 2), ball.y - (b.y + b.h / 2)));
          }
          ctx.globalAlpha = Math.max(0.18, Math.min(1, 1 - (d - 90) / 240));
        }
        Paint.bevel(ctx, b.x, b.y, b.w, b.h, 4, this.brickColor(b),
                    b.kind === 'steel' ? 0.22 : 0.34);

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
      ctx.globalAlpha = 1;
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

        Paint.orb(ctx, ball.x, ball.y, ball.radius,
                  hot ? '#f59e0b' : (pierce ? '#f472b6' : (slow ? '#fbbf24' : ball.color)));
      });
    },

    drawPaddle: function(ctx, canvas, now) {
      const pX = this.paddle.x;
      const pY = canvas.height - this.paddle.height - 4;
      if (this.beamFlash > 0) this.beamFlash--;
      const pc = this.beamFlash > 0 ? '#f43f5e'
               : this.effects.shrinkUntil > now ? '#ef4444'
               : (this.effects.wide ? '#67e8f9' : this.paddle.color);
      // A glow under the paddle so it reads as lit rather than pasted on.
      ctx.save();
      ctx.shadowColor = pc;
      ctx.shadowBlur = 14;
      Paint.bevel(ctx, pX, pY, this.paddle.width, this.paddle.height, 6, pc, 0.5);
      ctx.restore();
      if (this.effects.laserUntil > now) {
        ctx.fillStyle = '#f97316';
        ctx.fillRect(pX + 5, pY - 5, 6, 5);
        ctx.fillRect(pX + this.paddle.width - 11, pY - 5, 6, 5);
      }
    },

    drawPowerups: function(ctx, canvas, game) {
      const labels = { W: 'W', S: 'S', M: 'M', P: 'P', L: 'L', N: 'N', H: '♥', E: '♥+', X: '✕', R: '»' };
      const colors = { W: '#22d3ee', S: '#fbbf24', M: '#a855f7', P: '#f472b6', L: '#f97316', N: '#4ade80', H: '#ec4899', E: '#f43f5e', X: '#ef4444', R: '#ef4444' };
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
        Paint.bevel(ctx, p.x, p.y, p.w, p.h, hazard ? 2 : 8, colors[p.type], 0.4);
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
    // Two ways through steel that never destroy it -- the shell stays whole,
    // which is the point. Both are deliberate and both are hard on purpose.
    //
    // CORNER CLIP: at a lattice intersection the gaps between four cells cross,
    // and a ball arriving there on a true diagonal is passing through a hole
    // rather than into a face. Needs the centre inside both gaps at once and a
    // genuinely diagonal heading, which is far tighter than the vertical seam.
    clipsCorner: function(ball, b) {
      const pad = this.config.brickPadding;
      const sx = Math.min(Math.abs(ball.x - b.x), Math.abs(ball.x - (b.x + b.w)));
      const sy = Math.min(Math.abs(ball.y - b.y), Math.abs(ball.y - (b.y + b.h)));
      if (sx > pad * 0.9 || sy > pad * 0.9) return false;
      const v = Math.hypot(ball.dx, ball.dy) || 1;
      return Math.abs(ball.dx) > v * 0.45 && Math.abs(ball.dy) > v * 0.45;
    },

    // RUNG STEEL: a blast does not break the steel around it, it rings it, and
    // while it is ringing the ball passes straight through. It opens a hole
    // that closes again, so it is a timing problem: the charge has to already
    // be lit when the ball arrives. It cannot help you get *in* -- nothing
    // explodes until you are already through the face -- only get around.
    RUNG_MS: 2600,
    ringSteel: function(origin, now) {
      for (const n of this.bricks) {
        if (n.kind !== 'steel' || n.hp <= 0) continue;
        if (Math.abs(n.col - origin.col) > 1 || Math.abs(n.row - origin.row) > 1) continue;
        n.rungUntil = now + this.RUNG_MS;
      }
    },
    isRung: function(b, now) { return b.kind === 'steel' && (b.rungUntil || 0) > now; },

    hitBricks: function(ball, game, pierce) {
      const now = performance.now();
      for (const b of this.bricks) {
        if (b.hp <= 0) continue;
        if (ball.x > b.x && ball.x < b.x + b.w && ball.y > b.y && ball.y < b.y + b.h) {
          if (b.kind === 'steel' && (this.isRung(b, now) || this.clipsCorner(ball, b))) {
            Fx.burst(ball.x, ball.y, '#38bdf8', 5, 1.8);
            continue;                       // through it, and it is still there
          }
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

    // The wall patches itself. A brick left half-broken for long enough takes a
    // hit point back, up to what it started with.
    //
    // This is the fight-back that changes how you play rather than what you
    // dodge: chipping at everything a bit now loses to finishing one thing at a
    // time, and a tough brick you keep abandoning is never going to fall. It is
    // deliberately slow and it never resurrects a dead brick, so it can stall a
    // level but cannot make one unwinnable.
    REPAIR_AFTER: 7000,
    REPAIR_EVERY: 2600,
    stepRepairs: function(now) {
      if (!this.tier || !this.tier.repair) return;
      if (now < (this.nextRepairAt || 0)) return;
      this.nextRepairAt = now + this.REPAIR_EVERY;
      for (const b of this.bricks) {
        if (b.hp <= 0 || b.hp >= b.max) continue;      // dead, or already whole
        if (b.kind === 'steel') continue;
        if (now - (b.hurtAt || 0) < this.REPAIR_AFTER) continue;
        b.hp++;
        b.hurtAt = now;
        b.mended = 14;
        SFX.beep(420, 0.06, 'sine', 0.05, 620);
        Fx.burst(b.x + b.w / 2, b.y + b.h / 2, '#4ade80', 6, 1.6);
      }
    },

    // Balls bounce off each other. Multiball used to be several balls sharing a
    // board and ignoring one another, which reads as a rendering trick rather
    // than as objects; two of them meeting and going their separate ways is
    // what makes it look like a real table.
    //
    // Equal masses, so an elastic collision is just an exchange of the velocity
    // component along the line between the centres -- the perpendicular
    // component of each is untouched. They are also pushed apart to exactly
    // touching first, because resolving the overlap after the swap is what
    // makes pairs stick together and jitter.
    bounceBalls: function() {
      const n = this.balls.length;
      if (n < 2) return;
      for (let i = 0; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = this.balls[i], b = this.balls[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          const min = a.radius + b.radius;
          let d = Math.hypot(dx, dy);
          if (d >= min) continue;
          if (d < 1e-6) { dx = 1; dy = 0; d = 1; }      // exactly co-located
          const nx = dx / d, ny = dy / d;

          const push = (min - d) / 2 + 0.01;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;

          const va = a.dx * nx + a.dy * ny;
          const vb = b.dx * nx + b.dy * ny;
          if (va - vb <= 0) continue;                   // already separating
          a.dx += (vb - va) * nx; a.dy += (vb - va) * ny;
          b.dx += (va - vb) * nx; b.dy += (va - vb) * ny;

          SFX.beep(520, 0.05, 'triangle', 0.07, 640);
          Fx.burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#e0e7ff', 6, 1.8);
        }
      }
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
        const gale = this.galeAccel();
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

          if (gale) ball.dx += gale / steps;

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
      if (performance.now() < (this.stunUntil || 0)) return;   // pinned by a beam
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
        arrivals.push({ t: t, x: this.predictX(b, t, canvas, factor),
                        v: Math.hypot(b.dx, b.dy) });
      }
      arrivals.sort((a, b) => a.t - b.t);
      // Slack in "can I get there", as a fraction of the bat's own width.
      //
      // Two attempts to make this speed-aware both measured worse and are not
      // here: shrinking the slack as the ball outruns its tier, and clamping
      // the target to what the bat could reach in the time left. The reason is
      // that this test is ALREADY speed-aware in the only way that matters --
      // t is distance over the ball's own velocity, so it falls as the ball
      // speeds up and step*t tightens on its own.
      //
      // The misses at high speed are real (median run speed about 12, median
      // speed at the moment of a miss 22) but they are not an aiming mistake to
      // be corrected. They are the ball outrunning the bat, which no choice of
      // target can fix.
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
          // Plan the shot whenever there is a single ball to plan for.
          //
          // This used to be fenced behind two more conditions -- not while the
          // board is dense enough to tunnel, and not when the ball arrives in
          // under 14 frames -- on the reasoning that digging a channel beats
          // any single shot and that a near arrival leaves no time to be clever.
          // Both were wrong, and expensively so: they handed most frames to
          // aimBias, which aims at a weighted centre of mass. Removing them is
          // worth several levels on almost every row.
          //
          // The `arrivals.length === 1` guard stays. Removing that as well was
          // measured separately and is not an improvement -- with several balls
          // in play the planner optimises for one of them and the others are
          // what kill you.
          const planned = (arrivals.length === 1)
            ? this.plannedShot(canvas, pick, centre, step, now)
            : null;
          target = planned !== null ? planned
                                    : stand - this.aimBias(stand, pick.t, canvas, now);
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

      if (Difficulty.indestructible && pick) {
        const aim = this.seamAim(canvas, stand, target);
        if (aim !== null) target = aim;
      }
      // Last, so nothing downstream can put the paddle back under a turret.
      target = this.beamClamp(target, canvas, now);
      if (now < (this.stunUntil || 0)) return;                 // pinned by a beam
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
        // Always worth something: it lifts the ceiling even when already full.
        case 'E': return this.lives >= this.maxLives ? 55 : 45;
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

    // --- INDESTRUCTIBLE --------------------------------------------------
    // The whole grid is steel, which the ball cannot break, the laser cannot
    // drill and the blast will not touch. The only things that can be
    // destroyed are sealed inside it, and every route to them is a property of
    // this engine rather than a move the game teaches you:
    //
    //   the seam    bricks sit 6px apart and collision tests the ball's centre
    //               against a rectangle, so a centre travelling down a seam
    //               touches nothing and comes out above the wall. Verified:
    //               ±3px of the seam and under dx/dy = 0.02, about 1.1 degrees
    //               off vertical. That is the way in, and there is no other,
    //               because with no brick broken there is no capsule either.
    //   the chain   a blast reaches all eight neighbours, diagonals included,
    //               and chains through explosives. A diagonal staircase of them
    //               therefore walks straight down through solid steel.
    //   the row     a keystone clears every breakable in its row and skips the
    //               steel between, so it reaches things walled off from it.
    //   the bolt    laser bolts are points too, so they thread the same seam
    //               once you have earned a capsule.
    //
    // A board of nothing but steel would report zero bricks left and complete
    // itself, so the targets are real and have to be reached.
// Six shapes rather than one slab. The rules that make the mode work are
    // structural, not decorative, so every shape has to keep them: nothing on
    // the bottom row (it would be open from underneath), a keystone and a boom
    // on the top row (the only row a ball can ever touch), a vault that only a
    // row collapse can realistically clear, and every sealed target within
    // blast reach of a chain rooted in that top-row boom. The tests verify all
    // of that for each shape rather than trusting this table.
    //
    //   f  the reachable face, [col, kind, hp]      -- always row 0
    //   d  everything sealed inside, [col, row, kind, hp]
// Not a slab. The steel is a *shape* -- a pyramid, a disc, a ring -- with a
    // shell several tiles thick and a hollow inside, and the targets live in
    // that hollow. Nothing is buried in solid rock any more.
    //
    // It plays completely differently from the filled grid it replaces. The
    // shape does not span the canvas, so the ball can go round it, and going
    // round gains nothing: the shell is closed on every side. What it does gain
    // is angles -- the thing can be attacked from above and from the sides, not
    // only from underneath.
    //
    // And once through, the ball is *inside*. It rattles around the cavity
    // hitting things from directions the old board never allowed, and the shell
    // that kept it out now keeps it in. Breaching is the whole game; after that
    // the shape does the work for you.
    //
    //   inside(c, r)  which cells the form occupies, in grid coordinates
    //   layers        how many tiles thick the shell is -- 2 means a seam has
    //                 to line up through two courses of steel, not one
    IND_FORMS: [
      { name: 'PYRAMID', cols: 11, rows: 9, layers: 2,
        inside: (c, r, C, R) => Math.abs(c - (C - 1) / 2) <= (r + 1) * (C / 2) / R },

      { name: 'DISC', cols: 11, rows: 9, layers: 2,
        inside: (c, r, C, R) => {
          const dc = (c - (C - 1) / 2) / (C / 2), dr = (r - (R - 1) / 2) / (R / 2);
          return dc * dc + dr * dr <= 1;
        } },

      { name: 'DIAMOND', cols: 11, rows: 9, layers: 2,
        inside: (c, r, C, R) =>
          Math.abs(c - (C - 1) / 2) / (C / 2) + Math.abs(r - (R - 1) / 2) / (R / 2) <= 1 },

      { name: 'VAULT', cols: 11, rows: 6, layers: 2,
        inside: (c, r, C, R) => c >= 1 && c <= C - 2 && r >= 0 && r <= R - 1 },

      { name: 'HOURGLASS', cols: 11, rows: 8, layers: 1,
        inside: (c, r, C, R) => {
          const dr = Math.abs(r - (R - 1) / 2) / (R / 2);
          return Math.abs(c - (C - 1) / 2) <= (0.35 + dr) * (C / 2);
        } },

      { name: 'ZIGGURAT', cols: 11, rows: 9, layers: 2,
        inside: (c, r, C, R) =>
          Math.abs(c - (C - 1) / 2) <= (C / 2) * (0.34 + 0.66 * Math.floor(r / 2) / Math.floor((R - 1) / 2)) },

      { name: 'CROSS', cols: 11, rows: 8, layers: 1,
        inside: (c, r, C, R) =>
          Math.abs(c - (C - 1) / 2) <= C * 0.16 || Math.abs(r - (R - 1) / 2) <= R * 0.16 },

      { name: 'ARROW', cols: 11, rows: 9, layers: 2,
        inside: (c, r, C, R) => {
          const half = Math.abs(c - (C - 1) / 2);
          return r < R / 2 ? half <= (r + 1) * (C / 2) / (R / 2) : half <= C * 0.18;
        } }
    ],

    buryBoard: function(canvas) {
      const cfg = this.config;
      const bw = cfg.brickWidth, pad = cfg.brickPadding;
      const form = this.IND_FORMS[(this.level - 1) % this.IND_FORMS.length];
      const C = this.cols = form.cols, R = form.rows;
      const gridW = C * bw + (C - 1) * pad;
      const left = Math.round((canvas.width - gridW) / 2);

      // Which cells the form occupies, then how deep inside it each one is.
      // A cell is shell while it is within `layers` of the outside, and cavity
      // once it is deeper than that.
      const occupied = [];
      for (let r = 0; r < R; r++) {
        occupied[r] = [];
        for (let c = 0; c < C; c++) occupied[r][c] = !!form.inside(c, r, C, R);
      }
      const depth = [];
      for (let r = 0; r < R; r++) {
        depth[r] = [];
        for (let c = 0; c < C; c++) {
          if (!occupied[r][c]) { depth[r][c] = 0; continue; }
          let d = Infinity;
          for (let rr = 0; rr < R && d > 1; rr++) {
            for (let cc = 0; cc < C; cc++) {
              if (occupied[rr][cc]) continue;
              d = Math.min(d, Math.max(Math.abs(rr - r), Math.abs(cc - c)));
            }
          }
          // The grid edge counts as outside too, or a form touching the edge
          // would have no shell along it.
          d = Math.min(d, c + 1, C - c, r + 1, R - r);
          depth[r][c] = d;
        }
      }

      this.bricks = [];
      const cell = (c, r, kind, hp) => {
        const b = {
          col: c, row: r, kind: kind, hp: hp, max: hp,
          x: left + c * (bw + pad),
          y: cfg.brickOffsetTop + r * (cfg.brickHeight + pad),
          w: bw, h: cfg.brickHeight
        };
        this.bricks.push(b);
        return b;
      };

      // Thin the shell rather than end up with a room too small to be worth
      // breaking into. A narrow form -- a pyramid's tip, a diamond's points --
      // is all edge, and two courses of steel would swallow it whole.
      const roomAt = (n) => {
        let k = 0;
        for (let r = 0; r < R; r++) {
          for (let c = 0; c < C; c++) if (occupied[r][c] && depth[r][c] > n) k++;
        }
        return k;
      };
      let layers = form.layers;
      while (layers > 1 && roomAt(layers) < 7) layers--;
      this.indLayers = layers;

      const cavity = [];
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
          if (!occupied[r][c]) continue;
          if (depth[r][c] <= layers) cell(c, r, 'steel', 1);
          else cavity.push({ c: c, r: r });
        }
      }

      // Fill the hollow: one keystone, one vault, one mystery, and charges
      // spread through the rest so a blast still chains inside the room.
      // Deepest first, so the keystone and the vault sit where the ball has to
      // work to reach them. Exactly one of each -- cycling a fixed plan gave a
      // big cavity two keystones and two vaults.
      const face = { easy: 1, normal: 2, hard: 3 }[Difficulty.current] || 2;
      cavity.sort((a, b) => (b.r - a.r) || (a.c - b.c));
      cavity.forEach((slot, i) => {
        if (i === 0) cell(slot.c, slot.r, 'key', 2);
        else if (i === 1) cell(slot.c, slot.r, 'normal', 9);
        else if (i === 2) cell(slot.c, slot.r, 'mystery', 1);
        else if (i % 3 === 0) cell(slot.c, slot.r, 'boom', 1);
        else cell(slot.c, slot.r, 'normal', face);
      });

      this.layoutName = 'INDESTRUCTIBLE · ' + form.name;
    },

    // --- The wall shoots back ---------------------------------------------
    // A board made of something you cannot break is a puzzle, not a fight, so
    // on the buried board the steel takes shots at the paddle.
    //
    // Telegraphed on purpose: a turret lights up its column for the better part
    // of a second before anything is fired, so being hit is a decision you got
    // wrong and never a surprise. It aims where the paddle is standing when it
    // charges, which is what makes it a threat -- standing still is the mistake.
    //
    // Easy never does this. The tier that exists so the mode can be learned is
    // not the tier to add a second thing to dodge to.
    BEAM_W: 10,
    // The ordinary board already has hazard capsules, mutators and a wall
    // coming down; the buried one has none of those and nothing breakable to
    // worry about, so it gets the guns at full rate and everything else is
    // paced back.
    beamGap: function() {
      const every = (this.tier && this.tier.beamEvery) || 0;
      if (!every) return 0;
      const base = Difficulty.indestructible ? every : every * 1.7;
      // Hard tightens as the run goes on, to a floor. A board that fights the
      // same at level 9 as at level 1 stops being the thing making it hard --
      // by then the ball is fast enough to be the whole difficulty on its own,
      // and the guns have become scenery.
      const ramp = this.tier.beamRamp || 0;
      if (!ramp) return base;
      const tighter = base * Math.pow(ramp, Math.max(0, this.level - 1));
      return Math.max(base * 0.45, tighter);
    },
    beamsReset: function(now) {
      this.beams = [];
      this.seekers = [];
      this.mines = [];
      const every = this.beamGap();
      // The first one comes late, so a level does not open under fire.
      this.nextBeamAt = every ? now + every * 1.8 : 0;
      this.nextSeekAt = every ? now + every * 2.6 : 0;
    },

    stepBeams: function(canvas, game, now) {
      if (!this.nextBeamAt) return;
      const warn = this.tier.beamWarn, every = this.beamGap();

      if (now >= this.nextBeamAt) {
        // Lead the target. Aiming where the paddle stands is a threat you beat
        // by walking; aiming where it is going is a threat you beat by
        // changing your mind, which is the harder and more interesting ask.
        // The lead is capped so it stays readable -- the lit column still tells
        // you the truth, it just tells you about the near future.
        const half = this.paddle.width / 2;
        const here = this.paddle.x + half;
        const drift = here - (this.lastPaddleX === undefined ? here : this.lastPaddleX);
        this.lastPaddleX = here;
        const lead = Math.max(-half, Math.min(half, drift * (this.tier.beamLead || 0)));
        const aim = Math.max(half, Math.min(canvas.width - half, here + lead));
        const onlySteel = Difficulty.indestructible;
        let src = null, near = Infinity;
        for (const b of this.bricks) {
          if (b.hp <= 0 || (onlySteel && b.kind !== 'steel')) continue;
          const d = Math.abs(b.x + b.w / 2 - aim);
          if (d < near) { near = d; src = b; }
        }
        if (src) {
          this.beams.push({ x: src.x + src.w / 2, from: src.y + src.h, at: now + warn, fired: 0 });
          SFX.beep(90, 0.18, 'square', 0.07, 150);

          // Hard fires a second column at where you would step to. One turret
          // is answered by moving; two are answered by picking the right way
          // and committing to it, which is a harder question and still a fair
          // one -- both columns light for the same warning, so everything you
          // need is on screen before anything is fired.
          //
          // It aims at the side with more room, because that is the side
          // anything sensible runs to. Never both sides: leaving no answer at
          // all is not difficulty, it is a coin toss.
          if (this.tier.beamTwin) {
            const clear = this.BEAM_W / 2 + half + 4;
            const room = (here - clear) > clear ? -1 : 1;
            const cut = Math.max(half, Math.min(canvas.width - half, here + room * clear * 1.6));
            let alt = null, near2 = Infinity;
            for (const b of this.bricks) {
              if (b.hp <= 0 || (onlySteel && b.kind !== 'steel')) continue;
              const d = Math.abs(b.x + b.w / 2 - cut);
              if (d < near2) { near2 = d; alt = b; }
            }
            if (alt && Math.abs((alt.x + alt.w / 2) - (src.x + src.w / 2)) > this.BEAM_W * 2) {
              this.beams.push({ x: alt.x + alt.w / 2, from: alt.y + alt.h,
                                at: now + warn, fired: 0 });
            }
          }
        }
        this.nextBeamAt = now + every;
      }

      for (let i = this.beams.length - 1; i >= 0; i--) {
        const beam = this.beams[i];
        if (now < beam.at) continue;              // still charging
        if (!beam.fired) {
          beam.fired = now;
          SFX.beep(760, 0.12, 'sawtooth', 0.13, 120);
          Fx.burst(beam.x, canvas.height - 40, '#f43f5e', 14, 3);
          game.shake(4, 8);
          const half = this.BEAM_W / 2;
          const hit = beam.x + half > this.paddle.x &&
                      beam.x - half < this.paddle.x + this.paddle.width;
          if (hit && now > (this.beamSafeUntil || 0)) {
            // Not a life. A turret fires often enough that charging a heart per
            // hit ends the run on arithmetic rather than on play -- measured at
            // roughly eighteen shots a board, which even a 95% dodge turns into
            // a hit every run, and hard only has two hearts. A hit pins the
            // paddle and shrinks it instead: you will probably miss the ball,
            // and losing it that way is a consequence you can still play out of.
            this.beamSafeUntil = now + 1400;      // no double-tap while recovering
            this.stunUntil = now + 520;
            this.effects.shrinkUntil = Math.max(this.effects.shrinkUntil || 0, now + 5000);
            this.beamFlash = 22;
            Haptics.power();
            Fx.text(beam.x, canvas.height - 60, 'PINNED!', '#f43f5e');
          }
        }
        if (now - beam.fired > 160) this.beams.splice(i, 1);
      }
    },

    // --- Seekers ----------------------------------------------------------
    // The turret is a dodge and nothing else: it fires, you are somewhere else,
    // it is over. A second threat should ask a different question, so this one
    // can be shot down.
    //
    // A seeker drifts down slowly and leans toward the paddle, and it is a real
    // object rather than a flash -- the ball kills it, a laser bolt kills it,
    // and killing one is worth points. So it is a threat you can answer with
    // the thing you are already aiming, instead of only running from.
    //
    // It is slow on purpose. The turret punishes standing still; a seeker
    // punishes ignoring it, which is a different mistake.
    SEEK_R: 9,
    SEEK_FALL: 0.62,
    SEEK_HOME: 0.055,
    stepSeekers: function(canvas, game, now) {
      if (!this.nextBeamAt) return;                 // same tiers that get guns
      this.seekers = this.seekers || [];
      if (now >= (this.nextSeekAt || 0)) {
        // Roughly a third as often as the turret, and never more than two out.
        this.nextSeekAt = now + this.beamGap() * 3;
        const live = this.bricks.filter(b => b.hp > 0 &&
          (!Difficulty.indestructible || b.kind === 'steel'));
        if (live.length && this.seekers.length < 2) {
          const src = live[Math.floor(Math.random() * live.length)];
          this.seekers.push({ x: src.x + src.w / 2, y: src.y + src.h, vx: 0, born: now });
          SFX.beep(300, 0.14, 'triangle', 0.08, 220);
        }
      }

      const paddleTop = canvas.height - this.paddle.height - 4;
      const aim = this.paddle.x + this.paddle.width / 2;
      for (let i = this.seekers.length - 1; i >= 0; i--) {
        const s = this.seekers[i];
        s.vx += (aim > s.x ? 1 : -1) * this.SEEK_HOME;
        s.vx = Math.max(-2.2, Math.min(2.2, s.vx));
        s.x += s.vx;
        s.y += this.SEEK_FALL * this.ballFactor(now);
        if (s.x < this.SEEK_R || s.x > canvas.width - this.SEEK_R) s.vx = -s.vx;

        // The ball kills it, and so does a bolt.
        let killed = this.balls.some(b =>
          Math.hypot(b.x - s.x, b.y - s.y) < b.radius + this.SEEK_R);
        if (!killed) {
          for (let j = this.bolts.length - 1; j >= 0; j--) {
            const bolt = this.bolts[j];
            if (Math.abs(bolt.x - s.x) < this.SEEK_R + 3 &&
                Math.abs(bolt.y - s.y) < this.SEEK_R + 8) {
              this.bolts.splice(j, 1);
              killed = true;
              break;
            }
          }
        }
        if (killed) {
          this.seekers.splice(i, 1);
          game.updateScore(game.score + 40);
          SFX.bonus();
          Fx.text(s.x, s.y - 8, '+40', '#a78bfa');
          Fx.burst(s.x, s.y, '#a78bfa', 16, 3);
          continue;
        }

        if (s.y > paddleTop - this.SEEK_R &&
            s.x > this.paddle.x - this.SEEK_R &&
            s.x < this.paddle.x + this.paddle.width + this.SEEK_R) {
          this.seekers.splice(i, 1);
          if (now > (this.beamSafeUntil || 0)) {
            this.beamSafeUntil = now + 1200;
            this.stunUntil = now + 420;
            this.beamFlash = 18;
            game.shake(6, 12);
            Haptics.power();
            Fx.text(s.x, s.y - 10, 'PINNED!', '#f43f5e');
          }
          continue;
        }
        // A seeker that gets past the bat does not simply disappear. It
        // settles on the floor as a mine and takes that strip of the board away
        // from you until it is shot. Dodging one is no longer free -- it costs
        // you room, and room is what the bat is made of.
        if (s.y > paddleTop + 6) {
          this.seekers.splice(i, 1);
          this.mines = this.mines || [];
          if (this.mines.length < 4) {
            this.mines.push({ x: Math.max(14, Math.min(canvas.width - 14, s.x)),
                              y: canvas.height - 8, born: now });
            SFX.beep(120, 0.2, 'sawtooth', 0.08, 90);
          }
        }
      }
    },

    // Mines. They do not move and they do not chase; they simply occupy floor.
    // The ball clears one, so the answer is the same tool as for a seeker, but
    // the pressure is different: a turret asks you to move now, a seeker asks
    // you to deal with it, a mine asks you to give up a piece of the board
    // until you do.
    MINE_R: 11,
    stepMines: function(canvas, game, now) {
      if (!this.mines || !this.mines.length) return;
      const paddleTop = canvas.height - this.paddle.height - 4;
      for (let i = this.mines.length - 1; i >= 0; i--) {
        const m = this.mines[i];
        const hit = this.balls.some((b) =>
          Math.hypot(b.x - m.x, b.y - m.y) < b.radius + this.MINE_R);
        if (hit) {
          this.mines.splice(i, 1);
          game.updateScore(game.score + 60);
          SFX.bonus();
          Fx.text(m.x, m.y - 12, '+60', '#fb923c');
          Fx.burst(m.x, m.y, '#fb923c', 20, 3.4);
          continue;
        }
        if (m.y > paddleTop - this.MINE_R &&
            m.x > this.paddle.x - this.MINE_R &&
            m.x < this.paddle.x + this.paddle.width + this.MINE_R &&
            now > (this.beamSafeUntil || 0)) {
          this.mines.splice(i, 1);
          this.beamSafeUntil = now + 1200;
          this.stunUntil = now + 380;
          this.beamFlash = 16;
          game.shake(7, 12);
          Haptics.power();
          Fx.text(m.x, m.y - 12, 'MINE!', '#fb923c');
        }
      }
    },

    drawMines: function(ctx, now) {
      if (!this.mines || !this.mines.length) return;
      for (const m of this.mines) {
        const t = 0.6 + 0.4 * Math.sin((now - m.born) / 160);
        ctx.save();
        ctx.shadowColor = '#fb923c';
        ctx.shadowBlur = 14 * t;
        Paint.orb(ctx, m.x, m.y, this.MINE_R, '#fb923c');
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.35 * t).toFixed(2) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(m.x, m.y, this.MINE_R + 4 * t, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    },

    drawSeekers: function(ctx, now) {
      if (!this.seekers || !this.seekers.length) return;
      for (const s of this.seekers) {
        const pulse = 0.7 + 0.3 * Math.sin((now - s.born) / 90);
        ctx.save();
        ctx.shadowColor = '#a78bfa';
        ctx.shadowBlur = 12 * pulse;
        Paint.orb(ctx, s.x, s.y, this.SEEK_R, '#a78bfa');
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(s.x, s.y, this.SEEK_R * 0.34 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    },

    drawBeams: function(ctx, canvas, now) {
      if (!this.beams || !this.beams.length) return;
      const half = this.BEAM_W / 2;
      for (const beam of this.beams) {
        const charging = now < beam.at;
        const y0 = beam.from, y1 = canvas.height;
        if (charging) {
          const t = 1 - (beam.at - now) / (this.tier.beamWarn || 1);
          ctx.save();
          ctx.globalAlpha = 0.18 + 0.34 * t;
          ctx.fillStyle = '#f43f5e';
          ctx.fillRect(beam.x - half * (0.4 + t * 0.6), y0, this.BEAM_W * (0.4 + t * 0.6), y1 - y0);
          ctx.restore();
        } else {
          const g = ctx.createLinearGradient(0, y0, 0, y1);
          g.addColorStop(0, 'rgba(255,255,255,0.95)');
          g.addColorStop(1, 'rgba(244,63,94,0.85)');
          ctx.save();
          ctx.fillStyle = g;
          ctx.fillRect(beam.x - half, y0, this.BEAM_W, y1 - y0);
          ctx.restore();
        }
      }
    },

    // Where to stand when several things are aimed at you.
    //
    // The old version walked the threats and returned on the first one it had
    // to avoid. That is correct for a single turret and wrong for anything
    // else: stepping clear of one column can step straight into another, and
    // hard now fires two at once precisely to punish that. It also could not
    // weigh "a little close to two things" against "very close to one", which
    // is the choice that actually comes up.
    //
    // So score positions instead of taking the first that works. Danger is
    // piecewise linear in x, so its minima sit on the boundaries of the
    // keep-out zones -- checking just outside each threat, plus the two edges
    // and the target itself, finds the best position without a search.
    // Ties go to whichever is nearest the target, because being safe is worth
    // nothing if the ball is missed doing it.
    threats: function(canvas) {
      const out = [];
      const paddleTop = canvas.height - this.paddle.height - 4;
      for (const beam of (this.beams || [])) {
        if (!beam.fired) out.push({ x: beam.x, r: this.BEAM_W / 2, weight: 1 });
      }
      // Tried and dropped: with the cannon up a seeker is arguably a target
      // rather than a threat, since bolts leave the bat going straight up and
      // would destroy it for 40 instead of it pinning you. Measured as an
      // exact no-op, because the situation never arises. Counting frames where
      // a seeker is inside this 70px window AND the laser is armed:
      //   ordinary normal 0 of 0, buried normal 0 of 286, buried hard 0 of 1619
      // On the buried board capsules only drop when bricks break and almost
      // nothing breaks until you are inside, so the bot is never armed when a
      // seeker reaches it. Sound idea, wrong game.
      //
      // A follow-up correction, because the first reading of those counters was
      // wrong. Buried hard spends 1619 frames with a seeker in this window and
      // is pinned 24 times in 5 runs, which looked like the dodging failing.
      // It is not: stunUntil is set by beams, seekers AND mines alike, and at
      // the moment of pinning the nearest seeker or mine was usually not on
      // screen at all. Those pins are turret fire.
      //
      // Measured against the beams directly, the dodge is doing well: of 85
      // beams fired on buried hard the bat was under only 8 of them, and 3 of
      // 49 on ordinary hard -- 91% and 94% avoided, against a board that fires
      // two columns at once and tightens with every level. The residual is
      // mostly volleys with no clean answer near an edge.
      for (const sk of (this.seekers || [])) {
        if (paddleTop - sk.y > 70) continue;      // still high; it only follows
        out.push({ x: sk.x, r: this.SEEK_R, weight: 1.2 });
      }
      for (const m of (this.mines || [])) {
        out.push({ x: m.x, r: this.MINE_R, weight: 0.9 });
      }
      return out;
    },

    beamClamp: function(target, canvas, now) {
      const threats = this.threats(canvas);
      if (!threats.length) return target;
      const half = this.paddle.width / 2;
      const lo = half, hi = canvas.width - half;

      const danger = (x) => {
        let worst = 0;
        for (const t of threats) {
          const need = t.r + half + 4;
          const over = need - Math.abs(t.x - x);
          if (over > 0) worst = Math.max(worst, over * t.weight);
        }
        return worst;
      };
      if (danger(target) <= 0) return target;      // already clear; do not move

      const cand = [lo, hi, target];
      for (const t of threats) {
        const need = t.r + half + 4;
        cand.push(t.x - need, t.x + need);
      }
      let best = null, bestD = Infinity, bestGap = Infinity;
      for (const raw of cand) {
        const x = Math.max(lo, Math.min(hi, raw));
        const d = danger(x), gap = Math.abs(x - target);
        if (d < bestD - 1e-6 || (Math.abs(d - bestD) <= 1e-6 && gap < bestGap)) {
          bestD = d; bestGap = gap; best = x;
        }
      }
      return best === null ? target : best;
    },

    // --- Returning the ball on a buried board -----------------------------
    // Aim at the gap, every time. Nothing in this wall can be broken from
    // underneath, so a return that does not put the ball through a seam is a
    // wasted trip by construction -- and measurement agreed: with a blunt
    // "just never go vertical" rule the ball reached the far side of the wall
    // zero times in nine thousand frames, and the single brick that did break
    // was a chance corner clip.
    //
    // Two cases, both closed form.
    //
    //   on a seam   thread it, at the steepest angle that still fits. The gap
    //               is 6px and collision tests the ball's centre, so the centre
    //               may wander half of that across the wall's depth: tan(t) <
    //               3/depth. Take 70% of that -- enough margin to survive the
    //               sub-stepping, still enough drift to come down on a brick
    //               rather than back out of the same seam it went up.
    //   off a seam  the underside of the wall is flat steel, so a miss flips dy
    //               and leaves dx alone: a ball leaving x0 at angle t returns to
    //               the paddle line at x0 + 2*tan(t)*h. That inverts, so the
    //               shot that misses is the one that sets up the next arrival
    //               on a seam. A miss is never wasted either.
    // Thread the gap only where threading pays. Measured at 21 runs a tier:
    //
    //   easy    threading 18/21 boards cleared, not threading 21/21
    //   normal  threading 12/21,               not threading 19/21
    //   hard    threading 21/21,               not threading 12/21
    //
    // The reason is catching, not breaking. A threaded return is near vertical,
    // so the ball comes back down to almost the same x and is nearly
    // self-catching -- which is worth everything when the bat is 86px wide and
    // the ball moves at 8.2, and worth nothing when it is 126px at 4.6, where
    // the wider angles of the fallback simply do more work. So the test is the
    // bat measured against the ball, not the name of the tier.
    threadWorthIt: function() {
      return this.tier && this.tier.paddle / this.tier.speed < 13;
    },
    SEAM_SAFETY: 0.95,
    IND_MIN_SLOPE: 0.18,   // measured best as the fallback; see the note below
    seamAim: function(canvas, stand, target) {
      let left = Infinity, top = Infinity, bottom = 0;
      for (const b of this.bricks) {
        if (b.hp <= 0) continue;
        if (b.x < left) left = b.x;
        if (b.y < top) top = b.y;
        if (b.y + b.h > bottom) bottom = b.y + b.h;
      }
      if (!isFinite(left)) return null;
      const cfg = this.config;
      const pitch = cfg.brickWidth + cfg.brickPadding;
      const gap = cfg.brickPadding / 2;
      const seam = left - gap + Math.round((stand - left + gap) / pitch) * pitch;
      const depth = Math.max(1, bottom - top);
      const half = this.paddle.width / 2;
      const toHit = (tan) => stand - Math.atan(tan) / (Math.PI / 3) * half;

      if (this.threadWorthIt() && Math.abs(stand - seam) <= gap * 0.6) {
        // Lined up. Lean toward whatever is still alive on the reachable row so
        // the ball comes down on something instead of back out of the seam.
        let goal = null, near = Infinity;
        for (const b of this.bricks) {
          if (b.hp <= 0 || b.kind === 'steel' || b.row > 0) continue;
          const d = Math.abs(b.x + b.w / 2 - stand);
          if (d < near) { near = d; goal = b.x + b.w / 2; }
        }
        const dir = (goal === null || goal >= stand) ? 1 : -1;
        return toHit(dir * (gap / depth) * this.SEAM_SAFETY);
      }

      // Off a seam. Steering the next arrival onto one is solvable in closed
      // form -- the wall's underside is flat steel, so a ball leaving x0 at
      // angle t returns to the paddle line at x0 + 2*tan(t)*h -- and it was
      // tried. It does not survive contact with the real bounce: on easy it
      // put an arrival within the gap zero times in nine thousand frames, and
      // it replaced the aim that was keeping the ball alive.
      //
      // So do the thing that measured best instead: never hand the ball back
      // near-vertical. It does not thread, but it keeps the rally going, and
      // the arrivals it produces land on a seam often enough for the branch
      // above to convert them.
      const minHit = Math.atan(this.IND_MIN_SLOPE) / (Math.PI / 3);
      const hit = (stand - target) / half;
      if (Math.abs(hit) >= minHit) return target;
      const away = (stand < canvas.width / 2) ? 1 : -1;
      return stand - away * minHit * half;
    },

    // --- Shot planning ---------------------------------------------------
    // The paddle's contact point sets the outgoing angle, and that is the only
    // decision available — so rather than nudge the bounce toward a weighted
    // average of the board, play the shot out. For each place the paddle could
    // stand, run the real physics forward (walls, bricks, pierce, gale) and
    // count what the ball breaks before it comes back down. One-ply search
    // over the actual game, instead of a heuristic standing in for it.
    SHOT_CANDIDATES: 9,
    SHOT_HORIZON: 200,
    REPLAN_EVERY: 12,

    plannedShot: function(canvas, arrival, centre, step, now) {
      // Simulating is not free, so it runs on a cadence; between plans the
      // paddle simply travels to the point already chosen.
      if (this._planX != null && this.tick - this._planTick < this.REPLAN_EVERY) {
        return this._planX;
      }
      const half = this.paddle.width / 2;
      const reach = step * arrival.t;
      // Contact has to land somewhere on the paddle, and the paddle has to be
      // somewhere it can actually get to in time.
      const lo = Math.max(half, arrival.x - half * 0.92, centre - reach);
      const hi = Math.min(canvas.width - half, arrival.x + half * 0.92, centre + reach);
      if (!(hi > lo)) { this._planX = null; return null; }

      let best = null, bestScore = -1;
      for (let i = 0; i < this.SHOT_CANDIDATES; i++) {
        const px = lo + (hi - lo) * (i / (this.SHOT_CANDIDATES - 1));
        const sc = this.scoreShot(canvas, arrival, px, now);
        if (sc > bestScore) { bestScore = sc; best = px; }
      }
      // A shot that breaks nothing is not a plan. bestScore starts at -1 and
      // scoreShot never returns less than zero, so an all-zero search used to
      // hand back the first candidate -- lo, the left end of the reachable
      // span -- as though it had been chosen, which is a hard right-going shot
      // picked by accident. On a sealed board that was more than half of every
      // decision. Abstaining routes the caller to aimBias and seamAim instead,
      // which is what handled these frames before the planner was unfenced.
      //
      // Deliberately not stamping _planTick here: the null is not cached, so
      // the search is retried next frame. It costs 0.064ms against a 16.7ms
      // budget, and memoising it gives the levels straight back.
      if (bestScore <= 0) { this._planX = null; return null; }
      this._planTick = this.tick;
      this._planX = best;
      return best;
    },

    scoreShot: function(canvas, arrival, px, now) {
      const half = this.paddle.width / 2;
      const paddleTop = canvas.height - this.paddle.height - 4;
      const hit = Math.max(-1, Math.min(1, (arrival.x - px) / half));
      const angle = hit * (Math.PI / 3);
      const v = arrival.v || this.speed;

      let x = arrival.x, y = paddleTop - 12;
      let dx = v * Math.sin(angle);
      let dy = -Math.abs(v * Math.cos(angle));

      const pierce = this.effects.pierceUntil > now;
      const gale = this.galeAccel();
      const factor = this.ballFactor(now);
      const bricks = this.bricks;
      const hp = [];
      for (let i = 0; i < bricks.length; i++) hp.push(bricks[i].hp);

      let score = 0;
      for (let f = 0; f < this.SHOT_HORIZON; f++) {
        const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * factor / this.SUBSTEP));
        for (let n = 0; n < steps; n++) {
          if (x + dx * factor / steps > canvas.width - 10 || x + dx * factor / steps < 10) dx = -dx;
          if (y + dy * factor / steps < 10) dy = -dy;
          if (gale) dx += gale / steps;
          x += dx * factor / steps;
          y += dy * factor / steps;
          if (y > paddleTop) return score;      // shot is over, it is coming back
          for (let i = 0; i < bricks.length; i++) {
            if (hp[i] <= 0) continue;
            const b = bricks[i];
            if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) {
              if (b.kind === 'steel') { dy = -dy; break; }
              if (!pierce) dy = -dy;
              hp[i]--;
              score += 1;                        // credit for chipping it
              if (hp[i] <= 0) {
                // What the kill is worth: explosives and keystones take a
                // chunk of the board with them.
                score += b.kind === 'boom' ? 9 : b.kind === 'key' ? 7
                       : b.kind === 'mystery' ? 4 : 2;
              }
              break;
            }
          }
        }
      }
      return score;
    },

    // Unfold the wall bounces: the path is a triangle wave over the playable
    // span, so one modulo gets the landing point without a stepped simulation.
    // Straight-line extrapolation with the walls unfolded. It does NOT model
    // GALE, and that is deliberate rather than an oversight.
    //
    // Under GALE stepBalls adds `gale` to dx once a frame, so the true
    // displacement is f*(N*dx + gale*N*(N-1)/2) and this is out by the second
    // term -- measured at 36.8px over 40 frames against a 104px bat, which is
    // a big error. Adding the term takes it to 1.7px, so the physics fix
    // works exactly as intended.
    //
    // It also makes the bot play slightly WORSE. Paired A/B, two seed
    // families, n=18-20 a row: ordinary normal -0.72 then -0.25, hard -0.11
    // then -0.55, easy -0.05, buried normal 0.00. Six cells, none positive.
    // Everything downstream -- aimBias, the arrival grouping, plannedShot's
    // reachable span -- was tuned against this predictor's actual behaviour,
    // so correcting one term in isolation moves the aim off what the rest
    // expects. Fixing it properly would mean retuning the aim around it, which
    // is a much larger change than the error justifies given GALE is one
    // mutator among six.
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

      // Learned target selection, when a policy has been trained and shipped.
      // Not while the wall is nearly down: that is a specific emergency the
      // heuristic below handles explicitly, and it is not what the policy was
      // scored on.
      if (!urgent && canvas) {
        const pick = ConvPolicy.goalX(this, canvas.width, canvas.height);
        if (pick !== null) return pick;
      }

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
      const live = Object.keys(cost).filter((c) => cost[c] !== Infinity);
      if (live.length < 3) { this._digCol = null; return null; }

      // Stick with the column already being dug. Re-scoring every frame meant
      // the target moved as bricks broke elsewhere, so several columns ended up
      // half-open and none of them went through — which is the one thing a
      // tunnel has to do.
      let col = this._digCol;
      const stillWorth = col != null && cost[col] !== undefined && cost[col] !== Infinity;
      if (!stillWorth) {
        let best = null, bestScore = Infinity;
        for (const c of live) {
          const n = Number(c);
          const edge = Math.min(n, this.cols - 1 - n);
          const score = cost[c] * 2 + edge;   // shallow first, then edge-most
          if (score < bestScore) { bestScore = score; best = n; }
        }
        col = best;
        this._digCol = col;
      }
      if (col == null) return null;

      const cfg = this.config;
      const gridW = this.cols * cfg.brickWidth + (this.cols - 1) * cfg.brickPadding;
      const left = Math.round((canvas.width - gridW) / 2);
      const colX = left + col * (cfg.brickWidth + cfg.brickPadding) + cfg.brickWidth / 2;

      // Once the channel is actually open, stop aiming at the column and start
      // feeding the ball up it — the payoff is the ball living above the wall,
      // not the bricks that used to be in the way.
      const remaining = this.bricks.filter((b) => b.col === col && b.hp > 0 && b.kind !== 'steel');
      if (!remaining.length) return colX;

      // Aim at the lowest brick left in the column: it is the one in the way.
      let lowest = remaining[0];
      for (const b of remaining) if (b.y > lowest.y) lowest = b;
      return lowest.x + lowest.w / 2;
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
    jumpsUsed: 0,
    chain: 0,
    chainFlash: 0,
    // Two jumps come free. Anything past that has to be bought with timing:
    // the tap must land near the top of the arc, where the dino is barely
    // moving vertically. Five is the ceiling, and each one gives a little less
    // than the last, so a chain is for reach and recovery rather than flight.
    MAX_JUMPS: 5,
    // |dy| under this counts as the top of the arc. At 0.85 gravity, 2.6 was a
    // 102ms window -- tighter than a fighting-game link, and not something you
    // could hit four times in one arc. 5.0 gives ~196ms.
    APEX_WINDOW: 5.0,
    // Pressing while still rising is the natural mistake, and it is the one
    // worth forgiving: the press is held and spent the moment the window
    // opens. Pressing late, already falling, cannot be rewound, so that still
    // falls through to the landing buffer.
    APEX_BUFFER: 10,
    apexBuffer: 0,
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

    TIERS: {
      baby:   { speed: 3.8, cap: 9.0,  ramp: 300, gap: 145, floor: 88, ptero: 320, pteroRate: 0.20, hearts: 5 },
      easy:   { speed: 3.8, cap: 9.0,  ramp: 300, gap: 145, floor: 88, ptero: 320, pteroRate: 0.20, hearts: 3 },
      normal: { speed: 4.6, cap: 11.5, ramp: 230, gap: 115, floor: 62, ptero: 200, pteroRate: 0.28, hearts: 2 },
      hard:   { speed: 5.8, cap: 14.5, ramp: 170, gap:  95, floor: 48, ptero: 110, pteroRate: 0.36, hearts: 1 }
    },

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
      this.tier = Difficulty.pick(this.TIERS);
      // A run used to end on the first mistake. It now costs a heart, and the
      // rare pink one raises the ceiling rather than just topping it up.
      this.lives = this.tier.hearts;
      this.maxLives = this.tier.hearts;
      this.invulnUntil = 0;
      this.distance = 0;
      this.speed = this.tier.speed;
      this.spawnGap = this.tier.gap;
      this.coinGap = 150;
      this.night = 0;
      this.lastMilestone = 0;
      this.ducking = false;
      this.downPressed = false;
      this.wasOnGround = true;
      this.jumpsUsed = 0;
      this.chain = 0;
      this.chainFlash = 0;
      this.apexBuffer = 0;
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

    // Release a crouch and stand up in place, feet where they are. doJump()
    // refuses while ducking, and update() only re-anchors a grounded dino, so
    // jumping straight out of a duck needs this first.
    standUp: function() {
      if (!this.ducking) return;
      this.dino.y -= (this.STAND_H - this.DUCK_H);
      this.dino.height = this.STAND_H;
      this.ducking = false;
    },

    // At the top of the arc, where a chained jump is allowed.
    atApex: function() {
      return Math.abs(this.dino.dy) <= this.APEX_WINDOW;
    },

    // What the next jump would be worth, or 0 if there isn't one. The autopilot
    // simulates with this, so its predictions match what actually happens.
    // ignoreDuck: the autopilot stands up before it jumps, so when it is
    // costing an option it needs the lift it *would* get, not zero because the
    // dino happens to be crouched this frame.
    nextLift: function(ignoreDuck) {
      if (this.ducking && !ignoreDuck) return 0;
      if (this.dino.onGround || this.coyote > 0) return this.dino.jumpForce;
      if (this.jumpsUsed >= this.MAX_JUMPS) return 0;
      const apex = this.atApex();
      if (this.jumpsUsed >= 2 && !apex) return 0;      // past the freebie, timing only
      const falloff = Math.pow(0.9, Math.max(0, this.jumpsUsed - 1));
      return this.dino.jumpForce * (apex ? 0.94 : 0.86) * falloff;
    },

    canJumpNow: function() { return this.nextLift() !== 0; },

    doJump: function() {
      if (this.ducking) return;
      const grounded = this.dino.onGround || this.coyote > 0;
      if (grounded) {
        this.dino.dy = this.dino.jumpForce;
        this.dino.onGround = false;
        this.coyote = 0;
        this.jumpsUsed = 1;
        this.chain = 0;
        SFX.jump();
        return;
      }

      const apex = this.atApex();
      const lift = this.nextLift();
      if (!lift) {
        if (this.jumpsUsed < this.MAX_JUMPS && this.dino.dy < -this.APEX_WINDOW) {
          // Too early: still on the way up. Hold the press and spend it as the
          // arc flattens out, which is what the player meant.
          this.apexBuffer = this.APEX_BUFFER;
        } else {
          // Out of jumps, or already falling past the window.
          this.jumpBuffer = this.BUFFER_FRAMES;
        }
        return;
      }
      this.apexBuffer = 0;

      this.jumpsUsed++;
      this.dino.dy = lift;
      const cx = this.dino.x + this.dino.width / 2;
      const cy = this.dino.y + this.dino.height;

      if (this.jumpsUsed > 2) {
        // Earned by timing, so it gets to feel earned.
        this.chain = this.jumpsUsed;
        this.chainFlash = 26;
        SFX.seq([700, 950, 1250], 'triangle', 0.12, 0.05);
        Fx.text(cx, this.dino.y - 8, 'CHAIN ×' + this.jumpsUsed, '#fbbf24');
        Fx.burst(cx, cy, '#fbbf24', 14, 2.6);
      } else {
        SFX.beep(520, 0.11, 'triangle', 0.08, 820);
        Fx.burst(cx, cy, '#a855f7', 8, 2);
      }
    },

    onTap: function() { this.doJump(); },

    spawnObstacle: function(canvas) {
      const groundY = canvas.height - 20;
      const allowPtero = this.distance > this.tier.ptero;
      const roll = Math.random();

      if (allowPtero && roll < this.tier.pteroRate) {
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
      const minGap = Math.max(this.tier.floor, this.tier.gap - this.speed * 4);
      this.spawnGap = minGap + Math.random() * 80;
    },

    // Coins arc through the air so they're worth jumping for; every so often
    // the arc carries a shield instead.
    spawnCoins: function(canvas) {
      const groundY = canvas.height - 20;
      const n = 3 + Math.floor(Math.random() * 3);
      const peak = 70 + Math.random() * 45;
      const shieldAt = Math.random() < 0.22 ? Math.floor(n / 2) : -1;
      // Rare on purpose: it permanently raises the ceiling, so it should feel
      // like a find rather than a drip.
      const heartAt = Math.random() < 0.11 ? Math.floor(Math.random() * n) : -1;
      for (let i = 0; i < n; i++) {
        const f = n === 1 ? 0.5 : i / (n - 1);
        const lift = Math.sin(f * Math.PI) * peak;
        this.coins.push({
          x: canvas.width + 20 + i * 34,
          y: groundY - 46 - lift,
          r: 9,
          spin: i * 0.7,
          shield: i === shieldAt,
          heart: i === heartAt
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
        this.jumpsUsed = 0;
        this.chain = 0;
        this.apexBuffer = 0;
        if (this.jumpBuffer > 0) { this.jumpBuffer = 0; this.doJump(); }
      }
      if (this.jumpBuffer > 0) this.jumpBuffer--;
      if (this.apexBuffer > 0) {
        this.apexBuffer--;
        if (!this.dino.onGround && this.atApex() && this.nextLift()) {
          this.apexBuffer = 0;
          this.doJump();
        }
      }
      this.wasOnGround = this.dino.onGround;
      if (this.shieldFlash > 0) this.shieldFlash--;

      // Distance score + speed ramp (gentler than it used to be)
      this.distance += this.speed / 10;
      const score = Math.floor(this.distance);
      if (score !== game.score) game.updateScore(score);
      this.speed = Math.min(this.tier.speed + this.distance / this.tier.ramp, this.tier.cap);

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
          if (c.heart) {
            this.maxLives++;
            this.lives++;
            SFX.bonus();
            Fx.text(c.x, c.y - 10, 'MAX ❤️ +1', '#f43f5e');
            Fx.burst(c.x, c.y, '#f43f5e', 18, 3.2);
            Haptics.power();
          } else if (c.shield) {
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
        if (performance.now() < this.invulnUntil) continue;   // just spent a heart
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
          if (this.lives > 1) {
            // Spend a heart: clear what is on top of the dino so it does not
            // simply crash again on the same obstacle next frame, and give a
            // short window to recover.
            this.lives--;
            this.invulnUntil = performance.now() + 1200;
            this.obstacles = this.obstacles.filter(o => o.x > this.dino.x + this.dino.width + 40);
            game.shake(8, 16);
            SFX.beep(220, 0.2, 'sawtooth', 0.12, 90);
            Fx.text(this.dino.x + 20, this.dino.y - 14, '-1 ❤️', '#f43f5e');
            Fx.burst(this.dino.x + 20, this.dino.y, '#f43f5e', 20, 3.4);
            Haptics.power();
            return;
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

      // Ground: a lit edge, a band of soil, and pebbles that scroll with the
      // world, so the dino reads as running rather than hovering.
      const gY = canvas.height - 20;
      const soil = ctx.createLinearGradient(0, gY, 0, canvas.height);
      soil.addColorStop(0, this.night > 0.5 ? 'rgba(120,125,150,0.55)' : 'rgba(140,140,150,0.45)');
      soil.addColorStop(1, 'rgba(20,22,40,0)');
      ctx.fillStyle = soil;
      ctx.fillRect(0, gY, canvas.width, 20);
      ctx.beginPath();
      ctx.moveTo(0, gY);
      ctx.lineTo(canvas.width, gY);
      ctx.strokeStyle = this.night > 0.5 ? '#aab' : '#8a8a96';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = this.night > 0.5 ? 'rgba(190,195,220,0.5)' : 'rgba(110,110,125,0.6)';
      const scroll = (this.distance * 10) % 48;
      for (let i = -1; i < canvas.width / 48 + 1; i++) {
        const px = i * 48 - scroll;
        ctx.fillRect(px, gY + 6, 11, 2);
        ctx.fillRect(px + 22, gY + 12, 6, 2);
      }

      // Coins / shields (squashed circle so they read as spinning)
      // Hearts, top right, same language as Breakout's.
      if (this.maxLives) {
        ctx.save();
        ctx.font = '15px system-ui, sans-serif';
        ctx.textAlign = 'right';
        const full = Math.max(0, this.lives);
        ctx.fillText('❤️'.repeat(full) + '🖤'.repeat(Math.max(0, Math.min(this.maxLives - full, 6))),
                     canvas.width - 12, 24);
        ctx.restore();
      }
      this.coins.forEach(c => {
        const w = Math.abs(Math.cos(c.spin)) * c.r + 2;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, w, c.r, 0, 0, Math.PI * 2);
        ctx.fillStyle = c.heart ? '#f43f5e' : c.shield ? '#4ade80' : '#fbbf24';
        ctx.fill();
        ctx.fillStyle = c.heart ? '#4c0519' : c.shield ? '#052e16' : '#7c5a06';
        ctx.font = 'bold 10px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        if (w > 5) ctx.fillText(c.heart ? '♥' : c.shield ? 'S' : '$', c.x, c.y + 3.5);
      });

      this.drawDino(ctx);

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
          Paint.bevel(ctx, o.x, o.y, o.width, o.height, 5, o.color, 0.28);
          Paint.bevel(ctx, o.x - 6, o.y + 15, 7, 10, 3, o.color, 0.18);
          Paint.bevel(ctx, o.x + o.width - 1, o.y + 10, 7, 10, 3, o.color, 0.18);
          // ribs
          ctx.save();
          ctx.globalAlpha = 0.25;
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1;
          for (let k = 1; k < 3; k++) {
            ctx.beginPath();
            ctx.moveTo(o.x + (o.width * k) / 3, o.y + 4);
            ctx.lineTo(o.x + (o.width * k) / 3, o.y + o.height - 4);
            ctx.stroke();
          }
          ctx.restore();
        }
      });

      // HUD
      ctx.font = '16px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#a5b4fc';
      let hud = `${this.speed.toFixed(1)}× speed`;
      if (this.shield > 0) hud += ` · 🛡️×${this.shield}`;
      if (this.jumpsUsed > 2) hud += ` · CHAIN ×${this.jumpsUsed}`;
      ctx.fillText(hud, 12, 24);

      // A ring at the top of the arc, so the window you have to hit is a thing
      // you can see rather than a number in a changelog.
      if (!this.dino.onGround && this.jumpsUsed >= 2 && this.jumpsUsed < this.MAX_JUMPS) {
        const open = this.atApex();
        const armed = this.apexBuffer > 0;
        ctx.save();
        ctx.globalAlpha = open ? 0.95 : (armed ? 0.8 : 0.28);
        ctx.strokeStyle = open ? '#fbbf24' : (armed ? '#22d3ee' : '#64748b');
        ctx.lineWidth = open ? 3 : (armed ? 3 : 2);
        ctx.beginPath();
        ctx.arc(this.dino.x + this.dino.width / 2, this.dino.y + this.dino.height / 2,
                this.dino.width * 0.85, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (this.chainFlash > 0) this.chainFlash--;
    },

    // An actual creature rather than a rectangle with an eye: tail, haunch,
    // body, neck, snout and a running pair of legs, all built from the same
    // rounded-box vocabulary so it stays crisp at any size.
    drawDino: function(ctx) {
      const d = this.dino;
      const x = d.x, y = d.y, w = d.width, h = d.height;
      const duck = this.ducking;
      const c = d.color;
      const dark = Paint.shade(c, -0.32);

      ctx.save();
      // tail
      ctx.fillStyle = dark;
      Paint.path(ctx, x - 9, y + h * (duck ? 0.10 : 0.30), 12, h * 0.26, 3);
      ctx.fill();
      // body
      Paint.bevel(ctx, x, y + h * (duck ? 0.02 : 0.24), w * 0.72, h * (duck ? 0.96 : 0.76), 7, c);
      // haunch
      ctx.fillStyle = Paint.shade(c, -0.14);
      Paint.path(ctx, x + 1, y + h * (duck ? 0.30 : 0.46), w * 0.34, h * (duck ? 0.6 : 0.46), 6);
      ctx.fill();

      if (duck) {
        // Head thrust forward, level with the back.
        Paint.bevel(ctx, x + w * 0.62, y, w * 0.42, h * 0.68, 5, c);
        ctx.fillStyle = '#0d1b2a';
        ctx.beginPath();
        ctx.arc(x + w * 0.86, y + h * 0.26, 2.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // neck + head + snout
        Paint.bevel(ctx, x + w * 0.42, y + h * 0.06, w * 0.30, h * 0.34, 4, c);
        Paint.bevel(ctx, x + w * 0.52, y, w * 0.48, h * 0.30, 5, c);
        ctx.fillStyle = Paint.shade(c, -0.1);
        Paint.path(ctx, x + w * 0.86, y + h * 0.14, w * 0.22, h * 0.12, 2);
        ctx.fill();
        // eye
        ctx.fillStyle = '#0d1b2a';
        ctx.beginPath();
        ctx.arc(x + w * 0.80, y + h * 0.12, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(x + w * 0.785, y + h * 0.105, 0.9, 0, Math.PI * 2);
        ctx.fill();
        // arm
        ctx.fillStyle = dark;
        Paint.path(ctx, x + w * 0.52, y + h * 0.44, w * 0.20, h * 0.10, 2);
        ctx.fill();
      }

      // legs: two when running, tucked when airborne or crouched
      ctx.fillStyle = dark;
      if (d.onGround && !duck) {
        const step = Math.floor(this.distance * 3) % 2 === 0;
        Paint.path(ctx, x + w * 0.10, y + h, w * 0.20, step ? 7 : 3, 2); ctx.fill();
        Paint.path(ctx, x + w * 0.42, y + h, w * 0.20, step ? 3 : 7, 2); ctx.fill();
      } else if (!duck) {
        Paint.path(ctx, x + w * 0.16, y + h - 1, w * 0.40, 5, 2); ctx.fill();
      }
      ctx.restore();
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

      this.downPressed = false;
      const fromGround = d.onGround || this.coyote > 0;
      const lift = this.nextLift(true);
      const canJump = lift !== 0;

      // Three options, each rolled forward against the whole scene: stand,
      // hold down, jump. -1 means nothing hits within the horizon.
      const stand = this.crashFrame(groundLine, d.y, d.dy, d.onGround, 0, 0);
      if (stand < 0 || stand > this.ACT_WITHIN) {
        // Safe on the current course, so the only question left is whether a
        // jump is worth taking for the coins — and only if it stays safe.
        this.autoCoin(groundLine, canJump, lift);
        return;
      }

      const duck = this.crashFrame(groundLine, d.y, d.dy, d.onGround, 1, 0);
      const jump = canJump ? this.crashFrame(groundLine, d.y, d.dy, d.onGround, 0, lift) : stand;

      // Take whichever survives; ducking is preferred when both do, because it
      // keeps the jump in hand for whatever is behind.
      if (duck < 0) { this.downPressed = true; return; }
      if (jump < 0) { this.standUp(); this.doJump(); return; }

      // Nothing is clean. Buy the most time and re-decide next frame — the
      // scene will have moved, and an option that fails now can come good.
      if (duck >= stand && duck >= jump) { this.downPressed = true; return; }
      if (jump > stand && canJump) { this.standUp(); this.doJump(); }
    },

    // Roll the whole scene forward — every obstacle at once, not just the next
    // one — and report the frame of the first collision, or -1 for clear.
    //
    // Checking a single obstacle was the flaw in the previous version: a jump
    // that cleared the cactus in front could land straight into the one behind
    // it, and nothing noticed until it was too late to act.
    //
    //   duck  0 = stand, 1 = hold down for the whole horizon
    //   lift  a one-off velocity applied on the first frame (a jump), or 0
    HORIZON: 80,
    // Only intervene once the crash is this close. Acting the moment anything
    // appears in the horizon spent both jumps on an obstacle still sixty
    // frames away, and left nothing for the one behind it. The decision is
    // remade every frame, so waiting costs nothing and keeps options in hand.
    ACT_WITHIN: 24,

    crashFrame: function(groundLine, y0, dy0, ground0, duck, lift, horizon) {
      const d = this.dino;
      let y = y0, dy = dy0, onGround = ground0;
      // Anchor by the feet for the height this action implies, *before* the
      // jump is applied. Without it a jump simulated out of a crouch starts
      // 20px too low, the first frame reads as below ground, and every option
      // comes back looking doomed.
      if (onGround) y = groundLine - (duck ? this.DUCK_H : this.STAND_H);
      if (lift) { dy = lift; onGround = false; }

      // Obstacle positions are advanced in place from copies, so nothing here
      // touches the live objects.
      const obs = this.obstacles;
      const ox = [];
      for (let i = 0; i < obs.length; i++) ox.push(obs[i].x);

      const H = horizon || this.HORIZON;
      for (let t = 0; t < H; t++) {
        const ducking = !!duck && onGround;
        const h = ducking ? this.DUCK_H : this.STAND_H;
        const gy = groundLine - h;
        if (onGround) y = gy;                     // anchored by the feet

        if (!onGround && duck) dy += 1.3;         // holding down fast-falls
        y += dy;
        if (y < gy) { dy += d.gravity; onGround = false; }
        else { y = gy; dy = 0; onGround = true; }

        for (let i = 0; i < obs.length; i++) {
          const o = obs[i];
          ox[i] -= this.speed * (o.ptero ? 1.15 : 1);
          if (ox[i] + o.width < d.x) continue;
          if (d.x + 9 < ox[i] + o.width && d.x + d.width - 9 > ox[i] &&
              y + 9 < o.y + o.height && y + h - 6 > o.y) return t;
        }
      }
      return -1;
    },

    // Coins gathered along a simulated arc, so a detour can be checked for
    // safety before it is taken rather than only attempted when the screen
    // happens to be empty.
    coinsAlong: function(groundLine, lift, horizon) {
      const d = this.dino;
      let y = d.y, dy = d.dy, onGround = d.onGround;
      if (onGround) y = groundLine - this.STAND_H;
      if (lift) { dy = lift; onGround = false; }
      const cx = this.coins.map((c) => c.x);
      const got = new Array(this.coins.length).fill(false);
      let n = 0;
      const H = horizon || this.HORIZON;
      for (let t = 0; t < H; t++) {
        const gy = groundLine - this.STAND_H;
        if (onGround) y = gy;
        y += dy;
        if (y < gy) { dy += d.gravity; onGround = false; }
        else { y = gy; dy = 0; onGround = true; }
        for (let i = 0; i < this.coins.length; i++) {
          if (got[i]) continue;
          cx[i] -= this.speed;
          if (Math.abs(cx[i] - (d.x + d.width / 2)) < 24 &&
              Math.abs(this.coins[i].y - (y + this.STAND_H / 2)) < 26) {
            got[i] = true;
            n += this.coins[i].shield ? 4 : 1;   // a shield is worth a detour
          }
        }
      }
      return n;
    },

    // Jump for coins when the arc actually collects more than standing still
    // does, and only when that jump is still clear of everything on screen.
    autoCoin: function(groundLine, canJump, lift) {
      if (!canJump || !this.coins.length) return;
      const staying = this.coinsAlong(groundLine, 0);
      const jumping = this.coinsAlong(groundLine, lift);
      if (jumping <= staying) return;
      if (this.crashFrame(groundLine, this.dino.y, this.dino.dy, this.dino.onGround, 0, lift) >= 0) return;
      this.standUp();
      this.doJump();
    }
  };

  // ===================================
  // Snake — wrap-around edges, golden bonus, tail trims, streak scoring
  // ===================================
  const SnakeGame = {
    CELL: 20,
    DIRS: [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }],

    TIERS: {
      baby:   { tick: 175, floor: 110, step: 0.9, bonusMs: 8500, hearts: 5 },
      easy:   { tick: 155, floor: 95, step: 1.1, bonusMs: 7500, hearts: 3 },
      normal: { tick: 125, floor: 70, step: 1.6, bonusMs: 6200, hearts: 2 },
      hard:   { tick: 100, floor: 52, step: 2.3, bonusMs: 4800, hearts: 1 }
    },
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
      this.tier = Difficulty.pick(this.TIERS);
      this.dir = { x: 1, y: 0 };
      this.nextDir = { x: 1, y: 0 };
      this.tickMs = this.tier.tick;
      this.lastTick = 0;
      this.bonus = null;
      // Biting yourself used to end it outright. It now costs a heart and
      // resets the body; the pink apple raises the ceiling.
      this.lives = this.tier.hearts;
      this.maxLives = this.tier.hearts;
      this.heartFood = false;
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

    placeFood: function() {
      this.food = this.freeCell();
      // Rare, and it raises the ceiling rather than topping it up, so it is
      // still worth taking on a full run.
      this.heartFood = Math.random() < 0.11;
    },

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
        if (this.lives > 1) {
          // Spend a heart and start the body again from the middle. The score
          // and the food stay -- it is a setback, not a restart.
          this.lives--;
          SFX.beep(220, 0.2, 'sawtooth', 0.12, 90);
          Fx.text((head.x + 0.5) * this.cell, (head.y - 0.5) * this.cell, '-1 ❤️', '#f43f5e');
          Haptics.power();
          const mx = Math.floor(this.cols / 2), my = Math.floor(this.rows / 2);
          this.snake = [{ x: mx, y: my }, { x: mx - 1, y: my }, { x: mx - 2, y: my }];
          this.dir = { x: 1, y: 0 };
          this.nextDir = { x: 1, y: 0 };
          return;
        }
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
        if (this.heartFood) {
          this.maxLives++;
          this.lives++;
          SFX.bonus();
          Fx.text(head.x * C + C / 2, head.y * C - 16, 'MAX ❤️ +1', '#f43f5e');
          Fx.burst(head.x * C + C / 2, head.y * C + C / 2, '#f43f5e', 18, 3.2);
          Haptics.power();
        }
        SFX.eat(this.snake.length);
        Fx.burst(head.x * C + C / 2, head.y * C + C / 2, '#ec4899', 9, 2.2);
        Fx.text(head.x * C + C / 2, head.y * C - 4, `+${pts}`, this.streak > 1 ? '#fbbf24' : '#ec4899');
        this.tickMs = Math.max(this.tier.floor, this.tickMs - this.tier.step);
        this.placeFood();

        // Every 5 foods → a timed bonus. Once the snake is long the bonus
        // becomes a tail trim, which is what actually makes it survivable.
        if (this.foodsEaten % 5 === 0 && !this.bonus) {
          const spot = this.freeCell();
          const trim = this.snake.length > 14;
          this.bonus = { x: spot.x, y: spot.y, expiresAt: ts + this.tier.bonusMs, born: ts, trim: trim };
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

      // Food: an apple with a highlight and a leaf, which reads at 14px far
      // better than a flat dot does.
      const fx = this.food.x * C + C / 2, fy = this.food.y * C + C / 2;
      Paint.orb(ctx, fx, fy, C / 2 - 3, this.heartFood ? '#f43f5e' : '#ec4899');
      if (this.heartFood) {
        ctx.fillStyle = '#4c0519';
        ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('♥', fx, fy + 4);
      }
      ctx.strokeStyle = '#166534';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(fx, fy - C / 2 + 3);
      ctx.lineTo(fx + 1, fy - C / 2 - 1);
      ctx.stroke();
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.ellipse(fx + 4, fy - C / 2 - 1, 3.2, 1.8, -0.6, 0, Math.PI * 2);
      ctx.fill();

      // Timed bonus: blink + countdown ring (green when it's a tail trim)
      if (this.bonus) {
        const bx = this.bonus.x * C + C / 2;
        const by = this.bonus.y * C + C / 2;
        const frac = Math.max(0, (this.bonus.expiresAt - now) / (this.tier ? this.tier.bonusMs : 6200));
        const blink = 0.55 + 0.45 * Math.sin(now / 110);
        const tint = this.bonus.trim ? '#4ade80' : '#fbbf24';
        ctx.globalAlpha = blink;
        Paint.orb(ctx, bx, by, C / 2 - 2, tint);
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(bx, by, C / 2 + 2.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        ctx.strokeStyle = tint;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Snake — a jointed body rather than loose tiles: each segment is
      // bevelled and the gaps between neighbours are filled, so it reads as one
      // animal instead of a row of squares.
      const body = this.snake;
      const tone = (i) => i === 0 ? '#22d3ee'
        : Paint.shade('#7c3aed', 0.22 - (i / Math.max(1, body.length - 1)) * 0.5);

      // Two passes. The joins have to go down first: drawing each segment's
      // join as it went meant the next one painted flat over the previous
      // segment's bevel, and the whole snake came out looking like a bar.
      for (let i = body.length - 1; i > 0; i--) {
        const a = body[i], b = body[i - 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) continue;   // a wrap, not a join
        ctx.fillStyle = tone(i);
        const pad = 2;
        if (dx !== 0) {
          ctx.fillRect(Math.min(a.x, b.x) * C + C / 2, a.y * C + pad, C, C - pad * 2);
        } else {
          ctx.fillRect(a.x * C + pad, Math.min(a.y, b.y) * C + C / 2, C - pad * 2, C);
        }
      }

      for (let i = body.length - 1; i >= 0; i--) {
        const seg = body[i];
        const t = i / Math.max(1, body.length - 1);
        const pad = i === 0 ? 1 : 2;
        const sx = seg.x * C + pad, sy = seg.y * C + pad, sw = C - pad * 2;

        Paint.bevel(ctx, sx, sy, sw, sw, i === 0 ? 7 : 5, tone(i), i === 0 ? 0.45 : 0.3);

        // Scales down the back, fading out toward the tail.
        if (i > 0 && i % 2 === 0 && t < 0.8) {
          ctx.save();
          ctx.globalAlpha = 0.18 * (1 - t);
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(sx + sw / 2, sy + sw / 2, sw * 0.22, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        if (i === 0) {
          const cx0 = seg.x * C + C / 2, cy0 = seg.y * C + C / 2;
          const ex = cx0 + this.dir.x * 3.5, ey = cy0 + this.dir.y * 3.5;
          const ox = this.dir.y !== 0 ? 4.5 : 0, oy = this.dir.x !== 0 ? 4.5 : 0;
          // whites, then pupils looking the way it travels
          ctx.fillStyle = '#f8fafc';
          ctx.beginPath();
          ctx.arc(ex - ox, ey - oy, 3.1, 0, Math.PI * 2);
          ctx.arc(ex + ox, ey + oy, 3.1, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#0a0820';
          ctx.beginPath();
          ctx.arc(ex - ox + this.dir.x, ey - oy + this.dir.y, 1.7, 0, Math.PI * 2);
          ctx.arc(ex + ox + this.dir.x, ey + oy + this.dir.y, 1.7, 0, Math.PI * 2);
          ctx.fill();
          // a tongue that flicks
          if (Math.floor(now / 260) % 3 === 0) {
            ctx.strokeStyle = '#f43f5e';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(cx0 + this.dir.x * 9, cy0 + this.dir.y * 9);
            ctx.lineTo(cx0 + this.dir.x * 15, cy0 + this.dir.y * 15);
            ctx.stroke();
          }
        }
      }

      // HUD
      if (this.streak > 1) {
        ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(`STREAK ×${this.streak}`, 10, 20);
      }
      if (this.maxLives) {
        ctx.font = '15px system-ui, sans-serif';
        ctx.textAlign = 'right';
        const full = Math.max(0, this.lives);
        ctx.fillText('❤️'.repeat(full) + '🖤'.repeat(Math.max(0, Math.min(this.maxLives - full, 6))),
                     game.canvas.width - 12, 24);
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
  // Arcade: Lawn Siege — lane defense
  //
  // The fourth game, and the only one that is not a reflex test: you spend a
  // currency you have to farm, on a grid, against waves that arrive whether you
  // are ready or not. Same shell contract as the other three (init/update/draw
  // plus autoPlay), so it inherits pause, mute, the difficulty tiers, hearts and
  // the autopilot switch for free.
  //
  // Every sprite is drawn in tools/lawn_toon.py -- circles, polygons and arcs,
  // supersampled and resolved down, then palette-reduced and inlined as data
  // URIs so the game makes no network request. Nothing is traced, sampled or
  // derived from anyone else's artwork, and the fusions are the base plants
  // redrawn in another colour rather than an image operation on someone's
  // pixels. Run the tool to regenerate the ART block below.
  //
  // It is NOT Plants vs Zombies art. Nothing from PopCap is used and nothing
  // from PopCap should be added: free to download is not a licence to
  // redistribute.
  // ===================================
  const LawnGame = {
    COLS: 9,
    ROWS: 5,
    TOP: 78,            // shop strip above the lawn
    PORCH: 34,          // paved strip to the left of the lawn, where mowers park
    cellW: 0,
    cellH: 0,
    originX: 0,

    // cost, cooldown (ms), and what the thing does once planted
    SEEDS: [
      { key: 'sunflower', name: 'Sunflower',   cost: 50,  cool: 5000,  hp: 60,  art: 'sunflower'  },
      { key: 'shooter',   name: 'Peashooter',  cost: 100, cool: 5000,  hp: 60,  art: 'shooter'    },
      { key: 'wall',      name: 'Wall-nut',    cost: 50,  cool: 12000, hp: 400, art: 'wall'       },
      { key: 'mine',      name: 'Potato Mine', cost: 25,  cool: 9000,  hp: 40,  art: 'potatomine' },
      { key: 'squash',    name: 'Squash',      cost: 50,  cool: 14000, hp: 80,  art: 'squash'     },
      { key: 'frost',     name: 'Snow Pea',    cost: 175, cool: 12000, hp: 60,  art: 'frost'      },
      { key: 'bomb',      name: 'Cherry Bomb', cost: 150, cool: 18000, hp: 60,  art: 'bomb'       },
      { key: 'jala',      name: 'Jalapeno',    cost: 125, cool: 20000, hp: 50,  art: 'jalapeno'   },
      { key: 'tall',      name: 'Tall-nut',    cost: 125, cool: 20000, hp: 900, art: 'tallnut'    },
      { key: 'three',     name: 'Threepeater', cost: 325, cool: 9000,  hp: 60,  art: 'threepeater'},
      { key: 'torch',     name: 'Torchwood',   cost: 175, cool: 9000,  hp: 200, art: 'torchwood'  },
      { key: 'chomp',     name: 'Chomper',     cost: 150, cool: 9000,  hp: 90,  art: 'chomper'    }
    ],

    // Planting onto an occupied tile FUSES rather than being refused. Two plants
    // become one that keeps both jobs -- a shooter in a nut shell still shoots and
    // still soaks, a shooter wearing petals pays for itself. The pair is looked up
    // unordered, so it does not matter which half was already there.
    FUSIONS: {
      'shooter+shooter':   { key: 'repeater', name: 'Repeater',  art: 'repeater', hp: 60,  shots: 2, dmg: 34 },
      'shooter+sunflower': { key: 'sunshot',  name: 'Sunshot',   art: 'sunshot',  hp: 60,  shots: 1, dmg: 30, makesSun: true },
      'shooter+wall':      { key: 'bulwark',  name: 'Bulwark',   art: 'bulwark',  hp: 400, shots: 1, dmg: 30 },
      'frost+shooter':     { key: 'sleet',    name: 'Sleet',     art: 'sleet',    hp: 60,  shots: 2, dmg: 26, chill: true },
      'frost+frost':       { key: 'sleet',    name: 'Sleet',     art: 'sleet',    hp: 60,  shots: 2, dmg: 26, chill: true },
      'mine+wall':         { key: 'minewall', name: 'Mine-nut',  art: 'minewall', hp: 400, mine: true },
      'bomb+wall':         { key: 'cherrynut', name: 'Cherry-nut', art: 'cherrynut', hp: 460, mine: true },
      'bomb+frost':        { key: 'glacier',  name: 'Frozen Cherry', art: 'glacier', hp: 60, freeze: true },
      'bomb+bomb':         { key: 'glacier',  name: 'Frozen Cherry', art: 'glacier', hp: 60, freeze: true },
      // The mod's own pattern: a shooter crossed with a bomb throws exploding
      // shots, stacking repeaters gives a gatling, and anything crossed with the
      // three-lane plant keeps the three lanes.
      'bomb+shooter':      { key: 'cherry',   name: 'Cherry-shooter', art: 'cherryshooter', hp: 60, shots: 1, dmg: 40, splash: true },
      'repeater+shooter':  { key: 'gatling',  name: 'Gatling',   art: 'gatling',  hp: 60,  shots: 4, dmg: 32 },
      'shooter+three':     { key: 'splitpea', name: 'Split Pea', art: 'splitpea', hp: 60,  shots: 1, dmg: 34, back: true },
      'bomb+three':        { key: 'phoenix',  name: 'Phoenix',   art: 'phoenix',  hp: 60,  shots: 1, dmg: 46, lanes: 3, splash: true },
      'frost+three':       { key: 'frostthree', name: 'Frost Three', art: 'frostthree', hp: 60, shots: 1, dmg: 28, lanes: 3, chill: true },
      'chomp+wall':        { key: 'chompnut', name: 'Chomp-nut', art: 'chompnut', hp: 400, eats: true },
      // Torchwood, the mine and the two new nuts open a second family of them.
      // All of these are pairs the mod itself has, under the mod's own names.
      'shooter+torch':     { key: 'blazepea', name: 'Blaze Pea', art: 'blazepea', hp: 60, shots: 1, dmg: 48, splash: true },
      'repeater+torch':    { key: 'blazerep', name: 'Blaze Repeater', art: 'blazerepeater', hp: 60, shots: 2, dmg: 44, splash: true },
      'tall+torch':        { key: 'flametall', name: 'Flame Tall-nut', art: 'flametallnut', hp: 900, burnbite: true },
      'frost+tall':        { key: 'frosttall', name: 'Frost Tall-nut', art: 'frosttallnut', hp: 900, chillbite: true },
      'jala+three':        { key: 'charred', name: 'Charred Threepeater', art: 'charredthree', hp: 60, shots: 1, dmg: 40, lanes: 3, splash: true },
      'chomp+shooter':     { key: 'chompshoot', name: 'Chomp-shooter', art: 'chompshooter', hp: 90, eats: true, shots: 1, dmg: 30 },
      'bomb+squash':       { key: 'cherrysquash', name: 'Cherry Squash', art: 'cherrysquash', hp: 80, squash: true, wide: true },
      'chomp+mine':        { key: 'chompmine', name: 'Chomp-mine', art: 'chompmine', hp: 90, eats: true, mine: true }
    },

    fuseKey: function(a, b) { return [a, b].sort().join('+'); },

    // Difficulty moves the three things that actually decide a run: how fast the
    // sky pays you, how hard the wave pushes, and how many lawnmowers you get.
    TIERS: {
      baby:   { sunMs: 3200, sunAmt: 40, waveMs: 13000, ramp: 0.030, hp: 0.70, speed: 0.75, regen: 1, start: 300, waves: 2 },
      easy:   { sunMs: 3800, sunAmt: 30, waveMs: 11500, ramp: 0.045, hp: 0.85, speed: 0.9,  regen: 1, start: 225, waves: 2 },
      normal: { sunMs: 4400, sunAmt: 25, waveMs: 10000, ramp: 0.065, hp: 1.0,  speed: 1.0,  regen: 2, start: 175, waves: 2 },
      hard:   { sunMs: 4600, sunAmt: 25, waveMs: 8500,  ramp: 0.055, hp: 1.10, speed: 1.05, regen: 3, start: 200, waves: 3 }
    },

    // A run is a play-through, not one endless lane. Levels are grouped into
    // areas the way the original groups them into worlds: each has its own
    // ground, its own rules about what the sky pays and what you can see, and a
    // brute waiting on the last level. Past the final area they cycle, and the
    // wave ramp keeps climbing -- so there is always a next stage.
    AREAS: [
      { name: 'FRONT LAWN',   stripe: ['#4e8f36', '#437d2f'], grass: true,
        tint: null,                      sun: 1.0,  mowers: true,  fog: 0 },
      { name: 'NIGHT GARDEN', stripe: ['#2d5a44', '#264c3a'], grass: true,
        tint: 'rgba(18,30,86,0.52)',     sun: 0.45, mowers: true,  fog: 0 },
      { name: 'BACK YARD',    stripe: ['#458a52', '#3b7746'], grass: true,
        tint: 'rgba(28,96,86,0.24)',     sun: 0.85, mowers: true,  fog: 0 },
      { name: 'FOG BANK',     stripe: ['#456b52', '#3b5c46'], grass: true,
        tint: 'rgba(120,140,150,0.26)',  sun: 0.55, mowers: true,  fog: 3 },
      { name: 'THE ROOF',     stripe: ['#7a4a3a', '#653c2f'], grass: false,
        tint: 'rgba(40,20,12,0.18)',     sun: 0.9,  mowers: false, fog: 0 }
    ],
    LEVELS_PER_AREA: 10,

    areaFor: function(level) {
      return this.AREAS[Math.floor((level - 1) / this.LEVELS_PER_AREA) % this.AREAS.length];
    },
    // "3-7": which pass through the areas, then which level inside this one.
    stageName: function(level) {
      return (Math.floor((level - 1) / this.LEVELS_PER_AREA) + 1) + '-' +
             (((level - 1) % this.LEVELS_PER_AREA) + 1);
    },
    // Levels are short. In the game this is modelled on, 1-1 is five zombies and
    // has no huge wave at all, and a flag IS the huge wave -- so a level is two
    // or three small waves early on, growing a wave every third level and one
    // more each time the areas come round again. Depth comes from there being a
    // lot of levels, not from any one of them lasting.
    wavesFor: function(level) {
      const sub = ((level - 1) % this.LEVELS_PER_AREA) + 1;
      const pass = Math.floor((level - 1) / this.LEVELS_PER_AREA);
      return Math.min(8, this.tier.waves + Math.floor((sub - 1) / 3) +
                         (sub === this.LEVELS_PER_AREA ? 1 : 0) + Math.min(3, pass));
    },

    // The very first level of a run has no huge wave, the way 1-1 does not.
    hasFlag: function(level) { return level > 1; },
    isBossLevel: function(level) { return level % this.LEVELS_PER_AREA === 0; },

    // Entering a level: pick up the area's ground rules and announce the stage.
    enterLevel: function(game) {
      this.area = this.areaFor(this.level);
      this.waves = this.wavesFor(this.level);
      this.turfPat = null;
      if (!this.area.mowers && this.mowers.some(Boolean)) {
        this.mowers = this.mowers.map(() => false);
        this.lives = 0;
        Fx.text(game.canvas.width / 2, this.TOP + 116, 'NO MOWERS UP HERE', '#ff5d5d');
      }
      Fx.text(game.canvas.width / 2, this.TOP + 20,
              'LEVEL ' + this.stageName(this.level) + '  ' + this.area.name, '#ffd23f');
    },

    // Kills are the only score, and a tower defense kills slowly, so they are
    // worth more than a Breakout brick. Surviving a wave pays as well -- holding
    // the line is the thing the game is actually about, and it was scoring zero.
    ZOMBIES: {
      walker:   { hp: 100, speed: 0.22, dmg: 0.9,  art: 'walker',   score: 25 },
      armoured: { hp: 260, speed: 0.18, dmg: 1.1,  art: 'armoured', score: 70 },
      sprinter: { hp: 70,  speed: 0.50, dmg: 0.8,  art: 'sprinter', score: 45 },
      // the boss of an area: slow, enormous, and worth the whole level
      brute:    { hp: 900, speed: 0.13, dmg: 2.6,  art: 'armoured', score: 400, big: 1.45 }
    },

    grid: null,
    zombies: [],
    shots: [],
    suns: [],
    mowers: [],
    sun: 0,
    wave: 0,
    level: 1,
    waveInLevel: 0,
    levelFlash: 0,
    area: null,         // the AREAS entry this level belongs to
    waves: 5,           // flags in this level, from wavesFor()
    waveAt: 0,
    sunAt: 0,
    pick: 0,            // index into SEEDS, or -1 for none
    dig: false,         // shovel armed: the next lawn click removes a plant
    cursor: { c: 4, r: 2 },
    cool: {},
    img: {},
    turfPat: null,
    imgReady: false,
    keyHandler: null,
    moveHandler: null,
    clickHandler: null,
    lives: 0,
    maxLives: 0,
    over: false,
    flash: 0,
    autoAt: 0,

    // The whole cast, drawn in tools/lawn_toon.py and inlined so the game
    // never fetches anything. Fusions are the base plant redrawn in another
    // colour, which is also how they read on the lawn.
    ART: {
      sunflower    : 'data:image/png;base64,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',
      shooter      : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAABSCAMAAAA/3EdqAAAAwFBMVEU0Yh4WIhw1ZR0UJQwvXBg8lB0yZyOirp1qagAoNgdwll7d49mqzpdIcTVOlipOmShRX1Q9iRzH4biEn3Z0/3RVqlVCdChwszb//wA8hxt//wAhPRRewSyIwmlNnCV8gIU/RUp40koAAABivjNOlyhlwjV4x0/8/PgTIgsQGwlVpCwLEwYFCgRatS1zt1BJiyc/fwBUqQGAy1oaJxQAfwA7hhsA/wAQFgRsplI9ih01aRwAVQCFt22D01kPFxhmmE9iWPVFAAAAQHRSTlOd/+pXZx4X/wIZ/P//7eeq9oj//wIDoRABTgKB//9u////AP7+/v7/WEz+Myf+/v0EA/79As4BEv78/QP+//3+5FxfcgAABAxJREFUeNrtl2l3mzgYhcViMGAItR0naTqdGS3YYJZ4K9Tr//9X80osBu92e04+TO9J4nCsh3slvRIC4V8Q+gN/KjxpvfRBLa19L9x+qV9p8zvg9jP8efn+JKRqcPE8vxUGtPXkeN6/HuMKHAT85Da4j7Unb7OZgjyPEc5TwL/eAM9f8Xe2AUwIPgkBnlAVv16Ff2D8xLyYK8c3nCaMBOi6cz91GIDr9doEfLqZZjtBExbIafsy3AJfQDtCf8VZYttZAXPvj0vwBCNGgO12Laurm7a94yNX0BHQz+fhNlYDRsxOF8ie2QPvqRg0UgSHUdNWQoL5OIAdFnHjntvTdeDNbMMHjZXWTlq2X80PnCE0yVN3usBalqWbCaSessoaKUKGAU6a2uyzDc3iuNPpmvowl2570wqOaLKUl0v4lZGBkazidgnnPSZebHZ63WEpa7epYEJpkM9+7NhoKcvajxLOUxP4Zlf5uq6ux1NCqty0KD1vQ+WZrOXWIrbMLdjUM0tXS99KrunV4CQu6UTaQu6PHJ5jIxH5vLgw1q3h0N1KEjsJ29JWQiW8wiot4KLH7t+WDi2kiNViOyUsz2YStxTwB0Y0b+JYBSxJW2CbcNXp5Ww2k/ewSonodNQpYktCM0LOwHVnlUY53CvG6x/hbLJTMFkexg5YI7cFwV09rlLDPFNaXEWN2DBgSVBUUm9fI8P1vssRpUlQFHrTmU9VnrtB96JG6hImTK5PFS8SWt43yqyiOGssGNOkvGaNIuHlGRTWfPllsLCyYM8SwoeLlndiSaM8YWHwLwuafYui6BtjzXmCaLkiubkweO6gDC74mmsemiYJ/IBkWWkuSZ47vzc5Vs7CZoDe3xVVMfgTrLkZtFOwpgE5olnOBs5+61md2AAT3ihqmsOV6C/lG6AhtDreAIvgYBGxssf8M49ML2+9WNRo3jCISH6DqHCl1zZ9nlympQIQ3V/JuH39EYvoSQ1ueT6/8gVySAY3PWJFcgMl9cCADm57uAsacCep+uwMbj9WwOngWRQQguNM4tx5oOG4VvyzWNx7lMrrT9P6L/3F4v5DXHlAaf38cq4y/sC/Gf6KW87bxdq6AE/wG209Drc+Df6s2Hyq3h6f58n/tLa1B19EDbz4go0H4ZRvgOkjcFrtnnfDaYpDHnuBx/BfehcMALKVEOAwDJVwPA650pvgFPt2Fu9kH5x9d4eABp7f4hZnxc6yXZbZ8k+0g1dD2w99fywUXoMNJO8ANQcKSmzTNNdr990XOkk34fFopKABvESFyPEV23QRQqPzdAMOoXshvHv5I18FSLyH+SOQoMNr8NgXjaG5Mirl3wbjMac574+O2GuxufUhfYE9nKo9XbM+xx7Nc0X7dePTLP4PY2mII4vdxAMAAAAASUVORK5CYII=',
      wall         : 'data:image/png;base64,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',
      potatomine   : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADgAAAAsCAMAAAAHH4uhAAAAwFBMVEVtUygUFwfFmVhjSySmoZOxaFjYybJuLSFOOxsUFxxnZw/r5twiJQ6QWC3FsJVRny8XcwmuHg+wgjpcX2DLXE7RLSGhjWlUNRk6cyFcXFygKB3/AAD/f39iRyLqRzg1NhahJRsmTRfAjD9/g4eqqlWqVQD///8A/wApURdJOxyqqgA+gyZVqgCINyCRajOqVVX/fwD/qlUAAAC4iUSRbDUTIguaczgMGgj7/PmylmqleTkKEwb3OSm6ubLDnWO3klgN+DnQAAAAQHRSTlPvIv6f//7/Fv//A/9c4//9Cgn///79/1LtAqsBAmz+j35T//8DAwEBmoUD/wPengMCAwH+/Vn9Tf/+/jP+///+cEa1xwAAAsNJREFUeNrNlel22jAQhSXLjmNjAwECJISSpG3adK+kCCS8vP9bdbSBDYY2+dXLOTCW5vMdjWSD6BuF/j9w+Olt4PCNjkM6HNLF68GU4vkDfL/eMRvMcXe56GydnwcafO0av2luMN8PXIH+CqZpPIwfDOj340l//ToHpumTi+YD6M2X2HVndn9/xjH9YH7wbLkkS/R1ZZf4M13Q28nkXXHrN+cATH/rO5NcRAwUCKQ4QmSmp24nUWTIjx0guMVEsMCrZgF8GEcEx9dRX4NFTK86HOMfKqikrOtaVlUVBFXNjEboexGBY1EU910gUUEtnQwKrCXrvCjegV8HCK3LIUOG/QtQvw+sIStLquvC6Lqj1BzuLjXW62lW1hqra+eZW/KoOXcU6QxpsBKkPQMoIJTKk6Cj7UgpMUvRjv1yAyqnsqptxLmtNs/J4QFIacYDA8p+qLN7vU3Jah9dInNXJvhscdMCbyiyzZM1m+rsMhlvpPTR2M4yLhCsqQEOKXZTVcVCXd0mTMJwHym7n4LzuFUqpjO7DDhmAaT3kvdJMg53Ud/1R3CxpHEDjOmzcKCIdKnjJEnCqfSRHO1A4t4kHiTOEYGgJb1wXF7UzEWlM2T8GJxxsQMjswkXcOWiyHGK61LTdnNyrlw1kDANw6nSj4eN2M5QN6e5Rn1uhG+PfhjU6NGksUcI/Sj09HA7YB+h1gYJNV8aof0IcLrS9gGASwIT6pBrkJpTxHONQ45Rk0SXyMiDShcu8viu62WFRANFkZHllLbjKsc0PgbxwpJcmHYELJpMoj3FhQAOn3g9Ei58llJqNFIO0iOcnP4LwDTboS3BGMkoPg1utzgjCPIatIlJhvH2JAjcer3O1itgDWB5RJ5hcL3etshj8OVF09mKGK2yzI+dAbEBIc0kOr1Y/YOjT23rHEhPguvzpVrLTjsDtrr6B9gVqJqbhQ5HAAAAAElFTkSuQmCC',
      squash       : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAA6CAMAAADbe8pdAAAAwFBMVEVUWyKmsJ3b39UwVBgZKg1rag1faF4nZxA1WBkSIApKYx4zVBmMpnQZIiO4zaVzjF3H3bNblDTNWG+MwltYWR4A/wD//wCzUGAiOBFVqlX///9vPwBVqgBVOix//39BgSW/vsJ+goWJYic9REk0PED/AAAAAABqqDJUhyiEt1b8/PkPGQgTIgskOBBNeCZ5p09blSoLEwZVVQAGDAZjmy9xl0+Kqm02Vhk/fz98skvY2NYBBgxWqDE8PgJwsTUcNgyJu9E/AAAAQHRSTlPy//9iJA//E/JYoo///////+///3YBAf+AAwEGA/8CgP//Df//AQD+/v7/TFj/9/7+NAMl/v//sQT+///9Bf7/OG1/2QAAA7hJREFUeNqllYmWokoMhqvYFwVpe5vtrjMQpbtAFFzbfv+3ukkVICq2Y9+c47GWfPypJBQs/h/GrrsUq8/DNv6+ruxPwXas6wYNzM8ou7DLI8XfBv8y/5k70S6KdrnQ7RthkzFnR0bsbXBBMOTIgn5ztiWs6/d/+nji7zfD98xTw9XNyt8Qvi++rVb9Vf4QLkzbQ9i8uT2L1Vf68xihj2+3KH+XpKHrjHmqPR6L34NNEsOAIU8SxhYLEA5lO7bNq7Dted5Sj5IJGQghEjLh6D5u2FdgzI8O2Viyk/VkkiXKwNFj8wqMR/OUams1vRBLuX0ZfouNaL/OaqvpRjxnBjpchIvYgD1SVTUY4C871pZ0cQk2iU2yigdBMBrxMCS6jDq0MI7uhC78GDPFjjQtGJQojfS6FFEDJ8CMx364iJe4nw1GGqnykRZUKvBSiLzOGvjdwFmHddElq4KgCivUHmHk2Zrg8TgBASpwfLOLHviBgkbhgPOAD8JBoCl4nAkLpQGUtDAezuEi9hcUNYbNLb7Z8AEfUdjjCGeaFmIq5akx8C/nyoZDm+usCq2pNB5isZCtZ03cHWnWtocrd9eTUnprFp/yEjvEkkOi81pab1uFtTVeLuTmWJAr31hbroUTnGk4/JseBzXsxX+che2oakwsjXSnfDvcVOtJyNUQ6bKGhXESNjaXevmSNcF8aw2H278GBMth0IHBbtqMtUWu4T0gPB1uh9ufGiYbtH9xOKSwW7gtNWvy5UPTwCF6bqyhtQkQzgYaDbsJw2KtTmAdFk0Dy+Rq041szpKrUm3qbYTve+C8bX9OOeOqsff1rH10H+wDtC9PDmVVSna9l7OybJ68AKrV6iRhujjAKu148zCGq/vuat6TMCrVIe76xnyV5ojuKvSUikZwJO28v9b27iyOhM+ahNoTutJs+How50j4vD0p3QAHCee1a9Bh8cir81cS44Yu/N5YC1PQIN4e+i4D6NBsyFp7dw5lgtzruwyUdEs7P+5q+1EnTLIg7IfeC1CXu825BXt6urt7emJOJ2Y68Ze+q/eNEg5tzvdJHmHMsNsfZDvddfbFUIHDSbd0UKzxpS+GQW1W44s+FA8cG5c/sS+idYRcGnRM6B99YufxC4NLljM3nn0Ez+bu8hLsp7h9GZ7PZmnqPveKC99N09kxfQ6/pKnPxAnKfLlxFU5f0MtdHnjBlq5a/Q0Y/cjRffaXaP6zm7r10odwS5Mz6aOlatwnfFrn+bzRPjXFXoNnrXSHVOyJcPwfGXfwOF5wbYIAAAAASUVORK5CYII=',
      frost        : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAABSCAMAAAA/3EdqAAAAwFBMVEV90uaN1+hjo7ERHgr2+PYKEgb///9ttcYVIBwpcnabrKtiZmY8iBtLaWhpnFhVkJ1bpqo8jhn+/v4vUFc+fQk2W2M9iRwA/wA4WFw2WShTqQFJe4ZCbnlBkyB///9IajorPFQyUjJBbXZlsv9IeYVIeIX9/v4/f7+Et288hxuLvsknPkZ2x9t/f/9VVapSi5lEajQA//8AAP+q/////wAgQBCBwc9mZjN/v3+qqv/CwboqPUQmOh9//wCqqqoAAABaXGo3AAAAQHRSTlP+/vxS+ikK/v4O/wPj9PqkDSGkYwSSiAHvnwP8sP4C3B/tZwNpjFsE/k7/QY4CA2+xAQEDAW58BQQD//+DAgMAnXiwqwAAA59JREFUeNrtlulymzAUhYWwEAiDiSmt8RY7iRPH2bvvev+3qq6EBAJjE5Lpj07vZGIn6OOcuyCE+AsC/Yf/PuyJKP6TJOcfPO9DchV2hDXI786rF4/xSLGX4/HY85bfQPnhdgTxEIg/zoNjsMe9gYjLJ0HeOiYoHgk0aSBlihL2xgAPLBTBL8CXR5QL+LNTDYQEj/AF9yzrwuZ4fKmqVLGtxCwaOYiO6qZBSTkvCzbQ0K7IWNJIfCF3h2AuWjKq6lIcYVzRDtpti47wkTQtU2c4irAxruikvc/3PEUAQ+IMMytrafyMB6EMWL1Mfldaxe8IVsIsZhAYU8eSxkSLhUFNOeEZUrDAGZPOsS29cdObm5s0WAF+9t6abaisTBmzgQoWVWCE8UzFJCN8LrK413DIUyrhncO+D0xgAyNk8hAmsiiKwo8aTvgcKeWKbsTYzrACwaaKeOJPEh4a21jNosOMLPP9CW6BxaUL/kbBIV+pZQaGj8j3f1gwqsDrjRobgFOsljiFbIRB2feRU4F10s5MXJlr2wHPChhp2FdhwcY3XJ1o5QCUZdLIMQkrGLXB2R5YF2wiWWxgdADOMFUVo4PSeMScEsYAF98t21AwWiRd9mow2JUpA0z1oFsFg1Yp3xbNkNUpDSO7VTAk5X3ZHla6RgZeV4YExpPqa/D4wTNJkWOXS1evPp6QdOVi9cOYNjOCag8G+KZFzdSMV9DCtI7ZJLUfSdgM1L1RMxRL52mWZWmais2A1zaDkMxgelGDdgoWl1tPWN8AZatlRZ2aLFVuz3i4CkSsAH0K7FesMi7Fzd4DXxR6eOsVeYgyFLgGtSqwV4ePFSGPTEmpiLLAIuHl8TPJHFPcjPqLbj/sFVWz0cYrtkV5yVcbbBmmHV7uOkRJg41KWaW9/1jRcg4LYGVwAccZHHc80FRxvXg47HqUsiIMkuXX5XAYfOl3fHzHT4Zv1fPecojqAb9A2SuiH8zFOWjMe8HFac2r0K8P/+Ini2s+7Wd7yq8XJ024W8GmQrkJd2xVG9xpSPbbfqFy5wm77j+e09ee7X8b5oQLmPSHh/1gYnbPZ8OEcFIoE/h5DiyA/NQFmBDiEh2dYMLd0ziO165QdqM4JwfxurJk4/h0Pczj7TYWJly3Fbdhkq8l++jmC7jLdhv9dGXspWuwWJY/5mJtvnCFiSjPc7edRnaloUoyPmnIRAfYbY1j8CGadIFJd7bR5xa6S6va6JYp+QN63frcMhahCwAAAABJRU5ErkJggg==',
      bomb         : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAA4CAMAAACWs2tWAAAAwFBMVEWUKyWvZmDTaWapn5ze39zUpJ/YMCdhGxcLERhQny5kIhhqIRpyIyEsGA8pexpPmiZPnC5jYmRxbARNly2gHR0A/wCPLij/AAAnIA2cPUWqVVVVqlX/dnayg3z///8wXxyCKCN//3+qVQAuXBs0Zx7//wC/wcNfYCP5wb3NgXwzmTN/hIb/fwB9f4GYQz8AAADVNSwSIQutKiOuOzXYTEQQHAn6/PnSVk9REw8LFAa5QTriTUXNQzvkVU0GCwR+AADvlzDTAAAAQHRSTlPt/v7////+Y//zDpH8HQcblf8CWQQBlwFi/wMDAv8Bj28CA1fdAf/8//8F/wL//wH+WP79/k3//v82/v7+/iYCjp8chwAABBFJREFUeNrNlel24jgQhUveY2MIECDpmSyd9Doz3TaWwIkXeP+36luSjAlZ6f4zdU6C7FOf7q3SYsr+IOh/DA+Hk+GfKX8cDn8DnmR313fpbypPsk8nHNfDbHgUPOJqzzX79e45328pp1r40+ZI25+z6XQ0utaes2x4FDz7PNKGT6fT9Oh1/is7PRmNpqd2huzjEfBsNjo5NW3jGaaY7P2wFp79g+11/PY0wlptNnpxBnpFeL/Obaxj+yqsk7bpZCes48NVN7q6fQlexLukfeEP/C8MkyQMeRQ/C//dJ6UQnvSvQxKqVEpVksAvnsIoJ70hmXMU9DUxr/gvlI6Jtm7rhvHtAXyWZfO81VHneRAElPBLpM1Lpwuot3WVdHQHx1lMdVvaaLQ+xVwftRZEOC28t4osTR0bBnWHtm1Hh4b1fV8IKh2qyrZWqlaUXvUws3nJWd+dCq1p29zUHs7r0rC+z+qCGiirJtFLQKZXcZErTkLWz7KUaK6hqaqd7wKo5/nGvCQJ6zJkWsP/ZRTkjv/NKMB3Wdm2k1IOv/NdrYyxyGVTq4bShYFvsyTPG8dnhW8Mo2pFVORBUdXKcS59b732ROkI/K59ibIbSMe2Zgg3mNXlQFsVjwRoCEPZBeJ5nmDWc9culFVF2Dy66yEMNqVweWLvUpVaYe0GOSGtFfzgRa7v6reRJxqGU217kQ00POacH+5acLbnuutL0g7BuK4XRTz32HOjsZ+X2Khhdsu2UwIcSDuxVvC8L9F4PQBc5vwYRRbG7w4+I17jgmGyE+sk9wvyPSF5TdkIIDNpFFnb1Zzh7T7cKbiRzirQsLoxDVt3DfO5YbKDEwPbif/tFNi2YloX5Al42C0V4Js9OA/Gtk97DcNm1NrYAU2N42YGitfZNMzaBm1WSOR5v1RaWpU1CEl4woAvBSWl5APHDcMe0bQUrpA4yjy4FHhJslIGl/c6pEbR626TYKmMNF8BAW4R3pg8wvYkqV22cmDgAfe/hmmUHJtNQoWlcQhNUvdMElYBWxZ0i2eYlvZgcNGddNElFaYS1CnRtJbuBzruqeVmyao/kr10r2B8wDcy+e644BN5QVwv5pvvLoMzLJahg14h0CzoSuOwKgRq4Cd0K75a9DcJWTofGIWBRQtKNQ2Au2SHOFH9BYhriGm90Qp5cSG5Ys0WYbZJpGG6qOap/SDsLkCT23XZPoF92GAf9HjFx+ng0kfHqXgayeYBsXlIuOsVu6ab1HyW9i/9zvl+0PnDSgf4c3zC8BFLn//QwUnyGE9We8EGNq9+3FPY61ST89VquVyuHs+wee3jbu0Z0iLL5W6SA/oRzO1Bss0/jLfh1Qvw6p3wSqc+gd+y3dPvEn7SsM0LtGXfgk3Zz5h+OBTOfgG2bxPxFTvJEgAAAABJRU5ErkJggg==',
      jalapeno     : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAABCCAMAAAAmNqV/AAAAwFBMVEWUJiDflpHNYl8oFgcNExpqGhWzoJyuYVtnAADUKyVZFBHh5+NQmi0ndQUwXxtYrShkaGv//wD/fwCEHxrKw71jaCVpHRuqAAA5cCB//39Soi8tWRqNSyvhRDxZrjIqGQwA/wCqVQD/AABixDo/vz9qagBd5Rmqg31VqlX///9/gIDVg35AfyUAAADWNSzZSUERHAlOmy0LFAb7/PnjNy7VQzsRIAsHDAVPoy+tOTBTEw+vKyPgS0PKyMWsSUt/PwBQUpHkAAAAQHRSTlPp/v8j/5T//wL9Wv/zA6AQ/wECtP/+8APrArNZ//9eVAEDAf0EAgT/AwH//74B/v9L/jT//v9VJv3+//r///8EHXawnQAAAzlJREFUeNqVlgl7okAMhkcQEEXQetSj3XaPds9hPJjiVKD//19tMgNyo83TUq15Sb4kEyS02aZeywek+d/Pr87Ge74deKGes6He7cAP+uX7F7jeDLzSjePR9e3A1DudPHqbhul6/csbg4QXb/yJKqGE28qqu5t/rus6zna71eHtuBsY06f9SdoezHGclU7H3YC7zw25bTewpu5pXzK3G6B09SlgTHWnDJzcavsqwLZ8/2uAV5NwWtHfXRr01b5QVgV09OGDGkI8PCwWC8fZp+Qq7AC+URL4gQ3m+xm5IEM6aAF0OvQvFgQp6c8gcjNwR2eB73MOv36BJHTaDAyofg58zpimCcKBe1TAuU0DSIbPGWPCsjQN/ggeMUSG9L4RkJIfmSBWr9cDIPKJ4BjFKIkgZcmCnK2/CGicRREXoiaC5JIhABeJGccmxADgUd3AP7f1AQFrdAQb/YSceGLO56YgFRFlIEH/0Z/4aGkpe7TssogLMAXANsEjPk76Zk+T/qNJfBRlEaTYNnt+PJqT0aTfn1s5a58p7QDiPlpsxRnbs0siSlWSKYEP3BYBxfbsoCjiAnzFSRKYuDlB0Tlrl0SQfDKwcXlZk4yF3p112gQYOKp547Ky4vzp+ZmoRGCcW5ocjbRxCYw6aLhriYDDiv44fHI0/IjLeR3UgXsVgXEktEQIFsH4MSanr6kPeH5kBK5pD8v39/clYfiuOt8FYKgAxgj6gxEVoCi5BsAJjcR7ZgIVBLOC5FpKfgVQR/SjZS/BfGNOEVkmaEsiAxA4vB0ARxEi0TQoFJM7wICpaVkz2AgpO0IMdgavSS4D4SUEtoPJAJDRXduZVq1TlVVWl1zWMKBL/xIiDXDuWvdQ2bRQeYCK5MoDZZAN4MXfriz76hPoXi4nKZo3re4aMKBPsMFZtu6Dyl5teE6nzUj9zwbVr345kf1Wt5/pN339waTQHR5uN35fMlQ2IQ3DUL8G6GF4wAlZPoWHA/wcAOoA9FA6GcQID7vdIbUyUgTQGRzB1FW9RKQdUE5vu6KVCVL3fytYSlwF8JK+6AAKKcmbp+7tKRVEF/LZdYimqqoZ0VikSuPCSxDlX28D/Q8/xAoaNpdP/AAAAABJRU5ErkJggg==',
      tallnut      : 'data:image/png;base64,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',
      threepeater  : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABcCAMAAADpo0MMAAAAwFBMVEUtWhc6byAvVxtcaVsnawwSJwlskFkZKR2kqaIbLxBEby6xy6J//wDPz9BBdyWFsG9GdxxHjyVHiyQA/wCHymRBfCF//393e4AlNRxVqlVIhCn//wAAAABivTRPmCplwzV3xk78/PkTJApIiCdWpy0QGwlcti0LFQcFCgRVVQAZIxNDfCYAVQBzuU8/PwAnRxg0ZhtVqgBvqVI2aRx90FOHq3Q7dB5/fwDv7O0CBA6D01o9fTWYtogrVBcCCABqmFP/ImpZAAAAQHRSTlNW5ZT8FiP9/f9a2f8C/47+Kg3qAf9VAv+HA7EBAP7+/v7/U/7+TP4zKQP+/AP9BP22A/78/f/uAv///gf/9Ev+v68E/QAABD9JREFUeNrll2t/ojoQxhMEFGyrdbu3c3KhhosWsRZXu+129ft/qzMJilQx3F6e50Wr/pg/mWTmSYJIiRbz+YLUFLr4xfyW/b9ZtgLM5R/Lcaz8SzPAC/zyD/N9n4kVUl+bAb4RNPHeQR7n3MeIvDYD3BCDegkIIJxyzoxqAvo0foMm6Wg0SpJU7Dml3Dcqs0DF+UM0GQ2Hw5Edx3vPo0BgiJgLJbmwy7kO8EpMxtPhh93r9Wzv4UEBqDBrj+CGrDhNADAYDgc9BvNIVRKOM1WChUVIm4LFAPCwGTxKAYFKQChiJjLh1XqNLmojB5jECDn1UhV/C2kkagSU+e/eLyUP959XZHENIDOQgN8y/nHw1mcHAPMOSv4+Pf2916SwlQu3UeMffO+/4QNAJAcAe356ejbPczgDhLYCvPX7b/EFoA8ApAPA45zKFH4DoecrQMgErQ2ASeShyuHx9tYOs2VkQn2QRaVPASbRVxEbNQbbz8IYYzQT9/WTCMvIZBAP04+PDcteCwNgjB+11S4jmVuxCuM8DEOexYeMCekOShhrCwm6DrPsxZwfsoZ4MAVDCiEUaUtZWkmqCPyYs4xnwqrXTMpKPLGFV4ZUJUxDmT+083h5kKlp56OVCCGDVMZMqaah5FaywYKd5AuDmMurVnICFK0kXucIgc2atl6wksGghwWOhYhxjKeWo7OSQgqfrGTEPF/OZaWV5IASK1HLUGUlOaCtlRRSaGclZ4DmVlIEtLKSIqCVlRQnsZWVFJexwkroWruMUEjlVjKRfSWLGpxEV0jQC0aJlTBhi9h9xlCJPltrS9kkVpmVfEB32emDp6ry6jZ/bGd2biUTF5rTTt6rtnl0OFsY7LOVTPaDets8Op4uDOEXvGRi2zW3eZRvC+jkRiJOa2/zqHDCRKstWInYCtagN0/ZKKSFkLOGeazfm8X1XWaHwrhRb54VyGK5aNibJRXWrDcvAE178wLQdJsvSaHZNn8JKO/Nq9t8yZWnvDet2nem0t68vs2XGcVlb2q2+VKnOetNuc2/kiaAz73JtHenK14HSeL1Vnb/tuL2ds0sx2TiEhOhyvvjNcArcd1aN1gtwKxxh9YCXltdvjP9+9O9Iz/bA76QP+Ir+dMJEN/9zwE3ZAyT+NIe8EK+inE3wFigroCOI0BdAWa3SfxC7kXHOrjvVgemKiSzPcAiJgCsTgDw8i4Ay4o7ASAWYxLNjmoIsKwoAsAsOkh+AIpVEzCz4OFoBoAgigJQlINmdQDwmOH+mAFgF+yc4CSFqAZEJHDTdI8DGIHT2xu76bSAuBwDupg8p5fuQS6ODXs0sl0nUGfsHFEFMNy9vd9D3Cp2bdvebHo/VHzGqAZEztQx7gxnt1uJwIE7w51hqDEENQFErvpuF0wDx5gGO6lgmsfXAsDSyefh6WlBQRZfPYkZ4SxaE19aSLOoHFBaSf8BO8KdzEmty2UAAAAASUVORK5CYII=',
      torchwood    : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADoAAABGCAMAAACqhXegAAAAwFBMVEUYGRzmXx/tYhQsIAwmHgzR09BcGxGfn5v/0GVrZ1wwHw7nVRupc0f/PwBcXAD544VkOxn/t0bnVBtSMhb//wCaUiK9wcKqVQD5kCZaQyZQMxeqOwx2e4CVPxfEv7KfhWZ/f38AAACKWirrVBtQNBgSIQuYckn/4nr8/Pr+myIRHAk8JxKQZThuSiR3VS8LFAb4hyCWbEH+lhz+qDKwaTttRR3/AABEKxIdGgr6VARVAAAHDQbvaB7l6OW2uLTmUxu/3HAfAAAAQHRSTlP28xUTi/8Q////UFr/BAL/8f+NRAH//wP8/5UW//X//wIA/v3+V/7///5N8P7+/jT+/v7///4B/nkFAyX8//+xb/usRQAAA5lJREFUeNqdlol2ojAUhoMoLmNHO9NOO/uQpCCSUBGBsXV5/7eae4MLYAI6/+nx3EPznf9uRoir19r9sIePJhHD8zv3E1u72f+gD98t1mm2NaCZ22HsE3jfjkKpjO3dzn+gWCqDjLPb0c7HPaAfGoslplKtjQXF3o52oEvWglmd2xO+gy4tAtY8HmJo8J4tkg0Ue3cjilPdBMFz83iIqVRAIeOmXSSmUi1AN43jIaZSn5NkaTXuohZ9gKku7wfL5vEQU5eWg0EQNO4iMZY68BMsNru7Ac0gXyh1MLmHjBvGQwxfuOWz7w+WmHGWXY92XAtLnfgDHI+5x0RvGkCpvp9AxmxtsiUa0z2YJkBCsQEz7/EFus7AdIH5+pixxaz1Q3YliqYBmp5t11ehT3gVLpb3E8VCjzds//TUjtr4gaaqSf6xUefJvhlQfO6435XpgZwUtq5jg1z7qQKfUcd1uiQMfx4nc7ANwDYPC5GurXN13FHIJaVompzIolGPtJDk4ejhrY6+AZlS4VnKdOKXbC3L8goJIfOu+/HCNUxF7HlwLgiSktQ9s1JkHHtChvaxXnI07XIK5ApNg2VJeM8oWyE5l0JMu1BbGc1sIoWnTNGnomSBthFXimho1xK2w4PpQiNmWYIfFPHRIeMSiqbMpCk/SYuujCR75Dg5KJfnWtRsyhiSBat3RY3hb7xaVeLH6VQWW5Fy/vkw2Wqb1AyiYSS8ahzlHDAh4IPzb5conhlHw9122xtG40os8xTIOAZ2yqeOU92mkFJ1eqbUjyox9ghIZKFax71AhSfU6V5/O+uLUkxxFUQcRYBGWpQKucPTX4akP4tLMThRGos8FzEWe+hTBaVft+gz6xGy9UrxELsUyzyXZlTC8R35QQj58vvrOR5fgaa92WxLUL14eo7VbFoSTrE1fTi9+5We40lab5MGpWkfzm93s15UiVuHU7CQ52wXVWPOTyuRwkpkWpSmEexdWotTXlnENz0KeqT1WHIuj5fixfqXUY3U1QLCa8a5DU0LNtJ91VtQys0XTBsqj6C8vCWIpK0pI4mXqXNxhV/hK4UkdlZbCTtssYUmwTbSU5fKP1d5K4vt6v6p3/6unXXDtA2EHzpH+0IwIiFvVEhGxteQ+ejvUd2TTo/+zl9NryHvr6D5fP6i0fxljv99NaMI6lj1GOD3ZvRFh75cg2pZZdqAntlrTGsdfn83sAeyGS06pUn3tWbq/gNFpx6l+JPmigAAAABJRU5ErkJggg==',
      chomper      : 'data:image/png;base64,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',
      repeater     : 'data:image/png;base64,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',
      gatling      : 'data:image/png;base64,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',
      splitpea     : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEIAAABSCAMAAADXXPJBAAAAwFBMVEU0Yh0UHxs0YxwyZiOirp0WKQ08lB0qNgcvXBjd49lwll6qzpdIcTVOlipOmSg9iRxRX1RWVgDH4biEn3Z0/3RVqlVCcir//wBwszY8hxt//wAhPRSIwmlewSxNnCU/RUp40kp8gIUAAABivjNOlyhlwjV4x0/8/PgQHAkTIgsLEwZVpCxatS0FCQRzt1BJiydUqQE/fwCAy1oaJxQPFAcA/wA7hxsAfwBsp1I9ih1/fwA1aRyFt20AVQCD01lmmE8OWS1cAAAAQHRSTlOd/ucX/1geGGf//P/s56qI9gP//wIDogEQTgKB//9u////AP7+/v7/TVcz/v4o/v0DBP79EwHOAv78Av3+A//+5odvNgAABCJJREFUeNrtl313ojgUxkNAEYQOvtS2053Z3bygFQSrjDK+fv9vtTchKFR0UM/Z0z96T1ubY/LL89zchIDI3YG+EJ8eMW0+9yGaeuc2xOq52NKXVyNWj/Dn+eeDjJYOjcfldQgANB9c3//H5yICFwFleg2iT/QHf7ebQfg+p4LCAPK9NmL5RH7yHQyWAZ+UAoWyFnmqifhFyAP3IxEZZCcYlNMA1VXRT1wOwzebjQ2Q2W6W7iWD8gAnqzqIJmgAQFvGX1EaO06qEELH+58RU4I4BUK3a1ldw3acvcirYoTAePwTokNaAad2uwvje3YPdMxkSqmyAjnVtzLkmPcKxIq4PBQiel7PMIBipzuRUp7LcJO8/3ZZqQJs0MxHuwsEy7IMOwYfM36QgRoyTBMk662qXDjQOYra7a5tDLMwHH92QIQsXuP1Gn4xMgnCLdIpI7JMUD+y273uMA9rvzsgKGNBVi2R66A1xvqvMiLzQeH7/UGD5xlGNKP04ISpsvV3DM+xTlYfjGAxHZ/5dq7AMjTNs/0CIo5yRqxp4OS9iFgSM5aK/UiJMKzh0NM0jVciHPgGlREmaTGFUJnw/hUqNC3kBSNujsDzuSYmLiAgFRmCu5ZCaFmUEIdkrOfzOS4jVgQzKpMRtpWRjDCn9AziowqBCDNET2Xzb4mweRWCViA6YCQoO7HAimdEBx9QF4ypVlhhxCSNOFBV2DtW1nBzTEXIWByoDVOlYguLmjkpMXphyUeOoByfLqooLZbPEaaWKu8CAUSwOG/zitISqxooGWJjp7BZ0+BIoFQkk+U8HlcUOGwz0UUx+I8wDH9wXl5RkJlFiKu2mXAS5FYkpaAgs8HiGH4gMG5UbXZZn3IeehoZAY4c9PraaDVM8aStOnJWCchgAT1h8IwQuMcB27PHbyy6hmUh0JJ5YOL4NWVszx2/ygpMF/I8E+IzM8HqPAQEGKnuQUgzTKgUsHqPIiI3Wx4BBDu2MFnVvRwgVhmD+veLJ8hp8HF8cMXlQHoxUVy0AIDBNVcUubYAceNDLtzBtRcluOk8yuJDcFmL3ZuuawKiq38Wi9sujVkF63r/ub9Y3Hp1zS9ezd/fLtfTF+J/RXwnTfelRl1eQEzJC2vei2h+CsRnMCIW9eXeuph+FXgJod/12t8hi2/EvAthiuM3uR1hkiTJTvAbEclTrmKckEkicFciYMDAaYjnSDKZNCZjGROIpC7CJGMnjfZ4DCpG3h4pxngiODVVtJw03aepg3+jPbx8O6PJSIQC1UDoCO8BYA8aKHZs295svNe3kYpzjDIiMc0GGsBL6QS5o4Zjewiht9HbZcbJiojUwaAWDJVvt2LsG4RkTOogYCbRHcbLgSpG1yAEI5t4dEqoa+SUcZlQUeBHRkHGBULVHjkwRkURZwnkP0MRyKIq0eVSAAAAAElFTkSuQmCC',
      sunshot      : 'data:image/png;base64,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',
      bulwark      : 'data:image/png;base64,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',
      sleet        : 'data:image/png;base64,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',
      cherryshooter: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAABSCAMAAAA/3EdqAAAAwFBMVEVtGRjUYVcZHhqYODClZFs8iRxdIh2uoJvo2NVrJyLfqKNsKyOQNC1rn1Y8jhkbHQYRGAv/cXGqVVWyOjZTqQE+fAA2WSg9iRwA/wBYXlT/CgpYYTmTnXWNMitBkyC1QjnkSj1ubgA8hxvPgnvYTUOxYxU7ZCu8w75qamqdSDNEajTfw748R0x//wDNSD98gIX/fwAgQBAmOh8AAADoVkq3Qzr7/PgTIgsQGwntdGoLEwbGRz7qbWMFCgTtZFjNTEHJpRoZAAAAQHRSTlML/P70/+Ng//+e/+6b/CESVwIDFAMEn4gB9gHm/mv+sv8DTv+RA9v/AuOx//8Cbf8CboMA/v7/WEz+M/7+J/7+M11flAAAA6dJREFUeNrtl1l3ozgQhSWQWYwdIM4w4y3tJN3p6XUWSTY2xvz/f9VVQoBwcIw950xecvMQCPq4t6QCEcL/g8g7/Kbw7WQWgyYTcin898w8O8e3LpMYieXHD6glXopJXxjQyUd6AAlU8WUEV2/7wTGgh22pvcKFBDzuAZMZ/ym2jQ4aX/IZOQfDRIEtRe1b5sXorPMs5lQg+VThlGnvwj6ZXMMT/gHZoRLcgM0Z24ram7wG3/KREPRpOPQ8b+iy+ZwZZdNsdGLOSck6hUBfQBfMHQ5bVYtCOpyUUiWSFhxzWyDsuVMXtGCMKlpU1nZYjydHzrfcFwr+BrjrQnSXMQMG61HkoBB9IM6sVbNdwkOPuetS7tSAqbS1Aj/kvu3wTxVMsGIhDkCzz+tKHmtgIW3VtdC31PaDICC1c5laQIsYvlA8beBMsu1eabtlgRVM+EMd21YjtntWuXquZX2vukQVLQ97TUvLCpY8LGH40TDVxq63Xk8tyzJhm1bWNlzRbYOwI9WIA/1WwtO/0NmyaBe8R9hvYF/qSfU0bJUy4broQwBXghfOIhvq2BoWHfB2H7SdHVl6rBZ6vr4rlgljtiU76MUKjmMX7dweBJ9+blILCaqOj2PbWfn3FWt6ZP20MlNX9xfiaMKIrXOLbFHTLGulbsP1UmGTyGpkxjzdnAZLgbWpATdNgu2ZVdaCFgweLFYYBSvjumRht9oTp9u4KFarlTCFFdepjx8MzJ3JTJwQhoZHUpa/Aqf9SGJuc0Y62Mx3fN/HtwEi7ZfBnyFYd3urzJndvT+VMC41DKLdrGxegOTlC1AHh+i0C3391ctVj5YDi2bRZM1OXt+rCA9kpQwkm7Oz2w3KlwbSsKM++/NMz1ob7bXFqn2DjOxW4Kzv5q7mHHFVsirbvuCzAk5wJFmOQF/mF37QmPvYYHDpp5TmJ/GneDAgD9d9Pv7Bbwa/89/e4f8F/sFv7h/53XXwHX+8v7kevnkz+K1i41I9Xr/Od++9fdE/oiEHOLweHlwHh/Xb82I4DHleOu/gKLwIBiCZRznAeZ5H+W6Xo8JecMjT+Xg8fk7BOZ2OE6CBx1v0cY6QHY/nz4NkvFiM52mepjul/BwcJs+K/Rol93iXxWL6b6rUSbfh3WYTJV+TKMqT+xRCTJMk2ZymW3AO5eVRFKWb9B+AokgdgxSdn4N3qRoMw6NNpbQfzHdII59uXrDnYqP1Mf0Ke7xUDW1Yn2JfrHNNp6ZxN8t/AVUrcjCAMmXVAAAAAElFTkSuQmCC',
      blazepea     : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAABSCAMAAAA/3EdqAAAAwFBMVEUZHxibVRzXcSFlYgDUj1hoGAU8iByWTBJdMAuqWAI8jhmup51rn1aglW1sNwz/cQMcHgMRGQr1hCtkWilsOg/e4N710LIA/wDftZI9iRw+fAA2WShTqQFVYFRBkh///wC/PwCSSA+deVfTahf/AAA8hxs7ZCv/qgB7QA68wcA7Rk1EajQmOh9//wB8gIXUaRcgQBAAAADveR3HZBj7/PjziDUTIgsQGwm+YBcLEwa1Wxb0kkcFCgTwfCLsjUN/PwH6CwYzAAAAQHRSTlP+8/sD/hjknl8NIf/8/pwCElf97en//wH/iASfA/X4AQRr/6MBTtsDa///sYMC/21uAP7+//5YTP4z/f4n/v4GMseF1wAAA9VJREFUeNrt13lzokoQAHCGQzTIJeC6S9RoNsnb871hRFABv/+32u4ZTqPxeFWbf9KVVLCc33TPwUAk+j9C+sDvigcD+2U+fxk8KNdi225/Ouc7WEE6WDxC6PpCw860S/ELyEc5xhiN4ogRHejgMjwHGu94FHEeRdEoYsDtC7A2p//m6Arh44jHdkHn2jk8p/QxLgpVVQvkRa2Zfjbz1zmFwaplYHKZVJqcrLzEA6qPcmATDFWViUfILq9zP7yFbWEnYwxj6XmkaIaN2j6NB7QvRzK3E9M0J2o55xXe9qmm8OBD3HewTWGAiM2paRiGuSQy13mliVPvI+0g84BauKqAJ2OwQRAYS7Jr1810t4+hAVX2/3ztjJlAC5jr8XhprEQYpFktLJyI8C2HWqRf7jvACu0zgVXz26qKgDRlAxa7Ns5lYvm+r3yqsKg6gi1C6rzTqWGM2pgUHBejHfElf0CVumysOsp3sVllDQxJ+r6sq45Yuo2rIJLkL6gjsEK1LW9RxGViI1itppIkdbA8arCk032F+wLHo7HA09+YWZKik9iqyt5Ti4kmclBiSYR8FHvwjU+1CvcFzuVJWXaJu5l3YsY4tlo4FTgqJyz4zu2yheu1ivMDbKUHdQdQ+PSb3MGsuu6UjRNW1h2pzR5ZqXK9zPIWcPWpM2G4VGW3uWzW2mws7JFW5s5S4SZhjRaVB20bpVB2/WHb3iR4irC0/CaP2NKEe5JFeXuuYbYb3NmefNCs1jDE8m9TNPzAUQ4BVVte+8bgdTdjyjGiqF10yrZlEL/fvSXxtmqvxUFg0UzvW5aFpwE0PzgMFIewND2qZW5J63l2eADyUafHcmOfMNdQ556H8voAFIW/Ti7jXIF98+il/NbCAlPG2nsyLe3D288qm/q8YYqAh7iC37OPGwxd5IH0GKIDnveC5/Oc7xWWVpnF1UWPWF65pm9LVqbeXvhw53MOnAjPYKavea0Aii21hQ5BvCtfaFBWi9LrXfsqJfbf/sG27Vnv+pc4EZ/oXe8z/fKB/wr+Re9mT/T+NnxPn2Z3t+O7d8PvVTYu1dPt63z/sbev+kfUoYCd23HvNuzUp+fV2HFoJjJv4Mq5CgMIPTcDnGWZm202GYZzEXZo4g2Hw+cEMifTYQgaPHZxSWYX7XDoPffCoWkOvSRLkg2P7Bx2wmduf7jhDHsxzenPhMdR3cWb9doNf4Sum4WzBIqYhmG4Pq07OIPhZa7rJuvkP0Cuy68huM7O4U3CG0Nzd11FchmmG9Tok/Ure65sTH2o37CHS9XoVupT9tU61zppJz5u6R+dkF+Zi7BWagAAAABJRU5ErkJggg==',
      blazerepeater: 'data:image/png;base64,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',
      minewall     : 'data:image/png;base64,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',
      cherrynut    : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADQAAABGCAMAAAC0TEcTAAAAwFBMVEVnJB6nnJpgIBzMnppVHRkuEA6mMC0TGiJwJyPNzciXLSagWFf/AADFYWmcLSWcKyO9w8IxGg9qampWW1+qVQCaQTzFLB7/dHT/////cQDzSDnIwryohH3//wAAAADIRDymNzGbNC7PY177/PkPHAgSIQvLWVLTZ2IKEwZXHBm0V1K1dXC4QDl2Ojrou7iILSj1OSgGDAWyaWSqVVXLS0PVqaXo6+dVAAABBQ2oSEjxxcPLNy1/AAC2YVzswL1sJiTrXJEdAAAAQHRSTlOV/2L/Kx0P/+P/3f8B/6Bq/10C/wP/9QIBAv3//wEB/v79/v9MV/7+M//+//0E//X+JP4D/v//A/////4C/v/9pMAAdgAABGRJREFUeNrVln1X6jgQxtMWkBeVq3vVvbt306Rg0LRQrFSsiHz/b7Uzk6RNAcWz/+2cwzmkya/z5MmkCeP/Idj/Elr/nEOs19+Gzud3TeOu+x3onIhOSEHE80kIRnTHl0LEGELmLISHP/mvXq/3GfQOOS7FSkGsYhMiZ1bhP8ehOefjTCUzjESpGgt5bzz+JFOPd4aIJBSzWZ1NytXFX8tL/usQ6vFQKIcQllhqo4qt8ijmMeNYeUhDiY0OUoA2HX7ehpBZwUCltfIoA63SQi2XyzH46EPPPIxjlehtkaYpiHEUuiGWyzgGZtlrQ++8IyDRNo2isiyji0K7ZCAwGy4pbnvnLXnPfLiKFTALijIqlJ/qFpnN0E7JQs+cxfGKmA8MoGqFNKvh7e1QCGZLihlxXagbVSCDiT7e3qILu8aUKs6wsETexZqpIUgUa4LeIBZlmRZa6wqMnLnCAAhSXTtoza+wQHVa4vgoHclRGqUaKbmTma1eKuCQry1EM4pX+iKK0mI0KoIS9RWkT1U3UkpX9XZWJK+bI5SAvjSNyihavH0soi0trlJaCKQEQbJj5c05y/A9NxpHl9FgEAWLMtXodxEMBoHe1FZAqjlB57xPBiUJLG3wMoF4CaBukpn+PaEYkTqChvxPI68rY5IHBRFMbAQa8tStdOP8I30M/A7NNGEGI5snmLyAum3Tqpx9IsTpoHcGUvWrg9c/JoHyW79NqkySfww09mMfGgST4Ow1iJTfKoXThwWIc9qZBysDwYvPcFhWea2ohiR8Ztiad3K74CpJcQ5nrzDsR1pVhdfynVgDFEoLrZLqbxj3A8YFAz2b6aaV1+WHlcTmDSQyNRqQXy+DEe4K7Vo3oi4ksK8HEBOZdSaGcRH6HMEqYRHpEu2Lso2tCPScGUi6Bce1UvCR2NbbVuiiqJwJ9OI25HyHGjX7b0ZbabNpOjHRMSg2hL6Ru36/1dGGQtHug92we7SxEwcQGoGWGyearkcvxCGE69SRe6nyx34D5V4H+kCLC2WUexAshJAgq7+D6INM3LSiTiRNGeEeFDKrCUGpqguKihJljkPIFCxuDbIJ+rL6HKv0aKSrXHgKcEZSXNLWwDrCVO2JCeHJck8kVdHcbPccU+2vyUFQIvDhHSHYhULIk4xJ7j4sWLLfgEhc/Qkz+k5RhiF17rNMek8yxjt3AITyBGXy+AcAnB+Y6gvKaoNEd/6hln9FOcbMyDs+TXohjllttO0dn0j13ev2sMwcNNgzdLe45kqQW0p65ePaLXHN5ePaOGgwJ8f7S7vvev9CNW8oM9pjLTM/vLq1qXa0Gf/q1uFhLo5hkla1e/yS2OXdfjPzRinUdsdnDi6+LG/Pn0qOPbWYNvT08PA0JcxYYf6wK3z+GQR9D9Ppw5T1c7c4ss+m+KxN+RAx0+k9/K4YxZVt7lGslYgYDDP03jaQejoFmbH3Fv8SquX5kGM+k2eNaFFHmQPLm2k57JDZW9yamvqJ9hn+L8XCwojFlpBSAAAAAElFTkSuQmCC',
      flametallnut : 'data:image/png;base64,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',
      frosttallnut : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADQAAABoCAMAAACJ6iNVAAAAwFBMVEUwUVwzVWDU29tMeIg3XGgUIycNEhorXGCo0N6QoKNQYGtId4dji5cPGhZ4wtz///9CbnwA//8zZplCbHuVWWlHdITSVWhbbqJ/f39fnLIqPFGjvsV/f/9bl6slPUlttc5/v782PkRVqv/DwLoAAP+q//9dp8JVqlWqqv8AAABvts9ZkqeIw9fO5u9rpbr7+/gTIQwQGwhWjqKJucpprMMLFAdShphmnK5VVVWKq7U/f3+ryNEGDAWut7Z///9VqqrstFJhAAAAQHRSTlP7Y//pnBb/GP//9qbyVP4BlQEFcP9r/w4Cnin/AmFEmgT/A/8BA/8DAwH+/v7//v9YTP7+/jP6/QP/BP8l/wIDvA3asAAABXpJREFUeNrVmGt/qjgQhyNIBau1btvt7ezZs+fsjQRjJRFEtH7/b7UzuUBAQHff7bzor8E8zsx/Jhck8X8w8v+Edvv9/m33b6DnP+x/p92V0MsC/kxGYAH8s5hcA32P49FrLimlkvnjrxDpZegzfn6ld9RaNg7iLxeg30/xLw6C7vxRfBqElqf49e4uUeY4a1MNaPkZ/2oQl2JjCLoX+uYyDgbUvg/6BrElXZBsUQ6kNEg6KZ6NXOVraPL5TGmSdFO5H3zpgr5DcKIPkuzekZDUwT0pRwLtQoCk7oQZQILyoiik6NDdj1/a0N+gAjKFKMtS8HOKs7ozLLQIckoFjUpvtVqFDuW4CpZN6BkzoqJQTIOqoBxc7RvQIp5Bm3KhmdWqjKz6ohbQj5cu9ByP8HlUGmbldbhiqRWQGOluG47AVUHbEGe3pnFNeAGDp0XlCLM6gyjL3pzw9u3o3PgcyEpBdHQ+PhRhDa0SCwknPl/Hp8MLsjOoPFdC2viIjk6eQ0IkffERFd2YulBYlu8Rz8E451S4kNZPh6dSolG48kpRFNF7WUJPYEBA5YxxWSUVmPB28ZwpR0JEhQixVt56pSQPQwxPcuB0Urq+pE6J5jysuqhAKM+pzSlXGGMPmBTB5adS4jlPlJeyyAtwCvMFz7OcVwnppE4KWsRT5TuBJg8hJdDDs2UKE0iEMRWJRMiH6UqIQOsAXyxgDRZRVIShbr2QzmazjHFWlTebKCFAh0xDCS3CIjp63jGa6SrNZj8878csq3uCoRIEdWAGEmIarZVFPugWZtXInAk8VeUlqAM3UML1LA/mcRgV1cjEJ1OlBMF+MLUDjfWsmxtvPWuOHOgToEVALESPOGm1PsK8IxXuSFrd/WCh1JtSFzqS4/TmJippY/SnhbIgbkHvOpwbBQl3JBvQLp74BhKJyhy++eY3r0jcUd0W6STeATSqyqDjW0fT6frIheD1SFYQFgo91VCo50EqGawnntkRu2t62jc88azwwAoZqi6SeuR2LVaXTOIxq9YYxwbE5Vrt5OgQF5JeUAjdxj8BNDIQ9L5znJljytmKpIYeFDROuV6CtDo+RTYlYNOZewthqiPgSHQg239gOamM0cb1pRNSFCekh3Ig5n6AK8KFfBfiFTRqQFR5mhpreULoqcMTdlNOHn9W9tjKKU+15FDctPkJFjnzH8H8TDY/YKnaxKCN3jLW+kwn3fEQysR0w37NGKdXmWRVw4Kn/DoIdVCecPtn7HrIrtwWhPt9bTmXDR00BLsyS2W9G+LJUokg9TfwWge9scAWxtKq8TslkbnazrGJzBZ2wuoys5yGhNM66M0St2X8ovyCGibTB7Ut486C8cmrBDcHAB41LGVXVskcNUq+Wr9+U9HN8Camj0+A8uuis8enVuJifExBT+agVkqw9ELTqiLVVwLdSJdcaUeZvXyonrjkSjtyrjkmKXbZkb572KsbVmqoVlo6XaXqkkjYYIDSrBP3kmjjY3KorlV01cXX10EPJmSjq67YY/W0O63cMK0rtq5vD1UxEN1f7r18iU2rKdkTGzRrsGi8a1RStFc8rxndd+6r0NJKgc54FwIt1HoVgoavXeFMvCgzF0FH7ZcueHebOhNSZS4CGZ293tUC9lnXi6TZynpM3/M63qhfAr+fyiZfJl3QYIA9r+HwIt4f4H086ftpoZe6bTCtXz4CtZt1MMHQbyxApW3dILZg8IeZwzYetTSEN/3tYQA6HLbb7WFDXBH9OT5sYqThBmyz2czn95neGrP70Xzzsdm0KBfSyAZmzTfzMdj8A5APfNSkSMORQpSBu/nc/o/U4RJkJmtiGLLhNaBL4SkhWlQn05J866blJDQguUNtXEdtJv4HuZBVuvOc1UoAAAAASUVORK5CYII=',
      chompnut     : 'data:image/png;base64,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',
      chompshooter : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEIAAABQCAMAAACalFNKAAAAwFBMVEVeKl3k3NibaZhdGGMVHRgrHSqGHz1QKVbMoaeeTmNJJE+vo6xhVWcmGCeIL2p4OIM0HjX49vZ7TIReWl49G0EsG3E8HkP/AP9NSU5WQlfQssyJjIWbPquOQZsAAP85Q0bCxL+QQpuRkZF8OIiEPY1VVaoA/wB7OYb///iqVaoAAACLQZijS7H8+/ZQJFaMK0evZrsTIQuRNE4PGwhVAFUKEwabRqmoV7ZEHEkGCwUzFzaGPZIyCTJuNXa1acKsZnU0y9pMAAAAQHRSTlPx/v4S/Bv/n///U/vxXP/6lwb7BKkE2QFXqP9//3cB/9SDBy02AwGlmAMB/v7++f/+WP9MAzT+/fonRP4M/P7/SzVzfAAABZxJREFUeNrlmGmXqjgQhgMhItug7dLLXWefAQ0tIqKA/v9/dasqbCouPffj1OmjJqSevJVUFpoFP23s/4BIioSrXzwRyccRSeVTgAnFKT6EQH8hvOmUSbTp1Nsjp1Z1HwEAsZ9KVuZhShbmJZNTTyj2fQT0JEaS5elisV20loalHPVBWI8E7kk/3W6375XBz0VKlBwh/B4iCQQr08a9wVRafLm/pyIJPBlWgENLODSQlI2KmwgejNjiUHmFegU56OH74VBD/Lm4gSiCUUkSDodt+BS2KqCwhTpCbPO5eL6GqAmHd/3pST8NhGrelY58niT9iCTYM9KgU5+n40m69EqHP+rMbRcxEzJVketo266KLVWFFWPB9i2DdUWMcjUQuqMtl5qjN4y2ppmXNj1YZzIEW6g4oDma1jDamvc6P1oZrCsiXJBmh5pDv46KBWu0qnLbyGhmpROIkAtSUXXpGK6mk6qtrmmaYWgko07TspHRIESwL9VDnQDLpWE4+mes+Iwj4Rou1uv1qsunweQMMQmmeYvQjCfXMFxdrS792zcokYwGkbKL4eQBC9XDEJuiCyAqqCohOmwQsrgYi0KqZ9sUR06bg4+TVs2dWoST1mOxZaIajC4irKyk8YQh9HNVkftQoLoybKzJrhYh+L4yz8ZEWn63vbbmOwKctma/t/nt7ffl06eXezV9Cd6Ymq3xhPNZFeRkfHWjv6ZiMvntLzVRZE3uFF0Ttw6BhJxt01THiGSmaUNRntncLq4eAkFPewD5kBVpx3zDEBeI8Xj8bxD0+Ssr887JsoBsGfWrqAEMLCJjEVMhZRkDSJVxC2agDHYuYvzCyDeO4o6pgnpS4jFFi964RIzHtJLmsD0stciClNSsCH4uhwN92RT07A2fgxhErM4QwT+AKLMjfA4HEe518WAIhePAwuyMqFBmuJbfPivEuYoAHr6xOAZnK4qg/TCKLATVBYAPMynhOewDhPDODgETVpg+iKG9FsXofIQvjCOGSJBq4XOWORhHz1jMAi4zDRpie/CKwBnGEcQj1QIq8eA5RIJxLMrzSZ0FJvChe2x/HMTgjIXBEb3AedhUMbak/Sw8T63nGZOZhd1DJOR1RK/IGkYk5lhXRZF0SpzezBRnCc4hd6AV6qWv7udpFeSZDVsGv1hmiIhuWlx9A4L3LnYIRGJ3kaXTlxNHdSGKHarSLcJAXxxupReL/c8AFgejsGlMY5xSLOCAHJdxPaYRJLpks95dK7AxkriauXZmrdOZJRFmMOu7HHCUISml0FmjrIR81CEOXDSU7EcSIfnX3vsF/4oDKrGhRomNziqxcVVYqAjgSLCvXFFABjFoudKK0gi0xBW6pOVKq+yUcLHlCOjDda2jNbCOYFGMnzCaYFhluS7mxI0bH//y5e+SEu+XXmO05fhffv09eb5y45NhGj5gaSr771ogYu6H+X1CHuaQnLz/0jhlj4jIw3LOn6+NRVbel5GH/vVJhW1Llo8QGOdXZ2TCkJHfAgAh4wG/nhecwWFzC5CzM8LlaVaYmVSQ/MJdAcxTQt+BaLOM3uwuNfgAyOzz17O+d7MZQGAhQBrm9WUrR3fwRwkPvCFCHxM42zPEtJahP96vkkffUwO7hAtK1hgzbbqfJQ+/LfOE53/gLdAmq9IgKT7wwl0EvDSLk9c4UXz0tV+U5s/+80H4JtzwxH9G7ODfBqBis4G/3WZH9iHEznS9XcAYOHu7jTL83u3EQwgReK7+rrM1IOCX6W3WaBWnT8ylCvBDYyUzdcfRXW/dGGHuIoTJEPD06pmlYrmjVRdyqeMcsfM8z3w1vfXG9Nee++S+vo5Wq/UKrIHcQ+C4gfbVyjNrr1VjjyLW1LbqumPrRxGbjer4HIA1jwXSMlYPiuiZVAyll7F6cEbUgCJi3RNGb178AAevKBMVnZaFAAAAAElFTkSuQmCC',
      chompmine    : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADgAAAAsCAMAAAAHH4uhAAAAwFBMVEWpoK0aGhxTNmBjS3JMM1ff1+EUGB1gYGA7J0aQbZWxXmNzGHQjIiTHtdBRny/WLx2uHg8VdAfLVVE6byNKLlagKB0vKGf/AAAuLS/qRzi5pcI7JUahJRuQOU+qVaomTRV/f/92Fwt/g4cpURdVVQAA/wCqVQD///9VqgAAf38/hSF7Gxd+LDhCWzlfQW9vSISqqlX/fwDAmJQAAACOXqdyS4aRYqoTIQsMGwb8/Ph6UZCYdaqGV5qjergKEwb3OilCaaXxAAAAQHRSTlP/HfDwnf//Av/+/QVg//39CQz+62arEgGN/v9Yfv4DUwI4/5oDAQMBAwL/QN7/sJ4DAv8B/v7+WU3//f7+/jP+hEWD3gAAAr9JREFUeNrNldl62jAQhbUYXIyBsIQQCE3SLd03aZREFvj936ozIzt8BkObXPVcmLGkX2c0koUwL5T4/8Dx+5eB4xc6js14bC6eD74zcnqNz+c75sOpbE9XnMzz7ZDA567xI3HD6a7hDPVXsJ/O5fyawXo/7ujx6xSY9u+qaDrE2vyUaXz7cnV1wrH/mn/kajZLZtPPC1nNdWHOJ5PL8rzeHNGCzRLtQ3DOWf0NQKskp5nOJ1nG5IcWEDGZeLep5VgWVCJvR9lvAstbc9biOP8RXFEpotYSG/TXMkPHsiyv2sAEEywKgXoiC0QJzkblJfq1gH1jtLOuEMsBakksgWITyd6oZI1aUmVuOeiQBp1BJF3hIrmO5EFxboyi9QjiBkLEdDcOf3oeM7XOrkeog+1ITWLJkByX4hElesWmiJGGgH0urNfJ/gFITQ5kWHBpcHCng6SrI6UC9VqA2UW6BypLS6Fi8mjR1UjWkWbQWvDKNMC+kcpyCbAaBIpH0Y3WMYJYIA96Xn2eEZRmFbuwOuTY6b7pdrXYRaEGYWZkA0wgctZ7SlB3u+izi2ycFsAntOENME6qlVJkJNCvcHXkI9cGrrS3Neh5Ezo9Z0OMQjR0ASjVfrM4vFdc8WB9D9MEOtwxqjjsA+ibT3vb4WO/41MSAualNS4cI7fjvMYj1gRXGqqZmbZKvUIpVWFUNuBM04Mjhx2hGmUdY4zWHGFYmnT/zuFkwdd5KTQjMYhtgTktb9ouKyLBh/gtqIzumEzxojlL4sz8EMQDoSAOCGQSQq+HVxZWx8MTJ49cj3i9QTXKB0+CWh6S438B0uQ7tCEP33Mjj4PbrUQUfAPGN53kUm6Pgsg9kBaJ0gzwBHghL7h52yAPwft7fOT5ImEt8rxuOwFKBnEYD6x0H/UPjvXQpk6B5ij4cDrVaNlqx2Cjqn8AiFKtsRt9xzsAAAAASUVORK5CYII=',
      cherrysquash : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAA6CAMAAADbe8pdAAAAwFBMVEWpYV3e19RnJR3WpaGtpKBqHQxeHhoNExpSojDMWVsuEgxjYWGnQjpmVB4reiFkVgtvJiEqHQ7IOzIvXxuDKySQMSmqVVViVB6jgn2hWAmILCU5HxL///9tRxzCgn27xcM1Zx//fwD/f3///wDvwL0+Q0m+wLxVqgA2O0B+goU7dCNBgSUAAADIQzqnNzCbMy3QY1wMHAf7/PkTIQtIFxQLEwbLWFAIDQZxKCeILCbWaGH/AAA8Ew9VAAC5WlR9Pj7qchU9AAAAQHRSTlP//6D//xdi//r+H///8wYQ5l//aqHSA3P/BRuAAZ7//+ACAgH///8D//+KgAD+/vz+TP9Y/zT+JPb0/gH/A/8EWIJLfAAAA65JREFUeNqllXl/2jgQhmXjoz4xEMjVpN1t9+iuDiDg+IjN9/9WnZF8Y9yQvn/wk2Q9fmdGY0Hob4j8ess8/DiM6Ocw/BAc0tXKlQF8xHnxCaT46+B8fv/69ZNUsAqvhOdB0LLXwXOEFbu6utoSXq1u//8PMv7navg2eGrP6zrYBPh2boZhGF7dJMX89BTcFuY17ZnnCJ4+4/gpwNb4Zhb1+jucN5I0LSsIdEu2R17k73I2H/DnZs05Y0Hgc55GuluvT8K5qes3urUm8RbEhRAM5IvIgmXdpPmkc/FALRFvs2yrFDMlnlj04TTtDJW58eOaBGVbp6KFLh9fhk/UXLN4W6LieGgeudS9DBfU5SwmhDjPz4RkA2/GU7PvTXodBaxDyEyJEGRL+GUd2rwA5zRlrERW0wC9e8aax0QQv6Xdb+NwQXUGxoB+n6E9vKCUYZdC8ArmOt2MwQW1uIINcgfeGkYuk3YcqDWvam7R+xE4pwk8jcnMQJwY4CzhLPY9X3DOlXXq5ufwhupcwd9nnqFpxp0hw84Izr6QscAbOHfRmMWlQ7y9FNjHyFYzwc6sa9iVGTPsELlb8wygIWZPDpGWz+FDsZrjquE/VNTMyXzcamiebewB9iFmz/6Br/ObuP88K1iiktoSDX33hm1rEDYx1BBosqziHhYMmitVcIywYXu2bX8xEJbDv1tYiKbNSHPIqiDM8dEF9tv/ahA20f7CMSZNqpOGpIsefKK6qFuQyHrZnjYrs6y8k0NYmtVtAkmfBrBVtyDjsrjaXpPNSYy9tm/rpZwvw0wYuN0o1ddczfzlBKzzBmbcJ7JB1EUgZ01Ygp+FXXSdQcslix1fpGkKXzjOWAceFgyPindpCP5weAMdDml3FeCzo8Im6cMJYEpvh05C8GkLl460ZzfwtGGBjnrwzVl7ynJ36ENP3XK1xe59kgP4rVILY8KQ8tknCZcLHFZLp29RUimqw0ZfjHozcg2hdUtHiVMpOfgdtmPcge8xa9xQewsilSSdfDHjzdjVa8qCt+ZLrlTdAchi0KfxS39OE94zb+TjO2XQ7qV/DJeaqaTri7Y+ILWimmviL3aRyo1C7VaqJwJv/An4lS4iXlVG1Kpewfl6ARsm4ONxp9eBd4VzfXc8TsDI7naPCe8FroapDo8G9Ai82+lRG7karAF9eQ/8ArsWepTWyQK5UKvvcX6BnS+7xaMu9ahIZCfhHi2tZCA4HDMenvPr67EB+lLsr+Bja92Sih0Y05+oeyev4E34vQAAAABJRU5ErkJggg==',
      glacier      : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAA4CAMAAACWs2tWAAAAwFBMVEWcztxjl6aWrbALFQ3a4N5xyeNrtswqTVcLERlQny4scXNYX2cyVF1wcHA1X2cpeBpPmiZZpaUMFgxPnC1HeYZNbHPPUWNNly1Qb3X///9VqlW6wbxijZgA/wBqagB///8ZJF2GTVswXxyNdYVUfYggPkd//38A//80Zx5dgYtjY7EuXBv//wBXeYE5cqyqqqozmTMhPEcAAP9AfSVLiHhVqv8AAAATIQua2Olvw9z7+/dXma0RHAl3qbaIucan5PMyntSmAAAAQHRSTlP+9f4p//7+/f/zDP9lAo8JGwNSle5h/1mOAQP/lwECAhP/j/9s/wIB3W0DVwGvBAMFRAH5/wMAWP7+//5N/P7+O+6C6AAABDNJREFUeNrNlmtb2zgQhTWyrQTnSkg2yXIthVKWdu8rbCuS//+/2jMjOQQ2FNJ+2XmeFtfonXM0mpGr7A+E+h/Dk8nF5MeUP00m3wFf2Ifrh+w7lS/s5yOO64mdHARPebczYf962Of7LeVMhD9nB9r+YpfL6fRaPFs7OQg+/zIVwyfLZXbwOf9sT46m0+VJymA/HQCfn0+PTmLZOMMSyd4Pi/D572ivw9szCova+fTVDOobwrv7LEeIclR+E8bvOUZbYYnjdfe0Pn4Nviu3i3aFeX02XKxWiyGf2i974X9k0XA8Hv4x2RFGwgUFpaqqCp6G1l7+Fx6BvCFv6ro25P4eQ4R3iD8Lr9ptKMbLFzC8nZlKQhUIQ2N2iJRnqlUIIauqbcNKlHbgX21JleoC6sDnJV5barevkQC5IZ60E1zaoSmC4eDNMV1DfGgzYfM8EClFXnDQ2foJHoGtTeDkAbuG/Ui74VnLqCItwsqjci0cfpUjUJEtfQE2z3NNZBQ5XxSMm3kAHLTOmybSlSdT4e8F0wJfWoqsKARVKe98XbBxyADNVVLWOijP2pTdRfjYjms2HbzmBHKkxpEzhQvsEXDT5JofGjiI7xaokyhnVADWMQDXHj89YBxABddAeEfC6vwUylUg+FWp0nUddwYFU8tDow27rlpmm7yvT+VB9/PAvUZX9krxjntcHTPgNaQb7yWHbrTzcFiBQd5+n1MOct0fwA22iJKp5LouKCUWBWy9P2gGlGCgCcbPCIcbhnHGTuCUWBahcv1+Tp47ipMCikkBR9vhjGFsWZTnKXGE+QEwN7NKBQtaih4Lpjt4LLBLialTGDRzXzGdKBBcyFPei/LhvoO5m+quYPqpYCRT3FY4iThVfJTQBUyLZNuZOAfxqOqdowosXWF9i74kjx88lmjP4Es+KhSMTJoD7g0eZmkSHD75oOKI+56El3/ioNAkaxuPKtGFAeCIXM1P6G1H4rJq/W2Eb72MJIbrHjeFNMmcjAwRly0uckWa6MBjULWDXooBG/dwfbW2qT2di3THJhow06pq6XYgcculxu7RIr/ZbjAo0kVvG4UUAb615/mff/gJ8YHkBvXqjNluJClqF9SLCj0qhAUdCC6VMvTxIxFQsIHK9d32JsnmTLPxpDDHVcAs0RUF7T1fP9zQjCJdFq/P7hqCcYeaFwWJQsF3N944XIFfI56C0NXZs6uXh0MWG/A8nuI4shn6IISgiW8KPPib7treuXpZ+3mQG2cxVugucNg+3Wf28s8Xn5vSlvPnOBHNsscNB/DH4QqxyOz2W7P7ucGrMdbTFnXjzSyym83joxjgU82yfZ9YvMz4yGIGGs9mYDqaecnw6sed8Rm+sIiZoE9YenxBP/u4s7UZRyKex9vwPkrId8Hic7MHfsv2E/0u4Zf/G3qVTuxbMNMvfW/2svZftFcNW0J5TZsAAAAASUVORK5CYII=',
      phoenix      : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABcCAMAAADpo0MMAAAAwFBMVEWcWCFnZFwRFRhkNQ/dk1lcLgpjGwWtppuic0yiTBEpGQRfNg5zTCrd4N4bHAv5hy3Vbh6bSw+mhmhuRSDYtJi/PwB+QA9pVwC6yM12e4C/wLvzw542LBr//3/HfEH//wCkVhsAAADveR3KZhixWhbwiDf7/PkPGwgTIQvwfCFVVQAMFAcFCwSPSBH6k0S8YBgVJRSpVQN/PwBPMxGOSRI5GwDNh0//fwD/AAB2OwyzZyrSeTKIRBB/fwCWShG7k26fNWiYAAAAQHRSTlPy/f2S/mAZ//wkIPTq/179/Ej/sP8EYwb/////hwL/AbEA/v7+/v9MWP4DMyn2/v7+BAT91UL+AgFH/f61Aov/awNlfQAABEBJREFUeNrVl9l26jgQRQUeMY4hQHd6uD1ocIwxxmEIhCHJ//9Vl2RhDLaFgIe7+jwkLJZrUyWpTlkI12gCwppClW8Wf+X/N4u7AHP+x7YsT2RyOwDit//u+pRSdrAk7hbABm9ROAOFMSF0ZcEXNwE2+Gs/M9drExBAIMy4TkBn+X/FPNw013uEOIEaV6tA5XiL9NajP0ffro+QGRJOsLA9kYINmqgAn9im8dp0Bq1WawcLIQCE2doZbPCBxOuRM3BGfzit3cyMRQqHd+tdCDb2160CYGOPAcAcOK9cQBCAPkNMamWk6bZyNgrAAhuExOZexD9BGWGc19Cf9fjG9mZh2l4ePhoBvAJCwrWIf3Xa7Z2IJzQLpfbdt7duB3807kLKn/8W+Tu/t9t+LwcwGT/rL9/elp3LGs4BMREZtNogVADMHLCDDJbPagAh+yexBO12i8oSWCxTyK4C+jwFUcPr028uybcxY0SKqkvY4CH/zZgKwpNLY5nACaBeRNjGTBDI3nS+d0TGZ4zmR5L0iHob7bmNRNkQKWoRyijLqFTaVR4k6LouzQmgY9YMTMHgsrhJqY4yWEl/n1JKyoJ43WbKrQQhCDmFZ5C9hV8WUrainY9WghhftVwZr/5Lz1BOVuLzcNF7fO3A0jpeo5WcACUrcVHKZArQv7amrZesxHFaPkoBwlK0eveUVlIALqxksDN5AtxKMqWVFICqlYRaVlIA7rWS0i7cZyXngDus5DKDm62kDLjLSkqLeJ+VlLeRNVgJ9HXcaCWlg9RgJUVbpd2u6iBBLxhVK8koAvlLn3EQxH+qmslLaXZuJZDAyHQBAVM6VI15lL9MWezSSpgPhxpdH/O5oUz4Op5qhg/M/dYb8+j4dmGcW8lOd8yj4v3EWh0zADPY/6075su2bhncSVjKMhIOdHvzNBsn8h01SPlR0O7N8mveYnPHmL941Z14kxt7s/q2fmNvVgC39mYFoOjN2jFfATT2ZsOYr65BbW82j/k6QLU3FWO+ZhfqerN5zKO6S9tFbyrHfB1A9qacjPmY3+BbAHlvHpedrbaKm089gCe8SvPePGyVt7cGAH7BCPHetK/dH5sAnxygc4NVAl407tBKwOddl+9c/8zRQefm2wT4wB32jH95BDBnX/93QAc9BNiIRXxgF+b4mXUeAzycQefRDH52CT//INlQwhe27wd44iQ+AIAcIAPvAYDngaE8BMCrFU6mR90I8LwkAcA0keIfgOJpAqYePJxMARAlSQRKCtBUBwCPDf0fUwBAbBCdJBDXAQmOfHft+hFkELRcIxiPS4hqDtUMAuRy+X46dE1z4AfRmKtAXAF4hs/DkR8Mke8OBqbZ+iHic8Z1QBK8B8ZwGETBkEWB7/rDoSFyiDQBmO96wAsPDP6Hr+K4iNcC8K2D52XgUVEer7OI03zzx3rxtQdpmlz8vATUnqT/AJxb/Sd6KABXAAAAAElFTkSuQmCC',
      frostthree   : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABcCAMAAADpo0MMAAAAwFBMVEVVa26ZqqoPFxszVl5nlp4XJyg0Vlzh4t9Da3MOGREbXWZRjZU3XGBzenp///+q0tt3zeFCbnlRiZYA//9PhpZpr8BJe4Y2PXE/f79hfYUAAP8nQTy+wb3Fv7hrgXn///8oNzN/f/8nQjd/AH+Chn5VVaoAAACG2Ot+0+dmqLj8/Phut8gQGwkTIgxVVVVSiJV2x9kLFAhbmaeU4/UFCgQYIw9WqKxlm6eKyNhJeYU/f38cNDpQhpMuS0aLu8aRtblJSBguAAAAQHRSTlPz//1Z+R+M/69YFybyAwL//liNAUj+sgoE5wH/////AYcCbwL/AwD+/v7//kxYA/r+M/79Kf4F/v74BEHS/v7/YY4kNgAABEFJREFUeNrll1t74jYQhiUsO7ZJMMmGpGm33d0eJCsCZAuCISXm//+rjiQODj5iLvaic5EDj+dlDppvLEQrbA5GOxoqffL+zf4ePfcC/KN/PDuOayK5HLCi1HngQgiunhzz72WAEXUIW4AxMLF14IOLACP6kLA1GEBYzBj36I9LACv6xNZ5rgk54Zog/NYsUNH/frzOo5toR5DkjMVxzIRDw/neoEHzJsAdDTnLox3+AyHCIgOIxyrsHMEIEkjWEcb461eMssU+hKd/9waNvXcaACF1uS4gxq/agKAjYImSPDOmkL/Z3JfOxhHwTr0EekeM/w1CaG0iGBOx2BvbDD78L7UAnQEUfnej/V/xYJCZIsScs72tb9/eblf019ouSPBgOxM/fhkM0MIC1N5/wT8AMDzP4TOAxbkBDMDkAbA+AH57e/t4bAKYopkUgICEqUFyBLBWwCbRIZgcXm9+J7FtI1eJiSRmLSmMqC/MV2ITA0lsDSecx3uAaC4itJFrJzbOI7zjY2adOOeLQxua2xiuQmkJcIBje5ChAlxpdTAmbxsPEkzdLTcE8Lbha3/x4njaHC1STUdZS4mQmsAOORv/rsNkpIRlQBBJbBKOE50/v6d3z+/GnsOGcT5ICVHay2TMjXUUlJOUgJKcTCiPDt1aKTkBilKy2SjCJxNoP1fbsKOsF6QEY4QyKYkEQ4HbKCVHwJmU/M2ZrkHSKiVHQElK7LlrlZIjoK+UFLrQT0o+A3pISRHQS0oKgH5SUihiPykptrFaSsRBSuLmNsJBqpYSZeYKDrWEI95wkGAWvAop4ZIQiT6QkjCiyKF/NQ2TK8W5lHAVRQQYzOTBa9c8si9TDp+cSYlCes1H+zWf1CqTFZQ5JPFJSiaKYxx1WfPo8HbhSVHQEpJ1XfPo+H7iIMXtt3Mlhei65ouy7vgbqRSICR8vOs/maTcaZOg4wUZn3Xk2i6957o8ea/7sVXfuzi+czfLb+oWzWQJcOpslwKVrvgSonc2aNV+uQfVs1q75KkDFbIqWYfrcyorZrF/zqOrSdj6bTWu+CnA+m0L59XefSkBxNiGGl6a7UzVABwyvCmY2W25vNQCIgWz1bIZt98d6wHbb6QbbCLjrcIduBvS6fFv7tto+dLn51gG+0KF8pL9cB3j4nwNGdKger+nCij6q4XWAqyMYXhvBz07h55+D0ADC/gCX3gHg+RpACAD3CoDrXgcAX5C0dHmwCwGum6YAWKZ7038Axe0IWLrwcLoEwDRNp2DpEbTsAoDHfPR9CYBgGgTTkxlEOyClU4R3GZpCBAHKvGA6KyDKMaBS8YIN5hnnCEmf5DlGQNB2RLQBPJSBO0GBLxHBeJej78bfMtoBaTALPN8PgsBX0wAR5PueiWHaEUB11wOd+J/eDIoYBDYF698JAK2zzwezgtlSdiiiJYDNZp38Kw/SMq0GVJ6k/wC20lmjgJuvvgAAAABJRU5ErkJggg==',
      charredthree : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABcCAMAAADpo0MMAAAAwFBMVEVcKw+bVi5WJAmqc1VqGgVkYFkKERlnLxEpEAOqo5slGgrDUhfc3dr/fwD/AABsSjLOq5iVLAZ/eQKCOBGBOBGljHfHj3LIckW/y81XQi92e4CAOBB6gHkxKBqJRBS/wLv//wD/f38AAADFVRqpSBSYQxX7/PjKaTYOGwiIOxETIQsMFAcGCwR1NRFVAAAWJhS7URjUcD1KKQ5VVQDQdEOxVyh6PASqVQA/PwB2NBA3JxCRZUouDgBtKwtmKwyuhWuyFU61AAAAQHRSTlOW/F39Gv3/8CP/Wf7/AgHm/yECjcz///z/o/9b/4cN/wECAP7+/v/+TP1YMyn2A/7+/fkD/v4GAwTW/P5BQ7b+uoag0wAABB5JREFUeNrVmGl/4jgMh52LHLQNpWW6s7uzh4+CScLQaUJLM4Xv/61WthPIkAMnebV6UQq/6EGSrb9sEG6wDRjWNFT7ZPever19HwR4FX+8wPRkJP0BbxibD0ZGKeMHU77tB7jFprFMwZaEELo3sd0PcItRlj5ZkjEFBEN43gfwhtH0yQJLDTAigkBXs0DV+plbw5rNZkcnDA2ZBaGQxaYwWKDXLoCNbUasL/7CcRxj+aQAW25rRwAFIJk18y1/9rfvGGlKVBJB8FMaLKz52ZmCxwDwxfKfhf1pFADOWWH7g+t+4tc2wA6jLSFpJv1vRBpE5ZC9FLZMPj4Od5s2gMiAkKUl/Z/9yUQBCGPLwrIf37//uO9IIRHPHwXA8X+fTBIFoCXgRQLsyxwuAFMZgTOZVAEvEpAaHwD4vAIg2Y0swWTiUFUDxjPpP12yqwDhQmUOzze/5dMiAL4lRTW6U7jFB/mdBSGnZQas8Ce0u4iwjEwRjIV/NM7+tASQ7mXErzanKlpKp4XLVmwgWljidm4k6DqXsS2pGviDKCBhpmnGnVtZSEmW0ErAKn7dZpJSkhocCGUQW+Ev2vm9MBu/t7ZzISVHQShzltlrCspZSlzOaNl9lHKEd16rlJwBVSkJXc6LCPje1pT1ipT4vpMYScI5T7j70wu6pKSSwi9SsjBSEcD2qpScADUpWepJyQkwVEoqKQyTkgtAfym5jKC3lFQBg6SkUsRhUlJdxkFSUt1ITVICG4ky1VTNUlLthQOtSwmDER8mH2JbU+qa3c3kNUnJbJGHRjHmWeuYR+owZbJLKeGhHPPptTGvBGUj6viLlPB8oTfmC0mbY8TpWUoYN3THPDqdT0yXlxHwJDN0xzyqnDDNgyg5SAnb6vfmebBIpGeaQb/erB7z3ucDxvzFUXfjbXr2Zv203rM3a4C+vVkD9O3NhhS8XmO+DmjuzdYx3wTw+oz5hhSaerN9zKOmS1utNzvGfBPgsjfFmJ/jPgDVm6cQ4O50h/sBxCK5rurNK7e3FgDsp8dHbJvX749tgLkA6NxgOwE7jTt0J2A+6PKt7J+3xwedm28b4A7v+B9QyVGAh/87YD4OcIttKOKIVXjDJr8fB7jn5ljA/dgU7HGAkUW8w3+N3QcjAbbcifZwgAcAhL0RegBFRAN/zTuN2HEReHi/x1FcWk+A50URAOKoMPEPUDxNQOzBw1EMgFUUrcCiEyjWAcBjKPwWAwB8g9XZJOI6IMJBaFm5u4IIAidHq/W6gqjHUI8A/PM8t9x9gvLj0QoDQKxLSj2GS0CE3BwARhigJMzFj4vON+mvGBqAYBWgrwhyR3wFwYRfxRtF0AKIFYiDADwCVMa9PvlrAHAslg6eLxxLWyl/nSLGavHXev6NGymOLr6+ADTupP8ANW8O+a7EElEAAAAASUVORK5CYII=',
      sun          : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAwFBMVEXdoyf1qhvNoSTOslarih7/xjC9plz7yS/l16f//3+9r4C+lCKSdxn/f3//wDD/xC7HoiP/4lCwnRK4lyB5YhTl38vatki/fz8AAAD+yy77uS3NpST+1lH+uzf+0TD//wD/qlX+uC7+ui38uS3/fwD+uC39+Orsx07+uS3069HWuFT/uS3Xx5LFnCPlqSnPuGzbsSf/rCr/qgD//1X/yTH/AAD28NzSyaq9mSHKu4vl2Kz/wS/OpiTaw3fbuCrY0bcl6U/QAAAAQHRSTlOYBs7/pSn/mf8C/8ppAkzTbP8FaWX/BwQA/vr+/gn+AQMyzpECa//+q///UP/8/v/9EgMDCQH///7//2C0/wf/TR3W2QAABFBJREFUeNq1V+mamzoMzTJb9+3eWy9jmzUJEEL2Ju0s7/9WlWUDhoFk0n5XvxLwORzJkiwPyGlTuzMLBuQv7TSBRzKffPgLgjUJQiIuJIicABDBgq3qftlHIIhyfmeU+eCIw3iGICJ+TDZRtX5Gae1DtCGx3xbRItCiQ2JF6D+MBStVviMhcwV2ugAflTNhVAsSU2CwPnhEwKs2/gWBICGlwQplaw8YAx82+GIVuP70EXg6bjpywnoAhj+JD49p5kS0myBCFGUZEU9vMu0Box83T99JxihyRee2UYkAUbF+yRaLBWd6DUaDBUKdzYM1Oq5dj28ZBWNs+fB+YJ7N4HU3QV10NvSM3n/5cg8m0VjOjawqhjvVUuAJT5ko+jr097WBCikpzxeM2h1VsLipYOsjOBJC6dhTwE+n05JBGgoQAfuhhMA4Kn9bE3jrGFz2hU2lTxLQaZpWFJqBgoiRTSPhxyGN116tQOcfhCsIf/nX5Bbw6ePj/PExHU8rLzTD8gqwv8IAJFY5aQls0mmSQNJxMUc7Fum0lqA1vAtwkd4P5RKQCLafmryTdFoc5z/QjuPUkaAZFriGQkJEzV1QZIWptgCCtDg+/5vsJ0ny/PbGlUDlMkc8W1VFVW8jJDtYDkvHb5+TCdr++SZtEFCu88FtMoNG+6E5CKA3R4ufTJK5jQK1DEynQ+bU5MCt5JjmetX4x74i+Fk0CUCCm4/NWoigerTWdF4qSEoC6RAMyLC7mHZfV/9QS5Ds95P9PkmSu7RBQCXn37ZPuw4CpWVdSSQofiZoexBgCGhFsOQP2t31rkEQ6TrfXIe5+VJazJHi7q5oCYAoch5eC+QoCRR2CT+ETDqYVVAImItF0dwDSwBNM/Q3GhiVCvw40GnErQJ6r2upLifZJMBUAg6jYOchGvN4caA267GcG8VYx4CblAeOW3+oBkpkM4uvCTSD21AcAl4RAEO2jdAFkYXIwQ+s3q+Oz5s84AY9i7dlEL2Sgx14a3nbkADQYYYnj2eDqDzk+BjmvANEWyHgM4M2ra0qZ+S44vwkAQoY6dr1opeprIar9/y0BB3C5eftk+otJn6SQScBJGJfMWE5wxfkSQf6yxnnGX6AXZIn8aynoZQtTXvZ6YXF97W0qqnmqFK2KaTx3+A7mmrd1hdmWYNCyvLzZRq327p7sLyzKxFnjLKlxY96DhbnaBM6m4wty/mgfADtUFx3HW2tw3XEe2yk+g5X53jXQ9KiG896j3d3wHiD29mNZ70DxssRpynCtqGTI447aeLiwbeHEv/wOTw3ZDVmXVqOeTNmYReMeXY8BfzX/yI7aGbRULx60Ix0DO2oq/5k1MVZGfFwVJn0NCnz2mEbYihhWPdqsjL0rxz3FQk+2etCGY/ykvKqC4ci23BYrUEfAqUuuPJoH+pveDr2bgM7f+kypV3/3gSscfOMLrx4QkiDF2G78OobX3xzbWkY/t+399/xg7DIY45EtQAAAABJRU5ErkJggg==',
      pea          : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAUCAMAAAC+oj0CAAAAwFBMVEUAAAB93Elntz2C4k5/fwBzykST4meN12SHt21VlzJ+4Epboza4ybBVVQB3vVH///9VmDMAfwCCqW1KhCxirjng6tsZKw6YtYkA/wAnRhdFeyhUljGCyFv//wCJw2hVqlWnwZg9bCUnRRhNiS5Oii1/f39FeikrUxqB2VAcNRV/vz8PHw86ZSE/fz9eozoUIQ0hPBR5qV4NGgZ//39RkTFIgStEeCg1VxozXiR/t2F/qmdHfys+cyZVVVUAAAAAAAB5RwnQAAAAQHRSTlMA/v7+Av3+/v7u/e7/A/8B1QL/sfz/Ef8BMLqw/wH8A/+hQ5zyAkND/yMECEME0iYm+ycCnNqcJiP//9o1AwAA+ih31QAAAQNJREFUeNpNUdliwjAMs50madMTWnoBHQMGbGP3ff3/b81pw1a9SVFkJwKwmKTgkE7gDx7AfnMbhtnruicDYnjME62UEILyO6bO2wS66zqtlREmaAa/t7wMFn5V+b5WAoUImtTrza18qKKo+lwohSiwhQsbvCY5jWazaMr5iGjoCGdwA+fo5N6NQuZwBTW8CJn4q5X/YbNtSnZdc/hWIOs8sc9AI4PSrrK15KAHL6OXa/iSPT+gA9kQHkk4gpA055Ex7EM5UpFoxwvy7i0RDrmGvWx+co8n4gvGICYFhe9L7/RVNKBg9fv0tTHc54U7mL/Bz6iG4ybjGp53oxpcaWX5X9oveK0QtKfx6BoAAAAASUVORK5CYII=',
      frostpea     : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAUCAMAAAC+oj0CAAAAwFBMVEUAAAB+0+eH1+pttMVmqbl/f392xNdbmKeIyNeOsbr///+Gp7BVVVW5yMuEusdSiZYdKytRhpTg6esA//9alqRIeYMAf397zuJPhZKP4vUfHx8lPEI/f39IeoUqSU6nv8Q+Z3FFdH5VqqooSVEcNTk6YWl/f/9/v79WkZ86XmYuUVh4sL5ZlaMhPDxEcXxTi5g1V10NGiBDbngmPUUUISFGdH9WkJ4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD86f3CAAAAQHRSTlMA/v7+/QL+7v7/Af4D//7vEbL/AdSzAv6c/wgsBNo1/6FDA0UjQwIE0iNC/7cmutomJzVCJpzuAAAAAAAAAAAAjntTfAAAAPtJREFUeNpNkdd6wjAMhWVJ8YgzISGktKWUQvce7/9olR0zzkU++/fJkS0BBC1ySMoXcFQGsF12xjz8buNmUgGfLSGO44jU/8g2ea+NtVVlMcisJn+W39XWO+cCV4h/qzyL5jfNviydD1ih6mEfgr9Z+3I2K32FkfMObuESbgY6YiVY93APc7hC/ezWa+dswu8XcwmvcdCUKkZsmnCVWtaDtThRpShgCdHx3wQFdxIiJUmdCYlaKVnAk6GTFTXzRi4oz+mJUgYKFfM+PZ5Yq1BSE5N5zLPUKuFMJB+hX4fWFvDaMsUTfvk4NDZ2fhfG0C03Z2NIQ2ua09D+AQ29DbYGMeLzAAAAAElFTkSuQmCC',
      walker       : 'data:image/png;base64,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',
      armoured     : 'data:image/png;base64,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',
      sprinter     : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEIAAABgCAMAAACe7lTnAAAAwFBMVEWOpmlpIyxXY2IjGiATGRBfcpI6RVosNkURHA2lrpGjwnlwGyLe29JyiFSEKzdsbWquxJEUGxhidUhkbDKkOkZPXzptIi3MzLR7JzMxbi9nAGdLWTdgTzp1i1f//3/HurNcbUN/f/8AY2P///9arFovOUn/AAB//385RFg7RissNESlpVmDeWiNLD2qAFWqVVWqqqqEmmVVVar/f39yiFQAAP8+SWAAAABcbo63Q06cuXNBTWRdGyV4JzJ8k1v7+/Wczpl3AAAAQHRSTlP++vn6Kf76+1H+/g7/9/4F/pKoFv+XU/+hDAJu+ZQC/3MCAgEDjAECvFV7A/8PAwMDvgMCfwFFAP7//v7+/P3/v3E19gAABb1JREFUeNq1mIl2ozoMho0NhB0SsrVZ2plu02lnuasJbcj7v9VINjt2Q+6i05PggD7/FpJMIfwDu/Z9Xx7BwfdHzVXkA3/59c33v8nDH98vQlw/4tTL9do4oq3XS/8bUkYjfASAdxRFgoAH0REwwB6HgMuW62Pp3VgUGQDxRyAe4bK1mD6K5vP5AQy+pB6ADIQMETDLUiiIhHdj87mArP0egwwJIEEBkBQhpLcYMliFb0QaABqeO3Z1kIEI1BAdtDaXDF+L+C4I88PhY4bx4/pRg7jmy3MEyVi3ZHQREIgPV9EEtRUO0g0EijictQiW0sjoqTDOLmMog/QjER0Oo2Q00SD9Gzofg5hjgj0qEePWUa3kURVOA+xonDe8pk6vLuLdeB9rULL/I0IIhU9xWW3N6L0anVVhvB+P7413ZyR5GoS/pETY641LqRusguDmtTMS5ymly6U6O2N+FXpoeXIKAsaCE1gC1hrlcJqQItUUe+w/hzkYISvrdKLMRqcgz9sjQuB8UWx8tYorviAS4TJKmZw4yN32SCLIjKcaxKaQiARd5Lyu67ZHJeL2DAIuClg9bZK49egkVBYfIRZFtZLAdYWPmydJa1SGQruQmG9CkpeMk4iem5P2CAkCccvvNQizRIAXTI0uRDEqCripsW4ToKRioB/JFSMUEZq6TeAJEGVAcWoPXTCVpJAKBwjK/9Ag8JYUJO9Y41sOi+4NGSzEBBn1dKvVimwhDHSbrFZJyQBCEaYwmwbxBPlZVEtZnYLTiojcgKOAeFUs4ZbutRtizJ/DkuGFLlTXqv4IjNCTBKiQ5n4MFxILGYLBXrsIxiC+xUCEAoHRgMu8LRPy3fqDMUMSwrQtYviIAhlaCAZj2xv3hhj1B5QJLW9H3H9Eie/v7uL613u5lJApjMryeOk/KP2URy+d/CqIoUCEuAy4oIe44/Hut93uij+ZaZlf5gxkUHY0Os+MBttirzFbWSURT3wHHSHxQB9KuZILgqInFDbOlkXHLfw4Uz39/pm42Ji8fPEsa+cuBc6GQiG0N8fjESowvOX7dIBICfjDX473nM42TnliQgGyRf3C/2hQElLbvPs8VLEjuVCBiYftHy6coRxqURqGdIv+hrHFY5plDlcgIGuRgJWFGwARmAI2G3DIaMuyzLKyr9xUIKCRJIJAwqqgPbHdUAo+jVn496BCzKrGlPc6hUeFl1X5i0+lirSam4TdXkNo1hYhENZDN7fLm7qRXZmEhexwtQ0RmWXzT0MEVHeIvS1cLGiBUWghBmZ9USEgwdMZGGaMs6CwmlIModZYRLOniN75LMVAd1EhbJhR9Y9V/FJVWonZzHBtKgTV/IcYV5W2nc0Wi8Xm2TQdRrcXIH7ynSsrjZRNGqOLCW2NRMS8qbQCGUQ8K3lJqEKYwyJBxM5z60prMsMDRM8A4agQe96rtBZipAqBGFQaImz61jf69zDDCXTCdqV5bcTb0BR1JsLZrTSvNCXiQYWA7LwtK61YbCAvMN0p3lQFgipVYGrdykq7rX92bDCFCPqgigX27KrSnq7Sq/v9Pt4/0DeV2VRR7aTcBNtfoFWHyL7oEDxO9/u0lmjyr2rCR4iu/c4fsn4wITTQxVXVrkR84raV0Te7655hjtORr4M+8S9YEUJIy11TqlqE6P+07Z5dgviLv1nV7mN19yNFnWlejVVFOthJFNWuRMR8Mmx6Zf81xy3kMzz2KRkWbO3xuBd0MZ9mKoY1UW6IGoatQCiblg5hckfR9pTPBtqXlaYiopDdMb8EMYgoxtK86K3rIKIQS/OyF7cms7u7CGXOBS9uTRPiOWG0YxN7/EJMYdPJRD54O3CEZttT/H0MQhIcJh0nzHEmtjSBMM8jhD9Yg5iWBJuZjoJBFAQEVOq7CDwxYGgR7D9ETB32zxDTf4EoGXUo2oiJiqC5qbCO2qbNmiaOaY5FAGNaWedQlRe/AJdXGoUkNRjHAAAAAElFTkSuQmCC',
      lawn         : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAwFBMVEVNjTVRkzdboj1CfS1hqkFfp0A/eCoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANR3yBAAAAQHRSTlP/////////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA5x8Q6gAAAplJREFUeNqVVwmSwzAIQ9Dd/z95c9gGAU66nWknTWyZQwgiIgCOH6GPnrf0fLZuHZdzXVp/AJjfuLdgAAg92ADQ59o/vor0xDfm/WgB0ACM1docPfZtjgjQ08O9D8AGfO3SfvdtwR6AkgSOrwe4+N59lJMxMieGF4CcawKAO/puQlxwMQYlsO9u+FLDp9qNEU10B0fmXv9+GgA9dyu0xi5n5QheoN3CuQDAzqZaQMfbtQPH4YBuAMyTPvCAwPiZlmhApPgidUwnwq3lOe8/vgZxzkjyKGDq8gseKQTTbwDQOW4uFoAwgFSuINJzWjWCPymWvGirNGnJrZIgHwqriATRAqOMwsNe6hwxnEQSpIzOGt0AwGlSORVz0zUA9CqBJDZIzCVyutCpJBv4HKARN6zSPGsvJCSeZRTFkgpPg4o0AE5bCDqhseX6x1MSVPfyyORBoZbdOhje5Ov3pRnOqyktGcDsO53EAij3RxaxAwGy6BOIOQ0Uxfu7ZpBkhgtm0AkNwHz07OAQCKS2OKN21T1IURPbnKTKGXZFZADl9ASRXBSZNo1Lm+gYAKGosn/TApNA0dSZFQygkCb4Q1k5LKHyp1Ycv59Gz2KRNMQE0eMKipTxQJCqkHVcQvQp8uA6rRb4AZppIEGwnubNab+6B8YOlTEhaokhGwtqdGMI3gCoa4wJN0CAmjKs88BDCttpeClXmkPUx76dgCHLBgEAm/k2AdANxBarSKxHJSBYeQhAoc/ZHfrErzNxjJ2ig9C6UyfxWvayrDGdMr9vBQgB6+pqBwBjgLtsmil7A4DNzF0H/a5Ymu7vwl582NIIlZoQvL8poE8pvWq9+pDGREtLv+ifVHZ4fJl5e6htlB8B9H0t5HsL/vFe9bDjD6RqBIskkKS6AAAAAElFTkSuQmCC'
    },

    init: function(game) {
      const cv = game.canvas;
      // The lawn is pushed right to leave the paved strip the mowers park on,
      // the way the board sits against the house in the original.
      this.cellW = Math.floor((cv.width - this.PORCH - 8) / this.COLS);
      this.cellH = Math.floor((cv.height - this.TOP - 10) / this.ROWS);
      this.originX = this.PORCH;

      this.tier = Difficulty.pick(this.TIERS);
      this.grid = [];
      for (let r = 0; r < this.ROWS; r++) this.grid.push(new Array(this.COLS).fill(null));
      this.zombies = []; this.shots = []; this.suns = [];
      this.sun = this.tier.start;
      this.wave = 0;
      this.level = 1;
      this.waveInLevel = 0;
      this.levelFlash = 0;
      this.waveAt = 0; this.sunAt = 0; this.autoAt = 0;
      this.pick = 0;
      this.dig = false;
      this.cursor = { c: 4, r: 2 };
      this.cool = {};
      this.over = false;
      this.flash = 0;
      // A mower is the lane's last word: it fires once, clears everything in that
      // lane, and is gone. They ARE the hearts, so the shell's counter is the
      // number of lanes still covered.
      this.mowers = [];
      for (let r = 0; r < this.ROWS; r++) this.mowers.push(true);
      this.lives = this.ROWS;
      this.maxLives = this.ROWS;
      this.enterLevel(game);
      game.updateScore(0);
      this.loadArt();
      this.bind(game);
    },

    // Decode once per session. Until they land the game still runs and draws
    // flat shapes, so a slow decode never blocks the first frame.
    loadArt: function() {
      if (this.imgReady) return;
      // No Image constructor means this is not a browser -- the headless test
      // harness, say. The game is fully playable without the bitmaps (drawSprite
      // falls back to shapes), so degrade rather than throw on init.
      if (typeof Image === 'undefined') { this.imgReady = false; return; }
      const keys = Object.keys(this.ART);
      let left = keys.length;
      keys.forEach((k) => {
        const im = new Image();
        im.onload = () => { if (--left === 0) this.imgReady = true; };
        im.onerror = () => { if (--left === 0) this.imgReady = true; };
        im.src = this.ART[k];
        this.img[k] = im;
      });
    },

    cellAt: function(px, py) {
      const c = Math.floor((px - this.originX) / this.cellW);
      const r = Math.floor((py - this.TOP) / this.cellH);
      if (c < 0 || c >= this.COLS || r < 0 || r >= this.ROWS) return null;
      return { c: c, r: r };
    },

    cx: function(c) { return this.originX + c * this.cellW + this.cellW / 2; },
    cy: function(r) { return this.TOP + r * this.cellH + this.cellH / 2; },

    // The shop strip is laid out the way the real one is: sun counter pinned to
    // the left end, seed packets in the middle, shovel on the right.
    SUNW: 84,
    SHOVW: 44,
    slotW: function(w) { return (w - this.SUNW - this.SHOVW) / this.SEEDS.length; },
    slotX: function(w, i) { return this.SUNW + i * this.slotW(w); },
    slotAt: function(w, px) {
      if (px < this.SUNW) return 'sun';
      if (px > w - this.SHOVW) return 'shovel';
      const i = Math.floor((px - this.SUNW) / this.slotW(w));
      return (i >= 0 && i < this.SEEDS.length) ? i : null;
    },

    affordable: function(i, now) {
      const s = this.SEEDS[i];
      return this.sun >= s.cost && (now - (this.cool[s.key] || -1e9)) >= s.cool;
    },

    // Digging a plant up returns nothing, as in the original -- it exists so a
    // misplaced plant (or a fusion you did not want) is recoverable ground, not
    // a refund. One dig per press: the shovel puts itself away afterwards.
    shovel: function(c, r) {
      if (!this.grid || !this.grid[r] || !this.grid[r][c]) { this.dig = false; return false; }
      const p = this.grid[r][c];
      this.grid[r][c] = null;
      this.dig = false;
      Fx.burst(this.cx(c), this.cy(r), '#8b6b3f', 8);
      Fx.text(this.cx(c), this.cy(r) - 12, 'dug up', '#8b95a7');
      SFX.beep(200, 0.05, 'square', 0.05);
      return !!p;
    },

    plant: function(c, r, now, game) {
      if (this.pick < 0 || !this.grid) return false;
      if (r < 0 || r >= this.ROWS || c < 0 || c >= this.COLS) return false;
      const s = this.SEEDS[this.pick];
      const sitting = this.grid[r][c];
      // Occupied is not automatically a refusal: if the two make a known hybrid,
      // the seed is spent fusing instead of planting.
      const recipe = sitting ? this.FUSIONS[this.fuseKey(sitting.key, s.key)] : null;
      if (sitting && !recipe) return false;
      if (!this.affordable(this.pick, now)) { SFX.beep(150, 0.06, 'sine', 0.05); return false; }
      this.sun -= s.cost;
      this.cool[s.key] = now;
      if (recipe) {
        this.grid[r][c] = { key: recipe.key, hp: recipe.hp, maxHp: recipe.hp, at: now,
                            fired: 0, art: recipe.art, fused: recipe };
        Fx.burst(this.cx(c), this.cy(r), '#ffd23f', 22, 4);
        Fx.text(this.cx(c), this.cy(r) - 22, recipe.name + '!', '#ffd23f');
        SFX.powerup();
        return true;
      }
      this.grid[r][c] = { key: s.key, hp: s.hp, maxHp: s.hp, at: now, fired: 0, art: s.art };
      Fx.burst(this.cx(c), this.cy(r), '#7ede63', 8, 2);
      SFX.brick(1);
      return true;
    },

    // A seed you cannot pay for should not be silently ignored, and a click on a
    // taken cell should not cost anything -- both read as the game not working.
    bind: function(game) {
      const self = this;
      this.unbind();
      this.keyHandler = function(e) {
        if (!game.gameActive || game.currentGame !== 'lawn' || game.auto) return;
        const k = (e.key || '').toLowerCase();
        const now = performance.now();
        // 1-9 then 0, - and = -- the strip is twelve packets wide now
        const slot = '123456789'.indexOf(k) >= 0 ? Number(k) - 1
                   : k === '0' ? 9 : k === '-' ? 10 : k === '=' ? 11 : -1;
        if (slot >= 0 && slot < self.SEEDS.length) {
          self.pick = slot; self.dig = false; SFX.beep(520, 0.03, 'square', 0.05); return;
        }
        if (k === 'x') { self.dig = !self.dig; SFX.beep(300, 0.04, 'square', 0.05); return; }
        if (k === 'arrowleft'  || k === 'a') { self.cursor.c = Math.max(0, self.cursor.c - 1); e.preventDefault(); }
        else if (k === 'arrowright' || k === 'd') { self.cursor.c = Math.min(self.COLS - 1, self.cursor.c + 1); e.preventDefault(); }
        else if (k === 'arrowup'    || k === 'w') { self.cursor.r = Math.max(0, self.cursor.r - 1); e.preventDefault(); }
        else if (k === 'arrowdown'  || k === 's') { self.cursor.r = Math.min(self.ROWS - 1, self.cursor.r + 1); e.preventDefault(); }
        else if (k === ' ' || k === 'enter') {
          if (self.dig) self.shovel(self.cursor.c, self.cursor.r);
          else self.plant(self.cursor.c, self.cursor.r, now, game);
          e.preventDefault();
        }
      };
      document.addEventListener('keydown', this.keyHandler);

      this.clickHandler = function(ev) {
        if (!game.gameActive || game.currentGame !== 'lawn' || game.auto) return;
        const rect = game.canvas.getBoundingClientRect();
        const t = (ev.touches && ev.touches[0]) || ev;
        const px = (t.clientX - rect.left) * (game.canvas.width / rect.width);
        const py = (t.clientY - rect.top) * (game.canvas.height / rect.height);
        const now = performance.now();
        // sun first: collecting is the action you take most, so it wins ties
        for (let i = self.suns.length - 1; i >= 0; i--) {
          const s = self.suns[i];
          if (Math.abs(px - s.x) < 26 && Math.abs(py - s.y) < 26) {
            self.sun += s.amt; self.suns.splice(i, 1);
            Fx.text(s.x, s.y - 10, '+' + s.amt, '#ffd23f'); SFX.bonus();
            return;
          }
        }
        if (py < self.TOP) {                      // shop strip
          const hit = self.slotAt(game.canvas.width, px);
          if (hit === 'shovel') { self.dig = !self.dig; SFX.beep(300, 0.04, 'square', 0.05); }
          else if (typeof hit === 'number') { self.pick = hit; self.dig = false; SFX.beep(520, 0.03, 'square', 0.05); }
          return;
        }
        const cell = self.cellAt(px, py);
        if (!cell) return;
        self.cursor = cell;
        if (self.dig) { self.shovel(cell.c, cell.r); return; }
        self.plant(cell.c, cell.r, now, game);
      };
      game.canvas.addEventListener('mousedown', this.clickHandler);
      game.canvas.addEventListener('touchstart', this.clickHandler, { passive: true });

      this.moveHandler = function(ev) {
        if (!game.gameActive || game.currentGame !== 'lawn' || game.auto) return;
        const rect = game.canvas.getBoundingClientRect();
        const cell = self.cellAt((ev.clientX - rect.left) * (game.canvas.width / rect.width),
                                (ev.clientY - rect.top) * (game.canvas.height / rect.height));
        if (cell) self.cursor = cell;
      };
      game.canvas.addEventListener('mousemove', this.moveHandler);
    },

    unbind: function() {
      if (this.keyHandler) { document.removeEventListener('keydown', this.keyHandler); this.keyHandler = null; }
      const cv = GameSystem.canvas;
      if (this.clickHandler && cv) {
        cv.removeEventListener('mousedown', this.clickHandler);
        cv.removeEventListener('touchstart', this.clickHandler);
        this.clickHandler = null;
      }
      if (this.moveHandler && cv) {
        cv.removeEventListener('mousemove', this.moveHandler);
        this.moveHandler = null;
      }
    },

    spawnWave: function(now, game) {
      this.wave++;
      this.waveInLevel++;
      // Count rises with the wave; the mix hardens rather than just multiplying.
      // The last wave of a level is the flagged one and comes in heavy.
      const big = this.waveInLevel >= this.waves && this.hasFlag(this.level);
      const n = Math.min(9, (1 + Math.floor(this.wave * 0.45)) * (big ? 2 : 1));
      for (let i = 0; i < n; i++) {
        const roll = Math.random();
        let kind = 'walker';
        if (this.wave >= 3 && roll < 0.22) kind = 'sprinter';
        else if (this.wave >= 5 && roll < 0.45) kind = 'armoured';
        const z = this.ZOMBIES[kind];
        this.zombies.push({
          kind: kind, art: z.art, big: z.big || 0,
          hp: z.hp * this.tier.hp * (1 + this.wave * this.tier.ramp),
          maxHp: z.hp * this.tier.hp * (1 + this.wave * this.tier.ramp),
          speed: z.speed * this.tier.speed,
          dmg: z.dmg, score: z.score,
          r: Math.floor(Math.random() * this.ROWS),
          x: game.canvas.width + 20 + i * (40 + Math.random() * 70),
          slow: 0, hit: 0
        });
      }
      // the area's last level ends on a brute, not just more of the same
      if (big && this.isBossLevel(this.level)) {
        const z = this.ZOMBIES.brute;
        const hp = z.hp * this.tier.hp * (1 + this.wave * this.tier.ramp);
        this.zombies.push({
          kind: 'brute', art: z.art, big: z.big, hp: hp, maxHp: hp,
          speed: z.speed * this.tier.speed, dmg: z.dmg, score: z.score,
          r: Math.floor(this.ROWS / 2), x: game.canvas.width + 90, slow: 0, hit: 0
        });
      }
      Fx.text(game.canvas.width / 2, this.TOP + 52,
              big ? (this.isBossLevel(this.level) ? 'A BRUTE IS COMING!' : 'HUGE WAVE!')
                  : 'WAVE ' + this.waveInLevel + ' / ' + this.waves,
              big ? '#ff5d5d' : '#ff8f6b');
      SFX.levelUp();
      if (big) game.shake(6, 12);
    },

    update: function(game, ts) {
      if (this.over) return;
      const now = ts || performance.now();
      if (!this.waveAt) { this.waveAt = now + 2500; this.sunAt = now + 1200; }

      // A level is a fixed number of waves, the last of them the big one. Survive
      // it with the lawn clear and the level is done -- which is what makes this a
      // play-through rather than a tide that never ends.
      if (this.waveInLevel >= this.waves && !this.zombies.length) {
        const bonus = 250 * this.level;
        game.updateScore(game.score + bonus);
        Fx.text(game.canvas.width / 2, this.TOP + 40,
                'LEVEL ' + this.stageName(this.level) + ' CLEARED  +' + bonus, '#ffd23f');
        SFX.highScore();
        this.level++;
        this.waveInLevel = 0;
        this.levelFlash = 90;
        this.enterLevel(game);
        this.waveAt = now + this.tier.waveMs * 1.4;    // a breath before the next one
        // a mower back each level, capped, so a long run is survivable
        const idle = this.mowers.findIndex(m => !m);
        if (idle >= 0 && this.level % this.tier.regen === 0 && this.area.mowers) {
          this.mowers[idle] = true;
          this.lives = this.mowers.filter(Boolean).length;
          Fx.text(this.cx(1), this.cy(idle), 'MOWER BACK', '#ffd23f');
        }
      } else if (now >= this.waveAt && this.waveInLevel < this.waves) {
        if (this.wave > 0 && !this.zombies.length) {
          const bonus = 50 * this.wave;
          game.updateScore(game.score + bonus);
          Fx.text(game.canvas.width / 2, this.TOP + 84, 'LINE HELD +' + bonus, '#7ede63');
          SFX.bonus();
        }
        this.spawnWave(now, game);
        this.waveAt = now + this.tier.waveMs;
      }
      if (this.levelFlash > 0) this.levelFlash--;

      // Sky sun, so a board with no sunflowers is still playable -- just poorer.
      if (now >= this.sunAt && this.area.sun > 0) {
        this.sunAt = now + this.tier.sunMs / this.area.sun;
        this.suns.push({ x: 40 + Math.random() * (game.canvas.width - 80),
                         y: this.TOP, vy: 0.45, amt: this.tier.sunAmt,
                         rest: this.TOP + 40 + Math.random() * (this.cellH * this.ROWS - 80), life: 9000 });
      }
      for (let i = this.suns.length - 1; i >= 0; i--) {
        const s = this.suns[i];
        if (s.y < s.rest) s.y += s.vy; else s.life -= 16;
        if (s.life <= 0) this.suns.splice(i, 1);
      }

      // plants act
      for (let r = 0; r < this.ROWS; r++) {
        for (let c = 0; c < this.COLS; c++) {
          const p = this.grid[r][c];
          if (!p) continue;
          const f = p.fused;
          if (p.key === 'sunflower' || (f && f.makesSun)) {
            if (now - (p.sunAt || 0) > 7000) {
              p.sunAt = now;
              this.suns.push({ x: this.cx(c), y: this.cy(r), vy: 0, amt: 25,
                               rest: this.cy(r), life: 9000 });
            }
          }
          if (f && f.freeze) {                       // Glacier: chills a wide area
            const near = this.zombies.some(z => Math.abs(z.r - r) <= 1 &&
                                                Math.abs(z.x - this.cx(c)) < this.cellW * 2.2);
            if (now - p.at > 1200 && near) {
              this.zombies.forEach((z) => {
                if (Math.abs(z.r - r) <= 2 && Math.abs(z.x - this.cx(c)) < this.cellW * 2.6) {
                  z.slow = now + 7000; z.hp -= 240; z.hit = now;
                }
              });
              Fx.burst(this.cx(c), this.cy(r), '#9fe6ff', 34, 5.5);
              Fx.text(this.cx(c), this.cy(r) - 18, 'FREEZE', '#9fe6ff');
              this.grid[r][c] = null;
              game.shake(8, 14);
              SFX.lifeLost();
            }
          } else if (f && f.shots) {                 // every shooting hybrid
            // lanes:3 fires into the row above and below as well; back:true sends
            // one the other way, for the zombie that already walked past.
            const rows = (f.lanes === 3) ? [r - 1, r, r + 1].filter(y => y >= 0 && y < this.ROWS) : [r];
            const target = rows.some(y => this.zombies.some(z => z.r === y && z.x > this.cx(c) - 10)) ||
                           (f.back && this.zombies.some(z => z.r === r && z.x < this.cx(c)));
            if (target && now - p.fired > 820) {
              p.fired = now;
              rows.forEach((y) => {
                for (let k = 0; k < f.shots; k++) {
                  this.shots.push({ x: this.cx(c) + 14 - k * 16, y: this.cy(y) - 4, r: y,
                                    dmg: f.dmg, chill: !!f.chill, splash: !!f.splash,
                                    art: f.chill ? 'frostpea' : 'pea' });
                }
              });
              if (f.back) this.shots.push({ x: this.cx(c) - 14, y: this.cy(r) - 4, r: r,
                                            dmg: f.dmg, chill: !!f.chill, back: true, art: 'pea' });
              SFX.beep(520, 0.03, 'square', 0.05);
            }
          } else if (p.key === 'three') {             // three lanes at once
            const rows = [r - 1, r, r + 1].filter(y => y >= 0 && y < this.ROWS);
            if (rows.some(y => this.zombies.some(z => z.r === y && z.x > this.cx(c) - 10)) &&
                now - p.fired > 1000) {
              p.fired = now;
              rows.forEach((y) => this.shots.push({ x: this.cx(c) + 14, y: this.cy(y) - 4, r: y,
                                                    dmg: 30, art: 'pea' }));
              SFX.beep(520, 0.03, 'square', 0.05);
            }
          }
          if (p.key === 'chomp' || (f && f.eats)) {
            // Eats one whole, then chews: enormous single-target damage on a long
            // timer, so it stops one heavy attacker rather than a crowd. This is
            // its own branch rather than part of the chain above, so a hybrid
            // that both bites and shoots does both.
            if (now - (p.chewed || 0) > 6000) {
              const prey = this.zombies.find(z => z.r === r &&
                                                 z.x > this.cx(c) && z.x < this.cx(c) + this.cellW * 1.25);
              if (prey) {
                p.chewed = now;
                prey.hp -= 900; prey.hit = now;
                Fx.burst(prey.x, this.cy(r), '#a24bb0', 16, 3.5);
                Fx.text(this.cx(c), this.cy(r) - 18, 'CHOMP', '#d38ae0');
                SFX.brick(3);
              }
            }
          } else if (p.key === 'shooter' || p.key === 'frost') {
            // Only fire into a lane that has something in it and to the right --
            // a plant shooting at nothing is the classic wasted-DPS look.
            const target = this.zombies.some(z => z.r === r && z.x > this.cx(c) - 10);
            const rate = p.key === 'frost' ? 1250 : 900;
            if (target && now - p.fired > rate) {
              p.fired = now;
              this.shots.push({ x: this.cx(c) + 14, y: this.cy(r) - 4, r: r,
                                dmg: p.key === 'frost' ? 26 : 34,
                                chill: p.key === 'frost', art: p.key === 'frost' ? 'frostpea' : 'pea' });
              SFX.beep(520, 0.03, 'square', 0.05);
            }
          } else if (p.key === 'mine') {
            // The cheapest thing on the strip, and slow to arm: plant it in front
            // of something already walking and you have wasted it.
            if (now - p.at > 9000) {
              const prey = this.zombies.find(z => z.r === r &&
                                                  Math.abs(z.x - this.cx(c)) < this.cellW * 0.75);
              if (prey) {
                prey.hp -= 1400; prey.hit = now;
                Fx.burst(this.cx(c), this.cy(r), '#ffb03a', 26, 4.5);
                Fx.text(this.cx(c), this.cy(r) - 18, 'MINE', '#ffb03a');
                this.grid[r][c] = null;
                game.shake(7, 12);
                SFX.lifeLost();
              }
            }
          } else if (p.key === 'squash' || (f && f.squash)) {
            // Waits, then lands on whatever came closest -- one attacker, or the
            // pair either side of it once it is a Cherry Squash.
            const reach = this.cellW * ((f && f.wide) ? 1.9 : 1.25);
            const prey = this.zombies.find(z => z.r === r && Math.abs(z.x - this.cx(c)) < reach);
            if (prey && now - p.at > 500) {
              this.zombies.forEach((z) => {
                if (z.r === r && Math.abs(z.x - prey.x) < ((f && f.wide) ? this.cellW * 1.2 : 20)) {
                  z.hp -= 1800; z.hit = now;
                }
              });
              Fx.burst(prey.x, this.cy(r), '#59952c', 24, 4.5);
              Fx.text(this.cx(c), this.cy(r) - 18, 'SQUASH', '#7bba3e');
              this.grid[r][c] = null;
              game.shake(8, 13);
              SFX.brick(3);
            }
          } else if (p.key === 'jala') {
            // Burns its whole lane the moment it is in the ground -- the answer
            // to a lane that has already been lost.
            if (now - p.at > 600) {
              let hit = 0;
              this.zombies.forEach((z) => {
                if (z.r === r) { z.hp -= 1800; z.hit = now; hit++; }
              });
              for (let k = 0; k < this.COLS; k++) {
                Fx.burst(this.cx(k), this.cy(r), '#ff7a2a', 8, 4);
              }
              Fx.text(this.cx(c), this.cy(r) - 18, 'BURN ' + (hit || ''), '#ff7a2a');
              this.grid[r][c] = null;
              game.shake(10, 16);
              SFX.lifeLost();
            }
          } else if (p.key === 'bomb') {
            // Arms, then goes off on its own once anything is close enough.
            const near = this.zombies.some(z => z.r >= r - 1 && z.r <= r + 1 &&
                                                Math.abs(z.x - this.cx(c)) < this.cellW * 1.6);
            if (now - p.at > 1400 && near) {
              this.zombies.forEach((z) => {
                if (z.r >= r - 1 && z.r <= r + 1 && Math.abs(z.x - this.cx(c)) < this.cellW * 1.9) {
                  z.hp -= 900; z.hit = now;
                }
              });
              Fx.burst(this.cx(c), this.cy(r), '#ffb03a', 34, 5.5);
              Fx.text(this.cx(c), this.cy(r) - 18, 'BOOM', '#ffb03a');
              this.grid[r][c] = null;
              game.shake(10, 16);
              SFX.lifeLost();
            }
          }
        }
      }

      // shots
      for (let i = this.shots.length - 1; i >= 0; i--) {
        const b = this.shots[i];
        b.x += b.back ? -5.2 : 5.2;
        // Torchwood does not shoot; it lights what flies over it. Once per pea,
        // so a row of them cannot stack the same shot to absurdity.
        if (!b.lit) {
          const over = this.cellAt(b.x, this.cy(b.r));
          const t = over ? this.grid[over.r][over.c] : null;
          if (t && t.key === 'torch') {
            b.lit = true; b.dmg *= 2; b.splash = true; b.art = 'pea';
            Fx.burst(b.x, b.y, '#ff9a3c', 5, 2);
          }
        }
        if (b.x > game.canvas.width + 20 || b.x < -20) { this.shots.splice(i, 1); continue; }
        for (let j = 0; j < this.zombies.length; j++) {
          const z = this.zombies[j];
          if (z.r !== b.r || Math.abs(z.x - b.x) > 18) continue;
          z.hp -= b.dmg; z.hit = now;
          if (b.chill) z.slow = now + 3000;
          if (b.splash) {                      // exploding shot: catches the pack
            this.zombies.forEach((o) => {
              if (o !== z && Math.abs(o.r - z.r) <= 1 && Math.abs(o.x - z.x) < this.cellW) {
                o.hp -= b.dmg * 0.5; o.hit = now;
              }
            });
            Fx.burst(b.x, b.y, '#ff9a3c', 10, 3);
          }
          Fx.burst(b.x, b.y, b.chill ? '#9fe6ff' : '#7ede63', 5, 2);
          this.shots.splice(i, 1);
          break;
        }
      }

      // zombies
      for (let i = this.zombies.length - 1; i >= 0; i--) {
        const z = this.zombies[i];
        // A mower clears its whole lane at once, so this list can lose several
        // entries inside one pass and leave this index past the end.
        if (!z) continue;
        if (z.hp <= 0) {
          game.updateScore(game.score + z.score);
          Fx.burst(z.x, this.cy(z.r), '#8a6a58', 12, 3);
          this.zombies.splice(i, 1);
          SFX.brick(1);
          continue;
        }
        const chilled = now < z.slow ? 0.45 : 1;
        // eat what is in front of it rather than walking through
        const cell = this.cellAt(z.x - 16, this.cy(z.r));
        const p = cell ? this.grid[cell.r][cell.c] : null;
        if (p) {
          p.hp -= z.dmg;
          const pf = p.fused;
          if (pf && pf.chillbite) z.slow = now + 2600;
          if (pf && pf.burnbite) { z.hp -= 7; z.hit = now; }
          if (p.hp <= 0) {
            this.grid[cell.r][cell.c] = null;
            if (p.fused && p.fused.mine) {          // Mine-nut takes the lane with it
              this.zombies.forEach((z) => {
                if (Math.abs(z.r - cell.r) <= 1 &&
                    Math.abs(z.x - this.cx(cell.c)) < this.cellW * 2.0) { z.hp -= 700; z.hit = now; }
              });
              Fx.burst(this.cx(cell.c), this.cy(cell.r), '#ff8f6b', 30, 5);
              Fx.text(this.cx(cell.c), this.cy(cell.r) - 18, 'MINE', '#ff8f6b');
              game.shake(9, 14);
              SFX.lifeLost();
            } else {
              Fx.burst(this.cx(cell.c), this.cy(cell.r), '#c08a4a', 14, 3);
              SFX.beep(150, 0.06, 'sine', 0.05);
            }
          }
        } else {
          z.x -= z.speed * chilled * 3.2;
        }

        if (z.x < this.originX + 6) {
          if (this.mowers[z.r]) {                       // the lane's last word
            this.mowers[z.r] = false;
            this.lives = this.mowers.filter(Boolean).length;
            const lane = z.r;
            for (let k = this.zombies.length - 1; k >= 0; k--) {
              if (this.zombies[k].r === lane) {
                Fx.burst(this.zombies[k].x, this.cy(lane), '#ffd23f', 10, 3);
                this.zombies.splice(k, 1);
              }
            }
            Fx.text(this.cx(1), this.cy(lane), 'MOWER!', '#ffd23f');
            game.shake(8, 14);
            SFX.lifeLost();
          } else {
            this.over = true;
            this.flash = 30;
            game.shake(14, 20);
            game.showGameOver();
          }
        }
      }
      if (this.flash > 0) this.flash--;
    },

    // Autopilot. Economy first while the lawn is quiet, then a shooter column,
    // then react: wall the lane that is about to be breached, bomb a crowd.
    // Deliberately plays the same board a person does -- it buys from the same
    // purse and waits out the same cooldowns.
    autoPlay: function(game, ts) {
      const now = ts || performance.now();
      if (now < this.autoAt) return;
      this.autoAt = now + 260;                  // human-ish decision rate

      // collect sun on sight; it is free score and the whole economy
      if (this.suns.length) {
        const s = this.suns[0];
        this.sun += s.amt; this.suns.splice(0, 1);
        Fx.text(s.x, s.y - 10, '+' + s.amt, '#ffd23f');
        return;
      }

      const free = (c, r) => !this.grid[r][c];
      const count = (key) => {
        let n = 0;
        for (let r = 0; r < this.ROWS; r++) for (let c = 0; c < this.COLS; c++)
          if (this.grid[r][c] && this.grid[r][c].key === key) n++;
        return n;
      };
      const try_ = (seedKey, c, r) => {
        const i = this.SEEDS.findIndex(s => s.key === seedKey);
        if (i < 0 || !free(c, r) || !this.affordable(i, now)) return false;
        const keep = this.pick; this.pick = i;
        const ok = this.plant(c, r, now, game);
        this.pick = keep;
        return ok;
      };

      // 1. Something about to reach the house is an emergency: land a squash on
      //    it if one is ready, otherwise put a nut in the way. The heavier nut
      //    first, since a lane this far gone will chew through the light one.
      for (let r = 0; r < this.ROWS; r++) {
        const near = this.zombies.filter(z => z.r === r && z.x < this.originX + this.cellW * 3);
        if (!near.length) continue;
        const c = Math.max(0, Math.min(this.COLS - 1,
          Math.floor((near[0].x - this.originX) / this.cellW)));
        if (try_('squash', c, r)) return;
        for (let k = 1; k < 4; k++) if (try_('tall', k, r) || try_('wall', k, r)) return;
      }
      // 2. A lane that has genuinely gone is worth a jalapeno; a crowd short of
      //    that is worth a bomb.
      for (let r = 0; r < this.ROWS; r++) {
        const lane = this.zombies.filter(z => z.r === r);
        const pack = lane.filter(z => z.x < this.originX + this.cellW * 6);
        if (lane.length >= 4 && pack.length >= 2) {
          for (let c = 0; c < this.COLS; c++) if (try_('jala', c, r)) return;
        }
        if (pack.length >= 3) {
          const c = Math.max(1, Math.min(this.COLS - 2,
            Math.floor((pack[0].x - this.originX) / this.cellW)));
          if (try_('bomb', c, r)) return;
        }
      }
      // 3. Broke, with something walking: a mine costs 25 and buys a lane the
      //    time to earn a real plant. It arms slowly, so it goes down the far
      //    end of the lane rather than in front of whatever is already close.
      if (this.sun < 100 && this.zombies.length) {
        for (const z of this.zombies) {
          if (z.x < this.originX + this.cellW * 5) continue;
          for (let c = 2; c < this.COLS - 1; c++) if (try_('mine', c, z.r)) return;
        }
      }
      // 4. Economy, but never more than two sunflowers ahead of the guns. Six
      //    sunflowers before the first shooter reads as good economics and loses
      //    the run on level one, which is exactly how it used to die.
      const guns = count('shooter') + count('three') + count('frost') + count('chomp');
      if (count('sunflower') < 6 && count('sunflower') <= guns + 2) {
        for (let r = 0; r < this.ROWS; r++) if (try_('sunflower', 0, r)) return;
        for (let r = 0; r < this.ROWS; r++) if (try_('sunflower', 1, r)) return;
      }
      // 5. fuse what is already down before adding more of the same -- a Repeater
      //    in a held column beats a seventh lone shooter somewhere else.
      if (this.sun >= 220) {
        for (let r = 0; r < this.ROWS; r++) {
          for (let c = 2; c < this.COLS - 1; c++) {
            const have = this.grid[r][c];
            if (!have || have.fused) continue;
            for (const seed of ['shooter', 'torch', 'bomb', 'three', 'frost', 'wall']) {
              if (!this.FUSIONS[this.fuseKey(have.key, seed)]) continue;
              const i = this.SEEDS.findIndex(x => x.key === seed);
              if (i < 0 || !this.affordable(i, now)) continue;
              const keep = this.pick; this.pick = i;
              const ok = this.plant(c, r, now, game);
              this.pick = keep;
              if (ok) return;
            }
          }
        }
      }

      // 6. shooters, front-loaded into the lanes that are actually threatened
      const threat = [];
      for (let r = 0; r < this.ROWS; r++) threat.push({ r: r, n: this.zombies.filter(z => z.r === r).length });
      threat.sort((a, b) => b.n - a.n);
      for (const t of threat) {
        for (let c = 2; c < this.COLS - 1; c++) {
          if (this.sun >= 325 && count('three') < 3 && try_('three', c, t.r)) return;
          if (this.sun >= 175 && count('frost') < 3 && try_('frost', c, t.r)) return;
          if (this.sun >= 150 && count('chomp') < 2 && try_('chomp', this.COLS - 2, t.r)) return;
          if (try_('shooter', c, t.r)) return;
        }
      }
    },

    // The art is pixel art at assorted sizes -- a zombie is 50x80, a pea 17x12 --
    // so it is fitted INSIDE the box with its own aspect kept rather than
    // stretched to fill it, and drawn with smoothing off so the pixels stay
    // pixels instead of turning to mush at these scales.
    drawSprite: function(ctx, key, x, y, w, h) {
      const im = this.img[key];
      if (this.imgReady && im && im.complete && im.naturalWidth) {
        const k = Math.min(w / im.naturalWidth, h / im.naturalHeight);
        const dw = im.naturalWidth * k, dh = im.naturalHeight * k;
        const smooth = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(im, Math.round(x - dw / 2), Math.round(y - dh / 2), Math.round(dw), Math.round(dh));
        ctx.imageSmoothingEnabled = smooth;
      } else {                                   // pre-decode fallback
        ctx.fillStyle = '#54c05a';
        ctx.beginPath(); ctx.arc(x, y, w * 0.35, 0, Math.PI * 2); ctx.fill();
      }
    },

    draw: function(game) {
      const ctx = game.ctx, cv = game.canvas;
      const now = performance.now();

      // lawn: alternating stripes, so lanes read without gridlines
      for (let r = 0; r < this.ROWS; r++) {
        ctx.fillStyle = this.area.stripe[r % 2];
        ctx.fillRect(this.originX, this.TOP + r * this.cellH, this.cellW * this.COLS, this.cellH);
        // Real grass over the stripe, dimmed on alternate rows so the lanes still
        // read. Falls through to the flat fill above until the tile decodes.
        const turf = this.area.grass ? this.img.lawn : null;
        if (this.imgReady && turf && turf.complete && turf.naturalWidth) {
          if (!this.turfPat) this.turfPat = ctx.createPattern(turf, 'repeat');
          if (this.turfPat) {
            ctx.save();
            ctx.globalAlpha = 0.95;
            ctx.fillStyle = this.turfPat;
            ctx.fillRect(this.originX, this.TOP + r * this.cellH, this.cellW * this.COLS, this.cellH);
            ctx.restore();
            // lanes read as mown stripes rather than as a dark grid
            ctx.fillStyle = (r % 2) ? 'rgba(16,40,10,0.22)' : 'rgba(226,255,190,0.10)';
            ctx.fillRect(this.originX, this.TOP + r * this.cellH, this.cellW * this.COLS, this.cellH);
          }
        }
        // the area's own light, over whatever ground it has
        if (this.area.tint) {
          ctx.fillStyle = this.area.tint;
          ctx.fillRect(this.originX, this.TOP + r * this.cellH, this.cellW * this.COLS, this.cellH);
        }
        if (!this.area.grass) {                        // roof tiles, not turf
          ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1;
          for (let c = 0; c <= this.COLS; c++) {
            const gx = this.originX + c * this.cellW;
            ctx.beginPath(); ctx.moveTo(gx, this.TOP + r * this.cellH);
            ctx.lineTo(gx, this.TOP + (r + 1) * this.cellH); ctx.stroke();
          }
          ctx.beginPath();
          ctx.moveTo(this.originX, this.TOP + r * this.cellH + 0.5);
          ctx.lineTo(this.originX + this.cellW * this.COLS, this.TOP + r * this.cellH + 0.5);
          ctx.stroke();
        }
      }

      // Wear in the grass: a fixed scatter of darker patches, so the lawn reads
      // as ground rather than as a tiled fill.
      ctx.save();
      ctx.globalAlpha = 0.09;
      for (let r = 0; r < this.ROWS; r++) {
        for (let k = 0; k < 3; k++) {
          const h = Math.sin((r * 7 + k * 13) * 12.9898) * 43758.5453;
          const fx = h - Math.floor(h);
          const g = Math.sin((r * 3 + k * 29) * 78.233) * 43758.5453;
          const fy = g - Math.floor(g);
          ctx.fillStyle = (k % 2) ? '#22401a' : '#7fbf5e';
          ctx.beginPath();
          ctx.ellipse(this.originX + fx * this.cellW * this.COLS,
                      this.TOP + (r + fy) * this.cellH,
                      this.cellW * 0.22, this.cellH * 0.10, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      // The fence the zombies come round, at the far end of every lane.
      const fx0 = this.originX + this.cellW * this.COLS;
      const fh = this.cellH * this.ROWS;
      for (let k = 0; k * 7 < 14; k++) {                 // two pickets per gap
        const px = fx0 + 2 + k * 7;
        ctx.fillStyle = '#b98a4c';
        ctx.fillRect(px, this.TOP, 4, fh);
        ctx.fillStyle = 'rgba(90,60,24,0.45)';
        ctx.fillRect(px + 3, this.TOP, 1, fh);
      }
      ctx.fillStyle = '#8b6231';                         // the rail behind them
      for (let r = 0; r < this.ROWS; r++) {
        ctx.fillRect(fx0 + 1, this.TOP + r * this.cellH + this.cellH * 0.34, 13, 3);
      }

      // The strip the mowers are parked on, and the mowers themselves: a body, a
      // handle and two wheels, drawn rather than sprited.
      const porchW = this.originX;
      if (porchW > 6) {
        const pav = ctx.createLinearGradient(0, 0, porchW, 0);
        pav.addColorStop(0, '#6e6a63');
        pav.addColorStop(1, '#8b867c');
        ctx.fillStyle = pav;
        ctx.fillRect(0, this.TOP, porchW, this.cellH * this.ROWS);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(porchW - 3, this.TOP, 3, this.cellH * this.ROWS);
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1;
        for (let r = 1; r < this.ROWS; r++) {          // paving joints
          ctx.beginPath();
          ctx.moveTo(0, this.TOP + r * this.cellH + 0.5);
          ctx.lineTo(porchW, this.TOP + r * this.cellH + 0.5);
          ctx.stroke();
        }
      }
      for (let r = 0; r < this.ROWS; r++) {
        if (!this.mowers[r]) continue;
        const mxp = Math.max(9, this.originX - 11), myp = this.cy(r);
        ctx.fillStyle = '#b8342a';                     // body
        ctx.fillRect(mxp - 8, myp - 6, 15, 10);
        ctx.fillStyle = '#e05548';
        ctx.fillRect(mxp - 8, myp - 6, 15, 4);
        ctx.strokeStyle = '#7a1f18'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath();                               // handle
        ctx.moveTo(mxp + 5, myp - 5); ctx.lineTo(mxp + 9, myp - 12);
        ctx.stroke();
        ctx.fillStyle = '#22252a';                     // wheels
        ctx.beginPath(); ctx.arc(mxp - 5, myp + 5, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(mxp + 4, myp + 5, 3.2, 0, Math.PI * 2); ctx.fill();
      }

      // Shop strip, laid out and coloured like the original's: a wooden bar with
      // the sun counter pinned to the left end, tan seed packets across the
      // middle each with its cost on a bar at the foot, and the shovel on the
      // right. Every part of it is drawn here -- shapes and a wood palette, no
      // borrowed art.
      const wood = ctx.createLinearGradient(0, 0, 0, this.TOP);
      wood.addColorStop(0, '#a5773c');
      wood.addColorStop(0.5, '#8b6231');
      wood.addColorStop(1, '#6d4a24');
      ctx.fillStyle = wood;
      ctx.fillRect(0, 0, cv.width, this.TOP);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(0, this.TOP - 4, cv.width, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(0, 0, cv.width, 2);

      // a packet: tan card, dark cost bar at the foot, raised while picked
      const packet = (x, w, picked) => {
        ctx.fillStyle = picked ? '#f0dda6' : '#d9c48c';
        ctx.fillRect(x, 6, w, this.TOP - 14);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x, this.TOP - 22, w, 14);
        ctx.strokeStyle = picked ? '#ffe98a' : '#6d4a24';
        ctx.lineWidth = picked ? 2 : 1;
        ctx.strokeRect(x + 0.5, 6.5, w - 1, this.TOP - 15);
      };

      packet(4, this.SUNW - 8, false);
      this.drawSprite(ctx, 'sun', this.SUNW / 2, 26, 28, 28);
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#3a2a12';
      ctx.fillText(this.sun, this.SUNW / 2, this.TOP - 11);

      const shx = cv.width - this.SHOVW;              // shovel: dig a plant back up
      packet(shx + 3, this.SHOVW - 7, this.dig);
      ctx.save();                                     // a spade, drawn not sprited
      ctx.translate(shx + this.SHOVW / 2, 28);
      ctx.strokeStyle = '#7a4f22'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(5, -11); ctx.lineTo(-3, 2); ctx.stroke();
      ctx.fillStyle = '#b9c4d0';
      ctx.beginPath();
      ctx.moveTo(-1, 0); ctx.lineTo(-10, 4); ctx.lineTo(-5, 12); ctx.lineTo(3, 5);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#6f7c8a'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
      ctx.font = 'bold 9px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#3a2a12';
      ctx.fillText('X', shx + this.SHOVW / 2, this.TOP - 12);

      const sw = this.slotW(cv.width);
      this.SEEDS.forEach((s, i) => {
        const x = this.slotX(cv.width, i), ready = this.affordable(i, now);
        packet(x + 2, sw - 4, i === this.pick);
        ctx.globalAlpha = ready ? 1 : 0.4;
        const psz = Math.max(20, Math.min(32, sw - 10));
        this.drawSprite(ctx, s.art, x + sw / 2, 28, psz, psz);
        ctx.globalAlpha = 1;
        ctx.font = 'bold ' + (sw < 46 ? 10 : 11) + 'px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = ready ? '#3a2a12' : '#8d3b2c';
        ctx.fillText(s.cost, x + sw / 2, this.TOP - 12);
        ctx.font = '8px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = 'rgba(58,42,18,0.55)';
        ctx.fillText('1234567890-='[i] || '', x + sw - 8, 15);
        const wait = s.cool - (now - (this.cool[s.key] || -1e9));
        if (wait > 0) {                                   // cooldown wipe
          ctx.fillStyle = 'rgba(20,14,6,0.55)';
          ctx.fillRect(x + 2, 6, sw - 4, (this.TOP - 14) * Math.min(1, wait / s.cool));
        }
      });

      // cursor: the seed you are holding shows as a ghost on the tile it would
      // land on, and an armed shovel marks the tile it would clear instead
      const cur = this.grid[this.cursor.r][this.cursor.c];
      if (this.dig) {
        ctx.fillStyle = 'rgba(255,93,93,0.18)';
        ctx.fillRect(this.originX + this.cursor.c * this.cellW + 2,
                     this.TOP + this.cursor.r * this.cellH + 2, this.cellW - 4, this.cellH - 4);
      } else if (this.pick >= 0 && this.affordable(this.pick, now)) {
        const seed = this.SEEDS[this.pick];
        const pair = cur ? this.FUSIONS[this.fuseKey(cur.key, seed.key)] : null;
        if (!cur || pair) {
          ctx.globalAlpha = 0.42;
          this.drawSprite(ctx, (pair || seed).art, this.cx(this.cursor.c), this.cy(this.cursor.r),
                          this.cellW * 0.8, this.cellH * 0.8);
          ctx.globalAlpha = 1;
        }
        if (pair) {                                  // name the hybrid before you buy it
          ctx.textAlign = 'center';
          ctx.font = 'bold 10px "Segoe UI", Arial, sans-serif';
          ctx.fillStyle = '#7ede63';
          ctx.fillText(pair.name, this.cx(this.cursor.c), this.cy(this.cursor.r) + this.cellH * 0.46);
        }
      }
      ctx.strokeStyle = this.dig ? 'rgba(255,93,93,0.8)' : 'rgba(126,222,99,0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(this.originX + this.cursor.c * this.cellW + 2,
                     this.TOP + this.cursor.r * this.cellH + 2, this.cellW - 4, this.cellH - 4);

      // plants, with a health bar once they are actually hurt
      for (let r = 0; r < this.ROWS; r++) {
        for (let c = 0; c < this.COLS; c++) {
          const p = this.grid[r][c];
          if (!p) continue;
          const arming = p.key === 'mine' && now - p.at < 9000;
          if (arming) ctx.globalAlpha = 0.55;
          this.drawSprite(ctx, p.art, this.cx(c), this.cy(r) - this.cellH * 0.04,
                          this.cellW * (arming ? 0.55 : 0.98),
                          this.cellH * (arming ? 0.55 : 0.98));
          ctx.globalAlpha = 1;
          if (p.hp < p.maxHp) {
            const w = this.cellW * 0.6;
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(this.cx(c) - w / 2, this.cy(r) + this.cellH * 0.34, w, 4);
            ctx.fillStyle = '#7ede63';
            ctx.fillRect(this.cx(c) - w / 2, this.cy(r) + this.cellH * 0.34, w * (p.hp / p.maxHp), 4);
          }
        }
      }

      this.suns.forEach((s) => this.drawSprite(ctx, 'sun', s.x, s.y, 30, 30));
      this.shots.forEach((b) => this.drawSprite(ctx, b.art, b.x, b.y, 15, 15));

      this.zombies.forEach((z) => {
        const flash = (now - z.hit) < 90;
        if (now < z.slow) { ctx.globalAlpha = 0.9; }
        if (flash) { ctx.globalAlpha = 0.6; }
        const zs = z.big || 1;
        this.drawSprite(ctx, z.art, z.x, this.cy(z.r) - this.cellH * 0.06 - (zs - 1) * this.cellH * 0.2,
                        this.cellW * 0.92 * zs, this.cellH * 1.02 * zs);
        ctx.globalAlpha = 1;
        if (now < z.slow) {                       // chilled tint
          ctx.fillStyle = 'rgba(159,230,255,0.22)';
          ctx.fillRect(z.x - this.cellW * 0.39, this.cy(z.r) - this.cellH * 0.43,
                       this.cellW * 0.78, this.cellH * 0.86);
        }
        if (z.hp < z.maxHp) {
          const w = this.cellW * 0.55;
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.fillRect(z.x - w / 2, this.cy(z.r) - this.cellH * 0.46, w, 4);
          ctx.fillStyle = '#ff6b6b';
          ctx.fillRect(z.x - w / 2, this.cy(z.r) - this.cellH * 0.46, w * Math.max(0, z.hp / z.maxHp), 4);
        }
      });

      // Fog rolls in from the far end in the areas that have it, so a lane is
      // dark until whatever is walking down it is nearly on top of your plants.
      if (this.area.fog > 0) {
        const fw = this.cellW * this.area.fog;
        const fx = this.originX + this.cellW * this.COLS - fw;
        const g = ctx.createLinearGradient(fx, 0, fx + fw, 0);
        g.addColorStop(0, 'rgba(198,214,222,0)');
        g.addColorStop(0.45, 'rgba(198,214,222,0.55)');
        g.addColorStop(1, 'rgba(210,224,231,0.82)');
        ctx.fillStyle = g;
        ctx.fillRect(fx, this.TOP, fw, this.cellH * this.ROWS);
      }

      // --- HUD ------------------------------------------------------------
      // Sun in a panel on the left with the real sun sprite, and a wave meter on
      // the right that fills across the level and carries a flag on the last
      // wave -- so "how much of this level is left" is answerable at a glance
      // instead of only after it ends.
      const barY = cv.height - 22;
      const mw = 190, mx = cv.width - mw - 10, my = barY + 2;
      ctx.fillStyle = 'rgba(109,74,36,0.92)';          // the same wood as the strip
      ctx.fillRect(mx - 6, barY - 12, mw + 12, 30);
      ctx.strokeStyle = 'rgba(58,42,18,0.9)'; ctx.lineWidth = 1;
      ctx.strokeRect(mx - 6, barY - 12, mw + 12, 30);
      ctx.fillStyle = 'rgba(30,20,8,0.55)';
      ctx.fillRect(mx, my - 4, mw, 8);
      const done = Math.min(1, this.waveInLevel / this.waves);
      ctx.fillStyle = done >= 1 ? '#ff5d5d' : '#7ede63';
      ctx.fillRect(mx, my - 4, mw * done, 8);
      for (let w = 1; w <= this.waves; w++) {               // a tick per wave
        const tx = mx + mw * (w / this.waves);
        const last = (w === this.waves) && this.hasFlag(this.level);
        ctx.fillStyle = last ? '#ff5d5d' : 'rgba(240,221,166,0.55)';
        ctx.fillRect(tx - 1, my - (last ? 9 : 6), 2, last ? 18 : 12);
        if (last) {                                        // the flag on the big one
          ctx.beginPath();
          ctx.moveTo(tx + 1, my - 9); ctx.lineTo(tx + 9, my - 6); ctx.lineTo(tx + 1, my - 3);
          ctx.closePath(); ctx.fill();
        }
      }
      const hx = mx + mw * done, hy = my;         // the head that walks the meter
      ctx.fillStyle = '#8fa07a';
      ctx.beginPath(); ctx.arc(hx, hy, 6.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5d6b4c';
      ctx.beginPath(); ctx.arc(hx, hy, 6.5, Math.PI * 0.15, Math.PI * 0.85); ctx.fill();
      ctx.fillStyle = '#20281a';
      ctx.fillRect(hx - 4, hy - 3, 2.4, 2.4);
      ctx.fillRect(hx + 0.6, hy - 3, 2.4, 2.4);
      ctx.fillStyle = '#e8e0cf';
      ctx.fillRect(hx - 3.4, hy + 2, 7, 1.6);

      ctx.textAlign = 'right';
      ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#f0dda6';
      ctx.fillText('LEVEL ' + this.stageName(this.level), mx - 12, barY + 2);
      ctx.font = '9px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = 'rgba(240,221,166,0.65)';
      ctx.fillText(this.area.name, mx - 12, barY + 14);
      // no mower readout: the mowers are already drawn parked in their lanes

      if (this.levelFlash > 0) {                            // level-clear wash
        ctx.fillStyle = 'rgba(126,222,99,' + (this.levelFlash / 260) + ')';
        ctx.fillRect(0, 0, cv.width, cv.height);
      }

      if (this.flash > 0) {
        ctx.fillStyle = 'rgba(220,60,60,' + (this.flash / 60) + ')';
        ctx.fillRect(0, 0, cv.width, cv.height);
      }
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
        '%c🎮 Secret Arcade %c\n\nThere are hidden pages on this site…\n  · type %ceaster%c anywhere for the arcade (Breakout · Dino · Snake)\n  · no keyboard? long-press the site name\n  · type %cadmin%c for the visitor panel\n  · in a game: %cP%c pauses, %c🤖 Autopilot%c hands over to the algorithm, %cS%c takes control back\n  · Esc closes them\n',
        'font-size:18px; font-weight:bold; background:linear-gradient(90deg,#22d3ee,#a855f7,#ec4899); -webkit-background-clip:text; color:transparent;',
        'color:#94a3b8; font-size:12px;',
        'color:#22d3ee; font-weight:bold; font-size:12px;',
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
