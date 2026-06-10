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
      // Use a privacy-friendly approach with Cloudflare trace API
      // This is more reliable than ipify and works with GitHub Pages
      fetch('https://www.cloudflare.com/cdn-cgi/trace')
        .then(response => response.text())
        .then(data => {
          const ipMatch = data.match(/ip=([^\n]+)/);
          const ip = ipMatch ? ipMatch[1] : 'Unavailable';
          const now = new Date().toLocaleString();
          this.saveVisitLog(ip, now);
        })
        .catch(() => {
          // Fallback: just record timestamp without IP
          const now = new Date().toLocaleString();
          this.saveVisitLog('Privacy Protected', now);
        });
    },

    saveVisitLog: function(ip, time) {
      try {
        let logs = JSON.parse(localStorage.getItem('visitLogs') || '[]');
        logs.push({ ip: ip, time: time });
        // Keep only last 100 visits to prevent localStorage overflow
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

    // Returns true when score is a new record
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

    HINTS: {
      breakout: '⬅️➡️ arrows, mouse, or drag — 3 lives, clear the wall to level up',
      dino: 'Space / ⬆️ / tap to jump — survive as the speed ramps up',
      snake: 'Arrows / WASD / swipe — eat the food, don\'t bite yourself'
    },

    init: function() {
      this.canvas = document.getElementById('gameCanvas');
      if (!this.canvas) return;

      this.ctx = this.canvas.getContext('2d');
      this.games = { breakout: Breakout, dino: DinoGame, snake: SnakeGame };
      this.setupGameSequence();
      this.setupControls();
      this.setupPointer();
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
        // Escape closes whichever overlay is open
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

    // Shared pointer plumbing — each game opts into what it needs
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

      const tap = (e) => {
        if (!this.gameActive) return;
        const game = this.games[this.currentGame];
        if (game.onTap) game.onTap(this);
      };
      canvas.addEventListener('mousedown', tap);
      canvas.addEventListener('touchstart', (e) => {
        if (!this.gameActive) return;
        const game = this.games[this.currentGame];
        if (game.onSwipeStart) game.onSwipeStart(e.touches[0].clientX, e.touches[0].clientY);
        tap(e);
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

    startGame: function() {
      const select = document.getElementById('gameSelect');
      this.currentGame = select ? select.value : 'breakout';
      this.gameActive = true;
      this.score = 0;

      const game = this.games[this.currentGame];
      if (game) game.init(this);

      this.refreshMeta();
      // Generation token: restarting mid-game must orphan the old rAF chain
      this.loopId = (this.loopId || 0) + 1;
      this.gameLoop(this.loopId);
    },

    gameLoop: function(id, ts) {
      if (!this.gameActive || id !== this.loopId) return;

      const game = this.games[this.currentGame];
      if (game) {
        if (game.update) game.update(this, ts || performance.now());
        // update() may have ended the game — don't let draw() erase the game-over screen
        if (!this.gameActive) return;
        game.draw(this);
      }

      requestAnimationFrame((t) => this.gameLoop(id, t));
    },

    showGameOver: function(message) {
      this.gameActive = false;
      const ctx = this.ctx;
      const canvas = this.canvas;
      const isRecord = HighScores.submit(this.currentGame, this.score);
      this.updateScore(this.score);

      // Overlay
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

      // Restart handlers (deduped — bound once)
      if (!this.restartHandlersBound) {
        this.restartHandlersBound = true;
        const tryRestart = () => {
          const overlay = document.getElementById('hidden-game');
          const visible = overlay && overlay.style.display !== 'none' && overlay.style.display !== '';
          if (visible && !this.gameActive) this.startGame();
        };
        canvas.addEventListener('click', tryRestart);
        canvas.addEventListener('touchstart', tryRestart, { passive: true });
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
  // Breakout — lives, levels, angled bounces, pointer control
  // ===================================
  const Breakout = {
    ball: null,
    paddle: null,
    bricks: [],
    rightPressed: false,
    leftPressed: false,
    lives: 3,
    level: 1,
    speed: 4,
    levelFlash: 0,
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
      game.updateScore(0);
      this.buildLevel(game);
      this.resetBall(game.canvas);

      this.rightPressed = false;
      this.leftPressed = false;

      if (this.keyDownHandler) document.removeEventListener('keydown', this.keyDownHandler);
      if (this.keyUpHandler) document.removeEventListener('keyup', this.keyUpHandler);
      this.keyDownHandler = (e) => this.keyDown(e);
      this.keyUpHandler = (e) => this.keyUp(e);
      document.addEventListener('keydown', this.keyDownHandler);
      document.addEventListener('keyup', this.keyUpHandler);
    },

    buildLevel: function(game) {
      this.bricks = [];
      for (let c = 0; c < this.config.brickColumnCount; c++) {
        this.bricks[c] = [];
        for (let r = 0; r < this.config.brickRowCount; r++) {
          this.bricks[c][r] = { x: 0, y: 0, status: 1 };
        }
      }
      this.levelFlash = 90; // frames of "LEVEL n" banner
    },

    resetBall: function(canvas) {
      this.ball = {
        x: canvas.width / 2,
        y: canvas.height - 60,
        radius: 10,
        dx: this.speed * (Math.random() < 0.5 ? 1 : -1) * 0.7,
        dy: -this.speed,
        color: '#ec4899'
      };
      this.paddle = this.paddle || {};
      this.paddle.width = 90;
      this.paddle.height = 12;
      this.paddle.x = (canvas.width - 90) / 2;
      this.paddle.color = '#22d3ee';
      this.paddle.speed = 8;
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
          if (this.bricks[c][r].status === 1) n++;
      return n;
    },

    draw: function(game) {
      const ctx = game.ctx;
      const canvas = game.canvas;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.drawBricks(ctx);
      this.drawBall(ctx);
      this.drawPaddle(ctx, canvas);
      this.drawHud(ctx, canvas);
      this.collisionDetection(game);
      this.moveBall(canvas, game);
      this.movePaddle(canvas);
    },

    drawHud: function(ctx, canvas) {
      ctx.font = '16px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#a5b4fc';
      ctx.fillText(`Level ${this.level}`, 12, 24);
      ctx.textAlign = 'right';
      ctx.fillText('❤️'.repeat(Math.max(0, this.lives)), canvas.width - 12, 24);

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
          if (this.bricks[c][r].status === 1) {
            const brickX = (c * (this.config.brickWidth + this.config.brickPadding)) + this.config.brickOffsetLeft;
            const brickY = (r * (this.config.brickHeight + this.config.brickPadding)) + this.config.brickOffsetTop;
            this.bricks[c][r].x = brickX;
            this.bricks[c][r].y = brickY;

            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(brickX, brickY, this.config.brickWidth, this.config.brickHeight, 4) : ctx.rect(brickX, brickY, this.config.brickWidth, this.config.brickHeight);
            ctx.fillStyle = colors[r % colors.length];
            ctx.fill();
            ctx.closePath();
          }
        }
      }
    },

    drawBall: function(ctx) {
      ctx.beginPath();
      ctx.arc(this.ball.x, this.ball.y, this.ball.radius, 0, Math.PI * 2);
      const gradient = ctx.createRadialGradient(this.ball.x - 2, this.ball.y - 2, 2, this.ball.x, this.ball.y, this.ball.radius);
      gradient.addColorStop(0, '#fff');
      gradient.addColorStop(1, this.ball.color);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.closePath();
    },

    drawPaddle: function(ctx, canvas) {
      ctx.beginPath();
      const pX = this.paddle.x;
      const pY = canvas.height - this.paddle.height - 4;
      ctx.roundRect ? ctx.roundRect(pX, pY, this.paddle.width, this.paddle.height, 6) : ctx.rect(pX, pY, this.paddle.width, this.paddle.height);
      ctx.fillStyle = this.paddle.color;
      ctx.fill();
      ctx.closePath();
    },

    collisionDetection: function(game) {
      for (let c = 0; c < this.config.brickColumnCount; c++) {
        for (let r = 0; r < this.config.brickRowCount; r++) {
          const b = this.bricks[c][r];
          if (b.status === 1) {
            if (this.ball.x > b.x && this.ball.x < b.x + this.config.brickWidth &&
                this.ball.y > b.y && this.ball.y < b.y + this.config.brickHeight) {
              this.ball.dy = -this.ball.dy;
              b.status = 0;
              game.updateScore(game.score + 10);

              if (this.bricksLeft() === 0) {
                // Next level: rebuild wall, faster ball
                this.level++;
                this.speed = Math.min(this.speed * 1.18, 11);
                this.buildLevel(game);
                this.resetBall(game.canvas);
              }
            }
          }
        }
      }
    },

    moveBall: function(canvas, game) {
      if (this.ball.x + this.ball.dx > canvas.width - this.ball.radius ||
          this.ball.x + this.ball.dx < this.ball.radius) {
        this.ball.dx = -this.ball.dx;
      }

      const paddleTop = canvas.height - this.paddle.height - 4;
      if (this.ball.y + this.ball.dy < this.ball.radius) {
        this.ball.dy = -this.ball.dy;
      } else if (this.ball.dy > 0 &&
                 this.ball.y + this.ball.dy > paddleTop - this.ball.radius &&
                 this.ball.y < paddleTop) {
        if (this.ball.x > this.paddle.x - this.ball.radius &&
            this.ball.x < this.paddle.x + this.paddle.width + this.ball.radius) {
          // Bounce angle depends on where the ball hits the paddle
          const hit = (this.ball.x - (this.paddle.x + this.paddle.width / 2)) / (this.paddle.width / 2);
          const angle = hit * (Math.PI / 3); // up to 60°
          const v = Math.hypot(this.ball.dx, this.ball.dy);
          this.ball.dx = v * Math.sin(angle);
          this.ball.dy = -Math.abs(v * Math.cos(angle));
        }
      } else if (this.ball.y + this.ball.dy > canvas.height - this.ball.radius) {
        this.lives--;
        if (this.lives <= 0) {
          game.showGameOver('Game Over');
          return;
        }
        this.resetBall(canvas);
        return;
      }

      this.ball.x += this.ball.dx;
      this.ball.y += this.ball.dy;
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
  // Dino — distance score, speed ramp, varied obstacles, clouds
  // ===================================
  const DinoGame = {
    dino: null,
    obstacles: [],
    clouds: [],
    distance: 0,
    speed: 5,
    spawnGap: 0,
    jumpHandler: null,

    init: function(game) {
      const canvas = game.canvas;
      this.dino = {
        x: 60,
        y: canvas.height - 70,
        width: 40,
        height: 44,
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
      this.distance = 0;
      this.speed = 5;
      this.spawnGap = 90;
      game.updateScore(0);

      if (this.jumpHandler) document.removeEventListener('keydown', this.jumpHandler);
      this.jumpHandler = (e) => {
        if (e.key === ' ' || e.key === 'ArrowUp') this.doJump();
      };
      document.addEventListener('keydown', this.jumpHandler);
    },

    doJump: function() {
      if (this.dino.onGround) {
        this.dino.dy = this.dino.jumpForce;
        this.dino.onGround = false;
      }
    },

    onTap: function() { this.doJump(); },

    spawnObstacle: function(canvas) {
      const type = Math.random();
      let w, h;
      if (type < 0.45)      { w = 20; h = 45; }   // single cactus
      else if (type < 0.75) { w = 42; h = 45; }   // double cactus
      else                  { w = 22; h = 65; }   // tall cactus
      this.obstacles.push({
        x: canvas.width + 10,
        y: canvas.height - h - 20,
        width: w,
        height: h,
        color: '#ec4899'
      });
      // Next spawn: random gap that shrinks slightly as speed grows
      const minGap = Math.max(46, 95 - this.speed * 4);
      this.spawnGap = minGap + Math.random() * 70;
    },

    update: function(game) {
      const canvas = game.canvas;

      // Physics
      this.dino.y += this.dino.dy;
      const groundY = canvas.height - this.dino.height - 20;
      if (this.dino.y < groundY) {
        this.dino.dy += this.dino.gravity;
        this.dino.onGround = false;
      } else {
        this.dino.y = groundY;
        this.dino.dy = 0;
        this.dino.onGround = true;
      }

      // Distance score + speed ramp
      this.distance += this.speed / 10;
      const score = Math.floor(this.distance);
      if (score !== game.score) game.updateScore(score);
      this.speed = Math.min(5 + this.distance / 180, 13);

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
        o.x -= this.speed;
        if (o.x + o.width < 0) { this.obstacles.splice(i, 1); continue; }

        // Collision (with a little forgiveness)
        if (this.dino.x + 6 < o.x + o.width &&
            this.dino.x + this.dino.width - 6 > o.x &&
            this.dino.y + 6 < o.y + o.height &&
            this.dino.y + this.dino.height - 4 > o.y) {
          game.showGameOver('Game Over');
          return;
        }
      }
    },

    draw: function(game) {
      const ctx = game.ctx;
      const canvas = game.canvas;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Clouds
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
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
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Dino (with simple leg animation)
      ctx.fillStyle = this.dino.color;
      ctx.fillRect(this.dino.x, this.dino.y, this.dino.width, this.dino.height);
      ctx.fillStyle = '#222';
      ctx.fillRect(this.dino.x + this.dino.width - 12, this.dino.y + 6, 6, 6);
      if (this.dino.onGround) {
        const step = Math.floor(this.distance * 2) % 2 === 0;
        ctx.fillStyle = this.dino.color;
        ctx.fillRect(this.dino.x + (step ? 4 : 22), this.dino.y + this.dino.height, 8, 6);
      }

      // Obstacles
      this.obstacles.forEach(o => {
        ctx.fillStyle = o.color;
        ctx.fillRect(o.x, o.y, o.width, o.height);
        ctx.fillRect(o.x - 6, o.y + 15, 6, 10);
        ctx.fillRect(o.x + o.width, o.y + 10, 6, 10);
      });
    }
  };

  // ===================================
  // Snake — grid classic with swipe support
  // ===================================
  const SnakeGame = {
    CELL: 20,
    cols: 0,
    rows: 0,
    snake: [],
    dir: { x: 1, y: 0 },
    nextDir: { x: 1, y: 0 },
    food: null,
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
      // No 180° reversals
      if (x === -this.dir.x && y === -this.dir.y) return;
      this.nextDir = { x: x, y: y };
    },

    onSwipeStart: function(x, y) { this.swipeStart = { x: x, y: y }; },

    onSwipeEnd: function(x, y) {
      if (!this.swipeStart) return;
      const dx = x - this.swipeStart.x;
      const dy = y - this.swipeStart.y;
      this.swipeStart = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return; // too small
      if (Math.abs(dx) > Math.abs(dy)) this.turn(dx > 0 ? 1 : -1, 0);
      else this.turn(0, dy > 0 ? 1 : -1);
    },

    placeFood: function() {
      let spot;
      do {
        spot = { x: Math.floor(Math.random() * this.cols), y: Math.floor(Math.random() * this.rows) };
      } while (this.snake.some(s => s.x === spot.x && s.y === spot.y));
      this.food = spot;
    },

    update: function(game, ts) {
      if (ts - this.lastTick < this.tickMs) return;
      this.lastTick = ts;

      this.dir = this.nextDir;
      const head = { x: this.snake[0].x + this.dir.x, y: this.snake[0].y + this.dir.y };

      // Wall or self collision
      if (head.x < 0 || head.x >= this.cols || head.y < 0 || head.y >= this.rows ||
          this.snake.some(s => s.x === head.x && s.y === head.y)) {
        game.showGameOver('Game Over');
        return;
      }

      this.snake.unshift(head);

      if (head.x === this.food.x && head.y === this.food.y) {
        game.updateScore(game.score + 10);
        this.tickMs = Math.max(60, this.tickMs - 2); // speed up
        this.placeFood();
      } else {
        this.snake.pop();
      }
    },

    draw: function(game) {
      const ctx = game.ctx;
      const canvas = game.canvas;
      const C = this.CELL;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Food
      ctx.beginPath();
      ctx.arc(this.food.x * C + C / 2, this.food.y * C + C / 2, C / 2 - 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ec4899';
      ctx.fill();

      // Snake — head brighter, body gradient
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

      // iPad masquerades as Mac on iPadOS 13+ — use touch + screen heuristic
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
      // Inject floating chip if not present
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
      // Re-detect on resize / orientation change
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
