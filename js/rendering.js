import {
  CONFIG,
  MATURITY_DEFS,
  SPREAD_DEFS,
  dom,
  state,
  currentPalette,
  persistHistoryMaturities,
  persistOverlayDates,
  persistSpreadDefinitions,
  formatButterflyLabel,
} from "./core.js?v=spread-controls-20260603-6";
import {
  clampIsoDate,
  clampNumber,
  dateToIso,
  dedupe,
  downloadTextFile,
  findFirstScoredDate,
  findLastScoredDate,
  formatBasisPoints,
  formatHumanDate,
  isoDateToTimestamp,
  maturityMonths,
  paddedRange,
  shiftIsoDate,
  shortPcaLabel,
  transformationLabel,
} from "./utils.js?v=spread-controls-20260603-6";
import {
  buildActivePcaResult,
  getCurrentBaselineModel,
  normalizeDateRange,
  validateComponentInterpretation,
  validateDifferencedIndexAlignment,
  validateExplainedVariance,
} from "./pca.js?v=spread-controls-20260603-6";
import { applyDataset, parseTreasuryCsv, prepareRecords, setBusy, setStatus } from "./app.js?v=spread-controls-20260603-6";
import {
  getRegimeOptionLabel,
  getRegimePresetDefinitions,
  resolveRegimePreset,
} from "./regimes.js?v=spread-controls-20260603-6";

// === Rendering ===
function renderAll() {
  const safeRender = (renderFn) => {
    try {
      renderFn();
    } catch (_error) {
      // Keep rendering other panels even if one fails.
    }
  };

  safeRender(renderComparisonPanel);
  safeRender(renderSpreadControls);
  safeRender(renderSpreadCards);
  safeRender(renderHistoricalYieldChart);
  safeRender(renderPcaLoadingsChart);
  safeRender(renderPcaScoreCharts);
}

function renderEmptyDashboard() {
  const message = "No dataset loaded yet.";
  dom.pcaModeSummary.textContent = "PCA mode details will appear after data loads.";
  renderPcaControlMessage("");
  dom.pcaValidationList.innerHTML = "";
  dom.pcaRollingHeatmapWrap.hidden = true;
  renderPcaSummaryCards(null);
  updateHistoryAxisControls();
  renderEmptyChart(dom.comparisonCurveChart, message);
  renderEmptyChart(dom.differenceChart, message);
  renderEmptyChart(dom.historyYieldChart, message);
  renderEmptyChart(dom.pcaLoadingsChart, message);
  renderEmptyChart(dom.pcaVarianceChart, message);
  renderEmptyChart(dom.pcaRollingHeatmapChart, message);
  renderEmptyChart(dom.pc1Chart, message);
  renderEmptyChart(dom.pc2Chart, message);
  renderEmptyChart(dom.pc3Chart, message);
  renderSpreadControls();
  renderSpreadCards();
}

function renderComparisonPanel() {
  renderOverlayPills();
  renderComparisonCurveChart();
  renderDifferenceChart();
}

function renderComparisonCurveChart() {
  if (!state.latestRecord || !state.selectedComparisonDate) {
    renderEmptyChart(dom.comparisonCurveChart, "Comparison data will appear after a dataset loads.");
    return;
  }

  const palette = currentPalette();
  const latestTrace = buildCurveTrace(state.latestRecord, {
    name: `Latest · ${formatHumanDate(state.latestRecord.date)}`,
    color: palette.latest,
    width: 3.2,
  });

  const comparisonRecord = state.recordByDate.get(state.selectedComparisonDate);
  const comparisonTrace = buildCurveTrace(comparisonRecord, {
    name: `Selected · ${formatHumanDate(state.selectedComparisonDate)}`,
    color: palette.comparison,
    width: 2.6,
    dash: "dot",
  });

  const overlayTraces = state.overlayDates
    .filter((date) => date !== state.selectedComparisonDate && date !== state.latestRecord.date)
    .map((date, index) =>
      buildCurveTrace(state.recordByDate.get(date), {
        name: formatHumanDate(date),
        color: palette.overlays[index % palette.overlays.length],
        width: 1.8,
      })
    );

  const traces = [latestTrace, comparisonTrace, ...overlayTraces];
  const yValues = traces.flatMap((trace) => trace.y);
  const [minYield, maxYield] = paddedRange(yValues, 0.2);

  const requestedLabel =
    state.selectedComparisonRequestedDate &&
    state.selectedComparisonRequestedDate !== state.selectedComparisonDate
      ? `Requested ${state.selectedComparisonRequestedDate}, resolved to ${state.selectedComparisonDate}.`
      : `Selected ${state.selectedComparisonDate}.`;

  dom.comparisonRequestedDate.textContent = requestedLabel;
  dom.comparisonActualDate.textContent = formatHumanDate(state.selectedComparisonDate);

  renderPlot(
    dom.comparisonCurveChart,
    traces,
    buildBaseLayout({
      margin: { t: 26, r: 20, b: 54, l: 64 },
      hovermode: "closest",
      xaxis: { title: { text: "Maturity" }, type: "category" },
      yaxis: {
        title: { text: "Yield (%)" },
        range: [minYield, maxYield],
      },
      legend: {
        orientation: "h",
        x: 0,
        y: 1.14,
      },
    })
  );
}

function renderDifferenceChart() {
  dom.toggleDifferenceBtn.textContent = state.showDifferenceChart
    ? "Hide Bps Difference"
    : "Show Bps Difference";
  dom.differenceChartWrap.hidden = !state.showDifferenceChart;

  if (!state.showDifferenceChart) {
    return;
  }

  const latest = state.latestRecord;
  const comparison = state.recordByDate.get(state.selectedComparisonDate);

  if (!latest || !comparison) {
    renderEmptyChart(dom.differenceChart, "No comparison available.");
    return;
  }

  const palette = currentPalette();
  const maturities = [];
  const differences = [];
  const colors = [];

  MATURITY_DEFS.forEach((definition) => {
    if (latest[definition.key] == null || comparison[definition.key] == null) {
      return;
    }

    const difference = (latest[definition.key] - comparison[definition.key]) * 100;
    maturities.push(definition.label);
    differences.push(difference);
    colors.push(difference >= 0 ? palette.positive : palette.negative);
  });

  renderPlot(
    dom.differenceChart,
    [
      {
        type: "bar",
        x: maturities,
        y: differences,
        marker: { color: colors },
        hovertemplate:
          "Maturity %{x}<br>Latest - Selected: %{y:.1f} bp<extra></extra>",
      },
    ],
    buildBaseLayout({
      margin: { t: 20, r: 20, b: 44, l: 64 },
      showlegend: false,
      xaxis: { title: { text: "Maturity" }, type: "category" },
      yaxis: {
        title: { text: "Difference (bp)" },
        zeroline: true,
        zerolinecolor: palette.grid,
      },
    })
  );
}

function renderSpreadCards() {
  if (!dom.spreadGrid) {
    return;
  }

  const palette = currentPalette();
  const spreads = Array.isArray(state.spreadDefs) ? state.spreadDefs : [];
  dom.spreadGrid.innerHTML = "";

  if (!spreads.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "panel__hint spread-grid__empty";
    emptyState.textContent = "No spread cards selected.";
    dom.spreadGrid.append(emptyState);
    return;
  }

  spreads.forEach((spread) => {
    const series = computeSpreadSeries(spread);
    const card = document.createElement("article");
    card.className = "spread-card";

    const header = document.createElement("div");
    header.className = "spread-card__header";

    const labelNode = document.createElement("p");
    labelNode.className = "spread-card__label";
    labelNode.textContent = spread.label;

    const removeButton = document.createElement("button");
    removeButton.className = "spread-card__remove";
    removeButton.type = "button";
    removeButton.dataset.removeSpread = spread.id;
    removeButton.setAttribute("aria-label", `Remove ${spread.label}`);
    removeButton.textContent = "Remove";

    header.append(labelNode, removeButton);

    const valueNode = document.createElement("strong");
    valueNode.className = "spread-card__value";

    const noteNode = document.createElement("p");
    noteNode.className = "spread-card__subvalue";

    const changeNode = document.createElement("p");
    changeNode.className = "spread-card__change";

    const sparkNode = document.createElement("div");
    sparkNode.className = "chart chart--spark";

    card.append(header, valueNode, noteNode, changeNode, sparkNode);
    dom.spreadGrid.append(card);

    if (!series.length) {
      card.classList.remove("is-positive", "is-negative");
      valueNode.textContent = "--";
      noteNode.textContent = "Insufficient data";
      changeNode.textContent = "1D CHG --";
      renderSparklineFallback(sparkNode, "No data");
      return;
    }

    const latestPoint = series.at(-1);
    const previousPoint = series.at(-2);
    const oneDayChange = previousPoint ? (latestPoint.value - previousPoint.value) * 100 : null;
    card.classList.toggle("is-positive", latestPoint.value >= 0);
    card.classList.toggle("is-negative", latestPoint.value < 0);

    valueNode.textContent = formatBasisPoints(latestPoint.value * 100);
    noteNode.textContent = `As of ${formatHumanDate(latestPoint.date)}`;
    changeNode.classList.toggle("is-positive", oneDayChange != null && oneDayChange > 0);
    changeNode.classList.toggle("is-negative", oneDayChange != null && oneDayChange < 0);
    changeNode.textContent =
      oneDayChange == null ? "1D CHG --" : `1D CHG ${formatBasisPoints(oneDayChange)}`;

    const sparklineSeries = series.slice(-CONFIG.sparklineLookback);
    if (!window.Plotly) {
      renderSparklineFallback(sparkNode, "Sparkline unavailable");
      return;
    }

    renderPlot(
      sparkNode,
      [
        {
          type: "scatter",
          mode: "lines",
          x: sparklineSeries.map((point) => point.date),
          y: sparklineSeries.map((point) => point.value * 100),
          line: {
            color: latestPoint.value >= 0 ? palette.positive : palette.negative,
            width: 2,
          },
          hovertemplate: "%{x}<br>%{y:.1f} bp<extra></extra>",
        },
      ],
      buildBaseLayout({
        margin: { t: 4, r: 2, b: 10, l: 2 },
        xaxis: { visible: false },
        yaxis: { visible: false },
        showlegend: false,
      }),
      { displayModeBar: false }
    );
  });
}

function renderSparklineFallback(container, message) {
  if (window.Plotly) {
    renderEmptyChart(container, message);
    return;
  }

  container.textContent = message;
}

function renderSpreadControls(message = "") {
  if (!dom.spreadLeftSelect || !dom.spreadRightSelect || !dom.spreadFlyBackSelect) {
    return;
  }

  const previousLeft = dom.spreadLeftSelect.value || "10Y";
  const previousRight = dom.spreadRightSelect.value || "2Y";
  const previousBack = dom.spreadFlyBackSelect.value || "10Y";

  renderMaturitySelectOptions(dom.spreadLeftSelect, previousLeft);
  renderMaturitySelectOptions(dom.spreadRightSelect, previousRight);
  renderMaturitySelectOptions(dom.spreadFlyBackSelect, previousBack);

  if (dom.spreadLeftSelect.value === dom.spreadRightSelect.value) {
    dom.addSpreadBtn.disabled = true;
  } else {
    dom.addSpreadBtn.disabled = false;
  }

  const flyLegs = [
    dom.spreadLeftSelect.value,
    dom.spreadRightSelect.value,
    dom.spreadFlyBackSelect.value,
  ];
  dom.addButterflyBtn.disabled = new Set(flyLegs).size !== 3;

  const count = Array.isArray(state.spreadDefs) ? state.spreadDefs.length : 0;
  const formulaNote = "Butterfly = 2 x second leg - first leg - third leg.";
  dom.spreadControlHint.textContent =
    message ? `${message} ${formulaNote}` : `Showing ${count} ${count === 1 ? "spread" : "spreads"}. ${formulaNote}`;
}

function renderMaturitySelectOptions(selectNode, selectedKey) {
  selectNode.innerHTML = "";

  const availableKeys = new Set(
    MATURITY_DEFS.filter(
      (definition) =>
        !state.records.length ||
        state.records.some((record) => Number.isFinite(record[definition.key]))
    ).map((definition) => definition.key)
  );
  const shouldLimitToAvailableKeys = Boolean(state.records.length && availableKeys.size);

  MATURITY_DEFS.forEach((definition) => {
    const option = document.createElement("option");
    option.value = definition.key;
    option.textContent = definition.label;
    option.disabled = shouldLimitToAvailableKeys && !availableKeys.has(definition.key);
    selectNode.append(option);
  });

  if (!shouldLimitToAvailableKeys || availableKeys.has(selectedKey)) {
    selectNode.value = selectedKey;
    return;
  }

  selectNode.value = availableKeys.values().next().value || MATURITY_DEFS[0].key;
}

function addSpreadDefinition(left, right) {
  if (left === right) {
    renderSpreadControls("Spread requires two different maturities.");
    return;
  }

  const validMaturities = new Set(MATURITY_DEFS.map((definition) => definition.key));
  if (!validMaturities.has(left) || !validMaturities.has(right)) {
    renderSpreadControls("Selected maturity is unavailable.");
    return;
  }

  if (state.spreadDefs.some((spread) => spread.left === left && spread.right === right)) {
    renderSpreadControls(`${left}-${right} is already shown.`);
    return;
  }

  state.spreadDefs.push({
    id: `${left}_${right}`,
    label: `${left}-${right}`,
    left,
    right,
  });
  persistSpreadDefinitions();
  renderSpreadControls(`${left}-${right} added.`);
  renderSpreadCards();
}

function addButterflyDefinition(front, belly, back) {
  if (new Set([front, belly, back]).size !== 3) {
    renderSpreadControls("Butterfly requires three different maturities.");
    return;
  }

  const validMaturities = new Set(MATURITY_DEFS.map((definition) => definition.key));
  if (!validMaturities.has(front) || !validMaturities.has(belly) || !validMaturities.has(back)) {
    renderSpreadControls("Selected maturity is unavailable.");
    return;
  }

  if (
    state.spreadDefs.some(
      (spread) =>
        spread.type === "butterfly" &&
        spread.front === front &&
        spread.belly === belly &&
        spread.back === back
    )
  ) {
    renderSpreadControls(`${formatButterflyLabel(front, belly, back)} is already shown.`);
    return;
  }

  const label = formatButterflyLabel(front, belly, back);
  state.spreadDefs.push({
    id: `fly_${front}_${belly}_${back}`,
    type: "butterfly",
    label,
    front,
    belly,
    back,
  });
  persistSpreadDefinitions();
  renderSpreadControls(`${label} added.`);
  renderSpreadCards();
}

function removeSpreadDefinition(spreadId) {
  state.spreadDefs = state.spreadDefs.filter((spread) => spread.id !== spreadId);
  persistSpreadDefinitions();
  renderSpreadControls();
  renderSpreadCards();
}

function resetSpreadDefinitions() {
  state.spreadDefs = SPREAD_DEFS.map((spread) => ({ ...spread }));
  persistSpreadDefinitions();
  renderSpreadControls("Default spreads restored.");
  renderSpreadCards();
}

function computeSpreadSeries(spread) {
  return state.records
    .map((record) => {
      if (spread.type === "butterfly") {
        if (
          record[spread.front] == null ||
          record[spread.belly] == null ||
          record[spread.back] == null
        ) {
          return null;
        }

        return {
          date: record.date,
          value: 2 * record[spread.belly] - record[spread.front] - record[spread.back],
        };
      }

      if (record[spread.left] == null || record[spread.right] == null) {
        return null;
      }

      return {
        date: record.date,
        value: record[spread.left] - record[spread.right],
      };
    })
    .filter(Boolean);
}

function renderHistoricalYieldChart() {
  if (!state.records.length) {
    renderEmptyChart(dom.historyYieldChart, "Historical yield series will appear after data loads.");
    updateHistoryAxisControls();
    return;
  }

  const palette = currentPalette();
  const selectedKeys = resolveHistoryChartKeys();

  const traces = selectedKeys
    .map((key) => {
      const points = state.records
        .map((record) => ({
          x: record.date,
          y: record[key] == null ? null : Number(record[key]),
        }))
        .filter((point) => point.x && Number.isFinite(point.y));

      if (!points.length) {
        return null;
      }

      return {
        type: "scatter",
        mode: "lines",
        name: key,
        x: points.map((point) => point.x),
        y: points.map((point) => point.y),
        connectgaps: false,
        line: {
          color: palette.history[key] || palette.latest,
          width: key === "10Y" ? 1.4 : 0.8,
        },
        hovertemplate: `${key}<br>%{x}<br>%{y:.2f}%<extra></extra>`,
      };
    })
    .filter(Boolean);

  if (!traces.length) {
    renderEmptyChart(dom.historyYieldChart, "Selected maturities have no coverage in the current dataset.");
    updateHistoryAxisControls();
    return;
  }

  const xRange = normalizeHistoryChartXRange();
  const { appliedRange } = resolveHistoryYieldAxisState(selectedKeys, { xRange });

  renderPlot(
    dom.historyYieldChart,
    traces,
    buildBaseLayout({
      margin: { t: 26, r: 20, b: 62, l: 64 },
      hovermode: "x unified",
      xaxis: {
        title: { text: "Date" },
        type: "date",
        rangeslider: { visible: true, thickness: 0.08 },
        ...(xRange ? { range: [xRange.start, xRange.end] } : { autorange: true }),
      },
      yaxis: {
        title: { text: "Yield (%)" },
        range: appliedRange,
      },
      legend: {
        orientation: "h",
        x: 0,
        y: 1.12,
      },
    })
  );
  attachHistoryYieldChartRelayoutHandler();
  updateHistoryAxisControls();
}

function resolveHistoryChartKeys() {
  const coverage = computeCoverageMap();
  let selectedKeys = Array.from(state.historyMaturities)
    .filter((key) => (coverage[key] || 0) > 0)
    .sort((left, right) => maturityMonths(left) - maturityMonths(right));

  if (!selectedKeys.length) {
    selectedKeys = MATURITY_DEFS.filter((definition) => (coverage[definition.key] || 0) > 0)
      .sort((left, right) => right.months - left.months)
      .slice(0, 3)
      .map((definition) => definition.key)
      .sort((left, right) => maturityMonths(left) - maturityMonths(right));

    state.historyMaturities = new Set(selectedKeys);
    persistHistoryMaturities();
  }

  return selectedKeys;
}

function computeHistoryYieldYAxisRange(selectedKeys, { xRange = null } = {}) {
  const rangeRecords = xRange
    ? state.records.filter((record) => record.date >= xRange.start && record.date <= xRange.end)
    : state.records;
  const yValues = selectedKeys.flatMap((key) =>
    rangeRecords
      .map((record) => record[key])
      .filter((value) => Number.isFinite(value))
  );

  if (!yValues.length && xRange) {
    return computeHistoryYieldYAxisRange(selectedKeys, { xRange: null });
  }

  return yValues.length ? paddedRange(yValues, 0.18) : [0, 1];
}

function resolveHistoryYieldAxisState(selectedKeys, { xRange = null } = {}) {
  const autoRange = computeHistoryYieldYAxisRange(
    selectedKeys,
    { xRange: state.historyChart.yAxisMode === "visible" ? xRange : null }
  );
  const sliderBounds = computeHistoryYieldYAxisControlBounds(autoRange);

  if (state.historyChart.yAxisMode !== "visible") {
    state.historyChart.yRangeOverride = null;
    return {
      appliedRange: computeHistoryYieldYAxisRange(selectedKeys, { xRange: null }),
      autoRange,
      sliderBounds,
    };
  }

  state.historyChart.yRangeOverride = normalizeHistoryYieldRangeOverride(
    state.historyChart.yRangeOverride,
    sliderBounds
  );

  return {
    appliedRange: state.historyChart.yRangeOverride || autoRange,
    autoRange,
    sliderBounds,
  };
}

function computeHistoryYieldYAxisControlBounds(autoRange) {
  const [autoMin, autoMax] = autoRange;
  const span = Math.max(autoMax - autoMin, 0.25);
  const padding = Math.max(span * 0.75, 0.25);

  return {
    min: autoMin - padding,
    max: autoMax + padding,
    step: 0.01,
  };
}

function normalizeHistoryYieldRangeOverride(rangeOverride, sliderBounds) {
  if (!rangeOverride) {
    return null;
  }

  const minimumGap = sliderBounds.step;
  let min = clampNumber(rangeOverride[0], sliderBounds.min, sliderBounds.max);
  let max = clampNumber(rangeOverride[1], sliderBounds.min, sliderBounds.max);

  if (min > max) {
    [min, max] = [max, min];
  }

  if (max - min < minimumGap) {
    max = Math.min(sliderBounds.max, min + minimumGap);
  }

  return [min, max];
}

function normalizeHistoryChartXRange() {
  if (!state.records.length || !state.historyChart.xRange) {
    return null;
  }

  const firstDate = state.records[0].date;
  const lastDate = state.latestRecord.date;
  const start = clampIsoDate(state.historyChart.xRange.start, firstDate, lastDate);
  const end = clampIsoDate(state.historyChart.xRange.end, firstDate, lastDate);

  if (start > end) {
    state.historyChart.xRange = {
      start: end,
      end: start,
    };
    return state.historyChart.xRange;
  }

  state.historyChart.xRange = { start, end };
  if (start === firstDate && end === lastDate) {
    state.historyChart.xRange = null;
    return null;
  }

  return state.historyChart.xRange;
}

function attachHistoryYieldChartRelayoutHandler() {
  if (dom.historyYieldChart.__historyRelayoutAttached) {
    return;
  }

  dom.historyYieldChart.on("plotly_relayout", (event) => {
    if (dom.historyYieldChart.__historyAxisSyncing) {
      return;
    }

    if (event["xaxis.autorange"]) {
      state.historyChart.xRange = null;
    } else if (event["xaxis.range[0]"] && event["xaxis.range[1]"]) {
      state.historyChart.xRange = {
        start: normalizePlotlyDate(event["xaxis.range[0]"]),
        end: normalizePlotlyDate(event["xaxis.range[1]"]),
      };
    } else {
      return;
    }

    state.historyChart.yRangeOverride = null;
    updateHistoryAxisControls();
    if (state.historyChart.yAxisMode === "visible") {
      renderHistoricalYieldChart();
    }
  });

  dom.historyYieldChart.__historyRelayoutAttached = true;
}

function syncHistoryYieldYAxisToViewport() {
  if (!state.records.length) {
    return;
  }

  const selectedKeys = resolveHistoryChartKeys();
  const xRange = normalizeHistoryChartXRange();
  const { appliedRange } = resolveHistoryYieldAxisState(selectedKeys, { xRange });

  dom.historyYieldChart.__historyAxisSyncing = true;
  Plotly.relayout(dom.historyYieldChart, {
    "yaxis.autorange": false,
    "yaxis.range": appliedRange,
  }).finally(() => {
    dom.historyYieldChart.__historyAxisSyncing = false;
  });
}

function syncHistoryYieldYAxisOverride() {
  if (!state.records.length || state.historyChart.yAxisMode !== "visible") {
    return;
  }

  const selectedKeys = resolveHistoryChartKeys();
  const xRange = normalizeHistoryChartXRange();
  const { autoRange, sliderBounds } = resolveHistoryYieldAxisState(selectedKeys, { xRange });
  const minimumGap = sliderBounds.step;
  let min = Number.parseFloat(dom.historyYMinSlider.value);
  let max = Number.parseFloat(dom.historyYMaxSlider.value);

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    state.historyChart.yRangeOverride = null;
    renderHistoricalYieldChart();
    return;
  }

  min = clampNumber(min, sliderBounds.min, sliderBounds.max);
  max = clampNumber(max, sliderBounds.min, sliderBounds.max);

  if (min >= max) {
    if (document.activeElement === dom.historyYMinSlider) {
      min = Math.min(min, max - minimumGap);
      dom.historyYMinSlider.value = String(min);
    } else {
      max = Math.max(max, min + minimumGap);
      dom.historyYMaxSlider.value = String(max);
    }
  }

  state.historyChart.yRangeOverride =
    Math.abs(min - autoRange[0]) < 1e-9 && Math.abs(max - autoRange[1]) < 1e-9
      ? null
      : [min, max];

  updateHistoryAxisControls();

  dom.historyYieldChart.__historyAxisSyncing = true;
  Plotly.relayout(dom.historyYieldChart, {
    "yaxis.autorange": false,
    "yaxis.range": state.historyChart.yRangeOverride || autoRange,
  }).finally(() => {
    dom.historyYieldChart.__historyAxisSyncing = false;
  });
}

function normalizePlotlyDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? state.latestRecord?.date || "" : dateToIso(parsed);
}

function updateHistoryAxisControls() {
  if (
    !dom.historyYAxisButtons ||
    !dom.historyAxisHint ||
    !dom.historyResetViewBtn ||
    !dom.historyAxisWindow ||
    !dom.historyYMinSlider ||
    !dom.historyYMaxSlider ||
    !dom.historyYMinValue ||
    !dom.historyYMaxValue ||
    !dom.historyAutoYBtn
  ) {
    return;
  }

  dom.historyYAxisButtons
    .querySelectorAll("[data-history-y-axis]")
    .forEach((button) => {
      button.classList.toggle("is-active", button.dataset.historyYAxis === state.historyChart.yAxisMode);
    });

  const xRange = normalizeHistoryChartXRange();
  dom.historyResetViewBtn.disabled = !xRange;

  if (state.historyChart.yAxisMode === "visible") {
    const selectedKeys = state.records.length ? resolveHistoryChartKeys() : [];
    const { autoRange, sliderBounds, appliedRange } = selectedKeys.length
      ? resolveHistoryYieldAxisState(selectedKeys, { xRange })
      : {
          autoRange: [0, 1],
          sliderBounds: { min: 0, max: 1, step: 0.01 },
          appliedRange: [0, 1],
        };

    dom.historyAxisWindow.hidden = false;
    dom.historyAutoYBtn.disabled = !state.records.length;
    dom.historyYMinSlider.min = sliderBounds.min.toFixed(2);
    dom.historyYMinSlider.max = sliderBounds.max.toFixed(2);
    dom.historyYMinSlider.step = sliderBounds.step.toFixed(2);
    dom.historyYMinSlider.value = appliedRange[0].toFixed(2);
    dom.historyYMaxSlider.min = sliderBounds.min.toFixed(2);
    dom.historyYMaxSlider.max = sliderBounds.max.toFixed(2);
    dom.historyYMaxSlider.step = sliderBounds.step.toFixed(2);
    dom.historyYMaxSlider.value = appliedRange[1].toFixed(2);
    dom.historyYMinValue.textContent = `${appliedRange[0].toFixed(2)}%`;
    dom.historyYMaxValue.textContent = `${appliedRange[1].toFixed(2)}%`;

    dom.historyAxisHint.textContent = xRange
      ? `Visible-Window Y is active for ${formatHumanDate(xRange.start)} to ${formatHumanDate(xRange.end)}. Use the sliders to refine the y-axis range or click Auto Fit Visible Y.`
      : "Visible-Window Y is active. Zoom or drag the range slider to set the visible period, then use the y-axis sliders to refine the scale.";
    return;
  }

  dom.historyAxisWindow.hidden = true;
  dom.historyAxisHint.textContent = xRange
    ? `Y-axis uses the full selected history while the visible date window is ${formatHumanDate(xRange.start)} to ${formatHumanDate(xRange.end)}.`
    : "Y-axis uses the full selected history. Switch to Visible-Window Y after zooming the date range to rescale the plot.";
}

function renderPcaLoadingsChart() {
  const active = state.pcaActive;
  const baseline = getCurrentBaselineModel();

  if (!active?.model || active.model.eigenPairs.length < 3 || !baseline) {
    dom.pcaModeSummary.textContent = active?.summary || "PCA mode details will appear after data loads.";
    renderPcaPresetSummary();
    renderPcaSummaryCards(active || null);
    renderPcaValidationList(active?.validations || []);
    renderEmptyChart(dom.pcaLoadingsChart, "PCA unavailable for the current dataset.");
    renderEmptyChart(dom.pcaVarianceChart, "PCA unavailable for the current dataset.");
    dom.pcaRollingHeatmapWrap.hidden = true;
    return;
  }

  const palette = currentPalette();
  const labels = active.model.keys;
  dom.pcaExplanatoryNote.textContent =
    active.model.transformation === "differences"
      ? "Levels PCA captures long-run curve structure. Daily-differences PCA isolates day-to-day co-movement and can make slope and curvature clearer during strong hiking or easing cycles."
      : "Full-sample PCA gives a stable long-run basis. Rolling and regime PCA show how the factor structure shifts across monetary regimes and highlight non-stationarity.";
  dom.pcaModeSummary.textContent = [active.summary, active.mode === "presetRegimes" ? active.description : ""]
    .filter(Boolean)
    .join(" ");
  renderPcaPresetSummary();
  renderPcaSummaryCards(active);
  const validationChecks = [...(active.validations || [])];
  if (active.model.transformation === "differences") {
    validationChecks.push(validateDifferencedIndexAlignment(active.scoreSeries));
  }
  if (active.label !== "Full Sample") {
    const activeVarianceCheck = validateExplainedVariance(active.model);
    const activeInterpretationCheck = validateComponentInterpretation(active.model);
    validationChecks.push({
      label: `${active.label} variance shares`,
      passed: activeVarianceCheck.passed,
      detail: activeVarianceCheck.detail,
    });
    validationChecks.push({
      label: `${active.label} interpretation`,
      passed: activeInterpretationCheck.passed,
      detail: activeInterpretationCheck.detail,
    });
  }
  renderPcaValidationList(validationChecks);

  const traces = [];
  if (active.compareToBaseline) {
    baseline.eigenPairs.forEach((pair, index) => {
      traces.push({
        type: "scatter",
        mode: "lines+markers",
        name: `Baseline PC${index + 1}`,
        x: baseline.keys,
        y: pair.vector,
        opacity: 0.52,
        line: { width: 1.6, color: palette.pca[index], dash: "dot" },
        marker: { size: 5, color: palette.pca[index], symbol: "circle-open" },
        hovertemplate: `Baseline · ${transformationLabel(baseline.transformation)}<br>PC${index + 1}<br>%{x}: %{y:.3f}<br>Variance ${(baseline.explainedVariance[index] * 100).toFixed(1)}%<extra></extra>`,
      });
    });
  }

  active.model.eigenPairs.forEach((pair, index) => {
    traces.push({
      type: "scatter",
      mode: "lines+markers",
      name: `${active.shortLabel || shortPcaLabel(active.label)} PC${index + 1}`,
      x: labels,
      y: pair.vector,
      line: { width: 2.6, color: palette.pca[index] },
      marker: { size: 7, color: palette.pca[index] },
      hovertemplate: `${active.label} · ${transformationLabel(active.model.transformation)}<br>PC${index + 1}<br>%{x}: %{y:.3f}<br>Variance ${(active.model.explainedVariance[index] * 100).toFixed(1)}%<extra></extra>`,
    });
  });

  renderPlot(
    dom.pcaLoadingsChart,
    traces,
    buildBaseLayout({
      margin: { t: 46, r: 156, b: 48, l: 64 },
      title: {
        text: buildPcaLoadingsTitle(active),
        font: { size: 16 },
      },
      xaxis: { title: { text: "Maturity" }, type: "category" },
      yaxis: { title: { text: "Loading" }, zeroline: true },
      legend: {
        orientation: "v",
        x: 1.02,
        y: 1,
        xanchor: "left",
        yanchor: "top",
        bgcolor: "rgba(0,0,0,0)",
        tracegroupgap: 4,
      },
    })
  );

  renderPcaVarianceChart(active, baseline);
  renderRollingHeatmapChart(active);
}

function renderPcaScoreCharts() {
  if (!state.pcaActive?.model || state.pcaActive.model.eigenPairs.length < 3) {
    renderEmptyChart(dom.pc1Chart, "PCA unavailable.");
    renderEmptyChart(dom.pc2Chart, "PCA unavailable.");
    renderEmptyChart(dom.pc3Chart, "PCA unavailable.");
    return;
  }

  [dom.pc1Chart, dom.pc2Chart, dom.pc3Chart].forEach((chartNode, index) => {
    renderSinglePcaScoreChart(chartNode, index);
    attachPcaClickHandler(chartNode);
  });
}

function renderSinglePcaScoreChart(container, componentIndex) {
  const palette = currentPalette();
  const filteredScores = filterPcaScores();
  if (!filteredScores.length) {
    renderEmptyChart(container, "No scores available for the selected range.");
    return;
  }
  const values = filteredScores.map((row) => row.values[componentIndex]);

  renderPlot(
    container,
    [
      {
        type: "scatter",
        mode: "lines",
        name: `PC${componentIndex + 1}`,
        x: filteredScores.map((row) => row.date),
        y: values,
        customdata: filteredScores.map((row) => row.date),
        connectgaps: false,
        line: {
          color: palette.pca[componentIndex],
          width: 2.2,
        },
        hovertemplate: `${state.pcaActive.model.transformation === "differences" ? "Daily Change" : "Level"} PC${componentIndex + 1}<br>%{x}<br>${state.pcaActive.model.scoreLabel} %{y:.3f}<extra></extra>`,
      },
    ],
    buildBaseLayout({
      margin: { t: 24, r: 20, b: 44, l: 64 },
      showlegend: false,
      hovermode: "closest",
      title: {
        text:
          state.pcaActive.mode === "presetRegimes"
            ? `PC${componentIndex + 1} ${state.pcaActive.model.transformation === "differences" ? "Daily Change" : "Score"} Series · ${state.pcaActive.label}<br><sup>Included windows: ${state.pcaActive.fitWindowsLabel}</sup>`
            : `PC${componentIndex + 1} ${state.pcaActive.model.transformation === "differences" ? "Daily Change" : "Score"} Series`,
        font: { size: 15 },
      },
      xaxis: { title: { text: componentIndex === 2 ? "Date" : "" } },
      yaxis: {
        title: { text: `PC${componentIndex + 1}` },
        zeroline: true,
      },
    })
  );
}

function attachPcaClickHandler(container) {
  if (container.__pcaHandlerAttached) {
    return;
  }

  container.on("plotly_click", (event) => {
    const selectedDate = event?.points?.[0]?.customdata;
    if (selectedDate) {
      setComparisonDate(selectedDate);
      if (state.pcaFit.mode === "rollingWindow") {
        state.pcaFit.selectedRollingDate = selectedDate;
        dom.pcaRollingBasisDate.value = selectedDate;
        refreshPcaState();
        renderPcaLoadingsChart();
      }
    }
  });

  container.__pcaHandlerAttached = true;
}

function filterPcaScores() {
  if (!state.pcaActive) {
    return [];
  }

  const { startDate, endDate } = resolvePcaRangeBounds();
  return state.pcaActive.scoreSeries.filter((row) => row.date >= startDate && row.date <= endDate);
}

function resolvePcaRangeBounds() {
  const latestDate = state.pcaActive?.scoreEndDate || state.latestRecord?.date;
  const earliestDate = state.pcaActive?.scoreStartDate || state.records[0]?.date;

  if (!latestDate || !earliestDate) {
    return {
      startDate: "",
      endDate: "",
    };
  }

  if (state.pcaRange.preset === "custom") {
    return {
      startDate: state.pcaRange.start || earliestDate,
      endDate: state.pcaRange.end || latestDate,
    };
  }

  if (state.pcaRange.preset === "5y") {
    return {
      startDate: shiftIsoDate(latestDate, { years: -5 }),
      endDate: latestDate,
    };
  }

  if (state.pcaRange.preset === "1y") {
    return {
      startDate: shiftIsoDate(latestDate, { years: -1 }),
      endDate: latestDate,
    };
  }

  if (state.pcaRange.preset === "3m") {
    return {
      startDate: shiftIsoDate(latestDate, { months: -3 }),
      endDate: latestDate,
    };
  }

  return {
    startDate: earliestDate,
    endDate: latestDate,
  };
}

function renderPcaVarianceChart(active, baseline) {
  const palette = currentPalette();
  const x = ["PC1", "PC2", "PC3"];
  const traces = [];

  if (active.compareToBaseline) {
    traces.push({
      type: "bar",
      name: "Baseline",
      x,
      y: baseline.explainedVariance.map((value) => value * 100),
      marker: { color: palette.overlays[2] },
      opacity: 0.55,
      hovertemplate: `Baseline · ${transformationLabel(baseline.transformation)}<br>%{x}<br>%{y:.1f}%<extra></extra>`,
    });
  }

  traces.push({
    type: "bar",
    name: active.shortLabel || shortPcaLabel(active.label),
    x,
    y: active.model.explainedVariance.map((value) => value * 100),
    marker: { color: palette.latest },
    hovertemplate: `${active.label} · ${transformationLabel(active.model.transformation)}<br>%{x}<br>%{y:.1f}%<extra></extra>`,
  });

  renderPlot(
    dom.pcaVarianceChart,
    traces,
    buildBaseLayout({
      margin: { t: 28, r: 32, b: 44, l: 64 },
      barmode: active.compareToBaseline ? "group" : "relative",
      title: {
        text:
          active.mode === "presetRegimes"
            ? `Explained Variance · ${transformationLabel(active.model.transformation)}<br><sup>Top-three variance shares for ${active.label}; windows: ${active.fitWindowsLabel}.</sup>`
            : `Explained Variance · ${transformationLabel(active.model.transformation)}<br><sup>Top-three variance shares for the displayed PCA basis.</sup>`,
        font: { size: 15 },
      },
      xaxis: { title: { text: "Component" }, type: "category" },
      yaxis: { title: { text: "Explained Variance (%)" } },
      legend: {
        orientation: "h",
        x: 0,
        y: 1.12,
      },
    })
  );
}

function renderRollingHeatmapChart(active) {
  const isRolling = active.mode === "rollingWindow" && active.rollingHeatmap?.dates?.length;
  dom.pcaRollingHeatmapWrap.hidden = !isRolling;

  if (!isRolling) {
    return;
  }

  const palette = currentPalette();
  const heatmapData = active.rollingHeatmap;
  const traces = heatmapData.components.map((componentMatrix, index) => ({
    type: "heatmap",
    x: heatmapData.dates,
    y: heatmapData.keys,
    z: componentMatrix,
    zmid: 0,
    colorscale: [
      [0, palette.negative],
      [0.5, palette.paper === "rgba(0,0,0,0)" ? "#f8fafc" : "#f8fafc"],
      [1, palette.positive],
    ],
    colorbar: index === 2 ? { title: "Loading" } : undefined,
    xaxis: index === 0 ? "x" : `x${index + 1}`,
    yaxis: index === 0 ? "y" : `y${index + 1}`,
    hovertemplate: `PC${index + 1}<br>%{x}<br>%{y}: %{z:.3f}<extra></extra>`,
    showscale: index === 2,
  }));

  renderPlot(
    dom.pcaRollingHeatmapChart,
    traces,
    buildBaseLayout({
      margin: { t: 28, r: 40, b: 48, l: 76 },
      grid: {
        rows: 3,
        columns: 1,
        pattern: "independent",
      },
      xaxis: { title: { text: "" } },
      xaxis2: { title: { text: "" } },
      xaxis3: { title: { text: "Date" } },
      yaxis: { title: { text: "PC1" }, automargin: true },
      yaxis2: { title: { text: "PC2" }, automargin: true },
      yaxis3: { title: { text: "PC3" }, automargin: true },
      showlegend: false,
    })
  );
}

function renderPcaValidationList(checks) {
  dom.pcaValidationList.innerHTML = "";
  checks.forEach((check) => {
    const item = document.createElement("li");
    item.innerHTML = `<strong>${check.label}:</strong> ${check.passed ? "pass" : "review"} · ${check.detail}`;
    dom.pcaValidationList.append(item);
  });
}

function renderPcaSummaryCards(active) {
  if (!active) {
    dom.pcaSummaryBasis.textContent = "--";
    dom.pcaSummaryFitRange.textContent = "--";
    dom.pcaSummaryRows.textContent = "--";
    dom.pcaSummaryTransform.textContent = "--";
    dom.pcaSummaryVariance.textContent = "--";
    return;
  }

  dom.pcaSummaryBasis.textContent = active.subtitle ? `${active.label} · ${active.subtitle}` : active.label;
  dom.pcaSummaryFitRange.textContent = active.fitWindowsLabel || "--";
  dom.pcaSummaryRows.textContent = active.model ? active.model.rowsUsed.toLocaleString() : "--";
  dom.pcaSummaryTransform.textContent = active.model
    ? transformationLabel(active.model.transformation)
    : transformationLabel(state.pcaFit.transformation);
  dom.pcaSummaryVariance.textContent = active.model
    ? active.model.explainedVariance.map((value, index) => `PC${index + 1} ${(value * 100).toFixed(1)}%`).join(" · ")
    : "--";
}

function renderPcaPresetOptions() {
  dom.pcaPresetRegime.innerHTML = "";
  getRegimePresetDefinitions().forEach((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = getRegimeOptionLabel(preset);
    dom.pcaPresetRegime.append(option);
  });
}

function renderPcaPresetSummary() {
  const mode = dom.pcaModeSelect?.value || state.pcaFit.mode;
  if (mode !== "presetRegimes" || !state.records.length) {
    dom.pcaPresetSummary.hidden = true;
    dom.pcaPresetSummary.textContent = "";
    return;
  }

  const preset = resolveRegimePreset(dom.pcaPresetRegime.value || state.pcaFit.presetRegime, {
    firstDate: state.records[0].date,
    lastDate: state.latestRecord.date,
  });
  const lines = [getRegimeOptionLabel(preset)];
  if (preset.description) {
    lines.push(preset.description);
  }
  lines.push(preset.helperText);
  dom.pcaPresetSummary.textContent = lines.join(" · ");
  dom.pcaPresetSummary.hidden = false;
}

function buildPcaLoadingsTitle(active) {
  const subtitleBits = [`${transformationLabel(active.model.transformation)} basis`];
  if (active.fitWindowsLabel) {
    subtitleBits.push(`Included windows: ${active.fitWindowsLabel}`);
  }
  if (active.compareToBaseline) {
    subtitleBits.push("Dashed traces are the long-run baseline");
  }

  return active.compareToBaseline
    ? `Loadings Comparison: Full Sample vs ${active.label}<br><sup>${subtitleBits.join(" · ")}</sup>`
    : `Loadings: ${active.label}<br><sup>${subtitleBits.join(" · ")}</sup>`;
}

function renderMaturityToggles() {
  dom.historyMaturityToggles.innerHTML = "";
  MATURITY_DEFS.forEach((definition) => {
    const label = document.createElement("label");
    label.className = "toggle-chip";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = definition.key;
    input.checked = state.historyMaturities.has(definition.key);
    input.dataset.maturityToggle = definition.key;

    const text = document.createElement("span");
    text.textContent = definition.label;

    label.append(input, text);
    dom.historyMaturityToggles.append(label);
  });
}

function updateMaturityToggleAvailability() {
  const coverage = computeCoverageMap();
  const availableKeys = MATURITY_DEFS.filter((definition) => (coverage[definition.key] || 0) > 0).map(
    (definition) => definition.key
  );

  state.historyMaturities = new Set(
    Array.from(state.historyMaturities).filter((key) => availableKeys.includes(key))
  );

  if (!state.historyMaturities.size && availableKeys.length) {
    state.historyMaturities.add(availableKeys[0]);
    persistHistoryMaturities();
  }

  dom.historyMaturityToggles
    .querySelectorAll("input[type='checkbox']")
    .forEach((checkbox) => {
      const available = (coverage[checkbox.value] || 0) > 0;
      checkbox.disabled = !available;
      checkbox.checked = available && state.historyMaturities.has(checkbox.value);
    });
}

function computeCoverageMap() {
  const coverage = {};
  MATURITY_DEFS.forEach((definition) => {
    coverage[definition.key] = state.records.reduce(
      (count, record) => count + (record[definition.key] != null ? 1 : 0),
      0
    );
  });
  return coverage;
}

function setComparisonDate(requestedDate) {
  if (!state.records.length) {
    return;
  }

  const resolved = resolveNearestPriorDate(requestedDate);
  if (!resolved) {
    return;
  }

  state.selectedComparisonRequestedDate = requestedDate;
  state.selectedComparisonDate = resolved.date;
  dom.historicalDateInput.value = requestedDate;
  renderComparisonPanel();
}

function addOverlayDate(date) {
  if (!date || date === state.latestRecord?.date) {
    return;
  }

  state.overlayDates = dedupe([...state.overlayDates, date]).sort();
  persistOverlayDates();
  renderComparisonPanel();
}

function removeOverlayDate(date) {
  state.overlayDates = state.overlayDates.filter((item) => item !== date);
  persistOverlayDates();
  renderComparisonPanel();
}

function clearOverlayDates() {
  state.overlayDates = [];
  persistOverlayDates();
  renderComparisonPanel();
}

function renderOverlayPills() {
  dom.overlayPills.innerHTML = "";

  if (!state.overlayDates.length) {
    const placeholder = document.createElement("span");
    placeholder.className = "panel__hint";
    placeholder.textContent = "No saved overlays yet.";
    dom.overlayPills.append(placeholder);
    return;
  }

  state.overlayDates.forEach((date) => {
    const pill = document.createElement("span");
    pill.className = "overlay-pill";
    pill.innerHTML = `<span>${formatHumanDate(date)}</span><button type="button" data-remove-overlay="${date}" aria-label="Remove ${date}">×</button>`;
    dom.overlayPills.append(pill);
  });
}

function updateStatusCards() {
  dom.asOfDate.textContent = state.latestRecord ? formatHumanDate(state.latestRecord.date) : "--";
  dom.rowsLoaded.textContent = state.records.length
    ? state.records.length.toLocaleString()
    : "--";
  dom.activeSource.textContent = state.source?.label || "Waiting";
}

function updateDateInputBounds() {
  if (!state.records.length) {
    return;
  }

  const firstDate = state.records[0].date;
  const lastDate = state.latestRecord.date;

  dom.historicalDateInput.min = firstDate;
  dom.historicalDateInput.max = lastDate;
  dom.historicalDateInput.value = state.selectedComparisonRequestedDate || state.selectedComparisonDate;
}

function initializePcaFitDefaults() {
  if (!state.records.length) {
    return;
  }

  const firstDate = state.records[0].date;
  const lastDate = state.latestRecord.date;

  if (!state.pcaFit.customStart) {
    state.pcaFit.customStart = clampIsoDate(
      shiftIsoDate(lastDate, { years: -CONFIG.pcaDefaultRollingYears }),
      firstDate,
      lastDate
    );
  }

  if (!state.pcaFit.customEnd) {
    state.pcaFit.customEnd = lastDate;
  }

  state.pcaFit.customStart = clampIsoDate(state.pcaFit.customStart, firstDate, lastDate);
  state.pcaFit.customEnd = clampIsoDate(state.pcaFit.customEnd, firstDate, lastDate);
  state.pcaFit.selectedRollingDate = clampIsoDate(
    state.pcaFit.selectedRollingDate || lastDate,
    firstDate,
    lastDate
  );
  normalizePcaFitState();

  syncPcaControlsFromState();
  updatePcaModeControls();
}

function normalizePcaFitState() {
  if (!state.records.length) {
    return { message: "" };
  }

  const firstDate = state.records[0].date;
  const lastDate = state.latestRecord.date;
  const messages = [];

  state.pcaFit.customStart = clampIsoDate(state.pcaFit.customStart || firstDate, firstDate, lastDate);
  state.pcaFit.customEnd = clampIsoDate(state.pcaFit.customEnd || lastDate, firstDate, lastDate);
  if (state.pcaFit.customStart > state.pcaFit.customEnd) {
    const normalized = normalizeDateRange(state.pcaFit.customStart, state.pcaFit.customEnd);
    state.pcaFit.customStart = normalized.startDate;
    state.pcaFit.customEnd = normalized.endDate;
    messages.push("Fit dates were reordered to keep the start date before the end date.");
  }

  state.pcaFit.selectedRollingDate = clampIsoDate(
    state.pcaFit.selectedRollingDate || lastDate,
    firstDate,
    lastDate
  );
  state.pcaFit.rollingYears = clampNumber(
    Number.parseInt(state.pcaFit.rollingYears, 10) || CONFIG.pcaDefaultRollingYears,
    1,
    20
  );

  syncPcaControlsFromState();
  return {
    message: messages.join(" "),
  };
}

function renderPcaControlMessage(message) {
  state.pcaUiMessage = message || "";
  dom.pcaControlMessage.textContent = state.pcaUiMessage;
  dom.pcaControlMessage.hidden = !state.pcaUiMessage;
}

function syncPcaControlsFromState() {
  dom.pcaModeSelect.value = state.pcaFit.mode;
  dom.pcaTransformationSelect.value = state.pcaFit.transformation;
  dom.pcaRollingYears.value = String(state.pcaFit.rollingYears);
  dom.pcaRollingBasisDate.value = state.pcaFit.selectedRollingDate;
  dom.pcaFitStartDate.value = state.pcaFit.customStart;
  dom.pcaFitEndDate.value = state.pcaFit.customEnd;
  dom.pcaPresetRegime.value = state.pcaFit.presetRegime;
  renderPcaPresetSummary();
}

function updatePcaModeControls(mode = dom.pcaModeSelect?.value || state.pcaFit.mode) {
  dom.pcaRollingControls.hidden = mode !== "rollingWindow";
  dom.pcaCustomControls.hidden = mode !== "customRange";
  dom.pcaPresetControls.hidden = mode !== "presetRegimes";
  dom.pcaRollingYears.disabled = mode !== "rollingWindow";
  dom.pcaRollingBasisDate.disabled = mode !== "rollingWindow";
  dom.pcaFitStartDate.disabled = mode !== "customRange";
  dom.pcaFitEndDate.disabled = mode !== "customRange";
  dom.pcaPresetRegime.disabled = mode !== "presetRegimes";
  renderPcaPresetSummary();
}

function applyPcaModeSelection() {
  state.pcaFit.mode = dom.pcaModeSelect.value;
  state.pcaFit.transformation = dom.pcaTransformationSelect.value;
  state.pcaFit.rollingYears = clampNumber(
    Number.parseInt(dom.pcaRollingYears.value, 10) || CONFIG.pcaDefaultRollingYears,
    1,
    20
  );
  state.pcaFit.selectedRollingDate = dom.pcaRollingBasisDate.value || state.latestRecord?.date || "";
  state.pcaFit.customStart = dom.pcaFitStartDate.value || state.records[0]?.date || "";
  state.pcaFit.customEnd = dom.pcaFitEndDate.value || state.latestRecord?.date || "";
  state.pcaFit.presetRegime = dom.pcaPresetRegime.value || "allHistory";

  initializePcaFitDefaults();
  const validation = normalizePcaFitState();
  refreshPcaState(validation.message);
  updatePcaRangeBounds();
  renderPcaLoadingsChart();
  renderPcaScoreCharts();
}

function refreshPcaState(validationMessage = "") {
  state.pcaActive = buildActivePcaResult();
  renderPcaControlMessage([validationMessage, state.pcaActive?.uiMessage].filter(Boolean).join(" "));

  if (state.pcaActive?.mode === "rollingWindow") {
    dom.pcaRollingBasisDate.value = state.pcaFit.selectedRollingDate;
    const validEntries = state.pcaActive.rollingEntries.filter((entry) => entry.model);
    if (validEntries.length) {
      dom.pcaRollingBasisDate.min = validEntries[0].date;
      dom.pcaRollingBasisDate.max = validEntries.at(-1).date;
    }
  } else if (state.records.length) {
    dom.pcaRollingBasisDate.min = state.records[0].date;
    dom.pcaRollingBasisDate.max = state.latestRecord.date;
  }

  updatePcaRangeBounds();
}

function updatePcaFitBounds() {
  if (!state.records.length) {
    return;
  }

  const firstDate = state.records[0].date;
  const lastDate = state.latestRecord.date;

  [dom.pcaFitStartDate, dom.pcaFitEndDate, dom.pcaRollingBasisDate].forEach((input) => {
    input.min = firstDate;
    input.max = lastDate;
  });
}

function updatePcaRangeBounds() {
  if (!state.pcaActive) {
    return;
  }

  const scoreStart = state.pcaActive.scoreStartDate;
  const scoreEnd = state.pcaActive.scoreEndDate;

  dom.pcaStartDate.min = scoreStart;
  dom.pcaStartDate.max = scoreEnd;
  dom.pcaEndDate.min = scoreStart;
  dom.pcaEndDate.max = scoreEnd;

  if (!state.pcaRange.start || state.pcaRange.start < scoreStart || state.pcaRange.start > scoreEnd) {
    state.pcaRange.start = "";
  }

  if (!state.pcaRange.end || state.pcaRange.end < scoreStart || state.pcaRange.end > scoreEnd) {
    state.pcaRange.end = "";
  }

  dom.pcaStartDate.value = state.pcaRange.start;
  dom.pcaEndDate.value = state.pcaRange.end;
  updatePcaRangeButtons();
}

function updatePcaRangeButtons() {
  dom.pcaRangeButtons.querySelectorAll("[data-range]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.range === state.pcaRange.preset);
  });
}

async function handleUploadedFile(file) {
  try {
    setBusy(true);
    setStatus(`Loading ${file.name}.`, "warning", { badge: "Upload" });

    const text = await file.text();
    const records = prepareRecords(parseTreasuryCsv(text));
    applyDataset(records, {
      kind: "upload",
      label: `Uploaded CSV · ${file.name}`,
      badge: "Upload",
      sourceUrl: null,
    });

    setStatus(
      `Loaded ${records.length.toLocaleString()} rows from ${file.name}.`,
      "info",
      { badge: "Upload" }
    );
  } catch (error) {
    setStatus(`Could not parse ${file.name}: ${error.message}`, "error", {
      badge: "Upload",
    });
  } finally {
    setBusy(false);
  }
}

function exportCurrentDataset() {
  if (!state.records.length) {
    setStatus("No dataset is loaded yet, so there is nothing to export.", "warning");
    return;
  }

  const header = ["Date", ...MATURITY_DEFS.map((definition) => definition.key)];
  const rows = state.records.map((record) =>
    [
      record.date,
      ...MATURITY_DEFS.map((definition) =>
        record[definition.key] == null ? "" : record[definition.key].toFixed(2)
      ),
    ].join(",")
  );

  downloadTextFile(
    `treasury_yield_curve_snapshot_${state.latestRecord.date}.csv`,
    [header.join(","), ...rows].join("\n")
  );
  setStatus(
    "Downloaded a normalized CSV snapshot of the currently loaded dataset.",
    "info"
  );
}

function getPresetTargetDate(preset) {
  const latestDate = state.latestRecord?.date;
  if (!latestDate) {
    return null;
  }

  if (preset === "latest") {
    return latestDate;
  }

  if (preset === "1d") {
    return shiftIsoDate(latestDate, { days: -1 });
  }

  if (preset === "1w") {
    return shiftIsoDate(latestDate, { days: -7 });
  }

  if (preset === "1m") {
    return shiftIsoDate(latestDate, { months: -1 });
  }

  if (preset === "3m") {
    return shiftIsoDate(latestDate, { months: -3 });
  }

  if (preset === "1y") {
    return shiftIsoDate(latestDate, { years: -1 });
  }

  if (preset === "maxSteepening") {
    return state.extremeSpreadDates.maxSteepeningDate || latestDate;
  }

  if (preset === "maxInversion") {
    return state.extremeSpreadDates.maxInversionDate || latestDate;
  }

  return latestDate;
}

function resolveNearestPriorDate(date) {
  if (!date || !state.records.length) {
    return null;
  }

  const targetTimestamp = isoDateToTimestamp(date);
  let low = 0;
  let high = state.records.length - 1;
  let answer = null;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = state.records[mid];

    if (candidate.timestamp <= targetTimestamp) {
      answer = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return answer || state.records[0];
}

function resolveNearestPriorPcaEntry(entries, date) {
  if (!date || !entries.length) {
    return null;
  }

  const targetTimestamp = isoDateToTimestamp(date);
  let low = 0;
  let high = entries.length - 1;
  let answer = null;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = entries[mid];

    if (isoDateToTimestamp(candidate.date) <= targetTimestamp) {
      answer = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return answer || entries[0];
}

function buildCurveTrace(record, { name, color, width, dash = "solid" }) {
  const points = MATURITY_DEFS.filter((definition) => record?.[definition.key] != null);

  return {
    type: "scatter",
    mode: "lines+markers",
    name,
    x: points.map((definition) => definition.label),
    y: points.map((definition) => record[definition.key]),
    marker: {
      color,
      size: 7,
      line: { color, width: 1 },
    },
    line: {
      color,
      width,
      dash,
    },
    hovertemplate: "%{x}<br>%{y:.2f}%<extra>%{fullData.name}</extra>",
  };
}

function renderPlot(container, data, layout, config = {}) {
  Plotly.react(
    container,
    data,
    layout,
    {
      displaylogo: false,
      responsive: true,
      modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
      ...config,
    }
  );
}

function renderEmptyChart(container, message) {
  renderPlot(
    container,
    [],
    buildBaseLayout({
      margin: { t: 10, r: 10, b: 10, l: 10 },
      xaxis: { visible: false },
      yaxis: { visible: false },
      annotations: [
        {
          x: 0.5,
          y: 0.5,
          xref: "paper",
          yref: "paper",
          text: message,
          showarrow: false,
          font: {
            color: currentPalette().axis,
            size: 14,
          },
        },
      ],
      showlegend: false,
    }),
    { displayModeBar: false }
  );
}

function buildBaseLayout(overrides = {}) {
  const palette = currentPalette();
  const {
    xaxis = {},
    yaxis = {},
    legend = {},
    hoverlabel = {},
    margin = {},
    ...rest
  } = overrides;
  const mergedXaxis = {
    gridcolor: palette.grid,
    linecolor: palette.grid,
    tickfont: { color: palette.axis },
    zerolinecolor: palette.grid,
    title: {
      font: { color: palette.axis },
      ...(xaxis.title || {}),
    },
    ...xaxis,
  };
  const mergedYaxis = {
    gridcolor: palette.grid,
    linecolor: palette.grid,
    tickfont: { color: palette.axis },
    zerolinecolor: palette.grid,
    title: {
      font: { color: palette.axis },
      ...(yaxis.title || {}),
    },
    ...yaxis,
  };

  return {
    paper_bgcolor: palette.paper,
    plot_bgcolor: palette.plot,
    font: {
      family: '"IBM Plex Sans", sans-serif',
      color: palette.text,
      size: 13,
    },
    margin: { t: 20, r: 18, b: 40, l: 54, ...margin },
    hoverlabel: {
      bgcolor: palette.text,
      bordercolor: palette.text,
      font: {
        color: palette.paper === "rgba(0,0,0,0)" ? "#ffffff" : palette.paper,
      },
      ...hoverlabel,
    },
    xaxis: mergedXaxis,
    yaxis: mergedYaxis,
    legend,
    ...rest,
  };
}

export {
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
  renderMaturityToggles,
  renderPcaControlMessage,
  renderPcaLoadingsChart,
  renderPcaPresetOptions,
  renderPcaPresetSummary,
  renderPcaScoreCharts,
  resolveNearestPriorDate,
  setComparisonDate,
  syncHistoryYieldYAxisOverride,
  syncPcaControlsFromState,
  updateHistoryAxisControls,
  updateDateInputBounds,
  updateMaturityToggleAvailability,
  updatePcaFitBounds,
  updatePcaModeControls,
  updatePcaRangeBounds,
  updatePcaRangeButtons,
  updateStatusCards,
  addButterflyDefinition,
  addSpreadDefinition,
  removeSpreadDefinition,
  resetSpreadDefinitions,
  renderSpreadControls,
};
