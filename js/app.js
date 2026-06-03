import {
  CONFIG,
  MATURITY_DEFS,
  SPREAD_DEFS,
  dom,
  state,
  loadOverlayDates,
  persistHistoryMaturities,
} from "./core.js";
import { dedupe, fetchText, isoDateToTimestamp, shiftIsoDate } from "./utils.js";
import { buildPcaContext } from "./pca.js";
import {
  addOverlayDate,
  applyPcaModeSelection,
  clearOverlayDates,
  exportCurrentDataset,
  getPresetTargetDate,
  handleUploadedFile,
  initializePcaFitDefaults,
  refreshPcaState,
  removeOverlayDate,
  renderAll,
  renderDifferenceChart,
  renderEmptyDashboard,
  renderHistoricalYieldChart,
  syncHistoryYieldYAxisOverride,
  updateHistoryAxisControls,
  renderMaturityToggles,
  renderPcaControlMessage,
  renderPcaLoadingsChart,
  renderPcaPresetOptions,
  renderPcaPresetSummary,
  renderPcaScoreCharts,
  resolveNearestPriorDate,
  setComparisonDate,
  syncPcaControlsFromState,
  updateDateInputBounds,
  updateMaturityToggleAvailability,
  updatePcaFitBounds,
  updatePcaModeControls,
  updatePcaRangeBounds,
  updatePcaRangeButtons,
  updateStatusCards,
} from "./rendering.js";

// === Application Bootstrap ===
document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheDom();
  if (!window.Plotly) {
    setStatus(
      "Plotly did not load. This version uses the CDN-hosted library, so basic internet access is required for chart rendering.",
      "error",
      { badge: "Chart Library" }
    );
    return;
  }

  hydratePreferences();
  renderPcaPresetOptions();
  renderMaturityToggles();
  bindEvents();
  applyTheme(state.theme);
  updateDifferenceToggleText();
  updateHistoryAxisControls();
  syncPcaControlsFromState();
  updatePcaModeControls();
  renderPcaPresetSummary();

  setStatus("Preparing the dashboard.", "warning", { badge: "Loading" });

  let loaded = false;

  if (location.protocol !== "file:") {
    loaded = await loadBundledSnapshot({ announceSuccess: true });
    if (loaded) {
      void refreshOfficialData({ background: true });
    }
  }

  if (!loaded) {
    loaded = await refreshOfficialData({ background: false, quietFailure: true });
  }

  if (!loaded && location.protocol !== "file:") {
    loaded = await loadBundledSnapshot({ announceSuccess: true });
  }

  if (!loaded) {
    setStatus(
      "Unable to load the official Treasury feed or the local snapshot. Upload a CSV or serve the folder over a lightweight local server.",
      "error",
      { badge: "Needs Data" }
    );
    renderEmptyDashboard();
  }
}

function cacheDom() {
  dom.asOfDate = document.getElementById("asOfDate");
  dom.rowsLoaded = document.getElementById("rowsLoaded");
  dom.activeSource = document.getElementById("activeSource");
  dom.sourceBadge = document.getElementById("sourceBadge");
  dom.statusMessage = document.getElementById("statusMessage");
  dom.sourceNote = document.getElementById("sourceNote");
  dom.refreshOfficialBtn = document.getElementById("refreshOfficialBtn");
  dom.loadSnapshotBtn = document.getElementById("loadSnapshotBtn");
  dom.exportDatasetBtn = document.getElementById("exportDatasetBtn");
  dom.themeToggleBtn = document.getElementById("themeToggleBtn");
  dom.csvFileInput = document.getElementById("csvFileInput");
  dom.dropzone = document.getElementById("dropzone");
  dom.historicalDateInput = document.getElementById("historicalDateInput");
  dom.setComparisonBtn = document.getElementById("setComparisonBtn");
  dom.addOverlayBtn = document.getElementById("addOverlayBtn");
  dom.clearOverlaysBtn = document.getElementById("clearOverlaysBtn");
  dom.toggleDifferenceBtn = document.getElementById("toggleDifferenceBtn");
  dom.comparisonRequestedDate = document.getElementById("comparisonRequestedDate");
  dom.comparisonActualDate = document.getElementById("comparisonActualDate");
  dom.overlayPills = document.getElementById("overlayPills");
  dom.presetButtons = document.getElementById("presetButtons");
  dom.comparisonCurveChart = document.getElementById("comparisonCurveChart");
  dom.differenceChartWrap = document.getElementById("differenceChartWrap");
  dom.differenceChart = document.getElementById("differenceChart");
  dom.historyMaturityToggles = document.getElementById("historyMaturityToggles");
  dom.historyYAxisButtons = document.getElementById("historyYAxisButtons");
  dom.historyResetViewBtn = document.getElementById("historyResetViewBtn");
  dom.historyAxisHint = document.getElementById("historyAxisHint");
  dom.historyAxisWindow = document.getElementById("historyAxisWindow");
  dom.historyYMinSlider = document.getElementById("historyYMinSlider");
  dom.historyYMaxSlider = document.getElementById("historyYMaxSlider");
  dom.historyYMinValue = document.getElementById("historyYMinValue");
  dom.historyYMaxValue = document.getElementById("historyYMaxValue");
  dom.historyAutoYBtn = document.getElementById("historyAutoYBtn");
  dom.historyYieldChart = document.getElementById("historyYieldChart");
  dom.pcaModeSummary = document.getElementById("pcaModeSummary");
  dom.pcaExplanatoryNote = document.getElementById("pcaExplanatoryNote");
  dom.pcaControlMessage = document.getElementById("pcaControlMessage");
  dom.pcaSummaryBasis = document.getElementById("pcaSummaryBasis");
  dom.pcaSummaryFitRange = document.getElementById("pcaSummaryFitRange");
  dom.pcaSummaryRows = document.getElementById("pcaSummaryRows");
  dom.pcaSummaryTransform = document.getElementById("pcaSummaryTransform");
  dom.pcaSummaryVariance = document.getElementById("pcaSummaryVariance");
  dom.pcaValidationList = document.getElementById("pcaValidationList");
  dom.pcaLoadingsChart = document.getElementById("pcaLoadingsChart");
  dom.pcaVarianceChart = document.getElementById("pcaVarianceChart");
  dom.pcaRollingHeatmapWrap = document.getElementById("pcaRollingHeatmapWrap");
  dom.pcaRollingHeatmapChart = document.getElementById("pcaRollingHeatmapChart");
  dom.pcaTransformationSelect = document.getElementById("pcaTransformationSelect");
  dom.pcaModeSelect = document.getElementById("pcaModeSelect");
  dom.pcaRollingControls = document.getElementById("pcaRollingControls");
  dom.pcaRollingYears = document.getElementById("pcaRollingYears");
  dom.pcaRollingBasisDate = document.getElementById("pcaRollingBasisDate");
  dom.pcaCustomControls = document.getElementById("pcaCustomControls");
  dom.pcaFitStartDate = document.getElementById("pcaFitStartDate");
  dom.pcaFitEndDate = document.getElementById("pcaFitEndDate");
  dom.pcaPresetControls = document.getElementById("pcaPresetControls");
  dom.pcaPresetRegime = document.getElementById("pcaPresetRegime");
  dom.pcaApplyModeBtn = document.getElementById("pcaApplyModeBtn");
  dom.pcaPresetSummary = document.getElementById("pcaPresetSummary");
  dom.pcaDebugPanel = document.getElementById("pcaDebugPanel");
  dom.pcaRangeButtons = document.getElementById("pcaRangeButtons");
  dom.pcaStartDate = document.getElementById("pcaStartDate");
  dom.pcaEndDate = document.getElementById("pcaEndDate");
  dom.pcaApplyRangeBtn = document.getElementById("pcaApplyRangeBtn");
  dom.pc1Chart = document.getElementById("pc1Chart");
  dom.pc2Chart = document.getElementById("pc2Chart");
  dom.pc3Chart = document.getElementById("pc3Chart");
}

function bindEvents() {
  dom.refreshOfficialBtn.addEventListener("click", () => {
    void refreshOfficialData({ background: false });
  });

  dom.loadSnapshotBtn.addEventListener("click", () => {
    void loadBundledSnapshot({ announceSuccess: true });
  });

  dom.exportDatasetBtn.addEventListener("click", exportCurrentDataset);
  dom.themeToggleBtn.addEventListener("click", toggleTheme);

  dom.csvFileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    if (file) {
      await handleUploadedFile(file);
      dom.csvFileInput.value = "";
    }
  });

  dom.setComparisonBtn.addEventListener("click", () => {
    setComparisonDate(dom.historicalDateInput.value || state.latestRecord?.date);
  });

  dom.historicalDateInput.addEventListener("change", () => {
    if (dom.historicalDateInput.value) {
      setComparisonDate(dom.historicalDateInput.value);
    }
  });

  dom.addOverlayBtn.addEventListener("click", () => {
    if (state.selectedComparisonDate) {
      addOverlayDate(state.selectedComparisonDate);
    }
  });

  dom.clearOverlaysBtn.addEventListener("click", clearOverlayDates);

  dom.toggleDifferenceBtn.addEventListener("click", () => {
    state.showDifferenceChart = !state.showDifferenceChart;
    renderDifferenceChart();
  });

  dom.presetButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-preset]");
    if (!button || !state.latestRecord) {
      return;
    }

    const targetDate = getPresetTargetDate(button.dataset.preset);
    if (targetDate) {
      setComparisonDate(targetDate);
    }
  });

  dom.overlayPills.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-overlay]");
    if (!removeButton) {
      return;
    }

    removeOverlayDate(removeButton.dataset.removeOverlay);
  });

  dom.historyMaturityToggles.addEventListener("change", (event) => {
    const checkbox = event.target.closest("input[type='checkbox']");
    if (!checkbox) {
      return;
    }

    const key = checkbox.value;
    if (checkbox.checked) {
      state.historyMaturities.add(key);
    } else if (state.historyMaturities.size > 1) {
      state.historyMaturities.delete(key);
    } else {
      checkbox.checked = true;
      return;
    }

    persistHistoryMaturities();
    renderHistoricalYieldChart();
  });

  dom.historyYAxisButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-history-y-axis]");
    if (!button) {
      return;
    }

    state.historyChart.yAxisMode = button.dataset.historyYAxis;
    state.historyChart.yRangeOverride = null;
    updateHistoryAxisControls();
    renderHistoricalYieldChart();
  });

  dom.historyResetViewBtn.addEventListener("click", () => {
    state.historyChart.xRange = null;
    state.historyChart.yRangeOverride = null;
    renderHistoricalYieldChart();
  });

  [dom.historyYMinSlider, dom.historyYMaxSlider].forEach((slider) => {
    slider.addEventListener("input", () => {
      syncHistoryYieldYAxisOverride();
    });
  });

  dom.historyAutoYBtn.addEventListener("click", () => {
    state.historyChart.yRangeOverride = null;
    renderHistoricalYieldChart();
  });

  dom.pcaModeSelect.addEventListener("change", () => {
    updatePcaModeControls(dom.pcaModeSelect.value);
    renderPcaPresetSummary();
    renderPcaControlMessage("Pending PCA settings. Click Apply PCA Mode to recompute the basis.");
  });

  dom.pcaTransformationSelect.addEventListener("change", () => {
    renderPcaControlMessage("Pending PCA settings. Click Apply PCA Mode to recompute the basis.");
  });

  [dom.pcaRollingYears, dom.pcaFitStartDate, dom.pcaFitEndDate, dom.pcaPresetRegime].forEach((control) => {
    control.addEventListener("change", () => {
      renderPcaPresetSummary();
      renderPcaControlMessage("Pending PCA settings. Click Apply PCA Mode to recompute the basis.");
    });
  });

  dom.pcaApplyModeBtn.addEventListener("click", () => {
    applyPcaModeSelection();
  });

  dom.pcaRollingBasisDate.addEventListener("change", () => {
    state.pcaFit.selectedRollingDate = dom.pcaRollingBasisDate.value;
    if (state.pcaFit.mode === "rollingWindow") {
      refreshPcaState();
      renderPcaLoadingsChart();
    }
  });

  dom.pcaRangeButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-range]");
    if (!button) {
      return;
    }

    state.pcaRange = {
      preset: button.dataset.range,
      start: "",
      end: "",
    };
    updatePcaRangeButtons();
    renderPcaScoreCharts();
  });

  dom.pcaApplyRangeBtn.addEventListener("click", () => {
    if (!state.pcaActive) {
      return;
    }

    const start = dom.pcaStartDate.value || state.pcaActive.scoreStartDate;
    const end = dom.pcaEndDate.value || state.pcaActive.scoreEndDate;

    state.pcaRange = {
      preset: "custom",
      start: start <= end ? start : end,
      end: end >= start ? end : start,
    };

    updatePcaRangeButtons();
    renderPcaScoreCharts();
  });

  window.addEventListener("dragover", (event) => {
    event.preventDefault();
    dom.dropzone.classList.add("is-active");
  });

  window.addEventListener("dragleave", (event) => {
    if (!event.relatedTarget) {
      dom.dropzone.classList.remove("is-active");
    }
  });

  window.addEventListener("drop", async (event) => {
    event.preventDefault();
    dom.dropzone.classList.remove("is-active");

    const [file] = Array.from(event.dataTransfer?.files || []);
    if (file) {
      await handleUploadedFile(file);
    }
  });
}

// === Preferences And Data Loading ===
function hydratePreferences() {
  const storedTheme = localStorage.getItem(CONFIG.storageKeys.theme);
  if (storedTheme === "light" || storedTheme === "dark") {
    state.theme = storedTheme;
  }

  const storedMaturities = localStorage.getItem(CONFIG.storageKeys.historyMaturities);
  if (storedMaturities) {
    try {
      const parsed = JSON.parse(storedMaturities);
      const valid = parsed.filter((key) => MATURITY_DEFS.some((def) => def.key === key));
      if (valid.length) {
        state.historyMaturities = new Set(valid);
      }
    } catch (_error) {
      // Ignore malformed local storage and fall back to defaults.
    }
  }
}

async function loadBundledSnapshot({ announceSuccess = false } = {}) {
  if (state.isBusy) {
    return false;
  }

  try {
    setBusy(true);
    setStatus("Loading the bundled snapshot.", "warning", {
      badge: "Snapshot",
    });

    const snapshotCandidates = dedupe([
      CONFIG.bundledSnapshotPath,
      "./data/sample_treasury_yields.csv",
      "/data/sample_treasury_yields.csv",
    ]);

    let text = "";
    let resolvedSnapshotUrl = CONFIG.bundledSnapshotPath;
    let lastSnapshotError = null;

    for (const candidate of snapshotCandidates) {
      try {
        text = await fetchText(candidate);
        resolvedSnapshotUrl = candidate;
        lastSnapshotError = null;
        break;
      } catch (error) {
        lastSnapshotError = error;
      }
    }

    if (!text) {
      throw lastSnapshotError || new Error("Bundled snapshot fetch failed.");
    }

    const records = prepareRecords(parseTreasuryCsv(text));
    applyDataset(records, {
      kind: "snapshot",
      label: "Bundled Snapshot",
      badge: "Snapshot",
      sourceUrl: resolvedSnapshotUrl,
    });

    if (announceSuccess) {
      setStatus(
        `Loaded ${records.length.toLocaleString()} rows from the bundled snapshot.`,
        "info"
      );
    }

    return true;
  } catch (error) {
    setStatus(
      location.protocol === "file:"
        ? "Bundled snapshot fetch failed under file:// access. Use a lightweight local server or upload a CSV directly."
        : `Bundled snapshot unavailable: ${error.message}`,
      "warning",
      { badge: "Snapshot" }
    );
    return false;
  } finally {
    setBusy(false);
  }
}

async function refreshOfficialData({ background = false, quietFailure = false } = {}) {
  if (state.isBusy) {
    return false;
  }

  try {
    setBusy(true);
    setStatus(
      background
        ? "Refreshing the official Treasury XML feed in the background."
        : "Fetching the official Treasury XML history. This can take a few seconds.",
      "warning",
      { badge: "Official Live" }
    );

    const rawRows = await fetchOfficialXmlHistory((pageNumber, rowCount) => {
      setStatus(
        `Fetched Treasury XML page ${pageNumber + 1}; ${rowCount.toLocaleString()} rows accumulated.`,
        "warning",
        { badge: "Official Live" }
      );
    });

    const records = prepareRecords(rawRows);
    applyDataset(records, {
      kind: "official",
      label: "Official Treasury XML",
      badge: "Official Live",
      sourceUrl: CONFIG.officialSourcePage,
    });

    setStatus(
      `Official Treasury history refreshed with ${records.length.toLocaleString()} rows.`,
      "info"
    );

    return true;
  } catch (error) {
    if (!quietFailure || state.records.length === 0) {
      setStatus(
        background && state.records.length
          ? `Background official refresh failed. Keeping the current dataset. ${error.message}`
          : `Official Treasury fetch failed. ${error.message} Upload a CSV or load the bundled snapshot instead.`,
        background && state.records.length ? "warning" : "error",
        { badge: "Official Live" }
      );
    }

    return false;
  } finally {
    setBusy(false);
  }
}

async function fetchOfficialXmlHistory(onProgress) {
  const rows = [];

  for (let page = 0; page < CONFIG.maxOfficialPages; page += 1) {
    const xmlText = await fetchText(`${CONFIG.officialXmlPageBase}${page}`);
    const pageRows = parseOfficialXmlPage(xmlText);

    if (!pageRows.length) {
      break;
    }

    rows.push(...pageRows);
    if (page % 10 === 0) {
      console.log(
        `Page ${page}, total rows: ${rows.length}, latest date on this page:`,
        pageRows.at(-1)?.date
      );
    }
    if (typeof onProgress === "function") {
      onProgress(page, rows.length);
    }
  }

  if (!rows.length) {
    throw new Error("The Treasury XML feed returned no rows.");
  }
  console.log(
    "FINAL FETCHED RAW DATES:",
    rows.slice(-5).map(r => r.date)
  );
  return rows;
}

// === Normalization And Preprocessing ===
function parseOfficialXmlPage(xmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "application/xml");

  if (xml.querySelector("parsererror")) {
    throw new Error("The Treasury XML feed could not be parsed.");
  }

  const entries = Array.from(xml.getElementsByTagName("entry"));
  return entries
    .map((entry) => {
      const propertiesNode =
        entry.querySelector("m\\:properties, properties") ||
        entry.getElementsByTagNameNS(
          "http://schemas.microsoft.com/ado/2007/08/dataservices/metadata",
          "properties"
        )[0];

      if (!propertiesNode) {
        return null;
      }

      const propertyMap = {};

      Array.from(propertiesNode.children).forEach((child) => {
        const fieldName = child.localName || child.nodeName.split(":").pop();
        propertyMap[fieldName] = child.textContent.trim();
      });

      return normalizeRawRecord(propertyMap);
    })
    .filter(Boolean);
}

function parseTreasuryCsv(csvText) {
  const cleanText = csvText.replace(/^\uFEFF/, "").trim();
  if (!cleanText) {
    throw new Error("The CSV file is empty.");
  }

  const lines = cleanText.split(/\r?\n/).filter((line) => line.trim());
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = {};
    normalizedHeaders.forEach((header, index) => {
      row[header] = values[index]?.trim() ?? "";
    });
    return normalizeRawRecord(row);
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function normalizeHeader(header) {
  return header
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\./g, "")
    .replace(/year/g, "yr")
    .replace(/month/g, "mo");
}

function normalizeRawRecord(raw) {
  const record = {
    date: normalizeDateValue(raw.NEW_DATE || raw.new_date || raw.Date || raw.date || raw["new date"]),
  };

  if (!record.date) {
    return null;
  }

  MATURITY_DEFS.forEach((definition) => {
    const candidateKeys = [
      definition.xmlField,
      definition.xmlField.toLowerCase(),
      ...definition.csvAliases,
      ...definition.csvAliases.map((alias) => normalizeHeader(alias)),
    ];

    let rawValue = null;
    for (const key of candidateKeys) {
      if (raw[key] !== undefined) {
        rawValue = raw[key];
        break;
      }

      const normalizedKey = normalizeHeader(key);
      if (raw[normalizedKey] !== undefined) {
        rawValue = raw[normalizedKey];
        break;
      }
    }

    record[definition.key] = parseYieldValue(rawValue);
  });

  return record;
}

function normalizeDateValue(value) {
  if (!value) {
    return null;
  }

  const clean = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
    return clean.slice(0, 10);
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) {
    const [month, day, year] = clean.split("/");
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return null;
}

function parseYieldValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const clean = String(value).trim();
  if (!clean || clean.toUpperCase() === "N/A") {
    return null;
  }

  const parsed = Number.parseFloat(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function prepareRecords(records) {
  const deduped = new Map();

  records.forEach((record) => {
    if (!record?.date) {
      return;
    }

    const hasAnyValue = MATURITY_DEFS.some((definition) => record[definition.key] != null);
    if (!hasAnyValue) {
      return;
    }

    deduped.set(record.date, {
      ...record,
      timestamp: isoDateToTimestamp(record.date),
    });
  });

  const prepared = Array.from(deduped.values()).sort((left, right) => left.timestamp - right.timestamp);

  if (!prepared.length) {
    throw new Error("No usable yield-curve rows were found in the dataset.");
  }
  console.log(
    "PREPARED DATES (TAIL):",
    prepared.slice(-5).map(r => r.date)
  );
  return prepared;
}

function applyDataset(records, sourceMeta) {
  state.records = records;
  console.log(
  "LATEST PROCESSED RECORD:",
  records.at(-1)
);
  state.recordByDate = new Map(records.map((record) => [record.date, record]));
  state.latestRecord = records.at(-1);
  state.source = sourceMeta;
  state.spreadSeries = computeAllSpreadSeries(records);
  state.extremeSpreadDates = computeExtremeSpreadDates(state.spreadSeries["10Y2Y"]);
  try {
    state.pcaContext = buildPcaContext(records);
  } catch (_error) {
    state.pcaContext = null;
  }

  if (!state.hasHydratedOverlayStorage) {
    state.overlayDates = loadOverlayDates();
    state.hasHydratedOverlayStorage = true;
  }

  state.overlayDates = dedupe(
    state.overlayDates
      .map((date) => resolveNearestPriorDate(date)?.date)
      .filter((date) => date && date !== state.latestRecord.date)
  );

  const desiredComparisonDate = shiftIsoDate(state.latestRecord.date, {
    days: -CONFIG.defaultComparisonOffsetDays,
  });

  const resolvedComparison = resolveNearestPriorDate(desiredComparisonDate) || state.latestRecord;
  state.selectedComparisonRequestedDate = desiredComparisonDate;
  state.selectedComparisonDate = resolvedComparison.date;

  try {
    initializePcaFitDefaults();
    refreshPcaState();
    updatePcaFitBounds();
    updatePcaRangeBounds();
  } catch (_error) {
    // Keep the dataset loaded even if advanced PCA state setup fails.
    state.pcaActive = null;
  }

  updateDateInputBounds();
  updateStatusCards();
  updateMaturityToggleAvailability();

  try {
    renderAll();
  } catch (_error) {
    // Do not fail data loading if one rendering path errors.
    setStatus(
      "Dataset loaded, but one visualization failed to render. Try toggling panels or reloading.",
      "warning",
      { badge: state.source?.badge || "Ready" }
    );
  }
}

function computeAllSpreadSeries(records) {
  const series = {};
  SPREAD_DEFS.forEach((spread) => {
    series[spread.id] = records
      .map((record) => {
        if (record[spread.left] == null || record[spread.right] == null) {
          return null;
        }

        return {
          date: record.date,
          value: record[spread.left] - record[spread.right],
        };
      })
      .filter(Boolean);
  });
  return series;
}

function computeExtremeSpreadDates(spreadSeries) {
  if (!spreadSeries?.length) {
    return {
      maxSteepeningDate: null,
      maxInversionDate: null,
    };
  }

  let maxSteepening = spreadSeries[0];
  let maxInversion = spreadSeries[0];

  spreadSeries.forEach((point) => {
    if (point.value > maxSteepening.value) {
      maxSteepening = point;
    }

    if (point.value < maxInversion.value) {
      maxInversion = point;
    }
  });

  return {
    maxSteepeningDate: maxSteepening.date,
    maxInversionDate: maxInversion.date,
  };
}

// === UI State Helpers ===
function setStatus(message, tone = "info", { badge } = {}) {
  dom.statusMessage.textContent = message;
  dom.sourceBadge.textContent = badge || state.source?.badge || "Ready";
  dom.sourceBadge.className = "status-badge";

  if (tone === "warning") {
    dom.sourceBadge.classList.add("is-warning");
  } else if (tone === "error") {
    dom.sourceBadge.classList.add("is-error");
  }
}

function setBusy(isBusy) {
  state.isBusy = isBusy;
  dom.refreshOfficialBtn.disabled = isBusy;
  dom.loadSnapshotBtn.disabled = isBusy;
  dom.exportDatasetBtn.disabled = isBusy || !state.records.length;
}

function updateDifferenceToggleText() {
  dom.toggleDifferenceBtn.textContent = state.showDifferenceChart
    ? "Hide Bps Difference"
    : "Show Bps Difference";
}

function toggleTheme() {
  applyTheme(state.theme === "dark" ? "light" : "dark");
  if (state.records.length) {
    renderAll();
  }
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(CONFIG.storageKeys.theme, theme);
  dom.themeToggleBtn.textContent = theme === "dark" ? "Light Mode" : "Dark Mode";
}

export { applyDataset, parseTreasuryCsv, prepareRecords, setBusy, setStatus };
