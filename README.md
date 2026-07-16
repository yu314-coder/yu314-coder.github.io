# Yu, Yao-Hsing 尤耀星 — Personal Portfolio

Personal portfolio website showcasing apps, libraries, research, and achievements in mathematics, AI, and software development.

**Live site:** [yu314-coder.github.io](https://yu314-coder.github.io/)

---

## Interactive Data Pages

### 🌀 Typhoon Tracks — [/typhoon-tracks.html](https://yu314-coder.github.io/typhoon-tracks.html)
A Western Pacific typhoon explorer that runs entirely in the browser on real agency data — nothing simulated.

**Track mode (history, 1985–present)**
- Base archive: **IBTrACS v04r01 (NOAA NCEI)**, pre-sharded per season for instant loads
- **Two-layer live top-up straight from NOAA/JTWC**: active storms come from NCEI's IBTrACS *active-storms* feed (3-hourly), then are extended with the **JTWC working best track** (ATCF b-deck via UCAR/RAL, updated several times a day) so a storm's history runs to the very latest fix — marked `LIVE` in the picker; falls back cleanly to the static archive if a feed is down
- Per-point **wind radii** — Beaufort **force 8 / 10 / 12** (JTWC's 34 / 50 / 64 kt quadrant radii; gale / storm / hurricane-force) — drawn as rings on a zoomable Plotly map
- Intensity color scale from Tropical Depression → **C5 Super Typhoon** (C5 in magenta so the top category reads clearly apart from C4)
- Time scrubber with per-frame interpolation: position, wind, pressure, Dvorak T-number, radii, and the intensity-chart cursor all animate together (in-place Plotly restyles, no per-frame trace churn)
- **Two classification standards**: Saffir–Simpson-style (on 1-minute winds), and Taiwan **CWA** on CWA's official 10-minute thresholds (17.2 / 32.7 / 51.0 m/s) applied to **JMA's real 10-minute wind analysis** per point (IBTrACS `TOKYO_WIND`), interpolated between JMA's 6-hourly records — so storms class the way CWA's own record does (e.g. Doksuri 2023 as mostly 中度), not inflated by a converted 1-minute wind
- Season overview (every track at once, colored by peak intensity), ACE, rapid-intensification detection, ENSO badges (real NOAA CPC ONI), and a 1985-present season climatology chart

**Forecast mode (live JMA)**
- Official **JMA** 5-day forecasts fetched in-browser (CORS-open JSON), reissued every few hours
- Past leg enriched with per-observation wind radii from **Digital Typhoon** (NII) best track
- Real satellite **Dvorak T-numbers from UW-CIMSS ADT** for the past; forecast T anchored to the current real value and carried by JMA's intensity trend
- One-timeline sweep animation: past (real radii) → now → +120 h (forecast radii + probability circles), with play/pause/speed/scrub controls

**Experimental AI overlay — my own track model, running in your browser**
- An optional **"🧪 Overlay Yu's AI model track"** button (live-forecast mode) and **"🧪 Predict from here"** (history mode) run my own **[TrackFormer](https://github.com/yu314-coder/typhoon-predict)** — a 21 M-parameter transformer (bidirectional track-history encoder → temporal context → cross-attention lead-time decoder) that forecasts the **full storm state** at 20 six-hourly lead times: motion, max wind, central pressure, RMW, and the 34/50/64 kt wind radii in four quadrants
- **Track-only, no atmosphere.** It reads 9 six-hourly history fixes (position, wind, pressure, wind radii) and needs **no ERA5, no live field fetch, nothing external** — so nothing off-site can make it fail. On a WP-2020+ held-out test it *matches* an ERA5-conditioned model (720 vs 729 km track error); across experiments the pattern was **data diversity > engineered features > parameters**
- Runs **entirely client-side via [onnxruntime-web](https://onnxruntime.ai/docs/tutorials/web/)** — exported to an **int8 ONNX (~30 MB, lazily loaded only when you ask for a forecast)**, verified ~lossless vs fp32 (track 26 km, vmax 0.3 kt, radii 0.6 km) and validated **bit-for-bit** against the Python feature pipeline on real storm data. **No backend, no server, no cold start**
- Draws the predicted track (dashed emerald with a soft casing so it reads against JMA's violet line) + an **uncertainty cone** built from the model's own per-step spread; hovering any point gives the lead time, predicted position **and predicted intensity**. Clearly flagged **experimental — not an operational forecast**
- In **history mode** you can scrub to any point on a past storm and forecast forward, drawn against the white line of what the storm *actually* did next — a genuine, location-aware hindcast (needs ~2 days of prior track). The overlay stays on screen through the sweep ending, map rebuilds and storm switches, and **re-runs on the latest data** when you switch storms or JMA reissues

### 📦 PyPI Stats — [/pypi-stats.html](https://yu314-coder.github.io/pypi-stats.html)
Live download analytics for any PyPI package (mine pre-listed), by country / package version / Python version.
- Queries the public **ClickPy ClickHouse** dataset directly from the browser — no backend, nothing sent to me
- Downloads-over-time chart, country/version breakdowns, full country×version matrix, and an author explorer
- The ClickHouse dataset runs **several days behind**, so the downloads chart is served from **pypistats.org** instead (fresher by about a week). For my own packages a nightly GitHub Action snapshots it into `assets/pypi-tracker/data/` and the page reads that **same-origin** — no runtime proxy to break. The country / version / Python breakdowns (which pypistats doesn't publish) stay on ClickHouse, and the page states each panel's source and cut-off date
- Guarded by **Byte**, a hand-drawn canvas robot companion who watches your cursor, reacts while you type, and celebrates when the stats land

### Why track-only

I trained two forecasters (both in [typhoon-predict](https://github.com/yu314-coder/typhoon-predict)): **StormFusion-MT v2**, which ingests ERA5 reanalysis patches (26- and 14-channel, five pressure levels, 65×65 grid) plus track history, and **TrackFormer**, which sees only track. On the WP-2020+ held-out test the track-only model **matched or beat** the ERA5 one on every metric. ERA5 is heavy, high-latency (Copernicus CDS, ~5-day lag), and can't be fetched per web-request — and here it buys nothing — so the site runs **TrackFormer** for both live forecasts and past-storm hindcasts, with no atmospheric data and no external dependency at all.

---

## Featured Projects

### ManimStudio
GUI application for creating mathematical animations with Manim.
- **Windows** (v1.1.3.0) — bundled with Python 3.12.7 + MiKTeX, no admin rights. [Microsoft Store](https://apps.microsoft.com/detail/9NZFT55DVCBS)
- **iOS / iPadOS** — fully offline studio with Monaco editor + VideoToolbox H.264 render. [App Store](https://apps.apple.com/app/manimstudio/id6764472686) · [GitHub (ios)](https://github.com/yu314-coder/manim_app/tree/ios)

### CodeBench
A self-contained, fully offline developer / scientific / AI workstation for iPad & Mac — Monaco editor, integrated terminal, Python 3.14, C/C++/Fortran, on-device pdflatex, and local LLMs (llama.cpp + ExecuTorch).
- [GitHub](https://github.com/yu314-coder/CodeBench)

### python-ios-lib
Full Python 3.14 runtime for iOS/iPadOS with 30+ native offline libraries — the **first public native PyTorch build on iOS** (with a Metal GPU bridge for a 2–10× on-device training speedup), HuggingFace transformers, Rust tokenizers, NumPy, SciPy, scikit-learn, manim, PyAV/FFmpeg, Cairo, plus C/C++/Fortran interpreters and a Flask/Dash/Streamlit web stack.
- [GitHub](https://github.com/yu314-coder/python-ios-lib)

### Generalized Covariance Matrix — ESD Analysis Tool
Eigenvalue spectral distribution analysis for generalized covariance matrices (the research tool behind the Yau Award paper).
- [Microsoft Store](https://apps.microsoft.com/detail/9nzj475s7b01)

### EigenDenoise
Native macOS image denoiser using random matrix theory — the macOS counterpart to Generalized Covariance Matrix.
- [Mac App Store](https://apps.apple.com/app/eigendenoise/id6764759636) · [GitHub](https://github.com/yu314-coder/EigenDenoise)

### GPS-location-app
Precision GPS workout tracker for iPhone & Apple Watch — Kalman-filtered location, HealthKit sync, Live Activities, CarPlay, route analytics.
- [App Store](https://apps.apple.com/app/gps-location-app/id6764729098) · [GitHub](https://github.com/yu314-coder/GPS-location-app)

---

## Apps on Stores

| App | Platform | Store |
|-----|----------|-------|
| ManimStudio | Windows 10+ | [Microsoft Store](https://apps.microsoft.com/detail/9NZFT55DVCBS) |
| ManimStudio | iOS / iPadOS | [App Store](https://apps.apple.com/app/manimstudio/id6764472686) |
| Generalized Covariance Matrix | Windows 10+ | [Microsoft Store](https://apps.microsoft.com/detail/9nzj475s7b01) |
| t-SNE Visualization | Windows 10+ | [Microsoft Store](https://apps.microsoft.com/detail/9P969D6N7P6J) |
| EigenDenoise | macOS | [Mac App Store](https://apps.apple.com/app/eigendenoise/id6764759636) |
| GPS-location-app | iOS / watchOS | [App Store](https://apps.apple.com/app/gps-location-app/id6764729098) |

---

## PyPI Packages

| Package | Description | Links |
|---------|-------------|-------|
| ollama-installer | Install Ollama from a Python CLI | [GitHub](https://github.com/yu314-coder/python-ollama) · [PyPI](https://pypi.org/project/ollama-installer/) |
| narrate | Local text-to-speech (Kokoro + Chatterbox) | [GitHub](https://github.com/yu314-coder/narrate) · [PyPI](https://pypi.org/project/narrate/) |
| rmt-denoise | Image denoising via Random Matrix Theory (v2.3.0) | [GitHub](https://github.com/yu314-coder/rmt-denoise) · [PyPI](https://pypi.org/project/rmt-denoise/) |
| cairometal | pycairo-compatible 2D graphics on the Apple GPU via Metal (macOS arm64 wheel) | [GitHub](https://github.com/yu314-coder/cairometal) · [PyPI](https://pypi.org/project/cairometal/) |

---

## Other Open-Source Projects

| Project | Description | Links |
|---------|-------------|-------|
| NeonScribe | Creative writing and text processing tool | [GitHub](https://github.com/yu314-coder/NeonScribe) |
| Sound Transfer | TCP-based audio streaming between devices | [GitHub](https://github.com/yu314-coder/sound_transfer) |
| Google Drive Download | Python tool for downloading from Google Drive | [GitHub](https://github.com/yu314-coder/google_drive_download) |

---

## Awards

- **2025 S. T. Yau High School Science Award — Grand Finals (Bronze Medal)**
  Research on the limiting spectral distributions of products of sample covariance matrices with deterministic sequences.
- **2025 S. T. Yau High School Science Award — Asia Regional (Silver Medal)**

---

## Project Structure

```
yu314-coder.github.io/
├── assets/
│   ├── css/
│   │   └── style.css              # Site styles (design tokens, dark zones)
│   ├── js/
│   │   ├── ui.js                  # Scroll-reveal, counters, hero spiral canvas, live PyPI total
│   │   ├── main.js                # Home page scripts (arcade, admin panel)
│   │   └── script.js              # Shared page scripts
│   ├── typhoon-tracker/           # Typhoon Tracks app (iframe): Plotly geo map,
│   │   │                          #   track/forecast modes, live NOAA/JMA/CIMSS feeds
│   │   ├── index.html · app.js · styles.css
│   │   └── model/                 #   TrackFormer int8 ONNX + meta (in-browser AI overlay)
│   ├── pypi-tracker/              # PyPI stats app (iframe): ClickHouse queries,
│   │   │                          #   Plotly chart, Byte the robot companion
│   │   ├── index.html · app.js · creature.js · styles.css
│   │   └── data/                  #   nightly pypistats snapshots (fresh downloads chart)
│   ├── data/typhoons/             # IBTrACS v04r01 baked data: index.json,
│   │   │                          #   per-season shards, climatology.json (ONI/ACE)
│   ├── img/
│   │   ├── app-icons/             # App icons (WebP + PNG fallback)
│   │   ├── badges/                # Official store badges
│   │   └── og-image.png           # Social share preview image
│   └── docs/
│       └── yau-science-award-research-paper.pdf
├── index.html                     # Home — hero (animated eigenvalue spiral), spotlights
├── about.html                     # About — education, skills, interests, timeline
├── projects.html                  # Projects — tabbed (per flagship + PyPI + others)
├── pypi-stats.html                # PyPI download analytics (live ClickPy data)
├── typhoon-tracks.html            # Typhoon track explorer (live NOAA/JMA data)
├── privacy.html                   # Privacy policies for all published apps
├── scripts/
│   └── refresh_pypistats.py       # Snapshots pypistats → assets/pypi-tracker/data
├── .github/workflows/
│   └── refresh-pypi-stats.yml     # Nightly: run that snapshot, commit if changed
├── 404.html · sitemap.xml · robots.txt
└── README.md
```

---

## Tech Stack

- **HTML5 / CSS3 / JavaScript (ES5-compatible)** — no build step, no framework, no bundler
- **Bootstrap 5.3.3** — responsive layout, pills/tabs, components
- **Plotly.js** (geo + basic bundles, deferred) — typhoon map, intensity charts, download charts
- **onnxruntime-web** — runs my TrackFormer typhoon model (int8 ONNX) *in the browser*, no backend
- **Google Fonts** — Inter, JetBrains Mono, Source Serif 4
- **GitHub Pages** — static hosting; every data feed is fetched **client-side**, no server of my own
- **Cross-platform parity** — identical behaviour on Windows and macOS across Chrome / Edge / Firefox / Safari (ES5 syntax, `-webkit-` + `-moz-` slider styling, motion that renders on every engine)
- **Live data sources** — NOAA NCEI IBTrACS (archive, active-storms feed, and JMA `TOKYO_WIND` 10-min analysis), JTWC ATCF b-deck (via UCAR/RAL), JMA *bosai* forecasts + storm/gale radii, Digital Typhoon (NII) best-track radii, UW-CIMSS ADT Dvorak analyses, NOAA CPC ONI, ClickPy ClickHouse + **pypistats.org** (PyPI downloads)

Every figure on both data pages traces to a named public agency — nothing is invented, simulated, or filled in when a source hasn't published it yet.

---

## License

This project is open source. Feel free to use it as a starting point for your own portfolio.

---

© 2026 Yu, Yao-Hsing 尤耀星. All rights reserved.
