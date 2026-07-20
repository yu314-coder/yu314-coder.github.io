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
  // ===================================
  const GameSystem = {
    canvas: null,
    ctx: null,
    gameActive: false,
    currentGame: 'breakout',
    score: 0,
    games: {},
    restartHandlersBound: false,
    loopId: 0,
    shakeFrames: 0,
    shakeTotal: 1,
    shakeMag: 0,

    HINTS: {
      breakout: 'Arrows / mouse / drag — catch capsules: Wide · Multi-ball · Slow · ❤️',
      dino: 'Space/⬆️ jump · ⬇️ duck & dive — pterodactyls join at 150!',
      snake: 'Arrows / WASD / swipe — golden bonus every 5 foods (timed, +50)'
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
          document.getElementById('hidden-game').style.display = 'flex';
          this.refreshMeta();
        }
        if (event.key === 'Escape') {
          const g = document.getElementById('hidden-game');
          const a = document.getElementById('hidden-admin');
          if (g && g.style.display !== 'none' && g.style.display !== '') window.exitGame();
          if (a && a.style.display !== 'none' && a.style.display !== '') window.exitAdmin();
        }
      });
    },

    setupControls: function() {
      const gameSelect = document.getElementById('gameSelect');
      if (gameSelect) {
        gameSelect.addEventListener('change', (e) => {
          this.currentGame = e.target.value;
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

    setupPointer: function() {
      const canvas = this.canvas;
      const pos = (clientX) => {
        const rect = canvas.getBoundingClientRect();
        return (clientX - rect.left) * (canvas.width / rect.width);
      };

      canvas.addEventListener('mousemove', (e) => {
        if (!this.gameActive) return;
        const game = this.games[this.currentGame];
        if (game.onPointerMove) game.onPointerMove(pos(e.clientX), this);
      });

      canvas.addEventListener('touchmove', (e) => {
        if (!this.gameActive) return;
        const game = this.games[this.currentGame];
        if (game.onPointerMove) {
          e.preventDefault();
          game.onPointerMove(pos(e.touches[0].clientX), this);
        }
      }, { passive: false });

      const tap = () => {
        if (!this.gameActive) return;
        const game = this.games[this.currentGame];
        if (game.onTap) game.onTap(this);
      };
      canvas.addEventListener('mousedown', tap);
      canvas.addEventListener('touchstart', (e) => {
        if (!this.gameActive) return;
        const game = this.games[this.currentGame];
        if (game.onSwipeStart) game.onSwipeStart(e.touches[0].clientX, e.touches[0].clientY);
        tap();
      }, { passive: true });
      canvas.addEventListener('touchend', (e) => {
        if (!this.gameActive) return;
        const game = this.games[this.currentGame];
        if (game.onSwipeEnd && e.changedTouches.length) {
          game.onSwipeEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
        }
      }, { passive: true });
    },

    refreshMeta: function() {
      const hintEl = document.getElementById('gameHint');
      if (hintEl) hintEl.textContent = this.HINTS[this.currentGame] || '';
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
      this.gameActive = true;
      this.score = 0;
      this.shakeFrames = 0;
      Fx.reset();

      const game = this.games[this.currentGame];
      if (game) game.init(this);

      this.refreshMeta();
      this.loopId++;
      this.gameLoop(this.loopId);
    },

    gameLoop: function(id, ts) {
      if (!this.gameActive || id !== this.loopId) return;

      const game = this.games[this.currentGame];
      if (game) {
        if (game.update) game.update(this, ts || performance.now());
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
      }

      requestAnimationFrame((t) => this.gameLoop(id, t));
    },

    showGameOver: function(message) {
      this.gameActive = false;
      const ctx = this.ctx;
      const canvas = this.canvas;
      const isRecord = HighScores.submit(this.currentGame, this.score);
      this.updateScore(this.score);

      if (isRecord && this.score > 0) SFX.highScore(); else SFX.gameOver();

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
      ctx.fillText('Space · Click · Tap to restart', canvas.width / 2, canvas.height / 2 + 70);
      ctx.restore();

      if (!this.restartHandlersBound) {
        this.restartHandlersBound = true;
        const tryRestart = () => {
          const overlay = document.getElementById('hidden-game');
          const visible = overlay && overlay.style.display !== 'none' && overlay.style.display !== '';
          if (visible && !this.gameActive) this.startGame();
        };
        this.canvas.addEventListener('click', tryRestart);
        this.canvas.addEventListener('touchstart', tryRestart, { passive: true });
        document.addEventListener('keydown', (e) => {
          if (e.code === 'Space') tryRestart();
        });
      }
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
  // Breakout — power-ups, multi-ball, combos, 2-hit bricks, levels
  // ===================================
  const Breakout = {
    balls: [],
    paddle: null,
    bricks: [],
    powerups: [],
    rightPressed: false,
    leftPressed: false,
    lives: 3,
    level: 1,
    speed: 4,
    combo: 0,
    levelFlash: 0,
    effects: { wideUntil: 0, slowUntil: 0 },
    BASE_W: 90,
    WIDE_W: 150,
    keyDownHandler: null,
    keyUpHandler: null,
    config: {
      brickRowCount: 5,
      brickColumnCount: 7,
      brickWidth: 75,
      brickHeight: 20,
      brickPadding: 10,
      brickOffsetTop: 40,
      brickOffsetLeft: 30
    },

    init: function(game) {
      this.lives = 3;
      this.level = 1;
      this.speed = 4;
      this.combo = 0;
      this.powerups = [];
      this.effects = { wideUntil: 0, slowUntil: 0 };
      game.updateScore(0);
      this.paddle = {
        width: this.BASE_W,
        height: 12,
        x: (game.canvas.width - this.BASE_W) / 2,
        color: '#22d3ee',
        speed: 8
      };
      this.buildLevel();
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

    buildLevel: function() {
      // Top rows become 2-hit bricks as levels climb (max 3 hardened rows)
      const hardRows = Math.min(Math.max(this.level - 1, 0), 3);
      this.bricks = [];
      for (let c = 0; c < this.config.brickColumnCount; c++) {
        this.bricks[c] = [];
        for (let r = 0; r < this.config.brickRowCount; r++) {
          this.bricks[c][r] = { x: 0, y: 0, hp: r < hardRows ? 2 : 1 };
        }
      }
      this.levelFlash = 90;
    },

    newBall: function(x, y, dx, dy) {
      return { x: x, y: y, dx: dx, dy: dy, radius: 10, color: '#ec4899' };
    },

    resetBalls: function(canvas) {
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

    bricksLeft: function() {
      let n = 0;
      for (let c = 0; c < this.config.brickColumnCount; c++)
        for (let r = 0; r < this.config.brickRowCount; r++)
          if (this.bricks[c][r].hp > 0) n++;
      return n;
    },

    maybeDropPowerup: function(x, y) {
      if (Math.random() > 0.18) return;
      const roll = Math.random();
      let type;
      if (roll < 0.32) type = 'W';        // wide paddle
      else if (roll < 0.62) type = 'S';   // slow ball
      else if (roll < 0.88) type = 'M';   // multi-ball
      else type = 'H';                    // extra life
      this.powerups.push({ x: x, y: y, w: 36, h: 17, vy: 2.3, type: type });
    },

    applyPowerup: function(p, game) {
      const now = performance.now();
      SFX.powerup();
      Fx.burst(p.x + p.w / 2, p.y, '#fbbf24', 14, 3);
      if (p.type === 'W') {
        this.effects.wideUntil = now + 12000;
        Fx.text(p.x + p.w / 2, p.y - 6, 'WIDE!', '#22d3ee');
      } else if (p.type === 'S') {
        this.effects.slowUntil = now + 8000;
        Fx.text(p.x + p.w / 2, p.y - 6, 'SLOW', '#fbbf24');
      } else if (p.type === 'M') {
        const src = this.balls[0] || this.newBall(p.x, p.y - 40, 2, -this.speed);
        const v = Math.hypot(src.dx, src.dy) || this.speed;
        this.balls.push(this.newBall(src.x, src.y, v * 0.6, -Math.abs(v * 0.8)));
        this.balls.push(this.newBall(src.x, src.y, -v * 0.6, -Math.abs(v * 0.8)));
        if (this.balls.length > 7) this.balls.length = 7;
        Fx.text(p.x + p.w / 2, p.y - 6, 'MULTI!', '#a855f7');
      } else if (p.type === 'H') {
        if (this.lives < 5) this.lives++;
        Fx.text(p.x + p.w / 2, p.y - 6, '+1 ❤️', '#ec4899');
      }
    },

    draw: function(game) {
      const ctx = game.ctx;
      const canvas = game.canvas;
      const now = performance.now();

      // Animate paddle width toward its target
      const targetW = this.effects.wideUntil > now ? this.WIDE_W : this.BASE_W;
      if (Math.abs(this.paddle.width - targetW) > 1) {
        const cx = this.paddle.x + this.paddle.width / 2;
        this.paddle.width += (targetW - this.paddle.width) * 0.2;
        this.paddle.x = Math.max(0, Math.min(canvas.width - this.paddle.width, cx - this.paddle.width / 2));
      }

      this.drawBricks(ctx);
      this.drawBalls(ctx, now);
      this.drawPaddle(ctx, canvas, now);
      this.drawPowerups(ctx, canvas, game);
      this.drawHud(ctx, canvas, now);
      this.collisionDetection(game);
      this.moveBalls(canvas, game, now);
      this.movePaddle(canvas);
    },

    drawHud: function(ctx, canvas, now) {
      ctx.font = '16px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#a5b4fc';
      let hud = `Level ${this.level}`;
      if (this.effects.slowUntil > now) hud += ' · 🐢';
      ctx.fillText(hud, 12, 24);
      ctx.textAlign = 'right';
      ctx.fillText('❤️'.repeat(Math.max(0, this.lives)), canvas.width - 12, 24);

      if (this.combo >= 3) {
        ctx.textAlign = 'center';
        ctx.font = 'bold 17px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(`COMBO ×${this.combo}`, canvas.width / 2, 24);
      }

      if (this.levelFlash > 0) {
        this.levelFlash--;
        ctx.globalAlpha = Math.min(1, this.levelFlash / 30);
        ctx.textAlign = 'center';
        ctx.font = 'bold 40px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#a855f7';
        ctx.fillText(`LEVEL ${this.level}`, canvas.width / 2, canvas.height / 2);
        ctx.globalAlpha = 1;
      }
    },

    drawBricks: function(ctx) {
      const colors = ['#ec4899', '#a855f7', '#7c3aed', '#06b6d4', '#22d3ee'];
      for (let c = 0; c < this.config.brickColumnCount; c++) {
        for (let r = 0; r < this.config.brickRowCount; r++) {
          const b = this.bricks[c][r];
          if (b.hp > 0) {
            const brickX = (c * (this.config.brickWidth + this.config.brickPadding)) + this.config.brickOffsetLeft;
            const brickY = (r * (this.config.brickHeight + this.config.brickPadding)) + this.config.brickOffsetTop;
            b.x = brickX;
            b.y = brickY;

            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(brickX, brickY, this.config.brickWidth, this.config.brickHeight, 4) : ctx.rect(brickX, brickY, this.config.brickWidth, this.config.brickHeight);
            ctx.fillStyle = colors[r % colors.length];
            ctx.fill();
            if (b.hp >= 2) {
              // Hardened brick: darker veil + rivet dots
              ctx.fillStyle = 'rgba(0,0,0,0.35)';
              ctx.fill();
              ctx.fillStyle = 'rgba(255,255,255,0.5)';
              ctx.fillRect(brickX + 6, brickY + this.config.brickHeight / 2 - 1.5, 3, 3);
              ctx.fillRect(brickX + this.config.brickWidth - 9, brickY + this.config.brickHeight / 2 - 1.5, 3, 3);
            }
            ctx.closePath();
          }
        }
      }
    },

    drawBalls: function(ctx, now) {
      const slow = this.effects.slowUntil > now;
      this.balls.forEach(ball => {
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
        const gradient = ctx.createRadialGradient(ball.x - 2, ball.y - 2, 2, ball.x, ball.y, ball.radius);
        gradient.addColorStop(0, '#fff');
        gradient.addColorStop(1, slow ? '#fbbf24' : ball.color);
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
      ctx.fillStyle = this.effects.wideUntil > now ? '#67e8f9' : this.paddle.color;
      ctx.fill();
      ctx.closePath();
    },

    drawPowerups: function(ctx, canvas, game) {
      const labels = { W: 'W', S: 'S', M: 'M', H: '♥' };
      const colors = { W: '#22d3ee', S: '#fbbf24', M: '#a855f7', H: '#ec4899' };
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

        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(p.x, p.y, p.w, p.h, 8) : ctx.rect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = colors[p.type];
        ctx.fill();
        ctx.closePath();
        ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#0a0820';
        ctx.fillText(labels[p.type], p.x + p.w / 2, p.y + p.h - 4.5);
      }
    },

    collisionDetection: function(game) {
      for (let c = 0; c < this.config.brickColumnCount; c++) {
        for (let r = 0; r < this.config.brickRowCount; r++) {
          const b = this.bricks[c][r];
          if (b.hp <= 0) continue;
          for (const ball of this.balls) {
            if (ball.x > b.x && ball.x < b.x + this.config.brickWidth &&
                ball.y > b.y && ball.y < b.y + this.config.brickHeight) {
              ball.dy = -ball.dy;
              b.hp--;
              const colors = ['#ec4899', '#a855f7', '#7c3aed', '#06b6d4', '#22d3ee'];
              const color = colors[r % colors.length];

              if (b.hp <= 0) {
                this.combo++;
                const pts = 10 + (this.combo - 1) * 5;
                game.updateScore(game.score + pts);
                SFX.brick(this.combo);
                Fx.burst(ball.x, b.y + this.config.brickHeight / 2, color, 12);
                if (this.combo >= 2) Fx.text(b.x + this.config.brickWidth / 2, b.y, `+${pts}`, '#fbbf24');
                this.maybeDropPowerup(b.x + this.config.brickWidth / 2 - 18, b.y);
              } else {
                SFX.beep(240, 0.05, 'square', 0.09);
                Fx.burst(ball.x, b.y + this.config.brickHeight, 'rgba(255,255,255,0.7)', 5, 1.6);
              }

              if (this.bricksLeft() === 0) {
                this.level++;
                this.speed = Math.min(this.speed * 1.18, 11);
                SFX.levelUp();
                this.buildLevel();
                this.resetBalls(game.canvas);
                this.powerups = [];
                return;
              }
              break; // this brick is done for this frame
            }
          }
        }
      }
    },

    moveBalls: function(canvas, game, now) {
      const factor = this.effects.slowUntil > now ? 0.55 : 1;
      const paddleTop = canvas.height - this.paddle.height - 4;

      for (let i = this.balls.length - 1; i >= 0; i--) {
        const ball = this.balls[i];
        const dx = ball.dx * factor;
        const dy = ball.dy * factor;

        if (ball.x + dx > canvas.width - ball.radius || ball.x + dx < ball.radius) {
          ball.dx = -ball.dx;
        }

        if (ball.y + dy < ball.radius) {
          ball.dy = -ball.dy;
        } else if (ball.dy > 0 &&
                   ball.y + dy > paddleTop - ball.radius &&
                   ball.y < paddleTop) {
          if (ball.x > this.paddle.x - ball.radius &&
              ball.x < this.paddle.x + this.paddle.width + ball.radius) {
            const hit = (ball.x - (this.paddle.x + this.paddle.width / 2)) / (this.paddle.width / 2);
            const angle = hit * (Math.PI / 3);
            const v = Math.hypot(ball.dx, ball.dy);
            ball.dx = v * Math.sin(angle);
            ball.dy = -Math.abs(v * Math.cos(angle));
            this.combo = 0;
            SFX.paddle();
            Fx.burst(ball.x, paddleTop, '#22d3ee', 4, 1.4);
          }
        } else if (ball.y + dy > canvas.height - ball.radius) {
          this.balls.splice(i, 1);
          continue;
        }

        ball.x += ball.dx * factor;
        ball.y += ball.dy * factor;
      }

      if (this.balls.length === 0) {
        this.lives--;
        this.combo = 0;
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
    }
  };

  // ===================================
  // Dino — duck & dive, pterodactyls, day/night, milestones
  // ===================================
  const DinoGame = {
    dino: null,
    obstacles: [],
    clouds: [],
    stars: [],
    distance: 0,
    speed: 5,
    spawnGap: 0,
    night: 0,
    lastMilestone: 0,
    ducking: false,
    downPressed: false,
    wasOnGround: true,
    keyDownH: null,
    keyUpH: null,
    STAND_H: 44,
    DUCK_H: 24,

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
      this.speed = 5;
      this.spawnGap = 90;
      this.night = 0;
      this.lastMilestone = 0;
      this.ducking = false;
      this.downPressed = false;
      this.wasOnGround = true;
      game.updateScore(0);

      if (this.keyDownH) document.removeEventListener('keydown', this.keyDownH);
      if (this.keyUpH) document.removeEventListener('keyup', this.keyUpH);
      this.keyDownH = (e) => {
        if (e.key === ' ' || e.key === 'ArrowUp') this.doJump();
        if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') this.downPressed = true;
      };
      this.keyUpH = (e) => {
        if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') this.downPressed = false;
      };
      document.addEventListener('keydown', this.keyDownH);
      document.addEventListener('keyup', this.keyUpH);
    },

    doJump: function() {
      if (this.dino.onGround && !this.ducking) {
        this.dino.dy = this.dino.jumpForce;
        this.dino.onGround = false;
        SFX.jump();
      }
    },

    onTap: function() { this.doJump(); },

    spawnObstacle: function(canvas) {
      const groundY = canvas.height - 20;
      const allowPtero = this.distance > 150;
      const roll = Math.random();

      if (allowPtero && roll < 0.32) {
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
        if (type < 0.45)      { w = 20; h = 45; }
        else if (type < 0.75) { w = 42; h = 45; }
        else                  { w = 22; h = 65; }
        this.obstacles.push({
          x: canvas.width + 10,
          y: groundY - h,
          width: w,
          height: h,
          color: '#ec4899'
        });
      }
      const minGap = Math.max(46, 95 - this.speed * 4);
      this.spawnGap = minGap + Math.random() * 70;
    },

    update: function(game) {
      const canvas = game.canvas;
      const groundLine = canvas.height - 20;

      // Duck state (only meaningful on the ground)
      const wantDuck = this.downPressed && this.dino.onGround;
      if (wantDuck && !this.ducking) { this.ducking = true; SFX.duck(); }
      if (!wantDuck && this.ducking) this.ducking = false;
      this.dino.height = this.ducking ? this.DUCK_H : this.STAND_H;

      // Physics (+ fast-fall when holding down mid-air)
      if (!this.dino.onGround && this.downPressed) this.dino.dy += 1.3;
      this.dino.y += this.dino.dy;
      const groundY = groundLine - this.dino.height;
      if (this.dino.y < groundY) {
        this.dino.dy += this.dino.gravity;
        this.dino.onGround = false;
      } else {
        this.dino.y = groundY;
        this.dino.dy = 0;
        if (!this.wasOnGround) {
          Fx.burst(this.dino.x + this.dino.width / 2, groundLine - 2, 'rgba(180,180,200,0.8)', 6, 1.8);
        }
        this.dino.onGround = true;
      }
      this.wasOnGround = this.dino.onGround;

      // Distance score + speed ramp
      this.distance += this.speed / 10;
      const score = Math.floor(this.distance);
      if (score !== game.score) game.updateScore(score);
      this.speed = Math.min(5 + this.distance / 180, 13);

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

      // Obstacles
      this.spawnGap -= this.speed / 4;
      if (this.spawnGap <= 0) this.spawnObstacle(canvas);

      for (let i = this.obstacles.length - 1; i >= 0; i--) {
        const o = this.obstacles[i];
        o.x -= this.speed * (o.ptero ? 1.15 : 1);
        if (o.ptero) o.flap++;
        if (o.x + o.width < 0) { this.obstacles.splice(i, 1); continue; }

        if (this.dino.x + 6 < o.x + o.width &&
            this.dino.x + this.dino.width - 6 > o.x &&
            this.dino.y + 6 < o.y + o.height &&
            this.dino.y + this.dino.height - 4 > o.y) {
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
    }
  };

  // ===================================
  // Snake — golden bonus food, eyes, popups, grid
  // ===================================
  const SnakeGame = {
    CELL: 20,
    cols: 0,
    rows: 0,
    snake: [],
    dir: { x: 1, y: 0 },
    nextDir: { x: 1, y: 0 },
    food: null,
    bonus: null,
    foodsEaten: 0,
    tickMs: 110,
    lastTick: 0,
    keyHandler: null,
    swipeStart: null,

    init: function(game) {
      const canvas = game.canvas;
      this.cols = Math.floor(canvas.width / this.CELL);
      this.rows = Math.floor(canvas.height / this.CELL);
      const cx = Math.floor(this.cols / 2);
      const cy = Math.floor(this.rows / 2);
      this.snake = [ { x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy } ];
      this.dir = { x: 1, y: 0 };
      this.nextDir = { x: 1, y: 0 };
      this.tickMs = 110;
      this.lastTick = 0;
      this.bonus = null;
      this.foodsEaten = 0;
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

      if (ts - this.lastTick < this.tickMs) return;
      this.lastTick = ts;

      this.dir = this.nextDir;
      const head = { x: this.snake[0].x + this.dir.x, y: this.snake[0].y + this.dir.y };

      if (head.x < 0 || head.x >= this.cols || head.y < 0 || head.y >= this.rows ||
          this.snake.some(s => s.x === head.x && s.y === head.y)) {
        game.shake(7, 14);
        game.showGameOver('Game Over');
        return;
      }

      this.snake.unshift(head);

      const C = this.CELL;
      if (head.x === this.food.x && head.y === this.food.y) {
        game.updateScore(game.score + 10);
        this.foodsEaten++;
        SFX.eat(this.snake.length);
        Fx.burst(head.x * C + C / 2, head.y * C + C / 2, '#ec4899', 9, 2.2);
        Fx.text(head.x * C + C / 2, head.y * C - 4, '+10', '#ec4899');
        this.tickMs = Math.max(60, this.tickMs - 2);
        this.placeFood();

        // Every 5 foods → timed golden bonus
        if (this.foodsEaten % 5 === 0 && !this.bonus) {
          const spot = this.freeCell();
          this.bonus = { x: spot.x, y: spot.y, expiresAt: ts + 5200, born: ts };
        }
      } else if (this.bonus && head.x === this.bonus.x && head.y === this.bonus.y) {
        game.updateScore(game.score + 50);
        SFX.bonus();
        Fx.burst(head.x * C + C / 2, head.y * C + C / 2, '#fbbf24', 16, 3);
        Fx.text(head.x * C + C / 2, head.y * C - 4, '+50', '#fbbf24');
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

      // Food
      ctx.beginPath();
      ctx.arc(this.food.x * C + C / 2, this.food.y * C + C / 2, C / 2 - 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ec4899';
      ctx.fill();

      // Golden bonus: blink + countdown ring
      if (this.bonus) {
        const bx = this.bonus.x * C + C / 2;
        const by = this.bonus.y * C + C / 2;
        const frac = Math.max(0, (this.bonus.expiresAt - now) / 5200);
        const blink = 0.55 + 0.45 * Math.sin(now / 110);
        ctx.globalAlpha = blink;
        ctx.beginPath();
        ctx.arc(bx, by, C / 2 - 2, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(bx, by, C / 2 + 2.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        ctx.strokeStyle = '#fbbf24';
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
        '%c🎮 Secret Arcade %c\n\nThere are hidden pages on this site…\n  · type %ceaster%c anywhere for the arcade (Breakout · Dino · Snake)\n  · type %cadmin%c for the visitor panel\n  · Esc closes them\n',
        'font-size:18px; font-weight:bold; background:linear-gradient(90deg,#22d3ee,#a855f7,#ec4899); -webkit-background-clip:text; color:transparent;',
        'color:#94a3b8; font-size:12px;',
        'color:#22d3ee; font-weight:bold; font-size:12px;',
        'color:#94a3b8; font-size:12px;',
        'color:#22d3ee; font-weight:bold; font-size:12px;',
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

  /* ---------------------------------------------------------------------------
     Unlisted watchlist trigger — double-tap the hero avatar (the round spiral
     canvas). A <canvas> has no text, so a double-tap cannot turn into a word
     selection the way it did on the device chip; touch-action:manipulation stops
     Safari's double-tap zoom, and the callout is suppressed so a stray long-press
     doesn't offer "Save Image".
     The canvas already bursts particles on tap, so the first tap gives its own
     feedback. There is also a gesture-free way in: /#w
     ------------------------------------------------------------------------- */
  (function () {
    function init() {
      var art = document.querySelector('.hero-flow') || document.querySelector('.hero-art');
      if (!art) return;
      art.style.touchAction = 'manipulation';
      art.style.webkitUserSelect = 'none';
      art.style.userSelect = 'none';
      art.style.webkitTouchCallout = 'none';

      function open(e) {
        if (e && e.cancelable) e.preventDefault();
        if (typeof window.__sxOpen === 'function') window.__sxOpen();
      }
      art.addEventListener('dblclick', function (e) { open(e); });

      // iOS fires dblclick unreliably, so pair the taps ourselves: 600 ms apart,
      // within 70 px (a finger on a 360 px circle is imprecise).
      var last = 0, lx = 0, ly = 0;
      art.addEventListener('touchend', function (e) {
        var t = (e.changedTouches && e.changedTouches[0]) || {};
        var x = t.clientX || 0, y = t.clientY || 0, now = Date.now();
        if (now - last < 600 && Math.abs(x - lx) < 70 && Math.abs(y - ly) < 70) {
          last = 0; open(e); return;
        }
        last = now; lx = x; ly = y;
      }, { passive: false });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  })();
