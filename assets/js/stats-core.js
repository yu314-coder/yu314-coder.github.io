/* =============================================================================
   stats-core.js — shared rendering primitives for the two stats pages
   (store-stats.html and pypi-stats.html).

   These pages show different things — app downloads by store, package
   downloads by index — but they are the same KIND of page, and they used to
   drift because each carried its own copy of the chart, the number formatting
   and the country list. Everything here is deliberately about SHAPE rather
   than subject: give it {date, value} rows and it draws them, whatever the
   values happen to mean.

   Anything store- or package-specific stays in the page that owns it.

   Exposed as window.StatsUI. No dependencies, no build step.
   ========================================================================== */
(function () {
  "use strict";
  var SVGNS = "http://www.w3.org/2000/svg";

  function el(tag, attrs, txt) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (txt != null) e.textContent = txt;
    return e;
  }
  function fmt(n) { return (n || 0).toLocaleString("en-US"); }
  function cssVar(n) {
    return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#4f7cff";
  }

  function toSeries(rows, field) {
    var cum = 0;
    return rows.map(function (r) { cum += r[field]; return { date: r.date, d: r[field], c: cum }; });
  }
  // Partner Center's "over time" export has a granularity dropdown (day / week
  // / month) — the CSV shape is identical either way, so infer which one this
  // export used from the actual date gaps rather than assuming weekly.
  function inferGranularity(rows) {
    if (!rows || rows.length < 2) return "period";
    var diffs = [];
    for (var i = 1; i < rows.length; i++) {
      diffs.push((new Date(rows[i].date) - new Date(rows[i - 1].date)) / 86400000);
    }
    diffs.sort(function (a, b) { return a - b; });
    var median = diffs[Math.floor(diffs.length / 2)];
    if (median <= 1.5) return "day";
    if (median <= 10) return "week";
    if (median <= 45) return "month";
    return "period";
  }

  function chart(series, perLabel, wrap) {
    wrap = wrap || document.querySelector(".ss-chartwrap");
    var W = Math.max(320, (wrap ? wrap.clientWidth : 800) - 32);
    var pad = { l: 52, r: 14, t: 14, b: 24 };
    var topH = 176, gap = 26, botH = 104;
    var H = pad.t + topH + gap + botH + pad.b;
    var iw = W - pad.l - pad.r, n = series.length;
    var topY = pad.t, botY = pad.t + topH + gap;

    var maxD = Math.max.apply(null, series.map(function (s) { return s.d; }).concat([1]));
    var maxC = Math.max.apply(null, series.map(function (s) { return s.c; }).concat([1]));
    var x  = function (i) { return pad.l + (n <= 1 ? iw / 2 : iw * i / (n - 1)); };
    var yD = function (v) { return topY + topH - topH * v / maxD; };
    var yC = function (v) { return botY + botH - botH * v / maxC; };

    var cPer = cssVar("--ss-series-1") || "#3987e5";
    var cCum = cssVar("--ss-series-2") || "#d95926";
    var cGrid = "rgba(140,150,170,0.16)", cAxis = "rgba(150,160,180,0.85)";
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, class: "ss-chart",
                          preserveAspectRatio: "xMidYMid meet", role: "img" });
    svg.style.height = H + "px";

    function panel(label, y0, h, maxV, colour) {
      [0, 0.5, 1].forEach(function (f) {
        var yy = y0 + h - h * f;
        svg.appendChild(el("line", { x1: pad.l, y1: yy, x2: W - pad.r, y2: yy,
                                     stroke: cGrid, "stroke-width": 1 }));
        svg.appendChild(el("text", { x: pad.l - 8, y: yy + 3, "text-anchor": "end",
                                     "font-size": 10, fill: cAxis }, fmt(Math.round(maxV * f))));
      });
      // Each panel names its own series, so identity never rests on colour alone.
      var t = el("text", { x: pad.l, y: y0 - 5, "font-size": 10.5, fill: colour,
                           "font-weight": 700 }, label);
      svg.appendChild(t);
    }
    panel(perLabel, topY, topH, maxD, cPer);
    panel("cumulative total", botY, botH, maxC, cCum);

    // Per-period bars. A 2px surface gap between neighbours keeps adjacent
    // weeks legible instead of reading as one solid block.
    var slot = iw / Math.max(n, 1);
    var bw = Math.max(1.5, Math.min(slot - 2, slot * 0.72));
    series.forEach(function (s, i) {
      var hh = topH * s.d / maxD;
      if (hh <= 0.2) return;
      svg.appendChild(el("rect", { x: x(i) - bw / 2, y: yD(s.d), width: bw,
                                   height: Math.max(1, hh), fill: cPer,
                                   rx: Math.min(2, bw / 2) }));
    });

    // Cumulative area + line.
    var areaD = "M" + x(0) + "," + (botY + botH), lineD = "";
    series.forEach(function (s, i) {
      areaD += " L" + x(i) + "," + yC(s.c);
      lineD += (i ? " L" : "M") + x(i) + "," + yC(s.c);
    });
    areaD += " L" + x(n - 1) + "," + (botY + botH) + " Z";
    svg.appendChild(el("path", { d: areaD, fill: cCum, opacity: 0.14 }));
    svg.appendChild(el("path", { d: lineD, fill: "none", stroke: cCum,
                                 "stroke-width": 2, "stroke-linejoin": "round",
                                 "stroke-linecap": "round" }));

    // x labels: first, middle, last -- shared by both panels.
    [0, Math.floor((n - 1) / 2), n - 1].forEach(function (i) {
      if (i < 0 || i >= n) return;
      svg.appendChild(el("text", { x: x(i), y: H - 7, "font-size": 10, fill: cAxis,
        "text-anchor": i === 0 ? "start" : (i === n - 1 ? "end" : "middle") }, series[i].date));
    });

    // Hover: one crosshair down both panels, so a week is read in both at once.
    var tip = el("g", { visibility: "hidden", "pointer-events": "none" });
    var rule = el("line", { stroke: "rgba(255,255,255,0.28)", "stroke-width": 1 });
    var dotD = el("circle", { r: 3.5, fill: cPer, stroke: "#141a27", "stroke-width": 2 });
    var dotC = el("circle", { r: 3.5, fill: cCum, stroke: "#141a27", "stroke-width": 2 });
    var trect = el("rect", { rx: 5, fill: "rgba(10,14,22,0.95)", stroke: "rgba(255,255,255,0.16)" });
    var ttxt = el("text", { "font-size": 11, fill: "#fff" });
    [rule, dotD, dotC, trect, ttxt].forEach(function (e) { tip.appendChild(e); });
    svg.appendChild(tip);

    var hit = el("rect", { x: pad.l, y: topY, width: iw, height: botY + botH - topY, fill: "transparent" });
    function move(px) {
      var i = Math.round((px - pad.l) / (iw / Math.max(n - 1, 1)));
      i = Math.max(0, Math.min(n - 1, i));
      var s = series[i], xi = x(i);
      rule.setAttribute("x1", xi); rule.setAttribute("x2", xi);
      rule.setAttribute("y1", topY); rule.setAttribute("y2", botY + botH);
      dotD.setAttribute("cx", xi); dotD.setAttribute("cy", yD(s.d));
      dotC.setAttribute("cx", xi); dotC.setAttribute("cy", yC(s.c));
      ttxt.textContent = s.date + "  ·  " + fmt(s.d) + "  ·  \u03a3 " + fmt(s.c);
      var tw = ttxt.getComputedTextLength ? ttxt.getComputedTextLength() + 16 : 170;
      var tx = Math.min(Math.max(xi - tw / 2, pad.l), W - pad.r - tw);
      var ty = topY + 2;
      trect.setAttribute("x", tx); trect.setAttribute("y", ty);
      trect.setAttribute("width", tw); trect.setAttribute("height", 21);
      ttxt.setAttribute("x", tx + 8); ttxt.setAttribute("y", ty + 15);
      tip.setAttribute("visibility", "visible");
    }
    function fromEvent(ev) {
      var r = svg.getBoundingClientRect();
      var pt = ev.touches ? ev.touches[0] : ev;
      move((pt.clientX - r.left) / r.width * W);
    }
    hit.addEventListener("mousemove", fromEvent);
    hit.addEventListener("touchmove", function (ev) { fromEvent(ev); ev.preventDefault(); }, { passive: false });
    hit.addEventListener("mouseleave", function () { tip.setAttribute("visibility", "hidden"); });
    svg.appendChild(hit);
    return svg;
  }

  // Country code -> readable name and flag, with no shipped lookup table.
  // Intl.DisplayNames is built into every browser this site supports; the
  // flag is just the two letters as regional-indicator codepoints. Both fall
  // back to the bare code rather than showing nothing.
  var REGION_NAMES = (function () {
    try { return new Intl.DisplayNames(["en"], { type: "region" }); }
    catch (e) { return null; }
  })();
  function countryName(cc) {
    if (!cc) return "Unknown";
    try { return (REGION_NAMES && REGION_NAMES.of(cc)) || cc; }
    catch (e) { return cc; }
  }
  function countryFlag(cc) {
    if (!cc || cc.length !== 2 || !/^[A-Z]{2}$/.test(cc)) return "\uD83C\uDF10";
    return String.fromCodePoint(
      0x1F1E6 + cc.charCodeAt(0) - 65, 0x1F1E6 + cc.charCodeAt(1) - 65);
  }

  // Ranked country list. `field` is whichever metric the caller is showing,
  // so the same builder serves downloads and (once Apple publishes them)
  // impressions.
  function geoBlock(title, items, field, unitWord) {
    if (!items || !items.length) return null;
    var wrap = document.createElement("div"); wrap.className = "ss-geo";
    wrap.innerHTML = '<p class="eyebrow eyebrow--rule" style="margin-bottom:.2rem">' + title + '</p>';
    var total = items.reduce(function (t, r) { return t + (r[field] || 0); }, 0);
    var max = Math.max.apply(null, items.map(function (r) { return r[field] || 0; }).concat([1]));
    var list = document.createElement("div"); list.className = "ss-geo-list";
    // A long tail of single-download countries is noise; show the ones that
    // carry the number and say plainly what was left off.
    var SHOWN = 12;
    items.slice(0, SHOWN).forEach(function (r) {
      var row = document.createElement("div"); row.className = "ss-geo-row";
      var pct = total ? Math.round(1000 * (r[field] || 0) / total) / 10 : 0;
      row.innerHTML =
        '<span class="ss-geo-flag">' + countryFlag(r.code) + '</span>' +
        '<span class="ss-geo-name"><b>' + countryName(r.code) + '</b>' +
          '<span class="ss-geo-track"><span class="ss-geo-bar" style="width:' +
            Math.max(2, Math.round(100 * (r[field] || 0) / max)) + '%"></span></span></span>' +
        '<span class="ss-geo-val" title="' + pct + '% of ' + unitWord + '">' + fmt(r[field]) + '</span>';
      list.appendChild(row);
    });
    wrap.appendChild(list);
    if (items.length > SHOWN) {
      var rest = items.slice(SHOWN).reduce(function (t, r) { return t + (r[field] || 0); }, 0);
      var more = document.createElement("p"); more.className = "ss-geo-more";
      more.textContent = "+ " + (items.length - SHOWN) + " more countries, " +
                         fmt(rest) + " " + unitWord + " between them";
      wrap.appendChild(more);
    }
    return wrap;
  }

  // One retry per snapshot. A dropped request used to be swallowed and the
  // app simply vanished from the tabs and the totals — a page built on
  // "these are the real numbers" silently showing a smaller one is the worst
  // way to fail. Anything still missing after the retry gets reported.
  function fetchApp(base, id) {
    function once() {
      return fetch(base + id + ".json?cb=" + Date.now() + "-" + Math.random().toString(36).slice(2))
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return once().then(function (d) { return d || once(); });
  }

  // Names that never arrived, said out loud above the numbers they'd have
  // changed, rather than left to look like the whole picture.
  function missingNote(container, names) {
    if (!names.length) return;
    var p = document.createElement("p");
    p.className = "ss-missing";
    p.textContent = names.length + (names.length > 1 ? " apps" : " app") +
      " couldn't be loaded (" + names.join(", ") + "), so the totals below are " +
      "incomplete. A reload usually fixes it.";
    container.insertBefore(p, container.firstChild);
  }

  window.StatsUI = {
    el: el, fmt: fmt, cssVar: cssVar,
    chart: chart, toSeries: toSeries, inferGranularity: inferGranularity,
    countryName: countryName, countryFlag: countryFlag, geoBlock: geoBlock,
    fetchJSON: fetchApp, missingNote: missingNote
  };
})();
