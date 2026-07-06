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
     4. Hero spiral flow — if .hero-flow (a <canvas>) exists, animates glowing
                             particles spiraling into a bright core, tracing
                             the phase portrait of a linear system with a
                             complex-conjugate eigenvalue pair (the spiral a
                             non-symmetric random matrix's spectrum produces).
                             The cursor/finger genuinely stirs the flow (drag
                             velocity, not just proximity), and a click/tap
                             bursts nearby particles outward from that point.
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
     4. Hero spiral flow — glowing particles spiraling into a bright core,
     tracing the phase portrait of a linear system x' = Mx whose matrix M
     has a complex-conjugate eigenvalue pair a +/- bi. That pair is exactly
     what makes trajectories spiral instead of just scaling in place — a
     real, direct link to the author's random matrix theory research (real
     non-symmetric random matrices generically have complex eigenvalues).
     Cursor/touch gently perturbs nearby flow. A few faint static spiral
     guide-curves replace the animation under prefers-reduced-motion.
     ------------------------------------------------------------------------- */
  function initHeroFlow() {
    var canvas = document.querySelector(".hero-flow");
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;

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
      var t = Math.min(Math.max(r, 0), 1) * (STOPS.length - 1);
      var i = Math.min(Math.floor(t), STOPS.length - 2);
      var f = t - i, a = STOPS[i], b = STOPS[i + 1];
      return [
        Math.round(a[0] + (b[0] - a[0]) * f),
        Math.round(a[1] + (b[1] - a[1]) * f),
        Math.round(a[2] + (b[2] - a[2]) * f)
      ];
    }

    // x' = Ax - By, y' = Bx + Ay  <=>  eigenvalues A +/- Bi of [[A,-B],[B,A]].
    // A < 0 (decay) + B != 0 (rotation) = a damped spiral into the origin.
    var A = -0.5, B = -1.4; // B's sign sets screen rotation; negative = counterclockwise

    var N = 200;
    var particles = [];
    function spawn(p) {
      var ang = rand() * Math.PI * 2, rad = 0.62 + rand() * 0.34;
      p.x = rad * Math.cos(ang); p.y = rad * Math.sin(ang);
      p.px = p.x; p.py = p.y;
      p.age = 0;
      p.burstLife = 0;
    }
    for (var i = 0; i < N; i++) {
      var p = { burstLife: 0 };
      // First placement scatters across the whole disk (not just the outer
      // band) so it doesn't read as an empty ring for the first few seconds.
      var ang0 = rand() * Math.PI * 2, rad0 = Math.sqrt(rand()) * 0.95;
      p.x = rad0 * Math.cos(ang0); p.y = rad0 * Math.sin(ang0);
      p.px = p.x; p.py = p.y;
      p.age = 0;
      particles.push(p);
    }

    // Click/tap: kick a handful of existing particles out from that point —
    // they burst outward, then get swept back into the spiral naturally.
    // Reuses particles (no array growth) so repeated clicking stays cheap.
    function burst(nx, ny) {
      var count = Math.min(24, particles.length);
      for (var k = 0; k < count; k++) {
        var p = particles[Math.floor(rand() * particles.length)];
        var ang = rand() * Math.PI * 2, speed = 0.6 + rand() * 0.9;
        p.x = nx; p.y = ny; p.px = nx; p.py = ny;
        p.age = 0;
        p.burstVX = Math.cos(ang) * speed; p.burstVY = Math.sin(ang) * speed;
        p.burstLife = 0.7;
      }
    }

    // A soft baseline glow at the fixed point the spiral falls into — so
    // there's a bright core from frame one, before trails accumulate one
    // of their own (particles genuinely slow down near the center, which
    // naturally builds extra brightness there over the first few seconds).
    function paintCore(cx, cy, R) {
      var coreCol = colorFor(0);
      var glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.11);
      glow.addColorStop(0, "rgba(" + coreCol.join(",") + ",0.4)");
      glow.addColorStop(1, "rgba(" + coreCol.join(",") + ",0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.11, 0, Math.PI * 2); ctx.fill();
    }

    function resize() {
      var rect = canvas.getBoundingClientRect();
      size = rect.width || 360;
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, size, size);
    }

    // Cursor tracking, canvas-local CSS px, plus its recent velocity — so the
    // flow can be genuinely stirred (pushed along the drag direction) rather
    // than just nudged away from a fixed point.
    var mouseX = null, mouseY = null, stirVX = 0, stirVY = 0;
    function trackPointer(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      var nx = clientX - rect.left, ny = clientY - rect.top;
      if (mouseX != null) { stirVX = nx - mouseX; stirVY = ny - mouseY; }
      mouseX = nx; mouseY = ny;
    }
    window.addEventListener("mousemove", function (e) { trackPointer(e.clientX, e.clientY); }, { passive: true });
    window.addEventListener("touchmove", function (e) {
      if (e.touches && e.touches[0]) trackPointer(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    window.addEventListener("touchend", function () { mouseX = null; mouseY = null; }, { passive: true });
    canvas.addEventListener("mouseleave", function () { mouseX = null; mouseY = null; });

    // Click/tap anywhere on the piece to kick off a burst at that point.
    function burstAt(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      var R = size * 0.46;
      burst((clientX - rect.left - size / 2) / R, (clientY - rect.top - size / 2) / R);
    }
    canvas.addEventListener("click", function (e) { burstAt(e.clientX, e.clientY); });
    canvas.addEventListener("touchstart", function (e) {
      if (e.touches && e.touches[0]) burstAt(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    function step(dt, R, cx, cy) {
      // Stir decays on its own between mousemove events, so a moving cursor
      // feels like a continuous drag and a stopped one fades out naturally.
      stirVX *= 0.85; stirVY *= 0.85;

      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.px = p.x; p.py = p.y;
        var vx = A * p.x - B * p.y;
        var vy = B * p.x + A * p.y;

        if (p.burstLife > 0) {
          var bf = p.burstLife / 0.7;
          vx += p.burstVX * bf * 3;
          vy += p.burstVY * bf * 3;
          p.burstLife -= dt;
        }

        if (mouseX != null) {
          var wx = cx + p.x * R, wy = cy + p.y * R;
          var mdx = wx - mouseX, mdy = wy - mouseY;
          var mdist = Math.sqrt(mdx * mdx + mdy * mdy);
          if (mdist < 80) {
            var falloff = 1 - mdist / 80;
            // Stir: carry the cursor's own recent motion into the flow.
            vx += (stirVX / R) * falloff * 18;
            vy += (stirVY / R) * falloff * 18;
            // A little direct push too, so particles don't sit under a
            // motionless cursor.
            var push = falloff * 0.8;
            vx += (mdx / (mdist || 1)) * push;
            vy += (mdy / (mdist || 1)) * push;
          }
        }

        p.x += vx * dt; p.y += vy * dt;
        p.age += dt;
        var rr = Math.sqrt(p.x * p.x + p.y * p.y);
        if (rr < 0.05 || p.age > 7.5) spawn(p);
      }
    }

    function draw(cx, cy, R) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(0, 0, size, size);

      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        var rNow = Math.sqrt(p.x * p.x + p.y * p.y);
        var col = colorFor(Math.min(rNow / 0.95, 1));
        var rgb = "rgb(" + col.join(",") + ")";
        // Faster-moving particles (just stirred, or mid-burst) glow a little
        // brighter and thicker — motion itself becomes visible, not just position.
        var speed = Math.min(Math.hypot(p.x - p.px, p.y - p.py) * 45, 2.2);
        ctx.shadowBlur = 4 + speed * 2.5;
        ctx.shadowColor = rgb;
        ctx.strokeStyle = "rgba(" + col.join(",") + "," + Math.min(0.8 + speed * 0.1, 1) + ")";
        ctx.lineWidth = 1.8 + speed;
        ctx.beginPath();
        ctx.moveTo(cx + p.px * R, cy + p.py * R);
        ctx.lineTo(cx + p.x * R, cy + p.y * R);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      paintCore(cx, cy, R);
    }

    function drawStatic() {
      // Reduced motion: a few faint logarithmic spiral guide-curves, still.
      var cx = size / 2, cy = size / 2, R = size * 0.46;
      ctx.clearRect(0, 0, size, size);
      for (var k = 0; k < 3; k++) {
        ctx.beginPath();
        for (var s = 0; s <= 220; s++) {
          var t = s / 220 * 6.2;
          var rr = 0.95 * Math.exp(A * t);
          var th = B * t + k * (Math.PI * 2 / 3);
          var x = cx + rr * Math.cos(th) * R, y = cy + rr * Math.sin(th) * R;
          if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "rgba(91,91,240,0.30)";
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      paintCore(cx, cy, R);
    }

    try {
      resize();
      if (REDUCED) {
        drawStatic();
      } else {
        var lastTs = null, rafId = null, running = false;
        var raf = function (ts) {
          var dt = lastTs == null ? 1 / 60 : Math.min((ts - lastTs) / 1000, 0.05);
          lastTs = ts;
          var cx = size / 2, cy = size / 2, R = size * 0.46;
          step(dt, R, cx, cy);
          draw(cx, cy, R);
          rafId = requestAnimationFrame(raf);
        };
        var startFlow = function () {
          if (running) return;
          running = true; lastTs = null; // reset dt so the resume frame doesn't jump
          rafId = requestAnimationFrame(raf);
        };
        var stopFlow = function () {
          running = false;
          if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
        };
        startFlow(); // paint immediately (hero is above the fold)
        // Only run the 200-particle loop while the canvas is actually on-screen;
        // scrolling the hero away stops it instead of burning CPU on an
        // invisible canvas. (rAF already pauses when the whole tab is hidden.)
        if ("IntersectionObserver" in window) {
          new IntersectionObserver(function (entries) {
            if (entries[entries.length - 1].isIntersecting) startFlow();
            else stopFlow();
          }, { threshold: 0 }).observe(canvas);
        }
      }
      window.addEventListener("resize", function () {
        resize();
        if (REDUCED) drawStatic();
      }, { passive: true });
    } catch (e) {}
  }

  /* ---------------------------------------------------------------------------
     5. Navbar frosted-on-scroll
     ------------------------------------------------------------------------- */
  function initNavScroll() {
    var nav = document.querySelector(".navbar");
    if (!nav) return;
    var scrolled = null;
    var onScroll = function () {
      var now = window.scrollY > 24;
      if (now === scrolled) return; // skip redundant DOM writes on every scroll tick
      scrolled = now;
      nav.classList.toggle("scrolled", now);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* --------------------------------------------------------------------------- */
  ready(function () {
    try { initReveal(); } catch (e) {}
    try { initNavScroll(); } catch (e) {}
    try { initLiveDownloads(); } catch (e) {}
    try { initHeroFlow(); } catch (e) {}
  });
})();
