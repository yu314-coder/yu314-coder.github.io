// assets/js/script.js
// Custom JavaScript for portfolio site

(function() {
  'use strict';

  // ===================================
  // DOM Content Loaded
  // ===================================
  document.addEventListener('DOMContentLoaded', function() {
    console.log("Portfolio website loaded successfully!");

    // Initialize smooth scrolling for anchor links
    initSmoothScrolling();

    // Initialize form validation if contact form exists
    initFormValidation();
  });

  // ===================================
  // Smooth Scrolling for Anchor Links
  // ===================================
  function initSmoothScrolling() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function(e) {
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
          e.preventDefault();
          target.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }
      });
    });
  }

  // ===================================
  // Form Validation Enhancement
  // ===================================
  function initFormValidation() {
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
      form.addEventListener('submit', function(e) {
        if (!form.checkValidity()) {
          e.preventDefault();
          e.stopPropagation();
        }
        form.classList.add('was-validated');
      });
    });
  }

  // ===================================
  // Navbar Active State
  // ===================================
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const navLinks = document.querySelectorAll('.navbar-nav .nav-link');

  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  });

  // ===================================
  // Device-Aware Theming (shared on all pages)
  // ===================================
  function detectDevice() {
    const ua = (navigator.userAgent || '').toLowerCase();
    const w = Math.min(window.innerWidth, window.screen.width || window.innerWidth);
    const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const isIPad = /ipad/.test(ua) || (ua.includes('macintosh') && hasTouch);
    const isPhone = /iphone|ipod|android.*mobile|windows phone|blackberry|bb10/.test(ua);
    const isAndroidTablet = /android/.test(ua) && !/mobile/.test(ua);
    if (isPhone || (hasTouch && w < 600)) return 'phone';
    if (isIPad || isAndroidTablet || (hasTouch && w >= 600 && w < 1180)) return 'tablet';
    return 'desktop';
  }

  function applyDevice() {
    const kind = detectDevice();
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
        const next = detectDevice();
        if (next !== document.body.getAttribute('data-device')) {
          document.body.setAttribute('data-device', next);
          const g = document.querySelector('.device-chip .glyph');
          if (g) g.textContent = next === 'desktop' ? '🖥️' : (next === 'tablet' ? '🖼️' : '📱');
        }
      }, 200);
    });
  }

  document.addEventListener('DOMContentLoaded', applyDevice);

})();
