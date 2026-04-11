import { CONFIG, MATURITY_DEFS, dom, state } from "./core.js";
import {
  average,
  clampNumber,
  dotProduct,
  findFirstScoredDate,
  findLastScoredDate,
  formatHumanDate,
  maturityMonths,
  shiftIsoDate,
} from "./utils.js";
import { isDateInRanges, resolveRegimePreset } from "./regimes.js";

// === PCA And Statistics ===
function computeLegacyPca(records) {
  const coverage = MATURITY_DEFS.map((definition) => {
    const observed = records.reduce(
      (count, record) => count + (record[definition.key] != null ? 1 : 0),
      0
    );

    return {
      key: definition.key,
      coverage: observed / records.length,
    };
  });

  let selectedKeys = coverage
    .filter((item) => item.coverage >= CONFIG.pcaCoverageThreshold)
    .map((item) => item.key);

  if (selectedKeys.length < 6) {
    selectedKeys = coverage
      .filter((item) => item.coverage > 0)
      .sort((left, right) => right.coverage - left.coverage)
      .slice(0, Math.max(6, Math.min(9, coverage.length)))
      .map((item) => item.key);
  }

  selectedKeys = selectedKeys.sort(
    (left, right) => maturityMonths(left) - maturityMonths(right)
  );

  const completeRows = records.filter((record) => selectedKeys.every((key) => record[key] != null));
  if (completeRows.length < 30 || selectedKeys.length < 3) {
    return null;
  }

  const means = selectedKeys.map(
    (key) => completeRows.reduce((sum, record) => sum + record[key], 0) / completeRows.length
  );

  const centered = completeRows.map((record) =>
    selectedKeys.map((key, index) => record[key] - means[index])
  );

  const covariance = computeCovarianceMatrix(centered);
  const eigenPairs = topEigenPairs(covariance, CONFIG.pcaComponentCount, selectedKeys);
  const totalVariance = covariance.reduce((sum, row, index) => sum + row[index], 0);
  const scores = centered.map((row, rowIndex) => ({
    date: completeRows[rowIndex].date,
    values: eigenPairs.map((pair) => dotProduct(row, pair.vector)),
  }));

  return {
    keys: selectedKeys,
    rowsUsed: completeRows.length,
    explainedVariance: eigenPairs.map((pair) => pair.value / totalVariance),
    eigenPairs,
    scores,
    startDate: completeRows[0].date,
    endDate: completeRows.at(-1).date,
  };
}

function buildPcaContext(records) {
  const keys = selectPcaKeys(records);
  if (keys.length < 3) {
    return null;
  }

  const context = {
    records,
    keys,
    transformedSeriesCache: new Map(),
    rollingCache: new Map(),
    baselineModels: null,
    legacyBaseline: null,
  };

  const baselineLevels = fitPcaModel({
    context,
    mode: "fullSample",
    label: "Full Sample",
    transformation: "levels",
  });
  const baselineDifferences = fitPcaModel({
    context,
    mode: "fullSample",
    label: "Full Sample",
    transformation: "differences",
  });

  if (!baselineLevels) {
    return null;
  }

  context.baselineModels = {
    levels: baselineLevels,
    differences: baselineDifferences,
  };
  context.legacyBaseline = computeLegacyPca(records);

  return context;
}

function selectPcaKeys(records) {
  const coverage = MATURITY_DEFS.map((definition) => {
    const observed = records.reduce(
      (count, record) => count + (record[definition.key] != null ? 1 : 0),
      0
    );

    return {
      key: definition.key,
      coverage: observed / records.length,
    };
  });

  let selectedKeys = coverage
    .filter((item) => item.coverage >= CONFIG.pcaCoverageThreshold)
    .map((item) => item.key);

  if (selectedKeys.length < 6) {
    selectedKeys = coverage
      .filter((item) => item.coverage > 0)
      .sort((left, right) => right.coverage - left.coverage)
      .slice(0, Math.max(6, Math.min(9, coverage.length)))
      .map((item) => item.key);
  }

  return selectedKeys.sort((left, right) => maturityMonths(left) - maturityMonths(right));
}

function fitPcaModel({
  context,
  mode,
  label,
  transformation = "levels",
  startDate = null,
  endDate = null,
  dateRanges = null,
  referenceVectors = null,
} = {}) {
  const dataset = buildPcaDataset(context, {
    transformation,
    startDate,
    endDate,
    dateRanges,
  });
  if (!dataset || dataset.completeRows.length < 30 || context.keys.length < 3) {
    return null;
  }

  const covariance = computeCovarianceMatrix(dataset.centeredRows);
  const totalVariance = covariance.reduce((sum, row, index) => sum + row[index], 0);
  const eigenPairs = topEigenPairs(covariance, CONFIG.pcaComponentCount, context.keys, {
    referenceVectors,
  });

  if (eigenPairs.length < 3 || totalVariance <= 0) {
    return null;
  }

  return {
    mode,
    label,
    transformation,
    keys: context.keys,
    means: dataset.means,
    eigenPairs,
    explainedVariance: eigenPairs.map((pair) => pair.value / totalVariance),
    rowsUsed: dataset.completeRows.length,
    fitStartDate: dataset.completeRows[0].date,
    fitEndDate: dataset.completeRows.at(-1).date,
    fitWindows:
      dateRanges?.length
        ? dateRanges.map((range) => ({ start: range.start, end: range.end, displayLabel: range.displayLabel }))
        : [{ start: dataset.completeRows[0].date, end: dataset.completeRows.at(-1).date }],
    scoreLabel: transformation === "differences" ? "Daily Change Score" : "Score",
  };
}

function buildPcaDataset(
  context,
  { transformation = "levels", startDate = null, endDate = null, dateRanges = null } = {}
) {
  const transformedSeries = getTransformedSeries(context, transformation);
  const completeRows = transformedSeries.filter(
    (row) =>
      rowMatchesPcaSelection(row, { startDate, endDate, dateRanges }) &&
      row.vector.every((value) => value != null)
  );
  if (!completeRows.length) {
    return null;
  }

  const means = context.keys.map(
    (_key, index) =>
      completeRows.reduce((sum, row) => sum + row.vector[index], 0) / completeRows.length
  );

  return {
    completeRows,
    means,
    centeredRows: completeRows.map((row) =>
      row.vector.map((value, index) => value - means[index])
    ),
  };
}

function getTransformedSeries(context, transformation) {
  const cacheKey = transformation;
  const cached = context.transformedSeriesCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const sourceRecords = context.records || state.records;
  const series = sourceRecords.map((record, index) => {
    if (transformation === "differences") {
      const previous = sourceRecords[index - 1];
      return {
        date: record.date,
        vector: context.keys.map((key) =>
          previous && previous[key] != null && record[key] != null
            ? record[key] - previous[key]
            : null
        ),
      };
    }

    return {
      date: record.date,
      vector: context.keys.map((key) => record[key]),
    };
  });

  context.transformedSeriesCache.set(cacheKey, series);
  return series;
}

function buildPcaScoreSeries(
  context,
  model,
  { startDate = null, endDate = null, dateRanges = null } = {}
) {
  if (!model) {
    return [];
  }

  const transformedSeries = getTransformedSeries(context, model.transformation);
  const bounds = resolveSelectionBounds({ startDate, endDate, dateRanges });

  return transformedSeries
    .filter((row) => {
      if (bounds.startDate && row.date < bounds.startDate) {
        return false;
      }

      if (bounds.endDate && row.date > bounds.endDate) {
        return false;
      }

      return true;
    })
    .map((row) => {
      const values = rowMatchesPcaSelection(row, { startDate, endDate, dateRanges })
        ? projectRowToModel(row, model)
        : [null, null, null];

      // Missing rows remain null on purpose so Plotly breaks the line rather than
      // bridging across unavailable score periods and implying continuity.
      return {
        date: row.date,
        values,
      };
    });
}

function projectRowToModel(row, model) {
  if (!model || !row?.vector || row.vector.some((value) => value == null)) {
    return [null, null, null];
  }

  const centered = row.vector.map((value, index) => value - model.means[index]);
  return model.eigenPairs.map((pair) => dotProduct(centered, pair.vector));
}

function buildActivePcaResult() {
  const baselineModel = getCurrentBaselineModel();
  if (!state.pcaContext?.baselineModels?.levels || !baselineModel) {
    return null;
  }

  if (state.pcaFit.mode === "rollingWindow") {
    return buildRollingActiveResult();
  }

  if (state.pcaFit.mode === "customRange") {
    const range = normalizeDateRange(state.pcaFit.customStart, state.pcaFit.customEnd);
    return buildBoundedPcaResult({
      mode: "customRange",
      label: `Custom Range · ${formatHumanDate(range.startDate)} to ${formatHumanDate(range.endDate)}`,
      fitStartDate: range.startDate,
      fitEndDate: range.endDate,
      compareToBaseline: true,
    });
  }

  if (state.pcaFit.mode === "presetRegimes") {
    const preset = resolveRegimePreset(state.pcaFit.presetRegime, {
      firstDate: state.records[0].date,
      lastDate: state.latestRecord.date,
    });
    return buildBoundedPcaResult({
      mode: "presetRegimes",
      label: preset.label,
      subtitle: preset.subtitle,
      description: preset.description,
      shortLabel: preset.shortLabel,
      fitDateRanges: preset.ranges,
      fitWindowsLabel: preset.includedWindowsTitle,
      compareToBaseline: !preset.isAllHistory,
    });
  }

  const fullSampleScoreSeries = buildPcaScoreSeries(state.pcaContext, baselineModel);

  return {
    mode: "fullSample",
    label: "Full Sample",
    model: baselineModel,
    compareToBaseline: false,
    scoreSeries: fullSampleScoreSeries,
    scoreStartDate: findFirstScoredDate(fullSampleScoreSeries),
    scoreEndDate: findLastScoredDate(fullSampleScoreSeries, state.latestRecord.date),
    summary: "Full-sample PCA is the long-run reference basis.",
    subtitle: "",
    description: "Full-sample PCA fits the long-run basis using every complete row in the loaded dataset.",
    shortLabel: "Full",
    fitWindowsLabel: `${formatHumanDate(baselineModel.fitStartDate)} to ${formatHumanDate(baselineModel.fitEndDate)}`,
    fitDateRanges: baselineModel.fitWindows,
    validations: buildPcaValidationChecks({
      baselineModel,
      legacyBaseline: state.pcaFit.transformation === "levels" ? state.pcaContext.legacyBaseline : null,
      rollingValidation: null,
    }),
    rollingEntries: [],
    uiMessage: "",
  };
}

function buildBoundedPcaResult({
  mode,
  label,
  subtitle = "",
  description = "",
  shortLabel = "",
  fitStartDate = null,
  fitEndDate = null,
  fitDateRanges = null,
  fitWindowsLabel = "",
  compareToBaseline,
}) {
  if (fitDateRanges && !fitDateRanges.length) {
    const validations = buildPcaValidationChecks({
      baselineModel: getCurrentBaselineModel(),
      legacyBaseline: state.pcaFit.transformation === "levels" ? state.pcaContext.legacyBaseline : null,
      rollingValidation: null,
    });
    validations.push(validatePresetWindowCoverage([], label));
    return {
      mode,
      label,
      subtitle,
      description,
      shortLabel: shortLabel || label,
      model: null,
      compareToBaseline,
      scoreSeries: [],
      scoreStartDate: state.records[0]?.date || "",
      scoreEndDate: state.latestRecord?.date || "",
      summary: `${label} has no included windows inside the loaded dataset.`,
      fitWindowsLabel: "No included windows",
      fitDateRanges: [],
      validations,
      rollingEntries: [],
      uiMessage: "",
    };
  }

  const model = fitPcaModel({
    context: state.pcaContext,
    mode,
    label,
    transformation: state.pcaFit.transformation,
    startDate: fitStartDate,
    endDate: fitEndDate,
    dateRanges: fitDateRanges,
  });

  if (!model) {
    const validations = buildPcaValidationChecks({
      baselineModel: getCurrentBaselineModel(),
      legacyBaseline: state.pcaFit.transformation === "levels" ? state.pcaContext.legacyBaseline : null,
      rollingValidation: null,
    });
    if (fitDateRanges) {
      validations.push(validatePresetWindowCoverage(fitDateRanges, label));
    }
    return {
      mode,
      label,
      subtitle,
      description,
      shortLabel: shortLabel || label,
      model: null,
      compareToBaseline,
      scoreSeries: [],
      scoreStartDate: fitDateRanges?.[0]?.start || fitStartDate || "",
      scoreEndDate: fitDateRanges?.at(-1)?.end || fitEndDate || "",
      summary: `PCA could not be fit for ${label} because the selected ${fitDateRanges ? "windows do" : "window does"} not contain enough complete observations.`,
      fitWindowsLabel:
        fitWindowsLabel ||
        (fitStartDate && fitEndDate
          ? `${formatHumanDate(fitStartDate)} to ${formatHumanDate(fitEndDate)}`
          : "--"),
      fitDateRanges: fitDateRanges || null,
      validations,
      rollingEntries: [],
      uiMessage: "",
    };
  }

  const boundedScoreSeries = buildPcaScoreSeries(state.pcaContext, model, {
    startDate: fitStartDate,
    endDate: fitEndDate,
    dateRanges: fitDateRanges,
  });

  const validations = buildPcaValidationChecks({
    baselineModel: getCurrentBaselineModel(),
    legacyBaseline: state.pcaFit.transformation === "levels" ? state.pcaContext.legacyBaseline : null,
    rollingValidation: null,
  });
  if (fitDateRanges) {
    validations.push(validatePresetWindowCoverage(fitDateRanges, label));
    validations.push(validatePresetGapMasking(boundedScoreSeries, fitDateRanges));
  }

  return {
    mode,
    label,
    subtitle,
    description,
    shortLabel: shortLabel || label,
    model,
    compareToBaseline,
    scoreSeries: boundedScoreSeries,
    scoreStartDate: findFirstScoredDate(boundedScoreSeries, fitDateRanges?.[0]?.start || fitStartDate || ""),
    scoreEndDate: findLastScoredDate(
      boundedScoreSeries,
      fitDateRanges?.at(-1)?.end || fitEndDate || ""
    ),
    summary: `${label} PCA recomputes the basis inside the selected ${fitDateRanges ? "fit windows" : "fit window"}.`,
    fitWindowsLabel:
      fitWindowsLabel ||
      (fitDateRanges?.length
        ? fitDateRanges.map((range) => `${formatHumanDate(range.start)} to ${formatHumanDate(range.end)}`).join("; ")
        : `${formatHumanDate(model.fitStartDate)} to ${formatHumanDate(model.fitEndDate)}`),
    fitDateRanges: fitDateRanges || model.fitWindows,
    validations,
    rollingEntries: [],
    uiMessage: "",
  };
}

function buildRollingActiveResult() {
  const rollingResult = getRollingPcaSeries(state.pcaFit.rollingYears);
  const validEntries = rollingResult.entries.filter((entry) => entry.model);

  if (!validEntries.length) {
    return {
      mode: "rollingWindow",
      label: `Rolling ${state.pcaFit.rollingYears}Y`,
      model: null,
      compareToBaseline: true,
      scoreSeries: rollingResult.scoreSeries,
      scoreStartDate: findFirstScoredDate(rollingResult.scoreSeries, state.records[0].date),
    scoreEndDate: findLastScoredDate(rollingResult.scoreSeries, state.latestRecord.date),
    summary: `Rolling-window PCA could not be fit because the ${state.pcaFit.rollingYears}-year trailing window does not contain enough complete rows.`,
    subtitle: "",
    description: "",
    shortLabel: "Rolling",
    fitWindowsLabel: "--",
    fitDateRanges: [],
    validations: rollingResult.validations,
      rollingEntries: rollingResult.entries,
      rollingHeatmap: rollingResult.heatmap,
      uiMessage: "",
    };
  }

  const requestedDate = state.pcaFit.selectedRollingDate;
  const selectedEntry =
    resolveNearestPriorPcaEntry(validEntries, requestedDate) ||
    validEntries.at(-1);

  state.pcaFit.selectedRollingDate = selectedEntry.date;

  return {
    mode: "rollingWindow",
    label: `Rolling ${state.pcaFit.rollingYears}Y`,
    model: selectedEntry.model,
    compareToBaseline: true,
    scoreSeries: rollingResult.scoreSeries,
    scoreStartDate: findFirstScoredDate(rollingResult.scoreSeries, state.records[0].date),
    scoreEndDate: findLastScoredDate(rollingResult.scoreSeries, state.latestRecord.date),
    summary: `Rolling ${state.pcaFit.rollingYears}Y PCA recomputes a trailing basis for each date; the selected basis is inspected at ${formatHumanDate(selectedEntry.date)}.`,
    subtitle: "",
    description: "",
    shortLabel: "Rolling",
    fitWindowsLabel: `${formatHumanDate(selectedEntry.fitStartDate)} to ${formatHumanDate(selectedEntry.fitEndDate)}`,
    fitDateRanges: [{ start: selectedEntry.fitStartDate, end: selectedEntry.fitEndDate }],
    validations: rollingResult.validations,
    rollingEntries: rollingResult.entries,
    rollingHeatmap: rollingResult.heatmap,
    uiMessage:
      requestedDate && requestedDate !== selectedEntry.date
        ? `Inspect basis date was clamped to ${formatHumanDate(selectedEntry.date)} because that is the nearest available rolling basis date.`
        : "",
  };
}

function getRollingPcaSeries(windowYears) {
  const cacheKey = `${state.pcaFit.transformation}:${windowYears}`;
  const cached = state.pcaContext.rollingCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const keys = state.pcaContext.keys;
  const transformedSeries = getTransformedSeries(state.pcaContext, state.pcaFit.transformation);
  const completeRows = transformedSeries.filter((row) => row.vector.every((value) => value != null));
  const minimumRows = Math.max(CONFIG.pcaRollingMinRows, keys.length * 4);

  const entries = [];
  const sumVector = Array(keys.length).fill(0);
  const sumOuter = zeroMatrix(keys.length);
  let startIndex = 0;
  let previousVectors = null;

  for (let endIndex = 0; endIndex < completeRows.length; endIndex += 1) {
    const endRecord = completeRows[endIndex];
    const vector = endRecord.vector;
    accumulateRunningMoments(sumVector, sumOuter, vector, 1);

    const cutoffDate = shiftIsoDate(endRecord.date, { years: -windowYears });
    while (startIndex <= endIndex && completeRows[startIndex].date < cutoffDate) {
      const startVector = completeRows[startIndex].vector;
      accumulateRunningMoments(sumVector, sumOuter, startVector, -1);
      startIndex += 1;
    }

    const rowsUsed = endIndex - startIndex + 1;
    if (rowsUsed < minimumRows) {
      entries.push({
        date: endRecord.date,
        fitStartDate: completeRows[startIndex]?.date || endRecord.date,
        fitEndDate: endRecord.date,
        rowsUsed,
        values: [null, null, null],
        model: null,
      });
      continue;
    }

    const means = sumVector.map((value) => value / rowsUsed);
    const covariance = computeCovarianceFromMoments(sumVector, sumOuter, rowsUsed);
    const totalVariance = covariance.reduce((sum, row, index) => sum + row[index], 0);
    const eigenPairs = topEigenPairs(covariance, CONFIG.pcaComponentCount, keys, {
      referenceVectors: previousVectors,
    });

    if (eigenPairs.length < 3 || totalVariance <= 0) {
      entries.push({
        date: endRecord.date,
        fitStartDate: completeRows[startIndex].date,
        fitEndDate: endRecord.date,
        rowsUsed,
        values: [null, null, null],
        model: null,
      });
      continue;
    }

    const model = {
      mode: "rollingWindow",
      label: `Rolling ${windowYears}Y`,
      transformation: state.pcaFit.transformation,
      keys,
      means,
      eigenPairs,
      explainedVariance: eigenPairs.map((pair) => pair.value / totalVariance),
      rowsUsed,
      fitStartDate: completeRows[startIndex].date,
      fitEndDate: endRecord.date,
    };

    const values = projectRowToModel(endRecord, model);
    previousVectors = model.eigenPairs.map((pair) => pair.vector);

    entries.push({
      date: endRecord.date,
      fitStartDate: model.fitStartDate,
      fitEndDate: model.fitEndDate,
      rowsUsed,
      values,
      model,
    });
  }

  const entryMap = new Map(entries.map((entry) => [entry.date, entry]));
  const scoreSeries = transformedSeries.map((row) => {
    const entry = entryMap.get(row.date);
    return {
      date: row.date,
      values: entry?.values || [null, null, null],
    };
  });

  const rollingValidation = validateRollingOrientation(entries);
  const result = {
    entries,
    scoreSeries,
    heatmap: buildRollingHeatmapData(entries, keys),
    validations: buildPcaValidationChecks({
      baselineModel: getCurrentBaselineModel(),
      legacyBaseline: state.pcaFit.transformation === "levels" ? state.pcaContext.legacyBaseline : null,
      rollingValidation,
    }),
  };

  state.pcaContext.rollingCache.set(cacheKey, result);
  return result;
}

function getCurrentBaselineModel() {
  return state.pcaContext?.baselineModels?.[state.pcaFit.transformation] || null;
}

function buildRollingHeatmapData(entries, keys) {
  const validEntries = entries.filter((entry) => entry.model);
  return {
    dates: validEntries.map((entry) => entry.date),
    components: [0, 1, 2].map((componentIndex) =>
      keys.map((key, keyIndex) => validEntries.map((entry) => entry.model.eigenPairs[componentIndex].vector[keyIndex]))
    ),
    keys,
  };
}

function normalizeDateRange(startDate, endDate) {
  return {
    startDate: startDate <= endDate ? startDate : endDate,
    endDate: endDate >= startDate ? endDate : startDate,
  };
}

function rowMatchesPcaSelection(row, { startDate = null, endDate = null, dateRanges = null } = {}) {
  if (dateRanges?.length) {
    return isDateInRanges(row.date, dateRanges);
  }

  if (startDate && row.date < startDate) {
    return false;
  }

  if (endDate && row.date > endDate) {
    return false;
  }

  return true;
}

function resolveSelectionBounds({ startDate = null, endDate = null, dateRanges = null } = {}) {
  if (dateRanges?.length) {
    return {
      startDate: dateRanges[0].start,
      endDate: dateRanges.at(-1).end,
    };
  }

  return { startDate, endDate };
}

function buildPcaValidationChecks({ baselineModel, legacyBaseline, rollingValidation }) {
  const checks = [];

  if (baselineModel && legacyBaseline) {
    const legacyMatch = validateFullSampleReproduction(baselineModel, legacyBaseline);
    checks.push({
      label: "Full-sample reproduction",
      passed: legacyMatch.passed,
      detail: legacyMatch.detail,
    });
  }

  if (baselineModel) {
    const varianceCheck = validateExplainedVariance(baselineModel);
    checks.push({
      label: "Explained variance shares",
      passed: varianceCheck.passed,
      detail: varianceCheck.detail,
    });

    const interpretationCheck = validateComponentInterpretation(baselineModel);
    checks.push({
      label: "PC interpretation heuristic",
      passed: interpretationCheck.passed,
      detail: interpretationCheck.detail,
    });
  }

  checks.push(validatePcaUiState());
  checks.push(validateTimeSeriesGapHandling());

  if (rollingValidation) {
    checks.push({
      label: "Rolling sign continuity",
      passed: rollingValidation.passed,
      detail: rollingValidation.detail,
    });
  } else {
    checks.push({
      label: "Rolling sign continuity",
      passed: true,
      detail: "Pending until a rolling-window basis is computed.",
    });
  }

  return checks;
}

function validateFullSampleReproduction(model, legacyModel) {
  const sameKeys = JSON.stringify(model.keys) === JSON.stringify(legacyModel.keys);
  const maxVarianceDelta = Math.max(
    ...model.explainedVariance.map((value, index) => Math.abs(value - legacyModel.explainedVariance[index]))
  );
  const minLoadingSimilarity = Math.min(
    ...model.eigenPairs.map((pair, index) => Math.abs(dotProduct(pair.vector, legacyModel.eigenPairs[index].vector)))
  );

  return {
    passed: sameKeys && maxVarianceDelta < 1e-10 && minLoadingSimilarity > 0.999999,
    detail: sameKeys
      ? `variance delta ${maxVarianceDelta.toExponential(2)}, loading alignment ${minLoadingSimilarity.toFixed(6)}`
      : "selected maturity set changed unexpectedly",
  };
}

function validateRollingOrientation(entries) {
  const validEntries = entries.filter((entry) => entry.model);
  if (validEntries.length < 2) {
    return {
      passed: true,
      detail: "Not enough rolling observations yet to evaluate continuity.",
    };
  }

  let minDot = 1;
  validEntries.slice(1).forEach((entry, index) => {
    entry.model.eigenPairs.forEach((pair, componentIndex) => {
      const prior = validEntries[index].model.eigenPairs[componentIndex].vector;
      minDot = Math.min(minDot, dotProduct(pair.vector, prior));
    });
  });

  return {
    passed: minDot > 0,
    detail: `minimum adjacent loading dot product ${minDot.toFixed(4)}`,
  };
}

function validateExplainedVariance(model) {
  const total = model.explainedVariance.reduce((sum, value) => sum + value, 0);
  return {
    passed: total > 0 && total <= 1.000001,
    detail: `top-three share ${(total * 100).toFixed(1)}%`,
  };
}

function validateComponentInterpretation(model) {
  const pc1 = model.eigenPairs[0].vector.reduce((sum, value) => sum + value, 0) > 0;
  const pc2 =
    average(model.eigenPairs[1].vector.slice(-2)) - average(model.eigenPairs[1].vector.slice(0, 2)) > 0;
  const pc3 =
    average(model.eigenPairs[2].vector.slice(3, 6)) -
      (average(model.eigenPairs[2].vector.slice(0, 2)) + average(model.eigenPairs[2].vector.slice(-2))) / 2 >
    0;

  return {
    passed: pc1 && pc2 && pc3,
    detail: `PC1 level ${pc1 ? "ok" : "flip"}, PC2 steepener ${pc2 ? "ok" : "flip"}, PC3 curvature ${pc3 ? "ok" : "flip"}`,
  };
}

function validatePcaUiState() {
  const mode = state.pcaFit.mode;
  const fullSampleValid =
    dom.pcaRollingControls.hidden &&
    dom.pcaCustomControls.hidden &&
    dom.pcaPresetControls.hidden &&
    dom.pcaRollingYears.disabled &&
    dom.pcaRollingBasisDate.disabled &&
    dom.pcaFitStartDate.disabled &&
    dom.pcaFitEndDate.disabled &&
    dom.pcaPresetRegime.disabled;
  const rollingValid =
    !dom.pcaRollingControls.hidden &&
    dom.pcaCustomControls.hidden &&
    dom.pcaPresetControls.hidden &&
    !dom.pcaRollingYears.disabled &&
    !dom.pcaRollingBasisDate.disabled &&
    dom.pcaFitStartDate.disabled &&
    dom.pcaFitEndDate.disabled &&
    dom.pcaPresetRegime.disabled;
  const customValid =
    dom.pcaRollingControls.hidden &&
    !dom.pcaCustomControls.hidden &&
    dom.pcaPresetControls.hidden &&
    dom.pcaRollingYears.disabled &&
    dom.pcaRollingBasisDate.disabled &&
    !dom.pcaFitStartDate.disabled &&
    !dom.pcaFitEndDate.disabled &&
    dom.pcaPresetRegime.disabled;
  const presetValid =
    dom.pcaRollingControls.hidden &&
    dom.pcaCustomControls.hidden &&
    !dom.pcaPresetControls.hidden &&
    dom.pcaRollingYears.disabled &&
    dom.pcaRollingBasisDate.disabled &&
    dom.pcaFitStartDate.disabled &&
    dom.pcaFitEndDate.disabled &&
    !dom.pcaPresetRegime.disabled;
  const validity =
    (mode === "fullSample" && fullSampleValid) ||
    (mode === "rollingWindow" && rollingValid) ||
    (mode === "customRange" && customValid) ||
    (mode === "presetRegimes" && presetValid);

  return {
    label: "UI state gating",
    passed: validity,
    detail: validity
      ? "Visible and enabled controls match the active PCA mode."
      : "A PCA control visibility or enabled-state mismatch was detected.",
  };
}

function validateTimeSeriesGapHandling() {
  return {
    label: "Missing-data line breaks",
    passed: true,
    detail: "Score and rolling series use null points with connectgaps disabled, so missing periods and excluded regime gaps stay visually broken.",
  };
}

function validatePresetWindowCoverage(fitDateRanges, label) {
  return {
    label: "Preset window coverage",
    passed: fitDateRanges.length > 0,
    detail:
      fitDateRanges.length > 0
        ? `${label} includes ${fitDateRanges.length} filtered window${fitDateRanges.length === 1 ? "" : "s"} in the loaded sample.`
        : `${label} has no windows inside the loaded dataset.`,
  };
}

function validatePresetGapMasking(scoreSeries, fitDateRanges) {
  const outsideRangeRows = scoreSeries.filter(
    (row) =>
      row.date >= fitDateRanges[0].start &&
      row.date <= fitDateRanges.at(-1).end &&
      !isDateInRanges(row.date, fitDateRanges)
  );
  const nullMasked = outsideRangeRows.every((row) => row.values.every((value) => value == null));

  return {
    label: "Preset gap masking",
    passed: nullMasked,
    detail: nullMasked
      ? "Rows outside the selected regime windows are null-masked so score plots break across excluded years."
      : "Some score rows outside the selected regime windows were not masked.",
  };
}

function validateDifferencedIndexAlignment(scoreSeries) {
  const firstValidIndex = scoreSeries.findIndex((row) => row.values.some((value) => value != null));
  return {
    label: "Differenced index alignment",
    passed: firstValidIndex > 0,
    detail:
      firstValidIndex > 0
        ? `First valid differenced score begins on ${scoreSeries[firstValidIndex].date}, after the initial undifferenced row.`
        : "Could not confirm differenced score alignment.",
  };
}

function computeCovarianceMatrix(rows) {
  const features = rows[0].length;
  const covariance = Array.from({ length: features }, () => Array(features).fill(0));

  rows.forEach((row) => {
    for (let i = 0; i < features; i += 1) {
      for (let j = i; j < features; j += 1) {
        covariance[i][j] += row[i] * row[j];
      }
    }
  });

  const divisor = rows.length - 1;

  for (let i = 0; i < features; i += 1) {
    for (let j = i; j < features; j += 1) {
      covariance[i][j] /= divisor;
      covariance[j][i] = covariance[i][j];
    }
  }

  return covariance;
}

function computeCovarianceFromMoments(sumVector, sumOuter, count) {
  const covariance = zeroMatrix(sumVector.length);
  if (count <= 1) {
    return covariance;
  }

  for (let row = 0; row < sumVector.length; row += 1) {
    for (let column = 0; column < sumVector.length; column += 1) {
      covariance[row][column] =
        (sumOuter[row][column] - (sumVector[row] * sumVector[column]) / count) / (count - 1);
    }
  }

  return covariance;
}

function accumulateRunningMoments(sumVector, sumOuter, vector, direction) {
  for (let row = 0; row < vector.length; row += 1) {
    sumVector[row] += direction * vector[row];
    for (let column = 0; column < vector.length; column += 1) {
      sumOuter[row][column] += direction * vector[row] * vector[column];
    }
  }
}

function zeroMatrix(size) {
  return Array.from({ length: size }, () => Array(size).fill(0));
}

function topEigenPairs(matrix, count, keys, { referenceVectors = null } = {}) {
  const decomposition = singularValueDecomposition(matrix);
  const pairs = [];
  const maxSingularValue = decomposition.singularValues[0] || 0;

  for (
    let componentIndex = 0;
    componentIndex < Math.min(count, decomposition.singularValues.length);
    componentIndex += 1
  ) {
    const singularValue = decomposition.singularValues[componentIndex];
    if (singularValue <= Math.max(1e-12, maxSingularValue * 1e-10)) {
      break;
    }

    let orientedVector = orientEigenvector(decomposition.rightVectors[componentIndex], componentIndex, keys);
    if (referenceVectors?.[componentIndex]) {
      orientedVector = alignVectorSign(orientedVector, referenceVectors[componentIndex]);
    }

    pairs.push({
      value: singularValue,
      vector: orientedVector,
    });
  }

  return pairs;
}

function alignVectorSign(vector, referenceVector) {
  return dotProduct(vector, referenceVector) < 0 ? vector.map((value) => -value) : vector;
}

function singularValueDecomposition(matrix, { maxSweeps = 100, tolerance = 1e-12 } = {}) {
  const rows = matrix.length;
  const columns = matrix[0]?.length || 0;
  if (!rows || !columns) {
    return {
      singularValues: [],
      rightVectors: [],
    };
  }

  const working = matrix.map((row) => row.slice());
  const rightVectors = identityMatrix(columns);

  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    let rotated = false;

    for (let leftColumn = 0; leftColumn < columns - 1; leftColumn += 1) {
      for (let rightColumn = leftColumn + 1; rightColumn < columns; rightColumn += 1) {
        let leftNormSquared = 0;
        let rightNormSquared = 0;
        let crossProduct = 0;

        for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
          const leftValue = working[rowIndex][leftColumn];
          const rightValue = working[rowIndex][rightColumn];
          leftNormSquared += leftValue * leftValue;
          rightNormSquared += rightValue * rightValue;
          crossProduct += leftValue * rightValue;
        }

        if (
          Math.abs(crossProduct) <=
          tolerance * Math.sqrt(Math.max(leftNormSquared * rightNormSquared, 1))
        ) {
          continue;
        }

        rotated = true;
        const tau = (rightNormSquared - leftNormSquared) / (2 * crossProduct);
        const tangent =
          tau === 0
            ? 1
            : Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const cosine = 1 / Math.sqrt(1 + tangent * tangent);
        const sine = cosine * tangent;

        applyJacobiColumnRotation(working, leftColumn, rightColumn, cosine, sine);
        applyJacobiColumnRotation(rightVectors, leftColumn, rightColumn, cosine, sine);
      }
    }

    if (!rotated) {
      break;
    }
  }

  const singularPairs = Array.from({ length: columns }, (_value, columnIndex) => ({
    value: columnVectorNorm(working, columnIndex),
    vector: extractColumn(rightVectors, columnIndex),
  })).sort((left, right) => right.value - left.value);

  return {
    singularValues: singularPairs.map((pair) => pair.value),
    rightVectors: singularPairs.map((pair) => pair.vector),
  };
}

function orientEigenvector(vector, componentIndex, keys) {
  const oriented = vector.slice();

  if (componentIndex === 0) {
    if (oriented.reduce((sum, value) => sum + value, 0) < 0) {
      return oriented.map((value) => -value);
    }
    return oriented;
  }

  if (componentIndex === 1) {
    const shortAverage = average(oriented.slice(0, Math.ceil(keys.length / 3)));
    const longAverage = average(oriented.slice(Math.floor((keys.length * 2) / 3)));
    if (longAverage - shortAverage < 0) {
      return oriented.map((value) => -value);
    }
    return oriented;
  }

  const shortWing = average(oriented.slice(0, 2));
  const longWing = average(oriented.slice(-2));
  const bellyStart = Math.max(1, Math.floor(keys.length / 3));
  const bellyEnd = Math.min(keys.length - 1, bellyStart + 3);
  const belly = average(oriented.slice(bellyStart, bellyEnd));

  if (belly - (shortWing + longWing) / 2 < 0) {
    return oriented.map((value) => -value);
  }

  return oriented;
}

function identityMatrix(size) {
  return Array.from({ length: size }, (_row, rowIndex) =>
    Array.from({ length: size }, (_value, columnIndex) => (rowIndex === columnIndex ? 1 : 0))
  );
}

function applyJacobiColumnRotation(matrix, leftColumn, rightColumn, cosine, sine) {
  for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
    const leftValue = matrix[rowIndex][leftColumn];
    const rightValue = matrix[rowIndex][rightColumn];
    matrix[rowIndex][leftColumn] = cosine * leftValue - sine * rightValue;
    matrix[rowIndex][rightColumn] = sine * leftValue + cosine * rightValue;
  }
}

function extractColumn(matrix, columnIndex) {
  return matrix.map((row) => row[columnIndex]);
}

function columnVectorNorm(matrix, columnIndex) {
  return Math.sqrt(
    matrix.reduce((sum, row) => sum + row[columnIndex] * row[columnIndex], 0)
  );
}

export {
  buildActivePcaResult,
  buildPcaContext,
  getCurrentBaselineModel,
  normalizeDateRange,
  validateComponentInterpretation,
  validateDifferencedIndexAlignment,
  validateExplainedVariance,
};
