# Yu, Yao-Hsing 尤耀星 — Personal Portfolio

Personal portfolio website showcasing apps, libraries, research, and achievements in mathematics, AI, and software development.

**Live site:** [yu314-coder.github.io](https://yu314-coder.github.io/)

---

## Featured Projects

### ManimStudio
GUI application for creating mathematical animations with Manim.
- **Windows** (v1.1.1.0) — bundled with Python 3.12.7 + MiKTeX, no admin rights. [Microsoft Store](https://apps.microsoft.com/detail/9NZFT55DVCBS)
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
│   │   └── style.css              # Custom styles + shared footer
│   ├── js/
│   │   ├── main.js                # Home page scripts (games, admin panel)
│   │   └── script.js              # Shared scripts
│   ├── img/
│   │   ├── badges/                # Official Microsoft / App Store badges
│   │   └── og-image.png           # Social share preview image
│   └── docs/
│       └── yau-science-award-research-paper.pdf
├── index.html                     # Home — hero, highlights, project spotlights
├── about.html                     # About — education, skills, interests, timeline
├── projects.html                  # Projects — tabbed (per flagship + PyPI + others)
├── privacy.html                   # Privacy policies for all published apps
├── sitemap.xml                    # SEO sitemap
├── robots.txt                     # Crawler directives
└── README.md
```

---

## Tech Stack

- **HTML5 / CSS3 / JavaScript**
- **Bootstrap 5.3.3** — responsive layout, pills/tabs, components
- **Google Fonts** — Roboto typeface
- **GitHub Pages** — static hosting

---

## License

This project is open source. Feel free to use it as a starting point for your own portfolio.

---

© 2026 Yu, Yao-Hsing 尤耀星. All rights reserved.
