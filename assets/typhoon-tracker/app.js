/* =============================================================================
   Typhoon Tracks — Western Pacific, IBTrACS v04r01, 2000-present.
   Self-contained (embedded via iframe in typhoon-tracks.html), matching the
   pypi-tracker app's pattern: its own HTML/CSS/JS, Plotly for the charts.
   ============================================================================= */
(function () {
  "use strict";

  var DATA_BASE = "../data/typhoons/";
  var DATA_V = "?v=20260716e";   // bump when the season/index JSON is regenerated (e.g. RMW added)
  var DEFAULT_STORM = { name: "Haiyan", season: 2013 };
  var DEFAULT_GEO = { lon: 150, lat: 20, lonRange: [95, 205], latRange: [-2, 55], scale: 1 };
  var currentGeoScale = DEFAULT_GEO.scale;

  var indexData = [];
  var seasonCache = {};
  var climatology = null;   // per-year {count, ace, oni, phase, strongest}
  var currentStorm = null;
  var currentSid = null;
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
    fcPlay: document.getElementById("tt-fc-play"),
    fcReplay: document.getElementById("tt-fc-replay"),
    fcSpeed: document.getElementById("tt-fc-speed"),
    aiBtn: document.getElementById("tt-ai-btn"),
    aiStatus: document.getElementById("tt-ai-status"),
    hindcastBtn: document.getElementById("tt-hindcast-btn"),
    consensusBtn: document.getElementById("tt-consensus-btn"),
    hindcastStatus: document.getElementById("tt-hindcast-status"),
    fcSlider: document.getElementById("tt-fc-slider"),
    fcTime: document.getElementById("tt-fc-time"),
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
    ["C5 Super Typhoon", "rgb(240,0,150)"],
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
  fetch(DATA_BASE + "index.json" + DATA_V)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      indexData = data;
      // index ships only maxWind; derive each storm's peak category/color here
      // (same rule buildStormEntry uses) so the file stays small.
      for (var ii = 0; ii < indexData.length; ii++) {
        var iac = atlanticCat(indexData[ii].maxWind);
        indexData[ii].cat = iac[0] || "Tropical Depression";
        indexData[ii].color = iac[1] || "rgb(150,190,215)";
      }
      populateSeasons();
      var def = indexData.find(function (s) {
        return s.name === DEFAULT_STORM.name && s.season === DEFAULT_STORM.season;
      }) || indexData[0];
      els.season.value = def.season;
      populateStorms(def.season);
      els.storm.value = def.sid;
      loadStorm(def.season, def.sid);
      fetchNoaaActive();   // live NOAA top-up of currently-active storms
    })
    .catch(function () {
      els.map.innerHTML = '<p class="tt-error">Could not load typhoon track data.</p>';
    });

  fetch(DATA_BASE + "climatology.json" + DATA_V)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      climatology = data;
      updateEnsoBadge();
    })
    .catch(function () { /* climatology is optional — the tracker still works */ });

  /* ---------------------------------------------------------------------------
     LIVE top-up straight from NOAA. The baked season shards only know storms
     up to when they were generated — NOAA NCEI's IBTrACS "ACTIVE storms" CSV
     (CORS-open, ~48 KB, refreshed with the provisional working best track
     several times a week) carries every currently-active storm's full track.
     We fetch it in the browser, convert WP storms to the exact shard format,
     and overlay them: new storms appear in the pickers, already-known ones
     get their freshest points. Best-effort — if the fetch fails, the static
     data behaves exactly as before.
     ------------------------------------------------------------------------- */
  var NOAA_ACTIVE = "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.ACTIVE.list.v04r01.csv";
  var liveStorms = {};   // sid -> { season, storm } in shard format

  // Category boundaries reproduced from the shard generator (verified against
  // every wind/category pair in the baked data).
  function atlanticCat(w) {
    if (w == null) return [null, null];
    if (w < 34) return ["Tropical Depression", "rgb(150,190,215)"];
    if (w < 64) return ["Tropical Storm", "rgb(0,220,220)"];
    if (w < 83) return ["C1 Typhoon", "rgb(255,255,0)"];
    if (w < 96) return ["C2 Typhoon", "rgb(255,191,0)"];
    if (w < 113) return ["C3 Strong Typhoon", "rgb(255,127,0)"];
    if (w < 137) return ["C4 Very Strong Typhoon", "rgb(255,63,0)"];
    return ["C5 Super Typhoon", "rgb(240,0,150)"];   // magenta — distinct from C4 orange-red
  }
  // CWA (Taiwan) thresholds are defined on 10-MINUTE mean winds: 輕度 17.2,
  // 中度 32.7, 強烈 51.0 m/s. Classifying converted 1-minute winds is only an
  // approximation (agencies' analyses genuinely differ — Doksuri 2023 reads
  // Strong for ~36h that way, while CWA's own calls were mostly Medium), so
  // the shards now carry JMA's REAL 10-minute analysis per point (wj, kt) —
  // the same averaging convention CWA uses — and the Taiwan standard is
  // classified on that. The 0.88-converted 1-min wind is only the fallback
  // for storms with no 10-minute record at all.
  var KT_TO_MS = 0.514444, ONE_MIN_TO_TEN_MIN = 0.88;
  function taiwanCatMs10(ms10) {
    if (ms10 == null) return [null, null];
    if (ms10 < 17.2) return ["Tropical Depression", "rgb(150,190,215)"];
    if (ms10 < 32.7) return ["Mild Typhoon 輕度颱風", "rgb(255,255,0)"];
    if (ms10 < 51.0) return ["Medium Typhoon 中度颱風", "rgb(255,127,0)"];
    return ["Strong Typhoon 強烈颱風", "rgb(255,0,0)"];
  }
  function taiwanCat(w) {   // fallback: converted 1-min wind
    return taiwanCatMs10(w == null ? null : w * ONE_MIN_TO_TEN_MIN * KT_TO_MS);
  }
  // Reconstruct BOTH classification standards per point (the shards ship only
  // wind — ca/cc/ta/tc are all derived here to keep the files small). Atlantic
  // (ca/cc) comes straight from the 1-min wind; Taiwan (ta/tc) from JMA's 10-min
  // winds — JMA is 6-hourly while the track is 3-hourly, so gaps interpolate
  // linearly on elapsed hours (tails carry the nearest analysis).
  function reclassTaiwanStorm(stm) {
    var pts = stm.pts || [], known = [];
    for (var i = 0; i < pts.length; i++) if (pts[i].wj != null) known.push(i);
    for (var j = 0; j < pts.length; j++) {
      var pt = pts[j], cat;
      var ac = atlanticCat(pt.w);           // Saffir–Simpson-style, from 1-min wind
      pt.ca = ac[0]; pt.cc = ac[1];
      if (!known.length) {
        if (pt.w == null) continue;
        cat = taiwanCat(pt.w);
      } else if (pt.wj != null) {
        cat = taiwanCatMs10(pt.wj * KT_TO_MS);
      } else {
        var lo = -1, hi = -1;
        for (var k = 0; k < known.length; k++) {
          if (known[k] < j) lo = known[k];
          else { hi = known[k]; break; }
        }
        var wjv = lo < 0 ? pts[hi].wj
          : hi < 0 ? pts[lo].wj
          : pts[lo].wj + (pts[hi].wj - pts[lo].wj) * ((pt.h - pts[lo].h) / ((pts[hi].h - pts[lo].h) || 1));
        cat = taiwanCatMs10(wjv * KT_TO_MS);
      }
      pt.ta = cat[0]; pt.tc = cat[1];
    }
  }
  function fixTaiwanCats(shard) {
    Object.keys(shard).forEach(function (sid) { reclassTaiwanStorm(shard[sid]); });
    return shard;
  }
  function csvNum(v) {
    v = (v || "").trim();
    if (!v) return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }
  function csvQuadKm(c, col, base) {
    var q = ["_NE", "_SE", "_SW", "_NW"].map(function (s) {
      var nm = csvNum(c[col[base + s]]);
      return nm != null && nm >= 0 ? Math.round(nm * 1.852) : null;
    });
    return q.some(function (v) { return v != null; }) ? q : null;
  }
  function parseActiveCsv(text) {
    var lines = text.split(/\r?\n/);
    if (lines.length < 3) return null;
    var col = {};
    lines[0].split(",").forEach(function (h, i) { col[h.trim()] = i; });
    if (col.SID == null || col.BASIN == null || col.ISO_TIME == null) return null;
    var storms = {};
    for (var i = 2; i < lines.length; i++) {           // rows 0-1 are headers
      var c = lines[i].split(",");
      if (c.length < 40 || (c[col.BASIN] || "").trim() !== "WP") continue;
      var sid = (c[col.SID] || "").trim();
      var t = (c[col.ISO_TIME] || "").trim().replace(" ", "T");
      var la = csvNum(c[col.USA_LAT]); if (la == null) la = csvNum(c[col.LAT]);
      var lo = csvNum(c[col.USA_LON]); if (lo == null) lo = csvNum(c[col.LON]);
      if (!sid || !t || la == null || lo == null) continue;
      if (!storms[sid]) {
        var raw = (c[col.NAME] || "").trim();
        storms[sid] = {
          name: raw && raw !== "NOT_NAMED" ? raw.charAt(0) + raw.slice(1).toLowerCase() : "Unnamed",
          season: csvNum(c[col.SEASON]) || Number(sid.slice(0, 4)),
          atcf: (c[col.USA_ATCF_ID] || "").trim(),   // e.g. WP092026 — keys the JTWC b-deck
          pts: []
        };
      }
      var w = csvNum(c[col.USA_WIND]), p = csvNum(c[col.USA_PRES]);
      var ac = atlanticCat(w), tc = taiwanCat(w);
      var pt = { t: t, h: 0, la: la, lo: lo, w: w, p: p, ca: ac[0], cc: ac[1], ta: tc[0], tc: tc[1] };
      // JMA 10-min analysis when present — drives the Taiwan classification
      var wj = col.TOKYO_WIND != null ? csvNum(c[col.TOKYO_WIND]) : null;
      if (wj != null && wj > 0) pt.wj = wj;
      var r3 = csvQuadKm(c, col, "USA_R34"), r5 = csvQuadKm(c, col, "USA_R50"), r6 = csvQuadKm(c, col, "USA_R64");
      if (r3) pt.r3 = r3;
      if (r5) pt.r5 = r5;
      if (r6) pt.r6 = r6;
      storms[sid].pts.push(pt);
    }
    Object.keys(storms).forEach(function (sid) {
      var pts = storms[sid].pts;
      pts.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
      var t0 = Date.parse(pts[0].t + "Z");
      pts.forEach(function (pt) { pt.h = (Date.parse(pt.t + "Z") - t0) / 3600000; });
    });
    return storms;
  }
  function liveIndexEntry(sid, st) {
    var maxWind = 0, hasRadius = false;
    st.pts.forEach(function (pt) {
      if (pt.w != null && pt.w > maxWind) maxWind = pt.w;
      if (pt.r3 || pt.r5 || pt.r6) hasRadius = true;
    });
    var ac = atlanticCat(maxWind);
    return {
      sid: sid, name: st.name, season: st.season,
      start: st.pts[0].t, end: st.pts[st.pts.length - 1].t,
      maxWind: maxWind, cat: ac[0] || "Tropical Depression", color: ac[1] || "rgb(150,190,215)",
      hasRadius: hasRadius, ace: Math.round(computeACE(st.pts) * 10) / 10, live: true
    };
  }
  // Overlay live storms onto a fetched shard (also used when a shard has no
  // static file yet — e.g. the first storm of a brand-new season).
  function applyLiveToShard(season, shard) {
    Object.keys(liveStorms).forEach(function (sid) {
      if (liveStorms[sid].season === Number(season)) shard[sid] = liveStorms[sid].storm;
    });
    return shard;
  }
  function mergeLiveStorms(storms) {
    var affected = {};
    Object.keys(storms).forEach(function (sid) {
      var st = storms[sid];
      if (!st.pts.length) return;
      reclassTaiwanStorm(st);   // Taiwan classes from JMA 10-min winds (b-deck
                                // appended points interpolate / carry nearest)
      liveStorms[sid] = { season: st.season, storm: st };
      affected[st.season] = true;
      var entry = liveIndexEntry(sid, st);
      var existing = null;
      for (var i = 0; i < indexData.length; i++) { if (indexData[i].sid === sid) { existing = indexData[i]; break; } }
      if (existing) {
        st.nameZh = existing.nameZh;   // keep the baked Chinese name
        ["start", "end", "maxWind", "cat", "color", "hasRadius", "ace"].forEach(function (k) { existing[k] = entry[k]; });
        existing.live = true;
      } else {
        indexData.push(entry);
      }
      if (seasonCache[st.season]) seasonCache[st.season][sid] = st;   // patch already-loaded shards
    });
    // refresh the pickers without yanking the user's current view
    var curSeason = Number(els.season.value), curStorm = els.storm.value;
    var seasonsKnown = {};
    for (var j = 0; j < els.season.options.length; j++) seasonsKnown[els.season.options[j].value] = true;
    var newSeason = Object.keys(affected).some(function (s) { return !seasonsKnown[s]; });
    if (newSeason) { populateSeasons(); els.season.value = curSeason; }
    if (affected[curSeason]) {
      populateStorms(curSeason);
      for (var k = 0; k < els.storm.options.length; k++) {
        if (els.storm.options[k].value === curStorm) { els.storm.value = curStorm; break; }
      }
      if (appMode === "track" && viewMode === "season") ensureSeasonThen(buildSeasonOverview);
    }
  }
  function fetchNoaaActive() {
    fetch(NOAA_ACTIVE)
      .then(function (r) { if (!r.ok) throw new Error("noaa " + r.status); return r.text(); })
      .then(function (text) {
        var storms = parseActiveCsv(text);
        if (storms) { mergeLiveStorms(storms); fetchBdecks(storms); }
      })
      .catch(function () { /* live top-up is best-effort; static data stands */ });
  }

  // Second freshness layer: the ATCF b-deck (JTWC working best track, mirrored
  // openly by UCAR/RAL) updates several times a DAY — usually a day or two
  // ahead of the IBTrACS ACTIVE csv — and is the primary source for the
  // 34/50/64 kt quadrant radii. CORS-blocked, so it rides the same public
  // proxy the CIMSS Dvorak feed uses. When JTWC starts publishing R50/R64
  // for a storm, they appear here first. Best-effort, per storm.
  var BDECK_BASE = "https://hurricanes.ral.ucar.edu/repository/data/bdecks_open/";
  function parseATCFCoord(s) {
    var m = /^(\d+)([NSEW])$/.exec((s || "").trim());
    if (!m) return null;
    var v = Number(m[1]) / 10;
    return (m[2] === "S" || m[2] === "W") ? -v : v;
  }
  function parseBdeck(text) {
    var byTime = {};
    text.split(/\r?\n/).forEach(function (line) {
      var f = line.split(",").map(function (s) { return s.trim(); });
      if (f.length < 17 || f[4] !== "BEST" || !/^\d{10}$/.test(f[2])) return;
      var ts = f[2];
      var t = ts.slice(0, 4) + "-" + ts.slice(4, 6) + "-" + ts.slice(6, 8) + "T" + ts.slice(8, 10) + ":00:00";
      var la = parseATCFCoord(f[6]), lo = parseATCFCoord(f[7]);
      if (la == null || lo == null) return;
      var pt = byTime[t];
      if (!pt) {
        var w = csvNum(f[8]), p = csvNum(f[9]);
        if (w != null && w <= 0) w = null;
        if (p != null && p <= 0) p = null;
        var ac = atlanticCat(w), tw = taiwanCat(w);
        pt = byTime[t] = { t: t, h: 0, la: la, lo: lo, w: w, p: p, ca: ac[0], cc: ac[1], ta: tw[0], tc: tw[1] };
      }
      // one line per wind-radius threshold: RAD column 34 / 50 / 64
      var key = f[11] === "34" ? "r3" : f[11] === "50" ? "r5" : f[11] === "64" ? "r6" : null;
      if (key) {
        var q = [13, 14, 15, 16].map(function (i) {
          var nm = Number(f[i]);
          return isFinite(nm) && nm > 0 ? Math.round(nm * 1.852) : null;
        });
        if (q.some(function (v) { return v != null; })) pt[key] = q;
      }
    });
    var pts = Object.keys(byTime).sort().map(function (k) { return byTime[k]; });
    if (!pts.length) return null;
    var t0 = Date.parse(pts[0].t + "Z");
    pts.forEach(function (pt) { pt.h = (Date.parse(pt.t + "Z") - t0) / 3600000; });
    return pts;
  }
  // Fold b-deck fixes into an ACTIVE-csv storm. The csv is 3-hourly but lags;
  // the b-deck is 6-hourly but current. So keep the dense csv track, graft the
  // b-deck's (fresher) radii onto matching times, and append the newer fixes
  // the csv doesn't have yet. Returns true if anything changed.
  function mergeBdeckPts(st, bpts) {
    var byT = {};
    bpts.forEach(function (bp) { byT[bp.t] = bp; });
    var changed = false;
    st.pts.forEach(function (pt) {
      var bp = byT[pt.t];
      if (!bp) return;
      ["r3", "r5", "r6"].forEach(function (k) {
        if (bp[k] && JSON.stringify(bp[k]) !== JSON.stringify(pt[k])) { pt[k] = bp[k]; changed = true; }
      });
    });
    var lastT = st.pts.length ? st.pts[st.pts.length - 1].t : "";
    bpts.forEach(function (bp) {
      if (bp.t > lastT) { st.pts.push(bp); changed = true; }
    });
    if (changed) {
      st.pts.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
      var t0 = Date.parse(st.pts[0].t + "Z");
      st.pts.forEach(function (pt) { pt.h = (Date.parse(pt.t + "Z") - t0) / 3600000; });
    }
    return changed;
  }
  function fetchBdecks(storms) {
    Object.keys(storms).forEach(function (sid) {
      var st = storms[sid];
      if (!/^WP\d{6}$/.test(st.atcf || "")) return;
      var url = BDECK_BASE + st.atcf.slice(4) + "/b" + st.atcf.toLowerCase() + ".dat";
      fetch(CIMSS_PROXY + encodeURIComponent(url))
        .then(function (r) { if (!r.ok) throw new Error("bdeck " + r.status); return r.text(); })
        .then(function (text) {
          var bpts = parseBdeck(text);
          if (!bpts || !mergeBdeckPts(st, bpts)) return;
          var single = {}; single[sid] = st;
          mergeLiveStorms(single);   // refresh index entry, shard patch, pickers
          // if that storm is on screen, redraw it with the fresher track
          if (appMode === "track" && viewMode === "storm" && currentSid === sid) loadStorm(st.season, sid);
        })
        .catch(function () { /* best-effort */ });
    });
  }

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
        " — " + s.cat + " (" + Math.round(s.maxWind || 0) + "kt" +
        (s.ace != null ? " · ACE " + s.ace : "") + ")" +
        (s.live ? " · LIVE" : "") +
        (s.hasRadius ? "" : " · no radius data") + "</option>";
    }).join("");
  }

  function loadStorm(season, sid) {
    stopPlay();
    var p = seasonCache[season]
      ? Promise.resolve(seasonCache[season])
      : fetch(DATA_BASE + "seasons/" + season + ".json" + DATA_V)
          .then(function (r) { return r.json(); })
          .catch(function () { return {}; })   // a season may exist only via live NOAA storms
          .then(function (d) { seasonCache[season] = applyLiveToShard(season, fixTaiwanCats(d)); return seasonCache[season]; });

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
  // Standard table starts at T1.0 = 25 kt; the [0.0, 0] anchor extends it
  // linearly down to T0.0 so weak/nascent systems read on the full T0.0–8.0
  // scale rather than clamping at T1.0.
  var DVORAK_TABLE = [
    [0.0, 0], [1.0, 25], [1.5, 25], [2.0, 30], [2.5, 35], [3.0, 45], [3.5, 55],
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
    // a full track rebuild (storm/classification/view change) wipes every trace,
    // so drop any hindcast overlay state that was sitting on the old map.
    hindcastTraceCount = 0;
    if (els.hindcastBtn) { els.hindcastBtn.setAttribute("aria-pressed", "false"); els.hindcastBtn.classList.remove("is-on"); }
    consensusTraceCount = 0;
    if (els.consensusBtn) { els.consensusBtn.setAttribute("aria-pressed", "false"); els.consensusBtn.classList.remove("is-on"); }
    aiSetHindcastStatus("");
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

    traces = traces.concat(dynamicTraces());

    lastMarkerColor = null; // force the next scrub frame to sync the marker color
    Plotly.react(els.map, traces, geoLayout(), { displayModeBar: false, responsive: true, scrollZoom: true });
    bindMapClick();
  }

  function geoLayout() {
    return {
      geo: {
        resolution: 50,   // higher-detail coastlines (NCDR-like), vs default 110
        projection: { type: "natural earth", scale: DEFAULT_GEO.scale },
        center: { lon: DEFAULT_GEO.lon, lat: DEFAULT_GEO.lat },
        lonaxis: { range: DEFAULT_GEO.lonRange.slice() },
        lataxis: { range: DEFAULT_GEO.latRange.slice() },
        showland: true, landcolor: "rgb(44,52,70)",
        showocean: true, oceancolor: "rgb(9,12,19)",
        showcountries: true, countrycolor: "rgba(255,255,255,0.13)",
        coastlinecolor: "rgba(150,180,220,0.35)", coastlinewidth: 0.8,
        showlakes: true, lakecolor: "rgb(9,12,19)",
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

  var STATIC_TRACES = 2; // track line, intensity markers
  // buildMap appends exactly four dynamic traces — the three wind-radius rings
  // then the current-position marker — and they persist for the storm's whole
  // life. So the scrubber updates them IN PLACE with Plotly.restyle instead of
  // deleting every dynamic trace and re-adding it each frame (which reallocated
  // SVG groups and janked playback). Same approach the forecast sweep uses.
  var DYN_IDX = [STATIC_TRACES, STATIC_TRACES + 1, STATIC_TRACES + 2, STATIC_TRACES + 3];
  var lastMarkerColor = null;
  function ringLatLon(pt, key, show) {
    if (!show || !pt[key]) return { lat: [], lon: [] };
    var poly = radiusPolygon(pt.la, pt.lo, pt[key]);
    return poly ? { lat: poly.lat, lon: poly.lon } : { lat: [], lon: [] };
  }
  function updateDynamic(pt) {
    if (!currentStorm || appMode !== "track" || viewMode !== "storm") return;
    // Slots not built yet (defensive — buildMap always creates them): add once.
    if (!els.map.data || els.map.data.length <= STATIC_TRACES) {
      if (els.map.data) Plotly.addTraces(els.map, dynamicTraces());
      return;
    }
    if (!pt) pt = interpAt(currentHour);
    var r3 = ringLatLon(pt, "r3", els.r34.checked);
    var r5 = ringLatLon(pt, "r5", els.r50.checked);
    var r6 = ringLatLon(pt, "r6", els.r64.checked);
    // One restyle → one redraw of the data layer, no trace churn.
    Plotly.restyle(els.map, {
      lat: [r3.lat, r5.lat, r6.lat, [pt.la]],
      lon: [r3.lon, r5.lon, r6.lon, [pt.lo]]
    }, DYN_IDX);
    // Marker color tracks the category, which only changes at discrete wind
    // thresholds — so restyle it only when it actually changes, keeping the
    // common frame down to the single restyle above.
    var color = pt[catFields().color] || "#fff";
    if (color !== lastMarkerColor) {
      lastMarkerColor = color;
      Plotly.restyle(els.map, { "marker.color": color, "marker.line.color": color }, [DYN_IDX[3]]);
    }
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

    var t0 = formatUTC(absTimeAt(currentHour));
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
      },
      { // time cursor — a 2-point trace on a hidden full-height axis. As a
        // TRACE it scrubs via a cheap data-only Plotly.restyle each frame; as
        // a layout shape (the old way) every frame forced a full relayout
        // pass, the single heaviest per-frame cost while playing.
        x: [t0, t0], y: [0, 1], yaxis: "y3", type: "scatter", mode: "lines",
        line: { color: "rgba(255,255,255,0.55)", width: 1, dash: "dash" },
        hoverinfo: "skip", showlegend: false
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
      // invisible fixed [0,1] axis that the time cursor spans
      yaxis3: { overlaying: "y", range: [0, 1], visible: false, fixedrange: true },
      legend: { orientation: "h", y: 1.12, font: { color: "#98a2bd" } },
      height: 220
    };

    Plotly.react(els.chart, traces, layout, { displayModeBar: false, responsive: true });
  }

  var CHART_CURSOR_IDX = 2; // the time-cursor trace buildChart appends last

  function updateChartMarker() {
    if (!els.chart.data || els.chart.data.length <= CHART_CURSOR_IDX) return;
    var t = formatUTC(absTimeAt(currentHour));
    Plotly.restyle(els.chart, { x: [[t, t]] }, [CHART_CURSOR_IDX]);
  }

  // One scrub/play frame: interpolate the storm state ONCE and feed the same
  // point to the map rings+marker, the intensity-chart cursor, and the readout
  // (each used to re-interpolate independently, doubling the per-frame work).
  function renderScrub() {
    var pt = interpAt(currentHour);
    updateDynamic(pt);
    updateChartMarker();
    updateReadout(false, pt);
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
  function updateReadout(animate, pt) {
    if (!pt) pt = interpAt(currentHour);
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
  // Digital Typhoon (NII / Kitamoto lab) archives JMA best-track PER OBSERVATION
  // — including the wind radii JMA's own live JSON omits for past positions.
  // CORS-open, so we can read it from the browser. Its "Detailed Best Track
  // Wind" (k) page is an HTML table we parse. DT id = "20" + JMA number.
  var DT_WIND = "https://agora.ex.nii.ac.jp/digital-typhoon/summary/wnp/k/";
  var jmaCache = {};   // tcId -> parsed forecast
  var jmaList = [];    // parsed forecasts for all currently-active TCs
  var fcAnim = null;   // requestAnimationFrame id for the forecast sweep
  var fcSweepGaleIdx = -1, fcSweepCircleIdx = -1, fcSweepMarkerIdx = -1; // sweep overlay trace indices

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

  // JMA reports the storm's location in Japanese (e.g. "沖縄の南東海上").
  // Translate compositionally: a base place + an optional direction, so the
  // English UI reads naturally; fall back to JMA's own string if unknown.
  var LOC_PLACE = {
    "マリアナ諸島": "the Mariana Islands", "沖縄": "Okinawa", "沖縄本島": "Okinawa",
    "硫黄島": "Iwo To", "南大東島": "Minamidaito", "大東島": "the Daito Islands",
    "台湾": "Taiwan", "フィリピン": "the Philippines", "ルソン島": "Luzon",
    "小笠原諸島": "the Ogasawara Islands", "父島": "Chichijima", "母島": "Hahajima",
    "宮古島": "Miyakojima", "石垣島": "Ishigaki", "与那国島": "Yonaguni",
    "奄美大島": "Amami-Oshima", "奄美": "Amami", "種子島": "Tanegashima", "屋久島": "Yakushima",
    "九州": "Kyushu", "四国": "Shikoku", "本州": "Honshu", "北海道": "Hokkaido", "日本": "Japan",
    "朝鮮半島": "the Korean Peninsula", "済州島": "Jeju", "香港": "Hong Kong",
    "海南島": "Hainan", "ベトナム": "Vietnam", "中国": "China",
    "南シナ海": "the South China Sea", "東シナ海": "the East China Sea",
    "黄海": "the Yellow Sea", "日本海": "the Sea of Japan", "太平洋": "the Pacific"
  };
  var LOC_DIR = {
    "南": "south", "北": "north", "東": "east", "西": "west",
    "南東": "southeast", "南西": "southwest", "北東": "northeast", "北西": "northwest",
    "南南東": "south-southeast", "南南西": "south-southwest", "北北東": "north-northeast",
    "北北西": "north-northwest", "東南東": "east-southeast", "西南西": "west-southwest",
    "東北東": "east-northeast", "西北西": "west-northwest"
  };
  function translateLocation(jp) {
    if (!jp) return "";
    if (LOC_PLACE[jp]) return LOC_PLACE[jp];
    var s = jp.replace(/海上$|海域$|付近$/g, function (m) { return m === "付近" ? "near" : ""; });
    var near = s.indexOf("near") !== -1;
    s = s.replace("near", "");
    if (near && LOC_PLACE[s]) return "near " + LOC_PLACE[s];
    if (LOC_PLACE[s]) return LOC_PLACE[s];
    var m = s.match(/^(.+?)の(.+)$/);
    if (m && LOC_PLACE[m[1]] && LOC_DIR[m[2]]) return LOC_DIR[m[2]] + " of " + LOC_PLACE[m[1]];
    return jp; // unknown — show JMA's original rather than guess
  }

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
      var probKm = o.probabilityCircleRadius ? o.probabilityCircleRadius.km : 0;
      // JMA's "storm warning area" = actual storm-wind radius ⊕ the position
      // probability circle. Subtract the probability circle so the drawn ring
      // is the storm's ACTUAL expected wind radius (matching the past best-track
      // radii), with the uncertainty shown separately as the violet ± circle.
      var swKm = maxRange(o.stormWarning);
      var gwKm = maxRange(o.galeWarning);
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
        galeKm: gwKm != null ? Math.max(0, Math.round(gwKm - probKm)) : null,
        stormKm: swKm != null ? Math.max(0, Math.round(swKm - probKm)) : null
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

  // Parse Digital Typhoon's "Detailed Best Track Wind" HTML table into past
  // observations with real wind radii. Columns are matched by header text (not
  // fixed index) so it survives layout tweaks; "-" cells become null.
  function parseDTWind(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var trs = Array.prototype.slice.call(doc.querySelectorAll("tr"));
    // Read only DIRECT-child cells: the k-page nests tables, so plain
    // querySelectorAll("td") on a wrapper row would pull in every nested cell.
    function cellsOf(tr) {
      return Array.prototype.map.call(tr.querySelectorAll(":scope > th, :scope > td"),
        function (c) { return c.textContent.trim(); });
    }
    // Map columns from the actual header row (has "Lat." + the radius labels).
    var headerCells = null;
    for (var r = 0; r < trs.length; r++) {
      var cells = cellsOf(trs[r]);
      if (cells.length >= 10 && cells.indexOf("Lat.") !== -1 && cells.join("|").indexOf("Radius of Major Storm Axis") !== -1) {
        headerCells = cells; break;
      }
    }
    if (!headerCells) return null;
    function col(label) { for (var i = 0; i < headerCells.length; i++) { if (headerCells[i].indexOf(label) !== -1) return i; } return -1; }
    var ci = {
      y: col("Year"), mo: col("Month"), d: col("Day"), h: col("Hour"),
      lat: col("Lat"), lon: col("Long"), wind: col("Wind"),
      storm: col("Radius of Major Storm Axis"), gale: col("Radius of Major Gale Axis")
    };
    if (ci.y < 0 || ci.lat < 0) return null;
    function n(v) { return (v && v !== "-" && v !== "—" && !isNaN(Number(v))) ? Number(v) : null; }
    var out = [];
    trs.forEach(function (tr) {
      var c = cellsOf(tr);
      if (c.length < 10 || c.length > 30 || !/^\d{4}$/.test(c[ci.y] || "")) return;
      var lat = n(c[ci.lat]), lon = n(c[ci.lon]);
      if (lat == null || lon == null) return;
      var sr = ci.storm >= 0 ? n(c[ci.storm]) : null;  // 50kt storm radius, nm
      var gr = ci.gale >= 0 ? n(c[ci.gale]) : null;    // 30kt gale radius, nm
      out.push({
        timeMs: Date.UTC(+c[ci.y], (+c[ci.mo] || 1) - 1, +c[ci.d] || 1, +c[ci.h] || 0, 0, 0),
        lat: lat, lon: lon,
        windKt: ci.wind >= 0 ? n(c[ci.wind]) : null,
        stormKm: sr != null ? Math.round(sr * 1.852) : null,
        galeKm: gr != null ? Math.round(gr * 1.852) : null
      });
    });
    return out.length ? out : null;
  }

  // Real satellite Dvorak T-numbers from UW-CIMSS ADT (the objective Dvorak
  // technique). CIMSS is CORS-blocked, so route through a public CORS proxy
  // (best-effort; falls back to wind-derived T). The history file gives the
  // CI# every ~30 min for the storm's whole life.
  var CIMSS_PROXY = "https://corsproxy.io/?url=";
  var CIMSS_BASE = "https://tropic.ssec.wisc.edu/real-time/adt/";
  var CIMSS_MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

  function parseCimss(text, id) {
    if (!text || text.indexOf(id) === -1) return null;   // empty / wrong storm
    var out = [];
    text.split("\n").forEach(function (line) {
      var m = line.match(/^(\d{4})([A-Z]{3})(\d{2})\s+(\d{6})\s+([\d.]+)\s+[\d.]+\s+[\d.]+/);
      if (!m) return;
      var mo = CIMSS_MON[m[2]], ciNum = parseFloat(m[5]);
      if (mo == null || isNaN(ciNum)) return;
      out.push({ timeMs: Date.UTC(+m[1], mo, +m[3], +m[4].slice(0, 2), +m[4].slice(2, 4), 0), ci: ciNum });
    });
    return out.length ? out : null;
  }
  function fetchCimss(jmaNumber, analysisMs) {
    var id = /^\d{3,4}$/.test(jmaNumber || "") ? jmaNumber.slice(-2) + "W" : null;
    if (!id) return Promise.resolve(null);
    return fetch(CIMSS_PROXY + encodeURIComponent(CIMSS_BASE + id + "-list.txt"))
      .then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (text) {
        var list = parseCimss(text, id);
        if (!list) return null;
        // reject a stale / mismatched storm: latest CIMSS fix must be near "now"
        if (analysisMs && Math.abs(list[list.length - 1].timeMs - analysisMs) > 2 * 86400000) return null;
        return list;
      }).catch(function () { return null; });
  }
  function cimssNowT(d) { return (d && d.cimss && d.cimss.length) ? d.cimss[d.cimss.length - 1].ci : null; }
  function nearestCimssCi(list, timeMs) {
    var best = null, bd = Infinity;
    for (var i = 0; i < list.length; i++) { var dd = Math.abs(list[i].timeMs - timeMs); if (dd < bd) { bd = dd; best = list[i]; } }
    return (best && bd <= 3 * 3600000) ? best.ci : null;   // within 3h
  }
  // No agency forecasts a Dvorak number, so anchor to CIMSS's current real T
  // and add the JMA forecast intensity change on top (continuous with the real
  // value). Falls back to plain wind-derived T when CIMSS is unavailable.
  function anchoredT(d, windKt) {
    if (windKt == null) return null;
    var dt = dvorakTNumber(windKt); if (dt == null) return null;
    var nowT = cimssNowT(d), nowW = d.points[0] && d.points[0].windKt;
    if (nowT != null && nowW != null && dvorakTNumber(nowW) != null) {
      return Math.max(0, Math.round((nowT + (dt - dvorakTNumber(nowW))) * 10) / 10);
    }
    return dt;
  }
  function pointT(d, windKt, timeMs, isPast) {
    if (isPast && d.cimss && timeMs != null) { var ci = nearestCimssCi(d.cimss, timeMs); if (ci != null) return ci; }
    return anchoredT(d, windKt);
  }
  function fmtT(t) { return t != null ? "T" + t.toFixed(1) : null; }

  function fetchJmaTc(tcId, force) {
    if (!force && jmaCache[tcId]) return Promise.resolve(jmaCache[tcId]);
    var bust = force ? "?_=" + Date.now() : "";   // dodge the browser HTTP cache on a live refresh
    return Promise.all([
      fetch(JMA_BASE + tcId + "/specifications.json" + bust).then(function (r) { return r.json(); }),
      fetch(JMA_BASE + tcId + "/forecast.json" + bust).then(function (r) { return r.json(); })
    ]).then(function (res) {
      var p = parseJma(tcId, res[0], res[1]);
      if (!p) return null;
      // Past wind radii from JMA best-track (via Digital Typhoon), and real
      // past Dvorak T-numbers from CIMSS ADT (via CORS proxy). Both best-effort.
      var dtId = /^\d{4}$/.test(p.number) ? "20" + p.number : null;
      var dtPromise = dtId
        ? fetch(DT_WIND + dtId + ".html.en").then(function (r) { return r.text(); })
            .then(function (html) { return parseDTWind(html); }).catch(function () { return null; })
        : Promise.resolve(null);
      var analysisMs = (p.points[0] && p.points[0].valid) ? Date.parse(p.points[0].valid.UTC) : null;
      return Promise.all([dtPromise, fetchCimss(p.number, analysisMs)]).then(function (r2) {
        p.past = r2[0];
        p.cimss = r2[1];
        jmaCache[tcId] = p;
        return p;
      });
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
        cancelForecastAnim();
        fcSweepCircleIdx = -1;
        setForecastMessage("Couldn’t reach JMA’s forecast service. It may be briefly unavailable — switch back to Track, or try Forecast again shortly.");
        if (els.typhoonSelect) els.typhoonSelect.innerHTML = "<option>—</option>";
        Plotly.react(els.map, [], geoLayout(), { displayModeBar: false, responsive: true, scrollZoom: true });
      });
  }

  /* ---------------------------------------------------------------------------
     Live refresh — JMA reissues typhoon forecasts every few hours. While the
     page is open we re-scan the active-storm list AND re-fetch the viewed storm
     on a timer: new storms are added to the picker and dissipated ones removed
     (keeping your current selection when it survives), and ONLY when JMA has
     actually published a newer forecast for the viewed storm do we re-render it
     and re-run the AI model on the fresh track — so the route genuinely updates
     as the storm evolves rather than staying frozen at page-load. Unchanged data
     → no work (no needless recompute, no flicker).
     ------------------------------------------------------------------------- */
  var FC_REFRESH_MS = 30 * 60 * 1000;   // 30 min
  var fcRefreshTimer = null;
  function jmaIssueKey(d) {             // identifies a forecast issuance
    if (!d) return null;
    var a = (d.points && d.points[0] && d.points[0].valid) ? d.points[0].valid.UTC : "";
    return JSON.stringify(d.issue || "") + "|" + a;
  }
  function startForecastRefresh() {
    stopForecastRefresh();
    fcRefreshTimer = setInterval(refreshForecast, FC_REFRESH_MS);
  }
  function stopForecastRefresh() {
    if (fcRefreshTimer) { clearInterval(fcRefreshTimer); fcRefreshTimer = null; }
  }
  function refreshForecast() {
    if (appMode !== "predict") return;
    if (typeof document !== "undefined" && document.hidden) return;   // don't poll a backgrounded tab
    var sel = els.typhoonSelect, curId = sel && sel.value;
    var prevCur = curId ? jmaCache[curId] : null;
    var oldCurKey = prevCur ? jmaIssueKey(prevCur) : null;
    // Re-scan the active-storm LIST (new storms appear, others dissipate)…
    fetch(JMA_BASE + "targetTc.json?_=" + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (list) {
        if (appMode !== "predict") return;
        var ids = (list || []).map(function (t) { return t.tropicalCyclone; }).filter(Boolean);
        if (!ids.length) { jmaList = []; aiLastFc = null; aiClearState(); renderNoActive(); return; }
        var prevIds = jmaList.map(function (d) { return d.tcId; });
        // force-fetch storms new to us + the one being viewed (fresh route); reuse cache for the rest
        return Promise.all(ids.map(function (id) {
          return fetchJmaTc(id, prevIds.indexOf(id) < 0 || id === curId);
        })).then(function (parsed) {
          if (appMode !== "predict") return;
          var fresh = parsed.filter(Boolean);
          if (!fresh.length) { jmaList = []; aiLastFc = null; aiClearState(); renderNoActive(); return; }
          var listChanged = fresh.length !== prevIds.length ||
            fresh.some(function (d) { return prevIds.indexOf(d.tcId) < 0; });
          jmaList = fresh;
          var cur = fresh.filter(function (d) { return d.tcId === curId; })[0];
          if (listChanged) {                     // rebuild the dropdown, keep the current pick if it survived
            populateTyphoonSelect(fresh);
            if (cur) sel.value = curId;
          }
          if (cur) {
            if (!cur.past && prevCur && prevCur.past) cur.past = prevCur.past;         // keep history on a
            if (!cur.cimss && prevCur && prevCur.cimss) cur.cimss = prevCur.cimss;     // transient proxy miss
            if (oldCurKey && jmaIssueKey(cur) === oldCurKey) return;   // viewed storm unchanged — dropdown was enough
            renderForecast(cur);         // aiRestoreOrClear sees the new dataKey and re-runs the AI on it
          } else {                       // the viewed storm dissipated — show the strongest remaining one
            var def = fresh.slice().sort(function (a, b) {
              return (a.points[0].pressure || 9999) - (b.points[0].pressure || 9999);
            })[0];
            sel.value = def.tcId;
            renderForecast(def);         // different tcId → aiRestoreOrClear re-runs for it
          }
        });
      })
      .catch(function () { /* transient network error — try again next tick */ });
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
    updateForecastPanel(d);   // builds #tt-fc-live before the animation starts
    buildForecastMap(d);
  }

  function renderNoActive() {
    cancelForecastAnim();
    fcSweepCircleIdx = -1;
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
    // JMA 70% position-probability circles: where the CENTRE may be, not a wind
    // field. Drawn as a faint DOTTED ring (barely filled) so a big ±200 km circle
    // reads as "the storm could be anywhere in here", not a huge wind radius.
    pts.slice(1).forEach(function (p) {
      if (!p.circleKm) return;
      var c = circlePolygon(p.lat, p.lon, p.circleKm);
      traces.push({ type: "scattergeo", mode: "lines", lat: c.lat, lon: c.lon,
        fill: "toself", fillcolor: "rgba(124,58,237,0.04)", line: { color: "rgba(167,139,250,0.6)", width: 1, dash: "dot" },
        hoverinfo: "text", text: "+" + p.h + " h · 70% chance the centre is within " + p.circleKm + " km",
        showlegend: false });
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

    // Sweep overlay (animated): a marker that travels the whole timeline (past
    // observed track → future forecast) carrying the storm's TWO wind-field
    // boundaries — the outer gale ring (30kt, thin yellow) and the inner
    // storm ring (50kt, orange). Added last so their indices are stable for
    // per-frame Plotly.restyle().
    fcSweepGaleIdx = traces.length;
    traces.push({ type: "scattergeo", mode: "lines", lat: [a.lat], lon: [a.lon],
      fill: "toself", fillcolor: "rgba(255,205,60,0.06)", line: { color: "rgba(255,210,80,0.65)", width: 1 },
      hoverinfo: "skip", showlegend: false });
    fcSweepCircleIdx = traces.length;
    traces.push({ type: "scattergeo", mode: "lines", lat: [a.lat], lon: [a.lon],
      fill: "toself", fillcolor: "rgba(255,120,0,0.14)", line: { color: "rgba(255,150,0,0.85)", width: 1.6 },
      hoverinfo: "skip", showlegend: false });
    fcSweepMarkerIdx = traces.length;
    traces.push({ type: "scattergeo", mode: "markers", lat: [a.lat], lon: [a.lon],
      marker: { size: 11, color: "#ffd54a", line: { width: 2, color: "rgba(20,26,46,0.9)" } },
      hoverinfo: "skip", showlegend: false });

    Plotly.react(els.map, traces, geoLayout(), { displayModeBar: false, responsive: true, scrollZoom: true });
    aiRestoreOrClear(d);   // re-draw the AI overlay if it was on for this same storm
    startForecastAnim(d);
  }

  /* ---------------------------------------------------------------------------
     Experimental AI overlay — Yu's own TrackFormer model, run ENTIRELY IN THE
     BROWSER via onnxruntime-web (no backend). Both this live-forecast overlay and
     the track-mode hindcast use the one track-only model (the runtime + feature
     build live in the TrackFormer block below). On demand it loads the int8 ONNX
     checkpoint and draws the predicted track + intensity + an uncertainty cone
     over the JMA forecast — clearly flagged experimental. Track-only: no ERA5, no
     live atmospheric fetch, so nothing external can make it fail. This section is
     the live-overlay controller (persistence across rebuilds / storm switches /
     play-end); aiRun() below feeds the live JMA track into tfRunModel(). */
  var ORT_VER = "1.20.1";
  var ORT_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@" + ORT_VER + "/dist/ort.min.js";
  var ORT_WASM = "https://cdn.jsdelivr.net/npm/onnxruntime-web@" + ORT_VER + "/dist/";
  var aiTraceCount = 0, aiLoading = false;
  var aiEnabled = false; // the user wants the overlay shown — survives rebuilds,
                         // storm switches and the animation ending
  var aiLastFc = null;   // last drawn AI forecast, tagged with .tcId + .dataKey so a
                         // rebuild can tell "same run" (redraw) from "data moved on" (re-run)

  function aiPmod(a, n) { return ((a % n) + n) % n; }     // Python-style positive modulo
  function aiLoadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error("load " + src)); };
      document.head.appendChild(s);
    });
  }

  function aiSetStatus(msg, cls) {
    if (!els.aiStatus) return;
    els.aiStatus.textContent = msg || "";
    els.aiStatus.className = "tt-ai-status" + (cls ? " tt-ai-status--" + cls : "");
  }
  function aiClearState() {
    aiTraceCount = 0;
    if (els.aiBtn) { els.aiBtn.setAttribute("aria-pressed", "false"); els.aiBtn.classList.remove("is-on"); }
    aiSetStatus("");
  }
  function aiRemoveTraces() {
    if (aiTraceCount > 0 && els.map.data && els.map.data.length >= aiTraceCount) {
      var n = els.map.data.length, idx = [];
      for (var i = n - aiTraceCount; i < n; i++) idx.push(i);   // AI traces are the last ones
      Plotly.deleteTraces(els.map, idx);
    }
    aiEnabled = false; // explicit toggle-off: don't restore or re-run on the next rebuild
    aiLastFc = null;
    aiClearState();
  }
  // Called after buildForecastMap's Plotly.react (which drops every trace,
  // including the AI overlay). If the overlay was on for the SAME storm, put it
  // straight back — no need to re-run the model — so it survives the rebuild.
  function aiRestoreOrClear(d) {
    aiTraceCount = 0;   // react() just cleared the map; the old AI traces are gone
    if (!aiEnabled || !d) { aiClearState(); return; }
    // Same storm AND same JMA issuance → redraw the cached run (no recompute).
    // Storm switched, or JMA reissued → re-run on THAT storm's latest data.
    if (aiLastFc && aiLastFc.tcId === d.tcId && aiLastFc.dataKey === jmaIssueKey(d)) aiDrawForecast(aiLastFc);
    else aiRun(d);
  }
  // Belt-and-suspenders: if the AI overlay should be on for the storm on screen
  // but its emerald traces aren't actually on the map any more, put them back.
  // Cheap (a couple of property reads) and idempotent — a no-op when the overlay
  // is already present or was deliberately toggled off. Called once per play
  // cycle so the AI track can never silently vanish when the animation ends.
  function aiEnsureOverlay() {
    if (appMode !== "predict" || !aiEnabled || !aiLastFc || aiLoading) return;
    var d = els.typhoonSelect ? jmaCache[els.typhoonSelect.value] : null;
    if (!d || d.tcId !== aiLastFc.tcId) return;               // different / no storm on screen
    var data = els.map.data || [], last = data[data.length - 1];
    var present = last && last.line && String(last.line.color).indexOf("52,211,153") >= 0;
    if (!present) aiDrawForecast(aiLastFc);                   // it went missing — redraw it
  }
  function aiDrawForecast(fc) {
    var pts = fc.points || [];
    if (!pts.length) throw new Error("empty forecast");
    var meanLat = [fc.initial_lat], meanLon = [fc.initial_lon], txt = ["AI · now · " + fmtLatLon(fc.initial_lat, fc.initial_lon)];
    pts.forEach(function (p) { meanLat.push(p.lat); meanLon.push(p.lon); txt.push(tfHover(p)); });
    // spread cone: apex at now, out along the p90 corners, back along the p10 corners
    var rev = pts.slice().reverse();
    var coneLat = [fc.initial_lat].concat(pts.map(function (p) { return p.p90_lat; }))
      .concat(rev.map(function (p) { return p.p10_lat; }));
    var coneLon = [fc.initial_lon].concat(pts.map(function (p) { return p.p90_lon; }))
      .concat(rev.map(function (p) { return p.p10_lon; }));
    var cone = { type: "scattergeo", mode: "lines", lat: coneLat, lon: coneLon,
      fill: "toself", fillcolor: "rgba(52,211,153,0.11)", line: { color: "rgba(52,211,153,0.35)", width: 1 },
      hoverinfo: "skip", showlegend: false };
    // Soft casing under the track: a thin dashed line alone gets lost against the
    // dark map and JMA's violet forecast — this gives the AI route its own presence.
    var halo = { type: "scattergeo", mode: "lines", lat: meanLat, lon: meanLon,
      line: { color: "rgba(52,211,153,0.22)", width: 9 }, hoverinfo: "skip", showlegend: false };
    // "now" modest, mid points even, the +120 h endpoint emphasised
    var sizes = meanLat.map(function (_, i) { return i === 0 ? 7 : (i === meanLat.length - 1 ? 11 : 8); });
    var mean = { type: "scattergeo", mode: "lines+markers", lat: meanLat, lon: meanLon,
      line: { color: "rgb(52,211,153)", width: 3, dash: "dash" },
      marker: { size: sizes, color: tfCatColors(fc), line: { width: 1.6, color: "rgba(52,211,153,0.95)" } },   // dots by predicted category, emerald-ringed = AI
      text: txt, hoverinfo: "text", showlegend: false };
    var allTraces = [cone].concat(tfRadiiTraces(pts), [halo, mean]);   // mean stays LAST (aiEnsureOverlay checks it)
    Plotly.addTraces(els.map, allTraces);   // appended after the sweep — sweep indices unaffected
    aiTraceCount = allTraces.length;
    aiLastFc = fc;   // remember it so a same-storm map rebuild can restore it
    if (els.aiBtn) { els.aiBtn.setAttribute("aria-pressed", "true"); els.aiBtn.classList.add("is-on"); }
    aiSetStatus("🧪 " + (fc.storm || "AI") + " — my TrackFormer model: predicted track with dots coloured by forecast intensity category, plus wind, pressure & wind-field size (hover a dot) and an uncertainty cone. Experimental, not an official forecast.", "on");
  }
  // Build TrackFormer's history pts from the live storm's recent track: the
  // Digital Typhoon best-track past leg + the current JMA analysis point, put on
  // a 6-hourly clock with "now" at h=0 — exactly the shape tfBuildFeat wants.
  // Wind radii aren't in the live past leg, so they go in as missing (the model's
  // validity flags handle that, just like a pre-2001 best-track storm).
  function tfLivePts(d) {
    if (!d || !d.points || !d.points.length) return null;
    var a = d.points[0], raw = [];
    if (d.past && d.past.length) {
      d.past.forEach(function (o) { if (o.lat != null && o.lon != null) raw.push({ ms: o.timeMs, la: o.lat, lo: o.lon, w: o.windKt }); });
    }
    var nowMs = (a.valid && a.valid.UTC) ? Date.parse(a.valid.UTC) : Date.now();
    raw.push({ ms: nowMs, la: a.lat, lo: a.lon, w: a.windKt, p: a.pressure });
    raw.sort(function (x, y) { return x.ms - y.ms; });
    var pts = raw.map(function (o) {
      return { la: o.la, lo: o.lo, w: (o.w != null ? o.w : null), p: (o.p != null ? o.p : null),
        h: (o.ms - nowMs) / 3600000, t: new Date(o.ms).toISOString() };
    });
    return { pts: pts, nowHour: 0 };
  }
  // Run TrackFormer on storm d's current track and draw the overlay. Shared by
  // the toggle and the live refresh (which re-runs it on freshly-fetched data so
  // the route reflects the new analysis — genuinely recomputed, not redrawn).
  function aiRun(d) {
    var live = tfLivePts(d);
    if (!live) { aiSetStatus("No storm loaded to run the model on.", "err"); return; }
    aiLoading = true;
    aiSetStatus(tfRT.session ? "Running my AI model…"
      : "Loading my AI model in your browser (~one-time 30 MB download)…", "loading");
    tfEnsureModel()
      .then(function () { return tfRunModel(live.pts, live.nowHour); })
      .then(function (fc) {
        aiLoading = false;
        fc.storm = (d.name && d.name.en) || "storm";
        fc.tcId = d.tcId;              // which storm this run belongs to
        fc.dataKey = jmaIssueKey(d);   // which JMA issuance it was computed from
        aiDrawForecast(fc);
      })
      .catch(function (e) {
        aiLoading = false;
        aiSetStatus(((e && e.message) || e), "err");
      });
  }
  function aiToggle() {
    if (appMode !== "predict") return;
    if (aiTraceCount > 0) { aiRemoveTraces(); return; }   // toggle off
    if (aiLoading) return;
    aiEnabled = true;   // keep it on across rebuilds, storm switches and play-end
    aiRun(els.typhoonSelect ? jmaCache[els.typhoonSelect.value] : null);
  }

  /* --- TrackFormer v9 — powers BOTH the live overlay and the track-mode hindcast.
     Still a NO-REANALYSIS model (github.com/yu314-coder/typhoon-predict): every input
     is derived from the track itself, so it runs anywhere in the browser. v9 adds a
     third "protected" stream to v8's kinematic+thermodynamic pair — an ENVIRONMENT
     encoder over absolute position (lat, |lat|, sin/cos lon), distance-to-land and a
     lat+month climatological SST proxy. v8 was position-BLIND (translation-invariant,
     relative motion only); giving the model absolute latitude — Coriolis, recurvature,
     SST-latitude — cut WP-2020+ track to 618 km (−31 vs v8) and vmax to 18.6 kt (−2.1).
     Inputs: 9 six-hourly history fixes as a 54-dim vector (48 as before + 6 environment)
     PLUS the current velocity v0; outputs 20 six-hourly leads of the full 17-dim storm
     state. The feature build mirrors build_track_v9.py; dist2land isn't in our per-fix
     data so it's fed as the training mean (normalises to 0 — exactly how the builder
     treats a missing DIST2LAND). v9's own train-time normalization ships in the meta.
     Verified: our export reproduces the published 618 km exactly (618.4), the fp32 ONNX
     is bit-exact to PyTorch, int8 costs ~3 physical units. Radii/RMW: IBTrACS is nmile,
     our JSON is km, so ÷1.852 in and ×1.852 out. ~18 MB int8 ONNX, lazily loaded only
     when a forecast is requested. ------------------------------------------------- */
  var TF_MODEL_URL = "model/trackformer-v9.int8.onnx";
  var TF_META_URL = "model/trackformer-v9-meta.json?v=20260719v9";
  // Probabilistic ensemble on v8 (no retraining): a 40x40 Cholesky L of the model's
  // own forecast-error covariance (20 leads x 2 axes) + a per-lead 90% cone radius.
  // Sampling L·z gives CROSS-LEAD-CORRELATED noise, so drawn routes are coherent
  // (smooth) rather than jagged. Computed offline (ensemble_v8.py); the "sample"
  // covariance won on WP-2020+ energy score (cover90 0.82) — a diagonal cov collapses
  // to 0.20, which is why the correlation structure matters.
  var TF_ENS_URL = "model/trackformer-v9-ensemble.json?v=20260719v9";
  // Multi-initialisation CONSENSUS (make_rmt_tracks.py + smooth_consensus.py): at each valid
  // time the members are forecasts from different init times, so they carry different leads.
  // Combine them min-variance, w = C^-1 1 / (1' C^-1 1) over the lead x lead position-error
  // covariance C, then run a constant-velocity Kalman + RTS smoother so the track has physical
  // momentum instead of jumping when the short-lead membership rotates.
  var TF_CONS_URL = "model/trackformer-v9-consensus.json?v=20260719v9";
  var TF_NM = 1.852;                                    // km per nautical mile
  var TF_ENS_N = 40;                                    // ensemble routes to draw
  var tfRT = { session: null, meta: null, ens: null, cons: null };
  var hindcastTraceCount = 0;
  var consensusTraceCount = 0;
  // Overlay tags. Both overlays can be on at once (the consensus stays visible while the
  // hindcast animates), so traces are located by tag, never by position in els.map.data.
  var TF_HIND = "tf-hind", TF_CONS = "tf-cons", TF_CONS_ACT = "tf-cons-act";
  // Consensus horizon: only forecasts made at least this far ahead are combined, so the
  // yellow line is a genuine PREDICTION rather than a re-tracing of the observations.
  var TF_CONS_MIN_LEAD_H = 0;
  function tfTraceIdx(tag) {
    var out = [], data = (els.map && els.map.data) || [];
    for (var i = 0; i < data.length; i++) if (data[i].meta === tag) out.push(i);
    return out;
  }
  function tfEnsureModel() {
    if (tfRT.session) return Promise.resolve();
    return (window.ort ? Promise.resolve() : aiLoadScript(ORT_URL)).then(function () {
      try { window.ort.env.wasm.wasmPaths = ORT_WASM; } catch (e) {}
      return Promise.all([
        fetch(TF_META_URL).then(function (r) { return r.json(); }),
        window.ort.InferenceSession.create(TF_MODEL_URL),
        fetch(TF_ENS_URL).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
        fetch(TF_CONS_URL).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      ]);
    }).then(function (r) { tfRT.meta = r[0]; tfRT.session = r[1]; tfRT.ens = r[2]; tfRT.cons = r[3]; });
  }
  // Deterministic seeded standard-normals (mulberry32 + Box–Muller) so ensemble
  // routes stay stable across follow-the-playhead redraws (no flicker), yet morph
  // smoothly as the forecast changes.
  function tfRng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function tfNormals(n, seed) {
    var r = tfRng(seed), out = new Float64Array(n);
    for (var i = 0; i < n; i += 2) {
      var m = Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))), a = 6.283185307179586 * r();
      out[i] = m * Math.cos(a); if (i + 1 < n) out[i + 1] = m * Math.sin(a);
    }
    return out;
  }
  // Sample TF_ENS_N coherent routes from L: eps = L·z (correlated per-step motion
  // error, km), added to the deterministic per-step motion, then cumulatively
  // walked into lat/lon exactly as tfRunModel does. Returns one null-separated
  // {lat,lon} pair for a single Plotly trace (keeps the fixed trace layout intact).
  function tfSpaghetti(fc) {
    var ens = tfRT.ens; if (!ens || !ens.L || !fc.motion) return { lat: [], lon: [] };
    var L = ens.L, mot = fc.motion, la0 = fc.initial_lat, lo0 = fc.initial_lon, lat = [], lon = [];
    for (var m = 0; m < TF_ENS_N; m++) {
      var z = tfNormals(40, 1013 + m * 9161), la = la0, lo = lo0;
      for (var k = 0; k < 20; k++) {
        var eE = 0, eN = 0, rE = (2 * k) * 40, rN = (2 * k + 1) * 40;   // rows of L for this lead's E,N
        for (var j = 0; j <= 2 * k + 1; j++) { if (j <= 2 * k) eE += L[rE + j] * z[j]; eN += L[rN + j] * z[j]; }
        var e = mot[k][0] + eE, n = mot[k][1] + eN;
        var la2 = la + n / 111.2, lo2 = lo + e / (111.2 * Math.cos((la + la2) / 2 * Math.PI / 180));
        lat.push(la2); lon.push(lo2); la = la2; lo = lo2;
      }
      lat.push(null); lon.push(null);   // break between routes
    }
    return { lat: lat, lon: lon };
  }
  function tfDoy(t) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t || "");
    if (!m) return 200;
    return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(+m[1], 0, 0)) / 86400000);
  }
  function tfMonth(t) {   // 1..12, for v9's climatological SST proxy
    var m = /^\d{4}-(\d{2})/.exec(t || "");
    return m ? +m[1] : 8;
  }
  function tfMotionKm(la0, lo0, la1, lo1) {   // storm-relative motion, east/north km
    var dlat = la1 - la0, dlon = aiPmod(lo1 - lo0 + 180, 360) - 180;
    return [dlon * 111.2 * Math.cos((la0 + la1) / 2 * Math.PI / 180), dlat * 111.2];
  }
  function tfNearestIdx(pts, targetH) {       // nearest fix within 1.5 h (build_track_only.py's TOL)
    var best = -1, bd = 1.5 + 1e-9;
    for (var i = 0; i < pts.length; i++) { var d = Math.abs(pts[i].h - targetH); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  function tfRadiiNm(p, key) {                 // km quadrants -> nm, order [ne,se,sw,nw]
    var a = p[key]; if (!a) return [NaN, NaN, NaN, NaN];
    var o = []; for (var q = 0; q < 4; q++) { var v = a[q]; o.push(v != null && isFinite(v) ? v / TF_NM : NaN); }
    return o;
  }
  // Build the normalized [9,48] track-history tensor + current velocity v0, exactly
  // as build_track_v2.py does (TrackFormer's protected dual-stream input). The
  // first 40 features match build_track_only.py; 40:48 are motion-dynamics (step
  // heading sin/cos, speed, turn/recurvature, Δvmax, Δpressure, 2 validity flags).
  function tfBuildFeat(pts, baseHour) {
    var meta = tfRT.meta, mean = meta.track_mean, std = meta.track_std, D = meta.feat_dim || 48;
    pts = pts.filter(function (p) { return p.la != null && p.lo != null; });
    var bi = tfNearestIdx(pts, baseHour);
    if (bi < 0) return { ok: false };
    var base = pts[bi], phase = 2 * Math.PI * tfDoy(base.t) / 365.25, sp = Math.sin(phase), cp = Math.cos(phase);
    var hidx = []; for (var i = 8; i >= 0; i--) hidx.push(tfNearestIdx(pts, base.h - 6 * i));   // -48 h..0
    if (hidx.indexOf(-1) >= 0) return { ok: false, base: base };
    var feat = new Float32Array(9 * D), prev = -1, prevDir = null, v0 = [0, 0];
    for (var k = 0; k < 9; k++) {
      var p = pts[hidx[k]], off = k * D, raw = new Array(D); for (var z = 0; z < D; z++) raw[z] = 0;
      var en = tfMotionKm(base.la, base.lo, p.la, p.lo); raw[0] = en[0]; raw[1] = en[1];
      var se = 0, sn = 0;
      if (prev >= 0) { var s2 = tfMotionKm(pts[prev].la, pts[prev].lo, p.la, p.lo); se = s2[0]; sn = s2[1]; }
      raw[2] = se; raw[3] = sn;
      var vals = [p.w, p.p, NaN, (p.rm != null ? p.rm / TF_NM : NaN)];   // vmax, pressure, gust(absent), rmw (km->nm)
      for (var j = 0; j < 4; j++) raw[4 + j] = (vals[j] != null && isFinite(vals[j])) ? vals[j] : 0;
      var rad = tfRadiiNm(p, "r3").concat(tfRadiiNm(p, "r5"), tfRadiiNm(p, "r6"));
      for (var jr = 0; jr < 12; jr++) raw[8 + jr] = isFinite(rad[jr]) ? rad[jr] : 0;
      raw[20] = 0; raw[21] = sp; raw[22] = cp; raw[23] = base.h - p.h;
      var fields = vals.concat(rad);
      for (var jf = 0; jf < 4; jf++) raw[24 + jf] = (fields[jf] != null && isFinite(fields[jf])) ? 1 : 0;
      for (var jg = 0; jg < 12; jg++) raw[28 + jg] = isFinite(fields[4 + jg]) ? 1 : 0;
      // motion dynamics (40:48)
      var speed = Math.hypot(se, sn), hsin = 0, hcos = 0;
      if (speed > 1e-3 && prev >= 0) { hsin = se / speed; hcos = sn / speed; }
      raw[40] = hsin; raw[41] = hcos; raw[42] = speed;
      raw[43] = (prevDir && (hsin || hcos) && (prevDir[0] || prevDir[1])) ? (prevDir[0] * hcos - prevDir[1] * hsin) : 0;
      if (prev >= 0) {
        var pv = pts[prev], dvok = (pv.w != null && isFinite(pv.w) && p.w != null && isFinite(p.w));
        var dpok = (pv.p != null && isFinite(pv.p) && p.p != null && isFinite(p.p));
        raw[44] = dvok ? (p.w - pv.w) : 0; raw[45] = dpok ? (p.p - pv.p) : 0;
        raw[46] = dvok ? 1 : 0; raw[47] = dpok ? 1 : 0;
      }
      // environment stream (48:53) — v9's third encoder, all IBTrACS-derivable. Mirrors
      // build_track_v9.py exactly: absolute position (Coriolis/recurvature), plus a
      // lat+month climatological SST proxy. dist2land isn't in our per-fix data, so we
      // feed the training mean — which normalises to 0, exactly how the dataset builder
      // treats a missing DIST2LAND (NaN -> train mean).
      if (D > 48) {
        var mo = tfMonth(p.t), decl = 23.44 * Math.sin(2 * Math.PI * (mo - 3) / 12);
        var thermal = 0.5 * decl;                                   // thermal-equator shift
        raw[48] = p.la;
        raw[49] = Math.abs(p.la);
        raw[50] = Math.sin(p.lo * Math.PI / 180);
        raw[51] = Math.cos(p.lo * Math.PI / 180);
        raw[52] = mean[52];                                          // dist2land -> train mean
        raw[53] = Math.max(0, Math.min(31, 30 - 0.30 * Math.pow(Math.abs(p.la - thermal), 1.4)));
      }
      if (hsin || hcos) prevDir = [hsin, hcos];
      if (k === 8) v0 = [se, sn];   // current velocity (raw km/6h) for the persistence-residual head
      for (var c = 0; c < D; c++) { var vv = (raw[c] - mean[c]) / std[c]; feat[off + c] = isFinite(vv) ? vv : 0; }
      prev = hidx[k];
    }
    return { ok: true, feat: feat, base: base, v0: v0 };
  }
  function tfRunModel(pts, baseHour) {
    var built = tfBuildFeat(pts, baseHour);
    if (!built.ok) return Promise.reject(new Error(built.base
      ? "Need about two days of 6-hourly track before this point — scrub a bit later."
      : "No usable track history at this point."));
    var meta = tfRT.meta, TS = meta.target_scale, leads = meta.lead_hours, O = meta.out_dim, D = meta.feat_dim || 48;
    return tfRT.session.run({
      track: new window.ort.Tensor("float32", built.feat, [1, 9, D]),
      v0: new window.ort.Tensor("float32", new Float32Array(built.v0), [1, 2])
    }).then(function (res) {
      var state = (res.state || res[Object.keys(res)[0]]).data;
      var base = built.base, la = base.la, lo = base.lo, points = [], motion = [];
      for (var i = 0; i < leads.length; i++) {
        var o = i * O, e = state[o] * TS[0], n = state[o + 1] * TS[1];
        motion.push([e, n]);                                       // per-step motion (km) for the ensemble
        var la2 = la + n / 111.2, lo2 = lo + e / (111.2 * Math.cos((la + la2) / 2 * Math.PI / 180));
        var radiiKm = []; for (var q = 0; q < 12; q++) radiiKm.push(Math.max(0, state[o + 5 + q]) * TS[5 + q] * TF_NM);
        points.push({ lead_hours: leads[i], lat: la2, lon: lo2,
          vmax: Math.max(0, state[o + 2] * TS[2]), pres: state[o + 3] * TS[3], rmw: Math.max(0, state[o + 4] * TS[4]) * TF_NM,
          radiiKm: radiiKm });
        la = la2; lo = lo2;
      }
      // Uncertainty cone. Half-width per lead is the ensemble's data-driven 90%
      // position radius (from v8's own forecast-error covariance, cone_km), laid
      // PERPENDICULAR to the local heading. Falls back to a climatological growth
      // (~3.3 km/h) if the ensemble artifact didn't load. (The model's raw log-scale
      // head is miscalibrated — it saturates and blew the cone to ~40,000 km — so
      // the covariance-derived cone replaces it.)
      var coneKm = (tfRT.ens && tfRT.ens.cone_km) ? tfRT.ens.cone_km : null;
      var prevLat = base.la, prevLon = base.lo;
      for (var k = 0; k < points.length; k++) {
        var p = points[k];
        var cosk = Math.cos(p.lat * Math.PI / 180) || 1e-6;
        var dxE = (aiPmod(p.lon - prevLon + 180, 360) - 180) * cosk, dyN = p.lat - prevLat;
        var mag = Math.hypot(dxE, dyN) || 1e-6, pE = -dyN / mag, pN = dxE / mag;   // unit perpendicular
        var hwDeg = (coneKm ? coneKm[k] : 3.3 * p.lead_hours) / 111.2;              // half-width km -> deg
        var offLat = pN * hwDeg, offLon = (pE * hwDeg) / cosk;
        p.p90_lat = p.lat + offLat; p.p90_lon = p.lon + offLon;   // right edge
        p.p10_lat = p.lat - offLat; p.p10_lon = p.lon - offLon;   // left edge
        prevLat = p.lat; prevLon = p.lon;
      }
      return { initial_lat: base.la, initial_lon: base.lo, initial_vmax: base.w, points: points, motion: motion };
    });
  }
  // The model predicts vmax (1-min); classify it in whichever standard is active so
  // the AI dots read the same intensity scale (TD/TS/C1–C5, or CWA 輕/中/強) as the
  // real track. Taiwan uses the converted-1-min fallback (no predicted 10-min wind).
  function tfCat(vmax) {
    if (vmax == null || !isFinite(vmax)) return ["Tropical Depression", "rgb(150,190,215)"];
    var c = (standard === "taiwan") ? taiwanCat(vmax) : atlanticCat(vmax);
    return [c[0] || "Tropical Depression", c[1] || "rgb(150,190,215)"];
  }
  function tfCatColors(fc) {   // per-marker color array: init + each lead, by predicted category
    var cols = [tfCat(fc.initial_vmax)[1]];
    (fc.points || []).forEach(function (p) { cols.push(tfCat(p.vmax)[1]); });
    return cols;
  }
  // Faint 34-kt wind-field polygons at a few leads, from the model's radii output
  // — shows the storm's forecast SIZE, not just its path. Skips implausible values.
  function tfRadiiTraces(pts) {
    var traces = [], want = { 24: 1, 72: 1, 120: 1 };
    pts.forEach(function (p) {
      if (!want[p.lead_hours] || !p.radiiKm) return;
      var r34 = p.radiiKm.slice(0, 4), avg = avgRadius(r34);
      if (!(avg > 15 && avg < 700)) return;
      var poly = radiusPolygon(p.lat, p.lon, r34);
      if (!poly) return;
      traces.push({ type: "scattergeo", mode: "lines", lat: poly.lat, lon: poly.lon,
        fill: "toself", fillcolor: "rgba(52,211,153,0.05)", line: { color: "rgba(52,211,153,0.28)", width: 1 },
        hoverinfo: "text", text: "AI +" + p.lead_hours + " h · predicted 34 kt wind radius ~" + Math.round(avg) + " km", showlegend: false });
    });
    return traces;
  }
  // Hover text carrying the model's full predicted state at a lead: category, wind,
  // pressure, RMW, and the 34/50/64-kt wind radii.
  function tfHover(p) {
    var r34 = p.radiiKm ? avgRadius(p.radiiKm.slice(0, 4)) : null,
        r50 = p.radiiKm ? avgRadius(p.radiiKm.slice(4, 8)) : null,
        r64 = p.radiiKm ? avgRadius(p.radiiKm.slice(8, 12)) : null;
    var rads = [];
    if (r34 > 1) rads.push("R34 ~" + Math.round(r34));
    if (r50 > 1) rads.push("R50 ~" + Math.round(r50));
    if (r64 > 1) rads.push("R64 ~" + Math.round(r64));
    return "<b>" + tfCat(p.vmax)[0] + "</b><br>AI +" + p.lead_hours + " h · " + fmtLatLon(p.lat, p.lon)
      + "<br>" + Math.round(p.vmax) + " kt · " + Math.round(p.pres) + " mb"
      + (p.rmw ? " · RMW " + Math.round(p.rmw) + " km" : "")
      + (rads.length ? "<br>wind radii: " + rads.join(" · ") + " km" : "");
  }
  function aiSetHindcastStatus(msg, cls) {
    if (!els.hindcastStatus) return;
    els.hindcastStatus.textContent = msg || "";
    els.hindcastStatus.className = "tt-ai-status" + (cls ? " tt-ai-status--" + cls : "");
  }
  function aiClearHindcast() {
    var idx = tfTraceIdx(TF_HIND);
    if (idx.length) Plotly.deleteTraces(els.map, idx);
    hindcastTraceCount = 0;
    if (els.hindcastBtn) { els.hindcastBtn.setAttribute("aria-pressed", "false"); els.hindcastBtn.classList.remove("is-on"); }
    aiSetHindcastStatus("");
  }
  var hindcastFollowRun = false, hindcastFollowTs = 0;
  var ACT_HOVER = "actual track (what really happened)";
  // Shared trace data for the overlay — used by both the initial draw and the
  // in-place restyle that lets it follow the playhead. Fixed layout: cone, three
  // 34-kt rings (+24/+72/+120 h, empty if implausible), actual track, mean track.
  function tfHindcastData(fc, initHour) {
    var pts = fc.points || [], rev = pts.slice().reverse();
    var meanLat = [fc.initial_lat], meanLon = [fc.initial_lon], meanTxt = ["AI init · " + fmtLatLon(fc.initial_lat, fc.initial_lon)];
    pts.forEach(function (p) { meanLat.push(p.lat); meanLon.push(p.lon); meanTxt.push(tfHover(p)); });
    var coneLat = [fc.initial_lat].concat(pts.map(function (p) { return p.p90_lat; })).concat(rev.map(function (p) { return p.p10_lat; }));
    var coneLon = [fc.initial_lon].concat(pts.map(function (p) { return p.p90_lon; })).concat(rev.map(function (p) { return p.p10_lon; }));
    var actLat = [fc.initial_lat], actLon = [fc.initial_lon];
    currentStorm.pts.forEach(function (p) { if (p.h > initHour + 0.01 && p.la != null) { actLat.push(p.la); actLon.push(p.lo); } });
    var rings = [24, 72, 120].map(function (L) {
      var p = null, i; for (i = 0; i < pts.length; i++) if (pts[i].lead_hours === L) { p = pts[i]; break; }
      if (p && p.radiiKm) {
        var r34 = p.radiiKm.slice(0, 4), avg = avgRadius(r34);
        if (avg > 15 && avg < 700) { var poly = radiusPolygon(p.lat, p.lon, r34);
          if (poly) return { lat: poly.lat, lon: poly.lon, text: "AI +" + L + " h · predicted 34 kt wind radius ~" + Math.round(avg) + " km" }; }
      }
      return { lat: [], lon: [], text: "" };
    });
    return { coneLat: coneLat, coneLon: coneLon, rings: rings, actLat: actLat, actLon: actLon,
      meanLat: meanLat, meanLon: meanLon, meanTxt: meanTxt, meanColors: tfCatColors(fc) };
  }
  function tfHindcastStatusText() {
    var ens = tfRT.ens ? " Faint green lines are an ensemble of possible tracks sampled from the model's own forecast-error covariance; the shaded cone is the 90% area." : "";
    return "🧪 " + (currentStorm.name || "This storm") + " — my TrackFormer model forecast from this point, dots coloured by forecast intensity category (hover for wind, pressure & 34/50/64 kt radii; faint rings = predicted gale radius), vs what actually happened (white)." + ens + " Press play and it re-forecasts as the storm moves. Experimental, not an official forecast.";
  }
  function aiDrawHindcast(fc, initHour) {
    aiClearHindcast();
    var d = tfHindcastData(fc, initHour), sp = tfSpaghetti(fc);
    function ring(r) { return { type: "scattergeo", mode: "lines", lat: r.lat, lon: r.lon, fill: "toself", meta: TF_HIND,
      fillcolor: "rgba(52,211,153,0.05)", line: { color: "rgba(52,211,153,0.28)", width: 1 }, hoverinfo: "text", text: r.text, showlegend: false }; }
    // Fixed 7-trace block so the follow-the-playhead restyle stays in place:
    // cone, ensemble routes (one null-separated trace), 3 rings, actual, mean.
    // Every trace is tagged so it can be found by tag rather than by tail position —
    // that lets the consensus overlay coexist with this one during the animation.
    var traces = [
      { type: "scattergeo", mode: "lines", lat: d.coneLat, lon: d.coneLon, fill: "toself", meta: TF_HIND,
        fillcolor: "rgba(52,211,153,0.08)", line: { color: "rgba(52,211,153,0.28)", width: 1 }, hoverinfo: "skip", showlegend: false },
      { type: "scattergeo", mode: "lines", lat: sp.lat, lon: sp.lon, connectgaps: false, meta: TF_HIND,
        line: { color: "rgba(52,211,153,0.14)", width: 1 }, hoverinfo: "skip", showlegend: false },
      ring(d.rings[0]), ring(d.rings[1]), ring(d.rings[2]),
      { type: "scattergeo", mode: "lines", lat: d.actLat, lon: d.actLon, meta: TF_HIND,
        line: { color: "rgba(255,255,255,0.9)", width: 2.5 }, hoverinfo: "text", text: ACT_HOVER, showlegend: false },
      { type: "scattergeo", mode: "lines+markers", lat: d.meanLat, lon: d.meanLon, meta: TF_HIND,
        line: { color: "rgb(52,211,153)", width: 3, dash: "dash" },
        marker: { size: 7, color: d.meanColors, line: { width: 1.6, color: "rgba(52,211,153,0.95)" } },   // dots by predicted category, emerald-ringed = AI
        text: d.meanTxt, hoverinfo: "text", showlegend: false }
    ];
    Plotly.addTraces(els.map, traces);
    hindcastTraceCount = traces.length;   // fixed 7, so a follow-update can restyle in place
    if (els.hindcastBtn) { els.hindcastBtn.setAttribute("aria-pressed", "true"); els.hindcastBtn.classList.add("is-on"); }
    aiSetHindcastStatus(tfHindcastStatusText(), "on");
  }
  // In-place update (restyle) so the overlay follows the playhead smoothly, no
  // flicker from delete+add. Falls back to a full redraw if the layout drifted.
  function aiUpdateHindcast(fc, initHour) {
    var block = tfTraceIdx(TF_HIND);
    if (hindcastTraceCount !== 7 || block.length !== 7) { aiDrawHindcast(fc, initHour); return; }
    var d = tfHindcastData(fc, initHour), sp = tfSpaghetti(fc), i0 = block[0];
    Plotly.restyle(els.map, {
      lat: [d.coneLat, sp.lat, d.rings[0].lat, d.rings[1].lat, d.rings[2].lat, d.actLat, d.meanLat],
      lon: [d.coneLon, sp.lon, d.rings[0].lon, d.rings[1].lon, d.rings[2].lon, d.actLon, d.meanLon]
    }, [i0, i0 + 1, i0 + 2, i0 + 3, i0 + 4, i0 + 5, i0 + 6]);
    Plotly.restyle(els.map, { text: [d.rings[0].text, d.rings[1].text, d.rings[2].text, ACT_HOVER, d.meanTxt] }, [i0 + 2, i0 + 3, i0 + 4, i0 + 5, i0 + 6]);
    Plotly.restyle(els.map, { "marker.color": [d.meanColors] }, [i0 + 6]);
  }
  // While the overlay is on, re-forecast from the current playhead as the animation
  // (or a manual scrub) moves — throttled + in-flight-guarded + updated in place.
  // Keeps the last good forecast if the playhead is too early (<~2 days of history).
  function hindcastFollowTick(force) {
    if (hindcastTraceCount === 0 || !tfRT.session || hindcastFollowRun) return;
    var now = Date.now();
    if (!force && now - hindcastFollowTs < 240) return;
    hindcastFollowTs = now; hindcastFollowRun = true;
    var h = Number(els.slider.value);
    tfRunModel(currentStorm.pts, h).then(function (fc) {
      if (hindcastTraceCount > 0) aiUpdateHindcast(fc, h);
    }, function () {}).then(function () { hindcastFollowRun = false; });
  }
  /* --- Multi-initialisation consensus ------------------------------------------
     Runs the model from EVERY 6-hourly init along the storm, then at each valid time
     combines the forecasts that land on it. Those members carry different lead times
     (one 6 h out, one 120 h out) so an equal mean is wrong: we use the min-variance
     combination w = C^-1 1 / (1' C^-1 1) over the shipped lead x lead position-error
     covariance, clip negative weights, and feed the combination variance
     R = 1/(1' C^-1 1) to a constant-velocity Kalman + RTS smoother — a storm has
     momentum, so the track must not jump when short-lead membership rotates.
     Inference is ~2 ms, so ~40 inits is well under a tenth of a second. ---------- */
  function tfMatInv(A, n) {                 // Gauss-Jordan with partial pivoting; null if singular
    var M = [], i, j, k;
    for (i = 0; i < n; i++) { M[i] = []; for (j = 0; j < n; j++) M[i][j] = A[i * n + j]; for (j = 0; j < n; j++) M[i][n + j] = (i === j) ? 1 : 0; }
    for (i = 0; i < n; i++) {
      var piv = i; for (k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
      if (Math.abs(M[piv][i]) < 1e-12) return null;
      var tmp = M[i]; M[i] = M[piv]; M[piv] = tmp;
      var d = M[i][i]; for (j = i; j < 2 * n; j++) M[i][j] /= d;
      for (k = 0; k < n; k++) { if (k === i) continue; var f = M[k][i]; if (!f) continue; for (j = i; j < 2 * n; j++) M[k][j] -= f * M[i][j]; }
    }
    var out = new Float64Array(n * n);
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) out[i * n + j] = M[i][n + j];
    return out;
  }
  // Constant-velocity Kalman filter + RTS smoother on 2-D positions (km).
  function tfRtsSmooth(th, zx, zy, rvar, qA) {
    var n = th.length, i;
    var xs = [], Ps = [], xp = [], Pp = [];
    var x = [zx[0], zy[0], 0, 0];
    var P = [[rvar[0], 0, 0, 0], [0, rvar[0], 0, 0], [0, 0, 2500, 0], [0, 0, 0, 2500]];
    function mul(A, B) { var C = [], r, c, k2; for (r = 0; r < 4; r++) { C[r] = []; for (c = 0; c < 4; c++) { var s = 0; for (k2 = 0; k2 < 4; k2++) s += A[r][k2] * B[k2][c]; C[r][c] = s; } } return C; }
    function T(A) { var C = [], r, c; for (r = 0; r < 4; r++) { C[r] = []; for (c = 0; c < 4; c++) C[r][c] = A[c][r]; } return C; }
    for (i = 0; i < n; i++) {
      if (i > 0) {
        var dt = Math.max(th[i] - th[i - 1], 1e-3);
        var F = [[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]];
        var d4 = dt * dt * dt * dt / 4, d3 = dt * dt * dt / 2, d2 = dt * dt;
        var Q = [[qA * d4, 0, qA * d3, 0], [0, qA * d4, 0, qA * d3], [qA * d3, 0, qA * d2, 0], [0, qA * d3, 0, qA * d2]];
        var nx = [x[0] + dt * x[2], x[1] + dt * x[3], x[2], x[3]];
        P = mul(mul(F, P), T(F));
        for (var a = 0; a < 4; a++) for (var b = 0; b < 4; b++) P[a][b] += Q[a][b];
        x = nx;
      }
      xp[i] = x.slice(); Pp[i] = P.map(function (r) { return r.slice(); });
      var R = Math.max(rvar[i], 1e-3);
      // H picks [x,y]; S = HPH' + R (2x2), K = P H' S^-1 (4x2)
      var S00 = P[0][0] + R, S01 = P[0][1], S10 = P[1][0], S11 = P[1][1] + R;
      var det = S00 * S11 - S01 * S10; if (Math.abs(det) < 1e-12) det = 1e-12;
      var Si = [[S11 / det, -S01 / det], [-S10 / det, S00 / det]];
      var K = [];
      for (var r2 = 0; r2 < 4; r2++) K[r2] = [P[r2][0] * Si[0][0] + P[r2][1] * Si[1][0], P[r2][0] * Si[0][1] + P[r2][1] * Si[1][1]];
      var yx = zx[i] - x[0], yy = zy[i] - x[1];
      for (r2 = 0; r2 < 4; r2++) x[r2] = x[r2] + K[r2][0] * yx + K[r2][1] * yy;
      var Pn = [];
      for (r2 = 0; r2 < 4; r2++) { Pn[r2] = []; for (var c2 = 0; c2 < 4; c2++) Pn[r2][c2] = P[r2][c2] - (K[r2][0] * P[0][c2] + K[r2][1] * P[1][c2]); }
      P = Pn;
      xs[i] = x.slice(); Ps[i] = P.map(function (rr) { return rr.slice(); });
    }
    for (i = n - 2; i >= 0; i--) {                       // RTS backward pass
      var dt2 = Math.max(th[i + 1] - th[i], 1e-3);
      var F2 = [[1, 0, dt2, 0], [0, 1, 0, dt2], [0, 0, 1, 0], [0, 0, 0, 1]];
      var PpInv = tfMatInv(new Float64Array([].concat.apply([], Pp[i + 1])), 4);
      if (!PpInv) continue;
      var PFt = mul(Ps[i], T(F2)), G = [];
      for (var r3 = 0; r3 < 4; r3++) { G[r3] = []; for (var c3 = 0; c3 < 4; c3++) { var s3 = 0; for (var k3 = 0; k3 < 4; k3++) s3 += PFt[r3][k3] * PpInv[k3 * 4 + c3]; G[r3][c3] = s3; } }
      for (r3 = 0; r3 < 4; r3++) { var acc = 0; for (k3 = 0; k3 < 4; k3++) acc += G[r3][k3] * (xs[i + 1][k3] - xp[i + 1][k3]); xs[i][r3] += acc; }
    }
    return { x: xs.map(function (s) { return s[0]; }), y: xs.map(function (s) { return s[1]; }) };
  }
  // Build the consensus track for the whole storm. Returns {lat,lon,n} or null.
  function tfConsensus(pts, minLeadH) {
    var cons = tfRT.cons; if (!cons || !cons.C) return Promise.resolve(null);
    var C = cons.C, MINM = cons.min_members || 3, qA = cons.q_accel || 3.0;
    var leadsH = tfRT.meta.lead_hours;
    // ONLY combine forecasts made at least minLeadH ahead. Without this the
    // minimum-variance solution collapses onto the +6 h member (89% of the weight,
    // sigma 34 km vs 1181 km at +120 h) — and a +6 h forecast is essentially
    // persistence from the position observed 6 h earlier, so the "consensus" just
    // retraced the observed track instead of showing what the model predicts.
    minLeadH = minLeadH || TF_CONS_MIN_LEAD_H;
    // one init per 6-hourly fix that has enough history
    var inits = [];
    for (var i = 0; i < pts.length; i++) if (pts[i].h != null) inits.push(pts[i].h);
    var runs = [], chain = Promise.resolve();
    inits.forEach(function (h) {
      chain = chain.then(function () {
        return tfRunModel(pts, h).then(function (fc) { runs.push({ h: h, fc: fc }); }, function () {});
      });
    });
    return chain.then(function () {
      if (runs.length < 2) return null;
      var bins = {};                                   // valid hour -> [{lead index, lat, lon}]
      runs.forEach(function (r) {
        r.fc.points.forEach(function (p, li) {
          if (leadsH[li] < minLeadH) return;         // drop the near-persistence short leads
          var vt = Math.round((r.h + leadsH[li]) / 6) * 6;
          (bins[vt] = bins[vt] || []).push({ L: li, lat: p.lat, lon: p.lon });
        });
      });
      // Keep only valid times the storm actually reached: leads from late inits project
      // past the end of the record, and that tail is pure extrapolation with nothing to
      // verify it against. Trimming makes the consensus directly comparable to the actual track.
      var lastH = -1e9;
      for (var q2 = 0; q2 < pts.length; q2++) if (pts[q2].h != null && pts[q2].h > lastH) lastH = pts[q2].h;
      var times = Object.keys(bins).map(Number).sort(function (a, b) { return a - b; })
        .filter(function (t) { return bins[t].length >= MINM && t <= lastH; });
      if (times.length < 3) return null;
      var zlat = [], zlon = [], rvar = [];
      times.forEach(function (t) {
        var mem = bins[t], m = mem.length, i2, j2;
        var sub = new Float64Array(m * m);
        for (i2 = 0; i2 < m; i2++) for (j2 = 0; j2 < m; j2++) sub[i2 * m + j2] = C[mem[i2].L * 20 + mem[j2].L];
        var tr = 0; for (i2 = 0; i2 < m; i2++) tr += sub[i2 * m + i2];
        for (i2 = 0; i2 < m; i2++) sub[i2 * m + i2] += 1e-6 * tr / m;      // ridge
        var inv = tfMatInv(sub, m), w = [], sum = 0, denom = 0;
        if (inv) {
          for (i2 = 0; i2 < m; i2++) { var s4 = 0; for (j2 = 0; j2 < m; j2++) s4 += inv[i2 * m + j2]; w[i2] = Math.max(0, s4); sum += w[i2]; denom += s4; }
        }
        if (!inv || sum <= 0) { for (i2 = 0; i2 < m; i2++) w[i2] = 1 / m; sum = 1; denom = m / Math.max(C[0], 1); }
        var la = 0, lo = 0;
        for (i2 = 0; i2 < m; i2++) { la += (w[i2] / sum) * mem[i2].lat; lo += (w[i2] / sum) * mem[i2].lon; }
        zlat.push(la); zlon.push(lo); rvar.push(denom > 0 ? Math.max(1 / denom, 1) : 1e4);
      });
      // smooth in a local km frame
      var lat0 = zlat.reduce(function (a, b) { return a + b; }, 0) / zlat.length;
      var lon0 = zlon.reduce(function (a, b) { return a + b; }, 0) / zlon.length;
      var cos0 = Math.cos(lat0 * Math.PI / 180) || 1e-6;
      var zx = zlon.map(function (v) { return (aiPmod(v - lon0 + 180, 360) - 180) * 111.2 * cos0; });
      var zy = zlat.map(function (v) { return (v - lat0) * 111.2; });
      var sm = tfRtsSmooth(times, zx, zy, rvar, qA);
      return { lat: sm.y.map(function (v) { return lat0 + v / 111.2; }),
               lon: sm.x.map(function (v) { return lon0 + v / (111.2 * cos0); }),
               n: runs.length, times: times };
    });
  }
  // The consensus is a whole-storm line, so on its own nothing moves while the
  // animation runs. This walks the REAL track out from the storm's start to the
  // playhead, so you watch what actually happened trace itself against the
  // consensus as it plays. Restyled in place on every scrub/play tick.
  function consensusFollowTick() {
    if (consensusTraceCount === 0 || !currentStorm) return;
    var idx = tfTraceIdx(TF_CONS_ACT);
    if (!idx.length) return;
    var h = Number(els.slider.value), la = [], lo = [];
    currentStorm.pts.forEach(function (p) {
      if (p.la != null && p.h != null && p.h <= h + 0.01) { la.push(p.la); lo.push(p.lo); }
    });
    Plotly.restyle(els.map, { lat: [la], lon: [lo] }, idx);
  }
  function aiClearConsensus() {
    var idx0 = tfTraceIdx(TF_CONS).concat(tfTraceIdx(TF_CONS_ACT)).sort(function (a, b) { return a - b; });
    if (idx0.length) Plotly.deleteTraces(els.map, idx0);
    consensusTraceCount = 0;
    if (els.consensusBtn) { els.consensusBtn.setAttribute("aria-pressed", "false"); els.consensusBtn.classList.remove("is-on"); }
  }
  function aiConsensusToggle() {
    if (appMode !== "track" || viewMode !== "storm" || !currentStorm) return;
    if (consensusTraceCount > 0) { aiClearConsensus(); aiSetHindcastStatus(""); return; }
    if (aiLoading) return;
    aiLoading = true;
    aiSetHindcastStatus(tfRT.session ? "Running every initialisation…" : "Loading my AI model…", "loading");
    tfEnsureModel().then(function () { return tfConsensus(currentStorm.pts); })
      .then(function (c) {
        aiLoading = false;
        if (!c) { aiSetHindcastStatus("Not enough of this storm to build a consensus.", "err"); return; }
        Plotly.addTraces(els.map, [{
          type: "scattergeo", mode: "lines", lat: c.lat, lon: c.lon, meta: TF_CONS,
          line: { color: "rgb(250,204,21)", width: 3 }, hoverinfo: "text",
          text: "consensus of " + c.n + " initialisations (min-variance by lead + Kalman/RTS smoothed)",
          showlegend: false
        }, {
          // what actually happened, drawn only as far as the playhead — this is the
          // trace that "plays" while the animation runs, against the yellow consensus
          type: "scattergeo", mode: "lines", lat: [], lon: [], meta: TF_CONS_ACT,
          line: { color: "rgba(255,255,255,0.95)", width: 3 }, hoverinfo: "text",
          text: ACT_HOVER, showlegend: false
        }]);
        consensusTraceCount = 2;
        consensusFollowTick();          // fill the white line up to the current playhead
        els.consensusBtn.setAttribute("aria-pressed", "true"); els.consensusBtn.classList.add("is-on");
        // Honest framing: this is an ANALYSIS, not a forecast. The minimum-variance
        // solve puts ~89% of the weight on the +6 h member (sigma 34 km vs 1181 km at
        // +120 h), and a +6 h forecast is near-persistence from the position observed
        // 6 h earlier — so it necessarily sits close to the real track. Every member is
        // still model output, and none of them sees data at or after its own valid time.
        var inSample = currentStorm && Number(currentStorm.season) <= 2015;
        aiSetHindcastStatus("🧭 Best-estimate track (yellow) — my model re-run from every 6-hourly "
          + "initialisation (" + c.n + " of them), combined at each time by minimum-variance weighting over lead "
          + "time and smoothed with a Kalman/RTS filter. This is an ANALYSIS, not a forecast: the weighting "
          + "lands ~89% on the +6 h member, which is near-persistence, so it deliberately hugs the real track. "
          + "For actual forecast skill use “Predict from here”. "
          + (inSample ? "⚠️ This storm (" + currentStorm.season + ") is in the model's TRAINING data — it is "
              + "in-sample and will flatter the model. Pick a 2020+ storm for an honest out-of-sample view. " : "")
          + "Press play — the white line is what actually happened, drawn out to the playhead.", "on");
      })
      .catch(function (e) { aiLoading = false; aiSetHindcastStatus((e && e.message) || String(e), "err"); });
  }
  function aiHindcastToggle() {
    if (appMode !== "track" || viewMode !== "storm" || !currentStorm) return;
    if (hindcastTraceCount > 0) { aiClearHindcast(); return; }   // toggle off
    if (aiLoading) return;
    var initHour = Number(els.slider.value);
    aiLoading = true;
    aiSetHindcastStatus(tfRT.session ? "Running my AI model…" : "Loading my AI model (~one-time 30 MB download)…", "loading");
    tfEnsureModel()
      .then(function () { return tfRunModel(currentStorm.pts, initHour); })
      .then(function (fc) { aiLoading = false; aiDrawHindcast(fc, initHour); })
      .catch(function (e) { aiLoading = false; aiSetHindcastStatus(((e && e.message) || String(e)), "err"); });
  }

  // One continuous timeline. The PAST leg comes from JMA best-track (via
  // Digital Typhoon) when available — real position, wind, and storm radius per
  // observation — hours measured back from the JMA analysis time. If that isn't
  // available we fall back to JMA's position-only observed track. The forecast
  // leg is the JMA forecast points (radius + expected intensity).
  function buildTimeline(d) {
    var tl = [];
    var baseMs = (d.points[0] && d.points[0].valid) ? Date.parse(d.points[0].valid.UTC) : null;
    if (d.past && d.past.length && baseMs != null) {
      d.past.forEach(function (o) {
        if (o.timeMs >= baseMs - 1800000) return; // strictly before "now"
        tl.push({ h: (o.timeMs - baseMs) / 3600000, lat: o.lat, lon: o.lon,
          stormKm: o.stormKm, galeKm: o.galeKm, windKt: o.windKt,
          tNum: pointT(d, o.windKt, o.timeMs, true) });   // real CIMSS T for the past
      });
    } else {
      var obs = d.observed || [], N = obs.length;
      for (var i = 0; i < N - 1; i++) {
        tl.push({ h: -6 * (N - 1 - i), lat: obs[i][0], lon: obs[i][1], stormKm: null, galeKm: null, windKt: null, tNum: null });
      }
    }
    // JMA forecasts the storm-force area but not a gale radius, so the outer
    // ring would vanish over the forecast leg. Estimate it by keeping the
    // gale−storm gap measured at "now" (analysis, where both are real), so the
    // two-ring wind field stays continuous. Flagged as estimated in the footer.
    var a0 = d.points[0];
    var galeGap = (a0 && a0.galeKm != null && a0.stormKm != null) ? (a0.galeKm - a0.stormKm) : null;
    d.points.forEach(function (p) {
      var gk = p.galeKm;
      if (gk == null && p.h > 0 && p.stormKm != null && galeGap != null) gk = Math.round(p.stormKm + galeGap);
      tl.push({ h: p.h, lat: p.lat, lon: p.lon, stormKm: p.stormKm, galeKm: gk, windKt: p.windKt,
        tNum: anchoredT(d, p.windKt) });   // CIMSS-anchored expected T
    });
    tl.sort(function (a, b) { return a.h - b.h; });
    return tl;
  }
  function lerpMaybe(x, y, f) {
    if (x == null && y == null) return null;
    if (x == null) return y;
    if (y == null) return x;
    return x + (y - x) * f;
  }
  function tlInterp(tl, t) {
    if (t <= tl[0].h) return tl[0];
    var last = tl[tl.length - 1];
    if (t >= last.h) return last;
    for (var i = 0; i < tl.length - 1; i++) {
      var a = tl[i], b = tl[i + 1];
      if (t >= a.h && t <= b.h) {
        var f = (b.h - a.h) > 0 ? (t - a.h) / (b.h - a.h) : 0;
        return {
          h: t,
          lat: a.lat + (b.lat - a.lat) * f,
          lon: a.lon + (b.lon - a.lon) * f,
          stormKm: lerpMaybe(a.stormKm, b.stormKm, f),
          galeKm: lerpMaybe(a.galeKm, b.galeKm, f),
          windKt: lerpMaybe(a.windKt, b.windKt, f),
          tNum: lerpMaybe(a.tNum, b.tNum, f)
        };
      }
    }
    return last;
  }
  // Draw both wind rings (gale outer, storm inner) + the marker at point p.
  // A ring with no radius (weak storm / no forecast data) collapses to a point.
  // ONE combined restyle → one map redraw per frame instead of three (the
  // marker.size entries for the two line-mode ring traces are inert).
  function restyleSweep(p, pulse) {
    if (fcSweepCircleIdx < 0) return;
    var gale = (p.galeKm > 0) ? circlePolygon(p.lat, p.lon, p.galeKm) : { lat: [p.lat], lon: [p.lon] };
    var storm = (p.stormKm > 0) ? circlePolygon(p.lat, p.lon, p.stormKm) : { lat: [p.lat], lon: [p.lon] };
    Plotly.restyle(els.map, {
      lat: [gale.lat, storm.lat, [p.lat]],
      lon: [gale.lon, storm.lon, [p.lon]],
      "marker.size": [1, 1, pulse]
    }, [fcSweepGaleIdx, fcSweepCircleIdx, fcSweepMarkerIdx]);
  }
  // Live readout element (updated per frame; not a full innerHTML rebuild).
  function updateSweepLive(p) {
    var el = document.getElementById("tt-fc-live");
    var chip = document.getElementById("tt-fc-tnum");
    if (!el) return;
    if (!p || p.windKt == null) {   // truly no data (pre-classification / no best-track)
      el.innerHTML = '<span class="tt-fc-live-dot tt-fc-live-dot--past"></span><span class="tt-fc-live-past">replaying observed track…</span>';
      if (chip) { chip.textContent = "T—"; chip.className = "tt-fc-tnum"; }
      return;
    }
    var tnum = fmtT(p.tNum);
    var phase = p.h == null || Math.abs(p.h) < 0.5 ? "now" : (p.h < 0 ? "past" : "fcst");
    var when = phase === "now" ? "now" : (p.h < 0 ? "−" + Math.round(-p.h) + " h" : "+" + Math.round(p.h) + " h");
    var rad = "";
    if (p.stormKm != null && p.galeKm != null) rad = " · storm " + Math.round(p.stormKm) + " / gale " + Math.round(p.galeKm) + " km";
    else if (p.stormKm != null) rad = " · storm radius " + Math.round(p.stormKm) + " km";
    el.innerHTML = '<span class="tt-fc-live-dot"></span>' + when +
      " · ~" + Math.round(p.windKt) + " kt" + (tnum ? " · " + tnum : "") + rad;
    // live Dvorak T chip — past / now / expected, changing with the sweep
    if (chip && tnum) {
      chip.textContent = tnum + (phase === "fcst" ? " exp." : phase === "past" ? " past" : "");
      chip.className = "tt-fc-tnum tt-fc-tnum--" + phase;
    }
  }

  // Sweep the marker + wind-radius circle across the whole timeline, then hold
  // and loop. The past portion plays quicker (it's context); the forecast
  // portion — the point of interest — plays slower. dt-based (frame-rate
  // independent); disabled under prefers-reduced-motion (rests at "now").
  // State lives in fcState so the play/pause/replay/speed controls can drive it.
  var FC_PAST_SECONDS = 6, FC_FUTURE_SECONDS = 9, FC_HOLD_SECONDS = 1.6;
  var FC_DRAW_MS = 33;          // cap sweep redraws at ~30fps — a Plotly geo restyle is the cost, not the math
  var fcState = null;
  var fcMapVisible = true;      // false while the forecast map is scrolled out of view (animation rests)
  function cancelForecastAnim() {
    if (fcAnim) { cancelAnimationFrame(fcAnim); fcAnim = null; }
  }
  function formatSweepTime(t) {
    if (!fcState || fcState.baseMs == null) {
      return Math.abs(t) < 0.5 ? "now" : (t > 0 ? "+" : "−") + Math.round(Math.abs(t)) + "h";
    }
    var d = new Date(fcState.baseMs + t * 3600000);
    var mm = ("0" + (d.getUTCMonth() + 1)).slice(-2), dd = ("0" + d.getUTCDate()).slice(-2);
    var hh = ("0" + d.getUTCHours()).slice(-2);
    var rel = Math.abs(t) < 0.5 ? "now" : (t > 0 ? "+" : "−") + Math.round(Math.abs(t)) + "h";
    return mm + "-" + dd + " " + hh + "Z · " + rel;
  }
  // Render the sweep (marker + wind-radius circle + live readout) at timeline
  // hour t. syncSlider=false while the user is dragging the slider (so we don't
  // fight their input). Shared by the animation loop and the scrubber.
  function sweepTo(t, pulse, syncSlider) {
    if (!fcState) return;
    var p = tlInterp(fcState.tl, t);
    restyleSweep(p, pulse);
    updateSweepLive(p);
    if (els.fcTime) els.fcTime.textContent = formatSweepTime(t);
    if (syncSlider !== false && els.fcSlider) els.fcSlider.value = t;
  }
  function fcFrame(ts) {
    var s = fcState;
    if (!s || appMode !== "predict" || s.paused || !fcMapVisible) { fcAnim = null; return; }
    var dt = s.lastTs == null ? 0 : Math.min((ts - s.lastTs) / 1000, 0.25);
    s.lastTs = ts;
    var holding = s.holdUntil > 0;
    if (holding) {
      if (ts >= s.holdUntil) { s.holdUntil = 0; holding = false; s.t = s.startH; s.lastDrawTs = 0; aiEnsureOverlay(); }
    } else {
      s.t += (s.t < 0 ? s.pastRate : s.futureRate) * s.speed * dt;
      if (s.t >= s.endH) { s.t = s.endH; s.holdUntil = ts + FC_HOLD_SECONDS * 1000; aiEnsureOverlay(); }
    }
    // The position math above runs every rAF (cheap); the redraw is throttled to
    // ~30fps and frozen entirely during the end-of-loop hold — that's the win.
    if (!holding && ts - (s.lastDrawTs || 0) >= FC_DRAW_MS) {
      s.lastDrawTs = ts;
      sweepTo(s.t, 11 + Math.sin(ts / 180) * 2, true);
    }
    fcAnim = requestAnimationFrame(fcFrame);
  }
  function startForecastAnim(d) {
    cancelForecastAnim();
    var tl = buildTimeline(d);
    if (!tl.length) { fcState = null; return; }
    var startH = tl[0].h, endH = tl[tl.length - 1].h;
    var reduced = false;
    try { reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    var baseMs = (d.points[0] && d.points[0].valid) ? Date.parse(d.points[0].valid.UTC) : null;
    fcState = {
      tl: tl, startH: startH, endH: endH, baseMs: baseMs,
      pastRate: Math.max(1, -startH) / FC_PAST_SECONDS,
      futureRate: (endH > 0 ? endH : 1) / FC_FUTURE_SECONDS,
      t: startH, holdUntil: 0, lastTs: null, speed: 1,
      paused: reduced || endH <= 0
    };
    if (els.fcSlider) { els.fcSlider.min = startH; els.fcSlider.max = endH; els.fcSlider.value = fcState.t; }
    if (fcState.paused) {
      fcState.t = Math.max(0, endH);
      sweepTo(fcState.t, 11, true);
    } else {
      fcAnim = requestAnimationFrame(fcFrame);
    }
    syncPlayBtn();
    if (els.fcSpeed) els.fcSpeed.textContent = "1×";
  }
  function toggleForecastPlay() {
    if (!fcState) return;
    fcState.paused = !fcState.paused;
    if (!fcState.paused) { fcState.lastTs = null; if (!fcAnim) fcAnim = requestAnimationFrame(fcFrame); }
    else cancelForecastAnim();
    syncPlayBtn();
  }
  function replayForecastAnim() {
    if (!fcState) return;
    fcState.t = fcState.startH; fcState.holdUntil = 0; fcState.lastTs = null; fcState.paused = false;
    if (!fcAnim) fcAnim = requestAnimationFrame(fcFrame);
    syncPlayBtn();
  }
  function cycleForecastSpeed() {
    if (!fcState) return;
    fcState.speed = fcState.speed >= 2 ? 0.5 : (fcState.speed >= 1 ? 2 : 1);
    if (els.fcSpeed) els.fcSpeed.textContent = fcState.speed + "×";
  }
  function syncPlayBtn() {
    if (!els.fcPlay) return;
    var paused = !fcState || fcState.paused;
    els.fcPlay.textContent = paused ? "▶" : "⏸";
    els.fcPlay.setAttribute("aria-label", paused ? "Play forecast animation" : "Pause forecast animation");
  }

  // Intensity color for a JMA 10-min wind (kt), on JMA's own scale — the same
  // TD/TS/STS/TY palette the category badge uses, so the forecast timeline reads
  // in one visual language. Null wind (pre-classification) → muted.
  function fcWindColor(kt) {
    if (kt == null) return "rgba(152,162,189,0.5)";
    if (kt < 34) return CAT_COLOR.TD;
    if (kt < 48) return CAT_COLOR.TS;
    if (kt < 64) return CAT_COLOR.STS;
    return CAT_COLOR.TY;
  }

  function updateForecastPanel(d) {
    if (!els.predictPanel) return;
    var a = d.points[0];
    var catFull = CAT_NAME[a.catEn] || a.catEn || "Tropical cyclone";
    var badge = catFull + (a.intensity ? " · " + a.intensity : "") + (a.scale ? " · " + a.scale : "");
    var move = (a.course || "") + (a.speedKt != null ? " " + a.speedKt + " kt" : "");
    var curT = fmtT(anchoredT(d, a.windKt));   // CIMSS current real T
    var rows = d.points.slice(1).map(function (p) {
      var when = p.valid ? p.valid.UTC.slice(5, 16).replace("T", " ") + "Z" : "";
      var ft = fmtT(anchoredT(d, p.windKt));
      return '<div class="tt-fc-row" style="--fc-row:' + fcWindColor(p.windKt) + '"><span class="tt-fc-h">+' + p.h + "h</span>" +
        '<span class="tt-fc-when">' + when + "</span>" +
        '<span class="tt-fc-val">' + (p.pressure != null ? p.pressure + " hPa" : "—") +
        (p.windKt != null ? " · " + p.windKt + " kt" : "") + (ft ? " · " + ft : "") + "</span>" +
        '<span class="tt-fc-circ">±' + (p.circleKm != null ? p.circleKm + " km" : "—") + "</span></div>";
    }).join("");
    var issued = d.issue ? d.issue.JST.replace("T", " ").slice(0, 16) : "";

    els.predictPanel.innerHTML =
      '<div class="tt-pred-head">' +
        '<span class="tt-details-name">' + d.name.en + (d.name.jp ? " " + d.name.jp : "") + "</span>" +
        '<span class="tt-details-time">JMA official forecast' + (d.number ? " · Typhoon No." + d.number : "") + "</span>" +
      "</div>" +
      '<div class="tt-fc-badgerow">' +
        '<span class="tt-fc-badge" style="color:' + (CAT_COLOR[a.catEn] || "#fff") + '">' + badge + "</span>" +
        '<span class="tt-fc-tnum" id="tt-fc-tnum" title="Dvorak T-number at the current animation time — past &amp; expected, from best-track / forecast wind via the standard CI-number/wind table">' + (curT || "T—") + "</span>" +
      "</div>" +
      '<div class="tt-fc-live" id="tt-fc-live" aria-live="off"></div>' +
      '<div class="tt-details-grid">' +
        predItem("Pressure", a.pressure != null ? a.pressure + " hPa" : "—") +
        predItem("Max wind", a.windKt != null ? a.windKt + " kt" : "—") +
        predItem("Gusts", a.gustKt != null ? a.gustKt + " kt" : "—") +
        predItem("Moving", move || "—") +
      "</div>" +
      '<div class="tt-fc-pos">' + fmtLatLon(a.lat, a.lon) + (a.location ? " · " + translateLocation(a.location) : "") + "</div>" +
      '<div class="tt-fc-subhead">5-day forecast · T = Dvorak (± = 70% circle)</div>' +
      '<div class="tt-fc-rows">' + (rows || '<div class="tt-fc-row">No forecast points issued.</div>') + "</div>" +
      '<div class="tt-pred-foot">Forecast &amp; current: <a href="https://www.jma.go.jp/bosai/map.html#contents=typhoon&lang=en" target="_blank" rel="noopener">JMA</a>' +
        (issued ? ", issued " + issued + " JST" : "") +
        '. Past radii via <a href="https://agora.ex.nii.ac.jp/digital-typhoon/" target="_blank" rel="noopener">Digital Typhoon</a> (NII); past Dvorak <b>T</b>-numbers are real satellite ADT from <a href="https://tropic.ssec.wisc.edu/real-time/adt/adt.html" target="_blank" rel="noopener">UW-CIMSS</a>' + (cimssNowT(d) != null ? "" : " (unavailable — T shown from wind)") + '. Forecast T is anchored to that and carried by JMA\'s intensity trend; the forecast outer (gale) ring is estimated. Reissued every few hours.</div>';
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
    fetch(DATA_BASE + "seasons/" + season + ".json" + DATA_V)
      .then(function (r) { return r.json(); })
      .catch(function () { return {}; })   // a season may exist only via live NOAA storms
      .then(function (d) { seasonCache[season] = applyLiveToShard(season, fixTaiwanCats(d)); cb(); });
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
    cancelForecastAnim();   // rebuilt/ restarted by loadForecastMode when entering Forecast
    stopForecastRefresh();  // only runs while Forecast mode is active
    if (mode === "predict") { loadForecastMode(); startForecastRefresh(); }
    else if (viewMode === "season") { buildSeasonOverview(); }
    else if (currentStorm) { buildMap(); }
  }

  els.mode.addEventListener("change", function () { setAppMode(els.mode.value); });
  // Coming back to the tab after a while? Pull a fresh forecast right away
  // (no-op unless JMA has actually reissued) instead of waiting for the timer.
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && appMode === "predict") refreshForecast();
    });
  }
  if (els.typhoonSelect) els.typhoonSelect.addEventListener("change", function () {
    var d = jmaCache[els.typhoonSelect.value];
    if (d) renderForecast(d);
  });
  if (els.fcPlay) els.fcPlay.addEventListener("click", toggleForecastPlay);
  if (els.fcReplay) els.fcReplay.addEventListener("click", replayForecastAnim);
  if (els.fcSpeed) els.fcSpeed.addEventListener("click", cycleForecastSpeed);
  if (els.aiBtn) els.aiBtn.addEventListener("click", aiToggle);
  if (els.hindcastBtn) els.hindcastBtn.addEventListener("click", aiHindcastToggle);
  if (els.consensusBtn) els.consensusBtn.addEventListener("click", aiConsensusToggle);

  // Rest the forecast sweep when its map isn't on screen: no point spending
  // frames (and Plotly redraws) animating a map the user has scrolled past.
  // rAF already idles on a hidden tab; this covers scrolled-out-of-view.
  if (window.IntersectionObserver && els.map) {
    new IntersectionObserver(function (entries) {
      var vis = entries[entries.length - 1].isIntersecting;
      if (vis === fcMapVisible) return;
      fcMapVisible = vis;
      if (appMode !== "predict" || !fcState) return;
      if (vis && !fcState.paused && !fcAnim) { fcState.lastTs = null; fcAnim = requestAnimationFrame(fcFrame); }
      else if (!vis) cancelForecastAnim();
    }, { threshold: 0.04 }).observe(els.map);
  }
  if (els.fcSlider) els.fcSlider.addEventListener("input", function () {
    if (!fcState) return;
    fcState.paused = true; fcState.holdUntil = 0; fcState.lastTs = null;
    cancelForecastAnim();
    syncPlayBtn();
    fcState.t = Number(els.fcSlider.value);
    sweepTo(fcState.t, 11, false); // false: don't write back to the slider being dragged
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
    renderScrub();
    hindcastFollowTick();          // estimate follows a manual scrub too (throttled)
    consensusFollowTick();         // actual track walks out to the playhead
  });
  els.slider.addEventListener("change", function () { hindcastFollowTick(true); consensusFollowTick(); });   // settle on release
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
      renderScrub();
      if (currentHour >= totalHours) { hindcastFollowTick(true); consensusFollowTick(); stopPlay(); return; }
      hindcastFollowTick();         // re-forecast from the moving playhead (throttled, in place)
      consensusFollowTick();        // and the real track keeps drawing itself out
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
