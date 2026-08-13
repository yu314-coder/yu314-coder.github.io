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
      lawn: '1–5 pick a seed · arrows move, space plants · plant ONTO a plant to FUSE it — shooter+shooter is a Repeater, shooter+wall a Bulwark, bomb+frost a Glacier · click a sun to bank it · each lane has one mower, and that is your last life'
    },

    // Same games, described in the gestures a phone actually has.
    TOUCH_HINTS: {
      breakout: 'Drag or hold ⬅ ➡ — 10 boards, each rolling a modifier · ? = mystery, KEY clears a row · dodge the red capsules · the wall creeps down',
      dino: 'Tap to jump · a 2nd is free; a 3rd to 5th only at the top of the arc · hold ⬇ to duck',
      snake: 'Swipe or use the pad — edges wrap around · gold +50 · ✂️ trims your tail',
      lawn: 'Tap a seed, then a tile to plant · tap a tile you already own to FUSE — shooter+shooter is a Repeater, shooter+wall a Bulwark, bomb+frost a Glacier · tap falling suns to bank them · each lane has one mower, and that is your last life'
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
  // The art is ORIGINAL and drawn for this file — eleven small PNGs inlined as
  // data URIs below, no external requests and nothing copied from any published
  // game. They are real bitmaps rather than emoji so the sprites keep their
  // proportions on every platform, which emoji do not.
  // ===================================
  const LawnGame = {
    COLS: 9,
    ROWS: 5,
    TOP: 78,            // shop strip above the lawn
    cellW: 0,
    cellH: 0,
    originX: 0,

    // cost, cooldown (ms), and what the thing does once planted
    SEEDS: [
      { key: 'sunflower', name: 'Sunflower', cost: 50,  cool: 5000,  hp: 60,  art: 'sunflower' },
      { key: 'shooter',   name: 'Shooter',   cost: 100, cool: 5000,  hp: 60,  art: 'shooter'   },
      { key: 'wall',      name: 'Wall-nut',  cost: 50,  cool: 12000, hp: 400, art: 'wall'      },
      { key: 'frost',     name: 'Frost pea', cost: 175, cool: 12000, hp: 60,  art: 'frost'     },
      { key: 'bomb',      name: 'Bomb bud',  cost: 150, cool: 18000, hp: 60,  art: 'bomb'      }
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
      'bomb+wall':         { key: 'minewall', name: 'Mine-nut',  art: 'minewall', hp: 400, mine: true },
      'bomb+frost':        { key: 'glacier',  name: 'Glacier',   art: 'glacier',  hp: 60,  freeze: true },
      'bomb+bomb':         { key: 'glacier',  name: 'Glacier',   art: 'glacier',  hp: 60,  freeze: true }
    },

    fuseKey: function(a, b) { return [a, b].sort().join('+'); },

    // Difficulty moves the three things that actually decide a run: how fast the
    // sky pays you, how hard the wave pushes, and how many lawnmowers you get.
    TIERS: {
      baby:   { sunMs: 3200, sunAmt: 40, waveMs: 16000, ramp: 0.030, hp: 0.70, speed: 0.75, mowers: 5, start: 300 },
      easy:   { sunMs: 3800, sunAmt: 30, waveMs: 14000, ramp: 0.045, hp: 0.85, speed: 0.9,  mowers: 4, start: 225 },
      normal: { sunMs: 4400, sunAmt: 25, waveMs: 11500, ramp: 0.065, hp: 1.0,  speed: 1.0,  mowers: 3, start: 175 },
      hard:   { sunMs: 5400, sunAmt: 25, waveMs: 9000,  ramp: 0.095, hp: 1.15, speed: 1.15, mowers: 2, start: 125 }
    },

    // Kills are the only score, and a tower defense kills slowly, so they are
    // worth more than a Breakout brick. Surviving a wave pays as well -- holding
    // the line is the thing the game is actually about, and it was scoring zero.
    ZOMBIES: {
      walker:   { hp: 100, speed: 0.22, dmg: 0.9,  art: 'walker',   score: 25 },
      armoured: { hp: 260, speed: 0.18, dmg: 1.1,  art: 'armoured', score: 70 },
      sprinter: { hp: 70,  speed: 0.50, dmg: 0.8,  art: 'sprinter', score: 45 }
    },

    grid: null,
    zombies: [],
    shots: [],
    suns: [],
    mowers: [],
    sun: 0,
    wave: 0,
    waveAt: 0,
    sunAt: 0,
    pick: 0,            // index into SEEDS, or -1 for none
    cursor: { c: 4, r: 2 },
    cool: {},
    img: {},
    imgReady: false,
    keyHandler: null,
    clickHandler: null,
    lives: 0,
    maxLives: 0,
    over: false,
    flash: 0,
    autoAt: 0,

    ART: {
      shooter  : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAwFBMVEUhJhUeNinT49ZVXGUZEQyIjpN//38mqyZ/24Ok36cwOUMwVSVs2nJChUF2fIMA/wC+6sBAeT1VVVVAhD9VqlV///8AAABdymL8/fwAAABVxVo8l0NhzGaR45JOuVRDmEYaGA84hjsVSBsUCgxp024EAQFGpkwWCQmx57MhKBaO25E0eDYvaC8vWCo9jUApRiMkNhwRGycbGA8eJBQaFQ4+oUbT89McGBAWCAkMBATU1tgZEw0WCQkbUyEZKxYYIi7M1ev/AAAAQHRSTlMY/v//pf8CBP7//wj9//8B//0D/wMCAP7/R/7+//7+/vb9//X+M/7R/////v3+/v7+/034af7/Mq1t/5CO/xL/ciR6EgAABCVJREFUeNrtl1l/2jgQwAWhabttt3tWIAsdkZF821wBwpHv/612JBuwiZPY25d92HngFyaavzSnBPrxk4L+B/ynAajbBu0L0ORglFgul0KZ7W7TF7DYqjD9phkhjPE/01CZFeoBQFuVc386/eT7GPsgJMuFWnQGLFTIv05LAQII9YlXqNGpG2ClcgymQRA4BC0RmCXCbLoAVirxo+n0cQwSXAmYMhka9D4AqfSrX9mXhAhX8hqhoTup3KdgVdqPH69xANFSbN8D7AXD/msAomOxehuA1O8+sYCaC+ADpS6OlK1zVS2/bwccQtgnsjm4HgAAhFBK4QNrbzk6GChQYbaLv14CPprYlk5Q7v9Y5nEakWgIX4efCBwhVXnMGdMyv2S1BtgI7VMSjGvntzGIKsVngj2ZEVvf8KELtboF7ApMSbl8eCUEF0VEoD0YwdYhYKRqcwPYpj6hbvnTr4MP43EJqCko7E0rwYwMXEhrAPPNLw9wNxwq9aGso6CmiJjdvewxCml1WUW1JHKf/Ga3m/8yeJ4PXBZwUFMEzNrr5HhMOESLpOa+cQKIIRm69fN5CYhoQxGAAz5/sDKQQODWhxtAeWL1/KzuxgEUUEMREdj/oZQB9xkLZy8Avgv53Xx+BzGDDZsKGA1JBXg4QkiLGwC/lMHT09geGCq4pvgMIcDHM+ABUtoEICHx+cy2DEjVQxeFTWINoMmNC99NYm3Kyn2MyKULzwooQVxzgUEeZzeFxGzfEexHPr7YXxRQfoxRPqiCGDOSmI/NUg495za0H9TrFVApHICR2BEGCfwdHm6bKWbnIXojbiJozxKYhDAcY0Cl6nTbzvmavbC9MJjnadeKTGt3lLId6wNlJaRzotWeeCCpQ9h2Zqnat4y0fM1xK4Fi7nkwT0TKrRs6Catx0ByqC5WsedsZoO7BXor9yqiwKEJhDqj1XhiBE97LOFj/QULzBQxmVu5fuVhOZinXECtazyIl2tkXCr1/tVkCLNfMGrrJg5kzX4P9osPdiJARsbNwuYKMuc09LcNXbvgGYCPUFo1U7lVmZ1l7qTDo/ev9D1PEodrvzTKVWq+v5pC0PerwwFiImNvFo70Rg0SeAfA+OWy6PHG+wNMm83gGx10t4AoTkHHOpRQ71O2RtRdSZhzEXlyLvyHhE+EAHZ958LjgcRw7iENAUvsAvm9DsPSktJCMx4XY2DHZHYBUojMIQQUBu74AATc39zIIO0AyWZhTP4B9nxZJhch44gqvF6B84iYQiCzj0Ln2Xz0BUMsHeCVLcKHqvN4A+H5QIpdJ1Tn/AgDJX0ER7n/YsVEV0sT+3ee5jya7SSkVoJR2SAtgBmvPAF0DWEYXwOy6fmJ/tCxrgMmkJ2DnpCegTnATePaWffuPrrrJpI7r8bOvufMbefzpH57/AM3zofXn1fSPAAAAAElFTkSuQmCC',
      sunflower: 'data:image/png;base64,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',
      wall     : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAwFBMVEXk3tZWXWZVMyIhHBMYEg3jyqqSlpwlLjmqfEFSOh5ubif//3/NomgtNkFsSiA3QEqZZjP///8hGBB3fYSeZRUAAADNlk+ndTT9/Pvnu3ubazEAAACgbjK5hkQBAQHqw4oYEw3DjUYMDA0OCwk1JxUkGhHnvoJ4VSi2gj3XqWru1bJqRBlLNhz05dARGycnHBBpSiULCQgKCQgFBQSFXSvXoFgaFA0ZIy/U1dfcsHRiPhUvKBEbFA7ZuY8iGQ8UEAxAu00XAAAAQHRSTlP//wkjof////7+BAL///7/BQFq//8A/v7//v5H/v42//v+9tH++P/9/v////7//yr+tI1r/f1x/////w1P/0zSjy93igAABFlJREFUeNrtl2lz4jgQhglnkklmz5GwQD4kG9tgsDkTJiH5//9quyVfsvGG2q39tl0FSDb96O1WW5J7P/6l9f4H/LeAvv4ZfPsHgG+D/VbKQJkr5W7fSbkKSHfS9TN2z4nnefyehYnvyl16KyDdCj+8J8cjqcxjme9u328BvA2Fz46WsnNcY9AQEOmXgA8ZHIhlLRb4WThWAyFOXwB+Fwl/ssDbchwlwrFqBM4Sd9j/O8BQZCSG0Z3edDpdL9sEGrqfaTfgJEJyhOGdqbY1EhYm4RDItAvwIbIjQZdpYUuMxokNAgtk/zpgIL4TEkPoyxIw1YkgJsEdXgU8Sh/uW84i5pRSfqkAhgRCIQ+na4CTew+3nXM055fR5YnSXgEwsoCEB5G2AX1MAInPNIp1CE9/jqZTXVBWLh4swsmkfpWGEnAKOPwpphFUz1oR4rmeyByAcfGIUg9aB/e9CfhVhlj7HrVQtSZw4lQASosAUEIiHxuAgcvVbZ4X4HK9Xi4sqwQU/qpFYSbeG4Bdou8e87SZBsq8KokcJWxNwG86ghyA1eM4pbsTe1FUzULkeYyG4s0ApGoOAaDDdjAJ6xyxsM4j6Pcu9ZlkwcwAzPycTtFlWa/kRfloLCsAxLAzALuHolLPjvbvVc9C1a0Bsq0B2IYlXTn0euPJOK9E5T+e3GFplAtDmQQN6EtWBYgC7savQoxRguL9MZ5uBBCWXglgbl3BwK0AHgBeN8/Pm80zrggEn6rJyy+bl83rdF0pYIFdDyGgDcAGHCYgnXioYAJdEzCnficAPe7EywtqdjxyrnWXtwBIjEm722yKrGESsQsTcSlnoQWoJZGM0OX1Fb5G2L2U3TXpBLh1AFmalVOusfVCYgbg7TP06oSFKuUFZeFqFbL5Gbu9UW2jmzdnQWZRHeCROI7599VPZasVhS7xahsMgzXlzSjlhJKGRSuwA2MH/DXvUgBk+ZKSA/b+nJv+HrgxPSiFJje26nnrYRq4h4YEHv4sr/BVRg0BkAJ/bwAeZUYbEgi/2swFhGLQWNJ82spCh1EVQWNJgyUpNAhqE1DbQNPwQYJJbC6qP7Y+ZbzuHqldoIWAAFBAsSRWgHeQUBCiyo03IvPmGAALTu29ESTMNYHTelmaGqgWIN/agFQkUCC85dIcH/yzamernw9OGAQDxYYAI3/a3zgg1E8oQ6gmIHhdClC+SoAcXAf0ZcCQcL0i4GhC0Z/6Iu06ZKWfijCnrSC8COtXje+Lj+5jXvoJecCJgoF4CYF6YEwNj/pN/+ZBsz90HyiKYEqINtVW7pD/xjGxfVY+Cf+gEBQhTIPm2v3KQfXKaT2VbnLIx9WGFLyQBPLjpveFd+k+ZKxQnzfCxBWn/m0vHLa93wo3yULtDKtalgRC7mb2Le8L9gzMtme7rRRu4IMFrpDbHV7DO18B1L80A5p7ZZpYXL8VUFBs27w0uymEbrNvSKLdybDtm98bW8rta85ofwFYfYwc94zKYAAAAABJRU5ErkJggg==',
      frost    : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAwFBMVEUjIRoqVWRcZGYeJB5YlacxZi+f3O8WDQibmZlgrsp+0exReopTmVk6dIotNkFlZV3///+Cfnrl5+gfarRKRD45WmJVqv8A//9///8/v784OFUuRRcgHRgA/wBmmZkAAACL1u37/f0AAABUpsfQ8fsaFxAFAgEkWW4RCQd6yeTL7PZDmEY5hjsqKikRBgJrt9G05vUuNTUbGBKEzeULBQIRGyd2w9wQBwM9jkBQl7KqqKY+kUEaFQ/T1dfJyMciIxppxy3JAAAAQHRSTlMb/v77/v7+o/7+/v3+/v8FAv3/A/8KAwECBAkLXgEFAP7/R/7+9TP+9v7//v7+zv7+/kv/bP/+k/78/f9t//71HCYr7wAABEJJREFUeNrll2uXojgQhgPhqvZM987s7H07iMGAJICoiO3l//+rrQQUsJWW6Y9bp/scLVNP6q1UQkCvnzT0PwN8DQL0CcCyEDwTxfKnAYXO9R3Xiw8AqPuh+R2JbOccd5lAdwFBsMcnOwjAOy0Ew6fTiTJhr6oxAdcdz3P076t7gABz9rJjHO9txnXD2OSWtTGMOWdij6CA2e7oecedfh/Aj1LkETPNIJaVpkSaZYWlRtkSJPB+CWjP1AiOjXQ2iyL4rxCEjEqN2d+giC9OXxHxSyXSktEexMNfTSDJExV/F+K73reMeCdFehAbedI6hLDk4le0WvU0ErKlBC9Koyq+IqQtAkP9rayKOCOQfA3wADAjFxUltr+hXgA+UWtGZl3AJYXcHbN9/2ZaMiMlcgVaEhoASXztLOL5NmDFYVgqw5oEmjIS4pfcLgSF/hT28sd7wL9ibElAe36ZgSUziiyZwhx6zE2SxNDouZ9aAEQTmCbqxs/StHakJPfLEroqDEeEuFldkBZglUkFavAvjYLo4khJEpIwrxZ1NNKrgrQAtg5pquGHMYeeVAlELQcJ63CFIFVJWwBhWFUCenRkzKk6MWo5rPC8ogSmGiV03+1EBgA5/rD+kuH1F6Wh44gUIBlr2pMrKbr4vZOBrGE1fr3Gaw4aUjKatRxqRQ1Nm8812PDwUWq4AlQSGMZMr8a3HbKnEgiXphlWuOHBO4AqYqSv1zrUTNmVY1wD5hrJw+wK4F7a4HDwvLoFG0cqS3COn88TcgVA1CCtRrq08MURAiBvAUZXEn4TY3JR7TV76OLIJeHpImEzcmlXgj0/r7NFrqxyhEBwL0UMYRn/uGplPyc9lm8kwVAE7SmERSiuN5OR9AESP5RWamr+G638Q2ju5n586PuJ3IokTBLIhdTnU+dAoWWPCB9srhCyVBt4Urw7kRDTfL8n3tUY1Q2YfePq/Hw+do7ZJRv7t3PI5fwGtfeC8SzjVBTo5uPdBhF+eFM/GDxaICCQ9nznfgB3AN+yrtciT1R89tGDRdqeOVFk+Ukri7AKh/jlx5cshOXzNZWKYa3AkjraNfjt+C4AUebAtjtaddjZXL85xvsAXwU2T45zcPi8dN0mvtQ4s/984J64pOZiYk4cehIUDq1SLZ1haJgV6JGL5l/MXGy3bwuTsj3cCSnNsmyyiGO6Qo/dVG0ax9vF4m0Rm1Qsn2HBp3QhAQ9edREkYJqmgiiELOoAwD/2SU4fxxKyXZiYwk9DAJDARFaghkDcUAA1TQjevr1JyDbGYiDgdWkzfEaABNV4gwAKcTKhENvtIqb2KxoMgG8FIGKQgKudNxigENSMzXrn/ARA3pmhCe1XeWzUjTSVn4e8M6HpalpZDajsNuQGIICxZ8CkBZCMRwBBM35KMVgLMJ0OBKyUDQS0CeoEDvrib7/2tUOmbdyAN9fuzD3r+Ol35/8Akx8DcFVyGlwAAAAASUVORK5CYII=',
      bomb     : 'data:image/png;base64,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',
      walker   : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAwFBMVEUnJBheY0ipZWW7zaEbFQ4YEgzNo6Onk4nXy8qGh3HNxLP///8YEw1RYD+DICB/f38zTDNMTDMAAABVZUN0hF78/Pmjt4d3h2EoJRkbFg5reVXH2asIAQISCgcCAACFmWsGAwJNVzsgGxM1KyDj2suxxZVxBASesoGSpXdbS0ESCgdKRzU0NCXa5MwSCwfr6dYaFQ7V2sV7EhLw6uhJOC19kWMmJhb28d2ONzYbFQ/O4rGbrIKcsX67s6g7QSwOCAXiMncGAAAAQHRSTlMV/v/+UJn//////wHM//8ECgoA/v7+/v7+9v7+NPVI/mz+8////v/+/v/R/v7/rv81//////0T//9s/v7+//+O+T8gRgAAA2pJREFUeNrNl2t7qjAMgIu6udu5jQINWCogyhDw7nRz2///VycUnGzCsZ59WZ6n2gJ5SZM0tOT+i0K+N+BW4R3Nd0k/i4ExBjx+6/w5G0AyzjQriqLnyNISiLfkPMCWMyt8enKc0DTD0BRjiKfnAC64h+pp6khCLpTxrTKAXHC77TgGytM7Qbzy7VQN0AFuh4W+YRxsiMYAF0qAO2Ci/XQAtKV+aOoAoAbwfT4WB4CTq49sxpkPRAHwK9ZGns/Z9aLUd8xRpANPNOHxtQJgCsJMF92EQzd1CkCX84cXYxJR1lcAvCXmLDf+5eGqMCB0jOur/EoqxpkCINMdY3G5uZQqEoDDVks6RD+ewxHgN6fGVWsxHHb3UUwXrcVmKAkW9E5bAMJoDTfz4c8CEO6MSxzOhwMcPjMVQISAeQnAHBghYH4WQBiD+bCcwsg0d6mxwaGcglACUAedUDjR2aEFbWPR2kj9GQ1OAwi3zUmRhcZEJvFoVg4NQX0FC2JvZ6by+bRYRXvCIlrZsFZJpAjNnqWzchXmhNBJZ+2ICi++PQ3oAEXCLtd7PjRzNxKrlVIqE1yKkWlezx615WCyb9cmGqBzldV4vwVbmKPlwBizQ3ugYmWxTKkekDhYCYGAh2Dw+N40IcacqNXEDk6CLmePHwB25NWW1TrAHYBHlxO0oNLsvKJN1QDg6Z6mvdws2cvNmBX/mu55+nEifwbIUQ90KXZFiiunAOuMg48VtQRoNkVnCrGitlYC3GObK8N1zDT5tsTT64Vx9ANk0wZAxmxLCm3Q14NX/PEYn9YC1lyzqJRmQmlITGotALsEUOvfAK8azgrAVwV8iIY6YB/L/wBgZPBaxTPqgFI1jwzKGQD7k2oh6oAj1fMBtfLtAYTrXwPcZqzwm9XAsU6lMuGBXI72uH4u1j4Vk+o2g3wox8CCIABocIb1mhcKL4FOY0mb9lDcJm9auNPD3Xu8PVVUGwFBH/lTcvLDAlqDD/yeUlm/jZNVXpboO6borOr2mfVfJvCsiua+r9fttevPC3hcKJezDGsZPbhYqwII7At7gnHdp0/dZ6XpxALvSev2oC6BzwL8OB9QUeq7h76rCMBcPFjQP/R9TCMVQM91XZ4UOq+8X+3jLTVA743nZ1Y8tGYf+nhHaQr4XL8U91P/+Om/dllWFovfkjsAAAAASUVORK5CYII=',
      armoured : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAwFBMVEWaoZ1gZFUlIhUUDgnLoqHV3tWEIiKdoXl9FRXLybM7QSwaEw2oY2NRYD////8WEAhVVVV6kV4AAABVZUN0hF6apbJ4g4/8/Ph3h2BreVUGAQIhHBcoJBobFg/K0tmkt4iSm6cDAQESCwcFAgEzKyHl2880MyqDmGhxfIhMWDtwAwOesoLo59ZcS0Gxw5fq5ue3yKN9kWTFzNPJ2LITDAcaFA6vucRJOC4TDQgmJhX28d26w80oJyeTp3dQRzi0eXkBXeClAAAAQHRSTlP+/hyb/////v///l3//wHMBv4A/v7+/v7+/jXt/vf+/v5I8W3+//7+//7//////v///f/+0jH+/6wR//8Q/v7/hU7LZQAAA1pJREFUeNrNlgtzojAQxxN89XXtHaYCmohEhIJWimDVno/v/61uA/iiPNLrzM39Z6IhZn+zu9ksIjUvRa3Q9tMKyu9o8EGF+FqpBmxjikcV6jlcqQSs6ej9uULo2Yl/VgAUjivtgYDYssqDwUjsel8sfuctT2tOvxbwPgTlCOc1CcBCbB6iK8B57V8A3lsFIbRkQxj1ej0I+DfqXStbQzUAmtqhvPlp7QXVePDSq5NdCWDfBGw5RtXmCFdXYoPhJFKh3smbl0wwxfRpWwXYNNgAT80g0BbYWURvQggNca8VBAEKDZs9Lav7AdwnMteCZgcQmhZF0e28M9Oah6YG2hFm1TUUVWFuNDkE/k0AFq0omk/nWlNr+4JwS3IZLAKoA1c73Dzc+AewmM1NsxNNbh7afls8ho4cAPl+CmjtADCciEd5ACPDoO377QlYRFPThBAefD8JIZIJYcsNU5scDsJeM4WmgdZ8SJKIyEDCg9jrvGmp3qYJwcwe0S+DbeoBDWc3nc9ExEd7c95KcMT14sd6wD0jOwj8bW7uEPgvxs4Uj24Y0rFaD1D43gUrPfrAq8nsODrTne52uSIBABcM15yuJtqenscrcUOdrlUZwCamoesC4NWefJwGdt27AgeKAApje5eshh9XAGOHWe4mlwFU5nkGWc3Ag4thEK9L+3WA5Kr3WbfbxRjdrii63dP0G8NaLWCz5ky8wgUAZFwoXaHW5/8P6Cp5ONnseMl2bBBIpuuGxMAZgDPQelkCWFNDT0S6JbLv4MOjfFkI2HCsk0TlhMyReFvoATMyANGrAd7lcV4ABrKAq9OQBxyP4i8AcDKwdpEZeUBmKk4G9AWAkTNNJQ/4ZPp1QKH+e4DCu98DPK5pmje9hKPXlbLC7eQ6GvviWPRjKTp8U9xQlJhR27YZK0mGficaheew+9KWtuyDrLJs6pRTSll8X9dUSwH2GPhLpb6t45IcDPpSbf0xdkLRlsgJk05Cj2/k3gv3zNMvLI/zLmuocgC1wb3sOifHmp0ea2xkAQrzjkcO53osn6LXSglAZaeitfqsqIC/BPjxdcCF0dg6zy1JANTi2YPxeT6AMpIB9C3L4k5qc8fHl3P4SQ7Qb3BGRdnz9dUcfpEKAfaNM1m5+efdfwAnjF9I9yy1tgAAAABJRU5ErkJggg==',
      sprinter : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAwFBMVEUmISXd1ddTWWKgnJ9jJCF3h5vPqKi90epfb4ihVlaMMTEgGhU/TWL///+csc4AAP+FgXxMTDNIJEgAf/9fX19/f78AAABJWnNhc476+/0bFA4AAAAoKCovN0SxxNxOYHsRCgMGAQDb6faoutK2yuIuMzuSqMVYaYTK2eo7RVVxBQUZEgyFmLIhHBgaFA8SCwQbFhJ4iqQcFxSQoroYEQno6vAYEQoQCAItKSpBSVYTDAYlIR2xdHQNBwMYGBiZR0cU7IUuAAAAQHRSTlMY/v3+//7//v7//07/Af0B/woHAggEAP7+/vpH/v7+/vU0/v7+/f7+/vv/lP7+btNO/TD+0P6yrhL9avf/hw//xlM0uQAAA4VJREFUeNrtlmmfojgQhxGPvnZm9pg1UAaJcsh9Ix6t/f2/1VQAbduhm9jzavc3/3chqSdVSaUKafqLkv7ngC8Ce7w/u9lVMez3e2DVIflyM2DjM0qGtoEKZAvipxsBUhwqzkBdLh3TvLubBy5bb24BPDHLUFElEuYo07gPY2l6FAT4BdNMdckJ6rKsCfN5ShkUYoAMgM4HjT0GsbyrAWYaAiSiAGblrwB0wbybK3sAiIQAEpPHIaPDE2CJRyDvGVW27EkIMAsNZzkcsfDPxn5pDhkbDdV5Gs6EAAfZ4XsPR3JtXzrlQB7wL8a2EgJUCt7f8+QcAeImw5KPFPZdAPAXy9WJ+uA9NwDVUSeDgffICUPIRDyAQek9PHpe7Tbegfry+DKqeQ5dCAGcged5oxqwNOcI4KNbAAYG4HkP3AGeQuqE8zhuLgjIVfX5sT6CkgPwEF5e6nhsIcCGjR21VfMMytMoDXsAyY4ne0xMs7YpzVZNWhu2wvibznbJO4AIKGb7t4P1Ff1GGWeZfBTYcoXrE9iD3wmImEUsnMtgbPDnp2hn6TjO82C/q3ch2gXhFZCARYjO5+KtbZimoVHNaqTR3LQDm2AEfBe+KvoZsKM6wTkX1glTkGC4rx5o+dfATpHt810IWdGqywNKWsIaUiynF/Y0zfOcxv/6oPFdMNIOD6YJOxGwJI1tm9DG2rKoG9iBxaQ1uI09izpvofWBECSEip2naYBK03Qc2GPKnk729LIyvcmDLA4bApY/kAP7rEAHrtaeJe9mYlbAtllEyB9EQQ8w9iBVcMC/tfsnH6SyVLTbtFqhyBuFcfbhWzgfVKf0LRRZz2M6nq6qy96FQup/zpgs+rbD3OUpIom0Nkz3sANAKfhHseaaVNAFqCLx9t4JWEx/AaCv7ulC+hxAX63uFdRnPEDblXLSjQBdv7D9BODK+Dfgvwg4AvnJfgU3AP6JrSvze/zJ29wQQgTbKwK57Ki9AKnAiqJfmGORo0UmDvBB1olLX6XxelwIP+eorswrLV40quq+K3cG0QXImNV0OP8N8LKpfwjYFE2LDIu/T5/WdX3QKRP60WxWE766DWF6bJsmLTb9AL/1lx0Ws7N2TesnsO4FJE1jcll1YT9bHBj/jK0l6gNUtO6mEM/eaFGx9mb6AH7o1gcwu9Ii5kcj06IPgO1Z0y22W1wTZngMLsTX9/ADnjmT04wOmskAAAAASUVORK5CYII=',
      sun      : 'data:image/png;base64,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',
      pea      : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAwFBMVEV93WIBAACD5GgaFg7I97RNpzx42V0VCAkWCgpmuU8SAwZ94WP4/vVUrEJZtEVsx1RIljclMRczVSQhJxQbFQ9GizY4aCmp7JIdGg8aFA4ZEQ0XDAuB3mYTBAdFeTMySyMcGA8oKBQ8di0ZKRQeIhEiMyJVk0G+9KrT+cQ0WjQfXx8/Xx9V/1UoGhoZDwwgIBFIbUh//3/m/NwZMxk/vz+a54EtSx+18J+q/6oXRReH8WsAAAAAAAAAAAAAAAAAAABcaa+jAAAAQHRSTlP/Af71//3+1fj+N/7//v7+/P/+/238/v8njq2M/6z7/k8R+RP/D////wcICAMTZEcHAv8KBP/+/wML/gAAAAAAN7vNUQAAATNJREFUeNpdkleWwyAMRWVEc9x7iUt6JtN72//CBozjcfI+4MDVE0gA1lnfejhNSzDT/aoVqCTadD8HK4HxwQ4C+xCjTP9BJXubjLJjWW9HUMmOONAAByXidFgb8CS7X06O9FjAICfT2cA6iZ7wj1fXpbQYPA2P5VaBFdoEqOu6N5SSwUL83VKBtifQaEAVGCzAY/EOzyIjwAuq4ukXjKeEWMKDzgRQqP2iOQNvtwDLAK5KgEl+NAEwVVwAbxZqbsVZsoAf0TnXIMhQOdrP4Nri5+IWrEcM+QUhPot0gXvZezOPQ2yWy1I3MZUbP1BdHaIJ91mGlWl7jRvmBRwU4jZjYSLeDFjXGIeMeUqMsRxFOT1tKpM8U4yFeSSr9ewzrJcCkyhKUCzLi19iWS/lQuvuvP4DTfASiYNzST4AAAAASUVORK5CYII=',
      frostpea : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAwFBMVEWe5f4BAACk6P7v/P8aFxJct9YVCgITBwEQAwGm8/+M2PLQ9P9qutVJdoQjKShrw+FzwtwnNDUbFQ9SnLRLhpgoLC4ZEQqDwtU2U1oWCwMaFA4RAgA6XWVXq8gxR0dmmKeCzOYeGBAdIx0bFQ89Z3Sq//88TE6f8P9VobpAVVciHhsgIBkiM0QeIyA/X39///9Vf38/v79fX39IbZEfX18ZDwcoGhoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABNbuppAAAAQHRSTlP+Af7/9P341Tf8/v///P/+/f9t/PoSrf3+jI6s/vwM//8nJ1L+A/////9LRw//CAIGBAgHCGQTAAAAAAAAAAAATha8lQAAASRJREFUeNpVkueSgzAMhIWQ7NB7CSGBlMv1Xt7/0c7GQGB/eEb7mZ21MViT7vTyNY8wuuedJCW5Sw9L8CTpsatct+paEukNNOJaOQ4qOU5ci7IYQSMCBwFhEEJOpQHPygf0bM8z5D7XaWB9yKvyba2RQCsKBc5UIdhGJhDj160Cu3r6YAZwkZ/wLTsHwFtEKWV0hD/y9S5NvLEYoB9uwKJ+mNUhYK4cJRrEJne2leIB+MbA2UeXVdRB5outI8hoo+u6a4AQBfIHrF/arwlGnOgDvog6WhDEmANx0peYijzqh7ZD55gzasy1l5Sz37u6lxsxZ6E8GFCUot0z+0rMHJA8zb82FeElU4wfgkQ0xeIxFFtJYZKEJLfH1SuxrPfjRuttmv8BwogQNB2lwDgAAAAASUVORK5CYII=',
      repeater : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAwFBMVEUfLhic16HX4ttWXmZbx2Viu2mjp6wZEQwsTiEdHSE1PUcgRh8A/wAAamp+hIo9sUd5yYFVqlV1e4K+6MJVVVUA/38AAABDrEw7pkT8/fwAAABJtlI0hjoaFw8URRkuejWF1IxDmEY6l0EVCwsFAAEsaC4XCgl70YIeJxUiNhs0lT09jkApViex3bUmRiFxx3gaGA/L684aFw8QPBUOGSQgKRYYCgkYIi4cWCINBQUaFA40pD4XCQoZEg0bGw7n6Oggc6eCAAAAQHRSTlMS/////v7/rgju//8BAv/9/wP//wMCAP7+/0f+/vb//v7+/vU0/s3+/v7+/v3//v4w/1D///+y//9qcP+RlRX/4Kqd+gAAA/NJREFUeNrtl2lz4jgQhg2EHJPMzuyFBJJsI0W+MeYwSYCQ//+vpls+qYWJvfN1uoqiRfl91Gp1S8aa/KJZvwG/AdcB953pF56xZkfPE4EQQnm7t6wvwDoqkWouKSGS6zRQu3UfwNe9CvT4xveXY0IYGNWh2GWdAdZOJGPX9X3fdZcMgiCICNS+I8DyBL9x/cVqNUAEI4XxULx3Atx7uVy6/moKNnTdhhAl1wltwJ2QzPUHU2MrXAWpYkjE/nPAWjmsCgDMb4VAeaqyzwCWShlpAEMEjGkBYJLn3v0ngDdBGHHdG7cADBAAa6BosAgNizjBY38WT9duDfjXSxiBJQxWQ5zf6N3lgQ0WC5dRCCFVHhSn8I7rSXas3QZwEpwRWmbwb9/oXbYsw6EQQg71GXEdKk/V7p1VA95yCPd7mUAgoL7aESTEnJbmiKRxH2rAEVLI8NmP29HtdOoi4XszHh8gE1jbkBTZuFzUAE+zA044HE2/qFFRBm4zXkRGY9qD0sqF/bXqTeTssADBH9vRy8t2iGXAmvHH8ICCG4bNQQsXP5TWEUAVGsBfamsA0Ezt8dConFfb5sX84D5qKJAzgAl5u33BJUAR0tZ48Q1Erxvb3hQAdO2NTUgD4LDbmLTbLw+jj+nyAIDWeAwBOyiyJa1de/NK24BiSsi72XhCWuNFBLMajQGULlidxJPQGHS58YuqiaqxyXwhiRq3DXjyEpyUjuE0WSxp1cfVGPuBabNuh8rSNfHUS9g9SqMom6cmlGPzZW/MsisXA2hy8Bbwlu4/JlEVwS7ar1Hj8qaQJpnQ0VU5k440JRxxI69dmdeAp13IJbuqd3jVTN946FTNxHPVHChroa8QGOEOd0RqooDjUTWulzWAr14As7DLeoeHaqeCMAyEt7fWjds+VDOVckdeiB/1iVpPTs9gxdlq1W77WN+LBGIl7Hz6yAG9vnoxnN1M7woITmSOC3Ot4QVb6O+sTlfbnUg5BhyZbZdGDflPruvPAJlQCi5nbmSlYf5D9W51uRv/8UInV0o8AoKXc+MnUOtu1/taOHMJd7kSYaIdA9E85lycur1g3Kt0Hst5DIWivAcRgAkxnwOg4xvKu+A8noPxFCokw42e9QFYKpmbZccFwlRJD8DTLgelNMkDhhOKrB/gpDSJIQUlBGR9AdBhII6lREjMQ8/qB5hAh4W6RMRzXex9r11ARK4hEXE852Xv9ANALR9VnnBYQlgeNH0B5Yuuaf7/CYAf9vD6AgtoFdIM/T6v+7PaSkBhlyEXADh1BSAtADK6AJ5nrQhMS7V+mPUEvBnrCWgTno39TH/5b1FbMmvjevxrO5/5J/v4y3/7fgAI0JvzPXoe0gAAAABJRU5ErkJggg==',
      sunshot  : 'data:image/png;base64,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',
      bulwark  : 'data:image/png;base64,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',
      sleet    : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAwFBMVEUbIiAgIBkpVGJVk6hfZmmgnp0xZi8bFhAWDQhdqcY+kEJPfY3f4OI0b4Ws3OsyPUVAOjRFmmB50fCCfHeIuso3WFhLS0tJRD4A//+q//9IJCQ4OFUuRRcA/wBVVapCmT5///+HgX2qqqr///8AAAB5yeX6/f4BAADG7PmJ0+xrudUaFw8RCAYFAQEcU2dDmEVOm7hUpsY5hjsqKSdywd2CzucRBwMxNDLO8fy15PMLBQIkWm2ppqQ9jUDKycgSCQS7TQh2AAAAQHRSTlP7H/7+/v7+Xpf+//3//v3///79/f0JB/8BAwcJCwED/wL/AwEA/v9H//7+9vY0//7+/v7+///N/v7+av78/v6u5Z9q6wAABFtJREFUeNrNl1lzozgQgIXE5Th2JpkkM3tfEQZJ2IgbH+H//6ttidNb2DGTl+0HV3cV/fUpkNHbJwX9vwHGfm98AuDm4pspcveHAblVfLUKK/9RgJEXR+v9WORnVfx9FWCE4fD0/ptpeZ5lmnXfEReh+r9dGQHC0E2KOgwb65+9eXz3vPdjD9h8SUwr+bK5BAhRIixLJKglGKIpQTiN/bObKBvVxgWAkbwn5hF+1AOvE01ETUlJOA0wHKEjJGLvuHnOEUJcmKboEoBHLV1ScQEQJlYT4a+C4yVhSsgSJ6JuCUbdlJBfKCEsLN00a/28XpfrKqA0AGHkgbdVqyYeLzfRcHUJlvlclj5IqRAgAV0mTRnGvk6K/PIYdRMt4pV+6cGPX/oNgVKJRbPPr+M9mRzjVy/wfU+LyqIjLDrC9VU2cv5c+Sp+Sygr2hO48zHAEeRpXbYJnKeQyoMwPgK8CBzQ6gxQdoCMySJ/+QCwR4xmKmzjX/rjGqgkUIRK4qe23k7tAX/mZkCzqiwHfwXI1r4PA4UUsFDryXMXQG6vjvZAEEjYHzVAlRA0ZqVSKEzYz8USQKJXa6MH7BNIdO15Z4SqMysqZVcNScxe5XkPcKGFmXr2Xp+JpgWDHbA0hWZmMBHKdF+1ukA9IF8GOoF703sQpk6hqgbbhw4HQaaOR5qmrZqlNEJ9C6JAd4AgE07yvadWeWwz7ZOBb5r2apDSPgO+aABLgRpAdW5TcMoIPhwI7VS8TAM2ABisETi8w+OQst6hke3D4aYrvN1iqWrR6hYf2HkGemjWQ2Lee3oHz+wsgKDbLfhkrbo94NUIQJ6akNA3aGEzpsFm8GJQPgBIO1WJ7JvIyeDR+Q92ytLOi9F0CvA9x80LCBrXH8KRzSCFlcobR7RTVReGJtaY0SuSpoyyg2riqle3GBM6WmWZXgGwFHJgKx10UAms4nCYVouL7hmLmKqCMrlQifYqK3rA9xrLi0WwKJKAh1ZS+kQeYGBapaQQwwvF4UvJsmkAiWTEcaTiRiYXg5oPx/nt9zyRZDoHCQnA2RdJUSQidwynV1/O3soCy2iCwIj2d9T1ofswDOr4guEogpyoP5JL7t5yxXEVITobpwqv/Y0bAAYX4iAVAr7M8NpgDHSwJObuLzd8mV5zZCOREKndWiELGcGHzbjlluZwe3dnc4EBIdvYi0X0iIRz0zXvV2HvTne7EyAKDINXEEIeTzE3brsnujyOTzsQheAcBl1wvvsjjvltF00DErBtW0NiQOxh0BsO+o2A32oEnndxrCCnnY104jMAkMDjCVrQQuJ4NoDbNjif7u4U5BQ3l7EZgDc4IKhDQAnN6OYAWgQ04nTaxe3qzwPoqx6yYygBtReauQCN4HZsd7s3H6DuzDlXBYTDHmyUPucfy6aXFtDINGQCoEJ3gMcRQDFuAYSbUQbq0z4CbDYzAXstMwFjQqjlmv/0376xy2aMm/G/8TzylTl++s/3v50TPy7yof+sAAAAAElFTkSuQmCC',
      minewall : 'data:image/png;base64,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',
      glacier  : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAwFBMVEUiIx5kmaMaJCA+j0NYZGUyUlovXS1eNg6Zpare4OJSlmNWeIOn9f8oOWEZEgz///8xPEKgvMY4VV49kDx5x+R/v78A//+DhHJxWzs/fz8/f78AAACc2u7x+/6h3O/W8/1irckBAABotdOr5fee5f0QCQYZFhACAQDJ6/ZeqccTCANCl0eIxts6ijo2R0oRBQILBQIoIxkrNTZZmLAbFxGMzOIRBgNQhZkZFA99wttKaXM8W2UZEgwmKCVuRRitsbWUNtv7AAAAQHRSTlMg/f3+/gn+/f7//vz9CbUB/v78//wEAf//BAQA/v7+/v5H/v7+9vo1//7Q/v7+/rRu/f79Uf6K/XH//f6V/f7/fM+yNAAABGJJREFUeNqllwl3qjoQxwNV69LetvfetwoBEhMREcS9Wuv3/1ZvJmxRY4vnzekpIvx/mSWTRDL83jZHh4+U8SR9uXhIvte3I+sp14+efEHuBvxJZFw4AHYc3+/BuIoAY7gfQKKsBowWdwPID/nYLXPAY3l3DkD/+TcvXHhqRX/cCfgA/efjnqMP/MkSq+F9gDnqPzORWCM+ilviY9gUQIJNGslMZjB+JsAWyUJGq2FDwCoVWTKw3tbOX4+PfauV2EJsxsZ3TV+SFFymnudx7vBWi8PlfZvA+C+NAO0P8dr1XGVeyB2Hwh8wloAgDQAkkhZHrZdDgKCMOr+thdh9CyDi+AbKwgO0sCRQx/8pPr7pRiKSNXfPjWMQCrFme/nj+SsAiaBxPNdE8MATvmZb+fEVIM3iUXiphyCow9V/GrPBRR7OADthcefKAZVI11WBUMYO52uKfvMs9lB41wQIi0xQh7FF1L4B2GSxGRBS1ysyCUEs5c4MaIsB+HoOyCsahi4tS+FgEG0jILDjKwDOpxD0YaWnsW/pLmiAtMVVul0DopRjFnx2iP41AAiWAF7wau9rglN5gIVYagtb/SnAFMJ74YUeATqBvk/YYm4AbBLlgDEGyCOvPFhP2CE1ADAFRkLZ2loStuL5CvASWbx4QQXR675pkFPXLSuBgKW89iDPIUVDQu90ElYp73V7oqWaSj1mbJKNr0OQrAoTghi87m27V0TQtVu2OFVrC/PZ4gYAF8J8KeoKOwfg3QluAODmT6l/A+ADoAq69yoxhALXEhhCYXRyC1DNNqdKYgFwTzC+Wzxcmz0gcqnWX5Umqs0hr5xSFB/mE8k/XgOeo2092Zy8lJ5XE8KyHykzl3GY7n/X8x0Inm7YTbScRziRiGkqM61jyoIURvVW8Nk+MjXTcfKudy0N9fHr6Bh48LoxtvNWc0ElNKzcr79GB5YyMC4oCWPauzSkRU3Ux6qTwIG9tqZpgJVcsrjeCnndPdVHLAHYcWNeVKOE+XWwWPii8k65v2EA6AAxL+sraZUE7MhqIVVLBN7wGPWTbHNjX2hHC5gkDtckJcFTvRyj/yw525rOtynxk038Nfrt1Zuyqil2AjwD/eD8pHa+ue7EnvkThiuC5+gVwYhU/ph1sT2Ty2PhFgkxr1aP/GwBhFiNv5Tp85cnlB9yACNN2HvRmPlMWANV6bfSJl8fceCIdWCI8BmL16r93+Ee1WBW1uD3wk4sloiAMZVsUoh95vd/da7OuoaD2yqSB0shdGO+NZ09TO2IfH/QbO+EPIAXrKTA1UL5w8N0JkmTo257HsnFYbvMvbcsqz+d/QL5tNNpBsAHczxs9/vTh850NlOjozzakcbH/fE4kFMQi84U1Q8dW6Srfxqd1kGamwJICfIZyE2nfROgVCOgjwDRmXWkSOfj8bgJQNMHEvY3W24kyIPcrTsBc2VwCcpv7wxhrCyochI0/MmjOxHouOGw8Y8uNfKZJ7fmy/B/2n/lLdWXDEzvzgAAAABJRU5ErkJggg=='
    },

    init: function(game) {
      const cv = game.canvas;
      this.cellW = Math.floor((cv.width - 20) / this.COLS);
      this.cellH = Math.floor((cv.height - this.TOP - 10) / this.ROWS);
      this.originX = Math.floor((cv.width - this.cellW * this.COLS) / 2);

      this.tier = Difficulty.pick(this.TIERS);
      this.grid = [];
      for (let r = 0; r < this.ROWS; r++) this.grid.push(new Array(this.COLS).fill(null));
      this.zombies = []; this.shots = []; this.suns = [];
      this.sun = this.tier.start;
      this.wave = 0;
      this.waveAt = 0; this.sunAt = 0; this.autoAt = 0;
      this.pick = 0;
      this.cursor = { c: 4, r: 2 };
      this.cool = {};
      this.over = false;
      this.flash = 0;
      // A mower is the lane's last word: it fires once, clears everything in that
      // lane, and is gone. They ARE the hearts, so the shell's counter is the
      // number of lanes still covered.
      this.mowers = [];
      for (let r = 0; r < this.ROWS; r++) this.mowers.push(r < this.tier.mowers ? true : false);
      this.lives = this.tier.mowers;
      this.maxLives = this.tier.mowers;
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

    affordable: function(i, now) {
      const s = this.SEEDS[i];
      return this.sun >= s.cost && (now - (this.cool[s.key] || -1e9)) >= s.cool;
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
        if (k >= '1' && k <= '5') { self.pick = Number(k) - 1; SFX.beep(520, 0.03, 'square', 0.05); return; }
        if (k === 'arrowleft'  || k === 'a') { self.cursor.c = Math.max(0, self.cursor.c - 1); e.preventDefault(); }
        else if (k === 'arrowright' || k === 'd') { self.cursor.c = Math.min(self.COLS - 1, self.cursor.c + 1); e.preventDefault(); }
        else if (k === 'arrowup'    || k === 'w') { self.cursor.r = Math.max(0, self.cursor.r - 1); e.preventDefault(); }
        else if (k === 'arrowdown'  || k === 's') { self.cursor.r = Math.min(self.ROWS - 1, self.cursor.r + 1); e.preventDefault(); }
        else if (k === ' ' || k === 'enter') { self.plant(self.cursor.c, self.cursor.r, now, game); e.preventDefault(); }
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
          const i = Math.floor(px / (game.canvas.width / self.SEEDS.length));
          if (i >= 0 && i < self.SEEDS.length) { self.pick = i; SFX.beep(520, 0.03, 'square', 0.05); }
          return;
        }
        const cell = self.cellAt(px, py);
        if (cell) { self.cursor = cell; self.plant(cell.c, cell.r, now, game); }
      };
      game.canvas.addEventListener('mousedown', this.clickHandler);
      game.canvas.addEventListener('touchstart', this.clickHandler, { passive: true });
    },

    unbind: function() {
      if (this.keyHandler) { document.removeEventListener('keydown', this.keyHandler); this.keyHandler = null; }
      const cv = GameSystem.canvas;
      if (this.clickHandler && cv) {
        cv.removeEventListener('mousedown', this.clickHandler);
        cv.removeEventListener('touchstart', this.clickHandler);
        this.clickHandler = null;
      }
    },

    spawnWave: function(now, game) {
      this.wave++;
      // Count rises with the wave; the mix hardens rather than just multiplying.
      const n = Math.min(7, 1 + Math.floor(this.wave * 0.45));
      for (let i = 0; i < n; i++) {
        const roll = Math.random();
        let kind = 'walker';
        if (this.wave >= 3 && roll < 0.22) kind = 'sprinter';
        else if (this.wave >= 5 && roll < 0.45) kind = 'armoured';
        const z = this.ZOMBIES[kind];
        this.zombies.push({
          kind: kind, art: z.art,
          hp: z.hp * this.tier.hp * (1 + this.wave * this.tier.ramp),
          maxHp: z.hp * this.tier.hp * (1 + this.wave * this.tier.ramp),
          speed: z.speed * this.tier.speed,
          dmg: z.dmg, score: z.score,
          r: Math.floor(Math.random() * this.ROWS),
          x: game.canvas.width + 20 + i * (40 + Math.random() * 70),
          slow: 0, hit: 0
        });
      }
      Fx.text(game.canvas.width / 2, this.TOP + 24, 'WAVE ' + this.wave, '#ff8f6b');
      SFX.levelUp();
    },

    update: function(game, ts) {
      if (this.over) return;
      const now = ts || performance.now();
      if (!this.waveAt) { this.waveAt = now + 2500; this.sunAt = now + 1200; }

      if (now >= this.waveAt) {
        // Clearing the board before the next wave is the win condition of a round,
        // so pay for it -- and pay more the deeper in you are.
        if (this.wave > 0 && !this.zombies.length) {
          const bonus = 50 * this.wave;
          game.updateScore(game.score + bonus);
          Fx.text(game.canvas.width / 2, this.TOP + 46, 'LINE HELD +' + bonus, '#7ede63');
          SFX.bonus();
        }
        this.spawnWave(now, game);
        this.waveAt = now + this.tier.waveMs;
      }

      // Sky sun, so a board with no sunflowers is still playable -- just poorer.
      if (now >= this.sunAt) {
        this.sunAt = now + this.tier.sunMs;
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
          } else if (f && f.shots) {                 // Repeater / Sunshot / Bulwark / Sleet
            const target = this.zombies.some(z => z.r === r && z.x > this.cx(c) - 10);
            if (target && now - p.fired > 820) {
              p.fired = now;
              for (let k = 0; k < f.shots; k++) {
                this.shots.push({ x: this.cx(c) + 14 - k * 16, y: this.cy(r) - 4, r: r,
                                  dmg: f.dmg, chill: !!f.chill,
                                  art: f.chill ? 'frostpea' : 'pea' });
              }
              SFX.beep(520, 0.03, 'square', 0.05);
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
        b.x += 5.2;
        if (b.x > game.canvas.width + 20) { this.shots.splice(i, 1); continue; }
        for (let j = 0; j < this.zombies.length; j++) {
          const z = this.zombies[j];
          if (z.r !== b.r || Math.abs(z.x - b.x) > 18) continue;
          z.hp -= b.dmg; z.hit = now;
          if (b.chill) z.slow = now + 3000;
          Fx.burst(b.x, b.y, b.chill ? '#9fe6ff' : '#7ede63', 5, 2);
          this.shots.splice(i, 1);
          break;
        }
      }

      // zombies
      for (let i = this.zombies.length - 1; i >= 0; i--) {
        const z = this.zombies[i];
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

      // 1. a lane about to be lost gets a wall, whatever else was planned
      for (let r = 0; r < this.ROWS; r++) {
        const near = this.zombies.filter(z => z.r === r && z.x < this.originX + this.cellW * 3);
        if (near.length && this.mowers[r]) {
          for (let c = 1; c < 4; c++) if (try_('wall', c, r)) return;
        }
      }
      // 2. a crowd in one lane is worth a bomb
      for (let r = 0; r < this.ROWS; r++) {
        const pack = this.zombies.filter(z => z.r === r && z.x < this.originX + this.cellW * 6);
        if (pack.length >= 3) {
          const c = Math.max(1, Math.min(this.COLS - 2,
            Math.floor((pack[0].x - this.originX) / this.cellW)));
          if (try_('bomb', c, r)) return;
        }
      }
      // 3. economy until it can sustain a shooter every wave, then guns
      if (count('sunflower') < 6) {
        for (let r = 0; r < this.ROWS; r++) if (try_('sunflower', 0, r)) return;
        for (let r = 0; r < this.ROWS; r++) if (try_('sunflower', 1, r)) return;
      }
      // 4. fuse what is already down before adding more of the same -- a Repeater
      //    in a held column beats a seventh lone shooter somewhere else.
      if (this.sun >= 220) {
        for (let r = 0; r < this.ROWS; r++) {
          for (let c = 2; c < this.COLS - 1; c++) {
            const have = this.grid[r][c];
            if (!have || have.fused) continue;
            for (const seed of ['shooter', 'wall', 'frost']) {
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

      // 5. shooters, front-loaded into the lanes that are actually threatened
      const threat = [];
      for (let r = 0; r < this.ROWS; r++) threat.push({ r: r, n: this.zombies.filter(z => z.r === r).length });
      threat.sort((a, b) => b.n - a.n);
      for (const t of threat) {
        for (let c = 2; c < this.COLS - 1; c++) {
          if (this.sun >= 175 && count('frost') < 3 && try_('frost', c, t.r)) return;
          if (try_('shooter', c, t.r)) return;
        }
      }
    },

    drawSprite: function(ctx, key, x, y, w, h) {
      const im = this.img[key];
      if (this.imgReady && im && im.complete && im.naturalWidth) {
        ctx.drawImage(im, x - w / 2, y - h / 2, w, h);
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
        ctx.fillStyle = (r % 2) ? '#243b1c' : '#2b4622';
        ctx.fillRect(this.originX, this.TOP + r * this.cellH, this.cellW * this.COLS, this.cellH);
        if (!this.mowers[r]) continue;
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(this.originX - 12, this.cy(r) - 7, 9, 14);
      }

      // shop strip
      ctx.fillStyle = '#161d2b';
      ctx.fillRect(0, 0, cv.width, this.TOP);
      const sw = cv.width / this.SEEDS.length;
      this.SEEDS.forEach((s, i) => {
        const x = i * sw, ready = this.affordable(i, now);
        ctx.fillStyle = (i === this.pick) ? '#22304a' : '#1b2333';
        ctx.fillRect(x + 3, 5, sw - 6, this.TOP - 12);
        ctx.strokeStyle = (i === this.pick) ? '#7ede63' : 'rgba(255,255,255,0.12)';
        ctx.lineWidth = (i === this.pick) ? 2 : 1;
        ctx.strokeRect(x + 3, 5, sw - 6, this.TOP - 12);
        ctx.globalAlpha = ready ? 1 : 0.35;
        this.drawSprite(ctx, s.art, x + sw / 2, 30, 34, 34);
        ctx.globalAlpha = 1;
        ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = ready ? '#ffd23f' : '#7d8797';
        ctx.fillText(s.cost, x + sw / 2, 58);
        ctx.fillStyle = '#8b95a7';
        ctx.font = '10px "Segoe UI", Arial, sans-serif';
        ctx.fillText((i + 1) + ' · ' + s.name, x + sw / 2, 70);
        const wait = s.cool - (now - (this.cool[s.key] || -1e9));
        if (wait > 0) {                                   // cooldown wipe
          ctx.fillStyle = 'rgba(10,14,22,0.62)';
          ctx.fillRect(x + 3, 5, sw - 6, (this.TOP - 12) * Math.min(1, wait / s.cool));
        }
      });

      // cursor
      ctx.strokeStyle = 'rgba(126,222,99,0.7)'; ctx.lineWidth = 2;
      ctx.strokeRect(this.originX + this.cursor.c * this.cellW + 2,
                     this.TOP + this.cursor.r * this.cellH + 2, this.cellW - 4, this.cellH - 4);

      // plants, with a health bar once they are actually hurt
      for (let r = 0; r < this.ROWS; r++) {
        for (let c = 0; c < this.COLS; c++) {
          const p = this.grid[r][c];
          if (!p) continue;
          this.drawSprite(ctx, p.art, this.cx(c), this.cy(r), this.cellW * 0.8, this.cellH * 0.8);
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
        this.drawSprite(ctx, z.art, z.x, this.cy(z.r), this.cellW * 0.78, this.cellH * 0.86);
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

      // readouts
      ctx.textAlign = 'left';
      ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#ffd23f';
      ctx.fillText('☀ ' + this.sun, 10, cv.height - 10);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#8b95a7';
      ctx.fillText('Wave ' + this.wave + ' · mowers ' + this.mowers.filter(Boolean).length, cv.width - 10, cv.height - 10);

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
