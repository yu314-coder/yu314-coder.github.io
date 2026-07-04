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
     4. Hero eigenvalue field — if .hero-eigen (a <canvas>) exists, animates
                             ~200 points settling into the circular law (the
                             limiting eigenvalue distribution of a random
                             matrix), then drifts them gently forever.
     5. Navbar frosted-on-scroll — toggles .scrolled on .navbar

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
     4. Hero "circular law" — a canvas point field depicting the limiting
     eigenvalue distribution of a random matrix (the author's own random
     matrix theory research). Points settle from a scatter into the unit
     disk, then drift with slow independent motion. Static (final frame
     only) under prefers-reduced-motion.
     ------------------------------------------------------------------------- */
  function initHeroEigen() {
    var canvas = document.querySelector(".hero-eigen");
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    var N = 200;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var size = 360;

    // Deterministic PRNG so the piece looks the same on every load.
    var seed = 3141592;
    function rand() {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    var STOPS = [[45, 107, 255], [91, 91, 240], [124, 58, 237]]; // accent -> accent-2
    function colorFor(r) {
      var t = Math.min(r, 1) * (STOPS.length - 1);
      var i = Math.min(Math.floor(t), STOPS.length - 2);
      var f = t - i, a = STOPS[i], b = STOPS[i + 1];
      return [
        Math.round(a[0] + (b[0] - a[0]) * f),
        Math.round(a[1] + (b[1] - a[1]) * f),
        Math.round(a[2] + (b[2] - a[2]) * f)
      ];
    }

    var points = [];
    for (var i = 0; i < N; i++) {
      // Circular law: uniform density in the unit disk.
      var r0 = Math.sqrt(rand()), theta0 = rand() * Math.PI * 2;
      var sr = 1.6 + rand() * 0.9, stheta = rand() * Math.PI * 2;
      points.push({
        tx: r0 * Math.cos(theta0), ty: r0 * Math.sin(theta0),
        x: sr * Math.cos(stheta), y: sr * Math.sin(stheta),
        phase: rand() * Math.PI * 2,
        speed: 0.15 + rand() * 0.25,
        wobble: 0.012 + rand() * 0.02
      });
    }

    // Real eigenvalues repel one another (a hallmark of random matrix
    // theory) — relax the naive i.i.d. sample so it reads as an ordered
    // field rather than clumpy noise, closer to a genuine spectrum.
    var MIN_D = 1.9 / Math.sqrt(N);
    for (var pass = 0; pass < 60; pass++) {
      for (var a = 0; a < points.length; a++) {
        for (var c = a + 1; c < points.length; c++) {
          var dx = points[a].tx - points[c].tx, dy = points[a].ty - points[c].ty;
          var d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
          if (d < MIN_D) {
            var push = (MIN_D - d) / d * 0.5;
            var ox = dx * push, oy = dy * push;
            points[a].tx += ox; points[a].ty += oy;
            points[c].tx -= ox; points[c].ty -= oy;
          }
        }
      }
      for (var i2 = 0; i2 < points.length; i2++) {
        var rr = Math.sqrt(points[i2].tx * points[i2].tx + points[i2].ty * points[i2].ty);
        if (rr > 0.97) { points[i2].tx = points[i2].tx / rr * 0.97; points[i2].ty = points[i2].ty / rr * 0.97; }
      }
    }
    for (var i3 = 0; i3 < points.length; i3++) {
      var p3 = points[i3];
      p3.r = Math.sqrt(p3.tx * p3.tx + p3.ty * p3.ty);
      p3.size = 1.4 + (1 - p3.r) * 2.0 + (rand() < 0.06 ? 1.8 : 0);
    }

    // Pre-baked glow sprites (a handful of color buckets) so the per-frame
    // cost is a drawImage, not a fresh radial gradient for every point.
    var glowSprites = [];
    var GS = 96;
    for (var b = 0; b < 6; b++) {
      var col = colorFor(b / 5);
      var off = document.createElement("canvas");
      off.width = GS; off.height = GS;
      var octx = off.getContext("2d");
      var g = octx.createRadialGradient(GS / 2, GS / 2, 0, GS / 2, GS / 2, GS / 2);
      g.addColorStop(0, "rgba(" + col.join(",") + ",0.55)");
      g.addColorStop(1, "rgba(" + col.join(",") + ",0)");
      octx.fillStyle = g;
      octx.beginPath(); octx.arc(GS / 2, GS / 2, GS / 2, 0, Math.PI * 2); octx.fill();
      glowSprites.push(off);
    }

    function resize() {
      var rect = canvas.getBoundingClientRect();
      size = rect.width || 360;
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function frame(cx, cy, R, eased, ts) {
      ctx.clearRect(0, 0, size, size);
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(124,58,237,0.20)";
      ctx.lineWidth = 1;
      ctx.stroke();

      for (var i = 0; i < points.length; i++) {
        var p = points[i];
        var curX = p.x + (p.tx - p.x) * eased;
        var curY = p.y + (p.ty - p.y) * eased;
        var wx = 0, wy = 0;
        if (ts != null) {
          wx = Math.cos(ts * 0.00035 * p.speed + p.phase) * p.wobble * eased;
          wy = Math.sin(ts * 0.00042 * p.speed + p.phase * 1.3) * p.wobble * eased;
        }
        var px = cx + (curX + wx) * R, py = cy + (curY + wy) * R;
        var bucket = Math.min(5, Math.round(p.r * 5));
        var sp = p.size * 7.5;
        ctx.drawImage(glowSprites[bucket], px - sp / 2, py - sp / 2, sp, sp);
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        var col = colorFor(p.r);
        ctx.fillStyle = "rgba(" + col.join(",") + "," + (0.65 + (1 - p.r) * 0.35) + ")";
        ctx.fill();
      }
    }

    try {
      resize();
      var SETTLE_MS = 2200;
      if (REDUCED) {
        frame(size / 2, size / 2, size * 0.42, 1, null);
      } else {
        var start = null;
        var raf = function (ts) {
          if (start === null) start = ts;
          var p = Math.min((ts - start) / SETTLE_MS, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          frame(size / 2, size / 2, size * 0.42, eased, ts);
          requestAnimationFrame(raf);
        };
        requestAnimationFrame(raf);
      }
      window.addEventListener("resize", function () {
        resize();
        if (REDUCED) frame(size / 2, size / 2, size * 0.42, 1, null);
      }, { passive: true });
    } catch (e) {}
  }

  /* ---------------------------------------------------------------------------
     5. Navbar frosted-on-scroll
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
    try { initHeroEigen(); } catch (e) {}
  });
})();
