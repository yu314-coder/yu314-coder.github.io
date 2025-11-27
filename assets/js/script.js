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

})();
