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
  // Easter Egg Game System
  // ===================================
  const GameSystem = {
    canvas: null,
    ctx: null,
    gameActive: false,
    currentGame: "breakout",
    score: 0,

    init: function() {
      this.canvas = document.getElementById('gameCanvas');
      if (!this.canvas) return;

      this.ctx = this.canvas.getContext('2d');
      this.setupGameSequence();
      this.setupControls();
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
        }
      });
    },

    setupControls: function() {
      const gameSelect = document.getElementById('gameSelect');
      if (gameSelect) {
        gameSelect.addEventListener('change', (e) => {
          this.currentGame = e.target.value;
        });
      }
    },

    startGame: function() {
      const select = document.getElementById('gameSelect');
      this.currentGame = select ? select.value : 'breakout';
      this.gameActive = true;

      if (this.currentGame === 'breakout') {
        Breakout.init(this);
      } else if (this.currentGame === 'dino') {
        DinoGame.init(this);
      }

      this.gameLoop();
    },

    gameLoop: function() {
      if (!this.gameActive) return;

      if (this.currentGame === 'breakout') {
        Breakout.draw(this);
      } else if (this.currentGame === 'dino') {
        DinoGame.update(this);
        DinoGame.draw(this);
      }

      if (this.gameActive) {
        requestAnimationFrame(() => this.gameLoop());
      }
    },

    showGameOver: function(message) {
      this.gameActive = false;
      const ctx = this.ctx;
      const canvas = this.canvas;
      
      // Overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Text
      ctx.font = 'bold 30px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(message, canvas.width/2, canvas.height/2 - 10);
      
      ctx.font = '20px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#ccc';
      ctx.fillText('Press Space or Click to Restart', canvas.width/2, canvas.height/2 + 30);
      
      // Restart handlers
      const restart = () => {
        canvas.removeEventListener('click', restart);
        document.removeEventListener('keydown', keyRestart);
        this.startGame();
      };
      
      const keyRestart = (e) => {
        if (e.code === 'Space') restart();
      };
      
      canvas.addEventListener('click', restart);
      document.addEventListener('keydown', keyRestart);
    },

    updateScore: function(newScore) {
      this.score = newScore;
      const scoreEl = document.getElementById('scoreDisplay');
      if (scoreEl) {
        scoreEl.textContent = `Score: ${this.score}`;
      }
    }
  };

  // ===================================
  // Breakout Game
  // ===================================
  const Breakout = {
    ball: null,
    paddle: null,
    bricks: [],
    rightPressed: false,
    leftPressed: false,
    keyDownHandler: null,
    keyUpHandler: null,
    config: {
      brickRowCount: 5,
      brickColumnCount: 7,
      brickWidth: 75,
      brickHeight: 20,
      brickPadding: 10,
      brickOffsetTop: 30,
      brickOffsetLeft: 30
    },

    init: function(game) {
      const canvas = game.canvas;
      this.ball = {
        x: canvas.width / 2,
        y: canvas.height - 30,
        radius: 10,
        dx: 3,
        dy: -3,
        color: 'orange'
      };
      this.paddle = {
        width: 75,
        height: 10,
        x: (canvas.width - 75) / 2,
        color: 'cyan',
        speed: 7
      };

      this.bricks = [];
      for (let c = 0; c < this.config.brickColumnCount; c++) {
        this.bricks[c] = [];
        for (let r = 0; r < this.config.brickRowCount; r++) {
          this.bricks[c][r] = { x: 0, y: 0, status: 1 };
        }
      }

      game.score = 0;
      game.updateScore(0);
      this.rightPressed = false;
      this.leftPressed = false;

      // Remove old listeners if they exist
      if (this.keyDownHandler) {
        document.removeEventListener('keydown', this.keyDownHandler);
      }
      if (this.keyUpHandler) {
        document.removeEventListener('keyup', this.keyUpHandler);
      }

      // Create new listeners and store references
      this.keyDownHandler = (e) => this.keyDown(e);
      this.keyUpHandler = (e) => this.keyUp(e);
      document.addEventListener('keydown', this.keyDownHandler);
      document.addEventListener('keyup', this.keyUpHandler);
    },

    keyDown: function(e) {
      if (e.key === 'Right' || e.key === 'ArrowRight') this.rightPressed = true;
      if (e.key === 'Left' || e.key === 'ArrowLeft') this.leftPressed = true;
    },

    keyUp: function(e) {
      if (e.key === 'Right' || e.key === 'ArrowRight') this.rightPressed = false;
      if (e.key === 'Left' || e.key === 'ArrowLeft') this.leftPressed = false;
    },

    draw: function(game) {
      const ctx = game.ctx;
      const canvas = game.canvas;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.drawBricks(ctx);
      this.drawBall(ctx);
      this.drawPaddle(ctx, canvas);
      this.collisionDetection(game);
      this.moveBall(canvas, game);
      this.movePaddle(canvas);
    },

    drawBricks: function(ctx) {
      const colors = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db'];
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
      const pY = canvas.height - this.paddle.height;
      ctx.roundRect ? ctx.roundRect(pX, pY, this.paddle.width, this.paddle.height, 5) : ctx.rect(pX, pY, this.paddle.width, this.paddle.height);
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
              game.updateScore(++game.score);

              if (game.score === this.config.brickRowCount * this.config.brickColumnCount) {
                game.showGameOver('YOU WIN!');
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

      if (this.ball.y + this.ball.dy < this.ball.radius) {
        this.ball.dy = -this.ball.dy;
      } else if (this.ball.y + this.ball.dy > canvas.height - this.ball.radius) {
        if (this.ball.x > this.paddle.x && this.ball.x < this.paddle.x + this.paddle.width) {
          this.ball.dy = -this.ball.dy;
        } else {
          game.showGameOver('Game Over');
        }
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
  // Dino Game
  // ===================================
  const DinoGame = {
    dino: null,
    cactus: null,
    gameOver: false,
    jumpHandler: null,

    init: function(game) {
      const canvas = game.canvas;
      this.dino = {
        x: 50,
        y: canvas.height - 60,
        width: 40,
        height: 40,
        color: 'lime',
        dy: 0,
        gravity: 0.8,
        jumpForce: -15,
        onGround: true
      };
      this.cactus = {
        x: canvas.width,
        y: canvas.height - 50,
        width: 20,
        height: 50,
        color: 'red',
        speed: 4
      };
      this.gameOver = false;
      game.score = 0;
      game.updateScore(0);

      // Remove old listener if it exists
      if (this.jumpHandler) {
        document.removeEventListener('keydown', this.jumpHandler);
      }

      // Create new listener and store reference
      this.jumpHandler = (e) => this.jump(e);
      document.addEventListener('keydown', this.jumpHandler);
    },

    jump: function(e) {
      if (e.key === ' ' || e.key === 'ArrowUp') {
        if (this.dino.onGround) {
          this.dino.dy = this.dino.jumpForce;
          this.dino.onGround = false;
        }
      }
    },

    update: function(game) {
      const canvas = game.canvas;

      // Update dino physics
      this.dino.y += this.dino.dy;
      if (this.dino.y + this.dino.height < canvas.height) {
        this.dino.dy += this.dino.gravity;
        this.dino.onGround = false;
      } else {
        this.dino.y = canvas.height - this.dino.height;
        this.dino.dy = 0;
        this.dino.onGround = true;
      }

      // Update cactus
      this.cactus.x -= this.cactus.speed;
      if (this.cactus.x + this.cactus.width < 0) {
        this.cactus.x = canvas.width;
        game.updateScore(++game.score);
      }

      // Collision detection
      if (this.dino.x < this.cactus.x + this.cactus.width &&
          this.dino.x + this.dino.width > this.cactus.x &&
          this.dino.y < this.cactus.y + this.cactus.height &&
          this.dino.y + this.dino.height > this.cactus.y) {
        this.gameOver = true;
        game.showGameOver('Game Over');
      }
    },

    draw: function(game) {
      const ctx = game.ctx;
      const canvas = game.canvas;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Ground
      ctx.beginPath();
      ctx.moveTo(0, canvas.height - 20);
      ctx.lineTo(canvas.width, canvas.height - 20);
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw dino
      ctx.fillStyle = this.dino.color;
      ctx.fillRect(this.dino.x, this.dino.y, this.dino.width, this.dino.height);
      // Eye
      ctx.fillStyle = '#222';
      ctx.fillRect(this.dino.x + this.dino.width - 12, this.dino.y + 6, 6, 6);

      // Draw cactus
      ctx.fillStyle = this.cactus.color;
      ctx.fillRect(this.cactus.x, this.cactus.y, this.cactus.width, this.cactus.height);
      // Cactus arms
      ctx.fillRect(this.cactus.x - 6, this.cactus.y + 15, 6, 10);
      ctx.fillRect(this.cactus.x + this.cactus.width, this.cactus.y + 10, 6, 10);
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
  // Initialize on DOM Load
  // ===================================
  document.addEventListener('DOMContentLoaded', function() {
    AdminPanel.init();
    GameSystem.init();
    console.log('Portfolio website loaded successfully!');
  });

})();
