/* =============================================================================
   assets/js/ui.js — site-wide motion + live data
   Safe to include on EVERY page: no errors if target elements are absent.

   Provides:
     1. Scroll-reveal      — .reveal elements fade + rise in once when seen
     2. Animated counters  — .count[data-count] count up (honors data-suffix /
                             data-prefix / data-duration) when revealed
     3. Live PyPI total    — if #live-downloads exists, query ClickHouse for the
                             summed downloads of a fixed project set and animate
                             the number in. Fails silently (blank), never throws.
     4. Navbar frosted-on-scroll — toggles .scrolled on .navbar

   All motion respects prefers-reduced-motion: when reduced, final values are
   set instantly with no animation.
   ============================================================================= */
(function () {
  "use strict";

  var REDUCED = false;
  try {
    REDUCED = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) { REDUCED = false; }

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  /* ---------------------------------------------------------------------------
     Number formatting + count-up
     ------------------------------------------------------------------------- */
  function formatInt(n) {
    try { return Math.round(n).toLocaleString("en-US"); }
    catch (e) { return String(Math.round(n)); }
  }

  function countUp(el, target, opts) {
    opts = opts || {};
    var prefix = opts.prefix != null ? opts.prefix : (el.getAttribute("data-prefix") || "");
    var suffix = opts.suffix != null ? opts.suffix : (el.getAttribute("data-suffix") || "");
    var dur = opts.duration != null ? opts.duration
      : parseInt(el.getAttribute("data-duration"), 10) || 1600;

    if (REDUCED || !target || dur <= 0) {
      el.textContent = prefix + formatInt(target) + suffix;
      return;
    }

    var start = null;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      // easeOutCubic
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + formatInt(target * eased) + suffix;
      if (p < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = prefix + formatInt(target) + suffix;
      }
    }
    requestAnimationFrame(step);
  }

  /* ---------------------------------------------------------------------------
     1 + 2. Scroll reveal & counters (one IntersectionObserver)
     ------------------------------------------------------------------------- */
  function initReveal() {
    var revealEls = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
    var counterEls = Array.prototype.slice.call(document.querySelectorAll(".count[data-count]"));

    // Reduced motion or no IO support: show everything + set final counts now.
    if (REDUCED || !("IntersectionObserver" in window)) {
      revealEls.forEach(function (el) { el.classList.add("is-visible"); });
      counterEls.forEach(function (el) {
        var t = parseFloat(el.getAttribute("data-count")) || 0;
        countUp(el, t);
      });
      return;
    }

    if (revealEls.length) {
      var revObs = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            obs.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
      revealEls.forEach(function (el) { revObs.observe(el); });
    }

    if (counterEls.length) {
      var cntObs = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var el = entry.target;
            var t = parseFloat(el.getAttribute("data-count")) || 0;
            countUp(el, t);
            obs.unobserve(el);
          }
        });
      }, { threshold: 0.4 });
      counterEls.forEach(function (el) { cntObs.observe(el); });
    }
  }

  /* ---------------------------------------------------------------------------
     3. Live PyPI total downloads via ClickHouse demo endpoint
     ------------------------------------------------------------------------- */
  function initLiveDownloads() {
    var el = document.getElementById("live-downloads");
    if (!el) return;

    var query =
      "SELECT sum(count) AS total FROM pypi.pypi_downloads_per_day_by_version_by_python_by_country " +
      "WHERE project IN ('rmt-denoise','cairometal','narrate','ollama-installer') FORMAT TabSeparated";

    var url = "https://sql-clickhouse.clickhouse.com/?user=demo";

    function fail() {
      // Graceful: blank the readout, never surface an error.
      el.textContent = "";
      var wrap = el.closest("[data-live-downloads-wrap]");
      if (wrap) { wrap.style.display = "none"; }
    }

    var controller;
    try { controller = new AbortController(); } catch (e) { controller = null; }
    var timer = setTimeout(function () {
      if (controller) { try { controller.abort(); } catch (e) {} }
    }, 9000);

    try {
      fetch(url, {
        method: "POST",
        body: query,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        signal: controller ? controller.signal : undefined
      })
        .then(function (res) {
          if (!res || !res.ok) throw new Error("bad response");
          return res.text();
        })
        .then(function (text) {
          clearTimeout(timer);
          var total = parseInt(String(text).trim().split(/\s+/)[0], 10);
          if (!isFinite(total) || total <= 0) { fail(); return; }
          countUp(el, total, { duration: 1800 });
        })
        .catch(function () {
          clearTimeout(timer);
          fail();
        });
    } catch (e) {
      clearTimeout(timer);
      fail();
    }
  }

  /* ---------------------------------------------------------------------------
     4. Navbar frosted-on-scroll
     ------------------------------------------------------------------------- */
  function initNavScroll() {
    var nav = document.querySelector(".navbar");
    if (!nav) return;
    var onScroll = function () {
      if (window.scrollY > 24) { nav.classList.add("scrolled"); }
      else { nav.classList.remove("scrolled"); }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* --------------------------------------------------------------------------- */
  ready(function () {
    try { initReveal(); } catch (e) {}
    try { initNavScroll(); } catch (e) {}
    try { initLiveDownloads(); } catch (e) {}
  });
})();
