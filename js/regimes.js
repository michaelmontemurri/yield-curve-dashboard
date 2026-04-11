const REGIME_PRESET_DEFINITIONS = [
  {
    id: "tightening_cycles",
    environmentClassification: "Tightening Cycles",
    label: "Tightening Cycles",
    shortLabel: "Tightening",
    subtitle: "Bear Flattener",
    description: "Hiking phases where front-end yields tend to rise faster than the long end.",
    ranges: [
      { start: "2004-01-01", end: "2006-06-30" },
      { start: "2016-01-01", end: "2018-12-31" },
      { start: "2022-03-01", end: "2023-07-31" },
    ],
  },
  {
    id: "crisis_easing",
    environmentClassification: "Crisis Easing",
    label: "Crisis Easing",
    shortLabel: "Crisis",
    subtitle: "Bull Steepener",
    description: "Aggressive easing episodes associated with growth scares and crisis response.",
    ranges: [
      { start: "2000-01-01", end: "2003-12-31" },
      { start: "2007-09-01", end: "2008-12-31" },
    ],
  },
  {
    id: "zlb_qe",
    environmentClassification: "ZLB / QE",
    label: "ZLB / QE",
    shortLabel: "ZLB/QE",
    subtitle: "The Zero Bound",
    description: "Near-zero policy-rate periods shaped by forward guidance and balance-sheet policy.",
    ranges: [
      { start: "2009-01-01", end: "2015-12-31" },
      { start: "2020-03-01", end: "2021-12-31" },
    ],
  },
  {
    id: "restrictive_plateaus",
    environmentClassification: "Restrictive Plateaus",
    label: "Restrictive Plateaus",
    shortLabel: "Plateaus",
    subtitle: "Higher for Longer",
    description: "Late-cycle holding patterns where policy stays tight after the main hiking leg.",
    ranges: [
      { start: "2006-07-01", end: "2007-08-31" },
      { start: "2023-08-01", end: "2024-06-30" },
    ],
  },
  {
    id: "transitional_anomalous",
    environmentClassification: "Transitional / Anomalous",
    label: "Transitional / Anomalous",
    openEnded: true,
    shortLabel: "Transition",
    subtitle: "Goldilocks / Transition",
    description: "Mixed handoff periods that do not sit cleanly inside the core hiking, easing, or ZLB buckets.",
    ranges: [
      { start: "2019-01-01", end: "2019-12-31" },
      { start: "2024-10-01", end: "latest", displayLabel: "Late 2024–Present", openEnded: true },
    ],
  },
  {
    id: "allHistory",
    environmentClassification: "All History",
    label: "All History",
    shortLabel: "All",
    subtitle: "",
    description: "Use the full available history in the loaded dataset.",
    useAllHistory: true,
    ranges: [],
  },
];

function getRegimePresetDefinitions() {
  return REGIME_PRESET_DEFINITIONS.slice();
}

function getRegimePresetDefinition(presetId) {
  return (
    REGIME_PRESET_DEFINITIONS.find((preset) => preset.id === presetId) ||
    REGIME_PRESET_DEFINITIONS.find((preset) => preset.id === "allHistory")
  );
}

function getRegimeOptionLabel(preset) {
  return preset.subtitle ? `${preset.label} · ${preset.subtitle}` : preset.label;
}

function resolveRegimePreset(presetId, { firstDate, lastDate }) {
  const preset = getRegimePresetDefinition(presetId);
  const ranges = preset.useAllHistory
    ? [{ start: firstDate, end: lastDate }]
    : mergeDateRanges(
        preset.ranges
          .map((range) => clampPresetRange(range, firstDate, lastDate))
          .filter(Boolean)
      );

  return {
    ...preset,
    ranges,
    isAllHistory: preset.useAllHistory || false,
    hasAnyRanges: ranges.length > 0,
    includedWindowsLabel: formatRegimeRanges(ranges),
    includedWindowsTitle: formatRegimeRanges(ranges, { separator: "; " }),
    helperText:
      ranges.length > 0
        ? `Included windows: ${formatRegimeRanges(ranges)}`
        : "Included windows: none inside the loaded sample.",
  };
}

function clampPresetRange(range, firstDate, lastDate) {
  const resolvedEnd = range.end === "latest" ? lastDate : range.end;
  if (resolvedEnd < firstDate || range.start > lastDate) {
    return null;
  }

  const start = range.start < firstDate ? firstDate : range.start;
  const end = resolvedEnd > lastDate ? lastDate : resolvedEnd;
  if (start > end) {
    return null;
  }

  return {
    ...range,
    start,
    end,
  };
}

function mergeDateRanges(ranges) {
  if (!ranges.length) {
    return [];
  }

  const sorted = ranges
    .map((range) => ({ ...range }))
    .sort((left, right) => left.start.localeCompare(right.start));
  const merged = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const prior = merged.at(-1);
    if (current.start <= prior.end) {
      prior.end = current.end > prior.end ? current.end : prior.end;
      prior.displayLabel = prior.displayLabel || current.displayLabel;
      continue;
    }

    merged.push(current);
  }

  return merged;
}

function isDateInRanges(date, ranges) {
  return ranges.some((range) => date >= range.start && date <= range.end);
}

function formatRegimeRanges(ranges, { separator = ", " } = {}) {
  if (!ranges.length) {
    return "No included windows";
  }

  return ranges.map((range) => formatRegimeRange(range)).join(separator);
}

function formatRegimeRange(range) {
  if (range.displayLabel) {
    return range.displayLabel;
  }

  const startYear = range.start.slice(0, 4);
  const endYear = range.end.slice(0, 4);

  if (startYear === endYear) {
    return startYear;
  }

  if (range.end === "latest") {
    return `${startYear}–Present`;
  }

  return `${startYear}–${endYear}`;
}

export {
  getRegimeOptionLabel,
  getRegimePresetDefinition,
  getRegimePresetDefinitions,
  isDateInRanges,
  resolveRegimePreset,
};
