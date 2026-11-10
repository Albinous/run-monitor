import type { CleanSeries } from './clean';
import { bucketEdge, emaSmooth, m4Indices } from './downsample';
import { formatTick } from './format';
import {
  type BlockIndex, type Validity, buildBlockIndex, computeInvalid, computeSegments,
  lowerBound, rangeExtent, rangeMinPositive, upperBound,
} from './index';
import type { Metric, ScaleKind } from './types';

/** Everything derived once per (series, metric). Built lazily; the 1M run pays ~O(n) once. */
export interface MetricPrep {
  values: Float64Array;
  index: BlockIndex;
  /** Drawable runs as flat [start, end, start, end, ...], for linear ('finite') and log ('positive') axes. */
  segments: Record<Validity, Int32Array>;
  /** Indices of points that can't be drawn on that axis (NaN, ±Inf, and ≤ 0 on log). */
  invalid: Record<Validity, Int32Array>;
  smoothCache: Map<string, { values: Float64Array; index: BlockIndex }>;
}

export function prepareMetric(series: CleanSeries, metric: Metric): MetricPrep {
  const values = series.values[metric];
  const gap = series.report.gapThreshold;
  return {
    values,
    index: buildBlockIndex(values),
    segments: {
      finite: computeSegments(series.step, values, gap, 'finite'),
      positive: computeSegments(series.step, values, gap, 'positive'),
    },
    invalid: { finite: computeInvalid(values, 'finite'), positive: computeInvalid(values, 'positive') },
    smoothCache: new Map(),
  };
}

/** Maps data values (domain) to pixels (range) and back. */
export interface Scale {
  kind: ScaleKind;
  domainMin: number;
  domainMax: number;
  /** Pixel for domainMin. For the y axis this is the bottom of the plot, so rangeStart > rangeEnd. */
  rangeStart: number;
  rangeEnd: number;
  map(value: number): number;
  invert(pixel: number): number;
}

export function makeScale(kind: ScaleKind, domainMin: number, domainMax: number, rangeStart: number, rangeEnd: number): Scale {
  const pixels = rangeEnd - rangeStart;
  if (kind === 'log') {
    const logMin = Math.log10(domainMin);
    const logMax = Math.log10(domainMax);
    return {
      kind, domainMin, domainMax, rangeStart, rangeEnd,
      map: (value) => rangeStart + ((Math.log10(value) - logMin) / (logMax - logMin)) * pixels,
      invert: (pixel) => 10 ** (logMin + ((pixel - rangeStart) / pixels) * (logMax - logMin)),
    };
  }
  return {
    kind, domainMin, domainMax, rangeStart, rangeEnd,
    map: (value) => rangeStart + ((value - domainMin) / (domainMax - domainMin)) * pixels,
    invert: (pixel) => domainMin + ((pixel - rangeStart) / pixels) * (domainMax - domainMin),
  };
}

/** A "round" tick spacing (1, 2 or 5 × 10ⁿ) that gives about `count` ticks over `span`. */
export function niceStep(span: number, count: number): number {
  const rough = span / Math.max(1, count);
  const exponent = Math.floor(Math.log10(rough));
  const fraction = rough / 10 ** exponent; // between 1 and 10
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * 10 ** exponent;
}

export function linearTicks(min: number, max: number, count: number, minStep = 0): { values: number[]; step: number } {
  if (!(max > min)) return { values: [min], step: 1 };
  const tickStep = Math.max(minStep, niceStep(max - min, count));
  const values: number[] = [];
  for (let k = Math.ceil(min / tickStep - 1e-9); k <= Math.floor(max / tickStep + 1e-9); k++) {
    values.push(Number((k * tickStep).toPrecision(12))); // toPrecision removes float noise like 0.30000000000000004
  }
  return { values, step: tickStep };
}

export function logTicks(min: number, max: number): number[] {
  const powers: number[] = [];
  for (let exponent = Math.ceil(Math.log10(min) - 1e-9); exponent <= Math.floor(Math.log10(max) + 1e-9); exponent++) {
    powers.push(Number((10 ** exponent).toPrecision(12)));
  }
  if (powers.length >= 2) return powers;
  // less than two powers of 10 in range: also use 2× and 5×
  const withMultiples: number[] = [];
  for (let exponent = Math.floor(Math.log10(min)); exponent <= Math.ceil(Math.log10(max)); exponent++) {
    for (const multiple of [1, 2, 5]) {
      const tick = Number((multiple * 10 ** exponent).toPrecision(12));
      if (tick >= min && tick <= max) withMultiples.push(tick);
    }
  }
  return withMultiples;
}

export interface Tick { value: number; label: string; px: number }
export type MarkerKind = 'nan' | 'posInf' | 'negInf' | 'nonPositive';
export interface Marker { kind: MarkerKind; idx: number; step: number; px: number; count: number }
/** One continuous line: `idx` = indices into the series, `px` = [x0, y0, x1, y1, ...] in pixels. */
export interface Line { idx: Int32Array; px: Float32Array }

export interface Frame {
  plot: { left: number; top: number; width: number; height: number };
  x: Scale;
  y: Scale;
  xTicks: Tick[];
  yTicks: Tick[];
  lines: Line[];
  smoothLines: Line[];
  markers: Marker[];
  notes: string[];
  pointsInView: number;
  drawnPoints: number;
  empty: boolean;
}

export interface FrameInput {
  series: CleanSeries;
  metric: Metric;
  prep: MetricPrep;
  scale: ScaleKind;
  /** Visible step range: x0 = left edge, x1 = right edge. */
  view: { x0: number; x1: number };
  width: number;
  height: number;
  smoothing: number;
  mode?: 'm4' | 'naive';
  locale?: string;
}

export const MARGIN = { left: 64, right: 12, top: 10, bottom: 24 };

export function computeFrame(input: FrameInput): Frame {
  const { series, prep, view, scale } = input;
  const locale = input.locale ?? 'en-US';
  const mode: Validity = scale === 'log' ? 'positive' : 'finite';
  const step = series.step;
  const values = prep.values;
  const plot = {
    left: MARGIN.left,
    top: MARGIN.top,
    width: Math.max(10, Math.floor(input.width - MARGIN.left - MARGIN.right)),
    height: Math.max(10, Math.floor(input.height - MARGIN.top - MARGIN.bottom)),
  };
  const viewStart = view.x0;
  const viewEnd = view.x1;
  const x = makeScale('linear', viewStart, viewEnd, plot.left, plot.left + plot.width);
  const firstVisible = lowerBound(step, viewStart);
  const endVisible = upperBound(step, viewEnd); // one past the last visible point
  const notes: string[] = [];

  // --- y domain: exact extent of the RAW data in view (never of the downsampled or smoothed line)
  let minValue: number;
  let maxValue: number;
  let empty = false;
  if (scale === 'log') {
    minValue = rangeMinPositive(values, prep.index, firstVisible, endVisible);
    maxValue = rangeExtent(values, prep.index, firstVisible, endVisible).max;
    if (!(minValue < Infinity) || !(maxValue > 0)) empty = true;
  } else {
    const extent = rangeExtent(values, prep.index, firstVisible, endVisible);
    minValue = extent.min;
    maxValue = extent.max;
    if (extent.argmin < 0) empty = true;
  }
  if (empty) {
    notes.push(endVisible > firstVisible ? 'No drawable values in view' : 'No points in view');
    minValue = scale === 'log' ? 1 : 0;
    maxValue = scale === 'log' ? 10 : 1;
  }
  // 5% padding so the extreme points don't touch the plot border
  let yMin: number;
  let yMax: number;
  if (scale === 'log') {
    const decades = Math.max(Math.log10(maxValue) - Math.log10(minValue), 0.2);
    yMin = minValue / 10 ** (decades * 0.05);
    yMax = maxValue * 10 ** (decades * 0.05);
  } else {
    const span = maxValue - minValue;
    const padding = span > 0 ? span * 0.05 : Math.abs(maxValue) * 0.1 || 1;
    yMin = minValue - padding;
    yMax = maxValue + padding;
  }
  const y = makeScale(scale, yMin, yMax, plot.top + plot.height, plot.top);

  // --- ticks
  const xTickSet = linearTicks(viewStart, viewEnd, Math.max(2, Math.floor(plot.width / 110)), 1);
  const xTicks = xTickSet.values.map((value) => ({ value, label: formatTick(value, xTickSet.step, locale), px: x.map(value) }));
  let yTicks: Tick[];
  if (scale === 'log') {
    yTicks = logTicks(yMin, yMax).map((value) => ({ value, label: formatTick(value, null, locale), px: y.map(value) }));
  } else {
    const yTickSet = linearTicks(yMin, yMax, Math.max(2, Math.floor(plot.height / 40)));
    yTicks = yTickSet.values.map((value) => ({ value, label: formatTick(value, yTickSet.step, locale), px: y.map(value) }));
  }

  // --- lines (per segment, never across NaN/Inf/gap)
  const columns = plot.width;
  const naive = input.mode === 'naive';
  const segments = prep.segments[mode];
  const segmentCount = segments.length / 2;
  const toLines = (lineValues: Float64Array, lineIndex: BlockIndex): Line[] => {
    const out: Line[] = [];
    // only segments that intersect the window: binary search the first whose last step >= viewStart
    let left = 0;
    let right = segmentCount;
    while (left < right) {
      const middle = (left + right) >>> 1;
      const segmentLastStep = step[segments[2 * middle + 1] - 1];
      if (segmentLastStep < viewStart) left = middle + 1;
      else right = middle;
    }
    for (let s = left; s < segmentCount; s++) {
      const segmentStart = segments[2 * s];
      const segmentEnd = segments[2 * s + 1];
      if (step[segmentStart] > viewEnd) break;
      const idx = m4Indices(step, lineValues, lineIndex, segmentStart, segmentEnd, viewStart, viewEnd, columns, naive);
      if (idx.length === 0) continue;
      const px = new Float32Array(idx.length * 2);
      for (let p = 0; p < idx.length; p++) {
        px[2 * p] = x.map(step[idx[p]]);
        px[2 * p + 1] = y.map(lineValues[idx[p]]);
      }
      out.push({ idx, px });
    }
    return out;
  };
  const lines = empty ? [] : toLines(values, prep.index);
  let smoothLines: Line[] = [];
  if (!empty && input.smoothing > 0) {
    const cacheKey = `${mode}:${input.smoothing}`;
    let smoothed = prep.smoothCache.get(cacheKey);
    if (!smoothed) {
      const smoothedValues = emaSmooth(values, segments, input.smoothing);
      smoothed = { values: smoothedValues, index: buildBlockIndex(smoothedValues) };
      prep.smoothCache.set(cacheKey, smoothed);
    }
    smoothLines = toLines(smoothed.values, smoothed.index);
  }

  // --- markers for values that can't be drawn as a line point (aggregated per pixel column)
  const invalid = prep.invalid[mode];
  const stepOf = (i: number) => step[i];
  const firstInvalidInView = lowerBoundBy(invalid, stepOf, viewStart);
  const endInvalidInView = upperBoundBy(invalid, stepOf, viewEnd);
  const markersByColumn = new Map<string, Marker>();
  const counts: Record<MarkerKind, number> = { nan: 0, posInf: 0, negInf: 0, nonPositive: 0 };
  for (let p = firstInvalidInView; p < endInvalidInView; p++) {
    const i = invalid[p];
    const value = values[i];
    const kind: MarkerKind =
      value !== value ? 'nan' : value === Infinity ? 'posInf' : value === -Infinity ? 'negInf' : 'nonPositive';
    counts[kind]++;
    const px = x.map(step[i]);
    const key = `${Math.floor(px)}:${kind}`;
    const existing = markersByColumn.get(key);
    if (existing) existing.count++;
    else markersByColumn.set(key, { kind, idx: i, step: step[i], px, count: 1 });
  }
  if (counts.nan) notes.push(`${counts.nan} NaN in view`);
  if (counts.posInf) notes.push(`${counts.posInf} +∞ in view`);
  if (counts.negInf) notes.push(`${counts.negInf} −∞ in view`);
  if (counts.nonPositive) notes.push(`${counts.nonPositive} value(s) ≤ 0 not plottable on log axis`);

  let drawnPoints = 0;
  for (const line of lines) drawnPoints += line.idx.length;
  return {
    plot, x, y, xTicks, yTicks, lines, smoothLines, markers: [...markersByColumn.values()], notes,
    pointsInView: endVisible - firstVisible, drawnPoints, empty,
  };
}

/** Binary search over `sorted` by a derived key: first position whose key >= target. */
function lowerBoundBy(sorted: Int32Array, key: (item: number) => number, target: number): number {
  let left = 0;
  let right = sorted.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (key(sorted[middle]) < target) left = middle + 1;
    else right = middle;
  }
  return left;
}

/** First position whose key > target. */
function upperBoundBy(sorted: Int32Array, key: (item: number) => number, target: number): number {
  let left = 0;
  let right = sorted.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (key(sorted[middle]) <= target) left = middle + 1;
    else right = middle;
  }
  return left;
}

export { bucketEdge };
