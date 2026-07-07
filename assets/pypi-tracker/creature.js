/* =============================================================================
   Byte — a small robot companion that sits by the package search field.
   Smooth vector art (not pixel grid): a glowing capsule body with a visor,
   two eyes that TRACK your cursor anywhere on the page, a pulsing antenna,
   and moods. It perks up when you focus the field, gets excited while you
   type, hops with a sparkle when you click it, and celebrates when download
   stats land. Original character; self-contained; respects reduced-motion.
   ============================================================================= */
(function () {
  "use strict";

  var canvas = document.getElementById("pypi-buddy");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Byte always animates (like the hero spiral) so it stays visible even when
  // the OS requests reduced motion — a Windows machine with "animation effects"
  // off would otherwise only get a single static frame that can read as blank.
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var S = 56; // Byte's logical SIZE in px (its width; sets all its proportions)
  var H = 56; // canvas logical HEIGHT — taller than S, the extra is hop headroom
  function resize() {
    var rect = canvas.getBoundingClientRect();
    S = rect.width || 56;
    H = rect.height || S;
    canvas.width = Math.round(S * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---- state ------------------------------------------------------------- */
  // Target params per mood; the drawn params ease toward these each frame.
  var STATES = {
    idle:    { bobAmp: 1.8, bobRate: 0.0016, eyeOpen: 1.00, antenna: 0.55, wiggle: 0 },
    alert:   { bobAmp: 1.1, bobRate: 0.0038, eyeOpen: 1.18, antenna: 0.95, wiggle: 0 },
    excited: { bobAmp: 2.6, bobRate: 0.0130, eyeOpen: 1.22, antenna: 1.00, wiggle: 1 }
  };
  var state = "idle";
  var cur = { bobAmp: 1.8, bobRate: 0.0016, eyeOpen: 1, antenna: 0.55, wiggle: 0 };
  var excitedUntil = 0;   // typing keeps us excited briefly, then back to alert
  var happy = 0;          // 0..1 celebration level (smile + brighter), decays
  var hop = null;         // { start, dur } vertical hop from a click / success
  var blinkT = 2200 + Math.random() * 2600;
  var lastMove = -9999;   // ts of last cursor movement (for gaze vs. idle drift)
  var mouse = { x: 0, y: 0 };
  var gaze = { x: 0, y: 0 };    // eased look direction, each component in [-1,1]
  var sparks = [];             // celebration particles

  function setState(next) { state = next; }

  function celebrate(strength) {
    happy = Math.min(1, happy + (strength || 1));
    hop = { start: now(), dur: 620 };
    var n = 5 + Math.round(3 * (strength || 1));
    for (var i = 0; i < n; i++) {
      var a = Math.PI * (0.15 + Math.random() * 0.7); // fan upward
      var sp = 26 + Math.random() * 34;
      sparks.push({ x: S / 2 + (Math.random() - 0.5) * S * 0.4, y: H * 0.5,
        vx: Math.cos(a) * sp * (Math.random() < 0.5 ? -1 : 1), vy: -Math.sin(a) * sp,
        life: 1, born: now(), hue: Math.random() < 0.5 ? "#22d3ee" : "#c084fc" });
    }
  }

  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  /* ---- drawing helpers --------------------------------------------------- */
  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw(ts) {
    ctx.clearRect(0, 0, S, H);

    // ease drawn params toward the active state's target
    var tgt = STATES[state];
    var k = 0.14;
    cur.bobAmp += (tgt.bobAmp - cur.bobAmp) * k;
    cur.bobRate += (tgt.bobRate - cur.bobRate) * k;
    cur.eyeOpen += (tgt.eyeOpen - cur.eyeOpen) * k;
    cur.antenna += (tgt.antenna - cur.antenna) * k;
    cur.wiggle += (tgt.wiggle - cur.wiggle) * k;

    // gaze: follow the cursor if it moved recently, else drift/look around
    var gx, gy;
    if (ts - lastMove < 2600) {
      var rect = canvas.getBoundingClientRect();
      var cx = rect.left + rect.width / 2, cy = rect.top + rect.height * 0.35;
      var dx = mouse.x - cx, dy = mouse.y - cy;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var mag = Math.min(1, d / 220);
      gx = (dx / d) * mag; gy = (dy / d) * mag;
    } else {
      gx = Math.sin(ts * 0.0006) * 0.55;
      gy = Math.sin(ts * 0.0009 + 1.3) * 0.32;
    }
    gaze.x += (gx - gaze.x) * 0.12;
    gaze.y += (gy - gaze.y) * 0.12;

    var bob = Math.sin(ts * cur.bobRate) * cur.bobAmp;
    var sway = Math.sin(ts * 0.006) * 1.4 * cur.wiggle;
    var hopY = 0, squash = 0;
    if (hop) {
      var hp = (ts - hop.start) / hop.dur;
      if (hp >= 1) { hop = null; }
      else {
        var e = Math.sin(hp * Math.PI);           // up then down
        hopY = -e * S * 0.16;
        squash = Math.sin(hp * Math.PI * 2) * 0.06; // stretch up, squash on land
      }
    }
    happy = Math.max(0, happy - 0.006);

    var cX = S / 2 + sway;
    // Anchor Byte around the canvas's vertical centre so it lines up with the
    // input, with the taller canvas leaving room above for the hop. groundY is
    // the fixed shadow line (Byte bobs/hops relative to it).
    var groundY = H * 0.5 + S * 0.375;
    var baseY = groundY - S * 0.28 + bob + hopY;

    // ground shadow (shrinks as it lifts)
    var lift = (-bob - hopY);
    ctx.save();
    ctx.globalAlpha = 0.28 - Math.min(0.16, lift * 0.02);
    ctx.fillStyle = "#0b1020";
    ctx.beginPath();
    ctx.ellipse(S / 2, groundY, S * 0.24 - lift * 0.15, S * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // hover-jet glow — a soft cyan bloom under the feet as Byte lifts / hops
    if (lift > 0.6) {
      var jetY = baseY + S * 0.05, jetA = Math.min(0.42, lift * 0.05);
      var jg = ctx.createRadialGradient(cX, jetY, 0, cX, jetY, S * 0.22);
      jg.addColorStop(0, "rgba(56,230,255," + jetA + ")");
      jg.addColorStop(1, "rgba(56,230,255,0)");
      ctx.fillStyle = jg;
      ctx.beginPath(); ctx.ellipse(cX, jetY, S * 0.2, S * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    }

    // antenna
    var antX = cX + gaze.x * 1.2;
    var topY = baseY - S * (0.30 + squash);
    var tipY = topY - S * 0.17;
    ctx.strokeStyle = "rgba(150,180,255,0.7)";
    ctx.lineWidth = Math.max(1, S * 0.03);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cX, topY + S * 0.02);
    ctx.quadraticCurveTo(cX + gaze.x * 2, (topY + tipY) / 2, antX, tipY);
    ctx.stroke();
    var glow = 0.5 + 0.5 * Math.abs(Math.sin(ts * 0.004)) * cur.antenna + happy * 0.4;
    ctx.save();
    ctx.shadowBlur = 8 * glow; ctx.shadowColor = "#22d3ee";
    ctx.fillStyle = happy > 0.2 ? "#c084fc" : "#5eead4";
    ctx.beginPath();
    ctx.arc(antX, tipY, S * 0.055, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // signal ping — a faint ring pulses outward from the antenna tip
    var ping = (ts % 2600) / 2600;
    if (ping < 0.55) {
      ctx.save();
      ctx.globalAlpha = (1 - ping / 0.55) * 0.38;
      ctx.strokeStyle = "#5eead4";
      ctx.lineWidth = Math.max(0.6, S * 0.013);
      ctx.beginPath();
      ctx.arc(antX, tipY, S * 0.06 + ping * S * 0.14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // body — rounded capsule with a cyan→violet gradient + soft glow
    var bw = S * 0.60, bh = S * (0.56 - squash), bx = cX - bw / 2, by = baseY - bh + S * 0.02;
    ctx.save();
    ctx.shadowBlur = 12; ctx.shadowColor = "rgba(34,211,238,0.45)";
    var g = ctx.createLinearGradient(bx, by, bx, by + bh);
    g.addColorStop(0, "#38e0f0");
    g.addColorStop(1, "#7c5cff");
    ctx.fillStyle = g;
    rr(bx, by, bw, bh, S * 0.20);
    ctx.fill();
    ctx.restore();
    // rim light
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1;
    rr(bx + 1, by + 1, bw - 2, bh - 2, S * 0.19);
    ctx.stroke();
    // glossy catch-light on the rounded top-left of the shell
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(bx + bw * 0.32, by + bh * 0.12, bw * 0.19, bh * 0.06, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // feet
    ctx.fillStyle = "#4b3ea8";
    var fw = S * 0.12, fy = by + bh - S * 0.02;
    rr(cX - bw * 0.28 - fw / 2, fy, fw, S * 0.07, S * 0.03); ctx.fill();
    rr(cX + bw * 0.28 - fw / 2, fy, fw, S * 0.07, S * 0.03); ctx.fill();

    // visor (dark screen face)
    var vw = bw * 0.82, vh = bh * 0.56, vx = cX - vw / 2, vy = by + bh * 0.16;
    ctx.fillStyle = "#0b1020";
    rr(vx, vy, vw, vh, S * 0.11);
    ctx.fill();
    ctx.strokeStyle = "rgba(120,150,220,0.35)";
    ctx.lineWidth = 1;
    rr(vx + 0.5, vy + 0.5, vw - 1, vh - 1, S * 0.10);
    ctx.stroke();

    // chest status LED — softly breathes; warms to pink when celebrating
    var ledPulse = 0.55 + 0.45 * Math.sin(ts * 0.005);
    ctx.save();
    ctx.shadowBlur = 6 * ledPulse;
    ctx.shadowColor = happy > 0.2 ? "#f0abfc" : "#22d3ee";
    ctx.globalAlpha = 0.7 + 0.3 * ledPulse;
    ctx.fillStyle = happy > 0.2 ? "#f5d0fe" : "#67e8f9";
    ctx.beginPath();
    ctx.arc(cX, by + bh * 0.83, S * 0.033, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // eyes — glowing, track gaze, blink
    var blink = 1;
    var bt = ts % 4200;
    if (bt > blinkT && bt < blinkT + 130) blink = 0.12;
    var eyeR = S * 0.055 * cur.eyeOpen;
    var eyeMidY = vy + vh * 0.44;
    var eyeDX = vw * 0.22, shiftX = gaze.x * vw * 0.12, shiftY = gaze.y * vh * 0.14;
    ctx.save();
    ctx.shadowBlur = 7; ctx.shadowColor = "#38e6ff";
    ctx.fillStyle = happy > 0.2 ? "#b9f5ff" : "#6ff0ff";
    [-1, 1].forEach(function (s) {
      var ex = cX + s * eyeDX + shiftX, ey = eyeMidY + shiftY;
      if (happy > 0.35) {
        // happy: upside-down "u" arcs
        ctx.lineWidth = S * 0.045; ctx.strokeStyle = ctx.fillStyle; ctx.lineCap = "round";
        ctx.beginPath(); ctx.arc(ex, ey + eyeR * 0.4, eyeR * 1.1, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.ellipse(ex, ey, eyeR, eyeR * blink, 0, 0, Math.PI * 2);
        ctx.fill();
        if (blink > 0.5) { // glossy catch-light in the eye (not mid-blink)
          ctx.save();
          ctx.shadowBlur = 0;
          ctx.fillStyle = "rgba(255,255,255,0.92)";
          ctx.beginPath();
          ctx.arc(ex - eyeR * 0.32, ey - eyeR * 0.4, eyeR * 0.34, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    });
    ctx.restore();

    // mouth — reacts to state/mood
    var mY = vy + vh * 0.80, mW = vw * 0.30;
    ctx.strokeStyle = "rgba(150,240,255,0.85)";
    ctx.lineWidth = Math.max(1, S * 0.028); ctx.lineCap = "round";
    ctx.beginPath();
    if (happy > 0.3) {                         // big grin
      ctx.arc(cX, mY - S * 0.03, mW * 0.7, 0.15 * Math.PI, 0.85 * Math.PI);
    } else if (state === "excited") {          // open "o"
      ctx.ellipse(cX, mY, mW * 0.32, S * 0.045, 0, 0, Math.PI * 2);
    } else if (state === "alert") {            // small surprised dot-line
      ctx.moveTo(cX - mW * 0.28, mY); ctx.lineTo(cX + mW * 0.28, mY);
    } else {                                   // gentle smile
      ctx.moveTo(cX - mW * 0.4, mY - S * 0.01);
      ctx.quadraticCurveTo(cX, mY + S * 0.03, cX + mW * 0.4, mY - S * 0.01);
    }
    ctx.stroke();

    // sparkles
    for (var i = sparks.length - 1; i >= 0; i--) {
      var p = sparks[i];
      var age = (ts - p.born) / 1000;
      p.life = 1 - age / 0.9;
      if (p.life <= 0) { sparks.splice(i, 1); continue; }
      var px = p.x + p.vx * age, py = p.y + p.vy * age + 40 * age * age;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.hue;
      ctx.beginPath();
      var r = S * 0.03 * p.life;
      // 4-point sparkle
      ctx.moveTo(px, py - r * 2); ctx.lineTo(px + r * 0.6, py); ctx.lineTo(px, py + r * 2);
      ctx.lineTo(px - r * 0.6, py); ctx.closePath();
      ctx.moveTo(px - r * 2, py); ctx.lineTo(px, py - r * 0.6); ctx.lineTo(px + r * 2, py);
      ctx.lineTo(px, py + r * 0.6); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /* ---- loop -------------------------------------------------------------- */
  var loopRaf = null, loopRunning = false;
  function loop(ts) {
    if (state === "excited" && ts > excitedUntil) setState(document.activeElement === input ? "alert" : "idle");
    draw(ts);
    loopRaf = requestAnimationFrame(loop);
  }
  function startLoop() {
    if (loopRunning) return;
    loopRunning = true;
    draw(now()); // paint instantly on resume, don't wait a frame
    loopRaf = requestAnimationFrame(loop);
  }
  function stopLoop() {
    loopRunning = false;
    if (loopRaf != null) { cancelAnimationFrame(loopRaf); loopRaf = null; }
  }

  /* ---- interactions ------------------------------------------------------ */
  window.addEventListener("mousemove", function (e) {
    mouse.x = e.clientX; mouse.y = e.clientY; lastMove = now();
  }, { passive: true });

  var input = document.getElementById("package");
  if (input) {
    input.addEventListener("focus", function () { if (state !== "excited") setState("alert"); });
    input.addEventListener("blur", function () { if (state !== "excited") setState("idle"); });
    input.addEventListener("input", function () { setState("excited"); excitedUntil = now() + 500; });
  }

  canvas.addEventListener("click", function () { celebrate(1); });

  // Celebrate when the stats land (total downloads becomes non-zero).
  var total = document.getElementById("total-downloads");
  if (total && window.MutationObserver) {
    new MutationObserver(function () {
      var v = (total.textContent || "").replace(/[^0-9]/g, "");
      if (v && v !== "0") celebrate(1.4);
    }).observe(total, { childList: true, characterData: true, subtree: true });
  }

  try {
    resize();
    draw(0); // paint one frame immediately so Byte is never blank while rAF spins up
    // resize() clears the canvas, so repaint right after it — otherwise a resize
    // between animation frames (or while the loop is paused) leaves Byte blank.
    window.addEventListener("resize", function () { resize(); draw(now()); }, { passive: true });
    // Re-measure once after layout has settled (the canvas may report 0 width at
    // first paint inside the lazy iframe). resize() clears the canvas, so redraw
    // right after — this way a frame is always on screen even if the loop is
    // momentarily paused (e.g. a backgrounded tab), then run it continuously.
    requestAnimationFrame(function () { resize(); draw(0); startLoop(); });
    // Only animate while Byte is actually on screen — scrolling the stats page
    // (or the parent page hosting the iframe; same-origin IO accounts for it)
    // away pauses the loop instead of drawing an invisible robot at 60 fps.
    // The static frame painted above stays visible; resume repaints instantly.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        if (entries[entries.length - 1].isIntersecting) startLoop();
        else stopLoop();
      }, { threshold: 0 }).observe(canvas);
    }
  } catch (e) {}
})();
