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
  var viewMode = "storm";   // TRACK sub-view: "storm" (one track) | "season" (all)
  var appMode = "track";    // "track" (history) | "predict" (live JMA forecast)
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
    app: document.querySelector(".tt-app"),
    mode: document.getElementById("mode-select"),
    typhoonSelect: document.getElementById("jma-typhoon"),
    predictPanel: document.getElementById("tt-predict-panel"),
    predictHint: document.getElementById("tt-predict-hint"),
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
      buildChart();
      buildLegend();
      renderMap();
      updateReadout(true);
    }).catch(function () {
      els.map.innerHTML = '<p class="tt-error">Could not load that season’s track data.</p>';
    });
  }

  // Track-mode map: one storm's path, or the whole-season overview. (Forecast
  // mode renders separately, straight from live JMA data.)
  function renderMap() {
    if (viewMode === "season") buildSeasonOverview();
    else buildMap();
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

  // A circle polygon of radiusKm around a center — used to draw JMA's forecast
  // "probability circles" and current gale/storm wind areas.
  function circlePolygon(lat, lon, radiusKm) {
    var la = [], lo = [];
    for (var a = 0; a <= 360; a += 15) {
      var p = gcDest({ la: lat, lo: lon }, a, radiusKm);
      la.push(p.la); lo.push(p.lo);
    }
    return { lat: la, lon: lo };
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
      if (!ev.points || !ev.points.length) return;
      var p = ev.points[0];
      var sid = p.customdata || (p.data && p.data.meta);
      if (!sid) return;
      if (appMode === "track" && viewMode === "season") openStormBySid(sid);
    });
    mapClickBound = true;
  }
  // Open a storm in the Track view by its id (clicked from the season overview).
  function openStormBySid(sid) {
    var entry = indexData.find(function (s) { return s.sid === sid; });
    if (!entry) return;
    if (els.mode) els.mode.value = "track";
    setAppMode("track");
    setViewMode("storm");
    els.season.value = entry.season;
    populateStorms(entry.season);
    els.storm.value = sid;
    updateEnsoBadge();
    loadStorm(entry.season, sid);
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

  // Everything that moves as the scrubber advances: wind-radius rings, then
  // the current-position marker last (on top).
  function dynamicTraces() {
    var pt = interpAt(currentHour);
    return radiusTraces(pt).concat([currentPositionTrace(pt)]);
  }

  var STATIC_TRACES = 3; // track line, intensity markers, RI overlay
  function updateDynamic() {
    if (!currentStorm || appMode !== "track" || viewMode !== "storm") return;
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
     FORECAST mode — live official forecasts from the Japan Meteorological
     Agency (JMA). JMA publishes every active Western Pacific tropical cyclone
     as CORS-open JSON: an analysis position plus a 5-day forecast track, each
     forecast point carrying a probability circle of positional uncertainty.
     We fetch it straight from the browser and draw it. This is real forecast
     data, not a homemade approximation — it reissues every few hours.
     ------------------------------------------------------------------------- */
  var JMA_BASE = "https://www.jma.go.jp/bosai/typhoon/data/";
  var jmaCache = {};   // tcId -> parsed forecast
  var jmaList = [];    // parsed forecasts for all currently-active TCs

  var CAT_NAME = { TD: "Tropical Depression", TS: "Tropical Storm",
    STS: "Severe Tropical Storm", TY: "Typhoon", L: "Low", LO: "Low" };
  var CAT_COLOR = { TD: "rgb(150,190,215)", TS: "rgb(0,210,210)",
    STS: "rgb(255,170,0)", TY: "rgb(255,70,70)", L: "rgb(150,190,215)", LO: "rgb(150,190,215)" };
  var JMA_INTENSITY = { "猛烈な": "Violent", "非常に強い": "Very strong", "強い": "Strong" };
  var JMA_SCALE = { "超大型": "Very large", "大型": "Large" };
  var JMA_COURSE = {
    "北": "N", "北北東": "NNE", "北東": "NE", "東北東": "ENE", "東": "E",
    "東南東": "ESE", "南東": "SE", "南南東": "SSE", "南": "S", "南南西": "SSW",
    "南西": "SW", "西南西": "WSW", "西": "W", "西北西": "WNW", "北西": "NW", "北北西": "NNW",
    "ほとんど停滞": "nearly stationary", "停滞": "stationary", "不明": "unknown"
  };

  function num(v) { return (v == null || v === "" || isNaN(Number(v))) ? null : Number(v); }

  // Merge JMA's specifications.json (intensity/pressure/movement per point)
  // with forecast.json (the observed-track polyline) into one tidy object.
  function parseJma(tcId, spec, fc) {
    if (!spec || !spec.length) return null;
    var title = spec[0] || {};
    function maxRange(arr) {
      if (!arr || !arr.length) return null;
      return arr.reduce(function (m, a) { return (a.range && a.range.km > m) ? a.range.km : m; }, 0) || null;
    }
    var points = spec.slice(1).map(function (o) {
      var mw = o.maximumWind || {}, sus = mw.sustained || {}, gust = mw.gust || {};
      var pos = (o.position && o.position.deg) || [];
      return {
        h: o.advancedHours,
        lat: pos[0], lon: pos[1],
        pressure: num(o.pressure),
        windKt: sus.kt ? num(sus.kt) : null,
        gustKt: gust.kt ? num(gust.kt) : null,
        catEn: o.category ? o.category.en : "",
        intensity: JMA_INTENSITY[o.intensity] || "",
        scale: JMA_SCALE[o.scale] || "",
        circleKm: o.probabilityCircleRadius ? o.probabilityCircleRadius.km : null,
        course: JMA_COURSE[o.course] || o.course || "",
        speedKt: (o.speed && o.speed.kt) ? num(o.speed.kt) : null,
        location: o.location || "",
        valid: o.validtime || null,
        galeKm: maxRange(o.galeWarning),
        stormKm: maxRange(o.stormWarning)
      };
    }).filter(function (p) { return p.lat != null && p.lon != null; });

    var observed = [];
    var analysis = (fc || []).filter(function (o) { return o.track; })[0];
    if (analysis && analysis.track) {
      observed = (analysis.track.preTyphoon || []).concat(analysis.track.typhoon || []);
    }
    return {
      tcId: tcId,
      name: title.name || { en: tcId, jp: "" },
      number: title.typhoonNumber || "",
      issue: title.issue || null,
      points: points,
      observed: observed
    };
  }

  function fetchJmaTc(tcId) {
    if (jmaCache[tcId]) return Promise.resolve(jmaCache[tcId]);
    return Promise.all([
      fetch(JMA_BASE + tcId + "/specifications.json").then(function (r) { return r.json(); }),
      fetch(JMA_BASE + tcId + "/forecast.json").then(function (r) { return r.json(); })
    ]).then(function (res) {
      var p = parseJma(tcId, res[0], res[1]);
      if (p) jmaCache[tcId] = p;
      return p;
    }).catch(function () { return null; });
  }

  function loadForecastMode() {
    setForecastMessage("Loading live typhoon forecasts from JMA…");
    fetch(JMA_BASE + "targetTc.json")
      .then(function (r) { return r.json(); })
      .then(function (list) {
        if (!list || !list.length) { renderNoActive(); return null; }
        return Promise.all(list.map(function (t) { return fetchJmaTc(t.tropicalCyclone); }))
          .then(function (parsed) {
            jmaList = parsed.filter(Boolean);
            if (!jmaList.length) { renderNoActive(); return; }
            populateTyphoonSelect(jmaList);
            var def = jmaList.slice().sort(function (a, b) {
              return (a.points[0].pressure || 9999) - (b.points[0].pressure || 9999);
            })[0]; // default to the most intense (lowest central pressure)
            els.typhoonSelect.value = def.tcId;
            renderForecast(def);
          });
      })
      .catch(function () {
        setForecastMessage("Couldn’t reach JMA’s forecast service. It may be briefly unavailable — switch back to Track, or try Forecast again shortly.");
        if (els.typhoonSelect) els.typhoonSelect.innerHTML = "<option>—</option>";
        Plotly.react(els.map, [], geoLayout(), { displayModeBar: false, responsive: true, scrollZoom: true });
      });
  }

  function populateTyphoonSelect(list) {
    if (!els.typhoonSelect) return;
    els.typhoonSelect.innerHTML = list.map(function (d) {
      var a = d.points[0];
      return '<option value="' + d.tcId + '">' + d.name.en +
        " · " + (CAT_NAME[a.catEn] || a.catEn || "TC") +
        (d.number ? " (No." + d.number + ")" : "") + "</option>";
    }).join("");
  }

  function renderForecast(d) {
    if (!d) return;
    buildForecastMap(d);
    updateForecastPanel(d);
  }

  function renderNoActive() {
    if (els.typhoonSelect) els.typhoonSelect.innerHTML = "<option>None active</option>";
    Plotly.react(els.map, [], geoLayout(), { displayModeBar: false, responsive: true, scrollZoom: true });
    setForecastMessage("No active tropical cyclones. JMA isn’t tracking any storms in the Western Pacific right now — check back during a storm.");
  }

  function setForecastMessage(msg) {
    if (!els.predictPanel) return;
    els.predictPanel.innerHTML = '<div class="tt-pred-head"><span class="tt-details-name">JMA forecast</span></div>' +
      '<div class="tt-pred-foot">' + msg + "</div>";
  }

  function fmtLatLon(lat, lon) {
    return Math.abs(lat).toFixed(1) + "°" + (lat >= 0 ? "N" : "S") + " " +
           Math.abs(lon).toFixed(1) + "°" + (lon >= 0 ? "E" : "W");
  }

  function buildForecastMap(d) {
    currentGeoScale = DEFAULT_GEO.scale;
    var pts = d.points, a = pts[0];
    var traces = [];

    if (d.observed.length) {
      traces.push({ type: "scattergeo", mode: "lines",
        lat: d.observed.map(function (p) { return p[0]; }),
        lon: d.observed.map(function (p) { return p[1]; }),
        line: { color: "rgba(255,255,255,0.45)", width: 1.6 }, hoverinfo: "skip", showlegend: false });
    }
    if (a.galeKm) {
      var g = circlePolygon(a.lat, a.lon, a.galeKm);
      traces.push({ type: "scattergeo", mode: "lines", lat: g.lat, lon: g.lon,
        fill: "toself", fillcolor: "rgba(255,200,0,0.07)", line: { color: "rgba(255,200,0,0.5)", width: 1 },
        hoverinfo: "skip", showlegend: false });
    }
    if (a.stormKm) {
      var s = circlePolygon(a.lat, a.lon, a.stormKm);
      traces.push({ type: "scattergeo", mode: "lines", lat: s.lat, lon: s.lon,
        fill: "toself", fillcolor: "rgba(255,60,60,0.13)", line: { color: "rgba(255,60,60,0.6)", width: 1 },
        hoverinfo: "skip", showlegend: false });
    }
    pts.slice(1).forEach(function (p) {
      if (!p.circleKm) return;
      var c = circlePolygon(p.lat, p.lon, p.circleKm);
      traces.push({ type: "scattergeo", mode: "lines", lat: c.lat, lon: c.lon,
        fill: "toself", fillcolor: "rgba(124,58,237,0.10)", line: { color: "rgba(124,58,237,0.4)", width: 1 },
        hoverinfo: "skip", showlegend: false });
    });
    var flat = [a.lat], flon = [a.lon], ftext = ["now"];
    pts.slice(1).forEach(function (p) { flat.push(p.lat); flon.push(p.lon); ftext.push("+" + p.h + " h"); });
    traces.push({ type: "scattergeo", mode: "lines+markers", lat: flat, lon: flon,
      line: { color: "rgba(196,181,253,0.95)", width: 2, dash: "dot" },
      marker: { size: 6, color: "rgba(196,181,253,0.95)" },
      text: ftext, hoverinfo: "text", showlegend: false });
    traces.push({ type: "scattergeo", mode: "markers", lat: [a.lat], lon: [a.lon],
      marker: { size: 16, symbol: "circle-open", color: CAT_COLOR[a.catEn] || "#fff",
        line: { width: 3, color: CAT_COLOR[a.catEn] || "#fff" } },
      hoverinfo: "skip", showlegend: false });

    Plotly.react(els.map, traces, geoLayout(), { displayModeBar: false, responsive: true, scrollZoom: true });
  }

  function updateForecastPanel(d) {
    if (!els.predictPanel) return;
    var a = d.points[0];
    var catFull = CAT_NAME[a.catEn] || a.catEn || "Tropical cyclone";
    var badge = catFull + (a.intensity ? " · " + a.intensity : "") + (a.scale ? " · " + a.scale : "");
    var move = (a.course || "") + (a.speedKt != null ? " " + a.speedKt + " kt" : "");
    var rows = d.points.slice(1).map(function (p) {
      var when = p.valid ? p.valid.UTC.slice(5, 16).replace("T", " ") + "Z" : "";
      return '<div class="tt-fc-row"><span class="tt-fc-h">+' + p.h + "h</span>" +
        '<span class="tt-fc-when">' + when + "</span>" +
        '<span class="tt-fc-val">' + (p.pressure != null ? p.pressure + " hPa" : "—") +
        (p.windKt != null ? " · " + p.windKt + " kt" : "") + "</span>" +
        '<span class="tt-fc-circ">±' + (p.circleKm != null ? p.circleKm + " km" : "—") + "</span></div>";
    }).join("");
    var issued = d.issue ? d.issue.JST.replace("T", " ").slice(0, 16) : "";

    els.predictPanel.innerHTML =
      '<div class="tt-pred-head">' +
        '<span class="tt-details-name">' + d.name.en + (d.name.jp ? " " + d.name.jp : "") + "</span>" +
        '<span class="tt-details-time">JMA official forecast' + (d.number ? " · Typhoon No." + d.number : "") + "</span>" +
      "</div>" +
      '<div class="tt-fc-badge" style="color:' + (CAT_COLOR[a.catEn] || "#fff") + '">' + badge + "</div>" +
      '<div class="tt-details-grid">' +
        predItem("Pressure", a.pressure != null ? a.pressure + " hPa" : "—") +
        predItem("Max wind", a.windKt != null ? a.windKt + " kt" : "—") +
        predItem("Gusts", a.gustKt != null ? a.gustKt + " kt" : "—") +
        predItem("Moving", move || "—") +
      "</div>" +
      '<div class="tt-fc-pos">' + fmtLatLon(a.lat, a.lon) + (a.location ? " · " + a.location : "") + "</div>" +
      '<div class="tt-fc-subhead">5-day forecast (± = 70% probability circle)</div>' +
      '<div class="tt-fc-rows">' + (rows || '<div class="tt-fc-row">No forecast points issued.</div>') + "</div>" +
      '<div class="tt-pred-foot">Live from the <a href="https://www.jma.go.jp/bosai/map.html#contents=typhoon&lang=en" target="_blank" rel="noopener">Japan Meteorological Agency</a>' +
        (issued ? ", issued " + issued + " JST" : "") + ". Reissued every few hours while a storm is active.</div>";
  }

  function predItem(label, value, sub) {
    return '<div class="tt-details-item"><span class="tt-details-label">' + label +
      '</span><span class="tt-details-value tt-details-value--sm">' + value +
      (sub ? " <small>" + sub + "</small>" : "") + "</span></div>";
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

  /* ---- Track / Forecast mode plumbing ------------------------------------ */
  function setAppMode(mode) {
    appMode = mode;
    els.app.classList.toggle("mode-track", mode === "track");
    els.app.classList.toggle("mode-predict", mode === "predict");
    // the season-view chrome (hint, hidden panels) must only apply inside Track
    els.app.classList.toggle("is-season", mode === "track" && viewMode === "season");
    stopPlay();
    if (mode === "predict") { loadForecastMode(); }
    else if (viewMode === "season") { buildSeasonOverview(); }
    else if (currentStorm) { buildMap(); }
  }

  els.mode.addEventListener("change", function () { setAppMode(els.mode.value); });
  if (els.typhoonSelect) els.typhoonSelect.addEventListener("change", function () {
    var d = jmaCache[els.typhoonSelect.value];
    if (d) renderForecast(d);
  });

  /* ---- Track controls ---------------------------------------------------- */
  els.season.addEventListener("change", function () {
    populateStorms(els.season.value);
    updateEnsoBadge();
    if (appMode === "track" && viewMode === "season") { ensureSeasonThen(buildSeasonOverview); return; }
    if (els.storm.options.length) {
      els.storm.selectedIndex = 0;
      loadStorm(els.season.value, els.storm.value);
    }
  });
  els.storm.addEventListener("change", function () {
    if (appMode === "track" && viewMode === "season") setViewMode("storm");
    loadStorm(els.season.value, els.storm.value);
  });
  els.standard.addEventListener("change", function () {
    standard = els.standard.value;
    if (!currentStorm || appMode !== "track" || viewMode !== "storm") return;
    buildMap();
    buildChart();
    buildLegend();
    updateReadout();
  });
  [els.r34, els.r50, els.r64].forEach(function (cb) {
    cb.addEventListener("change", function () { if (currentStorm) updateDynamic(); });
  });
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
