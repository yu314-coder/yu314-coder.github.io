/* =============================================================================
   Typhoon Tracks — Western Pacific, IBTrACS v04r01, 2000-present.
   Self-contained (embedded via iframe in typhoon-tracks.html), matching the
   pypi-tracker app's pattern: its own HTML/CSS/JS, Plotly for the charts.
   ============================================================================= */
(function () {
  "use strict";

  var DATA_BASE = "../data/typhoons/";
  var DEFAULT_STORM = { name: "Haiyan", season: 2013 };
  var DEFAULT_GEO = { lon: 150, lat: 20, lonRange: [95, 205], latRange: [-2, 55], scale: 1 };
  var currentGeoScale = DEFAULT_GEO.scale;

  var indexData = [];
  var seasonCache = {};
  var climatology = null;   // per-year {count, ace, oni, phase, strongest}
  var currentStorm = null;
  var currentSid = null;
  var currentRI = null;     // last-computed rapid-intensification result
  var viewMode = "storm";   // "storm" (one track + details) | "season" (all tracks)
  var currentHour = 0;   // elapsed hours since the storm's first point — the
                          // scrubber's real unit, so equal drag distance always
                          // means equal TIME, regardless of how unevenly the
                          // underlying observations are spaced.
  var playRaf = null;
  var standard = "atlantic";

  var els = {
    season: document.getElementById("season-select"),
    storm: document.getElementById("storm-select"),
    standard: document.getElementById("standard-select"),
    r34: document.getElementById("show-r34"),
    r50: document.getElementById("show-r50"),
    r64: document.getElementById("show-r64"),
    forecast: document.getElementById("show-forecast"),
    app: document.querySelector(".tt-app"),
    viewStorm: document.getElementById("tt-view-storm"),
    viewSeason: document.getElementById("tt-view-season"),
    enso: document.getElementById("tt-enso"),
    clim: document.getElementById("tt-clim"),
    climChart: document.getElementById("tt-clim-chart"),
    stats: document.getElementById("tt-stats"),
    map: document.getElementById("tt-map"),
    zoomIn: document.getElementById("tt-zoom-in"),
    zoomOut: document.getElementById("tt-zoom-out"),
    zoomReset: document.getElementById("tt-zoom-reset"),
    chart: document.getElementById("tt-chart"),
    play: document.getElementById("tt-play"),
    slider: document.getElementById("tt-slider"),
    readout: document.getElementById("tt-time-readout"),
    legend: document.getElementById("tt-legend"),
    dName: document.getElementById("td-name"),
    dTime: document.getElementById("td-time"),
    dCat: document.getElementById("td-cat"),
    dWind: document.getElementById("td-wind"),
    dPres: document.getElementById("td-pres"),
    dPos: document.getElementById("td-pos"),
    dDvorak: document.getElementById("td-dvorak"),
    dR34: document.getElementById("td-r34"),
    dR50: document.getElementById("td-r50"),
    dR64: document.getElementById("td-r64")
  };

  var ATLANTIC_LEGEND = [
    ["C5 Super Typhoon", "rgb(255,0,0)"],
    ["C4 Very Strong Typhoon", "rgb(255,63,0)"],
    ["C3 Strong Typhoon", "rgb(255,127,0)"],
    ["C2 Typhoon", "rgb(255,191,0)"],
    ["C1 Typhoon", "rgb(255,255,0)"],
    ["Tropical Storm", "rgb(0,220,220)"],
    ["Tropical Depression", "rgb(150,190,215)"]
  ];
  var TAIWAN_LEGEND = [
    ["Strong Typhoon 強烈颱風", "rgb(255,0,0)"],
    ["Medium Typhoon 中度颱風", "rgb(255,127,0)"],
    ["Mild Typhoon 輕度颱風", "rgb(255,255,0)"],
    ["Tropical Depression", "rgb(150,190,215)"]
  ];

  /* ---------------------------------------------------------------------------
     Geometry: turn 4 quadrant radii (km) into a smooth closed polygon of
     lat/lon points around a center. Flat-earth approximation (fine at the
     ~50-300km scale of wind radii; not for precision navigation).
     ------------------------------------------------------------------------- */
  var EARTH_R_KM = 6371;

  function destPoint(lat0, lon0, bearingDeg, distKm) {
    var bearing = (bearingDeg * Math.PI) / 180;
    var lat0Rad = (lat0 * Math.PI) / 180;
    var dLat = (distKm * Math.cos(bearing)) / EARTH_R_KM;
    var cosLat0 = Math.cos(lat0Rad) || 0.0001;
    var dLon = (distKm * Math.sin(bearing)) / (EARTH_R_KM * cosLat0);
    return {
      lat: lat0 + (dLat * 180) / Math.PI,
      lon: lon0 + (dLon * 180) / Math.PI
    };
  }

  // quads = [NE, SE, SW, NW] at bearings 45/135/225/315. Missing quadrants
  // fall back to the average of whichever quadrants ARE reported.
  function radiusPolygon(lat0, lon0, quads, steps) {
    if (quads.every(function (v) { return v == null; })) return null;
    var avail = quads.filter(function (v) { return v != null; });
    var avg = avail.reduce(function (a, b) { return a + b; }, 0) / avail.length;
    var q = quads.map(function (v) { return v == null ? avg : v; });
    steps = steps || 72;
    var lats = [], lons = [];
    for (var i = 0; i <= steps; i++) {
      var bearing = (i / steps) * 360;
      var r;
      if (bearing <= 45) {
        var t0 = (bearing + 45) / 90;
        r = q[3] + (q[0] - q[3]) * t0;
      } else if (bearing <= 135) {
        r = q[0] + (q[1] - q[0]) * ((bearing - 45) / 90);
      } else if (bearing <= 225) {
        r = q[1] + (q[2] - q[1]) * ((bearing - 135) / 90);
      } else if (bearing <= 315) {
        r = q[2] + (q[3] - q[2]) * ((bearing - 225) / 90);
      } else {
        r = q[3] + (q[0] - q[3]) * ((bearing - 315) / 90);
      }
      var pt = destPoint(lat0, lon0, bearing, r);
      lats.push(pt.lat);
      lons.push(pt.lon);
    }
    return { lat: lats, lon: lons };
  }

  /* ---------------------------------------------------------------------------
     Time-based interpolation. Each stored point has "h" (hours elapsed since
     the storm's first point) and "t" (its own real observation time), but
     observations aren't evenly spaced — some gaps are 1h, some 6h. Querying
     by elapsed hours and lerping between the two bracketing points is what
     makes the scrubber behave like a real video timeline: a fixed drag
     distance always covers a fixed amount of storm-time.
     ------------------------------------------------------------------------- */
  function lerp(a, b, t) { return (a == null || b == null) ? null : a + (b - a) * t; }

  function lerpQuads(qa, qb, t) {
    if (!qa || !qb) return null;
    var out = [];
    for (var i = 0; i < 4; i++) out.push(lerp(qa[i], qb[i], t));
    return out.every(function (v) { return v == null; }) ? null : out;
  }

  function absTimeAt(hour) {
    var t0 = new Date(currentStorm.pts[0].t + "Z");
    return new Date(t0.getTime() + hour * 3600000);
  }

  function formatUTC(date) {
    // ISO "T" form, matching the raw stored point format (and the chart's
    // x-axis values) -- display code applies its own T->" " replace, same
    // as it already does for real (non-interpolated) points.
    return date.toISOString().slice(0, 19);
  }

  // Returns a virtual point at the given elapsed-hours position: numeric
  // fields (position, wind, pressure, radius quadrants) linearly interpolate
  // between the two bracketing real observations; categorical fields
  // (classification label/color) snap to whichever is nearer in time —
  // they can't be blended, and a jarring snap mid-transition would look
  // like a bug, so the snap point is placed at the midpoint between the two
  // real observations rather than always favoring one side.
  function interpAt(hour) {
    var pts = currentStorm.pts;
    var n = pts.length;
    if (hour <= pts[0].h) return pts[0];
    if (hour >= pts[n - 1].h) return pts[n - 1];
    var i = 0;
    while (i < n - 2 && pts[i + 1].h < hour) i++;
    var a = pts[i], b = pts[i + 1];
    var span = b.h - a.h;
    var t = span > 0 ? (hour - a.h) / span : 0;
    var pick = t < 0.5 ? a : b;
    return {
      t: formatUTC(absTimeAt(hour)),
      la: lerp(a.la, b.la, t),
      lo: lerp(a.lo, b.lo, t),
      w: lerp(a.w, b.w, t),
      p: lerp(a.p, b.p, t),
      ca: pick.ca, cc: pick.cc, ta: pick.ta, tc: pick.tc,
      r3: lerpQuads(a.r3, b.r3, t),
      r5: lerpQuads(a.r5, b.r5, t),
      r6: lerpQuads(a.r6, b.r6, t)
    };
  }

  /* ---------------------------------------------------------------------------
     Data loading
     ------------------------------------------------------------------------- */
  fetch(DATA_BASE + "index.json")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      indexData = data;
      populateSeasons();
      var def = indexData.find(function (s) {
        return s.name === DEFAULT_STORM.name && s.season === DEFAULT_STORM.season;
      }) || indexData[0];
      els.season.value = def.season;
      populateStorms(def.season);
      els.storm.value = def.sid;
      loadStorm(def.season, def.sid);
    })
    .catch(function () {
      els.map.innerHTML = '<p class="tt-error">Could not load typhoon track data.</p>';
    });

  fetch(DATA_BASE + "climatology.json")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      climatology = data;
      updateEnsoBadge();
    })
    .catch(function () { /* climatology is optional — the tracker still works */ });

  /* ---------------------------------------------------------------------------
     ENSO context + season climatology. ONI values are real NOAA CPC ASO
     figures baked into climatology.json; phase uses the standard ±0.5 cut.
     ------------------------------------------------------------------------- */
  var ENSO_LABEL = { nino: "El Niño", nina: "La Niña", neutral: "Neutral" };
  function updateEnsoBadge() {
    if (!els.enso) return;
    var c = climatology && climatology[els.season.value];
    if (!c || !c.phase || c.phase === "unknown") {
      els.enso.textContent = "—";
      els.enso.className = "tt-enso-badge";
      els.enso.removeAttribute("title");
      return;
    }
    var oni = c.oni != null ? (c.oni > 0 ? "+" : "") + c.oni.toFixed(1) : "n/a";
    els.enso.textContent = (ENSO_LABEL[c.phase] || "—") + " · ONI " + oni;
    els.enso.className = "tt-enso-badge tt-enso--" + c.phase;
    els.enso.title = "Autumn (Aug–Oct) ENSO state for this season — NOAA CPC ONI " +
      oni + ". El Niño seasons tend to spawn stronger, more recurving Pacific typhoons.";
  }

  var climBuilt = false;
  function buildClimChart() {
    if (climBuilt || !climatology || !els.climChart || typeof Plotly === "undefined") return;
    var years = Object.keys(climatology).map(Number).sort(function (a, b) { return a - b; });
    var counts = years.map(function (y) { return climatology[y].count; });
    var aces = years.map(function (y) { return climatology[y].ace; });
    var colors = years.map(function (y) {
      var p = climatology[y].phase;
      return p === "nino" ? "rgba(255,99,71,0.85)"
        : p === "nina" ? "rgba(56,152,255,0.85)"
        : "rgba(150,170,200,0.65)";
    });
    var hover = years.map(function (y) {
      var c = climatology[y], s = c.strongest;
      return y + "<br>" + c.count + " storms · ACE " + c.ace +
        "<br>" + (ENSO_LABEL[c.phase] || "—") + (c.oni != null ? " (ONI " + (c.oni > 0 ? "+" : "") + c.oni.toFixed(1) + ")" : "") +
        (s ? "<br>Strongest: " + s.name + " " + Math.round(s.maxWind) + " kt" : "") +
        "<extra></extra>";
    });
    // The plotly-geo bundle carries only scatter/scattergeo/choropleth — no
    // bar type — so storms-per-year is a line with per-year markers colored by
    // ENSO phase, which shows the El Niño/La Niña signal just as clearly.
    var traces = [
      { x: years, y: counts, type: "scatter", mode: "lines+markers", name: "Named storms",
        line: { color: "rgba(120,140,175,0.5)", width: 1.5 },
        marker: { color: colors, size: 9, line: { color: "rgba(10,14,20,0.7)", width: 0.5 } },
        hovertemplate: hover, yaxis: "y" },
      { x: years, y: aces, type: "scatter", mode: "lines", name: "ACE",
        line: { color: "rgba(168,85,247,0.9)", width: 2 }, yaxis: "y2",
        hovertemplate: "%{x}<br>ACE %{y}<extra></extra>" }
    ];
    var layout = {
      margin: { l: 38, r: 44, t: 6, b: 30 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#98a2bd", size: 11 },
      xaxis: { gridcolor: "rgba(255,255,255,0.05)" },
      yaxis: { title: "Storms", gridcolor: "rgba(255,255,255,0.06)", zeroline: false },
      yaxis2: { title: "ACE", overlaying: "y", side: "right", showgrid: false, zeroline: false },
      legend: { orientation: "h", y: 1.2, font: { color: "#98a2bd" } },
      height: 250
    };
    Plotly.react(els.climChart, traces, layout, { displayModeBar: false, responsive: true });
    els.climChart.on("plotly_click", function (ev) {
      if (!ev.points || !ev.points.length) return;
      var y = ev.points[0].x;
      if (!climatology[y]) return;
      els.season.value = y;
      populateStorms(y);
      updateEnsoBadge();
      if (viewMode === "season") { ensureSeasonThen(buildSeasonOverview); }
      else if (els.storm.options.length) { els.storm.selectedIndex = 0; loadStorm(y, els.storm.value); }
      if (els.map.scrollIntoView) els.map.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    climBuilt = true;
  }

  function populateSeasons() {
    var seasons = [];
    var seen = {};
    indexData.forEach(function (s) {
      if (!seen[s.season]) { seen[s.season] = true; seasons.push(s.season); }
    });
    seasons.sort(function (a, b) { return b - a; });
    els.season.innerHTML = seasons.map(function (s) {
      return '<option value="' + s + '">' + s + "</option>";
    }).join("");
  }

  function populateStorms(season) {
    var storms = indexData.filter(function (s) { return s.season === Number(season); });
    storms.sort(function (a, b) { return (b.maxWind || 0) - (a.maxWind || 0); });
    els.storm.innerHTML = storms.map(function (s) {
      return '<option value="' + s.sid + '">' + s.name + (s.nameZh ? " " + s.nameZh : "") +
        " — " + s.cat + " (" + Math.round(s.maxWind || 0) + "kt)" +
        (s.hasRadius ? "" : " · no radius data") + "</option>";
    }).join("");
  }

  function loadStorm(season, sid) {
    stopPlay();
    var p = seasonCache[season]
      ? Promise.resolve(seasonCache[season])
      : fetch(DATA_BASE + "seasons/" + season + ".json")
          .then(function (r) { return r.json(); })
          .then(function (d) { seasonCache[season] = d; return d; });

    p.then(function (seasonStorms) {
      var storm = seasonStorms[sid];
      if (!storm) return;
      currentStorm = storm;
      currentSid = sid;
      updateEnsoBadge();

      var maxH = 0, maxW = -1;
      storm.pts.forEach(function (pt) {
        var w = pt.w || 0;
        if (w > maxW) { maxW = w; maxH = pt.h; }
      });
      currentHour = maxH;
      els.slider.min = 0;
      els.slider.max = storm.pts[storm.pts.length - 1].h;
      els.slider.step = "any";
      els.slider.value = currentHour;

      els.dName.textContent = storm.name + (storm.nameZh ? "  " + storm.nameZh : "");

      buildStats();
      buildMap();
      buildChart();
      buildLegend();
      updateReadout(true);
    }).catch(function () {
      els.map.innerHTML = '<p class="tt-error">Could not load that season’s track data.</p>';
    });
  }

  /* ---------------------------------------------------------------------------
     Stats strip
     ------------------------------------------------------------------------- */
  function buildStats() {
    var pts = currentStorm.pts;
    var maxWind = Math.max.apply(null, pts.map(function (p) { return p.w || 0; }));
    var pressures = pts.map(function (p) { return p.p; }).filter(function (p) { return p != null; });
    var minPres = pressures.length ? Math.min.apply(null, pressures) : null;
    var start = pts[0].t ? pts[0].t.slice(0, 10) : "?";
    var end = pts[pts.length - 1].t ? pts[pts.length - 1].t.slice(0, 10) : "?";
    var days = (new Date(end) - new Date(start)) / 86400000;

    var ace = computeACE(pts);
    var ri = findRI(pts);

    var cards = [
      statCard("Peak wind", Math.round(maxWind) + " kt"),
      statCard("Min. pressure", minPres != null ? Math.round(minPres) + " mb" : "—"),
      statCard("ACE", ace.toFixed(1),
        "Accumulated Cyclone Energy (×10⁴ kt²) — Σ v² over 6-hourly points at ≥34 kt"),
      statCard("Duration", (days > 0 ? days.toFixed(1) : "?") + " days"),
      statCard("Track points", pts.length)
    ];
    if (ri.occurred) {
      cards.push(statCard("Rapid intensification", "+" + ri.peakRate + " kt/24h",
        "Peak 24-hour intensification — the RI stretch is highlighted in magenta on the track", true));
    }
    els.stats.innerHTML = cards.join("");
  }
  function statCard(label, value, title, hot) {
    return '<div class="tt-stat' + (hot ? " tt-stat--hot" : "") + '"' +
      (title ? ' title="' + title.replace(/"/g, "&quot;") + '"' : "") +
      '><div class="tt-stat-label">' + label +
      '</div><div class="tt-stat-value">' + value + "</div></div>";
  }

  /* ---------------------------------------------------------------------------
     Map
     ------------------------------------------------------------------------- */
  function catFields() {
    return standard === "taiwan" ? { label: "ta", color: "tc" } : { label: "ca", color: "cc" };
  }

  // Dvorak Current Intensity (CI) number -> 1-minute max sustained wind (kt),
  // the standard published table (Dvorak 1984 / operational JTWC use). We
  // only have archived best-track wind here, not satellite cloud imagery, so
  // the "T-number" shown is this table read in reverse and snapped to the
  // real convention's 0.5 steps -- a standard approximation, not an
  // independent analysis.
  var DVORAK_TABLE = [
    [1.0, 25], [1.5, 25], [2.0, 30], [2.5, 35], [3.0, 45], [3.5, 55],
    [4.0, 65], [4.5, 77], [5.0, 90], [5.5, 102], [6.0, 115], [6.5, 127],
    [7.0, 140], [7.5, 155], [8.0, 170]
  ];
  function dvorakTNumber(windKt) {
    if (windKt == null || isNaN(windKt)) return null;
    var lo = DVORAK_TABLE[0], hi = DVORAK_TABLE[DVORAK_TABLE.length - 1];
    if (windKt <= lo[1]) return lo[0];
    if (windKt >= hi[1]) return hi[0];
    for (var i = 0; i < DVORAK_TABLE.length - 1; i++) {
      var a = DVORAK_TABLE[i], b = DVORAK_TABLE[i + 1];
      if (windKt >= a[1] && windKt <= b[1]) {
        var t = (windKt - a[1]) / (b[1] - a[1]);
        return Math.round((a[0] + (b[0] - a[0]) * t) * 2) / 2;
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------------------
     Derived metrics — ACE, rapid intensification, and a persistence forecast.
     All computed from data already loaded; nothing is fetched or fabricated.
     ------------------------------------------------------------------------- */

  // Accumulated Cyclone Energy: 1e-4 · Σ v² over synoptic times (00/06/12/18Z)
  // where v ≥ 34 kt. The standard integrated-intensity metric for a storm.
  function computeACE(pts) {
    var total = 0;
    for (var i = 0; i < pts.length; i++) {
      var w = pts[i].w, t = pts[i].t || "";
      if (w == null || w < 34) continue;
      var hh = t.slice(11, 13);
      if (hh !== "00" && hh !== "06" && hh !== "12" && hh !== "18") continue;
      total += w * w;
    }
    return total * 1e-4;
  }

  // Rapid intensification: a ≥30 kt rise in max wind over any 24 h. Returns the
  // map-overlay geometry (bright segments where RI is underway), whether it
  // happened at all, and the peak 24 h rate for the stat note.
  function findRI(pts) {
    var n = pts.length;
    var active = new Array(n);
    var peakRate = 0;
    for (var i = 0; i < n; i++) {
      active[i] = false;
      if (pts[i].h < 24 || pts[i].w == null) continue;
      var prevW = interpAt(pts[i].h - 24).w;
      if (prevW == null) continue;
      var d = pts[i].w - prevW;
      if (d >= 30) { active[i] = true; if (d > peakRate) peakRate = d; }
    }
    // Draw a line through each run of RI-active points, including the point
    // just before a run so even a single RI point still renders as a segment.
    var lat = [], lon = [], any = false;
    for (var j = 0; j < n; j++) {
      if (active[j]) {
        any = true;
        if ((lat.length === 0 || lat[lat.length - 1] === null) && j > 0) {
          lat.push(pts[j - 1].la); lon.push(pts[j - 1].lo);
        }
        lat.push(pts[j].la); lon.push(pts[j].lo);
      } else if (lat.length && lat[lat.length - 1] !== null) {
        lat.push(null); lon.push(null);
      }
    }
    return { lat: lat, lon: lon, occurred: any, peakRate: Math.round(peakRate) };
  }

  // Great-circle helpers — accurate over the ~1000 km a forecast can span,
  // where the flat-earth radiusPolygon approximation would drift too far.
  function toRad(d) { return d * Math.PI / 180; }
  function toDeg(r) { return r * 180 / Math.PI; }
  function gcDist(a, b) {
    var dLat = toRad(b.la - a.la), dLon = toRad(b.lo - a.lo);
    var la1 = toRad(a.la), la2 = toRad(b.la);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function gcBearing(a, b) {
    var la1 = toRad(a.la), la2 = toRad(b.la), dLon = toRad(b.lo - a.lo);
    var y = Math.sin(dLon) * Math.cos(la2);
    var x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }
  function gcDest(a, bearingDeg, distKm) {
    var d = distKm / EARTH_R_KM, br = toRad(bearingDeg);
    var la1 = toRad(a.la), lo1 = toRad(a.lo);
    var la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br));
    var lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la1),
                               Math.cos(d) - Math.sin(la1) * Math.sin(la2));
    return { la: toDeg(la2), lo: ((toDeg(lo2) + 540) % 360) - 180 };
  }

  // Persistence baseline (a standard CLIPER-style reference forecast): assume
  // the storm holds its current heading and speed. This is NOT a skillful
  // forecast — it's the naive benchmark real forecasts are scored against,
  // shown so you can watch where simple extrapolation diverges from what the
  // storm actually did.
  var FORECAST_HOURS = [12, 24, 36, 48, 72];
  // Cone half-width = typical JTWC average track error at each lead time
  // (rounded, illustrative km — not a storm-specific error estimate).
  var TRACK_ERR = [[0, 0], [12, 55], [24, 100], [36, 150], [48, 195], [72, 295]];
  function errRadiusKm(h) {
    for (var i = 0; i < TRACK_ERR.length - 1; i++) {
      var a = TRACK_ERR[i], b = TRACK_ERR[i + 1];
      if (h >= a[0] && h <= b[0]) return a[1] + (b[1] - a[1]) * ((h - a[0]) / (b[0] - a[0]));
    }
    return TRACK_ERR[TRACK_ERR.length - 1][1];
  }
  function getMotion(hour) {
    var pts = currentStorm.pts, maxH = pts[pts.length - 1].h;
    var back = Math.min(6, hour), pA, pB, dt;
    if (back >= 1.5) { pA = interpAt(hour - back); pB = interpAt(hour); dt = back; }
    else {
      var fwd = Math.min(6, maxH - hour);
      if (fwd < 1.5) return null;
      pA = interpAt(hour); pB = interpAt(hour + fwd); dt = fwd;
    }
    var dist = gcDist(pA, pB);
    if (dist < 0.5) return { bearing: 0, speed: 0 };
    return { bearing: gcBearing(pA, pB), speed: dist / dt };
  }
  function forecastPath(hour) {
    var motion = getMotion(hour);
    if (!motion) return null;
    var start = interpAt(hour);
    var path = [{ la: start.la, lo: start.lo, h: 0 }];
    for (var i = 0; i < FORECAST_HOURS.length; i++) {
      var fh = FORECAST_HOURS[i];
      var d = gcDest(start, motion.bearing, motion.speed * fh);
      path.push({ la: d.la, lo: d.lo, h: fh });
    }
    return path;
  }
  function conePolygon(path) {
    var left = [], right = [];
    for (var i = 0; i < path.length; i++) {
      var heading = i === 0
        ? (path.length > 1 ? gcBearing(path[0], path[1]) : 0)
        : gcBearing(path[i - 1], path[i]);
      var e = errRadiusKm(path[i].h);
      left.push(gcDest(path[i], heading - 90, e));
      right.push(gcDest(path[i], heading + 90, e));
    }
    var last = path[path.length - 1], eLast = errRadiusKm(last.h);
    var endHeading = gcBearing(path[path.length - 2], last);
    var lat = [], lon = [];
    left.forEach(function (p) { lat.push(p.la); lon.push(p.lo); });
    for (var a = -90; a <= 90; a += 30) {           // rounded end cap
      var c = gcDest(last, endHeading + a, eLast);
      lat.push(c.la); lon.push(c.lo);
    }
    for (var k = right.length - 1; k >= 0; k--) { lat.push(right[k].la); lon.push(right[k].lo); }
    lat.push(left[0].la); lon.push(left[0].lo);
    return { lat: lat, lon: lon };
  }

  function buildMap() {
    currentGeoScale = DEFAULT_GEO.scale;
    var pts = currentStorm.pts;
    var f = catFields();

    var lats = pts.map(function (p) { return p.la; });
    var lons = pts.map(function (p) { return p.lo; });
    var colors = pts.map(function (p) { return p[f.color] || "rgb(150,190,215)"; });
    var hover = pts.map(function (p) {
      return (p.t || "").replace("T", " ") + "<br>" + (p.w != null ? p.w + " kt" : "n/a") +
        (p.p != null ? " · " + p.p + " mb" : "") + "<br>" + (p[f.label] || "");
    });

    var traces = [
      { // connecting line
        type: "scattergeo", mode: "lines", lat: lats, lon: lons,
        line: { color: "rgba(255,255,255,0.45)", width: 1.6 },
        hoverinfo: "skip", showlegend: false
      },
      { // per-point intensity markers
        type: "scattergeo", mode: "markers", lat: lats, lon: lons,
        marker: { size: 6, color: colors, line: { color: "rgba(10,14,20,0.6)", width: 0.5 } },
        text: hover, hoverinfo: "text", showlegend: false
      }
    ];

    // Static trace 2: rapid-intensification overlay (empty geometry if the
    // storm never underwent RI), so the dynamic block below always begins at
    // a fixed, known index.
    currentRI = findRI(pts);
    traces.push({
      type: "scattergeo", mode: "lines", lat: currentRI.lat, lon: currentRI.lon,
      line: { color: "rgba(255,64,196,0.95)", width: 4 },
      hoverinfo: "skip", showlegend: false
    });

    traces = traces.concat(dynamicTraces());

    Plotly.react(els.map, traces, geoLayout(), { displayModeBar: false, responsive: true, scrollZoom: true });
    bindMapClick();
  }

  function geoLayout() {
    return {
      geo: {
        projection: { type: "natural earth", scale: DEFAULT_GEO.scale },
        center: { lon: DEFAULT_GEO.lon, lat: DEFAULT_GEO.lat },
        lonaxis: { range: DEFAULT_GEO.lonRange.slice() },
        lataxis: { range: DEFAULT_GEO.latRange.slice() },
        showland: true, landcolor: "rgb(46,54,72)",
        showocean: true, oceancolor: "rgb(9,12,19)",
        showcountries: true, countrycolor: "rgba(255,255,255,0.14)",
        coastlinecolor: "rgba(255,255,255,0.22)",
        showframe: false,
        bgcolor: "rgba(0,0,0,0)"
      },
      margin: { l: 0, r: 0, t: 6, b: 0 },
      paper_bgcolor: "rgba(0,0,0,0)",
      showlegend: false,
      height: 460
    };
  }

  // Season overview: every track in the selected season at once, each colored
  // by its own peak-intensity category; the open storm is drawn boldest.
  function buildSeasonOverview() {
    var season = Number(els.season.value);
    var shard = seasonCache[season];
    if (!shard) return;
    currentGeoScale = DEFAULT_GEO.scale;
    var entries = indexData.filter(function (s) { return s.season === season; });
    var traces = [];
    entries.forEach(function (s) {
      var st = shard[s.sid];
      if (!st || !st.pts.length) return;
      var isSel = s.sid === currentSid;
      traces.push({
        type: "scattergeo", mode: "lines",
        lat: st.pts.map(function (p) { return p.la; }),
        lon: st.pts.map(function (p) { return p.lo; }),
        line: { color: s.color || "rgb(150,190,215)", width: isSel ? 3.4 : 1.5 },
        opacity: isSel ? 1 : 0.68,
        meta: s.sid,
        hovertemplate: s.name + (s.nameZh ? " " + s.nameZh : "") +
          "<br>" + s.cat + " · " + Math.round(s.maxWind || 0) + " kt<extra></extra>",
        showlegend: false
      });
    });
    if (!traces.length) {
      traces.push({ type: "scattergeo", mode: "lines", lat: [], lon: [], hoverinfo: "skip" });
    }
    Plotly.react(els.map, traces, geoLayout(), { displayModeBar: false, responsive: true, scrollZoom: true });
    bindMapClick();
  }

  var mapClickBound = false;
  function bindMapClick() {
    if (mapClickBound || !els.map.on) return;
    els.map.on("plotly_click", function (ev) {
      if (viewMode !== "season" || !ev.points || !ev.points.length) return;
      var sid = ev.points[0].data.meta;
      if (!sid) return;
      els.storm.value = sid;
      setViewMode("storm");
      loadStorm(els.season.value, sid);
    });
    mapClickBound = true;
  }

  function radiusTraces(pt) {
    var out = [];
    var bands = [
      { key: "r3", show: els.r34.checked, fill: "rgba(0,220,220,0.10)", line: "rgba(0,220,220,0.55)" },
      { key: "r5", show: els.r50.checked, fill: "rgba(255,180,0,0.14)", line: "rgba(255,180,0,0.6)" },
      { key: "r6", show: els.r64.checked, fill: "rgba(255,60,60,0.18)", line: "rgba(255,60,60,0.7)" }
    ];
    bands.forEach(function (b) {
      if (!b.show || !pt[b.key]) { out.push(emptyGeoTrace()); return; }
      var poly = radiusPolygon(pt.la, pt.lo, pt[b.key]);
      if (!poly) { out.push(emptyGeoTrace()); return; }
      out.push({
        type: "scattergeo", mode: "lines", lat: poly.lat, lon: poly.lon,
        fill: "toself", fillcolor: b.fill, line: { color: b.line, width: 1.2 },
        hoverinfo: "skip", showlegend: false
      });
    });
    return out;
  }

  function emptyGeoTrace() {
    return { type: "scattergeo", mode: "lines", lat: [], lon: [], hoverinfo: "skip", showlegend: false };
  }

  function currentPositionTrace(pt) {
    var f = catFields();
    return {
      type: "scattergeo", mode: "markers", lat: [pt.la], lon: [pt.lo],
      marker: { size: 15, symbol: "circle-open", color: pt[f.color] || "#fff", line: { width: 2.5, color: pt[f.color] || "#fff" } },
      hoverinfo: "skip", showlegend: false
    };
  }

  function forecastTraces() {
    if (!els.forecast || !els.forecast.checked) return [];
    var path = forecastPath(currentHour);
    if (!path) return [];
    var cone = conePolygon(path);
    var lat = path.map(function (p) { return p.la; });
    var lon = path.map(function (p) { return p.lo; });
    return [
      { type: "scattergeo", mode: "lines", lat: cone.lat, lon: cone.lon,
        fill: "toself", fillcolor: "rgba(124,58,237,0.13)",
        line: { color: "rgba(124,58,237,0.45)", width: 1 },
        hoverinfo: "skip", showlegend: false },
      { type: "scattergeo", mode: "lines+markers", lat: lat, lon: lon,
        line: { color: "rgba(196,181,253,0.9)", width: 1.8, dash: "dot" },
        marker: { size: 5, color: "rgba(196,181,253,0.95)" },
        text: path.map(function (p) { return p.h === 0 ? "now" : "+" + p.h + " h"; }),
        hoverinfo: "text", showlegend: false }
    ];
  }

  // Everything that moves as the scrubber advances: wind-radius rings, the
  // forecast cone/track, then the current-position marker last (on top).
  function dynamicTraces() {
    var pt = interpAt(currentHour);
    return radiusTraces(pt).concat(forecastTraces()).concat([currentPositionTrace(pt)]);
  }

  var STATIC_TRACES = 3; // track line, intensity markers, RI overlay
  function updateDynamic() {
    if (!currentStorm || viewMode !== "storm") return;
    var n = (els.map.data && els.map.data.length) || 0;
    var idx = [];
    for (var i = STATIC_TRACES; i < n; i++) idx.push(i);
    if (idx.length) Plotly.deleteTraces(els.map, idx);
    Plotly.addTraces(els.map, dynamicTraces());
  }

  /* ---------------------------------------------------------------------------
     Intensity-over-time chart
     ------------------------------------------------------------------------- */
  function buildChart() {
    var pts = currentStorm.pts;
    var f = catFields();
    var times = pts.map(function (p) { return p.t; });
    var winds = pts.map(function (p) { return p.w; });
    var pres = pts.map(function (p) { return p.p; });
    var colors = pts.map(function (p) { return p[f.color] || "rgb(150,190,215)"; });

    var traces = [
      {
        x: times, y: winds, type: "scatter", mode: "lines+markers", name: "Wind (kt)",
        line: { color: "rgba(255,255,255,0.35)", width: 1.5 },
        marker: { color: colors, size: 6 },
        yaxis: "y"
      },
      {
        x: times, y: pres, type: "scatter", mode: "lines", name: "Pressure (mb)",
        line: { color: "rgba(168,85,247,0.85)", width: 1.5, dash: "dot" },
        yaxis: "y2"
      }
    ];

    var layout = {
      margin: { l: 46, r: 46, t: 10, b: 34 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#98a2bd", size: 11 },
      xaxis: { gridcolor: "rgba(255,255,255,0.06)", showline: false },
      yaxis: { title: "Wind (kt)", gridcolor: "rgba(255,255,255,0.06)", zeroline: false },
      yaxis2: { title: "Pressure (mb)", overlaying: "y", side: "right", showgrid: false },
      legend: { orientation: "h", y: 1.12, font: { color: "#98a2bd" } },
      height: 220,
      shapes: [currentTimeLine()]
    };

    Plotly.react(els.chart, traces, layout, { displayModeBar: false, responsive: true });
  }

  function currentTimeLine() {
    var t = formatUTC(absTimeAt(currentHour));
    return {
      type: "line", x0: t, x1: t, y0: 0, y1: 1, yref: "paper",
      line: { color: "rgba(255,255,255,0.55)", width: 1, dash: "dash" }
    };
  }

  function updateChartMarker() {
    Plotly.relayout(els.chart, { shapes: [currentTimeLine()] });
  }

  /* ---------------------------------------------------------------------------
     Legend + readout
     ------------------------------------------------------------------------- */
  function buildLegend() {
    var list = standard === "taiwan" ? TAIWAN_LEGEND : ATLANTIC_LEGEND;
    els.legend.innerHTML = list.map(function (item) {
      return '<span class="tt-legend-item"><span class="tt-legend-swatch" style="background:' +
        item[1] + '"></span>' + item[0] + "</span>";
    }).join("");
  }

  // animate=true only for a genuine jump (loading a different storm) — see
  // the note above tweenNumber for why continuous scrub/play must NOT animate.
  function updateReadout(animate) {
    var pt = interpAt(currentHour);
    var f = catFields();
    els.readout.textContent = (pt.t || "").replace("T", " ") +
      "  ·  " + (pt.w != null ? Math.round(pt.w) + " kt" : "n/a") +
      (pt.p != null ? "  ·  " + Math.round(pt.p) + " mb" : "") +
      "  ·  " + (pt[f.label] || "unclassified");
    updateDetailsPanel(pt, f, !!animate);
  }

  /* ---------------------------------------------------------------------------
     Live details panel. Numbers tween on a genuine jump (picking a different
     storm snaps straight to its peak) but update INSTANTLY during scrubbing
     or playback. That split matters: during continuous scrub/play this is
     called on every slider "input" event or every animation frame, far
     faster than a 320ms tween can finish. Each call was cancelling the
     previous tween before it ever rendered a frame — the field only ever
     showed its very first synchronous write, appearing completely frozen
     until the movement stopped and one call finally survived long enough to
     animate. Since interpAt() already makes the underlying value change
     smoothly as currentHour advances, instant updates during scrub/play
     look exactly as smooth as the motion driving them — no easing needed
     on top. Each field keeps its own token so a new tween for the same key
     still invalidates the last one, for the jump case.
     ------------------------------------------------------------------------- */
  var tweenState = {};
  function tweenNumber(key, el, toVal, decimals, suffix, animate) {
    if (toVal == null || isNaN(toVal)) {
      tweenState[key] = null;
      el.textContent = "—";
      return;
    }
    if (!animate) {
      tweenState[key] = { current: toVal, token: null };
      el.textContent = toVal.toFixed(decimals) + (suffix || "");
      return;
    }
    var prev = tweenState[key];
    var fromVal = prev && prev.current != null ? prev.current : toVal;
    var token = {};
    tweenState[key] = { current: fromVal, token: token };
    var duration = 320;

    // Write the starting frame synchronously — the field must never depend
    // on a rAF callback firing just to show *a* value (a backgrounded tab,
    // or simply the very first paint, would otherwise leave it blank).
    el.textContent = fromVal.toFixed(decimals) + (suffix || "");
    if (fromVal === toVal) return;

    var start = null;
    function step(ts) {
      if (!tweenState[key] || tweenState[key].token !== token) return;
      if (start === null) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      var val = fromVal + (toVal - fromVal) * eased;
      tweenState[key].current = val;
      el.textContent = val.toFixed(decimals) + (suffix || "");
      if (p < 1) {
        requestAnimationFrame(step);
      } else {
        tweenState[key].current = toVal;
        el.textContent = toVal.toFixed(decimals) + (suffix || "");
      }
    }
    requestAnimationFrame(step);
  }

  function avgRadius(quads) {
    if (!quads) return null;
    var avail = quads.filter(function (v) { return v != null; });
    return avail.length ? avail.reduce(function (a, b) { return a + b; }, 0) / avail.length : null;
  }

  function updateDetailsPanel(pt, f, animate) {
    els.dTime.textContent = pt.t ? pt.t.replace("T", " ") : "—";

    var catLabel = pt[f.label] || "Unclassified";
    var catColor = pt[f.color] || "rgb(150,190,215)";
    els.dCat.textContent = catLabel;
    els.dCat.style.color = catColor;
    els.dCat.style.background = catColor.replace("rgb(", "rgba(").replace(")", ",0.16)");

    tweenNumber("wind", els.dWind, pt.w, 0, "", animate);
    tweenNumber("pres", els.dPres, pt.p, 0, "", animate);
    tweenNumber("dvorak", els.dDvorak, dvorakTNumber(pt.w), 1, "", animate);

    els.dPos.textContent =
      (pt.la != null ? Math.abs(pt.la).toFixed(1) + "°" + (pt.la >= 0 ? "N" : "S") : "—") +
      "   " +
      (pt.lo != null ? Math.abs(pt.lo).toFixed(1) + "°" + (pt.lo >= 0 ? "E" : "W") : "—");

    tweenNumber("r34", els.dR34, avgRadius(pt.r3), 0, " km", animate);
    tweenNumber("r50", els.dR50, avgRadius(pt.r5), 0, " km", animate);
    tweenNumber("r64", els.dR64, avgRadius(pt.r6), 0, " km", animate);
  }

  /* ---------------------------------------------------------------------------
     Controls
     ------------------------------------------------------------------------- */
  // Load a season's shard (if not cached) then run a callback — used by the
  // season-overview mode, which needs the full shard rather than one storm.
  function ensureSeasonThen(cb) {
    var season = els.season.value;
    if (seasonCache[season]) { cb(); return; }
    fetch(DATA_BASE + "seasons/" + season + ".json")
      .then(function (r) { return r.json(); })
      .then(function (d) { seasonCache[season] = d; cb(); })
      .catch(function () {});
  }

  function setViewMode(mode) {
    viewMode = mode;
    if (els.app) els.app.classList.toggle("is-season", mode === "season");
    if (els.viewStorm) {
      els.viewStorm.classList.toggle("is-active", mode === "storm");
      els.viewStorm.setAttribute("aria-pressed", String(mode === "storm"));
    }
    if (els.viewSeason) {
      els.viewSeason.classList.toggle("is-active", mode === "season");
      els.viewSeason.setAttribute("aria-pressed", String(mode === "season"));
    }
    if (mode === "season") { stopPlay(); ensureSeasonThen(buildSeasonOverview); }
    else if (currentStorm) { buildMap(); }
  }
  if (els.viewStorm) els.viewStorm.addEventListener("click", function () { setViewMode("storm"); });
  if (els.viewSeason) els.viewSeason.addEventListener("click", function () { setViewMode("season"); });

  els.season.addEventListener("change", function () {
    populateStorms(els.season.value);
    updateEnsoBadge();
    if (viewMode === "season") { ensureSeasonThen(buildSeasonOverview); return; }
    if (els.storm.options.length) {
      els.storm.selectedIndex = 0;
      loadStorm(els.season.value, els.storm.value);
    }
  });
  els.storm.addEventListener("change", function () {
    if (viewMode === "season") setViewMode("storm");
    loadStorm(els.season.value, els.storm.value);
  });
  els.standard.addEventListener("change", function () {
    standard = els.standard.value;
    if (!currentStorm || viewMode !== "storm") return;
    buildMap();
    buildChart();
    buildLegend();
    updateReadout();
  });
  [els.r34, els.r50, els.r64].forEach(function (cb) {
    cb.addEventListener("change", function () { if (currentStorm) updateDynamic(); });
  });
  if (els.forecast) els.forecast.addEventListener("change", function () { if (currentStorm) updateDynamic(); });
  els.slider.addEventListener("input", function () {
    stopPlay();
    currentHour = Number(els.slider.value);
    updateDynamic();
    updateChartMarker();
    updateReadout();
  });
  els.play.addEventListener("click", togglePlay);

  // Build the climatology chart the first time its panel is opened (a collapsed
  // <details> has zero width, which would make Plotly lay it out wrong).
  if (els.clim) {
    els.clim.addEventListener("toggle", function () {
      if (els.clim.open) { buildClimChart(); if (typeof Plotly !== "undefined") Plotly.Plots.resize(els.climChart); }
    });
  }

  /* ---------------------------------------------------------------------------
     Map zoom — scroll/pinch already works (scrollZoom is on), these buttons
     make it discoverable and give touch/trackpad users an explicit control.
     ------------------------------------------------------------------------- */
  function zoomBy(factor) {
    currentGeoScale = Math.max(0.5, Math.min(currentGeoScale * factor, 20));
    Plotly.relayout(els.map, { "geo.projection.scale": currentGeoScale });
  }
  els.zoomIn.addEventListener("click", function () { zoomBy(1.5); });
  els.zoomOut.addEventListener("click", function () { zoomBy(1 / 1.5); });
  els.zoomReset.addEventListener("click", function () {
    currentGeoScale = DEFAULT_GEO.scale;
    Plotly.relayout(els.map, {
      "geo.projection.scale": DEFAULT_GEO.scale,
      "geo.center": { lon: DEFAULT_GEO.lon, lat: DEFAULT_GEO.lat },
      "geo.lonaxis.range": DEFAULT_GEO.lonRange.slice(),
      "geo.lataxis.range": DEFAULT_GEO.latRange.slice()
    });
  });

  // Every storm plays out in the same real-world duration (~18s) regardless
  // of how many days it actually lasted, so short and long-lived storms
  // both feel like a normal-length clip rather than a rushed or endless one.
  var PLAYBACK_SECONDS = 18;

  function togglePlay() {
    if (playRaf) { stopPlay(); return; }
    if (currentHour >= Number(els.slider.max)) currentHour = 0;
    els.play.textContent = "⏸";
    els.play.setAttribute("aria-label", "Pause track animation");
    var lastTs = null;
    var totalHours = Number(els.slider.max);
    var rate = totalHours / PLAYBACK_SECONDS;
    function tick(ts) {
      var dt = lastTs == null ? 0 : Math.min((ts - lastTs) / 1000, 0.25);
      lastTs = ts;
      currentHour += rate * dt;
      if (currentHour >= totalHours) { currentHour = totalHours; }
      els.slider.value = currentHour;
      updateDynamic();
      updateChartMarker();
      updateReadout();
      if (currentHour >= totalHours) { stopPlay(); return; }
      playRaf = requestAnimationFrame(tick);
    }
    playRaf = requestAnimationFrame(tick);
  }
  function stopPlay() {
    if (playRaf) { cancelAnimationFrame(playRaf); playRaf = null; }
    els.play.textContent = "▶";
    els.play.setAttribute("aria-label", "Play track animation");
  }
})();
