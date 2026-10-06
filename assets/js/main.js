// ===================================
// Main JavaScript for Portfolio Site
// ===================================
// What every visitor needs: the navbar's scroll state, the device chip, the visitor panel and the console hint.
// The hidden arcade is in arcade.js and is fetched only when someone opens it (see "Arcade loader").

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
  }, { passive: true });

  // ===================================
  // Admin Panel: Visitor Tracking
  // ===================================
  const AdminPanel = {
    init: function() {
      // The visit log asks Cloudflare for the visitor's IP -- a third-party request, so it waits until the page
      // has loaded and the browser is idle instead of competing with first paint.
      const record = () => this.recordVisit();
      const idle = () => ('requestIdleCallback' in window)
        ? window.requestIdleCallback(record, { timeout: 4000 })
        : setTimeout(record, 1500);
      if (document.readyState === 'complete') idle();
      else window.addEventListener('load', idle, { once: true });
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
  // Arcade loader
  // ===================================
  // The games live in arcade.js (about 330 KB) and are fetched the first time someone opens them. Until then
  // these two listeners stand in for the arcade's own: "easter" typed anywhere, or a 600 ms press on the site
  // name. Once arcade.js has run, its listeners take over and these step aside.
  const ARCADE_SRC = 'assets/js/arcade.js?v=20261006-split';
  let arcadeLoading = null;

  function loadArcade() {
    if (!arcadeLoading) {
      arcadeLoading = new Promise(function(resolve, reject) {
        const s = document.createElement('script');
        s.src = ARCADE_SRC;
        s.async = true;
        s.onload = resolve;
        s.onerror = function() { arcadeLoading = null; reject(new Error('arcade.js failed to load')); };
        document.head.appendChild(s);
      });
    }
    return arcadeLoading;
  }

  const arcadeReady = () => typeof window.__arcadeOpen === 'function';

  function openArcade(how) {
    loadArcade().then(function() { window.__arcadeOpen(how); }).catch(function() {});
  }

  function setupArcadeKeys() {
    const secret = ['e', 'a', 's', 't', 'e', 'r'];
    let typed = [];
    document.addEventListener('keydown', function(event) {
      const key = (event.key || '').toLowerCase();
      if (key === 'escape') {
        const a = document.getElementById('hidden-admin');
        if (a && a.style.display !== 'none' && a.style.display !== '') window.exitAdmin();
      }
      if (arcadeReady()) return;
      typed.push(key);
      if (typed.length > secret.length) typed.shift();
      if (secret.every((l, i) => l === typed[i])) {
        typed = [];
        openArcade('keys');
      }
    });
  }

  function setupArcadePress() {
    const brand = document.querySelector('.navbar-brand');
    if (!brand) return;
    let fetchTimer = null, openTimer = null, fired = false;
    const start = () => {
      fired = false;
      if (arcadeReady()) return;
      clearTimeout(fetchTimer); clearTimeout(openTimer);
      // A tap on the name is a link home; only a press held past 250 ms starts the download.
      fetchTimer = setTimeout(() => { loadArcade().catch(function() {}); }, 250);
      openTimer = setTimeout(() => { fired = true; openArcade('press'); }, 600);
    };
    const cancel = () => { clearTimeout(fetchTimer); clearTimeout(openTimer); };
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
  }

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
    setupArcadeKeys();
    setupArcadePress();
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
