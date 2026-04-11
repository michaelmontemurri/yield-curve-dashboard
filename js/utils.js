import { MATURITY_DEFS } from "./core.js";

// === Utilities ===
async function fetchText(url) {
  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.text();
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampIsoDate(date, minDate, maxDate) {
  if (!date) {
    return minDate;
  }

  if (date < minDate) {
    return minDate;
  }

  if (date > maxDate) {
    return maxDate;
  }

  return date;
}

function findFirstScoredDate(scoreSeries, fallback = "") {
  const first = scoreSeries.find((row) => row.values.some((value) => value != null));
  return first?.date || fallback;
}

function findLastScoredDate(scoreSeries, fallback = "") {
  for (let index = scoreSeries.length - 1; index >= 0; index -= 1) {
    if (scoreSeries[index].values.some((value) => value != null)) {
      return scoreSeries[index].date;
    }
  }

  return fallback;
}

function shiftIsoDate(date, { days = 0, months = 0, years = 0 }) {
  const [year, month, day] = date.split("-").map(Number);

  let nextYear = year + years;
  let nextMonth = month + months;
  while (nextMonth > 12) {
    nextMonth -= 12;
    nextYear += 1;
  }
  while (nextMonth < 1) {
    nextMonth += 12;
    nextYear -= 1;
  }

  const maxDay = daysInMonth(nextYear, nextMonth);
  const clampedDay = Math.min(day, maxDay);
  const shifted = new Date(Date.UTC(nextYear, nextMonth - 1, clampedDay + days));

  return dateToIso(shifted);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateToIso(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function isoDateToTimestamp(date) {
  return Date.parse(`${date}T00:00:00Z`);
}

function formatHumanDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatBasisPoints(value) {
  const rounded = value.toFixed(1);
  return `${value >= 0 ? "+" : ""}${rounded} bp`;
}

function transformationLabel(transformation) {
  return transformation === "differences" ? "Daily Differences" : "Levels";
}

function shortPcaLabel(label) {
  return label
    .replace("Custom Range · ", "Custom · ")
    .replace("All History", "All")
    .replace("Pre-2008", "Pre-08")
    .replace("2009-2019", "2009-19")
    .replace("Post-2020", "Post-20");
}

function maturityMonths(key) {
  return MATURITY_DEFS.find((definition) => definition.key === key)?.months ?? 0;
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function paddedRange(values, padding) {
  const numericValues = values.filter((value) => Number.isFinite(value));
  const min = Math.min(...numericValues);
  const max = Math.max(...numericValues);
  return [min - padding, max + padding];
}

function normalizeVector(vector) {
  const norm = vectorNorm(vector);
  if (!norm) {
    return vector.slice();
  }
  return vector.map((value) => value / norm);
}

function vectorNorm(vector) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function vectorDistance(left, right) {
  return Math.sqrt(
    left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0)
  );
}

function multiplyMatrixVector(matrix, vector) {
  return matrix.map((row) => dotProduct(row, vector));
}

function dotProduct(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
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

function dedupe(values) {
  return Array.from(new Set(values));
}

export {
  fetchText,
  clampNumber,
  clampIsoDate,
  findFirstScoredDate,
  findLastScoredDate,
  shiftIsoDate,
  daysInMonth,
  dateToIso,
  isoDateToTimestamp,
  formatHumanDate,
  formatBasisPoints,
  transformationLabel,
  shortPcaLabel,
  maturityMonths,
  average,
  paddedRange,
  normalizeVector,
  vectorNorm,
  vectorDistance,
  multiplyMatrixVector,
  dotProduct,
  downloadTextFile,
  dedupe,
};
