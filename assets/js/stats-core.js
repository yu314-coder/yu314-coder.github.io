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

  /* Nice axis ticks: round numbers a person would choose, not maxV/2.
     1, 2, 2.5, 5 x 10^k covers every scale these pages show. */
  function niceTicks(maxV, count) {
    if (!(maxV > 0)) return [0, 1];
    var raw = maxV / Math.max(1, count);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    var out = [];
    for (var v = 0; v <= maxV + step * 0.001; v += step) out.push(v);
    if (out[out.length - 1] < maxV) out.push(out[out.length - 1] + step);
    return out;
  }

  /* A centred rolling mean. Daily download counts are spiky enough that the
     bars alone read as noise; the mean is what shows whether a thing is
     actually growing. Centred rather than trailing so a peak sits under its
     own bar instead of a week to the right. */
  function rollingMean(values, win) {
    var half = Math.floor(win / 2), out = [];
    for (var i = 0; i < values.length; i++) {
      var lo = Math.max(0, i - half), hi = Math.min(values.length - 1, i + half), sum = 0;
      for (var j = lo; j <= hi; j++) sum += values[j];
      out.push(sum / (hi - lo + 1));
    }
    return out;
  }

  /* Ticks a reader can orient by: the 1st of each month where the series is
     long enough for that to be sparse, otherwise evenly spaced dates. Three
     labels across three months tells you nothing about where you are. */
  function dateTicks(series, maxTicks) {
    var firsts = [];
    for (var i = 0; i < series.length; i++) {
      var d = series[i].date;
      if (i === 0 || d.slice(0, 7) !== series[i - 1].date.slice(0, 7)) firsts.push(i);
    }
    // Month firsts only when there are enough of them to actually label the
    // axis. Three months across 83 days gives three ticks, which is no better
    // than the arbitrary first/middle/last this replaced.
    if (firsts.length >= 5 && firsts.length <= maxTicks) return firsts;
    var step = Math.max(1, Math.ceil(series.length / Math.min(maxTicks, series.length)));
    var out = [];
    for (var k = 0; k < series.length; k += step) out.push(k);
    if (out[out.length - 1] !== series.length - 1) out.push(series.length - 1);
    return out;
  }

  var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function shortDate(iso) {
    var p = String(iso).split("-");
    return p.length >= 3 ? (MONTHS[+p[1] - 1] || p[1]) + " " + (+p[2]) : iso;
  }

  function chart(series, perLabel, wrap) {
    wrap = wrap || document.querySelector(".ss-chartwrap");
    var W = Math.max(320, (wrap ? wrap.clientWidth : 800) - 32);
    var n = series.length;

    var svgEmpty;
    if (!n) {
      svgEmpty = el("svg", { viewBox: "0 0 " + W + " 80", class: "ss-chart", role: "img" });
      svgEmpty.appendChild(el("text", { x: W / 2, y: 44, "text-anchor": "middle",
        "font-size": 12, fill: "rgba(150,160,180,0.85)" }, "No data for this range yet"));
      return svgEmpty;
    }

    var pad = { l: 54, r: 16, t: 18, b: 26 };
    var topH = 196, gap = 30, botH = 96;
    var H = pad.t + topH + gap + botH + pad.b;
    var iw = W - pad.l - pad.r;
    var topY = pad.t, botY = pad.t + topH + gap;

    var dVals = series.map(function (s) { return s.d; });
    var maxD = Math.max.apply(null, dVals.concat([1]));
    var maxC = Math.max.apply(null, series.map(function (s) { return s.c; }).concat([1]));
    var dTicks = niceTicks(maxD, 4), cTicks = niceTicks(maxC, 3);
    var topMax = dTicks[dTicks.length - 1], botMax = cTicks[cTicks.length - 1];

    var x  = function (i) { return pad.l + (n <= 1 ? iw / 2 : iw * i / (n - 1)); };
    var yD = function (v) { return topY + topH - topH * v / topMax; };
    var yC = function (v) { return botY + botH - botH * v / botMax; };

    var cPer = cssVar("--ss-series-1") || "#3987e5";
    var cCum = cssVar("--ss-series-2") || "#d95926";
    var cGrid = "rgba(140,150,170,0.14)", cAxis = "rgba(150,160,180,0.85)";
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, class: "ss-chart",
                          preserveAspectRatio: "xMidYMid meet", role: "img" });
    svg.style.height = H + "px";

    function panel(label, y0, h, ticks, maxV, colour) {
      ticks.forEach(function (v) {
        var yy = y0 + h - h * v / maxV;
        svg.appendChild(el("line", { x1: pad.l, y1: yy, x2: W - pad.r, y2: yy,
          stroke: cGrid, "stroke-width": 1 }));
        svg.appendChild(el("text", { x: pad.l - 8, y: yy + 3, "text-anchor": "end",
          "font-size": 10, fill: cAxis }, fmt(v)));
      });
      // Each panel names its own series, so identity never rests on colour.
      svg.appendChild(el("text", { x: pad.l, y: y0 - 6, "font-size": 10.5,
        fill: colour, "font-weight": 700 }, label));
    }
    panel(perLabel, topY, topH, dTicks, topMax, cPer);
    panel("cumulative total", botY, botH, cTicks, botMax, cCum);

    // Peak marker, drawn before the bars so the bar sits on top of the halo.
    var peak = 0;
    for (var pi = 1; pi < n; pi++) if (series[pi].d > series[peak].d) peak = pi;

    // Cap the bar width. Without a ceiling a short series turns each bar into
    // a slab — six points across a 1000px plot gives 123px bars that read as
    // blocks of colour rather than a chart. 34px is about where a bar still
    // looks like a bar.
    var slot = iw / Math.max(n, 1);
    var bw = Math.max(1.5, Math.min(slot - 2, slot * 0.74, 34));
    series.forEach(function (s, i) {
      var hh = (topH * s.d / topMax);
      if (hh <= 0.2) return;
      svg.appendChild(el("rect", { x: x(i) - bw / 2, y: yD(s.d), width: bw,
        height: Math.max(1, hh), fill: cPer,
        opacity: i === peak ? 1 : 0.78,
        rx: Math.min(2, bw / 2) }));
    });

    // Label the peak — the single most-asked question of a chart like this is
    // "what was the best day", and hunting for the tallest bar is a poor way
    // to answer it.
    if (series[peak].d > 0 && n > 4) {
      var px = x(peak), py = yD(series[peak].d) - 6;
      var lbl = fmt(series[peak].d);
      var anchor = px < pad.l + 24 ? "start" : (px > W - pad.r - 24 ? "end" : "middle");
      svg.appendChild(el("text", { x: px, y: Math.max(topY + 9, py), "text-anchor": anchor,
        "font-size": 10.5, "font-weight": 700, fill: cPer }, lbl));
    }

    // 7-day centred mean over the bars.
    if (n >= 7) {
      var mean = rollingMean(dVals, 7), md = "";
      mean.forEach(function (v, i) { md += (i ? " L" : "M") + x(i) + "," + yD(v); });
      svg.appendChild(el("path", { d: md, fill: "none", stroke: cPer,
        "stroke-width": 1.75, "stroke-linejoin": "round", "stroke-linecap": "round",
        opacity: 0.95, "stroke-dasharray": "0" }));
      svg.appendChild(el("text", { x: W - pad.r, y: topY - 6, "text-anchor": "end",
        "font-size": 10, fill: cAxis }, "line = 7-day average"));
    }

    // Cumulative area + line.
    var areaD = "M" + x(0) + "," + (botY + botH), lineD = "";
    series.forEach(function (s, i) {
      areaD += " L" + x(i) + "," + yC(s.c);
      lineD += (i ? " L" : "M") + x(i) + "," + yC(s.c);
    });
    areaD += " L" + x(n - 1) + "," + (botY + botH) + " Z";
    svg.appendChild(el("path", { d: areaD, fill: cCum, opacity: 0.14 }));
    svg.appendChild(el("path", { d: lineD, fill: "none", stroke: cCum,
      "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));

    // x labels, shared by both panels.
    dateTicks(series, 7).forEach(function (i, k, arr) {
      var anchor = i === 0 ? "start" : (i === n - 1 ? "end" : "middle");
      svg.appendChild(el("text", { x: x(i), y: H - 8, "font-size": 10, fill: cAxis,
        "text-anchor": anchor }, shortDate(series[i].date)));
      if (k && k < arr.length - 1) {
        svg.appendChild(el("line", { x1: x(i), y1: botY + botH, x2: x(i),
          y2: botY + botH + 4, stroke: cGrid, "stroke-width": 1 }));
      }
    });

    // Hover: one crosshair down both panels, so a day is read in both at once.
    var tip = el("g", { visibility: "hidden", "pointer-events": "none" });
    var rule = el("line", { stroke: "rgba(255,255,255,0.28)", "stroke-width": 1 });
    var dotD = el("circle", { r: 3.5, fill: cPer, stroke: "#141a27", "stroke-width": 2 });
    var dotC = el("circle", { r: 3.5, fill: cCum, stroke: "#141a27", "stroke-width": 2 });
    var trect = el("rect", { rx: 6, fill: "rgba(10,14,22,0.96)", stroke: "rgba(255,255,255,0.16)" });
    var tDate = el("text", { "font-size": 10.5, fill: "rgba(255,255,255,0.72)" });
    var tMain = el("text", { "font-size": 12, fill: "#fff", "font-weight": 700 });
    [rule, dotD, dotC, trect, tDate, tMain].forEach(function (e) { tip.appendChild(e); });
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
      tDate.textContent = s.date;
      tMain.textContent = fmt(s.d) + "   \u03a3 " + fmt(s.c);
      var w1 = tDate.getComputedTextLength ? tDate.getComputedTextLength() : 70;
      var w2 = tMain.getComputedTextLength ? tMain.getComputedTextLength() : 110;
      var tw = Math.max(w1, w2) + 18, th = 34;
      var tx = Math.min(Math.max(xi - tw / 2, pad.l), W - pad.r - tw);
      var ty = topY + 2;
      trect.setAttribute("x", tx); trect.setAttribute("y", ty);
      trect.setAttribute("width", tw); trect.setAttribute("height", th);
      tDate.setAttribute("x", tx + 9); tDate.setAttribute("y", ty + 13);
      tMain.setAttribute("x", tx + 9); tMain.setAttribute("y", ty + 27);
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
