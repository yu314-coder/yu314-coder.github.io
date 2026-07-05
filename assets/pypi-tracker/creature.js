/* =============================================================================
   A small pixel-art companion that sits by the package search field —
   idles quietly, and perks up when you focus or type. Original character
   (not a reproduction of any existing mascot), drawn on a coarse grid so
   it reads as deliberately blocky/pixel rather than smooth vector art.
   Self-contained: safe to include even if #pypi-buddy isn't on the page.
   ============================================================================= */
(function () {
  "use strict";

  var canvas = document.getElementById("pypi-buddy");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var REDUCED = false;
  try { REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch (e) { REDUCED = false; }

  // 16x16 grid. B=body, D=outline, E=eye, W=belly, C=cheek, F=feet/hands
  // (reuses the outline color so extremities read as a darker accent).
  // Cool blue-violet to match the portfolio's own brand blue, not the
  // tracker's local cyan/purple accent.
  var SPRITE = [
    "................",
    "...DD......DD...",
    "..DBBD...DBBD...",
    "..DBBD...DBBD...",
    "...DD......DD...",
    "....DDDDDDDD....",
    "....DBBBBBBD....",
    "....DEEBBEED....",
    "...BDBBBBBBDB...",
    "..BBDBCBBCBDBB..",
    ".FFBDBWWWWBDBFF.",
    "....DBWWWWBD....",
    "....DBBBBBBD....",
    ".....BB..BB.....",
    ".....FF..FF.....",
    "................"
  ];
  var BLINK_ROW = 7;
  var BLINK_SPRITE = "....D--BB--D....";

  var PALETTE = {
    B: "#4f7bff", D: "#182449", E: "#ffffff", W: "#dbe6ff",
    C: "#ffb3d9", F: "#182449", "-": "#2748a3"
  };

  var GRID = 16;
  var size = 64;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    var rect = canvas.getBoundingClientRect();
    size = rect.width || 64;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  var state = "idle";       // idle | alert | typing
  var stateUntil = 0;       // ts after which "typing" reverts to "alert"
  var blinkAt = randomBlinkOffset();
  function randomBlinkOffset() { return 2600 + Math.random() * 2200; }

  function drawFrame(ts, bob, blinking, lean) {
    var cell = size / GRID;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(lean || 0, bob || 0);
    var rows = SPRITE;
    if (blinking) {
      rows = SPRITE.slice();
      rows[BLINK_ROW] = BLINK_SPRITE;
    }
    for (var y = 0; y < GRID; y++) {
      var row = rows[y];
      for (var x = 0; x < GRID; x++) {
        var ch = row[x];
        if (ch === ".") continue;
        ctx.fillStyle = PALETTE[ch] || "#4f7bff";
        ctx.fillRect(Math.round(x * cell), Math.round(y * cell), Math.ceil(cell) + 1, Math.ceil(cell) + 1);
      }
    }
    ctx.restore();
  }

  function loop(ts) {
    if (REDUCED) { drawFrame(0, 0, false, 0); return; }

    var bob = 0, lean = 0, blinking = false;

    if (state === "idle") {
      bob = Math.sin(ts / 900) * 1.6;
      blinking = (ts % 3800) > blinkAt && (ts % 3800) < blinkAt + 130;
    } else if (state === "alert") {
      bob = Math.sin(ts / 500) * 1.1 - 1;
      blinking = (ts % 2600) > 2350 && (ts % 2600) < 2470;
    } else if (state === "typing") {
      bob = Math.sin(ts / 130) * 1.3 - 1.5;
      lean = Math.sin(ts / 90) * 1.2;
      if (ts > stateUntil) state = "alert";
    }

    drawFrame(ts, bob, blinking, lean);
    requestAnimationFrame(loop);
  }

  function setState(next) {
    if (next === "typing") stateUntil = performance.now() + 260;
    if (state === "idle" && next !== "idle") blinkAt = randomBlinkOffset();
    state = next;
  }

  var input = document.getElementById("package");
  if (input) {
    input.addEventListener("focus", function () { setState("alert"); });
    input.addEventListener("blur", function () { setState("idle"); });
    input.addEventListener("input", function () { setState("typing"); });
  }

  try {
    resize();
    window.addEventListener("resize", resize, { passive: true });
    if (REDUCED) { drawFrame(0, 0, false, 0); }
    else { requestAnimationFrame(loop); }
  } catch (e) {}
})();
