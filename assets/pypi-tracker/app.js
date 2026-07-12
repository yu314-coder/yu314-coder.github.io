const form = document.querySelector("#tracker-form");
const statusBox = document.querySelector("#status");
const runButton = document.querySelector("#run");
const fullHistory = document.querySelector("#full-history");
const startDate = document.querySelector("#start-date");
const endDate = document.querySelector("#end-date");
const authorForm = document.querySelector("#author-form");
const authorQuery = document.querySelector("#author-query");
const authorLimit = document.querySelector("#author-limit");

const CLICKHOUSE_URL = "https://sql-clickhouse.clickhouse.com/?user=demo";
const DOWNLOADS_TABLE = "pypi.pypi_downloads_per_day_by_version_by_python_by_country";
// pypistats.org runs ~a week ahead of the ClickHouse public dataset (which lags
// several days), but sends no CORS headers — so reach it through a CORS proxy.
const PYPISTATS_URL = "https://pypistats.org/api/packages/";
const CORS_PROXY = "https://cors.eu.org/";
const formatNumber = new Intl.NumberFormat();

// Fresh per-day totals (with mirrors) from pypistats as [{date, downloads}]
// ascending. Throws on any failure so the caller can fall back to ClickHouse.
async function fetchPypistatsDaily(pkg) {
  const res = await fetch(CORS_PROXY + PYPISTATS_URL + pkg + "/overall");
  if (!res.ok) throw new Error("pypistats proxy HTTP " + res.status);
  const json = await res.json();
  const byDate = new Map();
  for (const row of json.data || []) {
    if (row.category !== "with_mirrors") continue;
    byDate.set(row.date, (byDate.get(row.date) || 0) + Number(row.downloads || 0));
  }
  return Array.from(byDate, ([date, downloads]) => ({ date, downloads }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function setStatus(message, type = "") {
  statusBox.className = `status ${type}`.trim();
  statusBox.textContent = message;
}

function setBusy(isBusy) {
  runButton.disabled = isBusy;
  runButton.textContent = isBusy ? "Analyzing..." : "Analyze";
}

function applyFullHistoryState() {
  const disabled = fullHistory.checked;
  startDate.disabled = disabled;
  endDate.disabled = disabled;
}

function renderBars(targetId, rows) {
  const target = document.querySelector(targetId);
  const visible = rows.slice(0, 12);
  const max = visible.length ? visible[0].downloads : 0;

  if (!visible.length) {
    target.innerHTML = '<div class="empty">No data</div>';
    return;
  }

  // build the markup once and write it in a single DOM mutation
  target.innerHTML = visible.map((row) => {
    const percent = max ? Math.max((row.downloads / max) * 100, 2) : 0;
    return `<div class="bar-row">
      <div class="bar-meta">
        <span title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</span>
        <span>${formatNumber.format(row.downloads)}</span>
      </div>
      <div class="bar"><i style="width:${percent}%"></i></div>
    </div>`;
  }).join("");
}

function renderTable(rows) {
  // up to 1000 rows — one innerHTML write instead of a per-row append to the
  // live table (each of which is a separate DOM mutation the browser tracks)
  document.querySelector("#matrix").innerHTML = rows.map((row) => `<tr>
      <td>${escapeHtml(row.country)}</td>
      <td>${escapeHtml(row.packageVersion)}</td>
      <td>${escapeHtml(row.pythonVersion)}</td>
      <td>${formatNumber.format(row.downloads)}</td>
    </tr>`).join("");
}

function renderAuthors(rows) {
  const target = document.querySelector("#author-list");
  target.innerHTML = "";
  if (!rows.length) {
    target.innerHTML = '<div class="empty">No authors found</div>';
    return;
  }

  // assemble off-DOM in a fragment (keeps per-button listeners), then attach
  // the whole list in one mutation
  const frag = document.createDocumentFragment();
  for (const row of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "author-item";
    button.innerHTML = `
      <strong title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</strong>
      <span>${formatNumber.format(Number(row.projectCount || 0))} projects · ${formatNumber.format(Number(row.downloads || 0))} downloads</span>
      <span>Latest upload ${escapeHtml(row.latestUpload || "Unknown")}</span>
    `;
    button.addEventListener("click", () => loadAuthorDetails(row.name, button));
    frag.appendChild(button);
  }
  target.appendChild(frag);
}

function renderAuthorProjects(author, rows) {
  document.querySelector("#author-title").textContent = `${author} Packages`;
  const target = document.querySelector("#author-projects");
  if (!rows.length) {
    target.innerHTML = '<tr><td colspan="6">No packages found for this author</td></tr>';
    return;
  }

  // up to 1000 rows — single innerHTML write, not a per-row live-table append
  target.innerHTML = rows.map((row) => {
    const packageName = escapeHtml(row.name || "");
    const homePage = row.homePage ? escapeHtml(row.homePage) : "";
    return `<tr>
      <td>${homePage ? `<a href="${homePage}">${packageName}</a>` : packageName}</td>
      <td class="muted-cell">${escapeHtml(row.summary || "")}</td>
      <td>${escapeHtml(row.latestVersion || "")}<br><span class="small">${escapeHtml(row.latestUpload || "")}</span></td>
      <td>${escapeHtml(row.requiresPython || "")}</td>
      <td>${formatNumber.format(Number(row.downloads || 0))}</td>
      <td>${formatNumber.format(Number(row.fileCount || 0))}</td>
    </tr>`;
  }).join("");
}

async function callNative(name, ...args) {
  const fn = window[name];
  if (typeof fn !== "function") return null;
  const raw = await fn(...args);
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function callApi(name, ...args) {
  const native = await callNative(name, ...args);
  if (native) return native;
  if (name === "nativeDefaults") return webDefaults();
  if (name === "nativeAnalyze") return webAnalyze(JSON.parse(args[0]));
  if (name === "nativeSearchAuthors") return webSearchAuthors(args[0], args[1]);
  if (name === "nativeAuthorDetails") return webAuthorDetails(args[0], args[1]);
  throw new Error(`Unknown API call: ${name}`);
}

function webDefaults() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 30);
  return {
    ok: true,
    data: {
      startDate: isoDate(start),
      endDate: isoDate(end),
      source: "ClickPy public ClickHouse",
      runtime: "Web",
    },
  };
}

async function webAnalyze(payload) {
  try {
    const options = parsePackageOptions(payload);
    const where = packageWhere(options);
    const limit = options.limit;
    const totalSql = `
      SELECT sum(d.count) AS downloads
      FROM ${DOWNLOADS_TABLE} AS d
      WHERE ${where}
      FORMAT JSONEachRow
    `;
    const countriesSql = `
      SELECT ifNull(nullIf(c.name, ''), if(d.country_code = '', 'Unknown', d.country_code)) AS name,
             sum(d.count) AS downloads
      FROM ${DOWNLOADS_TABLE} AS d
      LEFT JOIN pypi.countries AS c ON d.country_code = c.code
      WHERE ${where}
      GROUP BY name
      ORDER BY downloads DESC
      LIMIT ${limit}
      FORMAT JSONEachRow
    `;
    const versionsSql = `
      SELECT if(d.version = '', 'Unknown', d.version) AS name, sum(d.count) AS downloads
      FROM ${DOWNLOADS_TABLE} AS d
      WHERE ${where}
      GROUP BY name
      ORDER BY downloads DESC
      LIMIT ${limit}
      FORMAT JSONEachRow
    `;
    const pythonSql = `
      SELECT if(d.python_minor = '', 'Unknown', d.python_minor) AS name, sum(d.count) AS downloads
      FROM ${DOWNLOADS_TABLE} AS d
      WHERE ${where}
      GROUP BY name
      ORDER BY downloads DESC
      LIMIT ${limit}
      FORMAT JSONEachRow
    `;
    const dailySql = `
      SELECT toString(d.date) AS date, sum(d.count) AS downloads
      FROM ${DOWNLOADS_TABLE} AS d
      WHERE ${where}
      GROUP BY d.date
      ORDER BY d.date ASC
      FORMAT JSONEachRow
    `;
    const matrixSql = `
      SELECT ifNull(nullIf(c.name, ''), if(d.country_code = '', 'Unknown', d.country_code)) AS country,
             if(d.version = '', 'Unknown', d.version) AS packageVersion,
             if(d.python_minor = '', 'Unknown', d.python_minor) AS pythonVersion,
             sum(d.count) AS downloads
      FROM ${DOWNLOADS_TABLE} AS d
      LEFT JOIN pypi.countries AS c ON d.country_code = c.code
      WHERE ${where}
      GROUP BY country, packageVersion, pythonVersion
      ORDER BY downloads DESC
      LIMIT ${limit}
      FORMAT JSONEachRow
    `;

    const [totalRows, countries, packageVersions, pythonVersions, dailyDownloads, matrix] =
      await Promise.all([
        queryClickHouse(totalSql),
        queryClickHouse(countriesSql),
        queryClickHouse(versionsSql),
        queryClickHouse(pythonSql),
        queryClickHouse(dailySql),
        queryClickHouse(matrixSql),
      ]);

    const chDaily = normalizeRows(dailyDownloads);
    const breakdownLatest = chDaily.length ? chDaily[chDaily.length - 1].date
      : (options.fullHistory ? "" : options.endDate);
    let daily = chDaily;
    let total = Number(totalRows[0]?.downloads || 0);
    let dailySource = "ClickHouse public dataset";

    // Freshen the chart + its total from pypistats. Only for a bounded recent
    // range pypistats actually covers (it keeps ~180 days) — full history stays on
    // ClickHouse. Any proxy/parse failure silently keeps the ClickHouse data, so a
    // flaky proxy never breaks the query; worst case is the old (lagging) chart.
    if (!options.fullHistory) {
      try {
        const ps = await fetchPypistatsDaily(options.package);
        const inRange = ps.filter((r) => r.date >= options.startDate && r.date <= options.endDate);
        if (inRange.length && ps[0].date <= options.startDate) {
          daily = inRange;
          total = inRange.reduce((sum, r) => sum + r.downloads, 0);
          dailySource = "pypistats.org";
        }
      } catch (_) { /* keep the ClickHouse daily series */ }
    }

    return {
      ok: true,
      data: {
        package: options.package,
        startDate: options.fullHistory ? "" : options.startDate,
        endDate: options.fullHistory ? "" : options.endDate,
        fullHistory: options.fullHistory,
        totalDownloads: total,
        dailySource,
        breakdownLatest,
        countries: normalizeRows(countries),
        packageVersions: normalizeRows(packageVersions),
        pythonVersions: normalizeRows(pythonVersions),
        dailyDownloads: daily,
        matrix: normalizeRows(matrix),
      },
    };
  } catch (error) {
    return errorResult(error);
  }
}

async function webSearchAuthors(query, limitValue) {
  try {
    const needle = String(query || "").trim();
    if (needle.length < 2) throw new Error("Type at least 2 characters to search authors.");
    const limit = clampLimit(limitValue);
    const sql = `
      WITH author_projects AS (
        SELECT author, lower(name) AS project, max(upload_time) AS latestUpload
        FROM pypi.projects
        WHERE author != '' AND positionCaseInsensitive(author, ${sqlString(needle)}) > 0
        GROUP BY author, project
      )
      SELECT author AS name, count() AS projectCount, ifNull(sum(dl.count), 0) AS downloads,
             toString(max(latestUpload)) AS latestUpload
      FROM author_projects
      LEFT JOIN pypi.pypi_downloads AS dl ON author_projects.project = dl.project
      GROUP BY author
      ORDER BY downloads DESC, projectCount DESC
      LIMIT ${limit}
      FORMAT JSONEachRow
    `;
    return { ok: true, data: { authors: normalizeRows(await queryClickHouse(sql)) } };
  } catch (error) {
    return errorResult(error);
  }
}

async function webAuthorDetails(author, limitValue) {
  try {
    const selected = String(author || "").trim();
    if (!selected) throw new Error("Select an author first.");
    const limit = clampLimit(limitValue);
    const sql = `
      WITH latest AS (
        SELECT lower(name) AS projectKey, anyLast(name) AS projectName,
               argMax(summary, upload_time) AS summary,
               argMax(version, upload_time) AS latestVersion,
               argMax(requires_python, upload_time) AS requiresPython,
               argMax(home_page, upload_time) AS homePage,
               argMax(license, upload_time) AS license,
               argMax(author_email, upload_time) AS authorEmail,
               argMax(maintainer, upload_time) AS maintainer,
               max(upload_time) AS latestUpload,
               uniqExact(version) AS versionCount,
               count() AS fileCount,
               sum(size) AS totalFileBytes
        FROM pypi.projects
        WHERE author = ${sqlString(selected)}
        GROUP BY projectKey
      )
      SELECT projectName AS name, summary, latestVersion, requiresPython, homePage, license,
             authorEmail, maintainer, toString(latestUpload) AS latestUpload, versionCount,
             fileCount, totalFileBytes, ifNull(dl.count, 0) AS downloads
      FROM latest
      LEFT JOIN pypi.pypi_downloads AS dl ON latest.projectKey = dl.project
      ORDER BY downloads DESC, latestUpload DESC
      LIMIT ${limit}
      FORMAT JSONEachRow
    `;
    return {
      ok: true,
      data: { author: selected, projects: normalizeRows(await queryClickHouse(sql)) },
    };
  } catch (error) {
    return errorResult(error);
  }
}

async function queryClickHouse(sql) {
  const response = await fetch(CLICKHOUSE_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: sql,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`ClickHouse rejected the query: ${text}`);
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function parsePackageOptions(payload) {
  const packageName = String(payload.package || "").trim().toLowerCase();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(packageName)) {
    throw new Error("Enter a valid PyPI package name.");
  }
  const fullHistory = Boolean(payload.fullHistory);
  const startDate = String(payload.startDate || "").trim();
  const endDate = String(payload.endDate || "").trim();
  if (!fullHistory && (!startDate || !endDate)) {
    throw new Error("Choose a start and end date, or enable full history.");
  }
  return {
    package: packageName,
    startDate,
    endDate,
    fullHistory,
    limit: clampLimit(payload.limit),
  };
}

function packageWhere(options) {
  let where = `d.project = ${sqlString(options.package)}`;
  if (!options.fullHistory) {
    where += ` AND d.date BETWEEN toDate(${sqlString(options.startDate)}) AND toDate(${sqlString(options.endDate)})`;
  }
  return where;
}

function sqlString(value) {
  return `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function clampLimit(value) {
  const limit = Number.parseInt(value || "100", 10);
  if (Number.isNaN(limit)) return 100;
  return Math.max(10, Math.min(limit, 1000));
}

function normalizeRows(rows) {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      ["downloads", "projectCount", "versionCount", "fileCount", "totalFileBytes"].includes(key)
        ? Number(value || 0)
        : value,
    ]),
  ));
}

function errorResult(error) {
  return {
    ok: false,
    error: error.message || String(error),
    hint: "Try a shorter date range if the public demo service is busy.",
  };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function renderDownloadChart(rows, source) {
  const el = document.querySelector("#download-chart");
  const empty = document.querySelector("#chart-empty");
  const range = document.querySelector("#chart-range");

  if (!rows.length || typeof Plotly === "undefined") {
    if (typeof Plotly !== "undefined") Plotly.purge(el);
    el.innerHTML = "";
    empty.style.display = "grid";
    range.textContent = "";
    return;
  }

  empty.style.display = "none";
  range.textContent = `${rows[0].date} to ${rows[rows.length - 1].date}` +
    (source ? ` · ${source}` : "");

  const x = rows.map((row) => row.date);
  const y = rows.map((row) => row.downloads);

  const trace = {
    x,
    y,
    type: "scatter",
    mode: rows.length <= 60 ? "lines+markers" : "lines",
    fill: "tozeroy",
    fillcolor: "rgba(34, 211, 238, 0.14)",
    line: { color: "#22d3ee", width: 2.5, shape: "spline", smoothing: 0.4 },
    marker: { color: "#a855f7", size: 6, line: { color: "#0d1426", width: 1 } },
    hovertemplate: "<b>%{x}</b><br>%{y:,} downloads<extra></extra>",
  };

  const layout = {
    autosize: true,
    margin: { l: 56, r: 18, t: 10, b: 40 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "Inter, system-ui, sans-serif", color: "#98a2bd", size: 12 },
    hoverlabel: {
      bgcolor: "#131a2e",
      bordercolor: "#2a3450",
      font: { color: "#e8ecf6", size: 13 },
    },
    xaxis: {
      gridcolor: "rgba(42, 52, 80, 0.55)",
      zeroline: false,
      linecolor: "#2a3450",
      tickformat: "%b %d",
      nticks: 8,
    },
    yaxis: {
      gridcolor: "rgba(42, 52, 80, 0.55)",
      zeroline: false,
      linecolor: "#2a3450",
      rangemode: "tozero",
      tickformat: "~s",
    },
  };

  const config = {
    responsive: true,
    displayModeBar: false,
    scrollZoom: false,
  };

  Plotly.react(el, [trace], layout, config);
}

function renderResult(data) {
  document.querySelector("#total-downloads").textContent = formatNumber.format(
    data.totalDownloads,
  );
  document.querySelector("#country-count").textContent = formatNumber.format(
    data.countries.length,
  );
  document.querySelector("#version-count").textContent = formatNumber.format(
    data.packageVersions.length,
  );
  document.querySelector("#python-count").textContent = formatNumber.format(
    data.pythonVersions.length,
  );
  renderBars("#countries", data.countries);
  renderBars("#package-versions", data.packageVersions);
  renderBars("#python-versions", data.pythonVersions);
  renderDownloadChart(data.dailyDownloads, data.dailySource);
  renderBreakdownNote(data);
  renderTable(data.matrix);
}

// When the chart & total are freshened from pypistats but the breakdowns still
// come from the (laggier) ClickHouse dataset, say so plainly so the different
// cutoff dates read as honest sourcing rather than a glitch.
function renderBreakdownNote(data) {
  const note = document.querySelector("#breakdown-note");
  if (!note) return;
  const daily = data.dailyDownloads || [];
  const chartLatest = daily.length ? daily[daily.length - 1].date : null;
  if (data.dailySource === "pypistats.org" && data.breakdownLatest && chartLatest &&
      data.breakdownLatest < chartLatest) {
    note.textContent =
      `Chart & total: pypistats.org, through ${chartLatest}. ` +
      `Country / version / Python breakdowns: ClickHouse public dataset, through ${data.breakdownLatest} ` +
      `(it updates a few days behind).`;
    note.hidden = false;
  } else {
    note.textContent = "";
    note.hidden = true;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadDefaults() {
  try {
    const result = await callApi("nativeDefaults");
    if (!result.ok) {
      setStatus(result.error || "Could not load defaults.", "error");
      return;
    }
    startDate.value = result.data.startDate;
    endDate.value = result.data.endDate;
    setStatus(`Ready. Source: ${result.data.source}; runtime: ${result.data.runtime}`);
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
}

fullHistory.addEventListener("change", applyFullHistoryState);

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    package: document.querySelector("#package").value,
    startDate: startDate.value,
    endDate: endDate.value,
    fullHistory: fullHistory.checked,
    limit: document.querySelector("#limit").value,
  };

  setBusy(true);
  setStatus("Querying public ClickPy data. Full-history queries can take a while.");

  try {
    const result = await callApi("nativeAnalyze", JSON.stringify(payload));
    if (!result.ok) {
      const message = [result.error, result.hint].filter(Boolean).join(" ");
      setStatus(message, "error");
      return;
    }
    renderResult(result.data);
    setStatus(`Loaded ${payload.package} download data.`, "ok");
  } catch (error) {
    setStatus(error.message || String(error), "error");
  } finally {
    setBusy(false);
  }
});

authorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(true);
  setStatus("Searching authors.");
  try {
    const result = await callApi("nativeSearchAuthors", authorQuery.value, authorLimit.value);
    if (!result.ok) {
      setStatus([result.error, result.hint].filter(Boolean).join(" "), "error");
      return;
    }
    renderAuthors(result.data.authors);
    setStatus(`Loaded ${result.data.authors.length} author matches.`, "ok");
  } catch (error) {
    setStatus(error.message || String(error), "error");
  } finally {
    setBusy(false);
  }
});

async function loadAuthorDetails(author, selectedButton) {
  for (const item of document.querySelectorAll(".author-item")) {
    item.classList.remove("active");
  }
  selectedButton.classList.add("active");
  setBusy(true);
  setStatus(`Loading packages for ${author}.`);
  try {
    const result = await callApi("nativeAuthorDetails", author, authorLimit.value);
    if (!result.ok) {
      setStatus([result.error, result.hint].filter(Boolean).join(" "), "error");
      return;
    }
    renderAuthorProjects(result.data.author, result.data.projects);
    setStatus(`Loaded ${result.data.projects.length} packages for ${author}.`, "ok");
  } catch (error) {
    setStatus(error.message || String(error), "error");
  } finally {
    setBusy(false);
  }
}

loadDefaults();
