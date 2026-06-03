const CONFIG = {
  treasuryDirectJsonpBase: "https://www.treasurydirect.gov/TA_WS/securities/jqsearch",
  treasuryDirectSourcePage: "https://www.treasurydirect.gov/auctions/auction-query/",
  pageSize: 1000,
  maxPages: 3,
  defaultLookbackMonths: 12,
  maxRecentTableRows: 36,
  maxUpcomingTableRows: 16,
  maxAllocationRows: 24,
  storageKeys: {
    theme: "yield-curve-dashboard.theme",
    lookbackMonths: "yield-curve-dashboard.issuance-lookback-months",
    selectedTypes: "yield-curve-dashboard.issuance-types",
    includeUpcoming: "yield-curve-dashboard.issuance-include-upcoming",
    includeReopenings: "yield-curve-dashboard.issuance-include-reopenings",
  },
};

const TYPE_ORDER = ["Bill", "CMB", "Note", "Bond", "TIPS", "FRN"];

const TYPE_COLORS = {
  Bill: "#0f766e",
  CMB: "#155e75",
  Note: "#b45309",
  Bond: "#be123c",
  TIPS: "#6d28d9",
  FRN: "#475569",
};

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
    positive: "#17643e",
    negative: "#9a2f2f",
    neutral: "#64748b",
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
    positive: "#5fd095",
    negative: "#f0837d",
    neutral: "#94a3b8",
  },
};

const dom = {};

const state = {
  rows: [],
  totalAvailableRows: 0,
  selectedTypes: new Set(TYPE_ORDER),
  lookbackMonths: CONFIG.defaultLookbackMonths,
  includeUpcoming: true,
  includeReopenings: true,
  latestCompletedAuctionDate: "",
  latestAuctionDate: "",
  source: null,
  theme: "light",
  isBusy: false,
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheDom();
  hydratePreferences();
  renderTypeToggles();
  bindEvents();
  applyTheme(state.theme);
  updateTypeToggleAvailability();

  if (!window.Plotly) {
    setStatus(
      "Plotly did not load. This page uses the CDN-hosted library, so chart rendering needs basic internet access.",
      "error",
      { badge: "Chart Library" }
    );
    renderEmptyState();
    return;
  }

  renderEmptyState();
  await refreshAuctionData();
}

function cacheDom() {
  dom.latestAuctionDate = document.getElementById("latestAuctionDate");
  dom.auctionRowsLoaded = document.getElementById("auctionRowsLoaded");
  dom.auctionActiveSource = document.getElementById("auctionActiveSource");
  dom.refreshAuctionsBtn = document.getElementById("refreshAuctionsBtn");
  dom.exportAuctionsBtn = document.getElementById("exportAuctionsBtn");
  dom.auctionThemeToggleBtn = document.getElementById("auctionThemeToggleBtn");
  dom.auctionSourceBadge = document.getElementById("auctionSourceBadge");
  dom.auctionStatusMessage = document.getElementById("auctionStatusMessage");
  dom.auctionSourceNote = document.getElementById("auctionSourceNote");
  dom.issuanceLookbackSelect = document.getElementById("issuanceLookbackSelect");
  dom.includeUpcomingToggle = document.getElementById("includeUpcomingToggle");
  dom.includeReopeningsToggle = document.getElementById("includeReopeningsToggle");
  dom.issuanceTypeToggles = document.getElementById("issuanceTypeToggles");
  dom.issuanceFilterSummary = document.getElementById("issuanceFilterSummary");
  dom.periodOfferingAmount = document.getElementById("periodOfferingAmount");
  dom.periodAuctionCount = document.getElementById("periodAuctionCount");
  dom.averageBidToCover = document.getElementById("averageBidToCover");
  dom.indirectShare = document.getElementById("indirectShare");
  dom.upcomingOfferingAmount = document.getElementById("upcomingOfferingAmount");
  dom.issuanceWindowLabel = document.getElementById("issuanceWindowLabel");
  dom.monthlyIssuanceChart = document.getElementById("monthlyIssuanceChart");
  dom.bidToCoverChart = document.getElementById("bidToCoverChart");
  dom.bidderAllocationChart = document.getElementById("bidderAllocationChart");
  dom.termMixChart = document.getElementById("termMixChart");
  dom.upcomingAuctionsTable = document.getElementById("upcomingAuctionsTable");
  dom.recentAuctionsTable = document.getElementById("recentAuctionsTable");
}

function bindEvents() {
  dom.refreshAuctionsBtn.addEventListener("click", () => {
    void refreshAuctionData();
  });

  dom.exportAuctionsBtn.addEventListener("click", exportCurrentAuctionCsv);

  dom.auctionThemeToggleBtn.addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
    if (state.rows.length) {
      renderAll();
    } else {
      renderEmptyState();
    }
  });

  dom.issuanceLookbackSelect.addEventListener("change", () => {
    state.lookbackMonths =
      Number.parseInt(dom.issuanceLookbackSelect.value, 10) || CONFIG.defaultLookbackMonths;
    persistPreferences();
    renderAll();
  });

  dom.includeUpcomingToggle.addEventListener("change", () => {
    state.includeUpcoming = dom.includeUpcomingToggle.checked;
    persistPreferences();
    renderAll();
  });

  dom.includeReopeningsToggle.addEventListener("change", () => {
    state.includeReopenings = dom.includeReopeningsToggle.checked;
    persistPreferences();
    renderAll();
  });

  dom.issuanceTypeToggles.addEventListener("change", (event) => {
    const checkbox = event.target.closest("input[type='checkbox']");
    if (!checkbox) {
      return;
    }

    if (checkbox.checked) {
      state.selectedTypes.add(checkbox.value);
    } else if (state.selectedTypes.size > 1) {
      state.selectedTypes.delete(checkbox.value);
    } else {
      checkbox.checked = true;
      return;
    }

    persistPreferences();
    renderAll();
  });
}

function hydratePreferences() {
  const storedTheme = localStorage.getItem(CONFIG.storageKeys.theme);
  if (storedTheme === "light" || storedTheme === "dark") {
    state.theme = storedTheme;
  }

  const storedLookback = Number.parseInt(
    localStorage.getItem(CONFIG.storageKeys.lookbackMonths),
    10
  );
  if (Number.isFinite(storedLookback) && storedLookback > 0) {
    state.lookbackMonths = storedLookback;
  }

  const storedTypes = localStorage.getItem(CONFIG.storageKeys.selectedTypes);
  if (storedTypes) {
    try {
      const parsed = JSON.parse(storedTypes);
      const validTypes = parsed.filter((type) => TYPE_ORDER.includes(type));
      if (validTypes.length) {
        state.selectedTypes = new Set(validTypes);
      }
    } catch (_error) {
      // Ignore malformed local storage.
    }
  }

  const storedUpcoming = localStorage.getItem(CONFIG.storageKeys.includeUpcoming);
  if (storedUpcoming === "true" || storedUpcoming === "false") {
    state.includeUpcoming = storedUpcoming === "true";
  }

  const storedReopenings = localStorage.getItem(CONFIG.storageKeys.includeReopenings);
  if (storedReopenings === "true" || storedReopenings === "false") {
    state.includeReopenings = storedReopenings === "true";
  }

  dom.issuanceLookbackSelect.value = String(state.lookbackMonths);
  if (dom.issuanceLookbackSelect.value !== String(state.lookbackMonths)) {
    state.lookbackMonths = CONFIG.defaultLookbackMonths;
    dom.issuanceLookbackSelect.value = String(state.lookbackMonths);
  }
  dom.includeUpcomingToggle.checked = state.includeUpcoming;
  dom.includeReopeningsToggle.checked = state.includeReopenings;
}

function persistPreferences() {
  localStorage.setItem(CONFIG.storageKeys.lookbackMonths, String(state.lookbackMonths));
  localStorage.setItem(CONFIG.storageKeys.selectedTypes, JSON.stringify([...state.selectedTypes]));
  localStorage.setItem(CONFIG.storageKeys.includeUpcoming, String(state.includeUpcoming));
  localStorage.setItem(CONFIG.storageKeys.includeReopenings, String(state.includeReopenings));
}

async function refreshAuctionData() {
  if (state.isBusy) {
    return false;
  }

  try {
    setBusy(true);
    setStatus("Fetching recent TreasuryDirect auction pages.", "warning", {
      badge: "TreasuryDirect",
    });

    const rawRows = [];
    let totalAvailableRows = 0;

    for (let pageNumber = 0; pageNumber < CONFIG.maxPages; pageNumber += 1) {
      const payload = await fetchTreasuryDirectPage(pageNumber);
      const pageRows = Array.isArray(payload?.securityList) ? payload.securityList : [];
      totalAvailableRows = Number(payload?.totalResultsCount) || totalAvailableRows;
      rawRows.push(...pageRows);
      setStatus(
        `Fetched page ${pageNumber + 1} from TreasuryDirect; ${rawRows.length.toLocaleString()} rows loaded.`,
        "warning",
        { badge: "TreasuryDirect" }
      );

      if (pageRows.length < CONFIG.pageSize) {
        break;
      }
    }

    const rows = prepareAuctionRows(rawRows);
    state.rows = rows;
    state.totalAvailableRows = totalAvailableRows || rows.length;
    state.latestAuctionDate = resolveLatestDate(rows.map((row) => row.auctionDate));
    state.latestCompletedAuctionDate = resolveLatestDate(
      rows.filter((row) => row.isCompleted).map((row) => row.auctionDate)
    );
    state.source = {
      label: "TreasuryDirect JSONP",
      badge: "TreasuryDirect",
      sourceUrl: CONFIG.treasuryDirectSourcePage,
    };

    updateTypeToggleAvailability();
    updateStatusCards();
    renderAll();
    setStatus(
      `Loaded ${rows.length.toLocaleString()} recent auction rows from TreasuryDirect.`,
      "info",
      { badge: "TreasuryDirect" }
    );
    return true;
  } catch (error) {
    setStatus(`TreasuryDirect auction fetch failed: ${error.message}`, "error", {
      badge: "Needs Data",
    });
    renderEmptyState();
    return false;
  } finally {
    setBusy(false);
  }
}

function fetchTreasuryDirectPage(pageNumber) {
  return new Promise((resolve, reject) => {
    const callbackName = `tdIssuanceCallback_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`;
    const url = new URL(CONFIG.treasuryDirectJsonpBase);
    url.searchParams.set("format", "jsonp");
    url.searchParams.set("callback", callbackName);
    url.searchParams.set("pagenum", String(pageNumber));
    url.searchParams.set("pagesize", String(CONFIG.pageSize));

    const script = document.createElement("script");
    let settled = false;

    const cleanup = () => {
      delete window[callbackName];
      script.remove();
    };

    const timeout = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error("Timed out waiting for TreasuryDirect."));
    }, 20000);

    window[callbackName] = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      resolve(payload);
    };

    script.onerror = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      reject(new Error("TreasuryDirect JSONP script failed to load."));
    };

    script.async = true;
    script.src = url.href;
    document.head.append(script);
  });
}

function prepareAuctionRows(rawRows) {
  const deduped = new Map();

  rawRows.forEach((raw) => {
    const row = normalizeAuctionRow(raw);
    if (!row?.auctionDate || !row.offeringAmount) {
      return;
    }

    deduped.set(`${row.cusip}-${row.auctionDate}`, row);
  });

  return Array.from(deduped.values()).sort(
    (left, right) => right.auctionTimestamp - left.auctionTimestamp || left.cusip.localeCompare(right.cusip)
  );
}

function normalizeAuctionRow(raw) {
  const auctionDate = normalizeDateValue(raw.auctionDate);
  const issueDate = normalizeDateValue(raw.issueDate);
  const announcementDate = normalizeDateValue(raw.announcementDate);
  const maturityDate = normalizeDateValue(raw.maturityDate);
  const type = resolveSecurityType(raw);
  const resultRate = resolveResultRate(raw);
  const totalAccepted = parseNumber(raw.totalAccepted);
  const bidToCover = parseNumber(raw.bidToCoverRatio);
  const totalTendered = parseNumber(raw.totalTendered);

  return {
    cusip: String(raw.cusip || "").trim(),
    type,
    securityType: String(raw.securityType || "").trim(),
    term: resolveTermLabel(raw),
    auctionDate,
    issueDate,
    announcementDate,
    maturityDate,
    auctionTimestamp: auctionDate ? Date.parse(`${auctionDate}T00:00:00Z`) : 0,
    offeringAmount: parseNumber(raw.offeringAmount),
    totalAccepted,
    totalTendered,
    bidToCover,
    resultRate,
    pricePer100: parseNumber(raw.pricePer100),
    competitiveAccepted: parseNumber(raw.competitiveAccepted),
    primaryDealerAccepted: parseNumber(raw.primaryDealerAccepted),
    indirectBidderAccepted: parseNumber(raw.indirectBidderAccepted),
    directBidderAccepted: parseNumber(raw.directBidderAccepted),
    noncompetitiveAccepted: parseNumber(raw.noncompetitiveAccepted),
    treasuryRetailAccepted: parseNumber(raw.treasuryRetailAccepted),
    somaAccepted: parseNumber(raw.somaAccepted),
    isReopening: String(raw.reopening || "").toLowerCase() === "yes",
    isCmb: String(raw.cashManagementBillCMB || "").toLowerCase() === "yes",
    isCompleted: Boolean(totalAccepted || bidToCover || resultRate.value != null),
    pdfFilenameAnnouncement: String(raw.pdfFilenameAnnouncement || "").trim(),
    pdfFilenameCompetitiveResults: String(raw.pdfFilenameCompetitiveResults || "").trim(),
    updatedTimestamp: normalizeDateTimeValue(raw.updatedTimestamp),
  };
}

function resolveSecurityType(raw) {
  if (String(raw.cashManagementBillCMB || "").toLowerCase() === "yes" || raw.type === "CMB") {
    return "CMB";
  }

  if (String(raw.tips || "").toLowerCase() === "yes" || raw.type === "TIPS") {
    return "TIPS";
  }

  if (String(raw.floatingRate || "").toLowerCase() === "yes" || raw.type === "FRN") {
    return "FRN";
  }

  const candidates = [raw.type, raw.securityType].map((value) => String(value || "").trim());
  return candidates.find((value) => TYPE_ORDER.includes(value)) || "Bill";
}

function resolveTermLabel(raw) {
  const candidates = [raw.term, raw.securityTerm, raw.securityTermWeekYear, raw.securityTermDayMonth];
  const value = candidates.find((candidate) => String(candidate || "").trim());
  return String(value || "--").trim();
}

function resolveResultRate(raw) {
  const candidates = [
    { label: "Yield", value: parseNumber(raw.highYield) },
    { label: "Discount", value: parseNumber(raw.highDiscountRate) },
    { label: "Margin", value: parseNumber(raw.highDiscountMargin) },
    { label: "Median Yield", value: parseNumber(raw.averageMedianYield) },
    { label: "Median Discount", value: parseNumber(raw.averageMedianDiscountRate) },
  ];

  return candidates.find((candidate) => candidate.value != null) || {
    label: "Rate",
    value: null,
  };
}

function renderAll() {
  const period = getPeriodContext();
  renderFilterSummary(period);
  renderSummaryCards(period);
  renderMonthlyIssuanceChart(period);
  renderBidToCoverChart(period);
  renderBidderAllocationChart(period);
  renderTermMixChart(period);
  renderUpcomingAuctionsTable(period.upcomingRows);
  renderRecentAuctionsTable(period.completedRows);
}

function renderEmptyState() {
  updateStatusCards();
  dom.periodOfferingAmount.textContent = "--";
  dom.periodAuctionCount.textContent = "--";
  dom.averageBidToCover.textContent = "--";
  dom.indirectShare.textContent = "--";
  dom.upcomingOfferingAmount.textContent = "--";
  dom.issuanceWindowLabel.textContent = "--";
  dom.issuanceFilterSummary.textContent = "Filters apply after live data loads.";
  renderEmptyChart(dom.monthlyIssuanceChart, "Auction issuance data will appear after TreasuryDirect loads.");
  renderEmptyChart(dom.bidToCoverChart, "Auction demand data will appear after TreasuryDirect loads.");
  renderEmptyChart(dom.bidderAllocationChart, "Bidder allocation data will appear after TreasuryDirect loads.");
  renderEmptyChart(dom.termMixChart, "Term mix data will appear after TreasuryDirect loads.");
  renderEmptyTable(dom.upcomingAuctionsTable, 8, "No upcoming auctions loaded.");
  renderEmptyTable(dom.recentAuctionsTable, 10, "No auction results loaded.");
}

function getPeriodContext() {
  const typeFilteredRows = state.rows.filter((row) => state.selectedTypes.has(row.type));
  const completedSourceRows = typeFilteredRows.filter((row) => row.isCompleted);
  const latestCompletedDate =
    resolveLatestDate(completedSourceRows.map((row) => row.auctionDate)) ||
    state.latestCompletedAuctionDate ||
    state.latestAuctionDate;
  const startDate = latestCompletedDate
    ? shiftIsoDate(latestCompletedDate, { months: -state.lookbackMonths })
    : "";
  const completedRows = completedSourceRows
    .filter((row) => !startDate || (row.auctionDate >= startDate && row.auctionDate <= latestCompletedDate))
    .filter((row) => state.includeReopenings || !row.isReopening)
    .sort((left, right) => left.auctionTimestamp - right.auctionTimestamp);
  const upcomingRows = typeFilteredRows
    .filter((row) => !row.isCompleted)
    .sort((left, right) => left.auctionTimestamp - right.auctionTimestamp);

  return {
    typeFilteredRows,
    completedRows,
    upcomingRows: state.includeUpcoming ? upcomingRows : [],
    allUpcomingRows: upcomingRows,
    latestCompletedDate,
    startDate,
    endDate: latestCompletedDate,
  };
}

function renderFilterSummary(period) {
  const typeList = [...state.selectedTypes].sort(sortTypes).join(", ");
  const completedCount = period.completedRows.length.toLocaleString();
  const upcomingCount = period.upcomingRows.length.toLocaleString();
  const reopeningText = state.includeReopenings ? "including reopenings" : "excluding reopenings";
  const upcomingText = state.includeUpcoming ? `${upcomingCount} announced rows shown` : "announced rows hidden";
  const windowText =
    period.startDate && period.endDate
      ? `${formatHumanDate(period.startDate)} to ${formatHumanDate(period.endDate)}`
      : "no completed auction window";

  dom.issuanceFilterSummary.textContent = `${completedCount} completed auctions in ${windowText}, ${reopeningText}; types: ${typeList}. ${upcomingText}.`;
  dom.issuanceWindowLabel.textContent =
    period.startDate && period.endDate
      ? `${formatMonthLabel(period.startDate)} - ${formatMonthLabel(period.endDate)}`
      : "--";
}

function renderSummaryCards(period) {
  const completedRows = period.completedRows;
  const grossOffering = sumBy(completedRows, "offeringAmount");
  const upcomingOffering = sumBy(period.upcomingRows, "offeringAmount");
  const weightedBidToCover = weightedAverage(
    completedRows.filter((row) => row.bidToCover != null),
    (row) => row.bidToCover,
    (row) => row.offeringAmount || 1
  );
  const indirectAccepted = sumBy(completedRows, "indirectBidderAccepted");
  const primaryAccepted = sumBy(completedRows, "primaryDealerAccepted");
  const directAccepted = sumBy(completedRows, "directBidderAccepted");
  const knownBidderAccepted = indirectAccepted + primaryAccepted + directAccepted;

  dom.periodOfferingAmount.textContent = formatMoney(grossOffering);
  dom.periodAuctionCount.textContent = completedRows.length
    ? completedRows.length.toLocaleString()
    : "--";
  dom.averageBidToCover.textContent =
    weightedBidToCover == null ? "--" : `${weightedBidToCover.toFixed(2)}x`;
  dom.indirectShare.textContent = knownBidderAccepted
    ? formatShare(indirectAccepted / knownBidderAccepted)
    : "--";
  dom.upcomingOfferingAmount.textContent = state.includeUpcoming
    ? formatMoney(upcomingOffering)
    : "Hidden";
}

function renderMonthlyIssuanceChart(period) {
  if (!period.completedRows.length) {
    renderEmptyChart(dom.monthlyIssuanceChart, "No completed auctions match the current filters.");
    return;
  }

  const monthKeys = enumerateMonthKeys(period.startDate, period.endDate);
  const buckets = new Map(monthKeys.map((monthKey) => [monthKey, {}]));

  period.completedRows.forEach((row) => {
    const monthKey = row.auctionDate.slice(0, 7);
    if (!buckets.has(monthKey)) {
      buckets.set(monthKey, {});
    }
    const monthBucket = buckets.get(monthKey);
    monthBucket[row.type] = (monthBucket[row.type] || 0) + row.offeringAmount;
  });

  const activeTypes = TYPE_ORDER.filter((type) => state.selectedTypes.has(type));
  const traces = activeTypes
    .map((type) => ({
      type: "bar",
      name: type,
      x: monthKeys,
      y: monthKeys.map((monthKey) => (buckets.get(monthKey)?.[type] || 0) / 1e9),
      marker: { color: TYPE_COLORS[type] },
      hovertemplate: `${type}<br>%{x}<br>$%{y:,.1f}B<extra></extra>`,
    }))
    .filter((trace) => trace.y.some((value) => value > 0));

  renderPlot(
    dom.monthlyIssuanceChart,
    traces,
    buildBaseLayout({
      margin: { t: 24, r: 20, b: 58, l: 74 },
      barmode: "stack",
      hovermode: "x unified",
      xaxis: {
        title: { text: "Auction Month" },
        type: "category",
        tickangle: monthKeys.length > 18 ? -45 : 0,
      },
      yaxis: {
        title: { text: "Offering Amount ($B)" },
      },
      legend: {
        orientation: "h",
        x: 0,
        y: 1.12,
      },
    })
  );
}

function renderBidToCoverChart(period) {
  const rows = period.completedRows.filter((row) => row.bidToCover != null);
  if (!rows.length) {
    renderEmptyChart(dom.bidToCoverChart, "No bid-to-cover data matches the current filters.");
    return;
  }

  const maxOfferingBn = Math.max(...rows.map((row) => row.offeringAmount / 1e9));
  const sizeRef = (2 * maxOfferingBn) / 34 ** 2;
  const traces = TYPE_ORDER.filter((type) => state.selectedTypes.has(type))
    .map((type) => {
      const typeRows = rows.filter((row) => row.type === type);
      if (!typeRows.length) {
        return null;
      }

      return {
        type: "scatter",
        mode: "markers",
        name: type,
        x: typeRows.map((row) => row.auctionDate),
        y: typeRows.map((row) => row.bidToCover),
        text: typeRows.map((row) => `${row.term} ${row.cusip}`),
        customdata: typeRows.map((row) => [
          formatMoney(row.offeringAmount),
          formatHumanDate(row.issueDate),
          row.isReopening ? "Reopening" : "New issue",
        ]),
        marker: {
          color: TYPE_COLORS[type],
          opacity: 0.78,
          size: typeRows.map((row) => row.offeringAmount / 1e9),
          sizemode: "area",
          sizeref: sizeRef,
          sizemin: 6,
          line: { color: "rgba(255,255,255,0.5)", width: 1 },
        },
        hovertemplate:
          "%{text}<br>Auction %{x}<br>Issue %{customdata[1]}<br>Offering %{customdata[0]}<br>Bid-to-cover %{y:.2f}x<br>%{customdata[2]}<extra></extra>",
      };
    })
    .filter(Boolean);

  renderPlot(
    dom.bidToCoverChart,
    traces,
    buildBaseLayout({
      margin: { t: 24, r: 24, b: 52, l: 74 },
      hovermode: "closest",
      xaxis: { title: { text: "Auction Date" }, type: "date" },
      yaxis: { title: { text: "Bid-To-Cover Ratio" } },
      legend: {
        orientation: "h",
        x: 0,
        y: 1.12,
      },
    })
  );
}

function renderBidderAllocationChart(period) {
  const rows = period.completedRows
    .filter((row) => row.primaryDealerAccepted || row.indirectBidderAccepted || row.directBidderAccepted)
    .slice(-CONFIG.maxAllocationRows);

  if (!rows.length) {
    renderEmptyChart(dom.bidderAllocationChart, "Bidder allocation fields are unavailable for this filter.");
    return;
  }

  const labels = rows.map((row) => `${row.auctionDate}<br>${row.type} ${row.term}`);
  const allocationSeries = [
    {
      name: "Indirect",
      color: currentPalette().latest,
      accessor: (row) => row.indirectBidderAccepted,
    },
    {
      name: "Primary Dealer",
      color: currentPalette().comparison,
      accessor: (row) => row.primaryDealerAccepted,
    },
    {
      name: "Direct",
      color: currentPalette().overlays[0],
      accessor: (row) => row.directBidderAccepted,
    },
  ];

  const traces = allocationSeries.map((series) => ({
    type: "bar",
    name: series.name,
    x: labels,
    y: rows.map((row) => {
      const total =
        (row.indirectBidderAccepted || 0) +
        (row.primaryDealerAccepted || 0) +
        (row.directBidderAccepted || 0);
      return total ? ((series.accessor(row) || 0) / total) * 100 : 0;
    }),
    marker: { color: series.color },
    hovertemplate: `${series.name}<br>%{x}<br>%{y:.1f}% of known competitive accepted<extra></extra>`,
  }));

  renderPlot(
    dom.bidderAllocationChart,
    traces,
    buildBaseLayout({
      margin: { t: 24, r: 24, b: 92, l: 74 },
      barmode: "stack",
      hovermode: "x unified",
      xaxis: { title: { text: "Recent Completed Auctions" }, type: "category", tickangle: -45 },
      yaxis: {
        title: { text: "Share Of Known Competitive Accepted (%)" },
        range: [0, 100],
      },
      legend: {
        orientation: "h",
        x: 0,
        y: 1.12,
      },
    })
  );
}

function renderTermMixChart(period) {
  if (!period.completedRows.length) {
    renderEmptyChart(dom.termMixChart, "No completed auctions match the current filters.");
    return;
  }

  const termBuckets = new Map();
  period.completedRows.forEach((row) => {
    const term = row.term || "--";
    const existing = termBuckets.get(term) || {
      term,
      amount: 0,
      sortValue: termSortValue(term),
    };
    existing.amount += row.offeringAmount;
    termBuckets.set(term, existing);
  });

  const rows = Array.from(termBuckets.values())
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 14)
    .sort((left, right) => left.sortValue - right.sortValue);

  renderPlot(
    dom.termMixChart,
    [
      {
        type: "bar",
        orientation: "h",
        y: rows.map((row) => row.term),
        x: rows.map((row) => row.amount / 1e9),
        marker: { color: currentPalette().latest },
        hovertemplate: "%{y}<br>$%{x:,.1f}B<extra></extra>",
      },
    ],
    buildBaseLayout({
      margin: { t: 24, r: 24, b: 52, l: 112 },
      showlegend: false,
      xaxis: { title: { text: "Offering Amount ($B)" } },
      yaxis: { title: { text: "Term" }, automargin: true },
    })
  );
}

function renderUpcomingAuctionsTable(rows) {
  dom.upcomingAuctionsTable.innerHTML = "";

  if (!state.includeUpcoming) {
    renderEmptyTable(dom.upcomingAuctionsTable, 8, "Announced auctions are hidden by the current filter.");
    return;
  }

  if (!rows.length) {
    renderEmptyTable(dom.upcomingAuctionsTable, 8, "No announced auctions match the current filters.");
    return;
  }

  rows.slice(0, CONFIG.maxUpcomingTableRows).forEach((row) => {
    const tr = document.createElement("tr");
    appendTextCell(tr, formatHumanDate(row.auctionDate));
    appendTextCell(tr, formatHumanDate(row.issueDate));
    appendTextCell(tr, row.type);
    appendTextCell(tr, row.term);
    appendTextCell(tr, row.cusip, "mono-cell");
    appendTextCell(tr, formatMoney(row.offeringAmount));
    appendTextCell(tr, row.isReopening ? "Yes" : "No");
    appendLinkCell(tr, row);
    dom.upcomingAuctionsTable.append(tr);
  });
}

function renderRecentAuctionsTable(rows) {
  dom.recentAuctionsTable.innerHTML = "";

  if (!rows.length) {
    renderEmptyTable(dom.recentAuctionsTable, 10, "No completed auctions match the current filters.");
    return;
  }

  rows
    .slice()
    .reverse()
    .slice(0, CONFIG.maxRecentTableRows)
    .forEach((row) => {
      const tr = document.createElement("tr");
      appendTextCell(tr, formatHumanDate(row.auctionDate));
      appendTextCell(tr, formatHumanDate(row.issueDate));
      appendTextCell(tr, row.type);
      appendTextCell(tr, row.term);
      appendTextCell(tr, row.cusip, "mono-cell");
      appendTextCell(tr, formatMoney(row.offeringAmount));
      appendTextCell(tr, formatMoney(row.totalAccepted));
      appendTextCell(tr, row.bidToCover == null ? "--" : `${row.bidToCover.toFixed(2)}x`);
      appendTextCell(tr, formatResultRate(row));
      appendLinkCell(tr, row);
      dom.recentAuctionsTable.append(tr);
    });
}

function appendTextCell(row, value, className = "") {
  const cell = document.createElement("td");
  if (className) {
    cell.className = className;
  }
  cell.textContent = value || "--";
  row.append(cell);
}

function appendLinkCell(row, auctionRow) {
  const cell = document.createElement("td");
  const links = [
    {
      label: "Announcement",
      href: buildPdfUrl(auctionRow.pdfFilenameAnnouncement, auctionRow.announcementDate),
    },
    {
      label: "Results",
      href: buildPdfUrl(auctionRow.pdfFilenameCompetitiveResults, auctionRow.auctionDate),
    },
  ].filter((link) => link.href);

  if (!links.length) {
    cell.textContent = "--";
    row.append(cell);
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "table-link-group";
  links.forEach((link) => {
    const anchor = document.createElement("a");
    anchor.href = link.href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = link.label;
    wrapper.append(anchor);
  });
  cell.append(wrapper);
  row.append(cell);
}

function buildPdfUrl(filename, date) {
  if (!filename || !date) {
    return "";
  }

  return `https://www.treasurydirect.gov/instit/annceresult/press/preanre/${date.slice(
    0,
    4
  )}/${encodeURIComponent(filename)}`;
}

function renderEmptyTable(tableBody, columnCount, message) {
  tableBody.innerHTML = "";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = columnCount;
  cell.className = "empty-table-cell";
  cell.textContent = message;
  row.append(cell);
  tableBody.append(row);
}

function renderTypeToggles() {
  dom.issuanceTypeToggles.innerHTML = "";

  TYPE_ORDER.forEach((type) => {
    const label = document.createElement("label");
    label.className = "toggle-chip";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = type;
    input.checked = state.selectedTypes.has(type);

    const swatch = document.createElement("span");
    swatch.className = "type-swatch";
    swatch.style.background = TYPE_COLORS[type];

    const text = document.createElement("span");
    text.textContent = type;

    label.append(input, swatch, text);
    dom.issuanceTypeToggles.append(label);
  });
}

function updateTypeToggleAvailability() {
  const availableTypes = new Set(state.rows.map((row) => row.type));

  dom.issuanceTypeToggles.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    const hasRows = !state.rows.length || availableTypes.has(checkbox.value);
    checkbox.disabled = !hasRows;
    checkbox.checked = hasRows && state.selectedTypes.has(checkbox.value);
  });
}

function updateStatusCards() {
  dom.latestAuctionDate.textContent = state.latestCompletedAuctionDate
    ? formatHumanDate(state.latestCompletedAuctionDate)
    : state.latestAuctionDate
      ? formatHumanDate(state.latestAuctionDate)
      : "--";
  dom.auctionRowsLoaded.textContent = state.rows.length ? state.rows.length.toLocaleString() : "--";
  dom.auctionActiveSource.textContent = state.source?.label || "Waiting";
}

function setStatus(message, tone = "info", { badge } = {}) {
  dom.auctionStatusMessage.textContent = message;
  dom.auctionSourceBadge.textContent = badge || state.source?.badge || "Ready";
  dom.auctionSourceBadge.className = "status-badge";

  if (tone === "warning") {
    dom.auctionSourceBadge.classList.add("is-warning");
  } else if (tone === "error") {
    dom.auctionSourceBadge.classList.add("is-error");
  }
}

function setBusy(isBusy) {
  state.isBusy = isBusy;
  dom.refreshAuctionsBtn.disabled = isBusy;
  dom.exportAuctionsBtn.disabled = isBusy || !state.rows.length;
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(CONFIG.storageKeys.theme, theme);
  dom.auctionThemeToggleBtn.textContent = theme === "dark" ? "Light Mode" : "Dark Mode";
}

function exportCurrentAuctionCsv() {
  if (!state.rows.length) {
    setStatus("No auction data is loaded yet, so there is nothing to export.", "warning");
    return;
  }

  const period = getPeriodContext();
  const rows = [...period.upcomingRows, ...period.completedRows.slice().reverse()];

  if (!rows.length) {
    setStatus("No rows match the current filters, so there is nothing to export.", "warning");
    return;
  }

  const headers = [
    "Auction Date",
    "Issue Date",
    "Type",
    "Term",
    "CUSIP",
    "Offering Amount",
    "Total Accepted",
    "Total Tendered",
    "Bid To Cover",
    "Result Rate",
    "Result Rate Type",
    "Reopening",
  ];
  const csvRows = rows.map((row) =>
    [
      row.auctionDate,
      row.issueDate,
      row.type,
      row.term,
      row.cusip,
      row.offeringAmount,
      row.totalAccepted,
      row.totalTendered,
      row.bidToCover,
      row.resultRate.value,
      row.resultRate.label,
      row.isReopening ? "Yes" : "No",
    ]
      .map(csvEscape)
      .join(",")
  );

  downloadTextFile(
    `treasury_issuance_${period.startDate || "filtered"}_${period.endDate || "latest"}.csv`,
    [headers.join(","), ...csvRows].join("\n")
  );
  setStatus("Downloaded the currently filtered Treasury auction rows.", "info");
}

function csvEscape(value) {
  if (value === undefined || value === null) {
    return "";
  }

  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function renderPlot(container, data, layout, config = {}) {
  Plotly.react(container, data, layout, {
    displaylogo: false,
    responsive: true,
    modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
    ...config,
  });
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
        color: "#ffffff",
      },
      ...hoverlabel,
    },
    xaxis: {
      gridcolor: palette.grid,
      linecolor: palette.grid,
      tickfont: { color: palette.axis },
      zerolinecolor: palette.grid,
      title: {
        font: { color: palette.axis },
        ...(xaxis.title || {}),
      },
      ...xaxis,
    },
    yaxis: {
      gridcolor: palette.grid,
      linecolor: palette.grid,
      tickfont: { color: palette.axis },
      zerolinecolor: palette.grid,
      title: {
        font: { color: palette.axis },
        ...(yaxis.title || {}),
      },
      ...yaxis,
    },
    legend,
    ...rest,
  };
}

function currentPalette() {
  return PALETTES[state.theme];
}

function normalizeDateValue(value) {
  if (!value) {
    return "";
  }

  const clean = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
    return clean.slice(0, 10);
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) {
    const [month, day, year] = clean.split("/");
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return "";
}

function normalizeDateTimeValue(value) {
  if (!value) {
    return "";
  }
  const clean = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(clean) ? clean : "";
}

function parseNumber(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const clean = String(value).trim().replace(/,/g, "");
  if (!clean) {
    return null;
  }

  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveLatestDate(dates) {
  return dates.filter(Boolean).sort().at(-1) || "";
}

function shiftIsoDate(date, { months = 0 } = {}) {
  const [year, month, day] = date.split("-").map(Number);
  let nextYear = year;
  let nextMonth = month + months;

  while (nextMonth > 12) {
    nextMonth -= 12;
    nextYear += 1;
  }

  while (nextMonth < 1) {
    nextMonth += 12;
    nextYear -= 1;
  }

  const maxDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  const shifted = new Date(Date.UTC(nextYear, nextMonth - 1, Math.min(day, maxDay)));
  return dateToIso(shifted);
}

function dateToIso(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function enumerateMonthKeys(startDate, endDate) {
  if (!startDate || !endDate) {
    return [];
  }

  const [startYear, startMonth] = startDate.split("-").map(Number);
  const [endYear, endMonth] = endDate.split("-").map(Number);
  const keys = [];
  let year = startYear;
  let month = startMonth;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return keys;
}

function formatHumanDate(date) {
  if (!date) {
    return "--";
  }

  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatMonthLabel(date) {
  if (!date) {
    return "--";
  }

  const [year, month] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
  }).format(new Date(year, month - 1, 1));
}

function formatMoney(value) {
  if (value == null || !Number.isFinite(value)) {
    return "--";
  }

  const absValue = Math.abs(value);
  if (absValue >= 1e12) {
    return `$${(value / 1e12).toFixed(2)}T`;
  }

  if (absValue >= 1e9) {
    return `$${(value / 1e9).toFixed(1)}B`;
  }

  if (absValue >= 1e6) {
    return `$${(value / 1e6).toFixed(1)}M`;
  }

  return `$${value.toLocaleString()}`;
}

function formatShare(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatResultRate(row) {
  if (row.resultRate.value == null) {
    return "--";
  }

  return `${row.resultRate.value.toFixed(3)}% ${row.resultRate.label}`;
}

function sortTypes(left, right) {
  return TYPE_ORDER.indexOf(left) - TYPE_ORDER.indexOf(right);
}

function sumBy(rows, key) {
  return rows.reduce((sum, row) => sum + (row[key] || 0), 0);
}

function weightedAverage(rows, valueAccessor, weightAccessor) {
  const weighted = rows.reduce(
    (accumulator, row) => {
      const value = valueAccessor(row);
      const weight = weightAccessor(row);
      if (value == null || !Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) {
        return accumulator;
      }

      accumulator.value += value * weight;
      accumulator.weight += weight;
      return accumulator;
    },
    { value: 0, weight: 0 }
  );

  return weighted.weight ? weighted.value / weighted.weight : null;
}

function termSortValue(term) {
  const clean = String(term || "");
  let months = 0;
  let matched = false;
  const unitPattern = /(\d+)\s*-\s*(Year|Month|Week|Day)|(\d+)\s*(Year|Month|Week|Day)/gi;
  let match = unitPattern.exec(clean);

  while (match) {
    matched = true;
    const amount = Number(match[1] || match[3]);
    const unit = String(match[2] || match[4]).toLowerCase();
    if (unit === "year") {
      months += amount * 12;
    } else if (unit === "month") {
      months += amount;
    } else if (unit === "week") {
      months += amount / 4.348;
    } else if (unit === "day") {
      months += amount / 30.437;
    }
    match = unitPattern.exec(clean);
  }

  if (matched) {
    return months;
  }

  const numeric = Number.parseFloat(clean);
  return Number.isFinite(numeric) ? numeric : 9999;
}
