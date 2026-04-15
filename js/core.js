// === Configuration ===
const CONFIG = {
  officialXmlPageBase:
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=all&page=",
  officialSourcePage:
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve",
  bundledSnapshotPath: new URL("../data/sample_treasury_yields.csv", import.meta.url).href,
  maxOfficialPages: 200,
  pcaCoverageThreshold: 0.8,
  pcaComponentCount: 3,
  pcaDefaultRollingYears: 5,
  pcaRollingMinRows: 60,
  sparklineLookback: 260,
  defaultHistoryMaturities: ["2Y", "10Y", "30Y"],
  defaultComparisonOffsetDays: 1,
  storageKeys: {
    overlays: "yield-curve-dashboard.overlay-dates",
    historyMaturities: "yield-curve-dashboard.history-maturities",
    theme: "yield-curve-dashboard.theme",
  },
};

const MATURITY_DEFS = [
  { key: "1M", label: "1M", months: 1, xmlField: "BC_1MONTH", csvAliases: ["1 Mo", "1M", "BC_1MONTH"] },
  { key: "3M", label: "3M", months: 3, xmlField: "BC_3MONTH", csvAliases: ["3 Mo", "3M", "BC_3MONTH"] },
  { key: "6M", label: "6M", months: 6, xmlField: "BC_6MONTH", csvAliases: ["6 Mo", "6M", "BC_6MONTH"] },
  { key: "1Y", label: "1Y", months: 12, xmlField: "BC_1YEAR", csvAliases: ["1 Yr", "1Y", "BC_1YEAR"] },
  { key: "2Y", label: "2Y", months: 24, xmlField: "BC_2YEAR", csvAliases: ["2 Yr", "2Y", "BC_2YEAR"] },
  { key: "3Y", label: "3Y", months: 36, xmlField: "BC_3YEAR", csvAliases: ["3 Yr", "3Y", "BC_3YEAR"] },
  { key: "5Y", label: "5Y", months: 60, xmlField: "BC_5YEAR", csvAliases: ["5 Yr", "5Y", "BC_5YEAR"] },
  { key: "7Y", label: "7Y", months: 84, xmlField: "BC_7YEAR", csvAliases: ["7 Yr", "7Y", "BC_7YEAR"] },
  { key: "10Y", label: "10Y", months: 120, xmlField: "BC_10YEAR", csvAliases: ["10 Yr", "10Y", "BC_10YEAR"] },
  { key: "20Y", label: "20Y", months: 240, xmlField: "BC_20YEAR", csvAliases: ["20 Yr", "20Y", "BC_20YEAR"] },
  { key: "30Y", label: "30Y", months: 360, xmlField: "BC_30YEAR", csvAliases: ["30 Yr", "30Y", "BC_30YEAR"] },
];

const SPREAD_DEFS = [
  { id: "10Y2Y", label: "10Y-2Y", left: "10Y", right: "2Y" },
  { id: "30Y10Y", label: "30Y-10Y", left: "30Y", right: "10Y" },
  { id: "5Y3M", label: "5Y-3M", left: "5Y", right: "3M" },
];

const PALETTES = {
  light: {
    paper: "rgba(0,0,0,0)",
    plot: "rgba(0,0,0,0)",
    grid: "rgba(22, 32, 42, 0.11)",
    axis: "#556472",
    text: "#16202a",
    latest: "#0f766e",
    comparison: "#9a6a20",
    overlays: ["#0369a1", "#be123c", "#475569", "#1d4ed8", "#15803d", "#9a3412"],
    pca: ["#0f766e", "#9a6a20", "#9a2f2f"],
    positive: "#17643e",
    negative: "#9a2f2f",
    neutral: "#64748b",
    history: {
      "1M": "#0f766e",
      "3M": "#155e75",
      "6M": "#0369a1",
      "1Y": "#1d4ed8",
      "2Y": "#2563eb",
      "3Y": "#0891b2",
      "5Y": "#b45309",
      "7Y": "#c2410c",
      "10Y": "#be123c",
      "20Y": "#475569",
      "30Y": "#111827",
    },
  },
  dark: {
    paper: "rgba(0,0,0,0)",
    plot: "rgba(0,0,0,0)",
    grid: "rgba(127, 147, 165, 0.16)",
    axis: "#a9bac7",
    text: "#edf4f7",
    latest: "#35d1c7",
    comparison: "#d7a74a",
    overlays: ["#60a5fa", "#fb7185", "#94a3b8", "#22c55e", "#f97316", "#14b8a6"],
    pca: ["#35d1c7", "#d7a74a", "#f0837d"],
    positive: "#5fd095",
    negative: "#f0837d",
    neutral: "#94a3b8",
    history: {
      "1M": "#2dd4bf",
      "3M": "#22d3ee",
      "6M": "#38bdf8",
      "1Y": "#60a5fa",
      "2Y": "#3b82f6",
      "3Y": "#06b6d4",
      "5Y": "#f59e0b",
      "7Y": "#fb923c",
      "10Y": "#fb7185",
      "20Y": "#94a3b8",
      "30Y": "#f8fafc",
    },
  },
};

const dom = {};

const state = {
  records: [],
  recordByDate: new Map(),
  latestRecord: null,
  selectedComparisonDate: null,
  selectedComparisonRequestedDate: null,
  overlayDates: [],
  spreadSeries: {},
  extremeSpreadDates: {},
  historyMaturities: new Set(CONFIG.defaultHistoryMaturities),
  historyChart: {
    yAxisMode: "full",
    xRange: null,
    yRangeOverride: null,
  },
  pcaContext: null,
  pcaActive: null,
  pcaFit: {
    mode: "fullSample",
    transformation: "levels",
    rollingYears: CONFIG.pcaDefaultRollingYears,
    customStart: "",
    customEnd: "",
    presetRegime: "allHistory",
    selectedRollingDate: "",
  },
  pcaRange: {
    preset: "all",
    start: "",
    end: "",
  },
  source: null,
  theme: "light",
  isBusy: false,
  showDifferenceChart: false,
  hasHydratedOverlayStorage: false,
  pcaUiMessage: "",
};

function currentPalette() {
  return PALETTES[state.theme];
}

function persistOverlayDates() {
  localStorage.setItem(CONFIG.storageKeys.overlays, JSON.stringify(state.overlayDates));
}

function loadOverlayDates() {
  const stored = localStorage.getItem(CONFIG.storageKeys.overlays);
  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch (_error) {
    return [];
  }
}

function persistHistoryMaturities() {
  localStorage.setItem(
    CONFIG.storageKeys.historyMaturities,
    JSON.stringify(Array.from(state.historyMaturities))
  );
}

export {
  CONFIG,
  MATURITY_DEFS,
  SPREAD_DEFS,
  PALETTES,
  dom,
  state,
  currentPalette,
  persistOverlayDates,
  loadOverlayDates,
  persistHistoryMaturities,
};
