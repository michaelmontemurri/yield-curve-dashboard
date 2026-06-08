const DEFAULT_SAMPLE_START = "2006-02-09";
const DEFAULT_MIN_OBSERVATIONS = 30;

const spreadSeriesCache = new WeakMap();
const dailyStatsCache = new WeakMap();

function computeSpreadSeries(spread, records = [], { basisPoints = true } = {}) {
  if (!Array.isArray(records) || !records.length || !spread) {
    return [];
  }

  const cacheKey = getSpreadCacheKey(spread, { basisPoints });
  let recordCache = spreadSeriesCache.get(records);
  if (!recordCache) {
    recordCache = new Map();
    spreadSeriesCache.set(records, recordCache);
  }

  if (recordCache.has(cacheKey)) {
    return recordCache.get(cacheKey);
  }

  const multiplier = basisPoints ? 100 : 1;
  const series = records
    .slice()
    .sort((left, right) => recordTimestamp(left) - recordTimestamp(right))
    .map((record) => {
      const value = computeSpreadValue(spread, record);
      if (!record?.date || !Number.isFinite(value)) {
        return null;
      }

      return {
        date: record.date,
        value: value * multiplier,
      };
    })
    .filter(Boolean);

  recordCache.set(cacheKey, series);
  return series;
}

function computeDailyChangeStats(
  series,
  { sampleStart = DEFAULT_SAMPLE_START, minObservations = DEFAULT_MIN_OBSERVATIONS } = {}
) {
  if (!Array.isArray(series) || !series.length) {
    return buildEmptyDailyChangeStats("no_data", minObservations);
  }

  const cacheKey = `${sampleStart || "all"}:${minObservations}`;
  let seriesCache = dailyStatsCache.get(series);
  if (!seriesCache) {
    seriesCache = new Map();
    dailyStatsCache.set(series, seriesCache);
  }

  if (seriesCache.has(cacheKey)) {
    return seriesCache.get(cacheKey);
  }

  const sampleSeries = series
    .filter(
      (point) =>
        point?.date &&
        Number.isFinite(point.value) &&
        (!sampleStart || point.date >= sampleStart)
    )
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date));

  const dailyChanges = [];
  for (let index = 1; index < sampleSeries.length; index += 1) {
    dailyChanges.push({
      date: sampleSeries[index].date,
      previousDate: sampleSeries[index - 1].date,
      value: sampleSeries[index].value - sampleSeries[index - 1].value,
    });
  }

  const values = dailyChanges.map((point) => point.value).filter(Number.isFinite);
  const meanChange = values.length ? mean(values) : null;
  const meanAbsChange = values.length ? mean(values.map((value) => Math.abs(value))) : null;
  const stdChange = values.length > 1 ? sampleStandardDeviation(values, meanChange) : null;
  const currentChange = dailyChanges.at(-1)?.value ?? null;
  const zScore =
    Number.isFinite(currentChange) && Number.isFinite(meanChange) && Number.isFinite(stdChange) && stdChange > 0
      ? (currentChange - meanChange) / stdChange
      : null;
  const empiricalPercentile = computeEmpiricalPercentile(values, currentChange);
  const normalizedChanges =
    Number.isFinite(meanChange) && Number.isFinite(stdChange) && stdChange > 0
      ? values.map((value) => (value - meanChange) / stdChange)
      : [];

  const stats = {
    status: resolveStatsStatus({
      sampleSeries,
      values,
      stdChange,
      minObservations,
    }),
    sampleSeries,
    dailyChanges,
    normalizedChanges,
    meanChange,
    meanAbsChange,
    stdChange,
    currentChange,
    zScore,
    empiricalPercentile,
    sampleStartDate: sampleSeries[0]?.date ?? null,
    sampleEndDate: sampleSeries.at(-1)?.date ?? null,
    observations: values.length,
    minObservations,
  };

  seriesCache.set(cacheKey, stats);
  return stats;
}

function computeEmpiricalPercentile(values, currentChange) {
  if (!Number.isFinite(currentChange)) {
    return null;
  }

  const numericValues = (Array.isArray(values) ? values : []).filter(Number.isFinite);
  if (!numericValues.length) {
    return null;
  }

  const lessThanOrEqualCount = numericValues.reduce(
    (count, value) => count + (value <= currentChange ? 1 : 0),
    0
  );

  return (lessThanOrEqualCount / numericValues.length) * 100;
}

function getMoveSeverityLabel(zScore) {
  if (!Number.isFinite(zScore)) {
    return "n/a";
  }

  const absoluteZ = Math.abs(zScore);
  if (absoluteZ < 1) {
    return "Normal";
  }
  if (absoluteZ < 1.5) {
    return "Notable";
  }
  if (absoluteZ < 2) {
    return "Significant";
  }
  if (absoluteZ < 3) {
    return "Large";
  }
  return "Extreme";
}

function getDirectionalInterpretation(spread, currentChange, severityLabel) {
  if (!Number.isFinite(currentChange)) {
    return "Insufficient history";
  }

  if (currentChange === 0) {
    return severityLabel === "n/a" ? "No move" : `${severityLabel} unchanged`;
  }

  const direction =
    spread?.type === "butterfly"
      ? currentChange > 0
        ? "belly cheapening"
        : "belly richening"
      : currentChange > 0
        ? "steepening"
        : "flattening";

  return severityLabel === "n/a" ? direction : `${severityLabel} ${direction}`;
}

function computeSpreadValue(spread, record) {
  if (spread?.type === "butterfly") {
    const front = record?.[spread.front];
    const belly = record?.[spread.belly];
    const back = record?.[spread.back];

    if (!Number.isFinite(front) || !Number.isFinite(belly) || !Number.isFinite(back)) {
      return null;
    }

    return 2 * belly - front - back;
  }

  const left = record?.[spread.left];
  const right = record?.[spread.right];
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return null;
  }

  return left - right;
}

function getSpreadCacheKey(spread, { basisPoints }) {
  if (spread?.type === "butterfly") {
    return `butterfly:${spread.front}:${spread.belly}:${spread.back}:${basisPoints ? "bp" : "pct"}`;
  }

  return `spread:${spread?.left || ""}:${spread?.right || ""}:${basisPoints ? "bp" : "pct"}`;
}

function recordTimestamp(record) {
  if (Number.isFinite(record?.timestamp)) {
    return record.timestamp;
  }

  const parsed = Date.parse(`${record?.date || ""}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveStatsStatus({ sampleSeries, values, stdChange, minObservations }) {
  if (sampleSeries.length < 2 || values.length < minObservations) {
    return "insufficient_history";
  }

  if (!Number.isFinite(stdChange) || stdChange <= 0) {
    return "zero_volatility";
  }

  return "ready";
}

function buildEmptyDailyChangeStats(status, minObservations) {
  return {
    status,
    sampleSeries: [],
    dailyChanges: [],
    normalizedChanges: [],
    meanChange: null,
    meanAbsChange: null,
    stdChange: null,
    currentChange: null,
    zScore: null,
    empiricalPercentile: null,
    sampleStartDate: null,
    sampleEndDate: null,
    observations: 0,
    minObservations,
  };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardDeviation(values, average) {
  if (values.length < 2) {
    return null;
  }

  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export {
  DEFAULT_SAMPLE_START,
  computeSpreadSeries,
  computeDailyChangeStats,
  computeEmpiricalPercentile,
  getMoveSeverityLabel,
  getDirectionalInterpretation,
};
